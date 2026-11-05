// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"slices"
	"strconv"
	"strings"
)

// DefaultHeight is the pixel height used when Options.Height is 0.
const DefaultHeight = 600

// Options controls SVG output.
type Options struct {
	// Height is the image's height in pixels. Its width follows the proportion.
	Height float64
	// Ratio asks for another proportion, as fly divided by hoist.
	Ratio float64
	// Variant names one of the flag's variants.
	Variant string
	// Side is obverse, the default, or reverse.
	Side string
	// Fit says what happens when a flag can't reach Ratio: error, the default, or
	// pad, which draws it as near as it can and leaves the rest transparent.
	Fit string
	// Align places a padded flag: start, for the left or top; center, the default;
	// or end, for the right or bottom.
	Align string
	// Fold names one of the flag's folds, to render it folded.
	Fold string
	// FoldStep stops a fold after that many steps, or finishes it if that's 0.
	FoldStep int
}

// WriteSVG renders the flag as a standalone SVG document.
func (f *Flag) WriteSVG(w io.Writer, opts Options) error {
	height := opts.Height
	if height == 0 {
		height = DefaultHeight
	}
	original := f
	f, turn, upright, mirror, canvas, err := f.resolve(opts)
	if err != nil {
		return err
	}
	r := &renderer{flag: f, idPrefix: original.idPrefix}
	if opts != (Options{Height: opts.Height}) {
		// A page can show several forms of one flag, which mustn't share definitions.
		sum := sha256.Sum256([]byte(fmt.Sprintf("%v|%s|%s|%s|%s|%s|%d", opts.Ratio, opts.Variant, opts.Side, opts.Fit, opts.Align, opts.Fold, opts.FoldStep)))
		r.idPrefix += hex.EncodeToString(sum[:2]) + "-"
	}
	if opts.Fold != "" {
		fold, ok := f.Folds[opts.Fold]
		if !ok {
			return fmt.Errorf("%s has no fold %q", f.Meta.Name, opts.Fold)
		}
		if turn != "none" {
			return errors.New("a fold can't be applied to a turned variant")
		}
		if err := r.writeFolded(f, fold, opts, height); err != nil {
			return err
		}
		_, err = w.Write(r.out.Bytes())
		return err
	}
	x0, y0, width, tall := 0.0, 0.0, f.Fly, f.Hoist
	var outer []vec
	if f.Border != nil && f.BorderOutside {
		if outer, err = offsetPolygon(f.boundary(), f.Border.Width); err != nil {
			return err
		}
		x0, y0, width, tall = bounds(outer)
	}
	transform, undo := view(turn, x0, y0, width, tall)
	if mirror {
		// The back is the mirror image, then turned as the front would be.
		transform = strings.TrimSpace(transform + fmt.Sprintf(" matrix(-1 0 0 1 %s 0)", num(2*x0+width)))
	}
	vx, vy, vw, vh := x0, y0, width, tall
	if turn != "none" {
		vx, vy, vw, vh = y0, x0, tall, width
	}
	if upright {
		r.upright = undo
	}
	if canvas != 0 {
		// The canvas ratio is the design's, so a turned flag's is the other way up.
		want := canvas
		if turn != "none" {
			want = 1 / canvas
		}
		share := map[string]float64{"start": 0, "end": 1}[opts.Align]
		if opts.Align == "" || opts.Align == "center" {
			share = 0.5
		}
		if vw/vh < want {
			extra := vh*want - vw
			vx -= extra * share
			vw += extra
		} else {
			extra := vw/want - vh
			vy -= extra * share
			vh += extra
		}
	}
	r.line(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s %s %s %s" width="%s" height="%s">`,
		num(vx), num(vy), num(vw), num(vh), num(height*vw/vh), num(height))
	r.depth++
	r.line(`<title>%s</title>`, esc(f.Meta.Name))
	if f.Meta.Description != "" {
		r.line(`<desc>%s</desc>`, esc(f.Meta.Description))
	}
	if transform != "" {
		r.line(`<g transform="%s">`, transform)
		r.depth++
	}

	r.flagArt(f)
	if transform != "" {
		r.depth--
		r.line(`</g>`)
	}
	r.depth--
	r.line(`</svg>`)
	_, err = w.Write(r.out.Bytes())
	return err
}

