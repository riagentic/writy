//! PDF → XAST, best effort, from poppler's `pdftohtml -xml` output (positioned
//! text boxes + fonts). Rebuilds lines → paragraphs, headings (font size/bold),
//! lists (bullet/number markers), simple column tables, images, alignment, and
//! drops repeated page headers/footers. PDF has no structure; this is heuristic.
use crate::ast::{Attrs, Node};
use crate::html::Att;
use crate::imp::{self, Cell, Imported, ListPara, Run, Style};
use crate::xml::{self, El, X};
use std::collections::HashMap;

/// pdftohtml renders at zoom 1.5 → 108 px per inch.
const PX_MM: f64 = 25.4 / 108.0;
const BULLETS: &[char] = &['•', '●', '○', '◦', '▪', '■', '□', '–', '-', '*', '·', '➢', '►', '✓', '❖'];

#[derive(Clone, Debug)]
struct Font {
    size: f64,
    bold: bool,
    italic: bool,
    color: String,
}

#[derive(Clone, Debug)]
struct Item {
    top: f64,
    left: f64,
    w: f64,
    h: f64,
    size: f64,
    runs: Vec<Run>,
    text: String,
    bold: bool, // whole item bold
}

#[derive(Clone, Debug)]
struct Line {
    top: f64,
    bottom: f64,
    left: f64,
    right: f64,
    size: f64,
    items: Vec<Item>,
}

impl Line {
    fn text(&self) -> String {
        self.items.iter().map(|i| i.text.as_str()).collect::<Vec<_>>().join(" ")
    }
    fn bold(&self) -> bool {
        self.items.iter().filter(|i| !i.text.trim().is_empty()).all(|i| i.bold)
    }
    /// Cells separated by wide horizontal gaps (table candidates).
    fn cells(&self) -> Vec<Vec<&Item>> {
        let mut out: Vec<Vec<&Item>> = vec![];
        let mut right = f64::MIN;
        for it in &self.items {
            if out.is_empty() || it.left - right > 1.2 * self.size {
                out.push(vec![it]);
            } else {
                out.last_mut().unwrap().push(it);
            }
            right = right.max(it.left + it.w);
        }
        out
    }
}

enum Block {
    Lines(Vec<Line>),
    Image { w: f64, src: String },
}

struct Page {
    w: f64,
    h: f64,
    lines: Vec<Line>,
    images: Vec<(f64, f64, f64, String)>, // top, left, width, file name
}

fn num(e: &El, k: &str) -> f64 {
    e.attr(k).and_then(|v| v.parse().ok()).unwrap_or(0.0)
}

fn base(p: &str) -> &str {
    p.rsplit(['/', '\\']).next().unwrap_or(p)
}

/// Text box children (<b>, <i>, <a href>) → styled runs.
fn runs(kids: &[X], st: &Style, out: &mut Vec<Run>) {
    for k in kids {
        match k {
            X::Text(t) => out.push(Run::Text(t.clone(), st.clone())),
            X::El(e) => {
                let mut s = st.clone();
                match e.name.as_str() {
                    "b" => s.strong = true,
                    "i" => s.emph = true,
                    "a" => s.link = e.attr("href").map(String::from),
                    _ => {}
                }
                runs(&e.kids, &s, out);
            }
        }
    }
}

fn parse(xml_text: &str) -> Result<Vec<Page>, String> {
    let root = xml::parse(xml_text)?;
    let mut fonts: HashMap<String, Font> = HashMap::new();
    let mut pages = vec![];
    for p in root.children("page") {
        for f in p.children("fontspec") {
            let fam = f.attr("family").unwrap_or("").to_ascii_lowercase();
            fonts.insert(
                f.attr("id").unwrap_or("").into(),
                Font {
                    size: num(f, "size"),
                    bold: fam.contains("bold") || fam.contains("black") || fam.contains("heavy"),
                    italic: fam.contains("italic") || fam.contains("oblique"),
                    color: f.attr("color").unwrap_or("#000000").to_ascii_lowercase(),
                },
            );
        }
        let mut items = vec![];
        let mut images = vec![];
        for e in p.els() {
            match e.name.as_str() {
                "text" => {
                    let f = fonts.get(e.attr("font").unwrap_or("")).cloned().unwrap_or(Font {
                        size: num(e, "height"),
                        bold: false,
                        italic: false,
                        color: "#000000".into(),
                    });
                    let mut st = Style { strong: f.bold, emph: f.italic, ..Default::default() };
                    if f.color != "#000000" {
                        st.span.insert("color".into(), f.color.clone());
                    }
                    let mut rs = vec![];
                    runs(&e.kids, &st, &mut rs);
                    let text: String = rs.iter().map(|r| if let Run::Text(t, _) = r { t.as_str() } else { "" }).collect();
                    if text.trim().is_empty() && !text.chars().any(is_pua) {
                        continue;
                    }
                    let bold = rs.iter().all(|r| matches!(r, Run::Text(t, s) if s.strong || t.trim().is_empty()));
                    items.push(Item { top: num(e, "top"), left: num(e, "left"), w: num(e, "width"), h: num(e, "height"), size: f.size, runs: rs, text, bold });
                }
                "image" => images.push((num(e, "top"), num(e, "left"), num(e, "width"), base(e.attr("src").unwrap_or("")).to_string())),
                _ => {}
            }
        }
        pages.push(Page { w: num(p, "width"), h: num(p, "height"), lines: lines(items), images });
    }
    Ok(pages)
}

