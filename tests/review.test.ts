import { assertEquals } from "@std/assert";
import { schema } from "../src/editor/schema.ts";
import { notes } from "../src/editor/review.ts";

const K = schema.marks;
const c = K.span.create({ a: { comment: "Check this", by: "Ann", at: "2026-10-20" } });
const ins = K.ins.create({ a: { by: "Bob" } });
const d = schema.node("doc", null, [
  schema.node("paragraph", null, [
    schema.text("Hello "),
    schema.text("big", [c]),
    schema.text(" world", [c, K.strong.create()]), // same comment across formatting → one note
    schema.text(" new", [ins]),
    schema.text(" underline", [K.ins.create()]), // plain underline is not a tracked change
  ]),
]);

Deno.test("review: comments merge across marks; plain ins ignored", () => {
  const n = notes(d);
  assertEquals(n.map((x) => [x.kind, x.quote, x.by, x.text]), [["comment", "big world", "Ann", "Check this"], ["ins", " new", "Bob", ""]]);
});
