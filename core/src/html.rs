//! XAST → static HTML (no script needed to view). Extensions are rendered here.
use crate::ast::{Attrs, Node};
use crate::sheet::{self, Sheet};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct Att {
    pub name: String,
    pub mime: String,
    pub b64: String,
}

pub struct Ctx<'a> {
    atts: HashMap<&'a str, &'a Att>,
    used: HashSet<String>,
    sheets: Vec<Sheet>,
    calc: sheet::Result,
    sheet_i: usize,
    ids: HashSet<String>,
    heads: Vec<(u8, String, String)>, // level, id, text
    notes: Vec<String>,               // footnote labels in reference order
    defs: BTreeMap<String, Node>,
}

pub fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            _ => o.push(c),
        }
    }
    o
}

pub fn slug(s: &str) -> String {
    let mut o = String::new();
    for c in s.chars() {
        if c.is_alphanumeric() {
            o.extend(c.to_lowercase());
        } else if !o.ends_with('-') && !o.is_empty() {
            o.push('-');
        }
    }
    let o = o.trim_end_matches('-').to_string();
    if o.is_empty() { "s".into() } else { o }
}

/// `key: value` lines of the ```` ``` =meta ```` block.
pub fn meta(doc: &Node) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    for n in doc.kids() {
        if let Node::Raw { format, s, .. } = n
            && format == "meta"
        {
            for l in s.lines() {
                if let Some((k, v)) = l.split_once(':') {
                    m.insert(k.trim().to_lowercase(), v.trim().to_string());
                }
            }
        }
    }
    m
}

/// Presentational attribute keys → CSS; the rest become data-* (id/class stay).
fn html_attrs(a: &Attrs, extra_class: &str, extra_style: &str) -> String {
    let mut out = String::new();
    let mut style = String::from(extra_style);
    let mut class = String::from(extra_class);
    for (k, v) in a {
        let css = match k.as_str() {
            "width" => Some(format!("width:{v}")),
            "height" => Some(format!("height:{v}")),
            "color" => Some(format!("color:{v}")),
            "bg" => Some(format!("background:{v}")),
            "font" => Some(format!("font-family:{v}")),
            "size" => Some(format!("font-size:{v}")),
            "align" => Some(format!("text-align:{v}")),
            "valign" => Some(format!("vertical-align:{v}")),
            "indent" => Some(format!("margin-left:{v}")),
            "first" => Some(format!("text-indent:{v}")),
            "spacing" => Some(format!("line-height:{v}")),
            "cols" => Some(format!("columns:{v}")),
            "gap" => Some(format!("column-gap:{v}")),
            "border" => Some(format!("border:{v}")),
            "float" => Some(format!("float:{v};margin:{}", if v == "left" { "0 1em .5em 0" } else { "0 0 .5em 1em" })),
            "break" => Some(format!("break-{v}:page")),
            "style" => Some(v.trim_end_matches(';').to_string()),
            _ => None,
        };
        if let Some(c) = css {
            if !style.is_empty() {
                style.push(';');
            }
            style.push_str(&c);
            continue;
        }
        match k.as_str() {
            "id" => out.push_str(&format!(" id=\"{}\"", esc(v))),
            "class" => {
                if !class.is_empty() {
                    class.push(' ');
                }
                class.push_str(v);
            }
            "colspan" | "rowspan" | "title" | "lang" | "dir" => out.push_str(&format!(" {k}=\"{}\"", esc(v))),
            _ => out.push_str(&format!(" data-{}=\"{}\"", esc(&k.replace(':', "-")), esc(v))),
        }
    }
    if !class.is_empty() {
        out.push_str(&format!(" class=\"{}\"", esc(&class)));
    }
    if !style.is_empty() {
        out.push_str(&format!(" style=\"{}\"", esc(&style)));
    }
    out
}

impl<'a> Ctx<'a> {
    pub fn new(doc: &Node, atts: &'a [Att]) -> Self {
        let sheets = sheet::collect(doc);
        let calc = sheet::evaluate(&sheets);
        let mut defs = BTreeMap::new();
        for n in doc.kids() {
            if let Node::Footnote { label, .. } = n {
                defs.insert(label.clone(), n.clone());
            }
        }
        Ctx {
            atts: atts.iter().map(|a| (a.name.as_str(), a)).collect(),
            used: HashSet::new(),
            sheets,
            calc,
            sheet_i: 0,
            ids: HashSet::new(),
            heads: vec![],
            notes: vec![],
            defs,
        }
    }
    pub fn used(&self) -> &HashSet<String> {
        &self.used
    }

    fn uniq(&mut self, base: &str) -> String {
        let mut id = base.to_string();
        let mut i = 1;
        while self.ids.contains(&id) {
            i += 1;
            id = format!("{base}-{i}");
        }
        self.ids.insert(id.clone());
        id
    }

    fn src(&mut self, src: &str) -> (String, String) {
        if let Some(name) = src.strip_prefix("#att:")
            && let Some(a) = self.atts.get(name)
        {
            self.used.insert(name.to_string());
            return (format!("data:{};base64,{}", a.mime, a.b64), a.mime.clone());
        }
        let ext = src.rsplit('.').next().unwrap_or("").to_lowercase();
        let mime = match ext.as_str() {
            "mp4" | "m4v" => "video/mp4",
            "webm" => "video/webm",
            "ogv" => "video/ogg",
            "mov" => "video/quicktime",
            "mp3" => "audio/mpeg",
            "ogg" | "oga" => "audio/ogg",
            "wav" => "audio/wav",
            _ => "",
        };
        (src.to_string(), mime.into())
    }

