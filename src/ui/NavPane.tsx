// Navigation pane: the document's headings; click to jump, current section highlighted.
import type { JSX } from "aio";
import { prefs } from "../cell/prefs.ts";
import { doc, getView } from "../editor/session.ts";
import { current, headings, jumpTo } from "../editor/outline.ts";

export default function NavPane(): JSX.Element {
  void doc.active.value; // refresh on every transaction
  const v = getView();
  const hs = v ? headings(v.state.doc) : [];
  const cur = v ? current(hs, v.state.selection.from) : -1;
  const min = Math.min(...hs.map((h) => h.level));
  return (
    <aside class="jw-nav" aria-label="Navigation pane">
      <div class="jw-review-head">
        <strong>Navigation</strong>
        <button type="button" aria-label="Close navigation pane" onClick={() => prefs.toggleNav()}>✕</button>
      </div>
      {hs.length === 0 ? <p class="muted jw-review-empty">Add headings (Heading 1, 2 …) to see the outline here.</p> : null}
      <ol>
        {hs.map((h, i) => (
          <li key={`${h.pos}`}>
            <button
              type="button"
              class={i === cur ? "on" : ""}
              style={{ paddingLeft: `${8 + (h.level - min) * 14}px` }}
              aria-current={i === cur ? "true" : false}
              title={h.text}
              onClick={() => v && jumpTo(v, h)}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
