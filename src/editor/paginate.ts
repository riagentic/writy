// Print-layout pagination: the editor is one flow, so blocks that would cross a page edge get an extra top margin
// (a node decoration) that moves them onto the next sheet; a long table breaks between rows. View-only — never
// touches the document or the file.
import { state, view as pmView } from "../vendor/pm.js";
import type { model as M } from "../vendor/pm.js";

/** Page box in CSS px: sheet height, gap between sheets, top/bottom margin. */
export type Box = { page: number; gap: number; top: number; bottom: number };

const key = new state.PluginKey<pmView.DecorationSet>("pages");
/** Containers we look inside, so a long list or quote can break between its items. */
const OPEN = new Set(["bullet_list", "ordered_list", "list_item", "blockquote", "div", "dl", "dd", "footnote"]);
/** Overlays that take no room in the flow. */
const SKIP = new Set(["shape"]);

let relayout = () => {};
/** Who re-paginates after a document change (the page view registers itself). */
export const onRelayout = (f: () => void): void => void (relayout = f);

export const pagesPlugin = new state.Plugin<pmView.DecorationSet>({
  key,
  view: () => ({ update: (v, prev) => void (prev.doc !== v.state.doc && relayout()) }),
  state: {
    init: () => pmView.DecorationSet.empty,
    apply: (tr, set) => tr.getMeta(key) ?? set.map(tr.mapping, tr.doc),
  },
  props: { decorations: (st) => key.getState(st) },
});

/**
 * Where a block whose natural top is `y` (px from the top of the first sheet) and height `h` should start.
 * Pure: moves it to the next sheet's content top when it would cross the bottom margin (unless it already starts a
 * page or is taller than a page), or out of a top margin it fell into; `force` = right after a page break.
 */
export function place(y: number, h: number, b: Box, force = false): number {
  const step = b.page + b.gap;
  const k = Math.max(0, Math.floor(y / step));
  const inPage = y - k * step;
  const head = k * step + b.top;
  const next = (k + 1) * step + b.top;
  if (inPage < b.top - 0.5) return head;
  const atHead = inPage <= b.top + 1;
  if (force) return atHead ? y : next;
  if (atHead || inPage + h <= b.page - b.bottom + 0.5 || h > b.page - b.top - b.bottom) return y;
  return next;
}

/** Number of sheets needed for content ending at `end` px. */
export const sheetsFor = (end: number, b: Box): number => Math.max(1, Math.floor(Math.max(0, end - 0.5) / (b.page + b.gap)) + 1);

type Cell = { th: boolean; colspan: number; rowspan: number };

/**
 * Where a table may move to the next sheet: before the rows in `at`. Never inside the header rows (`head`, repeated on
 * each sheet), before the first body row (the header never stands alone) or across a row-spanning cell. `lead` = the
 * row that ends the part that must start together with the table. `cols` = the table's width in columns.
 */
export function tableBreaks(rows: Cell[][]): { head: number; lead: number; at: number[]; cols: number } {
  let head = 0;
  while (head < rows.length && rows[head].length && rows[head].every((c) => c.th)) head++;
  const at: number[] = [];
  let cover = 0; // last row a rowspan so far reaches into
  rows.forEach((r, i) => {
    if (i > head && i > cover) at.push(i);
    for (const c of r) cover = Math.max(cover, i + c.rowspan - 1);
  });
  return { head, lead: Math.min(head, rows.length - 1), at, cols: Math.max(1, ...rows.map((r) => r.reduce((n, c) => n + c.colspan, 0))) };
}

/** A row the table may break before: the table's width in columns and its header rows (repeated after the break). */
type Break = { cols: number; head: number[] };
/** A table taller than a sheet starts with this row: only up to its end must fit. */
type Lead = { table: HTMLElement; row: Node | null };
type Unit = { pos: number; node: M.Node; dom: Node | null; force: boolean; brk?: Break; lead?: Lead };
/** prosemirror-view's internal view tree: one desc per rendered node, in document order (stable across 1.x). */
type Desc = { node: M.Node | null; dom: Node; children: Desc[] };
type Kid = { node: M.Node; pos: number; dom: Node | null; kids: () => Kid[] };

/**
 * The blocks to place, with their DOM; a table also gives its rows, so a long one can break between them. Walks the
 * view tree once in step with the document: linear. (`view.nodeDOM` per block re-scans siblings each time —
 * quadratic, ~1 s per keystroke on a 300-page document.)
 */
