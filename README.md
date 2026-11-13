# Vexyl

Vexyl is a format for describing flags the way a flag specification does: by
their proportions, divisions, ordinaries and charges. A renderer turns that
description into an image, and this repository includes a reference renderer for
SVG.

```kdl
vexyl 1
meta {
  name "Sweden"
}
palette {
  blue "#006aa7"
  yellow "#fecc02"
}
proportion hoist=10 fly=16

field blue
cross yellow {
  fly 5 2 9
  hoist 4 2 4
}
```

Those numbers are Sweden's official 5:2:9 and 4:2:4 construction. Each file is
self-contained, so a flag can be shared as a single `.kdl` file.

A file can also say how the flag behaves away from its usual form. `adapt` says how it
reaches other proportions without distorting, since a cross should keep its place while
a tricolor can simply spread out. `variant` describes vertical, banner and other forms. `fold`
describes how it's folded, and can be drawn step by step. Colors can also record their
Pantone, NCS, dye or other values, for print and manufacturing.

**Status:** version 1 of the format is frozen. A change to what a document means or how it renders needs a new format version.

## Installing

The `vexyl` command needs Go 1.25 or later:

```sh
go install github.com/NaomiAmethyst/vexyl/go/cmd/vexyl@latest
```

Each [release](https://github.com/NaomiAmethyst/vexyl/releases) also has it built for Linux,
macOS and Windows.

The TypeScript library, which has the same command, is on npm:

```sh
npm install @naomiamethyst/vexyl
```

The [Java library](java/README.md), for Java 17 and later, will be on Maven Central as
`name.amethyst:vexyl`, but isn't published yet. Its jar is the same command too.

The command is also an image. It reads files from `/work`, so mount the folder they're in:

```sh
docker run --rm -v "$PWD:/work:ro" ghcr.io/naomiamethyst/vexyl render flags/sweden.kdl > sweden.svg
```

The editor is at [vexyl.amethyst.name](https://vexyl.amethyst.name/). To run your own, its image
serves it on port 8080:

```sh
docker run --rm -p 8080:8080 ghcr.io/naomiamethyst/vexyl-web
```

## Use

```sh
vexyl check flags/*.kdl
vexyl render -o sweden.svg flags/sweden.kdl
vexyl render -height 1200 flags/sweden.kdl > sweden.svg

# Another proportion, by the flag's own rules, written hoist:fly
vexyl render -ratio 1:2 -o sweden-long.svg flags/sweden.kdl

# A named form, or the other side
vexyl render -variant vertical -o us-vertical.svg flags/united-states.kdl
vexyl render -side reverse -o us-back.svg flags/united-states.kdl

# A shape the flag can't reach, padded with transparency. -align takes
# left, top or start; center; or right, bottom or end
vexyl render -ratio 1:1 -fit pad -align left -o sweden-square.svg flags/sweden.kdl

# Folded, or partway through folding
vexyl render -fold triangle -o us-folded.svg flags/united-states.kdl
vexyl render -fold triangle -fold-step 2 -o us-step-2.svg flags/united-states.kdl
```

As a Go library, imported from `github.com/NaomiAmethyst/vexyl/go`:

```go
flag, err := vexyl.Parse(file, "sweden.kdl")
if err != nil {
	return err
}
err = flag.WriteSVG(os.Stdout, vexyl.Options{Height: vexyl.Float(1200)})
```

## Contents

- [`SPEC.md`](SPEC.md) is the language-neutral format specification, with its
  algorithms in pseudocode.
- [`SDK.md`](SDK.md) says what every library offers, and
  [`conformance/`](conformance/README.md) is the suite that they have to pass.
- [`go/`](go) is the Go reference implementation, with the `vexyl` command in
  [`go/cmd/vexyl`](go/cmd/vexyl).
- [`ts/`](ts/README.md) is the TypeScript library, which runs in browsers and Node.
- [`java/`](java/README.md) is the Java library, written from the two specifications.
- [`flags/`](flags) holds flags written by hand and checked against official
  sources where possible, with notes on what each relies on.
- [`vexyl-flags`](https://github.com/NaomiAmethyst/vexyl-flags), a separate repo, holds
  about 2,000 flags, most converted from Wikimedia Commons, and is how the format is stress
  tested. Its `flags/` folder is where hand-written flags are maintained, and its `imported/`
  holds the conversions. The ones in `flags/` here are copies, kept as test fixtures.
- [`docs/missing-from-spec.md`](docs/missing-from-spec.md) is the survey of real flags
  behind the format's vocabulary.
- [`docs/format-2.md`](docs/format-2.md) collects what the frozen format can't yet say, as
  plans for a format 2, and [`docs/format-1-open-questions.md`](docs/format-1-open-questions.md)
  lists what the version 1 text leaves open.
- [`docs/logo/`](docs/logo) holds the logo, which is itself a Vexyl flag.
- [`tools/`](tools) holds the importer. `svg2vexyl.py` converts one SVG file, and
  `fetch_flags.py` and `import_flags.py` gather a corpus and check each result with resvg.

Run the tests with `make check`, the conformance suite with `make conformance`, and the
fuzzers with `make fuzz`. Golden output
lives in `go/testdata/golden`; after an intended change, rewrite it by running
`go test . -update` in `go/`.

## The editor

[`web/`](web/README.md) is an editor for flags in this format, as a static site with no server. It's hosted at
[vexyl.amethyst.name](https://vexyl.amethyst.name/). `make web` builds it
into `web/dist`, and `make check-web` tests it. Both need Node, so `make check` leaves them out.
It downloads any view of a flag, its forms, sides, proportions and fold steps, as SVG or as a PNG at a height
in pixels, made smaller and saying so when that's more than a browser can draw.

Its Construction view draws a flag's construction sheet: the flag on its grid with its sizes marked,
as the drawings attached to flag laws are, in grid units, parts of the hoist or millimetres. It
downloads as SVG, or as a PNG at 150, 300 or 600 dpi with its fonts inside it, and prints on A4,
Letter or paper the size of the drawing. `make check-construction`
draws one for every flag in a vexyl-flags checkout beside this one, and counts labels that collide.

## License

Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>.

- The specifications, `SPEC.md` and `SDK.md`, are licensed under
  [CC BY-SA 4.0](LICENSE-SPEC).
- The code is licensed under the [Apache License 2.0](LICENSE).
- Hand-written flag files say what they're licensed under in their `license` field, mostly
  [CC BY-SA 4.0](LICENSE-SPEC). Most also have a `render-license` of CC0 1.0, so that what
  they render to can be used with no conditions.

These licenses cover this project's work. They grant no rights in the flag designs
themselves, which belong to their own designers and may have their own terms or
legal restrictions on use. In particular, the Progress Pride design has a Creative
Commons license that excludes commercial use; see the notes in its flag file.
