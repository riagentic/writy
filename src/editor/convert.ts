// XAST ⇄ ProseMirror. Pure functions; the only lossy spots are noted inline.
import type { model as M } from "../vendor/pm.js";
import { schema } from "./schema.ts";
import { type Attrs, NBSP, omit, para, str, textOf, type X } from "../doc/xast.ts";
import { gridFormat, gridParse } from "../core/index.ts";

type PJ = { type: string; attrs?: Record<string, unknown>; content?: PJ[]; text?: string; marks?: MJ[] };
type MJ = { type: string; attrs?: Record<string, unknown> };

const BULLETS = ["-", "*", "+"];
const emptyPara = (): PJ => ({ type: "paragraph", attrs: { a: {} } });

// ── XAST → ProseMirror ──────────────────────────────────────────────

export function toPM(doc: X): M.Node {
  let meta = "";
  let css = "";
  const body: PJ[] = [];
  for (const b of doc.c ?? []) {
    if (b.t === "raw" && b.format === "meta") meta += b.s ?? "";
    else if (b.t === "raw" && b.format === "css") css += b.s ?? "";
    else body.push(...block(b));
  }
  if (!body.length) body.push(emptyPara());
  return schema.nodeFromJSON({ type: "doc", attrs: { meta, css }, content: body });
}

const blocks = (c: X[] | undefined): PJ[] => {
  const out = (c ?? []).flatMap(block);
  return out.length ? out : [emptyPara()];
};

function block(n: X): PJ[] {
  const a = n.a ?? {};
  switch (n.t) {
    case "para": {
      const inl = inlines(n.c ?? [], []);
      const onlyNbsp = inl.length === 1 && inl[0].text === NBSP && !inl[0].marks?.length;
      return [{ type: "paragraph", attrs: { a }, content: onlyNbsp ? [] : inl }];
    }
    case "heading":
      return [{ type: "heading", attrs: { level: n.level ?? 1, a }, content: inlines(n.c ?? [], []) }];
    case "blockquote":
      return [{ type: "blockquote", attrs: { a }, content: blocks(n.c) }];
    case "list": {
      const items = (n.c ?? []).map((it): PJ => ({ type: "list_item", attrs: { checked: n.task ? !!it.checked : null }, content: blocks(it.c) }));
      return BULLETS.includes(n.marker ?? "-")
        ? [{ type: "bullet_list", attrs: { marker: n.marker, task: !!n.task, tight: !!n.tight, a }, content: items }]
        : [{ type: "ordered_list", attrs: { marker: n.marker, start: n.start ?? 1, tight: !!n.tight, a }, content: items }];
    }
    case "dl": {
      const out: PJ[] = [];
      for (const k of n.c ?? []) {
        if (k.t === "term") out.push({ type: "dt", content: inlines(k.c ?? [], []) });
        else if (k.t === "dd") out.push({ type: "dd", content: blocks(k.c) });
      }
      return [{ type: "dl", attrs: { a }, content: pairDl(out) }];
    }
    case "table":
      return [pipeTable(n)];
    case "div":
      return div(n);
    case "code":
      return [{ type: "code_block", attrs: { lang: n.lang ?? "", a }, content: textNode((n.s ?? "").replace(/\n$/, ""), []) }];
    case "raw":
      if (n.format === "sheet") {
        const g = gridParse(n.s ?? "");
        return [{
          type: "sheet",
          attrs: { id: a.id ?? "Sheet1", rows: g.rows.length ? g.rows : [[""]], head: g.head, fmt: a.fmt ?? "", a: omit(a, ["id", "fmt"]) },
        }];
      }
      return [{ type: "raw_block", attrs: { format: n.format, text: n.s ?? "", a } }];
    case "hr":
      return (a.class ?? "").split(" ").includes("page-break") ? [{ type: "page_break" }] : [{ type: "horizontal_rule", attrs: { a } }];
    case "footnote":
      return [{ type: "footnote", attrs: { label: n.label }, content: blocks(n.c) }];
    default:
      return n.c ? blocks(n.c) : [];
  }
}

