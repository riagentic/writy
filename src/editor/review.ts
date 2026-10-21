// Reviewing pane model: comments + tracked changes as ranges (pure), and per-item actions.
import { state } from "../vendor/pm.js";
import type { model as M, view as V } from "../vendor/pm.js";
import { schema } from "./schema.ts";

export type Note = { kind: "comment" | "ins" | "del"; from: number; to: number; text: string; quote: string; by: string; at: string };

const K = schema.marks;

/** The review-relevant mark of an inline node for one kind, if any. */
function markOf(n: M.Node, kind: Note["kind"]): M.Mark | undefined {
  if (kind === "comment") return n.marks.find((m) => m.type === K.span && m.attrs.a?.comment);
  return n.marks.find((m) => m.type === K[kind] && m.attrs.a?.by !== undefined);
}

/** All comments and tracked changes in document order; adjacent runs of the same mark merge. */
export function notes(d: M.Node): Note[] {
  const out: Note[] = [];
  const open = new Map<Note["kind"], { m: M.Mark; n: Note }>();
  d.descendants((n, pos) => {
    if (!n.isInline) return true;
    for (const kind of ["comment", "ins", "del"] as const) {
      const m = markOf(n, kind);
      const cur = open.get(kind);
      if (cur && m && cur.m.eq(m) && cur.n.to === pos) {
        cur.n.to = pos + n.nodeSize;
        continue;
      }
      if (!m) {
        open.delete(kind);
        continue;
      }
      const a = m.attrs.a as Record<string, string>;
      const note: Note = { kind, from: pos, to: pos + n.nodeSize, text: kind === "comment" ? a.comment : "", quote: "", by: a.by ?? "", at: a.at ?? "" };
      out.push(note);
      open.set(kind, { m, n: note });
    }
    return false;
  });
  for (const n of out) n.quote = d.textBetween(n.from, n.to, " ", "￼");
  return out.sort((a, b) => a.from - b.from);
}

/** The next item after `pos` (dir 1) or the previous one before it (dir -1), wrapping around. */
export function neighbor(list: Note[], pos: number, dir: 1 | -1): Note | undefined {
  if (!list.length) return undefined;
  return dir > 0 ? list.find((n) => n.from > pos) ?? list[0] : [...list].reverse().find((n) => n.from < pos) ?? list.at(-1);
}

export function jump(v: V.EditorView, n: Note): void {
  v.dispatch(v.state.tr.setSelection(state.TextSelection.create(v.state.doc, n.from, n.to)).scrollIntoView());
  v.focus();
}

/** Resolve a comment, or accept/reject one tracked change. */
export function settle(v: V.EditorView, n: Note, accept: boolean): void {
  const tr = v.state.tr;
  const m = (() => {
    let found: M.Mark | undefined;
    v.state.doc.nodesBetween(n.from, n.to, (c) => ((found ??= c.isInline ? markOf(c, n.kind) : undefined), !found));
    return found;
  })();
  if (!m) return;
  const keep = n.kind === "comment" || (n.kind === "ins") === accept;
  if (keep) tr.removeMark(n.from, n.to, m);
  else tr.delete(n.from, n.to);
  v.dispatch(tr);
}
