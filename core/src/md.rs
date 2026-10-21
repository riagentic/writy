//! Markdown (CommonMark + GFM) ⇄ XAST. Import is structural; export is lossy
//! (spans, divs and attributes have no Markdown form).
use crate::ast::{Attrs, Node, merge_str};
use pulldown_cmark::{Alignment, CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};

pub fn import(src: &str) -> Node {
    let opts = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_HEADING_ATTRIBUTES
        | Options::ENABLE_MATH
        | Options::ENABLE_YAML_STYLE_METADATA_BLOCKS
        | Options::ENABLE_DEFINITION_LIST
        | Options::ENABLE_SUPERSCRIPT
        | Options::ENABLE_SUBSCRIPT;
    let e = Vec::new;
    let mut stack: Vec<Node> = vec![Node::Doc { a: Attrs::new(), c: e() }];
    let mut aligns: Vec<Alignment> = vec![];
    let mut col = 0usize;
    let mut notes = vec![];
    for ev in Parser::new_ext(src, opts) {
        let top = stack.last_mut().unwrap();
        match ev {
            Event::Start(t) => {
                let n = match t {
                    Tag::Paragraph => Node::para(e()),
                    Tag::Heading { level, id, classes, attrs } => {
                        let mut a = Attrs::new();
                        if let Some(id) = id {
                            a.insert("id".into(), id.to_string());
                        }
                        if !classes.is_empty() {
                            a.insert("class".into(), classes.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(" "));
                        }
                        for (k, v) in attrs {
                            a.insert(k.to_string(), v.map(|v| v.to_string()).unwrap_or_default());
                        }
                        Node::Heading { a, level: level_num(level), c: e() }
                    }
                    Tag::BlockQuote(_) => Node::Blockquote { a: Attrs::new(), c: e() },
                    Tag::CodeBlock(k) => Node::Code {
                        a: Attrs::new(),
                        lang: match k {
                            CodeBlockKind::Fenced(l) => l.split_whitespace().next().unwrap_or("").to_string(),
                            CodeBlockKind::Indented => String::new(),
                        },
                        s: String::new(),
                    },
                    Tag::HtmlBlock => Node::Raw { a: Attrs::new(), format: "html".into(), s: String::new() },
                    Tag::List(start) => Node::List {
                        a: Attrs::new(),
                        marker: if start.is_some() { "1.".into() } else { "-".into() },
                        start: start.unwrap_or(1),
                        task: false,
                        tight: true,
                        c: e(),
                    },
                    Tag::Item => Node::Item { checked: None, c: e() },
                    Tag::FootnoteDefinition(l) => Node::Footnote { label: l.to_string(), c: e() },
                    Tag::DefinitionList => Node::Dl { a: Attrs::new(), c: e() },
                    Tag::DefinitionListTitle => Node::Term { c: e() },
                    Tag::DefinitionListDefinition => Node::Dd { c: e() },
                    Tag::Table(al) => {
                        aligns = al;
                        Node::Table { a: Attrs::new(), c: e() }
                    }
                    Tag::TableHead => {
                        col = 0;
                        Node::Row { head: true, c: e() }
                    }
                    Tag::TableRow => {
                        col = 0;
                        Node::Row { head: false, c: e() }
                    }
                    Tag::TableCell => {
                        let head = matches!(top, Node::Row { head: true, .. });
                        let align = match aligns.get(col) {
                            Some(Alignment::Left) => "left",
                            Some(Alignment::Center) => "center",
                            Some(Alignment::Right) => "right",
                            _ => "",
                        };
                        col += 1;
                        Node::Cell { head, align: align.into(), c: e() }
                    }
                    Tag::Emphasis => Node::Emph { a: Attrs::new(), c: e() },
                    Tag::Strong => Node::Strong { a: Attrs::new(), c: e() },
                    Tag::Strikethrough => Node::Del { a: Attrs::new(), c: e() },
                    Tag::Superscript => Node::Sup { a: Attrs::new(), c: e() },
                    Tag::Subscript => Node::Sub { a: Attrs::new(), c: e() },
                    Tag::Link { dest_url, title, .. } => {
                        let mut a = Attrs::new();
                        if !title.is_empty() {
                            a.insert("title".into(), title.to_string());
                        }
                        Node::Link { a, href: dest_url.to_string(), c: e() }
                    }
                    Tag::Image { dest_url, title, .. } => {
                        let mut a = Attrs::new();
                        if !title.is_empty() {
                            a.insert("title".into(), title.to_string());
                        }
                        Node::Image { a, src: dest_url.to_string(), c: e() }
                    }
                    Tag::MetadataBlock(_) => Node::Raw { a: Attrs::new(), format: "meta".into(), s: String::new() },
                };
                stack.push(n);
            }
            Event::End(t) => {
                let mut n = stack.pop().unwrap();
                if let (TagEnd::Item, Node::Item { c, .. }) = (&t, &mut n) {
                    // tight items hold inlines directly → wrap them in a paragraph
                    if c.iter().any(Node::is_inline) {
                        let mut out = vec![];
                        let mut run = vec![];
                        for k in c.drain(..) {
                            if k.is_inline() {
                                run.push(k);
                            } else {
                                if !run.is_empty() {
                                    out.push(Node::para(std::mem::take(&mut run)));
                                }
                                out.push(k);
                            }
                        }
                        if !run.is_empty() {
                            out.push(Node::para(run));
                        }
                        *c = out;
                    }
                }
                if let Node::List { c, tight, task, .. } = &mut n {
                    *tight = c.iter().all(|i| i.kids().len() <= 1 && matches!(i.kids().first(), None | Some(Node::Para { .. })));
                    *task = c.iter().any(|i| matches!(i, Node::Item { checked: Some(_), .. }));
                    if *task {
                        for i in c.iter_mut() {
                            if let Node::Item { checked, .. } = i {
                                checked.get_or_insert(false);
                            }
                        }
                    }
                }
                if matches!(t, TagEnd::MetadataBlock(_)) {
                    // keep simple `key: value` lines only
                    if let Node::Raw { s, .. } = &mut n {
                        *s = s.lines().filter(|l| l.contains(':') && !l.starts_with(' ')).map(|l| format!("{}\n", l.replace('"', ""))).collect();
                    }
                }
                match n {
                    Node::Footnote { .. } => notes.push(n),
                    n => {
                        if let Some(c) = stack.last_mut().unwrap().kids_mut() {
                            c.push(n)
                        }
                    }
                }
            }
            Event::Text(t) => match top {
                Node::Code { s, .. } | Node::Raw { s, .. } => s.push_str(&t),
                n => {
                    if let Some(c) = n.kids_mut() {
                        c.push(Node::str(t.to_string()))
                    }
                }
            },
            Event::Code(t) => push(top, Node::Verb { a: Attrs::new(), s: t.to_string() }),
            Event::InlineMath(t) => push(top, Node::Math { display: false, s: t.to_string() }),
            Event::DisplayMath(t) => push(top, Node::Math { display: true, s: t.to_string() }),
            Event::Html(t) => match top {
                Node::Raw { s, .. } => s.push_str(&t),
                n => push(n, Node::RawI { format: "html".into(), s: t.to_string() }),
            },
            Event::InlineHtml(t) => push(top, Node::RawI { format: "html".into(), s: t.to_string() }),
            Event::FootnoteReference(l) => push(top, Node::FnRef { label: l.to_string() }),
            Event::SoftBreak => push(top, Node::Soft),
            Event::HardBreak => push(top, Node::Hard),
            Event::Rule => push(top, Node::Hr { a: Attrs::new() }),
            Event::TaskListMarker(b) => {
                if let Node::Item { checked, .. } = top {
                    *checked = Some(b)
                }
            }
        }
    }
    let mut doc = stack.pop().unwrap();
    if let Some(c) = doc.kids_mut() {
        c.extend(notes);
        *c = merge_str(std::mem::take(c));
    }
    doc
}