// flagArt paints a flag's outside border, then everything within its outline.
func (r *renderer) flagArt(f *Flag) {
	if f.Border != nil && f.BorderOutside {
		// Worked out once for its bounds, so this can't fail here.
		outer, _ := offsetPolygon(f.boundary(), f.Border.Width)
		r.geom(geom{poly: outer}, fmt.Sprintf(`fill="%s"`, r.fill(f.Border.Color, nil)))
	}
	root := region{w: f.Fly, h: f.Hoist}
	shape := geom{poly: rectPoly(0, 0, f.Fly, f.Hoist)}
	if f.Outline != nil {
		shape = f.Outline.geom(f.Fly, f.Hoist)
	}
	flagClip := r.id("flag")
	r.line(`<clipPath id="%s">`, flagClip)
	r.depth++
	r.geom(shape, "")
	r.depth--
	r.line(`</clipPath>`)

	r.line(`<g clip-path="url(#%s)">`, flagClip)
	r.depth++
	r.layers(f.Layers, root)
	if f.Border != nil && !f.BorderOutside {
		// Half of the stroke falls outside the outline, and the clip removes it.
		r.geom(shape, fmt.Sprintf(`fill="none" stroke="%s" stroke-width="%s" stroke-linejoin="miter" stroke-miterlimit="10"`,
			r.fill(f.Border.Color, nil), num(2*f.Border.Width)))
	}
	r.depth--
	r.line(`</g>`)
}

func bounds(poly []vec) (x, y, width, height float64) {
	x0, y0, x1, y1 := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for _, p := range poly {
		x0, y0, x1, y1 = min(x0, p.x), min(y0, p.y), max(x1, p.x), max(y1, p.y)
	}
	return x0, y0, x1 - x0, y1 - y0
}

type renderer struct {
	flag      *Flag
	out       bytes.Buffer
	depth     int
	nextID    int
	gradients map[string]string
	// upright is the transform that undoes a turned variant's rotation.
	upright  string
	idPrefix string
}

func (r *renderer) line(format string, args ...any) {
	r.out.WriteString(strings.Repeat("  ", r.depth))
	fmt.Fprintf(&r.out, format, args...)
	r.out.WriteByte('\n')
}

func (r *renderer) color(name string) string { return strings.ToLower(r.flag.Palette[name]) }

// fill is the paint value for a palette name. A gradient spans the box given, or
// the bounding box of each shape it's used on if that's nil.
func (r *renderer) fill(name string, box *[4]float64) string {
	g, isGradient := r.flag.Gradients[name]
	if !isGradient {
		return r.color(name)
	}
	if box == nil {
		if id, ok := r.gradients[name]; ok {
			return "url(#" + id + ")"
		}
	}
	id := r.id("gradient")
	x1, y1, x2, y2 := 0, 0, 1, 0
	switch g.Along {
	case "hoist":
		x2, y2 = 0, 1
	case "bend":
		y2 = 1
	case "bend-sinister":
		y1 = 1
	}
	units := ""
	if box != nil {
		units = fmt.Sprintf(` gradientUnits="userSpaceOnUse" gradientTransform="translate(%s %s) scale(%s %s)"`,
			num(box[0]), num(box[1]), num(box[2]), num(box[3]))
	}
	r.line(`<linearGradient id="%s" x1="%d" y1="%d" x2="%d" y2="%d"%s>`, id, x1, y1, x2, y2, units)
	r.depth++
	for i, c := range g.Colors {
		r.line(`<stop offset="%s" stop-color="%s"/>`, num(g.Stops[i]), r.color(c))
	}
	r.depth--
	r.line(`</linearGradient>`)
	if box == nil {
		if r.gradients == nil {
			r.gradients = map[string]string{}
		}
		r.gradients[name] = id
	}
	return "url(#" + id + ")"
}

