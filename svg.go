// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
)

// DefaultHeight is the pixel height used when Options.Height is 0.
const DefaultHeight = 600

// Options controls SVG output.
type Options struct {
	// Height is the image's height in pixels. Its width follows the proportion.
	Height float64
}

// WriteSVG renders the flag as a standalone SVG document.
func (f *Flag) WriteSVG(w io.Writer, opts Options) error {
	height := opts.Height
	if height == 0 {
		height = DefaultHeight
	}
	r := &renderer{flag: f}
	x0, y0, width, tall := 0.0, 0.0, f.Fly, f.Hoist
	var outer []vec
	if f.Border != nil && f.BorderOutside {
		var err error
		if outer, err = offsetPolygon(f.boundary(), f.Border.Width); err != nil {
			return err
		}
		x0, y0, width, tall = bounds(outer)
	}
	r.line(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s %s %s %s" width="%s" height="%s">`,
		num(x0), num(y0), num(width), num(tall), num(height*width/tall), num(height))
	r.depth++
	r.line(`<title>%s</title>`, esc(f.Meta.Name))
	if f.Meta.Description != "" {
		r.line(`<desc>%s</desc>`, esc(f.Meta.Description))
	}

	if outer != nil {
		r.geom(geom{poly: outer}, fmt.Sprintf(`fill="%s"`, r.color(f.Border.Color)))
	}
	root := region{f.Fly, f.Hoist}
	shape := geom{poly: rectPoly(0, 0, f.Fly, f.Hoist)}
	if f.Outline != nil {
		s := Shape{Kind: "polygon", Vertices: f.Outline}
		shape = shapeGeom(&s, vec{}, 0)
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
			r.color(f.Border.Color), num(2*f.Border.Width)))
	}
	r.depth--
	r.line(`</g>`)
	r.depth--
	r.line(`</svg>`)
	_, err := w.Write(r.out.Bytes())
	return err
}

func bounds(poly []vec) (x, y, width, height float64) {
	x0, y0, x1, y1 := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for _, p := range poly {
		x0, y0, x1, y1 = min(x0, p.x), min(y0, p.y), max(x1, p.x), max(y1, p.y)
	}
	return x0, y0, x1 - x0, y1 - y0
}

type renderer struct {
	flag   *Flag
	out    bytes.Buffer
	depth  int
	nextID int
}

func (r *renderer) line(format string, args ...any) {
	r.out.WriteString(strings.Repeat("  ", r.depth))
	fmt.Fprintf(&r.out, format, args...)
	r.out.WriteByte('\n')
}

func (r *renderer) color(name string) string { return strings.ToLower(r.flag.Palette[name]) }

func (r *renderer) id(kind string) string {
	r.nextID++
	return fmt.Sprintf("%s%s%d", r.flag.idPrefix, kind, r.nextID)
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
		r.geom(shapeGeom(e.Clip, position(e.Clip, reg), 0), "")
		r.depth--
		r.line(`</clipPath>`)
		attrs = append(attrs, fmt.Sprintf(`clip-path="url(#%s)"`, id))
	}
	if len(e.Cuts) > 0 {
		id := r.id("mask")
		r.line(`<mask id="%s" maskUnits="userSpaceOnUse" x="0" y="0" width="%s" height="%s">`, id, num(reg.w), num(reg.h))
		r.depth++
		r.geom(geom{poly: rectPoly(0, 0, reg.w, reg.h)}, `fill="#fff"`)
		for i := range e.Cuts {
			r.geom(shapeGeom(&e.Cuts[i], position(&e.Cuts[i], reg), 0), `fill="#000"`)
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
		r.paint(l.Color, nil, []geom{{poly: rectPoly(0, 0, reg.w, reg.h)}})
	case *Bars:
		for i, poly := range barPolys(l, reg) {
			r.paint(l.Colors[i], nil, []geom{{poly: poly}})
		}
	case *Chevrons:
		polys := chevronPolys(l, reg)
		for i, poly := range polys {
			r.paint(l.Colors[len(polys)-1-i], nil, []geom{{poly: poly}})
		}
	case *Band:
		poly := bandPoly(reg, l.Along, l.Rotate, l.Width, l.Offset, l.Fimbriate != nil)
		r.paint(l.Color, l.Fimbriate, []geom{{poly: poly}})
	case *Cross:
		polys := crossPolys(l, reg)
		r.paint(l.Color, l.Fimbriate, []geom{{poly: polys[0]}, {poly: polys[1]}})
	case *Saltire:
		stroked := l.Fimbriate != nil
		r.paint(l.Color, l.Fimbriate, []geom{
			{poly: bandPoly(reg, "bend", 0, l.Width, 0, stroked)},
			{poly: bandPoly(reg, "bend-sinister", 0, l.Width, 0, stroked)},
		})
	case *Charge:
		r.charge(l, reg)
	case *Group:
		r.layers(l.Layers, reg)
	case *Canton:
		id := r.id("canton")
		r.line(`<clipPath id="%s">`, id)
		r.depth++
		r.geom(geom{poly: rectPoly(0, 0, l.Fly, l.Hoist)}, "")
		r.depth--
		r.line(`</clipPath>`)
		r.line(`<g clip-path="url(#%s)" style="isolation:isolate">`, id)
		r.depth++
		r.layers(l.Layers, region{l.Fly, l.Hoist})
		r.depth--
		r.line(`</g>`)
	}
}

func (r *renderer) charge(c *Charge, reg region) {
	s := &c.Shape
	at := position(s, reg)
	if s.Kind == "svg" {
		r.embedded(s, at)
		return
	}
	var copies []geom
	switch {
	case c.Repeat == nil:
		copies = []geom{shapeGeom(s, at, 0)}
	case c.Repeat.Kind == "ring":
		for i := range c.Repeat.Count {
			a := float64(i) * 360 / float64(c.Repeat.Count)
			turn := 0.0
			if c.Repeat.Turn {
				turn = a
			}
			copies = append(copies, shapeGeom(s, at.add(vec{0, -c.Repeat.Radius}.rotate(a)), turn))
		}
	default:
		for row := 1; row <= c.Repeat.Rows; row++ {
			for col := 1; col <= c.Repeat.Columns; col++ {
				if c.Repeat.Stagger && (row+col)%2 == 1 {
					continue
				}
				copies = append(copies, shapeGeom(s, vec{
					reg.w * float64(col) / float64(c.Repeat.Columns+1),
					reg.h * float64(row) / float64(c.Repeat.Rows+1),
				}, 0))
			}
		}
	}
	r.paint(c.Color, c.Fimbriate, copies)
}

func (r *renderer) embedded(s *Shape, at vec) {
	if s.Rotate != 0 {
		r.line(`<g transform="rotate(%s %s %s)">`, num(s.Rotate), num(at.x), num(at.y))
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
func (r *renderer) paint(color string, fimbriate *Edge, shapes []geom) {
	if fimbriate != nil {
		edge := r.color(fimbriate.Color)
		for _, g := range shapes {
			r.geom(g, fmt.Sprintf(`fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="miter" stroke-miterlimit="10"`,
				edge, edge, num(2*fimbriate.Width)))
		}
	}
	for _, g := range shapes {
		r.geom(g, fmt.Sprintf(`fill="%s"`, r.color(color)))
	}
}

func (r *renderer) geom(g geom, attrs string) {
	if attrs != "" {
		attrs = " " + attrs
	}
	switch {
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
