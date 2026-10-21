use xcore::{
    parse::parse,
    write::{normalize, write},
};

const CORPUS: &[&str] = &[
    "# Hello, *Djot*\n\nA _simple_ para with [a span]{.red} and `code`.",
    "{#intro .lead}\nPara with attrs.\n\nSecond line\nsoft broken.",
    "- one\n- two\n  - nested\n- three",
    "1. a\n2. b\n\n3. c",
    "a) x\nb) y",
    "(i) first\n(ii) second",
    "- [ ] todo\n- [x] done",
    "> quote\n>\n> - list in quote",
    "| Item | Qty |\n|:-----|----:|\n| Milk | 2 |\n| Bread | 1 |\n\n^ Fruit order",
    "::: warning\nCareful *now*.\n\n::: inner\nnested\n:::\n:::",
    "```rust\nfn main() {}\n```",
    "``` =html\n<b>raw</b>\n```",
    "Text with footnote[^1].\n\n[^1]: The note\n\n    with two paras.",
    ": term\n\n  definition text",
    "Smart \"quotes\" and 'single' -- dashes --- and ... dots.",
    "Escapes: \\* \\_ \\[x\\] 1\\. not list \\# not heading",
    "Math $`x^2` and $$`\\sum x`.",
    "{=mark=} {+ins+} {-del-} H~2~O x^2^",
    "Link [here](https://x.y/a(b)) and <https://auto.link> and <me@mail.com>.",
    "![alt *text*](#att:logo.png){width=40mm}",
    "Hard break\\\nnext line",
    "* * *",
    "Raw `<b>`{=html} inline and :smile: symbol.",
    "Price \\$5 and 50% and a|b and #tag and a < b and a > b",
    "Non\\ breaking space",
    "- a\n\n{% %}\n- b",
    "Para one\n\n\n\nPara two",
    "{.page-break}\n* * *",
    "| a | b |\n| c | d |",
    "intra_word_emphasis and snake_case_name",
    "Ends with backslash \\\\",
    "#hashtag at start\n> not quote? no it is",
    "{key=\"a b\" n=3}\n# Heading attrs",
    "Text {_braced_} emph",
];

#[test]
fn roundtrip_and_idempotent() {
    let mut fails = vec![];
    for src in CORPUS {
        let a = normalize(parse(src));
        let out = write(&a);
        let b = normalize(parse(&out));
        let out2 = write(&b);
        if a != b {
            fails.push(format!(
                "AST MISMATCH\n--src--\n{src}\n--out--\n{out}\n--a--\n{}\n--b--\n{}",
                serde_json::to_string(&a).unwrap(),
                serde_json::to_string(&b).unwrap()
            ));
        } else if out != out2 {
            fails.push(format!("NOT IDEMPOTENT\n--out--\n{out}\n--out2--\n{out2}"));
        }
    }
    assert!(fails.is_empty(), "{}", fails.join("\n\n========\n"));
}

#[test]
fn show_outputs() {
    for src in CORPUS {
        println!("──────\n{}", write(&parse(src)));
    }
}
