// File system edge: dialogs, read/write, legacy-format conversion. Server only.
import { serverFns } from "aio";

export type Loaded = { path: string; name: string; ext: string; text?: string; b64?: string };

const TEXT = new Set(["html", "htm", "dj", "djot", "md", "markdown", "txt", "csv", "tsv"]);
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

export const files = serverFns("files", {
  /** Read a document. Text formats come back as text, others as base64. */
  read: async (path: string): Promise<Loaded> => {
    const e = ext(path);
    const out: Loaded = { path, name: base(path), ext: e };
    if (TEXT.has(e)) out.text = await Deno.readTextFile(path);
    else if (e !== "pdf") out.b64 = b64(await Deno.readFile(path)); // PDFs go through pdfXml
    return out;
  },
  /** Read a media file to embed. Relative paths resolve against `dir`. */
  readMedia: async (path: string, dir?: string) => {
    const p = /^([a-zA-Z]:)?[\\/]/.test(path) || !dir ? path : `${dir}/${path}`;
    return { name: base(p), mime: MIME[ext(p)] ?? "application/octet-stream", b64: b64(await Deno.readFile(p)) };
  },
  write: async (path: string, text: string) => {
    const tmp = `${path}.jw-tmp`;
    await Deno.writeTextFile(tmp, text);
    await Deno.rename(tmp, path); // atomic replace: never a half-written document
    return { path, name: base(path), bytes: text.length };
  },
  exists: async (path: string) => {
    try {
      await Deno.stat(path);
      return true;
    } catch {
      return false;
    }
  },
  // ── crash recovery: one draft per editing session ──
  draftSave: async (id: string, path: string, name: string, html: string) => {
    await Deno.mkdir(draftDir(), { recursive: true });
    const f = `${draftDir()}/${safeId(id)}`;
    await Deno.writeTextFile(`${f}.html.tmp`, html);
    await Deno.rename(`${f}.html.tmp`, `${f}.html`);
    await Deno.writeTextFile(`${f}.json`, JSON.stringify({ id, path, name, time: Date.now() } satisfies Draft));
  },
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
  draftRead: (id: string) => Deno.readTextFile(`${draftDir()}/${safeId(id)}.html`),
  draftDrop: async (id: string) => {
    for (const x of [".html", ".json"]) await Deno.remove(`${draftDir()}/${safeId(id)}${x}`).catch(() => {});
  },

  /** Saved-file HTML → .docx / .odt via LibreOffice (written next to `path`). */
  convertTo: async (html: string, path: string, fmt: "docx" | "odt") => {
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
  },

  /** PDF → pdftohtml XML (text boxes with fonts/positions) + extracted images. */
  pdfXml: async (path: string) => {
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

  /** DOC/RTF/WPS/… → DOCX via LibreOffice headless (base64), for the DOCX importer. */
  toDocx: async (path: string) => {
    if (!LEGACY.has(ext(path))) throw new Error(`not a convertible document: ${base(path)}`);
    const out = await Deno.makeTempDir({ prefix: "jw-conv-" });
    try {
      await soffice(["--convert-to", "docx:MS Word 2007 XML", "--outdir", out, path]);
      return b64(await Deno.readFile(`${out}/${base(path).replace(/\.[^.]+$/, ".docx")}`));
    } finally {
      await Deno.remove(out, { recursive: true }).catch(() => {});
    }
  },
});
