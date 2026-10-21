// Split colour button (Word style): the main half re-applies the last colour, the arrow opens a swatch palette.
// Kinds "page" / "ink" / "desk" are DOCUMENT settings (=meta page-color / text-color / desk-color): the main half shows the current one
// and opens the palette. "desk" is the workspace around the pages, in the editor and in the saved file's pages view.
import type { JSX } from "aio";
import { onCleanup, onMount, signal, useLocal, useRef } from "aio/air";
import { Icon } from "./icons.tsx";
import { below } from "./popover.ts";
import { prefs } from "../cell/prefs.ts";
import * as C from "../editor/commands.ts";
import { doc, getView, metaGet, metaSet } from "../editor/session.ts";

type Kind = "color" | "bg" | "cell" | "page" | "ink" | "desk";
type Swatch = readonly [hex: string, name: string];

const TEXT: readonly Swatch[] = [
  ["#000000", "Black"],
  ["#595959", "Dark grey"],
  ["#a6a6a6", "Grey"],
  ["#c00000", "Dark red"],
  ["#ff0000", "Red"],
  ["#ed7d31", "Orange"],
  ["#bf8f00", "Gold"],
  ["#00b050", "Green"],
  ["#0070c0", "Blue"],
  ["#7030a0", "Purple"],
  ["#1f3864", "Navy"],
  ["#2e75b6", "Steel blue"],
  ["#00b0f0", "Light blue"],
  ["#548235", "Olive"],
  ["#843c0c", "Brown"],
  ["#c55a11", "Rust"],
  ["#d6336c", "Pink"],
  ["#5f497a", "Plum"],
  ["#0d7377", "Teal"],
  ["#404040", "Charcoal"],
];
const HIGHLIGHT: readonly Swatch[] = [
  ["#ffff00", "Yellow"],
  ["#00ff00", "Bright green"],
  ["#00ffff", "Turquoise"],
  ["#ff66ff", "Pink"],
  ["#ffc000", "Amber"],
  ["#ff0000", "Red"],
  ["#4472c4", "Blue"],
  ["#a6a6a6", "Grey"],
  ["#fff2cc", "Pale yellow"],
  ["#e2efda", "Pale green"],
  ["#ddebf7", "Pale blue"],
  ["#fce4ec", "Pale pink"],
  ["#ede7f6", "Pale lavender"],
  ["#fbe5d6", "Pale peach"],
  ["#e7e6e6", "Pale grey"],
];
const PAGE: readonly Swatch[] = [
  ["#fffdf5", "Cream"],
  ["#fbf8ef", "Ivory"],
  ["#f5f5f0", "Paper grey"],
  ["#fff8e1", "Pale yellow"],
  ["#eef6ee", "Pale green"],
  ["#eef4fb", "Pale blue"],
  ["#fdf0f4", "Pale pink"],
  ["#f3effa", "Pale lavender"],
  ["#1e1e1e", "Charcoal"],
  ["#10243e", "Midnight"],
];
const DESK: readonly Swatch[] = [
  ["#ffffff", "White"],
  ["#e6e6e6", "Light grey"],
  ["#a0a0a0", "Grey"],
  ["#3a3a3a", "Dark grey"],
  ["#000000", "Black"],
  ["#dfe6ee", "Blue grey"],
  ["#e8e2d6", "Warm grey"],
  ["#2b3440", "Slate"],
];
const META = { page: "page-color", ink: "text-color", desk: "desk-color" } as const;
const isDoc = (k: Kind): k is "page" | "ink" | "desk" => k in META;

const SPEC = {
  color: { icon: "color", label: "Font colour", none: "Automatic", swatches: TEXT, first: "#c00000" },
  bg: { icon: "highlight", label: "Highlight", none: "No highlight", swatches: HIGHLIGHT, first: "#ffff00" },
  cell: { icon: "palette", label: "Shading", none: "No colour", swatches: [...HIGHLIGHT.slice(8), ...TEXT.slice(0, 10)], first: "#ddebf7" },
  page: { icon: "palette", label: "Page colour", none: "White (default)", swatches: PAGE, first: "#ffffff" },
  ink: { icon: "color", label: "Text colour", none: "Automatic (default)", swatches: TEXT, first: "#1f2328" },
  desk: { icon: "palette", label: "Around pages", none: "Automatic grey (default)", swatches: DESK, first: "" },
} as const;

