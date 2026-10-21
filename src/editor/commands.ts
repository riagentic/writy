// Ribbon commands. Each takes the view and acts on the current selection.
import { commands, history, schemaList, state, tables } from "../vendor/pm.js";
import type { model as M, view as V } from "../vendor/pm.js";
import { schema } from "./schema.ts";
import { paraIndent, togglePlain } from "./setup.ts";

type View = V.EditorView;
type Attrs = Record<string, string>;
const N = schema.nodes;
const K = schema.marks;
const { toggleMark, setBlockType, wrapIn, lift } = commands;
const { wrapInList, liftListItem, sinkListItem } = schemaList;

const run = (v: View, c: state.Command) => {
  c(v.state, v.dispatch, v);
  v.focus();
};

export const toggle = (v: View, mark: keyof typeof K) => run(v, mark === "ins" || mark === "del" ? togglePlain(K[mark]) : toggleMark(K[mark]));

export function block(v: View, kind: string) {
  if (kind === "p") return run(v, setBlockType(N.paragraph));
  if (kind === "code") return run(v, setBlockType(N.code_block));
  if (kind === "quote") return run(v, wrapIn(N.blockquote));
  const m = kind.match(/^h([1-6])$/);
  if (m) run(v, setBlockType(N.heading, { level: +m[1] }));
}

/** Set (or clear with "") a Djot attribute on every textblock in the selection. */
export function blockAttr(v: View, key: string, value: string) {
  const { from, to } = v.state.selection;
  const tr = v.state.tr;
  v.state.doc.nodesBetween(from, to, (n, pos) => {
    if (!n.isTextblock || !("a" in n.attrs)) return true;
    const a: Attrs = { ...n.attrs.a };
    if (value) a[key] = value;
    else delete a[key];
    tr.setNodeMarkup(pos, null, { ...n.attrs, a });
    return false;
  });
  v.dispatch(tr);
  v.focus();
}

// ── format painter: copy the caret's inline look, paint it over a selection ──
/** Links and comments are content, not formatting: the painter leaves them alone. */
const paintable = (m: M.Mark) => m.type !== K.link && !(m.type === K.span && m.attrs.a?.comment);

export const copyFormat = (v: View): readonly M.Mark[] => (v.state.storedMarks ?? v.state.selection.$from.marks()).filter(paintable);

/** Set (or clear with "") a cell attribute on the selected cells, or the cell with the caret. */
export const cellAttr = (v: View, key: "bg" | "align" | "valign", value: string) => run(v, tables.setCellAttr(key, value));

/** Table styles (a class on the table; core/src/theme.rs draws them). "" = the default grid. */
export const TABLE_STYLES: [cls: string, name: string][] = [["", "Grid"], ["banded", "Banded rows"], ["minimal", "Lines between rows"], [
  "plain",
  "No borders",
]];

/** The table holding the caret: position and node. */
function tableAt(v: View): { pos: number; node: M.Node } | null {
  const $f = v.state.selection.$from;
  for (let d = $f.depth; d > 0; d--) if ($f.node(d).type === N.table) return { pos: $f.before(d), node: $f.node(d) };
  return null;
}

/** Vertical alignment of the cell holding the caret. */
export const cellValign = (v: View): string => {
  const $f = v.state.selection.$from;
  for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.spec.tableRole?.includes("cell")) return $f.node(d).attrs.valign ?? "";
  return "";
};

export const tableStyle = (v: View): string => {
  const cls = (tableAt(v)?.node.attrs.a?.class ?? "").split(" ");
  return TABLE_STYLES.find(([c]) => c && cls.includes(c))?.[0] ?? "";
};

/** Set the style of the table holding the caret, keeping any other classes it has. */
export function setTableStyle(v: View, style: string) {
  const t = tableAt(v);
  if (!t) return;
  const keep = String(t.node.attrs.a?.class ?? "").split(" ").filter((c) => c && !TABLE_STYLES.some(([s]) => s === c));
  const a = { ...t.node.attrs.a, class: [...keep, style].filter(Boolean).join(" ") };
  if (!a.class) delete a.class;
  v.dispatch(v.state.tr.setNodeMarkup(t.pos, null, { ...t.node.attrs, a }));
  v.focus();
}

