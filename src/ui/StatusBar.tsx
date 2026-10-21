// Status bar: pages, words, tracking, layout, zoom.
import type { JSX } from "aio";
import { prefs } from "../cell/prefs.ts";
import { doc } from "../editor/session.ts";
import { tracking } from "../editor/track.ts";
import { pages } from "./paper.ts";
import { Icon } from "./icons.tsx";
import { showStats } from "./actions.ts";
import { onCleanup, onMount, useLocal, useRef } from "aio/air";
import { MAX, MIN, setZoom, zoomBy, zoomFit } from "./zoom.ts";
import { settingsOpen } from "./state.ts";
import { count } from "./text.ts";

const THEME = { auto: ["monitor", "System"], light: ["sun", "Light"], dark: ["moon", "Dark"] } as const;
const NEXT = { auto: "Light", light: "Dark", dark: "System" } as const;

const PRESETS = [50, 75, 100, 125, 150, 200];

/** "100%" button → presets, page width, whole page. */
function ZoomMenu(): JSX.Element {
  const [open, setOpen] = useLocal(false);
  const root = useRef<HTMLDivElement | null>(null);
  onMount(() => {
    const away = (e: Event) => !root.current?.contains(e.target as Node) && setOpen(false);
    addEventListener("pointerdown", away, true);
    onCleanup(() => removeEventListener("pointerdown", away, true));
  });
  const pick = (f: () => void) => () => (f(), setOpen(false));
  return (
    <div class="jw-zoom-wrap" ref={root} onKeyDown={(e: KeyboardEvent) => e.key === "Escape" && setOpen(false)}>
      <button
        type="button"
        class="jw-sb-btn jw-zoom"
        aria-label="Zoom level"
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        title="Zoom presets"
        onClick={() => setOpen(!open)}
      >
        {prefs.zoom}%
      </button>
      {open
        ? (
          <div class="jw-menu jw-zoom-menu" role="menu" aria-label="Zoom">
            {PRESETS.map((z) => (
              <button
                key={z}
                type="button"
                role="menuitemradio"
                aria-checked={prefs.zoom === z ? "true" : "false"}
                onClick={pick(() => setZoom(z))}
              >
                {z}%
              </button>
            ))}
            <hr />
            <button type="button" role="menuitem" onClick={pick(() => zoomFit("width"))}>Page width</button>
            <button type="button" role="menuitem" onClick={pick(() => zoomFit("page"))}>Whole page</button>
          </div>
        )
        : null}
    </div>
  );
}

export default function StatusBar(): JSX.Element {
  const p = pages.value;
  return (
    <footer class="jw-status" aria-label="Status bar">
      <span t="pages">Page {p.current} of {p.total}</span>
      <button type="button" class="jw-sb-btn" t="words" title="Word count (click for details)" onClick={showStats}>
        {doc.selWords.value ? `${doc.selWords.value.toLocaleString()} of ${doc.words.value.toLocaleString()} words` : count(doc.words.value, "word")}
      </button>
      {tracking() ? <span class="jw-badge">Track changes on</span> : null}
      {doc.stale.value ? <span class="jw-badge warn" title="The Djot source was edited outside Writy">Source edited externally</span> : null}
      <span class="jw-spacer" />
      <span class="muted">{doc.dirty.value ? "Unsaved changes" : doc.path.value ? "Saved" : ""}</span>
      <button
        type="button"
        class={`jw-sb-btn${prefs.layout === "print" ? " on" : ""}`}
        aria-label="Print layout"
        title="Print layout: see pages while you edit. Only this editor — the document is not changed (Document ▸ In a browser)"
        onClick={() => prefs.setLayout("print")}
      >
        Print
      </button>
      <button
        type="button"
        class={`jw-sb-btn${prefs.layout === "web" ? " on" : ""}`}
        aria-label="Web layout"
        title="Web layout: one flowing page while you edit. Only this editor — the document is not changed (Document ▸ In a browser)"
        onClick={() => prefs.setLayout("web")}
      >
        Web
      </button>
      <button type="button" class={`jw-sb-btn${prefs.showSource ? " on" : ""}`} aria-label="Toggle source view" onClick={() => prefs.toggleSource()}>
        Source
      </button>
      <button type="button" class="jw-sb-btn" aria-label="Zoom out (Ctrl+−)" title="Zoom out (Ctrl+−)" onClick={() => zoomBy(-1)}>−</button>
      <input
        type="range"
        min={String(MIN)}
        max={String(MAX)}
        step="5"
        value={String(prefs.zoom)}
        aria-label="Zoom"
        onInput={(e: Event) => setZoom(+(e.target as HTMLInputElement).value)}
      />
      <button type="button" class="jw-sb-btn" aria-label="Zoom in (Ctrl+=)" title="Zoom in (Ctrl+=)" onClick={() => zoomBy(1)}>+</button>
      <ZoomMenu />
      <button
        type="button"
        class="jw-sb-btn icon"
        aria-label={`App theme: ${THEME[prefs.dark][1]}`}
        title={`App theme: ${THEME[prefs.dark][1]} — click for ${NEXT[prefs.dark]}. The document keeps its own colours.`}
        onClick={() => prefs.cycleTheme()}
      >
        <Icon name={THEME[prefs.dark][0]} size={16} />
      </button>
      <button type="button" class="jw-sb-btn icon" aria-label="Options" title="Options" onClick={() => settingsOpen.set(true)}>
        <Icon name="gear" size={16} />
      </button>
    </footer>
  );
}
