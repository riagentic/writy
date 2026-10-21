import { assert, assertEquals } from "jsr:@std/assert@1";
import { clamp, fit, step } from "../src/ui/zoom.ts";

Deno.test("zoom ladder steps from any value", () => {
  assertEquals(step(100, 1), 110);
  assertEquals(step(100, -1), 90);
  assertEquals(step(103, -1), 100);
  assertEquals(step(400, 1), 400);
  assertEquals(step(25, -1), 25);
});
Deno.test("clamp", () => assertEquals([clamp(5), clamp(999), clamp(99.6)], [25, 400, 100]));
Deno.test("fit width / whole page for A4", () => {
  const a4 = { w: 210, h: 297 };
  assertEquals(fit("width", 841.7, 600, a4), 100); // 210mm = 793.7px + 48
  assert(fit("page", 841.7, 600, a4) < fit("width", 841.7, 600, a4));
});
