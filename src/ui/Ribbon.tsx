// The Word-style ribbon: File · Home · Insert · Layout · Review · View.
import type { JSX } from "aio";
import { useLocal } from "aio/air";
import { Icon } from "./icons.tsx";
import { prefs } from "../cell/prefs.ts";
import * as C from "../editor/commands.ts";
import { api, doc, fileDisplay, getView, insertMediaFromPath, metaGet, metaSet, setFileDisplay } from "../editor/session.ts";
import { ask, form, toast } from "./dialog.ts";
import { addComment, cutCopy, editLink, paste, showStats, stepNote, toggleTrack } from "./actions.ts";
import { setFormattingMarks } from "../editor/marks.ts";
import { tracking } from "../editor/track.ts";
import { addAtt } from "../editor/store.ts";
import { colLetters } from "../editor/refs.ts";
import { chartForm, editSelectedShape } from "../editor/views.ts";
import { lastRange } from "../editor/sheetview.ts";
import { backstage, findMode, hfOpen, painter, previewOpen, reviewPane, settingsOpen } from "./state.ts";
import ColorPick from "./ColorPick.tsx";
import TablePick from "./TablePick.tsx";
import { showShortcuts } from "./shortcuts.ts";
import { present } from "./Slideshow.tsx";
import { setZoom, zoomBy, zoomFit } from "./zoom.ts";

