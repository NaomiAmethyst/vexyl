// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"fmt"
	"slices"
)

// Fold is a sequence of flat folds, for storage or ceremony.
type Fold struct {
	Description string
	Sources     []string
	Steps       []FoldStep
}

// FoldStep folds everything on one side of a line, over the rest, behind it, or
// away out of sight.
type FoldStep struct {
	// Kind is over, under or tuck.
	Kind string
	// A and B are two points on the crease, in the folded flag's current position.
	A, B Point
	// Moving is a point on the side that moves.
	Moving Point
}

// matrix maps (x, y) to (a*x + c*y + e, b*x + d*y + f), as SVG writes it.
type matrix struct{ a, b, c, d, e, f float64 }

func (m matrix) apply(p vec) vec {
	return vec{m.a*p.x + m.c*p.y + m.e, m.b*p.x + m.d*p.y + m.f}
}

// then returns the transform that applies m, followed by n.
func (m matrix) then(n matrix) matrix {
	return matrix{
		n.a*m.a + n.c*m.b, n.b*m.a + n.d*m.b,
		n.a*m.c + n.c*m.d, n.b*m.c + n.d*m.d,
		n.a*m.e + n.c*m.f + n.e, n.b*m.e + n.d*m.f + n.f,
	}
}

// reflection reflects across the line through a and b.
func reflection(a, b vec) matrix {
	d := b.sub(a)
	l := d.dot(d)
	cos, sin := (d.x*d.x-d.y*d.y)/l, 2*d.x*d.y/l
	return matrix{cos, sin, sin, -cos, a.x - cos*a.x - sin*a.y, a.y - sin*a.x + cos*a.y}
}

// facet is a flat piece of the folded flag. Its polygon is where it now lies, and
// its transform takes the flag's coordinates there. Facets are kept from back to
// front, and flipped ones show the flag's other side.
type facet struct {
	poly    []vec
	place   matrix
	flipped bool
}

// halfPlane keeps the part of a polygon on one side of a line.
func halfPlane(poly []vec, a, b vec, side float64) []vec {
	d := b.sub(a)
	value := func(p vec) float64 { return side * (d.x*(p.y-a.y) - d.y*(p.x-a.x)) }
	var out []vec
	for i, cur := range poly {
		prev := poly[(i+len(poly)-1)%len(poly)]
		vc, vp := value(cur), value(prev)
		if (vc >= 0) != (vp >= 0) {
			out = append(out, prev.add(cur.sub(prev).mul(vp/(vp-vc))))
		}
		if vc >= 0 {
			out = append(out, cur)
		}
	}
	return out
}

func polyArea(poly []vec) float64 {
	sum := 0.0
	for i, p := range poly {
		q := poly[(i+1)%len(poly)]
		sum += p.x*q.y - q.x*p.y
	}
	if sum < 0 {
		sum = -sum
	}
	return sum / 2
}

// foldFacets folds a flat shape through a number of steps, or all of them if steps
// is 0, which reading a document does to check them.
func foldFacets(shape []vec, fold *Fold, steps int) ([]facet, error) {
	stack := []facet{{poly: shape, place: matrix{a: 1, d: 1}}}
	limit := polyArea(shape) * 1e-9
	for i, step := range fold.Steps {
		if steps > 0 && i == steps {
			break
		}
		a, b, moving := vec{step.A.Fly, step.A.Hoist}, vec{step.B.Fly, step.B.Hoist}, vec{step.Moving.Fly, step.Moving.Hoist}
		d := b.sub(a)
		side := d.x*(moving.y-a.y) - d.y*(moving.x-a.x)
		if side == 0 || d.dot(d) == 0 {
			return nil, fmt.Errorf("fold step %d: its point to move is on its crease", i+1)
		}
		if side < 0 {
			side = -1
		} else {
			side = 1
		}
		mirror := reflection(a, b)
		var kept, moved []facet
		for _, f := range stack {
			if part := halfPlane(f.poly, a, b, -side); polyArea(part) > limit {
				kept = append(kept, facet{part, f.place, f.flipped})
			}
			if part := halfPlane(f.poly, a, b, side); polyArea(part) > limit {
				reflected := make([]vec, len(part))
				for j, p := range part {
					reflected[j] = mirror.apply(p)
				}
				moved = append(moved, facet{reflected, f.place.then(mirror), !f.flipped})
			}
		}
		if len(moved) == 0 {
			return nil, fmt.Errorf("fold step %d: nothing is on the side it moves", i+1)
		}
		if len(kept) == 0 {
			return nil, fmt.Errorf("fold step %d: nothing is left on the other side of its crease", i+1)
		}
		if len(kept)+len(moved) > maxFacets {
			return nil, fmt.Errorf("fold step %d: makes more than %d pieces", i+1, maxFacets)
		}
		// Whichever way it goes, the moving stack lands in reverse order.
		slices.Reverse(moved)
		switch step.Kind {
		case "over":
			stack = append(kept, moved...)
		case "under":
			stack = append(moved, kept...)
		default:
			// A tuck goes inside the fold, out of sight.
			stack = kept
		}
	}
	return stack, nil
}

