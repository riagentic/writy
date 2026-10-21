// Find & replace bar (Ctrl+F / Ctrl+H). Inputs are uncontrolled so typing never loses focus.
import type { JSX } from "aio";
import { onCleanup, onMount, useRef } from "aio/air";
import { getView } from "../editor/session.ts";
import { clearFind, findNext, findPrev, findState, type Query, replaceAll, replaceOne, setQuery } from "../editor/find.ts";
import { toast } from "./dialog.ts";
import { count } from "./text.ts";
import { findCount, findMode } from "./state.ts";

const q: Query = { text: "", caseSensitive: false, word: false, regex: false };
let rep = "";

function sync() {
  const v = getView();
  if (!v) return;
  const s = findState(v.state);
  findCount.set({ cur: s.matches.length ? s.cur + 1 : 0, total: s.matches.length });
}

const run = (fn: (v: NonNullable<ReturnType<typeof getView>>) => void) => () => {
  const v = getView();
  if (v) (fn(v), sync());
};

function Count(): JSX.Element {
  const c = findCount.value;
  return <span class="jw-find-count" aria-live="polite">{q.text ? (c.total ? `${c.cur} of ${c.total}` : "No results") : ""}</span>;
}

function close() {
  const v = getView();
  if (v) (clearFind(v), v.focus());
  findMode.set("");
}

export default function FindBar(): JSX.Element {
  const mode = findMode.value;
  const find = useRef<HTMLInputElement | null>(null);
  onMount(() => {
    const v = getView();
    const sel = v && !v.state.selection.empty ? v.state.doc.textBetween(v.state.selection.from, v.state.selection.to) : "";
    if (sel && !sel.includes("\n") && sel.length < 200) q.text = sel;
    if (find.current) (find.current.value = q.text, find.current.select());
    if (v) (setQuery(v, { ...q }), sync());
    const t = setInterval(sync, 400); // keep the count fresh while the user edits the doc
    onCleanup(() => clearInterval(t));
  });
  const update = () => {
    const v = getView();
    if (v) (setQuery(v, { ...q }), sync());
  };
  const opt = (k: "caseSensitive" | "word" | "regex", label: string, text: string) => (
    <label class="jw-find-opt" title={label}>
      <input type="checkbox" aria-label={label} checked={q[k]} onChange={(e: Event) => ((q[k] = (e.target as HTMLInputElement).checked), update())} />
      {text}
    </label>
  );
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") (e.preventDefault(), close());
    else if (e.key === "Enter" && (e.target as HTMLElement).dataset.role === "find") (e.preventDefault(), run(e.shiftKey ? findPrev : findNext)());
    else if (e.key === "Enter") (e.preventDefault(), run((v) => replaceOne(v, rep))());
  };
  return (
    <div class="jw-findbar" role="search" aria-label="Find and replace" onKeyDown={keys}>
      <input
        ref={find}
        data-role="find"
        placeholder="Find"
        aria-label="Find"
        onInput={(e: Event) => ((q.text = (e.target as HTMLInputElement).value), update())}
      />
      <Count />
      <button type="button" aria-label="Previous match" title="Previous (Shift+Enter)" onClick={run(findPrev)}>↑</button>
      <button type="button" aria-label="Next match" title="Next (Enter)" onClick={run(findNext)}>↓</button>
      {opt("caseSensitive", "Match case", "Aa")}
      {opt("word", "Whole words", "W")}
      {opt("regex", "Regular expression", ".*")}
      {mode === "replace"
        ? (
          <>
            <input
              data-role="replace"
              placeholder="Replace with"
              aria-label="Replace with"
              value={rep}
              onInput={(e: Event) => (rep = (e.target as HTMLInputElement).value)}
            />
            <button type="button" aria-label="Replace" onClick={run((v) => replaceOne(v, rep))}>Replace</button>
            <button
              type="button"
              aria-label="Replace all"
              onClick={run((v) => toast(((n) => n ? `Replaced ${count(n, "occurrence")}.` : "Nothing to replace.")(replaceAll(v, rep))))}
            >
              All
            </button>
          </>
        )
        : <button type="button" aria-label="Show replace" title="Replace (Ctrl+H)" onClick={() => findMode.set("replace")}>⇄</button>}
      <button type="button" aria-label="Close find" onClick={close}>✕</button>
    </div>
  );
}
