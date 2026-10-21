// Client-side document context shared by node views: attachments, live calc, zoom.
import type { model as M } from "../vendor/pm.js";
import type { Att } from "../doc/xast.ts";
import { type SheetIn, type SheetOut, sheetsEval } from "../core/index.ts";

// ── attachments ──
const atts = new Map<string, Att>();
const urls = new Map<string, string>();

export function setAtts(list: Att[]): void {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
  atts.clear();
  for (const a of list) atts.set(a.name, a);
}
export const allAtts = (): Att[] => [...atts.values()];
export const getAtt = (name: string): Att | undefined => atts.get(name);

/** Add an attachment under a unique name; returns the `#att:` reference. */
export function addAtt(name: string, mime: string, b64: string): string {
  const safe = name.replace(/[^\w.\-]+/g, "_") || "file";
  let n = safe;
  for (let i = 2; atts.has(n) && atts.get(n)!.b64 !== b64; i++) n = safe.replace(/(\.[^.]*)?$/, `-${i}$1`);
  atts.set(n, { name: n, mime, b64 });
  return `#att:${n}`;
}

/** Only keep attachments the document references (plus non-media extras like an original file). */
export function pruneAtts(used: Set<string>): void {
  for (const [n, a] of atts) if (!used.has(n) && /^(image|video|audio)\//.test(a.mime)) atts.delete(n);
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

export function urlFor(src: string): { url: string; mime: string } {
  const name = src.startsWith("#att:") ? src.slice(5) : null;
  if (name) {
    const a = atts.get(name);
    if (!a) return { url: "", mime: "" };
    if (!urls.has(name)) urls.set(name, URL.createObjectURL(b64ToBlob(a.b64, a.mime)));
    return { url: urls.get(name)!, mime: a.mime };
  }
  const ext = src.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  const mime = ["mp4", "webm", "mov", "ogv"].includes(ext) ? "video/" + ext : ["mp3", "wav", "ogg"].includes(ext) ? "audio/" + ext : "image/";
  return { url: src, mime };
}

// ── live calculation ──
let calc: SheetOut = { values: {}, numeric: {} };
let sheets: SheetIn[] = [];
const subs = new Set<() => void>();

export function sheetsOf(doc: M.Node): SheetIn[] {
  const out: SheetIn[] = [];
  doc.descendants((n) => {
    if (n.type.name === "sheet") out.push({ id: n.attrs.id, rows: n.attrs.rows, head: n.attrs.head, fmt: n.attrs.fmt });
    return true;
  });
  return out;
}

let lastKey = "";
export function recompute(doc: M.Node): void {
  const s = sheetsOf(doc);
  const key = JSON.stringify(s);
  if (key !== lastKey) {
    lastKey = key;
    sheets = s;
    calc = s.length ? sheetsEval(s) : { values: {}, numeric: {} };
  }
  for (const f of subs) f();
}

export const calcResult = (): SheetOut => calc;
export const currentSheets = (): SheetIn[] => sheets;
export function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

export function colName(c: number): string {
  let s = "";
  for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
}

/** "sales!D4" → displayed value (or "#REF!"). */
export function lookup(ref: string): string {
  const [sid, cell] = ref.includes("!") ? ref.split("!") : [sheets[0]?.id ?? "", ref];
  const m = cell.replace(/\$/g, "").match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return "#REF!";
  const col = m[1].toUpperCase().split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return calc.values[sid.replace(/^'|'$/g, "")]?.[+m[2] - 1]?.[col] ?? "#REF!";
}

// ── view state ──
let zoom = 1;
export const getZoom = (): number => zoom;
export const setZoom = (z: number): void => {
  zoom = z;
};
export const MM = 96 / 25.4; // CSS px per mm
