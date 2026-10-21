//! XAST → canonical Djot. Minimal escaping first; every top-level block is
//! re-parsed and, if it does not round-trip, rewritten in safe mode
//! (braced delimiters + every ASCII punctuation escaped).
use crate::ast::{Attrs, Node, merge_str};
use crate::parse::parse;

/// Paragraph text is re-wrapped at this width (source readability in text editors).
const WRAP: usize = 80;
/// Placeholder for a space where a line may break (private-use char).
const BREAK: char = '\u{E000}';

/// Greedy line fill over the BREAK points; never starts a line with block syntax.
fn reflow(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut col = 0usize;
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\n' {
            out.push(c);
            col = 0;
        } else if c == BREAK {
            let rest = &chars[i + 1..];
            let word = rest.iter().take_while(|x| **x != BREAK && **x != '\n').count();
            if col + 1 + word > WRAP && col > 0 && safe_line_start(rest) {
                out.push('\n');
                col = 0;
            } else {
                out.push(' ');
                col += 1;
            }
        } else {
            out.push(c);
            col += 1;
        }
        i += 1;
    }
    out
}

fn safe_line_start(rest: &[char]) -> bool {
    let rest: Vec<char> = rest.iter().map(|c| if *c == BREAK { ' ' } else { *c }).collect();
    let (a, b) = (rest.first().copied(), rest.get(1).copied());
    let bad = match a {
        None => true,
        Some('-' | '+' | '#' | '>' | ':' | '|' | '{' | '}' | '^' | '~' | '=' | '%' | ' ') => true,
        Some('*') => b.is_none_or(|x| x == ' '),
        Some('[') => b == Some('^'),
        Some('`') => rest.iter().take(3).filter(|x| **x == '`').count() == 3,
        _ => false,
    };
    !bad && list_number_ahead(&rest).is_none()
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Plain,
    Safe,
}

pub fn write(doc: &Node) -> String {
    let doc = normalize(doc.clone());
    let (notes, body): (Vec<&Node>, Vec<&Node>) = doc.kids().iter().partition(|n| matches!(n, Node::Footnote { .. }));
    let mut parts: Vec<String> = Vec::new();
    let mut prev: Option<&Node> = None;
    for b in body {
        let mut s = checked_block(b);
        if let (Some(Node::List { marker: m1, task: t1, .. }), Node::List { marker: m2, task: t2, .. }) = (prev, b)
            && m1 == m2
            && t1 == t2
        {
            s = format!("{{% %}}\n{s}"); // keeps two adjacent lists apart
        }
        parts.push(s);
        prev = Some(b);
    }
    for n in notes {
        if let Node::Footnote { label, c } = n {
            parts.push(item(&format!("[^{label}]:"), &blocks(c, Mode::Plain), 2));
        }
    }
    let mut out = parts.join("\n\n");
    out.push('\n');
    out
}

fn checked_block(b: &Node) -> String {
    let s = block(b, Mode::Plain);
    if same(b, &s) {
        return s;
    }
    block(b, Mode::Safe)
}

fn same(b: &Node, s: &str) -> bool {
    let want = normalize(Node::Doc { a: Attrs::new(), c: vec![b.clone()] });
    let got = normalize(parse(s));
    want == got
}

// ── normalization: the canonical form both sides are compared in ──

pub fn normalize(mut n: Node) -> Node {
    if let Some(c) = n.kids_mut() {
        let kids: Vec<Node> = std::mem::take(c).into_iter().map(normalize).collect();
        *c = if kids.iter().any(Node::is_inline) { norm_inlines(kids) } else { kids };
    }
    match &mut n {
        Node::Para { c, .. } | Node::Heading { c, .. } | Node::Term { c } | Node::Caption { c } | Node::Cell { c, .. } => trim_line(c),
        Node::List { tight, c, .. } => {
            if c.iter().any(|i| i.kids().len() > 1) {
                *tight = false;
            }
        }
        Node::Table { c, .. } => c.sort_by_key(|k| !matches!(k, Node::Caption { .. })), // caption first, rows in order
        Node::Link { href, .. } => *href = dest(href),
        Node::Image { src, .. } => *src = dest(src),
        Node::Raw { format, s, .. } if format == "sheet" => {
            let (rows, head) = crate::sheet::parse_grid(s);
            *s = crate::sheet::format_grid(&rows, head);
        }
        Node::Code { s, .. } | Node::Raw { s, .. } if !s.is_empty() && !s.ends_with('\n') => {
            s.push('\n');
        }
        _ => {}
    }
    n
}

