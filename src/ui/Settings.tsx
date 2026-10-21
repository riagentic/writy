// Options dialog: every change applies at once (no OK/Cancel), Escape or ✕ closes.
import type { JSX } from "aio";
import { onMount, useRef } from "aio/air";
import { prefs } from "../cell/prefs.ts";
import { Icon } from "./icons.tsx";
import { settingsOpen } from "./state.ts";
import { setZoom } from "./zoom.ts";

type Opt<T extends string> = { value: T; label: string; icon?: string };

/** A row of toggle buttons (radio group) — one choice, visible at a glance. */
function Segmented<T extends string>(p: { label: string; value: T; options: Opt<T>[]; onPick: (v: T) => void }): JSX.Element {
  return (
    <div class="jw-seg" role="radiogroup" aria-label={p.label}>
      {p.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={p.value === o.value ? "true" : "false"}
          class={p.value === o.value ? "on" : ""}
          onClick={() => p.onPick(o.value)}
        >
          {o.icon ? <Icon name={o.icon} size={16} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row(p: { title: string; hint?: string; children?: JSX.Children }): JSX.Element {
  return (
    <div class="jw-set-row">
      <div>
        <div class="jw-set-title">{p.title}</div>
        {p.hint ? <div class="jw-set-hint">{p.hint}</div> : null}
      </div>
      <div class="jw-set-ctl">{p.children}</div>
    </div>
  );
}

const close = () => settingsOpen.set(false);

export default function Settings(): JSX.Element {
  const box = useRef<HTMLDivElement | null>(null);
  onMount(() => box.current?.querySelector<HTMLElement>("[aria-checked=true], input")?.focus());
  return (
    <div class="jw-modal-back" onMouseDown={(e: MouseEvent) => e.target === e.currentTarget && close()}>
      <div class="jw-modal jw-settings" role="dialog" aria-label="Options" ref={box} onKeyDown={(e: KeyboardEvent) => e.key === "Escape" && close()}>
        <div class="jw-set-head">
          <Icon name="gear" size={18} />
          <span class="jw-modal-title">Options</span>
          <button type="button" class="jw-x" aria-label="Close options" onClick={close}>✕</button>
        </div>
        <p class="jw-set-note">
          How Writy looks and works for you. Nothing here is saved in your documents — a document's own look (page and text colour, design, fonts, pages or web
          page) is in the <b>Layout</b> tab.
        </p>
        <h4>App appearance</h4>
        <Row title="Theme" hint="The app around the page. Pages keep their own colours.">
          <Segmented
            label="Theme"
            value={prefs.dark}
            onPick={(v) => prefs.setDark(v)}
            options={[{ value: "auto", label: "System", icon: "monitor" }, { value: "light", label: "Light", icon: "sun" }, {
              value: "dark",
              label: "Dark",
              icon: "moon",
            }]}
          />
        </Row>
        <h4>You</h4>
        <Row title="Your name" hint="Shown on comments and tracked changes.">
          <input
            aria-label="Your name"
            placeholder="e.g. Ana Novak"
            value={prefs.author}
            onChange={(e: Event) => prefs.setAuthor((e.target as HTMLInputElement).value)}
          />
        </Row>
        <h4>Editor view</h4>
        <Row title="Editor layout" hint="How you see the document while editing. How the saved file opens is set in Document ▸ In a browser.">
          <Segmented
            label="Editor layout"
            value={prefs.layout}
            onPick={(v) => prefs.setLayout(v)}
            options={[{ value: "print", label: "Print" }, { value: "web", label: "Web" }]}
          />
        </Row>
        <Row title="Zoom" hint={`${prefs.zoom}%`}>
          <input
            type="range"
            min="25"
            max="300"
            step="5"
            aria-label="Zoom"
            value={String(prefs.zoom)}
            onInput={(e: Event) => setZoom(+(e.target as HTMLInputElement).value)}
          />
        </Row>
        <Row title="Navigation pane" hint="Outline of headings beside the page.">
          <Segmented
            label="Navigation pane"
            value={prefs.nav ? "on" : "off"}
            onPick={(v) => (v === "on") !== prefs.nav && prefs.toggleNav()}
            options={[{ value: "off", label: "Hidden" }, { value: "on", label: "Shown" }]}
          />
        </Row>
      </div>
    </div>
  );
}
