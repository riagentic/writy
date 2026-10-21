// ProseMirror schema — mirrors the XAST (core/src/ast.rs) one-to-one where it can.
// Every block keeps its Djot attributes in `a` (id, class, align, color, …).
import { model, tables } from "../vendor/pm.js";
import type { model as M } from "../vendor/pm.js";
import { urlFor } from "./store.ts";

type Attrs = Record<string, string>;
type DOMOut = M.DOMOutputSpec;

const A = { a: { default: {} as Attrs } };

/** Djot attrs → DOM attributes for on-screen rendering (subset of html.rs). */
export function domAttrs(a: Attrs, extraClass = ""): Record<string, string> {
  const css: string[] = [];
  const out: Record<string, string> = {};
  const map: Record<string, string> = {
    color: "color",
    bg: "background",
    font: "font-family",
    size: "font-size",
    align: "text-align",
    indent: "margin-left",
    first: "text-indent",
    spacing: "line-height",
    width: "width",
    height: "height",
  };
  let cls = extraClass;
  for (const [k, v] of Object.entries(a ?? {})) {
    if (map[k]) css.push(`${map[k]}:${v}`);
    else if (k === "class") cls = (cls ? cls + " " : "") + v;
    else if (k === "style") css.push(v);
    else if (k === "float") css.push(`float:${v}`);
    else if (k === "id") out.id = v;
  }
  if (cls) out.class = cls;
  if (css.length) out.style = css.join(";");
  return out;
}

// ── pasting from other apps: keep meaningful formatting, drop noise ──

