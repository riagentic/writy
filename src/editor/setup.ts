// Plugins, keymaps and Word-style autoformat (smart quotes, "1. " lists, "# " headings …).
import { commands, dropcursor, gapcursor, history, inputrules, keymap, schemaList, state, tables } from "../vendor/pm.js";
import type { model as M, state as S } from "../vendor/pm.js";
import { domAttrs, schema } from "./schema.ts";

const { wrappingInputRule, textblockTypeInputRule, InputRule, smartQuotes, ellipsis, emDash } = inputrules;
const N = schema.nodes;
const Mk = schema.marks;

/** "**bold**" / "*italic*" / "`code`" typed → marks (like Word autoformat). */
function markRule(re: RegExp, mark: typeof Mk.strong) {
  return new InputRule(re, (st, m, start, end) => {
    const tr = st.tr.delete(start, end).insertText(m[1], start);
    return tr.addMark(start, start + m[1].length, mark.create()).removeStoredMark(mark);
  });
}

/** A typed web address becomes a link when the space after it is typed (Word); trailing punctuation stays text. */
const autolink = new InputRule(/(?:^|[\s(])((?:https?:\/\/|www\.)[^\s]*[^\s.,;:!?)\]'"])([.,;:!?)\]'"]*)(\s)$/, (st, m, _start, end) => {
  const from = end - m[2].length - m[1].length, to = from + m[1].length;
  if (st.doc.resolve(from).parent.type.spec.code || st.doc.rangeHasMark(from, to, Mk.link)) return null;
  const href = m[1].startsWith("www.") ? `https://${m[1]}` : m[1];
  return st.tr.addMark(from, to, Mk.link.create({ href })).insertText(m[3], end).removeStoredMark(Mk.link);
});

