/* tslint:disable */
/* eslint-disable */

/**
 * Languages the code-block picker offers: [[value, label]].
 */
export function code_langs(): string;

/**
 * Djot source → document tree (JSON).
 */
export function djot_parse(src: string): string;

/**
 * Document tree → canonical Djot source.
 */
export function djot_write(ast: string): string;

/**
 * Theme + page CSS for a document (same CSS the saved file uses).
 */
export function doc_css(ast: string): string;

/**
 * DOCX bytes → { doc, atts }.
 */
export function docx_import(bytes: Uint8Array): string;

/**
 * Document tree + attachments → the complete single-file `.html`.
 */
export function file_build(ast: string, attachments: string): string;

/**
 * `.html` file text → { src, atts, stale, native }.
 */
export function file_read(html_text: string): string;

/**
 * rows (JSON string[][]) + header count → canonical grid text.
 */
export function grid_format(rows: string, head: number): string;

/**
 * Grid text → { rows, head }.
 */
export function grid_parse(s: string): string;

/**
 * Code-block highlighting for the editor: [[from, to, class]] in UTF-16 offsets (what JS strings and ProseMirror count).
 */
export function highlight(lang: string, code: string): string;

/**
 * Any HTML page → { doc, atts } (data: images become attachments).
 */
export function html_import(html_text: string): string;

/**
 * LaTeX → MathML.
 */
export function math_html(tex: string, display: boolean): string;

export function md_export(ast: string): string;

export function md_import(src: string): string;

/**
 * ODT bytes → { doc, atts }.
 */
export function odt_import(bytes: Uint8Array): string;

/**
 * `pdftohtml -xml` output + { file name: base64 } images → { doc, atts }.
 */
export function pdf_import(xml_text: string, images_json: string): string;

/**
 * Document tree → body HTML (preview / print). Sheets are evaluated.
 */
export function render_html(ast: string, attachments: string): string;

/**
 * The reader's IANA time zone, for TODAY() / NOW().
 */
export function set_timezone(tz: string): void;

/**
 * Evaluate sheets: [{id, rows, head, fmt}] → { values, numeric }.
 */
export function sheets_eval(sheets: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly code_langs: (a: number) => void;
  readonly djot_parse: (a: number, b: number, c: number) => void;
  readonly djot_write: (a: number, b: number, c: number) => void;
  readonly doc_css: (a: number, b: number, c: number) => void;
  readonly docx_import: (a: number, b: number, c: number) => void;
  readonly file_build: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly file_read: (a: number, b: number, c: number) => void;
  readonly grid_format: (a: number, b: number, c: number, d: number) => void;
  readonly grid_parse: (a: number, b: number, c: number) => void;
  readonly highlight: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly html_import: (a: number, b: number, c: number) => void;
  readonly math_html: (a: number, b: number, c: number, d: number) => void;
  readonly md_export: (a: number, b: number, c: number) => void;
  readonly md_import: (a: number, b: number, c: number) => void;
  readonly odt_import: (a: number, b: number, c: number) => void;
  readonly pdf_import: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly render_html: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly set_timezone: (a: number, b: number) => void;
  readonly sheets_eval: (a: number, b: number, c: number) => void;
  readonly __wbindgen_export: (a: number, b: number) => number;
  readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init(module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
