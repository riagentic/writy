// Find & replace: a plugin that highlights matches; pure match search + commands.
import { state, view as pmView } from "../vendor/pm.js";
import type { model as M } from "../vendor/pm.js";

export type Query = { text: string; caseSensitive: boolean; word: boolean; regex: boolean };
/** A match in text (from–to), or inside a sheet cell: `from`–`to` is then the sheet, `cell` the occurrence in its raw text. */
export type Match = { from: number; to: number; cell?: { r: number; c: number; at: number; len: number } };

/** Spec of the node decoration a sheet gets: its matching cells and the current one. */
export type SheetHits = { cells: { r: number; c: number }[]; cur: { r: number; c: number } | null };
type FindState = { q: Query; matches: Match[]; cur: number };

const key = new state.PluginKey<FindState>("find");
const EMPTY: Query = { text: "", caseSensitive: false, word: false, regex: false };

/** Compile a query to a global regexp, or null if empty/invalid. */
export function compile(q: Query): RegExp | null {
  if (!q.text) return null;
  let src = q.regex ? q.text : q.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (q.word) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(src, `gu${q.caseSensitive ? "" : "i"}`);
  } catch {
    return null;
  }
}

/** All matches inside textblocks (never across blocks) and inside sheet cells, in document order. */
export function search(d: M.Node, q: Query): Match[] {
  const re = compile(q);
  if (!re) return [];
  const out: Match[] = [];
  d.descendants((n, pos) => {
    if (n.type.name === "sheet") {
      (n.attrs.rows as string[][]).forEach((row, r) =>
        row.forEach((v, c) => {
          for (const m of v.matchAll(re)) if (m[0].length) out.push({ from: pos, to: pos + n.nodeSize, cell: { r, c, at: m.index!, len: m[0].length } });
        })
      );
      return false;
    }
    if (!n.isTextblock) return true;
    // Map text offsets to doc positions; inline atoms count as one U+FFFC char.
    let text = "";
    const at: number[] = [];
    n.forEach((c, off) => {
      const s = c.isText ? c.text! : "￼";
      for (let i = 0; i < s.length; i++) at.push(pos + 1 + off + i);
      text += s;
    });
    at.push(pos + 1 + n.content.size);
    for (const m of text.matchAll(re)) if (m[0].length) out.push({ from: at[m.index!], to: at[m.index! + m[0].length] });
    return false;
  });
  return out;
}

const nearest = (ms: Match[], pos: number) => Math.max(0, ms.findIndex((m) => m.from >= pos));

export const findPlugin = new state.Plugin<FindState>({
  key,
  state: {
    init: () => ({ q: EMPTY, matches: [], cur: 0 }),
    apply(tr, s, _old, st) {
      const meta = tr.getMeta(key) as Partial<FindState> | undefined;
      if (meta?.q) {
        const matches = search(st.doc, meta.q);
        return { q: meta.q, matches, cur: meta.cur ?? nearest(matches, st.selection.from) };
      }
      if (meta?.cur !== undefined) return { ...s, cur: meta.cur };
      if (!tr.docChanged || !s.q.text) return s;
      const matches = search(st.doc, s.q);
      return { ...s, matches, cur: Math.min(s.cur, Math.max(0, matches.length - 1)) };
    },
  },
  props: {
    decorations(st) {
      const s = key.getState(st)!;
      if (!s.matches.length) return null;
      const text = s.matches.flatMap((m, i) => m.cell ? [] : [pmView.Decoration.inline(m.from, m.to, { class: i === s.cur ? "jw-find cur" : "jw-find" })]);
      // one node decoration per sheet; the sheet view reads the cells from its spec
      const sheets = new Map<number, { to: number; hits: SheetHits }>();
      s.matches.forEach((m, i) => {
        if (!m.cell) return;
        const e = sheets.get(m.from) ?? { to: m.to, hits: { cells: [], cur: null } };
        e.hits.cells.push({ r: m.cell.r, c: m.cell.c });
        if (i === s.cur) e.hits.cur = { r: m.cell.r, c: m.cell.c };
        sheets.set(m.from, e);
      });
      const nodes = [...sheets].map(([from, e]) => pmView.Decoration.node(from, e.to, {}, { find: e.hits }));
      return pmView.DecorationSet.create(st.doc, [...text, ...nodes]);
    },
  },
});