/** Strip formatting (not links/comments) from the selection. */
function unformat(s: state.EditorState, tr: state.Transaction) {
  const { from, to } = s.selection;
  s.doc.nodesBetween(from, to, (n, pos) => {
    if (n.isInline) { for (const m of n.marks.filter(paintable)) tr.removeMark(Math.max(pos, from), Math.min(pos + n.nodeSize, to), m); }
  });
  return tr;
}

export function pasteFormat(v: View, marks: readonly M.Mark[]) {
  const { from, to, empty } = v.state.selection;
  if (empty) return;
  const tr = unformat(v.state, v.state.tr);
  for (const m of marks) tr.addMark(from, to, m);
  v.dispatch(tr);
}

/** Add/replace one key on a `span` mark over the selection (font, size, color, bg …). */
export function spanAttr(v: View, key: string, value: string) {
  const { from, to, empty } = v.state.selection;
  const tr = v.state.tr;
  if (empty) {
    const cur = (v.state.storedMarks ?? v.state.selection.$from.marks()).find((m) => m.type === K.span);
    const a: Attrs = { ...(cur?.attrs.a ?? {}) };
    if (value) a[key] = value;
    else delete a[key];
    if (cur) tr.removeStoredMark(cur);
    if (Object.keys(a).length) tr.addStoredMark(K.span.create({ a }));
    v.dispatch(tr);
    return v.focus();
  }
  v.state.doc.nodesBetween(from, to, (n, pos) => {
    if (!n.isInline) return true;
    const s = Math.max(pos, from);
    const e = Math.min(pos + n.nodeSize, to);
    const old = n.marks.find((m) => m.type === K.span && m.attrs.a?.[key] !== undefined) ?? n.marks.find((m) => m.type === K.span && !m.attrs.a?.comment);
    const a: Attrs = { ...(old?.attrs.a ?? {}) };
    if (value) a[key] = value;
    else delete a[key];
    if (old) tr.removeMark(s, e, old);
    if (Object.keys(a).length) tr.addMark(s, e, K.span.create({ a }));
    return false;
  });
  v.dispatch(tr);
  v.focus();
}

export function clearFormat(v: View) {
  v.dispatch(unformat(v.state, v.state.tr).setStoredMarks([]));
  blockAttr(v, "align", "");
}

export function list(v: View, kind: "bullet" | "ordered" | "task") {
  const $f = v.state.selection.$from;
  for (let d = $f.depth; d > 0; d--) {
    const n = $f.node(d);
    if (n.type === N.bullet_list || n.type === N.ordered_list) {
      const same = (kind === "ordered") === (n.type === N.ordered_list) && (kind === "task") === !!n.attrs.task;
      if (same) return run(v, liftListItem(N.list_item));
      const type = kind === "ordered" ? N.ordered_list : N.bullet_list;
      const tr = v.state.tr.setNodeMarkup($f.before(d), type, kind === "ordered" ? { start: 1 } : { task: kind === "task" });
      if (kind === "task") n.forEach((_c, off) => tr.setNodeMarkup($f.before(d) + 1 + off, null, { checked: false }));
      else n.forEach((_c, off) => tr.setNodeMarkup($f.before(d) + 1 + off, null, { checked: null }));
      v.dispatch(tr);
      return v.focus();
    }
  }
  run(v, wrapInList(kind === "ordered" ? N.ordered_list : N.bullet_list, kind === "task" ? { task: true } : null));
  if (kind === "task") {
    const tr = v.state.tr;
    v.state.doc.nodesBetween(v.state.selection.from, v.state.selection.to, (n, pos) => {
      if (n.type === N.list_item && n.attrs.checked === null) tr.setNodeMarkup(pos, null, { checked: false });
      return true;
    });
    v.dispatch(tr);
  }
}