function units(v: pmView.EditorView): Unit[] {
  const out: Unit[] = [];
  let force = false;
  const take = (k: Kid) => {
    const n = k.node;
    if (SKIP.has(n.type.name)) return;
    if (OPEN.has(n.type.name) && n.childCount) return k.kids().forEach(take);
    const unit: Unit = { pos: k.pos, node: n, dom: k.dom, force };
    out.push(unit);
    force = n.type.name === "page_break";
    if (n.type.name !== "table" || !(k.dom instanceof HTMLElement)) return;
    const rows = k.kids();
    const cells = rows.map((r) => {
      const o: Cell[] = [];
      r.node.forEach((c) => o.push({ th: c.type.name === "table_header", colspan: c.attrs.colspan ?? 1, rowspan: c.attrs.rowspan ?? 1 }));
      return o;
    });
    const t = tableBreaks(cells);
    unit.lead = { table: k.dom, row: rows[t.lead]?.dom ?? null };
    const brk: Break = { cols: t.cols, head: rows.slice(0, t.head).map((r) => r.pos) };
    for (const i of t.at) out.push({ pos: rows[i].pos, node: rows[i].node, dom: rows[i].dom, force: false, brk });
  };
  const tree = (v as unknown as { docView?: Desc }).docView;
  if (tree?.children) {
    const kids = (d: Desc, base: number): Kid[] => {
      const o: Kid[] = [];
      let pos = base;
      for (const c of d.children) {
        if (!c.node) continue; // widgets take no document space
        const at = pos;
        o.push({ node: c.node, pos: at, dom: c.dom, kids: () => kids(c, at + 1) });
        pos += c.node.nodeSize;
      }
      return o;
    };
    kids(tree, 0).forEach(take);
  } else {
    const kids = (n: M.Node, base: number): Kid[] => {
      const o: Kid[] = [];
      n.forEach((c, off) => o.push({ node: c, pos: base + off, dom: v.nodeDOM(base + off), kids: () => kids(c, base + off + 1) }));
      return o;
    };
    kids(v.state.doc, 0).forEach(take);
  }
  return out;
}

/**
 * A pushed block's decoration: the margin-top it was given (m) and the move that margin really produced (d). A pushed
 * table row cannot take a margin: it gets a gap row of m − hh px and copies of the header rows (hh px tall) before it.
 */
type Spec = { m: number; d: number; hh: number; hd?: string };

/** Short FNV-1a hash: tells whether the header rows a gap copies have changed. */
const hash = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x1000193);
  return (h >>> 0).toString(36);
};

/** The widgets that move table row `pos` onto the next sheet: a gap row, then the repeated header rows. */
function rowGap(pos: number, spec: Spec, brk: Break): pmView.Decoration[] {
  const key = `jw-pg:${pos}:${spec.m}:${spec.hh}:${spec.hd}`;
  // the spec object itself (not a copy): the real move is written back into it after measuring
  const gap = pmView.Decoration.widget(pos, () => {
    const tr = document.createElement("tr"), td = document.createElement("td");
    tr.className = "jw-pg";
    td.colSpan = brk.cols;
    td.style.height = `${Math.max(0, spec.m - spec.hh)}px`;
    tr.append(td);
    return tr;
  }, Object.assign(spec, { side: -100, key, ignoreSelection: true }));
  const heads = brk.head.map((hp, i) =>
    pmView.Decoration.widget(pos, (view) => {
      const src = view.nodeDOM(hp);
      const tr = src instanceof HTMLTableRowElement ? src.cloneNode(true) as HTMLElement : document.createElement("tr");
      tr.className = "jw-pg-head";
      tr.removeAttribute("style");
      tr.setAttribute("aria-hidden", "true");
      tr.querySelectorAll(".column-resize-handle").forEach((e) => e.remove());
      return tr;
    }, { side: -99 + i, key: `${key}:${i}`, ignoreSelection: true })
  );
  return [gap, ...heads];
}

/**
 * Lay the document out on sheets of box `b` (null = web layout: no breaks). Returns the sheet count.
 *
 * Natural top of a block = measured top − the real moves (d) of all pushed blocks up to and including it. Margins
 * collapse, so a margin m moves a block by m − c for some unknown c; after applying, the real move is measured
 * back into d, which gives c = m − d and the exact margin next time. Settles in one or two passes.
 */