fn delim(n: &Node) -> bool {
    matches!(n, Node::Emph { .. } | Node::Strong { .. } | Node::Mark { .. } | Node::Sup { .. } | Node::Sub { .. } | Node::Ins { .. } | Node::Del { .. })
}

fn norm_inlines(c: Vec<Node>) -> Vec<Node> {
    let mut out = Vec::new();
    for mut n in c {
        if matches!(n, Node::Soft) {
            n = Node::str(" ");
        }
        if delim(&n) {
            let k = n.kids_mut().unwrap();
            if k.is_empty() {
                continue;
            }
            let lead = take_ws(k, true);
            let trail = take_ws(k, false);
            if k.is_empty() {
                out.push(Node::str(lead + &trail));
                continue;
            }
            out.push(Node::str(lead));
            out.push(n);
            out.push(Node::str(trail));
        } else if let Node::Span { a, c } = &n {
            if a.is_empty() {
                out.extend(c.clone());
            } else {
                out.push(n);
            }
        } else {
            out.push(n);
        }
    }
    merge_str(out)
}

/// Remove leading (or trailing) whitespace from an inline list, returning it.
fn take_ws(k: &mut Vec<Node>, lead: bool) -> String {
    let idx = if lead { 0 } else { k.len().wrapping_sub(1) };
    if let Some(Node::Str { s }) = k.get_mut(idx) {
        let t = if lead { s.trim_start_matches(' ') } else { s.trim_end_matches(' ') };
        let ws = if lead { s[..s.len() - t.len()].to_string() } else { s[t.len()..].to_string() };
        *s = t.to_string();
        if s.is_empty() {
            k.remove(idx);
        }
        return ws;
    }
    String::new()
}

/// Djot drops whitespace at line edges and a break at paragraph end.
fn trim_line(c: &mut Vec<Node>) {
    while matches!(c.last(), Some(Node::Soft | Node::Hard)) {
        c.pop();
    }
    let n = c.len();
    for i in 0..n {
        let before_break = matches!(c.get(i + 1), Some(Node::Soft | Node::Hard)) || i + 1 == n;
        let after_break = i == 0 || matches!(c.get(i.wrapping_sub(1)), Some(Node::Soft | Node::Hard));
        if let Node::Str { s } = &mut c[i] {
            if before_break {
                *s = s.trim_end_matches([' ', '\t']).to_string();
            }
            if after_break {
                *s = s.trim_start_matches([' ', '\t']).to_string();
            }
        }
    }
    c.retain(|x| !matches!(x, Node::Str { s } if s.is_empty()));
}

// ── blocks ──

fn blocks(c: &[Node], m: Mode) -> String {
    let mut parts = Vec::new();
    let mut prev: Option<&Node> = None;
    for b in c {
        let mut s = block(b, m);
        if let (Some(Node::List { marker: m1, task: t1, .. }), Node::List { marker: m2, task: t2, .. }) = (prev, b)
            && m1 == m2
            && t1 == t2
        {
            s = format!("{{% %}}\n{s}");
        }
        parts.push(s);
        prev = Some(b);
    }
    parts.join("\n\n")
}

pub fn attrs(a: &Attrs) -> String {
    if a.is_empty() {
        return String::new();
    }
    let mut p = Vec::new();
    let bare = |v: &str| !v.is_empty() && v.chars().all(|ch| ch.is_ascii_alphanumeric() || "_-:".contains(ch));
    let quote = |v: &str| format!("\"{}\"", v.replace('\\', "\\\\").replace('"', "\\\""));
    if let Some(id) = a.get("id") {
        p.push(if bare(id) { format!("#{id}") } else { format!("id={}", quote(id)) });
    }
    if let Some(cls) = a.get("class") {
        if cls.split(' ').all(&bare) {
            p.extend(cls.split(' ').map(|c| format!(".{c}")));
        } else {
            p.push(format!("class={}", quote(cls)));
        }
    }
    for (k, v) in a {
        if k == "id" || k == "class" {
            continue;
        }
        p.push(format!("{k}={}", if bare(v) { v.clone() } else { quote(v) }));
    }
    format!("{{{}}}", p.join(" "))
}

