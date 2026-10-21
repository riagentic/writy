//! DOCX → XAST. Structure, styles, lists, tables (merged cells), images, links,
//! footnotes, comments, tracked changes, headers/footers and page setup.
use crate::ast::{Attrs, Node};
use crate::html::Att;
use crate::imp::{self, Cell, Imported, ListPara, Run, Style};
use crate::xml::{self, El};
use std::collections::HashMap;
use std::io::Read;

struct Num {
    fmt: String,
    start: u64,
}

#[derive(Default, Clone)]
struct StyleInfo {
    name: String,
    based_on: Option<String>,
    outline: Option<u8>,
    num: Option<(String, usize)>,
    bold: bool,
    italic: bool,
    mono: bool,
}

struct Ctx {
    rels: HashMap<String, (String, String)>, // id → (type, target)
    styles: HashMap<String, StyleInfo>,
    nums: HashMap<String, Vec<Num>>, // numId → levels
    files: HashMap<String, Vec<u8>>,
    atts: Vec<Att>,
    att_of: HashMap<String, String>,
    comments: HashMap<String, Attrs>,
    notes: Vec<Node>,
    def_size: Option<String>,
    def_font: Option<String>,
}

pub(crate) fn zip_files(bytes: &[u8]) -> Result<HashMap<String, Vec<u8>>, String> {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| format!("not a DOCX/ODT package: {e}"))?;
    let mut out = HashMap::new();
    for i in 0..z.len() {
        let mut f = z.by_index(i).map_err(|e| e.to_string())?;
        let mut b = vec![];
        f.read_to_end(&mut b).map_err(|e| e.to_string())?;
        out.insert(f.name().to_string(), b);
    }
    Ok(out)
}

fn xml_of(files: &HashMap<String, Vec<u8>>, name: &str) -> Option<El> {
    files.get(name).and_then(|b| xml::parse(&String::from_utf8_lossy(b)).ok())
}

const EMU_PER_MM: f64 = 36000.0;
const TWIP_PER_MM: f64 = 56.692_913;

fn on(e: Option<&El>) -> bool {
    e.is_some_and(|e| !matches!(e.attr("w:val"), Some("0" | "false" | "off" | "none")))
}

impl Ctx {
    fn style_chain(&self, id: &str) -> Vec<&StyleInfo> {
        let mut v = vec![];
        let mut cur = self.styles.get(id);
        while let Some(s) = cur {
            v.push(s);
            if v.len() > 10 {
                break;
            }
            cur = s.based_on.as_ref().and_then(|b| self.styles.get(b));
        }
        v
    }

    fn heading_level(&self, style: &str, ppr: Option<&El>) -> Option<u8> {
        if let Some(l) = ppr.and_then(|p| p.val("w:outlineLvl", "w:val")).and_then(|v| v.parse::<u8>().ok())
            && l < 9
        {
            return Some((l + 1).min(6));
        }
        for s in self.style_chain(style) {
            let n = s.name.to_lowercase();
            if n == "title" {
                return Some(1);
            }
            if let Some(d) = n.strip_prefix("heading ").and_then(|d| d.trim().parse::<u8>().ok()) {
                return Some(d.clamp(1, 6));
            }
            if let Some(l) = s.outline {
                return Some((l + 1).min(6));
            }
        }
        None
    }

    fn style_named(&self, style: &str, pred: impl Fn(&str) -> bool) -> bool {
        self.style_chain(style).iter().any(|s| pred(&s.name.to_lowercase()))
    }

    fn list_of(&self, ppr: Option<&El>, style: &str) -> Option<(String, usize)> {
        if let Some(np) = ppr.and_then(|p| p.child("w:numPr")) {
            let id = np.val("w:numId", "w:val").unwrap_or("0").to_string();
            let lvl = np.val("w:ilvl", "w:val").and_then(|v| v.parse().ok()).unwrap_or(0);
            return (id != "0").then_some((id, lvl));
        }
        self.style_chain(style).iter().find_map(|s| s.num.clone()).filter(|(id, _)| id != "0")
    }

    fn marker(&self, num: &str, lvl: usize) -> (String, u64) {
        let l = self.nums.get(num).and_then(|v| v.get(lvl));
        let fmt = l.map(|l| l.fmt.as_str()).unwrap_or("bullet");
        let start = l.map(|l| l.start).unwrap_or(1);
        let m = match fmt {
            "decimal" | "decimalZero" => "1.",
            "lowerLetter" => "a.",
            "upperLetter" => "A.",
            "lowerRoman" => "i.",
            "upperRoman" => "I.",
            _ => "-",
        };
        (m.into(), start)
    }