    /// Render a whole document body. Two passes: headings first (for the TOC).
    pub fn doc(&mut self, doc: &Node) -> String {
        self.collect_heads(doc);
        self.ids.clear();
        let body: Vec<Node> = doc.kids().iter().filter(|n| !matches!(n, Node::Footnote { .. })).cloned().collect();
        let mut o = self.blocks(&body);
        if !self.notes.is_empty() {
            o.push_str("<section class=\"footnotes\" role=\"doc-endnotes\"><hr><ol>");
            let notes = self.notes.clone();
            for (i, l) in notes.iter().enumerate() {
                let def = self.defs.get(l).cloned();
                let inner = def.map(|n| self.blocks(n.kids())).unwrap_or_default();
                o.push_str(&format!("<li id=\"fn-{}\">{inner} <a href=\"#fnref-{}\" class=\"fnback\">↩</a></li>", i + 1, i + 1));
            }
            o.push_str("</ol></section>");
        }
        o
    }

    fn collect_heads(&mut self, n: &Node) {
        if let Node::Heading { a, level, .. } = n {
            let text = n.text();
            let id = a.get("id").cloned().unwrap_or_else(|| self.uniq(&slug(&text)));
            self.ids.insert(id.clone());
            self.heads.push((*level, id, text));
        }
        n.kids().iter().for_each(|k| self.collect_heads(k));
    }

    fn blocks(&mut self, c: &[Node]) -> String {
        let mut o = String::new();
        let mut i = 0;
        while i < c.len() {
            // shapes float over the block that follows them
            if is_shape(&c[i]) {
                let mut j = i;
                let mut shapes = String::new();
                while j < c.len() && is_shape(&c[j]) {
                    shapes.push_str(&self.shape(&c[j]));
                    j += 1;
                }
                let next = c.get(j).map(|n| self.block(n)).unwrap_or_default();
                o.push_str(&format!("<div class=\"jw-anchor\">{shapes}{next}</div>\n"));
                i = j + 1;
                continue;
            }
            o.push_str(&self.block(&c[i]));
            o.push('\n');
            i += 1;
        }
        o
    }

    fn shape(&mut self, n: &Node) -> String {
        let Node::Div { a, c, .. } = n else {
            return String::new();
        };
        let g = |k: &str, d: &str| a.get(k).cloned().unwrap_or_else(|| d.to_string());
        let kind = g("kind", "rect");
        let (x, y, w, h) = (g("x", "0"), g("y", "0"), g("w", "40mm"), g("h", "20mm"));
        let fill = g("fill", "none");
        let stroke = g("stroke", "#333");
        let sw = g("sw", "1.5");
        let rot = g("rotate", "0");
        // a line / arrow runs corner to corner, starting at the corner `from` names; an arrow without it (older files) runs across the middle
        let ends = match (kind.as_str(), a.get("from").map(String::as_str).unwrap_or("")) {
            ("arrow", "") => "x1=\"0\" y1=\"50%\" x2=\"100%\" y2=\"50%\"",
            (_, "br") => "x1=\"100%\" y1=\"100%\" x2=\"0\" y2=\"0\"",
            (_, "tr") => "x1=\"100%\" y1=\"0\" x2=\"0\" y2=\"100%\"",
            (_, "bl") => "x1=\"0\" y1=\"100%\" x2=\"100%\" y2=\"0\"",
            _ => "x1=\"0\" y1=\"0\" x2=\"100%\" y2=\"100%\"",
        };
        let svg = match kind.as_str() {
            "ellipse" => format!(
                "<ellipse cx=\"50%\" cy=\"50%\" rx=\"calc(50% - {sw}px)\" ry=\"calc(50% - {sw}px)\" fill=\"{fill}\" stroke=\"{stroke}\" stroke-width=\"{sw}\"/>"
            ),
            "line" => format!("<line {ends} stroke=\"{stroke}\" stroke-width=\"{sw}\"/>"),
            "arrow" => format!(
                "<defs><marker id=\"{ah}\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"6\" markerHeight=\"6\" orient=\"auto\"><path d=\"M0,0L10,5L0,10z\" fill=\"{stroke}\"/></marker></defs><line {ends} stroke=\"{stroke}\" stroke-width=\"{sw}\" marker-end=\"url(#{ah})\"/>",
                ah = format!("ah-{}", stroke.chars().filter(char::is_ascii_alphanumeric).collect::<String>())
            ),
            "roundrect" => format!(
                "<rect x=\"{sw}\" y=\"{sw}\" width=\"calc(100% - {sw}px * 2)\" height=\"calc(100% - {sw}px * 2)\" rx=\"12\" fill=\"{fill}\" stroke=\"{stroke}\" stroke-width=\"{sw}\"/>"
            ),
            _ => format!(
                "<rect x=\"{sw}\" y=\"{sw}\" width=\"calc(100% - {sw}px * 2)\" height=\"calc(100% - {sw}px * 2)\" fill=\"{fill}\" stroke=\"{stroke}\" stroke-width=\"{sw}\"/>"
            ),
        };
        let text = self.blocks(c);
        let look = shape_text_css(a);
        format!(
            "<div class=\"jw-shape jw-{}\" style=\"left:{};top:{};width:{};height:{};transform:rotate({}deg)\"><svg width=\"100%\" height=\"100%\" aria-hidden=\"true\">{svg}</svg><div class=\"jw-shape-text\"{look}>{text}</div></div>",
            esc(&kind),
            esc(&x),
            esc(&y),
            esc(&w),
            esc(&h),
            esc(&rot)
        )
    }