export function rules() {
  return inputrules.inputRules({
    rules: [
      ...smartQuotes,
      ellipsis,
      emDash,
      new InputRule(/--$/, "–"),
      new InputRule(/\(c\)$/, "©"),
      new InputRule(/->$/, "→"),
      wrappingInputRule(/^\s*>\s$/, N.blockquote),
      wrappingInputRule(/^(\d+)\.\s$/, N.ordered_list, (m) => ({ start: +m[1] }), (m, n) => n.childCount + n.attrs.start === +m[1]),
      wrappingInputRule(/^\s*([-+*])\s$/, N.bullet_list),
      wrappingInputRule(/^\s*\[( |x)\]\s$/, N.bullet_list, () => ({ task: true })),
      textblockTypeInputRule(/^```([\w+#.-]*)\s$/, N.code_block, (m) => ({ lang: m[1] ?? "" })), // ```js + space
      textblockTypeInputRule(/^(#{1,6})\s$/, N.heading, (m) => ({ level: m[1].length })),
      markRule(/\*\*([^*]+)\*\*$/, Mk.strong),
      markRule(/(?:^|[^*])\*([^*\s][^*]*)\*$/, Mk.em),
      markRule(/`([^`]+)`$/, Mk.code),
      autolink,
    ],
  });
}

const { toggleMark, setBlockType, chainCommands, exitCode, joinUp, joinDown, selectParentNode, baseKeymap } = commands;
const { wrapInList, splitListItem, liftListItem, sinkListItem } = schemaList;

export type Cmd = S.Command;

/** Enter in an empty list item ends the list (Word behaviour). */
const exitEmptyItem: Cmd = (st, dispatch) => {
  const { $from, empty } = st.selection;
  if (!empty || $from.parent.content.size || $from.depth < 2 || $from.node(-1).type !== N.list_item) return false;
  return liftListItem(N.list_item)(st, dispatch);
};

/** Enter after "```js" on its own line → a JavaScript code block (like Markdown). */
const fenceOnEnter: Cmd = (st, dispatch) => {
  const { $from, empty } = st.selection;
  const m = /^```([\w+#.-]*)$/.exec($from.parent.textContent);
  if (!empty || !m || $from.parent.type !== N.paragraph || $from.parentOffset !== $from.parent.content.size) return false;
  if (dispatch) {
    const tr = st.tr.delete($from.start(), $from.end());
    dispatch(tr.setBlockType($from.start(), $from.start(), N.code_block, { lang: m[1] }).scrollIntoView());
  }
  return true;
};

const inCode = (st: S.EditorState) => st.selection.$from.parent.type === N.code_block;

/** Enter in code keeps the line's indentation; a third Enter on blank lines at the end leaves the block. */
const codeEnter: Cmd = (st, dispatch) => {
  if (!inCode(st)) return false;
  const { $from } = st.selection;
  const before = $from.parent.textBetween(0, $from.parentOffset);
  const atEnd = $from.parentOffset === $from.parent.content.size;
  const blank = /\n[ \t]*\n[ \t]*$/.exec(before); // two blank (or indent-only) lines
  if (atEnd && st.selection.empty && blank) {
    if (dispatch) {
      const end = $from.end();
      const tr = st.tr.delete(end - blank[0].length, end);
      const after = tr.mapping.map($from.after());
      tr.insert(after, N.paragraph.create());
      dispatch(tr.setSelection(state.TextSelection.create(tr.doc, after + 1)).scrollIntoView());
    }
    return true;
  }
  const indent = /^[ \t]*/.exec(before.slice(before.lastIndexOf("\n") + 1))![0];
  dispatch?.(st.tr.insertText("\n" + indent).scrollIntoView());
  return true;
};

/** Tab / Shift+Tab in code: indent / outdent the selected lines by two spaces. */
const codeIndent = (out: boolean): Cmd => (st, dispatch) => {
  if (!inCode(st)) return false;
  const { $from, $to } = st.selection;
  const start = $from.start(), text = $from.parent.textContent;
  if (!out && st.selection.empty) return (dispatch?.(st.tr.insertText("  ")), true);
  const tr = st.tr;
  let i = text.lastIndexOf("\n", $from.parentOffset - 1) + 1;
  const lines: number[] = [];
  while (i <= $to.parentOffset && i <= text.length) {
    lines.push(i);
    const n = text.indexOf("\n", i);
    if (n < 0) break;
    i = n + 1;
  }
  for (const l of lines.reverse()) {
    if (!out) tr.insertText("  ", start + l);
    else {
      const sp = /^ {1,2}|^\t/.exec(text.slice(l))?.[0].length ?? 0;
      if (sp) tr.delete(start + l, start + l + sp);
    }
  }
  if (tr.docChanged) dispatch?.(tr);
  return true;
};

/** Set (or clear) a Djot attribute on every textblock in the selection. */
export const setBlockAttr = (key: string, value: string): Cmd => (st, dispatch) => {
  const { from, to } = st.selection;
  const tr = st.tr;
  st.doc.nodesBetween(from, to, (n, pos) => {
    if (!n.isTextblock || !("a" in n.attrs)) return true;
    const a: Record<string, string> = { ...n.attrs.a };
    if (value) a[key] = value;
    else delete a[key];
    tr.setNodeMarkup(pos, null, { ...n.attrs, a });
    return false;
  });
  dispatch?.(tr);
  return true;
};

/** Paragraph indent in 12.7 mm (½ inch) steps, like Word; lists use sink/lift instead. */
const STEP = 12.7;
export const paraIndent = (dir: 1 | -1): Cmd => (st, dispatch) => {
  const { from, to, $from } = st.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === N.list_item || $from.node(d).type === N.table_cell || $from.node(d).type === N.table_header) return false;
  }
  const tr = st.tr;
  let any = false;
  st.doc.nodesBetween(from, to, (n, pos) => {
    if (!n.isTextblock || !("a" in n.attrs) || n.type === N.code_block) return true;
    const now = parseFloat(n.attrs.a?.indent ?? "0") || 0;
    const next = Math.max(0, Math.round((now + dir * STEP) * 10) / 10);
    if (next === now) return false;
    const a: Record<string, string> = { ...n.attrs.a };
    if (next) a.indent = `${next}mm`;
    else delete a.indent;
    tr.setNodeMarkup(pos, null, { ...n.attrs, a });
    any = true;
    return false;
  });
  if (!any) return dir < 0 ? false : true; // never let Tab leave the document
  dispatch?.(tr);
  return true;
};

/** Tick / untick the checklist item with the caret. */
export const toggleTask: Cmd = (st, dispatch) => {
  const { $from } = st.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type === N.list_item && n.attrs.checked !== null) {
      dispatch?.(st.tr.setNodeMarkup($from.before(d), null, { ...n.attrs, checked: !n.attrs.checked }));
      return true;
    }
  }
  return false;
};

const hardBreak: Cmd = chainCommands(exitCode, (st, dispatch) => {
  dispatch?.(st.tr.replaceSelectionWith(N.hard_break.create()).scrollIntoView());
  return true;
});

/** A plain (not tracked) instance of `ins` / `del` — underline / strikethrough. */
export const isPlain = (m: M.Mark, type: M.MarkType): boolean => m.type === type && !m.attrs.a?.by;

/** Underline / strikethrough on or off, never touching tracked insertions and deletions of the same mark type. */
export const togglePlain = (type: M.MarkType): Cmd => (st, dispatch) => {
  const { empty, from, to, $from } = st.selection;
  if (empty) {
    const cur = (st.storedMarks ?? $from.marks()).find((m) => isPlain(m, type));
    dispatch?.(cur ? st.tr.removeStoredMark(cur) : st.tr.addStoredMark(type.create()));
    return true;
  }
  let all = true;
  st.doc.nodesBetween(from, to, (n) => void (n.isText && !n.marks.some((m) => isPlain(m, type)) && (all = false)));
  const tr = st.tr;
  if (!all) tr.addMark(from, to, type.create());
  else {
    st.doc.nodesBetween(from, to, (n, pos) => {
      if (n.isText) { for (const m of n.marks.filter((m) => isPlain(m, type))) tr.removeMark(Math.max(pos, from), Math.min(pos + n.nodeSize, to), m); }
    });
  }
  dispatch?.(tr.scrollIntoView());
  return true;
};

/** Tab in a table's last cell adds a row and moves into it (Word). */
const tabNewRow: Cmd = (st, dispatch, view) => {
  if (!tables.isInTable(st) || tables.goToNextCell(1)(st)) return false;
  if (!dispatch || !view) return true;
  tables.addRowAfter(st, dispatch);
  tables.goToNextCell(1)(view.state, view.dispatch);
  return true;
};

/** Backspace at the very start of a list item: the bullet goes, the text stays (Word); a second Backspace joins upward. */
const unbullet: Cmd = (st, dispatch) => {
  const { $from, empty } = st.selection;
  if (!empty || $from.parentOffset > 0 || $from.depth < 2) return false;
  const item = $from.node(-1);
  if (item.type !== N.list_item || $from.index(-1) !== 0) return false;
  return liftListItem(N.list_item)(st, dispatch);
};

export function keys(extra: Record<string, Cmd> = {}) {
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  const k: Record<string, Cmd> = {
    "Mod-z": history.undo,
    "Shift-Mod-z": history.redo,
    "Mod-y": history.redo,
    "Mod-b": toggleMark(Mk.strong),
    "Mod-i": toggleMark(Mk.em),
    "Mod-u": togglePlain(Mk.ins),
    "Mod-`": toggleMark(Mk.code),
    "Mod-l": setBlockAttr("align", ""),
    "Mod-e": setBlockAttr("align", "center"),
    "Mod-r": setBlockAttr("align", "right"), // the desktop window may keep Ctrl+R for itself
    "Mod-j": setBlockAttr("align", "justify"),
    "Mod-Shift-Enter": toggleTask,
    "Shift-Mod-e": () => true, // Ctrl+Shift+E = track changes (global shortcut), never inline code
    "Mod-.": toggleMark(Mk.sup),
    "Mod-,": toggleMark(Mk.sub),
    "Mod-Shift-x": togglePlain(Mk.del),
    "Mod-Shift-h": toggleMark(Mk.mark),
    "Alt-ArrowUp": joinUp,
    "Alt-ArrowDown": joinDown,
    Escape: selectParentNode,
    "Shift-Enter": hardBreak,
    "Mod-Enter": (st, dispatch) => (dispatch?.(st.tr.replaceSelectionWith(N.page_break.create()).scrollIntoView()), true),
    "Mod-Shift-8": wrapInList(N.bullet_list),
    "Mod-Shift-7": wrapInList(N.ordered_list),
    "Mod-Alt-0": setBlockType(N.paragraph),
    Enter: chainCommands(codeEnter, fenceOnEnter, exitEmptyItem, splitListItem(N.list_item)),
    Backspace: unbullet,
    Tab: chainCommands(codeIndent(false), tables.goToNextCell(1), tabNewRow, sinkListItem(N.list_item), paraIndent(1), () => true), // Tab never leaves the page
    "Shift-Tab": chainCommands(codeIndent(true), tables.goToNextCell(-1), liftListItem(N.list_item), paraIndent(-1), () => true),
    ...extra,
  };
  for (let i = 1; i <= 6; i++) k[`Mod-Alt-${i}`] = setBlockType(N.heading, { level: i });
  if (mac) k["Ctrl-Enter"] = hardBreak;
  return [keymap.keymap(k), keymap.keymap(baseKeymap)];
}

/** The resizable table view, plus the table's style class (Table ▸ Style: banded rows, no borders …). */
class StyledTable extends tables.TableView {
  constructor(node: M.Node, cellMinWidth: number) {
    super(node, cellMinWidth);
    this.look(node);
  }
  override update(node: M.Node): boolean {
    if (!super.update(node)) return false;
    this.look(node);
    return true;
  }
  private look(node: M.Node) {
    this.table.className = domAttrs(node.attrs.a).class ?? ""; // the class only: the view owns the table's inline width
  }
}

export function plugins(extra: S.Plugin[] = [], extraKeys: Record<string, Cmd> = {}): S.Plugin[] {
  return [
    ...extra, // first: track changes must see Backspace / Delete before the keymaps delete for real
    rules(),
    ...keys(extraKeys),
    history.history(),
    dropcursor.dropCursor({ color: "#1a5fb4", width: 2 }),
    gapcursor.gapCursor(),
    tables.columnResizing({ View: StyledTable }),
    tables.tableEditing(),
  ];
}

export { state };