/** dl content must alternate dt, dd. */
function pairDl(items: PJ[]): PJ[] {
  const out: PJ[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (it.type === "dd" && (!last || last.type === "dd")) out.push({ type: "dt", content: [] });
    if (it.type === "dt" && last?.type === "dt") out.push({ type: "dd", content: [emptyPara()] });
    out.push(it);
  }
  if (out[out.length - 1]?.type === "dt") out.push({ type: "dd", content: [emptyPara()] });
  return out.length ? out : [{ type: "dt", content: [] }, { type: "dd", content: [emptyPara()] }];
}

function div(n: X): PJ[] {
  const a = n.a ?? {};
  switch (n.class) {
    case "table":
      return [richTable(n)];
    case "slide":
      return [{ type: "slide", attrs: { a }, content: blocks(n.c) }];
    case "toc":
      return [{ type: "toc", attrs: { depth: a.depth ?? "3" } }];
    case "chart":
      return [{ type: "chart", attrs: { type: a.type ?? "bar", data: a.data ?? "", title: a.title ?? "", a: omit(a, ["type", "data", "title"]) } }];
    case "shape": {
      const keys = ["kind", "x", "y", "w", "h", "fill", "stroke"];
      const attrs: Record<string, unknown> = { a: omit(a, keys), text: (n.c ?? []).map(textOf).join("\n") };
      for (const k of keys) if (a[k] !== undefined) attrs[k] = a[k];
      return [{ type: "shape", attrs }];
    }
    default:
      return [{ type: "div", attrs: { class: n.class ?? "", a }, content: blocks(n.c) }];
  }
}

function pipeTable(n: X): PJ {
  let caption = "";
  const rows: PJ[] = [];
  for (const r of n.c ?? []) {
    if (r.t === "caption") caption = textOf(r); // lossy: caption formatting
    if (r.t !== "row") continue;
    rows.push({
      type: "table_row",
      content: (r.c ?? []).map((c): PJ => ({
        type: c.head ? "table_header" : "table_cell",
        attrs: { align: c.align ?? "" },
        content: [{ type: "paragraph", attrs: { a: {} }, content: inlines(c.c ?? [], []) }],
      })),
    });
  }
  return { type: "table", attrs: { caption, a: n.a ?? {} }, content: padRows(rows) };
}

/** `::: table` → list of rows → list of cells; leading `[]{colspan=…}` = cell attrs. */
function richTable(n: X): PJ {
  const a = n.a ?? {};
  const head = Number(a.head ?? 0);
  const widths = (a.widths ?? "").split(",").map((w) => w.trim()).filter(Boolean);
  let caption = "";
  const rows: PJ[] = [];
  for (const k of n.c ?? []) {
    if (k.t === "para") caption = textOf(k);
    if (k.t !== "list") continue;
    (k.c ?? []).forEach((row, ri) => {
      const cellList = (row.c ?? []).find((x) => x.t === "list");
      const cells = (cellList?.c ?? []).map((cell, ci): PJ => {
        const kids = structuredClone(cell.c ?? []);
        let ca: Attrs = {};
        const first = kids[0];
        if (first?.t === "para" && first.c?.[0]?.t === "span" && !(first.c[0].c ?? []).length) {
          ca = first.c[0].a ?? {};
          first.c.shift();
          const lead = first.c[0] as X | undefined;
          if (lead?.t === "str") lead.s = (lead.s ?? "").trimStart();
        }
        const w = widths[ci];
        return {
          type: ri < head ? "table_header" : "table_cell",
          attrs: {
            colspan: Number(ca.colspan ?? 1),
            rowspan: Number(ca.rowspan ?? 1),
            align: ca.align ?? "",
            bg: ca.bg ?? "",
            valign: ca.valign ?? "",
            colwidth: w?.endsWith("px") ? [parseInt(w)] : null,
          },
          content: blocks(kids),
        };
      });
      rows.push({ type: "table_row", content: cells.length ? cells : [{ type: "table_cell", content: [emptyPara()] }] });
    });
  }
  const keepWidths = widths.length && !widths.every((w) => w.endsWith("px"));
  return {
    type: "table",
    attrs: { caption, a: omit(a, keepWidths ? ["head"] : ["head", "widths"]) },
    content: rows.length ? rows : [{ type: "table_row", content: [{ type: "table_cell", content: [emptyPara()] }] }],
  };
}