    fn block(&mut self, n: &Node) -> String {
        match n {
            Node::Para { a, c } => format!("<p{}>{}</p>", html_attrs(a, "", ""), self.inlines(c)),
            Node::Heading { a, level, c } => {
                let id = match a.get("id") {
                    Some(id) => id.clone(),
                    None => self.uniq(&slug(&n.text())),
                };
                let mut a = a.clone();
                a.insert("id".into(), id);
                format!("<h{level}{}>{}</h{level}>", html_attrs(&a, "", ""), self.inlines(c))
            }
            Node::Blockquote { a, c } => format!("<blockquote{}>\n{}</blockquote>", html_attrs(a, "", ""), self.blocks(c)),
            Node::List { a, marker, start, task, tight, c } => {
                let ordered = marker.chars().any(|ch| ch.is_ascii_alphanumeric());
                let tag = if ordered { "ol" } else { "ul" };
                let mut extra = String::new();
                if ordered {
                    if *start != 1 {
                        extra.push_str(&format!(" start=\"{start}\""));
                    }
                    let ty = marker.chars().find(|ch| ch.is_ascii_alphanumeric()).unwrap_or('1');
                    if ty != '1' {
                        extra.push_str(&format!(" type=\"{ty}\""));
                    }
                }
                let cls = if *task { "task-list" } else { "" };
                let items: String = c
                    .iter()
                    .map(|it| {
                        let (checked, kids) = match it {
                            Node::Item { checked, c } => (*checked, c.as_slice()),
                            o => (None, std::slice::from_ref(o)),
                        };
                        let body = if *tight && kids.len() == 1 {
                            if let Node::Para { c, .. } = &kids[0] { self.inlines(c) } else { self.blocks(kids) }
                        } else {
                            self.blocks(kids)
                        };
                        let cb = match checked {
                            Some(true) => "<input type=\"checkbox\" disabled checked> ",
                            Some(false) => "<input type=\"checkbox\" disabled> ",
                            None => "",
                        };
                        format!("<li>{cb}{body}</li>\n")
                    })
                    .collect();
                format!("<{tag}{}{extra}>\n{items}</{tag}>", html_attrs(a, cls, ""))
            }
            Node::Dl { a, c } => {
                let mut o = format!("<dl{}>", html_attrs(a, "", ""));
                for k in c {
                    match k {
                        Node::Term { c } => o.push_str(&format!("<dt>{}</dt>", self.inlines(c))),
                        Node::Dd { c } => o.push_str(&format!("<dd>{}</dd>", self.blocks(c))),
                        _ => {}
                    }
                }
                o + "</dl>"
            }
            Node::Table { a, c } => {
                let mut o = format!("<table{}>", html_attrs(a, "", ""));
                for k in c {
                    if let Node::Caption { c } = k {
                        o.push_str(&format!("<caption>{}</caption>", self.inlines(c)));
                    }
                }
                for k in c {
                    if let Node::Row { c, .. } = k {
                        o.push_str("<tr>");
                        for cell in c {
                            if let Node::Cell { head, align, c } = cell {
                                let t = if *head { "th" } else { "td" };
                                let st = if align.is_empty() { String::new() } else { format!(" style=\"text-align:{align}\"") };
                                o.push_str(&format!("<{t}{st}>{}</{t}>", self.inlines(c)));
                            }
                        }
                        o.push_str("</tr>");
                    }
                }
                o + "</table>"
            }
            Node::Div { a, class, c } => self.div(a, class, c),
            Node::Code { a, lang, s } => {
                let cls = if lang.is_empty() { String::new() } else { format!(" class=\"language-{}\"", esc(lang)) };
                format!("<pre{}><code{cls}>{}</code></pre>", html_attrs(a, "", ""), crate::hl::to_html(lang, s, esc))
            }
            Node::Raw { a, format, s } => match format.as_str() {
                "html" => s.clone(),
                "sheet" => self.sheet(a, s),
                _ => String::new(), // meta, css, typst … not body content
            },
            Node::Hr { a } => {
                if a.get("class").is_some_and(|c| c.split(' ').any(|x| x == "page-break")) {
                    "<div class=\"page-break\"></div>".into()
                } else {
                    format!("<hr{}>", html_attrs(a, "", ""))
                }
            }
            n if n.is_inline() => self.inlines(std::slice::from_ref(n)),
            _ => String::new(),
        }
    }

    fn div(&mut self, a: &Attrs, class: &str, c: &[Node]) -> String {
        match class {
            "table" => self.rich_table(a, c),
            "figure" => {
                let (cap, body) = match c.split_last() {
                    Some((Node::Para { c: ic, .. }, rest)) if !rest.is_empty() && !ic.iter().any(|x| matches!(x, Node::Image { .. })) => {
                        (Some(ic.clone()), rest.to_vec())
                    }
                    _ => (None, c.to_vec()),
                };
                let mut o = format!("<figure{}>", html_attrs(a, "", ""));
                o.push_str(&self.blocks(&body));
                if let Some(cap) = cap {
                    o.push_str(&format!("<figcaption>{}</figcaption>", self.inlines(&cap)));
                }
                o + "</figure>"
            }
            "chart" => self.chart(a),
            "toc" => {
                let mut o = format!("<nav{}><ol>", html_attrs(a, "jw-toc", ""));
                let max: u8 = a.get("depth").and_then(|d| d.parse().ok()).unwrap_or(3);
                for (lvl, id, text) in self.heads.clone() {
                    if lvl <= max {
                        o.push_str(&format!("<li class=\"l{lvl}\"><a href=\"#{}\">{}</a></li>", esc(&id), esc(&text)));
                    }
                }
                o + "</ol></nav>"
            }
            "slide" => format!("<section{}>\n{}</section>", html_attrs(a, "jw-slide", ""), self.blocks(c)),
            "shape" => self.shape(&Node::Div { a: a.clone(), class: class.into(), c: c.to_vec() }),
            _ => format!("<div{}>\n{}</div>", html_attrs(a, class, ""), self.blocks(c)),
        }
    }