// foldShape is the flat shape a flag folds as, including an outside border.
func (f *Flag) foldShape() ([]vec, error) {
	shape := f.boundary()
	if shape == nil {
		// A curved outline folds as its rectangle, with the flag's own clip inside.
		shape = rectPoly(0, 0, f.Fly, f.Hoist)
	}
	if f.Border != nil && f.BorderOutside {
		outer, err := offsetPolygon(shape, f.Border.Width)
		if err != nil {
			return nil, err
		}
		return outer, nil
	}
	return shape, nil
}

// writeFolded renders a flag in a folded position.
func (r *renderer) writeFolded(f *Flag, fold *Fold, opts Options, height float64) error {
	shape, err := f.foldShape()
	if err != nil {
		return err
	}
	steps := 0
	if opts.FoldStep != nil {
		steps = *opts.FoldStep
	}
	stack, err := foldFacets(shape, fold, steps)
	if err != nil {
		return err
	}
	var all []vec
	for _, facet := range stack {
		all = append(all, facet.poly...)
	}
	x, y, w, h := bounds(all)
	r.line(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s %s %s %s" width="%s" height="%s">`,
		num(x), num(y), num(w), num(h), num(height*w/h), num(height))
	r.depth++
	r.line(`<title>%s</title>`, esc(f.Meta.Name))
	r.line(`<defs>`)
	r.depth++
	front := r.id("front")
	r.line(`<g id="%s">`, front)
	r.depth++
	r.flagArt(f)
	r.depth--
	r.line(`</g>`)
	back := ""
	if f.Reverse != nil {
		back = r.id("back")
		reverse := *f
		reverse.Layers = f.Reverse.Layers
		r.line(`<g id="%s">`, back)
		r.depth++
		r.flagArt(&reverse)
		r.depth--
		r.line(`</g>`)
	}
	r.depth--
	r.line(`</defs>`)
	// A crease line reads at any scale, without hiding the design.
	crease := fmt.Sprintf(`fill="none" stroke="#000" stroke-opacity="0.35" stroke-linejoin="round" stroke-width="%s"`, num(max(w, h)*0.004))
	for _, fc := range stack {
		id := r.id("facet")
		r.line(`<clipPath id="%s">`, id)
		r.depth++
		r.geom(geom{poly: fc.poly}, "")
		r.depth--
		r.line(`</clipPath>`)
		art, place := front, fc.place
		if fc.flipped && back != "" {
			// A separate back is written as seen from that side, so it mirrors back.
			art = back
			place = matrix{-1, 0, 0, 1, f.Fly, 0}.then(fc.place)
		}
		r.line(`<g clip-path="url(#%s)"><use href="#%s" transform="matrix(%s %s %s %s %s %s)"/></g>`, id, art,
			num(place.a), num(place.b), num(place.c), num(place.d), num(place.e), num(place.f))
		r.geom(geom{poly: fc.poly}, crease)
	}
	r.depth--
	r.line(`</svg>`)
	return nil
}
