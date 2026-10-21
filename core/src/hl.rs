//! Syntax highlighting for code blocks: one small lexer per language family, shared by the saved file (static spans,
//! no script) and the editor (decorations). Token classes: k keyword · t type/builtin/literal · s string · c comment
//! · n number · f function · m meta (decorator, directive, macro) · a attribute/key/property · g tag/section · v variable
//! · i inserted · d deleted · h heading.

type Span = (usize, usize, &'static str);

#[derive(Clone, Copy, PartialEq)]
enum Fam {
    CLike,
    Python,
    Ruby,
    Lua,
    Shell,
    Sql,
    Json,
    Yaml,
    Toml,
    Markup,
    Css,
    Markdown,
    Diff,
    Docker,
}

struct Lang {
    fam: Fam,
    kw: &'static [&'static str],
    ty: &'static [&'static str],
    line: &'static [&'static str],
    block: Option<(&'static str, &'static str)>,
    /// quote characters; `` ` `` strings may span lines
    quotes: &'static str,
    /// identifiers starting with a capital letter are types
    caps: bool,
}

const JS_KW: &[&str] = &[
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "finally",
    "for",
    "from",
    "function",
    "get",
    "if",
    "import",
    "in",
    "instanceof",
    "let",
    "new",
    "of",
    "return",
    "set",
    "static",
    "super",
    "switch",
    "this",
    "throw",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
    "as",
    "type",
    "interface",
    "enum",
    "implements",
    "declare",
    "namespace",
    "readonly",
    "private",
    "public",
    "protected",
    "abstract",
    "keyof",
    "satisfies",
];
const JS_TY: &[&str] = &[
    "true",
    "false",
    "null",
    "undefined",
    "NaN",
    "Infinity",
    "string",
    "number",
    "boolean",
    "any",
    "unknown",
    "never",
    "object",
    "bigint",
    "symbol",
    "console",
    "window",
    "document",
    "globalThis",
    "Promise",
    "Array",
    "Object",
    "Map",
    "Set",
    "JSON",
    "Math",
    "Date",
    "Error",
];
const RUST_KW: &[&str] = &[
    "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern", "fn", "for", "if", "impl", "in", "let", "loop", "match",
    "mod", "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super", "trait", "type", "unsafe", "use", "where", "while",
];
const RUST_TY: &[&str] = &[
    "true", "false", "i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize", "f32", "f64", "bool", "char", "str", "String",
    "Vec", "Option", "Result", "Some", "None", "Ok", "Err", "Box",
];
const C_KW: &[&str] = &[
    "auto",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "constexpr",
    "continue",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "explicit",
    "extern",
    "for",
    "friend",
    "goto",
    "if",
    "inline",
    "namespace",
    "new",
    "noexcept",
    "operator",
    "private",
    "protected",
    "public",
    "register",
    "return",
    "sizeof",
    "static",
    "struct",
    "switch",
    "template",
    "this",
    "throw",
    "try",
    "typedef",
    "typename",
    "union",
    "using",
    "virtual",
    "volatile",
    "while",
];
const C_TY: &[&str] = &[
    "true", "false", "nullptr", "NULL", "void", "int", "char", "short", "long", "float", "double", "signed", "unsigned", "bool", "size_t", "std", "string",
    "vector", "uint8_t", "uint16_t", "uint32_t", "uint64_t", "int8_t", "int16_t", "int32_t", "int64_t",
];
const JAVA_KW: &[&str] = &[
    "abstract",
    "assert",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "default",
    "do",
    "else",
    "enum",
    "extends",
    "final",
    "finally",
    "for",
    "if",
    "implements",
    "import",
    "instanceof",
    "interface",
    "native",
    "new",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "static",
    "super",
    "switch",
    "synchronized",
    "this",
    "throw",
    "throws",
    "try",
    "var",
    "void",
    "volatile",
    "while",
    "record",
    "fun",
    "val",
    "when",
    "object",
    "companion",
    "data",
    "override",
    "open",
    "internal",
    "is",
    "in",
    "out",
    "suspend",
    "lateinit",
    "by",
    "namespace",
    "using",
    "async",
    "await",
    "readonly",
    "sealed",
    "struct",
    "get",
    "set",
    "func",
    "let",
    "guard",
    "defer",
    "extension",
    "protocol",
    "where",
    "self",
    "init",
    "mut",
    "late",
    "required",
    "dynamic",
];
const JAVA_TY: &[&str] = &[
    "true", "false", "null", "nil", "int", "long", "short", "byte", "char", "float", "double", "boolean", "String", "Integer", "Object", "List", "Map", "Int",
    "Unit", "Any", "Bool", "string", "bool", "decimal",
];
const GO_KW: &[&str] = &[
    "break",
    "case",
    "chan",
    "const",
    "continue",
    "default",
    "defer",
    "else",
    "fallthrough",
    "for",
    "func",
    "go",
    "goto",
    "if",
    "import",
    "interface",
    "map",
    "package",
    "range",
    "return",
    "select",
    "struct",
    "switch",
    "type",
    "var",
];
const GO_TY: &[&str] = &[
    "true", "false", "nil", "iota", "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "float32", "float64", "string",
    "bool", "byte", "rune", "error", "any", "make", "len", "cap", "append", "new", "panic",
];
const PHP_KW: &[&str] = &[
    "abstract",
    "and",
    "as",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "default",
    "do",
    "echo",
    "else",
    "elseif",
    "extends",
    "final",
    "finally",
    "fn",
    "for",
    "foreach",
    "function",
    "if",
    "implements",
    "include",
    "interface",
    "match",
    "namespace",
    "new",
    "or",
    "private",
    "protected",
    "public",
    "require",
    "return",
    "static",
    "switch",
    "throw",
    "trait",
    "try",
    "use",
    "while",
    "yield",
];
const PHP_TY: &[&str] = &["true", "false", "null", "array", "int", "string", "bool", "float", "self", "parent", "TRUE", "FALSE", "NULL"];
const PY_KW: &[&str] = &[
    "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if",
    "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield", "match", "case",
];
const PY_TY: &[&str] = &[
    "True",
    "False",
    "None",
    "self",
    "cls",
    "int",
    "float",
    "str",
    "bool",
    "list",
    "dict",
    "set",
    "tuple",
    "bytes",
    "print",
    "len",
    "range",
    "open",
    "type",
    "object",
    "super",
    "isinstance",
    "enumerate",
    "zip",
    "map",
    "filter",
    "sorted",
];
const RB_KW: &[&str] = &[
    "alias",
    "and",
    "begin",
    "break",
    "case",
    "class",
    "def",
    "defined?",
    "do",
    "else",
    "elsif",
    "end",
    "ensure",
    "for",
    "if",
    "in",
    "module",
    "next",
    "not",
    "or",
    "redo",
    "rescue",
    "retry",
    "return",
    "self",
    "super",
    "then",
    "undef",
    "unless",
    "until",
    "when",
    "while",
    "yield",
    "require",
    "attr_accessor",
    "attr_reader",
    "puts",
];
const RB_TY: &[&str] = &["true", "false", "nil"];
const LUA_KW: &[&str] =
    &["and", "break", "do", "else", "elseif", "end", "for", "function", "goto", "if", "in", "local", "not", "or", "repeat", "return", "then", "until", "while"];
