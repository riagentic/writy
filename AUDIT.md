# Writy feature audit

Each feature is checked in the real app (headless browser against `am start --client=server-only`) and then gets an automated test.

Status: ⬜ not audited · 🔧 broken/incomplete, being fixed · ✅ works, tested (test file in brackets)

Run: `am start --client=server-only`, then `JW_URL=<url> deno test -A tests/e2e/` (app.test + audit.test, 99 steps).

## 1. Pages & layout

| #    | Feature                                                                        | Status | Notes                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | Real pages in print layout (sheets, gaps, content moves to next page)          | ✅     | was one long sheet → paginator; headings keep with next (audit.test 1.1, paginate.test)                                                                                                                                                 |
| 1.2  | Header / footer on every page, `{page}` `{pages}` `{title}`, left/centre/right | ✅     | new dialog (presets, fields, preview), double-click margin (audit.test 1.2)                                                                                                                                                             |
| 1.3  | Page break (Ctrl+Enter) starts a new page                                      | ✅     | fixed: a break near the page bottom left an empty page (audit.test 1.3, 1.11)                                                                                                                                                           |
| 1.4  | Paper size A3/A4/A5/Letter/Legal, orientation                                  | ✅     | (audit.test 1.4)                                                                                                                                                                                                                        |
| 1.5  | Margins                                                                        | ✅     | (audit.test 1.5)                                                                                                                                                                                                                        |
| 1.6  | Web layout (editor view only)                                                  | ✅     | editor view only, never changes the file (audit.test 1.6, 1.11)                                                                                                                                                                         |
| 1.7  | Zoom (ribbon, status bar, slider, Ctrl+wheel)                                  | ✅     | added Ctrl+=/−/0, Ctrl+wheel, presets, page width/whole page; fixed lost fast steps (zoom.test, audit.test 1.7)                                                                                                                         |
| 1.8  | Page counter in status bar                                                     | ✅     | (audit.test 1.8)                                                                                                                                                                                                                        |
| 1.9  | Themes, body/headings font                                                     | ✅     | designs made distinct; font prompts → dropdowns + base size; renamed to "Document design" (audit.test 1.9)                                                                                                                              |
| 1.10 | Print / PDF matches the editor's pages                                         | ✅     | fixed: Ctrl+P in the desktop app printed the whole window (aio grabs it); now prints only the document (audit.test 1.10)                                                                                                                |
| 1.11 | Saved file opens in a browser as pages or web page                             | ✅     | new: Document ▸ In a browser (Pages / Web page, Browser preview), separate from the editor view; view-only pager in the file, same pages and header/footer as the editor; print still uses real pages (audit.test 1.11, core file test) |
| 1.12 | Page colour and text colour (document settings)                                | ✅     | new: Document ▸ Colours (page, text, around pages); saved in the file, independent of the app theme (audit.test 5.10, core)                                                                                                             |

## 2. Text formatting (Home)

| #    | Feature                                                     | Status | Notes                                                              |
| ---- | ----------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| 2.1  | Undo / redo (+ disabled state)                              | ✅     | added disabled states (audit.test 2.1)                             |
| 2.2  | Format painter (once, sticky, Esc)                          | ✅     | new; fixed: clicking the brush painted the source (audit.test 2.2) |
| 2.3  | Font, size (selects show current value)                     | ✅     | fixed: box showed text _before_ the selection (audit.test 2.3)     |
| 2.4  | Bold, italic, underline, strike, sup, sub, code + shortcuts | ✅     | (audit.test 2.4)                                                   |
| 2.5  | Font colour palette, recent, custom, automatic              | ✅     | new palette (audit.test 2.5)                                       |
| 2.6  | Highlight palette, no highlight                             | ✅     | new palette (audit.test 2.6)                                       |
| 2.7  | Clear formatting keeps links & comments                     | ✅     | fixed: used to delete comments (audit.test 2.7)                    |
| 2.8  | Bullets, numbering, checklist, indent/outdent               | ✅     | (audit.test 2.8)                                                   |
| 2.9  | Align left/centre/right/justify                             | ✅     | (audit.test 2.9)                                                   |
| 2.10 | Styles: Normal, H1–H4, quote, code                          | ✅     | (audit.test 2.10)                                                  |
| 2.11 | Autoformat (`#`, `1.`, `**x**`, smart quotes)               | ✅     | (app.test typing step)                                             |

## 3. Insert

