// Headings outline (pure) + jump, for the navigation pane.
import { state } from "../vendor/pm.js";
import type { model as M, view as V } from "../vendor/pm.js";

export type Head = { level: number; text: string; pos: number };

export function headings(d: M.Node): Head[] {
  const out: Head[] = [];
  d.descendants((n, pos) => {
    if (n.type.name === "heading") out.push({ level: n.attrs.level, text: n.textContent.trim() || "(empty heading)", pos });
    return n.isBlock && !n.isTextblock;
  });
  return out;
}

/** Index of the heading whose section contains `pos` (-1 before the first heading). */
export const current = (hs: Head[], pos: number): number => hs.findLastIndex((h) => h.pos <= pos);

export function jumpTo(v: V.EditorView, h: Head): void {
  const tr = v.state.tr.setSelection(state.TextSelection.create(v.state.doc, h.pos + 1));
  v.dispatch(tr);
  (v.nodeDOM(h.pos) as HTMLElement | null)?.scrollIntoView({ block: "start", behavior: "smooth" });
  v.focus();
}