const LUA_TY: &[&str] = &["true", "false", "nil", "print", "pairs", "ipairs", "require", "table", "string", "math"];
const SH_KW: &[&str] = &[
    "if", "then", "else", "elif", "fi", "for", "in", "do", "done", "while", "until", "case", "esac", "function", "return", "export", "local", "readonly",
    "source", "alias", "set", "unset", "shift", "exit", "break", "continue",
];
const SH_TY: &[&str] = &[
    "echo", "printf", "cd", "ls", "cat", "grep", "sed", "awk", "rm", "cp", "mv", "mkdir", "sudo", "git", "npm", "deno", "cargo", "curl", "chmod", "test",
    "read", "true", "false",
];
const SQL_KW: &[&str] = &[
    "select",
    "from",
    "where",
    "and",
    "or",
    "not",
    "insert",
    "into",
    "values",
    "update",
    "set",
    "delete",
    "create",
    "table",
    "drop",
    "alter",
    "add",
    "join",
    "left",
    "right",
    "inner",
    "outer",
    "full",
    "on",
    "as",
    "group",
    "by",
    "order",
    "having",
    "limit",
    "offset",
    "distinct",
    "union",
    "all",
    "in",
    "is",
    "like",
    "between",
    "case",
    "when",
    "then",
    "else",
    "end",
    "primary",
    "key",
    "foreign",
    "references",
    "index",
    "view",
    "with",
    "exists",
    "asc",
    "desc",
    "default",
    "unique",
    "constraint",
    "returning",
    "begin",
    "commit",
    "rollback",
];
const SQL_TY: &[&str] = &[
    "null",
    "true",
    "false",
    "int",
    "integer",
    "bigint",
    "text",
    "varchar",
    "char",
    "boolean",
    "date",
    "timestamp",
    "numeric",
    "decimal",
    "real",
    "serial",
    "count",
    "sum",
    "avg",
    "min",
    "max",
    "coalesce",
    "now",
];
const LIT: &[&str] = &["true", "false", "null", "yes", "no", "on", "off", "~"];
const DOCKER_KW: &[&str] = &[
    "FROM",
    "RUN",
    "CMD",
    "LABEL",
    "EXPOSE",
    "ENV",
    "ADD",
    "COPY",
    "ENTRYPOINT",
    "VOLUME",
    "USER",
    "WORKDIR",
    "ARG",
    "ONBUILD",
    "STOPSIGNAL",
    "HEALTHCHECK",
    "SHELL",
    "AS",
];