    fn sheet(&mut self, a: &Attrs, s: &str) -> String {
        self.sheet_i += 1;
        let (rows, head) = sheet::parse_grid(s);
        let id = a.get("id").cloned().unwrap_or_else(|| format!("Sheet{}", self.sheet_i));
        let vals = self.calc.values.get(&id).cloned().unwrap_or_default();
        let nums = self.calc.numeric.get(&id).cloned().unwrap_or_default();
        let mut o = format!("<table{}>", html_attrs(&strip(a, &["widths", "cells"]), "jw-sheet", ""));
        let styles = a.get("cells").cloned().unwrap_or_default();
        // column widths set in the editor (`widths="A:120;C:80"`, px)
        if let Some(w) = a.get("widths") {
            let cols = rows.iter().map(Vec::len).max().unwrap_or(0);
            let set: std::collections::HashMap<&str, &str> = w.split(';').filter_map(|x| x.split_once(':')).collect();
            o.push_str("<colgroup>");
            for c in 0..cols {
                match set.get(sheet::col_name(c).as_str()).and_then(|v| v.parse::<u32>().ok()) {
                    Some(px) => o.push_str(&format!("<col style=\"width:{px}px\">")),
                    None => o.push_str("<col>"),
                }
            }
            o.push_str("</colgroup>");
        }
        for (r, row) in rows.iter().enumerate() {
            o.push_str("<tr>");
            for (ci, raw) in row.iter().enumerate() {
                let v = vals.get(r).and_then(|x| x.get(ci)).cloned().unwrap_or_else(|| raw.clone());
                let num = nums.get(r).and_then(|x| x.get(ci)).copied().unwrap_or(false);
                let t = if r < head { "th" } else { "td" };
                let cls = if num && r >= head { " class=\"num\"" } else { "" };
                let css = if styles.is_empty() { String::new() } else { sheet::cell_css(&styles, r, ci, head) };
                let style = if css.is_empty() { String::new() } else { format!(" style=\"{css}\"") };
                o.push_str(&format!("<{t}{cls}{style}>{}</{t}>", esc(&v)));
            }
            o.push_str("</tr>");
        }
        o + "</table>"
    }

