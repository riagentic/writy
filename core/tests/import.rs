use xcore::{docx, file, htmlin, odt, parse::parse, write::write};

fn check(name: &str, r: xcore::imp::Imported) {
    let dj = write(&r.doc);
    let flat = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    for want in [
        "# Quarterly Report",
        "*bold*",
        "_italic_",
        "H~2~O",
        "x^2^",
        "[a link](https://example.com",
        "{align=center}",
        "- two\n\n  - nested",
        "1. first",
        "> A quote here.",
    ] {
        assert!(flat(&dj).contains(&flat(want)), "{name}: missing {want:?} in\n{dj}");
    }
    assert!(dj.contains("head=1"), "{name}: header row\n{dj}");
    assert_eq!(r.atts.len(), 1, "{name}: one image");
    let html = file::build(parse(&dj), &r.atts);
    for want in ["colspan=\"2\"", "rowspan=\"2\"", "<th", "data-att=", "<blockquote>"] {
        assert!(html.contains(want), "{name}: html missing {want}");
    }
    // the Djot we produce is stable
    assert_eq!(write(&parse(&dj)), dj, "{name}: stable");
}

#[test]
fn docx() {
    check("docx", docx::import(include_bytes!("fixtures/t.docx")).unwrap());
}

#[test]
fn odt() {
    check("odt", odt::import(include_bytes!("fixtures/t.odt")).unwrap());
}

#[test]
fn html() {
    check("html", htmlin::import(include_str!("fixtures/t.html")));
}

#[test]
fn not_a_package() {
    assert!(docx::import(b"nope").is_err());
}

#[test]
fn pdf() {
    use xcore::pdf;
    let flat = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    let img = std::collections::HashMap::from([("d-1_1.png".to_string(), "iVBORw0KGgo=".to_string())]);
    let r = pdf::import(include_str!("fixtures/t2.pdf.xml"), &img).unwrap();
    let dj = write(&r.doc);
    for want in [
        "page: A4",
        "# Quarterly Report",
        "*bold*",
        "_italic_",
        "H~2~O",
        "x^2^",
        "{align=center}\nCentered paragraph",
        "## List",
        "- one",
        "- nested",
        "1. first",
        "2. second",
    ] {
        assert!(flat(&dj).contains(&flat(want)), "pdf: missing {want:?} in\n{dj}");
    }
    assert_eq!(r.atts.len(), 1, "pdf: image");
    let r = pdf::import(include_str!("fixtures/t.pdf.xml"), &Default::default()).unwrap();
    let dj = write(&r.doc);
    for want in ["# Annual Plan", "## Budget", "| Name | Qty | Price |", "| Item 4 | 28 | 6.00 EUR |", "- alpha point\n- beta point", "## Section 5"] {
        assert!(flat(&dj).contains(&flat(want)), "pdf: missing {want:?} in\n{dj}");
    }
    // paragraphs continue across page breaks; no paragraph starts mid-sentence
    assert!(dj.split("\n\n").all(|p| !p.starts_with(char::is_lowercase)), "pdf: split paragraph\n{dj}");
    assert_eq!(write(&parse(&dj)), dj, "pdf: stable");
    // running header + "Page N of M" footers vanish; body text stays
    let page = |n: u32| {
        format!(
            r##"<page number="{n}" height="1262" width="892"><fontspec id="0" size="18" family="Serif" color="#000000"/>
<text top="30" left="85" width="200" height="20" font="0">ACME Confidential</text>
<text top="300" left="85" width="300" height="20" font="0">Body text {n}.</text>
<text top="1200" left="400" width="90" height="20" font="0">Page {n} of 3</text></page>"##
        )
    };
    let xml = format!("<pdf2xml>{}{}{}</pdf2xml>", page(1), page(2), page(3));
    let dj = write(&pdf::import(&xml, &Default::default()).unwrap().doc);
    assert!(dj.contains("Body text 2.") && !dj.contains("ACME") && !dj.contains("Page"), "pdf: running\n{dj}");
}

#[test]
fn docx_paragraph_indent_and_spacing() {
    let dj = write(&docx::import(include_bytes!("fixtures/indent.docx")).unwrap().doc);
    assert!(dj.contains("{indent=\"25.4mm\"}\nIndented one inch."), "left indent in mm: {dj}");
    assert!(dj.contains("{first=\"12.7mm\"}\nFirst line in"), "first-line indent: {dj}");
    assert!(dj.contains("{spacing=\"1.5\"}\nOne and a half"), "line spacing factor: {dj}");
    assert!(dj.contains("\nPlain.") && !dj.contains("}\nPlain."), "zero indents add nothing: {dj}");
}

#[test]
fn odt_paragraph_indent_and_spacing() {
    let dj = write(&odt::import(include_bytes!("fixtures/indent.odt")).unwrap().doc);
    assert!(dj.contains("{indent=\"25.4mm\"}\nIndented one inch."), "left indent: {dj}");
    assert!(dj.contains("{first=\"12.7mm\"}\nFirst line in"), "first-line indent: {dj}");
    assert!(dj.contains("{spacing=\"1.5\"}\nOne and a half"), "line spacing: {dj}");
}
