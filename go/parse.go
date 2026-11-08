// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	kdl "github.com/calico32/kdl-go"
)

// FormatVersion is the format version this package reads.
const FormatVersion = 1

const (
	maxDepth  = 32
	maxCopies = 10000
	// noColor in a color list leaves a gap, and can't be a palette name.
	noColor = "none"
)

var (
	colorValue = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	kdlLines   = regexp.MustCompile("\n|\u0085|\v|\f|\u2028|\u2029")

	alongValues  = []string{"fly", "hoist", "bend", "bend-sinister"}
	fromValues   = []string{"hoist", "fly", "top", "bottom"}
	blendValues  = []string{"normal", "multiply", "screen", "overlay", "darken", "lighten"}
	anchorValues = []string{"start", "center", "end", "scale"}
)

// Parse reads a Vexyl document. The name is used in error messages. Every
// problem found is reported, joined into the returned error.
func Parse(r io.Reader, name string) (*Flag, error) {
	raw, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}
	if !utf8.Valid(raw) {
		return nil, Problems{{Source: name, Message: "a document has to be UTF-8"}}
	}
	// kdl-go mishandles CRLF in multi-line strings, and a document means the same
	// however its lines end.
	src := []byte(normalizeNewlines(string(raw)))
	doc, err := kdl.Parse(bytes.NewReader(src),
		kdl.WithVersion(kdl.Version2),
		kdl.WithSourceName(name),
		kdl.WithDuplicateProperties(kdl.DupError))
	if err != nil {
		return nil, Problems{syntaxProblem(err, src)}
	}
	sum := sha256.Sum256(src)
	p := &parser{src: src}
	p.prepare(doc.Nodes)
	flag := p.document(doc)
	flag.idPrefix = "vx-" + hex.EncodeToString(sum[:8]) + "-"
	if len(p.errs) > 0 {
		problems := make(Problems, len(p.errs))
		for i, err := range p.errs {
			var one Problem
			if errors.As(err, &one) {
				problems[i] = one
			} else {
				problems[i] = Problem{Message: err.Error()}
			}
		}
		return nil, problems
	}
	return flag, nil
}

type parser struct {
	src       []byte
	errs      []error
	defines   map[string]*Define
	palette   map[string]string
	gradients map[string]*Gradient
	// gradientNames lets a gradient's stops recognize other gradients, since
	// they're defined one at a time.
	gradientNames []string
	// size is what the flag has painted so far, as SPEC section 15 counts it.
	size int
	// longer is the longer side of the flag's own grid, for counting shaped edges.
	longer float64
}

func (p *parser) errf(n *kdl.Node, format string, args ...any) {
	at := n.Location()
	line, column := place(p.src, int(at.Offset))
	p.errs = append(p.errs, Problem{at.Filename, line, column, n.Name(), fmt.Sprintf(format, args...)})
}

// place finds where a byte is, as SDK section 2 says to: lines end at LF, and a column
// counts code points.
func place(src []byte, offset int) (line, column int) {
	offset = min(offset, len(src))
	before := src[:offset]
	start := bytes.LastIndexByte(before, '\n') + 1
	return bytes.Count(before, []byte{'\n'}) + 1, utf8.RuneCount(before[start:]) + 1
}

// document walks the top level, whose nodes have a fixed order.
func (p *parser) document(doc *kdl.Document) *Flag {
	flag := &Flag{}
	const (
		stageVersion = iota
		stageMeta
		stagePalette
		stageProportion
		stageOutline
		stageBorder
		stageDefine
		stageLayers
		stageReverse
		stageAdapt
		stageVariant
		stageFold
	)
	stages := map[string]int{
		"vexyl": stageVersion, "meta": stageMeta, "palette": stagePalette,
		"proportion": stageProportion, "outline": stageOutline, "border": stageBorder,
		"define": stageDefine, "reverse": stageReverse, "adapt": stageAdapt, "variant": stageVariant, "fold": stageFold,
	}
	flag.Defines = map[string]*Define{}
	p.defines = flag.Defines
	flag.Variants = map[string]*Variant{}
	flag.Folds = map[string]*Fold{}
	stage := -1
	seen := map[int]bool{}
	for _, n := range doc.Nodes {
		s, named := stages[n.Name()]
		if !named {
			s = stageLayers
		}
		if s < stage || (s == stage && s != stageLayers && s != stageDefine && s != stageVariant && s != stageFold) {
			p.errf(n, "out of order or repeated")
			continue
		}
		if s > stageVersion && stage < stageVersion {
			at := n.Location()
			line, column := place(p.src, int(at.Offset))
			p.errs = append(p.errs, Problem{at.Filename, line, column, "", fmt.Sprintf("document must start with `vexyl %d`", FormatVersion)})
			return flag
		}
		stage = s
		seen[s] = true
		switch n.Name() {
		case "vexyl":
			version := p.number(n)
			if version != FormatVersion {
				p.errf(n, "unsupported format version; this renderer reads %d", FormatVersion)
				return flag
			}
			flag.Version = FormatVersion
		case "meta":
			p.meta(n, &flag.Meta)
		case "palette":
			p.paletteNode(n, flag)
		case "proportion":
			p.proportion(n, flag)
		case "outline":
			flag.Outline = p.outline(n)
		case "border":
			flag.Border, flag.BorderOutside = p.border(n)
			p.checkOutside(n, flag.Outline, flag.Fly, flag.Hoist, flag.Border, flag.BorderOutside)
		case "define":
			p.define(n)
		case "reverse":
			p.reverse(n, flag)
		case "adapt":
			p.adapt(n, flag)
		case "variant":
			p.variant(n, flag)
		case "fold":
			p.fold(n, flag)
		default:
			if flag.Fly == 0 && flag.Hoist == 0 {
				p.errf(n, "layers must follow `proportion`")
				return flag
			}
			if l := p.layer(n, 1); l != nil {
				flag.Layers = append(flag.Layers, l)
				p.count(n, []Layer{l})
			}
		}
	}
	if !seen[stageVersion] {
		p.errs = append(p.errs, fmt.Errorf("document must start with `vexyl %d`", FormatVersion))
	}
	for _, need := range []struct {
		stage int
		name  string
	}{{stageMeta, "meta"}, {stagePalette, "palette"}, {stageProportion, "proportion"}} {
		if !seen[need.stage] {
			p.errs = append(p.errs, fmt.Errorf("document needs `%s`", need.name))
		}
	}
	for name, v := range flag.Variants {
		if v.Ratio != 0 && flag.Adapt == nil {
			p.errs = append(p.errs, fmt.Errorf("variant %q has a `ratio`, but the flag has no `adapt` rules", name))
		}
	}
	if flag.Fly > 0 && flag.Hoist > 0 && len(p.errs) == 0 {
		for name, fold := range flag.Folds {
			shape, err := flag.foldShape()
			if err == nil {
				_, err = foldFacets(shape, fold, 0)
			}
			if err != nil {
				p.errs = append(p.errs, fmt.Errorf("fold %q: %w", name, err))
			}
		}
	}
	return flag
}