func (r *renderer) id(kind string) string {
	r.nextID++
	return fmt.Sprintf("%s%s%d", r.idPrefix, kind, r.nextID)
}

func (r *renderer) layers(layers []Layer, reg region) {
	for _, l := range layers {
		r.layer(l, reg)
	}
}

func (r *renderer) layer(l Layer, reg region) {
	attrs, style := r.effects(l.effects(), reg)
	if _, isGroup := l.(*Group); isGroup {
		// A group composites as a unit, so its children blend only with each other.
		style = append(style, "isolation:isolate")
	}
	if len(style) > 0 {
		attrs = append(attrs, fmt.Sprintf(`style="%s"`, strings.Join(style, ";")))
	}
	if len(attrs) > 0 {
		r.line(`<g %s>`, strings.Join(attrs, " "))
		r.depth++
		defer func() {
			r.depth--
			r.line(`</g>`)
		}()
	}
	r.content(l, reg)
}

// effects writes any clip and mask a layer needs, and returns its attributes.
func (r *renderer) effects(e *Effects, reg region) (attrs, style []string) {
	if e.Opacity != 1 {
		attrs = append(attrs, fmt.Sprintf(`opacity="%s"`, num(e.Opacity)))
	}
	if e.Blend != "normal" {
		style = append(style, "mix-blend-mode:"+e.Blend)
	}
	if e.Clip != nil {
		id := r.id("clip")
		r.line(`<clipPath id="%s">`, id)
		r.depth++
		clip := e.Clip.forRegion(reg)
		r.geom(shapeGeom(clip, position(clip, reg), 0), "")
		r.depth--
		r.line(`</clipPath>`)
		attrs = append(attrs, fmt.Sprintf(`clip-path="url(#%s)"`, id))
	}
	if len(e.Cuts) > 0 {
		id := r.id("mask")
		x, y, w, h := reg.bounds()
		r.line(`<mask id="%s" maskUnits="userSpaceOnUse" x="%s" y="%s" width="%s" height="%s">`, id, num(x), num(y), num(w), num(h))
		r.depth++
		r.geom(geom{poly: rectPoly(x, y, x+w, y+h)}, `fill="#fff"`)
		for i := range e.Cuts {
			cut := e.Cuts[i].forRegion(reg)
			r.geom(shapeGeom(cut, position(cut, reg), 0), `fill="#000"`)
		}
		r.depth--
		r.line(`</mask>`)
		attrs = append(attrs, fmt.Sprintf(`mask="url(#%s)"`, id))
	}
	return attrs, style
}