const fn clike(kw: &'static [&'static str], ty: &'static [&'static str], quotes: &'static str) -> Lang {
    Lang { fam: Fam::CLike, kw, ty, line: &["//"], block: Some(("/*", "*/")), quotes, caps: true }
}
const fn simple(fam: Fam) -> Lang {
    Lang { fam, kw: &[], ty: &[], line: &[], block: None, quotes: "\"'", caps: false }
}

fn lang(name: &str) -> Option<Lang> {
    let n = name.trim().to_ascii_lowercase();
    Some(match n.as_str() {
        "js" | "javascript" | "jsx" | "mjs" | "cjs" | "ts" | "typescript" | "tsx" | "mts" | "node" => clike(JS_KW, JS_TY, "\"'`"),
        "rust" | "rs" => clike(RUST_KW, RUST_TY, "\""),
        "c" | "h" | "cpp" | "c++" | "cc" | "cxx" | "hpp" | "objc" | "arduino" => clike(C_KW, C_TY, "\"'"),
        "java" | "kotlin" | "kt" | "kts" | "cs" | "csharp" | "c#" | "swift" | "scala" | "dart" | "groovy" => clike(JAVA_KW, JAVA_TY, "\"'"),
        "go" | "golang" => clike(GO_KW, GO_TY, "\"'`"),
        "php" => Lang { line: &["//", "#"], ..clike(PHP_KW, PHP_TY, "\"'") },
        "python" | "py" | "python3" | "py3" | "gyp" => Lang { fam: Fam::Python, kw: PY_KW, ty: PY_TY, line: &["#"], block: None, quotes: "\"'", caps: true },
        "ruby" | "rb" | "gemfile" | "rake" => Lang { fam: Fam::Ruby, kw: RB_KW, ty: RB_TY, line: &["#"], block: None, quotes: "\"'", caps: true },
        "lua" => Lang { fam: Fam::Lua, kw: LUA_KW, ty: LUA_TY, line: &["--"], block: Some(("--[[", "]]")), quotes: "\"'", caps: false },
        "sh" | "bash" | "shell" | "zsh" | "fish" | "console" | "shellsession" | "ps1" | "powershell" => {
            Lang { fam: Fam::Shell, kw: SH_KW, ty: SH_TY, line: &["#"], block: None, quotes: "\"'", caps: false }
        }
        "sql" | "mysql" | "postgres" | "postgresql" | "sqlite" | "plsql" => {
            Lang { fam: Fam::Sql, kw: SQL_KW, ty: SQL_TY, line: &["--"], block: Some(("/*", "*/")), quotes: "'\"`", caps: false }
        }
        "json" | "jsonc" | "json5" | "geojson" => Lang { line: &["//"], block: Some(("/*", "*/")), ..simple(Fam::Json) },
        "yaml" | "yml" => Lang { line: &["#"], ..simple(Fam::Yaml) },
        "toml" | "ini" | "cfg" | "conf" | "properties" | "env" | "dotenv" => Lang { line: &["#", ";"], ..simple(Fam::Toml) },
        "html" | "htm" | "xml" | "svg" | "xhtml" | "vue" | "svelte" | "plist" | "rss" => simple(Fam::Markup),
        "css" | "scss" | "less" | "sass" => Lang { line: &["//"], block: Some(("/*", "*/")), ..simple(Fam::Css) },
        "md" | "markdown" | "djot" | "dj" => simple(Fam::Markdown),
        "diff" | "patch" => simple(Fam::Diff),
        "dockerfile" | "docker" | "containerfile" => Lang { fam: Fam::Docker, kw: DOCKER_KW, line: &["#"], ..simple(Fam::Docker) },
        _ => return None,
    })
}

