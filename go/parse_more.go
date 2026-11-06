// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"errors"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	kdl "github.com/calico32/kdl-go"
)

var (
	seriesValue  = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	pathValue    = regexp.MustCompile(`^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$`)
	decimalWhole = regexp.MustCompile(`^` + decimalForm + `$`)
	numberList   = regexp.MustCompile(`^\s*` + decimalForm + `(?:[\s,]+` + decimalForm + `)*\s*$`)
	numberSplit  = regexp.MustCompile(`[\s,]+`)
	cornerValues = []string{"upper-hoist", "upper-fly", "lower-hoist", "lower-fly"}
	rayFromNames = append([]string{"center", "hoist", "fly", "top", "bottom"}, cornerValues...)
	shapeKinds   = []string{"disc", "ring", "rect", "plus", "triangle", "star", "heart", "cardioid",
		"polygon", "crescent", "sun", "lozenge", "ellipse", "path"}
	viewValues = []string{"none", "rotate", "transpose"}
	modeValues = []string{"extend", "center", "scale", "hoist-extend", "hoist-center", "hoist-scale"}
)

// flagValue reads a child that's either bare or holds #true or #false.
func (p *parser) flagValue(n *kdl.Node) bool {
	p.noProps(n)
	p.noChildren(n)
	args := n.Arguments()
	if len(args) == 0 {
		return true
	}
	if len(args) != 1 || args[0].Kind() != kdl.Bool {
		p.errf(n, "must be #true or #false")
		return false
	}
	return args[0].Bool()
}

func (p *parser) pathData(n *kdl.Node) string {
	d := p.str(n)
	if !pathValue.MatchString(d) {
		p.errf(n, "isn't SVG path data")
		return ""
	}
	return d
}

// decimalForm is the one way to write a number inside a string.
const decimalForm = `[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?`

// asciiSpace is what counts as whitespace inside strings and inline SVG.
const asciiSpace = " \t\n\f\r"

// decimalValue reads one number written in decimalForm, within the format's limits.
func decimalValue(text string) (float64, bool) {
	if !decimalWhole.MatchString(text) {
		return 0, false
	}
	v, err := strconv.ParseFloat(text, 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return 0, false
	}
	if !inLimits(v) {
		return 0, false
	}
	return v, true
}

// numbersIn reads a string holding numbers, separated by whitespace, commas or both.
func numbersIn(text string) ([]float64, bool) {
	if !numberList.MatchString(text) {
		return nil, false
	}
	parts := numberSplit.Split(strings.Trim(text, asciiSpace), -1)
	out := make([]float64, len(parts))
	for i, part := range parts {
		v, ok := decimalValue(part)
		if !ok {
			return nil, false
		}
		out[i] = v
	}
	return out, true
}

func (p *parser) boxValue(n *kdl.Node, text string) [4]float64 {
	var box [4]float64
	values, ok := numbersIn(text)
	if !ok || len(values) != 4 {
		p.errf(n, `box must be "x y width height", with each a finite decimal number of a reasonable size`)
		return box
	}
	copy(box[:], values)
	return box
}

func (p *parser) box(n *kdl.Node) [4]float64 { return p.boxValue(n, p.str(n)) }

// line reads `edge wavy depth=N period=N` or `edge zigzag depth=N count=N`.
func (p *parser) line(n *kdl.Node) *Line {
	p.noChildren(n)
	args := n.Arguments()
	if len(args) != 1 || args[0].Kind() != kdl.String || (args[0].String() != "wavy" && args[0].String() != "zigzag") {
		p.errf(n, "needs a kind: wavy or zigzag")
		return nil
	}
	p.only(n, 1, "depth", "period", "count")
	l := &Line{Kind: args[0].String(), Depth: p.positive(n, p.prop(n, "depth"))}
	if v := n.Prop("period"); v.IsValid() {
		l.Period = p.positive(n, p.numberValue(n, v))
	}
	if v := n.Prop("count"); v.IsValid() {
		l.Count = p.integer(n, p.numberValue(n, v), maxCopies)
	}
	if l.Period == 0 && l.Count == 0 {
		p.errf(n, "needs `period` or `count`")
		return nil
	}
	return l
}