export function paginate(v: pmView.EditorView, b: Box | null): number {
  const clear = () => key.getState(v.state)!.find().length && v.dispatch(v.state.tr.setMeta(key, pmView.DecorationSet.empty));
  if (!b) return (clear(), 1);
  const root = v.dom as HTMLElement;
  const room = b.page - b.top - b.bottom;
  const measure = () => {
    const rect = root.getBoundingClientRect();
    const ratio = rect.height / (root.offsetHeight || 1) || 1; // CSS zoom
    const list = units(v).filter((u) => u.dom instanceof HTMLElement);
    const boxes = list.map((u) => (u.dom as HTMLElement).getBoundingClientRect());
    const tall = (el: Node | null) => (el instanceof HTMLElement ? el.getBoundingClientRect().height / ratio : 0);
    // a table taller than a sheet only needs its start (header + first body row) to fit; a row brings its header copies
    const lead = (l: Lead, i: number) => l.row instanceof HTMLElement ? (l.row.getBoundingClientRect().bottom - boxes[i].top) / ratio : boxes[i].height / ratio;
    const fits = boxes.map((r, i) => {
      const h = r.height / ratio, u = list[i];
      return u.lead && h > room ? lead(u.lead, i) : h;
    });
    const hh = list.map((u) => u.brk ? u.brk.head.reduce((s, p) => s + tall(v.nodeDOM(p)), 0) : 0);
    return { list, tops: boxes.map((r) => (r.top - rect.top) / ratio), hs: boxes.map((r) => r.height / ratio), fits, hh };
  };
  let end = 0;
  for (let pass = 0; pass < 4; pass++) {
    const old = new Map(key.getState(v.state)!.find().filter((d) => "m" in d.spec).map((d) => [d.from, d.spec as Spec]));
    const { list, tops, hs, fits, hh } = measure();
    const decos: pmView.Decoration[] = [];
    const pushed: { pos: number; natural: number; spec: Spec }[] = [];
    let moved = 0; // Σ real moves so far (current layout)
    let shift = 0; // Σ wanted moves so far (new layout)
    let changed = false;
    let used = 0; // old decorations still matched to a block (the rest are leftovers: redraw without them)
    end = 0;
    list.forEach((u, i) => {
      const was = old.get(u.pos);
      if (was) used++;
      const natural = tops[i] - moved - (was?.d ?? 0);
      moved += was?.d ?? 0;
      const y = natural + shift;
      const brk = u.node.type.name === "page_break";
      const keep = u.node.type.name === "heading" && i + 1 < list.length ? fits[i + 1] + 12 : 0; // heading stays with what follows
      // a page break never moves: its marker may sit in the bottom margin (pushing it left an empty page, unlike print)
      const h = brk ? 0 : fits[i] + keep <= room ? fits[i] + keep : fits[i];
      const target = place(y, h, b, u.force);
      const D = target > y + 0.5 ? target - y + hh[i] : 0; // a moved row starts below its repeated header
      shift += D;
      end = Math.max(end, y + D + (brk ? 0 : hs[i]));
      if (D <= 0.5) return void (was && (changed = true));
      const c = was ? was.m - was.d : u.brk ? 0 : Math.max(parseFloat(getComputedStyle(u.dom as HTMLElement).marginTop) || 0, prevGap(u.dom as HTMLElement));
      const spec: Spec = { m: Math.round((c + D) * 10) / 10, d: was?.d ?? D, hh: Math.round(hh[i] * 10) / 10 };
      if (u.brk) spec.hd = hash(u.brk.head.map((p) => JSON.stringify(v.state.doc.nodeAt(p)?.toJSON())).join() + u.brk.head.join("."));
      if (!was || Math.abs(spec.m - was.m) > 0.5 || Math.abs(spec.hh - (was.hh ?? 0)) > 0.5 || spec.hd !== was.hd) changed = true;
      decos.push(...(u.brk ? rowGap(u.pos, spec, u.brk) : [pmView.Decoration.node(u.pos, u.pos + u.node.nodeSize, { style: `margin-top:${spec.m}px` }, spec)]));
      pushed.push({ pos: u.pos, natural, spec });
    });
    if (!changed && used === old.size) break;
    v.dispatch(v.state.tr.setMeta(key, pmView.DecorationSet.create(v.state.doc, decos)).setMeta("addToHistory", false));
    // read back the real moves
    const after = measure();
    const at = new Map(after.list.map((u, i) => [u.pos, after.tops[i]]));
    let sum = 0;
    for (const p of pushed) {
      p.spec.d = Math.max(0, (at.get(p.pos) ?? p.natural) - p.natural - sum);
      sum += p.spec.d;
    }
  }
  return sheetsFor(end + b.bottom, b);
}

/** The collapsed gap a block already has above it from its previous sibling's bottom margin. */
const prevGap = (el: HTMLElement) => {
  const p = el.previousElementSibling;
  return p ? parseFloat(getComputedStyle(p).marginBottom) || 0 : 0;
};
