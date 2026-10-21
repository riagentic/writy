// Shape geometry (pure). A shape is a box (x, y, w, h in mm, from its anchor). Lines and arrows run corner to corner of
// that box, starting at the corner `from` names (tl, tr, bl, br) — so either end can go anywhere. An arrow without `from`
// (older files) runs across the middle, left to right.

export type Box = { x: number; y: number; w: number; h: number };
export type Ends = { x1: number; y1: number; x2: number; y2: number };
export type Corner = "tl" | "tr" | "bl" | "br";
/** Resize handles of a box: edges and corners, by compass point. */
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN = 3; // mm: the smallest box a handle can make
const r1 = (n: number) => Math.round(n * 10) / 10;

export const isLine = (kind: string): boolean => kind === "line" || kind === "arrow";

/** The two ends of a line / arrow (start, end) in mm. */
export function endsOf(b: Box, kind: string, from = ""): Ends {
  if (!from && kind === "arrow") return { x1: b.x, y1: b.y + b.h / 2, x2: b.x + b.w, y2: b.y + b.h / 2 };
  const c = (from || "tl") as Corner;
  const [sx, ex] = c[1] === "l" ? [b.x, b.x + b.w] : [b.x + b.w, b.x];
  const [sy, ey] = c[0] === "t" ? [b.y, b.y + b.h] : [b.y + b.h, b.y];
  return { x1: sx, y1: sy, x2: ex, y2: ey };
}

/** The box and start corner that put a line's ends exactly here. */
export function fromEnds(e: Ends): Box & { from: Corner } {
  const from = `${e.y1 <= e.y2 ? "t" : "b"}${e.x1 <= e.x2 ? "l" : "r"}` as Corner;
  return { x: r1(Math.min(e.x1, e.x2)), y: r1(Math.min(e.y1, e.y2)), w: r1(Math.abs(e.x2 - e.x1)), h: r1(Math.abs(e.y2 - e.y1)), from };
}

/** Move one end to (x, y); with `snap` the line keeps to 0°, 45°, 90° … around the other end. */
export function moveEnd(e: Ends, end: 1 | 2, x: number, y: number, snap = false): Ends {
  const [ox, oy] = end === 1 ? [e.x2, e.y2] : [e.x1, e.y1];
  if (snap) {
    const len = Math.hypot(x - ox, y - oy), a = Math.round(Math.atan2(y - oy, x - ox) / (Math.PI / 4)) * (Math.PI / 4);
    [x, y] = [ox + Math.round(Math.cos(a) * len * 10) / 10, oy + Math.round(Math.sin(a) * len * 10) / 10];
  }
  return end === 1 ? { x1: x, y1: y, x2: e.x2, y2: e.y2 } : { x1: e.x1, y1: e.y1, x2: x, y2: y };
}

/** Drag handle `hd` by (dx, dy) mm; the opposite side stays put. `ratio` keeps the proportions (corner handles). */
export function resizeBox(b: Box, hd: Handle, dx: number, dy: number, ratio = false): Box {
  let { x, y, w, h } = b;
  if (hd.includes("e")) w = Math.max(MIN, b.w + dx);
  if (hd.includes("w")) w = Math.max(MIN, b.w - dx);
  if (hd.includes("s")) h = Math.max(MIN, b.h + dy);
  if (hd.includes("n")) h = Math.max(MIN, b.h - dy);
  if (ratio && hd.length === 2 && b.w > 0 && b.h > 0) {
    const k = Math.max(w / b.w, h / b.h);
    [w, h] = [Math.max(MIN, b.w * k), Math.max(MIN, b.h * k)];
  }
  if (hd.includes("w")) x = b.x + b.w - w;
  if (hd.includes("n")) y = b.y + b.h - h;
  return { x: r1(x), y: r1(y), w: r1(w), h: r1(h) };
}

/** Where a handle sits on the box, as fractions of its width and height. */
export const handleAt = (
  hd: Handle,
): [number, number] => [hd.includes("w") ? 0 : hd.includes("e") ? 1 : 0.5, hd.includes("n") ? 0 : hd.includes("s") ? 1 : 0.5];