    /// `{type=bar data="sales!A1:C4"}` — first column labels, first row series names.
    fn chart(&mut self, a: &Attrs) -> String {
        let kind = a.get("type").map(String::as_str).unwrap_or("bar");
        let title = a.get("title").cloned().unwrap_or_default();
        let Some(range) = a.get("data") else {
            return "<div class=\"jw-chart\">chart: missing data=</div>".into();
        };
        let (sid, rng) = match range.split_once('!') {
            Some((s, r)) => (s.to_string(), r.to_string()),
            None => (self.sheets.first().map(|s| s.id.clone()).unwrap_or_default(), range.clone()),
        };
        let Some(vals) = self.calc.values.get(&sid) else {
            return format!("<div class=\"jw-chart\">chart: no sheet {}</div>", esc(&sid));
        };
        let (r0, c0, r1, c1) = parse_range(&rng).unwrap_or((0, 0, vals.len().saturating_sub(1), 1));
        let cell = |r: usize, c: usize| vals.get(r).and_then(|x| x.get(c)).cloned().unwrap_or_default();
        let num = |s: String| chart_num(&s);
        let series: Vec<String> = (c0 + 1..=c1).map(|c| cell(r0, c)).collect();
        let labels: Vec<String> = (r0 + 1..=r1).map(|r| cell(r, c0)).collect();
        let data: Vec<Vec<f64>> = (c0 + 1..=c1).map(|c| (r0 + 1..=r1).map(|r| num(cell(r, c))).collect()).collect();
        let pal = ["#2a6fdb", "#e8833a", "#3aa76d", "#c94f7c", "#8a63d2", "#d4b02c"];
        let (w, h) = (480.0, 260.0);
        let (left, right, top, bottom) = (44.0, 12.0, 26.0, 28.0);
        let mut svg = format!("<svg viewBox=\"0 0 {w} {h}\" role=\"img\" aria-label=\"{}\">", esc(&title));
        let n = labels.len().max(1) as f64;
        let fmt_n = |v: f64| {
            let a = v.abs();
            if a >= 1e6 {
                format!("{}M", trim_num(v / 1e6))
            } else if a >= 1e4 {
                format!("{}k", trim_num(v / 1e3))
            } else {
                trim_num(v)
            }
        };
        // legend: swatch + name, spaced by the name's length
        let legend = |svg: &mut String, names: &[String], y: f64, x0: f64| {
            let mut x = x0;
            for (i, s) in names.iter().enumerate() {
                svg.push_str(&format!(
                    "<rect x=\"{x:.1}\" y=\"{:.1}\" width=\"10\" height=\"10\" rx=\"2\" fill=\"{}\"/><text x=\"{:.1}\" y=\"{:.1}\" font-size=\"11\" fill=\"currentColor\">{}</text>",
                    y - 9.0, pal[i % pal.len()], x + 14.0, y, esc(s)
                ));
                x += 14.0 + s.chars().count() as f64 * 6.4 + 16.0;
            }
        };
        match kind {
            "pie" | "donut" => {
                let vals: Vec<f64> = data.first().cloned().unwrap_or_default().into_iter().map(|v| v.max(0.0)).collect();
                let total: f64 = vals.iter().sum::<f64>().max(1e-9);
                let (cx, cy, rad) = (h / 2.0, h / 2.0, h / 2.0 - 10.0);
                let mut ang = -std::f64::consts::FRAC_PI_2;
                for (i, v) in vals.iter().enumerate() {
                    let a2 = ang + v / total * std::f64::consts::TAU;
                    let large = if a2 - ang > std::f64::consts::PI { 1 } else { 0 };
                    if *v >= total - 1e-9 {
                        svg.push_str(&format!("<circle cx=\"{cx}\" cy=\"{cy}\" r=\"{rad}\" fill=\"{}\"/>", pal[i % pal.len()]));
                    } else {
                        svg.push_str(&format!(
                            "<path d=\"M{cx},{cy}L{:.2},{:.2}A{rad},{rad} 0 {large} 1 {:.2},{:.2}Z\" fill=\"{}\" stroke=\"#fff\" stroke-width=\"1\"/>",
                            cx + rad * ang.cos(),
                            cy + rad * ang.sin(),
                            cx + rad * a2.cos(),
                            cy + rad * a2.sin(),
                            pal[i % pal.len()]
                        ));
                    }
                    svg.push_str(&format!(
                        "<rect x=\"{}\" y=\"{}\" width=\"10\" height=\"10\" rx=\"2\" fill=\"{}\"/><text x=\"{}\" y=\"{}\" font-size=\"12\" fill=\"currentColor\">{} · {}%</text>",
                        h + 10.0, 20.0 + i as f64 * 18.0, pal[i % pal.len()], h + 26.0, 29.0 + i as f64 * 18.0,
                        esc(labels.get(i).map(String::as_str).unwrap_or("")), trim_num((v / total * 1000.0).round() / 10.0)
                    ));
                    ang = a2;
                }
                if kind == "donut" {
                    svg.push_str(&format!("<circle cx=\"{cx}\" cy=\"{cy}\" r=\"{:.1}\" fill=\"var(--bg, #fff)\"/>", rad * 0.55));
                }
            }
            "hbar" => {
                // horizontal bars: categories down the left, values along the bottom (long labels read well)
                let lo0 = data.iter().flatten().cloned().fold(0.0f64, f64::min);
                let hi0 = data.iter().flatten().cloned().fold(0.0f64, f64::max);
                let (lo, hi, step) = nice_axis(lo0, hi0);
                let longest = labels.iter().map(|l| l.chars().count()).max().unwrap_or(0).min(18) as f64;
                let lw = (longest * 6.2 + 10.0).max(30.0);
                let (x0, x1) = (lw, w - right - 10.0);
                let x = |v: f64| x0 + (v - lo) / (hi - lo) * (x1 - x0);
                let gh = (h - top - bottom) / n;
                let mut t = lo;
                while t <= hi + step / 2.0 {
                    svg.push_str(&format!(
                        "<line x1=\"{0:.1}\" y1=\"{top}\" x2=\"{0:.1}\" y2=\"{1}\" stroke=\"currentColor\" stroke-opacity=\"{2}\"/><text x=\"{0:.1}\" y=\"{3}\" font-size=\"10\" text-anchor=\"middle\" fill=\"currentColor\" fill-opacity=\".7\">{4}</text>",
                        x(t), h - bottom, if t.abs() < step / 1e6 { ".45" } else { ".12" }, h - bottom + 14.0, fmt_n(t)
                    ));
                    t += step;
                }
                let ns = data.len().max(1) as f64;
                let bh = gh * 0.8 / ns;
                for (si, sv) in data.iter().enumerate() {
                    for (i, v) in sv.iter().enumerate() {
                        let (a0, a1) = (x(0.0), x(*v));
                        svg.push_str(&format!(
                            "<rect x=\"{:.1}\" y=\"{:.1}\" width=\"{:.1}\" height=\"{:.1}\" fill=\"{}\" rx=\"2\"><title>{}: {}</title></rect>",
                            a0.min(a1),
                            top + i as f64 * gh + gh * 0.1 + si as f64 * bh,
                            (a0 - a1).abs(),
                            (bh - 2.0).max(1.0),
                            pal[si % pal.len()],
                            esc(labels.get(i).map(String::as_str).unwrap_or("")),
                            trim_num(*v)
                        ));
                    }
                }
                for (i, l) in labels.iter().enumerate() {
                    let short = if l.chars().count() > 18 { format!("{}…", l.chars().take(17).collect::<String>()) } else { l.clone() };
                    svg.push_str(&format!(
                        "<text x=\"{:.1}\" y=\"{:.1}\" font-size=\"11\" text-anchor=\"end\" fill=\"currentColor\"><title>{}</title>{}</text>",
                        x0 - 6.0,
                        top + (i as f64 + 0.5) * gh + 4.0,
                        esc(l),
                        esc(&short)
                    ));
                }
                legend(&mut svg, &series, 15.0, x0);
            }
            _ => {
                // value axis from a zero baseline (negatives go below it), rounded to friendly steps; stacked = per-category sums
                let stacked = kind == "stacked";
                let cats = labels.len();
                let d = &data;
                let sums = |pos: bool| (0..cats).map(move |i| d.iter().map(|s| s.get(i).copied().unwrap_or(0.0)).filter(|v| (*v >= 0.0) == pos).sum::<f64>());
                let (lo0, hi0) = if stacked {
                    (sums(false).fold(0.0f64, f64::min), sums(true).fold(0.0f64, f64::max))
                } else {
                    (data.iter().flatten().cloned().fold(0.0f64, f64::min), data.iter().flatten().cloned().fold(0.0f64, f64::max))
                };
                let (lo, hi, step) = nice_axis(lo0, hi0);
                let ph = h - top - bottom;
                let y = |v: f64| top + (hi - v) / (hi - lo) * ph;
                let mut t = lo;
                while t <= hi + step / 2.0 {
                    svg.push_str(&format!(
                        "<line x1=\"{left}\" y1=\"{0:.1}\" x2=\"{1}\" y2=\"{0:.1}\" stroke=\"currentColor\" stroke-opacity=\"{2}\"/><text x=\"{3}\" y=\"{4:.1}\" font-size=\"10\" text-anchor=\"end\" fill=\"currentColor\" fill-opacity=\".7\">{5}</text>",
                        y(t), w - right, if t.abs() < step / 1e6 { ".45" } else { ".12" }, left - 6.0, y(t) + 3.5, fmt_n(t)
                    ));
                    t += step;
                }
                let gw = (w - left - right) / n;
                if kind == "line" || kind == "area" {
                    for (si, s) in data.iter().enumerate() {
                        let pts: Vec<(f64, f64)> = s.iter().enumerate().map(|(i, v)| (left + (i as f64 + 0.5) * gw, y(*v))).collect();
                        let col = pal[si % pal.len()];
                        if kind == "area" && pts.len() > 1 {
                            let base = y(0.0);
                            svg.push_str(&format!(
                                "<polygon points=\"{:.1},{base:.1} {} {:.1},{base:.1}\" fill=\"{col}\" fill-opacity=\".22\"/>",
                                pts[0].0,
                                pts.iter().map(|(x, y)| format!("{x:.1},{y:.1}")).collect::<Vec<_>>().join(" "),
                                pts[pts.len() - 1].0
                            ));
                        }
                        svg.push_str(&format!(
                            "<polyline points=\"{}\" fill=\"none\" stroke=\"{col}\" stroke-width=\"2.5\" stroke-linejoin=\"round\"/>",
                            pts.iter().map(|(x, y)| format!("{x:.1},{y:.1}")).collect::<Vec<_>>().join(" ")
                        ));
                        for (x, y) in pts {
                            svg.push_str(&format!("<circle cx=\"{x:.1}\" cy=\"{y:.1}\" r=\"3\" fill=\"{col}\"/>"));
                        }
                    }
                } else if stacked {
                    // one column per category, series piled up (negatives pile downwards)
                    let (mut up, mut down) = (vec![0.0f64; cats], vec![0.0f64; cats]);
                    for (si, s) in data.iter().enumerate() {
                        for (i, v) in s.iter().enumerate().take(cats) {
                            let base = if *v >= 0.0 { &mut up[i] } else { &mut down[i] };
                            let (y0, y1) = (y(*base), y(*base + v));
                            *base += v;
                            svg.push_str(&format!(
                                "<rect x=\"{:.1}\" y=\"{:.1}\" width=\"{:.1}\" height=\"{:.1}\" fill=\"{}\"><title>{} · {}: {}</title></rect>",
                                left + i as f64 * gw + gw * 0.15,
                                y0.min(y1),
                                (gw * 0.7).max(1.0),
                                (y0 - y1).abs(),
                                pal[si % pal.len()],
                                esc(labels.get(i).map(String::as_str).unwrap_or("")),
                                esc(series.get(si).map(String::as_str).unwrap_or("")),
                                trim_num(*v)
                            ));
                        }
                    }
                } else {
                    let ns = data.len().max(1) as f64;
                    let bw = gw * 0.8 / ns;
                    for (si, s) in data.iter().enumerate() {
                        for (i, v) in s.iter().enumerate() {
                            let (y0, y1) = (y(0.0), y(*v));
                            svg.push_str(&format!(
                                "<rect x=\"{:.1}\" y=\"{:.1}\" width=\"{:.1}\" height=\"{:.1}\" fill=\"{}\" rx=\"2\"><title>{}: {}</title></rect>",
                                left + i as f64 * gw + gw * 0.1 + si as f64 * bw,
                                y0.min(y1),
                                (bw - 2.0).max(1.0),
                                (y0 - y1).abs(),
                                pal[si % pal.len()],
                                esc(labels.get(i).map(String::as_str).unwrap_or("")),
                                trim_num(*v)
                            ));
                        }
                    }
                }
                // crowded categories (12 months on a narrow chart): show every k-th label, shorten what still does not fit
                let longest = labels.iter().map(|l| l.chars().count()).max().unwrap_or(0) as f64;
                let every = ((longest.min(14.0) * 6.2 + 8.0) / gw).ceil().max(1.0) as usize;
                let fit = ((gw * every as f64 - 6.0) / 6.2).max(3.0) as usize;
                for (i, l) in labels.iter().enumerate().filter(|(i, _)| i % every == 0) {
                    let short = if l.chars().count() > fit { format!("{}…", l.chars().take(fit - 1).collect::<String>()) } else { l.clone() };
                    svg.push_str(&format!(
                        "<text x=\"{:.1}\" y=\"{}\" font-size=\"11\" text-anchor=\"middle\" fill=\"currentColor\"><title>{}</title>{}</text>",
                        left + (i as f64 + 0.5) * gw,
                        h - bottom + 16.0,
                        esc(l),
                        esc(&short)
                    ));
                }
                legend(&mut svg, &series, 15.0, left);
            }
        }
        svg.push_str("</svg>");
        let cap = if title.is_empty() { String::new() } else { format!("<figcaption>{}</figcaption>", esc(&title)) };
        format!("<figure{}>{svg}{cap}</figure>", html_attrs(&strip(a, &["type", "data", "title"]), "jw-chart", ""))
    }

