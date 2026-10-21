// Code-block syntax colours: the core's highlighter (the same one the saved file uses) as inline decorations.
import { state, view as pmView } from "../vendor/pm.js";
import type { model as M } from "../vendor/pm.js";
import { highlight } from "../core/index.ts";

const key = new state.PluginKey<pmView.DecorationSet>("highlight");
/** lang + text → spans; a block that did not change costs a map lookup. */
const cache = new Map<string, [number, number, string][]>();

function spans(lang: string, text: string) {
  const k = `${lang}\u0000${text}`;
  let s = cache.get(k);
  if (!s) {
    if (cache.size > 400) cache.clear();
    cache.set(k, s = highlight(lang, text));
  }
  return s;
}

function build(doc: M.Node): pmView.DecorationSet {
  const out: pmView.Decoration[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name === "code_block") {
      if (n.attrs.lang) {
        for (const [a, b, c] of spans(n.attrs.lang, n.textContent)) out.push(pmView.Decoration.inline(pos + 1 + a, pos + 1 + b, { class: `hl-${c}` }));
      }
      return false;
    }
    return !n.isTextblock;
  });
  return pmView.DecorationSet.create(doc, out);
}

export const highlightPlugin = new state.Plugin<pmView.DecorationSet>({
  key,
  state: {
    init: (_, st) => build(st.doc),
    apply: (tr, set) => (tr.docChanged ? build(tr.doc) : set),
  },
  props: {
    decorations: (st) => {
      const set = key.getState(st)!;
      const $f = st.selection.$from; // the block being edited shows its language picker
      if ($f.parent.type.name !== "code_block") return set;
      return set.add(st.doc, [pmView.Decoration.node($f.before(), $f.after(), { class: "jw-code-on" })]);
    },
  },
});