export const indent = (v: View) => run(v, commands.chainCommands(sinkListItem(N.list_item), paraIndent(1)));
export const outdent = (v: View) => run(v, commands.chainCommands(liftListItem(N.list_item), paraIndent(-1), lift));

/** Next / previous font size on the size list (Ctrl+] / Ctrl+[). */
export const FONT_SIZES = ["8pt", "9pt", "10pt", "11pt", "12pt", "14pt", "16pt", "18pt", "20pt", "24pt", "28pt", "36pt", "48pt", "72pt"];
export function stepSize(v: View, dir: 1 | -1, cur: string) {
  const pt = parseFloat(cur || "11") || 11;
  const i = dir > 0 ? FONT_SIZES.findIndex((s) => parseFloat(s) > pt) : FONT_SIZES.findLastIndex((s) => parseFloat(s) < pt);
  if (i >= 0) spanAttr(v, "size", FONT_SIZES[i]);
}

/** Insert a node; block nodes with text inside get the caret in their first textblock. */
/** End of the slide holding the caret (slides never nest), or -1. */
function slideEnd(v: View): number {
  const $f = v.state.selection.$from;
  for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === "slide") return $f.after(d);
  return -1;
}

/** Put `n` at `at` (a block boundary) and the caret inside it. */
function insertAt(v: View, at: number, n: M.Node) {
  const tr = v.state.tr.insert(at, n);
  v.dispatch(tr.setSelection(state.TextSelection.near(tr.doc.resolve(at + 2))).scrollIntoView());
  v.focus();
}

/** The slide holding the caret: its position and attributes, or null. */
export function slideAt(v: View): { pos: number; a: Record<string, string> } | null {
  const $f = v.state.selection.$from;
  for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === "slide") return { pos: $f.before(d), a: { ...$f.node(d).attrs.a } };
  return null;
}

/** Background (and readable text colour) of the slide holding the caret; "" removes. */
export function slideLook(v: View, bg: string, color: string) {
  const s = slideAt(v);
  if (!s) return;
  const a = { ...s.a, bg, color };
  for (const k of ["bg", "color"] as const) if (!a[k]) delete a[k];
  v.dispatch(v.state.tr.setNodeMarkup(s.pos, null, { ...v.state.doc.nodeAt(s.pos)!.attrs, a }));
  v.focus();
}

/** A new slide: after the current slide and its notes, else at the caret. */
export function insertSlide(v: View) {
  const s = node("slide", undefined, [node("heading", { level: 2 }), p()]);
  let at = slideEnd(v);
  if (at < 0) return insert(v, s);
  const next = v.state.doc.nodeAt(at);
  if (next?.type.name === "div" && next.attrs.class === "notes") at += next.nodeSize;
  insertAt(v, at, s);
}

/** Speaker notes: after the slide holding the caret (a slide is a fixed 16:9 box), else at the caret. */
export function insertNotes(v: View) {
  const at = slideEnd(v);
  if (at < 0) return insert(v, node("div", { class: "notes" }, [p()]));
  const next = v.state.doc.nodeAt(at);
  if (next?.type.name === "div" && next.attrs.class === "notes") {
    v.dispatch(v.state.tr.setSelection(state.TextSelection.near(v.state.doc.resolve(at + 2))).scrollIntoView());
    return v.focus();
  }
  insertAt(v, at, node("div", { class: "notes" }, [p()]));
}

export function insert(v: View, node: M.Node) {
  const tr = v.state.tr.replaceSelectionWith(node);
  if (node.isBlock && !node.isAtom && node.content.size) {
    let at = -1;
    tr.doc.descendants((n, pos) => {
      if (at < 0 && n === node) at = pos; // persistent nodes: the inserted instance is in the new doc
      return at < 0;
    });
    if (at >= 0) tr.setSelection(state.TextSelection.near(tr.doc.resolve(at + 1)));
  }
  v.dispatch(tr.scrollIntoView());
  v.focus();
}

export function insertTable(v: View, rows: number, cols: number) {
  const cell = (head: boolean) => (head ? N.table_header : N.table_cell).create(null, N.paragraph.create());
  const rs = Array.from({ length: rows }, (_, r) => N.table_row.create(null, Array.from({ length: cols }, () => cell(r === 0))));
  insert(v, N.table.create(null, rs));
}

