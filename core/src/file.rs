//! The single-file container: static HTML + embedded Djot source + attachments.
use crate::ast::Node;
use crate::html::{Att, Ctx, esc, meta};
use crate::{sheet, theme, write};

pub const GENERATOR: &str = "Writy 0.1";

/// FNV-1a 32 — change detection only (mirrored by the inline stale check).
pub fn fnv(s: &str) -> String {
    let mut h: u32 = 0x811c9dc5;
    for b in s.bytes() {
        h = (h ^ b as u32).wrapping_mul(16777619);
    }
    format!("{h:x}")
}

/// Make text safe inside <script>: `</script` and `<!--` get one extra backslash
/// after `<` (reversible: existing backslash runs grow by one).
pub fn escape_script(s: &str) -> String {
    shift(s, true)
}
pub fn unescape_script(s: &str) -> String {
    shift(s, false)
}

fn shift(s: &str, add: bool) -> String {
    let b = s.as_bytes();
    let mut o = String::with_capacity(s.len() + 8);
    let mut i = 0;
    let mut last = 0;
    while i < b.len() {
        if b[i] == b'<' {
            let mut j = i + 1;
            while j < b.len() && b[j] == b'\\' {
                j += 1;
            }
            let rest = &s[j..];
            let hit = rest.get(..7).is_some_and(|r| r.eq_ignore_ascii_case("/script")) || rest.starts_with("!--");
            let slashes = j - i - 1;
            if hit && (add || slashes > 0) {
                o.push_str(&s[last..=i]);
                let n = if add { slashes + 1 } else { slashes - 1 };
                o.push_str(&"\\".repeat(n));
                last = j;
            }
            i = j;
            continue;
        }
        i += 1;
    }
    o.push_str(&s[last..]);
    o
}

const STALE: &str = r#"<script>(()=>{let h=0x811c9dc5;for(const b of new TextEncoder().encode(document.getElementById("jw-src").textContent))h=Math.imul(h^b,16777619)>>>0;const m=document.querySelector('meta[name="jw-hash"]');if(m&&h.toString(16)!==m.content){const d=document.createElement("div");d.className="jw-stale";d.textContent="This document's source was edited outside Writy — open it in Writy to refresh this view.";document.body.prepend(d)}})()</script>"#;

/// Print layout in the browser: splits the static page into sheets with header/footer (view only; printing uses @page).
const PAGER: &str = include_str!("pager.js");

/// Prepare a document for saving: evaluate sheets and refresh cached `calc` values.
pub fn finalize(mut doc: Node) -> Node {
    let sheets = sheet::collect(&doc);
    if !sheets.is_empty() {
        let res = sheet::evaluate(&sheets);
        sheet::refresh(&mut doc, &res, &sheets);
    }
    doc
}

/// Rendered body HTML (no wrapper) — used for previews and printing.
pub fn render_body(doc: &Node, atts: &[Att]) -> String {
    Ctx::new(doc, atts).doc(doc)
}

/// The complete `.html` file.
pub fn build(doc: Node, atts: &[Att]) -> String {
    let doc = finalize(doc);
    let src = write::write(&doc);
    let mut m = meta(&doc);
    let custom_css: String = doc
        .kids()
        .iter()
        .filter_map(|n| match n {
            Node::Raw { format, s, .. } if format == "css" => Some(s.as_str()),
            _ => None,
        })
        .collect();
    let mut ctx = Ctx::new(&doc, atts);
    let body = ctx.doc(&doc);
    let title = m.get("title").cloned().unwrap_or_else(|| first_heading(&doc).unwrap_or_else(|| "Untitled".into()));
    m.insert("title".into(), title.clone()); // {title} in header/footer: the same title everywhere
    let paged = m.get("display").map(String::as_str) != Some("web");
    let (w, h, mg) = theme::geometry(&m);
    let pages = if paged {
        let j = serde_json::json!({ "w": w, "h": h, "m": mg, "head": m.get("header"), "foot": m.get("footer"), "title": title });
        format!(" data-pages=\"{}\"", esc(&j.to_string()))
    } else {
        String::new()
    };
    let pager = if paged { format!("<script>{}</script>\n", PAGER.trim()) } else { String::new() };
    let lang = m.get("lang").cloned().unwrap_or_else(|| "en".into());
    let stored = format!("\n{}\n", escape_script(&src));
    let extra: String = atts
        .iter()
        .filter(|a| !ctx.used().contains(&a.name))
        .map(|a| {
            format!("<script type=\"application/octet-stream\" id=\"att:{}\" data-type=\"{}\">\n{}\n</script>\n", esc(&a.name), esc(&a.mime), wrap76(&a.b64))
        })
        .collect();
    let mut head_meta = String::new();
    for k in ["author", "description", "date", "keywords"] {
        if let Some(v) = m.get(k) {
            head_meta.push_str(&format!("<meta name=\"{k}\" content=\"{}\">\n", esc(v)));
        }
    }
    format!(
        "<!doctype html>\n<html lang=\"{}\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"generator\" content=\"{GENERATOR}\">\n<meta name=\"jw-hash\" content=\"{}\">\n{head_meta}<title>{}</title>\n<style>{}</style>\n</head>\n<body>\n<script type=\"text/x-djot\" id=\"jw-src\">{stored}</script>\n<main class=\"jw-page\"{pages}>\n{body}</main>\n{extra}{STALE}\n{pager}</body>\n</html>\n",
        esc(&lang),
        fnv(&stored),
        esc(&title),
        theme::css(&m, &custom_css)
    )
}

