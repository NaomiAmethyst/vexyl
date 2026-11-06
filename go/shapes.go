// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"fmt"
	"math"
	"strings"
)

// crescentPath draws a disc with another cut from it, offset toward the fly.
func crescentPath(radius, inner, offset float64, place func(vec) vec) string {
	x := (radius*radius - inner*inner + offset*offset) / (2 * offset)
	y := math.Sqrt(max(radius*radius-x*x, 0))
	top, bottom := place(vec{x, -y}), place(vec{x, y})
	outerLarge, innerLarge := 0, 0
	if x > 0 {
		outerLarge = 1
	}
	if x > offset {
		innerLarge = 1
	}
	return fmt.Sprintf("M%s %sA%s %s 0 %d 0 %s %sA%s %s 0 %d 1 %s %sZ",
		num(top.x), num(top.y),
		num(radius), num(radius), outerLarge, num(bottom.x), num(bottom.y),
		num(inner), num(inner), innerLarge, num(top.x), num(top.y))
}

// sunPath draws a disc and triangular rays, all wound the same way so that where
// they overlap stays filled.
func sunPath(s *Shape, center vec, place func(vec) vec) string {
	var b strings.Builder
	b.WriteString(circlePath(center, s.Disc))
	base := s.Disc + s.Gap
	step := 360 / float64(s.Points)
	half := step / 2 * s.Spread
	for i := range s.Points {
		a := float64(i) * step
		tip := place(vec{0, -s.Radius}.rotate(a))
		left := place(vec{0, -base}.rotate(a - half))
		right := place(vec{0, -base}.rotate(a + half))
		fmt.Fprintf(&b, " M%s %sL%s %sL%s %sZ",
			num(right.x), num(right.y), num(tip.x), num(tip.y), num(left.x), num(left.y))
	}
	return b.String()
}

// ringArcPath draws part of a ring, clockwise from one angle to another.
func ringArcPath(s *Shape, center vec, rotation float64) string {
	from, to := s.From+rotation, s.To+rotation
	for to <= from {
		to += 360
	}
	point := func(r, a float64) vec { return center.add(vec{0, -r}.rotate(a)) }
	large := 0
	if to-from > 180 {
		large = 1
	}
	a, b, c, d := point(s.Radius, from), point(s.Radius, to), point(s.Inner, to), point(s.Inner, from)
	return fmt.Sprintf("M%s %sA%s %s 0 %d 1 %s %sL%s %sA%s %s 0 %d 0 %s %sZ",
		num(a.x), num(a.y), num(s.Radius), num(s.Radius), large, num(b.x), num(b.y),
		num(c.x), num(c.y), num(s.Inner), num(s.Inner), large, num(d.x), num(d.y))
}

// starChords joins a star's points by skipping one each time, which is one closed
// line for an odd number of points and two for six, as on a hexagram.
func starChords(n int, radius float64, place func(vec) vec) string {
	seen := make([]bool, n)
	var b strings.Builder
	point := func(i int) vec { return place(vec{0, -radius}.rotate(float64(i) * 360 / float64(n))) }
	for start := range n {
		if seen[start] {
			continue
		}
		p := point(start)
		fmt.Fprintf(&b, "M%s %s", num(p.x), num(p.y))
		for i := (start + 2) % n; i != start; i = (i + 2) % n {
			seen[i] = true
			p = point(i)
			fmt.Fprintf(&b, "L%s %s", num(p.x), num(p.y))
		}
		seen[start] = true
		b.WriteString("Z")
	}
	return b.String()
}

// pathGeom fits a path's box within a size, keeping its shape, centered on a point.
func pathGeom(s *Shape, center vec, rotation float64) geom {
	scale := math.Inf(1)
	if s.Fly > 0 {
		scale = s.Fly / s.Box[2]
	}
	if s.Hoist > 0 {
		scale = min(scale, s.Hoist/s.Box[3])
	}
	transform := fmt.Sprintf("translate(%s %s)", num(center.x), num(center.y))
	if rotation != 0 {
		transform += fmt.Sprintf(" rotate(%s)", num(rotation))
	}
	transform += fmt.Sprintf(" scale(%s) translate(%s %s)", num(scale),
		num(-s.Box[0]-s.Box[2]/2), num(-s.Box[1]-s.Box[3]/2))
	return geom{path: s.D, transform: transform, scale: scale, evenodd: s.EvenOdd}
}

