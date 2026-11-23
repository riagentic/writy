import { assertEquals } from "jsr:@std/assert@1";
import { place, sheetsFor, tableBreaks } from "../src/editor/paginate.ts";

// 1000px sheets, 20px gap, 100px margins → content 100..900, next sheet content starts at 1120
const b = { page: 1000, gap: 20, top: 100, bottom: 100 };

Deno.test("block that fits stays", () => assertEquals(place(300, 200, b), 300));
Deno.test("block crossing the bottom margin moves to the next sheet", () => assertEquals(place(800, 200, b), 1120));
Deno.test("block ending exactly at the margin stays", () => assertEquals(place(700, 200, b), 700));
Deno.test("block taller than a page is left to flow", () => assertEquals(place(500, 2000, b), 500));
Deno.test("block already at a page top never moves (no endless push)", () => assertEquals(place(1120, 900, b), 1120));
Deno.test("block that fell into a top margin moves down to the content top", () => assertEquals(place(1050, 50, b), 1120));
Deno.test("page break forces the next block onto a new sheet", () => {
  assertEquals(place(300, 10, b, true), 1120);
  assertEquals(place(100, 10, b, true), 100); // already first on its page
});
Deno.test("sheet count", () => {
  assertEquals(sheetsFor(0, b), 1);
  assertEquals(sheetsFor(1000, b), 1);
  assertEquals(sheetsFor(1030, b), 2);
  assertEquals(sheetsFor(2040, b), 2);
  assertEquals(sheetsFor(2041, b), 3);
});

const th = { th: true, colspan: 1, rowspan: 1 }, td = { th: false, colspan: 1, rowspan: 1 };
Deno.test("table breaks: between body rows, never right after the header", () => {
  assertEquals(tableBreaks([[th, th], [td, td], [td, td], [td, td]]), { head: 1, lead: 1, at: [2, 3], cols: 2 });
});
Deno.test("table breaks: no header → any row but the first", () => {
  assertEquals(tableBreaks([[td], [td], [td]]), { head: 0, lead: 0, at: [1, 2], cols: 1 });
});
Deno.test("table breaks: never across a row-spanning cell", () => {
  const span = { th: false, colspan: 1, rowspan: 3 };
  assertEquals(tableBreaks([[th, th], [span, td], [td], [td], [td, td]]).at, [4]);
});
Deno.test("table breaks: width counts merged columns; header-only table never breaks", () => {
  assertEquals(tableBreaks([[{ th: true, colspan: 3, rowspan: 1 }], [td, td, td]]).cols, 3);
  assertEquals(tableBreaks([[th], [th]]), { head: 2, lead: 1, at: [], cols: 1 });
});
