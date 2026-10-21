// The open document: editor lifecycle, open/save/import/export, source sync, ribbon state.
import { serverFn } from "aio";
import { signal } from "aio/air";
import { commands, history, model as pmModel, state, tables, view as pmView } from "../vendor/pm.js";
import type { model as M, state as S, view as V } from "../vendor/pm.js";
import type { files } from "../server/files.server.ts";
import { prefs } from "../cell/prefs.ts";
import * as core from "../core/index.ts";
import { type Att, para, str, walk, type X } from "../doc/xast.ts";
import { schema } from "./schema.ts";
import { fromPM, toPM } from "./convert.ts";
import { isPlain, plugins, setBlockAttr } from "./setup.ts";
import { clearFormat, list } from "./commands.ts";
import { formattingMarks, marksPlugin } from "./marks.ts";
import { slideFitPlugin } from "./slidefit.ts";
import { nodeViews, shapeKeys } from "./views.ts";
import { addAtt, allAtts, getAtt, pruneAtts, recompute, setAtts } from "./store.ts";
import { trackPlugin } from "./track.ts";
import { pagesPlugin } from "./paginate.ts";
import { highlightPlugin } from "./highlight.ts";
import { parseTable } from "./sheetview.ts";
import { fromCalc, sheetIdOf } from "./refs.ts";
import { textStats } from "./stats.ts";
import { findPlugin } from "./find.ts";
import { ask, choose, toast } from "../ui/dialog.ts";
import { toCsv, withExt } from "../ui/text.ts";

export const api = serverFn<typeof files>("files");

export type Active = {
  marks: Record<string, boolean>;
  /** Formatting marks (¶) shown. */
  pilcrow: boolean;
  /** Something is selected (Cut / Copy). */
  sel: boolean;
  block: string; // p h1..h6 code quote
  align: string;
  spacing: string;
  list: "" | "bullet" | "ordered" | "task";
  table: boolean;
  font: string;
  size: string;
  color: string;
  bg: string;
  node: string;
  undo: boolean;
  redo: boolean; // selected atom type, if any
};
const NO_ACTIVE: Active = {
  marks: {},
  pilcrow: false,
  sel: false,
  block: "p",
  align: "",
  spacing: "",
  list: "",
  table: false,
  font: "",
  size: "",
  color: "",
  bg: "",
  node: "",
  undo: false,
  redo: false,
};

export const doc = {
  path: signal(""),
  name: signal("Untitled"),
  dirty: signal(false),
  words: signal(0),
  chars: signal(0),
  /** Words in the selection (0 = no selection). */
  selWords: signal(0),
  active: signal<Active>(NO_ACTIVE),
  source: signal(""),
  stale: signal(false),
  meta: signal(""),
  /** First top-level heading: the {title} fallback, as in the saved file. */
  heading: signal(""),
  ready: signal(false),
};

let view: V.EditorView | null = null;
let sourceOpen = false;
let fromSource = false;
let calcTimer: ReturnType<typeof setTimeout> | undefined;
let srcTimer: ReturnType<typeof setTimeout> | undefined;

export const getView = (): V.EditorView | null => view;

// ── crash recovery: unsaved work is mirrored to a draft file ──

const draftId = crypto.randomUUID();
let draftTimer: ReturnType<typeof setTimeout> | undefined;
let drafted = false;
/** Drafts untouched this long belong to a closed/crashed window. */
const ORPHAN_MS = 3 * 60_000;

function saveDraft() {
  if (!view || !doc.dirty.peek()) return;
  const x = currentX();
  drafted = true;
  api.draftSave(draftId, doc.path.peek(), doc.name.peek(), core.fileBuild(x, usedAtts(x))).catch(() => {});
}

function dropDraft() {
  clearTimeout(draftTimer);
  if (drafted) (drafted = false, api.draftDrop(draftId).catch(() => {}));
}

/** Offer to restore drafts left by windows that closed without saving. */
async function recover() {
  const old = (await api.draftList().catch(() => [])).filter((d) => d.id !== draftId && Date.now() - d.time > ORPHAN_MS);
  for (const d of old) {
    const when = new Date(d.time).toLocaleString();
    const r = await choose("Document Recovery", `Writy found unsaved changes to "${d.name}" from ${when}. Restore them?`, [
      { label: "Restore", value: "restore", primary: true },
      { label: "Discard", value: "discard" },
      { label: "Later", value: "later" },
    ]);
    if (r === "discard") await api.draftDrop(d.id);
    if (r !== "restore") continue;
    if (!(await confirmDiscard())) return;
    const o = core.fileRead(await api.draftRead(d.id));
    load(core.djotParse(o.src), o.atts, d.path, d.name);
    doc.dirty.set(true);
    saveDraft();
    await api.draftDrop(d.id);
    toast(`Restored "${d.name}" — save to keep it.`);
    return;
  }
}