func (r *renderer) content(l Layer, reg region) {
	switch l := l.(type) {
	case *Field:
		r.paint(l.Color, nil, nil, nil, []geom{{poly: rectPoly(0, 0, reg.w, reg.h)}})
	case *Bars:
		hasGap := slices.Contains(l.Colors, noColor)
		exact := func(i int) bool {
			_, isGradient := r.flag.Gradients[l.Colors[i]]
			return isGradient || hasGap
		}
		for i, poly := range barPolys(l, reg, exact) {
			if len(poly) > 0 {
				r.paint(l.Colors[i], nil, nil, nil, []geom{{poly: poly}})
			}
		}
	case *Chevrons:
		nested, bands := rawChevrons(l, reg)
		polys := chevronPolys(l, reg)
		if slices.Contains(l.Colors, noColor) {
			// A gap has to show what's beneath, so each band stands alone.
			polys = bands
		}
		if l.Fimbriate != nil {
			r.paint(l.Colors[len(polys)-1], nil, l.Fimbriate, []geom{{poly: nested[0]}}, nil)
		}
		for i, poly := range polys {
			if len(poly) > 0 {
				r.paint(l.Colors[len(polys)-1-i], nil, nil, nil, []geom{{poly: poly}})
			}
		}
	case *Band:
		// The fimbriation's stroke mustn't follow the region's edge, so it uses the
		// band's unclipped shape. A clipped polygon can be empty.
		stroke := []geom{{poly: bandPoly(reg, l.Along, l.Rotate, l.Width, l.Offset, true)}}
		if poly := bandPoly(reg, l.Along, l.Rotate, l.Width, l.Offset, false); len(poly) > 0 {
			r.paint(l.Color, nil, l.Fimbriate, stroke, []geom{{poly: poly}})
		} else {
			r.paint(l.Color, nil, l.Fimbriate, stroke, nil)
		}
	case *Cross:
		// A gradient spans a cross as one shape, so it's given the whole region.
		box := &[4]float64{0, 0, reg.w, reg.h}
		var stroke []geom
		if l.Fimbriate != nil {
			// Keep the arms' ends, and their stroke, beyond the region's edge.
			polys := crossPolys(l, reg, l.Fimbriate.Width*2)
			stroke = []geom{{poly: polys[0]}, {poly: polys[1]}}
		}
		polys := crossPolys(l, reg, 0)
		r.paint(l.Color, box, l.Fimbriate, stroke, []geom{{poly: polys[0]}, {poly: polys[1]}})
	case *Quarters:
		r.quarters(l, reg)
	case *Checks:
		r.checks(l, reg)
	case *Rays:
		polys := rayPolys(l, reg)
		if l.Colors[0] != noColor && !slices.Contains(l.Colors, noColor) {
			// Beneath the wedges, so that antialiasing can't leave seams between them.
			r.paint(l.Colors[0], nil, nil, nil, []geom{{poly: rectPoly(0, 0, reg.w, reg.h)}})
		}
		for i, poly := range polys {
			if len(poly) > 0 {
				r.paint(l.Colors[i], nil, nil, nil, []geom{{poly: poly}})
			}
		}
	case *Saltire:
		if l.Counterchange {
			r.counterchange(l, reg)
			return
		}
		box := &[4]float64{0, 0, reg.w, reg.h}
		var stroke []geom
		if l.Fimbriate != nil {
			stroke = []geom{
				{poly: bandPoly(reg, "bend", 0, l.Width, 0, true)},
				{poly: bandPoly(reg, "bend-sinister", 0, l.Width, 0, true)},
			}
		}
		r.paint(l.Color, box, l.Fimbriate, stroke, []geom{
			{poly: bandPoly(reg, "bend", 0, l.Width, 0, false)},
			{poly: bandPoly(reg, "bend-sinister", 0, l.Width, 0, false)},
		})
	case *Charge:
		r.charge(l, reg)
	case *Emblem:
		r.emblem(l, reg)
	case *Group:
		r.layers(l.Layers, reg)
	case *Panel:
		r.panel(l, reg)
	case *Use:
		if l.Define.Fly == 0 {
			r.layers(l.Define.Layers, reg)
			return
		}
		// A design with its own grid is scaled to fill the region it's used in.
		r.line(`<g transform="scale(%s %s)">`, num(reg.w/l.Define.Fly), num(reg.h/l.Define.Hoist))
		r.depth++
		r.layers(l.Define.Layers, region{w: l.Define.Fly, h: l.Define.Hoist})
		r.depth--
		r.line(`</g>`)
	}
}

func (r *renderer) panel(p *Panel, reg region) {
	x, y, w, h := panelRect(p, reg)
	shape := geom{poly: rectPoly(0, 0, w, h)}
	if p.Line != nil {
		shape = geom{poly: panelEdge(p, w, h)}
	}
	id := r.id("panel")
	r.line(`<clipPath id="%s">`, id)
	r.depth++
	r.geom(shape, "")
	r.depth--
	r.line(`</clipPath>`)
	r.line(`<g transform="translate(%s %s)" clip-path="url(#%s)" style="isolation:isolate">`, num(x), num(y), id)
	r.depth++
	r.layers(p.Layers, region{w: w, h: h})
	r.depth--
	r.line(`</g>`)
}

