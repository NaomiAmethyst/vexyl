// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"errors"
	"fmt"
	"math"
	"slices"
)

type vec struct{ x, y float64 }

func (a vec) add(b vec) vec     { return vec{a.x + b.x, a.y + b.y} }
func (a vec) sub(b vec) vec     { return vec{a.x - b.x, a.y - b.y} }
func (a vec) mul(k float64) vec { return vec{a.x * k, a.y * k} }
func (a vec) dot(b vec) float64 { return a.x*b.x + a.y*b.y }
func (a vec) rotate(deg float64) vec {
	s, c := math.Sincos(deg * math.Pi / 180)
	return vec{a.x*c - a.y*s, a.x*s + a.y*c}
}

// region is a rectangle with its origin at the current coordinate origin. An
// emblem's frame has no size, and its center is its origin; local is then how far
// its content could need to reach to cover everything visible.
type region struct {
	w, h  float64
	local float64
}

// bounds is the rectangle a mask has to cover.
func (r region) bounds() (x, y, w, h float64) {
	if r.local > 0 {
		return -r.local, -r.local, 2 * r.local, 2 * r.local
	}
	return 0, 0, r.w, r.h
}

func (r region) center() vec     { return vec{r.w / 2, r.h / 2} }
func (r region) reach() float64  { return math.Hypot(r.w, r.h) }
func (r region) corners() [4]vec { return [4]vec{{0, 0}, {r.w, 0}, {r.w, r.h}, {0, r.h}} }

func rectPoly(x0, y0, x1, y1 float64) []vec {
	return []vec{{x0, y0}, {x1, y0}, {x1, y1}, {x0, y1}}
}

// boundary is the flag's shape before any outside border.
func (f *Flag) boundary() []vec {
	if f.Outline == nil {
		return rectPoly(0, 0, f.Fly, f.Hoist)
	}
	return f.Outline.points(f.Fly, f.Hoist)
}

// offsetPolygon moves a polygon's edges outward by a distance, keeping its
// angles mitered. It fails on polygons with no area, repeated points or edges
// that fold back on themselves, where outward has no meaning.
func offsetPolygon(poly []vec, distance float64) ([]vec, error) {
	area := 0.0
	for i, p := range poly {
		q := poly[(i+1)%len(poly)]
		area += p.x*q.y - q.x*p.y
	}
	if area == 0 {
		return nil, errors.New("shape has no area, so it can't have an outside border")
	}
	side := 1.0
	if area < 0 {
		side = -1
	}
	normal := func(a, b vec) (vec, bool) {
		l := math.Hypot(b.x-a.x, b.y-a.y)
		if l == 0 {
			return vec{}, false
		}
		return vec{side * (b.y - a.y) / l, -side * (b.x - a.x) / l}, true
	}
	out := make([]vec, len(poly))
	for i, p := range poly {
		n1, ok1 := normal(poly[(i+len(poly)-1)%len(poly)], p)
		n2, ok2 := normal(p, poly[(i+1)%len(poly)])
		if !ok1 || !ok2 {
			return nil, errors.New("shape repeats a point, so it can't have an outside border")
		}
		turn := 1 + n1.dot(n2)
		if turn < 1e-9 {
			return nil, errors.New("shape folds back on itself, so it can't have an outside border")
		}
		out[i] = p.add(n1.add(n2).mul(distance / turn))
	}
	return out, nil
}

// axis returns the direction of an axis and the normal bars are listed along.
func axis(r region, along string, rotation float64) (dir, normal vec) {
	l := r.reach()
	switch along {
	case "hoist":
		dir, normal = vec{0, 1}, vec{1, 0}
	case "bend":
		dir, normal = vec{r.w / l, r.h / l}, vec{r.h / l, -r.w / l}
	case "bend-sinister":
		dir, normal = vec{r.w / l, -r.h / l}, vec{r.h / l, r.w / l}
	default:
		dir, normal = vec{1, 0}, vec{0, 1}
	}
	return dir.rotate(rotation), normal.rotate(rotation)
}

