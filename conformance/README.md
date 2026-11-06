# Vexyl conformance suite

Every Vexyl library has to pass this. [SDK.md](../SDK.md) says what the suite checks, and why.

```
python3 conformance/run.py [--only render,model,invalid,accepted,sanitize] [--filter TEXT] [--resvg PATH] COMMAND...
```

It needs Python with numpy and Pillow, and resvg at the version in `manifest.json`, since
different rasterizers draw differently. COMMAND runs the library under test, and has to offer:

```
COMMAND render [-ratio H:F] [-variant NAME] [-side SIDE] [-fit FIT] [-align WHERE]
               [-fold NAME] [-fold-step N] -o OUT.svg FILE
COMMAND model FILE                prints the canonical model as JSON
COMMAND check -json FILE          prints problems as JSON, and exits nonzero if there are any
```

A render that's refused exits nonzero.

## Files

| Path | Holds |
|---|---|
| `manifest.json` | The tolerance, and each flag with its renders |
| `valid/NAME.kdl` | A flag |
| `valid/NAME.model.json` | Its expected model |
| `valid/NAME/*.svg` | Its expected renders |
| `invalid.json` | Each document that must be refused, and the line of its first problem if it has one |
| `invalid/NAME.kdl` | Those documents |
| `accepted.json`, `accepted/NAME.kdl` | Documents that must be valid, many exactly at a limit |
| `sanitize.json`, `sanitize/NAME.kdl` | Documents with inline SVG, and the canonical markup each must come to |

The flags here are copies of those in `flags/` and `go/testdata/`, with the terms in their own
`license` fields. Files in `invalid/` and everything else here are under this project's Apache
License 2.0.

## How renders are compared

Each is drawn at each height in `tolerance.heights`, then compared by three measures. All must
be within their limits:

| Measure | Limit | Sees |
|---|---|---|
| Solid area of difference | `solid_percent`, at every height | Something large and wrong, ignoring antialiased edges |
| Mean difference per channel | `mean_channel`, at every height | A color that's slightly off everywhere |
| Worst 8 by 8 tile | `worst_tile`, at the largest height | A small shape in the wrong place or size |

These limits come from disturbing the fixtures. Every flag still passes with its numbers rounded
to 4 decimals. A color 2 off, a charge moved by 0.5% of the hoist and a star 3% too large fail,
with few exceptions, such as a star too small for the change to register. Very small errors can
still pass, like a radius 1% off on a small charge, so passing isn't proof of exactness.

## How the sanitizer is checked

Pixels can't show that a sanitizer works, because most of what it removes draws nothing. So
passing also takes all of these:

- Every document under `invalid/` whose name starts `sanitizer-` is refused. They come from the
  tables in `go/conformance_test.go`.
- Every render of every flag has nothing in it off the allowlist: no other element or attribute,
  no reference leaving the document, no function in a paint, no stray text and no repeated `id`.
- Each document in `sanitize.json` gives exactly its canonical markup in the model, and draws that
  same artwork, with each ID and reference having gained a prefix.

## Changing the fixtures

Run `make conformance-fixtures`. This changes what every library has to do, so review the diff.
