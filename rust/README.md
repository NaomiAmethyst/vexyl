# Vexyl for Rust

This is a library for reading [Vexyl](../README.md) flags and rendering them to SVG. It was written
from [SPEC.md](../SPEC.md) and [SDK.md](../SDK.md), and passes the same
[conformance suite](../conformance/README.md) as the Go reference and the other libraries. It needs
Rust 1.88 or later, and is pure Rust: its KDL parser, XML reader, SVG writer and SHA-256 are its
own, and share links are compressed with [miniz_oxide](https://crates.io/crates/miniz_oxide), its
one dependency. It never reads the network or the filesystem.

It's on crates.io as `vexyl`, from version 1.4.0:

```toml
[dependencies]
vexyl = "1.4"
```

```rust
use vexyl::RenderOptions;

let problems = vexyl::validate(&source);             // empty if the document is valid
let flag = vexyl::parse(&source)?;                     // or Problems, holding every problem

let image = flag.svg(&RenderOptions::new().height(1200.0))?;
let back = flag.svg(&RenderOptions::new().side("reverse"))?;
let tree = flag.svg_tree(&RenderOptions::new())?;     // the same document as a tree of elements
let own = flag.svg(&RenderOptions::new().id_prefix("mine-"))?;  // for documents you don't trust
let data = flag.model();                               // plain data, in the suite's canonical form

let spans = vexyl::locate(&source);                    // where each layer and part is
let here = vexyl::layer_at(&spans, 12);                // what's innermost at line 12
let link = vexyl::share_encode(&source)?;              // the part of a share link after its #
let again = vexyl::share_decode(&link)?;
```

A `Problem` has a `line` and `column`, which are `None` when it has no one place, a `node`, and a
`message`. A `Flag` never changes, rendering included, so one flag can render with many options,
and it's `Send` and `Sync`, so from many threads. A flag that can't be drawn as asked, or an
option it can't use, gives an `Error`. The model is a `Value` of maps, lists, strings, numbers and
booleans, and `Flag::model_json` writes it as the suite compares it.

## Command

The crate is also the `vexyl` command, with the same subcommands and options as the Go command,
apart from `info`:

```sh
cargo build --release --manifest-path rust/Cargo.toml
rust/target/release/vexyl render -o sweden.svg flags/sweden.kdl
rust/target/release/vexyl render -ratio 1:1 -fit pad -align left flags/sweden.kdl
rust/target/release/vexyl check -json flags/sweden.kdl
rust/target/release/vexyl model flags/sweden.kdl
rust/target/release/vexyl locate -line 12 flags/sweden.kdl
rust/target/release/vexyl share encode flags/sweden.kdl
```

## Development

It's built with Cargo, on Rust 1.88 or later, in edition 2024. From the repository's root,
`make check-rust` builds it, runs its tests and checks it with Clippy and rustfmt, and
`make conformance-rust` runs the conformance suite against its command. The tests read the
suite's fixtures, so they run inside a checkout of the repository.

KDL v2 is read by `kdl.rs`, written to the KDL 2.0.0 grammar, and inline SVG by a strict XML
reader in `xml.rs`. It and `sanitizer.rs` are a security boundary. `share-v1.dict` is a copy of
[`share/v1.dict`](../share/v1.dict), which the tests check, so that the crate builds on its own.

## License

Apache License 2.0, as the rest of this project's code is. See [`LICENSE`](../LICENSE).
