//! Djot text → XAST (via jotdown events).
use crate::ast::{Attrs, Node, merge_str};
use jotdown::{
    Alignment, AttributeKind, Attributes, Container, Event, LinkType, ListBulletType as Bul, ListKind, OrderedListNumbering as Num, OrderedListStyle as Sty,
};

pub fn attrs(a: &Attributes) -> Attrs {
    let mut m = Attrs::new();
    for (k, v) in a.iter() {
        let v = v.to_string();
        match k {
            AttributeKind::Class => {
                let c = m.entry("class".into()).or_default();
                if !c.is_empty() {
                    c.push(' ');
                }
                c.push_str(&v);
            }
            AttributeKind::Id => {
                m.insert("id".into(), v);
            }
            AttributeKind::Pair { key } => {
                m.insert(key.to_string(), v);
            }
            AttributeKind::Comment => {}
        }
    }
    m
}

fn bullet(b: Bul) -> &'static str {
    match b {
        Bul::Dash => "-",
        Bul::Star => "*",
        Bul::Plus => "+",
    }
}

fn ordered_marker(n: Num, s: Sty) -> String {
    let d = match n {
        Num::Decimal => "1",
        Num::AlphaLower => "a",
        Num::AlphaUpper => "A",
        Num::RomanLower => "i",
        Num::RomanUpper => "I",
    };
    match s {
        Sty::Period => format!("{d}."),
        Sty::Paren => format!("{d})"),
        Sty::ParenParen => format!("({d})"),
    }
}

fn open(c: &Container, a: Attrs) -> Option<Node> {
    use Container as C;
    let e = Vec::new;
    Some(match c {
        C::Document | C::Section { .. } => return None,
        C::Paragraph => Node::Para { a, c: e() },
        C::Heading { level, .. } => Node::Heading { a, level: *level as u8, c: e() },
        C::Blockquote => Node::Blockquote { a, c: e() },
        C::List { kind, tight } => {
            let (marker, start, task) = match kind {
                ListKind::Unordered(b) => (bullet(*b).to_string(), 1, false),
                ListKind::Task(b) => (bullet(*b).to_string(), 1, true),
                ListKind::Ordered { numbering, style, start } => (ordered_marker(*numbering, *style), *start, false),
            };
            Node::List { a, marker, start, task, tight: *tight, c: e() }
        }
        C::ListItem => Node::Item { checked: None, c: e() },
        C::TaskListItem { checked } => Node::Item { checked: Some(*checked), c: e() },
        C::DescriptionList => Node::Dl { a, c: e() },
        C::DescriptionTerm => Node::Term { c: e() },
        C::DescriptionDetails => Node::Dd { c: e() },
        C::Footnote { label } => Node::Footnote { label: label.to_string(), c: e() },
        C::Table => Node::Table { a, c: e() },
        C::TableRow { head } => Node::Row { head: *head, c: e() },
        C::TableCell { alignment, head } => Node::Cell {
            head: *head,
            align: match alignment {
                Alignment::Unspecified => "",
                Alignment::Left => "left",
                Alignment::Center => "center",
                Alignment::Right => "right",
            }
            .into(),
            c: e(),
        },
        C::Caption => Node::Caption { c: e() },
        C::Div { class } => Node::Div { a, class: class.to_string(), c: e() },
        C::CodeBlock { language } => Node::Code { a, lang: language.to_string(), s: String::new() },
        C::RawBlock { format } => Node::Raw { a, format: format.to_string(), s: String::new() },
        C::LinkDefinition { .. } => Node::Span { a: Attrs::new(), c: e() }, // discarded on close
        C::Span => Node::Span { a, c: e() },
        C::Link(url, kind) => Node::Link {
            a,
            href: match kind {
                LinkType::Email => format!("mailto:{url}"),
                _ => url.to_string(),
            },
            c: e(),
        },
        C::Image(src, _) => Node::Image { a, src: src.to_string(), c: e() },
        C::Verbatim => Node::Verb { a, s: String::new() },
        C::Math { display } => Node::Math { display: *display, s: String::new() },
        C::RawInline { format } => Node::RawI { format: format.to_string(), s: String::new() },
        C::Subscript => Node::Sub { a, c: e() },
        C::Superscript => Node::Sup { a, c: e() },
        C::Insert => Node::Ins { a, c: e() },
        C::Delete => Node::Del { a, c: e() },
        C::Strong => Node::Strong { a, c: e() },
        C::Emphasis => Node::Emph { a, c: e() },
        C::Mark => Node::Mark { a, c: e() },
    })
}

fn text(top: &mut Node, t: &str) {
    match top {
        Node::Verb { s, .. } | Node::Math { s, .. } | Node::RawI { s, .. } | Node::Code { s, .. } | Node::Raw { s, .. } => s.push_str(t),
        n => {
            if let Some(c) = n.kids_mut() {
                c.push(Node::str(t))
            }
        }
    }
}

fn push(top: &mut Node, n: Node) {
    if let Some(c) = top.kids_mut() {
        c.push(n)
    }
}

/// Parse Djot into a canonical XAST document. Footnotes are collected at the end.
pub fn parse(src: &str) -> Node {
    let mut stack = vec![Node::Doc { a: Attrs::new(), c: vec![] }];
    let mut notes = vec![];
    for ev in jotdown::Parser::new(src) {
        let top = stack.last_mut().unwrap();
        match ev {
            Event::Start(c, a) => {
                if let Some(n) = open(&c, attrs(&a)) {
                    stack.push(n)
                }
            }
            Event::End(c) => {
                if matches!(c, Container::Document | Container::Section { .. }) {
                    continue;
                }
                let n = stack.pop().unwrap();
                if matches!(c, Container::LinkDefinition { .. }) {
                    continue;
                }
                if let Node::Footnote { .. } = n {
                    notes.push(n);
                } else {
                    push(stack.last_mut().unwrap(), n);
                }
            }
            Event::Str(s) => text(top, &s),
            Event::FootnoteReference(l) => push(top, Node::FnRef { label: l.to_string() }),
            Event::Symbol(s) => push(top, Node::Sym { s: s.to_string() }),
            Event::LeftSingleQuote => text(top, "‘"),
            Event::RightSingleQuote => text(top, "’"),
            Event::LeftDoubleQuote => text(top, "“"),
            Event::RightDoubleQuote => text(top, "”"),
            Event::Ellipsis => text(top, "…"),
            Event::EnDash => text(top, "–"),
            Event::EmDash => text(top, "—"),
            Event::NonBreakingSpace => text(top, "\u{a0}"),
            Event::Softbreak => push(top, Node::Soft),
            Event::Hardbreak => push(top, Node::Hard),
            Event::ThematicBreak(a) => push(top, Node::Hr { a: attrs(&a) }),
            Event::Escape | Event::Blankline | Event::Attributes(_) => {}
        }
    }
    let mut doc = stack.into_iter().next().unwrap();
    if let Some(c) = doc.kids_mut() {
        c.extend(notes);
        *c = merge_str(std::mem::take(c));
    }
    doc
}