// forRegion fills in what a shape takes from the region it's in.
func (s *Shape) forRegion(r region) *Shape {
	switch s.Kind {
	case "lozenge":
		if s.Fly > 0 && s.Hoist > 0 {
			return s
		}
		out := *s
		if out.Fly == 0 {
			out.Fly = r.w
		}
		if out.Hoist == 0 {
			out.Hoist = r.h
		}
		return &out
	case "pile":
		out := *s
		out.Kind = "polygon"
		out.Vertices = pilePoints(s, r)
		return &out
	case "pall":
		out := *s
		out.Kind = "polygon"
		out.Vertices = pallPoints(s, r)
		return &out
	}
	return s
}

// edgeFrame maps a distance in from an edge and a distance along it to a point.
func edgeFrame(edge string, r region) (place func(in, along float64) Point, length float64) {
	switch edge {
	case "fly":
		return func(in, along float64) Point { return Point{r.w - in, along} }, r.h
	case "top":
		return func(in, along float64) Point { return Point{along, in} }, r.w
	case "bottom":
		return func(in, along float64) Point { return Point{along, r.h - in} }, r.w
	}
	return func(in, along float64) Point { return Point{in, along} }, r.h
}

// pilePoints continues a pile's sides back past its edge, so that fimbriation
// doesn't run along the edge of the flag.
func pilePoints(s *Shape, r region) []Point {
	place, length := edgeFrame(s.Edge, r)
	a, b := 0.0, length
	if s.Base != nil {
		a, b = s.Base[0], s.Base[1]
	}
	depth, along := s.Depth, (a+b)/2
	if s.Tip != nil {
		along, depth = s.Tip[0], s.Tip[1]
	}
	lo, hi := along-s.Flat/2, along+s.Flat/2
	back := r.reach()
	backA := a - (lo-a)*back/depth
	backB := b + (b-hi)*back/depth
	return []Point{place(-back, backA), place(depth, lo), place(depth, hi), place(-back, backB)}
}

// pallPoints outlines a Y whose arms run from the corners of its edge to a
// junction, then on as a single stem to the far side.
func pallPoints(s *Shape, r region) []Point {
	place, length := edgeFrame(s.Edge, r)
	far := r.w
	if s.Edge == "top" || s.Edge == "bottom" {
		far = r.h
	}
	junction := s.Junction
	if junction == 0 {
		junction = length / 2
	}
	half, mid := s.Width/2, length/2
	reach := r.reach() + s.Width
	l := math.Hypot(junction, mid)
	dirIn, dirAlong := junction/l, mid/l
	// The upper arm runs along direction (dirIn, dirAlong) from the corner at
	// along=0 to the junction, in coordinates of (in, along from the center line).
	normalIn, normalAlong := dirAlong, -dirIn
	line := func(offset, targetAlong float64) float64 {
		// Where the arm's edge at an offset reaches a distance from the center line.
		startIn, startAlong := normalIn*offset, -mid+normalAlong*offset
		return startIn + (targetAlong-startAlong)*dirIn/dirAlong
	}
	shoulder := line(half, -half)
	notch := line(-half, 0)
	farOuterIn, farOuterAlong := normalIn*half-dirIn*reach, -mid+normalAlong*half-dirAlong*reach
	farInnerIn, farInnerAlong := -normalIn*half-dirIn*reach, -mid-normalAlong*half-dirAlong*reach
	at := func(in, fromCenter float64) Point { return place(in, mid+fromCenter) }
	return []Point{
		at(farOuterIn, farOuterAlong),
		at(shoulder, -half),
		at(far+reach, -half),
		at(far+reach, half),
		at(shoulder, half),
		at(farOuterIn, -farOuterAlong),
		at(farInnerIn, -farInnerAlong),
		at(notch, 0),
		at(farInnerIn, farInnerAlong),
	}
}

// points returns an outline's corners, or nil if it's curved.
func (o *Outline) points(w, h float64) []vec {
	switch o.Kind {
	case "polygon":
		poly := make([]vec, len(o.Vertices))
		for i, p := range o.Vertices {
			poly[i] = vec{p.Fly, p.Hoist}
		}
		return poly
	case "swallowtail":
		return []vec{{0, 0}, {w, o.Taper}, {w - o.Depth, h / 2}, {w, h - o.Taper}, {0, h}}
	case "tongued":
		a := (h - o.Tongue) / 2
		return []vec{{0, 0}, {w, 0}, {w - o.Depth, a}, {w, h / 2}, {w - o.Depth, h - a}, {w, h}, {0, h}}
	case "pennant":
		a := (h - o.Tip) / 2
		if o.Tip == 0 {
			return []vec{{0, 0}, {w, h / 2}, {0, h}}
		}
		return []vec{{0, 0}, {w, a}, {w, h - a}, {0, h}}
	}
	return nil
}

