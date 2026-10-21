//! Shared import machinery: styled text runs → nested inlines, rich/pipe tables, lists.
use crate::ast::{Attrs, Node, merge_str};
use crate::html::Att;

/// Character formatting of one run of text (Word/ODT/HTML all reduce to this).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Style {
    pub link: Option<String>,
    pub ins: Option<Attrs>, // tracked insert (by/at) or plain underline (empty)
    pub del: Option<Attrs>, // tracked delete or strike-through (empty)
    pub comment: Option<Attrs>,
    pub span: Attrs, // color, bg, font, size …
    pub strong: bool,
    pub emph: bool,
    pub mark: bool,
    pub sup: bool,
    pub sub: bool,
    pub code: bool,
}

#[derive(Clone, Debug)]
pub enum Run {
    Text(String, Style),
    Node(Node, Style), // image, footnote ref, hard break … carrying the surrounding style
}

impl Run {
    fn style(&self) -> &Style {
        match self {
            Run::Text(_, s) | Run::Node(_, s) => s,
        }
    }
}

type Key = fn(&Style) -> Option<Node>;

/// Nesting order, outermost first. Each returns the empty container to wrap in.
const KEYS: &[Key] = &[
    |s| s.link.as_ref().map(|h| Node::Link { a: Attrs::new(), href: h.clone(), c: vec![] }),
    |s| s.comment.as_ref().map(|a| Node::Span { a: a.clone(), c: vec![] }),
    |s| s.ins.as_ref().map(|a| Node::Ins { a: a.clone(), c: vec![] }),
    |s| s.del.as_ref().map(|a| Node::Del { a: a.clone(), c: vec![] }),
    |s| (!s.span.is_empty()).then(|| Node::Span { a: s.span.clone(), c: vec![] }),
    |s| s.strong.then(|| Node::Strong { a: Attrs::new(), c: vec![] }),
    |s| s.emph.then(|| Node::Emph { a: Attrs::new(), c: vec![] }),
    |s| s.mark.then(|| Node::Mark { a: Attrs::new(), c: vec![] }),
    |s| s.sup.then(|| Node::Sup { a: Attrs::new(), c: vec![] }),
    |s| s.sub.then(|| Node::Sub { a: Attrs::new(), c: vec![] }),
];

/// Group runs into a nested inline tree, outermost formatting first.
pub fn inlines(runs: &[Run]) -> Vec<Node> {
    merge_str(group(runs, 0))
}

fn group(runs: &[Run], k: usize) -> Vec<Node> {
    if k == KEYS.len() {
        return runs
            .iter()
            .map(|r| match r {
                Run::Text(t, s) if s.code => Node::Verb { a: Attrs::new(), s: t.clone() },
                Run::Text(t, _) => Node::str(t.clone()),
                Run::Node(n, _) => n.clone(),
            })
            .collect();
    }
    let mut out = vec![];
    let mut i = 0;
    while i < runs.len() {
        let key = KEYS[k](runs[i].style());
        let mut j = i + 1;
        while j < runs.len() && KEYS[k](runs[j].style()) == key {
            j += 1;
        }
        let inner = group(&runs[i..j], k + 1);
        match key {
            Some(mut wrapper) => {
                *wrapper.kids_mut().unwrap() = inner;
                out.push(wrapper);
            }
            None => out.extend(inner),
        }
        i = j;
    }
    out
}

/// Collapse whitespace runs like HTML does (for HTML import).
pub fn collapse_ws(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    let mut ws = false;
    for c in s.chars() {
        if c.is_whitespace() && c != '\u{a0}' {
            if !ws {
                o.push(' ');
            }
            ws = true;
        } else {
            o.push(c);
            ws = false;
        }
    }
    o
}

/// Headings and header cells are bold already: drop a wrapping *strong* and
/// font/size spans that only restate the style.
pub fn clean_heading(c: Vec<Node>) -> Vec<Node> {
    let c = if c.len() == 1 && matches!(c[0], Node::Strong { .. }) { c[0].kids().to_vec() } else { c };
    let mut out = vec![];
    for n in c {
        match n {
            Node::Span { mut a, c } if a.contains_key("font") || a.contains_key("size") => {
                a.remove("font");
                a.remove("size");
                if a.is_empty() {
                    out.extend(clean_heading(c));
                } else {
                    out.push(Node::Span { a, c });
                }
            }
            n => out.push(n),
        }
    }
    merge_str(out)
}

