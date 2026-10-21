// Spreadsheet node view: an Excel-style grid. Ranges (Shift+arrows / drag / header click), clipboard (also from Excel), fill
// down/right, sort, column widths, number formats, click-a-cell-into-a-formula, undo, and formulas that follow inserted or
// deleted rows/columns and sheet renames everywhere in the document.
import { history } from "../vendor/pm.js";
import type { model as M, view as V } from "../vendor/pm.js";
import { state } from "../vendor/pm.js";
import { calcResult, subscribe } from "./store.ts";
import { colIndex, colLetters as colName, cycleRef, type Edit, moveRefs, renameRefs, shiftRange, shiftRefs } from "./refs.ts";
import { applyStyle, moveRows, parseStyles, type Patch, stepDecimals, type Style, styleAt, styleCss } from "./cellstyle.ts";
import { formulaHint } from "./fnhints.ts";
import { fillSeries } from "./series.ts";
import type { SheetHits } from "./find.ts";
import { localNumber, parseTable } from "../ui/text.ts";
export { parseTable };
import { type MenuItem, ownMenu } from "../ui/menu.ts";
import { ask, toast } from "../ui/dialog.ts";

type Pos = { r: number; c: number };
type Rect = { r0: number; c0: number; r1: number; c1: number };

/** Number formats people actually use; codes are Excel's. */
const FORMATS: [label: string, code: string][] = [
  ["General", ""],
  ["Number 1,234.50", "#,##0.00"],
  ["Whole 1,235", "#,##0"],
  ["Euro 1,234.50 €", '#,##0.00 "€"'],
  ["Dollar $1,234.50", '"$"#,##0.00'],
  ["Percent 12%", "0%"],
  ["Percent 12.5%", "0.0%"],
  ["Date 2026-10-20", "yyyy-mm-dd"],
  ["Date 20.10.2026", "dd.mm.yyyy"],
];

const ERRORS: Record<string, string> = {
  "#DIV/0!": "Division by zero",
  "#REF!": "Points at a cell that was deleted or does not exist",
  "#NAME?": "Unknown function or name — check the spelling",
  "#VALUE!": "Wrong kind of value (e.g. text where a number is needed)",
  "#N/A": "Value not available (e.g. a lookup found nothing)",
  "#NUM!": "Number out of range",
  "#ERROR!": "The formula could not be read",
  "#CIRC!": "The formula refers to itself (circular reference)",
};

/** Last copy inside Writy: pasting it back moves relative references (the system clipboard only has values). */
let clip: { text: string; rows: string[][]; origin: Pos } | null = null;

const keep = (e: Event) => e.preventDefault();

/** The last multi-cell range picked in any sheet (`Sales!A1:C4`): Insert ▸ Chart starts from it. */
export let lastRange = "";
const isNum = (s: string) => s.trim() !== "" && !Number.isNaN(Number(s.replace(/[\s,]/g, "")));
const num = (s: string) => Number(s.replace(/[\s,]/g, ""));

export class SheetView implements V.NodeView {
  dom: HTMLElement;
  private node: M.Node;
  private grid: HTMLTableElement;
  private bar: HTMLInputElement;
  private ref: HTMLElement;
  private stats: HTMLElement;
  private hint: HTMLElement;
  private fmtPick: HTMLSelectElement;
  private headBtn: HTMLButtonElement;
  private boldBtn!: HTMLButtonElement;
  private italicBtn!: HTMLButtonElement;
  private wrapBtn!: HTMLButtonElement;
  private borderBtn!: HTMLButtonElement;
  private alignPick!: HTMLSelectElement;
  private fillPick!: HTMLSelectElement;
  private inkPick!: HTMLSelectElement;
  private anchor: Pos = { r: 0, c: 0 };
  private focus: Pos = { r: 0, c: 0 };
  private editing: HTMLInputElement | null = null;
  private dragging: "cells" | "point" | "fill" | null = null;
  /** While dragging the fill handle: how far the fill reaches (rows down or columns right). */
  private fillTo: { axis: "row" | "col"; n: number } | null = null;
  private point: { at: number; len: number; start: Pos } | null = null;
  private off: () => void;

  /** Find matches in this sheet (from the find plugin's node decoration). */
  private hits: SheetHits = { cells: [], cur: null };

  constructor(node: M.Node, private view: V.EditorView, private getPos: () => number | undefined, decos: readonly V.Decoration[] = []) {
    this.node = node;
    this.hits = hitsOf(decos);
    this.dom = el("div", "jw-sheetview");
    this.dom.contentEditable = "false";

    const tools = el("div", "jw-sheet-tools");
    const name = el("input", "jw-sheet-name") as HTMLInputElement;
    name.value = node.attrs.id;
    name.title = "Sheet name — used in formulas and charts, like Sales!B2";
    name.setAttribute("aria-label", "Sheet name");
    name.onchange = () => this.rename(name);
    name.onkeydown = (e) => e.key === "Enter" && (e.preventDefault(), this.grid.focus());
    const btn = (label: string, title: string, f: () => void) => {
      const b = el("button", "jw-mini") as HTMLButtonElement;
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.onmousedown = keep;
      b.onclick = f;
      return b;
    };
    this.fmtPick = el("select", "jw-mini") as HTMLSelectElement;
    this.fmtPick.setAttribute("aria-label", "Number format");
    this.fmtPick.title = "Number format of the selected cells";
    this.fmtPick.onchange = () => this.pickFormat();
    const pick = (label: string, opts: [string, string][], f: (v: string) => void) => {
      const s = el("select", "jw-mini") as HTMLSelectElement;
      s.setAttribute("aria-label", label);
      s.title = label;
      s.append(...opts.map(([l, v]) => Object.assign(el("option", "", l) as HTMLOptionElement, { value: v })));
      s.onchange = () => (f(s.value), this.grid.focus());
      return s;
    };
    this.boldBtn = btn("B", "Bold (Ctrl+B)", () => this.toggle("b"));
    this.boldBtn.classList.add("jw-b");
    this.italicBtn = btn("I", "Italic (Ctrl+I)", () => this.toggle("i"));
    this.italicBtn.classList.add("jw-i");
    this.wrapBtn = btn("Wrap", "Wrap text: long text breaks onto more lines inside the cell", () => this.toggle("wr"));
    this.borderBtn = btn("Borders", "Borders: lines around each selected cell (shown in print and the saved file)", () => this.toggle("bd"));
    this.alignPick = pick(
      "Align",
      [["Align", ""], ["Left", "l"], ["Center", "c"], ["Right", "r"]],
      (v) => this.restyle({ al: (v || null) as Style["al"] | null }),
    );
    this.fillPick = pick("Cell fill", CELL_FILLS, (v) => this.restyle({ bg: v || null }));
    this.inkPick = pick("Text colour", CELL_INKS, (v) => this.restyle({ fg: v || null }));
    this.headBtn = btn("Header row", "Show the first row as a header", () => this.set({ head: this.node.attrs.head ? 0 : 1 }));
    tools.append(
      name,
      sep(),
      btn("+ Row", "Insert a row below (formulas follow)", () => this.structure("row", this.rect().r1 + 1, 1)),
      btn("+ Column", "Insert a column to the right (formulas follow)", () => this.structure("col", this.rect().c1 + 1, 1)),
      btn("− Row", "Delete the selected rows", () => this.structure("row", this.rect().r0, -(this.rect().r1 - this.rect().r0 + 1))),
      btn("− Column", "Delete the selected columns", () => this.structure("col", this.rect().c0, -(this.rect().c1 - this.rect().c0 + 1))),
      sep(),
      btn("Σ", "AutoSum (Alt+=): add up the numbers above or to the left", () => this.autoSum()),
      this.fmtPick,
      btn(".0+", "More decimals", () => this.decimals(1)),
      btn(".0−", "Fewer decimals", () => this.decimals(-1)),
      this.boldBtn,
      this.italicBtn,
      this.alignPick,
      this.fillPick,
      this.inkPick,
      this.wrapBtn,
      this.borderBtn,
      sep(),
      btn("Chart", "Chart from the selected cells (first column = labels, first row = series names)", () => this.chart()),
      btn("A→Z", "Sort rows by this column, smallest first (header and a totals row stay put)", () => this.sort(1)),
      btn("Z→A", "Sort rows by this column, largest first", () => this.sort(-1)),
      this.headBtn,
      sep(),
      btn("🗑", "Delete this sheet (Ctrl+Z brings it back)", () => this.remove()),
    );

    this.ref = el("span", "jw-sheet-ref");
    const fx = el("span", "jw-fx", "fx");
    this.bar = el("input", "jw-sheet-bar") as HTMLInputElement;
    this.bar.setAttribute("aria-label", "Formula bar");
    this.bar.placeholder = "Value or =formula";
    this.bar.spellcheck = false;
    this.bar.oninput = () => this.showHint(this.bar);
    this.bar.onblur = () => (this.hint.hidden = true);
    this.bar.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Tab" && this.complete(this.bar)) e.preventDefault();
      else if (e.key === "F4") (e.preventDefault(), refCycle(this.bar));
      else if (e.key === "Enter") (e.preventDefault(), this.commit(this.focus, this.bar.value), this.move(e.shiftKey ? -1 : 1, 0, false));
      else if (e.key === "Escape") (e.preventDefault(), this.render(), this.grid.focus());
    };
    this.stats = el("span", "jw-sheet-stats");
    this.stats.setAttribute("aria-live", "polite");
    this.hint = el("div", "jw-sheet-hint");
    this.hint.setAttribute("aria-live", "polite");
    this.hint.hidden = true;
    const fbar = el("div", "jw-sheet-fbar");
    fbar.append(this.ref, fx, this.bar, this.stats, this.hint);