func (p *parser) quarters(n *kdl.Node) Layer {
	l := &Quarters{Effects: newEffects()}
	colors := p.gapColorArgs(n)
	p.noProps(n)
	if len(colors) != 4 {
		p.errf(n, "needs 4 colors")
	} else {
		copy(l.Colors[:], colors)
	}
	p.children(n, []string{"cut"}, p.withEffects(&l.Effects, map[string]func(*kdl.Node){
		"diagonal": func(c *kdl.Node) { l.Diagonal = p.flagValue(c) },
		"split":    func(c *kdl.Node) { l.Split = p.at(c) },
	}))
	if l.Diagonal && l.Split != nil {
		p.errf(n, "`split` only applies to upright quarters")
	}
	return l
}

func (p *parser) checks(n *kdl.Node) Layer {
	l := &Checks{Effects: newEffects(), Flow: "bend-sinister"}
	l.Colors = p.gapColorArgs(n)
	p.noProps(n)
	p.children(n, []string{"cut"}, p.withEffects(&l.Effects, map[string]func(*kdl.Node){
		"rows":    func(c *kdl.Node) { l.Rows = p.integer(c, p.number(c), maxCopies) },
		"columns": func(c *kdl.Node) { l.Columns = p.integer(c, p.number(c), maxCopies) },
		"flow":    func(c *kdl.Node) { l.Flow = p.oneOf(c, []string{"bend", "bend-sinister"}) },
	}))
	if len(l.Colors) < 2 {
		p.errf(n, "needs at least 2 colors")
	}
	if l.Rows == 0 || l.Columns == 0 {
		p.errf(n, "needs `rows` and `columns`")
	}
	if l.Rows*l.Columns > maxCopies {
		p.errf(n, "makes more than %d cells", maxCopies)
	}
	return l
}

func (p *parser) rays(n *kdl.Node) Layer {
	l := &Rays{Effects: newEffects(), From: "center"}
	l.Colors = p.gapColorArgs(n)
	p.noProps(n)
	count := 0
	p.children(n, []string{"cut"}, p.withEffects(&l.Effects, map[string]func(*kdl.Node){
		"from": func(c *kdl.Node) {
			p.plain(c)
			if len(c.Arguments()) > 0 {
				l.From = p.oneOf(c, rayFromNames)
			} else {
				l.At = p.at(c)
			}
		},
		"count":  func(c *kdl.Node) { count = p.integer(c, p.number(c), maxCopies) },
		"ratio":  func(c *kdl.Node) { l.Ratio = p.positives(c) },
		"rotate": func(c *kdl.Node) { l.Rotate = p.number(c) },
		"measure": func(c *kdl.Node) {
			l.ByEdge = p.oneOf(c, []string{"angle", "edge"}) == "edge"
		},
	}))
	if len(l.Colors) == 0 {
		return l
	}
	if count > 0 {
		cycle := l.Colors
		l.Colors = make([]string, count)
		for i := range l.Colors {
			l.Colors[i] = cycle[i%len(cycle)]
		}
	}
	l.Ratio = p.ratio(n, l.Ratio, len(l.Colors))
	return l
}

// ordinaryShape reads a pile or pall, which are shapes tied to their region's edges.
func (p *parser) ordinaryShape(n *kdl.Node) Layer {
	l := &Charge{Effects: newEffects(), Shape: Shape{Kind: n.Name()}}
	l.Color = p.colorArg(n)
	p.noProps(n)
	p.shapeBody(n, &l.Shape, p.withEffects(&l.Effects, map[string]func(*kdl.Node){
		"fimbriate": func(c *kdl.Node) { l.Fimbriate = p.edge(c) },
	}))
	return l
}

