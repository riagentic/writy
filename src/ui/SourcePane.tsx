// Djot source view (CodeMirror), synced both ways with the WYSIWYG editor.
import type { JSX } from "aio";
import { onCleanup, onMount, useRef } from "aio/air";
import { cmCommands, cmLanguage, cmSearch, cmState, cmView, lezerHighlight } from "../vendor/pm.js";
import { applySource, doc, setSourceOpen } from "../editor/session.ts";

const t = lezerHighlight.tags;

/** Line-oriented Djot highlighter (headings, fences, attributes, divs, inline marks). */
const djot = cmLanguage.StreamLanguage.define<{ fence: string | null }>({
  startState: () => ({ fence: null }),
  token(stream, st) {
    if (stream.sol()) {
      if (st.fence) {
        if (stream.match(new RegExp("^" + st.fence + "\\s*$"))) {
          st.fence = null;
          return "keyword";
        }
        stream.skipToEnd();
        return "string";
      }
      const f = stream.match(/^(`{3,})(.*)$/) as RegExpMatchArray | null;
      if (f) {
        st.fence = f[1];
        return "keyword";
      }
      if (stream.match(/^#{1,6}\s.*$/)) return "heading";
      if (stream.match(/^:{3,}.*$/)) return "keyword";
      if (stream.match(/^\{[^}]*\}\s*$/)) return "meta";
      if (stream.match(/^>\s?/)) return "quote";
      if (stream.match(/^\s*([-*+]|\d+[.)])\s(\[[ x]\]\s)?/)) return "list";
      if (stream.match(/^\|/)) return "operator";
      if (stream.match(/^\[\^[^\]]+\]:/)) return "labelName";
    }
    if (stream.match(/^\\./)) return "escape";
    if (stream.match(/^`[^`]+`/)) return "monospace";
    if (stream.match(/^\{[#.=+\-][^}]*\}/)) return "meta";
    if (stream.match(/^!?\[[^\]]*\]\([^)]*\)/)) return "link";
    if (stream.match(/^\[[^\]]*\]\{[^}]*\}/)) return "attributeName";
    if (stream.match(/^\*[^*\s][^*]*\*/)) return "strong";
    if (stream.match(/^_[^_\s][^_]*_/)) return "emphasis";
    if (stream.match(/^\|/)) return "operator";
    stream.next();
    return null;
  },
  tokenTable: { list: t.list, quote: t.quote, escape: t.escape },
});

const style = cmLanguage.HighlightStyle.define([
  { tag: t.heading, fontWeight: "700", color: "var(--ui-accent)" },
  { tag: t.keyword, color: "#8a63d2", fontWeight: "600" },
  { tag: t.meta, color: "#b26b00" },
  { tag: t.string, color: "#2e7d32" },
  { tag: t.monospace, color: "#2e7d32" },
  { tag: t.link, color: "#1a5fb4", textDecoration: "underline" },
  { tag: t.attributeName, color: "#b26b00" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.list, color: "#c94f7c", fontWeight: "600" },
  { tag: t.quote, color: "#59636e" },
  { tag: t.operator, color: "#59636e" },
  { tag: t.escape, color: "#999" },
  { tag: t.labelName, color: "#c94f7c" },
]);

export default function SourcePane(): JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const err = useRef<HTMLDivElement | null>(null);
  let cm: cmView.EditorView | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let echo = false;
  onMount(() => {
    setSourceOpen(true);
    cm = new cmView.EditorView({
      parent: host.current!,
      state: cmState.EditorState.create({
        doc: doc.source.peek(),
        extensions: [
          cmView.lineNumbers(),
          cmView.highlightActiveLine(),
          cmView.EditorView.lineWrapping,
          cmCommands.history(),
          cmView.keymap.of([...cmCommands.defaultKeymap, ...cmCommands.historyKeymap, ...cmSearch.searchKeymap, cmCommands.indentWithTab]),
          djot,
          cmLanguage.syntaxHighlighting(style),
          cmView.EditorView.contentAttributes.of({ "aria-label": "Djot source" }),
          cmView.EditorView.updateListener.of((u) => {
            if (!u.docChanged || echo) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
              const e = applySource(u.state.doc.toString());
              if (err.current) err.current.textContent = e ?? "";
            }, 400);
          }),
        ],
      }),
    });
    const off = doc.source.subscribe(() => {
      if (!cm || cm.hasFocus) return;
      const next = doc.source.peek();
      if (next === cm.state.doc.toString()) return;
      echo = true;
      cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: next } });
      echo = false;
    });
    onCleanup(() => {
      off();
      setSourceOpen(false);
      cm?.destroy();
    });
  });
  return (
    <aside class="jw-source" aria-label="Source view">
      <div class="jw-source-head">
        <b>Djot source</b>
        <span class="muted">— edits here update the document</span>
      </div>
      <div class="jw-source-err" ref={err} role="alert" />
      <div class="jw-source-cm" ref={host} />
    </aside>
  );
}
