// What to show while a formula is typed (pure): matching function names, or the signature of the function the caret is in.

/** name → [arguments, what it does]. The functions people use most; all work in the sheet engine. */
export const FUNCS: Record<string, [string, string]> = {
  SUM: ["number1, [number2], …", "adds numbers"],
  AVERAGE: ["number1, [number2], …", "the mean of numbers"],
  MIN: ["number1, [number2], …", "the smallest number"],
  MAX: ["number1, [number2], …", "the largest number"],
  COUNT: ["value1, [value2], …", "how many cells hold numbers"],
  COUNTA: ["value1, [value2], …", "how many cells are not empty"],
  COUNTBLANK: ["range", "how many cells are empty"],
  COUNTIF: ["range, criteria", 'cells matching a condition, like ">10"'],
  COUNTIFS: ["range1, criteria1, [range2, criteria2], …", "cells matching every condition"],
  SUMIF: ["range, criteria, [sum_range]", "adds the cells matching a condition"],
  SUMIFS: ["sum_range, range1, criteria1, …", "adds the cells matching every condition"],
  AVERAGEIF: ["range, criteria, [average_range]", "the mean of the cells matching a condition"],
  SUMPRODUCT: ["array1, [array2], …", "multiplies ranges item by item, then adds"],
  ROUND: ["number, digits", "rounds to a number of digits"],
  ROUNDUP: ["number, digits", "rounds away from zero"],
  ROUNDDOWN: ["number, digits", "rounds toward zero"],
  INT: ["number", "rounds down to a whole number"],
  ABS: ["number", "the number without its sign"],
  MOD: ["number, divisor", "the remainder of a division"],
  POWER: ["number, power", "a number raised to a power"],
  SQRT: ["number", "the square root"],
  IF: ["test, value_if_true, [value_if_false]", "one value or another, by a condition"],
  IFS: ["test1, value1, [test2, value2], …", "the value of the first true condition"],
  IFERROR: ["value, value_if_error", "a fallback when the value is an error"],
  AND: ["test1, [test2], …", "TRUE when every test is true"],
  OR: ["test1, [test2], …", "TRUE when any test is true"],
  NOT: ["test", "flips TRUE and FALSE"],
  VLOOKUP: ["value, table, column, [approximate]", "finds a row by its first cell, returns another column"],
  HLOOKUP: ["value, table, row, [approximate]", "finds a column by its first cell, returns another row"],
  XLOOKUP: ["value, lookup_range, return_range, [if_not_found]", "finds a value, returns the matching item"],
  INDEX: ["range, row, [column]", "the cell at a position in a range"],
  MATCH: ["value, range, [match_type]", "the position of a value in a range"],
  CONCAT: ["text1, [text2], …", "joins text"],
  TEXTJOIN: ["delimiter, ignore_empty, text1, …", "joins text with a separator"],
  LEFT: ["text, [count]", "the first characters"],
  RIGHT: ["text, [count]", "the last characters"],
  MID: ["text, start, count", "characters from the middle"],
  LEN: ["text", "the number of characters"],
  TRIM: ["text", "removes extra spaces"],
  UPPER: ["text", "CAPITALS"],
  LOWER: ["text", "lower case"],
  PROPER: ["text", "Capitalises Each Word"],
  TEXT: ["value, format", 'a number as text, like TEXT(A1, "0.00")'],
  VALUE: ["text", "text that looks like a number, as a number"],
  TODAY: ["", "today's date"],
  NOW: ["", "the date and time now"],
  DATE: ["year, month, day", "a date from its parts"],
  YEAR: ["date", "the year of a date"],
  MONTH: ["date", "the month of a date (1–12)"],
  DAY: ["date", "the day of a date (1–31)"],
  WEEKDAY: ["date, [type]", "the day of the week (1 = Sunday)"],
  DAYS: ["end_date, start_date", "days between two dates"],
  EDATE: ["date, months", "the date some months later"],
  NETWORKDAYS: ["start_date, end_date, [holidays]", "working days between two dates"],
  PMT: ["rate, periods, present_value", "the payment of a loan"],
  MEDIAN: ["number1, [number2], …", "the middle number"],
  STDEV: ["number1, [number2], …", "how spread out numbers are (sample)"],
  RANK: ["number, range, [order]", "the position of a number in a list"],
  ISBLANK: ["value", "TRUE when the cell is empty"],
  ISNUMBER: ["value", "TRUE when the value is a number"],
};

export type Hint =
  | { kind: "names"; prefix: string; names: string[] }
  | { kind: "call"; name: string; args: string; desc: string; arg: number };

/** The hint for formula `text` with the caret at `caret`, or null (not a formula, nothing to say). */
export function formulaHint(text: string, caret = text.length): Hint | null {
  if (!text.startsWith("=")) return null;
  const before = text.slice(0, caret);
  // a function name being typed (letters right after an operator, `=`, `(` or `,`)
  const typing = /(?:^=|[(,;+\-*/^&<>=:\s])([A-Za-z][A-Za-z0-9.]*)$/.exec(before);
  if (typing) {
    const prefix = typing[1].toUpperCase();
    const names = Object.keys(FUNCS).filter((n) => n.startsWith(prefix) && n !== prefix).slice(0, 6);
    if (names.length) return { kind: "names", prefix: typing[1], names };
  }
  // the innermost open call around the caret, and which argument the caret is in
  const stack: { name: string; arg: number }[] = [];
  let quoted = false;
  for (let i = 1; i < before.length; i++) {
    const ch = before[i];
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch === "(") stack.push({ name: (/([A-Za-z][A-Za-z0-9.]*)$/.exec(before.slice(0, i))?.[1] ?? "").toUpperCase(), arg: 0 });
    else if (ch === ")") stack.pop();
    else if ((ch === "," || ch === ";") && stack.length) stack[stack.length - 1].arg++;
  }
  const top = stack.at(-1);
  const f = top && FUNCS[top.name];
  return f ? { kind: "call", name: top.name, args: f[0], desc: f[1], arg: top.arg } : null;
}