func (r *renderer) quarters(q *Quarters, reg region) {
	c := reg.center()
	if q.Diagonal {
		corners := reg.corners()
		for i, color := range q.Colors {
			r.paint(color, nil, nil, nil, []geom{{poly: []vec{c, corners[i], corners[(i+1)%4]}}})
		}
		return
	}
	if q.Split != nil {
		c = vec{q.Split.Fly, q.Split.Hoist}
	}
	if slices.Contains(q.Colors[:], noColor) {
		r.paint(q.Colors[0], nil, nil, nil, []geom{{poly: rectPoly(0, 0, c.x, c.y)}})
		r.paint(q.Colors[1], nil, nil, nil, []geom{{poly: rectPoly(c.x, 0, reg.w, c.y)}})
		r.paint(q.Colors[2], nil, nil, nil, []geom{{poly: rectPoly(0, c.y, c.x, reg.h)}})
	} else {
		// Each runs on beneath the next, so antialiasing can't leave a seam.
		r.paint(q.Colors[0], nil, nil, nil, []geom{{poly: rectPoly(0, 0, reg.w, reg.h)}})
		r.paint(q.Colors[1], nil, nil, nil, []geom{{poly: rectPoly(c.x, 0, reg.w, reg.h)}})
		r.paint(q.Colors[2], nil, nil, nil, []geom{{poly: rectPoly(0, c.y, reg.w, reg.h)}})
	}
	r.paint(q.Colors[3], nil, nil, nil, []geom{{poly: rectPoly(c.x, c.y, reg.w, reg.h)}})
}

func (r *renderer) checks(ch *Checks, reg region) {
	n := len(ch.Colors)
	cellW, cellH := reg.w/float64(ch.Columns), reg.h/float64(ch.Rows)
	for row := range ch.Rows {
		for col := range ch.Columns {
			i := row + col
			if ch.Flow == "bend" {
				i = col - row + ch.Rows*n
			}
			x, y := float64(col)*cellW, float64(row)*cellH
			// Each cell runs on beneath the next ones, unless gaps have to show.
			right, bottom := reg.w, reg.h
			if slices.Contains(ch.Colors, noColor) {
				right, bottom = x+cellW, y+cellH
			}
			r.paint(ch.Colors[i%n], nil, nil, nil, []geom{{poly: rectPoly(x, y, right, bottom)}})
		}
	}
}

// counterchange paints a saltire twice its width, clipped to four triangles around
// the center, so that one side of each diagonal shows.
func (r *renderer) counterchange(l *Saltire, reg region) {
	c := reg.center()
	id := r.id("clip")
	r.line(`<clipPath id="%s">`, id)
	r.depth++
	r.geom(geom{poly: []vec{
		c, {reg.w, c.y}, {reg.w, reg.h},
		c, {c.x, reg.h}, {0, reg.h},
		c, {0, c.y}, {0, 0},
		c, {c.x, 0}, {reg.w, 0},
	}}, "")
	r.depth--
	r.line(`</clipPath>`)
	r.line(`<g clip-path="url(#%s)">`, id)
	r.depth++
	box := &[4]float64{0, 0, reg.w, reg.h}
	r.paint(l.Color, box, nil, nil, []geom{
		{poly: bandPoly(reg, "bend", 0, 2*l.Width, 0, false)},
		{poly: bandPoly(reg, "bend-sinister", 0, 2*l.Width, 0, false)},
	})
	r.depth--
	r.line(`</g>`)
}

func (r *renderer) emblem(e *Emblem, reg region) {
	at := reg.center()
	if e.At != nil {
		at = vec{e.At.Fly, e.At.Hoist}
	}
	angle := e.Rotate
	if e.Along != "" {
		dir, _ := axis(reg, e.Along, 0)
		angle += math.Atan2(dir.y, dir.x) * 180 / math.Pi
	}
	// Painting is still clipped to the region, so the frame only has to reach
	// the region's farthest corner.
	reach := 0.0
	for _, corner := range reg.corners() {
		reach = max(reach, math.Hypot(corner.x-at.x, corner.y-at.y))
	}
	r.keepUpright(at, func() {
		r.line(`<g transform="translate(%s %s) rotate(%s)">`, num(at.x), num(at.y), num(angle))
		r.depth++
		// Charges in an emblem turn with it, so they aren't each kept upright as well.
		upright := r.upright
		r.upright = ""
		for _, c := range e.Charges {
			r.layer(c, region{local: reach})
		}
		r.upright = upright
		r.depth--
		r.line(`</g>`)
	})
}

