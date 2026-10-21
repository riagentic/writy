import { assert, assertStringIncludes } from "@std/assert";
import { djotParse, djotWrite, fileBuild, ready } from "../src/core/index.ts";
import { templates } from "../src/doc/templates.ts";
import { fromPM, toPM } from "../src/editor/convert.ts";

await ready();

for (const t of templates()) {
  Deno.test(`template ${t.id}: survives the editor and saves`, () => {
    const x = fromPM(toPM(djotParse(t.src)));
    const html = fileBuild(x, []);
    assertStringIncludes(html, 'id="jw-src"');
    assert(t.id === "blank" || djotWrite(x).length > 20, "has content");
  });
}

Deno.test("template invoice: totals are computed on save", () => {
  const html = fileBuild(djotParse(templates().find((t) => t.id === "invoice")!.src), []);
  assertStringIncludes(html, "[980.00]{calc=");
});
