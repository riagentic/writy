// Zoom: one ladder for buttons/keys/wheel, plus fit-to-width / whole-page from the live canvas.
import { prefs } from "../cell/prefs.ts";
import { metaGet } from "../editor/session.ts";
import { geometry, PX } from "./paper.ts";

export const MIN = 25;
export const MAX = 400;
export const LADDER = [25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400];

/** Next ladder step up (+1) or down (-1) from any zoom. */
export const step = (z: number, dir: 1 | -1): number =>
  dir > 0 ? LADDER.find((l) => l > z + 0.5) ?? MAX : [...LADDER].reverse().find((l) => l < z - 0.5) ?? MIN;

export const clamp = (z: number): number => Math.round(Math.min(MAX, Math.max(MIN, z)));

/** Zoom that fits the page width (or the whole page) into a canvas of w×h px. */
export function fit(kind: "width" | "page", w: number, h: number, pageMm: { w: number; h: number }): number {
  const pw = pageMm.w * PX + 48, ph = pageMm.h * PX + 48; // breathing room around the sheet
  return clamp(100 * (kind === "width" ? w / pw : Math.min(w / pw, h / ph)));
}

// prefs.setZoom round-trips to the server; fast key repeats / wheel spins must build on the value just asked for
let inFlight = 0;
let asked = 100;
const current = (): number => (inFlight ? asked : prefs.zoom);

export function setZoom(z: number): void {
  asked = clamp(z);
  inFlight++;
  prefs.setZoom(asked).finally(() => inFlight--);
}

export const zoomBy = (dir: 1 | -1): void => setZoom(step(current(), dir));

export function zoomFit(kind: "width" | "page"): void {
  const c = document.querySelector<HTMLElement>(".jw-canvas");
  if (c) setZoom(fit(kind, c.clientWidth, c.clientHeight, geometry(metaGet())));
}