func (r *renderer) charge(c *Charge, reg region) {
	s := c.Shape.forRegion(reg)
	at := position(s, reg)
	if s.Kind == "svg" {
		r.keepUpright(at, func() { r.embedded(c, at) })
		return
	}
	var copies []geom
	var centers []vec
	add := func(center vec, turn float64) {
		copies = append(copies, shapeGeom(s, center, turn))
		centers = append(centers, center)
	}
	switch {
	case len(s.Ats) > 1:
		for _, p := range s.Ats {
			if p == nil {
				add(reg.center(), 0)
			} else {
				add(vec{p.Fly, p.Hoist}, 0)
			}
		}
	case c.Repeat == nil:
		add(at, 0)
	case c.Repeat.Kind == "ring":
		for i := range c.Repeat.Count {
			a := float64(i) * 360 / float64(c.Repeat.Count)
			turn := 0.0
			if c.Repeat.Turn {
				turn = a
			}
			add(at.add(vec{0, -c.Repeat.Radius}.rotate(a)), turn)
		}
	case c.Repeat.Kind == "arc":
		for i := range c.Repeat.Count {
			a := c.Repeat.From + (c.Repeat.To-c.Repeat.From)*float64(i)/float64(c.Repeat.Count-1)
			turn := 0.0
			if c.Repeat.Turn {
				turn = a
			}
			add(at.add(vec{0, -c.Repeat.Radius}.rotate(a)), turn)
		}
	case c.Repeat.Kind == "line":
		for i := range c.Repeat.Count {
			add(at.add(vec{c.Repeat.Fly, c.Repeat.Hoist}.mul(float64(i))), 0)
		}
	default:
		for row := 1; row <= c.Repeat.Rows; row++ {
			for col := 1; col <= c.Repeat.Columns; col++ {
				if c.Repeat.Stagger && (row+col)%2 == 1 {
					continue
				}
				add(vec{
					reg.w * float64(col) / float64(c.Repeat.Columns+1),
					reg.h * float64(row) / float64(c.Repeat.Rows+1),
				}, 0)
			}
		}
	}
	draw := func(shapes []geom) {
		switch {
		case s.Hollow > 0:
			r.outlineOnly(c.Color, s.Hollow, shapes)
		case s.Lines > 0:
			r.outlineOnly(c.Color, s.Lines, shapes)
		default:
			r.paint(c.Color, nil, c.Fimbriate, shapes, shapes)
		}
	}
	if r.upright == "" || s.Kind == "polygon" {
		draw(copies)
		return
	}
	for i := range copies {
		r.keepUpright(centers[i], func() { draw(copies[i : i+1]) })
	}
}

// keepUpright undoes a turned variant's rotation around a point, if there is one.
func (r *renderer) keepUpright(at vec, draw func()) {
	if r.upright == "" {
		draw()
		return
	}
	r.line(`<g transform="translate(%s %s) %s translate(%s %s)">`, num(at.x), num(at.y), r.upright, num(-at.x), num(-at.y))
	r.depth++
	draw()
	r.depth--
	r.line(`</g>`)
}

func (r *renderer) outlineOnly(color string, width float64, shapes []geom) {
	if color == noColor {
		return
	}
	stroke := r.fill(color, nil)
	for _, g := range shapes {
		r.geom(g, fmt.Sprintf(`fill="none" stroke="%s" stroke-width="%s" stroke-linejoin="miter" stroke-miterlimit="10"`,
			stroke, num(width/g.strokeScale())))
	}
}

func (g geom) strokeScale() float64 {
	if g.scale > 0 {
		return g.scale
	}
	return 1
}

