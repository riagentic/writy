import { testCell } from "aio/testing";
import { prefs } from "../../src/cell/prefs.ts";

testCell(prefs, "recent files: newest first, deduped, capped at 12, remembers folder", async (t) => {
  t.send.addRecent("/a/one.html", "one.html", 1);
  t.send.addRecent("/b/two.html", "two.html", 2);
  t.send.addRecent("/a/one.html", "one.html", 3);
  t.expect.state((s) => s.recent.map((r) => r.name).join() === "one.html,two.html" && s.recent[0].at === 3, "deduped, newest first");
  t.expect.state((s) => s.lastDir === "/a", "last folder");
  for (let i = 0; i < 20; i++) t.send.addRecent(`/c/${i}.html`, `${i}.html`, 10 + i);
  t.expect.state((s) => s.recent.length === 12 && s.recent[0].name === "19.html", "capped");
  t.send.forget("/c/19.html");
  t.expect.state((s) => s.recent[0].name === "18.html", "forget");
  await t.expect.rejects(() => t.send.addRecent("", "x", 1), /path required/);
});

testCell(prefs, "view settings", async (t) => {
  t.send.setZoom(133.4);
  t.expect.state((s) => s.zoom === 133);
  await t.expect.rejects(() => t.send.setZoom(5), /zoom 25–400/);
  t.send.toggleSource();
  t.expect.state((s) => s.showSource);
  t.send.toggleSource();
  t.expect.state((s) => !s.showSource);
  t.send.setLayout("web");
  t.send.setDark("dark");
  t.send.setAuthor("  Ana  ");
  t.expect.state((s) => s.layout === "web" && s.dark === "dark" && s.author === "Ana");
});

testCell(prefs, "pick refuses an unknown dialog kind before opening anything", async (t) => {
  await t.expect.rejects(() => t.send.pick("save" as never), /one of open, picture, video, any, folder/);
});
