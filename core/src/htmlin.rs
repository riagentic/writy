//! Generic HTML → XAST (web pages, Word/LibreOffice HTML exports).
use crate::ast::{Attrs, Node};
use crate::html::Att;
use crate::imp::{self, Cell, Imported, Run, Style, collapse_ws};
use tl::{NodeHandle, Parser, ParserOptions};

struct Ctx<'a> {
    p: &'a Parser<'a>,
    atts: Vec<Att>,
    n_img: usize,
}

pub fn decode(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut o = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        o.push_str(&rest[..i]);
        rest = &rest[i..];
        let end = rest[..rest.len().min(12)].find(';');
        let ent = end.map(|e| &rest[1..e]);
        let ch = ent.and_then(|e| {
            if let Some(h) = e.strip_prefix("#x").or_else(|| e.strip_prefix("#X")) {
                u32::from_str_radix(h, 16).ok().and_then(char::from_u32).map(String::from)
            } else if let Some(d) = e.strip_prefix('#') {
                d.parse::<u32>().ok().and_then(char::from_u32).map(String::from)
            } else {
                Some(
                    match e {
                        "amp" => "&",
                        "lt" => "<",
                        "gt" => ">",
                        "quot" => "\"",
                        "apos" => "'",
                        "nbsp" => "\u{a0}",
                        "copy" => "©",
                        "reg" => "®",
                        "trade" => "™",
                        "hellip" => "…",
                        "mdash" => "—",
                        "ndash" => "–",
                        "lsquo" => "‘",
                        "rsquo" => "’",
                        "ldquo" => "“",
                        "rdquo" => "”",
                        "bull" => "•",
                        "middot" => "·",
                        "euro" => "€",
                        "pound" => "£",
                        "yen" => "¥",
                        "deg" => "°",
                        "times" => "×",
                        "divide" => "÷",
                        "laquo" => "«",
                        "raquo" => "»",
                        "shy" => "\u{ad}",
                        "sect" => "§",
                        "para" => "¶",
                        _ => return None,
                    }
                    .to_string(),
                )
            }
        });
        match (ch, end) {
            (Some(c), Some(e)) => {
                o.push_str(&c);
                rest = &rest[e + 1..];
            }
            _ => {
                o.push('&');
                rest = &rest[1..];
            }
        }
    }
    o.push_str(rest);
    o
}

fn attr(t: &tl::HTMLTag, k: &str) -> Option<String> {
    t.attributes().get(k).flatten().map(|v| decode(&v.as_utf8_str()))
}

fn css(t: &tl::HTMLTag) -> Vec<(String, String)> {
    attr(t, "style").unwrap_or_default().split(';').filter_map(|d| d.split_once(':').map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_string()))).collect()
}

const BLOCK: &[&str] = &[
    "p",
    "div",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "table",
    "blockquote",
    "pre",
    "hr",
    "figure",
    "dl",
    "section",
    "article",
    "main",
    "header",
    "footer",
    "aside",
    "nav",
    "address",
    "center",
    "form",
    "details",
    "summary",
    "body",
    "html",
];

pub fn import(html: &str) -> Imported {
    let dom = match tl::parse(html, ParserOptions::default()) {
        Ok(d) => d,
        Err(_) => {
            return Imported { doc: Node::Doc { a: Attrs::new(), c: vec![] }, atts: vec![] };
        }
    };
    let p = dom.parser();
    let mut ctx = Ctx { p, atts: vec![], n_img: 0 };
    let title = dom.query_selector("title").and_then(|mut q| q.next()).and_then(|h| h.get(p)).map(|n| decode(&n.inner_text(p))).unwrap_or_default();
    let roots: Vec<NodeHandle> = match dom.query_selector("body").and_then(|mut q| q.next()) {
        Some(b) => b.get(p).and_then(|n| n.children()).map(|c| c.top().to_vec()).unwrap_or_default(),
        None => dom.children().to_vec(),
    };
    let mut c = blocks(&mut ctx, &roots);
    if let Some(m) = imp::meta_block(&[("title", title)]) {
        c.insert(0, m);
    }
    Imported { doc: Node::Doc { a: Attrs::new(), c }, atts: ctx.atts }
}

fn tag_name(ctx: &Ctx, h: NodeHandle) -> Option<String> {
    h.get(ctx.p).and_then(|n| n.as_tag()).map(|t| t.name().as_utf8_str().to_lowercase())
}

fn kids(ctx: &Ctx, h: NodeHandle) -> Vec<NodeHandle> {
    h.get(ctx.p).and_then(|n| n.children()).map(|c| c.top().to_vec()).unwrap_or_default()
}

