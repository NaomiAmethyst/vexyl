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
a tricolor can simply spread out. `variant` describes vertical, banner and other forms.

**Status:** early draft. The format can still change.

## Use

```sh
go install github.com/NaomiAmethyst/vexyl/go/cmd/vexyl@latest

vexyl check flags/*.kdl
vexyl render -o sweden.svg flags/sweden.kdl
vexyl render -height 1200 flags/sweden.kdl > sweden.svg

# Another proportion, by the flag's own rules, written hoist:fly
vexyl render -ratio 1:2 -o sweden-long.svg flags/sweden.kdl

# A named form, or the other side
vexyl render -variant vertical -o us-vertical.svg flags/united-states.kdl
vexyl render -side reverse -o us-back.svg flags/united-states.kdl
```

As a Go library, imported from `github.com/NaomiAmethyst/vexyl/go`:

```go
flag, err := vexyl.Parse(file, "sweden.kdl")
if err != nil {
	return err
}
err = flag.WriteSVG(os.Stdout, vexyl.Options{Height: 1200})
```

## Contents

- [`SPEC.md`](SPEC.md) is the language-neutral format specification, with its
  algorithms in pseudocode.
- [`go/`](go) is the Go reference implementation, with the `vexyl` command in
  [`go/cmd/vexyl`](go/cmd/vexyl).
- [`flags/`](flags) holds flags written by hand and checked against official
  sources where possible, with notes on what each relies on.
- [`flags/imported/`](flags/imported) holds country and pride flags converted
  mechanically from Wikimedia Commons. They exist to stress test the format; see
  [its README](flags/imported/README.md).
- [`docs/missing-from-spec.md`](docs/missing-from-spec.md) is the survey of real flags
  behind the format's vocabulary.
- [`tools/`](tools) holds the importer. `svg2vexyl.py` converts one SVG file, and
  `fetch_flags.py` and `import_flags.py` gather a corpus and check each result.

Run the tests with `make check`, and the fuzzers with `make fuzz`. Golden output
lives in `go/testdata/golden`; after an intended change, rewrite it by running
`go test . -update` in `go/`.

## License

Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>.

- The specification, `SPEC.md`, is licensed under
  [CC BY-SA 4.0](LICENSE-SPEC).
- The code and hand-written flag files are licensed under the
  [Apache License 2.0](LICENSE).
- Files in `flags/imported/` derive from Wikimedia Commons, and each states its own
  license and author.

These licenses cover this project's work. They grant no rights in the flag designs
themselves, which belong to their own designers and may have their own terms or
legal restrictions on use. In particular, the Progress Pride design has a Creative
Commons license that excludes commercial use; see the notes in its flag file.
