import { assertEquals } from "@std/assert";
import { colIndex, colLetters, cycleRef, fromCalc, moveRefs, renameRefs, sheetIdOf, shiftRange, shiftRefs } from "../src/editor/refs.ts";

Deno.test("column letters", () => {
  assertEquals([colIndex("A"), colIndex("Z"), colIndex("AA"), colIndex("AZ"), colIndex("BA")], [0, 25, 26, 51, 52]);
  assertEquals([0, 25, 26, 51, 52, 701, 702].map(colLetters), ["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
});

Deno.test("insert / delete rows keeps formulas pointing at the same cells", () => {
  const ins = { sheet: "S", axis: "row" as const, at: 2, count: 1 }; // new row 3
  assertEquals(shiftRefs("=SUM(D2:D3)*B$4+A1", "S", ins), "=SUM(D2:D4)*B$5+A1");
  assertEquals(shiftRefs("=Other!A5+S!A5", "Other", ins), "=Other!A5+S!A6");
  assertEquals(shiftRefs('="A5"&A5', "S", ins), '="A5"&A6', "text in quotes untouched");
  const del = { sheet: "S", axis: "row" as const, at: 2, count: -1 }; // delete row 3
  assertEquals(shiftRefs("=A3+A4", "S", del), "=#REF!+A3");
  assertEquals(shiftRefs("=SUM(D2:D3)", "S", del), "=SUM(D2:D2)", "range shrinks");
  assertEquals(shiftRefs("=SUM(D3:D5)", "S", del), "=SUM(D3:D4)");
  assertEquals(shiftRefs("plain A3", "S", del), "plain A3", "not a formula");
  // a totals formula in row 4 summing D2:D3 grows when a row is inserted right under the list (new row 4)
  const under = { sheet: "S", axis: "row" as const, at: 3, count: 1 };
  assertEquals(shiftRefs("=SUM(D2:D3)", "S", under, { r: 3, c: 3 }), "=SUM(D2:D4)");
  assertEquals(shiftRefs("=SUM(D2:D3)", "S", under), "=SUM(D2:D3)", "without the formula's position: plain shift rules");
  assertEquals(shiftRefs("=SUM(D2:D3)", "S", under, { r: 0, c: 5 }), "=SUM(D2:D3)", "a formula above the list does not grow it");
});

Deno.test("insert / delete columns, functions are not references", () => {
  const ins = { sheet: "S", axis: "col" as const, at: 1, count: 1 }; // new column B
  assertEquals(shiftRefs("=LOG10(B2)+A1+$C$1", "S", ins), "=LOG10(C2)+A1+$D$1");
  const del = { sheet: "S", axis: "col" as const, at: 0, count: -1 };
  assertEquals(shiftRefs("=SUM(A1:C1)", "S", del), "=SUM(A1:B1)");
  assertEquals(shiftRefs("=A1", "S", del), "=#REF!");
});

Deno.test("copy a formula: relative refs move, $ refs stay", () => {
  assertEquals(moveRefs("=B2*C2", 1, 0), "=B3*C3");
  assertEquals(moveRefs("=$B2*C$2+$D$1", 2, 1), "=$B4*D$2+$D$1");
  assertEquals(moveRefs("=A1", -1, 0), "=#REF!");
  assertEquals(moveRefs("=Sales!A1", 0, 1), "=Sales!B1");
});

Deno.test("rename a sheet; ranges in charts", () => {
  assertEquals(renameRefs("=Sales!A1+Costs!B2+A1", "Sales", "Přehled"), "=Přehled!A1+Costs!B2+A1");
  assertEquals(renameRefs("=Sales!A1", "Sales", "My data"), "='My data'!A1");
  assertEquals(renameRefs("='My data'!A1", "My data", "D"), "=D!A1");
  assertEquals(shiftRange("S!A1:C4", "S", { sheet: "S", axis: "row", at: 1, count: 1 }), "S!A1:C5");
});

Deno.test("F4 cycles $ on the reference at the caret", () => {
  const steps = ["=A1+B2", "=$A$1+B2", "=A$1+B2", "=$A1+B2", "=A1+B2"];
  let t = steps[0], caret = 2;
  for (const want of steps.slice(1)) ({ text: t, caret } = cycleRef(t, caret)!), assertEquals(t, want);
  assertEquals(cycleRef("=SUM(B2:C3)", 10)?.text, "=SUM(B2:$C$3)");
  assertEquals(cycleRef("=LOG10(2)", 7), null, "a function name is not a reference");
});

Deno.test("Calc formulas from .xlsx / .ods become Writy formulas", () => {
  const ids = new Map([["Sales", "Sales"], ["Costs 2026", "Costs_2026"]]);
  assertEquals(fromCalc("=$Sales.B4*2", ids), "=Sales!B4*2");
  assertEquals(fromCalc("=SUM($'Costs 2026'.A1:$'Costs 2026'.A3)+1.5", ids), "=SUM(Costs_2026!A1:A3)+1.5");
  assertEquals(fromCalc("=SUM(B2:B3)", ids), "=SUM(B2:B3)", "same-sheet refs untouched");
  assertEquals(fromCalc('="a.b1"&STDEV.S(A1:A3)', ids), '="a.b1"&STDEV.S(A1:A3)', "quoted text and dotted functions untouched");
  assertEquals(sheetIdOf("2026 plan"), "S2026_plan");
});