| #    | Feature                                                                                | Status | Notes                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| 3.1  | Table (insert, rows/cols, merge/split, header row, delete, resize)                     | ✅     | new grid picker + cell shading; captioned Table tab (audit.test 3.1)                                                   |
| 3.2  | Picture (insert, drag/paste, resize, wrap, alt text, reset, delete)                    | ✅     | fixed: picture lost selection after resize; width capped to the text column, keeps aspect ratio (audit.test 3.2)       |
| 3.3  | Video / audio                                                                          | ✅     | (audit.test 3.3)                                                                                                       |
| 3.4  | Shapes (insert, drag, resize, fill, outline, text, delete)                             | ✅     | friendly names (Rectangle, Oval …) (audit.test 3.4)                                                                    |
| 3.5  | Text box                                                                               | ✅     | own icon (audit.test 3.5)                                                                                              |
| 3.6  | Spreadsheet (formulas, cross-sheet, formats)                                           | ✅     | (audit.test 3.6)                                                                                                       |
| 3.7  | Chart                                                                                  | ✅     | (audit.test 3.7)                                                                                                       |
| 3.8  | Cell value (live calc in text)                                                         | ✅     | (audit.test 3.8)                                                                                                       |
| 3.9  | Link (Ctrl+K, edit, remove)                                                            | ✅     | (audit.test 3.9)                                                                                                       |
| 3.10 | Equation                                                                               | ✅     | (audit.test 3.10)                                                                                                      |
| 3.11 | Footnote                                                                               | ✅     | fixed: numbers out of reading order; added hover text + click to jump (audit.test 3.11)                                |
| 3.12 | Table of contents                                                                      | ✅     | entries now clickable; live update (audit.test 3.12)                                                                   |
| 3.13 | Horizontal line, page break, slide, quote, code block, raw HTML                        | ✅     | Insert ▸ Text/Pages buttons now captioned (audit.test 3.13)                                                            |
| 3.14 | Sheet cells: wrap text, borders, fill series, large sheets                             | ✅     | (audit.test 3.16b, 3.18); 1000 rows: 15 ms per move, 56 ms per edit                                                    |
| 3.15 | Shapes: 8 resize handles, line / arrow ends drag anywhere (Shift 45°), arrow keys move | ✅     | fixed: one corner grip only, arrows always pointed right (audit.test 3.4b, shapegeo.test, file.rs line_and_arrow_ends) |

## 4. Review

| #   | Feature                                       | Status | Notes                                                                                                                       |
| --- | --------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | Comments (new, resolve, pane, jump)           | ✅     | new Previous/Next; dialogs return focus, trap Tab (audit.test 4.1)                                                          |
| 4.2 | Track changes (on/off, accept/reject one/all) | ✅     | Ctrl+Shift+E; fixed: status badge never updated (audit.test 4.2)                                                            |
| 4.3 | Find / replace (case, word, regex, counter)   | ✅     | fixed: Replace needed two clicks (audit.test 4.3, find.test)                                                                |
| 4.4 | Word count dialog, status bar count           | ✅     | real dialog (pages, words, chars ±spaces, paragraphs, selection); "N of M words" in status bar (audit.test 4.4, stats.test) |
| 4.5 | Author name                                   | ✅     | own icon (audit.test 4.5)                                                                                                   |

## 5. View & app

| #    | Feature                                                                  | Status | Notes                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1  | Light / dark / system theme, status-bar toggle                           | ✅     | fixed: dark theme turned the document dark; now only the app follows the theme (audit.test 5.1)                                                                                                 |
| 5.2  | Options dialog                                                           | ✅     | app-only settings, labelled; document settings live in Layout (audit.test 5.2)                                                                                                                  |
| 5.3  | Navigation pane                                                          | ✅     | (audit.test 5.3)                                                                                                                                                                                |
| 5.4  | Source view (two-way sync)                                               | ✅     | (audit.test 5.4)                                                                                                                                                                                |
| 5.5  | Reviewing pane                                                           | ✅     | own icon (app.test reviewing pane)                                                                                                                                                              |
| 5.6  | Slideshow (F5 / Shift+F5, keys, blank, jump, exit)                       | ✅     | added: Shift+F5 from the caret, number + Enter, B / W blank, right-click back, idle cursor hide, fade, empty state; fixed: a click on a link or video advanced the slide (audit.test 5.6, 5.6b) |
| 5.7  | Ribbon collapse / peek, contextual tabs                                  | ✅     | fixed: Ctrl+F1 also fired F1 (audit.test 5.7)                                                                                                                                                   |
| 5.8  | Right-click menu                                                         | ✅     | (audit.test 5.8)                                                                                                                                                                                |
| 5.9  | Keyboard shortcuts (all listed in tooltips)                              | ✅     | new list (F1 / Ctrl+/, UI ▸ Shortcuts); fixed: Ctrl+Shift+H also opened Replace (audit.test 5.9)                                                                                                |
| 5.10 | Ribbon split: Document tab (saved in the file) vs UI tab (this app only) | ✅     | tab tooltips say which; (audit.test 5.3b, 5.3c, 4.5)                                                                                                                                            |
| 5.11 | Colour around the pages: editor + saved file, light / dark               | ✅     | Document ▸ Colours ▸ Around pages, `desk-color` (audit.test 5.3b, file.rs document_colours)                                                                                                     |
| 5.12 | Browser preview (Ctrl+F2): the exact saved file, light / dark browser    | ✅     | (audit.test 5.3c)                                                                                                                                                                               |
| 5.13 | Rename OneType → Writy: settings, recent files and drafts carried over   | ✅     | copies, never moves (carry.test; checked on a real instance)                                                                                                                                    |

