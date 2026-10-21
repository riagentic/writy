//! The Writy document tree (XAST). One shape for every producer
//! (Djot, Markdown, DOCX, ODT) and every consumer (Djot writer, HTML, editor).
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub type Attrs = BTreeMap<String, String>;

fn empty(a: &Attrs) -> bool {
    a.is_empty()
}
fn no_kids(c: &[Node]) -> bool {
    c.is_empty()
}
fn falsy(b: &bool) -> bool {
    !*b
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum Node {
    // ── blocks ──
    Doc {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        #[serde(default)]
        c: Vec<Node>,
    },
    Para {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        #[serde(default)]
        c: Vec<Node>,
    },
    Heading {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        level: u8,
        #[serde(default)]
        c: Vec<Node>,
    },
    Blockquote {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        #[serde(default)]
        c: Vec<Node>,
    },
    /// marker: "-" "*" "+" (bullet) or "1." "a)" "(I)" … (ordered: numbering char + style)
    List {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        marker: String,
        #[serde(default = "one")]
        start: u64,
        #[serde(default, skip_serializing_if = "falsy")]
        task: bool,
        #[serde(default)]
        tight: bool,
        #[serde(default)]
        c: Vec<Node>,
    },
    Item {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        checked: Option<bool>,
        #[serde(default)]
        c: Vec<Node>,
    },
    Dl {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        #[serde(default)]
        c: Vec<Node>,
    },
    Term {
        #[serde(default)]
        c: Vec<Node>,
    },
    Dd {
        #[serde(default)]
        c: Vec<Node>,
    },
    Table {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        #[serde(default)]
        c: Vec<Node>,
    },
    Caption {
        #[serde(default)]
        c: Vec<Node>,
    },
    Row {
        #[serde(default, skip_serializing_if = "falsy")]
        head: bool,
        #[serde(default)]
        c: Vec<Node>,
    },
    /// align: "" | "left" | "center" | "right"
    Cell {
        #[serde(default, skip_serializing_if = "falsy")]
        head: bool,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        align: String,
        #[serde(default)]
        c: Vec<Node>,
    },
    Div {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        class: String,
        #[serde(default)]
        c: Vec<Node>,
    },
    Code {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        lang: String,
        s: String,
    },
    Raw {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        format: String,
        s: String,
    },
    Hr {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
    },
    Footnote {
        label: String,
        #[serde(default)]
        c: Vec<Node>,
    },

    // ── inlines ──
    Str {
        s: String,
    },
    Soft,
    Hard,
    Sym {
        s: String,
    },
    FnRef {
        label: String,
    },
    Emph {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        #[serde(default)]
        c: Vec<Node>,
    },
    Strong {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        #[serde(default)]
        c: Vec<Node>,
    },
    Mark {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        #[serde(default)]
        c: Vec<Node>,
    },
    Sup {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        #[serde(default)]
        c: Vec<Node>,
    },
    Sub {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        #[serde(default)]
        c: Vec<Node>,
    },
    Ins {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        #[serde(default)]
        c: Vec<Node>,
    },
    Del {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        #[serde(default)]
        c: Vec<Node>,
    },
    Span {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        #[serde(default, skip_serializing_if = "no_kids")]
        c: Vec<Node>,
    },
    Link {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        href: String,
        #[serde(default)]
        c: Vec<Node>,
    },
    Image {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        src: String,
        #[serde(default)]
        c: Vec<Node>,
    },
    Verb {
        #[serde(default, skip_serializing_if = "empty")]
        a: Attrs,
        s: String,
    },
    Math {
        #[serde(default, skip_serializing_if = "falsy")]
        display: bool,
        s: String,
    },
    RawI {
        format: String,
        s: String,
    },
}

fn one() -> u64 {
    1
}

impl Node {
    pub fn str(s: impl Into<String>) -> Node {
        Node::Str { s: s.into() }
    }
    pub fn para(c: Vec<Node>) -> Node {
        Node::Para { a: Attrs::new(), c }
    }
    pub fn kids(&self) -> &[Node] {
        use Node::*;
        match self {
            Doc { c, .. }
            | Para { c, .. }
            | Heading { c, .. }
            | Blockquote { c, .. }
            | List { c, .. }
            | Item { c, .. }
            | Dl { c, .. }
            | Term { c }
            | Dd { c }
            | Table { c, .. }
            | Caption { c }
            | Row { c, .. }
            | Cell { c, .. }
            | Div { c, .. }
            | Footnote { c, .. }
            | Emph { c, .. }
            | Strong { c, .. }
            | Mark { c, .. }
            | Sup { c, .. }
            | Sub { c, .. }
            | Ins { c, .. }
            | Del { c, .. }
            | Span { c, .. }
            | Link { c, .. }
            | Image { c, .. } => c,
            _ => &[],
        }
    }
    pub fn kids_mut(&mut self) -> Option<&mut Vec<Node>> {
        use Node::*;
        match self {
            Doc { c, .. }
            | Para { c, .. }
            | Heading { c, .. }
            | Blockquote { c, .. }
            | List { c, .. }
            | Item { c, .. }
            | Dl { c, .. }
            | Term { c }
            | Dd { c }
            | Table { c, .. }
            | Caption { c }
            | Row { c, .. }
            | Cell { c, .. }
            | Div { c, .. }
            | Footnote { c, .. }
            | Emph { c, .. }
            | Strong { c, .. }
            | Mark { c, .. }
            | Sup { c, .. }
            | Sub { c, .. }
            | Ins { c, .. }
            | Del { c, .. }
            | Span { c, .. }
            | Link { c, .. }
            | Image { c, .. } => Some(c),
            _ => None,
        }
    }
    pub fn attrs(&self) -> Option<&Attrs> {
        use Node::*;
        match self {
            Doc { a, .. }
            | Para { a, .. }
            | Heading { a, .. }
            | Blockquote { a, .. }
            | List { a, .. }
            | Dl { a, .. }
            | Table { a, .. }
            | Div { a, .. }
            | Code { a, .. }
            | Raw { a, .. }
            | Hr { a }
            | Emph { a, .. }
            | Strong { a, .. }
            | Mark { a, .. }
            | Sup { a, .. }
            | Sub { a, .. }
            | Ins { a, .. }
            | Del { a, .. }
            | Span { a, .. }
            | Link { a, .. }
            | Image { a, .. }
            | Verb { a, .. } => Some(a),
            _ => None,
        }
    }
    pub fn attrs_mut(&mut self) -> Option<&mut Attrs> {
        use Node::*;
        match self {
            Doc { a, .. }
            | Para { a, .. }
            | Heading { a, .. }
            | Blockquote { a, .. }
            | List { a, .. }
            | Dl { a, .. }
            | Table { a, .. }
            | Div { a, .. }
            | Code { a, .. }
            | Raw { a, .. }
            | Hr { a }
            | Emph { a, .. }
            | Strong { a, .. }
            | Mark { a, .. }
            | Sup { a, .. }
            | Sub { a, .. }
            | Ins { a, .. }
            | Del { a, .. }
            | Span { a, .. }
            | Link { a, .. }
            | Image { a, .. }
            | Verb { a, .. } => Some(a),
            _ => None,
        }
    }
    pub fn is_inline(&self) -> bool {
        use Node::*;
        matches!(
            self,
            Str { .. }
                | Soft
                | Hard
                | Sym { .. }
                | FnRef { .. }
                | Emph { .. }
                | Strong { .. }
                | Mark { .. }
                | Sup { .. }
                | Sub { .. }
                | Ins { .. }
                | Del { .. }
                | Span { .. }
                | Link { .. }
                | Image { .. }
                | Verb { .. }
                | Math { .. }
                | RawI { .. }
        )
    }
    /// Plain text of a subtree (alt text, captions, ids).
    pub fn text(&self) -> String {
        let mut o = String::new();
        self.text_into(&mut o);
        o
    }
    fn text_into(&self, o: &mut String) {
        match self {
            Node::Str { s } | Node::Verb { s, .. } | Node::Math { s, .. } | Node::Code { s, .. } => o.push_str(s),
            Node::Soft => o.push(' '),
            Node::Hard => o.push('\n'),
            _ => self.kids().iter().for_each(|k| k.text_into(o)),
        }
    }
}

/// Merge adjacent Str nodes, recursively — the canonical inline form.
pub fn merge_str(c: Vec<Node>) -> Vec<Node> {
    let mut out: Vec<Node> = Vec::with_capacity(c.len());
    for mut n in c {
        if let Some(k) = n.kids_mut() {
            *k = merge_str(std::mem::take(k));
        }
        match (out.last_mut(), &n) {
            (Some(Node::Str { s: prev }), Node::Str { s }) => prev.push_str(s),
            (_, Node::Str { s }) if s.is_empty() => {}
            _ => out.push(n),
        }
    }
    out
}
