// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Command vexyl checks Vexyl flag documents and renders them to SVG.
package main

import (
	"bytes"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/NaomiAmethyst/vexyl"
)

const usage = `usage:
  vexyl render [options] FILE   render a flag to SVG
  vexyl check FILE...           validate flags

render options:
  -o FILE         write to a file instead of standard output
  -height PIXELS  the image's height
  -ratio H:F      another proportion, by the flag's adapt rules, such as 1:2
  -variant NAME   one of the flag's variants, such as vertical or banner
  -side SIDE      obverse or reverse

FILE can be - for standard input.
`

func main() {
	if err := run(os.Args[1:], os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, stdin io.Reader, stdout io.Writer) error {
	if len(args) == 0 {
		return fmt.Errorf("%s", usage)
	}
	switch args[0] {
	case "render":
		return render(args[1:], stdin, stdout)
	case "check":
		return check(args[1:], stdin)
	case "help", "-h", "--help":
		_, err := io.WriteString(stdout, usage)
		return err
	}
	return fmt.Errorf("unknown command %q\n%s", args[0], usage)
}

func render(args []string, stdin io.Reader, stdout io.Writer) error {
	fs := flag.NewFlagSet("render", flag.ContinueOnError)
	output := fs.String("o", "", "output `file`")
	height := fs.Float64("height", vexyl.DefaultHeight, "image height in `pixels`")
	ratio := fs.String("ratio", "", "another proportion, as `hoist:fly`")
	variant := fs.String("variant", "", "a variant's `name`")
	side := fs.String("side", "", "obverse or reverse")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return fmt.Errorf("render needs one file\n%s", usage)
	}
	if *height <= 0 {
		return fmt.Errorf("-height must be positive")
	}
	doc, err := load(fs.Arg(0), stdin)
	if err != nil {
		return err
	}
	var out bytes.Buffer
	proportion, err := parseRatio(*ratio)
	if err != nil {
		return err
	}
	opts := vexyl.Options{Height: *height, Ratio: proportion, Variant: *variant, Side: *side}
	if err := doc.WriteSVG(&out, opts); err != nil {
		return err
	}
	if *output != "" {
		return os.WriteFile(*output, out.Bytes(), 0o644)
	}
	_, err = stdout.Write(out.Bytes())
	return err
}

// parseRatio reads hoist:fly, as flag proportions are written, into fly over hoist.
func parseRatio(text string) (float64, error) {
	if text == "" {
		return 0, nil
	}
	h, f, ok := strings.Cut(text, ":")
	hoist, err1 := strconv.ParseFloat(h, 64)
	fly, err2 := strconv.ParseFloat(f, 64)
	if !ok || err1 != nil || err2 != nil || hoist <= 0 || fly <= 0 {
		return 0, fmt.Errorf("-ratio must look like 1:2, hoist then fly, got %q", text)
	}
	return fly / hoist, nil
}

func check(paths []string, stdin io.Reader) error {
	if len(paths) == 0 {
		return fmt.Errorf("check needs at least one file\n%s", usage)
	}
	failed := 0
	for _, path := range paths {
		if _, err := load(path, stdin); err != nil {
			fmt.Fprintln(os.Stderr, err)
			failed++
		}
	}
	if failed > 0 {
		return fmt.Errorf("%d of %d files failed", failed, len(paths))
	}
	return nil
}

func load(path string, stdin io.Reader) (*vexyl.Flag, error) {
	if path == "-" {
		return vexyl.Parse(stdin, "<stdin>")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return vexyl.Parse(f, path)
}
