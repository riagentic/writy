// Shared user actions (ribbon, context menu, shortcuts).
import { prefs } from "../cell/prefs.ts";
import * as C from "../editor/commands.ts";
import { getView } from "../editor/session.ts";
import { jump, neighbor, notes } from "../editor/review.ts";
import { textStats } from "../editor/stats.ts";
import { setTracking, tracking } from "../editor/track.ts";
import { pages } from "./paper.ts";
import { ask, choose, form, info, toast } from "./dialog.ts";

/** Ctrl+K: insert or edit a link (text + address). */
export async function editLink(): Promise<void> {
  const v = getView();
  if (!v) return;
  const cur = C.linkRange(v);
  const { from, to } = cur ?? v.state.selection;
  const r = await form(cur ? "Edit link" : "Insert link", [
    { key: "text", label: "Text to display", value: v.state.doc.textBetween(from, to) },
    { key: "href", label: "Address (web page, mailto:, or #heading)", value: cur?.href ?? "https://" },
  ]);
  if (!r) return v.focus();
  const href = r.href.trim() === "https://" ? "" : r.href.trim();
  if (!href && !cur) return v.focus();
  C.editLink(v, r.text, href);
}

export function removeLink(): void {
  const v = getView();
  if (v && C.linkRange(v)) C.editLink(v, "", "");
}

export async function addComment(): Promise<void> {
  const v = getView();
  if (!v) return;
  if (v.state.selection.empty) {
    // Word: no selection → the word at the caret
    const $p = v.state.selection.$from, at = $p.parentOffset;
    const text = $p.parent.textBetween(0, $p.parent.content.size, undefined, "\ufffc"); // pictures count as one character
    const left = /[\p{L}\p{N}_'’-]*$/u.exec(text.slice(0, at))![0].length;
    const right = /^[\p{L}\p{N}_'’-]*/u.exec(text.slice(at))![0].length;
    if (!left && !right) return toast("Put the cursor in a word, or select the text you want to comment on.");
    v.dispatch(v.state.tr.setSelection(C.state.TextSelection.create(v.state.doc, $p.pos - left, $p.pos + right)));
  }
  const t = await ask("Comment", "", true);
  if (t) C.comment(v, t, prefs.author);
  else v.focus();
}

/** Paste from the system clipboard; plain = text only (Ctrl+Shift+V). */
export async function paste(plain = false): Promise<void> {
  const v = getView();
  if (!v) return;
  try {
    if (!plain) {
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes("text/html")) return v.pasteHTML(await (await item.getType("text/html")).text()), v.focus();
      }
    }
    v.pasteText(await navigator.clipboard.readText());
    v.focus();
  } catch {
    toast("Use Ctrl+V to paste — the clipboard can't be read from the menu here.");
  }
}

export function cutCopy(kind: "cut" | "copy"): void {
  getView()?.focus();
  document.execCommand(kind);
}

/** Word count dialog: the whole document, plus the selection when there is one. */
export function showStats(): void {
  const v = getView();
  if (!v) return;
  const all = textStats(v.state.doc);
  const { from, to, empty } = v.state.selection;
  const n = (x: number) => x.toLocaleString();
  const rows: [string, string][] = [
    ["Pages", n(pages.peek().total)],
    ["Words", n(all.words)],
    ["Characters (no spaces)", n(all.charsNoSpaces)],
    ["Characters (with spaces)", n(all.chars)],
    ["Paragraphs", n(all.paragraphs)],
  ];
  if (!empty) rows.push(["Words in selection", n(textStats(v.state.doc, from, to).words)]);
  info("Word count", rows);
}

/** Track changes on/off (Ctrl+Shift+E). */
export function toggleTrack(): void {
  setTracking(!tracking(), prefs.author);
  toast(tracking() ? "Track changes is on: your edits are marked." : "Track changes is off.");
}

/** Jump to the next/previous comment or tracked change. */
export function stepNote(dir: 1 | -1): void {
  const v = getView();
  if (!v) return;
  const { from, to } = v.state.selection;
  const n = neighbor(notes(v.state.doc), dir > 0 ? to - 1 : from, dir);
  if (n) jump(v, n);
  else toast("No comments or tracked changes.");
}

/** Slide background themes: a fill and the text colour that stays readable on it. */
const SLIDE_LOOKS: Record<string, [bg: string, color: string]> = {
  white: ["", ""],
  grey: ["#f1f3f5", ""],
  cream: ["#fff8e6", ""],
  sky: ["#e7f1ff", ""],
  navy: ["#1b2a4a", "#ffffff"],
  black: ["#111111", "#ffffff"],
};

export async function slideBackground(): Promise<void> {
  const v = getView();
  if (!v) return;
  const pick = await choose("Slide background", "Dark backgrounds switch the text to white.", [
    { label: "White", value: "white" },
    { label: "Light grey", value: "grey" },
    { label: "Cream", value: "cream" },
    { label: "Sky", value: "sky" },
    { label: "Navy", value: "navy", primary: true },
    { label: "Black", value: "black" },
  ]);
  if (pick) C.slideLook(v, ...SLIDE_LOOKS[pick]);
}
