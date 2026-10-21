// Node views for atoms: media, shapes, charts, live calc values, math, footnotes, raw blocks, TOC.
import { jumpTo } from "./outline.ts";
import { state } from "../vendor/pm.js";
import type { model as M, view as V } from "../vendor/pm.js";
import { calcResult, currentSheets, getZoom, lookup, MM, subscribe, urlFor } from "./store.ts";
import { codeLangs, gridFormat, mathHtml, renderHtml } from "../core/index.ts";
import { domAttrs } from "./schema.ts";
import { SheetView } from "./sheetview.ts";
import { type Box, type Ends, endsOf, fromEnds, handleAt, HANDLES, isLine, moveEnd, resizeBox } from "./shapegeo.ts";
import { ask, form, toast } from "../ui/dialog.ts";

type GetPos = () => number | undefined;
type Factory = (n: M.Node, v: V.EditorView, p: GetPos, d: readonly V.Decoration[]) => V.NodeView;

const h = (tag: string, cls = "", text = ""): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

function setAttrs(v: V.EditorView, p: GetPos, n: M.Node, attrs: Record<string, unknown>) {
  const pos = p();
  if (pos !== undefined) v.dispatch(v.state.tr.setNodeMarkup(pos, null, { ...n.attrs, ...attrs }));
}

/** Base for atom views that redraw on any change. */
abstract class Atom implements V.NodeView {
  dom: HTMLElement;
  protected off?: () => void;
  constructor(public node: M.Node, protected view: V.EditorView, protected getPos: GetPos, tag = "div", cls = "") {
    this.dom = h(tag, cls);
    this.dom.contentEditable = "false";
  }
  abstract draw(): void;
  update(n: M.Node) {
    if (n.type !== this.node.type) return false;
    this.node = n;
    this.draw();
    return true;
  }
  ignoreMutation() {
    return true;
  }
  destroy() {
    this.off?.();
  }
}

// ── image / video / audio with a resize handle ──
class MediaView extends Atom {
  constructor(n: M.Node, v: V.EditorView, p: GetPos) {
    super(n, v, p, "span", "jw-media");
    this.draw();
  }
  draw() {
    const { url, mime } = urlFor(this.node.attrs.src);
    const a = this.node.attrs.a as Record<string, string>;
    this.dom.textContent = "";
    const media = mime.startsWith("video/")
      ? h("video") as HTMLVideoElement
      : mime.startsWith("audio/")
      ? h("audio") as HTMLAudioElement
      : h("img") as HTMLImageElement;
    if (media instanceof HTMLMediaElement) media.controls = true;
    if (url) (media as HTMLImageElement).src = url;
    else this.dom.classList.add("missing");
    media.setAttribute("alt", this.node.attrs.alt);
    media.title = this.node.attrs.alt || this.node.attrs.src;
    Object.assign(media, domAttrs(a));
    const st = domAttrs(a).style;
    if (st) media.setAttribute("style", st);
    media.draggable = false;
    const grip = h("span", "jw-grip");
    grip.onmousedown = (e) => this.resize(e, media);
    this.dom.append(media, grip);
  }
  private resize(e: MouseEvent, media: HTMLElement) {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = media.getBoundingClientRect().width / getZoom();
    const max = (this.view.dom as HTMLElement).clientWidth - 2; // never wider than the text column
    const mv = (ev: MouseEvent) => (media.style.width = `${Math.min(max, Math.max(24, w0 + (ev.clientX - x0) / getZoom()))}px`);
    const up = () => {
      removeEventListener("mousemove", mv);
      removeEventListener("mouseup", up);
      const mm = (parseFloat(media.style.width) / MM).toFixed(1).replace(/\.0$/, "");
      const { height: _h, ...a } = this.node.attrs.a as Record<string, string>; // keep the aspect ratio
      setAttrs(this.view, this.getPos, this.node, { a: { ...a, width: `${mm}mm` } });
      const pos = this.getPos(); // the picture stays selected, like Word
      if (pos !== undefined) this.view.dispatch(this.view.state.tr.setSelection(state.NodeSelection.create(this.view.state.doc, pos)));
    };
    addEventListener("mousemove", mv);
    addEventListener("mouseup", up);
  }
  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
  }
  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
  }
}