fn is_pua(c: char) -> bool {
    ('\u{E000}'..='\u{F8FF}').contains(&c)
}

/// Group text boxes into visual lines; mark raised/lowered small boxes as sup/sub.
fn lines(mut items: Vec<Item>) -> Vec<Line> {
    items.sort_by(|a, b| a.top.total_cmp(&b.top).then(a.left.total_cmp(&b.left)));
    let mut out: Vec<Line> = vec![];
    'next: for it in items {
        for l in out.iter_mut().rev().take(4) {
            let overlap = (l.bottom.min(it.top + it.h)) - l.top.max(it.top);
            if overlap > 0.4 * it.h.min(l.bottom - l.top) {
                l.top = l.top.min(it.top);
                l.bottom = l.bottom.max(it.top + it.h);
                l.left = l.left.min(it.left);
                l.right = l.right.max(it.left + it.w);
                l.size = l.size.max(it.size);
                l.items.push(it);
                continue 'next;
            }
        }
        out.push(Line { top: it.top, bottom: it.top + it.h, left: it.left, right: it.left + it.w, size: it.size, items: vec![it] });
    }
    for l in out.iter_mut() {
        l.items.sort_by(|a, b| a.left.total_cmp(&b.left));
        let Some(main) = l.items.iter().max_by(|a, b| a.size.total_cmp(&b.size)).cloned() else {
            continue;
        };
        for it in l.items.iter_mut().filter(|i| i.size < main.size * 0.85) {
            let shift = (it.top + it.h / 2.0) - (main.top + main.h / 2.0);
            let (sup, sub) = (shift < -0.1 * main.h, shift > 0.1 * main.h);
            for r in it.runs.iter_mut() {
                if let Run::Text(_, s) = r {
                    s.sup = sup;
                    s.sub = sub;
                }
            }
        }
        // lines span the main font's box only, so a superscript does not widen the gap
        l.top = main.top;
        l.bottom = main.top + main.h;
    }
    out.sort_by(|a, b| a.top.total_cmp(&b.top));
    out
}

/// Header/footer lines repeated at the same spot on most pages (digits
/// normalized) and lone page numbers in the margins are dropped.
fn strip_running(pages: &mut [Page]) {
    let key = |l: &Line| {
        let t: String = l.text().chars().map(|c| if c.is_ascii_digit() { '#' } else { c }).collect();
        format!("{}|{}", (l.top / 4.0).round(), t.trim())
    };
    let edge = |l: &Line, h: f64| (l.bottom < h * 0.07 || l.top > h * 0.93) && l.text().chars().count() < 100;
    let mut seen: HashMap<String, usize> = HashMap::new();
    for p in pages.iter() {
        let mut keys: Vec<String> = p.lines.iter().filter(|l| edge(l, p.h)).map(key).collect();
        keys.dedup();
        for k in keys {
            *seen.entry(k).or_default() += 1;
        }
    }
    let n = pages.len();
    for p in pages.iter_mut() {
        let h = p.h;
        p.lines.retain(|l| {
            let t = l.text().to_lowercase();
            let t = t.trim().trim_start_matches("page").trim_matches(|c: char| !c.is_alphanumeric());
            let page_no = !t.is_empty() && t.split(|c: char| !c.is_alphanumeric()).all(|w| w.is_empty() || w == "of" || w.chars().all(|c| c.is_ascii_digit()));
            !(edge(l, h) && ((n >= 2 && seen.get(&key(l)).copied().unwrap_or(0) * 2 > n) || page_no))
        });
    }
}

