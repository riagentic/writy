import { assertEquals } from "@std/assert";
import { fillSeries } from "../src/editor/series.ts";

Deno.test("fill series: numbers, lists, numbered text, formulas, plain text", () => {
  assertEquals(fillSeries(["1", "2"], 3, 1, 0), ["3", "4", "5"]);
  assertEquals(fillSeries(["10", "20", "30"], 2, 1, 0), ["40", "50"]);
  assertEquals(fillSeries(["0.1", "0.2"], 2, 1, 0), ["0.3", "0.4"], "no 0.30000000000000004");
  assertEquals(fillSeries(["7"], 2, 1, 0), ["7", "7"], "one number copies, like Excel");
  assertEquals(fillSeries(["Jan"], 3, 1, 0), ["Feb", "Mar", "Apr"]);
  assertEquals(fillSeries(["november"], 3, 0, 1), ["december", "january", "february"], "wraps, keeps case");
  assertEquals(fillSeries(["Mon", "Wed"], 2, 1, 0), ["Fri", "Sun"]);
  assertEquals(fillSeries(["Q3"], 2, 1, 0), ["Q4", "Q1"]);
  assertEquals(fillSeries(["Item 1"], 2, 1, 0), ["Item 2", "Item 3"]);
  assertEquals(fillSeries(["=B2*C2"], 2, 1, 0), ["=B3*C3", "=B4*C4"]);
  assertEquals(fillSeries(["=A1", "=A$1"], 2, 0, 1), ["=C1", "=C$1"], "a block of two repeats, refs move by the block");
  assertEquals(fillSeries(["yes", "no"], 3, 1, 0), ["yes", "no", "yes"]);
});
