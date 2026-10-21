//! Writy core: pure functions over the document tree, exported to JS as JSON-in/JSON-out.
pub mod ast;
pub mod docx;
pub mod file;
pub mod hl;
pub mod html;
pub mod htmlin;
pub mod imp;
pub mod md;
pub mod odt;
pub mod parse;
pub mod pdf;
pub mod sheet;
pub mod theme;
pub mod write;
pub mod xml;

use ast::Node;
use html::Att;
use wasm_bindgen::prelude::*;

fn js(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}
fn doc(json: &str) -> Result<Node, JsValue> {
    serde_json::from_str(json).map_err(js)
}
fn atts(json: &str) -> Result<Vec<Att>, JsValue> {
    if json.is_empty() { Ok(vec![]) } else { serde_json::from_str(json).map_err(js) }
}
fn out<T: serde::Serialize>(v: &T) -> Result<String, JsValue> {
    serde_json::to_string(v).map_err(js)
}

/// Djot source → document tree (JSON).
#[wasm_bindgen]
pub fn djot_parse(src: &str) -> Result<String, JsValue> {
    out(&parse::parse(src))
}

/// Document tree → canonical Djot source.
#[wasm_bindgen]
pub fn djot_write(ast: &str) -> Result<String, JsValue> {
    Ok(write::write(&doc(ast)?))
}

/// Document tree → body HTML (preview / print). Sheets are evaluated.
#[wasm_bindgen]
pub fn render_html(ast: &str, attachments: &str) -> Result<String, JsValue> {
    let d = file::finalize(doc(ast)?);
    Ok(file::render_body(&d, &atts(attachments)?))
}

/// Theme + page CSS for a document (same CSS the saved file uses).
#[wasm_bindgen]
pub fn doc_css(ast: &str) -> Result<String, JsValue> {
    let d = doc(ast)?;
    let custom: String = d
        .kids()
        .iter()
        .filter_map(|n| match n {
            Node::Raw { format, s, .. } if format == "css" => Some(s.as_str()),
            _ => None,
        })
        .collect();
    Ok(theme::css(&html::meta(&d), &custom))
}

/// Document tree + attachments → the complete single-file `.html`.
#[wasm_bindgen]
pub fn file_build(ast: &str, attachments: &str) -> Result<String, JsValue> {
    Ok(file::build(doc(ast)?, &atts(attachments)?))
}

/// `.html` file text → { src, atts, stale, native }.
#[wasm_bindgen]
pub fn file_read(html_text: &str) -> Result<String, JsValue> {
    out(&file::read(html_text))
}

/// The reader's IANA time zone, for TODAY() / NOW().
#[wasm_bindgen]
pub fn set_timezone(tz: &str) {
    sheet::set_timezone(tz);
}

/// Evaluate sheets: [{id, rows, head, fmt}] → { values, numeric }.
#[wasm_bindgen]
pub fn sheets_eval(sheets: &str) -> Result<String, JsValue> {
    let s: Vec<sheet::Sheet> = serde_json::from_str(sheets).map_err(js)?;
    out(&sheet::evaluate(&s))
}

/// Grid text → { rows, head }.
#[wasm_bindgen]
pub fn grid_parse(s: &str) -> Result<String, JsValue> {
    let (rows, head) = sheet::parse_grid(s);
    out(&serde_json::json!({ "rows": rows, "head": head }))
}

/// rows (JSON string[][]) + header count → canonical grid text.
#[wasm_bindgen]
pub fn grid_format(rows: &str, head: usize) -> Result<String, JsValue> {
    let r: Vec<Vec<String>> = serde_json::from_str(rows).map_err(js)?;
    Ok(sheet::format_grid(&r, head))
}

#[wasm_bindgen]
pub fn md_import(src: &str) -> Result<String, JsValue> {
    out(&md::import(src))
}

#[wasm_bindgen]
pub fn md_export(ast: &str) -> Result<String, JsValue> {
    Ok(md::export(&doc(ast)?))
}

/// DOCX bytes → { doc, atts }.
#[wasm_bindgen]
pub fn docx_import(bytes: &[u8]) -> Result<String, JsValue> {
    out(&docx::import(bytes).map_err(js)?)
}

/// ODT bytes → { doc, atts }.
#[wasm_bindgen]
pub fn odt_import(bytes: &[u8]) -> Result<String, JsValue> {
    out(&odt::import(bytes).map_err(js)?)
}

/// `pdftohtml -xml` output + { file name: base64 } images → { doc, atts }.
#[wasm_bindgen]
pub fn pdf_import(xml_text: &str, images_json: &str) -> Result<String, JsValue> {
    let images: std::collections::HashMap<String, String> = serde_json::from_str(images_json).map_err(js)?;
    out(&pdf::import(xml_text, &images).map_err(js)?)
}

/// Any HTML page → { doc, atts } (data: images become attachments).
#[wasm_bindgen]
pub fn html_import(html_text: &str) -> Result<String, JsValue> {
    out(&htmlin::import(html_text))
}

/// LaTeX → MathML.
#[wasm_bindgen]
pub fn math_html(tex: &str, display: bool) -> String {
    html::math(tex, display)
}

/// Code-block highlighting for the editor: [[from, to, class]] in UTF-16 offsets (what JS strings and ProseMirror count).
#[wasm_bindgen]
pub fn highlight(lang: &str, code: &str) -> String {
    let mut u16_at = Vec::with_capacity(code.len() + 1);
    let mut n = 0u32;
    for (i, c) in code.char_indices() {
        while u16_at.len() < i {
            u16_at.push(n);
        }
        u16_at.push(n);
        n += c.len_utf16() as u32;
    }
    while u16_at.len() <= code.len() {
        u16_at.push(n);
    }
    let v: Vec<(u32, u32, &str)> = hl::spans(lang, code).into_iter().map(|(a, b, c)| (u16_at[a], u16_at[b], c)).collect();
    serde_json::to_string(&v).unwrap_or_default()
}

/// Languages the code-block picker offers: [[value, label]].
#[wasm_bindgen]
pub fn code_langs() -> String {
    serde_json::to_string(hl::LANGS).unwrap_or_default()
}