/** Last colour per kind (what the main half applies), shared by every picker of that kind. */
const last = { color: signal<string>(SPEC.color.first), bg: signal<string>(SPEC.bg.first), cell: signal<string>(SPEC.cell.first) };
/** Current document colour of a doc kind (default when unset). */
const docHex = (k: "page" | "ink" | "desk") => (doc.meta.value, metaGet()[META[k]] || SPEC[k].first);

const keep = (e: MouseEvent) => e.preventDefault(); // keep the caret in the document

function apply(kind: Kind, hex: string) {
  if (isDoc(kind)) {
    metaSet({ [META[kind]]: hex });
    if (hex) prefs.useColor(hex);
    return;
  }
  const v = getView();
  if (!v) return;
  if (!hex && kind === "bg" && v.state.schema.marks.mark) {
    const { from, to } = v.state.selection;
    v.dispatch(v.state.tr.removeMark(from, to, v.state.schema.marks.mark)); // Djot {=highlight=} counts too
  }
  if (kind === "cell") C.cellAttr(v, "bg", hex);
  else C.spanAttr(v, kind, hex);
  if (!hex) return;
  last[kind].set(hex);
  prefs.useColor(hex);
}

export default function ColorPick(p: { kind: Kind }): JSX.Element {
  const s = SPEC[p.kind];
  const [open, setOpen] = useLocal(false);
  const root = useRef<HTMLDivElement | null>(null);
  const k = p.kind;
  const hex = isDoc(k) ? docHex(k) : last[k].value;
  onMount(() => {
    const away = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener("pointerdown", away, true);
    onCleanup(() => removeEventListener("pointerdown", away, true));
  });
  const pick = (h: string) => (setOpen(false), apply(p.kind, h));
  const close = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    setOpen(false);
    (root.current?.querySelector(".jw-split-arrow") as HTMLElement | null)?.focus();
  };
  const sw = ([h, name]: Swatch) => (
    <button
      key={h}
      type="button"
      class="jw-swatch"
      style={{ background: h }}
      title={`${name} ${h}`}
      aria-label={name}
      onMouseDown={keep}
      onClick={() => pick(h)}
    />
  );
  const recent = prefs.colors.filter((c) => !s.swatches.some(([h]) => h === c)).slice(0, 10);
  return (
    <div class="jw-split" ref={root} onKeyDown={close}>
      <button
        type="button"
        class={`jw-btn jw-split-main${isDoc(k) ? " wide" : ""}`}
        title={k === "desk"
          ? `Colour around the pages (${
            hex || s.none
          }): in this editor and when the saved file opens as pages in a browser. Automatic = light or dark grey, following the app or browser theme.`
          : isDoc(k)
          ? `${s.label} of this document (${hex}). Saved in the document; the app theme never changes it.`
          : `${s.label} (${hex})`}
        aria-label={isDoc(k) ? `${s.label}: ${hex || s.none}` : `${s.label}: apply ${hex}`}
        onMouseDown={keep}
        onClick={() => (isDoc(k) ? setOpen(!open) : apply(k, hex))}
      >
        <Icon name={s.icon} size={18} />
        <span class="jw-split-bar" style={{ background: hex || "var(--ui-canvas)" }} />
        {isDoc(k) ? <span class="jw-split-cap">{s.label}</span> : null}
      </button>
      <button
        type="button"
        class="jw-btn jw-split-arrow"
        title={`${s.label} options`}
        aria-label={`${s.label} options`}
        aria-haspopup="true"
        aria-expanded={open ? "true" : "false"}
        onMouseDown={keep}
        onClick={() => setOpen(!open)}
      >
        <Icon name="down" size={12} />
      </button>
      {open
        ? (
          <div class="jw-palette" role="dialog" aria-label={s.label} style={below(root.current, 232)}>
            <button type="button" class="jw-pal-none" onMouseDown={keep} onClick={() => pick("")}>
              <span class="jw-swatch none" aria-hidden="true" />
              {s.none}
            </button>
            <div class="jw-pal-grid" role="group" aria-label="Colours">{s.swatches.map(sw)}</div>
            {recent.length
              ? (
                <>
                  <div class="jw-pal-title">Recent</div>
                  <div class="jw-pal-grid" role="group" aria-label="Recent colours">{recent.map((h) => sw([h, h]))}</div>
                </>
              )
              : null}
            <label class="jw-pal-more">
              <Icon name="color" size={14} />
              More colours…
              <input
                type="color"
                aria-label={`${s.label}: custom colour`}
                value={hex || "#e6e6e6"}
                onChange={(e: Event) => pick((e.target as HTMLInputElement).value)}
              />
            </label>
          </div>
        )
        : null}
    </div>
  );
}
