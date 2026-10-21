// Reviewing pane: every comment and tracked change; click to jump, resolve/accept/reject inline.
import type { JSX } from "aio";
import { doc, getView } from "../editor/session.ts";
import { jump, type Note, notes, settle } from "../editor/review.ts";
import { reviewPane } from "./state.ts";
import { count } from "./text.ts";

const LABEL = { comment: "Comment", ins: "Inserted", del: "Deleted" } as const;
const short = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export default function ReviewPane(): JSX.Element {
  void doc.active.value; // re-render on every transaction
  const v = getView();
  const list = v ? notes(v.state.doc) : [];
  const act = (n: Note, accept: boolean) => (e: MouseEvent) => {
    e.stopPropagation();
    if (v) settle(v, n, accept);
  };
  return (
    <aside class="jw-review" aria-label="Reviewing pane">
      <div class="jw-review-head">
        <strong>Reviewing</strong>
        <span class="muted">{count(list.length, "item")}</span>
        <button type="button" aria-label="Close reviewing pane" onClick={() => reviewPane.set(false)}>✕</button>
      </div>
      {list.length === 0 ? <p class="muted jw-review-empty">No comments or tracked changes.</p> : null}
      <ul>
        {list.map((n) => (
          <li
            key={`${n.kind}${n.from}`}
            class={`jw-note ${n.kind}`}
            role="button"
            tabIndex={0}
            aria-label={`${LABEL[n.kind]}: ${short(n.text || n.quote, 40)}`}
            onClick={() => v && jump(v, n)}
          >
            <div class="jw-note-meta">
              <b>{LABEL[n.kind]}</b>
              {n.by ? <span>{n.by}</span> : null}
              {n.at ? <span class="muted">{n.at}</span> : null}
            </div>
            {n.kind === "comment" ? <div class="jw-note-text">{n.text}</div> : null}
            <div class="jw-note-quote">“{short(n.quote)}”</div>
            <div class="jw-note-act">
              {n.kind === "comment" ? <button type="button" aria-label="Resolve comment" onClick={act(n, true)}>Resolve</button> : (
                <>
                  <button type="button" aria-label="Accept change" onClick={act(n, true)}>Accept</button>
                  <button type="button" aria-label="Reject change" onClick={act(n, false)}>Reject</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