/** Pipe tables may have ragged rows; PM needs rectangles. */
function padRows(rows: PJ[]): PJ[] {
  const w = Math.max(1, ...rows.map((r) => r.content?.length ?? 0));
  for (const r of rows) {
    while ((r.content?.length ?? 0) < w) (r.content ??= []).push({ type: "table_cell", attrs: { align: "" }, content: [emptyPara()] });
  }
  return rows.length ? rows : [{ type: "table_row", content: [{ type: "table_cell", content: [emptyPara()] }] }];
}

const MARKS: Record<string, string> = { emph: "em", strong: "strong", mark: "mark", sup: "sup", sub: "sub", ins: "ins", del: "del" };

const textNode = (text: string, marks: MJ[]): PJ[] => (text ? [{ type: "text", text, ...(marks.length ? { marks } : {}) }] : []);

function inlines(c: X[], marks: MJ[]): PJ[] {
  const out: PJ[] = [];
  for (const n of c) {
    const a = n.a ?? {};
    if (n.t === "str") out.push(...textNode(n.s ?? "", marks));
    else if (n.t === "soft") out.push(...textNode(" ", marks));
    else if (n.t === "hard") out.push({ type: "hard_break" });
    else if (n.t === "sym") out.push({ type: "symbol", attrs: { name: n.s } });
    else if (n.t === "fn_ref") out.push({ type: "footnote_ref", attrs: { label: n.label } });
    else if (MARKS[n.t]) out.push(...inlines(n.c ?? [], [...marks, { type: MARKS[n.t], attrs: { a } }]));
    else if (n.t === "span" && a.calc) out.push({ type: "calc", attrs: { ref: a.calc, cached: textOf(n) } });
    else if (n.t === "span") out.push(...inlines(n.c ?? [], [...marks, { type: "span", attrs: { a } }]));
    else if (n.t === "link") out.push(...inlines(n.c ?? [], [...marks, { type: "link", attrs: { href: n.href, a } }]));
    else if (n.t === "image") out.push({ type: "image", attrs: { src: n.src, alt: textOf(n), a }, ...(marks.length ? { marks } : {}) });
    else if (n.t === "verb") out.push(...textNode(n.s ?? "", [...marks.filter((m) => m.type === "link"), { type: "code", attrs: { a } }]));
    else if (n.t === "math") out.push({ type: "math", attrs: { tex: n.s, display: !!n.display } });
    else if (n.t === "raw_i") out.push({ type: "raw_inline", attrs: { format: n.format, text: n.s } });
  }
  return out;
}

// ── ProseMirror → XAST ──────────────────────────────────────────────

export function fromPM(doc: M.Node): X {
  const c: X[] = [];
  if (doc.attrs.meta) c.push({ t: "raw", format: "meta", s: ensureNl(doc.attrs.meta) });
  if (doc.attrs.css) c.push({ t: "raw", format: "css", s: ensureNl(doc.attrs.css) });
  doc.forEach((b) => c.push(...toX(b)));
  return { t: "doc", c };
}

const ensureNl = (s: string) => (s.endsWith("\n") ? s : s + "\n");
const kids = (n: M.Node): X[] => {
  const o: X[] = [];
  n.forEach((k) => o.push(...toX(k)));
  return o;
};