// ── tables ──

#[derive(Clone, Debug, Default)]
pub struct Cell {
    pub blocks: Vec<Node>,
    pub colspan: usize,
    pub rowspan: usize,
    pub head: bool,
    pub align: String,
    pub bg: String,
}

/// Simple tables become Djot pipe tables; anything richer becomes `::: table`.
pub fn table(mut rows: Vec<Vec<Cell>>, widths: Vec<String>, caption: Option<Vec<Node>>) -> Node {
    for c in rows.iter_mut().flatten().filter(|c| c.head) {
        for b in c.blocks.iter_mut() {
            if let Node::Para { c: ic, .. } = b {
                *ic = clean_heading(std::mem::take(ic));
            }
        }
    }
    let head = rows.iter().take_while(|r| !r.is_empty() && r.iter().all(|c| c.head)).count();
    let simple = widths.iter().all(|w| w.is_empty())
        && rows.iter().enumerate().all(|(i, r)| {
            r.iter().all(|c| {
                c.colspan <= 1
                    && c.rowspan <= 1
                    && c.bg.is_empty()
                    && c.head == (i < head)
                    && c.blocks.len() <= 1
                    && c.blocks.iter().all(|b| matches!(b, Node::Para { a, c } if a.is_empty() && !c.iter().any(|x| matches!(x, Node::Hard)) ))
            })
        })
        && head <= 1;
    if simple {
        let ncol = rows.iter().map(Vec::len).max().unwrap_or(0);
        let mut c: Vec<Node> = rows
            .into_iter()
            .enumerate()
            .map(|(i, r)| {
                let mut cells: Vec<Node> = r
                    .into_iter()
                    .map(|cell| Node::Cell {
                        head: i < head,
                        align: cell.align,
                        c: cell.blocks.into_iter().next().map(|b| b.kids().to_vec()).unwrap_or_default(),
                    })
                    .collect();
                while cells.len() < ncol {
                    cells.push(Node::Cell { head: i < head, align: String::new(), c: vec![] });
                }
                Node::Row { head: i < head, c: cells }
            })
            .collect();
        if let Some(cap) = caption {
            c.push(Node::Caption { c: cap });
        }
        return Node::Table { a: Attrs::new(), c };
    }
    let mut a = Attrs::new();
    if head > 0 {
        a.insert("head".into(), head.to_string());
    }
    if widths.iter().any(|w| !w.is_empty()) {
        a.insert("widths".into(), widths.iter().map(|w| if w.is_empty() { "auto" } else { w }).collect::<Vec<_>>().join(","));
    }
    let row_items = rows
        .into_iter()
        .map(|r| {
            let cells = r
                .into_iter()
                .map(|cell| {
                    let mut body = cell.blocks;
                    let mut ca = Attrs::new();
                    if cell.colspan > 1 {
                        ca.insert("colspan".into(), cell.colspan.to_string());
                    }
                    if cell.rowspan > 1 {
                        ca.insert("rowspan".into(), cell.rowspan.to_string());
                    }
                    if !cell.align.is_empty() {
                        ca.insert("align".into(), cell.align);
                    }
                    if !cell.bg.is_empty() {
                        ca.insert("bg".into(), cell.bg);
                    }
                    if body.is_empty() {
                        body.push(Node::para(vec![Node::str("\u{a0}")]));
                    }
                    if !ca.is_empty() {
                        if !matches!(body.first(), Some(Node::Para { .. })) {
                            body.insert(0, Node::para(vec![]));
                        }
                        if let Some(Node::Para { c, .. }) = body.first_mut() {
                            let rest: Vec<Node> = std::mem::take(c).into_iter().filter(|x| !matches!(x, Node::Str { s } if s == "\u{a0}")).collect();
                            c.push(Node::Span { a: ca, c: vec![] });
                            if !rest.is_empty() {
                                c.push(Node::str(" "));
                                c.extend(rest);
                            }
                        }
                    }
                    Node::Item { checked: None, c: body }
                })
                .collect();
            Node::Item { checked: None, c: vec![Node::List { a: Attrs::new(), marker: "-".into(), start: 1, task: false, tight: true, c: cells }] }
        })
        .collect();
    let mut c = vec![Node::List { a: Attrs::new(), marker: "-".into(), start: 1, task: false, tight: true, c: row_items }];
    if let Some(cap) = caption {
        c.push(Node::para(cap));
    }
    Node::Div { a, class: "table".into(), c }
}