const FONTS = [
  "Default",
  "Arial",
  "Calibri",
  "Cambria",
  "Georgia",
  "Garamond",
  "Helvetica",
  "Inter",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Courier New",
];
const SIZES = C.FONT_SIZES;
const STYLES: [string, string][] = [["p", "Normal"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["h4", "Heading 4"], ["quote", "Quote"], [
  "code",
  "Code",
]];
const TABS = ["Home", "Insert", "Document", "Review", "UI"] as const;
/** What each tab is for — the line between the document (saved in the file) and the app (only on this computer). */
const TAB_TIPS: Record<string, string> = {
  Document: "Document: saved in the file — how it looks everywhere (this editor, a web browser, print)",
  UI: "UI: how this app looks and works for you — never saved in the document",
};
const CTX = ["Table", "Shape", "Picture"];
const SHAPES = [["rect", "Rectangle"], ["roundrect", "Rounded rectangle"], ["ellipse", "Oval"], ["arrow", "Arrow"], ["line", "Line"]] as const;

const keep = (e: MouseEvent) => e.preventDefault(); // keep the caret in the document
const v = () => getView();
const withView = (f: (view: C.View) => void) => () => {
  const view = v();
  if (view) f(view);
};

/** `text` = short caption beside a small icon (when the icon alone is ambiguous). */
function Btn(
  p: { icon: string; label: string; tip?: string; text?: string; on?: boolean; big?: boolean; onClick: () => void; disabled?: boolean },
): JSX.Element {
  return (
    <button
      type="button"
      class={`jw-btn${p.big ? " big" : ""}${p.text && !p.big ? " wide" : ""}${p.on ? " on" : ""}`}
      aria-label={p.label}
      aria-pressed={p.on ? "true" : false}
      title={p.tip ?? p.label}
      disabled={p.disabled}
      onMouseDown={keep}
      onClick={p.onClick}
    >
      <Icon name={p.icon} size={p.big ? 26 : 18} />
      {p.big ? <span class="jw-btn-label">{p.text ?? p.label.replace(/ \(.*\)$/, "")}</span> : p.text ? <span class="jw-btn-text">{p.text}</span> : null}
    </button>
  );
}

function Group(p: { title: string; children?: JSX.Children }): JSX.Element {
  return (
    <div class="jw-group" role="group" aria-label={p.title}>
      <div class="jw-group-body">{p.children}</div>
      <div class="jw-group-title">{p.title}</div>
    </div>
  );
}

async function insertTable() {
  const r = await form("Custom table size", [{ key: "rows", label: "Rows", value: "3" }, { key: "cols", label: "Columns", value: "3" }]);
  const view = v();
  if (!r || !view) return;
  C.insertTable(view, Math.max(1, Math.min(200, +r.rows || 3)), Math.max(1, Math.min(30, +r.cols || 3)));
}

async function insertMedia(kind: "picture" | "video") {
  try {
    const path = await prefs.pick(kind);
    if (path) await insertMediaFromPath(path);
  } catch (e) {
    toast((e as Error).message, "error");
  }
}

async function attachFile() {
  const path = await prefs.pick("any");
  const view = v();
  if (!path || !view) return;
  const m = await api.readMedia(path);
  const src = addAtt(m.name, m.mime, m.b64);
  C.insert(view, C.N.paragraph.create(null, view.state.schema.text(`📎 ${m.name}`, [C.K.link.create({ href: src })])));
}

function sheetId(): string {
  const ids = new Set<string>();
  v()?.state.doc.descendants((n) => {
    if (n.type.name === "sheet") ids.add(n.attrs.id);
    return true;
  });
  let i = 1;
  while (ids.has(`Sheet${i}`)) i++;
  return `Sheet${i}`;
}

async function insertChart() {
  const view = v();
  if (!view) return;
  // the range last selected in a sheet that still exists, else the whole first sheet
  const ids = new Set<string>();
  view.state.doc.descendants((n) => void (n.type.name === "sheet" && ids.add(n.attrs.id)));
  let first = ids.has(lastRange.split("!")[0]) ? lastRange : "";
  view.state.doc.descendants((n) => {
    if (!first && n.type.name === "sheet") {
      first = `${n.attrs.id}!A1:${colLetters((n.attrs.rows[0]?.length ?? 2) - 1)}${n.attrs.rows.length}`;
    }
    return true;
  });
  const r = await chartForm("Insert chart", first || "Sheet1!A1:B4", "bar", "");
  if (r) C.insert(view, C.node("chart", r));
}

async function insertCalc() {
  const view = v();
  if (!view) return;
  const ref = await ask("Show the value of cell (e.g. Sheet1!D4) — it updates when the sheet changes", "Sheet1!A1");
  if (ref) C.insert(view, C.node("calc", { ref }));
}

async function insertEquation() {
  const view = v();
  if (!view) return;
  const tex = await ask("Equation (LaTeX), e.g. E = mc^2", "");
  if (tex) C.insert(view, C.node("math", { tex }));
}

async function insertRaw() {
  const view = v();
  if (!view) return;
  const html = await ask("Raw HTML block (shown as-is in the saved document)", "<div></div>", true);
  if (html) C.insert(view, C.node("raw_block", { format: "html", text: html }));
}

async function insertFootnote() {
  const view = v();
  if (!view) return;
  const t = await ask("Footnote text", "");
  if (t !== null) C.footnote(view, t);
}

async function pageSetup() {
  const m = metaGet();
  const r = await form("Page setup", [
    { key: "page", label: "Paper size", value: m.page || "A4", options: ["A4", "A5", "A3", "Letter", "Legal"] },
    { key: "orientation", label: "Orientation", value: m.orientation || "portrait", options: ["portrait", "landscape"] },
    { key: "margin", label: "Margins (e.g. 20mm or 25mm 20mm)", value: m.margin || "20mm" },
  ]);
  if (r) metaSet({ ...r, orientation: r.orientation === "portrait" ? "" : r.orientation });
}

async function docProps() {
  const m = metaGet();
  const r = await form("Document properties", [
    { key: "title", label: "Title", value: m.title || "" },
    { key: "author", label: "Author", value: m.author || prefs.author },
    { key: "description", label: "Description", value: m.description || "" },
    { key: "lang", label: "Language (en, de, cs …)", value: m.lang || "" },
  ]);
  if (r) metaSet(r);
}

const DESIGNS = [["default", "Default"], ["modern", "Modern"], ["classic", "Classic"], ["report", "Report"], ["slides", "Slides"]];
/** Font family value for meta, with a generic fallback so the file still looks right without that font. */
const family = (f: string) =>
  /mono|courier/i.test(f) ? `${f}, monospace` : /arial|calibri|helvetica|inter|verdana|trebuchet/i.test(f) ? `${f}, sans-serif` : `${f}, serif`;

function docFont(key: "font" | "headings-font", label: string, cur = ""): JSX.Element {
  const name = cur.split(",")[0].trim();
  return (
    <select
      class="jw-select wide"
      aria-label={label}
      title={label}
      value={name || "Default"}
      onChange={(e: Event) => {
        const f = (e.target as HTMLSelectElement).value;
        metaSet({ [key]: f === "Default" ? "" : family(f) });
      }}
    >
      {FONTS.map((f) => (
        <option key={f} value={f} style={{ fontFamily: f === "Default" ? "inherit" : f }}>{f === "Default" ? `${label}: design default` : f}</option>
      ))}
      {name && !FONTS.includes(name) ? <option value={name}>{name}</option> : null}
    </select>
  );
}

async function setAuthor() {
  const name = await ask("Your name (used for comments and tracked changes)", prefs.author);
  if (name !== null) prefs.setAuthor(name);
}

/** Click: paint once. Double-click: keep painting until Esc or another click on the brush. */
function Painter(): JSX.Element {
  const on = painter.value;
  const arm = (sticky: boolean) => {
    const view = v();
    if (!view) return;
    if (on && !sticky) return painter.set(null);
    painter.set({ marks: C.copyFormat(view), sticky });
    view.focus();
  };
  return (
    <button
      type="button"
      class={`jw-btn${on ? " on" : ""}`}
      aria-label="Format painter (double-click to keep it on)"
      aria-pressed={on ? "true" : "false"}
      title="Format painter: copy the look of this text, then select text to paint it. Double-click to keep it on; Esc stops."
      onMouseDown={keep}
      onClick={() => arm(false)}
      onDblClick={() => arm(true)}
    >
      <Icon name="brush" size={18} />
    </button>
  );
}

function Home(): JSX.Element {
  const a = doc.active.value;
  const m = a.marks;
  return (
    <div class="jw-tab-body">
      <Group title="Clipboard">
        <Btn big icon="paste" label="Paste (Ctrl+V)" text="Paste" onClick={() => paste()} />
        <div class="jw-stack">
          <div class="jw-row">
            <Btn icon="cut" label="Cut (Ctrl+X)" disabled={!a.sel} onClick={() => cutCopy("cut")} />
            <Btn icon="copy" label="Copy (Ctrl+C)" disabled={!a.sel} onClick={() => cutCopy("copy")} />
            <Painter />
          </div>
          <div class="jw-row">
            <Btn icon="undo" label="Undo (Ctrl+Z)" disabled={!a.undo} onClick={withView(C.undo)} />
            <Btn icon="redo" label="Redo (Ctrl+Y)" disabled={!a.redo} onClick={withView(C.redo)} />
          </div>
        </div>
      </Group>
      <Group title="Font">
        <div class="jw-stack">
          <div class="jw-row">
            <select
              class="jw-select wide"
              aria-label="Font"
              title="Font"
              value={a.font || "Default"}
              onChange={(e: Event) => {
                const f = (e.target as HTMLSelectElement).value;
                const view = v();
                if (view) C.spanAttr(view, "font", f === "Default" ? "" : f);
              }}
            >
              {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f === "Default" ? "inherit" : f }}>{f}</option>)}
            </select>
            <select
              class="jw-select"
              aria-label="Font size"
              title="Font size"
              value={a.size || ""}
              onChange={(e: Event) => {
                const view = v();
                if (view) C.spanAttr(view, "size", (e.target as HTMLSelectElement).value);
              }}
            >
              <option value="">Size</option>
              {SIZES.map((s) => <option key={s} value={s}>{s.replace("pt", "")}</option>)}
            </select>
            <Btn icon="grow" label="Bigger text (Ctrl+])" onClick={withView((x) => C.stepSize(x, 1, a.size))} />
            <Btn icon="shrink" label="Smaller text (Ctrl+[)" onClick={withView((x) => C.stepSize(x, -1, a.size))} />
          </div>
          <div class="jw-row">
            <Btn icon="bold" label="Bold (Ctrl+B)" on={m.strong} onClick={withView((x) => C.toggle(x, "strong"))} />
            <Btn icon="italic" label="Italic (Ctrl+I)" on={m.em} onClick={withView((x) => C.toggle(x, "em"))} />
            <Btn icon="underline" label="Underline (Ctrl+U)" on={m.ins} onClick={withView((x) => C.toggle(x, "ins"))} />
            <Btn icon="strike" label="Strikethrough (Ctrl+Shift+X)" on={m.del} onClick={withView((x) => C.toggle(x, "del"))} />
            <Btn icon="sup" label="Superscript (Ctrl+.)" on={m.sup} onClick={withView((x) => C.toggle(x, "sup"))} />
            <Btn icon="sub" label="Subscript (Ctrl+,)" on={m.sub} onClick={withView((x) => C.toggle(x, "sub"))} />
            <ColorPick kind="bg" />
            <ColorPick kind="color" />
            <Btn icon="code" label="Inline code (Ctrl+`)" on={m.code} onClick={withView((x) => C.toggle(x, "code"))} />
            <Btn icon="eraser" label="Clear formatting" onClick={withView(C.clearFormat)} />
          </div>
        </div>
      </Group>
      <Group title="Paragraph">
        <div class="jw-stack">
          <div class="jw-row">
            <Btn icon="ul" label="Bullets" on={a.list === "bullet"} onClick={withView((x) => C.list(x, "bullet"))} />
            <Btn icon="ol" label="Numbering" on={a.list === "ordered"} onClick={withView((x) => C.list(x, "ordered"))} />
            <Btn icon="task" label="Checklist" on={a.list === "task"} onClick={withView((x) => C.list(x, "task"))} />
            <Btn icon="outdent" label="Decrease indent (Shift+Tab)" onClick={withView(C.outdent)} />
            <Btn icon="indent" label="Increase indent (Tab)" onClick={withView(C.indent)} />
            <Btn
              icon="pilcrow"
              label="Show formatting marks (¶)"
              tip="Show spaces · line breaks ↵ and paragraph ends ¶ — on screen only, never printed or saved"
              on={a.pilcrow}
              onClick={withView((x) => setFormattingMarks(x, !a.pilcrow))}
            />
          </div>
          <div class="jw-row">
            <Btn icon="left" label="Align left (Ctrl+L)" on={!a.align || a.align === "left"} onClick={withView((x) => C.blockAttr(x, "align", ""))} />
            <Btn icon="center" label="Center (Ctrl+E)" on={a.align === "center"} onClick={withView((x) => C.blockAttr(x, "align", "center"))} />
            <Btn icon="right" label="Align right (Ctrl+R)" on={a.align === "right"} onClick={withView((x) => C.blockAttr(x, "align", "right"))} />
            <Btn icon="justify" label="Justify (Ctrl+J)" on={a.align === "justify"} onClick={withView((x) => C.blockAttr(x, "align", "justify"))} />
            <select
              class="jw-select"
              aria-label="Line spacing"
              title="Line spacing"
              value={a.spacing}
              onChange={(e: Event) => {
                const view = v();
                if (view) C.blockAttr(view, "spacing", (e.target as HTMLSelectElement).value);
              }}
            >
              <option value="">Spacing</option>
              <option value="1">1.0</option>
              <option value="1.15">1.15</option>
              <option value="1.5">1.5</option>
              <option value="2">2.0</option>
            </select>
          </div>
        </div>
      </Group>
      <Group title="Styles">
        <div class="jw-styles">
          {STYLES.map(([k, label]) => (
            <button
              key={k}
              type="button"
              class={`jw-style s-${k}${a.block === k ? " on" : ""}`}
              aria-label={`Style ${label}`}
              aria-pressed={a.block === k ? "true" : "false"}
              onMouseDown={keep}
              onClick={withView((x) => C.block(x, k))}
            >
              {label}
            </button>
          ))}
        </div>
      </Group>
      <Group title="Editing">
        <Btn icon="search" label="Find" onClick={() => findMode.set("find")} />
        <Btn icon="replace" label="Replace" onClick={() => findMode.set("replace")} />
      </Group>
    </div>
  );
}