function toX(n: M.Node): X[] {
  const a: Attrs = { ...(n.attrs.a ?? {}) };
  switch (n.type.name) {
    case "paragraph": {
      const c = inlineX(n);
      return [para(c.length ? c : [str(NBSP)], a)];
    }
    case "heading":
      return [{ t: "heading", level: n.attrs.level, a, c: inlineX(n) }];
    case "blockquote":
      return [{ t: "blockquote", a, c: kids(n) }];
    case "bullet_list":
    case "ordered_list": {
      const ordered = n.type.name === "ordered_list";
      const items: X[] = [];
      n.forEach((it) => items.push({ t: "item", ...(n.attrs.task ? { checked: !!it.attrs.checked } : {}), c: kids(it) }));
      return [{
        t: "list",
        a,
        marker: n.attrs.marker ?? (ordered ? "1." : "-"),
        start: ordered ? n.attrs.start : 1,
        task: !!n.attrs.task,
        tight: n.attrs.tight !== false,
        c: items,
      }];
    }
    case "dl": {
      const c: X[] = [];
      n.forEach((k) => c.push(k.type.name === "dt" ? { t: "term", c: inlineX(k) } : { t: "dd", c: kids(k) }));
      return [{ t: "dl", a, c }];
    }
    case "div":
      return [{ t: "div", class: n.attrs.class, a, c: kids(n) }];
    case "slide":
      return [{ t: "div", class: "slide", a, c: kids(n) }];
    case "footnote":
      return [{ t: "footnote", label: n.attrs.label, c: kids(n) }];
    case "code_block":
      return [{ t: "code", lang: n.attrs.lang, a, s: ensureNl(n.textContent) }];
    case "horizontal_rule":
      return [{ t: "hr", a }];
    case "page_break":
      return [{ t: "hr", a: { class: "page-break" } }];
    case "raw_block":
      return [{ t: "raw", format: n.attrs.format, a, s: ensureNl(n.attrs.text) }];
    case "sheet": {
      const sa: Attrs = { ...a, id: n.attrs.id };
      if (n.attrs.fmt) sa.fmt = n.attrs.fmt;
      return [{ t: "raw", format: "sheet", a: sa, s: gridFormat(n.attrs.rows, n.attrs.head) }];
    }
    case "chart":
      return [{ t: "div", class: "chart", a: { ...a, type: n.attrs.type, data: n.attrs.data, ...(n.attrs.title ? { title: n.attrs.title } : {}) }, c: [] }];
    case "shape": {
      const sa: Attrs = { ...a };
      for (const k of ["kind", "x", "y", "w", "h", "fill", "stroke"]) sa[k] = String(n.attrs[k]);
      const text = String(n.attrs.text ?? "");
      return [{ t: "div", class: "shape", a: sa, c: text ? text.split("\n").map((l) => para([str(l || NBSP)])) : [] }];
    }
    case "toc":
      return [{ t: "div", class: "toc", a: n.attrs.depth !== "3" ? { depth: n.attrs.depth } : {}, c: [] }];
    case "table":
      return [tableX(n)];
    default:
      return [];
  }
}

function tableX(n: M.Node): X {
  const rows: M.Node[] = [];
  n.forEach((r) => rows.push(r));
  const cellsOf = (r: M.Node) => {
    const o: M.Node[] = [];
    r.forEach((c) => o.push(c));
    return o;
  };
  const isHeadRow = (r: M.Node) => cellsOf(r).every((c) => c.type.name === "table_header");
  let head = 0;
  while (head < rows.length && isHeadRow(rows[head])) head++;
  const simple = rows.every((r, i) =>
    cellsOf(r).every((c) =>
      c.attrs.colspan === 1 && c.attrs.rowspan === 1 && !c.attrs.bg && !c.attrs.valign && !c.attrs.colwidth &&
      c.childCount === 1 && c.firstChild!.type.name === "paragraph" && !Object.keys(c.firstChild!.attrs.a ?? {}).length &&
      (i < head) === (c.type.name === "table_header")
    )
  );
  const caption = n.attrs.caption as string;
  const a: Attrs = { ...(n.attrs.a ?? {}) };
  if (simple && !a.widths) {
    const c: X[] = rows.map((r, i) => ({
      t: "row",
      head: i < head,
      c: cellsOf(r).map((cell) => ({ t: "cell", head: i < head, align: cell.attrs.align ?? "", c: inlineX(cell.firstChild!) })),
    }));
    if (caption) c.push({ t: "caption", c: [str(caption)] });
    return { t: "table", a, c };
  }
  // rich table (merged cells, block content, colours, widths)
  if (head) a.head = String(head);
  const widths = cellsOf(rows[0] ?? n).map((c) => c.attrs.colwidth?.[0] ? `${c.attrs.colwidth[0]}px` : "");
  if (widths.some(Boolean)) a.widths = widths.map((w) => w || "auto").join(","); // resized in the editor → px
  const rowItems: X[] = rows.map((r) => ({
    t: "item",
    c: [{
      t: "list",
      marker: "-",
      tight: true,
      c: cellsOf(r).map((cell): X => {
        const body = kids(cell);
        const ca: Attrs = {};
        if (cell.attrs.colspan > 1) ca.colspan = String(cell.attrs.colspan);
        if (cell.attrs.rowspan > 1) ca.rowspan = String(cell.attrs.rowspan);
        if (cell.attrs.align) ca.align = cell.attrs.align;
        if (cell.attrs.bg) ca.bg = cell.attrs.bg;
        if (cell.attrs.valign) ca.valign = cell.attrs.valign;
        if (Object.keys(ca).length) {
          if (body[0]?.t !== "para") body.unshift(para([]));
          const p = body[0];
          const rest = (p.c ?? []).filter((x) => !(x.t === "str" && x.s === NBSP));
          p.c = [{ t: "span", a: ca, c: [] }, ...(rest.length ? [str(" "), ...rest] : [])];
        }
        return { t: "item", c: body };
      }),
    }],
  }));
  const c: X[] = [{ t: "list", marker: "-", tight: true, c: rowItems }];
  if (caption) c.push(para([str(caption)]));
  return { t: "div", class: "table", a, c };
}