// ── lists from flat (level, kind, paragraph) items ──

#[derive(Clone, Debug)]
pub struct ListPara {
    pub level: usize,
    pub marker: String, // "-" or "1." "a." "i." …
    pub start: u64,
    pub block: Node,
}

/// Turn consecutive list paragraphs (with indent levels) into nested lists.
pub fn nest_lists(items: Vec<ListPara>) -> Vec<Node> {
    fn build(items: &[ListPara], level: usize) -> Vec<Node> {
        let mut out: Vec<Node> = vec![];
        let mut i = 0;
        while i < items.len() {
            let it = &items[i];
            if it.level > level {
                // deeper item without a parent at this level: attach to the previous item
                let j = (i..items.len()).find(|&j| items[j].level <= level).unwrap_or(items.len());
                let sub = build(&items[i..j], level + 1);
                match out.last_mut() {
                    Some(Node::List { c, .. }) => match c.last_mut() {
                        Some(Node::Item { c: ic, .. }) => ic.extend(sub),
                        _ => out.extend(sub),
                    },
                    _ => out.extend(sub),
                }
                i = j;
                continue;
            }
            let marker = it.marker.clone();
            let mut list_items = vec![];
            let start = it.start;
            while i < items.len() && items[i].level == level && items[i].marker == marker {
                let j = (i + 1..items.len()).find(|&j| items[j].level <= level).unwrap_or(items.len());
                let mut c = vec![items[i].block.clone()];
                c.extend(build(&items[i + 1..j], level + 1));
                list_items.push(Node::Item { checked: None, c });
                i = j;
            }
            let tight = list_items.iter().all(|x| x.kids().len() == 1);
            out.push(Node::List { a: Attrs::new(), marker, start, task: false, tight, c: list_items });
        }
        out
    }
    let min = items.iter().map(|i| i.level).min().unwrap_or(0);
    let items: Vec<ListPara> = items
        .into_iter()
        .map(|mut i| {
            i.level -= min;
            i
        })
        .collect();
    build(&items, 0)
}

pub fn mime_of(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "emf" => "image/emf",
        "wmf" => "image/wmf",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

pub fn att(name: &str, bytes: &[u8]) -> Att {
    use base64::Engine;
    Att { name: name.to_string(), mime: mime_of(name).into(), b64: base64::engine::general_purpose::STANDARD.encode(bytes) }
}

#[derive(serde::Serialize, Debug)]
pub struct Imported {
    pub doc: Node,
    pub atts: Vec<Att>,
}

/// `=meta` block from key/value pairs (skips empties).
pub fn meta_block(kv: &[(&str, String)]) -> Option<Node> {
    let s: String = kv.iter().filter(|(_, v)| !v.trim().is_empty()).map(|(k, v)| format!("{k}: {}\n", v.trim().replace('\n', " "))).collect();
    (!s.is_empty()).then(|| Node::Raw { a: Attrs::new(), format: "meta".into(), s })
}

pub fn page_name(w_mm: f64, h_mm: f64) -> (String, bool) {
    let (a, b) = if w_mm <= h_mm { (w_mm, h_mm) } else { (h_mm, w_mm) };
    let land = w_mm > h_mm;
    let near = |x: f64, y: f64| (x - y).abs() < 3.0;
    let name = if near(a, 210.0) && near(b, 297.0) {
        "A4"
    } else if near(a, 148.0) && near(b, 210.0) {
        "A5"
    } else if near(a, 297.0) && near(b, 420.0) {
        "A3"
    } else if near(a, 215.9) && near(b, 279.4) {
        "Letter"
    } else if near(a, 215.9) && near(b, 355.6) {
        "Legal"
    } else {
        "A4"
    };
    (name.into(), land)
}