const BORING = /^(rgba?\(0, 0, 0(, 1)?\)|black|#000(000)?|transparent|rgba\(0, 0, 0, 0\)|rgb\(255, 255, 255\)|white|#fff(fff)?|inherit|initial|windowtext)$/i;

/** "rgb(255, 0, 0)" → "#ff0000" (browsers normalise inline colours to rgb). */
const hex = (c: string) => {
  const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(c);
  return m ? "#" + m.slice(1).map((n) => (+n).toString(16).padStart(2, "0")).join("") : c;
};

/** Colour + highlight of a pasted <span style>; fonts/sizes are dropped (they are noise from Word/Docs). */
function pastedSpan(d: HTMLElement): { a: Attrs } | null {
  const a: Attrs = {};
  const c = d.style.color;
  const bg = d.style.backgroundColor;
  if (c && !BORING.test(c)) a.color = hex(c);
  if (bg && !BORING.test(bg)) a.bg = hex(bg);
  return Object.keys(a).length ? { a } : null;
}

/** Alignment of a pasted paragraph/heading. */
function pastedBlock(d: HTMLElement): Attrs {
  const al = d.style.textAlign || d.getAttribute("align") || "";
  return /^(center|right|justify)$/.test(al) ? { align: al } : {};
}

const tableNodes = tables.tableNodes({
  tableGroup: "block",
  cellContent: "block+",
  cellAttributes: {
    align: {
      default: "",
      getFromDOM: (d: HTMLElement) => d.style.textAlign || "",
      setDOMAttr: (v: unknown, at: Record<string, unknown>) => {
        if (v) at.style = String(at.style ?? "") + `text-align:${v};`;
      },
    },
    bg: {
      default: "",
      getFromDOM: (d: HTMLElement) => d.style.backgroundColor || "",
      setDOMAttr: (v: unknown, at: Record<string, unknown>) => {
        if (v) at.style = String(at.style ?? "") + `background:${v};`;
      },
    },
    valign: {
      default: "",
      getFromDOM: (d: HTMLElement) => d.style.verticalAlign || "",
      setDOMAttr: (v: unknown, at: Record<string, unknown>) => {
        if (v) at.style = String(at.style ?? "") + `vertical-align:${v};`;
      },
    },
  },
});
// table-level attrs: caption + passthrough; the table style (`class`: banded / minimal / plain) shows in the editor too
(tableNodes.table as M.NodeSpec).attrs = { caption: { default: "" }, ...A };
(tableNodes.table as M.NodeSpec).toDOM = (n): DOMOut => ["table", domAttrs(n.attrs.a), ["tbody", 0]];

const nodes: Record<string, M.NodeSpec> = {
  doc: { content: "block+", attrs: { meta: { default: "" }, css: { default: "" } } },
  paragraph: {
    content: "inline*",
    group: "block",
    attrs: A,
    parseDOM: [{ tag: "p", getAttrs: (d) => ({ a: pastedBlock(d as HTMLElement) }) }],
    toDOM: (n): DOMOut => ["p", domAttrs(n.attrs.a), 0],
  },
  heading: {
    content: "inline*",
    group: "block",
    defining: true,
    attrs: { level: { default: 1 }, ...A },
    parseDOM: [1, 2, 3, 4, 5, 6].map((l) => ({ tag: `h${l}`, getAttrs: (d) => ({ level: l, a: pastedBlock(d as HTMLElement) }) })),
    toDOM: (n): DOMOut => [`h${n.attrs.level}`, domAttrs(n.attrs.a), 0],
  },
  blockquote: {
    content: "block+",
    group: "block",
    defining: true,
    attrs: A,
    parseDOM: [{ tag: "blockquote" }],
    toDOM: (n): DOMOut => ["blockquote", domAttrs(n.attrs.a), 0],
  },
  code_block: {
    content: "text*",
    marks: "",
    group: "block",
    code: true,
    defining: true,
    attrs: { lang: { default: "" }, ...A },
    parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
    toDOM: (n): DOMOut => ["pre", { "data-lang": n.attrs.lang }, ["code", 0]],
  },
  horizontal_rule: {
    group: "block",
    attrs: A,
    parseDOM: [{ tag: "hr" }],
    toDOM: (n): DOMOut => ["hr", domAttrs(n.attrs.a)],
  },
  page_break: {
    group: "block",
    atom: true,
    parseDOM: [{ tag: "div.page-break" }],
    toDOM: (): DOMOut => ["div", { class: "jw-pagebreak", contenteditable: "false" }, "Page break"],
  },
  bullet_list: {
    content: "list_item+",
    group: "block",
    attrs: { marker: { default: "-" }, task: { default: false }, tight: { default: true }, ...A },
    parseDOM: [{ tag: "ul" }],
    toDOM: (n): DOMOut => ["ul", domAttrs(n.attrs.a, n.attrs.task ? "task-list" : ""), 0],
  },
  ordered_list: {
    content: "list_item+",
    group: "block",
    attrs: { marker: { default: "1." }, start: { default: 1 }, tight: { default: true }, ...A },
    parseDOM: [{ tag: "ol", getAttrs: (d) => ({ start: Number((d as HTMLElement).getAttribute("start") ?? 1) }) }],
    toDOM: (n): DOMOut => {
      const ty = (n.attrs.marker as string).replace(/[^1aAiI]/g, "") || "1";
      return ["ol", { start: String(n.attrs.start), type: ty, ...domAttrs(n.attrs.a) }, 0];
    },
  },
  list_item: {
    content: "block+",
    defining: true,
    attrs: { checked: { default: null } },
    parseDOM: [{ tag: "li" }],
    toDOM: (n): DOMOut => n.attrs.checked === null ? ["li", 0] : ["li", { class: "task", "data-checked": String(n.attrs.checked) }, 0],
  },
  dl: { content: "(dt dd)+", group: "block", attrs: A, parseDOM: [{ tag: "dl" }], toDOM: (): DOMOut => ["dl", 0] },
  dt: { content: "inline*", defining: true, parseDOM: [{ tag: "dt" }], toDOM: (): DOMOut => ["dt", 0] },
  dd: { content: "block+", defining: true, parseDOM: [{ tag: "dd" }], toDOM: (): DOMOut => ["dd", 0] },
  div: {
    content: "block+",
    group: "block",
    defining: true,
    attrs: { class: { default: "" }, ...A },
    parseDOM: [{ tag: "div.jw-div" }],
    toDOM: (n): DOMOut => ["div", { ...domAttrs(n.attrs.a, "jw-div " + n.attrs.class), "data-label": n.attrs.class }, 0],
  },
  slide: {
    content: "block+",
    group: "block",
    defining: true,
    attrs: A,
    parseDOM: [{ tag: "section.jw-slide" }],
    toDOM: (n): DOMOut => ["section", domAttrs(n.attrs.a, "jw-slide"), 0],
  },
  footnote: {
    content: "block+",
    group: "block",
    attrs: { label: { default: "1" } },
    parseDOM: [{ tag: "aside.jw-footnote" }],
    toDOM: (n): DOMOut => ["aside", { class: "jw-footnote", "data-label": n.attrs.label }, 0],
  },
  // atoms with node views
  raw_block: { group: "block", atom: true, attrs: { format: { default: "html" }, text: { default: "" }, ...A } },
  sheet: { group: "block", atom: true, attrs: { id: { default: "Sheet1" }, rows: { default: [[""]] }, head: { default: 1 }, fmt: { default: "" }, ...A } },
  chart: { group: "block", atom: true, attrs: { type: { default: "bar" }, data: { default: "" }, title: { default: "" }, ...A } },
  shape: {
    group: "block",
    atom: true,
    attrs: {
      kind: { default: "rect" },
      x: { default: "0mm" },
      y: { default: "0mm" },
      w: { default: "40mm" },
      h: { default: "20mm" },
      fill: { default: "none" },
      stroke: { default: "#1a5fb4" },
      text: { default: "" },
      ...A,
    },
  },
  toc: { group: "block", atom: true, attrs: { depth: { default: "3" } } },
  ...tableNodes,
  text: { group: "inline" },
  hard_break: { inline: true, group: "inline", selectable: false, parseDOM: [{ tag: "br" }], toDOM: (): DOMOut => ["br"] },
  image: {
    inline: true,
    group: "inline",
    draggable: true,
    attrs: { src: { default: "" }, alt: { default: "" }, ...A },
    parseDOM: [{
      tag: "img[src]",
      getAttrs: (d) => {
        const e = d as HTMLImageElement;
        const w = e.getAttribute("width") ?? e.style.width;
        return { src: e.getAttribute("src"), alt: e.getAttribute("alt") ?? "", a: w ? { width: /^\d+$/.test(w) ? `${w}px` : w } : {} };
      },
    }],
    // real URL so pictures survive a copy into other apps; data-jw keeps "#att:" for Writy
    toDOM: (n): DOMOut => ["img", { src: urlFor(n.attrs.src).url || n.attrs.src, alt: n.attrs.alt }],
  },
  math: { inline: true, group: "inline", atom: true, attrs: { tex: { default: "" }, display: { default: false } } },
  calc: { inline: true, group: "inline", atom: true, attrs: { ref: { default: "" }, cached: { default: "" } } },
  footnote_ref: { inline: true, group: "inline", atom: true, attrs: { label: { default: "1" } } },
  symbol: {
    inline: true,
    group: "inline",
    atom: true,
    attrs: { name: { default: "" } },
    toDOM: (n): DOMOut => ["span", { class: "jw-sym" }, `:${n.attrs.name}:`],
  },
  raw_inline: {
    inline: true,
    group: "inline",
    atom: true,
    attrs: { format: { default: "html" }, text: { default: "" } },
    toDOM: (n): DOMOut => ["code", { class: "jw-raw-inline" }, n.attrs.text],
  },
};

const marks: Record<string, M.MarkSpec> = {
  link: {
    attrs: { href: { default: "" }, ...A },
    inclusive: false,
    parseDOM: [{ tag: "a[href]", getAttrs: (d) => ({ href: (d as HTMLElement).getAttribute("href") }) }],
    toDOM: (m): DOMOut => ["a", { href: m.attrs.href, title: m.attrs.href }, 0],
  },
  em: { attrs: A, parseDOM: [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }], toDOM: (): DOMOut => ["em", 0] },
  strong: {
    attrs: A,
    parseDOM: [
      { tag: "strong" },
      // Google Docs wraps everything in <b style="font-weight:normal">
      { tag: "b", getAttrs: (d) => (d as HTMLElement).style.fontWeight !== "normal" && null },
      { style: "font-weight", getAttrs: (v) => /^(bold|[6-9]00)$/.test(v as string) && null },
    ],
    toDOM: (): DOMOut => ["strong", 0],
  },
  mark: { attrs: A, parseDOM: [{ tag: "mark" }], toDOM: (): DOMOut => ["mark", 0] },
  sup: { attrs: A, excludes: "sub", parseDOM: [{ tag: "sup" }], toDOM: (): DOMOut => ["sup", 0] },
  sub: { attrs: A, excludes: "sup", parseDOM: [{ tag: "sub" }], toDOM: (): DOMOut => ["sub", 0] },
  // excludes "": a tracked insertion / deletion (attrs.a.by) sits beside plain underline / strikethrough instead of replacing it
  ins: { attrs: A, excludes: "", parseDOM: [{ tag: "ins" }, { tag: "u" }], toDOM: (m): DOMOut => ["ins", { title: m.attrs.a?.by ?? "" }, 0] },
  del: { attrs: A, excludes: "", parseDOM: [{ tag: "del" }, { tag: "s" }], toDOM: (m): DOMOut => ["del", { title: m.attrs.a?.by ?? "" }, 0] },
  code: { attrs: A, excludes: "_", parseDOM: [{ tag: "code" }], toDOM: (): DOMOut => ["code", 0] },
  // generic span: colour, font, size, comments, classes … several may stack
  span: {
    attrs: A,
    excludes: "",
    parseDOM: [{ tag: "span.jw-span" }, { tag: "span[style]", getAttrs: (d) => pastedSpan(d as HTMLElement) || false }, {
      tag: "font[color]",
      getAttrs: (d) => ({ a: { color: (d as HTMLElement).getAttribute("color")! } }),
    }],
    toDOM: (m): DOMOut => {
      const a = m.attrs.a as Attrs;
      const d = domAttrs(a, "jw-span" + (a.comment ? " jw-comment" : ""));
      if (a.comment) d.title = `${a.by ? a.by + ": " : ""}${a.comment}`;
      return ["span", d, 0];
    },
  },
};