fn with_attrs(a: Option<&Attrs>, body: String) -> String {
    match a {
        Some(a) if !a.is_empty() => format!("{}\n{body}", attrs(a)),
        _ => body,
    }
}

/// First line after `head`, the rest indented by `ind` spaces.
fn item(head: &str, body: &str, ind: usize) -> String {
    if body.is_empty() {
        return head.to_string();
    }
    let pad = " ".repeat(ind);
    let mut out = String::new();
    for (i, l) in body.lines().enumerate() {
        if i == 0 {
            out.push_str(head);
            out.push(' ');
            out.push_str(l);
        } else {
            out.push('\n');
            if !l.is_empty() {
                out.push_str(&pad);
                out.push_str(l);
            }
        }
    }
    out
}

fn fence(ch: char, s: &str, min: usize) -> String {
    let mut run = 0;
    let mut max = 0;
    for c in s.chars() {
        if c == ch {
            run += 1;
            max = max.max(run);
        } else {
            run = 0;
        }
    }
    std::iter::repeat_n(ch, min.max(max + 1)).collect()
}

fn div_depth(c: &[Node]) -> usize {
    c.iter()
        .map(|n| match n {
            Node::Div { c, .. } => 1 + div_depth(c),
            n => div_depth(n.kids()),
        })
        .max()
        .unwrap_or(0)
}

fn roman(mut n: u64, upper: bool) -> String {
    const T: [(u64, &str); 13] =
        [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"), (50, "l"), (40, "xl"), (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")];
    let mut s = String::new();
    for (v, r) in T {
        while n >= v {
            s.push_str(r);
            n -= v;
        }
    }
    if upper { s.to_uppercase() } else { s }
}

fn alpha(mut n: u64, upper: bool) -> String {
    let mut s = Vec::new();
    while n > 0 {
        n -= 1;
        s.push((b'a' + (n % 26) as u8) as char);
        n /= 26;
    }
    let s: String = s.into_iter().rev().collect();
    if upper { s.to_uppercase() } else { s }
}

fn marker(tpl: &str, n: u64) -> String {
    let (num, kind) = match tpl.chars().find(|c| c.is_ascii_alphanumeric()) {
        Some('1') => (n.to_string(), '1'),
        Some('a') => (alpha(n, false), 'a'),
        Some('A') => (alpha(n, true), 'A'),
        Some('i') => (roman(n, false), 'i'),
        Some('I') => (roman(n, true), 'I'),
        _ => return tpl.to_string(),
    };
    tpl.replacen(kind, &num, 1)
}