// ── shapes: float over the next block; drag to move, handles to resize, line ends to point anywhere ──
const mm = (s: string) => parseFloat(s) * (s.endsWith("px") ? 1 / MM : s.endsWith("cm") ? 10 : s.endsWith("in") ? 25.4 : 1);

/** Shape views by their DOM, so Enter / F2 on a selected shape can start typing in it. */
const shapes = new WeakMap<Element, ShapeView>();

/** Enter / F2 on a selected shape or text box: type in it. Arrow keys: move it. */
export const shapeKeys = new state.Plugin({
  props: {
    handleKeyDown: (v, e) => ((e.key === "Enter" || e.key === "F2") && !e.ctrlKey && !e.metaKey && editSelectedShape(v)) || nudge(v, e),
  },
});

/** Start typing in the selected shape (Enter / F2). False when no shape is selected. */
export function editSelectedShape(v: V.EditorView): boolean {
  const s = v.state.selection;
  if (!(s instanceof state.NodeSelection) || s.node.type.name !== "shape") return false;
  const view = shapes.get(v.nodeDOM(s.from) as Element);
  return !!view && (view.editText(), true);
}

class ShapeView extends Atom {
  private box = h("div", "jw-shape-box");
  private editing: HTMLElement | null = null;
  constructor(n: M.Node, v: V.EditorView, p: GetPos) {
    super(n, v, p, "div", "jw-shape-anchor");
    this.dom.append(this.box);
    shapes.set(this.dom, this);
    this.box.onmousedown = (e) => {
      if (this.editing || (e.target as Element).closest(".jw-handle")) return;
      this.drag(e, (dx, dy, b) => ({ ...b, x: b.x + dx, y: b.y + dy }));
    };
    this.box.ondblclick = () => this.editText();
    this.draw();
  }
  /** Type in the shape itself (PowerPoint): Esc or a click outside keeps the text, Ctrl+Enter too; Enter is a new line. */
  editText() {
    const txt = this.box.querySelector<HTMLElement>(".jw-shape-text");
    if (!txt || this.editing) return;
    this.editing = txt;
    txt.contentEditable = "plaintext-only";
    txt.classList.add("editing");
    txt.focus();
    getSelection()?.selectAllChildren(txt);
    const done = () => {
      if (this.editing !== txt) return;
      this.editing = null;
      const text = txt.innerText.replace(/\n+$/, "");
      txt.contentEditable = "false";
      txt.classList.remove("editing");
      if (text !== this.node.attrs.text) setAttrs(this.view, this.getPos, this.node, { text });
      else this.draw();
      this.view.focus();
    };
    txt.onblur = done;
    txt.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) (e.preventDefault(), done());
    };
  }
  private geo(): Box {
    const a = this.node.attrs;
    return { x: mm(a.x), y: mm(a.y), w: mm(a.w), h: mm(a.h) };
  }
  private from = () => String((this.node.attrs.a as Record<string, string> | undefined)?.from ?? "");
  draw() {
    const a = this.node.attrs;
    const b = this.geo();
    const t = (a.a ?? {}) as Record<string, string>;
    Object.assign(this.box.style, {
      left: `${b.x}mm`,
      top: `${b.y}mm`,
      width: `${b.w}mm`,
      height: `${b.h}mm`,
      transform: t.rotate ? `rotate(${t.rotate}deg)` : "",
    });
    const sw = 1.5;
    const common = `fill="${esc(a.fill)}" stroke="${esc(a.stroke)}" stroke-width="${sw}"`;
    const line = isLine(a.kind);
    // a line runs between its two ends (in % of the box, so the saved file draws the same); a wide clear stroke makes it easy to grab
    const e = line ? endsOf({ x: 0, y: 0, w: b.w, h: b.h }, a.kind, this.from()) : null;
    const pc = (v: number, of: number) => (of ? `${(v / of) * 100}%` : "0");
    const xy = e ? `x1="${pc(e.x1, b.w)}" y1="${pc(e.y1, b.h)}" x2="${pc(e.x2, b.w)}" y2="${pc(e.y2, b.h)}"` : "";
    const hit = e ? `<line ${xy} stroke="transparent" stroke-width="14" pointer-events="stroke"/>` : "";
    const shape = ({
      ellipse: `<ellipse cx="50%" cy="50%" rx="calc(50% - ${sw}px)" ry="calc(50% - ${sw}px)" ${common}/>`,
      line: `<line ${xy} ${common}/>`,
      arrow: `<defs><marker id="${
        arrowId(a.stroke)
      }" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="${
        esc(a.stroke)
      }"/></marker></defs><line ${xy} ${common} marker-end="url(#${arrowId(a.stroke)})"/>`,
      roundrect: `<rect x="${sw}" y="${sw}" width="calc(100% - ${2 * sw}px)" height="calc(100% - ${2 * sw}px)" rx="12" ${common}/>`,
    } as Record<string, string>)[a.kind] ?? `<rect x="${sw}" y="${sw}" width="calc(100% - ${2 * sw}px)" height="calc(100% - ${2 * sw}px)" ${common}/>`;
    this.box.innerHTML = `<svg width="100%" height="100%">${shape}${hit}</svg>`;
    this.box.classList.toggle("line", line);
    const txt = h("div", "jw-shape-text", a.text);
    // text look (Shape ▸ Text): size, colour, alignment — the same attributes the saved file reads
    const flex = { left: "flex-start", right: "flex-end", center: "center" }[t.align ?? ""] ?? "";
    Object.assign(txt.style, { fontSize: t.size ?? "", color: t.color ?? "", textAlign: t.align ?? "", justifyContent: flex });
    this.box.append(txt, ...(e ? this.endHandles(e, b) : this.boxHandles()));
  }
  /** Eight handles: drag any edge or corner; the opposite side stays put. Shift on a corner keeps the proportions. */
  private boxHandles(): HTMLElement[] {
    return HANDLES.map((hd) => {
      const el = h("span", `jw-handle ${hd}`);
      const [fx, fy] = handleAt(hd);
      Object.assign(el.style, { left: `${fx * 100}%`, top: `${fy * 100}%` });
      el.title = "Drag to resize (Shift keeps the proportions)";
      el.onmousedown = (ev) => this.drag(ev, (dx, dy, b, shift) => resizeBox(b, hd, dx, dy, shift));
      return el;
    });
  }
  /** A handle on each end of a line / arrow: drag either end anywhere. Shift keeps the line at 0°, 45°, 90° … */
  private endHandles(e: Ends, b: Box): HTMLElement[] {
    return ([1, 2] as const).map((end) => {
      const el = h("span", `jw-handle end end${end}`);
      const [x, y] = end === 1 ? [e.x1, e.y1] : [e.x2, e.y2];
      Object.assign(el.style, { left: `${x}mm`, top: `${y}mm` });
      el.title = end === 1 ? "Drag to move the start (Shift: straight or 45°)" : "Drag to move the end (Shift: straight or 45°)";
      el.onmousedown = (ev) => {
        const abs = endsOf(b, this.node.attrs.kind, this.from());
        const [px, py] = end === 1 ? [abs.x1, abs.y1] : [abs.x2, abs.y2];
        this.drag(ev, (dx, dy, _b, shift) => fromEnds(moveEnd(abs, end, px + dx, py + dy, shift)));
      };
      return el;
    });
  }
  /** Mouse drag: `f` maps the mm moved (and Shift) to the new box; the box follows live, the document changes once on release. */
  private drag(e: MouseEvent, f: (dx: number, dy: number, b: Box, shift: boolean) => Box & { from?: string }) {
    e.preventDefault();
    e.stopPropagation();
    const pos = this.getPos();
    if (pos !== undefined) this.view.dispatch(this.view.state.tr.setSelection(sel(this.view, pos)));
    const [x0, y0] = [e.clientX, e.clientY];
    const start = this.geo();
    let last: (Box & { from?: string }) | null = null;
    const mv = (ev: MouseEvent) => {
      last = f((ev.clientX - x0) / getZoom() / MM, (ev.clientY - y0) / getZoom() / MM, start, ev.shiftKey);
      Object.assign(this.box.style, { left: `${last.x}mm`, top: `${last.y}mm`, width: `${last.w}mm`, height: `${last.h}mm` });
      if (last.from !== undefined) this.box.querySelector("svg")?.replaceChildren(); // the line is redrawn on release
    };
    const up = () => {
      removeEventListener("mousemove", mv);
      removeEventListener("mouseup", up);
      if (last) moveShape(this.view, this.getPos, this.node, last);
      else this.draw();
    };
    addEventListener("mousemove", mv);
    addEventListener("mouseup", up);
  }
  stopEvent(e: Event) {
    return !!this.editing || e.type.startsWith("mouse") || e.type === "dblclick";
  }
  override update(n: M.Node): boolean {
    if (!this.editing) return super.update(n);
    if (n.type !== this.node.type) return false;
    this.node = n; // keep up, but never redraw under the typing
    return true;
  }
  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
  }
  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
  }
}