func (p *parser) panel(n *kdl.Node, depth int) Layer {
	l := &Panel{Effects: newEffects()}
	p.noValues(n)
	p.container(n, depth, &l.Effects, &l.Layers, map[string]func(*kdl.Node){
		"side":   func(c *kdl.Node) { l.Side = p.oneOf(c, fromValues) },
		"corner": func(c *kdl.Node) { l.Corner = p.oneOf(c, cornerValues) },
		"at":     func(c *kdl.Node) { l.At = p.at(c) },
		"width":  func(c *kdl.Node) { l.Width = p.positive(c, p.number(c)) },
		"fly":    func(c *kdl.Node) { l.Fly = p.positive(c, p.number(c)) },
		"hoist":  func(c *kdl.Node) { l.Hoist = p.positive(c, p.number(c)) },
		"edge":   func(c *kdl.Node) { l.Line = p.line(c) },
	})
	p.checkWaves(n, l.Line)
	switch {
	case l.Side != "" && l.Corner != "":
		p.errf(n, "needs either `side` or `corner`, not both")
	case l.Side != "":
		if l.Width == 0 {
			p.errf(n, "a side panel needs a `width`")
		}
		if l.Fly != 0 || l.Hoist != 0 || l.At != nil {
			p.errf(n, "a side panel takes a `width`, and no `fly`, `hoist` or `at`")
		}
	default:
		if l.Fly == 0 || l.Hoist == 0 {
			p.errf(n, "needs a `side` and `width`, or a `fly` and `hoist`")
		}
		if l.Line != nil {
			p.errf(n, "only a side panel can have an `edge`")
		}
		if l.Corner != "" && l.At != nil {
			p.errf(n, "needs either `corner` or `at`, not both")
		}
	}
	if len(l.Layers) == 0 {
		p.errf(n, "needs at least one layer")
	}
	return l
}

func (p *parser) use(n *kdl.Node, depth int) Layer {
	l := &Use{Effects: newEffects()}
	args := n.Arguments()
	p.noProps(n)
	if len(args) != 1 || args[0].Kind() != kdl.String {
		p.errf(n, "needs the name of a definition")
		return nil
	}
	l.Name = args[0].String()
	d, ok := p.defines[l.Name]
	if !ok || d.Shape != nil {
		p.errf(n, "%q isn't a defined design", l.Name)
		return nil
	}
	if depth+d.height > maxDepth {
		p.errf(n, "%q nests more than %d levels deep where it's used", l.Name, maxDepth)
	}
	l.design = d
	p.children(n, []string{"cut"}, p.withEffects(&l.Effects, nil))
	return l
}

// define reads a reusable shape or design: `define NAME hoist=H fly=F { ... }`.
func (p *parser) define(n *kdl.Node) {
	p.plain(n)
	args := n.Arguments()
	if len(args) != 1 || args[0].Kind() != kdl.String {
		p.errf(n, "needs a name")
		return
	}
	name := args[0].String()
	if _, dup := p.defines[name]; dup || slices.Contains(shapeKinds, name) || name == "svg" || name == "pile" || name == "pall" {
		p.errf(n, "%q is already taken", name)
		return
	}
	p.only(n, 1, "hoist", "fly")
	d := &Define{}
	if n.Prop("fly").IsValid() || n.Prop("hoist").IsValid() {
		d.Fly, d.Hoist = p.positive(n, p.prop(n, "fly")), p.positive(n, p.prop(n, "hoist"))
	}
	if n.Children() == nil || len(n.Children().Nodes) == 0 {
		p.errf(n, "needs a shape or layers")
		return
	}
	nodes := n.Children().Nodes
	if len(nodes) == 1 && slices.Contains(shapeKinds, nodes[0].Name()) {
		c := nodes[0]
		p.plain(c)
		s := Shape{Kind: c.Name()}
		if s.Kind == "path" && len(c.Arguments()) > 0 {
			// The usual form, `path "M..." box="0 0 10 10"`, puts it all on one line.
			if a := c.Arguments(); len(a) == 1 && a[0].Kind() == kdl.String && pathValue.MatchString(a[0].String()) {
				s.D = a[0].String()
			} else {
				p.errf(c, "isn't SVG path data")
			}
			if b := c.Prop("box"); b.IsValid() && b.Kind() == kdl.String {
				s.Box = p.boxValue(c, b.String())
			}
			// Its size comes from each charge using it, so nothing can be checked yet.
			if s.Box[2] <= 0 || s.Box[3] <= 0 {
				p.errf(c, "needs a `box` with an area")
			}
			d.Shape = &s
			p.defines[name] = d
			return
		}
		p.noValues(c)
		p.shapeBody(c, &s, nil)
		d.Shape = &s
		p.defines[name] = d
		return
	}
	for _, c := range nodes {
		if l := p.layer(c, 2); l != nil {
			d.Layers = append(d.Layers, l)
		}
	}
	d.size = layersSize(d.Layers, p.longer)
	d.height = layersHeight(d.Layers)
	p.defines[name] = d
}

