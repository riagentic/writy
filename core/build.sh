#!/bin/sh
# Build the Rust core to WASM → src/core (wasm-bindgen --target web, per aio's WASM rule).
set -e
cd "$(dirname "$0")"
cargo build --release --target wasm32-unknown-unknown
T=$(cargo metadata --format-version 1 --no-deps | sed -n 's/.*"target_directory":"\([^"]*\)".*/\1/p')
wasm-bindgen --target web --out-dir ../src/core --out-name xcore "$T/wasm32-unknown-unknown/release/xcore.wasm"
# The binary lives in assets/ (mounted at /assets in dev AND packaged builds).
mkdir -p ../assets && mv ../src/core/xcore_bg.wasm ../assets/xcore_bg.wasm
