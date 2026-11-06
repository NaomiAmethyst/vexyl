// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Command vexyl checks Vexyl flag documents and renders them to SVG.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"maps"
	"os"
	"slices"
	"strconv"
	"strings"

	vexyl "github.com/NaomiAmethyst/vexyl/go"
)

const usage = `usage:
  vexyl render [options] FILE   render a flag to SVG
  vexyl check [-json] FILE...   validate flags, with -json listing one file's problems
  vexyl model FILE              print a flag's parsed model as JSON
  vexyl info FILE               list a flag's details, colors, variants and folds

render options:
  -o FILE         write to a file instead of standard output
  -height PIXELS  the image's height
  -ratio H:F      another proportion, by the flag's adapt rules, such as 1:2
  -variant NAME   one of the flag's variants, such as vertical or banner
  -side SIDE      obverse or reverse
  -fit FIT        error, the default, or pad with transparency if the flag
                  can't reach the ratio
  -align WHERE    place a padded flag: left, right, top, bottom or center
  -fold NAME      show one of the flag's folds
  -fold-step N    stop the fold after N steps

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
		if len(args) > 1 && args[1] == "-json" {
			return checkJSON(args[2:], stdin, stdout)
		}
		return check(args[1:], stdin)
	case "info":
		return info(args[1:], stdin, stdout)
	case "model":
		return model(args[1:], stdin, stdout)
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
	fit := fs.String("fit", "", "error or pad")
	align := fs.String("align", "", "left, right, top, bottom or center")
	fold := fs.String("fold", "", "a fold's `name`")
	foldStep := fs.Int("fold-step", 0, "stop the fold after this many steps")
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
	where, ok := map[string]string{"": "", "left": "start", "top": "start", "start": "start", "center": "center", "right": "end", "bottom": "end", "end": "end"}[*align]
	if !ok {
		return fmt.Errorf("-align must be left, right, top, bottom or center, got %q", *align)
	}
	opts := vexyl.Options{Height: height, Ratio: proportion, Variant: *variant, Side: *side,
		Fit: *fit, Align: where, Fold: *fold}
	fs.Visit(func(given *flag.Flag) {
		if given.Name == "fold-step" {
			opts.FoldStep = foldStep
		}
	})
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
func parseRatio(text string) (*float64, error) {
	if text == "" {
		return nil, nil
	}
	h, f, ok := strings.Cut(text, ":")
	hoist, err1 := strconv.ParseFloat(h, 64)
	fly, err2 := strconv.ParseFloat(f, 64)
	if !ok || err1 != nil || err2 != nil || hoist <= 0 || fly <= 0 {
		return nil, fmt.Errorf("-ratio must look like 1:2, hoist then fly, got %q", text)
	}
	return vexyl.Float(fly / hoist), nil
}

func info(paths []string, stdin io.Reader, stdout io.Writer) error {
	if len(paths) != 1 {
		return fmt.Errorf("info needs one file\n%s", usage)
	}
	doc, err := load(paths[0], stdin)
	if err != nil {
		return err
	}
	fmt.Fprintf(stdout, "name: %s\n", doc.Meta.Name)
	if doc.Meta.Version != "" {
		fmt.Fprintf(stdout, "version: %s\n", doc.Meta.Version)
	}
	if doc.Meta.Date != "" {
		fmt.Fprintf(stdout, "date: %s\n", doc.Meta.Date)
	}
	if doc.Meta.Until != "" {
		fmt.Fprintf(stdout, "until: %s\n", doc.Meta.Until)
	}
	if doc.Meta.Series != "" {
		fmt.Fprintf(stdout, "series: %s\n", doc.Meta.Series)
	}
	fmt.Fprintf(stdout, "proportion: %v:%v\n", doc.Hoist, doc.Fly)
	for _, note := range doc.Meta.Notes {
		fmt.Fprintf(stdout, "note: %s\n", note)
	}
	for _, law := range doc.Meta.Laws {
		fmt.Fprintf(stdout, "law: %s\n", law.Text)
	}
	for _, restriction := range doc.Meta.Restrictions {
		fmt.Fprintf(stdout, "restriction: %s\n", restriction.Text)
	}
	fmt.Fprintln(stdout, "colors:")
	for _, name := range slices.Sorted(maps.Keys(doc.Palette)) {
		fmt.Fprintf(stdout, "  %s %s", name, doc.Palette[name])
		for _, ref := range doc.ColorRefs[name] {
			fmt.Fprintf(stdout, ", %s %s", ref.System, ref.Value)
		}
		fmt.Fprintln(stdout)
	}
	if len(doc.Variants) > 0 {
		fmt.Fprintf(stdout, "variants: %s\n", strings.Join(slices.Sorted(maps.Keys(doc.Variants)), ", "))
	}
	if len(doc.Folds) > 0 {
		fmt.Fprintf(stdout, "folds: %s\n", strings.Join(slices.Sorted(maps.Keys(doc.Folds)), ", "))
	}
	return nil
}

// model prints a flag's canonical model, which the conformance suite compares.
func model(paths []string, stdin io.Reader, stdout io.Writer) error {
	if len(paths) != 1 {
		return fmt.Errorf("model needs one file\n%s", usage)
	}
	doc, err := load(paths[0], stdin)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(stdout)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", " ")
	return enc.Encode(doc.Model())
}

// checkJSON lists one file's problems for tools, and fails if it has any.
func checkJSON(paths []string, stdin io.Reader, stdout io.Writer) error {
	if len(paths) != 1 {
		return fmt.Errorf("check -json needs one file\n%s", usage)
	}
	var in io.Reader = stdin
	if paths[0] != "-" {
		f, err := os.Open(paths[0])
		if err != nil {
			return err
		}
		defer f.Close()
		in = f
	}
	problems := vexyl.Validate(in, paths[0])
	list := make([]map[string]any, len(problems))
	for i, p := range problems {
		list[i] = map[string]any{"line": p.Line, "column": p.Column, "node": p.Node, "message": p.Message}
	}
	enc := json.NewEncoder(stdout)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", " ")
	if err := enc.Encode(list); err != nil {
		return err
	}
	if len(problems) > 0 {
		return fmt.Errorf("%d problems", len(problems))
	}
	return nil
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