    /// `::: table` = list of rows, each a list of cells. A cell may start with
    /// `[]{colspan=2 rowspan=1 align=right bg=#eee}`. Table attr `head=N` marks header rows.
    fn rich_table(&mut self, a: &Attrs, c: &[Node]) -> String {
        let head: usize = a.get("head").and_then(|h| h.parse().ok()).unwrap_or(0);
        let widths: Vec<String> = a.get("widths").map(|w| w.split(',').map(|x| x.trim().to_string()).collect()).unwrap_or_default();
        let mut o = format!("<table{}>", html_attrs(&strip(a, &["head", "widths"]), "jw-table", ""));
        if !widths.is_empty() {
            o.push_str("<colgroup>");
            widths.iter().for_each(|w| o.push_str(&format!("<col style=\"width:{}\">", esc(w))));
            o.push_str("</colgroup>");
        }
        let mut caption = None;
        for n in c {
            match n {
                Node::List { c: rows, .. } => {
                    for (ri, row) in rows.iter().enumerate() {
                        o.push_str("<tr>");
                        let cells = row.kids().iter().find_map(|k| if let Node::List { c, .. } = k { Some(c.clone()) } else { None }).unwrap_or_default();
                        for cell in cells {
                            let mut kids = cell.kids().to_vec();
                            let ca = cell_attrs(&mut kids);
                            let t = if ri < head { "th" } else { "td" };
                            let body = if kids.len() == 1 {
                                if let Node::Para { a, c } = &kids[0] {
                                    if a.is_empty() { self.inlines(c) } else { self.blocks(&kids) }
                                } else {
                                    self.blocks(&kids)
                                }
                            } else {
                                self.blocks(&kids)
                            };
                            o.push_str(&format!("<{t}{}>{body}</{t}>", html_attrs(&ca, "", "")));
                        }
                        o.push_str("</tr>");
                    }
                }
                Node::Para { c, .. } => caption = Some(self.inlines(c)),
                _ => {}
            }
        }
        if let Some(cap) = caption {
            o.push_str(&format!("<caption>{cap}</caption>"));
        }
        o + "</table>"
    }

