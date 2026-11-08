# Vexyl conformance suite

Every Vexyl library has to pass this. [SDK.md](../SDK.md) says what the suite checks, and why.

```
python3 conformance/run.py [--only render,model,invalid,accepted,sanitize,distinct,options,tags,locate,share] [--filter TEXT] [--resvg PATH] [--jobs N] COMMAND...
```

Options go before COMMAND. Everything from COMMAND's first word on is passed through as it is, even words that look
like options, so `run.py --jobs 4 java -jar vexyl.jar` works, as does COMMAND given as one quoted string.

It needs Python with numpy, Pillow and jsonschema, as `requirements.txt` pins them, and resvg at the version in
`manifest.json`, since different rasterizers draw differently. COMMAND runs the library under test, and has to offer:

```
COMMAND render [-height PIXELS] [-ratio H:F] [-variant NAME] [-side SIDE] [-fit FIT] [-align WHERE]
               [-fold NAME] [-fold-step N] [-id-prefix TEXT] -o OUT.svg FILE
COMMAND model FILE                prints the canonical model as JSON
COMMAND check -json FILE          prints problems as JSON, and exits nonzero if there are any
COMMAND tree FILE                 prints the render as a tree of elements as JSON, each with a
                                  name, attrs of a name and value, any text, and children
COMMAND render -tags ...          marks each drawn element with the layer that drew it
COMMAND locate FILE               prints each part of a document, as SDK.md section 7.3 says, as JSON
COMMAND locate -line N FILE       prints what's innermost at that line, as JSON
COMMAND share encode FILE         prints the document as a share link's part after its #
COMMAND share decode FILE         prints the document held by the link in a file, exiting nonzero if it's refused
```

It runs `--jobs` cases at once, by default `$VEXYL_JOBS` or one for each CPU, each with files of its own. What it
reports doesn't change with that: the same failures, in the same order, and the same counts, as `--jobs 1`, which
runs one case after another, as it always used to, for a COMMAND that can't run beside itself.

A render that's refused exits nonzero. `-ratio` is written hoist then fly, as flags' proportions
are, so `1:2` is the option `ratio` of 2. `-align` takes `start`, `center` or `end`.

## Files

| Path | Holds |
|---|---|
| `manifest.json` | The suite's `version`, the `format` version it's for, the tolerance, and each flag with its renders |
| `model.schema.json` | The canonical model as a JSON Schema, which every library's models and every fixture have to fit |
| `options.json`, `options.kdl` | A render's options that have to be refused, and those that have to work |
| `distinct.json` | Pairs of document bodies that mean different things, so their models have to differ |
| `valid/NAME.kdl` | A flag |
| `valid/NAME.model.json` | Its expected model |
| `valid/NAME/*.svg` | Its expected renders |
| `invalid.json` | Each document that must be refused, and the line of its first problem if it has one |
| `invalid/NAME.kdl` | Those documents |
| `accepted.json`, `accepted/NAME.kdl` | Documents that must be valid, many exactly at a limit |
| `sanitize.json`, `sanitize/NAME.kdl` | Documents with inline SVG, and the canonical markup each must come to |
| `tags.json`, `tags/NAME.kdl` | Forms of a document, with the box of pixels that each layer's path has to draw alone |
| `locate.json` | The lines each part of some documents has to be found on |
| `share.json`, `share/NAME.link` | Share links that have to be read, as bytes and a hash, and those that have to be refused |

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

## How tagged renders, locations and share links are checked

For every render of every flag, a tagged render has to draw exactly the same pixels as the plain one, with no
tolerance at all. Each shape and piece of artwork it draws has to have a tag, a fold's crease lines apart, and
each tag has to be a path that `locate` gives for that document. A plain render can't have any tag in
it. So that a wrong path can't pass, `tags.json` draws each path of one document alone, in several forms, and
compares the box it fills, within 2 pixels at a height of 128. Each line where a located part starts or ends
has to lead back to what's innermost there.

Share links are made and read with zlib, not with a library under test. A library has to give the exact bytes of each
accepted link, including one that needs every byte of the dictionary and one exactly at the limit, and refuse each bad
one, including a compression bomb. What it writes has to inflate to the exact document, and be
within 15% of what zlib manages with the dictionary, which it can't be without using it. If the dictionary
file changes at all, this fails.

`conformance/prove.py` shows that all of these can fail, by running the suite against a library with one thing wrong
at a time, through `conformance/mutant.py`. It's `make conformance-prove`, which runs a few of these at once, sharing
`--jobs` between them. It also shows that renders catch a few mistakes in geometry: a charge's cuts, an arc's
direction, a turned reverse, a rotated layer adapted as if it weren't rotated, and a panel's shaped edge slanting to
its corner. The last two are the reference itself, patched and built with Go, since no change to a library's input
or output stands in for them.

## What else is checked

Beyond those, every library is run for its options: each refusal in `options.json`, the size that
`-height` gives, `-id-prefix` starting every ID, and two documents or two forms of one not sharing
an ID. Every seventh flag's `tree` has to keep its title and draw the same when written out.

A flag not changing when it's rendered can't be seen from outside, so each library tests that itself.

## Changing the fixtures

Run `make conformance-fixtures`. This changes what every library has to do, so review the diff.
