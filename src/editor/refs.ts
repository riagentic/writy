// Cell references inside formulas (pure): shift them when rows/columns are inserted or deleted, move them when a formula is
// copied (relative refs follow, `$` refs stay), and rename a sheet everywhere.

/** Column letters ↔ 0-based index. */
export const colIndex = (s: string): number => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const colLetters = (i: number): string => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

// sheet! (optional, maybe quoted) · $? COL · $? ROW — not part of a longer name, not a function call
const REF = /(?<![\p{L}\p{N}_.$])((?:'[^']+'|[\p{L}_][\p{L}\p{N}_]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\p{L}\p{N}_(!])/gu;

type Ref = { sheet: string | null; absC: boolean; col: number; absR: boolean; row: number };
const unq = (s: string) => s.replace(/^'|'$/g, "");

/** Rewrite every reference outside string literals. `f` returns the new ref, or null for #REF!. */
function mapRefs(formula: string, f: (r: Ref, inRange: "start" | "end" | null) => Ref | null): string {
  if (!formula.startsWith("=")) return formula;
  // split on string literals so "A1" inside quotes is never touched
  return formula.split(/("(?:[^"]|"")*")/).map((part, i) => {
    if (i % 2) return part;
    return part.replace(REF, (m, sh: string | undefined, ac: string, c: string, ar: string, r: string, off: number, all: string) => {
      const before = all.slice(0, off);
      const after = all.slice(off + m.length);
      const inRange = after.startsWith(":") ? "start" : before.endsWith(":") ? "end" : null;
      const ref: Ref = { sheet: sh ? unq(sh.slice(0, -1)) : null, absC: !!ac, col: colIndex(c), absR: !!ar, row: +r - 1 };
      const out = f(ref, inRange);
      if (!out) return "#REF!";
      const name = out.sheet === null ? "" : /^[\p{L}_][\p{L}\p{N}_]*$/u.test(out.sheet) ? `${out.sheet}!` : `'${out.sheet}'!`;
      return `${name}${out.absC ? "$" : ""}${colLetters(out.col)}${out.absR ? "$" : ""}${out.row + 1}`;
    });
  }).join("");
}

export type Edit = { sheet: string; axis: "row" | "col"; at: number; count: number };

/**
 * A row/column insert (count > 0) or delete (count < 0) at 0-based index `at` in sheet `edit.sheet`, seen from a formula
 * living in sheet `home`. References after the edit move; a single reference to a deleted cell becomes #REF!; a range
 * that loses an end shrinks. `cell` (the formula's own position, in `edit.sheet`) lets a totals formula below a range grow
 * it when a row is inserted right after the range's last row (the "add an item to the list" case).
 */
export function shiftRefs(formula: string, home: string, edit: Edit, cell?: { r: number; c: number }): string {
  return mapRefs(formula, (r, inRange) => {
    if ((r.sheet ?? home) !== edit.sheet) return r;
    const k = edit.axis === "row" ? "row" : "col";
    const v = r[k];
    const own = cell && home === edit.sheet ? (k === "row" ? cell.r : cell.c) : -1;
    if (edit.count > 0 && inRange === "end" && v === edit.at - 1 && own >= edit.at) return { ...r, [k]: v + edit.count };
    if (edit.count > 0) return v >= edit.at ? { ...r, [k]: v + edit.count } : r;
    const n = -edit.count;
    if (v < edit.at) return r;
    if (v >= edit.at + n) return { ...r, [k]: v - n };
    // inside the deleted block
    if (inRange === "start") return { ...r, [k]: edit.at };
    if (inRange === "end") return edit.at > 0 ? { ...r, [k]: edit.at - 1 } : null;
    return null;
  });
}

/** A formula copied by (dr, dc): relative references follow, `$` parts stay. Off-grid → #REF!. */
export function moveRefs(formula: string, dr: number, dc: number): string {
  return mapRefs(formula, (r) => {
    const row = r.absR ? r.row : r.row + dr;
    const col = r.absC ? r.col : r.col + dc;
    return row < 0 || col < 0 ? null : { ...r, row, col };
  });
}

/** Sheet `from` renamed to `to`: qualified references follow. */
export function renameRefs(formula: string, from: string, to: string): string {
  return mapRefs(formula, (r) => (r.sheet === from ? { ...r, sheet: to } : r));
}

/** A `Sheet!A1:B2` / `A1` reference string (charts, live values) under the same edits. */
export function shiftRange(range: string, home: string, edit: Edit): string {
  const out = shiftRefs(`=${range}`, home, edit).slice(1);
  return out.includes("#REF!") ? range : out;
}

/** F4 cycle, as [$column, $row]: A1 → $A$1 → A$1 → $A1 → A1. */
const LOCKS: [boolean, boolean][] = [[false, false], [true, true], [false, true], [true, false]];

/** F4 on the reference at `caret`: the next `$` combination. Returns the new text and caret, or null when the caret is on none. */
export function cycleRef(text: string, caret: number): { text: string; caret: number } | null {
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_])(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\p{L}\p{N}_(])/gu)) {
    const start = m.index!, end = start + m[0].length;
    if (caret < start || caret > end) continue;
    const i = LOCKS.findIndex(([c, r]) => c === !!m[1] && r === !!m[3]);
    const [c, r] = LOCKS[(i + 1) % LOCKS.length];
    const ref = `${c ? "$" : ""}${m[2]}${r ? "$" : ""}${m[4]}`;
    return { text: text.slice(0, start) + ref + text.slice(end), caret: start + ref.length };
  }
  return null;
}

/** A sheet name as a Writy sheet id (letters, digits, `_`; never starting with a digit). */
export const sheetIdOf = (name: string): string => name.replace(/[^\p{L}\p{N}_]/gu, "_").replace(/^(?=\d)|^$/, "S");

/**
 * A LibreOffice Calc formula (as its CSV export writes it) in Writy syntax: `$Sales.B4` / `$'Costs 2026'.B4` → `Sales!B4` /
 * `Costs_2026!B4`. `ids` maps sheet names to the ids they were imported as. Text in quotes is left alone.
 */
export function fromCalc(formula: string, ids: Map<string, string>): string {
  if (!formula.startsWith("=")) return formula;
  const cell = "\\$?[A-Za-z]{1,3}\\$?\\d+";
  const ref = new RegExp(
    `\\$?(?:'((?:[^']|'')+)'|([\\p{L}_][\\p{L}\\p{N}_]*))\\.(${cell})(?::\\$?(?:'(?:[^']|'')+'|[\\p{L}_][\\p{L}\\p{N}_]*)\\.(${cell}))?`,
    "gu",
  );
  return formula.split(/("(?:[^"]|"")*")/).map((part, i) =>
    i % 2 ? part : part.replace(ref, (_m, q: string | undefined, plain: string | undefined, a: string, b: string | undefined) => {
      const name = q !== undefined ? q.replace(/''/g, "'") : plain!;
      return `${ids.get(name) ?? sheetIdOf(name)}!${a}${b ? `:${b}` : ""}`;
    })
  ).join("");
}
