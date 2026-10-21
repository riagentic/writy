// Minimal Chrome DevTools Protocol driver for end-to-end checks (needs `chromium`).
export type Page = {
  eval: <T = unknown>(expr: string) => Promise<T>;
  click: (selector: string) => Promise<void>;
  /** Raw mouse click(s) at viewport coordinates (clickCount 2 = double-click). */
  mouse: (x: number, y: number, clickCount?: number) => Promise<void>;
  /** Press at (x0,y0), move in steps to (x1,y1), release. */
  drag: (x0: number, y0: number, x1: number, y1: number) => Promise<void>;
  type: (text: string) => Promise<void>;
  press: (text: string) => Promise<void>;
  key: (key: string, mods?: number) => Promise<void>;
  shot: (path: string) => Promise<void>;
  /** Raw DevTools protocol call (profiling, emulation …). */
  cdp: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  /** Print the page to PDF (what the user's printer would get). */
  pdf: (path: string) => Promise<void>;
  close: () => Promise<void>;
};

export async function launch(url: string, opts: { width?: number; height?: number } = {}): Promise<Page> {
  const port = 9300 + Math.floor(Math.random() * 500);
  const dir = await Deno.makeTempDir({ prefix: "jw-cdp-" });
  const proc = new Deno.Command("chromium", {
    args: [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${dir}`,
      `--window-size=${opts.width ?? 1400},${opts.height ?? 900}`,
      "about:blank",
    ],
    stdout: "null",
    stderr: "null",
  }).spawn();
  let ws = "";
  for (let i = 0; i < 100 && !ws; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      ws = list.find((t: { type: string }) => t.type === "page")?.webSocketDebuggerUrl ?? "";
    } catch { /* not up yet */ }
    if (!ws) await new Promise((r) => setTimeout(r, 100));
  }
  const sock = new WebSocket(ws);
  await new Promise((r) => (sock.onopen = r));
  let id = 0;
  const waiting = new Map<number, (v: { result?: Record<string, unknown>; error?: { message: string } }) => void>();
  sock.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)!(m);
      waiting.delete(m.id);
    }
  };
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((res, rej) => {
      const n = ++id;
      waiting.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result ?? {})));
      sock.send(JSON.stringify({ id: n, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url });
  const evaluate = async <T>(expr: string): Promise<T> => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }) as {
      result: { value: T };
      exceptionDetails?: { exception?: { description?: string } };
    };
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
    return r.result.value;
  };
  // the app: wait until the editor is up; a saved file: until it has loaded
  const ready = url.startsWith("file:") ? 'document.readyState === "complete"' : "!!(window.jw && window.jw.view())";
  for (let i = 0; i < 150; i++) {
    if (await evaluate<boolean>(ready).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    eval: evaluate,
    async click(sel) {
      const box = await evaluate<{ x: number; y: number } | null>(
        `(()=>{const e=document.querySelector(${
          JSON.stringify(sel)
        });if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
      );
      if (!box) throw new Error(`no element ${sel}`);
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
    },
    async mouse(x, y, clickCount = 1) {
      for (let n = 1; n <= clickCount; n++) {
        for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: n });
      }
    },
    async drag(x0, y0, x1, y1) {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, button: "left", clickCount: 1 });
      for (let i = 1; i <= 8; i++) {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + ((x1 - x0) * i) / 8, y: y0 + ((y1 - y0) * i) / 8, button: "left", buttons: 1 });
      }
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: y1, button: "left", clickCount: 1 });
    },
    async type(text) {
      for (const ch of text) await send("Input.insertText", { text: ch });
    },
    async press(text) {
      for (const ch of text) {
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
      }
    },
    async key(key, mods = 0) {
      const code: Record<string, [string, number]> = {
        F5: ["F5", 116],
        End: ["End", 35],
        Home: ["Home", 36],
        Enter: ["Enter", 13],
        Backspace: ["Backspace", 8],
        Tab: ["Tab", 9],
        ArrowLeft: ["ArrowLeft", 37],
        ArrowRight: ["ArrowRight", 39],
        ArrowDown: ["ArrowDown", 40],
        ArrowUp: ["ArrowUp", 38],
        Escape: ["Escape", 27],
        "=": ["Equal", 187],
        "-": ["Minus", 189],
        "0": ["Digit0", 48],
        ".": ["Period", 190],
        ",": ["Comma", 188],
        "/": ["Slash", 191],
        F1: ["F1", 112],
        F6: ["F6", 117],
        Delete: ["Delete", 46],
        "[": ["BracketLeft", 219],
        "]": ["BracketRight", 221],
        "`": ["Backquote", 192],
        F2: ["F2", 113],
        PageUp: ["PageUp", 33],
        PageDown: ["PageDown", 34],
      };
      const [c, k] = code[key] ?? (/^\d$/.test(key) ? [`Digit${key}`, key.charCodeAt(0)] : [`Key${key.toUpperCase()}`, key.toUpperCase().charCodeAt(0)]);
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code: c,
        windowsVirtualKeyCode: k,
        modifiers: mods,
        ...(key === "Enter" ? { text: "\r" } : {}),
      });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: c, windowsVirtualKeyCode: k, modifiers: mods });
    },
    cdp: (method, params) => send(method, params),
    async pdf(path) {
      const r = await send("Page.printToPDF", { preferCSSPageSize: true, printBackground: true }) as { data: string };
      await Deno.writeFile(path, Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)));
    },
    async shot(path) {
      const r = await send("Page.captureScreenshot", { format: "png" }) as { data: string };
      await Deno.writeFile(path, Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)));
    },
    async close() {
      sock.close();
      proc.kill();
      await proc.status;
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    },
  };
}
