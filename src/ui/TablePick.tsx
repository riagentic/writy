// Insert-table grid (Word style): hover or arrow keys pick rows × columns, click/Enter inserts; "Custom size…" for bigger.
import type { JSX } from "aio";
import { onCleanup, onMount, useLocal, useRef } from "aio/air";
import { Icon } from "./icons.tsx";
import { below } from "./popover.ts";

const ROWS = 8, COLS = 10;

export default function TablePick(p: { onPick: (rows: number, cols: number) => void; onCustom: () => void }): JSX.Element {
  const [open, setOpen] = useLocal(false);
  const [at, setAt] = useLocal({ r: 1, c: 1 });
  const root = useRef<HTMLDivElement | null>(null);
  onMount(() => {
    const away = (e: Event) => !root.current?.contains(e.target as Node) && setOpen(false);
    addEventListener("pointerdown", away, true);
    onCleanup(() => removeEventListener("pointerdown", away, true));
  });
  const pick = (r: number, c: number) => (setOpen(false), p.onPick(r, c));
  const key = (e: KeyboardEvent) => {
    const d: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] };
    if (d[e.key]) {
      e.preventDefault();
      setAt({ r: Math.min(ROWS, Math.max(1, at.r + d[e.key][0])), c: Math.min(COLS, Math.max(1, at.c + d[e.key][1])) });
    } else if (e.key === "Enter") (e.preventDefault(), pick(at.r, at.c));
    else if (e.key === "Escape") (e.stopPropagation(), setOpen(false));
  };
  return (
    <div class="jw-split" ref={root}>
      <button
        type="button"
        class="jw-btn big"
        aria-label="Table"
        title="Insert a table"
        aria-haspopup="true"
        aria-expanded={open ? "true" : "false"}
        onMouseDown={(e: MouseEvent) => e.preventDefault()}
        onClick={() => {
          setAt({ r: 1, c: 1 });
          setOpen(!open);
          requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(".jw-tgrid")?.focus());
        }}
      >
        <Icon name="table" size={26} />
        <span class="jw-btn-label">Table</span>
      </button>
      {open
        ? (
          <div class="jw-palette jw-tpick" role="dialog" aria-label="Insert table" style={below(root.current, 200)}>
            <div class="jw-pal-title" aria-live="polite">{at.r} × {at.c} table</div>
            <div
              class="jw-tgrid"
              role="grid"
              tabIndex={0}
              aria-label="Rows and columns"
              onKeyDown={key}
              style={{ gridTemplateColumns: `repeat(${COLS}, 16px)` }}
            >
              {Array.from({ length: ROWS * COLS }, (_, i) => {
                const r = Math.floor(i / COLS) + 1, c = (i % COLS) + 1;
                return (
                  <span
                    key={i}
                    class={r <= at.r && c <= at.c ? "on" : ""}
                    data-r={String(r)}
                    data-c={String(c)}
                    onMouseEnter={() => setAt({ r, c })}
                    onMouseDown={(e: MouseEvent) => e.preventDefault()}
                    onClick={() => pick(r, c)}
                  />
                );
              })}
            </div>
            <button type="button" class="jw-pal-none" onClick={() => (setOpen(false), p.onCustom())}>Custom size…</button>
          </div>
        )
        : null}
    </div>
  );
}
