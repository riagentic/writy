// Fill series (pure): what dragging a selection's fill handle writes into the next cells, like Excel.
import { moveRefs } from "./refs.ts";

const LISTS = [
  ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  ["Q1", "Q2", "Q3", "Q4"],
];
const NUM = /^[-+]?\d+(\.\d+)?$/;

/** Keep the case style of the example ("JAN", "jan", "Jan"). */
const likeCase = (word: string, ex: string) => ex === ex.toUpperCase() ? word.toUpperCase() : ex === ex.toLowerCase() ? word.toLowerCase() : word;

/** Decimals as typed, so 0.1 + 0.2 shows 0.3 and 1.50 stays 1.50 style. */
const places = (s: string) => s.split(".")[1]?.length ?? 0;

/**
 * The next `n` values after `src` (one line of cells along the drag). `step` is how far apart the cells are (1 for the next
 * row or column), so formulas move their relative references the right way; `dr` / `dc` say which way that is.
 */
export function fillSeries(src: string[], n: number, dr: number, dc: number): string[] {
  const k = src.length;
  if (!k) return [];
  const at = (i: number) => src[i % k];
  // a list (months, weekdays, quarters): continue from the last one, any case
  for (const list of LISTS) {
    const idx = src.map((v) => list.findIndex((w) => w.toLowerCase() === v.trim().toLowerCase()));
    if (idx.every((i) => i >= 0)) {
      const d = k > 1 ? (idx[k - 1] - idx[k - 2] + list.length) % list.length || 1 : 1;
      return Array.from({ length: n }, (_, i) => likeCase(list[(idx[k - 1] + d * (i + 1)) % list.length], src[k - 1].trim()));
    }
  }
  // numbers: one number copies (Excel), two or more continue the average step
  if (src.every((v) => NUM.test(v.trim()))) {
    if (k === 1) return Array(n).fill(src[0]);
    const xs = src.map(Number);
    const d = (xs[k - 1] - xs[0]) / (k - 1);
    const p = Math.max(...src.map((v) => places(v.trim())));
    return Array.from({ length: n }, (_, i) => (xs[k - 1] + d * (i + 1)).toFixed(p));
  }
  // text ending in a number: "Item 1" → "Item 2"
  const tail = src.map((v) => (v.startsWith("=") ? null : /^(.*?)(\d+)$/.exec(v)));
  if (tail.every((m) => m && m[1] === tail[0]![1])) {
    const nums = tail.map((m) => +m![2]);
    const d = k > 1 ? nums[k - 1] - nums[k - 2] : 1;
    return Array.from({ length: n }, (_, i) => `${tail[0]![1]}${nums[k - 1] + d * (i + 1)}`);
  }
  // anything else repeats; formulas move their relative references with the copy
  return Array.from({ length: n }, (_, i) => {
    const v = at(i), off = k + i - (i % k);
    return v.startsWith("=") ? moveRefs(v, off * dr, off * dc) : v;
  });
}
