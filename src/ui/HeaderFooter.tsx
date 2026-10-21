// Header & footer dialog: left / centre / right for each, field buttons, presets, live preview of page 1.
import type { JSX } from "aio";
import { onMount, useLocal, useRef } from "aio/air";
import { docTitle, metaGet, metaSet } from "../editor/session.ts";
import { hfText } from "./paper.ts";
import { Icon } from "./icons.tsx";
import { hfOpen } from "./state.ts";

type Parts = [string, string, string];
type Both = { header: Parts; footer: Parts };

const SLOTS = ["Left", "Centre", "Right"] as const;
const FIELDS: [token: string, label: string][] = [["{page}", "Page number"], ["{pages}", "Number of pages"], ["{title}", "Title"]];
const PRESETS: [string, Both][] = [
  ["Page X of Y", { header: ["", "", ""], footer: ["", "Page {page} of {pages}", ""] }],
  ["Title · page number", { header: ["{title}", "", ""], footer: ["", "", "{page}"] }],
  ["Page number only", { header: ["", "", ""], footer: ["", "{page}", ""] }],
  ["None", { header: ["", "", ""], footer: ["", "", ""] }],
];

/** Template → three parts (same rule as rendering: one part = centre, two = left & right). */
export const split = (tpl: string): Parts => {
  const p = tpl.trim() ? tpl.split("|").map((s) => s.trim()) : [];
  return p.length === 1 ? ["", p[0], ""] : p.length === 2 ? [p[0], "", p[1]] : [p[0] ?? "", p[1] ?? "", p[2] ?? ""];
};
/** Three parts → template ("" when all empty). */
export const join = (p: Parts): string => p.some((s) => s.trim()) ? p.map((s) => s.trim()).join(" | ") : "";

const close = () => hfOpen.set(false);

export default function HeaderFooter(): JSX.Element {
  const m = metaGet();
  const [v, setV] = useLocal<Both>({ header: split(m.header ?? ""), footer: split(m.footer ?? "") });
  const box = useRef<HTMLDivElement | null>(null);
  const last = useRef<HTMLInputElement | null>(null); // where field buttons insert
  onMount(() => box.current?.querySelector<HTMLInputElement>("input")?.focus());
  const title = docTitle(m);
  const set = (k: keyof Both, i: number, s: string) => setV({ ...v, [k]: v[k].map((x, j) => (j === i ? s : x)) as Parts });
  const insert = (token: string) => {
    const el = last.current;
    if (!el) return;
    const [k, i] = (el.dataset.slot ?? "footer:1").split(":");
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    set(k as keyof Both, +i, el.value.slice(0, a) + token + el.value.slice(b));
    requestAnimationFrame(() => (el.focus(), el.setSelectionRange(a + token.length, a + token.length)));
  };
  const ok = () => (metaSet({ header: join(v.header), footer: join(v.footer) }), close());
  const section = (k: keyof Both, name: string) => (
    <fieldset class="jw-hf-set">
      <legend>{name}</legend>
      <div class="jw-hf-row">
        {SLOTS.map((s, i) => (
          <label key={s}>
            <span>{s}</span>
            <input
              data-slot={`${k}:${i}`}
              aria-label={`${name} ${s.toLowerCase()}`}
              value={v[k][i]}
              placeholder="—"
              onFocus={(e: FocusEvent) => (last.current = e.target as HTMLInputElement)}
              onInput={(e: Event) => set(k, i, (e.target as HTMLInputElement).value)}
            />
          </label>
        ))}
      </div>
      <div class="jw-hf-prev" aria-label={`${name} preview`}>
        {(hfText(join(v[k]), title, 1, 3).length ? hfText(join(v[k]), title, 1, 3) : ["", "(empty)", ""]).map((s, i) => <span key={i}>{s}</span>)}
      </div>
    </fieldset>
  );
  return (
    <div class="jw-modal-back" onMouseDown={(e: MouseEvent) => e.target === e.currentTarget && close()}>
      <div
        class="jw-modal jw-hfdlg"
        role="dialog"
        aria-label="Header & footer"
        ref={box}
        onKeyDown={(e: KeyboardEvent) => e.key === "Escape" ? close() : e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && ok()}
      >
        <div class="jw-set-head">
          <Icon name="header" size={18} />
          <span class="jw-modal-title">Header & footer</span>
          <button type="button" class="jw-x" aria-label="Close header and footer" onClick={close}>✕</button>
        </div>
        <div class="jw-hf-presets" role="group" aria-label="Presets">
          {PRESETS.map(([name, p]) => <button key={name} type="button" class="jw-chip" onClick={() => setV(p)}>{name}</button>)}
        </div>
        {section("header", "Header")}
        {section("footer", "Footer")}
        <div class="jw-hf-fields" role="group" aria-label="Insert field">
          <span>Insert at cursor:</span>
          {FIELDS.map(([t, label]) => (
            <button
              key={t}
              type="button"
              class="jw-chip"
              onMouseDown={(e: MouseEvent) => e.preventDefault()}
              onClick={() => insert(t)}
            >
              {label}
            </button>
          ))}
        </div>
        <div class="jw-modal-row">
          <button type="button" onClick={close}>Cancel</button>
          <button type="button" class="primary" onClick={ok}>OK</button>
        </div>
      </div>
    </div>
  );
}
