// Small modal prompts + toasts usable from anywhere (node views, commands).
// Every modal: focus moves in, Tab stays inside, Escape / backdrop cancels, focus returns to where it was.
const h = (tag: string, cls = "", text = ""): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const FOCUSABLE = "button:not(:disabled), input, select, textarea, [tabindex]:not([tabindex='-1'])";

/** Shared modal shell. `build` fills the box and returns what to focus first; `done(v)` closes with a result. */
function modal<T>(
  title: string,
  role: "dialog" | "alertdialog",
  build: (box: HTMLElement, done: (v: T | null) => void) => HTMLElement | null,
): Promise<T | null> {
  return new Promise((resolve) => {
    const back = h("div", "jw-modal-back");
    const box = h("div", "jw-modal");
    box.setAttribute("role", role);
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", title);
    const was = document.activeElement as HTMLElement | null;
    const done = (v: T | null) => {
      back.remove();
      was?.isConnected && was.focus();
      resolve(v);
    };
    box.append(h("div", "jw-modal-title", title));
    const first = build(box, done);
    back.append(box);
    document.body.append(back);
    (first ?? box.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true }); // long dialogs open at the top
    back.onmousedown = (e) => e.target === back && done(null);
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape") return (e.stopPropagation(), done(null));
      if (e.key !== "Tab") return;
      const all = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const i = all.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? all.at(-1) : all[i - 1]) : (i === all.length - 1 ? all[0] : all[i + 1]);
      e.preventDefault();
      next?.focus();
    });
  });
}

function buttons(...b: HTMLButtonElement[]): HTMLElement {
  const row = h("div", "jw-modal-row");
  row.append(...b);
  return row;
}
const button = (label: string, primary = false) => h("button", primary ? "primary" : "", label) as HTMLButtonElement;

/** Ask for a value. Resolves null on Cancel/Escape. Multiline: Ctrl+Enter confirms. */
export function ask(title: string, initial = "", multiline = false): Promise<string | null> {
  return modal<string>(title, "dialog", (box, done) => {
    const inp = (multiline ? h("textarea") : h("input")) as HTMLInputElement | HTMLTextAreaElement;
    inp.value = initial;
    inp.setAttribute("aria-label", title);
    const ok = button("OK", true), cancel = button("Cancel");
    ok.onclick = () => done(inp.value);
    cancel.onclick = () => done(null);
    inp.onkeydown = (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Enter" && (!multiline || ke.ctrlKey || ke.metaKey)) (ke.preventDefault(), done(inp.value));
    };
    box.append(inp);
    if (multiline) box.append(h("div", "jw-modal-hint", "Ctrl+Enter to confirm"));
    box.append(buttons(cancel, ok));
    if (inp instanceof HTMLInputElement) queueMicrotask(() => inp.select());
    return inp;
  });
}

/** A form with several labelled fields. */
export function form(title: string, fields: { key: string; label: string; value: string; options?: string[] }[]): Promise<Record<string, string> | null> {
  return modal<Record<string, string>>(title, "dialog", (box, done) => {
    const inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
    for (const f of fields) {
      const lab = h("label", "jw-field");
      lab.append(h("span", "", f.label));
      let inp: HTMLInputElement | HTMLSelectElement;
      if (f.options) {
        inp = h("select") as HTMLSelectElement;
        for (const o of f.options) {
          const op = h("option", "", o) as HTMLOptionElement;
          op.value = o;
          inp.append(op);
        }
      } else inp = h("input") as HTMLInputElement;
      inp.value = f.value;
      inp.setAttribute("aria-label", f.label);
      lab.append(inp);
      inputs[f.key] = inp;
      box.append(lab);
    }
    const values = () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
    const ok = button("OK", true), cancel = button("Cancel");
    ok.onclick = () => done(values());
    cancel.onclick = () => done(null);
    box.addEventListener("keydown", (e) => e.key === "Enter" && e.target instanceof HTMLInputElement && (e.preventDefault(), done(values())));
    box.append(buttons(cancel, ok));
    return Object.values(inputs)[0] ?? null;
  });
}

/** A message with buttons. Resolves the chosen button's value, or null on Escape. */
export function choose<T extends string>(title: string, message: string, opts: { label: string; value: T; primary?: boolean }[]): Promise<T | null> {
  return modal<T>(title, "alertdialog", (box, done) => {
    const bs = opts.map((b) => {
      const el = button(b.label, b.primary);
      el.onclick = () => done(b.value);
      return el;
    });
    box.append(h("div", "jw-modal-msg", message), buttons(...bs));
    return bs[opts.findIndex((b) => b.primary)] ?? bs[0];
  });
}

/** Read-only facts in two columns (e.g. word count), with a Close button. A plain string row is a section heading. */
export function info(title: string, rows: ([label: string, value: string] | string)[]): Promise<null> {
  return modal<never>(title, "dialog", (box, done) => {
    const t = h("table", "jw-info");
    for (const r of rows) {
      const tr = h("tr");
      if (typeof r === "string") {
        const th = h("th", "jw-info-head", r);
        th.setAttribute("colspan", "2");
        tr.append(th);
      } else tr.append(h("th", "", r[0]), h("td", "", r[1]));
      t.append(tr);
    }
    const close = button("Close", true);
    close.onclick = () => done(null);
    box.append(t, buttons(close));
    return close;
  }) as Promise<null>;
}

/** Bottom-right notifications: stacked, click to dismiss, errors stay longer. */
export function toast(msg: string, kind: "info" | "error" = "info"): void {
  let host = document.querySelector<HTMLElement>(".jw-toasts");
  if (!host) {
    host = h("div", "jw-toasts");
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
  }
  const t = h("div", `jw-toast ${kind}`, msg);
  t.setAttribute("role", kind === "error" ? "alert" : "status");
  t.title = "Click to dismiss";
  t.onclick = () => t.remove();
  host.append(t);
  while (host.children.length > 4) host.firstElementChild!.remove();
  setTimeout(() => t.remove(), kind === "error" ? 8000 : 3000);
}