// count adds what a top-level node paints to the flag's size, and refuses the node that
// takes it past the limit, so that a document can't demand unbounded work.
func (p *parser) count(n *kdl.Node, layers []Layer) {
	was := p.size
	p.size = addSize(p.size, layersSize(layers, p.longer))
	if was <= maxSize && p.size > maxSize {
		p.errf(n, "paints too much: a flag can only come to %d parts", maxSize)
	}
}

// prepare checks what's the same wherever it is in a document, and makes what the KDL
// parser gave agree with KDL's own rules where it doesn't.
func (p *parser) prepare(nodes []*kdl.Node) {
	for _, n := range nodes {
		if _, annotated := n.TypeAnnotation(); annotated {
			p.errf(n, "type annotations aren't used by this format")
		}
		if n.Name() == "-inf" && p.bare(n.Location()) {
			p.errf(n, "`-inf` has to be quoted to be a string, or written `#-inf` to be a number")
		}
		for i, v := range n.Arguments() {
			if fixed, ok := p.value(n, v); ok {
				n.SetArg(i, kdl.NewString(fixed))
			}
		}
		for _, key := range n.PropertyOrder() {
			if start, _, ok := n.PropertyKeyLocation(key); ok && key == "-inf" && p.bare(start) {
				p.errf(n, "`-inf` has to be quoted to be a string, or written `#-inf` to be a number")
			}
			if fixed, ok := p.value(n, n.Prop(key)); ok {
				n.SetProp(key, kdl.NewString(fixed))
			}
		}
		p.prepare(n.Children().Nodes)
	}
}

// bare says whether what's at a place is written with no quotes.
func (p *parser) bare(at kdl.Location) bool {
	o := int(at.Offset)
	return o < len(p.src) && p.src[o] != '"' && p.src[o] != '#'
}

