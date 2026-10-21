import { assertEquals } from "@std/assert";
import { formulaHint } from "../src/editor/fnhints.ts";

Deno.test("formula hints: names while typing, signature inside a call", () => {
  assertEquals(formulaHint("plain"), null);
  assertEquals(formulaHint("=SU"), { kind: "names", prefix: "SU", names: ["SUM", "SUMIF", "SUMIFS", "SUMPRODUCT"] });
  assertEquals(formulaHint("=A1+cou")?.kind, "names");
  const h = formulaHint("=IF(A1>2, SUM(B1:B3), ");
  assertEquals(h, { kind: "call", name: "IF", args: "test, value_if_true, [value_if_false]", desc: "one value or another, by a condition", arg: 2 });
  assertEquals((formulaHint('=CONCAT("a,b", ') as { arg: number }).arg, 1, "commas in quotes do not count");
  assertEquals(formulaHint("=SUM(1,2)"), null, "closed call");
  assertEquals(formulaHint("=SUM(1, 2)", 6)?.kind, "call", "caret inside");
});