/** Word keys that need the command layer (setup.ts cannot import it). */
const WORD_KEYS: Record<string, S.Command> = {
  "Mod-Space": (_s, _d, v) => (v && clearFormat(v), true), // Ctrl+Space: plain text again
  "Mod-Shift-n": (s, d) => commands.setBlockType(schema.nodes.paragraph)(s, d) || true,
  "Mod-Shift-l": (_s, _d, v) => (v && list(v, "bullet"), true),
  "Mod-1": setBlockAttr("spacing", "1"),
  "Mod-2": setBlockAttr("spacing", "2"),
  "Mod-5": setBlockAttr("spacing", "1.5"),
};

const BLANK: X = { t: "doc", c: [{ t: "heading", level: 1, c: [] }, para([])] };

function makeState(d: M.Node): state.EditorState {
  return state.EditorState.create({
    doc: d,
    plugins: plugins([trackPlugin, findPlugin, pagesPlugin, highlightPlugin, marksPlugin, slideFitPlugin, shapeKeys], WORD_KEYS),
  });
}

export async function mount(el: HTMLElement): Promise<void> {
  await core.ready();
  view = new pmView.EditorView(el, {
    state: makeState(toPM(BLANK)),
    nodeViews,
    attributes: { class: "jw-page jw-editor", spellcheck: "true", "aria-label": "Document" },
    dispatchTransaction(tr) {
      const v = view!;
      v.updateState(v.state.apply(tr));
      if (tr.docChanged) changed();
      if (v.state.doc.attrs.meta !== doc.meta.peek()) doc.meta.set(v.state.doc.attrs.meta); // also after undo/redo of a page setting
      if (tr.docChanged) doc.heading.set(firstHeading(v.state.doc));
      if (tr.docChanged || tr.selectionSet) {
        const { from, to, empty } = v.state.selection;
        doc.selWords.set(empty ? 0 : textStats(v.state.doc, from, to).words);
      }
      doc.active.set(activeOf(v.state));
    },
    transformPasted: embedPasted,
    handleDOMEvents: {
      drop: (_v, e) => dropFiles(e as DragEvent),
      mousedown: (v, e) => tickBox(v, e as MouseEvent),
      paste: (_v, e) => pasteFiles(e as ClipboardEvent),
    },
  });
  doc.ready.set(true);
  afterLoad();
  setInterval(saveDraft, ORPHAN_MS / 3); // heartbeat: a live window's draft never looks orphaned
  recover();
}

let statsTimer: ReturnType<typeof setTimeout> | undefined;
function changed() {
  doc.dirty.set(true);
  clearTimeout(calcTimer);
  calcTimer = setTimeout(() => view && recompute(view.state.doc), 120);
  clearTimeout(statsTimer);
  statsTimer = setTimeout(stats, 250); // a full recount is O(document): wait for a pause in typing
  if (sourceOpen && !fromSource) {
    clearTimeout(srcTimer);
    srcTimer = setTimeout(syncSource, 250);
  }
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 3000);
}

function stats() {
  if (!view) return;
  const s = textStats(view.state.doc);
  doc.words.set(s.words);
  doc.chars.set(s.charsNoSpaces);
}