/// Is this a language we colour? (The editor offers these names.)
pub fn known(name: &str) -> bool {
    lang(name).is_some()
}

/// Languages offered in the editor's picker: (value, label).
pub const LANGS: &[(&str, &str)] = &[
    ("bash", "Bash / Shell"),
    ("c", "C"),
    ("cpp", "C++"),
    ("csharp", "C#"),
    ("css", "CSS"),
    ("diff", "Diff"),
    ("dockerfile", "Dockerfile"),
    ("go", "Go"),
    ("html", "HTML"),
    ("java", "Java"),
    ("js", "JavaScript"),
    ("json", "JSON"),
    ("kotlin", "Kotlin"),
    ("lua", "Lua"),
    ("markdown", "Markdown"),
    ("php", "PHP"),
    ("python", "Python"),
    ("ruby", "Ruby"),
    ("rust", "Rust"),
    ("sql", "SQL"),
    ("swift", "Swift"),
    ("toml", "TOML / INI"),
    ("ts", "TypeScript"),
    ("xml", "XML"),
    ("yaml", "YAML"),
];

/// Token spans (byte offsets, sorted, non-overlapping) for `code` in language `name`; empty for an unknown language.
pub fn spans(name: &str, code: &str) -> Vec<Span> {
    let Some(l) = lang(name) else { return vec![] };
    match l.fam {
        Fam::Markup => markup(code),
        Fam::Css => css(code, &l),
        Fam::Markdown => markdown(code),
        Fam::Diff => diff(code),
        _ => generic(code, &l),
    }
}

/// Code → HTML with `<span class="hl-…">` around tokens (text escaped).
pub fn to_html(name: &str, code: &str, esc: impl Fn(&str) -> String) -> String {
    let mut o = String::with_capacity(code.len() + code.len() / 2);
    let mut at = 0;
    for (s, e, c) in spans(name, code) {
        o.push_str(&esc(&code[at..s]));
        o.push_str(&format!("<span class=\"hl-{c}\">{}</span>", esc(&code[s..e])));
        at = e;
    }
    o.push_str(&esc(&code[at..]));
    o
}

fn is_id_start(c: char) -> bool {
    c.is_alphabetic() || c == '_' || c == '$'
}
fn is_id(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}

/// End of the char at byte `i`.
fn next(s: &str, i: usize) -> usize {
    i + s[i..].chars().next().map_or(1, char::len_utf8)
}

/// Scan a quoted string starting at `i` (the quote); returns its end. Backslash escapes; only `` ` `` and triple
/// quotes run across lines.
fn string(s: &str, i: usize, q: &str, multiline: bool) -> usize {
    let mut j = i + q.len();
    while j < s.len() {
        if s.as_bytes()[j] == b'\\' {
            j = next(s, j);
            if j < s.len() {
                j = next(s, j);
            }
            continue;
        }
        if s[j..].starts_with(q) {
            return j + q.len();
        }
        if !multiline && s.as_bytes()[j] == b'\n' {
            return j;
        }
        j = next(s, j);
    }
    s.len()
}

fn number_end(s: &str, i: usize) -> usize {
    let b = s.as_bytes();
    let mut j = i;
    while j < b.len() {
        let c = b[j];
        let exp =
            (c == b'+' || c == b'-') && j > i && matches!(b[j - 1], b'e' | b'E') && !(b[i] == b'0' && b.get(i + 1).is_some_and(|x| *x == b'x' || *x == b'X'));
        if c.is_ascii_alphanumeric() || c == b'_' || (c == b'.' && b.get(j + 1).is_some_and(u8::is_ascii_digit)) || exp {
            j += 1;
        } else {
            break;
        }
    }
    j
}