// clipConvex clips a convex polygon to a region (Sutherland-Hodgman).
func clipConvex(poly []vec, r region) []vec {
	type edge struct {
		inside func(vec) bool
		cross  func(a, b vec) vec
	}
	atX := func(x float64) func(a, b vec) vec {
		return func(a, b vec) vec { return vec{x, a.y + (b.y-a.y)*(x-a.x)/(b.x-a.x)} }
	}
	atY := func(y float64) func(a, b vec) vec {
		return func(a, b vec) vec { return vec{a.x + (b.x-a.x)*(y-a.y)/(b.y-a.y), y} }
	}
	edges := []edge{
		{func(v vec) bool { return v.x >= 0 }, atX(0)},
		{func(v vec) bool { return v.x <= r.w }, atX(r.w)},
		{func(v vec) bool { return v.y >= 0 }, atY(0)},
		{func(v vec) bool { return v.y <= r.h }, atY(r.h)},
	}
	for _, e := range edges {
		var out []vec
		for i, cur := range poly {
			prev := poly[(i+len(poly)-1)%len(poly)]
			switch {
			case e.inside(cur) && e.inside(prev):
				out = append(out, cur)
			case e.inside(cur):
				out = append(out, e.cross(prev, cur), cur)
			case e.inside(prev):
				out = append(out, e.cross(prev, cur))
			}
		}
		poly = out
	}
	return poly
}

// barPolys returns one polygon per bar. Each runs from its bar's start to the
// far side of the region, so the next bar paints over it and antialiasing can't
// leave a seam showing what's beneath. A gradient spans the shape it fills, so a
// bar for which exact returns true stays its true width.
func barPolys(b *Bars, r region, exact func(i int) bool) [][]vec {
	frame, c := b.fixed.place(r)
	dir, normal := axis(frame, b.Along, b.Rotate)
	lo, hi := math.Inf(1), math.Inf(-1)
	for _, corner := range r.corners() {
		offset := corner.sub(c).dot(normal)
		lo, hi = min(lo, offset), max(hi, offset)
	}
	total := 0.0
	for _, part := range b.Ratio {
		total += part
	}
	reach := reachFrom(c, r)
	polys := make([][]vec, 0, len(b.Ratio))
	t := lo
	for i, part := range b.Ratio {
		next := t + (hi-lo)*part/total
		end := hi
		isExact := exact != nil && exact(i)
		if isExact {
			end = next
		}
		if b.Line == nil {
			from, to := t, end
			if b.Rotate != 0 {
				// The outermost lines pass through corners, where rounding in the angle could
				// leave a sliver either side, so the outer ends reach well past the region.
				if i == 0 {
					from -= reach
				}
				if end == hi || i == len(b.Ratio)-1 {
					to = hi + reach
				}
			}
			polys = append(polys, clipConvex(stripPoly(c, dir, normal, from, to, reach), r))
			t = next
			continue
		}
		// A shaped edge isn't convex, so clipping is left to the region's own clip.
		margin := b.Line.Depth + 1
		near := []vec{c.add(normal.mul(lo - margin)).sub(dir.mul(reach)), c.add(normal.mul(lo - margin)).add(dir.mul(reach))}
		if i > 0 {
			near = waveEdge(c, dir, normal, t, axisSpan(frame, b.Along), reach, b.Line)
		}
		far := []vec{c.add(normal.mul(hi + margin)).add(dir.mul(reach)), c.add(normal.mul(hi + margin)).sub(dir.mul(reach))}
		if isExact && i < len(b.Ratio)-1 {
			far = waveEdge(c, dir, normal, next, axisSpan(frame, b.Along), reach, b.Line)
			slices.Reverse(far)
		}
		polys = append(polys, append(near, far...))
		t = next
	}
	return polys
}

// fixedFrame keeps a rotated bars or band where adapting to another proportion put it: its
// center, and the region it was drawn for, which its axis and any edge are measured in.
type fixedFrame struct {
	center vec
	frame  region
}

// place gives the region a layer's axis is measured in and the center it's drawn about,
// which are the region's own unless adapting fixed them.
func (f *fixedFrame) place(r region) (frame region, center vec) {
	if f == nil {
		return r, r.center()
	}
	return f.frame, f.center
}

// reachFrom is far enough from a point to cross the whole region, wherever the point is.
func reachFrom(c vec, r region) float64 {
	d := c.sub(r.center())
	return r.reach() + math.Hypot(d.x, d.y)
}

// stripPoly is the rectangle between two offsets along normal.
func stripPoly(c, dir, normal vec, t0, t1, reach float64) []vec {
	return []vec{
		c.add(normal.mul(t0)).sub(dir.mul(reach)),
		c.add(normal.mul(t0)).add(dir.mul(reach)),
		c.add(normal.mul(t1)).add(dir.mul(reach)),
		c.add(normal.mul(t1)).sub(dir.mul(reach)),
	}
}

// chevronPolys returns one polygon per color, from the outermost inward, which
// is the order they paint in.
func chevronPolys(ch *Chevrons, r region) [][]vec {
	raw, _ := rawChevrons(ch, r)
	for i, poly := range raw {
		raw[i] = clipConvex(poly, r)
	}
	return raw
}