function Insert(): JSX.Element {
  return (
    <div class="jw-tab-body">
      <Group title="Tables">
        <TablePick onPick={(r, c) => withView((x) => C.insertTable(x, r, c))()} onCustom={insertTable} />
        <Btn big icon="sheet" label="Spreadsheet" onClick={withView((x) => C.insertSheet(x, sheetId()))} />
        <Btn big icon="chart" label="Chart" onClick={insertChart} />
        <Btn big icon="calc" label="Cell value" onClick={insertCalc} />
      </Group>
      <Group title="Media">
        <Btn big icon="image" label="Picture" onClick={() => insertMedia("picture")} />
        <Btn big icon="video" label="Video" onClick={() => insertMedia("video")} />
        <Btn big icon="attach" label="Attach file" onClick={attachFile} />
      </Group>
      <Group title="Shapes">
        <div class="jw-stack">
          <div class="jw-row">
            {SHAPES.slice(0, 3).map(([k, label]) => (
              <Btn
                key={k}
                icon={k}
                label={label}
                onClick={withView((x) => C.insert(x, C.node("shape", { kind: k })))}
              />
            ))}
          </div>
          <div class="jw-row">
            <Btn
              icon="arrow"
              label="Arrow"
              onClick={withView((x) => C.insert(x, C.node("shape", { kind: "arrow", w: "50mm", h: "0mm", a: { from: "tl" } })))}
            />
            <Btn icon="line" label="Line" onClick={withView((x) => C.insert(x, C.node("shape", { kind: "line", w: "50mm", h: "0mm", a: { from: "tl" } })))} />
            <Btn
              icon="textbox"
              label="Text box"
              onClick={withView((x) => C.insert(x, C.node("shape", { kind: "rect", fill: "#fffbe6", stroke: "#d4b02c", text: "Text box" })))}
            />
          </div>
        </div>
      </Group>
      <Group title="Text">
        <div class="jw-cols3">
          <Btn icon="link" label="Link (Ctrl+K)" text="Link" onClick={editLink} />
          <Btn icon="footnote" label="Footnote" text="Footnote" onClick={insertFootnote} />
          <Btn icon="sigma" label="Equation" text="Equation" onClick={insertEquation} />
          <Btn icon="code" label="Code block" text="Code" onClick={withView((x) => C.block(x, "code"))} />
          <Btn icon="quote" label="Quote" text="Quote" onClick={withView((x) => C.block(x, "quote"))} />
          <Btn icon="raw" label="Raw HTML" text="HTML" onClick={insertRaw} />
        </div>
      </Group>
      <Group title="Pages">
        <div class="jw-cols2">
          <Btn icon="pagebreak" label="Page break (Ctrl+Enter)" text="Page break" onClick={withView((x) => C.insert(x, C.node("page_break")))} />
          <Btn icon="hr" label="Horizontal line" text="Line" onClick={withView((x) => C.insert(x, C.node("horizontal_rule")))} />
          <Btn icon="toc" label="Table of contents" text="Contents" onClick={withView((x) => C.insert(x, C.node("toc")))} />
          <Btn
            icon="slide"
            label="Slide"
            text="Slide"
            onClick={withView(C.insertSlide)}
          />
          <Btn icon="notes" label="Speaker notes (shown only in the presenter view)" text="Notes" onClick={withView(C.insertNotes)} />
        </div>
      </Group>
    </div>
  );
}