// geom resolves an outline for painting and clipping.
func (o *Outline) geom(w, h float64) geom {
	if o.Kind != "path" {
		return geom{poly: o.points(w, h)}
	}
	// A flag's own curved outline is stretched to its box.
	sx, sy := w/o.Box[2], h/o.Box[3]
	return geom{path: o.D, scale: 1, transform: fmt.Sprintf("scale(%s %s) translate(%s %s)",
		num(sx), num(sy), num(-o.Box[0]), num(-o.Box[1]))}
}

// linePoints samples a wavy or zigzag line along a span, as distances along it and
// displacements from it.
func linePoints(l *Line, span float64) (along, offset []float64) {
	period := l.Period
	if l.Count > 0 {
		period = span / float64(l.Count)
	}
	if span/period > maxCopies {
		panic(renderRefusal(fmt.Sprintf("a shaped edge can't have more than %d waves", maxCopies)))
	}
	half := l.Depth / 2
	if l.Kind == "zigzag" {
		sign := -1.0
		for s, i := 0.0, 0; s <= span+period/4; s, i = s+period/2, i+1 {
			along = append(along, s)
			offset = append(offset, sign*half)
			sign = -sign
		}
		return along, offset
	}
	const perWave = 24
	for s := 0.0; s <= span+period/perWave/2; s += period / perWave {
		along = append(along, s)
		offset = append(offset, half*math.Sin(2*math.Pi*s/period))
	}
	return along, offset
}

// waveEdge is a shaped line across a region, in the direction dir at offset t along
// normal, continued flat past the region at both ends.
func waveEdge(c, dir, normal vec, t, span, reach float64, l *Line) []vec {
	along, offset := linePoints(l, span)
	points := make([]vec, 0, len(along)+2)
	points = append(points, c.add(normal.mul(t+offset[0])).sub(dir.mul(reach)))
	for i, s := range along {
		points = append(points, c.add(normal.mul(t+offset[i])).add(dir.mul(s-span/2)))
	}
	return append(points, c.add(normal.mul(t+offset[len(offset)-1])).add(dir.mul(reach)))
}

// axisSpan is how far an axis runs across a region.
func axisSpan(r region, along string) float64 {
	switch along {
	case "fly":
		return r.w
	case "hoist":
		return r.h
	}
	return r.reach()
}

// rayPolys returns one wedge per color, each with an angle under 180 degrees or
// split so that it clips cleanly.
func rayPolys(l *Rays, r region) [][]vec {
	apex, from, sweep := rayFrame(l, r)
	if l.ByEdge {
		return rayPolysByEdge(l, r, apex, from, sweep)
	}
	from += l.Rotate
	total := 0.0
	for _, part := range l.Ratio {
		total += part
	}
	reach := r.reach() + math.Hypot(apex.x-r.w/2, apex.y-r.h/2)
	polys := make([][]vec, 0, len(l.Ratio))
	a := from
	for _, part := range l.Ratio {
		width := sweep * part / total
		steps := int(math.Ceil(width / 60))
		poly := []vec{apex}
		for i := 0; i <= steps; i++ {
			poly = append(poly, apex.add(vec{0, -reach * 2}.rotate(a+width*float64(i)/float64(steps))))
		}
		polys = append(polys, clipConvex(poly, r))
		a += width
	}
	return polys
}

