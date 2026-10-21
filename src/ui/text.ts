// Small text helpers for labels (pure).

/** "1 word", "2,048 words" (regular English plurals only). */
export const count = (n: number, word: string): string => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/** `typed` as a file name ending in one of `exts` (the first is added when none matches). */
export const withExt = (typed: string, exts: string[]): string =>
  exts.some((e) => typed.toLowerCase().endsWith(`.${e}`)) ? typed : `${typed.replace(/\.$/, "")}.${exts[0]}`;

/** Rows → CSV (RFC 4180): fields with a comma, quote or line break are quoted. */
export const toCsv = (rows: string[][]): string =>
  rows.map((r) => r.map((v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\r\n") + "\r\n";

/** Tab-separated (Excel, Calc, Google Sheets) or comma-separated text → rows. Quoted fields may hold separators, `""` and line breaks. */
export function parseTable(text: string): string[][] {
  const sep = text.includes("\t") ? "\t" : text.includes(",") ? "," : "";
  if (!sep) return text.split("\n").map((l) => [l]);
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"' && cur === "") q = true;
    else if (ch === sep) row.push(cur), cur = "";
    else if (ch === "\n") row.push(cur), rows.push(row), row = [], cur = "";
    else cur += ch;
  }
  row.push(cur);
  rows.push(row);
  return rows;
}

/** The decimal separator of the reader's locale ("." or ","). */
let dec = "";
export const decimalSep = (): string => (dec ||= new Intl.NumberFormat().formatToParts(1.5).find((p) => p.type === "decimal")?.value ?? ".");

/**
 * A number typed the local way ("1,5", "1 234,5", "1.234,5", "12,5 %") in the form formulas understand ("1.5" …), when the
 * locale writes a decimal comma. Anything else (text, formulas, dot decimals) is returned unchanged.
 */
export function localNumber(input: string, dec = decimalSep()): string {
  if (dec !== ",") return input;
  const m = /^\s*([-+]?)(\d{1,3}(?:[ .  ]\d{3})+|\d+),(\d+)\s*(%?)\s*$/.exec(input);
  return m ? `${m[1]}${m[2].replace(/[ .  ]/g, "")}.${m[3]}${m[4]}` : input;
}