// rawChevrons returns each chevron's polygon reaching well past the region, and
// each chevron alone between its apex and the next, for when gaps have to show.
func rawChevrons(ch *Chevrons, r region) (nested, bands [][]vec) {
	var origin, u, v vec
	var edge float64
	switch ch.From {
	case "fly":
		origin, u, v, edge = vec{r.w, r.h / 2}, vec{-1, 0}, vec{0, 1}, r.h
	case "top":
		origin, u, v, edge = vec{r.w / 2, 0}, vec{0, 1}, vec{1, 0}, r.w
	case "bottom":
		origin, u, v, edge = vec{r.w / 2, r.h}, vec{0, -1}, vec{1, 0}, r.w
	default:
		origin, u, v, edge = vec{0, r.h / 2}, vec{1, 0}, vec{0, 1}, r.h
	}
	reach := r.reach()
	if ch.Apex != nil {
		shift := *ch.Apex - edge/2
		origin = origin.add(v.mul(shift))
		reach += math.Abs(shift)
	}
	run := ch.Depth
	if ch.Angle != 0 {
		run = (edge / 2) / math.Tan(ch.Angle*math.Pi/180)
	}
	slope := run / (edge / 2)
	total := 0.0
	for _, part := range ch.Ratio {
		total += part
	}
	apexes := make([]float64, len(ch.Ratio))
	sum := 0.0
	for i, part := range ch.Ratio {
		sum += part
		apexes[i] = ch.Depth * sum / total
	}
	place := func(pu, pv float64) vec {
		point := origin.add(u.mul(pu)).add(v.mul(pv))
		return r.center().add(point.sub(r.center()).rotate(ch.Rotate))
	}
	for i := len(apexes) - 1; i >= 0; i-- {
		a := apexes[i]
		armEnd := a - slope*reach
		back := min(armEnd, 0) - reach
		nested = append(nested, []vec{
			place(a, 0),
			place(armEnd, reach),
			place(back, reach),
			place(back, -reach),
			place(armEnd, -reach),
		})
		if i == 0 {
			bands = append(bands, nested[len(nested)-1])
			continue
		}
		inner := apexes[i-1]
		innerEnd := inner - slope*reach
		bands = append(bands, []vec{
			place(a, 0),
			place(armEnd, reach),
			place(innerEnd, reach),
			place(inner, 0),
			place(innerEnd, -reach),
			place(armEnd, -reach),
		})
	}
	return nested, bands
}

// bandPoly is a band's rectangle. It's clipped to the region unless it will be
// stroked, since a clipped polygon's new edges would pick up fimbriation.
func bandPoly(r region, along string, rotation, width, offset float64, stroked bool) []vec {
	return placedBandPoly(r, nil, along, rotation, width, offset, stroked)
}

// placedBandPoly is bandPoly for a band whose place adapting may have fixed.
func placedBandPoly(r region, fixed *fixedFrame, along string, rotation, width, offset float64, stroked bool) []vec {
	frame, c := fixed.place(r)
	dir, normal := axis(frame, along, rotation)
	poly := stripPoly(c, dir, normal, offset-width/2, offset+width/2, reachFrom(c, r))
	if stroked {
		return poly
	}
	return clipConvex(poly, r)
}

// crossPolys returns a cross's vertical and horizontal arms, with their ends
// extended by a distance.
func crossPolys(c *Cross, r region, extend float64) [][]vec {
	a, w, b := c.FlyParts[0], c.FlyParts[1], c.FlyParts[2]
	x0 := r.w * a / (a + w + b)
	x1 := r.w * (a + w) / (a + w + b)
	d, h, e := c.HoistPart[0], c.HoistPart[1], c.HoistPart[2]
	y0 := r.h * d / (d + h + e)
	y1 := r.h * (d + h) / (d + h + e)
	return [][]vec{
		rectPoly(x0, -extend, x1, r.h+extend),
		rectPoly(-extend, y0, r.w+extend, y1),
	}
}

// geom is a shape resolved to coordinates.
type geom struct {
	circle bool
	ring   bool
	c      vec
	r      float64
	inner  float64
	poly   []vec
	// path is SVG path data, for shapes that polygons can't draw exactly.
	path string
	// evenodd is a path's fill rule.
	evenodd bool
	// transform places a path, whose scale strokes have to allow for.
	transform string
	scale     float64
}

func position(s *Shape, r region) vec {
	if s.At == nil {
		return r.center()
	}
	return vec{s.At.Fly, s.At.Hoist}
}

