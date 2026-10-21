// Writy — entry. Cells and server functions register on import.
import { carryOver } from "./carry.ts";
import "./cell/prefs.ts";
import "./server/files.server.ts";
import { aio, log } from "aio";

// settings, recent files and draft recovery from the former name, before aio opens the database
try {
  const got = await carryOver("onetype", "writy");
  if (got.length) log.info("carry", `carried over from OneType: ${got.join(", ")}`);
} catch (e) {
  log.warn("carry", `could not carry over OneType data: ${e instanceof Error ? e.message : e}`);
}

await aio.run({
  ui: { theme: "tokens", title: "Writy" },
  assets: { "/assets": "./assets" }, // the Rust/WASM core (also in deno.json, so builds embed it)
  electron: { ignoreDebugEnv: true, strictPin: true },
  wire: { refuseShortCalls: true },
  // drop a cell that existed for a moment during development (0.1.1), so dev stores stop warning about it
  onRestore: (s) => void delete (s as Record<string, unknown>).pick,
});