fn is_block(ctx: &Ctx, h: NodeHandle) -> bool {
    tag_name(ctx, h).is_some_and(|n| BLOCK.contains(&n.as_str()))
}

fn block_attrs(t: &tl::HTMLTag) -> Attrs {
    let mut a = Attrs::new();
    for (k, v) in css(t) {
        if k == "text-align" && ["center", "right", "justify"].contains(&v.as_str()) {
            a.insert("align".into(), v);
        }
    }
    if let Some(al) = attr(t, "align").filter(|v| ["center", "right", "justify"].contains(&v.as_str())) {
        a.insert("align".into(), al);
    }
    a
}

fn blocks(ctx: &mut Ctx, hs: &[NodeHandle]) -> Vec<Node> {
    let mut out = vec![];
    let mut inline_run: Vec<NodeHandle> = vec![];
    let flush = |ctx: &mut Ctx, run: &mut Vec<NodeHandle>, out: &mut Vec<Node>| {
        if run.is_empty() {
            return;
        }
        let mut runs = vec![];
        for h in run.drain(..) {
            inline(ctx, h, &Style::default(), &mut runs);
        }
        let c = trim(imp::inlines(&runs));
        if !c.is_empty() {
            out.push(Node::para(c));
        }
    };
    for &h in hs {
        let Some(name) = tag_name(ctx, h) else {
            inline_run.push(h);
            continue;
        };
        if !BLOCK.contains(&name.as_str())
            && !matches!(name.as_str(), "script" | "style" | "head" | "title" | "meta" | "link" | "noscript" | "template" | "svg")
        {
            inline_run.push(h);
            continue;
        }
        flush(ctx, &mut inline_run, &mut out);
        let node = h.get(ctx.p).unwrap();
        let t = node.as_tag().unwrap();
        let ks = kids(ctx, h);
        match name.as_str() {
            "script" | "style" | "head" | "title" | "meta" | "link" | "noscript" | "template" | "svg" => {}
            "p" | "summary" | "address" | "center" => {
                let mut runs = vec![];
                for k in &ks {
                    inline(ctx, *k, &Style::default(), &mut runs);
                }
                let mut a = block_attrs(t);
                if name == "center" {
                    a.insert("align".into(), "center".into());
                }
                let c = trim(imp::inlines(&runs));
                out.push(Node::Para { a, c: if c.is_empty() { vec![Node::str("\u{a0}")] } else { c } });
            }
            n if n.len() == 2 && n.starts_with('h') && n.as_bytes()[1].is_ascii_digit() => {
                let mut runs = vec![];
                for k in &ks {
                    inline(ctx, *k, &Style::default(), &mut runs);
                }
                out.push(Node::Heading { a: block_attrs(t), level: (n.as_bytes()[1] - b'0').clamp(1, 6), c: trim(imp::inlines(&runs)) });
            }
            "ul" | "ol" => {
                let mut items = vec![];
                let mut task = false;
                let lis: Vec<NodeHandle> = ks.iter().copied().filter(|k| tag_name(ctx, *k).as_deref() == Some("li")).collect();
                for k in lis.iter() {
                    let kk = kids(ctx, *k);
                    let mut checked = None;
                    if let Some(first) = kk.iter().find(|x| tag_name(ctx, **x).as_deref() == Some("input"))
                        && let Some(it) = first.get(ctx.p).and_then(|n| n.as_tag())
                        && attr(it, "type").as_deref() == Some("checkbox")
                    {
                        checked = Some(it.attributes().contains("checked"));
                        task = true;
                    }
                    let c = blocks(ctx, &kk);
                    items.push(Node::Item { checked, c: if c.is_empty() { vec![Node::para(vec![])] } else { c } });
                }
                let ordered = name == "ol";
                let marker = if ordered {
                    match attr(t, "type").as_deref() {
                        Some("a") => "a.",
                        Some("A") => "A.",
                        Some("i") => "i.",
                        Some("I") => "I.",
                        _ => "1.",
                    }
                } else {
                    "-"
                };
                let tight = items.iter().all(|i| i.kids().len() <= 1);
                if task {
                    for i in items.iter_mut() {
                        if let Node::Item { checked, .. } = i {
                            checked.get_or_insert(false);
                        }
                    }
                }
                out.push(Node::List {
                    a: Attrs::new(),
                    marker: marker.into(),
                    start: attr(t, "start").and_then(|s| s.parse().ok()).unwrap_or(1),
                    task,
                    tight,
                    c: items,
                });
            }
            "blockquote" => out.push(Node::Blockquote { a: Attrs::new(), c: blocks(ctx, &ks) }),
            "pre" => {
                let text = decode(&node.inner_text(ctx.p));
                let lang = ks
                    .iter()
                    .find_map(|k| k.get(ctx.p).and_then(|n| n.as_tag()).and_then(|ct| attr(ct, "class")))
                    .and_then(|c| c.split_whitespace().find_map(|x| x.strip_prefix("language-").map(String::from)))
                    .unwrap_or_default();
                let s = if text.ends_with('\n') { text } else { text + "\n" };
                out.push(Node::Code { a: Attrs::new(), lang, s });
            }
            "hr" => {
                let page = css(t).iter().any(|(k, v)| k.starts_with("page-break") || (k.starts_with("break-") && v == "page"));
                let mut a = Attrs::new();
                if page {
                    a.insert("class".into(), "page-break".into());
                }
                out.push(Node::Hr { a });
            }
            "table" => out.push(table(ctx, h)),
            "dl" => {
                let mut c = vec![];
                for k in &ks {
                    match tag_name(ctx, *k).as_deref() {
                        Some("dt") => {
                            let mut runs = vec![];
                            for x in kids(ctx, *k) {
                                inline(ctx, x, &Style::default(), &mut runs);
                            }
                            c.push(Node::Term { c: trim(imp::inlines(&runs)) });
                        }
                        Some("dd") => c.push(Node::Dd { c: blocks(ctx, &kids(ctx, *k)) }),
                        _ => {}
                    }
                }
                out.push(Node::Dl { a: Attrs::new(), c });
            }
            "figure" => out.push(Node::Div { a: Attrs::new(), class: "figure".into(), c: blocks(ctx, &ks) }),
            _ => {
                // div/section/…: page breaks, then contents inline into the flow
                if css(t).iter().any(|(k, v)| (k == "page-break-before" || k == "break-before") && (v == "always" || v == "page")) {
                    let mut a = Attrs::new();
                    a.insert("class".into(), "page-break".into());
                    out.push(Node::Hr { a });
                }
                out.extend(blocks(ctx, &ks));
            }
        }
    }
    flush(ctx, &mut inline_run, &mut out);
    out
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

fn inline(ctx: &mut Ctx, h: NodeHandle, st: &Style, runs: &mut Vec<Run>) {
    let Some(node) = h.get(ctx.p) else { return };
    let Some(t) = node.as_tag() else {
        if let Some(raw) = node.as_raw() {
            runs.push(Run::Text(collapse_ws(&decode(&raw.as_utf8_str())), st.clone()));
        }
        return;
    };
    let name = t.name().as_utf8_str().to_lowercase();
    let mut s = st.clone();
    for (k, v) in css(t) {
        match k.as_str() {
            "font-weight" if v == "bold" || v.parse::<u32>().is_ok_and(|n| n >= 600) => s.strong = true,
            "font-style" if v == "italic" => s.emph = true,
            "text-decoration" | "text-decoration-line" if v.contains("underline") => drop(s.ins.get_or_insert_with(Attrs::new)),
            "text-decoration" | "text-decoration-line" if v.contains("line-through") => drop(s.del.get_or_insert_with(Attrs::new)),
            "color" => drop(s.span.insert("color".into(), v)),
            "background" | "background-color" if v != "transparent" => drop(s.span.insert("bg".into(), v)),
            "font-family" => drop(s.span.insert("font".into(), v.replace(['"', '\''], ""))),
            "font-size" if v.ends_with("pt") || v.ends_with("px") || v.ends_with("em") => drop(s.span.insert("size".into(), v)),
            _ => {}
        }
    }
    match name.as_str() {
        "b" | "strong" => s.strong = true,
        "i" | "em" | "cite" | "var" | "dfn" => s.emph = true,
        "u" | "ins" => drop(s.ins.get_or_insert_with(Attrs::new)),
        "s" | "del" | "strike" => drop(s.del.get_or_insert_with(Attrs::new)),
        "mark" => s.mark = true,
        "sup" => s.sup = true,
        "sub" => s.sub = true,
        "code" | "kbd" | "samp" | "tt" => s.code = true,
        "a" => s.link = attr(t, "href"),
        "br" => return runs.push(Run::Node(Node::Hard, st.clone())),
        "img" => {
            let src = attr(t, "src").unwrap_or_default();
            let alt = attr(t, "alt").unwrap_or_default();
            let mut a = Attrs::new();
            if let Some(w) = attr(t, "width").filter(|w| !w.is_empty()) {
                a.insert("width".into(), if w.chars().all(|c| c.is_ascii_digit()) { format!("{w}px") } else { w });
            }
            let src = embed(ctx, &src).unwrap_or(src);
            return runs.push(Run::Node(Node::Image { a, src, c: if alt.is_empty() { vec![] } else { vec![Node::str(alt)] } }, st.clone()));
        }
        "video" | "audio" => {
            let src = attr(t, "src")
                .or_else(|| kids(ctx, h).iter().find_map(|k| k.get(ctx.p).and_then(|n| n.as_tag()).and_then(|x| attr(x, "src"))))
                .unwrap_or_default();
            let src = embed(ctx, &src).unwrap_or(src);
            return runs.push(Run::Node(Node::Image { a: Attrs::new(), src, c: vec![] }, st.clone()));
        }
        "script" | "style" | "noscript" | "template" | "head" | "svg" | "input" | "button" | "select" => return,
        _ => {}
    }
    for k in kids(ctx, h) {
        if is_block(ctx, k) {
            runs.push(Run::Node(Node::Hard, s.clone())); // block inside inline: keep the line break
            let text = k.get(ctx.p).map(|n| decode(&n.inner_text(ctx.p))).unwrap_or_default();
            runs.push(Run::Text(collapse_ws(&text), s.clone()));
            continue;
        }
        inline(ctx, k, &s, runs);
    }
}

/// `data:` URIs become attachments.
fn embed(ctx: &mut Ctx, src: &str) -> Option<String> {
    let rest = src.strip_prefix("data:")?;
    let (mime, b64) = rest.split_once(";base64,")?;
    ctx.n_img += 1;
    let ext = mime.rsplit('/').next().unwrap_or("bin").replace("svg+xml", "svg").replace("jpeg", "jpg");
    let name = format!("image{}.{ext}", ctx.n_img);
    ctx.atts.push(Att { name: name.clone(), mime: mime.into(), b64: b64.chars().filter(|c| !c.is_whitespace()).collect() });
    Some(format!("#att:{name}"))
}

fn table(ctx: &mut Ctx, h: NodeHandle) -> Node {
    let mut rows: Vec<Vec<Cell>> = vec![];
    let mut caption = None;
    fn collect(ctx: &Ctx, h: NodeHandle, head: bool, out: &mut Vec<(NodeHandle, bool)>, cap: &mut Option<NodeHandle>) {
        for k in kids(ctx, h) {
            match tag_name(ctx, k).as_deref() {
                Some("tr") => out.push((k, head)),
                Some("thead") => collect(ctx, k, true, out, cap),
                Some("tbody") | Some("tfoot") => collect(ctx, k, false, out, cap),
                Some("caption") => *cap = Some(k),
                _ => {}
            }
        }
    }
    let mut trs = vec![];
    let mut cap = None;
    collect(ctx, h, false, &mut trs, &mut cap);
    if let Some(c) = cap {
        let mut runs = vec![];
        for k in kids(ctx, c) {
            inline(ctx, k, &Style::default(), &mut runs);
        }
        caption = Some(trim(imp::inlines(&runs)));
    }
    for (tr, head) in trs {
        let mut row = vec![];
        for td in kids(ctx, tr) {
            let n = tag_name(ctx, td);
            if !matches!(n.as_deref(), Some("td" | "th")) {
                continue;
            }
            let t = td.get(ctx.p).and_then(|x| x.as_tag()).unwrap();
            let mut align = attr(t, "align").unwrap_or_default();
            let mut bg = attr(t, "bgcolor").unwrap_or_default();
            for (k, v) in css(t) {
                if k == "text-align" {
                    align = v;
                } else if k == "background" || k == "background-color" {
                    bg = v;
                }
            }
            let mut b = blocks(ctx, &kids(ctx, td));
            if b.iter()
                .all(|x| matches!(x, Node::Para { c, .. } if c.iter().all(|y| matches!(y, Node::Str { s } if s.trim_matches(['\u{a0}', ' ']).is_empty()))))
            {
                b.clear();
            }
            row.push(Cell {
                blocks: b,
                colspan: attr(t, "colspan").and_then(|v| v.parse().ok()).unwrap_or(1),
                rowspan: attr(t, "rowspan").and_then(|v| v.parse().ok()).unwrap_or(1),
                head: head || n.as_deref() == Some("th"),
                align: if ["left", "center", "right"].contains(&align.as_str()) { align } else { String::new() },
                bg,
            });
        }
        rows.push(row);
    }
    imp::table(rows, vec![], caption)
}
