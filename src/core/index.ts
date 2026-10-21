// Typed façade over the Rust/WASM core. `await core.ready` once, then every call is sync.
import init, * as w from "./xcore.js";
import type { Att, X } from "../doc/xast.ts";

export type Opened = { src: string; atts: Att[]; stale: boolean; native: boolean };
export type SheetIn = { id: string; rows: string[][]; head: number; fmt: string };
export type SheetOut = { values: Record<string, string[][]>; numeric: Record<string, boolean[][]> };

let loading: Promise<unknown> | null = null;

/** Load the WASM once (lazily — module evaluation must not touch the network or URLs). */
export function ready(): Promise<unknown> {
  if (!loading) {
    // ../../ resolves to the app root from src/core/ (Deno tests), /core/ (dev) and /app.js (bundle)
    loading = init({ module_or_path: new URL("../../assets/xcore_bg.wasm", import.meta.url) })
      .then(() => w.set_timezone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? "")); // TODAY() / NOW() in local time
  }
  return loading;
}

const J = JSON.stringify;

export const djotParse = (src: string): X => JSON.parse(w.djot_parse(src));
export const djotWrite = (doc: X): string => w.djot_write(J(doc));
export const renderHtml = (doc: X, atts: Att[] = []): string => w.render_html(J(doc), J(atts));
export const docCss = (doc: X): string => w.doc_css(J(doc));
export const fileBuild = (doc: X, atts: Att[]): string => w.file_build(J(doc), J(atts));
export const fileRead = (html: string): Opened => JSON.parse(w.file_read(html));
export const sheetsEval = (sheets: SheetIn[]): SheetOut => JSON.parse(w.sheets_eval(J(sheets)));
export const gridParse = (s: string): { rows: string[][]; head: number } => JSON.parse(w.grid_parse(s));
export const gridFormat = (rows: string[][], head: number): string => w.grid_format(J(rows), head);
export const mdImport = (src: string): X => JSON.parse(w.md_import(src));
export const mdExport = (doc: X): string => w.md_export(J(doc));

export type Imported = { doc: X; atts: Att[] };
export const docxImport = (bytes: Uint8Array): Imported => JSON.parse(w.docx_import(bytes));
export const odtImport = (bytes: Uint8Array): Imported => JSON.parse(w.odt_import(bytes));
export const pdfImport = (xml: string, images: Record<string, string>): Imported => JSON.parse(w.pdf_import(xml, JSON.stringify(images)));
export const htmlImport = (html: string): Imported => JSON.parse(w.html_import(html));
export const mathHtml = (tex: string, display: boolean): string => w.math_html(tex, display);
/** Code-block token spans [from, to, class] (UTF-16 offsets); [] for an unknown language. */
export const highlight = (lang: string, code: string): [number, number, string][] => JSON.parse(w.highlight(lang, code));
/** Languages the code-block picker offers. */
export const codeLangs = (): [string, string][] => JSON.parse(w.code_langs());
