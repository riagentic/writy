// File system edge: read/write, drafts, legacy-format conversion. Server only.
import { type RawRouteHandler, serverFns } from "aio";

const LEGACY = new Set(["doc", "rtf", "wps", "wpd", "odt", "docx", "pages", "sxw", "fodt"]);
export const BOOKS = new Set(["xlsx", "xlsm", "xls", "ods", "fods", "numbers"]);
export const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  pdf: "application/pdf",
};

const ext = (p: string) => (p.match(/\.([^./\\]+)$/)?.[1] ?? "").toLowerCase();
const base = (p: string) => p.replace(/^.*[\\/]/, "");

function b64(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Replace `path` atomically: never a half-written document. */
async function writeAtomic(path: string, body: ReadableStream<Uint8Array> | string): Promise<void> {
  const tmp = `${path}.${crypto.randomUUID().slice(0, 8)}.jw-tmp`; // own name: two writes never share one
  try {
    if (typeof body === "string") await Deno.writeTextFile(tmp, body);
    else await Deno.writeFile(tmp, body);
    await Deno.rename(tmp, path);
  } catch (e) {
    await Deno.remove(tmp).catch(() => {});
    throw e;
  }
}

const dataDir = () => `${Deno.env.get("XDG_DATA_HOME") ?? `${Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "."}/.local/share`}/writy`;
const draftDir = () => `${dataDir()}/drafts`;
const safeId = (id: string) => {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new Error("bad draft id");
  return id;
};
export type Draft = { id: string; path: string; name: string; time: number };

/** Run soffice headless; maps "not installed" to a readable error. Returns what it printed. */
async function soffice(args: string[]): Promise<string> {
  try {
    const p = await new Deno.Command("soffice", { args: ["--headless", ...args], stdout: "piped", stderr: "piped" }).output();
    if (!p.success) throw new Error(new TextDecoder().decode(p.stderr) || "LibreOffice conversion failed");
    return new TextDecoder().decode(p.stdout);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("LibreOffice (soffice) is not installed — needed for this conversion");
    throw e;
  }
}

/** PDF → pdftohtml XML (text boxes with fonts/positions) + extracted images. */
async function pdfXml(path: string): Promise<{ xml: string; images: Record<string, string> }> {
  const tmp = await Deno.makeTempDir({ prefix: "jw-pdf-" });
  try {
    const p = await new Deno.Command("pdftohtml", { args: ["-xml", "-nodrm", "-q", "-fmt", "png", path, `${tmp}/d`], stdout: "piped", stderr: "piped" })
      .output()
      .catch((e) => {
        throw e instanceof Deno.errors.NotFound ? new Error("poppler (pdftohtml) is not installed — needed for PDF import") : e;
      });
    if (!p.success) throw new Error(new TextDecoder().decode(p.stderr) || "pdftohtml failed");
    const images: Record<string, string> = {};
    for await (const e of Deno.readDir(tmp)) if (/\.(png|jpe?g)$/i.test(e.name)) images[e.name] = b64(await Deno.readFile(`${tmp}/${e.name}`));
    return { xml: await Deno.readTextFile(`${tmp}/d.xml`), images };
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
}

/** DOC/RTF/WPS/… → DOCX bytes via LibreOffice headless, for the DOCX importer. */
async function toDocx(path: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!LEGACY.has(ext(path))) throw new Error(`not a convertible document: ${base(path)}`);
  const out = await Deno.makeTempDir({ prefix: "jw-conv-" });
  try {
    await soffice(["--convert-to", "docx:MS Word 2007 XML", "--outdir", out, path]);
    return await Deno.readFile(`${out}/${base(path).replace(/\.[^.]+$/, ".docx")}`);
  } finally {
    await Deno.remove(out, { recursive: true }).catch(() => {});
  }
}

/** Saved-file HTML → .docx / .odt via LibreOffice (written to `path`). */
async function convertTo(html: string, path: string, fmt: string): Promise<{ path: string; name: string }> {
  if (fmt !== "docx" && fmt !== "odt") throw new Error(`unknown export format: ${fmt}`);
  const tmp = await Deno.makeTempDir({ prefix: "jw-exp-" });
  try {
    const stem = base(path).replace(/\.[^.]+$/, "");
    await Deno.writeTextFile(`${tmp}/${stem}.html`, html);
    const filter = fmt === "docx" ? "docx:MS Word 2007 XML" : "odt:writer8";
    await soffice(["--infilter=HTML (StarWriter)", "--convert-to", filter, "--outdir", tmp, `${tmp}/${stem}.html`]);
    await Deno.copyFile(`${tmp}/${stem}.${fmt}`, path);
    return { path, name: base(path) };
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
}

const draftMeta = (d: Draft) => Deno.writeTextFile(`${draftDir()}/${safeId(d.id)}.json`, JSON.stringify(d));

/** Small calls over the WebSocket. Document bytes go through `routes` below. */
export const files = serverFns("files", {
  exists: async (path: string) => {
    try {
      await Deno.stat(path);
      return true;
    } catch {
      return false;
    }
  },
  // ── crash recovery: one draft per editing session ──
  draftList: async (): Promise<Draft[]> => {
    const out: Draft[] = [];
    try {
      for await (const e of Deno.readDir(draftDir())) {
        if (e.name.endsWith(".json")) out.push(JSON.parse(await Deno.readTextFile(`${draftDir()}/${e.name}`)));
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    return out.sort((a, b) => b.time - a.time);
  },
  /** Heartbeat for an unchanged draft: refresh its time without resending the document. */
  draftTouch: (id: string, path: string, name: string) => draftMeta({ id, path, name, time: Date.now() }),
  draftDrop: async (id: string) => {
    for (const x of [".html", ".json"]) await Deno.remove(`${draftDir()}/${safeId(id)}${x}`).catch(() => {});
  },

  /** A workbook (.xlsx / .ods / …) → each sheet as CSV with its formulas, in workbook order, via LibreOffice. */
  bookSheets: async (path: string): Promise<{ name: string; csv: string }[]> => {
    if (!BOOKS.has(ext(path))) throw new Error(`not a spreadsheet: ${base(path)}`);
    const out = await Deno.makeTempDir({ prefix: "jw-book-" });
    try {
      // CSV filter: comma, ", UTF-8, from line 1, …, formulas instead of values (10th), every sheet (-1)
      const log = await soffice(["--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,true,false,-1", "--outdir", out, path]);
      const order = [...log.matchAll(/Writing sheet (.+?) -> (.+\.csv)\s*$/gm)].map((m) => ({ name: m[1], file: m[2].trim() }));
      if (!order.length) { // one sheet: LibreOffice writes <stem>.csv and says nothing
        for await (const e of Deno.readDir(out)) if (e.name.endsWith(".csv")) order.push({ name: "Sheet1", file: `${out}/${e.name}` });
      }
      return await Promise.all(order.map(async (o) => ({ name: o.name, csv: await Deno.readTextFile(o.file) })));
    } finally {
      await Deno.remove(out, { recursive: true }).catch(() => {});
    }
  },
});

// ── HTTP: documents, pictures and drafts can be 100+ MB — far over aio's 1 MB WebSocket frame limit,
// and an HTTP body streams (the client shows a progress bar). Same trust as `files`: the app's own window. ──

type Handler = (q: URLSearchParams, req: Request) => Promise<Response>;

/** A custom header makes every cross-origin call a preflight, which fails (no CORS headers): only Writy's page gets in. */
const io = (methods: Record<string, Handler>): RawRouteHandler => async (req) => {
  if (req.headers.get("x-writy") !== "1") return new Response("forbidden", { status: 403 });
  const h = methods[req.method];
  if (!h) return new Response("method not allowed", { status: 405, headers: { allow: Object.keys(methods).join(", ") } });
  try {
    return await h(new URL(req.url).searchParams, req);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : String(e), { status: e instanceof Deno.errors.NotFound ? 404 : 500 });
  }
};

const need = (q: URLSearchParams, k: string): string => {
  const v = q.get(k);
  if (!v) throw new Error(`missing "${k}"`);
  return v;
};

/** Stream a file with its size, so the client can show progress. */
async function sendFile(path: string): Promise<Response> {
  const f = await Deno.open(path);
  const { size } = await f.stat();
  return new Response(f.readable, { headers: { "content-type": MIME[ext(path)] ?? "application/octet-stream", "content-length": String(size) } });
}

const json = (v: unknown) => Response.json(v);

export const routes: Record<string, RawRouteHandler> = {
  /** GET: a file's bytes (`dir` resolves a relative `path`). PUT: replace it with the body. */
  "/io/file": io({
    GET: (q) => {
      const path = need(q, "path"), dir = q.get("dir");
      return sendFile(/^([a-zA-Z]:)?[\\/]/.test(path) || !dir ? path : `${dir}/${path}`);
    },
    PUT: async (q, req) => {
      const path = need(q, "path");
      await writeAtomic(path, req.body ?? "");
      return json({ path, name: base(path) });
    },
  }),
  "/io/docx": io({ GET: async (q) => new Response(await toDocx(need(q, "path"))) }),
  "/io/pdf": io({ GET: async (q) => json(await pdfXml(need(q, "path"))) }),
  "/io/convert": io({ PUT: async (q, req) => json(await convertTo(await req.text(), need(q, "path"), need(q, "fmt"))) }),
  /** Crash-recovery draft of one editing session. */
  "/io/draft": io({
    GET: (q) => sendFile(`${draftDir()}/${safeId(need(q, "id"))}.html`),
    PUT: async (q, req) => {
      const id = safeId(need(q, "id"));
      await Deno.mkdir(draftDir(), { recursive: true });
      await writeAtomic(`${draftDir()}/${id}.html`, req.body ?? "");
      await draftMeta({ id, path: q.get("path") ?? "", name: q.get("name") ?? "", time: Date.now() });
      return json({ ok: true });
    },
  }),
};
