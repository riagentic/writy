import { assertEquals } from "@std/assert";
import { schema } from "../src/editor/schema.ts";
import { compile, search } from "../src/editor/find.ts";

const N = schema.nodes;
const d = schema.node(N.doc, null, [
  N.paragraph.create(null, [schema.text("Cat cat "), schema.text("caterpillar", [schema.marks.strong.create()])]),
  N.paragraph.create(null, [schema.text("a.b")]),
]);
const q = (text: string, o: Partial<{ caseSensitive: boolean; word: boolean; regex: boolean }> = {}) => ({
  text,
  caseSensitive: false,
  word: false,
  regex: false,
  ...o,
});
const texts = (text: string, o = {}) => search(d, q(text, o)).map((m) => d.textBetween(m.from, m.to));

Deno.test("find: case-insensitive across marks", () => assertEquals(texts("cat"), ["Cat", "cat", "cat"]));
Deno.test("find: match case", () => assertEquals(texts("cat", { caseSensitive: true }), ["cat", "cat"]));
Deno.test("find: whole words", () => assertEquals(texts("cat", { word: true }), ["Cat", "cat"]));
Deno.test("find: literal dot vs regex", () => {
  assertEquals(texts("."), ["."]);
  assertEquals(texts("a.b", { regex: true }), ["a.b"]);
});
Deno.test("find: invalid regex and empty are no-ops", () => {
  assertEquals(compile(q("(", { regex: true })), null);
  assertEquals(texts(""), []);
});

Deno.test("find: inside sheet cells too, in document order", () => {
  const doc = schema.node(N.doc, null, [
    N.paragraph.create(null, [schema.text("milk first")]),
    N.sheet.create({ id: "S", rows: [["Item", "Note"], ["Milk", "milk, milk"]], head: 1 }),
    N.paragraph.create(null, [schema.text("milk last")]),
  ]);
  const ms = search(doc, q("milk"));
  assertEquals(ms.map((m) => m.cell ? `${m.cell.r},${m.cell.c}@${m.cell.at}` : "text"), ["text", "1,0@0", "1,1@0", "1,1@6", "text"]);
});