function activeOf(s: state.EditorState): Active {
  const { $from, from, to, empty } = s.selection;
  const marks: Record<string, boolean> = {};
  const set = empty ? (s.storedMarks ?? $from.marks()) : [];
  for (const [name, type] of Object.entries(schema.marks)) {
    // underline / strikethrough buttons light up for the plain marks only, not for tracked changes
    const hit = (m: M.Mark) => m.type === type && (name !== "ins" && name !== "del" || isPlain(m, type));
    let inRange = false;
    if (!empty) s.doc.nodesBetween(from, to, (n) => void (n.marks.some(hit) && (inRange = true)));
    marks[name] = empty ? set.some(hit) : inRange;
  }
  // a selection reports the look of its first character (not of the text just before it)
  const span = (empty ? set : (s.doc.nodeAt(from)?.marks ?? $from.marks())).filter((m) => m.type === schema.marks.span).reduce(
    (a, m) => ({ ...a, ...m.attrs.a }),
    {} as Record<string, string>,
  );
  const p = $from.parent;
  let block = p.type.name === "heading" ? `h${p.attrs.level}` : p.type.name === "code_block" ? "code" : "p";
  let list: Active["list"] = "";
  let table = false;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (!list && n.type.name === "bullet_list") list = n.attrs.task ? "task" : "bullet";
    if (!list && n.type.name === "ordered_list") list = "ordered";
    if (n.type.name === "blockquote" && block === "p") block = "quote";
    if (n.type.name === "table") table = true;
  }
  const node = s.selection instanceof state.NodeSelection ? s.selection.node.type.name : "";
  return {
    marks,
    pilcrow: formattingMarks(s),
    sel: !empty,
    block,
    align: p.attrs.a?.align ?? "",
    spacing: p.attrs.a?.spacing ?? "",
    list,
    table,
    font: span.font ?? "",
    size: span.size ?? "",
    color: span.color ?? "",
    bg: span.bg ?? "",
    node,
    undo: history.undoDepth(s) > 0,
    redo: history.redoDepth(s) > 0,
  };
}

// ── loading ──

function afterLoad() {
  if (!view) return;
  recompute(view.state.doc);
  stats();
  doc.dirty.set(false);
  dropDraft();
  doc.meta.set(view.state.doc.attrs.meta);
  doc.heading.set(firstHeading(view.state.doc));
  doc.active.set(activeOf(view.state));
  if (sourceOpen) syncSource();
}

export function load(x: X, atts: Att[], path: string, name: string): void {
  setAtts(atts);
  view?.updateState(makeState(toPM(x)));
  doc.path.set(path);
  doc.name.set(name);
  afterLoad();
}

/** New document, blank or from template source (Djot). */
export async function newDoc(src = ""): Promise<void> {
  if (!(await confirmDiscard())) return;
  load(src ? core.djotParse(src) : BLANK, [], "", "Untitled");
  doc.stale.set(false);
  view?.focus();
}

async function confirmDiscard(): Promise<boolean> {
  if (!doc.dirty.peek()) return true;
  const r = await choose("Writy", `Do you want to save the changes to "${doc.name.peek()}"?`, [
    { label: "Save", value: "save", primary: true },
    { label: "Don't Save", value: "discard" },
    { label: "Cancel", value: "cancel" },
  ]);
  if (r === "save") return await save();
  return r === "discard";
}

/** Window close with unsaved work. The desktop window shows no "Leave site?" box (Electron), so a bare veto made the
 *  close button do nothing: veto, ask Save / Don't Save / Cancel ourselves, then close for real. A browser tab asks itself. */
let leaving = false, asking = false;
export function beforeLeave(e: BeforeUnloadEvent): void {
  if (leaving || !doc.dirty.peek()) return;
  e.preventDefault();
  if (!("__aioWindow" in globalThis) || asking) return;
  asking = true;
  confirmDiscard().then((ok) => {
    asking = false;
    if (!ok) return;
    leaving = true;
    dropDraft();
    close();
  });
}

const u8 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, "");

