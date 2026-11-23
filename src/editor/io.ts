// Document bytes over HTTP (routes in server/files.server.ts) and the status-bar progress of long jobs.
// Documents, pictures and drafts can be 100+ MB: too big for one WebSocket message.
import { signal } from "aio/air";

/** The long job the status bar shows: what is happening and how far (0..1; null = unknown). */
export type Task = { label: string; done: number | null };
export const task = signal<Task | null>(null);

/** Let the browser paint (the status bar) before a stretch of blocking work. */
const paint = () => new Promise<void>((r) => (requestAnimationFrame(() => setTimeout(r)), setTimeout(r, 50)));

let owner = 0;
/** Show `label` in the status bar while `f` runs. `step` moves the bar on; awaited, it paints first. The newest job owns the bar. */
export async function busy<T>(label: string, f: (step: (label: string, done?: number | null) => Promise<void>) => Promise<T>): Promise<T> {
  const me = ++owner;
  const step = (l: string, done: number | null = null) => (me === owner && task.set({ label: l, done }), paint());
  await step(label);
  try {
    return await f(step);
  } finally {
    if (me === owner) task.set(null);
  }
}

const H = { "x-writy": "1" };

async function call(path: string, q: Record<string, string>, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(`${path}?${new URLSearchParams(q)}`, { ...init, headers: H });
  if (!r.ok) throw new Error((await r.text()) || `${r.status} ${r.statusText}`);
  return r;
}

/** The body as bytes; `progress(0..1)` while it arrives (when its size is known). */
async function bytes(r: Response, progress?: (done: number) => void): Promise<Uint8Array> {
  const total = Number(r.headers.get("content-length")) || 0;
  if (!progress || !total || !r.body) return new Uint8Array(await r.arrayBuffer());
  const out = new Uint8Array(total);
  const rd = r.body.getReader();
  let n = 0;
  for (let c = await rd.read(); !c.done; c = await rd.read()) {
    out.set(c.value, n);
    n += c.value.length;
    progress(n / total);
  }
  return out.subarray(0, n);
}

/** Base64 of a blob, natively (no per-byte JavaScript). */
export const b64Of = (b: Blob): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

const base = (p: string) => p.replace(/^.*[\\/]/, "");
const utf8 = new TextDecoder("utf-8", { fatal: true });
const ok = (r: Response) => r.json() as Promise<{ path: string; name: string }>;

export const io = {
  read: async (path: string, progress?: (done: number) => void) => bytes(await call("/io/file", { path }), progress),
  readText: async (path: string, progress?: (done: number) => void) => utf8.decode(await io.read(path, progress)),
  /** A file to embed; a relative `path` resolves against `dir`. */
  readMedia: async (path: string, dir?: string) => {
    const r = await call("/io/file", dir ? { path, dir } : { path });
    return { name: base(path), mime: r.headers.get("content-type") ?? "application/octet-stream", b64: await b64Of(await r.blob()) };
  },
  write: (path: string, text: string) => call("/io/file", { path }, { method: "PUT", body: text }).then(ok),
  /** DOC/RTF/WPS/… → DOCX bytes (LibreOffice). */
  toDocx: async (path: string) => bytes(await call("/io/docx", { path })),
  pdfXml: (path: string) => call("/io/pdf", { path }).then((r) => r.json() as Promise<{ xml: string; images: Record<string, string> }>),
  convertTo: (html: string, path: string, fmt: "docx" | "odt") => call("/io/convert", { path, fmt }, { method: "PUT", body: html }).then(ok),
  draftSave: (id: string, path: string, name: string, html: string) => call("/io/draft", { id, path, name }, { method: "PUT", body: html }),
  draftRead: (id: string) => call("/io/draft", { id }).then((r) => r.text()),
};
