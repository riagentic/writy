use xcore::{file, html::Att, md, parse::parse, write::write};

const DOC: &str = r##"``` =meta
title: Q3 Report
page: A4
header: ACME | Q3 Report | {page} / {pages}
theme: report
```

# Q3 Report

Revenue total is [0]{calc="sales!D4"} € this week.

{#sales fmt="D:0.00"}
``` =sheet
| Item  | Qty | Price | Total       |
|-------|-----|-------|-------------|
| Milk  | 2   | 1.20  | =B2*C2      |
| Bread | 1   | 2.50  | =B3*C3      |
| Sum   |     |       | =SUM(D2:D3) |
```

{type=bar data="sales!A1:D3" title="Totals"}
::: chart
:::

{kind=ellipse x=10mm y=-2mm w=30mm h=12mm stroke="#c33"}
::: shape
:::

A paragraph the shape floats over.[^n]

![Logo](#att:logo.svg){width=30mm}

{head=1 widths="30%,70%"}
::: table
- - Product
  - Notes
- - []{colspan=2} Merged across both

    Second para in cell.
:::

[^n]: A footnote. </script> <!-- tricky
"##;

fn att() -> Vec<Att> {
    vec![
        Att { name: "logo.svg".into(), mime: "image/svg+xml".into(), b64: "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=".into() },
        Att { name: "original.docx".into(), mime: "application/octet-stream".into(), b64: "UEsDBA==".into() },
    ]
}

#[test]
fn build_and_read_back() {
    let doc = parse(DOC);
    let html = file::build(doc, &att());
    std::fs::write(std::env::temp_dir().join("jw-test.html"), &html).ok();
    assert!(html.contains("<td class=\"num\">2.40</td>"), "formula evaluated");
    assert!(html.contains("<td class=\"num\">4.90</td>"), "sum evaluated");
    assert!(html.contains("data-calc=\"sales!D4\">4.90<"), "calc span");
    assert!(html.contains("<svg viewBox"), "chart svg");
    assert!(html.contains("jw-shape jw-ellipse"), "shape");
    assert!(html.contains("colspan=\"2\""), "rich table");
    assert!(html.contains("@top-right{content:counter(page) \" / \" counter(pages)"), "page header");
    assert!(!html[html.find("jw-src").unwrap()..html.find("</main>").unwrap()].contains("</script> <!--"), "escaped");
    let o = file::read(&html);
    assert!(o.native && !o.stale);
    assert!(o.src.contains("[4.90]{calc=\"sales!D4\"}"), "cached value written to source");
    assert!(parse(&o.src).text().contains("</script> <!– tricky"), "unescaped back");
    assert_eq!(o.atts.len(), 2, "{:?}", o.atts.iter().map(|a| &a.name).collect::<Vec<_>>());
    // source → same file again (stable)
    let again = file::build(parse(&o.src), &o.atts);
    assert_eq!(file::read(&again).src, o.src);
    // stale detection
    let edited = html.replacen("# Q3 Report", "# Q4 Report", 1);
    assert!(file::read(&edited).stale);
}

#[test]
fn script_escape_roundtrip() {
    for s in ["a</script>b", "a<\\/script>", "<!-- x", "<\\\\!--", "</SCRIPT", "plain"] {
        let e = file::escape_script(s);
        assert!(!e.to_lowercase().contains("</script") && !e.contains("<!--"), "{e}");
        assert_eq!(file::unescape_script(&e), s);
    }
}

#[test]
fn markdown_import() {
    let d = md::import(
        "---\ntitle: Hi\n---\n# Title\n\nSome *em* and **strong** ~~gone~~.\n\n- [ ] a\n- [x] b\n\n| A | B |\n|:--|--:|\n| 1 | 2 |\n\n![cat](img/cat.png)\n",
    );
    let dj = write(&d);
    println!("{dj}");
    assert!(dj.contains("title: Hi"));
    assert!(dj.contains("Some _em_ and *strong* {-gone-}."));
    assert!(dj.contains("- [ ] a\n- [x] b"));
    assert!(dj.contains("|:--"));
    let back = md::export(&d);
    assert!(back.contains("**strong**"));
}

#[test]
fn layout_pages_or_web() {
    // default: pages — sheet geometry + header template for the in-file pager
    let html = file::build(parse("``` =meta\npage: letter\norientation: landscape\nmargin: 1in 15mm\nfooter: {title} | {page}\n```\n\n# Hi\n"), &[]);
    assert!(html.contains(r#"data-pages="{&quot;foot&quot;:&quot;{title} | {page}&quot;,&quot;h&quot;:215.9,&quot;head&quot;:null,&quot;m&quot;:[25.4,15.0,25.4,15.0],&quot;title&quot;:&quot;Hi&quot;,&quot;w&quot;:279.4}""#), "{}", &html[html.find("<main").unwrap()..][..300]);
    assert!(html.contains("jw-paged"), "pager script");
    assert!(html.contains("@bottom-left{content:\"Hi\""), "print title = first heading, like the pager");
    // web: a plain flowing page, no pager
    let web = file::build(parse("``` =meta\ndisplay: web\n```\n\nText\n"), &[]);
    assert!(web.contains("<main class=\"jw-page\">") && !web.contains("classList.add(\"jw-paged\")"));
}

#[test]
fn document_colours() {
    let html = file::build(parse("``` =meta\npage-color: #fffdf5\ntext-color: navy\n```\n\nHi\n"), &[]);
    assert!(html.contains(":root{--bg:#fffdf5;--fg:navy;}"), "document colours");
    assert!(!html.contains("prefers-color-scheme:dark){:root"), "never follows the reader's dark mode");
    let bad = file::build(parse("``` =meta\npage-color: red;}body{display:none\n```\n\nHi\n"), &[]);
    let style = &bad[bad.find("<style>").unwrap()..bad.find("</style>").unwrap()];
    assert!(!style.contains("body{display:none") && !style.contains("--bg:red"), "only a colour is accepted, never CSS");
    let desk = |c: &str| file::build(parse(&format!("``` =meta\ndesk-color: {c}\n```\n\nHi\n")), &[]);
    assert!(desk("#ffffff").contains("--jw-desk:#ffffff;--jw-desk-shadow:0 1px 3px"), "workspace colour, light shadow");
    assert!(desk("#202020").contains("--jw-desk:#202020;--jw-desk-shadow:0 0 0 1px"), "a dark workspace gets the ringed shadow");
    assert!(desk("#e6e6e6").contains("body.jw-paged{background:var(--jw-desk,#e6e6e6)"), "the pages view uses it");
}

