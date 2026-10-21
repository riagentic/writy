// cargo run --example dbg -- file.dj  → prints the parsed XAST as JSON
fn main() {
    let src = std::fs::read_to_string(std::env::args().nth(1).unwrap()).unwrap();
    println!("{}", serde_json::to_string_pretty(&xcore::parse::parse(&src)).unwrap());
}