fn generic(s: &str, l: &Lang) -> Vec<Span> {
    let b = s.as_bytes();
    let mut out: Vec<Span> = vec![];
    let mut i = 0;
    let mut line_start = true;
    let ci = l.fam == Fam::Sql;
    while i < s.len() {
        let c = s[i..].chars().next().unwrap();
        if c == '\n' {
            line_start = true;
            i += 1;
            continue;
        }
        if c == ' ' || c == '\t' || c == '\r' {
            i += 1;
            continue;
        }
        let first = std::mem::replace(&mut line_start, false);
        // comments
        if let Some((open, close)) = l.block
            && s[i..].starts_with(open)
        {
            let e = s[i + open.len()..].find(close).map_or(s.len(), |k| i + open.len() + k + close.len());
            out.push((i, e, "c"));
            i = e;
            continue;
        }
        if l.line.iter().any(|p| s[i..].starts_with(p)) && !(l.fam == Fam::Shell && i > 0 && !b[i - 1].is_ascii_whitespace() && b[i - 1] != b';') {
            if l.fam == Fam::Shell && s[i..].starts_with("#!") && i == 0 {
                let e = s[i..].find('\n').map_or(s.len(), |k| i + k);
                out.push((i, e, "m"));
                i = e;
                continue;
            }
            let e = s[i..].find('\n').map_or(s.len(), |k| i + k);
            out.push((i, e, "c"));
            i = e;
            continue;
        }
        // section headers [x] and keys (toml/ini), keys (yaml)
        if l.fam == Fam::Toml && first && c == '[' {
            let e = s[i..].find('\n').map_or(s.len(), |k| i + k);
            out.push((i, e, "g"));
            i = e;
            continue;
        }
        if matches!(l.fam, Fam::Toml | Fam::Yaml) && first {
            let lead = if l.fam == Fam::Yaml && s[i..].starts_with("- ") { 2 } else { 0 };
            let k0 = i + lead;
            let eol = s[k0..].find('\n').map_or(s.len(), |k| k0 + k);
            let sep = if l.fam == Fam::Toml { '=' } else { ':' };
            if let Some(p) = s[k0..eol].find(sep)
                && p > 0
                && !s[k0..k0 + p].contains(['"', '\'', '#'])
                && (l.fam == Fam::Toml || s[k0 + p + 1..].starts_with([' ', '\n']) || k0 + p + 1 == s.len())
            {
                out.push((k0, k0 + s[k0..k0 + p].trim_end().len(), "a"));
                i = k0 + p + 1;
                continue;
            }
        }
        if l.fam == Fam::Docker && first && c.is_ascii_uppercase() {
            let e = i + s[i..].find(|x: char| !x.is_ascii_alphabetic()).unwrap_or(s.len() - i);
            if l.kw.contains(&&s[i..e]) {
                out.push((i, e, "k"));
                i = e;
                continue;
            }
        }
        // directives / decorators
        if c == '#' && first && l.fam == Fam::CLike && l.kw.contains(&"typedef") {
            let e = s[i..].find('\n').map_or(s.len(), |k| i + k);
            out.push((i, e, "m"));
            i = e;
            continue;
        }
        if c == '@' && matches!(l.fam, Fam::CLike | Fam::Python) && s[i + 1..].starts_with(is_id_start) {
            let e = i + 1 + s[i + 1..].find(|x: char| !is_id(x) && x != '.').unwrap_or(s.len() - i - 1);
            out.push((i, e, "m"));
            i = e;
            continue;
        }
        // variables
        if c == '$' && matches!(l.fam, Fam::Shell | Fam::Docker) || (c == '$' && l.kw.contains(&"foreach")) {
            let mut e = i + 1;
            if s[e..].starts_with('{') {
                e = s[e..].find('}').map_or(s.len(), |k| e + k + 1);
            } else {
                while e < s.len() && (b[e].is_ascii_alphanumeric() || b[e] == b'_') {
                    e += 1;
                }
            }
            if e > i + 1 {
                out.push((i, e, "v"));
                i = e;
                continue;
            }
        }
        // strings
        let triple = l.fam == Fam::Python && (s[i..].starts_with("\"\"\"") || s[i..].starts_with("'''"));
        if triple {
            let e = string(s, i, &s[i..i + 3], true);
            out.push((i, e, "s"));
            i = e;
            continue;
        }
        if l.quotes.contains(c) && !(c == '\'' && l.kw.contains(&"fn") && l.ty.contains(&"usize") && lifetime(s, i)) {
            let e = string(s, i, &s[i..i + 1], c == '`');
            // JSON: a string followed by ':' is a key
            let key = l.fam == Fam::Json && s[e..].trim_start().starts_with(':');
            out.push((i, e, if key { "a" } else { "s" }));
            i = e;
            continue;
        }
        if c.is_ascii_digit() && (i == 0 || !is_id(s[..i].chars().next_back().unwrap_or(' '))) {
            let e = number_end(s, i);
            out.push((i, e, "n"));
            i = e;
            continue;
        }
        if is_id_start(c) {
            let mut e = i;
            while e < s.len() {
                let ch = s[e..].chars().next().unwrap();
                if is_id(ch) || (l.fam == Fam::Shell && ch == '-' && e > i) {
                    e += ch.len_utf8();
                } else {
                    break;
                }
            }
            let w = &s[i..e];
            let lw = w.to_ascii_lowercase();
            let w_ = if ci { lw.as_str() } else { w };
            let after = s[e..].trim_start_matches([' ', '\t']);
            let prev = s[..i].trim_end_matches([' ', '\t']);
            let defines = prev.rsplit(|c: char| !is_id(c)).next().is_some_and(|p| matches!(p, "fn" | "def" | "function" | "func" | "fun" | "sub"));
            let cls = if l.kw.contains(&w_) && !prev.ends_with('.') {
                Some("k")
            } else if l.ty.contains(&w_) || (matches!(l.fam, Fam::Json | Fam::Yaml | Fam::Toml) && LIT.contains(&lw.as_str())) {
                Some("t")
            } else if l.kw.contains(&"fn") && l.ty.contains(&"usize") && after.starts_with('!') {
                Some("m") // Rust macro
            } else if defines || after.starts_with('(') && !matches!(l.fam, Fam::Json | Fam::Yaml | Fam::Toml | Fam::Shell) {
                Some("f")
            } else if l.caps && w.chars().next().is_some_and(char::is_uppercase) && (w.len() == 1 || w.chars().any(char::is_lowercase)) {
                Some("t")
            } else if l.fam == Fam::Shell && first {
                Some("f") // the command
            } else {
                None
            };
            if let Some(cls) = cls {
                out.push((i, e, cls));
            }
            i = e;
            continue;
        }
        i = next(s, i);
    }
    out
}

