// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"regexp"
	"slices"
	"strconv"
	"strings"

	kdl "github.com/calico32/kdl-go"
)

var (
	pathValue    = regexp.MustCompile(`^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$`)
	cornerValues = []string{"upper-hoist", "upper-fly", "lower-hoist", "lower-fly"}
	rayFromNames = append([]string{"center", "hoist", "fly", "top", "bottom"}, cornerValues...)
	shapeKinds   = []string{"disc", "ring", "rect", "plus", "triangle", "star", "heart", "cardioid",
		"polygon", "crescent", "sun", "lozenge", "path"}
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

func (p *parser) boxValue(n *kdl.Node, text string) [4]float64 {
	var box [4]float64
	fields := strings.FieldsFunc(text, func(r rune) bool { return r == ' ' || r == ',' })
	if len(fields) != 4 {
		p.errf(n, `box must be "x y width height"`)
		return box
	}
	for i, field := range fields {
		v, err := strconv.ParseFloat(field, 64)
		if err != nil {
			p.errf(n, `box must be "x y width height"`)
			return box
		}
		box[i] = v
	}
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

func (p *parser) use(n *kdl.Node) Layer {
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
	l.Define = d
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
	flag.Variants[name] = v
}
