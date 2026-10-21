// Every keyboard shortcut, in one table: the help dialog (F1 / Ctrl+/) shows it, the e2e audit checks it.
import { info } from "./dialog.ts";

export const SHORTCUTS: [group: string, keys: string, what: string][] = [
  ["File", "Ctrl+N", "New document"],
  ["File", "Ctrl+O", "Open"],
  ["File", "Ctrl+S", "Save"],
  ["File", "Ctrl+Shift+S", "Save as"],
  ["File", "Ctrl+P", "Print / PDF"],
  ["Edit", "Ctrl+Z", "Undo"],
  ["Edit", "Ctrl+Y / Ctrl+Shift+Z", "Redo"],
  ["Edit", "Ctrl+Shift+V", "Paste as plain text"],
  ["Edit", "Ctrl+F", "Find"],
  ["Edit", "Ctrl+H", "Find and replace"],
  ["Format", "Ctrl+B", "Bold"],
  ["Format", "Ctrl+I", "Italic"],
  ["Format", "Ctrl+U", "Underline"],
  ["Format", "Ctrl+Shift+X", "Strikethrough"],
  ["Format", "Ctrl+Shift+H", "Highlight"],
  ["Format", "Ctrl+`", "Inline code"],
  ["Format", "Ctrl+] / Ctrl+[", "Bigger / smaller text"],
  ["Format", "Ctrl+L / Ctrl+E / Ctrl+R / Ctrl+J", "Align left / center / right / justify"],
  ["Format", "Ctrl+. / Ctrl+,", "Superscript / subscript"],
  ["Format", "Ctrl+Alt+1 … 6", "Heading 1 … 6"],
  ["Format", "Ctrl+Alt+0 / Ctrl+Shift+N", "Normal text"],
  ["Format", "Ctrl+Space", "Clear formatting"],
  ["Format", "Ctrl+1 / Ctrl+5 / Ctrl+2", "Line spacing 1 / 1.5 / 2"],
  ["Format", "Ctrl+Shift+8 or Ctrl+Shift+L / Ctrl+Shift+7", "Bullets / numbering"],
  ["Format", "Tab / Shift+Tab", "Indent / outdent (list item, paragraph, code lines; next/previous cell in a table)"],
  ["Format", "Ctrl+Shift+Enter", "Tick / untick a checklist item"],
  ["Insert", "Ctrl+K", "Link"],
  ["Insert", "Ctrl+Enter", "Page break"],
  ["Insert", "Shift+Enter", "Line break"],
  ["Review", "Ctrl+Shift+E", "Track changes on/off"],
  ["Sheet", "Type / F2 / Enter", "Replace / edit / save a cell (arrows also save while typing)"],
  ["Sheet", "Shift+arrows / Ctrl+arrows", "Select a range / jump to the edge of the data"],
  ["Sheet", "Ctrl+D / Ctrl+R", "Fill down / right"],
  ["Sheet", "Alt+=", "AutoSum"],
  ["Sheet", "F4", "Cycle $ on the reference at the cursor (in a formula)"],
  ["Sheet", "Tab (while typing a function)", "Complete the function name"],
  ["Sheet", "Ctrl+B / Ctrl+I", "Bold / italic cells"],
  ["Sheet", "Esc", "Leave the sheet"],
  ["UI", "Ctrl+= / Ctrl+− / Ctrl+0", "Zoom in / out / 100%"],
  ["UI", "Ctrl+mouse wheel", "Zoom"],
  ["UI", "Ctrl+F1", "Collapse / expand the ribbon"],
  ["Document", "Ctrl+F2", "Browser preview: the saved file as a web browser shows it"],
  ["UI", "F5 / Shift+F5", "Present from the start / from the current slide"],
  ["Slideshow", "→ ← / click / right-click", "Next / previous slide"],
  ["Slideshow", "number + Enter", "Go to that slide"],
  ["Slideshow", "B / W", "Black / white screen"],
  ["Slideshow", "S / R", "Presenter view (notes, next slide, timer) / restart the timer"],
  ["UI", "F1 / Ctrl+/", "This list"],
];

export function showShortcuts(): void {
  const rows: ([string, string] | string)[] = [];
  let g = "";
  for (const [group, keys, what] of SHORTCUTS) {
    if (group !== g) rows.push(g = group);
    rows.push([what, keys]);
  }
  info("Keyboard shortcuts", rows);
}