// outline reads a flag's silhouette: a polygon or path inside it, or a named form.
func (p *parser) outline(n *kdl.Node) *Outline {
	p.plain(n)
	p.noProps(n)
	o := &Outline{}
	args := n.Arguments()
	if len(args) > 1 || (len(args) == 1 && args[0].Kind() != kdl.String) {
		p.errf(n, "takes a named form, or a polygon or path inside it")
		return nil
	}
	if len(args) == 1 {
		o.Kind = args[0].String()
		switch o.Kind {
		case "swallowtail", "tongued", "pennant":
		default:
			p.errf(n, "unknown form %q", o.Kind)
			return nil
		}
		p.children(n, nil, map[string]func(*kdl.Node){
			"depth":  func(c *kdl.Node) { o.Depth = p.positive(c, p.number(c)) },
			"tip":    func(c *kdl.Node) { o.Tip = p.positive(c, p.number(c)) },
			"tongue": func(c *kdl.Node) { o.Tongue = p.positive(c, p.number(c)) },
			"taper":  func(c *kdl.Node) { o.Taper = p.positive(c, p.number(c)) },
		})
		if o.Kind != "pennant" && o.Depth == 0 {
			p.errf(n, "needs a `depth`")
		}
		if o.Kind == "tongued" && o.Tongue == 0 {
			p.errf(n, "needs a `tongue`")
		}
		return o
	}
	p.children(n, nil, map[string]func(*kdl.Node){
		"polygon": func(c *kdl.Node) {
			s := Shape{Kind: "polygon"}
			p.noValues(c)
			p.shapeBody(c, &s, nil)
			o.Kind, o.Vertices = "polygon", s.Vertices
		},
		"path": func(c *kdl.Node) {
			a := c.Arguments()
			if len(a) != 1 || a[0].Kind() != kdl.String || !pathValue.MatchString(a[0].String()) {
				p.errf(c, "isn't SVG path data")
				return
			}
			o.Kind, o.D = "path", a[0].String()
			if b := c.Prop("box"); b.IsValid() && b.Kind() == kdl.String {
				o.Box = p.boxValue(c, b.String())
			}
			if o.Box[2] <= 0 || o.Box[3] <= 0 {
				p.errf(c, "needs a `box` with an area")
			}
		},
	})
	if o.Kind == "" {
		p.errf(n, "needs a form, a `polygon` or a `path`")
		return nil
	}
	return o
}

func (p *parser) reverse(n *kdl.Node, flag *Flag) {
	p.plain(n)
	args := n.Arguments()
	if len(args) == 1 && args[0].Kind() == kdl.String && args[0].String() == "mirror" {
		// The default, for saying so outright.
		p.noProps(n)
		p.noChildren(n)
		return
	}
	p.noValues(n)
	r := &Reverse{}
	if n.Children() != nil {
		for _, c := range n.Children().Nodes {
			if l := p.layer(c, 2); l != nil {
				r.Layers = append(r.Layers, l)
			}
		}
	}
	if len(r.Layers) == 0 {
		p.errf(n, "needs layers, or `mirror`")
	}
	p.count(n, r.Layers)
	flag.Reverse = r
}

func (p *parser) adapt(n *kdl.Node, flag *Flag) {
	p.noValues(n)
	a := &Adapt{}
	mode := func(c *kdl.Node) string {
		if len(c.Arguments()) == 1 && c.Arguments()[0].Kind() == kdl.String && c.Arguments()[0].String() == "cut" {
			return "extend"
		}
		return p.oneOf(c, modeValues)
	}
	p.children(n, nil, map[string]func(*kdl.Node){
		"range": func(c *kdl.Node) {
			v := p.numbers(c)
			if len(v) != 2 || v[0] <= 0 || v[1] < v[0] {
				p.errf(c, "needs a lowest and highest fly-to-hoist ratio")
				return
			}
			a.Min, a.Max = v[0], v[1]
		},
		"wider":    func(c *kdl.Node) { a.Wider = mode(c) },
		"narrower": func(c *kdl.Node) { a.Narrower = mode(c) },
	})
	if a.Wider == "" && a.Narrower == "" {
		p.errf(n, "needs `wider`, `narrower` or both")
	}
	flag.Adapt = a
}

