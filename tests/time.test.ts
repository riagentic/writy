import { assertEquals } from "jsr:@std/assert@1";
import { ago } from "../src/ui/time.ts";
import { friendly } from "../src/editor/session.ts";

const now = new Date("2026-10-20T15:00:00").getTime();
Deno.test("relative times", () => {
  assertEquals(ago(now - 10_000, now), "just now");
  assertEquals(ago(now - 60_000, now), "1 minute ago");
  assertEquals(ago(now - 5 * 60_000, now), "5 minutes ago");
  assertEquals(ago(now - 3 * 3600_000, now), "3 hours ago");
  assertEquals(ago(new Date("2026-10-19T09:00:00").getTime(), now), "Yesterday");
  assertEquals(ago(new Date("2026-10-16T09:00:00").getTime(), now), "4 days ago");
  assertEquals(ago(new Date("2026-09-01T09:00:00").getTime(), now).includes("2026"), true);
});
Deno.test("friendly file errors", () => {
  assertEquals(
    friendly(new Error("Permission denied (os error 13): open '/x'")),
    "Writy isn't allowed to access this file or folder. Check its permissions.",
  );
  assertEquals(friendly(new Error("No space left on device (os error 28)")), "the disk is full.");
  assertEquals(friendly(new Error("something else")), "something else");
});