fn wrap76(s: &str) -> String {
    s.as_bytes().chunks(76).map(|c| std::str::from_utf8(c).unwrap_or("")).collect::<Vec<_>>().join("\n")
}

fn first_heading(doc: &Node) -> Option<String> {
    doc.kids().iter().find_map(|n| if let Node::Heading { .. } = n { Some(n.text()) } else { None })
}

#[derive(serde::Serialize, Debug, Default)]
pub struct Opened {
    pub src: String,
    pub atts: Vec<Att>,
    /// true when the stored hash no longer matches (source edited by hand)
    pub stale: bool,
    /// true when this was a Writy file
    pub native: bool,
}

/// Attribute value `name="…"` inside one tag.
fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let key = format!("{name}=\"");
    let mut from = 0;
    while let Some(i) = tag[from..].find(&key) {
        let at = from + i;
        let ok = at == 0 || tag.as_bytes()[at - 1].is_ascii_whitespace();
        let s = at + key.len();
        let e = s + tag[s..].find('"')?;
        if ok {
            return Some(&tag[s..e]);
        }
        from = e;
    }
    None
}

fn unent(s: &str) -> String {
    s.replace("&quot;", "\"").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

/// Read a Writy `.html` file back into source + attachments.
pub fn read(html: &str) -> Opened {
    let mut o = Opened::default();
    let mut pos = 0;
    // every <script …> block
    while let Some(i) = html[pos..].find("<script") {
        let start = pos + i;
        let Some(gt) = html[start..].find('>') else {
            break;
        };
        let tag = &html[start..start + gt + 1];
        let body_start = start + gt + 1;
        let Some(end) = html[body_start..].find("</script") else {
            break;
        };
        let body = &html[body_start..body_start + end];
        pos = body_start + end + 8;
        let id = attr(tag, "id").unwrap_or("");
        if id == "jw-src" {
            o.native = true;
            let want = html.find("name=\"jw-hash\" content=\"").map(|i| {
                let s = i + 24;
                html[s..s + html[s..].find('"').unwrap_or(0)].to_string()
            });
            let norm = body.replace("\r\n", "\n");
            o.stale = want.is_some_and(|w| w != fnv(&norm));
            let t = norm.strip_prefix('\n').unwrap_or(&norm);
            let t = t.strip_suffix('\n').unwrap_or(t);
            o.src = unescape_script(t);
        } else if let Some(name) = id.strip_prefix("att:") {
            let mime = attr(tag, "data-type").or_else(|| attr(tag, "type")).unwrap_or("application/octet-stream");
            o.atts.push(Att { name: unent(name), mime: mime.trim_end_matches(";base64").to_string(), b64: body.split_whitespace().collect() });
        }
    }
    // media rendered inline: <img|video|audio … data-att="name" src="data:mime;base64,…">
    let mut pos = 0;
    while let Some(i) = html[pos..].find("data-att=\"") {
        let at = pos + i;
        let tag_start = html[..at].rfind('<').unwrap_or(0);
        let tag_end = at + html[at..].find('>').unwrap_or(0);
        let tag = &html[tag_start..=tag_end.min(html.len() - 1)];
        pos = tag_end.max(at + 1);
        let (Some(name), Some(src)) = (attr(tag, "data-att"), attr(tag, "src")) else {
            continue;
        };
        let name = unent(name);
        if o.atts.iter().any(|a| a.name == name) {
            continue;
        }
        if let Some(rest) = src.strip_prefix("data:")
            && let Some((mime, b64)) = rest.split_once(";base64,")
        {
            o.atts.push(Att { name, mime: mime.into(), b64: b64.into() });
        }
    }
    o
}