/// Rust lifetime `'a` (not a char literal `'a'`).
fn lifetime(s: &str, i: usize) -> bool {
    let rest = &s[i + 1..];
    let n = rest.find(|c: char| !is_id(c)).unwrap_or(rest.len());
    n > 0 && !rest[n..].starts_with('\'')
}

fn markup(s: &str) -> Vec<Span> {
    let mut out = vec![];
    let mut i = 0;
    while let Some(k) = s[i..].find('<') {
        let at = i + k;
        let r = &s[at..];
        if r.starts_with("<!--") {
            let e = r.find("-->").map_or(s.len(), |x| at + x + 3);
            out.push((at, e, "c"));
            i = e;
            continue;
        }
        if r.starts_with("<!") || r.starts_with("<?") {
            let e = r.find('>').map_or(s.len(), |x| at + x + 1);
            out.push((at, e, "m"));
            i = e;
            continue;
        }
        let name_start = at + 1 + usize::from(r[1..].starts_with('/'));
        let n = s[name_start..].find(|c: char| !(c.is_alphanumeric() || matches!(c, '-' | ':' | '_' | '.'))).unwrap_or(s.len() - name_start);
        if n == 0 {
            i = at + 1;
            continue;
        }
        out.push((name_start, name_start + n, "g"));
        // attributes until '>'
        let mut j = name_start + n;
        while j < s.len() {
            let c = s[j..].chars().next().unwrap();
            if c == '>' {
                j += 1;
                break;
            }
            if c == '"' || c == '\'' {
                let e = s[j + 1..].find(c).map_or(s.len(), |x| j + 1 + x + 1);
                out.push((j, e, "s"));
                j = e;
                continue;
            }
            if c.is_alphabetic() || c == '@' || c == ':' {
                let e = j + s[j..].find(|x: char| !(x.is_alphanumeric() || matches!(x, '-' | ':' | '_' | '@' | '.'))).unwrap_or(s.len() - j);
                out.push((j, e, "a"));
                j = e;
                continue;
            }
            j = next(s, j);
        }
        // raw text inside <script>/<style>: skip to its closing tag
        let tag = s[name_start..name_start + n].to_ascii_lowercase();
        if !r[1..].starts_with('/') && (tag == "script" || tag == "style") {
            let close = format!("</{tag}");
            j = s[j..].to_ascii_lowercase().find(&close).map_or(s.len(), |x| j + x);
        }
        i = j;
    }
    out
}