    const scroll = el("div", "jw-sheet-scroll");
    this.grid = el("table", "jw-sheet-grid") as HTMLTableElement;
    this.grid.tabIndex = 0;
    this.grid.setAttribute("aria-label", `Sheet ${node.attrs.id}`);
    this.grid.onkeydown = (e) => this.key(e);
    this.grid.onmousedown = (e) => this.down(e);
    this.grid.onmouseover = (e) => this.over(e);
    this.grid.ondblclick = (e) => {
      const p = cellOf(e.target);
      if (p) this.edit(p, null);
    };
    this.grid.oncopy = (e) => this.copy(e, false);
    this.grid.oncut = (e) => this.copy(e, true);
    this.grid.onpaste = (e) => this.paste(e);
    scroll.append(this.grid);
    this.dom.append(tools, fbar, scroll);
    addEventListener("mouseup", this.up);
    ownMenu(this.grid, (e) => this.menu(e));
    this.render();
    this.off = subscribe(() => this.render());
  }

  // ── model ──
  private rows(): string[][] {
    return this.node.attrs.rows.map((r: string[]) => [...r]);
  }
  private size() {
    const rows = this.node.attrs.rows as string[][];
    return { h: rows.length, w: rows[0]?.length ?? 1 };
  }
  private a(): Record<string, string> {
    return (this.node.attrs.a ?? {}) as Record<string, string>;
  }
  private fmts(): Map<string, string> {
    return new Map(String(this.node.attrs.fmt || "").split(";").filter((x) => x.includes(":")).map((x) => x.split(/:(.*)/s, 2) as [string, string]));
  }
  private widths(): Map<string, number> {
    return new Map(String(this.a().widths ?? "").split(";").filter((x) => x.includes(":")).map((x) => [x.split(":")[0], +x.split(":")[1]]));
  }
  private set(attrs: Record<string, unknown>): void {
    const pos = this.getPos();
    if (pos !== undefined) this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, ...attrs }));
  }
  private setRows(rows: string[][]) {
    const w = Math.max(1, ...rows.map((r) => r.length));
    this.set({ rows: rows.map((r) => [...r, ...Array(w - r.length).fill("")]) });
  }
  private commit(p: Pos, typed: string): void {
    const v = localNumber(typed); // "1,5" where the locale writes a decimal comma
    const rows = this.rows();
    while (rows.length <= p.r) rows.push(Array(rows[0]?.length ?? 1).fill(""));
    rows.forEach((r) => {
      while (r.length <= p.c) r.push("");
    });
    if (rows[p.r][p.c] === v) return;
    rows[p.r][p.c] = v;
    this.setRows(rows);
  }

  // ── selection ──
  private rect(): Rect {
    return {
      r0: Math.min(this.anchor.r, this.focus.r),
      r1: Math.max(this.anchor.r, this.focus.r),
      c0: Math.min(this.anchor.c, this.focus.c),
      c1: Math.max(this.anchor.c, this.focus.c),
    };
  }
  private select(p: Pos, extend = false) {
    const { h, w } = this.size();
    const q = { r: Math.max(0, Math.min(h - 1, p.r)), c: Math.max(0, Math.min(w - 1, p.c)) };
    this.focus = q;
    if (!extend) this.anchor = q;
    this.paint();
    this.grid.focus({ preventScroll: true });
    this.grid.querySelector(".sel")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  /** Move the cursor; Enter / Tab past the edge grow the sheet by one row / column (like an Excel table). */
  private move(dr: number, dc: number, extend: boolean, grow = false) {
    const { h, w } = this.size();
    const r = this.focus.r + dr, c = this.focus.c + dc;
    if (grow && r >= h) return (this.structure("row", h, 1), this.select({ r, c: this.focus.c }));
    if (grow && c >= w) return (this.structure("col", w, 1), this.select({ r: this.focus.r, c }));
    this.select({ r, c }, extend);
  }
  /** Ctrl+arrow: to the edge of the block of filled (or empty) cells, like Excel. */
  private jump(dr: number, dc: number, extend: boolean) {
    const rows = this.node.attrs.rows as string[][];
    const { h, w } = this.size();
    const at = (p: Pos) => (rows[p.r]?.[p.c] ?? "") !== "";
    let p = { ...this.focus };
    const inside = (q: Pos) => q.r >= 0 && q.c >= 0 && q.r < h && q.c < w;
    const step = (q: Pos) => ({ r: q.r + dr, c: q.c + dc });
    if (!inside(step(p))) return;
    const filled = at(p) && at(step(p));
    while (inside(step(p)) && (filled ? at(step(p)) : !at(step(p)))) p = step(p);
    if (!filled && inside(step(p))) p = step(p);
    this.select(p, extend);
  }

  // ── keyboard ──
  private key(e: KeyboardEvent) {
    if (this.editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const { h, w } = this.size();
    const k = e.key;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const go = (f: () => void) => (e.preventDefault(), e.stopPropagation(), f());
    if (arrows[k]) return go(() => (mod ? this.jump(...arrows[k], e.shiftKey) : this.move(...arrows[k], e.shiftKey)));
    if (k === "Enter") return go(() => this.move(e.shiftKey ? -1 : 1, 0, false, !e.shiftKey));
    if (k === "Tab") return go(() => this.move(0, e.shiftKey ? -1 : 1, false, !e.shiftKey));
    if (k === "Home") return go(() => this.select({ r: mod ? 0 : this.focus.r, c: 0 }, e.shiftKey));
    if (k === "End") return go(() => this.select({ r: mod ? h - 1 : this.focus.r, c: w - 1 }, e.shiftKey));
    if (k === "PageDown" || k === "PageUp") return go(() => this.move(k === "PageDown" ? 10 : -10, 0, e.shiftKey));
    if (k === "F2") return go(() => this.edit(this.focus, null));
    if (k === "Escape") return go(() => this.leave());
    if (k === "Delete" || k === "Backspace") return go(() => this.fill(() => ""));
    if (e.altKey && !mod && (k === "=" || e.code === "Equal")) return go(() => this.autoSum());
    if (mod && !e.altKey) {
      const lk = k.toLowerCase();
      if (lk === "z") return go(() => (e.shiftKey ? history.redo : history.undo)(this.view.state, this.view.dispatch));
      if (lk === "y") return go(() => history.redo(this.view.state, this.view.dispatch));
      if (lk === "a") return go(() => ((this.anchor = { r: 0, c: 0 }), this.select({ r: h - 1, c: w - 1 }, true)));
      if (lk === "b" || lk === "i") return go(() => this.toggle(lk));
      if (lk === "d") return go(() => this.fillFrom("down"));
      if (lk === "r") return go(() => this.fillFrom("right"));
      if (lk === "c" || lk === "x" || lk === "v") return e.stopPropagation(); // the copy / cut / paste events do the work
      return;
    }
    if (k.length === 1 && !e.altKey) go(() => this.edit(this.focus, k));
  }

  /** Leave the sheet with Escape: the caret goes after it. */
  private leave() {
    const pos = this.getPos();
    if (pos === undefined) return;
    const after = pos + this.node.nodeSize;
    const st = this.view.state;
    const sel = state.Selection.near(st.doc.resolve(Math.min(after, st.doc.content.size)));
    this.view.dispatch(st.tr.setSelection(sel).scrollIntoView());
    this.view.focus();
  }

  // ── editing ──
  private edit(p: Pos, initial: string | null) {
    const td = this.td(p);
    if (!td) return;
    const raw = (this.node.attrs.rows as string[][])[p.r]?.[p.c] ?? "";
    const inp = el("input", "jw-cell-edit") as HTMLInputElement;
    inp.value = initial ?? raw;
    inp.spellcheck = false;
    inp.setAttribute("aria-label", `Edit ${colName(p.c)}${p.r + 1}`);
    td.textContent = "";
    td.append(inp);
    this.editing = inp;
    this.point = null;
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
    this.bar.value = inp.value;
    inp.oninput = () => ((this.bar.value = inp.value), (this.point = null), this.showHint(inp));
    this.showHint(inp);
    const done = (save: boolean, dr = 0, dc = 0, grow = true) => {
      if (!this.editing) return;
      this.editing = null;
      this.hint.hidden = true;
      this.point = null;
      if (save) this.commit(p, inp.value);
      this.focus = this.anchor = p;
      if (dr || dc) this.move(dr, dc, false, grow);
      else (this.render(), this.grid.focus());
    };
    // Excel: typing over a cell ("enter" mode) lets arrows save and move; F2 / double-click ("edit" mode) moves in the text
    let enterMode = initial !== null;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    inp.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "F4") return (e.preventDefault(), refCycle(inp));
      if (e.key === "F2") return (e.preventDefault(), (enterMode = !enterMode));
      if (arrows[e.key] && enterMode && !e.shiftKey && !inp.value.startsWith("=")) {
        return (e.preventDefault(), done(true, ...arrows[e.key], false)); // arrows stop at the edge; Enter / Tab grow
      }
      if (arrows[e.key] && !e.shiftKey && this.pointing()) {
        // pointing in a formula (after `=`, `(`, `+` …): arrows walk a reference, like Excel's Point mode
        e.preventDefault();
        const [dr, dc] = arrows[e.key], from = this.point?.start ?? p, { h, w } = this.size();
        const q = { r: Math.max(0, Math.min(h - 1, from.r + dr)), c: Math.max(0, Math.min(w - 1, from.c + dc)) };
        return this.putRef(q, q);
      }
      if (e.key === "Enter") (e.preventDefault(), done(true, e.shiftKey ? -1 : 1, 0));
      else if (e.key === "Tab" && !e.shiftKey && this.complete(inp)) e.preventDefault();
      else if (e.key === "Tab") (e.preventDefault(), done(true, 0, e.shiftKey ? -1 : 1));
      else if (e.key === "Escape") (e.preventDefault(), done(false));
    };
    inp.onblur = () => !this.dragging && done(true);
  }

  /** Function names that match, or the signature of the function the caret is in (current argument in bold). */
  private showHint(inp: HTMLInputElement) {
    const h = formulaHint(inp.value, inp.selectionStart ?? inp.value.length);
    this.hint.hidden = !h;
    if (!h) return;
    if (h.kind === "names") {
      this.hint.replaceChildren(el("b", "", h.names[0]), ` ${h.names.slice(1).join(" · ")}`, el("span", "muted", "  Tab completes"));
      return;
    }
    const args = h.args ? h.args.split(", ") : [];
    const parts: (string | Node)[] = [`${h.name}(`];
    const last = args.length - (args.at(-1) === "…" ? 2 : 1); // past the end of a "…" list: the repeating argument
    const cur = Math.min(h.arg, last);
    args.forEach((a, i) => parts.push(i ? ", " : "", i === cur ? el("b", "", a) : a));
    this.hint.replaceChildren(...parts, `) — ${h.desc}`);
  }
  /** Tab while a function name is typed: complete the first match and open its bracket. */
  private complete(inp: HTMLInputElement): boolean {
    const at = inp.selectionStart ?? inp.value.length;
    const h = formulaHint(inp.value, at);
    if (h?.kind !== "names") return false;
    inp.value = `${inp.value.slice(0, at - h.prefix.length)}${h.names[0]}(${inp.value.slice(at)}`;
    const to = at - h.prefix.length + h.names[0].length + 1;
    inp.setSelectionRange(to, to);
    inp.dispatchEvent(new Event("input"));
    return true;
  }

  /** While typing a formula, a click (or drag) on a cell types its reference. */
  private pointing(): boolean {
    const v = this.editing?.value ?? "";
    if (!v.startsWith("=")) return false;
    if (this.point) return true;
    const before = v.slice(0, this.editing!.selectionStart ?? v.length).trimEnd();
    return /[=(,;+\-*/^&<>:]$/.test(before);
  }
  private putRef(start: Pos, end: Pos) {
    const inp = this.editing!;
    const a = `${colName(Math.min(start.c, end.c))}${Math.min(start.r, end.r) + 1}`;
    const b = `${colName(Math.max(start.c, end.c))}${Math.max(start.r, end.r) + 1}`;
    const ref = a === b ? a : `${a}:${b}`;
    const at = this.point?.at ?? inp.selectionStart ?? inp.value.length;
    const len = this.point?.len ?? 0;
    inp.value = inp.value.slice(0, at) + ref + inp.value.slice(at + len);
    this.point = { at, len: ref.length, start };
    inp.setSelectionRange(at + ref.length, at + ref.length);
    this.bar.value = inp.value;
  }

  // ── mouse ──
  private down(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.classList.contains("jw-col-grip")) return this.resizeCol(e, +t.dataset.c!);
    if (t.classList.contains("jw-fill-handle")) {
      e.preventDefault();
      this.dragging = "fill";
      this.fillTo = null;
      const mv = (ev: MouseEvent) => this.fillMove(ev.clientX, ev.clientY);
      addEventListener("mousemove", mv);
      addEventListener("mouseup", () => removeEventListener("mousemove", mv), { once: true });
      return;
    }
    const head = t.closest("th");
    if (head && !this.editing) {
      e.preventDefault();
      const { h, w } = this.size();
      if (head.dataset.c) (this.anchor = { r: 0, c: +head.dataset.c }), this.select({ r: h - 1, c: +head.dataset.c }, true);
      else if (head.dataset.r) (this.anchor = { r: +head.dataset.r, c: 0 }), this.select({ r: +head.dataset.r, c: w - 1 }, true);
      else (this.anchor = { r: 0, c: 0 }), this.select({ r: h - 1, c: w - 1 }, true);
      return;
    }
    const p = cellOf(t);
    if (!p || e.button !== 0) return;
    if (this.editing && t.closest(".jw-cell-edit")) return;
    if (this.editing && this.pointing()) {
      e.preventDefault();
      this.dragging = "point";
      this.putRef(p, p);
      return;
    }
    e.preventDefault();
    this.dragging = "cells";
    this.select(p, e.shiftKey);
  }
  private over(e: MouseEvent) {
    const p = cellOf(e.target);
    if (!p || !this.dragging) return;
    if (this.dragging === "point" && this.point) this.putRef(this.point.start, p);
    else if (this.dragging === "cells") this.select(p, true);
  }
  /** The fill reaches the cell under the mouse — or past the sheet's edge, where new rows / columns will be added. */
  private fillMove(x: number, y: number) {
    const { h, w } = this.size();
    const last = this.td({ r: h - 1, c: w - 1 })?.getBoundingClientRect();
    if (!last) return;
    const under = cellOf(document.elementFromPoint(x, y));
    const r = under?.r ?? (y > last.bottom ? h - 1 + Math.ceil((y - last.bottom) / last.height) : -1);
    const c = under?.c ?? (x > last.right ? w - 1 + Math.ceil((x - last.right) / last.width) : -1);
    const R = this.rect();
    const down = r - R.r1, right = c - R.c1;
    const next = down > 0 && down >= right
      ? { axis: "row" as const, n: Math.min(down, 500) }
      : right > 0
      ? { axis: "col" as const, n: Math.min(right, 50) }
      : null;
    if (JSON.stringify(next) === JSON.stringify(this.fillTo)) return;
    this.fillTo = next;
    this.paint();
    if (next) this.stats.textContent = `Fill ${next.n} ${next.axis === "row" ? "row" : "column"}${next.n > 1 ? "s" : ""} — release to fill`;
  }
  private up = () => {
    if (this.dragging === "point") this.editing?.focus();
    if (this.dragging === "fill" && this.fillTo) this.fillSeries(this.fillTo);
    if (this.dragging === "fill") (this.fillTo = null), this.paint();
    this.dragging = null;
  };
  /** Fill handle released: continue each column (or row) of the selection into the next cells, growing the sheet. */
  private fillSeries({ axis, n }: { axis: "row" | "col"; n: number }) {
    const R = this.rect(), rows = this.rows();
    const wide = Math.max(rows[0]?.length ?? 1, axis === "col" ? R.c1 + n + 1 : 0);
    while (rows.length <= (axis === "row" ? R.r1 + n : 0)) rows.push(Array(wide).fill(""));
    rows.forEach((r) => r.push(...Array(Math.max(0, wide - r.length)).fill("")));
    if (axis === "row") {
      for (let c = R.c0; c <= R.c1; c++) {
        const out = fillSeries(rows.slice(R.r0, R.r1 + 1).map((r) => r[c]), n, 1, 0);
        out.forEach((v, i) => (rows[R.r1 + 1 + i][c] = v));
      }
      this.setRows(rows);
      this.select({ r: R.r1 + n, c: R.c1 }, true);
    } else {
      for (let r = R.r0; r <= R.r1; r++) {
        const out = fillSeries(rows[r].slice(R.c0, R.c1 + 1), n, 0, 1);
        out.forEach((v, i) => (rows[r][R.c1 + 1 + i] = v));
      }
      this.setRows(rows);
      this.select({ r: R.r1, c: R.c1 + n }, true);
    }
  }
  private resizeCol(e: MouseEvent, c: number) {
    e.preventDefault();
    e.stopPropagation();
    const col = this.grid.querySelectorAll("col")[c + 1] as HTMLElement | undefined;
    const start = e.clientX, w0 = col?.getBoundingClientRect().width || 80;
    const z = this.grid.getBoundingClientRect().width / (this.grid.offsetWidth || 1) || 1;
    let wNow = w0 / z;
    const mv = (ev: MouseEvent) => {
      wNow = Math.max(36, Math.round((w0 + ev.clientX - start) / z));
      if (col) col.style.width = `${wNow}px`;
    };
    const stop = () => {
      removeEventListener("mousemove", mv);
      removeEventListener("mouseup", stop);
      const m = this.widths();
      m.set(colName(c), wNow);
      this.set({ a: { ...this.a(), widths: [...m].map(([k, v]) => `${k}:${v}`).join(";") } });
    };
    addEventListener("mousemove", mv);
    addEventListener("mouseup", stop);
  }

  // ── bulk edits ──
  /** Set every selected cell to `f(r, c)`. */
  private fill(f: (r: number, c: number, cur: string) => string) {
    const R = this.rect(), rows = this.rows();
    for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) rows[r][c] = f(r, c, rows[r][c]);
    this.setRows(rows);
  }
  /** Ctrl+D / Ctrl+R: copy the first row (column) of the selection over the rest — or the cell above (left) when one cell. */
  private fillFrom(dir: "down" | "right") {
    const R = this.rect(), rows = this.rows();
    const down = dir === "down";
    const single = down ? R.r0 === R.r1 : R.c0 === R.c1;
    const src = single ? (down ? R.r0 - 1 : R.c0 - 1) : (down ? R.r0 : R.c0);
    if (src < 0) return;
    for (let r = R.r0; r <= R.r1; r++) {
      for (let c = R.c0; c <= R.c1; c++) {
        if ((down ? r : c) === src) continue;
        const from = down ? rows[src][c] : rows[r][src];
        rows[r][c] = moveRefs(from, down ? r - src : 0, down ? 0 : c - src);
      }
    }
    this.setRows(rows);
  }
  private copy(e: ClipboardEvent, cut: boolean) {
    if (this.editing) return;
    e.preventDefault();
    const R = this.rect();
    const raw = this.node.attrs.rows as string[][];
    const shown = calcResult().values[this.node.attrs.id] ?? [];
    const rows: string[][] = [], text: string[] = [];
    for (let r = R.r0; r <= R.r1; r++) {
      rows.push(raw[r].slice(R.c0, R.c1 + 1));
      text.push(raw[r].slice(R.c0, R.c1 + 1).map((v, i) => shown[r]?.[R.c0 + i] ?? v).join("\t"));
    }
    const t = text.join("\n");
    e.clipboardData?.setData("text/plain", t);
    // a real table for Word, email and Calc
    const cell = (v: string) => `<td>${v.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</td>`;
    e.clipboardData?.setData("text/html", `<table>${text.map((l) => `<tr>${l.split("\t").map(cell).join("")}</tr>`).join("")}</table>`);
    clip = { text: t, rows, origin: { r: R.r0, c: R.c0 } };
    if (cut) this.fill(() => "");
  }
  private paste(e: ClipboardEvent) {
    if (this.editing) return;
    e.preventDefault();
    this.pasteText(e.clipboardData?.getData("text/plain") ?? "");
  }
  private pasteText(raw: string) {
    const text = raw.replace(/\r\n?/g, "\n").replace(/\n$/, "");
    if (!text) return;
    const R = this.rect();
    let block: string[][];
    if (clip && clip.text === text) {
      const { r, c } = clip.origin;
      block = clip.rows.map((row) => row.map((v) => moveRefs(v, R.r0 - r, R.c0 - c)));
    } else block = parseTable(text);
    const rows = this.rows();
    // one value into a selected range fills it; otherwise the block lands at the top-left cell and the sheet grows
    if (block.length === 1 && block[0].length === 1 && (R.r1 > R.r0 || R.c1 > R.c0)) return this.fill(() => block[0][0]);
    block.forEach((row, i) =>
      row.forEach((v, j) => {
        const r = R.r0 + i, c = R.c0 + j;
        while (rows.length <= r) rows.push(Array(rows[0]?.length ?? 1).fill(""));
        while (rows[r].length <= c) rows.forEach((x) => x.push(""));
        rows[r][c] = localNumber(v);
      })
    );
    this.setRows(rows);
    this.anchor = { r: R.r0, c: R.c0 };
    this.focus = { r: R.r0 + block.length - 1, c: R.c0 + Math.max(...block.map((b) => b.length)) - 1 };
  }

  /** A bar chart of the selection (or the whole sheet), right under the sheet. */
  private chart() {
    const pos = this.getPos();
    if (pos === undefined) return;
    const R = this.rect(), { h, w } = this.size(), id = this.node.attrs.id;
    const one = R.r0 === R.r1 && R.c0 === R.c1;
    const [a, b] = one ? [{ r: 0, c: 0 }, { r: h - 1, c: w - 1 }] : [{ r: R.r0, c: R.c0 }, { r: R.r1, c: R.c1 }];
    const data = `${id}!${colName(a.c)}${a.r + 1}:${colName(b.c)}${b.r + 1}`;
    const at = pos + this.node.nodeSize;
    const tr = this.view.state.tr.insert(at, this.view.state.schema.nodes.chart.create({ type: "bar", data }));
    this.view.dispatch(tr.setSelection(state.NodeSelection.create(tr.doc, at)).scrollIntoView());
  }

  /** Right-click: Excel's cell menu (the document's menu would paste into the page). */
  private menu(e: MouseEvent): MenuItem[] {
    const p = cellOf(e.target);
    const R0 = this.rect();
    if (p && !(p.r >= R0.r0 && p.r <= R0.r1 && p.c >= R0.c0 && p.c <= R0.c1)) this.select(p);
    this.grid.focus();
    const R = this.rect();
    const nr = R.r1 - R.r0 + 1, nc = R.c1 - R.c0 + 1;
    const s = (n: number, w: string) => (n > 1 ? `${n} ${w}s` : w);
    const clipCmd = (k: "cut" | "copy") => () => (this.grid.focus(), document.execCommand(k));
    return [
      { label: "Cut", keys: "Ctrl+X", run: clipCmd("cut") },
      { label: "Copy", keys: "Ctrl+C", run: clipCmd("copy") },
      {
        label: "Paste",
        keys: "Ctrl+V",
        run: () => navigator.clipboard.readText().then((t) => this.pasteText(t), () => toast("Use Ctrl+V to paste here.")),
      },
      { label: "Clear contents", keys: "Delete", run: () => this.fill(() => "") },
      "-",
      { label: `Insert ${s(nr, "row")} above`, run: () => this.structure("row", R.r0, nr) },
      { label: `Insert ${s(nr, "row")} below`, run: () => this.structure("row", R.r1 + 1, nr) },
      { label: `Insert ${s(nc, "column")} left`, run: () => this.structure("col", R.c0, nc) },
      { label: `Insert ${s(nc, "column")} right`, run: () => this.structure("col", R.c1 + 1, nc) },
      { label: `Delete ${s(nr, "row")}`, run: () => this.structure("row", R.r0, -nr) },
      { label: `Delete ${s(nc, "column")}`, run: () => this.structure("col", R.c0, -nc) },
      "-",
      { label: "Sort A→Z", run: () => this.sort(1) },
      { label: "Sort Z→A", run: () => this.sort(-1) },
      "-",
      { label: "Save sheet as CSV…", run: () => this.csv() },
    ];
  }
  private csv() {
    const id = this.node.attrs.id as string;
    const shown = calcResult().values[id] ?? [];
    const rows = (this.node.attrs.rows as string[][]).map((r, i) => r.map((v, j) => shown[i]?.[j] ?? v));
    import("./session.ts").then((m) => m.saveCsv(id, rows));
  }

  // ── cell styles ──
  /** Selected targets: whole columns when every row is selected (new rows then inherit), else each cell. */
  private targets(): string[] {
    const R = this.rect(), { h } = this.size();
    const out: string[] = [];
    for (let c = R.c0; c <= R.c1; c++) {
      if (R.r0 === 0 && R.r1 === h - 1 && h > 1) out.push(colName(c));
      else for (let r = R.r0; r <= R.r1; r++) out.push(`${colName(c)}${r + 1}`);
    }
    return out;
  }
  private restyle(patch: Patch) {
    this.set({ a: { ...this.a(), cells: applyStyle(this.a().cells ?? "", this.targets(), patch) } });
  }
  /** Bold / italic on or off for the selection, by the focus cell (like Excel). */
  private toggle(k: "b" | "i" | "wr" | "bd") {
    const head = this.node.attrs.head as number;
    const st = styleAt(parseStyles(this.a().cells ?? ""), this.focus.r, this.focus.c, head);
    const on = st[k] ?? (k === "b" && this.focus.r < head);
    // wrap / borders are on-only tokens: turning them off removes them
    this.restyle(k === "wr" || k === "bd" ? { [k]: on ? null : true } : { [k]: !on });
  }

  // ── structure: rows / columns, formulas everywhere follow ──
  private structure(axis: "row" | "col", at: number, count: number) {
    const pos = this.getPos();
    if (pos === undefined) return;
    const id = this.node.attrs.id as string;
    const { h, w } = this.size();
    if (count < 0 && (axis === "row" ? h : w) + count < 1) return toast("A sheet needs at least one row and one column.");
    const edit: Edit = { sheet: id, axis, at, count };
    const tr = this.view.state.tr;
    const firstSheet = firstSheetId(this.view.state.doc);
    this.view.state.doc.descendants((n, p) => {
      if (n.type.name === "sheet") {
        let rows = (n.attrs.rows as string[][]).map((row, r) => row.map((v, c) => shiftRefs(v, n.attrs.id, edit, { r, c })));
        let fmt = n.attrs.fmt as string, a = n.attrs.a as Record<string, string>;
        if (p === pos) {
          if (axis === "row") {
            if (count > 0) rows.splice(at, 0, ...Array.from({ length: count }, () => Array(w).fill("")));
            else rows.splice(at, -count);
          } else rows = rows.map((r) => (count > 0 ? r.splice(at, 0, ...Array(count).fill("")) : r.splice(at, -count), r));
          fmt = shiftFormats(fmt, axis, at, count);
          if (axis === "col" && a?.widths) a = { ...a, widths: shiftWidths(a.widths, at, count) };
          if (a?.cells) a = { ...a, cells: shiftFormats(a.cells, axis, at, count) };
        }
        tr.setNodeMarkup(p, null, { ...n.attrs, rows, fmt, a });
        return false;
      }
      if (n.type.name === "chart" && n.attrs.data) {
        tr.setNodeMarkup(p, null, { ...n.attrs, data: shiftRange(n.attrs.data, firstSheet, edit) });
      }
      if (n.type.name === "calc" && n.attrs.ref) tr.setNodeMarkup(p, null, { ...n.attrs, ref: shiftRange(n.attrs.ref, firstSheet, edit) });
      return true;
    });
    this.view.dispatch(tr);
    if (count < 0) this.select({ r: Math.min(this.focus.r, this.size().h - 1), c: Math.min(this.focus.c, this.size().w - 1) });
  }

  private rename(input: HTMLInputElement) {
    const from = this.node.attrs.id as string;
    const to = input.value.trim().replace(/[^\p{L}\p{N}_ ]/gu, "").replace(/\s+/g, "_");
    const taken = new Set<string>();
    this.view.state.doc.descendants((n) => void (n.type.name === "sheet" && n.attrs.id !== from && taken.add(n.attrs.id)));
    if (!to || to === from) return void (input.value = from);
    if (taken.has(to) || /^[A-Za-z]{1,3}\d+$/.test(to)) {
      input.value = from;
      return toast(taken.has(to) ? `There is already a sheet called “${to}”.` : `“${to}” looks like a cell address — pick another name.`, "error");
    }
    const tr = this.view.state.tr;
    const pos = this.getPos();
    this.view.state.doc.descendants((n, p) => {
      if (n.type.name === "sheet") {
        tr.setNodeMarkup(p, null, {
          ...n.attrs,
          id: p === pos ? to : n.attrs.id,
          rows: (n.attrs.rows as string[][]).map((r) => r.map((v) => renameRefs(v, from, to))),
        });
        return false;
      }
      if (n.type.name === "chart" && n.attrs.data) tr.setNodeMarkup(p, null, { ...n.attrs, data: renameRefs(`=${n.attrs.data}`, from, to).slice(1) });
      if (n.type.name === "calc" && n.attrs.ref) tr.setNodeMarkup(p, null, { ...n.attrs, ref: renameRefs(`=${n.attrs.ref}`, from, to).slice(1) });
      return true;
    });
    this.view.dispatch(tr);
    input.value = to;
  }

  private sort(dir: 1 | -1) {
    const rows = this.rows();
    const head = this.node.attrs.head as number;
    const R = this.rect();
    const shown = calcResult().values[this.node.attrs.id] ?? [];
    let r0 = head, r1 = rows.length - 1;
    if (R.r1 > R.r0) (r0 = Math.max(head, R.r0)), (r1 = R.r1);
    else while (r1 > r0 && rows[r1].some((v) => /^=.*[A-Za-z]+\d+:[A-Za-z]+\d+/.test(v))) r1--; // keep a totals row at the bottom
    if (r1 <= r0) return;
    const c = this.focus.c;
    const key = (i: number) => shown[i]?.[c] ?? rows[i][c] ?? "";
    const idx = Array.from({ length: r1 - r0 + 1 }, (_, i) => r0 + i);
    idx.sort((a, b) => {
      const x = key(a), y = key(b);
      if (x === "" || y === "") return x === "" ? 1 : -1; // blanks last
      const d = isNum(x) && isNum(y) ? num(x) - num(y) : x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
      return d * dir;
    });
    const out = rows.map((r) => [...r]);
    idx.forEach((from, i) => (out[r0 + i] = rows[from].map((v) => moveRefs(v, r0 + i - from, 0))));
    const to = new Map(idx.map((from, i) => [from, r0 + i])); // cell formats and styles travel with their rows
    const a = this.a();
    this.set({ rows: out, fmt: moveRows(this.node.attrs.fmt, to), ...(a.cells ? { a: { ...a, cells: moveRows(a.cells, to) } } : {}) });
  }

  private remove() {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
    this.view.focus();
    toast("Sheet deleted — Ctrl+Z brings it back.");
  }

  /** The format menu: whole columns get a column format, other selections a per-cell one. */
  private async pickFormat() {
    let code = this.fmtPick.value;
    if (code === "*") {
      const cur = this.formatAt(this.focus);
      const f = await ask('Number format (Excel style, e.g. 0.00, #,##0, 0%, 0.00 "€", yyyy-mm-dd). Empty = General.', cur);
      if (f === null) return this.render();
      code = f.trim();
    }
    this.setFormat(code);
    this.grid.focus();
  }
  /** Number format for the selection: whole columns when every row is selected, else each cell. */
  private setFormat(code: string | ((cur: string, p: Pos) => string)) {
    const at = (p: Pos) => (typeof code === "string" ? code : code(this.formatAt(p), p));
    const R = this.rect(), m = this.fmts();
    const whole = R.r0 === 0 && R.r1 === this.size().h - 1;
    for (let c = R.c0; c <= R.c1; c++) {
      const col = colName(c);
      if (whole) {
        const f = at({ r: R.r1, c });
        for (const k of [...m.keys()]) if (k.replace(/\d+$/, "") === col && k !== col) m.delete(k);
        f ? m.set(col, f) : m.delete(col);
      } else {
        for (let r = R.r0; r <= R.r1; r++) {
          const f = at({ r, c });
          f ? m.set(`${col}${r + 1}`, f) : m.delete(`${col}${r + 1}`);
        }
      }
    }
    this.set({ fmt: [...m].map(([k, v]) => `${k}:${v}`).join(";") });
  }
  private decimals(dir: 1 | -1) {
    const shown = calcResult().values[this.node.attrs.id] ?? [];
    this.setFormat((cur, p) => stepDecimals(cur, dir, shown[p.r]?.[p.c] ?? ""));
    this.grid.focus();
  }
  /** AutoSum: a range of numbers gets totals in the row under it; a single cell sums the numbers above it (or to its left). */
  private autoSum() {
    const R = this.rect(), { h } = this.size();
    const nums = calcResult().numeric[this.node.attrs.id] ?? [];
    const isN = (r: number, c: number) => !!nums[r]?.[c];
    const sum = (a: Pos, b: Pos) => `=SUM(${colName(a.c)}${a.r + 1}:${colName(b.c)}${b.r + 1})`;
    if (R.r1 > R.r0 || R.c1 > R.c0) {
      if (R.r1 === h - 1 || this.rows()[R.r1 + 1].slice(R.c0, R.c1 + 1).some((v) => v !== "")) this.structure("row", R.r1 + 1, 1);
      const rows = this.rows();
      for (let c = R.c0; c <= R.c1; c++) rows[R.r1 + 1][c] = sum({ r: R.r0, c }, { r: R.r1, c });
      this.setRows(rows);
      return this.select({ r: R.r1 + 1, c: R.c1 });
    }
    const p = this.focus;
    let r = p.r;
    while (r > 0 && isN(r - 1, p.c)) r--;
    if (r < p.r) return (this.commit(p, sum({ r, c: p.c }, { r: p.r - 1, c: p.c })), this.select(p));
    let c = p.c;
    while (c > 0 && isN(p.r, c - 1)) c--;
    if (c < p.c) return (this.commit(p, sum({ r: p.r, c }, { r: p.r, c: p.c - 1 })), this.select(p));
    toast("AutoSum: put the cursor under (or right of) a list of numbers, or select the numbers.");
  }
  private formatAt(p: Pos): string {
    const m = this.fmts();
    return m.get(`${colName(p.c)}${p.r + 1}`) ?? m.get(colName(p.c)) ?? "";
  }

  // ── drawing ──
  private td(p: Pos) {
    return this.grid.querySelector(`td[data-r="${p.r}"][data-c="${p.c}"]`) as HTMLElement | null;
  }
  private render() {
    if (this.editing) return;
    const rows = this.node.attrs.rows as string[][];
    const head = this.node.attrs.head as number;
    const id = this.node.attrs.id as string;
    const vals = calcResult().values[id] ?? [];
    const nums = calcResult().numeric[id] ?? [];
    const { h, w } = this.size();
    this.focus = { r: Math.min(this.focus.r, h - 1), c: Math.min(this.focus.c, w - 1) };
    this.anchor = { r: Math.min(this.anchor.r, h - 1), c: Math.min(this.anchor.c, w - 1) };
    const widths = this.widths();
    const styles = parseStyles(this.a().cells ?? "");
    const t = this.grid;
    // rebuild the frame only when the grid's shape changes; cells are patched in place, so an edit touches only what changed
    const shape = `${h}x${w}|${[...widths]}`;
    if (t.dataset.shape !== shape) {
      t.dataset.shape = shape;
      t.textContent = "";
      const cg = el("colgroup", "");
      cg.append(el("col", "jw-col-head"));
      for (let c = 0; c < w; c++) {
        const col = el("col", "");
        const px = widths.get(colName(c));
        if (px) col.style.width = `${px}px`;
        cg.append(col);
      }
      t.append(cg);
      const hr = t.insertRow();
      const corner = el("th", "jw-corner");
      corner.title = "Select all (Ctrl+A)";
      hr.append(corner);
      for (let c = 0; c < w; c++) {
        const th = el("th", "", colName(c));
        th.dataset.c = String(c);
        th.title = `Column ${colName(c)} — click to select, drag the edge to resize`;
        const grip = el("span", "jw-col-grip");
        grip.dataset.c = String(c);
        th.append(grip);
        hr.append(th);
      }
      for (let r = 0; r < h; r++) {
        const tr = t.insertRow();
        const th = el("th", "", String(r + 1));
        th.dataset.r = String(r);
        tr.append(th);
        for (let c = 0; c < w; c++) {
          const td = el("td", "");
          td.dataset.r = String(r);
          td.dataset.c = String(c);
          tr.append(td);
        }
      }
    }
    const found = new Map(this.hits.cells.map((x) => [`${x.r},${x.c}`, x.r === this.hits.cur?.r && x.c === this.hits.cur?.c]));
    rows.forEach((row, r) => {
      const tr = t.rows[r + 1];
      for (let c = 0; c < w; c++) {
        const src = row[c] ?? "";
        const shown = vals[r]?.[c] ?? src;
        const err = ERRORS[shown];
        const hit = found.get(`${r},${c}`);
        const cls = [r < head ? "head" : "", nums[r]?.[c] ? "num" : "", err ? "err" : "", hit !== undefined ? "found" : "", hit ? "found-cur" : ""]
          .filter(Boolean).join(" ");
        const css = styles.length ? styleCss(styleAt(styles, r, c, head)) : "";
        const title = err ? `${err}${src.startsWith("=") ? `\n${src}` : ""}` : src.startsWith("=") ? src : "";
        const key = `${cls}\0${shown}\0${css}\0${title}`;
        const td = tr.cells[c + 1];
        if (td.dataset.k === key) continue;
        td.dataset.k = key;
        td.className = cls;
        td.textContent = shown;
        td.style.cssText = css;
        td.title = title;
      }
    });
    this.paint();
  }

  /** Everything that follows the cell cursor. A move repaints only this, not the whole grid (1000-row sheets stay instant). */
  private paint() {
    if (this.editing) return;
    const rows = this.node.attrs.rows as string[][];
    const head = this.node.attrs.head as number;
    const id = this.node.attrs.id as string;
    const vals = calcResult().values[id] ?? [];
    const nums = calcResult().numeric[id] ?? [];
    const R = this.rect();
    const t = this.grid;
    for (const x of t.querySelectorAll(".in, .sel, .fill-pre, th.on")) x.classList.remove("in", "sel", "fill-pre", "on");
    t.querySelector(".jw-fill-handle")?.remove();
    const cell = (r: number, c: number) => t.rows[r + 1]?.cells[c + 1];
    for (let c = R.c0; c <= R.c1; c++) cell(-1, c)?.classList.add("on");
    for (let r = R.r0; r <= R.r1; r++) {
      cell(r, -1)?.classList.add("on");
      for (let c = R.c0; c <= R.c1; c++) cell(r, c)?.classList.add("in");
    }
    cell(this.focus.r, this.focus.c)?.classList.add("sel");
    const f = this.fillTo;
    if (f) {
      for (let i = 1; i <= f.n; i++) {
        if (f.axis === "row") { for (let c = R.c0; c <= R.c1; c++) cell(R.r1 + i, c)?.classList.add("fill-pre"); }
        else for (let r = R.r0; r <= R.r1; r++) cell(r, R.c1 + i)?.classList.add("fill-pre");
      }
    }
    const fh = el("span", "jw-fill-handle");
    fh.title = "Drag to fill: continues 1, 2, 3 · Jan, Feb · Monday · Item 1 — or copies";
    cell(R.r1, R.c1)?.append(fh);
    const styles = parseStyles(this.a().cells ?? "");
    const a = `${colName(R.c0)}${R.r0 + 1}`, b = `${colName(R.c1)}${R.r1 + 1}`;
    this.ref.textContent = a === b ? `${id}!${a}` : `${id}!${a}:${b}`;
    if (a !== b) lastRange = this.ref.textContent;
    if (document.activeElement !== this.bar) this.bar.value = rows[this.focus.r]?.[this.focus.c] ?? "";
    // number format menu shows the focus cell's format
    const cur = this.formatAt(this.focus);
    const opts = [
      ...FORMATS,
      ...(cur && !FORMATS.some(([, f]) => f === cur) ? [[`Custom ${cur}`, cur] as [string, string]] : []),
      ["Custom…", "*"] as [string, string],
    ];
    this.fmtPick.replaceChildren(...opts.map(([l, v]) => Object.assign(el("option", "", l) as HTMLOptionElement, { value: v })));
    this.fmtPick.value = cur;
    const st = styleAt(styles, this.focus.r, this.focus.c, head);
    for (
      const [b, on] of [
        [this.boldBtn, st.b ?? this.focus.r < head],
        [this.italicBtn, !!st.i],
        [this.wrapBtn, !!st.wr],
        [this.borderBtn, !!st.bd],
      ] as const
    ) {
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    this.alignPick.value = st.al ?? "";
    setPick(this.fillPick, st.bg ?? "", "Fill");
    setPick(this.inkPick, st.fg ?? "", "Text");
    this.headBtn.classList.toggle("on", !!head);
    this.headBtn.setAttribute("aria-pressed", String(!!head));
    // quick totals for a numeric selection, like Excel's status bar
    const picked: number[] = [];
    if (R.r1 > R.r0 || R.c1 > R.c0) {
      for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) if (nums[r]?.[c] && isNum(vals[r]?.[c] ?? "")) picked.push(num(vals[r][c]));
    }
    const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
    this.stats.textContent = picked.length
      ? `Sum ${fmt(picked.reduce((s, x) => s + x, 0))} · Average ${fmt(picked.reduce((s, x) => s + x, 0) / picked.length)} · Count ${picked.length}`
      : "";
  }

  update(node: M.Node, decos: readonly V.Decoration[] = []): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const hits = hitsOf(decos);
    const moved = hits.cur && (hits.cur.r !== this.hits.cur?.r || hits.cur.c !== this.hits.cur?.c);
    this.hits = hits;
    if (moved && !this.editing) {
      // Find ▸ Next landed in this sheet: put the cell cursor on the match
      this.focus = this.anchor = hits.cur!;
      requestAnimationFrame(() => this.grid.querySelector(".sel")?.scrollIntoView({ block: "nearest", inline: "nearest" }));
    }
    this.grid.setAttribute("aria-label", `Sheet ${node.attrs.id}`);
    const name = this.dom.querySelector<HTMLInputElement>(".jw-sheet-name");
    if (name && document.activeElement !== name) name.value = node.attrs.id;
    this.render();
    return true;
  }
  stopEvent(): boolean {
    return true;
  }
  ignoreMutation(): boolean {
    return true;
  }
  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
  }
  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
  }
  destroy() {
    this.off();
    removeEventListener("mouseup", this.up);
  }
}