/** Write a shape's new box (and a line's start corner) back to the document, as mm. */
function moveShape(v: V.EditorView, p: GetPos, n: M.Node, b: Box & { from?: string }) {
  const r = (x: number) => `${Math.round(x * 10) / 10}mm`;
  const attrs: Record<string, unknown> = { x: r(b.x), y: r(b.y), w: r(b.w), h: r(b.h) };
  if (b.from !== undefined) attrs.a = { ...(n.attrs.a ?? {}), from: b.from };
  setAttrs(v, p, n, attrs);
}

/** Arrow keys move the selected shape by 1 mm (Ctrl: 0.2 mm), like PowerPoint. */
function nudge(v: V.EditorView, e: KeyboardEvent): boolean {
  const s = v.state.selection;
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!d || e.altKey || e.shiftKey || !(s instanceof state.NodeSelection) || s.node.type.name !== "shape") return false;
  const k = e.ctrlKey || e.metaKey ? 0.2 : 1;
  const a = s.node.attrs;
  moveShape(v, () => s.from, s.node, { x: mm(a.x) + d[0] * k, y: mm(a.y) + d[1] * k, w: mm(a.w), h: mm(a.h) });
  return true;
}

const sel = (v: V.EditorView, pos: number) => state.NodeSelection.create(v.state.doc, pos);
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// ── chart: same SVG as the saved file, rendered by the core ──
class ChartView extends Atom {
  constructor(n: M.Node, v: V.EditorView, p: GetPos) {
    super(n, v, p, "div", "jw-chartview");
    this.off = subscribe(() => this.draw());
    this.dom.ondblclick = async () => {
      const r = await chartForm("Edit chart", this.node.attrs.data, this.node.attrs.type, this.node.attrs.title);
      if (r) setAttrs(this.view, this.getPos, this.node, r);
    };
    this.draw();
  }
  draw() {
    const a = this.node.attrs;
    const sheets = currentSheets().map((s) => ({ t: "raw", format: "sheet", a: { id: s.id, fmt: s.fmt }, s: gridFormat(s.rows, s.head) }));
    const html = renderHtml({ t: "doc", c: [...sheets, { t: "div", class: "chart", a: { type: a.type, data: a.data, title: a.title }, c: [] }] });
    const i = html.indexOf("<figure");
    this.dom.innerHTML = i >= 0 ? html.slice(i) : `<p class="jw-hint">Chart: double-click to choose data</p>`;
    this.dom.title = "Double-click to change the data, type or title";
  }
  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
  }
  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
  }
}

