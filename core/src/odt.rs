//! ODT (OpenDocument Text) → XAST: headings, styles, lists, tables, images,
//! links, notes, annotations, page setup.
use crate::ast::{Attrs, Node};
use crate::html::Att;
use crate::imp::{self, Cell, Imported, Run, Style};
use crate::xml::{self, El, X};
use std::collections::HashMap;

#[derive(Default, Clone, Debug)]
struct Props {
    parent: Option<String>,
    display: String,
    bold: Option<bool>,
    italic: Option<bool>,
    underline: Option<bool>,
    strike: Option<bool>,
    pos: Option<String>, // "super" | "sub"
    color: Option<String>,
    bg: Option<String>,
    size: Option<String>,
    font: Option<String>,
    align: Option<String>,
    /// paragraph layout as Writy attributes: indent / first (mm), spacing (line-height factor)
    layout: Vec<(&'static str, String)>,
    page_break: bool,
    cell_bg: Option<String>,
    col_width: Option<String>,
}

struct Ctx {
    styles: HashMap<String, Props>,
    lists: HashMap<String, Vec<(String, u64)>>, // list style → per level (marker, start)
    files: HashMap<String, Vec<u8>>,
    atts: Vec<Att>,
    att_of: HashMap<String, String>,
    notes: Vec<Node>,
    note_n: usize,
    comments: Vec<Attrs>,
    def_font: Option<String>,
    def_size: Option<String>,
}

fn read_styles(root: &El, into: &mut HashMap<String, Props>, lists: &mut HashMap<String, Vec<(String, u64)>>) {
    for sec in root.els().filter(|e| matches!(e.name.as_str(), "office:styles" | "office:automatic-styles")) {
        for s in sec.els() {
            if s.name == "text:list-style" {
                let mut lv: Vec<(usize, String, u64)> = vec![];
                for l in s.els() {
                    let level: usize = l.attr("text:level").and_then(|v| v.parse().ok()).unwrap_or(1);
                    let (m, start) = if l.name == "text:list-level-style-number" {
                        let f = l.attr("style:num-format").unwrap_or("1");
                        let m = match f {
                            "a" => "a.",
                            "A" => "A.",
                            "i" => "i.",
                            "I" => "I.",
                            "" => "-",
                            _ => "1.",
                        };
                        (m.to_string(), l.attr("text:start-value").and_then(|v| v.parse().ok()).unwrap_or(1))
                    } else {
                        ("-".to_string(), 1)
                    };
                    lv.push((level, m, start));
                }
                lv.sort_by_key(|x| x.0);
                lists.insert(s.attr("style:name").unwrap_or("").into(), lv.into_iter().map(|x| (x.1, x.2)).collect());
                continue;
            }
            if s.name != "style:style" {
                continue;
            }
            let mut p = Props {
                parent: s.attr("style:parent-style-name").map(String::from),
                display: s.attr("style:display-name").map(String::from).unwrap_or_else(|| s.attr("style:name").unwrap_or("").replace("_20_", " ")),
                ..Default::default()
            };
            if let Some(t) = s.child("style:text-properties") {
                p.bold = t.attr("fo:font-weight").map(|w| w == "bold" || w.parse::<u32>().is_ok_and(|n| n >= 600));
                p.italic = t.attr("fo:font-style").map(|v| v == "italic" || v == "oblique");
                p.underline = t.attr("style:text-underline-style").map(|v| v != "none");
                p.strike = t.attr("style:text-line-through-style").map(|v| v != "none");
                p.pos = t.attr("style:text-position").and_then(|v| {
                    let f = v.split_whitespace().next().unwrap_or("");
                    if f == "super" || f.trim_end_matches('%').parse::<f64>().is_ok_and(|n| n > 0.0) {
                        Some("super".into())
                    } else if f == "sub" || f.trim_end_matches('%').parse::<f64>().is_ok_and(|n| n < 0.0) {
                        Some("sub".into())
                    } else {
                        None
                    }
                });
                p.color = t.attr("fo:color").filter(|c| *c != "#000000").map(String::from);
                p.bg = t.attr("fo:background-color").filter(|c| *c != "transparent").map(String::from);
                p.size = t.attr("fo:font-size").filter(|v| v.ends_with("pt")).map(String::from);
                p.font = t.attr("style:font-name").map(String::from);
            }
            if let Some(pp) = s.child("style:paragraph-properties") {
                p.align = pp.attr("fo:text-align").and_then(|a| match a {
                    "center" => Some("center".into()),
                    "end" | "right" => Some("right".into()),
                    "justify" => Some("justify".into()),
                    _ => None,
                });
                p.page_break = pp.attr("fo:break-before") == Some("page");
                let mm = |x: f64| format!("{}mm", (x * 10.0).round() / 10.0);
                if let Some(l) = pp.attr("fo:margin-left").and_then(len_mm).filter(|l| *l > 0.05) {
                    p.layout.push(("indent", mm(l)));
                }
                if let Some(f) = pp.attr("fo:text-indent").and_then(len_mm).filter(|f| f.abs() > 0.05) {
                    p.layout.push(("first", mm(f)));
                }
                if let Some(pct) = pp.attr("fo:line-height").and_then(|v| v.strip_suffix('%')).and_then(|v| v.parse::<f64>().ok()) {
                    let f = (pct / 100.0 * 100.0).round() / 100.0;
                    if (f - 1.0).abs() > 0.01 && (0.5..=4.0).contains(&f) {
                        p.layout.push(("spacing", format!("{f}")));
                    }
                }
            }
            if let Some(cp) = s.child("style:table-cell-properties") {
                p.cell_bg = cp.attr("fo:background-color").filter(|c| *c != "transparent").map(String::from);
            }
            if let Some(cp) = s.child("style:table-column-properties") {
                p.col_width = cp.attr("style:column-width").map(String::from);
            }
            into.insert(s.attr("style:name").unwrap_or("").into(), p);
        }
    }
}

impl Ctx {
    fn chain(&self, name: &str) -> Vec<&Props> {
        let mut v = vec![];
        let mut cur = self.styles.get(name);
        while let Some(p) = cur {
            v.push(p);
            if v.len() > 12 {
                break;
            }
            cur = p.parent.as_ref().and_then(|n| self.styles.get(n));
        }
        v
    }
    fn display(&self, name: &str) -> String {
        self.chain(name).iter().map(|p| p.display.to_lowercase()).collect::<Vec<_>>().join("|")
    }
    fn text_style(&self, name: &str, base: &Style) -> Style {
        let mut s = base.clone();
        let ch = self.chain(name);
        let pick = |f: fn(&Props) -> Option<bool>| ch.iter().find_map(|p| f(p));
        if let Some(b) = pick(|p| p.bold) {
            s.strong = b;
        }
        if let Some(b) = pick(|p| p.italic) {
            s.emph = b;
        }
        if pick(|p| p.underline) == Some(true) {
            s.ins.get_or_insert_with(Attrs::new);
        }
        if pick(|p| p.strike) == Some(true) {
            s.del.get_or_insert_with(Attrs::new);
        }
        match ch.iter().find_map(|p| p.pos.clone()).as_deref() {
            Some("super") => s.sup = true,
            Some("sub") => s.sub = true,
            _ => {}
        }
        if let Some(c) = ch.iter().find_map(|p| p.color.clone()) {
            s.span.insert("color".into(), c);
        }
        if let Some(c) = ch.iter().find_map(|p| p.bg.clone()) {
            s.mark = c.eq_ignore_ascii_case("#ffff00");
            if !s.mark {
                s.span.insert("bg".into(), c);
            }
        }
        if let Some(f) = ch.first().and_then(|p| p.font.clone()).filter(|f| Some(f) != self.def_font.as_ref()) {
            let fl = f.to_lowercase();
            if fl.contains("mono") || fl.contains("courier") || fl.contains("consolas") {
                s.code = true;
            } else {
                s.span.insert("font".into(), f);
            }
        }
        if let Some(sz) = ch.first().and_then(|p| p.size.clone()).filter(|z| Some(z) != self.def_size.as_ref() && !s.sup && !s.sub) {
            s.span.insert("size".into(), sz);
        }
        s
    }
    fn media(&mut self, href: &str) -> Option<String> {
        if let Some(n) = self.att_of.get(href) {
            return Some(n.clone());
        }
        let bytes = self.files.get(href.trim_start_matches("./"))?;
        let name = href.rsplit('/').next().unwrap_or("image").to_string();
        self.atts.push(imp::att(&name, bytes));
        self.att_of.insert(href.into(), name.clone());
        Some(name)
    }
}

fn len_mm(v: &str) -> Option<f64> {
    let n: String = v.chars().take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-').collect();
    let x: f64 = n.parse().ok()?;
    Some(match &v[n.len()..] {
        "cm" => x * 10.0,
        "in" => x * 25.4,
        "pt" => x * 25.4 / 72.0,
        "px" => x * 25.4 / 96.0,
        _ => x,
    })
}

pub fn import(bytes: &[u8]) -> Result<Imported, String> {
    let files = crate::docx::zip_files(bytes)?;
    let parse = |n: &str| files.get(n).and_then(|b| xml::parse(&String::from_utf8_lossy(b)).ok());
    let content = parse("content.xml").ok_or("content.xml missing — not an OpenDocument text")?;
    let styles_x = parse("styles.xml");
    let meta_x = parse("meta.xml");
    let mut ctx = Ctx {
        styles: HashMap::new(),
        lists: HashMap::new(),
        files: HashMap::new(),
        atts: vec![],
        att_of: HashMap::new(),
        notes: vec![],
        note_n: 0,
        comments: vec![],
        def_font: None,
        def_size: None,
    };
    if let Some(s) = &styles_x {
        read_styles(s, &mut ctx.styles, &mut ctx.lists);
        let mut defs = vec![];
        s.find_all("style:default-style", &mut defs);
        if let Some(t) = defs.iter().find(|d| d.attr("style:family") == Some("paragraph")).and_then(|d| d.child("style:text-properties")) {
            ctx.def_font = t.attr("style:font-name").map(String::from);
            ctx.def_size = t.attr("fo:font-size").map(String::from);
        }
    }
    read_styles(&content, &mut ctx.styles, &mut ctx.lists);
    ctx.files = files;
    let body = content.child("office:body").and_then(|b| b.child("office:text")).ok_or("office:text missing")?;
    let mut out = blocks(&mut ctx, body, None);
    let mut meta: Vec<(&str, String)> = vec![];
    if let Some(m) = meta_x.as_ref().and_then(|m| m.child("office:meta")) {
        meta.push(("title", m.child("dc:title").map(|e| e.text()).unwrap_or_default()));
        meta.push(("author", m.child("dc:creator").or_else(|| m.child("meta:initial-creator")).map(|e| e.text()).unwrap_or_default()));
    }
    if let Some(s) = &styles_x {
        let mut layouts = vec![];
        s.find_all("style:page-layout-properties", &mut layouts);
        if let Some(pl) = layouts.first() {
            if let (Some(w), Some(h)) = (pl.attr("fo:page-width").and_then(len_mm), pl.attr("fo:page-height").and_then(len_mm)) {
                let (name, land) = imp::page_name(w, h);
                meta.push(("page", name));
                if land {
                    meta.push(("orientation", "landscape".into()));
                }
            }
            let m = |k: &str| pl.attr(k).and_then(len_mm).map(|v| format!("{v:.0}mm")).unwrap_or_else(|| "20mm".into());
            meta.push(("margin", format!("{} {} {} {}", m("fo:margin-top"), m("fo:margin-right"), m("fo:margin-bottom"), m("fo:margin-left"))));
        }
        if let Some(mp) = s.find("style:master-page") {
            for (tag, key) in [("style:header", "header"), ("style:footer", "footer")] {
                if let Some(h) = mp.child(tag) {
                    let t = hf(h);
                    if !t.trim().is_empty() {
                        meta.push((key, t));
                    }
                }
            }
        }
    }
    if let Some(m) = imp::meta_block(&meta) {
        out.insert(0, m);
    }
    out.extend(std::mem::take(&mut ctx.notes));
    Ok(Imported { doc: Node::Doc { a: Attrs::new(), c: out }, atts: ctx.atts })
}

fn hf(e: &El) -> String {
    fn walk(e: &El, s: &mut String) {
        for k in &e.kids {
            match k {
                X::Text(t) => s.push_str(t),
                X::El(x) => match x.name.as_str() {
                    "text:page-number" => s.push_str("{page}"),
                    "text:page-count" => s.push_str("{pages}"),
                    "text:tab" => s.push_str(" | "),
                    _ => walk(x, s),
                },
            }
        }
    }
    e.els()
        .map(|p| {
            let mut s = String::new();
            walk(p, &mut s);
            s.trim().to_string()
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" | ")
}

fn page_break() -> Node {
    let mut a = Attrs::new();
    a.insert("class".into(), "page-break".into());
    Node::Hr { a }
}

fn blocks(ctx: &mut Ctx, parent: &El, list_style: Option<&str>) -> Vec<Node> {
    let mut out = vec![];
    let mut quote: Vec<Node> = vec![];
    let mut code: Vec<String> = vec![];
    let flush = |out: &mut Vec<Node>, quote: &mut Vec<Node>, code: &mut Vec<String>| {
        if !quote.is_empty() {
            out.push(Node::Blockquote { a: Attrs::new(), c: std::mem::take(quote) });
        }
        if !code.is_empty() {
            out.push(Node::Code { a: Attrs::new(), lang: String::new(), s: std::mem::take(code).join("\n") + "\n" });
        }
    };
    for e in parent.els() {
        match e.name.as_str() {
            "text:h" | "text:p" => {
                let sn = e.attr("text:style-name").unwrap_or("");
                let disp = ctx.display(sn);
                let ch = ctx.chain(sn);
                let align = ch.iter().find_map(|p| p.align.clone());
                let brk = ch.first().is_some_and(|p| p.page_break);
                if brk {
                    flush(&mut out, &mut quote, &mut code);
                    out.push(page_break());
                }
                let mut a = Attrs::new();
                if let Some(al) = align {
                    a.insert("align".into(), al);
                }
                // nearest style in the chain that sets each layout property wins
                for (k, v) in ch.iter().rev().flat_map(|p| p.layout.iter()) {
                    a.insert((*k).into(), v.clone());
                }
                let mut runs = vec![];
                let mut extra = vec![];
                let base = ctx.text_style(sn, &Style::default());
                let base = Style { strong: if e.name == "text:h" { false } else { base.strong }, ..base };
                walk_runs(ctx, e, &base, &mut runs, &mut extra);
                let inl = trim(imp::inlines(&runs));
                let level = if e.name == "text:h" {
                    Some(e.attr("text:outline-level").and_then(|v| v.parse::<u8>().ok()).unwrap_or(1).clamp(1, 6))
                } else if disp.contains("title") && !disp.contains("subtitle") {
                    Some(1)
                } else {
                    disp.split('|').find_map(|d| d.strip_prefix("heading ").and_then(|n| n.trim().parse::<u8>().ok())).map(|n| n.clamp(1, 6))
                };
                if let Some(l) = level {
                    flush(&mut out, &mut quote, &mut code);
                    out.push(Node::Heading { a, level: l, c: imp::clean_heading(inl) });
                } else if disp.contains("preformatted") || disp.contains("source text") {
                    if !quote.is_empty() {
                        flush(&mut out, &mut quote, &mut vec![]);
                    }
                    code.push(Node::Para { a: Attrs::new(), c: inl }.text());
                } else if disp.contains("quotation") || disp.contains("quote") {
                    if !code.is_empty() {
                        flush(&mut out, &mut vec![], &mut code);
                    }
                    quote.push(para(a, inl));
                } else {
                    flush(&mut out, &mut quote, &mut code);
                    if !(inl.is_empty() && !extra.is_empty()) {
                        out.push(para(a, inl));
                    }
                }
                if !extra.is_empty() {
                    flush(&mut out, &mut quote, &mut code);
                    out.extend(extra);
                }
            }
            "text:list" => {
                flush(&mut out, &mut quote, &mut code);
                let st = e.attr("text:style-name").or(list_style);
                out.push(list(ctx, e, st, 0));
            }
            "table:table" => {
                flush(&mut out, &mut quote, &mut code);
                out.push(table(ctx, e));
            }
            "text:section" | "text:index-body" => {
                flush(&mut out, &mut quote, &mut code);
                out.extend(blocks(ctx, e, list_style));
            }
            "text:table-of-content" => {
                flush(&mut out, &mut quote, &mut code);
                out.push(Node::Div { a: Attrs::new(), class: "toc".into(), c: vec![] });
            }
            _ => {}
        }
    }
    flush(&mut out, &mut quote, &mut code);
    out
}

fn para(a: Attrs, c: Vec<Node>) -> Node {
    Node::Para { a, c: if c.is_empty() { vec![Node::str("\u{a0}")] } else { c } }
}

fn trim(mut c: Vec<Node>) -> Vec<Node> {
    if let Some(Node::Str { s }) = c.first_mut() {
        *s = s.trim_start().to_string();
    }
    if let Some(Node::Str { s }) = c.last_mut() {
        *s = s.trim_end().to_string();
    }
    c.retain(|n| !matches!(n, Node::Str { s } if s.is_empty()));
    c
}

fn list(ctx: &mut Ctx, e: &El, style: Option<&str>, depth: usize) -> Node {
    let (marker, start) = style.and_then(|s| ctx.lists.get(s)).and_then(|l| l.get(depth)).cloned().unwrap_or(("-".into(), 1));
    let mut items = vec![];
    for it in e.els().filter(|x| x.name == "text:list-item" || x.name == "text:list-header") {
        let mut c = vec![];
        for k in it.els() {
            if k.name == "text:list" {
                c.push(list(ctx, k, k.attr("text:style-name").or(style), depth + 1));
            } else {
                let wrapper = El { name: "#".into(), attrs: vec![], kids: vec![X::El(k.clone())] };
                c.extend(blocks(ctx, &wrapper, style));
            }
        }
        if c.is_empty() {
            c.push(para(Attrs::new(), vec![]));
        }
        items.push(Node::Item { checked: None, c });
    }
    let tight = items.iter().all(|i| i.kids().len() == 1);
    Node::List { a: Attrs::new(), marker, start, task: false, tight, c: items }
}

fn walk_runs(ctx: &mut Ctx, e: &El, st: &Style, runs: &mut Vec<Run>, extra: &mut Vec<Node>) {
    for k in &e.kids {
        let el = match k {
            X::Text(t) => {
                let mut s = st.clone();
                if let Some(c) = ctx.comments.last() {
                    s.comment = Some(c.clone());
                }
                runs.push(Run::Text(t.replace('\n', " "), s));
                continue;
            }
            X::El(el) => el,
        };
        match el.name.as_str() {
            "text:span" => {
                let s = ctx.text_style(el.attr("text:style-name").unwrap_or(""), st);
                walk_runs(ctx, el, &s, runs, extra);
            }
            "text:a" => {
                let mut s = st.clone();
                s.link = el.attr("xlink:href").map(String::from);
                walk_runs(ctx, el, &s, runs, extra);
            }
            "text:s" => runs.push(Run::Text(" ".repeat(el.attr("text:c").and_then(|v| v.parse().ok()).unwrap_or(1)), st.clone())),
            "text:tab" => runs.push(Run::Text("\t".into(), st.clone())),
            "text:line-break" => runs.push(Run::Node(Node::Hard, st.clone())),
            "text:note" => {
                ctx.note_n += 1;
                let label = format!("n{}", ctx.note_n);
                let c = el.child("text:note-body").map(|b| blocks(ctx, b, None)).unwrap_or_default();
                ctx.notes.push(Node::Footnote { label: label.clone(), c });
                runs.push(Run::Node(Node::FnRef { label }, Style::default()));
            }
            "office:annotation" => {
                let mut a = Attrs::new();
                let text: Vec<String> = el.children("text:p").map(|p| p.text()).collect();
                a.insert("comment".into(), text.join(" ").trim().to_string());
                if let Some(by) = el.child("dc:creator") {
                    a.insert("by".into(), by.text());
                }
                if let Some(d) = el.child("dc:date") {
                    a.insert("at".into(), d.text().chars().take(10).collect());
                }
                ctx.comments.push(a);
            }
            "office:annotation-end" => {
                ctx.comments.pop();
            }
            "draw:frame" => {
                if let Some(img) = el.child("draw:image") {
                    if let Some(name) = img.attr("xlink:href").and_then(|h| ctx.media(h)) {
                        let mut a = Attrs::new();
                        if let Some(w) = el.attr("svg:width").and_then(len_mm) {
                            a.insert("width".into(), format!("{w:.0}mm"));
                        }
                        let alt = el.child("svg:title").or_else(|| el.child("svg:desc")).map(|t| t.text()).unwrap_or_default();
                        runs.push(Run::Node(
                            Node::Image { a, src: format!("#att:{name}"), c: if alt.is_empty() { vec![] } else { vec![Node::str(alt)] } },
                            st.clone(),
                        ));
                    }
                } else if let Some(tb) = el.child("draw:text-box") {
                    let c = blocks(ctx, tb, None);
                    if !c.is_empty() {
                        extra.push(Node::Div { a: Attrs::new(), class: "textbox".into(), c });
                    }
                }
            }
            "text:soft-page-break" | "text:bookmark" | "text:bookmark-start" | "text:bookmark-end" | "text:sequence-decls" => {}
            "text:change-start" | "text:change-end" | "text:change" => {}
            _ => walk_runs(ctx, el, st, runs, extra),
        }
    }
}

fn table(ctx: &mut Ctx, t: &El) -> Node {
    let mut widths = vec![];
    let mut rows: Vec<Vec<Cell>> = vec![];
    fn cols(ctx: &Ctx, e: &El, widths: &mut Vec<f64>) {
        for c in e.els() {
            match c.name.as_str() {
                "table:table-column" => {
                    let n: usize = c.attr("table:number-columns-repeated").and_then(|v| v.parse().ok()).unwrap_or(1);
                    let w =
                        c.attr("table:style-name").and_then(|s| ctx.styles.get(s)).and_then(|p| p.col_width.clone()).and_then(|w| len_mm(&w)).unwrap_or(0.0);
                    for _ in 0..n.min(64) {
                        widths.push(w);
                    }
                }
                "table:table-columns" | "table:table-header-columns" => cols(ctx, c, widths),
                _ => {}
            }
        }
    }
    let mut wmm = vec![];
    cols(ctx, t, &mut wmm);
    let total: f64 = wmm.iter().sum();
    if wmm.len() > 1 && total > 0.0 {
        widths = wmm.iter().map(|w| format!("{:.0}%", w / total * 100.0)).collect();
    }
    fn collect_rows<'a>(e: &'a El, head: bool, out: &mut Vec<(&'a El, bool)>) {
        for r in e.els() {
            match r.name.as_str() {
                "table:table-row" => out.push((r, head)),
                "table:table-header-rows" => collect_rows(r, true, out),
                "table:table-rows" | "table:table-row-group" => collect_rows(r, head, out),
                _ => {}
            }
        }
    }
    let mut trs = vec![];
    collect_rows(t, false, &mut trs);
    for (tr, head) in trs {
        let cells: Vec<&El> = tr.els().filter(|c| c.name == "table:table-cell").collect();
        let head = head
            || (!cells.is_empty()
                && cells.iter().all(|tc| tc.children("text:p").all(|p| ctx.display(p.attr("text:style-name").unwrap_or("")).contains("table heading"))));
        let mut row = vec![];
        for tc in tr.els() {
            if tc.name != "table:table-cell" {
                continue;
            }
            let bg = tc.attr("table:style-name").and_then(|s| ctx.styles.get(s)).and_then(|p| p.cell_bg.clone()).unwrap_or_default();
            let mut b = blocks(ctx, tc, None);
            let mut align = String::new();
            if b.len() == 1
                && let Some(Node::Para { a, .. }) = b.first_mut()
            {
                align = a.remove("align").unwrap_or_default();
            }
            if b.iter()
                .all(|x| matches!(x, Node::Para { c, .. } if c.iter().all(|y| matches!(y, Node::Str { s } if s.trim_matches(['\u{a0}', ' ']).is_empty()))))
            {
                b.clear();
            }
            row.push(Cell {
                blocks: b,
                colspan: tc.attr("table:number-columns-spanned").and_then(|v| v.parse().ok()).unwrap_or(1),
                rowspan: tc.attr("table:number-rows-spanned").and_then(|v| v.parse().ok()).unwrap_or(1),
                head,
                align,
                bg,
            });
        }
        rows.push(row);
    }
    imp::table(rows, widths, None)
}
