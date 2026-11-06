# Vexyl conformance suite

Every Vexyl library has to pass this. [SDK.md](../SDK.md) says what the suite checks, and why.

```
python3 conformance/run.py [--only render,model,invalid] [--filter TEXT] COMMAND...
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

## Changing the fixtures

Run `make conformance-fixtures`. This changes what every library has to do, so review the diff.