## 6. Files

| #   | Feature                                               | Status | Notes                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 | New (blank, templates)                                | ✅     | File menu takes focus, arrow keys, Esc (audit.test 6.1)                                                                                                                                                                                                                         |
| 6.2 | Open .html .dj .md .txt .docx .odt .pdf .doc/.rtf     | ✅     | fixed: Open/Save-in-folder dialog gave up after 30 s and lost the pick (now a cell method); added: .csv / .tsv open as a sheet, .xlsx / .xls / .ods as one sheet per workbook sheet with formulas (audit.test 5.6c, 5.6f) (app.test import steps: html, dj, md, docx, odt, pdf) |
| 6.3 | Save, Save as (overwrite prompt), title shows dirty   | ✅     | window title now shows • when unsaved (audit.test 6.3, app.test save)                                                                                                                                                                                                           |
| 6.4 | Export .dj .md .docx .odt                             | ✅     | (app.test export docx/odt + re-import)                                                                                                                                                                                                                                          |
| 6.5 | Recent files, pin, missing file                       | ✅     | added pin, Pinned/Earlier groups, "2 hours ago"; missing file → dialog with Remove (audit.test 6.5, time.test)                                                                                                                                                                  |
| 6.6 | Autosave drafts + crash recovery                      | ✅     | (app.test autosave + recovery)                                                                                                                                                                                                                                                  |
| 6.7 | Unsaved-changes prompt (new/open/close window)        | ✅     | fixed: desktop close button did nothing with unsaved work (silent veto) → asks Save / Don't Save / Cancel (audit.test 6.7)                                                                                                                                                      |
| 6.8 | Saved .html opens in a browser, looks like the editor | ✅     | (app.test opens without Writy)                                                                                                                                                                                                                                                  |
| 6.9 | Copy/paste inside app, from Word/Docs/web, plain      | ✅     | (app.test paste steps)                                                                                                                                                                                                                                                          |

## 7. Quality

| #   | Feature                                        | Status | Notes                                                                                                                                                          |
| --- | ---------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1 | Every control has a name + tooltip             | ✅     | probe over every tab, menu and dialog in both themes (audit.test 7.1, tests/e2e/a11y.js)                                                                       |
| 7.2 | Keyboard-only use, focus rings, dialog focus   | ✅     | added F6/Shift+F6 regions, arrow keys in tab strip, global focus ring, modal focus trap + return (audit.test 7.2)                                              |
| 7.3 | Contrast in both themes                        | ✅     | fixed: contextual tab 2.4:1 in dark (audit.test 7.1)                                                                                                           |
| 7.4 | Errors are explained (bad file, missing tools) | ✅     | plain-language file errors (audit.test 7.4, time.test)                                                                                                         |
| 7.5 | Large document stays fast                      | ✅     | fixed: pagination never settled (6 passes, ~130 ms freezes) and was quadratic; word count debounced; now 1 pass, no task >50 ms on 300 pages (audit.test 7.5)  |
| 7.6 | Packaged AppImage works                        | ✅     | AppImage built, run headless + isolated, all 74 e2e steps pass                                                                                                 |
| 7.7 | App log clean (no errors / warnings)           | ✅     | fixed 3 renderer warnings (dropped `onCleanup`, print-area selector, ribbon peek keyboard) + picker timeout; `am logs --level=warn` empty after a full e2e run |
