import { assert, assertEquals } from "@std/assert";
import { carryOver, homesOf } from "../src/carry.ts";

Deno.test("carry-over from the former name: copies once, never moves, never overwrites", async () => {
  const root = await Deno.makeTempDir({ prefix: "writy-carry-" });
  try {
    const env = (k: string) => ({ HOME: root, XDG_DATA_HOME: `${root}/share` } as Record<string, string>)[k];
    const old = homesOf("onetype", env);
    assertEquals(old.home, `${root}/.onetype`);
    await Deno.mkdir(`${old.home}/data`, { recursive: true });
    await Deno.writeTextFile(`${old.home}/data/state.db`, "db");
    await Deno.writeTextFile(`${old.home}/data/meta.json`, `{"appId":"onetype"}`);
    await Deno.mkdir(`${old.data}/drafts`, { recursive: true });
    await Deno.writeTextFile(`${old.data}/drafts/a.html`, "draft");
    assertEquals(await carryOver("onetype", "writy", env), ["settings", "drafts"]);
    const neu = homesOf("writy", env);
    assertEquals(await Deno.readTextFile(`${neu.home}/data/state.db`), "db");
    assertEquals(await Deno.readTextFile(`${neu.data}/drafts/a.html`), "draft");
    assert(!(await Deno.stat(`${neu.home}/data/meta.json`).catch(() => null)), "meta.json is aio's to write for the new name");
    assertEquals(await Deno.readTextFile(`${old.home}/data/state.db`), "db", "the old folder stays");
    await Deno.writeTextFile(`${neu.home}/data/state.db`, "newer");
    assertEquals(await carryOver("onetype", "writy", env), [], "second start: nothing to do");
    assertEquals(await Deno.readTextFile(`${neu.home}/data/state.db`), "newer", "never overwrites");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
