import { assertEquals } from "@std/assert";
import { count, localNumber, parseTable, toCsv, withExt } from "../src/ui/text.ts";

Deno.test("plural labels", () => {
  assertEquals([count(0, "word"), count(1, "word"), count(2048, "word")], ["0 words", "1 word", (2048).toLocaleString() + " words"]);
});

Deno.test("save as adds the extension only when missing", () => {
  assertEquals(withExt("Report", ["html", "htm"]), "Report.html");
  assertEquals(withExt("Report.", ["html"]), "Report.html");
  assertEquals(withExt("Report.HTM", ["html", "htm"]), "Report.HTM");
  assertEquals(withExt("v1.2 notes", ["md", "markdown"]), "v1.2 notes.md");
});

Deno.test("CSV quotes only what needs it", () => {
  assertEquals(toCsv([["Item", "Note"], ["Milk", 'say "hi", ok'], ["a\nb", "1.5"]]), 'Item,Note\r\nMilk,"say ""hi"", ok"\r\n"a\nb",1.5\r\n');
});

Deno.test("CSV / TSV in: quotes, separators, line breaks inside a cell, and back out unchanged", () => {
  const rows = [["Item", "Note"], ["Milk", 'say "hi", ok'], ["two\nlines", "1.5"]];
  assertEquals(parseTable(toCsv(rows).replace(/\r\n/g, "\n").replace(/\n$/, "")), rows);
  assertEquals(parseTable("a\tb\nc\td"), [["a", "b"], ["c", "d"]]);
  assertEquals(parseTable("one\ntwo"), [["one"], ["two"]]);
});

Deno.test("decimal comma: typed local numbers become numbers, nothing else changes", () => {
  assertEquals(["1,5", "-1 234,50", "1.234,5", "12,5 %", "abc", "=A1,", "1.5", "1,2,3"].map((v) => localNumber(v, ",")), [
    "1.5",
    "-1234.50",
    "1234.5",
    "12.5%",
    "abc",
    "=A1,",
    "1.5",
    "1,2,3",
  ]);
  assertEquals(localNumber("1,5", "."), "1,5", "dot locales keep what was typed");
});