export const tableCmd = (v: View, c: keyof typeof tables) => run(v, tables[c] as unknown as state.Command);

export function insertSheet(v: View, id: string) {
  const rows = [["Item", "Qty", "Price", "Total"], ["", "", "", "=B2*C2"], ["", "", "", "=B3*C3"], ["Sum", "", "", "=SUM(D2:D3)"]];
  insert(v, N.sheet.create({ id, rows, head: 1, fmt: "C:0.00;D:0.00" }));
}

export function setLink(v: View, href: string) {
  const { from, to, empty } = v.state.selection;
  if (!href) return run(v, (s, d) => (d?.(s.tr.removeMark(from, to, K.link)), true));
  if (empty) {
    const tr = v.state.tr.insertText(href, from).addMark(from, from + href.length, K.link.create({ href }));
    v.dispatch(tr);
  } else v.dispatch(v.state.tr.addMark(from, to, K.link.create({ href })));
  v.focus();
}

/** The full range of the link around the cursor/selection start, if any. */
export function linkRange(v: View): { from: number; to: number; href: string } | null {
  const $p = v.state.selection.$from;
  const m = [...$p.marks(), ...($p.nodeAfter?.marks ?? [])].find((x) => x.type === K.link);
  if (!m) return null;
  // contiguous runs of children carrying this exact link mark; pick the one touching the cursor
  type R = { from: number; to: number };
  let run: R | null = null;
  let hit: R | null = null;
  $p.parent.forEach((n, off) => {
    const a = $p.start() + off, b = a + n.nodeSize;
    if (!m.isInSet(n.marks)) return void (run = null);
    const r: R = run ? { from: run.from, to: b } : { from: a, to: b };
    run = r;
    if ($p.pos >= r.from && $p.pos <= r.to) hit = r;
  });
  const h = hit as R | null;
  return h ? { ...h, href: m.attrs.href } : null;
}

/** Insert or edit a link: replaces the link (or selection) with `text` linked to `href`; empty href unlinks. */
export function editLink(v: View, text: string, href: string) {
  const cur = linkRange(v);
  const { from, to } = cur ?? v.state.selection;
  const tr = v.state.tr;
  const old = v.state.doc.textBetween(from, to);
  if (!href) {
    if (cur) tr.removeMark(from, to, K.link);
  } else if (text && text !== old) {
    const marks = (v.state.doc.resolve(from).marksAcross(v.state.doc.resolve(to)) ?? []).filter((m) => m.type !== K.link);
    tr.replaceWith(from, to, schema.text(text, [...marks, K.link.create({ href })]));
  } else if (from < to) tr.removeMark(from, to, K.link).addMark(from, to, K.link.create({ href }));
  else tr.insertText(href, from).addMark(from, from + href.length, K.link.create({ href }));
  v.dispatch(tr.scrollIntoView());
  v.focus();
}

/** Insert a footnote reference + its definition at the end of the document. */
export function footnote(v: View, text: string) {
  const label = `n${Date.now()}`; // temporary, renumbered below
  let tr = v.state.tr.replaceSelectionWith(N.footnote_ref.create({ label }));
  tr = tr.insert(tr.doc.content.size, N.footnote.create({ label }, N.paragraph.create(null, text ? schema.text(text) : null)));
  v.dispatch(renumberNotes(tr));
  v.focus();
}