/** One dialog for inserting and editing a chart. */
/** Chart types: stored code ↔ the name people see. */
const CHART_TYPES: [code: string, name: string][] = [
  ["bar", "Columns"],
  ["stacked", "Stacked columns"],
  ["hbar", "Bars (horizontal)"],
  ["line", "Line"],
  ["area", "Area"],
  ["pie", "Pie"],
  ["donut", "Donut"],
];

export async function chartForm(title: string, data: string, type: string, name: string) {
  const shown = (CHART_TYPES.find(([c]) => c === (type || "bar")) ?? CHART_TYPES[0])[1];
  const r = await form(title, [
    { key: "data", label: "Data (first row = series names, first column = labels), e.g. Sales!A1:C5", value: data },
    { key: "type", label: "Type", value: shown, options: CHART_TYPES.map(([, n]) => n) },
    { key: "title", label: "Title", value: name },
  ]);
  const code = CHART_TYPES.find(([, n]) => n === r?.type)?.[0] ?? "bar";
  return r ? { data: r.data.trim(), type: code, title: r.title.trim() } : null;
}

// ── inline live value from a sheet ──
class CalcView extends Atom {
  constructor(n: M.Node, v: V.EditorView, p: GetPos) {
    super(n, v, p, "span", "jw-calc");
    this.off = subscribe(() => this.draw());
    this.dom.ondblclick = async () => {
      const r = await ask("Cell reference (e.g. Sales!D4)", this.node.attrs.ref);
      if (r) setAttrs(this.view, this.getPos, this.node, { ref: r });
    };
    this.draw();
  }
  draw() {
    const v = Object.keys(calcResult().values).length ? lookup(this.node.attrs.ref) : this.node.attrs.cached;
    this.dom.textContent = v || "?";
    this.dom.title = `= ${this.node.attrs.ref}`;
  }
}