function TableTools(): JSX.Element {
  void doc.active.value; // redraw as the caret moves between tables and cells
  const view = v();
  const t = (c: Parameters<typeof C.tableCmd>[1]) => withView((x) => C.tableCmd(x, c));
  return (
    <div class="jw-tab-body">
      <Group title="Insert">
        <div class="jw-stack">
          <div class="jw-row">
            <Btn icon="rowadd" label="Insert row above" text="Above" onClick={t("addRowBefore")} />
            <Btn icon="rowadd" label="Insert row below" text="Below" onClick={t("addRowAfter")} />
          </div>
          <div class="jw-row">
            <Btn icon="coladd" label="Insert column left" text="Left" onClick={t("addColumnBefore")} />
            <Btn icon="coladd" label="Insert column right" text="Right" onClick={t("addColumnAfter")} />
          </div>
        </div>
      </Group>
      <Group title="Delete">
        <div class="jw-stack">
          <Btn icon="x" label="Delete row" text="Row" onClick={t("deleteRow")} />
          <Btn icon="x" label="Delete column" text="Column" onClick={t("deleteColumn")} />
        </div>
      </Group>
      <Group title="Cells">
        <div class="jw-stack">
          <div class="jw-row">
            <Btn icon="merge" label="Merge cells" text="Merge" onClick={t("mergeCells")} />
            <Btn icon="split" label="Split cell" text="Split" onClick={t("splitCell")} />
          </div>
          <div class="jw-row">
            <Btn icon="header" label="Header row" text="Header row" onClick={t("toggleHeaderRow")} />
            <ColorPick kind="cell" />
            <select
              class="jw-select"
              aria-label="Vertical alignment"
              title="Vertical alignment of the selected cells"
              value={view ? C.cellValign(view) : ""}
              onChange={(e: Event) => view && C.cellAttr(view, "valign", (e.target as HTMLSelectElement).value)}
            >
              <option value="">Top</option>
              <option value="middle">Middle</option>
              <option value="bottom">Bottom</option>
            </select>
          </div>
        </div>
      </Group>
      <Group title="Table">
        <div class="jw-stack">
          <select
            class="jw-select"
            aria-label="Table style"
            title="Table style: grid, banded rows, lines between rows, no borders"
            value={view ? C.tableStyle(view) : ""}
            onChange={(e: Event) => view && C.setTableStyle(view, (e.target as HTMLSelectElement).value)}
          >
            {C.TABLE_STYLES.map(([c, name]) => <option key={c} value={c}>{name}</option>)}
          </select>
          <Btn icon="trash" label="Delete table" text="Delete" onClick={t("deleteTable")} />
        </div>
      </Group>
    </div>
  );
}

