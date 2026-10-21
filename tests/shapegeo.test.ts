import { assertEquals } from "@std/assert";
import { endsOf, fromEnds, moveEnd, resizeBox } from "../src/editor/shapegeo.ts";

const box = { x: 10, y: 20, w: 40, h: 20 };

Deno.test("line ends: corner to corner, any direction; older arrows run across the middle", () => {
  assertEquals(endsOf(box, "line"), { x1: 10, y1: 20, x2: 50, y2: 40 });
  assertEquals(endsOf(box, "arrow", "br"), { x1: 50, y1: 40, x2: 10, y2: 20 }, "pointing up-left");
  assertEquals(endsOf(box, "arrow", "bl"), { x1: 10, y1: 40, x2: 50, y2: 20 });
  assertEquals(endsOf(box, "arrow"), { x1: 10, y1: 30, x2: 50, y2: 30 }, "legacy arrow");
});

Deno.test("dragging an end: the box and start corner follow, round trip is exact", () => {
  const e = moveEnd(endsOf(box, "arrow", "tl"), 2, 0, 5); // drag the tip up-left, past the start
  assertEquals(fromEnds(e), { x: 0, y: 5, w: 10, h: 15, from: "br" });
  assertEquals(endsOf(fromEnds(e), "arrow", "br"), e);
  assertEquals(fromEnds(moveEnd(endsOf(box, "arrow"), 1, 10, 30)), { x: 10, y: 30, w: 40, h: 0, from: "tl" }, "flat arrow stays flat");
});

Deno.test("Shift snaps a line to 45° steps", () => {
  assertEquals(moveEnd({ x1: 0, y1: 0, x2: 1, y2: 1 }, 2, 30, 2, true), { x1: 0, y1: 0, x2: 30.1, y2: 0 });
  const d = moveEnd({ x1: 0, y1: 0, x2: 1, y2: 1 }, 2, 20, 18, true);
  assertEquals(d.x2, d.y2, "diagonal");
});

Deno.test("resize from any handle; the opposite side stays; minimum size; Shift keeps proportions", () => {
  assertEquals(resizeBox(box, "w", -5, 0), { x: 5, y: 20, w: 45, h: 20 }, "left edge out");
  assertEquals(resizeBox(box, "n", 0, 30), { x: 10, y: 37, w: 40, h: 3 }, "top edge past the bottom stops at 3 mm");
  assertEquals(resizeBox(box, "se", 10, 0), { x: 10, y: 20, w: 50, h: 20 });
  assertEquals(resizeBox(box, "se", 40, 0, true), { x: 10, y: 20, w: 80, h: 40 }, "proportional");
  assertEquals(resizeBox(box, "nw", -40, 0, true), { x: -30, y: 0, w: 80, h: 40 }, "proportional from the top-left");
});
