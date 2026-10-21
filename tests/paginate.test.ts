import { assertEquals } from "jsr:@std/assert@1";
import { place, sheetsFor } from "../src/editor/paginate.ts";

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