    fn inlines(&mut self, c: &[Node]) -> String {
        let mut o = String::new();
        for n in c {
            self.inline(n, &mut o);
        }
        o
    }

    fn wrap(&mut self, tag: &str, a: &Attrs, c: &[Node], o: &mut String) {
        let inner = self.inlines(c);
        o.push_str(&format!("<{tag}{}>{inner}</{tag}>", html_attrs(a, "", "")));
    }

    fn inline(&mut self, n: &Node, o: &mut String) {
        match n {
            Node::Str { s } => o.push_str(&esc(s)),
            Node::Soft => o.push('\n'),
            Node::Hard => o.push_str("<br>\n"),
            Node::Sym { s } => o.push_str(emoji(s).unwrap_or(&format!(":{s}:"))),
            Node::FnRef { label } => {
                let i = match self.notes.iter().position(|l| l == label) {
                    Some(i) => i + 1,
                    None => {
                        self.notes.push(label.clone());
                        self.notes.len()
                    }
                };
                o.push_str(&format!("<sup class=\"fnref\"><a id=\"fnref-{i}\" href=\"#fn-{i}\" role=\"doc-noteref\">{i}</a></sup>"));
            }
            Node::Emph { a, c } => self.wrap("em", a, c, o),
            Node::Strong { a, c } => self.wrap("strong", a, c, o),
            Node::Mark { a, c } => self.wrap("mark", a, c, o),
            Node::Sup { a, c } => self.wrap("sup", a, c, o),
            Node::Sub { a, c } => self.wrap("sub", a, c, o),
            Node::Ins { a, c } => self.wrap("ins", a, c, o),
            Node::Del { a, c } => self.wrap("del", a, c, o),
            Node::Span { a, c } => {
                if let Some(r) = a.get("calc") {
                    let v = sheet::lookup(&self.calc, &self.sheets, r).unwrap_or_else(|| "#REF!".into());
                    o.push_str(&format!("<span class=\"jw-calc\" data-calc=\"{}\">{}</span>", esc(r), esc(&v)));
                } else if let Some(cm) = a.get("comment") {
                    let inner = self.inlines(c);
                    let by = a.get("by").map(|b| format!("{b}: ")).unwrap_or_default();
                    o.push_str(&format!("<span class=\"jw-comment\" title=\"{}\">{inner}</span>", esc(&format!("{by}{cm}"))));
                } else {
                    self.wrap("span", a, c, o)
                }
            }
            Node::Link { a, href, c } => {
                let inner = self.inlines(c);
                o.push_str(&format!("<a href=\"{}\"{}>{inner}</a>", esc(href), html_attrs(a, "", "")));
            }
            Node::Image { a, src, c } => {
                let alt = Node::Para { a: Attrs::new(), c: c.clone() }.text();
                let (url, mime) = self.src(src);
                let att = src.strip_prefix("#att:").map(|n| format!(" data-att=\"{}\"", esc(n))).unwrap_or_default();
                if mime.starts_with("video/") {
                    o.push_str(&format!(
                        "<video controls preload=\"metadata\" src=\"{}\"{att}{} title=\"{}\"></video>",
                        esc(&url),
                        html_attrs(a, "", ""),
                        esc(&alt)
                    ));
                } else if mime.starts_with("audio/") {
                    o.push_str(&format!("<audio controls src=\"{}\"{att}{} title=\"{}\"></audio>", esc(&url), html_attrs(a, "", ""), esc(&alt)));
                } else {
                    o.push_str(&format!("<img src=\"{}\" alt=\"{}\"{att}{}>", esc(&url), esc(&alt), html_attrs(a, "", "")));
                }
            }
            Node::Verb { a, s } => o.push_str(&format!("<code{}>{}</code>", html_attrs(a, "", ""), esc(s))),
            Node::Math { display, s } => o.push_str(&math(s, *display)),
            Node::RawI { format, s } if format == "html" => o.push_str(s),
            _ => {}
        }
    }
}