// rayPolysByEdge shares the region's far edges out by length, going clockwise.
func rayPolysByEdge(l *Rays, r region, apex vec, from, sweep float64) [][]vec {
	// Walk the region's outline clockwise from the top of the hoist, starting at
	// the first point the rays can see.
	corners := r.corners()
	var path []vec
	switch {
	case sweep == 360:
		path = []vec{{apex.x, 0}, corners[1], corners[2], corners[3], corners[0], {apex.x, 0}}
	case from == 90:
		switch l.From {
		case "top":
			path = []vec{corners[1], corners[2], corners[3], corners[0]}
		default:
			path = []vec{corners[1], corners[2], corners[3]}
		}
	case from == 0 && sweep == 90:
		path = []vec{corners[0], corners[1], corners[2]}
	case from == 0:
		path = []vec{corners[0], corners[1], corners[2], corners[3]}
	case from == 180 && sweep == 90:
		path = []vec{corners[2], corners[3], corners[0]}
	case from == 180:
		path = []vec{corners[2], corners[3], corners[0], corners[1]}
	case from == 270:
		path = []vec{corners[3], corners[0], corners[1]}
	default:
		path = []vec{corners[3], corners[0], corners[1], corners[2]}
	}
	length := 0.0
	for i := 1; i < len(path); i++ {
		length += math.Hypot(path[i].x-path[i-1].x, path[i].y-path[i-1].y)
	}
	total := 0.0
	for _, part := range l.Ratio {
		total += part
	}
	polys := make([][]vec, 0, len(l.Ratio))
	leg, into := 0, 0.0
	at := path[0]
	for _, part := range l.Ratio {
		remaining := length * part / total
		poly := []vec{apex, at}
		for remaining > 1e-9 && leg < len(path)-1 {
			next := path[leg+1]
			legLength := math.Hypot(next.x-path[leg].x, next.y-path[leg].y)
			left := legLength - into
			if remaining < left {
				into += remaining
				at = path[leg].add(next.sub(path[leg]).mul(into / legLength))
				remaining = 0
				break
			}
			remaining -= left
			at = next
			poly = append(poly, at)
			leg++
			into = 0
		}
		if remaining == 0 {
			poly = append(poly, at)
		}
		polys = append(polys, poly)
	}
	return polys
}

// rayFrame finds where rays start, and the angle they cover going clockwise from up.
func rayFrame(l *Rays, r region) (apex vec, from, sweep float64) {
	if l.At != nil {
		return vec{l.At.Fly, l.At.Hoist}, 0, 360
	}
	switch l.From {
	case "upper-hoist":
		return vec{0, 0}, 90, 90
	case "lower-hoist":
		return vec{0, r.h}, 0, 90
	case "upper-fly":
		return vec{r.w, 0}, 180, 90
	case "lower-fly":
		return vec{r.w, r.h}, 270, 90
	case "hoist":
		return vec{0, r.h / 2}, 0, 180
	case "fly":
		return vec{r.w, r.h / 2}, 180, 180
	case "top":
		return vec{r.w / 2, 0}, 90, 180
	case "bottom":
		return vec{r.w / 2, r.h}, -90, 180
	}
	return r.center(), 0, 360
}

// panelRect finds a panel's place in its parent, in the parent's coordinates.
func panelRect(p *Panel, r region) (x, y, w, h float64) {
	extra := 0.0
	if p.Line != nil {
		extra = p.Line.Depth / 2
	}
	switch p.Side {
	case "hoist":
		return 0, 0, p.Width + extra, r.h
	case "fly":
		return r.w - p.Width - extra, 0, p.Width + extra, r.h
	case "top":
		return 0, 0, r.w, p.Width + extra
	case "bottom":
		return 0, r.h - p.Width - extra, r.w, p.Width + extra
	}
	switch p.Corner {
	case "upper-hoist":
		return 0, 0, p.Fly, p.Hoist
	case "upper-fly":
		return r.w - p.Fly, 0, p.Fly, p.Hoist
	case "lower-hoist":
		return 0, r.h - p.Hoist, p.Fly, p.Hoist
	case "lower-fly":
		return r.w - p.Fly, r.h - p.Hoist, p.Fly, p.Hoist
	}
	at := r.center()
	if p.At != nil {
		at = vec{p.At.Fly, p.At.Hoist}
	}
	return at.x - p.Fly/2, at.y - p.Hoist/2, p.Fly, p.Hoist
}

// panelEdge is a panel's outline when it has a shaped edge, in its own coordinates.
func panelEdge(p *Panel, w, h float64) []vec {
	along, offset := linePoints(p.Line, map[bool]float64{true: h, false: w}[p.Side == "hoist" || p.Side == "fly"])
	half := p.Line.Depth / 2
	var points []vec
	switch p.Side {
	case "hoist":
		points = append(points, vec{0, 0})
		for i, s := range along {
			points = append(points, vec{w - half + offset[i], s})
		}
		points = append(points, vec{0, h})
	case "fly":
		points = append(points, vec{w, 0})
		for i, s := range along {
			points = append(points, vec{half - offset[i], s})
		}
		points = append(points, vec{w, h})
	case "top":
		points = append(points, vec{0, 0})
		for i, s := range along {
			points = append(points, vec{s, h - half + offset[i]})
		}
		points = append(points, vec{w, 0})
	default:
		points = append(points, vec{0, h})
		for i, s := range along {
			points = append(points, vec{s, half - offset[i]})
		}
		points = append(points, vec{w, h})
	}
	return points
}