// value checks a value, and gives the text a multi-line string should have had if kdl-go
// got it wrong.
func (p *parser) value(n *kdl.Node, v kdl.Value) (string, bool) {
	if _, annotated := v.TypeAnnotation(); annotated {
		p.errf(n, "type annotations aren't used by this format")
	}
	if v.Kind() != kdl.String {
		return "", false
	}
	if v.String() == "-inf" && p.bare(v.Location()) {
		p.errf(n, "`-inf` has to be quoted to be a string, or written `#-inf` to be a number")
	}
	literal, ok := v.Literal()
	if !ok || !strings.HasPrefix(literal, `"""`) || !strings.Contains(literal, `\`) {
		return "", false
	}
	return multilineString(literal)
}

// multilineString reads a quoted multi-line string that has escapes. KDL removes the
// indentation before it resolves escapes, while kdl-go does it after, which loses text when
// an escape makes a newline. So this removes it, and has kdl-go read what's left as a
// string on one line.
func multilineString(literal string) (string, bool) {
	body := strings.TrimSuffix(strings.TrimPrefix(literal, `"""`), `"""`)
	lines := kdlLines.Split(body, -1)
	if len(lines) < 2 {
		return "", false
	}
	prefix := lines[len(lines)-1]
	lines = lines[1 : len(lines)-1]
	var b strings.Builder
	b.WriteString(`x "`)
	continued := false
	for i, line := range lines {
		blank := strings.TrimFunc(line, unicode.IsSpace) == ""
		text := strings.TrimPrefix(line, prefix)
		if blank {
			text = ""
		}
		if i > 0 {
			if continued {
				b.WriteByte('\n')
			} else {
				b.WriteString(`\n`)
			}
		}
		escaped := false
		for _, r := range text {
			switch {
			case escaped:
				escaped = false
			case r == '\\':
				escaped = true
			case r == '"':
				b.WriteByte('\\')
			}
			b.WriteRune(r)
		}
		continued = escaped || (continued && blank)
	}
	b.WriteByte('"')
	doc, err := kdl.Parse(strings.NewReader(b.String()), kdl.WithVersion(kdl.Version2))
	if err != nil || len(doc.Nodes) != 1 || len(doc.Nodes[0].Arguments()) != 1 {
		return "", false
	}
	return doc.Nodes[0].Arguments()[0].String(), true
}

func (p *parser) meta(n *kdl.Node, m *Meta) {
	p.noValues(n)
	str := func(dst *string) func(*kdl.Node) {
		return func(c *kdl.Node) { *dst = p.str(c) }
	}
	list := func(dst *[]string) func(*kdl.Node) {
		return func(c *kdl.Node) { *dst = append(*dst, p.str(c)) }
	}
	p.children(n, []string{"designer", "encoder", "source", "note", "law", "restriction", "adapted-from"}, map[string]func(*kdl.Node){
		"name":        str(&m.Name),
		"description": str(&m.Description),
		"version":     str(&m.Version),
		"date": func(c *kdl.Node) {
			m.Date = p.str(c)
			if m.Date != "" && !validDate(m.Date) {
				p.errf(c, "must be YYYY, YYYY-MM or YYYY-MM-DD, got %q", m.Date)
			}
		},
		"until": func(c *kdl.Node) {
			m.Until = p.str(c)
			if m.Until != "" && !validDate(m.Until) {
				p.errf(c, "must be YYYY, YYYY-MM or YYYY-MM-DD, got %q", m.Until)
			}
		},
		"series": func(c *kdl.Node) {
			m.Series = p.str(c)
			if m.Series != "" && !seriesValue.MatchString(m.Series) {
				p.errf(c, "must be lowercase words joined by hyphens, got %q", m.Series)
			}
		},
		"note": list(&m.Notes),
		"law": func(c *kdl.Node) {
			if r := p.reference(c); r != nil {
				m.Laws = append(m.Laws, *r)
			}
		},
		"restriction": func(c *kdl.Node) {
			if r := p.reference(c); r != nil {
				if len(r.Sources) == 0 {
					p.errf(c, "needs a `source`, since an unsourced legal claim can mislead")
				}
				m.Restrictions = append(m.Restrictions, *r)
			}
		},
		"designer":       list(&m.Designers),
		"design-rights":  str(&m.DesignRights),
		"encoder":        list(&m.Encoders),
		"license":        str(&m.License),
		"render-license": str(&m.RenderLicense),
		"adapted-from": func(c *kdl.Node) {
			if a := p.adaptation(c); a != nil {
				m.AdaptedFrom = append(m.AdaptedFrom, *a)
			}
		},
		"source": list(&m.Sources),
	})
	if m.RenderLicense != "" {
		for _, a := range m.AdaptedFrom {
			if a.License != m.RenderLicense && !freeLicenses[a.License] {
				p.errf(n, "`render-license` %q can't cover work adapted from %s under %q", m.RenderLicense, a.URL, a.License)
			}
		}
	}
	if m.Name == "" {
		p.errf(n, "needs a `name`")
	}
	if m.Date != "" && m.Until != "" {
		// Each is only known to its own precision, so they compare only as far as both go.
		shared := min(len(m.Date), len(m.Until))
		if m.Until[:shared] < m.Date[:shared] {
			p.errf(n, "`until` comes before `date`")
		}
	}
}

// freeLicenses put no conditions on a work, so a file that adapts one can license its
// renders however it likes.
var freeLicenses = map[string]bool{"CC0-1.0": true, "LicenseRef-Public-Domain": true}

func (p *parser) adaptation(n *kdl.Node) *Adaptation {
	p.noProps(n)
	args := n.Arguments()
	if len(args) != 1 || args[0].Kind() != kdl.String {
		p.errf(n, "needs the URL of the original work")
		return nil
	}
	a := &Adaptation{URL: args[0].String()}
	p.children(n, []string{"author"}, map[string]func(*kdl.Node){
		"author":  func(c *kdl.Node) { a.Authors = append(a.Authors, p.str(c)) },
		"license": func(c *kdl.Node) { a.License = p.str(c) },
		"part":    func(c *kdl.Node) { a.Part = p.str(c) },
	})
	return a
}

func (p *parser) paletteNode(n *kdl.Node, flag *Flag) {
	p.noValues(n)
	flag.Palette = map[string]string{}
	flag.Gradients = map[string]*Gradient{}
	p.palette = flag.Palette
	p.gradients = flag.Gradients
	// Gradients can name colors defined after them, so they're read second.
	var gradients []*kdl.Node
	seen := map[string]bool{}
	for _, c := range n.Children().Nodes {
		if seen[c.Name()] {
			p.errf(c, "color defined twice")
			continue
		}
		if c.Name() == noColor {
			p.errf(c, "%q is reserved for leaving a gap", noColor)
			continue
		}
		if c.Name() == "" {
			p.errf(c, "a color's name can't be empty")
			continue
		}
		seen[c.Name()] = true
		if args := c.Arguments(); len(args) > 0 && args[0].Kind() == kdl.String && args[0].String() == "gradient" {
			gradients = append(gradients, c)
			continue
		}
		value := p.color(c, flag)
		if !colorValue.MatchString(value) {
			p.errf(c, "color must be #rrggbb, got %q", value)
		}
		// Either case means the same, so the model has only one.
		flag.Palette[c.Name()] = strings.ToLower(value)
	}
	for _, c := range gradients {
		p.gradientNames = append(p.gradientNames, c.Name())
	}
	for _, c := range gradients {
		flag.Gradients[c.Name()] = p.gradient(c)
	}
}

// gradient reads `name gradient COLOR... along=AXIS { stops N... }`.
func (p *parser) gradient(n *kdl.Node) *Gradient {
	g := &Gradient{Along: "fly"}
	for _, a := range n.Arguments()[1:] {
		if a.Kind() != kdl.String {
			p.errf(n, "a gradient's colors must be palette names")
			continue
		}
		g.Colors = append(g.Colors, p.solidColor(n, a.String()))
	}
	if len(g.Colors) < 2 {
		p.errf(n, "a gradient needs at least 2 colors")
	}
	for _, key := range n.PropertyOrder() {
		if key != "along" {
			p.errf(n, "unknown property %q", key)
		}
	}
	if v := n.Prop("along"); v.IsValid() {
		if v.Kind() != kdl.String || !slices.Contains(alongValues, v.String()) {
			p.errf(n, "along must be one of %v", alongValues)
		} else {
			g.Along = v.String()
		}
	}
	p.children(n, nil, map[string]func(*kdl.Node){
		"stops": func(c *kdl.Node) { g.Stops = p.stops(c, len(g.Colors)) },
	})
	if g.Stops == nil {
		g.Stops = make([]float64, len(g.Colors))
		for i := range g.Stops {
			g.Stops[i] = float64(i) / float64(max(len(g.Colors)-1, 1))
		}
	}
	return g
}

func (p *parser) stops(n *kdl.Node, count int) []float64 {
	stops := p.numbers(n)
	if len(stops) != count {
		p.errf(n, "has %d colors but %d stops", count, len(stops))
	}
	for i, s := range stops {
		if s < 0 || s > 1 {
			p.errf(n, "stops must be between 0 and 1")
		}
		if i > 0 && s < stops[i-1] {
			p.errf(n, "stops can't run backward")
		}
	}
	return stops
}

func (p *parser) proportion(n *kdl.Node, flag *Flag) {
	p.only(n, 0, "hoist", "fly")
	flag.Hoist = p.positive(n, p.prop(n, "hoist"))
	flag.Fly = p.positive(n, p.prop(n, "fly"))
	p.longer = max(flag.Hoist, flag.Fly)
	p.noChildren(n)
}

func (p *parser) layer(n *kdl.Node, depth int) Layer {
	if depth > maxDepth {
		p.errf(n, "nested more than %d levels deep", maxDepth)
		return nil
	}
	switch n.Name() {
	case "field":
		l := &Field{Effects: newEffects()}
		l.Color = p.colorArg(n)
		p.noProps(n)
		p.children(n, []string{"cut"}, p.withEffects(&l.Effects, nil))
		return l
	case "bars":
		return p.bars(n)
	case "chevrons":
		return p.chevrons(n)
	case "band":
		return p.band(n)
	case "cross":
		return p.cross(n)
	case "saltire":
		return p.saltire(n)
	case "charge":
		return p.charge(n)
	case "quarters":
		return p.quarters(n)
	case "checks":
		return p.checks(n)
	case "rays":
		return p.rays(n)
	case "pile", "pall":
		return p.ordinaryShape(n)
	case "panel":
		return p.panel(n, depth)
	case "use":
		return p.use(n, depth)
	case "emblem":
		return p.emblem(n)
	case "group":
		l := &Group{Effects: newEffects()}
		p.noValues(n)
		p.container(n, depth, &l.Effects, &l.Layers, nil)
		if len(l.Layers) == 0 {
			p.errf(n, "needs at least one layer")
		}
		return l
	case "canton":
		l := &Panel{Effects: newEffects(), Corner: "upper-hoist", Canton: true}
		p.noValues(n)
		p.container(n, depth, &l.Effects, &l.Layers, map[string]func(*kdl.Node){
			"fly":   func(c *kdl.Node) { l.Fly = p.positive(c, p.number(c)) },
			"hoist": func(c *kdl.Node) { l.Hoist = p.positive(c, p.number(c)) },
		})
		if l.Fly == 0 || l.Hoist == 0 {
			p.errf(n, "needs `fly` and `hoist`")
		}
		return l
	}
	p.errf(n, "unknown layer")
	return nil
}

// container reads a group or canton, whose children mix settings and layers.
func (p *parser) container(n *kdl.Node, depth int, e *Effects, layers *[]Layer, settings map[string]func(*kdl.Node)) {
	handlers := p.withEffects(e, settings)
	seen := map[string]bool{}
	for _, c := range n.Children().Nodes {
		handler, isSetting := handlers[c.Name()]
		if !isSetting {
			if l := p.layer(c, depth+1); l != nil {
				*layers = append(*layers, l)
			}
			continue
		}
		if seen[c.Name()] && c.Name() != "cut" {
			p.errf(c, "given more than once")
		}
		seen[c.Name()] = true
		handler(c)
	}
}

func newEffects() Effects { return Effects{Opacity: 1, Blend: "normal"} }

func (p *parser) withEffects(e *Effects, handlers map[string]func(*kdl.Node)) map[string]func(*kdl.Node) {
	merged := map[string]func(*kdl.Node){
		"opacity": func(c *kdl.Node) {
			e.Opacity = p.number(c)
			if e.Opacity < 0 || e.Opacity > 1 {
				p.errf(c, "must be between 0 and 1")
			}
		},
		"blend":  func(c *kdl.Node) { e.Blend = p.oneOf(c, blendValues) },
		"anchor": func(c *kdl.Node) { e.Anchor = p.oneOf(c, anchorValues) },
		"clip": func(c *kdl.Node) {
			if s := p.maskShape(c); s != nil {
				e.Clip = s
			}
		},
		"cut": func(c *kdl.Node) {
			if s := p.maskShape(c); s != nil {
				e.Cuts = append(e.Cuts, *s)
			}
		},
	}
	for name, handler := range handlers {
		merged[name] = handler
	}
	return merged
}

// maskShape reads the single shape inside a clip or cut.
func (p *parser) maskShape(n *kdl.Node) *Shape {
	p.noValues(n)
	if len(n.Children().Nodes) != 1 {
		p.errf(n, "needs exactly one shape")
		return nil
	}
	c := n.Children().Nodes[0]
	p.noValues(c)
	if c.Name() == "svg" {
		p.errf(c, "inline SVG can't be used as a clip or cut")
		return nil
	}
	s := p.namedShape(c.Name())
	p.shapeBody(c, &s, nil)
	if s.Hollow > 0 || s.Lines > 0 {
		p.errf(c, "a clip or cut uses a shape's whole area, so it can't be `hollow` or `lines`")
	}
	return &s
}

// namedShape starts a shape of a kind, or from a definition of that name.
func (p *parser) namedShape(name string) Shape {
	if d, ok := p.defines[name]; ok && d.Shape != nil {
		return *d.Shape
	}
	return Shape{Kind: name}
}

func (p *parser) bars(n *kdl.Node) Layer {
	l := &Bars{Effects: newEffects(), Along: "fly"}
	l.Colors = p.gapColorArgs(n)
	p.noProps(n)
	count := 0
	p.children(n, []string{"cut"}, p.withEffects(&l.Effects, map[string]func(*kdl.Node){
		"along":  func(c *kdl.Node) { l.Along = p.oneOf(c, alongValues) },
		"ratio":  func(c *kdl.Node) { l.Ratio = p.positives(c) },
		"rotate": func(c *kdl.Node) { l.Rotate = p.number(c) },
		"count": func(c *kdl.Node) {
			count = p.integer(c, p.number(c), maxCopies)
		},
		"grow": func(c *kdl.Node) { l.Grow = p.numbers(c) },
		"edge": func(c *kdl.Node) { l.Line = p.line(c) },
	}))
	if len(l.Colors) == 0 {
		return l
	}
	l.Colors = p.cycle(n, l.Colors, count)
	p.checkWaves(n, l.Line)
	l.Ratio = p.ratio(n, l.Ratio, len(l.Colors))
	if l.Grow != nil && len(l.Grow) != len(l.Colors) {
		p.errf(n, "has %d colors but %d `grow` values", len(l.Colors), len(l.Grow))
	}
	for _, g := range l.Grow {
		if g < 0 {
			p.errf(n, "`grow` can't be negative")
		}
	}
	return l
}

func (p *parser) chevrons(n *kdl.Node) Layer {
	l := &Chevrons{Effects: newEffects(), From: "hoist"}
	l.Colors = p.gapColorArgs(n)
	p.noProps(n)
	p.children(n, []string{"cut"}, p.withEffects(&l.Effects, map[string]func(*kdl.Node){
		"from":  func(c *kdl.Node) { l.From = p.oneOf(c, fromValues) },
		"depth": func(c *kdl.Node) { l.Depth = p.positive(c, p.number(c)) },
		"angle": func(c *kdl.Node) {
			l.Angle = p.number(c)
			if l.Angle <= 0 || l.Angle >= 90 {
				p.errf(c, "must be between 0 and 90 degrees, exclusive")
			}
		},
		"apex": func(c *kdl.Node) {
			apex := p.number(c)
			if apex < 0 {
				p.errf(c, "can't be negative")
			}
			l.Apex = &apex
		},
		"ratio":     func(c *kdl.Node) { l.Ratio = p.positives(c) },
		"rotate":    func(c *kdl.Node) { l.Rotate = p.number(c) },
		"fimbriate": func(c *kdl.Node) { l.Fimbriate = p.edge(c) },
	}))
	if l.Depth == 0 {
		p.errf(n, "needs a `depth`")
	}
	if l.Apex != nil && l.Angle == 0 {
		p.errf(n, "an off-center `apex` needs an `angle`, since its arms can't meet both corners at one slope")
	}
	l.Ratio = p.ratio(n, l.Ratio, len(l.Colors))
	return l
}

// cycle repeats colors until there are count of them, if count is given. Fewer would drop
// colors without a word.
func (p *parser) cycle(n *kdl.Node, colors []string, count int) []string {
	if count == 0 {
		return colors
	}
	if count < len(colors) {
		p.errf(n, "has %d colors but a `count` of %d, which would leave some out", len(colors), count)
		return colors
	}
	out := make([]string, count)
	for i := range out {
		out[i] = colors[i%len(colors)]
	}
	return out
}

func (p *parser) checkWaves(n *kdl.Node, l *Line) {
	if l != nil && l.waves(p.longer) > maxCopies {
		p.errf(n, "a shaped edge can't have more than %d waves", maxCopies)
	}
}

func (p *parser) ratio(n *kdl.Node, ratio []float64, count int) []float64 {
	if ratio == nil {
		ratio = make([]float64, count)
		for i := range ratio {
			ratio[i] = 1
		}
	}
	if len(ratio) != count {
		p.errf(n, "has %d colors but a ratio of %d values", count, len(ratio))
	}
	return ratio
}

func (p *parser) band(n *kdl.Node) Layer {
	l := &Band{Effects: newEffects(), Along: "fly"}
	l.Color = p.colorArg(n)
	p.noProps(n)
	p.children(n, []string{"cut"}, p.withEffects(&l.Effects, map[string]func(*kdl.Node){
		"along":     func(c *kdl.Node) { l.Along = p.oneOf(c, alongValues) },
		"width":     func(c *kdl.Node) { l.Width = p.positive(c, p.number(c)) },
		"offset":    func(c *kdl.Node) { l.Offset = p.number(c) },
		"rotate":    func(c *kdl.Node) { l.Rotate = p.number(c) },
		"fimbriate": func(c *kdl.Node) { l.Fimbriate = p.edge(c) },
	}))
	if l.Width == 0 {
		p.errf(n, "needs a `width`")
	}
	return l
}

func (p *parser) cross(n *kdl.Node) Layer {
	l := &Cross{Effects: newEffects()}
	l.Color = p.colorArg(n)
	p.noProps(n)
	var seenFly, seenHoist bool
	p.children(n, []string{"cut"}, p.withEffects(&l.Effects, map[string]func(*kdl.Node){
		"fly":       func(c *kdl.Node) { l.FlyParts = p.triple(c); seenFly = true },
		"hoist":     func(c *kdl.Node) { l.HoistPart = p.triple(c); seenHoist = true },
		"fimbriate": func(c *kdl.Node) { l.Fimbriate = p.edge(c) },
	}))
	if !seenFly || !seenHoist {
		p.errf(n, "needs `fly` and `hoist`")
	}
	return l
}

// triple reads the distance before an arm, its width and the distance after.
func (p *parser) triple(n *kdl.Node) [3]float64 {
	v := p.numbers(n)
	if len(v) != 3 {
		p.errf(n, "needs 3 values: before the arm, its width, and after it")
		return [3]float64{0, 1, 0}
	}
	if v[0] < 0 || v[1] <= 0 || v[2] < 0 {
		p.errf(n, "the arm's width must be positive and its distances not negative")
		return [3]float64{0, 1, 0}
	}
	return [3]float64{v[0], v[1], v[2]}
}

func (p *parser) saltire(n *kdl.Node) Layer {
	l := &Saltire{Effects: newEffects()}
	l.Color = p.colorArg(n)
	p.noProps(n)
	p.children(n, []string{"cut"}, p.withEffects(&l.Effects, map[string]func(*kdl.Node){
		"width":         func(c *kdl.Node) { l.Width = p.positive(c, p.number(c)) },
		"fimbriate":     func(c *kdl.Node) { l.Fimbriate = p.edge(c) },
		"counterchange": func(c *kdl.Node) { l.Counterchange = p.flagValue(c) },
	}))
	if l.Width == 0 {
		p.errf(n, "needs a `width`")
	}
	if l.Counterchange && l.Fimbriate != nil {
		p.errf(n, "a counterchanged saltire can't be fimbriated")
	}
	return l
}

func (p *parser) charge(n *kdl.Node) Layer {
	args := n.Arguments()
	p.noProps(n)
	if len(args) == 0 || args[0].Kind() != kdl.String {
		p.errf(n, "needs a shape")
		return nil
	}
	if name := args[0].String(); name == "pile" || name == "pall" {
		p.errf(n, "a %s is a layer of its own, not a charge's shape", name)
		return nil
	}
	l := &Charge{Effects: newEffects(), Shape: p.namedShape(args[0].String())}
	if l.Shape.Kind == "svg" && len(args) == 1 {
		// Inline SVG can bring its own colors.
	} else if len(args) != 2 {
		p.errf(n, "needs a shape and a color")
		return nil
	} else if args[1].Kind() != kdl.String {
		p.errf(n, "color must be a palette name")
		return nil
	} else if l.Shape.Kind == "svg" {
		l.Color = p.solidColor(n, args[1].String())
	} else {
		l.Color = p.paletteColor(n, args[1].String())
	}
	p.shapeBody(n, &l.Shape, p.withEffects(&l.Effects, map[string]func(*kdl.Node){
		"fimbriate": func(c *kdl.Node) { l.Fimbriate = p.edge(c) },
		"repeat":    func(c *kdl.Node) { l.Repeat = p.repeat(c) },
	}))
	switch {
	case l.Shape.embedded != nil && l.Color == "" && l.Shape.embedded.usesCurrentColor():
		p.errf(n, "inline SVG uses currentColor, so it needs a palette color")
	case l.Shape.Kind == "svg" && l.Fimbriate != nil:
		p.errf(n, "inline SVG can't be fimbriated")
	case l.Fimbriate != nil && (l.Shape.Hollow > 0 || l.Shape.Lines > 0):
		p.errf(n, "fimbriation edges a filled shape, so it can't go with `hollow` or `lines`")
	case l.Shape.Kind == "svg" && l.Repeat != nil:
		p.errf(n, "inline SVG can't be repeated")
	case l.Shape.Kind == "polygon" && l.Repeat != nil:
		p.errf(n, "a polygon can't be repeated")
	case l.Repeat != nil && len(l.Shape.Ats) > 1:
		p.errf(n, "several positions and a repeat can't be combined")
	case l.Shape.Kind == "svg" && len(l.Shape.Ats) > 1:
		p.errf(n, "inline SVG can't be repeated")
	case l.Repeat != nil && l.Repeat.Kind == "grid" && l.Shape.placed:
		p.errf(n, "a grid repeat spreads across the region, so it can't have `at`")
	}
	return l
}

func (p *parser) emblem(n *kdl.Node) Layer {
	l := &Emblem{Effects: newEffects()}
	p.noValues(n)
	placed := p.withEffects(&l.Effects, map[string]func(*kdl.Node){
		"at":     func(c *kdl.Node) { l.At = p.at(c) },
		"along":  func(c *kdl.Node) { l.Along = p.oneOf(c, alongValues) },
		"rotate": func(c *kdl.Node) { l.Rotate = p.number(c) },
	})
	seen := map[string]bool{}
	for _, c := range n.Children().Nodes {
		if c.Name() == "charge" {
			if charge, ok := p.layer(c, 1).(*Charge); ok {
				if charge.Repeat != nil && charge.Repeat.Kind == "grid" {
					p.errf(c, "a grid repeat needs a region, which an emblem doesn't have")
				}
				p.frameShape(c, &charge.Shape)
				if charge.Clip != nil {
					p.frameShape(c, charge.Clip)
				}
				for i := range charge.Cuts {
					p.frameShape(c, &charge.Cuts[i])
				}
				l.Charges = append(l.Charges, charge)
			}
			continue
		}
		handler, ok := placed[c.Name()]
		if !ok {
			p.errf(c, "an emblem can only hold charges")
			continue
		}
		if seen[c.Name()] && c.Name() != "cut" {
			p.errf(c, "given more than once")
		}
		seen[c.Name()] = true
		handler(c)
	}
	if len(l.Charges) == 0 {
		p.errf(n, "needs at least one charge")
	}
	return l
}

// frameShape refuses what needs a region's size, which an emblem's frame doesn't have.
func (p *parser) frameShape(n *kdl.Node, s *Shape) {
	switch {
	case s.Kind == "lozenge" && (s.Fly == 0 || s.Hoist == 0):
		p.errf(n, "a lozenge in an emblem needs `fly` and `hoist`, since a frame has no size to take")
	case s.Kind == "pile" || s.Kind == "pall":
		p.errf(n, "a %s needs a region's edges, which an emblem doesn't have", s.Kind)
	}
}

func (p *parser) repeat(n *kdl.Node) *Repeat {
	p.noChildren(n)
	args := n.Arguments()
	if len(args) != 1 || args[0].Kind() != kdl.String {
		p.errf(n, "needs a kind: ring or grid")
		return nil
	}
	r := &Repeat{Kind: args[0].String()}
	switch r.Kind {
	case "ring":
		p.only(n, 1, "count", "radius", "turn")
		r.Count = p.integer(n, p.prop(n, "count"), maxCopies)
		r.Radius = p.positive(n, p.prop(n, "radius"))
		r.Turn = p.boolProp(n, "turn")
	case "grid":
		p.only(n, 1, "rows", "columns", "stagger")
		r.Rows = p.integer(n, p.prop(n, "rows"), maxCopies)
		r.Columns = p.integer(n, p.prop(n, "columns"), maxCopies)
		r.Stagger = p.boolProp(n, "stagger")
		if r.Rows*r.Columns > maxCopies {
			p.errf(n, "makes more than %d copies", maxCopies)
		}
	case "line":
		p.only(n, 1, "count", "fly", "hoist")
		r.Count = p.integer(n, p.prop(n, "count"), maxCopies)
		if v := n.Prop("fly"); v.IsValid() {
			r.Fly = p.numberValue(n, v)
		}
		if v := n.Prop("hoist"); v.IsValid() {
			r.Hoist = p.numberValue(n, v)
		}
		if r.Fly == 0 && r.Hoist == 0 {
			p.errf(n, "needs a step: fly= or hoist=")
		}
	case "arc":
		p.only(n, 1, "count", "radius", "turn", "from", "to")
		r.Count = p.integer(n, p.prop(n, "count"), maxCopies)
		r.Radius = p.positive(n, p.prop(n, "radius"))
		r.Turn = p.boolProp(n, "turn")
		r.From, r.To = p.prop(n, "from"), p.prop(n, "to")
		if r.Count < 2 && r.Count != 0 {
			p.errf(n, "an arc needs at least 2 copies")
		}
		if n.Prop("from").IsValid() && n.Prop("to").IsValid() && math.Mod(r.To-r.From, 360) == 0 {
			p.errf(n, "`from` and `to` are the same place, so there's no arc to repeat along")
		}
	default:
		p.errf(n, "unknown repeat %q", r.Kind)
	}
	return r
}

// shapeBody reads a shape's children, along with any extra handlers.
func (p *parser) shapeBody(n *kdl.Node, s *Shape, extra map[string]func(*kdl.Node)) {
	handlers := map[string]func(*kdl.Node){
		"at": func(c *kdl.Node) {
			at := p.at(c)
			if !s.placed {
				s.At = at
			}
			s.placed = true
			s.Ats = append(s.Ats, at)
		},
		"rotate": func(c *kdl.Node) { s.Rotate = p.number(c) },
		"hollow": func(c *kdl.Node) { s.Hollow = p.positive(c, p.number(c)) },
	}
	s.placed, s.Ats = false, nil
	// What was only worked out from a definition's other values is worked out again.
	if s.autoInner {
		s.Inner, s.autoInner = 0, false
	}
	if s.autoSpread {
		s.Spread, s.autoSpread = 0, false
	}
	radius := func(c *kdl.Node) { s.Radius = p.positive(c, p.number(c)) }
	inner := func(c *kdl.Node) { s.Inner = p.positive(c, p.number(c)) }
	sizeFly := func(c *kdl.Node) { s.Fly = p.positive(c, p.number(c)) }
	sizeHoist := func(c *kdl.Node) { s.Hoist = p.positive(c, p.number(c)) }
	switch s.Kind {
	case "disc", "triangle", "cardioid":
		handlers["radius"] = radius
	case "crescent":
		handlers["radius"], handlers["inner"] = radius, inner
		handlers["offset"] = func(c *kdl.Node) { s.Offset = p.positive(c, p.number(c)) }
	case "sun":
		if s.Points == 0 {
			s.Points = 12
		}
		if s.Spread == 0 {
			s.Spread = 1
		}
		handlers["radius"] = radius
		handlers["disc"] = func(c *kdl.Node) { s.Disc = p.positive(c, p.number(c)) }
		handlers["gap"] = func(c *kdl.Node) { s.Gap = p.positive(c, p.number(c)) }
		handlers["points"] = func(c *kdl.Node) { s.Points = p.integer(c, p.number(c), maxCopies) }
		handlers["spread"] = func(c *kdl.Node) { s.Spread = p.positive(c, p.number(c)) }
	case "lozenge", "ellipse":
		handlers["fly"], handlers["hoist"] = sizeFly, sizeHoist
	case "path":
		handlers["fly"], handlers["hoist"] = sizeFly, sizeHoist
		handlers["d"] = func(c *kdl.Node) { s.D = p.pathData(c) }
		handlers["box"] = func(c *kdl.Node) { s.Box = p.box(c) }
		handlers["evenodd"] = func(c *kdl.Node) { s.EvenOdd = p.flagValue(c) }
	case "pile":
		delete(handlers, "at")
		delete(handlers, "rotate")
		if s.Edge == "" {
			s.Edge = "hoist"
		}
		handlers["from"] = func(c *kdl.Node) { s.Edge = p.oneOf(c, fromValues) }
		handlers["base"] = func(c *kdl.Node) {
			if v := p.numbers(c); len(v) == 2 {
				s.Base = &[2]float64{v[0], v[1]}
			} else {
				p.errf(c, "needs 2 values: where it starts and ends along the edge")
			}
		}
		handlers["tip"] = func(c *kdl.Node) {
			if v := p.numbers(c); len(v) == 2 {
				s.Tip = &[2]float64{v[0], v[1]}
			} else {
				p.errf(c, "needs 2 values: along the edge, then in from it")
			}
		}
		handlers["depth"] = func(c *kdl.Node) { s.Depth = p.positive(c, p.number(c)) }
		handlers["flat"] = func(c *kdl.Node) { s.Flat = p.positive(c, p.number(c)) }
	case "pall":
		delete(handlers, "at")
		delete(handlers, "rotate")
		if s.Edge == "" {
			s.Edge = "hoist"
		}
		handlers["from"] = func(c *kdl.Node) { s.Edge = p.oneOf(c, fromValues) }
		handlers["width"] = func(c *kdl.Node) { s.Width = p.positive(c, p.number(c)) }
		handlers["junction"] = func(c *kdl.Node) { s.Junction = p.positive(c, p.number(c)) }
	case "heart":
		handlers["radius"] = radius
		handlers["spread"] = func(c *kdl.Node) { s.Spread = p.positive(c, p.number(c)) }
	case "ring":
		handlers["radius"], handlers["inner"] = radius, inner
		handlers["from"] = func(c *kdl.Node) { s.From, s.HasArc = p.number(c), true }
		handlers["to"] = func(c *kdl.Node) { s.To, s.HasArc = p.number(c), true }
	case "rect":
		handlers["fly"], handlers["hoist"] = sizeFly, sizeHoist
	case "plus":
		handlers["radius"] = radius
		handlers["width"] = func(c *kdl.Node) { s.Width = p.positive(c, p.number(c)) }
	case "star":
		if s.Points == 0 {
			s.Points = 5
		}
		handlers["radius"], handlers["inner"] = radius, inner
		handlers["lines"] = func(c *kdl.Node) { s.Lines = p.positive(c, p.number(c)) }
		handlers["points"] = func(c *kdl.Node) {
			s.Points = p.integer(c, p.number(c), maxCopies)
			if s.Points > 0 && s.Points < 3 {
				p.errf(c, "needs at least 3 points")
			}
		}
	case "polygon":
		delete(handlers, "at")
		delete(handlers, "rotate")
		handlers["point"] = func(c *kdl.Node) {
			p.only(c, 0, "fly", "hoist")
			p.noChildren(c)
			s.Vertices = append(s.Vertices, Point{p.prop(c, "fly"), p.prop(c, "hoist")})
		}
	case "svg":
		handlers["fly"], handlers["hoist"] = sizeFly, sizeHoist
		handlers["markup"] = func(c *kdl.Node) { s.Markup = p.str(c) }
	default:
		p.errf(n, "unknown shape %q", s.Kind)
		return
	}
	for name, handler := range extra {
		handlers[name] = handler
	}
	repeatable := []string{"cut", "point"}
	if extra != nil {
		repeatable = append(repeatable, "at")
	}
	if s.Kind == "svg" {
		delete(handlers, "hollow")
	}
	p.children(n, repeatable, handlers)
	p.checkShape(n, s)
}

func (p *parser) checkShape(n *kdl.Node, s *Shape) {
	if _, hasRadius := map[string]bool{"disc": true, "ring": true, "plus": true, "triangle": true, "star": true, "heart": true, "cardioid": true, "crescent": true, "sun": true}[s.Kind]; hasRadius && s.Radius == 0 {
		p.errf(n, "needs a `radius`")
	}
	switch s.Kind {
	case "ring":
		if s.Inner == 0 || s.Inner >= s.Radius {
			p.errf(n, "needs an `inner` smaller than its `radius`")
		}
		if s.HasArc && math.Mod(s.To-s.From, 360) == 0 {
			p.errf(n, "`from` and `to` are the same place, so there's no arc to draw")
		}
	case "star":
		if s.Lines > 0 && s.Hollow > 0 {
			p.errf(n, "`lines` and `hollow` can't be combined")
		}
		if s.Inner >= s.Radius && s.Radius > 0 {
			p.errf(n, "`inner` must be smaller than `radius`")
		}
		if s.Inner == 0 && s.Points < 5 {
			p.errf(n, "needs an `inner` with fewer than 5 points")
		}
		if s.Inner == 0 {
			n := float64(s.Points)
			s.Inner = s.Radius * math.Cos(2*math.Pi/n) / math.Cos(math.Pi/n)
			s.autoInner = true
		}
	case "rect", "ellipse":
		if s.Fly == 0 || s.Hoist == 0 {
			p.errf(n, "needs `fly` and `hoist`")
		}
	case "crescent":
		switch {
		case s.Inner == 0 || s.Offset == 0:
			p.errf(n, "needs `inner` and `offset`")
		case s.Radius > 0 && (s.Offset >= s.Radius+s.Inner || s.Offset <= math.Abs(s.Radius-s.Inner)):
			p.errf(n, "`offset` has to make its two circles cross")
		}
	case "sun":
		if s.Disc == 0 {
			p.errf(n, "needs a `disc`")
		}
		if s.Radius > 0 && s.Disc+s.Gap >= s.Radius {
			p.errf(n, "`disc` and `gap` must be smaller than `radius`")
		}
		if s.Points < 3 && s.Points != 0 {
			p.errf(n, "needs at least 3 points")
		}
		if s.Spread > 1 {
			p.errf(n, "`spread` can't be more than 1")
		}
	case "path":
		if s.D == "" {
			p.errf(n, "needs `d`")
		}
		if s.Box[2] <= 0 || s.Box[3] <= 0 {
			p.errf(n, "needs a `box` with an area")
		}
		if s.Fly == 0 && s.Hoist == 0 {
			p.errf(n, "needs `fly` or `hoist`")
		}
	case "pile":
		switch {
		case s.Tip == nil && s.Depth == 0:
			p.errf(n, "needs a `depth` or a `tip`")
		case s.Tip != nil && s.Depth != 0:
			p.errf(n, "takes a `depth` or a `tip`, not both")
		case s.Tip != nil && s.Flat != 0:
			p.errf(n, "a `flat` goes with a `depth`, not a `tip`")
		}
	case "pall":
		if s.Width == 0 {
			p.errf(n, "needs a `width`")
		}
	case "heart":
		if s.Spread == 0 {
			s.Spread = s.Radius * math.Sqrt2
			s.autoSpread = true
		}
		if s.Spread >= 2*s.Radius && s.Radius > 0 {
			p.errf(n, "`spread` must be less than twice `radius`, so that the lobes meet")
		}
	case "plus":
		if s.Width == 0 || s.Width >= 2*s.Radius {
			p.errf(n, "needs a `width` less than twice its `radius`")
		}
	case "polygon":
		if len(s.Vertices) < 3 {
			p.errf(n, "needs at least 3 `point`s")
		}
	case "svg":
		if s.Fly == 0 || s.Hoist == 0 {
			p.errf(n, "needs `fly` and `hoist`")
		}
		if s.Markup == "" {
			p.errf(n, "needs `markup`")
			return
		}
		embedded, err := sanitizeSVG(s.Markup)
		if err != nil {
			p.errf(n, "%v", err)
			return
		}
		s.embedded = embedded
		// Only what passed is kept, so that nothing can read what the sanitizer removed.
		s.Markup = embedded.canonical()
	}
}

func (p *parser) at(n *kdl.Node) *Point {
	p.noChildren(n)
	if args := n.Arguments(); len(args) > 0 {
		if len(args) != 1 || args[0].Kind() != kdl.String || args[0].String() != "center" || len(n.Properties()) > 0 {
			p.errf(n, "must be `center` or `fly=A hoist=B`")
		}
		return nil
	}
	p.only(n, 0, "fly", "hoist")
	return &Point{p.prop(n, "fly"), p.prop(n, "hoist")}
}

// border reads `border COLOR W`, with an optional side of inside or outside.
func (p *parser) border(n *kdl.Node) (*Edge, bool) {
	args := n.Arguments()
	outside := false
	if len(args) == 3 {
		if args[2].Kind() != kdl.String || (args[2].String() != "inside" && args[2].String() != "outside") {
			p.errf(n, "side must be inside or outside")
			return nil, false
		}
		outside = args[2].String() == "outside"
		args = args[:2]
	}
	return p.edgeArgs(n, args), outside
}

// checkOutside refuses an outside border that can't go around the shape it's given.
func (p *parser) checkOutside(n *kdl.Node, o *Outline, fly, hoist float64, border *Edge, outside bool) {
	if border == nil || !outside || border.Width <= 0 || fly <= 0 || hoist <= 0 {
		return
	}
	shape := rectPoly(0, 0, fly, hoist)
	if o != nil {
		shape = o.points(fly, hoist)
	}
	if shape == nil {
		p.errf(n, "an outside border can't go around a `path` outline")
		return
	}
	if _, err := offsetPolygon(shape, border.Width); err != nil {
		p.errf(n, "%v", err)
	}
}

func (p *parser) edge(n *kdl.Node) *Edge {
	return p.edgeArgs(n, n.Arguments())
}

func (p *parser) edgeArgs(n *kdl.Node, args []kdl.Value) *Edge {
	p.noProps(n)
	p.noChildren(n)
	if len(args) != 2 || args[0].Kind() != kdl.String {
		p.errf(n, "needs a color and a width")
		return nil
	}
	return &Edge{p.paletteColor(n, args[0].String()), p.positive(n, p.numberValue(n, args[1]))}
}

// children dispatches n's children to handlers, rejecting unknown nodes and
// repeats of anything not listed as repeatable.
func (p *parser) children(n *kdl.Node, repeatable []string, handlers map[string]func(*kdl.Node)) {
	seen := map[string]bool{}
	for _, c := range n.Children().Nodes {
		handler, ok := handlers[c.Name()]
		if !ok {
			p.errf(c, "unknown here")
			continue
		}
		if seen[c.Name()] && !slices.Contains(repeatable, c.Name()) {
			p.errf(c, "given more than once")
		}
		seen[c.Name()] = true
		handler(c)
	}
}

func (p *parser) noValues(n *kdl.Node) {
	if len(n.Arguments()) > 0 {
		p.errf(n, "takes no arguments")
	}
	p.noProps(n)
}

func (p *parser) noProps(n *kdl.Node) {
	if len(n.Properties()) > 0 {
		p.errf(n, "takes no properties")
	}
}

func (p *parser) noChildren(n *kdl.Node) {
	if len(n.Children().Nodes) > 0 {
		p.errf(n, "takes no children")
	}
}

// only checks n's argument count and rejects any property not listed.
func (p *parser) only(n *kdl.Node, args int, props ...string) {
	if len(n.Arguments()) != args {
		p.errf(n, "takes %d arguments, got %d", args, len(n.Arguments()))
	}
	for _, key := range n.PropertyOrder() {
		if !slices.Contains(props, key) {
			p.errf(n, "unknown property %q", key)
		}
	}
}

func (p *parser) str(n *kdl.Node) string {
	p.noProps(n)
	p.noChildren(n)
	args := n.Arguments()
	if len(args) != 1 || args[0].Kind() != kdl.String {
		p.errf(n, "needs one string")
		return ""
	}
	return args[0].String()
}

func (p *parser) oneOf(n *kdl.Node, allowed []string) string {
	value := p.str(n)
	if value != "" && !slices.Contains(allowed, value) {
		p.errf(n, "must be one of %v, got %q", allowed, value)
	}
	return value
}

func (p *parser) colorArg(n *kdl.Node) string {
	args := n.Arguments()
	if len(args) != 1 || args[0].Kind() != kdl.String {
		p.errf(n, "needs one color")
		return ""
	}
	return p.paletteColor(n, args[0].String())
}

// gapColorArgs reads a color list that can leave gaps with `none`.
func (p *parser) gapColorArgs(n *kdl.Node) []string {
	args := n.Arguments()
	if len(args) == 0 {
		p.errf(n, "needs at least one color")
	}
	colors := make([]string, 0, len(args))
	for _, a := range args {
		switch {
		case a.Kind() != kdl.String:
			p.errf(n, "colors must be palette names")
		case a.String() == noColor:
			colors = append(colors, noColor)
		default:
			colors = append(colors, p.paletteColor(n, a.String()))
		}
	}
	return colors
}

func (p *parser) colorArgs(n *kdl.Node) []string {
	args := n.Arguments()
	if len(args) == 0 {
		p.errf(n, "needs at least one color")
	}
	colors := make([]string, 0, len(args))
	for _, a := range args {
		if a.Kind() != kdl.String {
			p.errf(n, "colors must be palette names")
			continue
		}
		colors = append(colors, p.paletteColor(n, a.String()))
	}
	return colors
}

func (p *parser) paletteColor(n *kdl.Node, name string) string {
	if _, ok := p.gradients[name]; ok {
		return name
	}
	return p.solidColor(n, name)
}

// solidColor is for the places a gradient has no meaning.
func (p *parser) solidColor(n *kdl.Node, name string) string {
	if _, ok := p.palette[name]; ok {
		return name
	}
	if _, ok := p.gradients[name]; ok {
		p.errf(n, "%q is a gradient, and a solid color is needed here", name)
		return name
	}
	for _, c := range p.gradientNames {
		if c == name {
			p.errf(n, "%q is a gradient, and a solid color is needed here", name)
			return name
		}
	}
	p.errf(n, "color %q isn't in the palette", name)
	return name
}

func (p *parser) numberValue(n *kdl.Node, v kdl.Value) float64 {
	var f float64
	switch v.Kind() {
	case kdl.Int:
		f = float64(v.Int())
	case kdl.Float:
		f = v.Float()
	case kdl.BigFloat:
		// The KDL parser keeps decimal literals at arbitrary precision.
		f, _ = v.BigFloat().Float64()
	default:
		p.errf(n, "needs a number")
		return 0
	}
	if !inLimits(f) {
		p.errf(n, "needs a finite number of a reasonable size")
		return 0
	}
	return f
}

func (p *parser) number(n *kdl.Node) float64 {
	p.noProps(n)
	p.noChildren(n)
	args := n.Arguments()
	if len(args) != 1 {
		p.errf(n, "needs one number")
		return 0
	}
	return p.numberValue(n, args[0])
}

func (p *parser) numbers(n *kdl.Node) []float64 {
	p.noProps(n)
	p.noChildren(n)
	values := make([]float64, 0, len(n.Arguments()))
	for _, a := range n.Arguments() {
		values = append(values, p.numberValue(n, a))
	}
	return values
}

func (p *parser) positives(n *kdl.Node) []float64 {
	values := p.numbers(n)
	for _, v := range values {
		p.positive(n, v)
	}
	return values
}

func (p *parser) positive(n *kdl.Node, v float64) float64 {
	if v <= 0 {
		p.errf(n, "needs a positive number")
	}
	return v
}

func (p *parser) integer(n *kdl.Node, v float64, limit int) int {
	if v != math.Trunc(v) || v < 1 {
		p.errf(n, "needs a positive whole number")
		return 0
	}
	if v > float64(limit) {
		p.errf(n, "can't be more than %d", limit)
		return 0
	}
	return int(v)
}

func (p *parser) prop(n *kdl.Node, key string) float64 {
	v := n.Prop(key)
	if !v.IsValid() {
		p.errf(n, "needs %s=", key)
		return 0
	}
	return p.numberValue(n, v)
}

func (p *parser) boolProp(n *kdl.Node, key string) bool {
	v := n.Prop(key)
	if !v.IsValid() {
		return false
	}
	if v.Kind() != kdl.Bool {
		p.errf(n, "%s must be #true or #false", key)
		return false
	}
	return v.Bool()
}