// ── clipboard fidelity ──
// Copy inside Writy must keep every attr (Djot attrs, comments, shapes …). Each
// node/mark gets `data-jw-t` (type) + `data-jw` (attrs JSON) in its DOM, and a
// high-priority parse rule that restores them exactly. Atoms without a DOM form get one.

type Spec = M.NodeSpec | M.MarkSpec;
const tagged = (name: string, attrs: Record<string, unknown>) => ({ "data-jw-t": name, "data-jw": JSON.stringify(attrs) });

function withAttrs(out: DOMOut, extra: Record<string, string>): DOMOut {
  if (!Array.isArray(out)) return out;
  const [tag, second, ...rest] = out as unknown as [string, unknown, ...unknown[]];
  const isAttrs = second && typeof second === "object" && !Array.isArray(second) && !(second as Node).nodeType;
  return (isAttrs ? [tag, { ...(second as object), ...extra }, ...rest] : [tag, extra, ...(second === undefined ? [] : [second]), ...rest]) as DOMOut;
}

function fidelity<T extends Spec>(specs: Record<string, T>, inline: (s: T) => boolean): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [name, spec] of Object.entries(specs)) {
    if (name === "text" || name === "doc" || !spec.attrs) {
      out[name] = spec;
      continue;
    }
    const toDOM = (spec.toDOM ?? (() => [inline(spec) ? "span" : "div", { class: `jw-atom-${name}` }])) as (n: M.Node | M.Mark, x?: unknown) => DOMOut;
    const own = { tag: `[data-jw-t="${name}"]`, priority: 100, getAttrs: (d: HTMLElement) => JSON.parse(d.dataset.jw ?? "{}") };
    out[name] = {
      ...spec,
      toDOM: (n: M.Node | M.Mark, x?: unknown) => withAttrs(toDOM(n, x), tagged(name, n.attrs)),
      parseDOM: [own, ...(spec.parseDOM ?? [])],
    } as T;
  }
  return out;
}

export const schema = new model.Schema({
  nodes: fidelity(nodes, (s) => !!(s as M.NodeSpec).inline),
  marks: fidelity(marks, () => true),
});

export type Schema = typeof schema;