func (r *renderer) embedded(c *Charge, at vec) {
	s := &c.Shape
	var attrs []string
	if c.Color != "" {
		attrs = append(attrs, fmt.Sprintf(`color="%s"`, r.color(c.Color)))
	}
	if s.Rotate != 0 {
		attrs = append(attrs, fmt.Sprintf(`transform="rotate(%s %s %s)"`, num(s.Rotate), num(at.x), num(at.y)))
	}
	if len(attrs) > 0 {
		r.line(`<g %s>`, strings.Join(attrs, " "))
		r.depth++
		defer func() {
			r.depth--
			r.line(`</g>`)
		}()
	}
	r.line(`<svg x="%s" y="%s" width="%s" height="%s" viewBox="%s" preserveAspectRatio="xMidYMid meet"%s>%s</svg>`,
		num(at.x-s.Fly/2), num(at.y-s.Hoist/2), num(s.Fly), num(s.Hoist),
		s.embedded.viewBox, s.embedded.attrs, s.embedded.body)
}

// paint fills shapes, after painting any fimbriation beneath all of them. Each
// shape's stroke lies beneath the others' fills, so arms read as a single shape.
// A gradient spans box, or each shape's own bounds if box is nil.
func (r *renderer) paint(color string, box *[4]float64, fimbriate *Edge, stroke, shapes []geom) {
	if fimbriate != nil {
		edge := r.fill(fimbriate.Color, box)
		for _, g := range stroke {
			r.geom(g, fmt.Sprintf(`fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="miter" stroke-miterlimit="10"`,
				edge, edge, num(2*fimbriate.Width/g.strokeScale())))
		}
	}
	if len(shapes) == 0 || color == noColor {
		return
	}
	fill := r.fill(color, box)
	for _, g := range shapes {
		r.geom(g, fmt.Sprintf(`fill="%s"`, fill))
	}
}

func (r *renderer) geom(g geom, attrs string) {
	if attrs != "" {
		attrs = " " + attrs
	}
	if g.transform != "" {
		attrs += fmt.Sprintf(` transform="%s"`, g.transform)
	}
	if g.evenodd {
		attrs += ` fill-rule="evenodd"`
	}
	switch {
	case g.path != "":
		r.line(`<path d="%s"%s/>`, g.path, attrs)
	case g.circle:
		r.line(`<circle cx="%s" cy="%s" r="%s"%s/>`, num(g.c.x), num(g.c.y), num(g.r), attrs)
	case g.ring:
		r.line(`<path fill-rule="evenodd" d="%s %s"%s/>`, circlePath(g.c, g.r), circlePath(g.c, g.inner), attrs)
	default:
		var points strings.Builder
		for i, p := range g.poly {
			if i > 0 {
				points.WriteByte(' ')
			}
			points.WriteString(num(p.x) + "," + num(p.y))
		}
		r.line(`<polygon points="%s"%s/>`, points.String(), attrs)
	}
}

func circlePath(c vec, radius float64) string {
	rs := num(radius)
	return fmt.Sprintf("M%s %sA%s %s 0 1 0 %s %sA%s %s 0 1 0 %s %sZ",
		num(c.x-radius), num(c.y), rs, rs, num(c.x+radius), num(c.y), rs, rs, num(c.x-radius), num(c.y))
}

// ellipsePath draws an ellipse with the given half sizes, turned clockwise by a rotation.
func ellipsePath(c vec, x, y, rotation float64) string {
	a, b := c.sub(vec{x, 0}.rotate(rotation)), c.add(vec{x, 0}.rotate(rotation))
	arc := fmt.Sprintf("A%s %s %s 1 0", num(x), num(y), num(rotation))
	return fmt.Sprintf("M%s %s%s %s %s%s %s %sZ", num(a.x), num(a.y), arc, num(b.x), num(b.y), arc, num(a.x), num(a.y))
}

// num formats a coordinate to a fixed precision, so output is stable across
// platforms and free of floating-point noise.
func num(v float64) string {
	v = math.Round(v*1e6) / 1e6
	if v == 0 {
		return "0"
	}
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func esc(s string) string {
	var b strings.Builder
	// Writing to a strings.Builder can't fail.
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}
