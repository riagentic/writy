// Right-click menu for the document: clipboard, link, comment + table/picture actions.
import type { JSX } from "aio";
import { onCleanup, onMount, signal, useRef } from "aio/air";
import * as C from "../editor/commands.ts";
import { doc, getView } from "../editor/session.ts";
import { addComment, cutCopy, editLink, paste, removeLink, slideBackground } from "./actions.ts";
import { menuFor, type MenuItem as Item } from "./menu.ts";

const menu = signal<{ x: number; y: number; items: Item[] } | null>(null);

function itemsFor(): Item[] {
  const v = getView();
  if (!v) return [];
  const empty = v.state.selection.empty;
  const a = doc.active.peek();
  const t = (c: Parameters<typeof C.tableCmd>[1]) => () => C.tableCmd(v, c);
  const out: Item[] = [
    { label: "Cut", keys: "Ctrl+X", run: () => cutCopy("cut"), off: empty },
    { label: "Copy", keys: "Ctrl+C", run: () => cutCopy("copy"), off: empty },
    { label: "Paste", keys: "Ctrl+V", run: () => paste() },
    { label: "Paste as plain text", keys: "Ctrl+Shift+V", run: () => paste(true) },
    "-",
    { label: C.linkRange(v) ? "Edit link…" : "Link…", keys: "Ctrl+K", run: editLink },
  ];
  if (C.linkRange(v)) out.push({ label: "Remove link", run: removeLink });
  out.push({ label: "New comment…", run: addComment });
  if (a.table) {
    out.push(
      "-",
      { label: "Insert row above", run: t("addRowBefore") },
      { label: "Insert row below", run: t("addRowAfter") },
      { label: "Insert column left", run: t("addColumnBefore") },
      { label: "Insert column right", run: t("addColumnAfter") },
      { label: "Merge cells", run: t("mergeCells") },
      { label: "Split cell", run: t("splitCell") },
      { label: "Delete row", run: t("deleteRow") },
      { label: "Delete column", run: t("deleteColumn") },
      { label: "Delete table", run: t("deleteTable") },
    );
  }
  if (C.slideAt(v)) out.push("-", { label: "Slide background…", run: slideBackground });
  if (a.node === "image" || a.node === "shape") {
    out.push("-", {
      label: a.node === "image" ? "Delete picture" : "Delete shape",
      run: () => C.deleteSelected(v),
    });
  }
  return out;
}

/** Listens for right-clicks on the page; renders the open menu. */
export default function ContextMenu(): JSX.Element {
  const box = useRef<HTMLDivElement | null>(null);
  onMount(() => {
    const open = (e: MouseEvent) => {
      const v = getView();
      if (!v || !v.dom.contains(e.target as Node)) return;
      e.preventDefault();
      const own = menuFor(e); // a sheet brings its own menu
      if (own) return menu.set({ x: e.clientX, y: e.clientY, items: own });
      // right-click outside the selection moves the caret there (Word behaviour)
      const pos = v.posAtCoords({ left: e.clientX, top: e.clientY })?.pos;
      const { from, to } = v.state.selection;
      if (pos !== undefined && (pos < from || pos > to)) v.dispatch(v.state.tr.setSelection(C.state.TextSelection.near(v.state.doc.resolve(pos))));
      menu.set({ x: e.clientX, y: e.clientY, items: itemsFor() });
    };
    const shut = (e: Event) => !box.current?.contains(e.target as Node) && menu.set(null);
    addEventListener("contextmenu", open);
    addEventListener("mousedown", shut, true);
    addEventListener("blur", () => menu.set(null));
    onCleanup(() => (removeEventListener("contextmenu", open), removeEventListener("mousedown", shut, true)));
  });
  const m = menu.value;
  if (!m) return <div ref={box} />;
  const run = (i: Exclude<Item, "-">) => () => (menu.set(null), i.run());
  const keys = (e: KeyboardEvent) => {
    const btns = [...(box.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") (menu.set(null), getView()?.focus());
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      btns[(i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length]?.focus();
    }
  };
  // keep the menu on screen
  const x = Math.min(m.x, innerWidth - 240), y = Math.min(m.y, innerHeight - m.items.length * 30 - 16);
  queueMicrotask(() => box.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
  return (
    <div ref={box} class="jw-menu" role="menu" aria-label="Context menu" style={{ left: `${x}px`, top: `${Math.max(4, y)}px` }} onKeyDown={keys}>
      {m.items.map((i, k) =>
        i === "-"
          ? <div key={`s${k}`} class="jw-menu-sep" role="separator" />
          : (
            <button key={i.label} type="button" role="menuitem" disabled={i.off} onClick={run(i)}>
              <span>{i.label}</span>
              {i.keys ? <kbd>{i.keys}</kbd> : null}
            </button>
          )
      )}
    </div>
  );
}