fn css(s: &str, l: &Lang) -> Vec<Span> {
    let mut out = vec![];
    let mut i = 0;
    let mut depth = 0i32;
    let mut in_value = false;
    while i < s.len() {
        let c = s[i..].chars().next().unwrap();
        if let Some((o, cl)) = l.block
            && s[i..].starts_with(o)
        {
            let e = s[i + 2..].find(cl).map_or(s.len(), |k| i + 2 + k + 2);
            out.push((i, e, "c"));
            i = e;
            continue;
        }
        if s[i..].starts_with("//") && (i == 0 || s.as_bytes()[i - 1] != b':') {
            let e = s[i..].find('\n').map_or(s.len(), |k| i + k);
            out.push((i, e, "c"));
            i = e;
            continue;
        }
        match c {
            '{' | '}' => {
                depth += if c == '{' { 1 } else { -1 };
                in_value = false;
            }
            ';' => in_value = false,
            '"' | '\'' => {
                let e = string(s, i, &s[i..i + 1], false);
                out.push((i, e, "s"));
                i = e;
                continue;
            }
            '@' => {
                let e = i + 1 + s[i + 1..].find(|x: char| !(x.is_alphanumeric() || x == '-')).unwrap_or(s.len() - i - 1);
                out.push((i, e, "k"));
                i = e;
                continue;
            }
            '#' if in_value => {
                let e = i + 1 + s[i + 1..].find(|x: char| !x.is_ascii_hexdigit()).unwrap_or(s.len() - i - 1);
                out.push((i, e, "n"));
                i = e;
                continue;
            }
            '$' | '-' if s[i..].starts_with("--") || c == '$' => {
                let e = i + 1 + s[i + 1..].find(|x: char| !(x.is_alphanumeric() || x == '-' || x == '_')).unwrap_or(s.len() - i - 1);
                out.push((i, e, "v"));
                if s[e..].trim_start().starts_with(':') && depth > 0 {
                    in_value = true;
                }
                i = e;
                continue;
            }
            _ => {}
        }
        if c.is_ascii_digit() && in_value {
            let e = number_end(s, i);
            let e = e + s[e..].find(|x: char| !(x.is_alphabetic() || x == '%')).unwrap_or(s.len() - e);
            out.push((i, e, "n"));
            i = e;
            continue;
        }
        if c.is_alphabetic() || c == '-' {
            let e = i + s[i..].find(|x: char| !(x.is_alphanumeric() || x == '-' || x == '_')).unwrap_or(s.len() - i);
            let after = s[e..].trim_start();
            if depth > 0 && !in_value && after.starts_with(':') && !after.starts_with("::") {
                out.push((i, e, "a"));
                in_value = true;
            } else if in_value && after.starts_with('(') {
                out.push((i, e, "f"));
            } else if !in_value && depth == 0 {
                out.push((i, e, "g")); // selector
            }
            i = e;
            continue;
        }
        if c == '.' || c == ':' && !in_value {
            if c == ':' && depth > 0 {
                i += 1;
                continue;
            }
            let e = i + 1 + s[i + 1..].find(|x: char| !(x.is_alphanumeric() || x == '-' || x == '_' || x == ':')).unwrap_or(s.len() - i - 1);
            if e > i + 1 {
                out.push((i, e, if c == '.' { "t" } else { "m" }));
                i = e;
                continue;
            }
        }
        i = next(s, i);
    }
    out
}

fn markdown(s: &str) -> Vec<Span> {
    let mut out = vec![];
    let mut at = 0;
    let mut fence = false;
    for line in s.split_inclusive('\n') {
        let t = line.trim_end_matches('\n');
        let lead = t.len() - t.trim_start().len();
        let body = &t[lead..];
        if body.starts_with("```") || body.starts_with("~~~") {
            fence = !fence;
            out.push((at, at + t.len(), "m"));
        } else if fence {
            out.push((at, at + t.len(), "s"));
        } else if body.starts_with('#') {
            out.push((at, at + t.len(), "h"));
        } else if body.starts_with('>') {
            out.push((at, at + t.len(), "c"));
        } else {
            if let Some(m) = ["- ", "* ", "+ "].iter().find(|m| body.starts_with(**m)) {
                out.push((at + lead, at + lead + m.len() - 1, "k"));
            }
            // inline `code`
            let mut k = 0;
            while let Some(p) = t[k..].find('`') {
                let p = k + p;
                let Some(q) = t[p + 1..].find('`') else { break };
                out.push((at + p, at + p + 1 + q + 1, "s"));
                k = p + q + 2;
            }
        }
        at += line.len();
    }
    out.sort_by_key(|x| x.0);
    out
}