func (p *parser) variant(n *kdl.Node, flag *Flag) {
	p.plain(n)
	args := n.Arguments()
	if len(args) != 1 || args[0].Kind() != kdl.String {
		p.errf(n, "needs a name")
		return
	}
	p.noProps(n)
	name := args[0].String()
	if _, dup := flag.Variants[name]; dup {
		p.errf(n, "%q is defined twice", name)
		return
	}
	v := &Variant{From: "none"}
	settings := map[string]func(*kdl.Node){
		"from":    func(c *kdl.Node) { v.From = p.oneOf(c, viewValues) },
		"upright": func(c *kdl.Node) { v.Upright = p.flagValue(c) },
		"ratio": func(c *kdl.Node) {
			v.Ratio = p.positive(c, p.number(c))
		},
		"proportion": func(c *kdl.Node) {
			p.only(c, 0, "hoist", "fly")
			v.Hoist = p.positive(c, p.prop(c, "hoist"))
			v.Fly = p.positive(c, p.prop(c, "fly"))
			p.noChildren(c)
		},
		"outline": func(c *kdl.Node) { v.Outline = p.outline(c) },
		"border":  func(c *kdl.Node) { v.Border, v.BorderOutside = p.border(c, nil) },
	}
	seen := map[string]bool{}
	if n.Children() != nil {
		for _, c := range n.Children().Nodes {
			handler, isSetting := settings[c.Name()]
			if !isSetting {
				if l := p.layer(c, 2); l != nil {
					v.Layers = append(v.Layers, l)
				}
				continue
			}
			if seen[c.Name()] {
				p.errf(c, "given more than once")
			}
			seen[c.Name()] = true
			p.plain(c)
			handler(c)
		}
	}
	if seen["proportion"] {
		if seen["ratio"] {
			p.errf(n, "can't have both `proportion` and `ratio`")
		}
		if len(v.Layers) == 0 {
			p.errf(n, "with a `proportion` needs its own layers")
		}
	}
	p.count(n, v.Layers)
	flag.Variants[name] = v
}

// reference reads a text with any sources for it as children.
func (p *parser) reference(n *kdl.Node) *Reference {
	p.noProps(n)
	args := n.Arguments()
	if len(args) != 1 || args[0].Kind() != kdl.String {
		p.errf(n, "needs one string")
		return nil
	}
	r := &Reference{Text: args[0].String()}
	p.children(n, []string{"source"}, map[string]func(*kdl.Node){
		"source": func(c *kdl.Node) { r.Sources = append(r.Sources, p.str(c)) },
	})
	return r
}

// validDate accepts a year, a month or a day, which is as much as many flags' origins
// are known to.
func validDate(text string) bool {
	for _, layout := range []string{"2006", "2006-01", "2006-01-02"} {
		if _, err := time.Parse(layout, text); err == nil {
			return true
		}
	}
	return false
}

// color reads a palette color, with its values in any other color systems.
func (p *parser) color(n *kdl.Node, flag *Flag) string {
	p.noProps(n)
	args := n.Arguments()
	if len(args) != 1 || args[0].Kind() != kdl.String {
		p.errf(n, "needs one string")
		return ""
	}
	var refs []ColorRef
	named := func(c *kdl.Node) { refs = append(refs, ColorRef{c.Name(), p.str(c)}) }
	p.children(n, []string{"dye", "reference"}, map[string]func(*kdl.Node){
		"pantone": named,
		"ncs":     named,
		"ral":     named,
		"munsell": named,
		"dye":     named,
		"thread":  named,
		"cmyk": func(c *kdl.Node) {
			v := p.numbers(c)
			if len(v) != 4 {
				p.errf(c, "needs 4 values from 0 to 100")
				return
			}
			parts := make([]string, 4)
			for i, x := range v {
				if x < 0 || x > 100 {
					p.errf(c, "needs 4 values from 0 to 100")
				}
				parts[i] = strconv.FormatFloat(x, 'f', -1, 64)
			}
			refs = append(refs, ColorRef{"cmyk", strings.Join(parts, " ")})
		},
		"reference": func(c *kdl.Node) {
			p.noProps(c)
			p.noChildren(c)
			a := c.Arguments()
			if len(a) != 2 || a[0].Kind() != kdl.String || a[1].Kind() != kdl.String {
				p.errf(c, "needs a system's name and a value")
				return
			}
			refs = append(refs, ColorRef{a[0].String(), a[1].String()})
		},
	})
	if refs != nil {
		if flag.ColorRefs == nil {
			flag.ColorRefs = map[string][]ColorRef{}
		}
		flag.ColorRefs[n.Name()] = refs
	}
	return args[0].String()
}