const CELL_FILLS: [string, string][] = [
  ["Fill", ""],
  ["Yellow", "#fff3a3"],
  ["Green", "#d8f3dc"],
  ["Blue", "#dbeafe"],
  ["Red", "#fde2e1"],
  ["Orange", "#ffe5cc"],
  ["Grey", "#eceff1"],
];
const CELL_INKS: [string, string][] = [
  ["Text colour", ""],
  ["Red", "#c0392b"],
  ["Green", "#1e7b3a"],
  ["Blue", "#1a5fb4"],
  ["Orange", "#c2570c"],
  ["Grey", "#6b7280"],
];

/** A colour select shows the current value, adding a "Custom" entry for one not in its list. */
function setPick(s: HTMLSelectElement, v: string, label: string) {
  s.querySelector("option[data-custom]")?.remove();
  if (v && ![...s.options].some((o) => o.value === v)) {
    s.append(Object.assign(el("option", "", `${label}: ${v}`) as HTMLOptionElement, { value: v }));
    s.lastElementChild!.setAttribute("data-custom", "");
  }
  s.value = v;
  s.style.boxShadow = v ? `inset 4px 0 0 ${v}` : "";
}

/** F4 in a formula: cycle `$` on the reference at the caret. */
function refCycle(inp: HTMLInputElement) {
  const r = cycleRef(inp.value, inp.selectionStart ?? inp.value.length);
  if (!r) return;
  inp.value = r.text;
  inp.setSelectionRange(r.caret, r.caret);
  inp.dispatchEvent(new Event("input"));
}