fn is_shape(n: &Node) -> bool {
    matches!(n, Node::Div { class, .. } if class == "shape")
}

fn strip(a: &Attrs, keys: &[&str]) -> Attrs {
    a.iter().filter(|(k, _)| !keys.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect()
}

/// Leading empty span with cell keys → cell attributes (removed from content).
fn cell_attrs(kids: &mut [Node]) -> Attrs {
    if let Some(Node::Para { c, .. }) = kids.first_mut()
        && let Some(Node::Span { a, c: sc }) = c.first()
        && sc.is_empty()
    {
        let a = a.clone();
        c.remove(0);
        if let Some(Node::Str { s }) = c.first_mut() {
            *s = s.trim_start().to_string();
        }
        return a;
    }
    Attrs::new()
}

fn parse_range(r: &str) -> Option<(usize, usize, usize, usize)> {
    let (a, b) = r.split_once(':')?;
    let p = |x: &str| -> Option<(usize, usize)> {
        let x = x.replace('$', "");
        let l: String = x.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
        let c = l.to_ascii_uppercase().bytes().fold(0usize, |a, b| a * 26 + (b - b'A' + 1) as usize).checked_sub(1)?;
        let r: usize = x[l.len()..].parse().ok()?;
        Some((r.checked_sub(1)?, c))
    };
    let (r0, c0) = p(a)?;
    let (r1, c1) = p(b)?;
    Some((r0.min(r1), c0.min(c1), r0.max(r1), c0.max(c1)))
}

fn emoji(s: &str) -> Option<&'static str> {
    Some(match s {
        "smile" => "😄",
        "+1" | "thumbsup" => "👍",
        "heart" => "❤️",
        "check" | "white_check_mark" => "✅",
        "x" => "❌",
        "warning" => "⚠️",
        "star" => "⭐",
        "fire" => "🔥",
        "rocket" => "🚀",
        "bulb" => "💡",
        "info" => "ℹ️",
        "tada" => "🎉",
        "arrow_right" => "➡️",
        "copyright" => "©",
        "tm" => "™",
        _ => return None,
    })
}

/// LaTeX → MathML (rendered natively by browsers); falls back to the source on failure.
pub fn math(tex: &str, display: bool) -> String {
    use pulldown_latex::{Parser, RenderConfig, Storage, config::DisplayMode, push_mathml};
    let storage = Storage::new();
    let parser = Parser::new(tex, &storage);
    let mut out = String::new();
    let cfg = RenderConfig { display_mode: if display { DisplayMode::Block } else { DisplayMode::Inline }, annotation: Some(tex), ..Default::default() };
    match push_mathml(&mut out, parser, cfg) {
        Ok(()) => out,
        Err(_) => format!("<span class=\"math\">{}</span>", esc(tex)),
    }
}

/// 1234.5 → "1234.5", 2.0 → "2", -0.25 → "-0.25" (no float noise).
fn trim_num(v: f64) -> String {
    let s = format!("{:.2}", v);
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" { "0".into() } else { s.into() }
}

/// A number as a sheet shows it: "1,234.5", "(1,234)" (negative), "12 %", "€ 3.20", "1,5" (decimal comma). Text → 0.
fn chart_num(s: &str) -> f64 {
    let t = s.trim();
    let neg = t.starts_with('(') && t.ends_with(')') || t.contains('-') || t.contains('−');
    let body: String = t.chars().filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',').collect();
    let thousands = body.contains('.') || body.split(',').skip(1).all(|g| g.len() == 3) && body.contains(',');
    let body = if thousands { body.replace(',', "") } else { body.replace(',', ".") };
    let v = body.parse::<f64>().unwrap_or(0.0);
    let v = if t.ends_with('%') { v / 100.0 } else { v };
    if neg { -v } else { v }
}

/// A value axis over lo0..hi0 that includes zero, in friendly steps (1, 2, 2.5, 5 × 10ⁿ): (lo, hi, step).
fn nice_axis(lo0: f64, hi0: f64) -> (f64, f64, f64) {
    let raw = (hi0 - lo0).max(1e-9) / 4.0;
    let mag = 10f64.powf(raw.log10().floor());
    let step = [1.0, 2.0, 2.5, 5.0, 10.0].iter().map(|m| m * mag).find(|s| *s >= raw).unwrap_or(10.0 * mag);
    let lo = (lo0 / step).floor() * step;
    (lo, ((hi0 / step).ceil() * step).max(lo + step), step)
}

/// Shape text look (`size`, `color`, `align` on the shape), as a style attribute. Values are checked, so it is never CSS injection.
fn shape_text_css(a: &Attrs) -> String {
    let mut css = vec![];
    if let Some(s) = a.get("size").filter(|s| {
        let n = s.trim_end_matches(|c: char| c.is_ascii_alphabetic());
        !n.is_empty() && n.parse::<f64>().is_ok() && ["pt", "px", "em", "mm"].contains(&&s[n.len()..])
    }) {
        css.push(format!("font-size:{s}"));
    }
    if let Some(c) = a.get("color").filter(|c| c.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '#') && !c.is_empty()) {
        css.push(format!("color:{c}"));
    }
    if let Some(al) = a.get("align").map(String::as_str).filter(|al| ["left", "center", "right"].contains(al)) {
        let flex = match al {
            "left" => "flex-start",
            "right" => "flex-end",
            _ => "center",
        };
        css.push(format!("text-align:{al};justify-content:{flex}"));
    }
    if css.is_empty() { String::new() } else { format!(" style=\"{}\"", css.join(";")) }
}
