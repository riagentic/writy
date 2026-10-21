// Slides are fixed 16:9 boxes; text that does not fit is cut off in the show and the file. Flag such slides while editing.
// The flag is a node decoration: ProseMirror owns the slide's DOM and would undo a class set from outside.
import { state, view as pmView } from "../vendor/pm.js";

const key = new state.PluginKey<number[]>("slidefit");
const WARN = "Too much for one slide — it will be cut off. Shorten it or split it with Insert ▸ Slide.";

export const slideFitPlugin = new state.Plugin<number[]>({
  key,
  state: {
    init: () => [],
    apply: (tr, cur) => (tr.getMeta(key) as number[] | undefined) ?? (tr.docChanged ? cur.map((p) => tr.mapping.map(p)) : cur),
  },
  props: {
    decorations(st) {
      const over = key.getState(st)!;
      if (!over.length) return null;
      const decos = over.flatMap((pos) => {
        const n = st.doc.nodeAt(pos);
        return n?.type.name === "slide" ? [pmView.Decoration.node(pos, pos + n.nodeSize, { class: "jw-overflow", "data-warn": WARN })] : [];
      });
      return pmView.DecorationSet.create(st.doc, decos);
    },
  },
  view: (v) => {
    let timer: ReturnType<typeof setTimeout> | 0 = 0;
    const check = () => {
      timer = 0;
      const over: number[] = [];
      v.state.doc.descendants((n, pos) => {
        if (n.type.name !== "slide") return true;
        const el = v.nodeDOM(pos) as HTMLElement | null;
        if (el && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)) over.push(pos);
        return false;
      });
      if (over.join() !== key.getState(v.state)!.join()) v.dispatch(v.state.tr.setMeta(key, over).setMeta("addToHistory", false));
    };
    // a timer, not requestAnimationFrame: frames pause in hidden windows, and typing bursts collapse into one check
    const soon = () => void (timer ||= setTimeout(check, 120));
    soon();
    return { update: soon, destroy: () => clearTimeout(timer) };
  },
});
