//! Minimal XML tree (quick-xml) for the DOCX/ODT importers.
use quick_xml::Reader;
use quick_xml::events::Event;

#[derive(Debug, Clone, Default)]
pub struct El {
    pub name: String, // qualified, e.g. "w:p"
    pub attrs: Vec<(String, String)>,
    pub kids: Vec<X>,
}

#[derive(Debug, Clone)]
pub enum X {
    El(El),
    Text(String),
}

impl El {
    pub fn attr(&self, k: &str) -> Option<&str> {
        self.attrs.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str())
    }
    pub fn els(&self) -> impl Iterator<Item = &El> {
        self.kids.iter().filter_map(|k| if let X::El(e) = k { Some(e) } else { None })
    }
    pub fn child(&self, name: &str) -> Option<&El> {
        self.els().find(|e| e.name == name)
    }
    pub fn children<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a El> + 'a {
        self.els().filter(move |e| e.name == name)
    }
    /// Depth-first search for the first descendant with this name.
    pub fn find(&self, name: &str) -> Option<&El> {
        for e in self.els() {
            if e.name == name {
                return Some(e);
            }
            if let Some(f) = e.find(name) {
                return Some(f);
            }
        }
        None
    }
    pub fn find_all<'a>(&'a self, name: &str, out: &mut Vec<&'a El>) {
        for e in self.els() {
            if e.name == name {
                out.push(e);
            }
            e.find_all(name, out);
        }
    }
    /// Concatenated text of all descendants.
    pub fn text(&self) -> String {
        let mut s = String::new();
        for k in &self.kids {
            match k {
                X::Text(t) => s.push_str(t),
                X::El(e) => s.push_str(&e.text()),
            }
        }
        s
    }
    /// `w:val`-style attribute of a named child.
    pub fn val(&self, child: &str, attr: &str) -> Option<&str> {
        self.child(child).and_then(|c| c.attr(attr))
    }
}

pub fn parse(s: &str) -> Result<El, String> {
    let mut r = Reader::from_str(s);
    r.config_mut().trim_text(false);
    let mut stack: Vec<El> = vec![El { name: "#root".into(), ..Default::default() }];
    let start = |e: &quick_xml::events::BytesStart| -> El {
        El {
            name: String::from_utf8_lossy(e.name().as_ref()).into_owned(),
            attrs: e
                .attributes()
                .flatten()
                .map(|a| (String::from_utf8_lossy(a.key.as_ref()).into_owned(), a.unescape_value().map(|v| v.into_owned()).unwrap_or_default()))
                .collect(),
            kids: vec![],
        }
    };
    loop {
        match r.read_event() {
            Ok(Event::Start(e)) => stack.push(start(&e)),
            Ok(Event::Empty(e)) => {
                let el = start(&e);
                stack.last_mut().unwrap().kids.push(X::El(el));
            }
            Ok(Event::End(_)) => {
                let el = stack.pop().ok_or("unbalanced XML")?;
                stack.last_mut().ok_or("unbalanced XML")?.kids.push(X::El(el));
            }
            Ok(Event::Text(t)) => {
                let s = t.unescape().map(|c| c.into_owned()).unwrap_or_else(|_| String::from_utf8_lossy(&t).into_owned());
                stack.last_mut().unwrap().kids.push(X::Text(s));
            }
            Ok(Event::CData(t)) => stack.last_mut().unwrap().kids.push(X::Text(String::from_utf8_lossy(&t).into_owned())),
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(format!("XML error at {}: {e}", r.buffer_position())),
        }
    }
    let mut root = stack.into_iter().next().ok_or("empty XML")?;
    Ok(match root.kids.iter().position(|k| matches!(k, X::El(_))) {
        Some(i) => match root.kids.swap_remove(i) {
            X::El(e) => e,
            _ => unreachable!(),
        },
        None => root,
    })
}