// fold reads a named sequence of folds.
func (p *parser) fold(n *kdl.Node, flag *Flag) {
	p.plain(n)
	args := n.Arguments()
	if len(args) != 1 || args[0].Kind() != kdl.String {
		p.errf(n, "needs a name")
		return
	}
	p.noProps(n)
	name := args[0].String()
	if _, dup := flag.Folds[name]; dup {
		p.errf(n, "%q is defined twice", name)
		return
	}
	f := &Fold{}
	step := func(c *kdl.Node) {
		if s := p.foldStep(c); s != nil {
			f.Steps = append(f.Steps, *s)
		}
	}
	p.children(n, []string{"source", "over", "under", "tuck"}, map[string]func(*kdl.Node){
		"description": func(c *kdl.Node) { f.Description = p.str(c) },
		"source":      func(c *kdl.Node) { f.Sources = append(f.Sources, p.str(c)) },
		"over":        step,
		"under":       step,
		"tuck":        step,
	})
	if len(f.Steps) == 0 && n.Children() != nil {
		p.errf(n, "needs at least one step")
	}
	flag.Folds[name] = f
}

// foldStep reads `over along=fly at=5 move=bottom`, or for any line,
// `over through="a b c d" move="e f"`.
func (p *parser) foldStep(n *kdl.Node) *FoldStep {
	p.noChildren(n)
	p.only(n, 0, "along", "at", "move", "through")
	s := &FoldStep{Kind: n.Name()}
	moveValue := n.Prop("move")
	if !moveValue.IsValid() || moveValue.Kind() != kdl.String {
		p.errf(n, "needs move=, the part that moves")
		return nil
	}
	move := moveValue.String()
	if through := n.Prop("through"); through.IsValid() {
		line := p.pointList(n, through, 4)
		point := p.pointList(n, moveValue, 2)
		if line == nil || point == nil {
			return nil
		}
		s.A, s.B, s.Moving = Point{line[0], line[1]}, Point{line[2], line[3]}, Point{point[0], point[1]}
		return s
	}
	along := n.Prop("along")
	if !along.IsValid() || along.Kind() != kdl.String || !n.Prop("at").IsValid() {
		p.errf(n, `needs along= and at=, or through=`)
		return nil
	}
	at := p.prop(n, "at")
	switch along.String() {
	case "fly":
		s.A, s.B = Point{0, at}, Point{1, at}
		switch move {
		case "top":
			s.Moving = Point{0, at - 1}
		case "bottom":
			s.Moving = Point{0, at + 1}
		default:
			p.errf(n, "a crease along the fly moves top or bottom")
			return nil
		}
	case "hoist":
		s.A, s.B = Point{at, 0}, Point{at, 1}
		switch move {
		case "hoist":
			s.Moving = Point{at - 1, 0}
		case "fly":
			s.Moving = Point{at + 1, 0}
		default:
			p.errf(n, "a crease along the hoist moves hoist or fly")
			return nil
		}
	default:
		p.errf(n, "along must be fly or hoist")
		return nil
	}
	return s
}

func (p *parser) pointList(n *kdl.Node, v kdl.Value, count int) []float64 {
	if v.Kind() != kdl.String {
		p.errf(n, "needs %d numbers in a string", count)
		return nil
	}
	values, ok := numbersIn(v.String())
	if !ok || len(values) != count {
		p.errf(n, "needs %d finite decimal numbers of a reasonable size in a string", count)
		return nil
	}
	return values
}
