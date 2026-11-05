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

**Status:** early draft. The format can still change.

## Use

```sh
go install github.com/NaomiAmethyst/vexyl/cmd/vexyl@latest

vexyl check flags/*.kdl
vexyl render -o sweden.svg flags/sweden.kdl
vexyl render -height 1200 flags/sweden.kdl > sweden.svg
```

As a Go library:

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
- The root package and [`cmd/vexyl`](cmd/vexyl) are the Go reference
  implementation.
- [`flags/`](flags) holds test flags written by hand. They aren't official
  artwork, and comments mark any approximate geometry.

Run the tests with `make check`, and the fuzzers with `make fuzz`. Golden output
lives in `testdata/golden`; after an intended change, rewrite it with
`go test . -update`.

## License

Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>.

- The specification, `SPEC.md`, is licensed under
  [CC BY-SA 4.0](LICENSE-SPEC).
- The code and encoded flag files are licensed under the
  [Apache License 2.0](LICENSE).

These licenses cover this project's work. They grant no rights in the flag designs
themselves, which belong to their own designers and may have their own terms or
legal restrictions on use. In particular, the Progress Pride design has a Creative
Commons license that excludes commercial use; see the notes in its flag file.
