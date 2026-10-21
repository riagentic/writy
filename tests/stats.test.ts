import { assertEquals } from "jsr:@std/assert@1";
import { textStats } from "../src/editor/stats.ts";
import { toPM } from "../src/editor/convert.ts";
import * as core from "../src/core/index.ts";

await core.ready();
const doc = (dj: string) => toPM(core.djotParse(dj));

Deno.test("counts words, characters and paragraphs", () => {
  assertEquals(textStats(doc("# Title\n\nIt's a *nice* day, 2026.\n\n- one\n- two\n")), { words: 8, chars: 33, charsNoSpaces: 29, paragraphs: 4 });
});
Deno.test("empty document", () => assertEquals(textStats(doc("")), { words: 0, chars: 0, charsNoSpaces: 0, paragraphs: 0 }));
Deno.test("a range counts only the selection", () => {
  const d = doc("alpha beta gamma\n");
  assertEquals(textStats(d, 1, 11).words, 2);
});