fn push(top: &mut Node, n: Node) {
    if let Some(c) = top.kids_mut() {
        c.push(n)
    }
}

fn level_num(l: HeadingLevel) -> u8 {
    l as u8
}

// ── export ──

pub fn export(doc: &Node) -> String {
    let mut out = blocks(doc.kids());
    out.push('\n');
    out
}

fn blocks(c: &[Node]) -> String {
    c.iter().map(block).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n\n")
}

fn indent(head: &str, body: &str, n: usize) -> String {
    let pad = " ".repeat(n);
    body.lines()
        .enumerate()
        .map(|(i, l)| {
            if i == 0 {
                format!("{head}{l}")
            } else if l.is_empty() {
                String::new()
            } else {
                format!("{pad}{l}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn block(n: &Node) -> String {
    match n {
        Node::Para { c, .. } => inl(c),
        Node::Heading { level, c, .. } => format!("{} {}", "#".repeat(*level as usize), inl(c).replace('\n', " ")),
        Node::Blockquote { c, .. } => blocks(c).lines().map(|l| if l.is_empty() { ">".into() } else { format!("> {l}") }).collect::<Vec<_>>().join("\n"),
        Node::List { marker, start, task, tight, c, .. } => {
            let ordered = marker.chars().any(|x| x.is_ascii_alphanumeric());
            c.iter()
                .enumerate()
                .map(|(i, it)| {
                    let mk = if ordered { format!("{}.", start + i as u64) } else { "-".into() };
                    let cb = match (task, it) {
                        (true, Node::Item { checked: Some(true), .. }) => "[x] ",
                        (true, _) => "[ ] ",
                        _ => "",
                    };
                    indent(&format!("{mk} {cb}"), &blocks(it.kids()), mk.len() + 1)
                })
                .collect::<Vec<_>>()
                .join(if *tight { "\n" } else { "\n\n" })
        }
        Node::Dl { c, .. } => c
            .iter()
            .map(|k| match k {
                Node::Term { c } => inl(c),
                Node::Dd { c } => indent(": ", &blocks(c), 2),
                _ => String::new(),
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Node::Table { c, .. } => {
            let rows: Vec<&Node> = c.iter().filter(|r| matches!(r, Node::Row { .. })).collect();
            let mut out = vec![];
            for (i, r) in rows.iter().enumerate() {
                let cells: Vec<String> = r.kids().iter().map(|cl| inl(cl.kids()).replace('|', "\\|").replace('\n', " ")).collect();
                out.push(format!("| {} |", cells.join(" | ")));
                if i == 0 {
                    let seps: Vec<&str> = r
                        .kids()
                        .iter()
                        .map(|cl| match cl {
                            Node::Cell { align, .. } if align == "left" => ":---",
                            Node::Cell { align, .. } if align == "right" => "---:",
                            Node::Cell { align, .. } if align == "center" => ":---:",
                            _ => "---",
                        })
                        .collect();
                    out.push(format!("| {} |", seps.join(" | ")));
                }
            }
            out.join("\n")
        }
        Node::Div { c, .. } => blocks(c),
        Node::Code { lang, s, .. } => format!("```{lang}\n{}```", if s.ends_with('\n') { s.clone() } else { format!("{s}\n") }),
        Node::Raw { format, s, .. } if format == "html" => s.trim_end().to_string(),
        Node::Raw { format, s, .. } if format == "sheet" => s.trim_end().to_string(),
        Node::Raw { format, s, .. } if format == "meta" => format!("---\n{}---", s),
        Node::Raw { .. } => String::new(),
        Node::Hr { .. } => "---".into(),
        Node::Footnote { label, c } => indent(&format!("[^{label}]: "), &blocks(c), 4),
        _ => String::new(),
    }
}

fn esc(s: &str) -> String {
    let mut o = String::new();
    for c in s.chars() {
        if "\\`*_[]<>#|".contains(c) {
            o.push('\\');
        }
        o.push(c);
    }
    o
}

fn inl(c: &[Node]) -> String {
    c.iter()
        .map(|n| match n {
            Node::Str { s } => esc(s),
            Node::Soft => "\n".into(),
            Node::Hard => "\\\n".into(),
            Node::Sym { s } => format!(":{s}:"),
            Node::FnRef { label } => format!("[^{label}]"),
            Node::Emph { c, .. } => format!("*{}*", inl(c)),
            Node::Strong { c, .. } => format!("**{}**", inl(c)),
            Node::Del { c, .. } => format!("~~{}~~", inl(c)),
            Node::Mark { c, .. } => format!("<mark>{}</mark>", inl(c)),
            Node::Ins { c, .. } => format!("<ins>{}</ins>", inl(c)),
            Node::Sup { c, .. } => format!("<sup>{}</sup>", inl(c)),
            Node::Sub { c, .. } => format!("<sub>{}</sub>", inl(c)),
            Node::Span { c, .. } => inl(c),
            Node::Link { href, c, .. } => format!("[{}]({})", inl(c), href.replace(' ', "%20")),
            Node::Image { src, c, .. } => format!("![{}]({})", inl(c), src.replace(' ', "%20")),
            Node::Verb { s, .. } => {
                let f = if s.contains('`') { "``" } else { "`" };
                format!("{f}{s}{f}")
            }
            Node::Math { display, s } => {
                if *display {
                    format!("$${s}$$")
                } else {
                    format!("${s}$")
                }
            }
            Node::RawI { format, s } if format == "html" => s.clone(),
            _ => String::new(),
        })
        .collect()
}