class MathView extends Atom {
  constructor(n: M.Node, v: V.EditorView, p: GetPos) {
    super(n, v, p, "span", "jw-math");
    this.dom.ondblclick = async () => {
      const t = await ask("Equation (LaTeX)", this.node.attrs.tex);
      if (t !== null) setAttrs(this.view, this.getPos, this.node, { tex: t });
    };
    this.draw();
  }
  draw() {
    this.dom.innerHTML = mathHtml(this.node.attrs.tex, this.node.attrs.display);
    this.dom.title = `${this.node.attrs.tex} — double-click to edit`;
    this.dom.classList.toggle("display", this.node.attrs.display);
  }
}

class FootRefView extends Atom {
  constructor(n: M.Node, v: V.EditorView, p: GetPos) {
    super(n, v, p, "sup", "jw-fnref");
    this.dom.onmousedown = (e) => e.preventDefault();
    this.dom.onclick = () => this.note()?.dom.scrollIntoView({ behavior: "smooth", block: "center" });
    this.off = subscribe(() => this.draw());
    this.draw();
  }
  /** The footnote block this reference points to. */
  private note(): { node: M.Node; dom: HTMLElement } | null {
    let hit: { node: M.Node; dom: HTMLElement } | null = null;
    this.view.state.doc.forEach((n, off) => {
      if (!hit && n.type.name === "footnote" && n.attrs.label === this.node.attrs.label) {
        const dom = this.view.nodeDOM(off);
        if (dom instanceof HTMLElement) hit = { node: n, dom };
      }
    });
    return hit;
  }
  draw() {
    this.dom.textContent = `[${this.node.attrs.label}]`;
    const text = this.note()?.node.textContent;
    this.dom.title = text ? `${text}\n(click to go to the footnote)` : "Footnote";
  }
}

class RawView extends Atom {
  constructor(n: M.Node, v: V.EditorView, p: GetPos) {
    super(n, v, p, "div", "jw-raw");
    this.dom.ondblclick = async () => {
      const t = await ask(`Raw ${this.node.attrs.format} block`, this.node.attrs.text, true);
      if (t !== null) setAttrs(this.view, this.getPos, this.node, { text: t });
    };
    this.draw();
  }
  draw() {
    this.dom.textContent = "";
    this.dom.append(h("span", "jw-raw-label", this.node.attrs.format), h("pre", "", this.node.attrs.text));
    this.dom.title = "Double-click to edit";
  }
}

