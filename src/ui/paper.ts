// Page geometry from the document's =meta block, and the live page counter.
import { signal } from "aio/air";

const SIZES: Record<string, [number, number]> = { a4: [210, 297], a5: [148, 210], a3: [297, 420], letter: [215.9, 279.4], legal: [215.9, 355.6] };

export type Geometry = { w: number; h: number; pad: string; padTop: number; padBottom: number; padLeft: number; padRight: number };

const mmOf = (v: string): number => {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return 20;
  return v.endsWith("cm") ? n * 10 : v.endsWith("in") ? n * 25.4 : v.endsWith("pt") ? n * 25.4 / 72 : n;
};

export function geometry(meta: Record<string, string>): Geometry {
  let [w, h] = SIZES[(meta.page || "a4").toLowerCase()] ?? SIZES.a4;
  if (meta.orientation === "landscape") [w, h] = [h, w];
  const m = (meta.margin || "20mm").trim().split(/\s+/).map(mmOf);
  const [t, r, b, l] = m.length === 1 ? [m[0], m[0], m[0], m[0]] : m.length === 2 ? [m[0], m[1], m[0], m[1]] : m.length === 3 ? [m[0], m[1], m[2], m[1]] : m;
  return { w, h, pad: `${t}mm ${r}mm ${b}mm ${l}mm`, padTop: t, padBottom: b, padLeft: l, padRight: r };
}

/** CSS px per mm (96 dpi), and the grey gap between sheets. */
export const PX = 96 / 25.4;
export const GAP = 24;

export const pages = signal({ current: 1, total: 1 });

/** Header/footer template → [left, centre, right] for one page. One part = centred, two = left & right. */
export function hfText(tpl: string, title: string, page: number, total: number): string[] {
  if (!tpl.trim()) return [];
  const p = tpl.split("|").map((s) => s.trim().replace(/\{title\}/g, title).replace(/\{pages\}/g, String(total)).replace(/\{page\}/g, String(page)));
  return p.length === 1 ? ["", p[0], ""] : p.length === 2 ? [p[0], "", p[1]] : p.slice(0, 3);
}
