// cargo run --example imp -- <file.docx|file.odt|file.html|file.xml (pdftohtml -xml)>  → prints canonical Djot
fn main() {
    let p = std::env::args().nth(1).expect("path");
    let b = std::fs::read(&p).unwrap();
    let r = if p.ends_with(".docx") {
        xcore::docx::import(&b).unwrap()
    } else if p.ends_with(".odt") {
        xcore::odt::import(&b).unwrap()
    } else if p.ends_with(".xml") {
        xcore::pdf::import(&String::from_utf8_lossy(&b), &Default::default()).unwrap()
    } else {
        xcore::htmlin::import(&String::from_utf8_lossy(&b))
    };
    println!("{}", xcore::write::write(&r.doc));
    for a in &r.atts {
        println!("ATT {} {} {}B", a.name, a.mime, a.b64.len());
    }
}
