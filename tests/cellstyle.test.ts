import { assertEquals } from "@std/assert";
import { applyStyle, moveRows, parseStyles, stepDecimals, styleAt, styleCss } from "../src/editor/cellstyle.ts";

Deno.test("cell styles: parse, merge, write", () => {
  const s = "C:al=r bg=#fff3a3;C2:b fg=#c0392b;bad:b;D1:bg=red";
  const rules = parseStyles(s);
  assertEquals(rules.length, 2, "bad target and an unsafe colour are dropped");
  assertEquals(styleAt(rules, 1, 2, 1), { al: "r", bg: "#fff3a3", b: true, fg: "#c0392b" }, "cell beats column");
  assertEquals(styleAt(rules, 0, 2, 1), {}, "column rules skip the header row");
  assertEquals(styleCss({ b: true, al: "c", bg: "#eee" }), "font-weight:700;text-align:center;background:#eee");
  assertEquals(styleAt(parseStyles("A1:wr bd;A2:wr=1"), 0, 0, 0), { wr: true, bd: true }, "wrap / borders are bare tokens");
  assertEquals(applyStyle("A1:wr bd", ["A1"], { bd: null }), "A1:wr");
  assertEquals(styleCss({ wr: true }), "white-space:pre-wrap");
});

Deno.test("cell styles: apply, remove, column clears its cells", () => {
  assertEquals(applyStyle("", ["A1", "B1"], { b: true }), "A1:b;B1:b");
  assertEquals(applyStyle("A1:b bg=#eee", ["A1"], { bg: null }), "A1:b");
  assertEquals(applyStyle("A1:b", ["A1"], { b: null }), "", "an empty rule disappears");
  assertEquals(applyStyle("A2:b=0 fg=#c0392b;B2:b", ["A"], { b: true }), "A2:fg=#c0392b;B2:b;A:b");
});

Deno.test("cell styles and formats follow sorted rows; columns stay", () => {
  const to = new Map([[1, 2], [2, 1]]);
  assertEquals(moveRows("A2:b;B3:bg=#eee;C:al=r;D4:i", to), "A3:b;B2:bg=#eee;C:al=r;D4:i");
});

Deno.test("more / fewer decimals", () => {
  assertEquals(stepDecimals("#,##0.00", 1), "#,##0.000");
  assertEquals(stepDecimals("#,##0.00", -1), "#,##0.0");
  assertEquals(stepDecimals("#,##0.0", -1), "#,##0");
  assertEquals(stepDecimals("0%", 1), "0.0%");
  assertEquals(stepDecimals('#,##0.00 "€"', 1), '#,##0.000 "€"');
  assertEquals(stepDecimals("", 1, "3.25"), "0.000", "General starts from the value shown");
  assertEquals(stepDecimals("", -1, "12"), "0");
  assertEquals(stepDecimals("yyyy-mm-dd", 1), "yyyy-mm-dd", "dates stay");
});