// inline content: rebuild nesting from flat marks
const MARK_X: Record<string, string> = { em: "emph", strong: "strong", mark: "mark", sup: "sup", sub: "sub", ins: "ins", del: "del" };

function markX(m: M.Mark): X {
  if (m.type.name === "link") return { t: "link", href: m.attrs.href, a: { ...(m.attrs.a ?? {}) }, c: [] };
  if (m.type.name === "span") return { t: "span", a: { ...(m.attrs.a ?? {}) }, c: [] };
  return { t: MARK_X[m.type.name] ?? "span", a: { ...(m.attrs.a ?? {}) }, c: [] };
}

function leafX(n: M.Node): X | null {
  switch (n.type.name) {
    case "text":
      return n.marks.some((m) => m.type.name === "code")
        ? { t: "verb", a: { ...(n.marks.find((m) => m.type.name === "code")!.attrs.a ?? {}) }, s: n.text! }
        : str(n.text!);
    case "hard_break":
      return { t: "hard" };
    case "image":
      return { t: "image", src: n.attrs.src, a: { ...(n.attrs.a ?? {}) }, c: n.attrs.alt ? [str(n.attrs.alt)] : [] };
    case "math":
      return { t: "math", display: n.attrs.display, s: n.attrs.tex };
    case "calc":
      return { t: "span", a: { calc: n.attrs.ref }, c: [str(n.attrs.cached || "?")] };
    case "footnote_ref":
      return { t: "fn_ref", label: n.attrs.label };
    case "symbol":
      return { t: "sym", s: n.attrs.name };
    case "raw_inline":
      return { t: "raw_i", format: n.attrs.format, s: n.attrs.text };
  }
  return null;
}

function inlineX(parent: M.Node): X[] {
  const root: X = { t: "root", c: [] };
  // stack of [mark, node] currently open
  let stack: { m: M.Mark; x: X }[] = [];
  parent.forEach((n) => {
    const marks = n.marks.filter((m) => m.type.name !== "code");
    let keep = 0;
    while (keep < stack.length && keep < marks.length && stack[keep].m.eq(marks[keep])) keep++;
    stack = stack.slice(0, keep);
    for (const m of marks.slice(keep)) {
      const x = markX(m);
      (stack.length ? stack[stack.length - 1].x : root).c!.push(x);
      stack.push({ m, x });
    }
    const leaf = leafX(n);
    if (leaf) (stack.length ? stack[stack.length - 1].x : root).c!.push(leaf);
  });
  return root.c!.map(clean);
}

function clean(x: X): X {
  if (x.a && !Object.keys(x.a).length) delete x.a;
  if (x.c) x.c = x.c.map(clean);
  return x;
}
