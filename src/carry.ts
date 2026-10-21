// One-time carry-over from the app's former name (OneType, appId "onetype"): settings, recent files, draft recovery.
// Copies, never moves — the old folders stay until the person deletes them. Runs before aio opens its database.

type Env = (k: string) => string | undefined;

const exists = (p: string) => Deno.stat(p).then(() => true, () => false);

async function copyDir(from: string, to: string) {
  await Deno.mkdir(to, { recursive: true });
  for await (const e of Deno.readDir(from)) {
    if (e.isDirectory) await copyDir(`${from}/${e.name}`, `${to}/${e.name}`);
    else if (e.isFile) await Deno.copyFile(`${from}/${e.name}`, `${to}/${e.name}`);
  }
}

/** The two folders an app id owns: aio's home (same rule as aio's appHome) and the drafts folder (files.server.ts). */
export function homesOf(id: string, env: Env): { home: string; data: string } {
  const user = env("HOME") ?? env("USERPROFILE") ?? ".";
  const apps = env("AIO_APPS_DIR");
  return {
    home: apps ? `${apps}/${id}` : `${user}/.${id}`,
    data: `${env("XDG_DATA_HOME") ?? `${user}/.local/share`}/${id}`,
  };
}

/** Copy what `from` left behind into `to`, once: only parts `to` does not have yet. Returns what was copied. */
export async function carryOver(from: string, to: string, env: Env = (k) => Deno.env.get(k)): Promise<string[]> {
  const a = homesOf(from, env), b = homesOf(to, env);
  const done: string[] = [];
  // the database only (state.db + its WAL files); aio writes a fresh meta.json / keys for the new name
  if (await exists(`${a.home}/data/state.db`) && !(await exists(`${b.home}/data/state.db`))) {
    await Deno.mkdir(`${b.home}/data`, { recursive: true });
    for (const f of ["state.db", "state.db-wal", "state.db-shm"]) {
      if (await exists(`${a.home}/data/${f}`)) await Deno.copyFile(`${a.home}/data/${f}`, `${b.home}/data/${f}`);
    }
    done.push("settings");
  }
  if (await exists(a.data) && !(await exists(b.data))) {
    await copyDir(a.data, b.data);
    done.push("drafts");
  }
  return done;
}