export const findState = (st: state.EditorState): FindState => key.getState(st) ?? { q: EMPTY, matches: [], cur: 0 };

type V = pmView.EditorView;

export function setQuery(v: V, q: Query): void {
  v.dispatch(v.state.tr.setMeta(key, { q }));
}

function go(v: V, i: number) {
  const { matches } = findState(v.state);
  if (!matches.length) return;
  const cur = (i + matches.length) % matches.length;
  const m = matches[cur];
  const sel = m.cell ? state.NodeSelection.create(v.state.doc, m.from) : state.TextSelection.create(v.state.doc, m.from, m.to);
  v.dispatch(v.state.tr.setSelection(sel).setMeta(key, { cur }).scrollIntoView());
}

export const findNext = (v: V): void => go(v, findState(v.state).cur + (isOn(v) ? 1 : 0));
export const findPrev = (v: V): void => go(v, findState(v.state).cur - 1);

/** True when the selection already sits on the current match. */
/** The current match is the selection (so Next moves past it). */
function isOn(v: V): boolean {
  const { matches, cur } = findState(v.state);
  const m = matches[cur];
  return !!m && v.state.selection.from === m.from && v.state.selection.to === m.to;
}

/** A sheet's cells with every listed occurrence replaced (occurrences of one cell applied right to left). */
function replaceCells(rows: string[][], hits: NonNullable<Match["cell"]>[], q: Query, rep: string): string[][] {
  const out = rows.map((r) => [...r]);
  for (const h of [...hits].sort((a, b) => a.r - b.r || a.c - b.c || b.at - a.at)) {
    const v = out[h.r][h.c];
    out[h.r][h.c] = v.slice(0, h.at) + replacement(q, v.slice(h.at, h.at + h.len), rep) + v.slice(h.at + h.len);
  }
  return out;
}

/** Expand $1… groups for regex queries; literal otherwise. */
function replacement(q: Query, found: string, rep: string): string {
  if (!q.regex) return rep;
  const re = compile({ ...q, word: false })!;
  re.lastIndex = 0;
  return found.replace(re, rep);
}

/** Replace the current (highlighted) match, then move to the next one. */
export function replaceOne(v: V, rep: string): void {
  const { q, matches, cur } = findState(v.state);
  const m = matches[cur];
  if (!m) return;
  if (m.cell) {
    const n = v.state.doc.nodeAt(m.from)!;
    v.dispatch(v.state.tr.setNodeMarkup(m.from, null, { ...n.attrs, rows: replaceCells(n.attrs.rows, [m.cell], q, rep) }));
    return go(v, findState(v.state).cur);
  }
  const text = replacement(q, v.state.doc.textBetween(m.from, m.to), rep);
  const tr = v.state.tr;
  if (text) tr.replaceWith(m.from, m.to, v.state.schema.text(text, v.state.doc.resolve(m.from).marksAcross(v.state.doc.resolve(m.to)) ?? []));
  else tr.delete(m.from, m.to);
  v.dispatch(tr);
  go(v, findState(v.state).cur);
}

/** Replace every match in one undo step. Returns the count. */
export function replaceAll(v: V, rep: string): number {
  const { q, matches } = findState(v.state);
  const tr = v.state.tr;
  const sheets = new Map<number, NonNullable<Match["cell"]>[]>();
  for (const m of matches) if (m.cell) sheets.set(m.from, [...(sheets.get(m.from) ?? []), m.cell]);
  for (const [from, hits] of sheets) {
    const n = v.state.doc.nodeAt(from)!; // sheets keep their size, so text replacements later in the loop stay valid
    tr.setNodeMarkup(from, null, { ...n.attrs, rows: replaceCells(n.attrs.rows, hits, q, rep) });
  }
  for (const m of [...matches].reverse()) {
    if (m.cell) continue;
    const text = replacement(q, v.state.doc.textBetween(m.from, m.to), rep);
    const marks = v.state.doc.resolve(m.from).marksAcross(v.state.doc.resolve(m.to)) ?? [];
    if (text) tr.replaceWith(m.from, m.to, v.state.schema.text(text, marks));
    else tr.delete(m.from, m.to);
  }
  if (matches.length) v.dispatch(tr);
  return matches.length;
}

export const clearFind = (v: V): void => setQuery(v, EMPTY);
