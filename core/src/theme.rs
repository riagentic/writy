//! Built-in themes + page setup (CSS paged media) from the `=meta` block.
use std::collections::BTreeMap;

pub const THEMES: &[&str] = &["default", "modern", "classic", "report", "slides"];

const BASE: &str = r#"
:root{--fg:#1f2328;--bg:#fff;--accent:#1a5fb4;--mark:#fff3a3;--muted:color-mix(in srgb,var(--fg) 70%,var(--bg));--line:color-mix(in srgb,var(--fg) 22%,var(--bg));--code:color-mix(in srgb,var(--fg) 4%,var(--bg))}
*{box-sizing:border-box}
html{background:var(--bg);color:var(--fg)}
body{margin:0;background:var(--bg)}
.jw-page{color:var(--fg);color-scheme:light;max-width:var(--pw,210mm);margin:0 auto;padding:var(--pm,20mm);font:var(--fs,11pt)/1.5 var(--font,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif)}
.jw-page h1,.jw-page h2,.jw-page h3,.jw-page h4{font-family:var(--hfont,inherit);line-height:1.2;margin:1.2em 0 .5em}
.jw-page h1{font-size:2em}.jw-page h2{font-size:1.5em}.jw-page h3{font-size:1.2em}
.jw-page p{margin:0 0 .8em}
.jw-page a{color:var(--accent)}
.jw-page img,.jw-page video{max-width:100%;height:auto}
.jw-page table{border-collapse:collapse;margin:0 0 1em}
.jw-page th,.jw-page td{border:1px solid var(--line);padding:4px 8px;vertical-align:top}
.jw-page th{background:var(--code);text-align:left}
.jw-page table.banded tr:nth-child(even) td{background:color-mix(in srgb,var(--accent) 7%,var(--bg))}
.jw-page table.minimal th,.jw-page table.minimal td{border-left:0;border-right:0;border-top:0}
.jw-page table.plain th,.jw-page table.plain td{border:0}
.jw-page caption{caption-side:bottom;color:var(--muted);font-size:.9em;padding-top:4px}
.jw-page td.num{text-align:right;font-variant-numeric:tabular-nums}
.jw-page blockquote{margin:0 0 1em;padding:0 1em;border-left:3px solid var(--accent);color:var(--muted)}
.jw-page pre{background:var(--code);padding:.8em;overflow:auto;border-radius:6px}
.jw-page code{font-family:ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;font-size:.92em}
.jw-page mark{background:var(--mark);color:inherit}
.jw-page .hl-k{color:#cf222e}.jw-page .hl-t{color:#0550ae}.jw-page .hl-s{color:#0a3069}.jw-page .hl-c{color:#6e7781;font-style:italic}.jw-page .hl-n{color:#0550ae}.jw-page .hl-f{color:#8250df}.jw-page .hl-m{color:#953800}.jw-page .hl-a{color:#116329}.jw-page .hl-g{color:#116329;font-weight:600}.jw-page .hl-v{color:#953800}.jw-page .hl-h{color:#0550ae;font-weight:600}.jw-page .hl-i{color:#116329;background:#e6ffec}.jw-page .hl-d{color:#82071e;background:#ffebe9}
.jw-page ul.task-list{list-style:none;padding-left:1.2em}
.jw-page figure{margin:0 0 1em}.jw-page figcaption{color:var(--muted);font-size:.9em}
.jw-page .jw-chart svg{width:100%;max-width:480px;height:auto}
@media print{.jw-page h1,.jw-page h2,.jw-page h3,.jw-page h4,.jw-page h5,.jw-page h6{break-after:avoid}.jw-page tr,.jw-page img,.jw-page figure,.jw-page pre,.jw-page .jw-chart,.jw-page .jw-shape{break-inside:avoid}.jw-page p,.jw-page li{orphans:2;widows:2}}
.jw-anchor{position:relative}
.jw-shape{position:absolute;z-index:2;pointer-events:none}
.jw-shape svg{position:absolute;inset:0;overflow:visible}
.jw-shape-text{position:relative;height:100%;display:flex;flex-direction:column;justify-content:center;text-align:center;padding:4px}
.jw-shape-text p{margin:0}
.jw-comment{background:color-mix(in srgb,#f5c542 35%,transparent);border-bottom:2px solid #f5c542}
.jw-page ins{color:#1a7f37;text-decoration:underline}.jw-page del{color:#cf222e}
.jw-toc ol{list-style:none;padding-left:0}.jw-toc .l2{padding-left:1em}.jw-toc .l3{padding-left:2em}
.page-break{break-after:page;height:0}
.footnotes{font-size:.9em;color:var(--muted)}
.math{font-family:"Latin Modern Math","STIX Two Math",serif}.math.display{display:block;text-align:center;margin:.5em 0}
.jw-slide{aspect-ratio:16/9;border:1px solid var(--line);border-radius:8px;padding:5%;margin:0 0 2em;overflow:hidden;break-after:page;display:flex;flex-direction:column;justify-content:center}
.jw-slide h1,.jw-slide h2{margin-top:0}
.jw-page .notes{display:none}
.jw-stale{position:fixed;left:0;right:0;top:0;background:#fff3cd;color:#664d03;padding:6px 12px;font:13px system-ui;z-index:9}
@media print{.jw-page{padding:0;max-width:none}.jw-stale{display:none}.jw-pg-sheets{display:none}}
@media screen{body.jw-paged{background:var(--jw-desk,#e6e6e6);padding:24px 0 48px;--jw-shadow:var(--jw-desk-shadow,0 1px 3px rgba(0,0,0,.18),0 4px 16px rgba(0,0,0,.08))}
@media (prefers-color-scheme:dark){body.jw-paged{background:var(--jw-desk,#3a3a3a);--jw-shadow:var(--jw-desk-shadow,0 0 0 1px rgba(0,0,0,.3),0 2px 10px rgba(0,0,0,.45))}}
.jw-paged .jw-book{position:relative;margin:0 auto}
.jw-paged .jw-page{position:relative;z-index:1;max-width:none;margin:0;min-height:var(--jw-book-h,auto)}
.jw-paged [style*="--jw-mt"]{margin-top:var(--jw-mt)!important}
.jw-pg-sheet{position:absolute;left:0;right:0;background:var(--bg);box-shadow:var(--jw-shadow)}
.jw-pg-hf{position:absolute;left:0;right:0;display:flex;font:9pt/1.2 var(--font,system-ui,sans-serif);color:var(--muted);white-space:nowrap}
.jw-pg-hf.head{transform:translateY(-50%)}.jw-pg-hf.foot{transform:translateY(50%)}
.jw-pg-hf span{flex:1;overflow:hidden;text-overflow:ellipsis}.jw-pg-hf span:nth-child(2){text-align:center}.jw-pg-hf span:nth-child(3){text-align:right}}
"#;

fn theme_css(name: &str) -> &'static str {
    match name {
        // clean sans, bold tight titles, accent subheads, soft panels
        "modern" => concat!(
            ".jw-page{--font:Inter,system-ui,sans-serif;--hfont:Inter,system-ui,sans-serif}",
            ".jw-page h1{font-weight:800;letter-spacing:-.025em;font-size:2.3em}",
            ".jw-page h2{color:var(--accent);font-weight:700;letter-spacing:-.01em}",
            ".jw-page h3{text-transform:uppercase;letter-spacing:.06em;font-size:.95em;color:var(--muted)}",
            ".jw-page a{text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--accent) 40%,transparent)}",
            ".jw-page blockquote{border:0;border-radius:8px;background:var(--code);padding:.8em 1em}",
            ".jw-page th{background:color-mix(in srgb,var(--accent) 12%,var(--bg))}",
            ".jw-page table{border-radius:6px}"
        ),
        // book typography: serif, centred title, indented paragraphs, justified
        "classic" => concat!(
            ".jw-page{--font:Georgia,\"Times New Roman\",serif;--hfont:Georgia,serif}",
            ".jw-page h1{font-weight:normal;text-align:center;font-size:2.2em;margin-bottom:1em}",
            ".jw-page h2{font-weight:normal;font-variant:small-caps;letter-spacing:.04em}",
            ".jw-page h3{font-weight:normal;font-style:italic}",
            ".jw-page p{text-align:justify;hyphens:auto;margin:0}",
            ".jw-page>p+p{text-indent:1.5em}",
            ".jw-page>:is(h1,h2,h3,h4,ul,ol,table,blockquote,pre,figure,div)+p{margin-top:.6em}",
            ".jw-page td p,.jw-page li p{text-align:left}",
            ".jw-page blockquote{border-left:0;font-style:italic;padding:0 2em}",
            ".jw-page th{background:none;border-bottom:2px solid var(--fg)}"
        ),
        // business report: serif heads with rules, striped tables, strong header row
        "report" => concat!(
            ".jw-page{--font:\"Source Sans 3\",\"Segoe UI\",system-ui,sans-serif;--hfont:\"Source Serif 4\",Georgia,serif}",
            ".jw-page h1{border-bottom:3px solid var(--accent);padding-bottom:.25em;color:var(--accent)}",
            ".jw-page h2{border-bottom:1px solid var(--line);padding-bottom:.15em}",
            ".jw-page th{background:var(--accent);color:var(--bg);border-color:var(--accent)}",
            ".jw-page tbody tr:nth-child(even) td{background:var(--code)}"
        ),
        "slides" => concat!(
            ".jw-page{max-width:none;--font:Inter,system-ui,sans-serif;--hfont:Inter,system-ui,sans-serif}",
            ".jw-page h1{font-size:2.6em;font-weight:800;letter-spacing:-.02em}",
            ".jw-page h2{color:var(--accent)}",
            ".jw-slide{font-size:1.6em}"
        ),
        _ => "",
    }
}

const PAGES: &[(&str, &str, &str)] =
    &[("a4", "210mm", "297mm"), ("a5", "148mm", "210mm"), ("a3", "297mm", "420mm"), ("letter", "8.5in", "11in"), ("legal", "8.5in", "14in")];
const PAGES_MM: &[(&str, f64, f64)] = &[("a4", 210.0, 297.0), ("a5", 148.0, 210.0), ("a3", 297.0, 420.0), ("letter", 215.9, 279.4), ("legal", 215.9, 355.6)];

/// One CSS length → mm (bare numbers are mm; unreadable → 20mm, like the editor).
fn mm(v: &str) -> f64 {
    let n: String = v.chars().take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-').collect();
    let Ok(x) = n.parse::<f64>() else { return 20.0 };
    if v.ends_with("cm") {
        x * 10.0
    } else if v.ends_with("in") {
        x * 25.4
    } else if v.ends_with("pt") {
        x * 25.4 / 72.0
    } else {
        x
    }
}

/// Sheet width, height and margins [top, right, bottom, left], all in mm — the same rules as the editor's sheets.
pub fn geometry(meta: &BTreeMap<String, String>) -> (f64, f64, [f64; 4]) {
    let g = |k: &str| meta.get(k).map(String::as_str).unwrap_or("");
    let page = g("page").to_lowercase();
    let (mut w, mut h) = PAGES_MM.iter().find(|p| p.0 == page).map(|p| (p.1, p.2)).unwrap_or((210.0, 297.0));
    if g("orientation") == "landscape" {
        std::mem::swap(&mut w, &mut h);
    }
    let m: Vec<f64> = g("margin").split_whitespace().map(mm).collect();
    let m = match m.len() {
        0 => [20.0; 4],
        1 => [m[0]; 4],
        2 => [m[0], m[1], m[0], m[1]],
        3 => [m[0], m[1], m[2], m[1]],
        _ => [m[0], m[1], m[2], m[3]],
    };
    (w, h, m)
}

/// "Left | Center {page} | Right" → CSS margin-box rules.
fn margin_boxes(where_: &str, tpl: &str, title: &str) -> String {
    let parts: Vec<&str> = tpl.split('|').map(str::trim).collect();
    let pos = match parts.len() {
        1 => vec!["center"],
        2 => vec!["left", "right"],
        _ => vec!["left", "center", "right"],
    };
    let mut o = String::new();
    for (p, t) in pos.iter().zip(parts.iter()) {
        if t.is_empty() {
            continue;
        }
        let mut content = vec![];
        let mut rest = t.replace("{title}", title);
        while !rest.is_empty() {
            let next =
                [("{pages}", "counter(pages)"), ("{page}", "counter(page)")].iter().filter_map(|(k, v)| rest.find(k).map(|i| (i, *k, *v))).min_by_key(|x| x.0);
            match next {
                Some((i, k, v)) => {
                    if i > 0 {
                        content.push(format!("\"{}\"", rest[..i].replace('"', "\\\"")));
                    }
                    content.push(v.to_string());
                    rest = rest[i + k.len()..].to_string();
                }
                None => {
                    content.push(format!("\"{}\"", rest.replace('"', "\\\"")));
                    rest.clear();
                }
            }
        }
        o.push_str(&format!("@{where_}-{p}{{content:{};font-size:9pt;color:#666}}", content.join(" ")));
    }
    o
}

/// A hex colour darker than mid grey (names count as light).
fn is_dark(c: &str) -> bool {
    let h = c.trim_start_matches('#');
    let ch = |i: usize, n: usize| u8::from_str_radix(&h[i..i + n], 16).map(|v| if n == 1 { v * 17 } else { v } as f64).ok();
    let rgb = match h.len() {
        3 | 4 => (ch(0, 1), ch(1, 1), ch(2, 1)),
        6 | 8 => (ch(0, 2), ch(2, 2), ch(4, 2)),
        _ => return false,
    };
    matches!(rgb, (Some(r), Some(g), Some(b)) if 0.299 * r + 0.587 * g + 0.114 * b < 128.0)
}

/// A document colour (`#rgb`/`#rrggbb`/`#rrggbbaa` or a CSS colour name) — anything else is ignored.
fn color(v: &str) -> Option<&str> {
    let v = v.trim();
    let hex = v.len() > 1 && v.starts_with('#') && matches!(v.len(), 4 | 5 | 7 | 9) && v[1..].chars().all(|c| c.is_ascii_hexdigit());
    let name = !v.is_empty() && v.len() <= 20 && v.chars().all(|c| c.is_ascii_alphabetic());
    (hex || name).then_some(v)
}

pub fn css(meta: &BTreeMap<String, String>, custom: &str) -> String {
    let g = |k: &str| meta.get(k).map(String::as_str).unwrap_or("");
    let theme = if g("theme").is_empty() { "default" } else { g("theme") };
    let page = g("page").to_lowercase();
    let (mut w, mut h) = PAGES.iter().find(|p| p.0 == page).map(|p| (p.1, p.2)).unwrap_or(("210mm", "297mm"));
    if g("orientation") == "landscape" {
        std::mem::swap(&mut w, &mut h);
    }
    let margin = if g("margin").is_empty() { "20mm" } else { g("margin") };
    let mut vars = format!("--pw:{w};--pm:{margin};");
    if !g("font").is_empty() {
        vars.push_str(&format!("--font:{};", g("font")));
    }
    if !g("headings-font").is_empty() {
        vars.push_str(&format!("--hfont:{};", g("headings-font")));
    }
    if !g("size").is_empty() {
        vars.push_str(&format!("--fs:{};", g("size")));
    }
    let mut root = String::new();
    for (k, var) in [("page-color", "--bg"), ("text-color", "--fg")] {
        if let Some(c) = color(g(k)) {
            root.push_str(&format!("{var}:{c};"));
        }
    }
    // workspace around the pages (editor canvas + the saved file's pages view); its shadow follows its brightness
    if let Some(c) = color(g("desk-color")) {
        let shadow = if is_dark(c) { "0 0 0 1px rgba(0,0,0,.3),0 2px 10px rgba(0,0,0,.45)" } else { "0 1px 3px rgba(0,0,0,.18),0 4px 16px rgba(0,0,0,.08)" };
        root.push_str(&format!("--jw-desk:{c};--jw-desk-shadow:{shadow};"));
    }
    let root = if root.is_empty() { root } else { format!(":root{{{root}}}\n") };
    let title = g("title");
    let boxes = margin_boxes("top", g("header"), title) + &margin_boxes("bottom", g("footer"), title);
    format!("{BASE}{}\n{root}.jw-page{{{vars}}}\n@page{{size:{w} {h};margin:{margin};{boxes}}}\n{custom}", theme_css(theme))
}
