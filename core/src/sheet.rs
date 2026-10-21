//! Spreadsheets: a ```` ``` =sheet ```` raw block holding a pipe grid.
//! Cells are stored exactly as typed (formulas start with `=`); IronCalc evaluates.
use crate::ast::{Attrs, Node};
use ironcalc_base::{Model, cell::CellValue};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Sheet {
    pub id: String,
    /// rows × cols of raw cell input
    pub rows: Vec<Vec<String>>,
    /// number of header rows (shown bold, excluded from nothing — just styling)
    pub head: usize,
    /// "D:0.00;B2:0%" — column or cell → number format
    #[serde(default)]
    pub fmt: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Result {
    /// per sheet id: rows × cols of display text
    pub values: BTreeMap<String, Vec<Vec<String>>>,
    /// per sheet id: rows × cols, true where the value is numeric (right-aligned)
    pub numeric: BTreeMap<String, Vec<Vec<bool>>>,
}

/// Split one `| a | b |` line into cells; `\|` is a literal pipe.
fn split_row(line: &str) -> Vec<String> {
    let t = line.trim();
    let t = t.strip_prefix('|').unwrap_or(t);
    let mut cells = vec![];
    let mut cur = String::new();
    let mut it = t.chars().peekable();
    while let Some(c) = it.next() {
        match c {
            '\\' if it.peek() == Some(&'|') => {
                cur.push('|');
                it.next();
            }
            '|' => cells.push(std::mem::take(&mut cur).trim().to_string()),
            _ => cur.push(c),
        }
    }
    if !cur.trim().is_empty() {
        cells.push(cur.trim().to_string());
    }
    cells
}

fn is_sep(line: &str) -> bool {
    let t = line.trim();
    t.starts_with('|') && t.chars().all(|c| "|-: ".contains(c)) && t.contains('-')
}

/// Parse grid text into rows; a separator line after row N makes rows 0..=N headers.
pub fn parse_grid(s: &str) -> (Vec<Vec<String>>, usize) {
    let mut rows = vec![];
    let mut head = 0;
    for l in s.lines().filter(|l| !l.trim().is_empty()) {
        if is_sep(l) {
            head = rows.len();
        } else {
            rows.push(split_row(l));
        }
    }
    let w = rows.iter().map(Vec::len).max().unwrap_or(0);
    rows.iter_mut().for_each(|r| r.resize(w, String::new()));
    (rows, head)
}

/// Canonical grid text: aligned columns, separator under the header rows.
pub fn format_grid(rows: &[Vec<String>], head: usize) -> String {
    let w = rows.iter().map(Vec::len).max().unwrap_or(0);
    let cell = |r: &Vec<String>, i: usize| r.get(i).map(|c| c.replace('|', "\\|")).unwrap_or_default();
    let mut width = vec![3usize; w];
    for r in rows {
        for (i, wd) in width.iter_mut().enumerate() {
            *wd = (*wd).max(cell(r, i).chars().count());
        }
    }
    let mut out = String::new();
    for (ri, r) in rows.iter().enumerate() {
        out.push('|');
        for (i, wd) in width.iter().enumerate() {
            let c = cell(r, i);
            out.push_str(&format!(" {c}{} |", " ".repeat(wd - c.chars().count())));
        }
        out.push('\n');
        if head > 0 && ri + 1 == head {
            out.push('|');
            width.iter().for_each(|wd| out.push_str(&format!("{}|", "-".repeat(wd + 2))));
            out.push('\n');
        }
    }
    out
}

pub fn from_node(n: &Node, auto: usize) -> Option<Sheet> {
    match n {
        Node::Raw { a, format, s } if format == "sheet" => {
            let (rows, head) = parse_grid(s);
            Some(Sheet { id: a.get("id").cloned().unwrap_or_else(|| format!("Sheet{auto}")), rows, head, fmt: a.get("fmt").cloned().unwrap_or_default() })
        }
        _ => None,
    }
}

pub fn to_node(sh: &Sheet, mut a: Attrs) -> Node {
    a.insert("id".into(), sh.id.clone());
    if sh.fmt.is_empty() {
        a.remove("fmt");
    } else {
        a.insert("fmt".into(), sh.fmt.clone());
    }
    Node::Raw { a, format: "sheet".into(), s: format_grid(&sh.rows, sh.head) }
}

/// Every sheet in the document, in order.
pub fn collect(doc: &Node) -> Vec<Sheet> {
    fn walk(n: &Node, out: &mut Vec<Sheet>) {
        if let Some(s) = from_node(n, out.len() + 1) {
            out.push(s);
        }
        n.kids().iter().for_each(|k| walk(k, out));
    }
    let mut v = vec![];
    walk(doc, &mut v);
    v
}

pub fn col_name(mut c: usize) -> String {
    let mut s = vec![];
    c += 1;
    while c > 0 {
        c -= 1;
        s.push((b'A' + (c % 26) as u8) as char);
        c /= 26;
    }
    s.into_iter().rev().collect()
}

fn col_index(s: &str) -> Option<usize> {
    if s.is_empty() || !s.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    Some(s.to_ascii_uppercase().bytes().fold(0usize, |a, b| a * 26 + (b - b'A' + 1) as usize) - 1)
}

/// "D" → (None, Some(3)); "B2" → (Some(1), Some(1)); 0-based (row, col).
fn parse_target(t: &str) -> Option<(Option<usize>, usize)> {
    let letters: String = t.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
    let digits = &t[letters.len()..];
    let col = col_index(&letters)?;
    if digits.is_empty() {
        return Some((None, col));
    }
    let row: usize = digits.parse().ok()?;
    Some((Some(row.checked_sub(1)?), col))
}

static TIMEZONE: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

/// The reader's time zone (IANA, e.g. "Europe/Prague"), so TODAY() and NOW() are local. Unknown zones fall back to UTC.
pub fn set_timezone(tz: &str) {
    if let Ok(mut t) = TIMEZONE.lock() {
        *t = tz.to_string();
    }
}

/// Evaluate all sheets together so cross-sheet references (`sales!D4`) work.
pub fn evaluate(sheets: &[Sheet]) -> Result {
    let mut res = Result::default();
    if sheets.is_empty() {
        return res;
    }
    let tz = TIMEZONE.lock().map(|t| t.clone()).unwrap_or_default();
    let model = Model::new_empty("doc", "en", if tz.is_empty() { "UTC" } else { &tz }, "en").or_else(|_| Model::new_empty("doc", "en", "UTC", "en"));
    let Ok(mut m) = model else {
        return res;
    };
    for (i, sh) in sheets.iter().enumerate() {
        if i == 0 {
            let _ = m.rename_sheet("Sheet1", &sh.id);
        } else {
            let _ = m.add_sheet(&sh.id);
        }
    }
    for (si, sh) in sheets.iter().enumerate() {
        for (r, row) in sh.rows.iter().enumerate() {
            for (c, v) in row.iter().enumerate() {
                if !v.is_empty() {
                    let _ = m.set_user_input(si as u32, r as i32 + 1, c as i32 + 1, v.clone());
                }
            }
        }
        for rule in sh.fmt.split(';').filter(|x| !x.trim().is_empty()) {
            let Some((target, fmt)) = rule.split_once(':') else {
                continue;
            };
            let Some((row, col)) = parse_target(target.trim()) else {
                continue;
            };
            let rows: Vec<usize> = match row {
                Some(r) => vec![r],
                None => (sh.head..sh.rows.len()).collect(),
            };
            for r in rows {
                if let Ok(mut st) = m.get_style_for_cell(si as u32, r as i32 + 1, col as i32 + 1) {
                    st.num_fmt = fmt.trim().to_string();
                    let _ = m.set_cell_style(si as u32, r as i32 + 1, col as i32 + 1, &st);
                }
            }
        }
    }
    m.evaluate();
    for (si, sh) in sheets.iter().enumerate() {
        let mut vals = vec![];
        let mut nums = vec![];
        for (r, row) in sh.rows.iter().enumerate() {
            let (rr, cc) = (r as i32 + 1, row.len());
            vals.push((0..cc).map(|c| m.get_formatted_cell_value(si as u32, rr, c as i32 + 1).unwrap_or_default()).collect());
            nums.push((0..cc).map(|c| matches!(m.get_cell_value_by_index(si as u32, rr, c as i32 + 1), Ok(CellValue::Number(_)))).collect());
        }
        res.values.insert(sh.id.clone(), vals);
        res.numeric.insert(sh.id.clone(), nums);
    }
    res
}

/// Look up "sales!D4" (or "D4" in the first sheet).
pub fn lookup(res: &Result, sheets: &[Sheet], r: &str) -> Option<String> {
    let (sid, cell) = match r.split_once('!') {
        Some((s, c)) => (s.trim_matches('\'').to_string(), c),
        None => (sheets.first()?.id.clone(), r),
    };
    let (row, col) = parse_target(cell.trim().trim_start_matches('$').replace('$', "").as_str())?;
    res.values.get(&sid)?.get(row?)?.get(col).cloned()
}

/// Refresh the cached text of every `[x]{calc="ref"}` span.
pub fn refresh(doc: &mut Node, res: &Result, sheets: &[Sheet]) {
    if let Node::Span { a, c } = doc
        && let Some(r) = a.get("calc")
    {
        let v = lookup(res, sheets, r).unwrap_or_else(|| "#REF!".into());
        *c = vec![Node::str(v)];
        return;
    }
    if let Some(k) = doc.kids_mut() {
        k.iter_mut().for_each(|x| refresh(x, res, sheets));
    }
}

/// Inline CSS per cell from `cells="C:al=r bg=#fff3a3;C2:b"` (see src/editor/cellstyle.ts): column rules cover body rows,
/// cell rules win, later rules win per property. Unknown tokens and non-hex colours are dropped, so the CSS is always safe.
pub fn cell_css(spec: &str, r: usize, c: usize, head: usize) -> String {
    let mut props: Vec<(&str, String)> = vec![];
    for pass in [false, true] {
        for rule in spec.split(';') {
            let Some((t, body)) = rule.split_once(':') else {
                continue;
            };
            let Some((row, col)) = parse_target(t.trim()) else {
                continue;
            };
            let hit = col == c && if pass { row == Some(r) } else { row.is_none() && r >= head };
            if !hit {
                continue;
            }
            for tok in body.split_whitespace() {
                let (k, v) = tok.split_once('=').unwrap_or((tok, ""));
                let hex = v.len() >= 4 && v.len() <= 9 && v.starts_with('#') && v[1..].chars().all(|ch| ch.is_ascii_hexdigit());
                let p = match (k, v) {
                    ("b", "0") => Some(("font-weight", "400".into())),
                    ("b", _) => Some(("font-weight", "700".into())),
                    ("i", "0") => Some(("font-style", "normal".into())),
                    ("i", _) => Some(("font-style", "italic".into())),
                    ("al", "l") => Some(("text-align", "left".into())),
                    ("al", "c") => Some(("text-align", "center".into())),
                    ("al", "r") => Some(("text-align", "right".into())),
                    ("fg", _) if hex => Some(("color", v.to_string())),
                    ("bg", _) if hex => Some(("background", v.to_string())),
                    ("wr", "") => Some(("white-space", "pre-wrap".into())),
                    ("bd", "") => Some(("border", "1px solid #000".into())),
                    _ => None,
                };
                if let Some((k, v)) = p {
                    props.retain(|(x, _)| *x != k);
                    props.push((k, v));
                }
            }
        }
    }
    props.iter().map(|(k, v)| format!("{k}:{v}")).collect::<Vec<_>>().join(";")
}