/** Embed local images referenced by an imported document. */
async function embedLocal(x: X, dir: string): Promise<void> {
  const imgs: X[] = [];
  walk(x, (n) => {
    if (n.t === "image" && n.src && !/^(#|[a-z]+:)/i.test(n.src)) imgs.push(n);
  });
  for (const n of imgs) {
    try {
      const m = await api.readMedia(decodeURIComponent(n.src!), dir);
      n.src = addAtt(m.name, m.mime, m.b64);
    } catch {
      /* keep the original link if the file is missing */
    }
  }
}

export async function open(path?: string): Promise<void> {
  if (!(await confirmDiscard())) return;
  const p = path ?? (await prefs.pick("open"));
  if (!p) return;
  if (!(await api.exists(p))) {
    const r = await choose("File not found", `“${baseName(p)}” was moved, renamed or deleted.\n${p}`, [
      { label: "Remove from recent", value: "forget" },
      { label: "OK", value: "ok", primary: true },
    ]);
    if (r === "forget") prefs.forget(p);
    return;
  }
  try {
    const f = await api.read(p);
    let x: X;
    let atts: Att[] = [];
    let savePath = p;
    const keepName = f.name;
    setAtts([]);
    switch (f.ext) {
      case "html":
      case "htm": {
        const o = core.fileRead(f.text!);
        if (o.native) {
          x = core.djotParse(o.src);
          atts = o.atts;
          doc.stale.set(o.stale);
          if (o.stale) toast("The source was edited outside Writy — showing the source version.");
        } else {
          const r = core.htmlImport(f.text!);
          x = r.doc;
          atts = r.atts;
          await embedLocal(x, dirOf(p));
          savePath = "";
        }
        break;
      }
      case "dj":
      case "djot":
        x = core.djotParse(f.text!);
        await embedLocal(x, dirOf(p));
        savePath = p.replace(/\.(dj|djot)$/, ".html");
        break;
      case "md":
      case "markdown":
        x = core.mdImport(f.text!);
        await embedLocal(x, dirOf(p));
        savePath = p.replace(/\.(md|markdown)$/, ".html");
        break;
      case "csv":
      case "tsv": {
        const rows = parseTable(f.text!.replace(/\r\n?/g, "\n").replace(/\n+$/, ""));
        const w = Math.max(1, ...rows.map((r) => r.length));
        const id = sheetIdOf(baseName(p).replace(/\.[^.]+$/, ""));
        x = { t: "doc", c: [{ t: "raw", format: "sheet", a: { id }, s: core.gridFormat(rows.map((r) => [...r, ...Array(w - r.length).fill("")]), 1) }] };
        savePath = p.replace(/\.(csv|tsv)$/i, ".html");
        break;
      }
      case "xlsx":
      case "xlsm":
      case "xls":
      case "ods":
      case "fods":
      case "numbers": {
        toast("Reading the workbook with LibreOffice…");
        const book = await api.bookSheets(p);
        const ids = new Map<string, string>();
        for (const { name } of book) {
          let id = sheetIdOf(name);
          while ([...ids.values()].includes(id)) id += "_";
          ids.set(name, id);
        }
        // one heading + sheet per workbook sheet; formulas follow the new sheet names
        x = {
          t: "doc",
          c: book.flatMap(({ name, csv }) => {
            const rows = parseTable(csv.replace(/\r\n?/g, "\n").replace(/\n+$/, "")).map((r) => r.map((v) => fromCalc(v, ids)));
            const w = Math.max(1, ...rows.map((r) => r.length));
            const grid = core.gridFormat(rows.map((r) => [...r, ...Array(w - r.length).fill("")]), 1);
            const sheet: X = { t: "raw", format: "sheet", a: { id: ids.get(name)! }, s: grid };
            return book.length > 1 ? [{ t: "heading", level: 2, c: [str(name)] } as X, sheet] : [sheet];
          }),
        };
        savePath = p.replace(/\.[^.]+$/, ".html");
        break;
      }
      case "txt":
        x = { t: "doc", c: f.text!.split(/\r?\n\s*\r?\n/).map((b) => para([str(b.replace(/\r?\n/g, " "))])) };
        savePath = p.replace(/\.txt$/, ".html");
        break;
      case "docx": {
        const r = core.docxImport(u8(f.b64!));
        [x, atts] = [r.doc, r.atts];
        savePath = p.replace(/\.docx$/i, ".html");
        break;
      }
      case "odt": {
        const r = core.odtImport(u8(f.b64!));
        [x, atts] = [r.doc, r.atts];
        savePath = p.replace(/\.odt$/i, ".html");
        break;
      }
      case "pdf": {
        toast("Reading PDF…");
        const { xml, images } = await api.pdfXml(p);
        const r = core.pdfImport(xml, images);
        [x, atts] = [r.doc, r.atts];
        savePath = p.replace(/\.pdf$/i, ".html");
        break;
      }
      default: {
        toast("Converting with LibreOffice…");
        const r = core.docxImport(u8(await api.toDocx(p)));
        [x, atts] = [r.doc, r.atts];
        savePath = p.replace(/\.[^.]+$/, ".html");
      }
    }
    const existing = allAtts();
    load(x, [...existing, ...atts], savePath === p ? p : "", savePath === p ? keepName : keepName.replace(/\.[^.]+$/, ".html"));
    if (savePath !== p) {
      doc.dirty.set(true);
      toast(`Imported ${keepName} — Save to create a Writy .html file.`);
    }
    prefs.addRecent(p, keepName, Date.now());
  } catch (e) {
    toast(`Could not open “${baseName(p)}”: ${friendly(e)}`, "error");
  }
}

const baseName = (p: string) => p.replace(/^.*[\\/]/, "");

/** OS / tool errors → a sentence a person can act on. */
export function friendly(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if (/permission denied|os error 13|EACCES/i.test(m)) return "Writy isn't allowed to access this file or folder. Check its permissions.";
  if (/no space left|os error 28|ENOSPC/i.test(m)) return "the disk is full.";
  if (/read-only file system|os error 30|EROFS/i.test(m)) return "this location is read-only. Use Save as to pick another folder.";
  if (/no such file|os error 2\b|ENOENT/i.test(m)) return "the file or its folder no longer exists.";
  if (/stream did not contain valid UTF-8|invalid utf-8/i.test(m)) return "the file isn't readable text (wrong format or damaged).";
  return m;
}

// ── saving / export ──

export function currentX(): X {
  return fromPM(view!.state.doc);
}

function usedAtts(x: X): Att[] {
  const used = new Set<string>();
  walk(x, (n) => {
    const s = n.src ?? "";
    if (s.startsWith("#att:")) used.add(s.slice(5));
  });
  pruneAtts(used);
  return allAtts();
}

/** The exact .html that Save writes now (for the browser preview). */
export const fileHtml = (): string => {
  const x = currentX();
  return core.fileBuild(x, usedAtts(x));
};

export async function save(as = false): Promise<boolean> {
  if (!view) return false;
  let path = doc.path.peek();
  if (as || !path) {
    const picked = await chooseTarget(doc.name.peek().replace(/\.[^.]+$/, "") + ".html", ["html", "htm"]);
    if (!picked) return false;
    path = picked;
  }
  try {
    const x = currentX();
    const html = core.fileBuild(x, usedAtts(x));
    const r = await api.write(path, html);
    doc.path.set(r.path);
    doc.name.set(r.name);
    doc.dirty.set(false);
    dropDraft();
    doc.stale.set(false);
    prefs.addRecent(r.path, r.name, Date.now());
    toast(`Saved ${r.name}`);
    return true;
  } catch (e) {
    toast(`Could not save: ${friendly(e)}`, "error");
    return false;
  }
}

/** Folder dialog + file name (aio has no native save-as dialog yet). */
/** Folder, then file name; the right extension is added when the name has none of the accepted ones. */
async function chooseTarget(suggest: string, exts: string[]): Promise<string | null> {
  const dir = await prefs.pick("folder");
  if (!dir) return null;
  const typed = (await ask(`Save in ${dir} as:`, suggest))?.trim().replace(/[\\/]/g, "-");
  if (!typed) return null;
  const name = withExt(typed, exts);
  const path = `${dir}/${name}`;
  if (await api.exists(path)) {
    const ok = await choose("Confirm Save As", `${name} already exists. Do you want to replace it?`, [
      { label: "Replace", value: "yes", primary: true },
      { label: "Cancel", value: "no" },
    ]);
    if (ok !== "yes") return null;
  }
  return path;
}

export async function exportAs(kind: "dj" | "md" | "docx" | "odt", to?: string): Promise<void> {
  if (!view) return;
  const x = currentX();
  const path = to ?? (await chooseTarget(doc.name.peek().replace(/\.[^.]+$/, `.${kind}`), kind === "md" ? ["md", "markdown"] : [kind]));
  if (!path) return;
  if (kind === "docx" || kind === "odt") {
    toast("Converting with LibreOffice…");
    try {
      const r = await api.convertTo(core.fileBuild(x, usedAtts(x)), path, kind);
      toast(`Exported ${r.name}`);
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, "error");
    }
    return;
  }
  const text = kind === "dj" ? core.djotWrite(x) : core.mdExport(x);
  try {
    await api.write(path, text);
  } catch (e) {
    return toast(`Export failed: ${friendly(e)}`, "error");
  }
  if (allAtts().length) toast(`Exported text only — pictures stay in the .html file.`);
  else toast(`Exported ${path.replace(/^.*[\\/]/, "")}`);
}

/** One sheet as a .csv file (the values shown, not the formulas), for Excel / Calc / other tools. */
export async function saveCsv(sheet: string, rows: string[][], to?: string): Promise<void> {
  const path = to ?? (await chooseTarget(`${sheet}.csv`, ["csv"]));
  if (!path) return;
  try {
    await api.write(path, toCsv(rows));
    toast(`Saved ${path.replace(/^.*[\\/]/, "")}`);
  } catch (e) {
    toast(`Could not save: ${friendly(e)}`, "error");
  }
}

/** Print / Save as PDF: renders the exact saved-file view in a hidden frame. */
/**
 * Fill .jw-print with the document exactly as the saved file renders it (its own CSS, @page size, margins,
 * header/footer). The app's print stylesheet hides everything else. Runs on `beforeprint` too, because in the
 * desktop shell Ctrl+P is handled by the main process and never reaches the page.
 */
export function preparePrint(): void {
  if (!view) return;
  const x = currentX();
  const file = new DOMParser().parseFromString(core.fileBuild(x, usedAtts(x)), "text/html");
  let host = document.querySelector<HTMLElement>(".jw-print");
  if (!host) {
    host = document.createElement("div");
    host.className = "jw-print";
    document.body.append(host);
  }
  const css = [...file.head.querySelectorAll("style")].map((st) => Object.assign(document.importNode(st, true), { media: "print" })); // never restyle the editor on screen
  host.replaceChildren(...css, ...[...file.body.querySelectorAll("main.jw-page")].map((n) => document.importNode(n, true)));
}

export function print(): void {
  preparePrint();
  const ipc = (globalThis as { __aioIPC?: { print?: () => void } }).__aioIPC;
  if (ipc?.print) ipc.print(); // Electron: window.print() is a no-op on Linux, aio prints from the main process
  else globalThis.print();
}

// ── source view ──

export function setSourceOpen(open: boolean): void {
  sourceOpen = open;
  if (open) syncSource();
}

function syncSource() {
  if (view) doc.source.set(core.djotWrite(currentX()));
}

/** Source text edited by the user → replace the document (undoable). */
export function applySource(text: string): string | null {
  if (!view) return null;
  try {
    const next = toPM(core.djotParse(text));
    fromSource = true;
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, next.content).setDocAttribute("meta", next.attrs.meta).setDocAttribute(
      "css",
      next.attrs.css,
    );
    view.dispatch(tr);
    return null;
  } catch (e) {
    return (e as Error).message;
  } finally {
    fromSource = false;
  }
}