// shapeGeom resolves a shape at a center, with its rotation added to the extra.
func shapeGeom(s *Shape, center vec, extra float64) geom {
	rotation := s.Rotate + extra
	place := func(p vec) vec { return center.add(p.rotate(rotation)) }
	switch s.Kind {
	case "disc":
		return geom{circle: true, c: center, r: s.Radius}
	case "ring":
		if s.HasArc {
			return geom{path: ringArcPath(s, center, rotation)}
		}
		return geom{ring: true, c: center, r: s.Radius, inner: s.Inner}
	case "rect":
		x, y := s.Fly/2, s.Hoist/2
		return geom{poly: placeAll(rectPoly(-x, -y, x, y), place)}
	case "plus":
		a, w := s.Radius, s.Width/2
		return geom{poly: placeAll([]vec{
			{-w, -a}, {w, -a}, {w, -w}, {a, -w}, {a, w}, {w, w},
			{w, a}, {-w, a}, {-w, w}, {-a, w}, {-a, -w}, {-w, -w},
		}, place)}
	case "triangle":
		return geom{poly: placeAll(starPoints(3, s.Radius, 0), place)}
	case "star":
		if s.Lines > 0 {
			return geom{path: starChords(s.Points, s.Radius, place)}
		}
		return geom{poly: placeAll(starPoints(s.Points, s.Radius, s.Inner), place)}
	case "heart":
		return geom{path: heartPath(s.Radius, s.Spread, place)}
	case "crescent":
		return geom{path: crescentPath(s.Radius, s.Inner, s.Offset, place)}
	case "sun":
		return geom{path: sunPath(s, center, place)}
	case "lozenge":
		x, y := s.Fly/2, s.Hoist/2
		return geom{poly: placeAll([]vec{{0, -y}, {x, 0}, {0, y}, {-x, 0}}, place)}
	case "ellipse":
		return geom{path: ellipsePath(center, s.Fly/2, s.Hoist/2, rotation)}
	case "path":
		return pathGeom(s, center, rotation)
	case "cardioid":
		return geom{poly: placeAll(cardioidPoints(s.Radius), place)}
	case "polygon":
		poly := make([]vec, len(s.Vertices))
		for i, p := range s.Vertices {
			poly[i] = vec{p.Fly, p.Hoist}
		}
		return geom{poly: poly}
	}
	return geom{}
}

// heartPath draws a heart with its lobes either side of the origin and its tip
// below, whose straight sides meet at a right angle and touch the lobes.
func heartPath(radius, spread float64, place func(vec) vec) string {
	half := spread / 2
	edge := radius / math.Sqrt2
	tip := place(vec{0, half + radius*math.Sqrt2})
	right := place(vec{half + edge, edge})
	left := place(vec{-half - edge, edge})
	notch := place(vec{0, -math.Sqrt(radius*radius - half*half)})
	// Each arc runs from 45 degrees below the lobe's side, around to the notch.
	large := 0
	if 225-math.Acos(half/radius)*180/math.Pi > 180 {
		large = 1
	}
	r := num(radius)
	return fmt.Sprintf("M%s %sL%s %sA%s %s 0 %d 0 %s %sA%s %s 0 %d 0 %s %sZ",
		num(tip.x), num(tip.y), num(right.x), num(right.y),
		r, r, large, num(notch.x), num(notch.y),
		r, r, large, num(left.x), num(left.y))
}

func placeAll(points []vec, place func(vec) vec) []vec {
	for i, p := range points {
		points[i] = place(p)
	}
	return points
}

// starPoints lays out n outer points clockwise from up. An inner radius of 0
// leaves out the inner points, giving a regular polygon.
func starPoints(n int, radius, inner float64) []vec {
	var points []vec
	step := 360 / float64(n)
	for i := range n {
		a := float64(i) * step
		points = append(points, vec{0, -radius}.rotate(a))
		if inner > 0 {
			points = append(points, vec{0, -inner}.rotate(a+step/2))
		}
	}
	return points
}

// cardioidPoints samples a cardioid with its cusp at the origin and its lobe
// below. 180 segments keep the error under the format's tolerance for any
// radius up to the flag's hoist.
func cardioidPoints(radius float64) []vec {
	const segments = 180
	points := make([]vec, segments)
	for i := range points {
		t := 2 * math.Pi * float64(i) / segments
		rho := radius * (1 - math.Cos(t)) / 2
		points[i] = vec{rho * math.Sin(t), -rho * math.Cos(t)}
	}
	return points
}