class TocView extends Atom {
  constructor(n: M.Node, v: V.EditorView, p: GetPos) {
    super(n, v, p, "nav", "jw-toc");
    this.off = subscribe(() => this.draw());
    this.draw();
  }
  draw() {
    const depth = Number(this.node.attrs.depth) || 3;
    const ol = h("ol");
    const heads = (doc: M.Node) => {
      const out: { level: number; text: string; pos: number }[] = [];
      doc.descendants((n, pos) => {
        if (n.type.name === "heading" && n.attrs.level <= depth) out.push({ level: n.attrs.level, text: n.textContent, pos });
        return n.type.name !== "heading";
      });
      return out;
    };
    heads(this.view.state.doc).forEach((hd, i) => {
      const a = h("a", "", hd.text) as HTMLAnchorElement;
      a.href = "#";
      a.title = "Go to this heading";
      a.onmousedown = (e) => e.preventDefault();
      a.onclick = (e) => {
        e.preventDefault();
        const now = heads(this.view.state.doc)[i]; // positions move as the text is edited
        if (now) jumpTo(this.view, now);
      };
      const li = h("li", `l${hd.level}`);
      li.append(a);
      ol.append(li);
    });
    this.dom.textContent = "";
    this.dom.append(h("div", "jw-toc-title", "Contents"), ol);
  }
}

// ── code block: editable text plus a language picker and Copy (editor-only bar, never saved) ──
let LANGS: [string, string][] | null = null;
class CodeView implements V.NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private bar: HTMLElement;
  private pick: HTMLSelectElement;
  constructor(public node: M.Node, view: V.EditorView, getPos: GetPos) {
    this.dom = h("pre", "jw-code");
    this.bar = h("div", "jw-code-bar");
    this.bar.contentEditable = "false";
    this.pick = h("select") as HTMLSelectElement;
    this.pick.setAttribute("aria-label", "Code language");
    this.pick.title = "Language (colours the code)";
    this.pick.onchange = () => setAttrs(view, getPos, this.node, { lang: this.pick.value });
    const copy = h("button", "", "Copy") as HTMLButtonElement;
    copy.type = "button";
    copy.title = "Copy the code";
    copy.setAttribute("aria-label", "Copy code");
    copy.onclick = () => navigator.clipboard.writeText(this.node.textContent).then(() => toast("Code copied"), () => toast("Could not copy", "error"));
    this.bar.append(this.pick, copy);
    this.contentDOM = h("code");
    this.dom.append(this.bar, this.contentDOM);
    this.sync();
  }
  private sync() {
    const lang = this.node.attrs.lang as string;
    LANGS ??= codeLangs();
    const opts: [string, string][] = [["", "Plain text"], ...LANGS];
    if (lang && !opts.some(([v]) => v === lang)) opts.push([lang, lang]);
    if (this.pick.options.length !== opts.length || this.pick.dataset.extra !== lang) {
      this.pick.replaceChildren(...opts.map(([v, l]) => Object.assign(h("option", "", l) as HTMLOptionElement, { value: v })));
      this.pick.dataset.extra = lang;
    }
    this.pick.value = lang;
    this.dom.dataset.lang = lang;
  }
  update(n: M.Node) {
    if (n.type !== this.node.type) return false;
    this.node = n;
    this.sync();
    return true;
  }
  stopEvent(e: Event) {
    return this.bar.contains(e.target as Node);
  }
  ignoreMutation(m: V.ViewMutationRecord) {
    return this.bar.contains(m.target as Node);
  }
}

export const nodeViews: Record<string, Factory> = {
  code_block: (n, v, p) => new CodeView(n, v, p),
  image: (n, v, p) => new MediaView(n, v, p),
  shape: (n, v, p) => new ShapeView(n, v, p),
  chart: (n, v, p) => new ChartView(n, v, p),
  calc: (n, v, p) => new CalcView(n, v, p),
  math: (n, v, p) => new MathView(n, v, p),
  footnote_ref: (n, v, p) => new FootRefView(n, v, p),
  raw_block: (n, v, p) => new RawView(n, v, p),
  toc: (n, v, p) => new TocView(n, v, p),
  sheet: (n, v, p, d) => new SheetView(n, v, p, d),
};

/** One arrowhead per colour: ids are page-wide, so a shared id gave every arrow the first arrow's colour. */
const arrowId = (stroke: string) => `ah-${String(stroke).replace(/[^a-z0-9]/gi, "") || "x"}`;