/// The most common font size by amount of text = body size.
fn body_size(pages: &[Page]) -> f64 {
    let mut w: HashMap<i64, usize> = HashMap::new();
    for l in pages.iter().flat_map(|p| &p.lines) {
        for it in &l.items {
            *w.entry((it.size * 2.0).round() as i64).or_default() += it.text.len();
        }
    }
    w.into_iter().max_by_key(|&(s, n)| (n, -s)).map(|(s, _)| s as f64 / 2.0).unwrap_or(12.0)
}

fn marker(text: &str) -> Option<(String, u64, usize)> {
    let t = text.trim_start();
    let lead = text.len() - t.len();
    let c = t.chars().next()?;
    if BULLETS.contains(&c) || is_pua(c) {
        let rest = &t[c.len_utf8()..];
        if rest.is_empty() || rest.starts_with(char::is_whitespace) {
            return Some(("-".into(), 1, lead + c.len_utf8()));
        }
    }
    let digits: String = t.chars().take_while(|c| c.is_ascii_digit()).collect();
    if !digits.is_empty() && digits.len() <= 3 {
        let rest = &t[digits.len()..];
        if let Some(d) = rest.chars().next().filter(|c| *c == '.' || *c == ')')
            && rest[1..].starts_with(char::is_whitespace)
        {
            return Some((format!("1{d}"), digits.parse().unwrap_or(1), lead + digits.len() + 1));
        }
    }
    None
}

/// Paragraph break between two consecutive lines of one page?
fn breaks(a: &Line, b: &Line, gap0: f64, col: (f64, f64)) -> bool {
    let lh = a.bottom - a.top;
    let gap = b.top - a.bottom;
    let ends = a.text().trim_end().ends_with(['.', '!', '?', ':', ';']);
    gap > gap0 + 0.45 * lh
        || (a.size - b.size).abs() > 0.1 * a.size
        || a.bold() != b.bold()
        || marker(&b.text()).is_some()
        || (ends && a.right < col.1 - 0.12 * (col.1 - col.0))
        || b.left - a.left > 1.5 * a.size && marker(&a.text()).is_none()
}

/// A run of ≥2 lines that all split into the same column grid → table rows.
fn table_rows(lines: &[Line]) -> usize {
    let mut n = 0;
    let mut cols = 0;
    for (i, l) in lines.iter().enumerate() {
        let c = l.cells().len();
        let near = i == 0 || l.top - lines[i - 1].bottom < 2.5 * (l.bottom - l.top);
        if c < 2 || !near || (cols != 0 && c != cols) {
            break;
        }
        cols = c;
        n += 1;
    }
    if n >= 2 { n } else { 0 }
}

fn join_runs(items: &[&Item], out: &mut Vec<Run>) {
    let mut prev: Option<&Item> = None;
    for it in items {
        if let Some(p) = prev {
            let gap = it.left - (p.left + p.w);
            let space = p.text.ends_with(char::is_whitespace) || it.text.starts_with(char::is_whitespace);
            if gap > 0.15 * it.size && !space {
                out.push(Run::Text(" ".into(), Style::default()));
            }
        }
        out.extend(it.runs.iter().cloned());
        prev = Some(it);
    }
}

/// Lines of one paragraph → runs, joining wrapped lines (de-hyphenating "exam-\nple").
fn para_runs(lines: &[Line], skip: usize) -> Vec<Run> {
    let mut out: Vec<Run> = vec![];
    for (i, l) in lines.iter().enumerate() {
        if i > 0 {
            let soft_hyphen = matches!(out.last(), Some(Run::Text(t, _)) if t.ends_with('-') && t.chars().rev().nth(1).is_some_and(char::is_alphabetic))
                && l.text().starts_with(char::is_lowercase);
            match out.last_mut() {
                Some(Run::Text(t, _)) if soft_hyphen => {
                    t.pop();
                }
                Some(Run::Text(t, _)) if t.ends_with(char::is_whitespace) => {}
                _ => out.push(Run::Text(" ".into(), Style::default())),
            }
        }
        let items: Vec<&Item> = l.items.iter().collect();
        join_runs(&items, &mut out);
    }
    // drop the list marker characters from the front
    let mut skip = skip;
    while skip > 0 && !out.is_empty() {
        if let Run::Text(t, _) = &mut out[0] {
            let n = t.len().min(skip);
            *t = t[n..].to_string();
            skip -= n;
            if t.is_empty() {
                out.remove(0);
            }
        } else {
            break;
        }
    }
    if let Some(Run::Text(t, _)) = out.first_mut() {
        *t = t.trim_start().to_string();
    }
    if let Some(Run::Text(t, _)) = out.last_mut() {
        *t = t.trim_end().to_string();
    }
    out
}