fn diff(s: &str) -> Vec<Span> {
    let mut out = vec![];
    let mut at = 0;
    for line in s.split_inclusive('\n') {
        let t = line.trim_end_matches('\n');
        let cls = if t.starts_with("+++") || t.starts_with("---") || t.starts_with("diff ") || t.starts_with("index ") {
            Some("h")
        } else if t.starts_with("@@") {
            Some("m")
        } else if t.starts_with('+') {
            Some("i")
        } else if t.starts_with('-') {
            Some("d")
        } else {
            None
        };
        if let Some(c) = cls {
            out.push((at, at + t.len(), c));
        }
        at += line.len();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    fn toks(l: &str, s: &str) -> Vec<(String, &'static str)> {
        spans(l, s).into_iter().map(|(a, b, c)| (s[a..b].to_string(), c)).collect()
    }
    #[test]
    fn js() {
        let t = toks("js", "const x = foo(\"hi\", 42); // done\nclass A {}");
        assert_eq!(
            t,
            vec![
                ("const".into(), "k"),
                ("foo".into(), "f"),
                ("\"hi\"".into(), "s"),
                ("42".into(), "n"),
                ("// done".into(), "c"),
                ("class".into(), "k"),
                ("A".into(), "t")
            ]
        );
        assert_eq!(toks("js", "`a\nb` /* c */"), vec![("`a\nb`".into(), "s"), ("/* c */".into(), "c")]);
        assert!(toks("ts", "console.log(\"hello\")").contains(&("log".into(), "f")));
    }
    #[test]
    fn python_sql_json_shell() {
        assert_eq!(
            toks("py", "def f(): return None # x"),
            vec![("def".into(), "k"), ("f".into(), "f"), ("return".into(), "k"), ("None".into(), "t"), ("# x".into(), "c")]
        );
        assert_eq!(toks("py", "s = \"\"\"a\nb\"\"\""), vec![("\"\"\"a\nb\"\"\"".into(), "s")]);
        assert_eq!(toks("sql", "SELECT * FROM t -- c"), vec![("SELECT".into(), "k"), ("FROM".into(), "k"), ("-- c".into(), "c")]);
        assert_eq!(toks("json", "{\"a\": [1, true, \"x\"]}"), vec![("\"a\"".into(), "a"), ("1".into(), "n"), ("true".into(), "t"), ("\"x\"".into(), "s")]);
        assert_eq!(toks("bash", "echo $HOME # hi\nls -la"), vec![("echo".into(), "t"), ("$HOME".into(), "v"), ("# hi".into(), "c"), ("ls".into(), "t")]);
        assert!(toks("bash", "echo a#b").is_empty() || !toks("bash", "echo a#b").iter().any(|t| t.1 == "c"));
    }
    #[test]
    fn markup_css_rust_misc() {
        assert_eq!(
            toks("html", "<a href=\"x\">t</a><!-- c -->"),
            vec![("a".into(), "g"), ("href".into(), "a"), ("\"x\"".into(), "s"), ("a".into(), "g"), ("<!-- c -->".into(), "c")]
        );
        assert_eq!(
            toks("css", ".a { color: #fff; margin: 4px }"),
            vec![(".a".into(), "t"), ("color".into(), "a"), ("#fff".into(), "n"), ("margin".into(), "a"), ("4px".into(), "n")]
        );
        assert_eq!(toks("rust", "fn f<'a>(x: &'a str) { println!(\"{x}\") }")[..2], [("fn".into(), "k"), ("f".into(), "f")]);
        assert!(toks("rust", "fn f<'a>(x: &'a str) { println!(\"{x}\") }").contains(&("println".into(), "m")));
        assert_eq!(toks("diff", "+a\n-b\n c"), vec![("+a".into(), "i"), ("-b".into(), "d")]);
        assert_eq!(toks("yaml", "name: x # c\n- key: 1"), vec![("name".into(), "a"), ("# c".into(), "c"), ("key".into(), "a"), ("1".into(), "n")]);
        assert!(spans("nope", "x").is_empty());
        // never panics on odd input
        for l in LANGS {
            for s in ["\"", "'", "/*", "<", "<a b=\"", "\\", "é\"ü\\", "`", "@", "$", "#", "0x", "1e+", "-- ", "<!--", "{", "\"\"\""] {
                let _ = spans(l.0, s);
            }
        }
    }
}