#[test]
fn chart_negative_values_and_axis() {
    let src = "{#S}\n``` =sheet\n| M | Profit |\n|---|---|\n| Jan | 5 |\n| Feb | -3 |\n```\n\n{type=bar data=\"S!A1:B3\"}\n::: chart\n:::\n";
    let html = file::build(parse(src), &[]);
    assert!(!html.contains("height=\"-"), "no negative bar heights");
    assert!(html.contains(">-") || html.contains(">−"), "axis shows negative values");
    let pie = file::build(parse(&src.replace("type=bar", "type=pie")), &[]);
    assert!(pie.contains("Jan · 100%"), "pie shares in percent (negatives count as zero)");
}

#[test]
fn sheet_cell_styles() {
    let src = "{#S cells=\"B:al=c bg=#fff3a3;B2:b fg=#c0392b;A2:bg=red;A3:fg=#123456\\\"onload=x\"}\n``` =sheet\n| Item | Qty |\n|---|---|\n| Milk | 2 |\n| Eggs | 12 |\n```\n";
    let html = file::build(parse(src), &[]);
    assert!(html.contains("style=\"text-align:center;background:#fff3a3;font-weight:700;color:#c0392b\">2<"), "column + cell rules merge: {html}");
    assert!(html.contains("<th>Qty</th>"), "column rules skip the header row");
    assert!(!html.contains("background:red") && !html.contains(" onload"), "only hex colours, never markup");
    assert!(!html.contains("data-cells"), "the rule text is not copied onto the table");
    let wrapped = file::build(parse(&src.replace("A3:fg", "A3:wr bd fg")), &[]);
    assert!(wrapped.contains("white-space:pre-wrap;border:1px solid #000"), "wrap + borders: {wrapped}");
}

