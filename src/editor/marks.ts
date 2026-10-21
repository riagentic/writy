// Formatting marks (Word's ¶ button): · for spaces, → for tabs, ↵ for line breaks, ¶ at the end of each paragraph. Editor only;
// decorations are built only while the marks are shown.
import { state, view as pmView } from "../vendor/pm.js";
import type { model as M } from "../vendor/pm.js";

const key = new state.PluginKey<pmView.DecorationSet | null>("marks");

const widget = (ch: string, cls: string) => () => Object.assign(document.createElement("span"), { className: `jw-fm ${cls}`, textContent: ch });

function build(doc: M.Node): pmView.DecorationSet {
  const out: pmView.Decoration[] = [];
  doc.descendants((n, pos) => {
    if (n.type.spec.code) return false; // code keeps its own whitespace look
    if (n.isText) {
      for (const m of n.text!.matchAll(/[ \t ]/g)) {
        const at = pos + m.index!;
        out.push(pmView.Decoration.inline(at, at + 1, { class: m[0] === "\t" ? "jw-fm-tab" : "jw-fm-sp" }));
      }
    } else if (n.type.name === "hard_break") out.push(pmView.Decoration.widget(pos, widget("↵", "br"), { side: -1 }));
    else if (n.isTextblock) out.push(pmView.Decoration.widget(pos + n.nodeSize - 1, widget("¶", "para"), { side: 1, ignoreSelection: true }));
    return true;
  });
  return pmView.DecorationSet.create(doc, out);
}

export const marksPlugin = new state.Plugin<pmView.DecorationSet | null>({
  key,
  state: {
    init: () => null,
    apply(tr, cur, _old, st) {
      const on = tr.getMeta(key);
      if (on !== undefined) return on ? build(st.doc) : null;
      return cur && tr.docChanged ? build(st.doc) : cur;
    },
  },
  props: { decorations: (st) => key.getState(st) ?? null },
});

/** Show or hide the formatting marks. */
export const setFormattingMarks = (v: pmView.EditorView, on: boolean): void => v.dispatch(v.state.tr.setMeta(key, on));
export const formattingMarks = (st: state.EditorState): boolean => !!key.getState(st);