/** Contextual tab for a selected shape (Word: Shape Format). */
function ShapeTools(): JSX.Element {
  const view = v();
  const n = view && C.selected(view)?.node;
  if (!n) return <div class="jw-tab-body" />;
  const a = n.attrs as Record<string, string>;
  const set = (attrs: Record<string, string>) => withView((x) => C.setSelected(x, attrs));
  const color = (key: "fill" | "stroke", label: string) => (
    <label class="jw-color big" title={label}>
      <span>{label}</span>
      <input
        type="color"
        aria-label={label}
        value={/^#[0-9a-f]{6}$/i.test(a[key]) ? a[key] : "#ffffff"}
        onInput={(e: Event) => set({ [key]: (e.target as HTMLInputElement).value })()}
      />
    </label>
  );
  const size = async () => {
    const r = await form("Shape size and position", [
      { key: "w", label: "Width", value: a.w },
      { key: "h", label: "Height", value: a.h },
      { key: "x", label: "Left (from paragraph)", value: a.x },
      { key: "y", label: "Top (from paragraph)", value: a.y },
    ]);
    if (r) set(Object.fromEntries(Object.entries(r).map(([k, val]) => [k, /^-?[\d.]+$/.test(val) ? `${val}mm` : val])))();
  };
  const look = (n.attrs.a ?? {}) as Record<string, string>;
  const setLook = (patch: Record<string, string>) => withView((x) => C.setSelected(x, {}, patch));
  return (
    <div class="jw-tab-body">
      <Group title="Shape">
        {SHAPES.map(([k, name]) => <Btn key={k} icon={k} label={name} tip={`Change to ${name.toLowerCase()}`} on={a.kind === k} onClick={set({ kind: k })} />)}
      </Group>
      <Group title="Style">
        {color("fill", "Fill")}
        <Btn icon="x" label="No fill" onClick={set({ fill: "none" })} />
        {color("stroke", "Outline")}
      </Group>
      <Group title="Text">
        <Btn big icon="textbox" label="Type text (Enter)" onClick={withView((x) => void editSelectedShape(x))} />
        <div class="jw-stack">
          <div class="jw-row">
            <select
              class="jw-select"
              aria-label="Text size"
              title="Text size"
              value={look.size ?? ""}
              onChange={(e: Event) => setLook({ size: (e.target as HTMLSelectElement).value })()}
            >
              {[["", "Normal"], ["9pt", "Small"], ["14pt", "Large"], ["20pt", "Larger"], ["28pt", "Title"], ["40pt", "Huge"]].map(([val, name]) => (
                <option key={val} value={val}>{name}</option>
              ))}
            </select>
            <label class="jw-color" title="Text colour">
              <input
                type="color"
                aria-label="Text colour"
                value={/^#[0-9a-f]{6}$/i.test(look.color ?? "") ? look.color : "#1f2328"}
                onInput={(e: Event) => setLook({ color: (e.target as HTMLInputElement).value })()}
              />
            </label>
          </div>
          <div class="jw-row">
            {(["left", "center", "right"] as const).map((al) => (
              <Btn
                key={al}
                icon={al}
                label={`Text ${al}`}
                on={(look.align || "center") === al}
                onClick={setLook({ align: al === "center" ? "" : al })}
              />
            ))}
          </div>
        </div>
      </Group>
      <Group title="Size">
        <Btn big icon="margins" label="Size & position" onClick={size} />
      </Group>
      <Group title="Arrange">
        <Btn big icon="trash" label="Delete shape" onClick={withView(C.deleteSelected)} />
      </Group>
    </div>
  );
}

/** Contextual tab for a selected picture/video (Word: Picture Format). */
function PictureTools(): JSX.Element {
  const view = v();
  const n = view && C.selected(view)?.node;
  if (!n) return <div class="jw-tab-body" />;
  const a = (n.attrs.a ?? {}) as Record<string, string>;
  const da = (patch: Record<string, string>) => withView((x) => C.setSelected(x, {}, patch));
  const width = async () => {
    const w = await ask("Picture width (e.g. 80mm, 50%, 300px — empty = natural size)", a.width ?? "");
    if (w !== null) da({ width: /^[\d.]+$/.test(w.trim()) ? `${w.trim()}mm` : w.trim() })();
  };
  const alt = async () => {
    const t = await ask("Alt text (describes the picture for screen readers)", n.attrs.alt);
    if (t !== null) withView((x) => C.setSelected(x, { alt: t }))();
  };
  return (
    <div class="jw-tab-body">
      <Group title="Accessibility">
        <Btn big icon="comment" label="Alt text" onClick={alt} />
      </Group>
      <Group title="Wrap text">
        <Btn icon="justify" label="In line with text" on={!a.float} onClick={da({ float: "" })} />
        <Btn icon="left" label="Float left" on={a.float === "left"} onClick={da({ float: "left" })} />
        <Btn icon="right" label="Float right" on={a.float === "right"} onClick={da({ float: "right" })} />
      </Group>
      <Group title="Size">
        <Btn icon="margins" label="Width" onClick={width} />
        <Btn icon="undo" label="Reset size" onClick={da({ width: "", height: "" })} />
        {["25%", "50%", "100%"].map((w) => (
          <button key={w} type="button" class={`jw-chip${a.width === w ? " on" : ""}`} aria-label={`Width ${w}`} onMouseDown={keep} onClick={da({ width: w })}>
            {w}
          </button>
        ))}
      </Group>
      <Group title="Arrange">
        <Btn big icon="trash" label="Delete picture" onClick={withView(C.deleteSelected)} />
      </Group>
    </div>
  );
}

/** Document tab: settings SAVED IN THE FILE — how the document looks anywhere: in this editor, in a browser, on paper. */
function DocumentTab(): JSX.Element {
  const m = (doc.meta.value, metaGet());
  return (
    <div class="jw-tab-body">
      <Group title="Page">
        <Btn big icon="page" label="Page setup" onClick={pageSetup} />
        <select
          class="jw-select"
          aria-label="Paper size"
          title="Paper size"
          value={m.page || "A4"}
          onChange={(e: Event) => metaSet({ page: (e.target as HTMLSelectElement).value })}
        >
          {["A4", "A5", "A3", "Letter", "Legal"].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <Btn
          icon="rotate"
          label={m.orientation === "landscape" ? "Portrait" : "Landscape"}
          on={m.orientation === "landscape"}
          onClick={() => metaSet({ orientation: m.orientation === "landscape" ? "" : "landscape" })}
        />
        <select
          class="jw-select"
          aria-label="Margins"
          title="Margins"
          value={m.margin || "20mm"}
          onChange={(e: Event) => metaSet({ margin: (e.target as HTMLSelectElement).value })}
        >
          {[["12.7mm", "Narrow"], ["20mm", "Normal"], ["25mm", "Moderate"], ["38mm", "Wide"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          {m.margin && !["12.7mm", "20mm", "25mm", "38mm"].includes(m.margin) ? <option value={m.margin}>Custom</option> : null}
        </select>
      </Group>
      <Group title="Look">
        <div class="jw-stack">
          <div class="jw-row">
            <select
              class="jw-select wide"
              aria-label="Document design"
              title="Document design (colours, heading style, spacing)"
              value={m.theme || "default"}
              onChange={(e: Event) => metaSet({ theme: (e.target as HTMLSelectElement).value === "default" ? "" : (e.target as HTMLSelectElement).value })}
            >
              {DESIGNS.map(([t, l]) => <option key={t} value={t}>{l}</option>)}
            </select>
            <select
              class="jw-select"
              aria-label="Base text size"
              title="Base text size"
              value={m.size || ""}
              onChange={(e: Event) => metaSet({ size: (e.target as HTMLSelectElement).value })}
            >
              <option value="">Size</option>
              {["9pt", "10pt", "11pt", "12pt", "13pt", "14pt"].map((z) => <option key={z} value={z}>{z.replace("pt", "")}</option>)}
            </select>
          </div>
          <div class="jw-row">
            {docFont("font", "Body font", m.font)}
            {docFont("headings-font", "Headings font", m["headings-font"])}
          </div>
        </div>
      </Group>
      <Group title="Colours">
        <div class="jw-stack">
          <ColorPick kind="page" />
          <ColorPick kind="ink" />
          <ColorPick kind="desk" />
        </div>
      </Group>
      <Group title="Header & footer">
        <Btn big icon="header" label="Header / Footer" onClick={() => hfOpen.set(true)} />
      </Group>
      <Group title="In a browser">
        <div class="jw-stack">
          <Btn
            icon="print"
            text="Pages"
            label="Opens as pages"
            tip="When the saved .html file is opened in a web browser it shows pages, with header and footer"
            on={fileDisplay() === "pages"}
            onClick={() => setFileDisplay("pages")}
          />
          <Btn
            icon="web"
            text="Web page"
            label="Opens as a web page"
            tip="When the saved .html file is opened in a web browser it shows one flowing web page"
            on={fileDisplay() === "web"}
            onClick={() => setFileDisplay("web")}
          />
        </div>
        <Btn
          big
          icon="eye"
          label="Browser preview"
          tip="Browser preview (Ctrl+F2): the saved file exactly as a web browser shows it"
          onClick={() => previewOpen.set(true)}
        />
      </Group>
      <Group title="Info">
        <Btn big icon="info" label="Properties" onClick={docProps} />
      </Group>
    </div>
  );
}

function Review(): JSX.Element {
  const on = tracking();
  return (
    <div class="jw-tab-body">
      <Group title="Comments">
        <Btn big icon="comment" label="New comment" onClick={addComment} />
        <Btn big icon="resolve" label="Resolve" onClick={withView(C.resolveComment)} />
        <div class="jw-stack">
          <Btn icon="up" label="Previous comment or change" text="Previous" onClick={() => stepNote(-1)} />
          <Btn icon="down" label="Next comment or change" text="Next" onClick={() => stepNote(1)} />
        </div>
        <Btn big icon="pane" label="Reviewing pane" on={reviewPane.value} onClick={() => reviewPane.set(!reviewPane.peek())} />
      </Group>
      <Group title="Tracking">
        <Btn big icon="track" label={on ? "Tracking on (Ctrl+Shift+E)" : "Track changes (Ctrl+Shift+E)"} on={on} onClick={toggleTrack} />
        <Btn big icon="check" label="Accept all" onClick={withView((x) => C.settleChanges(x, true))} />
        <Btn big icon="x" label="Reject all" onClick={withView((x) => C.settleChanges(x, false))} />
      </Group>
      <Group title="Proofing">
        <Btn big icon="count" label="Word count" onClick={showStats} />
      </Group>
    </div>
  );
}

/** UI tab: how THIS APP looks and works for you on this computer. Never saved in the document. */
function UiTab(): JSX.Element {
  return (
    <div class="jw-tab-body">
      <Group title="Editor view">
        <Btn
          big
          icon="print"
          label="Print layout"
          tip="Print layout: see pages while you edit. Only this editor — the document is not changed (Document ▸ In a browser)"
          on={prefs.layout === "print"}
          onClick={() => prefs.setLayout("print")}
        />
        <Btn
          big
          icon="web"
          label="Web layout"
          tip="Web layout: one flowing page while you edit. Only this editor — the document is not changed (Document ▸ In a browser)"
          on={prefs.layout === "web"}
          onClick={() => prefs.setLayout("web")}
        />
        <Btn
          big
          icon="source"
          label="Source"
          tip="Show the document's text source beside the page"
          on={prefs.showSource}
          onClick={() => prefs.toggleSource()}
        />
      </Group>
      <Group title="Show">
        <Btn big icon="toc" label="Navigation" on={prefs.nav} onClick={() => prefs.toggleNav()} />
        <Btn big icon="pane" label="Reviewing" on={reviewPane.value} onClick={() => reviewPane.set(!reviewPane.peek())} />
      </Group>
      <Group title="Zoom">
        <Btn icon="zoomout" label="Zoom out (Ctrl+−)" onClick={() => zoomBy(-1)} />
        <button type="button" class="jw-btn text" aria-label="Zoom 100% (Ctrl+0)" title="Back to 100% (Ctrl+0)" onMouseDown={keep} onClick={() => setZoom(100)}>
          {prefs.zoom}%
        </button>
        <Btn icon="zoomin" label="Zoom in (Ctrl+=)" onClick={() => zoomBy(1)} />
        <Btn icon="page" label="Page width" onClick={() => zoomFit("width")} />
        <Btn icon="print" label="Whole page" onClick={() => zoomFit("page")} />
      </Group>
      <Group title="Present">
        <Btn big icon="play" label="Present (F5)" onClick={() => present()} />
        <Btn icon="play" label="From here (Shift+F5)" onClick={() => present(true)} />
      </Group>
      <Group title="App theme">
        <Btn
          big
          icon="monitor"
          label="System"
          tip="App theme: follow the desktop (documents keep their own look)"
          on={prefs.dark === "auto"}
          onClick={() => prefs.setDark("auto")}
        />
        <Btn
          big
          icon="sun"
          label="Light"
          tip="App theme: light (documents keep their own look)"
          on={prefs.dark === "light"}
          onClick={() => prefs.setDark("light")}
        />
        <Btn
          big
          icon="moon"
          label="Dark"
          tip="App theme: dark (documents keep their own look)"
          on={prefs.dark === "dark"}
          onClick={() => prefs.setDark("dark")}
        />
      </Group>
      <Group title="You">
        <Btn big icon="user" label="Your name" tip="Your name: shown on your comments and tracked changes" onClick={setAuthor} />
      </Group>
      <Group title="More">
        <Btn
          big
          icon="gear"
          label="Options"
          tip="Options: how Writy looks and works for you (never saved in documents)"
          onClick={() => settingsOpen.set(true)}
        />
        <Btn big icon="keyboard" label="Shortcuts (F1)" onClick={showShortcuts} />
      </Group>
    </div>
  );
}

function tabKeys(e: KeyboardEvent) {
  const all = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"]')];
  const i = all.indexOf(document.activeElement as HTMLElement);
  const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[e.key];
  if (to === undefined || i < 0) return;
  e.preventDefault();
  all[(to + all.length) % all.length].focus();
}

export default function Ribbon(): JSX.Element {
  const [tab, setTab] = useLocal<string>("Home");
  const [peek, setPeek] = useLocal(false); // collapsed ribbon: a tab click shows it until the next command
  const act = doc.active.value;
  const ctx = act.node === "shape" ? "Shape" : act.node === "image" ? "Picture" : act.table ? "Table" : "";
  const tabs: string[] = [...TABS, ...(ctx ? [ctx] : [])];
  const cur = CTX.includes(tab) && tab !== ctx ? "Home" : tab;
  return (
    <header class="jw-ribbon">
      <nav class="jw-tabs" role="tablist" aria-label="Ribbon" onKeyDown={tabKeys}>
        <button type="button" class="jw-tab file" role="tab" tabIndex={-1} aria-label="File" onClick={() => backstage.set(true)}>File</button>
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={cur === t ? "true" : "false"}
            tabIndex={cur === t ? 0 : -1}
            class={`jw-tab${cur === t ? " on" : ""}${CTX.includes(t) ? " ctx" : ""}`}
            aria-label={`${t} tab`}
            title={TAB_TIPS[t]}
            onMouseDown={keep}
            onClick={() => (setTab(t), prefs.ribbonMin && setPeek(!(peek && t === cur)))}
            onDblClick={() => (prefs.toggleRibbon(), setPeek(false))}
          >
            {t}
          </button>
        ))}
        <span class="jw-title" aria-live="polite">{doc.name.value}{doc.dirty.value ? " •" : ""}</span>
        <button
          type="button"
          class="jw-collapse"
          aria-label={prefs.ribbonMin ? "Show ribbon (Ctrl+F1)" : "Collapse ribbon (Ctrl+F1)"}
          title={prefs.ribbonMin ? "Show ribbon (Ctrl+F1)" : "Collapse ribbon (Ctrl+F1)"}
          onMouseDown={keep}
          onClick={() => (prefs.toggleRibbon(), setPeek(false))}
        >
          {prefs.ribbonMin ? "⌄" : "⌃"}
        </button>
      </nav>
      {prefs.ribbonMin && !peek ? null : (
        <div
          class={prefs.ribbonMin ? "jw-ribbon-peek" : ""}
          onClick={() => prefs.ribbonMin && setTimeout(() => setPeek(false), 0)}
          onKeyDown={(e: KeyboardEvent) => prefs.ribbonMin && e.key === "Escape" && setPeek(false)}
        >
          {cur === "Home"
            ? <Home />
            : cur === "Insert"
            ? <Insert />
            : cur === "Document"
            ? <DocumentTab />
            : cur === "Review"
            ? <Review />
            : cur === "Table"
            ? <TableTools />
            : cur === "Shape"
            ? <ShapeTools />
            : cur === "Picture"
            ? <PictureTools />
            : <UiTab />}
        </div>
      )}
    </header>
  );
}