fn block(n: &Node, m: Mode) -> String {
    match n {
        Node::Para { a, c } => {
            let wrap = m == Mode::Plain && !Node::Para { a: Attrs::new(), c: c.clone() }.text().contains(BREAK);
            let text = inlines(c, if wrap { m } else { Mode::Safe }, Ctx::Block);
            with_attrs(Some(a), if wrap { reflow(&text) } else { text })
        }
        Node::Heading { a, level, c } => with_attrs(Some(a), format!("{} {}", "#".repeat(*level as usize), inlines(c, m, Ctx::Line)).trim_end().to_string()),
        Node::Blockquote { a, c } => {
            let inner = blocks(c, m);
            let q = if inner.is_empty() {
                ">".to_string()
            } else {
                inner.lines().map(|l| if l.is_empty() { ">".to_string() } else { format!("> {l}") }).collect::<Vec<_>>().join("\n")
            };
            with_attrs(Some(a), q)
        }
        Node::List { a, marker: tpl, start, task, tight, c } => {
            let items: Vec<String> = c
                .iter()
                .enumerate()
                .map(|(i, it)| {
                    let mk = marker(tpl, start + i as u64);
                    let (checked, kids) = match it {
                        Node::Item { checked, c } => (*checked, c.as_slice()),
                        other => (None, std::slice::from_ref(other)),
                    };
                    let head = match (task, checked) {
                        (true, Some(true)) => format!("{mk} [x]"),
                        (true, _) => format!("{mk} [ ]"),
                        _ => mk.clone(),
                    };
                    item(&head, &blocks(kids, m), mk.chars().count() + 1)
                })
                .collect();
            with_attrs(Some(a), items.join(if *tight { "\n" } else { "\n\n" }))
        }
        Node::Dl { a, c } => {
            let mut parts = Vec::new();
            let mut i = 0;
            while i < c.len() {
                if let Node::Term { c: t } = &c[i] {
                    let dd = match c.get(i + 1) {
                        Some(Node::Dd { c: d }) => {
                            i += 1;
                            blocks(d, m)
                        }
                        _ => String::new(),
                    };
                    let term = inlines(t, m, Ctx::Line);
                    let body = if dd.is_empty() { term } else { format!("{term}\n\n{dd}") };
                    parts.push(item(":", &body, 2));
                }
                i += 1;
            }
            with_attrs(Some(a), parts.join("\n\n"))
        }
        Node::Table { a, c } => with_attrs(Some(a), table(c, m)),
        Node::Div { a, class, c } => {
            let f = ":".repeat(3 + div_depth(c));
            let open = if class.is_empty() { f.clone() } else { format!("{f} {class}") };
            let inner = blocks(c, m);
            let body = if inner.is_empty() { format!("{open}\n{f}") } else { format!("{open}\n{inner}\n{f}") };
            with_attrs(Some(a), body)
        }
        Node::Code { a, lang, s } => {
            let f = fence('`', s, 3);
            with_attrs(Some(a), format!("{f}{lang}\n{s}{f}"))
        }
        Node::Raw { a, format, s } => {
            let f = fence('`', s, 3);
            with_attrs(Some(a), format!("{f} ={format}\n{s}{f}"))
        }
        Node::Hr { a } => with_attrs(Some(a), "* * *".into()),
        Node::Footnote { label, c } => item(&format!("[^{label}]:"), &blocks(c, m), 2),
        Node::Doc { c, .. } => blocks(c, m),
        other if other.is_inline() => inlines(std::slice::from_ref(other), m, Ctx::Block),
        _ => String::new(),
    }
}

fn table(c: &[Node], m: Mode) -> String {
    let rows: Vec<(&bool, Vec<(String, &str)>)> = c
        .iter()
        .filter_map(|r| match r {
            Node::Row { head, c } => Some((
                head,
                c.iter()
                    .filter_map(|cell| match cell {
                        Node::Cell { align, c, .. } => Some((inlines(c, m, Ctx::Cell), align.as_str())),
                        _ => None,
                    })
                    .collect(),
            )),
            _ => None,
        })
        .collect();
    let ncol = rows.iter().map(|r| r.1.len()).max().unwrap_or(0);
    let mut w = vec![3usize; ncol];
    for (_, cells) in &rows {
        for (i, (t, _)) in cells.iter().enumerate() {
            w[i] = w[i].max(t.chars().count());
        }
    }
    let mut lines = Vec::new();
    for (head, cells) in &rows {
        let cell = |i: usize| cells.get(i).map(|x| x.0.as_str()).unwrap_or("");
        let line: Vec<String> = (0..ncol).map(|i| format!(" {}{} ", cell(i), " ".repeat(w[i] - cell(i).chars().count()))).collect();
        lines.push(format!("|{}|", line.join("|")));
        if **head {
            let sep: Vec<String> = (0..ncol)
                .map(|i| {
                    let al = cells.get(i).map(|x| x.1).unwrap_or("");
                    let d = w[i];
                    match al {
                        "left" => format!(":{}", "-".repeat(d + 1)),
                        "right" => format!("{}:", "-".repeat(d + 1)),
                        "center" => format!(":{}:", "-".repeat(d)),
                        _ => "-".repeat(d + 2),
                    }
                })
                .collect();
            lines.push(format!("|{}|", sep.join("|")));
        }
    }
    let mut out = lines.join("\n");
    for n in c {
        if let Node::Caption { c } = n {
            out.push_str("\n\n^ ");
            out.push_str(&inlines(c, m, Ctx::Line));
        }
    }
    out
}

