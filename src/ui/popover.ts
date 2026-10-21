// Popovers live in the viewport (position: fixed) so a scrolling/clipping parent like the ribbon can't hide them.

/** Top-left for a popover of width `w` under `anchor`, kept inside the window (8px gutter). */
export function below(anchor: Element | null | undefined, w: number): { left: string; top: string } {
  const r = anchor?.getBoundingClientRect();
  if (!r) return { left: "8px", top: "8px" };
  return { left: `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`, top: `${r.bottom + 4}px` };
}
