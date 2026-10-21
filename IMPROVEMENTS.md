# Writy improvement plan

Goal: cover what everyday users do in Word / Writer, simple Excel / Calc sheets and simple PowerPoint / Impress decks — polished, not bloated. Source: a
code-level gap audit (112 items) plus hands-on testing. Each batch ships with tests; status: ⬜ todo · 🔧 in progress · ✅ done · 🟡 partly done.

## Batch 1 — broken basics and quick everyday wins

| #  | Item                                                                                                      | Status |
| -- | --------------------------------------------------------------------------------------------------------- | ------ |
| 1  | Checklist boxes can be ticked (click / Ctrl+Enter on the item)                                            | ✅     |
| 2  | Tab in a normal paragraph indents (never leaves the document); indent buttons work on paragraphs          | ✅     |
| 3  | Word alignment keys Ctrl+L / E / R / J; inline code moves to Ctrl+`                                       | ✅     |
| 4  | Sheet: number-format button uses the app's dialog (native `prompt()` does nothing in the desktop app)     | ✅     |
| 5  | Sheet: Ctrl+Z / Ctrl+Y work inside the grid                                                               | ✅     |
| 6  | Sheet: wide sheets scroll sideways instead of being cut off                                               | ✅     |
| 7  | Sheet: Enter on the last row / Tab on the last column adds one (like Excel tables)                        | ✅     |
| 8  | Sheet: F2, Home/End, Ctrl+Home/End, Shift+Enter, Shift+Tab, Esc reverts the formula bar                   | ✅     |
| 9  | Sheet: inserting / deleting rows and columns keeps formulas pointing at the right cells                   | ✅     |
| 10 | Save As adds `.html` (exports add `.docx` / `.odt` / `.md` / `.dj`) when the name has no extension        | ✅     |
| 11 | Export errors are shown, never silent                                                                     | ✅     |
| 12 | Open `.csv` → a document with a sheet                                                                     | ✅     |
| 13 | Charts: negative values draw correctly; editing keeps the type; columns past Z                            | ✅     |
| 14 | Slideshow: clicking a link or video does not advance; start from the current slide (Shift+F5)             | ✅     |
| 15 | Grow / shrink font (Ctrl+] / Ctrl+[ and buttons); line-spacing box shows the current value                | ✅     |
| 16 | Labels: "1 word", "1 occurrence", friendly shape names, picture vs video dialogs, tooltips with shortcuts | ✅     |
| 17 | Header/footer preview uses the same `{title}` as the pages                                                | ✅     |

## Batch 2 — sheets people can actually work in

✅ done: range selection, copy / cut / paste (also TSV / CSV), Delete clears a range, Ctrl+D / Ctrl+R, sort, column width, format gallery, click-to-reference,
error tooltips, Sum / Average / Count, cell bold / italic / alignment / fill / text colour (Ctrl+B / Ctrl+I; a styled column styles new rows; kept in the saved
file), function hints with Tab completion (60 common functions). Formats and styles move with sorted rows. ⬜ left: cell styles in .docx / .odt exports.

Range selection (Shift+arrows / Shift+click / drag) · copy / cut / paste cells (also from Excel / TSV) · Delete clears a range · fill down / right (Ctrl+D /
Ctrl+R) · sort by column · column width (drag) · number-format gallery (number, currency, %, date) · cell bold / colour / alignment · clicking a cell while
typing a formula inserts its reference · function hints · error tooltips.

## Batch 3 — slides

✅ done: fade, B / W blank, number + Enter, hidden cursor, start from the current slide (Shift+F5), right-click back, speaker notes (`::: notes`, Insert ▸
Notes), presenter view (S: notes, next slide, timer, clock). ⬜ left: layouts, slide sorter strip, slide numbers.

Slide layouts (title, title + content, two columns, picture, section) · speaker notes · presenter view (notes, next slide, timer) · slide sorter strip
(thumbnails, drag to reorder, duplicate, delete) · fade transition · slide numbers · B / W blank screen, number + Enter jump, hidden cursor · overflow warning
when text does not fit.

## Batch 4 — writing and review

Spellcheck suggestions in the right-click menu + language · track changes cover paste / Enter / cut / replace / formatting · comment replies, edit, delete,
resolved state · captions for pictures and tables · symbol picker · insert date · list styles (1. a. i. •) and restart numbering · spacing before / after and
first-line indent · Title / Subtitle styles · direct "Export PDF".

## Batch 5 — pages and polish

Table rows split across pages (repeat header row) · different first page header/footer · `{date}` field · page number start · system fonts in the font list ·
change case · chart axis values / data labels · picture rotate / border · shapes rotate and order.

## Batch 6 — gap audit (2026-10-20, 52 findings; 🐞 = confirmed bug)

| #  | Item                                                                                                                                                                                 | Status                                                   |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 1  | 🐞 Tab in the last table cell adds a row (Word)                                                                                                                                      | ✅                                                       |
| 2  | 🐞 Backspace at the start of a list item removes the bullet, keeps the text                                                                                                          | ✅                                                       |
| 3  | 🐞 Sheet right-click: its own menu (cut / copy / paste, insert above / below / left / right, delete, sort, CSV)                                                                      | ✅                                                       |
| 4  | Sheet: arrows save while typing (F2 switches to moving in the text); arrows point at cells in a formula                                                                              | ✅                                                       |
| 5  | Sheet: F4 cycles `$` on the reference at the cursor                                                                                                                                  | ✅                                                       |
| 6  | 🐞 Insert ▸ Slide inside a slide adds the next slide, never a nested one (old nested slides show once)                                                                               | ✅                                                       |
| 7  | Sheet: Save as CSV (values, RFC 4180)                                                                                                                                                | ✅                                                       |
| 8  | Sheet: AutoSum (Σ, Alt+=) and more / fewer decimals                                                                                                                                  | ✅                                                       |
| 9  | Chart from the selected cells (sheet toolbar; Insert ▸ Chart starts from the last selection)                                                                                         | ✅                                                       |
| 10 | Crowded chart labels thinned and shortened (full text on hover); "(1,234)", "12 %", "1,5" read right                                                                                 | ✅                                                       |
| 11 | Typed web addresses become links (punctuation after them stays text)                                                                                                                 | ✅                                                       |
| 12 | 🐞 Arrowheads take their own arrow's colour                                                                                                                                          | ✅                                                       |
| 13 | Copied cells paste as a real table in Word / email                                                                                                                                   | ✅                                                       |
| 14 | Slideshow: mouse wheel, "End of slide show" screen                                                                                                                                   | ✅                                                       |
| 15 | Shortcut list: Ctrl+R, a Sheet section                                                                                                                                               | ✅                                                       |
| 16 | 🐞 Track changes keep underline / strikethrough; 🐞 found on the way: tracked Backspace / Delete really deleted (keymaps ran first)                                                  | ✅                                                       |
| 17 | Open .xlsx / .xls / .ods: every sheet in order, formulas kept and translated (also across sheets); CSV cells may hold line breaks                                                    | ✅                                                       |
| 18 | .docx / .odt import: paragraph indent, first-line indent and line spacing                                                                                                            | ✅                                                       |
| 19 | Home tab Paste / Cut / Copy; show formatting marks ¶ (· ↵ ¶, screen only); Word keys Ctrl+Space, Ctrl+Shift+N / L, Ctrl+1 / 5 / 2                                                    | ✅                                                       |
| 20 | Table tab: borders, banded rows, column widths, vertical alignment                                                                                                                   | ✅                                                       |
| 21 | Sheets: fill series by drag (1, 2, 3 / Jan, Feb), filter, merge / wrap / borders                                                                                                     | 🟡 fill series, wrap, borders done; filter / merge later |
| 22 | Find / replace also covers sheet cells (highlight, Next walks into the sheet, Replace all)                                                                                           | ✅                                                       |
| 23 | Text boxes: type in place, format the text                                                                                                                                           | ✅                                                       |
| 24 | Slides: overflow warning while editing; right-click ▸ Slide background (dark ones switch text to white)                                                                              | ✅                                                       |
| 25 | Chart types: horizontal bar, area, stacked; a Chart tab                                                                                                                              | ✅                                                       |
| 26 | Comment on the word at the caret (no selection needed)                                                                                                                               | ✅                                                       |
| 27 | Sheet engine locale: decimal comma, local time for TODAY()                                                                                                                           | ✅                                                       |
| 28 | Large sheets: render only what changed                                                                                                                                               | ✅ 139→15 ms per move, 151→56 ms per edit (1000 rows)    |
| 29 | Pages on a grey workspace (not black in dark mode), same look + shadow in the saved file; Document ▸ Colours ▸ Around pages (saved in the file)                                      | ✅                                                       |
| 30 | Browser preview (Document ▸ In a browser, Ctrl+F2): the exact saved file in a sandboxed frame, light / dark browser                                                                  | ✅                                                       |
| 31 | Ribbon: Document tab (saved in the file: page, look, colours, header/footer, how a browser opens it, info) vs UI tab (this app only: view, zoom, present, theme, your name, options) | ✅                                                       |

Later / large: TOC page numbers, footnotes at the page bottom, heading numbering, ruler, picture crop, text columns, .pptx / .odp, native Save dialog (needs aio
`pickSave`).

## Not planned (bloat for this app)

Macros, mail merge, sections with mixed orientation, master documents, pivot tables, 3D charts, animations beyond a fade.