fn inl(runs: &[Run]) -> Vec<Node> {
    let runs: Vec<Run> = runs
        .iter()
        .map(|r| match r {
            Run::Text(t, s) => Run::Text(imp::collapse_ws(t), s.clone()),
            o => o.clone(),
        })
        .collect();
    imp::inlines(&runs)
}

pub fn import(xml_text: &str, images: &HashMap<String, String>) -> Result<Imported, String> {
    let mut pages = parse(xml_text)?;
    strip_running(&mut pages);
    let body = body_size(&pages);
    let mut atts: Vec<Att> = vec![];

    // 1. blocks: line groups and images, in reading order per page
    let mut blocks: Vec<(Block, f64, (f64, f64))> = vec![]; // block, font size, text column
    for p in &pages {
        let body_lines: Vec<&Line> = p.lines.iter().filter(|l| (l.size - body).abs() < 0.6).collect();
        // text column; margins are assumed symmetric when lines are short
        let col = if body_lines.len() >= 3 {
            let left = body_lines.iter().map(|l| l.left).fold(f64::MAX, f64::min);
            (left, body_lines.iter().map(|l| l.right).fold(0.0, f64::max).max(p.w - left))
        } else {
            (p.w * 0.12, p.w * 0.88)
        };
        let mut gaps: Vec<f64> = p.lines.windows(2).map(|w| w[1].top - w[0].bottom).filter(|g| *g >= -2.0).collect();
        gaps.sort_by(f64::total_cmp);
        let gap0 = gaps.get(gaps.len() / 4).copied().unwrap_or(0.0).max(0.0);
        let mut imgs = p.images.clone();
        imgs.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut imgs = imgs.into_iter().peekable();
        let mut i = 0;
        while i < p.lines.len() {
            while let Some(im) = imgs.next_if(|im| im.0 <= p.lines[i].top) {
                blocks.push((Block::Image { w: im.2, src: im.3 }, body, col));
            }
            let t = table_rows(&p.lines[i..]);
            if t > 0 {
                blocks.push((Block::Lines(p.lines[i..i + t].to_vec()), -1.0, col));
                i += t;
                continue;
            }
            let mut j = i + 1;
            while j < p.lines.len() && !breaks(&p.lines[j - 1], &p.lines[j], gap0, col) && imgs.peek().is_none_or(|im| im.0 > p.lines[j].top) {
                j += 1;
            }
            // a paragraph continued from the previous page starts in lowercase
            let first = p.lines[i].text();
            let cont = i == 0 && first.trim_start().starts_with(char::is_lowercase) && marker(&first).is_none();
            match blocks.last_mut() {
                Some((Block::Lines(prev), s, _)) if cont && (*s - p.lines[i].size).abs() < 0.6 => prev.extend_from_slice(&p.lines[i..j]),
                _ => blocks.push((Block::Lines(p.lines[i..j].to_vec()), p.lines[i].size, col)),
            }
            i = j;
        }
        for im in imgs {
            blocks.push((Block::Image { w: im.2, src: im.3 }, body, col));
        }
    }

    // 2. heading levels: distinct sizes larger than body, biggest = h1
    let mut hs: Vec<i64> = blocks
        .iter()
        .filter(|(b, s, ..)| matches!(b, Block::Lines(l) if l.len() <= 3) && *s >= body * 1.15)
        .map(|(_, s, ..)| (s * 2.0).round() as i64)
        .collect();
    hs.sort_unstable_by(|a, b| b.cmp(a));
    hs.dedup();
    let level = |s: f64| hs.iter().position(|&h| h == (s * 2.0).round() as i64).map(|i| (i + 1).min(6) as u8);
    let bold_level = (hs.len() + 1).min(6) as u8;

    // 3. emit nodes; consecutive list paragraphs are nested by indent
    let mut out: Vec<Node> = vec![];
    let mut list: Vec<ListPara> = vec![];
    let mut list_left: Vec<f64> = vec![];
    let flush = |list: &mut Vec<ListPara>, lefts: &mut Vec<f64>, out: &mut Vec<Node>| {
        if !list.is_empty() {
            out.extend(imp::nest_lists(std::mem::take(list)));
            lefts.clear();
        }
    };
    for (b, size, col) in blocks {
        match b {
            Block::Image { w, src, .. } => {
                flush(&mut list, &mut list_left, &mut out);
                let Some(data) = images.get(&src) else {
                    continue;
                };
                use base64::Engine;
                let bytes = base64::engine::general_purpose::STANDARD.decode(data).unwrap_or_default();
                let name = format!("pdf-{}", src);
                atts.push(imp::att(&name, &bytes));
                let mut a = Attrs::new();
                a.insert("width".into(), format!("{:.0}mm", w * PX_MM));
                out.push(Node::Para { a: Attrs::new(), c: vec![Node::Image { a, src: format!("#att:{name}"), c: vec![] }] });
            }
            Block::Lines(ls) if size < 0.0 => {
                flush(&mut list, &mut list_left, &mut out);
                let rows: Vec<Vec<Cell>> = ls
                    .iter()
                    .enumerate()
                    .map(|(r, l)| {
                        l.cells()
                            .iter()
                            .map(|c| {
                                let mut rs = vec![];
                                join_runs(c, &mut rs);
                                let head = r == 0 && ls[0].bold() && !ls[1..].iter().all(Line::bold);
                                Cell { blocks: vec![Node::Para { a: Attrs::new(), c: inl(&rs) }], colspan: 1, rowspan: 1, head, ..Default::default() }
                            })
                            .collect()
                    })
                    .collect();
                out.push(imp::table(rows, vec![], None));
            }
            Block::Lines(ls) => {
                let text = ls[0].text();
                if let Some((m, start, skip)) = marker(&text) {
                    let left = ls[0].left;
                    let lvl = match list_left.iter().position(|l| (l - left).abs() < body) {
                        Some(i) => i,
                        None => {
                            list_left.push(left);
                            list_left.sort_by(f64::total_cmp);
                            list_left.iter().position(|l| *l == left).unwrap()
                        }
                    };
                    let c = inl(&para_runs(&ls, skip));
                    list.push(ListPara { level: lvl, marker: m, start, block: Node::Para { a: Attrs::new(), c } });
                    continue;
                }
                flush(&mut list, &mut list_left, &mut out);
                let c = inl(&para_runs(&ls, 0));
                if c.is_empty() {
                    continue;
                }
                let short = text.chars().count() < 120;
                if let Some(l) = level(size).filter(|_| short && ls.len() <= 3) {
                    out.push(Node::Heading { a: Attrs::new(), level: l, c: imp::clean_heading(c) });
                    continue;
                }
                if ls.len() == 1 && ls[0].bold() && short && !text.trim_end().ends_with(['.', ',', ';']) && (size - body).abs() < 0.6 {
                    out.push(Node::Heading { a: Attrs::new(), level: bold_level, c: imp::clean_heading(c) });
                    continue;
                }
                let mut a = Attrs::new();
                let mid = (col.0 + col.1) / 2.0;
                let cw = col.1 - col.0;
                if ls.iter().all(|l| ((l.left + l.right) / 2.0 - mid).abs() < 0.04 * cw && l.left > col.0 + 0.05 * cw) {
                    a.insert("align".into(), "center".into());
                } else if ls.iter().all(|l| (l.right - col.1).abs() < 0.02 * cw && l.left > col.0 + 0.3 * cw) {
                    a.insert("align".into(), "right".into());
                }
                if (size - body).abs() >= 0.6 {
                    a.insert("size".into(), format!("{}pt", (size / 1.5 * 2.0).round() / 2.0));
                }
                out.push(Node::Para { a, c });
            }
        }
    }
    flush(&mut list, &mut list_left, &mut out);

    if let Some(p) = pages.first() {
        let (name, land) = imp::page_name(p.w * PX_MM, p.h * PX_MM);
        let mut kv = vec![("page", name)];
        if land {
            kv.push(("orientation", "landscape".into()));
        }
        kv.push(("size", format!("{}pt", (body / 1.5 * 2.0).round() / 2.0)));
        if let Some(m) = imp::meta_block(&kv) {
            out.insert(0, m);
        }
    }
    Ok(Imported { doc: Node::Doc { a: Attrs::new(), c: out }, atts })
}