/** Footnotes numbered 1…n in reading order of their references, notes sorted the same way at the end. */
export function renumberNotes(tr: state.Transaction): state.Transaction {
  const order = new Map<string, string>();
  tr.doc.descendants((n) => {
    if (n.type === N.footnote_ref && !order.has(n.attrs.label)) order.set(n.attrs.label, String(order.size + 1));
    return n.type !== N.footnote;
  });
  const notes: M.Node[] = [];
  tr.doc.descendants((n, pos) => {
    if (n.type === N.footnote_ref) tr.setNodeMarkup(pos, null, { label: order.get(n.attrs.label) }); // same size: positions stay valid
    if (n.type === N.footnote) notes.push(n);
    return n.type !== N.footnote;
  });
  // move every note to the end, sorted (unreferenced ones keep their label and go last)
  const pos: number[] = [];
  tr.doc.forEach((n, off) => n.type === N.footnote && pos.push(off));
  for (const p of pos.reverse()) tr.delete(p, p + tr.doc.nodeAt(p)!.nodeSize); // last first: earlier positions unaffected
  const key = (n: M.Node) => Number(order.get(n.attrs.label) ?? 1e9);
  for (const n of notes.sort((a, b) => key(a) - key(b))) {
    tr.insert(tr.doc.content.size, N.footnote.create({ label: order.get(n.attrs.label) ?? n.attrs.label }, n.content));
  }
  return tr;
}

export function comment(v: View, text: string, by: string) {
  const { from, to, empty } = v.state.selection;
  if (empty || !text) return;
  const a: Attrs = { comment: text, at: new Date().toISOString().slice(0, 10) };
  if (by) a.by = by;
  v.dispatch(v.state.tr.addMark(from, to, K.span.create({ a })));
  v.focus();
}

/** Remove the comment span under the cursor. */
export function resolveComment(v: View) {
  const { from, to } = v.state.selection;
  const tr = v.state.tr;
  v.state.doc.nodesBetween(Math.max(0, from - 1), to + 1, (n, pos) => {
    for (const m of n.marks) if (m.type === K.span && m.attrs.a?.comment) tr.removeMark(pos, pos + n.nodeSize, m);
    return true;
  });
  v.dispatch(tr);
}

/** Accept/reject every tracked change. */
export function settleChanges(v: View, accept: boolean) {
  const tr = v.state.tr;
  const dels: [number, number][] = [];
  v.state.doc.descendants((n, pos) => {
    if (!n.isInline) return true;
    const ins = n.marks.find((m) => m.type === K.ins && m.attrs.a?.by !== undefined);
    const del = n.marks.find((m) => m.type === K.del && m.attrs.a?.by !== undefined);
    if (ins) accept ? tr.removeMark(pos, pos + n.nodeSize, ins) : dels.push([pos, pos + n.nodeSize]);
    if (del) accept ? dels.push([pos, pos + n.nodeSize]) : tr.removeMark(pos, pos + n.nodeSize, del);
    return true;
  });
  for (const [a, b] of dels.reverse()) tr.delete(tr.mapping.map(a), tr.mapping.map(b));
  v.dispatch(tr);
}

export const undo = (v: View) => run(v, history.undo);
export const redo = (v: View) => run(v, history.redo);

export { K, N };
export type { View };
/** The selected atom (shape, image …) when the selection is a node selection. */
export function selected(v: View): { node: M.Node; pos: number } | null {
  const s = v.state.selection;
  return s instanceof state.NodeSelection ? { node: s.node, pos: s.from } : null;
}

/** Patch the selected atom's attrs (and/or its Djot attrs `a`), keeping it selected. */
export function setSelected(v: View, attrs: Record<string, unknown>, a?: Record<string, string>) {
  const s = selected(v);
  if (!s) return;
  const next: Attrs = { ...s.node.attrs.a };
  for (const [k, val] of Object.entries(a ?? {})) val ? (next[k] = val) : delete next[k];
  const tr = v.state.tr.setNodeMarkup(s.pos, null, { ...s.node.attrs, ...attrs, ...(a ? { a: next } : {}) });
  v.dispatch(tr.setSelection(state.NodeSelection.create(tr.doc, s.pos)));
}

export const deleteSelected = (v: View) => v.dispatch(v.state.tr.deleteSelection().scrollIntoView());

export const node = (type: keyof typeof N, attrs?: Record<string, unknown>, content?: M.Node | M.Node[]) => N[type].create(attrs ?? null, content ?? null);
export const p = (text = "") => N.paragraph.create(null, text ? schema.text(text) : null);
export { state };