// ── page setup (the `=meta` block) ──

export function metaGet(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const l of String(view?.state.doc.attrs.meta ?? "").split("\n")) {
    const i = l.indexOf(":");
    if (i > 0) m[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  return m;
}

export function metaSet(patch: Record<string, string>): void {
  if (!view) return;
  const m = { ...metaGet(), ...patch };
  const text = Object.entries(m).filter(([, v]) => v !== "").map(([k, v]) => `${k}: ${v}`).join("\n");
  view.dispatch(view.state.tr.setDocAttribute("meta", text ? text + "\n" : ""));
}

/** A click on a checklist box (left of the item's text) ticks / unticks it. */
function tickBox(v: V.EditorView, e: MouseEvent): boolean {
  const li = (e.target as Element).closest?.("li.task");
  if (!li || e.button !== 0 || e.clientX >= li.getBoundingClientRect().left) return false;
  const pos = v.posAtDOM(li, 0);
  const $p = v.state.doc.resolve(pos);
  for (let d = $p.depth; d > 0; d--) {
    const n = $p.node(d);
    if (n.type === schema.nodes.list_item && n.attrs.checked !== null) {
      e.preventDefault();
      v.dispatch(v.state.tr.setNodeMarkup($p.before(d), null, { ...n.attrs, checked: !n.attrs.checked }));
      return true;
    }
  }
  return false;
}

function firstHeading(d: M.Node): string {
  for (let i = 0; i < d.childCount; i++) if (d.child(i).type.name === "heading") return d.child(i).textContent;
  return "";
}

/** How the SAVED FILE shows in a browser: pages (default, not written) or one web page. Not the editor view (prefs.layout). */
/** The `{title}` of headers/footers and the window: meta title, else the first heading (same rule as the saved file). */
export const docTitle = (m: Record<string, string> = metaGet()): string => m.title || doc.heading.peek() || "Untitled";
export const fileDisplay = (): "pages" | "web" => /^display:\s*web\s*$/m.test(doc.meta.value) ? "web" : "pages";
export const setFileDisplay = (d: "pages" | "web"): void => metaSet({ display: d === "web" ? "web" : "" });

// ── media ──

export async function insertMediaFromPath(path: string): Promise<void> {
  if (!view) return;
  const m = await api.readMedia(path);
  const src = addAtt(m.name, m.mime, m.b64);
  view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.image.create({ src, alt: m.name.replace(/\.[^.]+$/, "") })).scrollIntoView());
  view.focus();
}

