// Print-layout pagination: the editor is one flow, so blocks that would cross a page edge get an extra top margin
// (a node decoration) that moves them onto the next sheet. View-only — never touches the document or the file.
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

type Unit = { pos: number; node: M.Node; dom: Node | null; force: boolean };
/** prosemirror-view's internal view tree: one desc per rendered node, in document order (stable across 1.x). */
type Desc = { node: M.Node | null; dom: Node; children: Desc[] };

/**
 * The blocks to place, with their DOM. Walks the view tree once in step with the document: linear. (`view.nodeDOM`
 * per block re-scans siblings each time — quadratic, ~1 s per keystroke on a 300-page document.)
 */
function units(v: pmView.EditorView): Unit[] {
  const out: Unit[] = [];
  let force = false;
  const take = (n: M.Node, pos: number, dom: Node | null, inner: () => void) => {
    if (SKIP.has(n.type.name)) return;
    if (OPEN.has(n.type.name) && n.childCount) return inner();
    out.push({ pos, node: n, dom, force });
    force = n.type.name === "page_break";
  };
  const tree = (v as unknown as { docView?: Desc }).docView;
  if (tree?.children) {
    const walk = (d: Desc, base: number) => {
      let pos = base;
      for (const c of d.children) {
        if (!c.node) continue; // widgets take no document space
        take(c.node, pos, c.dom, () => walk(c, pos + 1));
        pos += c.node.nodeSize;
      }
    };
    walk(tree, 0);
  } else {
    const walk = (n: M.Node, base: number) => n.forEach((c, off) => take(c, base + off, v.nodeDOM(base + off), () => walk(c, base + off + 1)));
    walk(v.state.doc, 0);
  }
  return out;
}

/** A pushed block's decoration: the margin-top it was given (m) and the move that margin really produced (d). */
type Spec = { m: number; d: number };

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
    return { list, tops: boxes.map((r) => (r.top - rect.top) / ratio), hs: boxes.map((r) => r.height / ratio) };
  };
  let end = 0;
  for (let pass = 0; pass < 4; pass++) {
    const old = new Map(key.getState(v.state)!.find().map((d) => [d.from, d.spec as Spec]));
    const { list, tops, hs } = measure();
    const decos: pmView.Decoration[] = [];
    const pushed: { pos: number; natural: number; spec: Spec }[] = [];
    let moved = 0; // Σ real moves so far (current layout)
    let shift = 0; // Σ wanted moves so far (new layout)
    let changed = false;
    end = 0;
    list.forEach((u, i) => {
      const was = old.get(u.pos);
      const natural = tops[i] - moved - (was?.d ?? 0);
      moved += was?.d ?? 0;
      const y = natural + shift;
      const keep = u.node.type.name === "heading" && i + 1 < list.length ? hs[i + 1] + 12 : 0; // heading stays with what follows
      // a page break never moves: its marker may sit in the bottom margin (pushing it left an empty page, unlike print)
      const h = u.node.type.name === "page_break" ? 0 : hs[i] + keep <= room ? hs[i] + keep : hs[i];
      const target = place(y, h, b, u.force);
      const D = target - y;
      shift += D;
      end = Math.max(end, target + (u.node.type.name === "page_break" ? 0 : hs[i]));
      if (D <= 0.5) return void (was && (changed = true));
      const c = was ? was.m - was.d : Math.max(parseFloat(getComputedStyle(u.dom as HTMLElement).marginTop) || 0, prevGap(u.dom as HTMLElement));
      const spec: Spec = { m: Math.round((c + D) * 10) / 10, d: was?.d ?? D };
      if (!was || Math.abs(spec.m - was.m) > 0.5) changed = true;
      decos.push(pmView.Decoration.node(u.pos, u.pos + u.node.nodeSize, { style: `margin-top:${spec.m}px` }, spec));
      pushed.push({ pos: u.pos, natural, spec });
    });
    if (!changed) break;
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