    fn media(&mut self, rid: &str) -> Option<String> {
        let (_, target) = self.rels.get(rid)?.clone();
        if let Some(n) = self.att_of.get(&target) {
            return Some(n.clone());
        }
        let path = if let Some(t) = target.strip_prefix('/') { t.to_string() } else { format!("word/{target}") };
        let bytes = self.files.get(&path)?;
        let name = path.rsplit('/').next().unwrap_or("image").to_string();
        self.atts.push(imp::att(&name, bytes));
        self.att_of.insert(target, name.clone());
        Some(name)
    }
}

pub fn import(bytes: &[u8]) -> Result<Imported, String> {
    let files = zip_files(bytes)?;
    let doc = xml_of(&files, "word/document.xml").ok_or("word/document.xml missing — not a Word document")?;
    let mut rels = HashMap::new();
    if let Some(r) = xml_of(&files, "word/_rels/document.xml.rels") {
        for e in r.children("Relationship") {
            rels.insert(e.attr("Id").unwrap_or("").to_string(), (e.attr("Type").unwrap_or("").to_string(), e.attr("Target").unwrap_or("").to_string()));
        }
    }
    let mut ctx = Ctx {
        rels,
        styles: HashMap::new(),
        nums: HashMap::new(),
        files: HashMap::new(),
        atts: vec![],
        att_of: HashMap::new(),
        comments: HashMap::new(),
        notes: vec![],
        def_size: None,
        def_font: None,
    };
    if let Some(st) = xml_of(&files, "word/styles.xml") {
        if let Some(rpr) = st.child("w:docDefaults").and_then(|d| d.find("w:rPr")) {
            ctx.def_size = rpr.val("w:sz", "w:val").map(String::from);
            ctx.def_font = rpr.val("w:rFonts", "w:ascii").map(String::from);
        }
        for s in st.children("w:style") {
            let ppr = s.child("w:pPr");
            let rpr = s.child("w:rPr");
            let font = rpr.and_then(|r| r.val("w:rFonts", "w:ascii")).unwrap_or("").to_lowercase();
            ctx.styles.insert(
                s.attr("w:styleId").unwrap_or("").to_string(),
                StyleInfo {
                    name: s.val("w:name", "w:val").unwrap_or("").to_string(),
                    based_on: s.val("w:basedOn", "w:val").map(String::from),
                    outline: ppr.and_then(|p| p.val("w:outlineLvl", "w:val")).and_then(|v| v.parse().ok()),
                    num: ppr
                        .and_then(|p| p.child("w:numPr"))
                        .map(|np| (np.val("w:numId", "w:val").unwrap_or("0").to_string(), np.val("w:ilvl", "w:val").and_then(|v| v.parse().ok()).unwrap_or(0))),
                    bold: on(rpr.and_then(|r| r.child("w:b"))),
                    italic: on(rpr.and_then(|r| r.child("w:i"))),
                    mono: font.contains("courier") || font.contains("mono") || font.contains("consolas"),
                },
            );
        }
    }
    if let Some(nx) = xml_of(&files, "word/numbering.xml") {
        let mut abs: HashMap<String, Vec<Num>> = HashMap::new();
        for a in nx.children("w:abstractNum") {
            let levels = a
                .children("w:lvl")
                .map(|l| Num {
                    fmt: l.val("w:numFmt", "w:val").unwrap_or("bullet").to_string(),
                    start: l.val("w:start", "w:val").and_then(|v| v.parse().ok()).unwrap_or(1),
                })
                .collect();
            abs.insert(a.attr("w:abstractNumId").unwrap_or("").to_string(), levels);
        }
        for n in nx.children("w:num") {
            if let Some(a) = n.val("w:abstractNumId", "w:val").and_then(|id| abs.get(id)) {
                ctx.nums.insert(n.attr("w:numId").unwrap_or("").to_string(), a.iter().map(|l| Num { fmt: l.fmt.clone(), start: l.start }).collect());
            }
        }
    }
    if let Some(cx) = xml_of(&files, "word/comments.xml") {
        for c in cx.children("w:comment") {
            let mut a = Attrs::new();
            let text: Vec<String> = c.children("w:p").map(|p| p.text()).collect();
            a.insert("comment".into(), text.join(" ").trim().to_string());
            if let Some(au) = c.attr("w:author") {
                a.insert("by".into(), au.to_string());
            }
            if let Some(d) = c.attr("w:date") {
                a.insert("at".into(), d.chars().take(10).collect());
            }
            ctx.comments.insert(c.attr("w:id").unwrap_or("").to_string(), a);
        }
    }
    ctx.files = files;
    // footnotes / endnotes
    for (file, tag, prefix) in [("word/footnotes.xml", "w:footnote", ""), ("word/endnotes.xml", "w:endnote", "e")] {
        if let Some(fx) = xml_of(&ctx.files, file) {
            for f in fx.children(tag) {
                if f.attr("w:type").is_some_and(|t| t != "normal") {
                    continue;
                }
                let label = format!("{prefix}{}", f.attr("w:id").unwrap_or("0"));
                let c = blocks(&mut ctx, f);
                ctx.notes.push(Node::Footnote { label, c });
            }
        }
    }
    let body = doc.child("w:body").ok_or("document body missing")?;
    let mut out = blocks(&mut ctx, body);
    // page setup, headers, footers, properties
    let mut meta: Vec<(&str, String)> = vec![];
    if let Some(core) = xml_of(&ctx.files, "docProps/core.xml") {
        meta.push(("title", core.child("dc:title").map(|e| e.text()).unwrap_or_default()));
        meta.push(("author", core.child("dc:creator").map(|e| e.text()).unwrap_or_default()));
    }
    if let Some(sp) = body.child("w:sectPr") {
        if let Some(sz) = sp.child("w:pgSz") {
            let w = sz.attr("w:w").and_then(|v| v.parse::<f64>().ok()).unwrap_or(11906.0) / TWIP_PER_MM;
            let h = sz.attr("w:h").and_then(|v| v.parse::<f64>().ok()).unwrap_or(16838.0) / TWIP_PER_MM;
            let (name, land) = imp::page_name(w, h);
            meta.push(("page", name));
            if land {
                meta.push(("orientation", "landscape".into()));
            }
        }
        if let Some(m) = sp.child("w:pgMar") {
            let g = |k: &str| m.attr(k).and_then(|v| v.parse::<f64>().ok()).map(|t| format!("{:.0}mm", t / TWIP_PER_MM)).unwrap_or_else(|| "25mm".into());
            meta.push(("margin", format!("{} {} {} {}", g("w:top"), g("w:right"), g("w:bottom"), g("w:left"))));
        }
        for (tag, key) in [("w:headerReference", "header"), ("w:footerReference", "footer")] {
            if let Some(r) = sp.children(tag).find(|r| r.attr("w:type") == Some("default")).and_then(|r| r.attr("r:id"))
                && let Some((_, target)) = ctx.rels.get(r)
                && let Some(hx) = xml_of(&ctx.files, &format!("word/{target}"))
            {
                let t = hf_text(&hx);
                if !t.trim().is_empty() {
                    meta.push((key, t));
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

/// Header/footer text with PAGE / NUMPAGES fields as {page} / {pages}.
fn hf_text(e: &El) -> String {
    let mut parts: Vec<String> = vec![];
    for p in e.els().filter(|x| x.name == "w:p") {
        let mut s = String::new();
        let mut in_field = 0u8; // 1 = instr, 2 = result
        walk_hf(p, &mut s, &mut in_field);
        if !s.trim().is_empty() {
            parts.push(s.trim().to_string());
        }
    }
    parts.join(" | ")
}

fn walk_hf(e: &El, s: &mut String, st: &mut u8) {
    for k in e.els() {
        match k.name.as_str() {
            "w:fldSimple" => {
                let ins = k.attr("w:instr").unwrap_or("").trim().to_uppercase();
                s.push_str(if ins.starts_with("NUMPAGES") {
                    "{pages}"
                } else if ins.starts_with("PAGE") {
                    "{page}"
                } else {
                    ""
                });
            }
            "w:fldChar" => {
                *st = match k.attr("w:fldCharType") {
                    Some("begin") => 1,
                    Some("separate") => 2,
                    _ => 0,
                }
            }
            "w:instrText" => {
                let ins = k.text().trim().to_uppercase();
                s.push_str(if ins.starts_with("NUMPAGES") {
                    "{pages}"
                } else if ins.starts_with("PAGE") {
                    "{page}"
                } else {
                    ""
                });
            }
            "w:t" if *st != 2 => s.push_str(&k.text()),
            "w:tab" => s.push_str(" | "),
            _ => walk_hf(k, s, st),
        }
    }
}

// ── block level ──

enum Pending {
    None,
    List(Vec<ListPara>),
    Quote(Vec<Node>),
    Code(Vec<String>),
}

fn flush(p: &mut Pending, out: &mut Vec<Node>) {
    match std::mem::replace(p, Pending::None) {
        Pending::List(items) => out.extend(imp::nest_lists(items)),
        Pending::Quote(c) => out.push(Node::Blockquote { a: Attrs::new(), c }),
        Pending::Code(lines) => out.push(Node::Code { a: Attrs::new(), lang: String::new(), s: lines.join("\n") + "\n" }),
        Pending::None => {}
    }
}

fn blocks(ctx: &mut Ctx, parent: &El) -> Vec<Node> {
    let mut out = vec![];
    let mut pend = Pending::None;
    for e in parent.els() {
        match e.name.as_str() {
            "w:p" => {
                let ppr = e.child("w:pPr");
                let style = ppr.and_then(|p| p.val("w:pStyle", "w:val")).unwrap_or("").to_string();
                if on(ppr.and_then(|p| p.child("w:pageBreakBefore"))) {
                    flush(&mut pend, &mut out);
                    out.push(page_break());
                }
                let (runs, extra, breaks) = para_runs(ctx, e);
                let mut a = Attrs::new();
                match ppr.and_then(|p| p.val("w:jc", "w:val")) {
                    Some("center") => drop(a.insert("align".into(), "center".into())),
                    Some("right" | "end") => drop(a.insert("align".into(), "right".into())),
                    Some("both" | "distribute") => drop(a.insert("align".into(), "justify".into())),
                    _ => {}
                }
                if ppr.and_then(|p| p.child("w:numPr")).is_none() {
                    para_layout(ppr, &mut a); // lists get their indent from the list itself
                }
                let inl = trim_inl(imp::inlines(&runs));
                let block = ctx.heading_level(&style, ppr).map(|l| Node::Heading { a: a.clone(), level: l, c: imp::clean_heading(inl.clone()) });
                let is_code = block.is_none() && ctx.style_named(&style, |n| n.contains("code") || n.contains("preformatted") || n == "plain text");
                let is_quote = block.is_none() && ctx.style_named(&style, |n| n.contains("quot"));
                let list = if block.is_none() { ctx.list_of(ppr, &style) } else { None };
                if is_code {
                    let line = Node::Para { a: Attrs::new(), c: inl.clone() }.text();
                    if let Pending::Code(v) = &mut pend {
                        v.push(line);
                    } else {
                        flush(&mut pend, &mut out);
                        pend = Pending::Code(vec![line]);
                    }
                } else if let Some((num, lvl)) = list {
                    let (marker, start) = ctx.marker(&num, lvl);
                    let item = ListPara { level: lvl, marker, start, block: para_or_nbsp(a, inl) };
                    if let Pending::List(v) = &mut pend {
                        v.push(item);
                    } else {
                        flush(&mut pend, &mut out);
                        pend = Pending::List(vec![item]);
                    }
                } else if is_quote {
                    let p = para_or_nbsp(a, inl);
                    if let Pending::Quote(v) = &mut pend {
                        v.push(p);
                    } else {
                        flush(&mut pend, &mut out);
                        pend = Pending::Quote(vec![p]);
                    }
                } else {
                    flush(&mut pend, &mut out);
                    match block {
                        Some(h) => out.push(h),
                        None => {
                            // a paragraph holding only a page break is just the break
                            if !(breaks > 0 && inl.is_empty()) {
                                out.push(para_or_nbsp(a, inl));
                            }
                        }
                    }
                }
                for _ in 0..breaks {
                    flush(&mut pend, &mut out);
                    out.push(page_break());
                }
                if !extra.is_empty() {
                    flush(&mut pend, &mut out);
                    out.extend(extra);
                }
            }
            "w:tbl" => {
                flush(&mut pend, &mut out);
                out.push(table(ctx, e));
            }
            "w:sdt" => {
                flush(&mut pend, &mut out);
                if let Some(c) = e.child("w:sdtContent") {
                    out.extend(blocks(ctx, c));
                }
            }
            "w:customXml" | "w:ins" | "w:smartTag" => {
                flush(&mut pend, &mut out);
                out.extend(blocks(ctx, e));
            }
            _ => {}
        }
    }
    flush(&mut pend, &mut out);
    out
}

fn page_break() -> Node {
    let mut a = Attrs::new();
    a.insert("class".into(), "page-break".into());
    Node::Hr { a }
}

/// Paragraph indent, first-line indent and line spacing (`w:ind`, `w:spacing`) as Writy attributes (mm, line-height factor).
fn para_layout(ppr: Option<&El>, a: &mut Attrs) {
    let mm = |twips: f64| format!("{}mm", (twips / 1440.0 * 25.4 * 10.0).round() / 10.0);
    let num = |el: &El, k: &str| el.attr(k).and_then(|v| v.parse::<f64>().ok());
    if let Some(ind) = ppr.and_then(|p| p.child("w:ind")) {
        if let Some(l) = num(ind, "w:left").or_else(|| num(ind, "w:start")).filter(|l| *l > 0.0) {
            a.insert("indent".into(), mm(l));
        }
        if let Some(f) = num(ind, "w:firstLine").filter(|f| *f > 0.0) {
            a.insert("first".into(), mm(f));
        } else if let Some(h) = num(ind, "w:hanging").filter(|h| *h > 0.0) {
            a.insert("first".into(), format!("-{}", mm(h)));
        }
    }
    if let Some(sp) = ppr.and_then(|p| p.child("w:spacing")) {
        // `auto` lines are 240ths of single spacing; exact / atLeast are twips, which have no factor — leave those alone
        let rule = sp.attr("w:lineRule").unwrap_or("auto");
        if let Some(line) = num(sp, "w:line").filter(|_| rule == "auto") {
            let f = (line / 240.0 * 100.0).round() / 100.0;
            if (f - 1.0).abs() > 0.01 && (0.5..=4.0).contains(&f) {
                a.insert("spacing".into(), trim(f));
            }
        }
    }
}

fn trim(f: f64) -> String {
    let s = format!("{f:.2}");
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

fn para_or_nbsp(a: Attrs, c: Vec<Node>) -> Node {
    Node::Para { a, c: if c.is_empty() { vec![Node::str("\u{a0}")] } else { c } }
}

/// Trim leading/trailing plain whitespace of a paragraph.
fn trim_inl(mut c: Vec<Node>) -> Vec<Node> {
    if let Some(Node::Str { s }) = c.first_mut() {
        *s = s.trim_start_matches([' ', '\t']).to_string();
    }
    if let Some(Node::Str { s }) = c.last_mut() {
        *s = s.trim_end_matches([' ', '\t']).to_string();
    }
    c.retain(|n| !matches!(n, Node::Str { s } if s.is_empty()));
    c
}

// ── runs ──

struct RunCtx {
    style: Style,
    comments: Vec<String>,
    field: u8, // 0 normal, 1 instruction, 2 result
    field_link: Option<String>,
}

fn para_runs(ctx: &mut Ctx, p: &El) -> (Vec<Run>, Vec<Node>, usize) {
    let mut runs = vec![];
    let mut extra = vec![];
    let mut breaks = 0;
    let mut rc = RunCtx { style: Style::default(), comments: vec![], field: 0, field_link: None };
    walk_runs(ctx, p, &mut rc, &mut runs, &mut extra, &mut breaks);
    (runs, extra, breaks)
}

fn run_style(ctx: &Ctx, rpr: Option<&El>, base: &Style) -> Style {
    let mut s = base.clone();
    let Some(r) = rpr else { return s };
    if let Some(cs) = r.val("w:rStyle", "w:val") {
        for st in ctx.style_chain(cs) {
            s.strong |= st.bold;
            s.emph |= st.italic;
            s.code |= st.mono;
        }
        let n = cs.to_lowercase();
        if n.contains("code") || n.contains("verbatim") {
            s.code = true;
        }
    }
    if let Some(b) = r.child("w:b") {
        s.strong = on(Some(b));
    }
    if let Some(i) = r.child("w:i") {
        s.emph = on(Some(i));
    }
    if let Some(u) = r.child("w:u")
        && on(Some(u))
        && s.ins.is_none()
    {
        s.ins = Some(Attrs::new());
    }
    if on(r.child("w:strike")) || on(r.child("w:dstrike")) {
        s.del.get_or_insert_with(Attrs::new);
    }
    match r.val("w:vertAlign", "w:val") {
        Some("superscript") => s.sup = true,
        Some("subscript") => s.sub = true,
        _ => {}
    }
    let raised = r.val("w:position", "w:val").and_then(|v| v.parse::<i32>().ok()).unwrap_or(0);
    if raised > 0 {
        s.sup = true;
    } else if raised < 0 {
        s.sub = true;
    }
    if r.child("w:highlight").is_some_and(|h| h.attr("w:val") != Some("none")) {
        s.mark = true;
    }
    if let Some(c) = r.val("w:color", "w:val").filter(|c| *c != "auto" && *c != "000000") {
        s.span.insert("color".into(), format!("#{}", c.to_lowercase()));
    }
    if let Some(f) = r.val("w:shd", "w:fill").filter(|c| *c != "auto" && *c != "FFFFFF") {
        s.span.insert("bg".into(), format!("#{}", f.to_lowercase()));
    }
    if let Some(sz) = r.val("w:sz", "w:val").filter(|v| Some(*v) != ctx.def_size.as_deref() && !s.sup && !s.sub)
        && let Ok(n) = sz.parse::<f64>()
    {
        s.span.insert("size".into(), format!("{}pt", n / 2.0));
    }
    if let Some(f) = r.val("w:rFonts", "w:ascii").filter(|v| Some(*v) != ctx.def_font.as_deref()) {
        let fl = f.to_lowercase();
        if fl.contains("courier") || fl.contains("consolas") || fl.contains("mono") {
            s.code = true;
        } else {
            s.span.insert("font".into(), f.to_string());
        }
    }
    s
}

fn walk_runs(ctx: &mut Ctx, e: &El, rc: &mut RunCtx, runs: &mut Vec<Run>, extra: &mut Vec<Node>, breaks: &mut usize) {
    for k in e.els() {
        match k.name.as_str() {
            "w:r" => {
                let saved = rc.style.clone();
                let mut st = run_style(ctx, k.child("w:rPr"), &rc.style);
                if let Some(c) = rc.comments.last() {
                    st.comment = ctx.comments.get(c).cloned();
                }
                if let Some(l) = &rc.field_link {
                    st.link = Some(l.clone());
                }
                for x in k.els() {
                    match x.name.as_str() {
                        "w:t" | "w:delText" if rc.field != 1 => runs.push(Run::Text(x.text(), st.clone())),
                        "w:tab" => runs.push(Run::Text("\t".into(), st.clone())),
                        "w:noBreakHyphen" => runs.push(Run::Text("\u{2011}".into(), st.clone())),
                        "w:softHyphen" => runs.push(Run::Text("\u{ad}".into(), st.clone())),
                        "w:sym" => {
                            if let Some(ch) = x.attr("w:char").and_then(|c| u32::from_str_radix(c.trim_start_matches("F0"), 16).ok()).and_then(char::from_u32) {
                                runs.push(Run::Text(ch.to_string(), st.clone()));
                            }
                        }
                        "w:br" => match x.attr("w:type") {
                            Some("page") => *breaks += 1,
                            _ => runs.push(Run::Node(Node::Hard, st.clone())),
                        },
                        "w:cr" => runs.push(Run::Node(Node::Hard, st.clone())),
                        "w:footnoteReference" => runs.push(Run::Node(Node::FnRef { label: x.attr("w:id").unwrap_or("0").into() }, Style::default())),
                        "w:endnoteReference" => runs.push(Run::Node(Node::FnRef { label: format!("e{}", x.attr("w:id").unwrap_or("0")) }, Style::default())),
                        "w:fldChar" => {
                            rc.field = match x.attr("w:fldCharType") {
                                Some("begin") => 1,
                                Some("separate") => 2,
                                _ => {
                                    rc.field_link = None;
                                    0
                                }
                            }
                        }
                        "w:instrText" => {
                            let t = x.text();
                            let t = t.trim();
                            if let Some(rest) = t.strip_prefix("HYPERLINK") {
                                rc.field_link = rest.split('"').nth(1).map(String::from);
                            }
                        }
                        "w:drawing" => drawing(ctx, x, &st, runs, extra),
                        "w:pict" | "w:object" => {
                            if let Some(id) = x.find("v:imagedata").and_then(|i| i.attr("r:id"))
                                && let Some(name) = ctx.media(id)
                            {
                                runs.push(Run::Node(Node::Image { a: Attrs::new(), src: format!("#att:{name}"), c: vec![] }, st.clone()));
                            }
                        }
                        _ => {}
                    }
                }
                rc.style = saved;
            }
            "w:hyperlink" => {
                let saved = rc.style.clone();
                let href = k.attr("r:id").and_then(|id| ctx.rels.get(id)).map(|r| r.1.clone()).or_else(|| k.attr("w:anchor").map(|a| format!("#{a}")));
                rc.style.link = href;
                walk_runs(ctx, k, rc, runs, extra, breaks);
                rc.style = saved;
            }
            "w:ins" | "w:del" | "w:moveFrom" | "w:moveTo" => {
                let saved = rc.style.clone();
                let mut a = Attrs::new();
                a.insert("by".into(), k.attr("w:author").unwrap_or("author").to_string());
                if let Some(d) = k.attr("w:date") {
                    a.insert("at".into(), d.chars().take(10).collect());
                }
                if k.name == "w:ins" || k.name == "w:moveTo" {
                    rc.style.ins = Some(a);
                } else {
                    rc.style.del = Some(a);
                }
                walk_runs(ctx, k, rc, runs, extra, breaks);
                rc.style = saved;
            }
            "w:commentRangeStart" => rc.comments.push(k.attr("w:id").unwrap_or("").to_string()),
            "w:commentRangeEnd" => {
                let id = k.attr("w:id").unwrap_or("");
                rc.comments.retain(|c| c != id);
            }
            "w:fldSimple" => {
                let ins = k.attr("w:instr").unwrap_or("");
                let saved = rc.style.clone();
                if let Some(rest) = ins.trim().strip_prefix("HYPERLINK") {
                    rc.style.link = rest.split('"').nth(1).map(String::from);
                }
                walk_runs(ctx, k, rc, runs, extra, breaks);
                rc.style = saved;
            }
            "m:oMathPara" | "m:oMath" => {
                runs.push(Run::Node(Node::Math { display: k.name == "m:oMathPara", s: omml(k) }, rc.style.clone()));
            }
            "w:smartTag" | "w:customXml" | "w:sdt" | "w:sdtContent" | "w:bdo" | "w:dir" => walk_runs(ctx, k, rc, runs, extra, breaks),
            _ => {}
        }
    }
}

/// Very small OMML → LaTeX-ish text (fractions, scripts, roots); the rest as plain text.
fn omml(e: &El) -> String {
    let mut s = String::new();
    for k in e.els() {
        match k.name.as_str() {
            "m:r" => s.push_str(&k.text()),
            "m:f" => s.push_str(&format!("\\frac{{{}}}{{{}}}", k.child("m:num").map(omml).unwrap_or_default(), k.child("m:den").map(omml).unwrap_or_default())),
            "m:sSup" => s.push_str(&format!("{{{}}}^{{{}}}", k.child("m:e").map(omml).unwrap_or_default(), k.child("m:sup").map(omml).unwrap_or_default())),
            "m:sSub" => s.push_str(&format!("{{{}}}_{{{}}}", k.child("m:e").map(omml).unwrap_or_default(), k.child("m:sub").map(omml).unwrap_or_default())),
            "m:rad" => s.push_str(&format!("\\sqrt{{{}}}", k.child("m:e").map(omml).unwrap_or_default())),
            _ => s.push_str(&omml(k)),
        }
    }
    s
}

fn drawing(ctx: &mut Ctx, d: &El, st: &Style, runs: &mut Vec<Run>, extra: &mut Vec<Node>) {
    let holder = d.child("wp:inline").or_else(|| d.child("wp:anchor"));
    let Some(h) = holder else { return };
    // text boxes become a side box after the paragraph
    if let Some(tx) = h.find("w:txbxContent") {
        let c = blocks(ctx, tx);
        if !c.is_empty() {
            extra.push(Node::Div { a: Attrs::new(), class: "textbox".into(), c });
        }
        return;
    }
    let Some(id) = h.find("a:blip").and_then(|b| b.attr("r:embed")) else {
        return;
    };
    let Some(name) = ctx.media(id) else { return };
    let mut a = Attrs::new();
    if let Some(cx) = h.child("wp:extent").and_then(|e| e.attr("cx")).and_then(|v| v.parse::<f64>().ok()) {
        a.insert("width".into(), format!("{:.0}mm", cx / EMU_PER_MM));
    }
    if h.name == "wp:anchor" {
        let align = h.find("wp:positionH").and_then(|p| p.child("wp:align")).map(|a| a.text()).unwrap_or_default();
        if h.child("wp:wrapSquare").is_some() || h.child("wp:wrapTight").is_some() {
            a.insert("float".into(), if align == "left" { "left".into() } else { "right".into() });
        }
    }
    let alt = h.child("wp:docPr").and_then(|p| p.attr("descr").or(p.attr("title"))).unwrap_or("").to_string();
    let c = if alt.is_empty() { vec![] } else { vec![Node::str(alt)] };
    let mut st = st.clone();
    st.comment = None;
    runs.push(Run::Node(Node::Image { a, src: format!("#att:{name}"), c }, st));
}

// ── tables ──

fn table(ctx: &mut Ctx, t: &El) -> Node {
    let grid: Vec<f64> =
        t.child("w:tblGrid").map(|g| g.children("w:gridCol").filter_map(|c| c.attr("w:w").and_then(|v| v.parse().ok())).collect()).unwrap_or_default();
    let total: f64 = grid.iter().sum();
    let widths: Vec<String> = if grid.len() > 1 && total > 0.0 { grid.iter().map(|w| format!("{:.0}%", w / total * 100.0)).collect() } else { vec![] };
    // rows of (grid column, cell)
    let mut rows: Vec<Vec<(usize, Cell, bool)>> = vec![]; // bool = vMerge continue
    for tr in t.children("w:tr") {
        let head = tr.child("w:trPr").is_some_and(|p| on(p.child("w:tblHeader")))
            || (tr.children("w:tc").count() > 0
                && tr.children("w:tc").all(|tc| {
                    tc.children("w:p").all(|p| {
                        let st = p.child("w:pPr").and_then(|x| x.val("w:pStyle", "w:val")).unwrap_or("");
                        ctx.style_named(st, |n| n.contains("table heading"))
                    })
                }));
        let mut col = 0;
        let mut row = vec![];
        for tc in tr.children("w:tc") {
            let pr = tc.child("w:tcPr");
            let span = pr.and_then(|p| p.val("w:gridSpan", "w:val")).and_then(|v| v.parse().ok()).unwrap_or(1usize);
            let vm = pr.and_then(|p| p.child("w:vMerge"));
            let cont = vm.is_some_and(|v| v.attr("w:val").is_none_or(|x| x == "continue"));
            let mut blocks_ = blocks(ctx, tc);
            // single centred/right paragraph → cell alignment
            let mut align = String::new();
            if blocks_.len() == 1
                && let Some(Node::Para { a, .. }) = blocks_.first_mut()
                && let Some(al) = a.remove("align")
            {
                align = al;
            }
            if blocks_
                .iter()
                .all(|b| matches!(b, Node::Para { c, .. } if c.iter().all(|x| matches!(x, Node::Str { s } if s.trim_matches(['\u{a0}', ' ']).is_empty()))))
            {
                blocks_.clear();
            }
            let bg = pr
                .and_then(|p| p.val("w:shd", "w:fill"))
                .filter(|f| *f != "auto" && *f != "FFFFFF")
                .map(|f| format!("#{}", f.to_lowercase()))
                .unwrap_or_default();
            row.push((col, Cell { blocks: blocks_, colspan: span, rowspan: 1, head, align, bg }, cont));
            col += span;
        }
        rows.push(row);
    }
    // vertical merges: add to the rowspan of the origin cell above, drop the continuation
    for r in 1..rows.len() {
        for i in 0..rows[r].len() {
            if !rows[r][i].2 {
                continue;
            }
            let col = rows[r][i].0;
            for up in (0..r).rev() {
                if let Some(j) = rows[up].iter().position(|c| c.0 == col && !c.2) {
                    rows[up][j].1.rowspan += 1;
                    break;
                }
            }
        }
    }
    let rows: Vec<Vec<Cell>> = rows.into_iter().map(|r| r.into_iter().filter(|c| !c.2).map(|c| c.1).collect()).collect();
    imp::table(rows, widths, None)
}