const hitsOf = (decos: readonly V.Decoration[]): SheetHits =>
  (decos.find((d) => (d.spec as { find?: SheetHits }).find)?.spec as { find?: SheetHits } | undefined)?.find ?? { cells: [], cur: null };

function el(tag: string, cls: string, text = ""): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
const sep = () => el("span", "jw-sheet-sep");

function cellOf(t: EventTarget | null): Pos | null {
  const td = (t as HTMLElement | null)?.closest?.("td[data-r]") as HTMLElement | null;
  return td ? { r: +td.dataset.r!, c: +td.dataset.c! } : null;
}

function firstSheetId(doc: M.Node): string {
  let id = "";
  doc.descendants((n) => {
    if (!id && n.type.name === "sheet") id = n.attrs.id;
    return !id;
  });
  return id;
}

/** Column / cell number formats follow inserted or deleted rows and columns. */
function shiftFormats(fmt: string, axis: "row" | "col", at: number, count: number): string {
  return String(fmt || "").split(";").filter((x) => x.includes(":")).flatMap((x) => {
    const [k, v] = x.split(/:(.*)/s, 2);
    const m = /^([A-Z]+)(\d*)$/.exec(k);
    if (!m) return [x];
    let c = colIndex(m[1]), r = m[2] ? +m[2] - 1 : -1;
    if (axis === "col") {
      if (c >= at) {
        if (count < 0 && c < at - count) return [];
        c += count;
      }
    } else if (r >= at) {
      if (count < 0 && r < at - count) return [];
      r += count;
    }
    return [`${colName(c)}${r >= 0 ? r + 1 : ""}:${v}`];
  }).join(";");
}

function shiftWidths(widths: string, at: number, count: number): string {
  return widths.split(";").filter((x) => x.includes(":")).flatMap((x) => {
    const [k, v] = x.split(":");
    let c = colIndex(k);
    if (c >= at) {
      if (count < 0 && c < at - count) return [];
      c += count;
    }
    return [`${colName(c)}:${v}`];
  }).join(";");
}