// ── inlines ──

#[derive(Clone, Copy, PartialEq)]
enum Ctx {
    Block, // paragraph: line-start escaping applies
    Line,  // heading / term / caption: one line
    Cell,  // table cell: one line, `|` escaped
}

fn inlines(c: &[Node], m: Mode, ctx: Ctx) -> String {
    let mut o = String::new();
    inlines_into(c, m, ctx, &mut o);
    o
}

fn inlines_into(c: &[Node], m: Mode, ctx: Ctx, o: &mut String) {
    for (i, n) in c.iter().enumerate() {
        inline(n, m, ctx, o, c.get(i + 1));
    }
}

fn at_line_start(o: &str) -> bool {
    o.is_empty() || o.ends_with('\n')
}

fn inline(n: &Node, m: Mode, ctx: Ctx, o: &mut String, next: Option<&Node>) {
    let wrap = |o: &mut String, open: &str, close: &str, c: &[Node], a: &Attrs| {
        o.push_str(open);
        inlines_into(c, m, ctx, o);
        o.push_str(close);
        o.push_str(&attrs(a));
    };
    let safe = m == Mode::Safe;
    match n {
        Node::Str { s } => esc(s, m, ctx, o, next),
        Node::Soft => o.push(if ctx == Ctx::Block { '\n' } else { ' ' }),
        Node::Hard => o.push_str(if ctx == Ctx::Block { "\\\n" } else { " " }),
        Node::Sym { s } => {
            o.push(':');
            o.push_str(s);
            o.push(':');
        }
        Node::FnRef { label } => {
            o.push_str("[^");
            o.push_str(label);
            o.push(']');
        }
        Node::Emph { a, c } => {
            if safe {
                wrap(o, "{_", "_}", c, a)
            } else {
                wrap(o, "_", "_", c, a)
            }
        }
        Node::Strong { a, c } => {
            if safe {
                wrap(o, "{*", "*}", c, a)
            } else {
                wrap(o, "*", "*", c, a)
            }
        }
        Node::Sup { a, c } => {
            if safe {
                wrap(o, "{^", "^}", c, a)
            } else {
                wrap(o, "^", "^", c, a)
            }
        }
        Node::Sub { a, c } => {
            if safe {
                wrap(o, "{~", "~}", c, a)
            } else {
                wrap(o, "~", "~", c, a)
            }
        }
        Node::Mark { a, c } => wrap(o, "{=", "=}", c, a),
        Node::Ins { a, c } => wrap(o, "{+", "+}", c, a),
        Node::Del { a, c } => wrap(o, "{-", "-}", c, a),
        Node::Span { a, c } => wrap(o, "[", "]", c, a),
        Node::Link { a, href, c } => {
            let txt = Node::Para { a: Attrs::new(), c: c.clone() }.text();
            let auto = c.len() == 1 && a.is_empty() && matches!(&c[0], Node::Str { .. }) && !href.contains(['<', '>', ' ']);
            if auto && (txt == *href && href.contains("://")) {
                o.push_str(&format!("<{href}>"));
            } else if auto && href.strip_prefix("mailto:") == Some(txt.as_str()) {
                o.push_str(&format!("<{txt}>"));
            } else {
                wrap(o, "[", &format!("]({})", dest(href)), c, a);
            }
        }
        Node::Image { a, src, c } => wrap(o, "![", &format!("]({})", dest(src)), c, a),
        Node::Verb { a, s } => {
            let f = fence('`', s, 1);
            let pad = if s.starts_with('`') || s.ends_with('`') { " " } else { "" };
            o.push_str(&format!("{f}{pad}{s}{pad}{f}"));
            o.push_str(&attrs(a));
        }
        Node::Math { display, s } => {
            let f = fence('`', s, 1);
            let pad = if s.starts_with('`') || s.ends_with('`') { " " } else { "" };
            o.push_str(&format!("{}{f}{pad}{s}{pad}{f}", if *display { "$$" } else { "$" }));
        }
        Node::RawI { format, s } => {
            let f = fence('`', s, 1);
            let pad = if s.starts_with('`') || s.ends_with('`') { " " } else { "" };
            o.push_str(&format!("{f}{pad}{s}{pad}{f}{{={format}}}"));
        }
        _ => {}
    }
}