function fileToB64(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
}

function insertFiles(list: File[], at?: number): boolean {
  const media = list.filter((f) => /^(image|video|audio)\//.test(f.type));
  if (!media.length || !view) return false;
  (async () => {
    for (const f of media) {
      const src = addAtt(f.name, f.type, await fileToB64(f));
      const node = schema.nodes.image.create({ src, alt: f.name.replace(/\.[^.]+$/, "") });
      const tr = at !== undefined ? view!.state.tr.insert(at, node) : view!.state.tr.replaceSelectionWith(node);
      view!.dispatch(tr);
    }
  })();
  return true;
}

/** Pasted pictures with data: URLs become attachments (the file stays self-contained). */
function embedPasted(slice: M.Slice): M.Slice {
  const map = (f: M.Fragment): M.Fragment => {
    const kids: M.Node[] = [];
    f.forEach((n) => {
      const m = /^data:([^;,]+);base64,(.*)$/s.exec(n.type === schema.nodes.image ? n.attrs.src : "");
      if (m) kids.push(n.type.create({ ...n.attrs, src: addAtt(`pasted.${m[1].split("/")[1] ?? "bin"}`, m[1], m[2]) }, n.content, n.marks));
      else kids.push(n.copy(map(n.content)));
    });
    return pmModel.Fragment.fromArray(kids);
  };
  return new pmModel.Slice(map(slice.content), slice.openStart, slice.openEnd);
}

function dropFiles(e: DragEvent): boolean {
  const list = [...(e.dataTransfer?.files ?? [])];
  if (!list.length || !view) return false;
  e.preventDefault();
  const pos = view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos;
  return insertFiles(list, pos);
}

function pasteFiles(e: ClipboardEvent): boolean {
  const list = [...(e.clipboardData?.files ?? [])];
  if (!list.length) return false;
  e.preventDefault();
  return insertFiles(list);
}

export { getAtt };

// Debug/automation handle (E2E tests, devtools): window.jw
(globalThis as Record<string, unknown>).jw = {
  load: (src: string) => load(core.djotParse(src), [], "", "Test.html"),
  source: () => core.djotWrite(currentX()),
  html: () => core.fileBuild(currentX(), allAtts()),
  view: () => view,
  /** Cell selection from the a-th to the b-th table cell, in document order (tests). */
  selectCells: (a: number, b: number) => {
    if (!view) return;
    const cells: number[] = [];
    view.state.doc.descendants((n, pos) => (/cell/.test(n.type.spec.tableRole ?? "") && cells.push(pos), true));
    view.dispatch(view.state.tr.setSelection(tables.CellSelection.create(view.state.doc, cells[a], cells[b])));
  },
  preparePrint: () => preparePrint(),
  /** Insert a picture/video/audio file from disk, as Insert ▸ Picture would after the file dialog (tests). */
  insertFile: (path: string) => insertMediaFromPath(path),
  /** Put the caret right after the first occurrence of `text` (tests). */
  caretAfter: (text: string) => {
    const ok = (globalThis as unknown as { jw: { select: (t: string) => boolean } }).jw.select(text);
    if (ok && view) view.dispatch(view.state.tr.setSelection(state.TextSelection.create(view.state.doc, view.state.selection.to)));
    return ok;
  },
  /** Select the first occurrence of `text` (tests). */
  select: (text: string) => {
    if (!view) return false;
    let at = -1;
    view.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isText) {
        const i = n.text!.indexOf(text);
        if (i >= 0) at = pos + i;
      }
      return at < 0;
    });
    if (at < 0) return false;
    view.dispatch(view.state.tr.setSelection(state.TextSelection.create(view.state.doc, at, at + text.length)));
    view.focus();
    return true;
  },
  fileHtml,
  saveTo: (path: string) => (doc.path.set(path), save()),
  open: (path: string) => (doc.dirty.set(false), open(path)),
  exportTo: (path: string, kind: "dj" | "md" | "docx" | "odt") => exportAs(kind, path),
};
