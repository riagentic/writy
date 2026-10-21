// Track changes: while on, typing is marked {+ins+}{by=… at=…} and deleting marks {-del-} instead of removing.
import { signal } from "aio/air";
import { state } from "../vendor/pm.js";
import type { view as V } from "../vendor/pm.js";
import { schema } from "./schema.ts";

const K = schema.marks;
const on = signal(false); // a signal, so the ribbon and status bar redraw when it flips
let author = "";

export const tracking = (): boolean => on.value;
export function setTracking(v: boolean, by: string): void {
  author = by;
  on.set(v);
}

const stamp = () => {
  const a: Record<string, string> = { by: author || "author", at: new Date().toLocaleDateString("sv-SE") }; // local yyyy-mm-dd
  return a;
};

function ownInsert(v: V.EditorView, from: number, to: number): boolean {
  let own = true;
  v.state.doc.nodesBetween(from, to, (n) => {
    if (n.isText && !n.marks.some((m) => m.type === K.ins && m.attrs.a?.by)) own = false;
    return true;
  });
  return own;
}

function markDeleted(v: V.EditorView, from: number, to: number, cursor: number) {
  if (from >= to) return;
  const tr = v.state.tr;
  if (ownInsert(v, from, to)) tr.delete(from, to); // deleting your own tracked insert really deletes
  else tr.addMark(from, to, K.del.create({ a: stamp() }));
  tr.setSelection(state.TextSelection.create(tr.doc, tr.mapping.map(cursor)));
  v.dispatch(tr);
}

export const trackPlugin = new state.Plugin({
  props: {
    handleTextInput(v, from, to, text) {
      if (!on.peek()) return false;
      const tr = v.state.tr;
      let at = from;
      if (to > from) {
        tr.addMark(from, to, K.del.create({ a: stamp() }));
        at = to;
      }
      tr.insertText(text, at);
      tr.addMark(at, at + text.length, K.ins.create({ a: stamp() }));
      tr.removeMark(at, at + text.length, K.del);
      tr.setSelection(state.TextSelection.create(tr.doc, at + text.length));
      v.dispatch(tr);
      return true;
    },
    handleKeyDown(v, e) {
      if (!on.peek() || (e.key !== "Backspace" && e.key !== "Delete")) return false;
      const { from, to, empty } = v.state.selection;
      if (!empty) return markDeleted(v, from, to, e.key === "Backspace" ? from : to), true;
      const $p = v.state.selection.$from;
      if (e.key === "Backspace" && $p.parentOffset > 0) return markDeleted(v, from - 1, from, from - 1), true;
      if (e.key === "Delete" && $p.parentOffset < $p.parent.content.size) return markDeleted(v, from, from + 1, from + 1), true;
      return true; // never join blocks while tracking
    },
  },
});