#[test]
fn chart_numbers_and_crowded_labels() {
    let months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    let rows: String = months.iter().enumerate().map(|(i, m)| format!("| {m} | ({},000) |\n", i + 1)).collect();
    let src = format!("{{#S}}\n``` =sheet\n| M | Loss |\n|---|---|\n{rows}```\n\n{{type=bar data=\"S!A1:B13\"}}\n::: chart\n:::\n");
    let html = file::build(parse(&src), &[]);
    assert!(html.contains("<title>January: -1000</title>"), "(1,000) is minus one thousand");
    let shown = html.matches("text-anchor=\"middle\" fill=\"currentColor\"><title>").count();
    assert!((2..12).contains(&shown), "crowded labels are thinned: {shown} of 12 shown");
    assert!(html.contains("<title>January</title>"), "the first label stays, with its full text on hover");
}

#[test]
fn chart_types_stacked_area_donut_hbar() {
    let src = "{#S}\n``` =sheet\n| M | A | B |\n|---|---|---|\n| Jan | 5 | 3 |\n| Feb | 2 | 4 |\n```\n\n{type=TYPE data=\"S!A1:C3\"}\n::: chart\n:::\n";
    let html = |t: &str| file::build(parse(&src.replace("TYPE", t)), &[]);
    let st = html("stacked");
    assert!(st.contains("<title>Jan · A: 5</title>") && st.contains("<title>Jan · B: 3</title>"), "stacked pieces named by series");
    assert!(st.contains(">8<") || st.contains(">10<"), "the axis reaches the stack total (5 + 3)");
    assert!(html("area").contains("fill-opacity=\".22\""), "area is filled");
    assert!(html("donut").contains("fill=\"var(--bg, #fff)\""), "donut hole");
    let hb = html("hbar");
    assert!(hb.contains("text-anchor=\"end\" fill=\"currentColor\"><title>Jan</title>"), "labels on the left");
}

#[test]
fn timezone_falls_back_to_utc() {
    xcore::sheet::set_timezone("Not/AZone");
    let r = xcore::sheet::evaluate(&[xcore::sheet::Sheet { id: "S".into(), rows: vec![vec!["=1+1".into()]], head: 0, fmt: String::new() }]);
    assert_eq!(r.values["S"][0][0], "2", "an unknown zone never breaks the sheet");
    xcore::sheet::set_timezone("Europe/Prague");
    let r = xcore::sheet::evaluate(&[xcore::sheet::Sheet { id: "S".into(), rows: vec![vec!["=YEAR(TODAY())>2000".into()]], head: 0, fmt: String::new() }]);
    assert_eq!(r.values["S"][0][0], "TRUE");
    xcore::sheet::set_timezone("");
}

#[test]
fn table_styles_and_vertical_alignment() {
    let html = file::build(parse("{.banded}\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n"), &[]);
    assert!(html.contains("<table class=\"banded") || html.contains("class=\"jw-table banded"), "the style class reaches the table: {html}");
    assert!(html.contains("table.banded tr:nth-child(even) td"), "and its CSS");
}

#[test]
fn line_and_arrow_ends() {
    let shape = |attrs: &str| file::build(parse(&format!("{{{attrs}}}\n::: shape\n:::\n\nText\n")), &[]);
    assert!(shape("kind=arrow from=br").contains("<line x1=\"100%\" y1=\"100%\" x2=\"0\" y2=\"0\""), "arrow pointing up-left");
    assert!(shape("kind=line from=bl").contains("<line x1=\"0\" y1=\"100%\" x2=\"100%\" y2=\"0\""), "rising line");
    assert!(shape("kind=arrow").contains("<line x1=\"0\" y1=\"50%\" x2=\"100%\" y2=\"50%\""), "older arrows run across the middle");
    assert!(shape("kind=line").contains("<line x1=\"0\" y1=\"0\" x2=\"100%\" y2=\"100%\""), "older lines: top-left to bottom-right");
}