/// Link/image destinations: Djot has no escapes there, so URL-encode what would end them.
pub fn dest(u: &str) -> String {
    u.replace(' ', "%20").replace('(', "%28").replace(')', "%29").replace('<', "%3C").replace('>', "%3E")
}

fn esc(s: &str, m: Mode, ctx: Ctx, o: &mut String, next: Option<&Node>) {
    let ch: Vec<char> = s.chars().collect();
    let n = ch.len();
    let mut force = vec![false; n];
    for i in 0..n {
        let c = ch[i];
        let nx = ch.get(i + 1).copied();
        let line_start = ctx == Ctx::Block && at_line_start(o);
        if c == '\u{a0}' {
            o.push_str("\\ ");
            continue;
        }
        // a breakable space in paragraph text: decided later by `reflow`
        let after_ok = nx.map_or(next.is_some(), |x| x != ' ');
        let before_ok = if i > 0 { ch[i - 1] != ' ' } else { !o.is_empty() && !o.ends_with([' ', BREAK, '\n']) };
        if c == ' ' && ctx == Ctx::Block && m == Mode::Plain && after_ok && before_ok {
            o.push(BREAK);
            continue;
        }
        let need = if m == Mode::Safe {
            c.is_ascii_punctuation()
        } else {
            match c {
                '\\' | '`' | '*' | '_' | '[' | ']' | '{' | '}' | '^' | '~' | '"' | '\'' => true,
                '<' => nx.is_some_and(|x| !x.is_whitespace()),
                '-' => nx == Some('-') || (line_start && nx.is_none_or(|x| x == ' ')),
                '+' => line_start && nx.is_none_or(|x| x == ' '),
                '.' => nx == Some('.') && ch.get(i + 2) == Some(&'.'),
                '|' => ctx == Ctx::Cell || line_start,
                '#' | '>' => line_start,
                ':' => (line_start && nx.is_none_or(|x| x == ' ' || x == ':')) || symbol_ahead(&ch[i + 1..]),
                '$' => nx.is_none() && matches!(next, Some(Node::Verb { .. })),
                '!' => nx.is_none() && matches!(next, Some(Node::Link { .. } | Node::Span { .. })),
                _ => false,
            }
        };
        // "1. " / "a) " / "(i) " at a line start would open an ordered list
        if m == Mode::Plain
            && line_start
            && let Some(j) = list_number_ahead(&ch[i..])
        {
            force[i + j] = true;
        }
        if need || force[i] {
            o.push('\\');
        }
        o.push(c);
    }
}

fn symbol_ahead(rest: &[char]) -> bool {
    let k = rest.iter().take_while(|c| c.is_ascii_alphanumeric() || "_+-".contains(**c)).count();
    k > 0 && rest.get(k) == Some(&':')
}

/// Offset of the punctuation to escape when `s` starts like an ordered-list marker.
fn list_number_ahead(s: &[char]) -> Option<usize> {
    let paren = s.first() == Some(&'(');
    let body = if paren { &s[1..] } else { s };
    let k = body.iter().take_while(|c| c.is_ascii_alphanumeric()).count();
    if k == 0 {
        return None;
    }
    let all_digit = body[..k].iter().all(|c| c.is_ascii_digit());
    let roman_or_alpha = k == 1 || body[..k].iter().all(|c| "ivxlcdmIVXLCDM".contains(*c));
    let ok = (all_digit || roman_or_alpha) && matches!(body.get(k), Some('.' | ')')) && body.get(k + 1).is_none_or(|c| *c == ' ');
    ok.then_some(if paren { 0 } else { k })
}
