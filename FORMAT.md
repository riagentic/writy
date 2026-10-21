# Writy document format (v1)

One file, `name.html`, that is at the same time:

1. **a normal web page**: any browser shows it, and it prints to paper/PDF with page size, margins and header/footer. By default it shows as **pages** (sheets
   with header/footer, like the editor's print layout; a small script, view only); `display: web` makes it one flowing page. Without scripts it is always one
   flowing page;
2. **the editable source**: [Djot](https://djot.net) text, plus the small extensions listed below;
3. **self-contained**: pictures and attachments live inside the file (base64).

## 1. File layout

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="generator" content="Writy …">
    <meta name="jw-hash" content="9c1f03aa">
    <!-- FNV-1a 32 of the stored source -->
    <title>Quarterly Report</title>
    <style>
    /* theme + page setup, generated from the source */
    </style>
  </head>
  <body>
    <script type="text/x-djot" id="jw-src">
# Quarterly Report
…Djot source…
</script>
    <main class="jw-page">…pre-rendered HTML…</main>
    <script type="application/octet-stream" id="att:logo.png" data-type="image/png">iVBOR…</script>
    <script>
    /* 10-line stale check, optional */
    </script>
    <script>
    /* pager (pages layout only, view only): reads main[data-pages] = {w,h,m:[t,r,b,l] mm, head, foot, title} */
    </script>
  </body>
</html>
```

| Part           | Rule                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `#jw-src`      | **The truth.** A reader that understands Djot needs nothing else. `</script` and `<!--` inside are written as `<\/script` / `<\!--`.                                                                   |
| `main.jw-page` | Derived view. A writer must regenerate it from `#jw-src` on every save. In pages layout it carries `data-pages` for the pager.                                                                         |
| attachments    | Referenced as `#att:<name>`. A picture used in the page is embedded once as `<img data-att="name" src="data:…">`; any other attachment is stored in a `script#att:<name>` block.                       |
| `jw-hash`      | FNV-1a (32-bit, hex) of the stored source text. If another tool changes `#jw-src` but not the view, the hash no longer matches, so the page shows a "stale" banner and Writy opens the source version. |

**Reading a file:** take `#jw-src` (undo the escapes) and collect attachments from both places. A file without `#jw-src` is ordinary HTML and is _imported_
instead.

## 2. Djot, plus attributes as formatting

Everything standard in Djot works as usual: headings, emphasis, lists, tables, footnotes, math, raw blocks and more. Formatting is done with Djot
**attributes**, and these keys become CSS:

| key                | CSS                        | key       | CSS                     |
| ------------------ | -------------------------- | --------- | ----------------------- |
| `color`            | `color`                    | `indent`  | `margin-left`           |
| `bg`               | `background`               | `first`   | `text-indent`           |
| `font`             | `font-family`              | `spacing` | `line-height`           |
| `size`             | `font-size`                | `cols`    | `columns`               |
| `align`            | `text-align`               | `gap`     | `column-gap`            |
| `valign`           | `vertical-align`           | `border`  | `border`                |
| `width` / `height` | size (images, tables)      | `float`   | `left`/`right` + margin |
| `break`            | `break-before/after: page` | `style`   | raw CSS (escape hatch)  |

`id` and `class` work as in HTML. Any other key becomes a `data-*` attribute.

```djot
{align=center}
[Red text]{color=red size=14pt} and ![logo](#att:logo.png){width=30mm float=right}
```

## 3. Extensions

All extensions are valid Djot syntax, so any Djot parser reads them (it just ignores what they mean).

### Document settings: `=meta`

````djot
``` =meta
title: Quarterly Report
author: Ana
page: A4            # A3 A4 A5 Letter Legal
orientation: portrait
margin: 20mm        # any CSS margin
page-color: #fffdf5 # page background (default white); never follows the app theme
text-color: #1f3864 # text colour (default near-black)
desk-color: #3a3a3a # workspace around the pages (default: light / dark grey, following the app or browser theme)
display: pages      # pages (default) | web — how a browser shows the saved file (the editor view is separate)
header: {title} | | Confidential
footer: | Page {page} of {pages} |
theme: report       # default modern classic report slides
font: Georgia, serif
headings-font: Inter, sans-serif
size: 11pt
lang: en
```
````

In `header`/`footer`, the parts `left | center | right` are split by `|`. A single part is centered, and two parts go left and right. Placeholders: `{page}`,
`{pages}`, `{title}` (the `title`, else the first heading, else "Untitled").

### Custom CSS: `=css`

````djot
``` =css
.jw-page h2 { color: teal }
```
````

### Spreadsheets: `=sheet`

````djot
{#Sales fmt="C:0.00;D:0%"}
``` =sheet
| Item  | Qty | Price | Share        |
| Pens  | 10  | 1.5   | =B2/SUM(B2:B3) |
| Paper | 30  | 4     | =B3/SUM(B2:B3) |
```
````

- Each row is one line of pipe cells. A cell that starts with `=` is a formula (Excel syntax, evaluated by IronCalc). The first row is the header.
- `#id` names the sheet. Formulas can reference other sheets: `=Sales!B2`.
- `fmt="TARGET:FORMAT;…"` sets number formats. TARGET is a column (`C`, meaning all body rows) or a single cell (`B2`). FORMAT is an Excel format code.
- `cells="TARGET:TOKENS;…"` styles cells, with the same TARGETs. TOKENS (space-separated): `b` / `b=0` bold on / off, `i` / `i=0` italic, `al=l|c|r` alignment,
  `fg=#hex` text colour, `bg=#hex` fill, `wr` wrap text, `bd` borders. A cell rule beats its column; later rules win. Only hex colours are accepted. Example:
  `cells="A5:b;D:al=r bg=#fff3a3"`.
- `widths="A:120;C:80"` sets column widths in pixels.
- Saved values are rendered into the HTML table, so the page needs no script.

**Live value in text:** `[42]{calc="Sales!D2"}`. The text in brackets is the cached value, refreshed on every save.

### Charts

```djot
{type=bar data="Sales!A1:B3" title="Units"}
::: chart
:::
```

`type` is `bar`, `line` or `pie`. In the data range, the first column holds the labels and the first row holds the series names. Charts are rendered as inline
SVG.

### Rich tables: `::: table`

Use this when a pipe table can't express what you need (merged cells, colors, widths, block content):

```djot
{head=1 widths="30%,70%"}
::: table
- - Name
  - Notes
- - []{colspan=2 bg="#eef"} A merged cell with *formatting*
:::
```

- The rows form a list, and each row is a list of cells.
- An optional empty span at the start of a cell carries the cell's settings: `colspan`, `rowspan`, `align`, `bg`, `valign` (`middle`, `bottom`).
- Table styles are classes on the table: `{.banded}` (banded rows), `{.minimal}` (lines between rows), `{.plain}` (no borders).
- `head=N` marks the first N rows as header rows.

### Shapes over the text

```djot
{kind=roundrect x=95mm y=-2mm w=55mm h=18mm fill="#fffbe6" stroke="#d4b02c"}
::: shape
Text inside the shape
:::
```

- `kind` is one of `rect`, `roundrect`, `ellipse`, `line`, `arrow`.
- A `line` / `arrow` runs from corner to corner of its box, starting at the corner `from` names: `tl` (default), `tr`, `bl`, `br`. A flat line has `h=0mm`. An
  `arrow` without `from` (older files) runs across the middle, left to right.
- The text's look: `size` (e.g. `14pt`), `color`, `align` (`left`, `center`, `right`).
- The shape is anchored to the **next** block. `x`/`y` are offsets from that block, so the shape moves with the text.
- It is rendered as absolutely positioned SVG.

### Other blocks

| Syntax                        | Meaning                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `{.page-break}` + `* * *`     | page break                                                                                                                |
| `::: toc` (attr `depth=3`)    | table of contents, from the headings                                                                                      |
| `::: figure` … last paragraph | figure; the last paragraph (without a picture) is the caption                                                             |
| `::: slide`                   | one presentation slide (slideshow: F5)                                                                                    |
| `::: notes`                   | speaker notes for the slide before it (or the heading slide around it): presenter view only, hidden in the file and print |
| `::: textbox`                 | boxed text (imported from Word/ODT text boxes)                                                                            |

### Review

| Syntax                                         | Meaning                          |
| ---------------------------------------------- | -------------------------------- |
| `[text]{comment="Check" by=Ana at=2026-10-20}` | a comment on `text`              |
| `{+new text+}{by=Ana at=…}`                    | tracked insertion                |
| `{-old text-}{by=Ana at=…}`                    | tracked deletion                 |
| `{+text+}` / `{-text-}` without `by`           | plain underline / strike-through |

## 4. Canonical writing

Writy writes Djot in one canonical way, so diffs stay small:

- paragraphs are wrapped at 80 columns;
- escaping is minimal, and each block is re-parsed to check it, with a fully-escaped fallback if the check fails;
- attributes are sorted;
- pipe tables are aligned;
- sheet grids are normalized.

Reading the source and writing it again gives the identical text, and the test suite checks this.

## 5. Compatibility promise

- Old files keep opening. New features only ever add attribute keys or `=format`/`::: class` blocks.
- A reader that doesn't know an extension must keep it unchanged when it re-saves the file.
- Opening a file needs no network access, and nothing in a file is ever executed. The only script is the optional stale check.
