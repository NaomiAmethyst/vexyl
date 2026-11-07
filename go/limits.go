// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import "math"

const (
	// maxSize limits how much a whole flag can paint, as SPEC section 15 counts it.
	maxSize = 200000
	// maxFacets limits how many pieces a fold can make, since each step can double them.
	maxFacets = 10000
	// sizePerByte is how many bytes of path data or inline SVG count as one part.
	bytesPerPart = 64
	// numberLimit is the largest size a number can have, and its inverse the smallest,
	// so that nothing worked out from them can overflow.
	numberLimit = 1e12
)

// inLimits says whether a number is finite and of a reasonable size.
func inLimits(v float64) bool {
	a := math.Abs(v)
	return !math.IsNaN(v) && a <= numberLimit && (a == 0 || a >= 1/numberLimit)
}

// addSize adds or multiplies sizes without passing the point where they stop mattering,
// since a chain of definitions can double them many times over.
func addSize(a, b int) int { return min(a+b, maxSize+1) }

func mulSize(a, b int) int {
	if a == 0 || b == 0 {
		return 0
	}
	if a > (maxSize+1)/b {
		return maxSize + 1
	}
	return min(a*b, maxSize+1)
}

// waves is how many waves a shaped edge has across the flag's longer side.
func (l *Line) waves(longer float64) int {
	if l.Count > 0 {
		return l.Count
	}
	if l.Period <= 0 {
		return 0
	}
	waves := math.Ceil(longer / l.Period)
	if waves > maxCopies {
		return maxCopies + 1
	}
	return int(waves)
}

// shapeParts is how many parts one copy of a shape counts as.
func shapeParts(s *Shape) int {
	switch s.Kind {
	case "star", "sun":
		return max(s.Points, 1)
	case "polygon":
		return max(len(s.Vertices), 1)
	case "path":
		return 1 + len(s.D)/bytesPerPart
	case "svg":
		return 1 + len(s.Markup)/bytesPerPart
	}
	return 1
}

func chargeCopies(c *Charge) int {
	switch {
	case c.Repeat != nil && c.Repeat.Kind == "grid":
		return c.Repeat.Rows * c.Repeat.Columns
	case c.Repeat != nil:
		return c.Repeat.Count
	case len(c.Shape.Ats) > 1:
		return len(c.Shape.Ats)
	}
	return 1
}

// layerSize counts what a layer paints. A definition's size was worked out when it was
// read, so a chain of them is never walked.
func layerSize(l Layer, longer float64) int {
	e := l.effects()
	size := 0
	if e.Clip != nil {
		size = shapeParts(e.Clip)
	}
	cuts := 0
	for i := range e.Cuts {
		cuts = addSize(cuts, shapeParts(&e.Cuts[i]))
	}
	// A charge's cuts go with each of its copies.
	if c, ok := l.(*Charge); ok {
		cuts = mulSize(chargeCopies(c), cuts)
	}
	return addSize(addSize(size, cuts), contentSize(l, longer))
}

func contentSize(l Layer, longer float64) int {
	switch t := l.(type) {
	case *Bars:
		if t.Line != nil {
			return mulSize(len(t.Colors), 1+t.Line.waves(longer))
		}
		return len(t.Colors)
	case *Chevrons:
		return len(t.Colors)
	case *Rays:
		return len(t.Colors)
	case *Quarters:
		return 4
	case *Checks:
		return mulSize(t.Rows, t.Columns)
	case *Charge:
		return mulSize(chargeCopies(t), shapeParts(&t.Shape))
	case *Emblem:
		size := 0
		for _, c := range t.Charges {
			size = addSize(size, layerSize(c, longer))
		}
		return size
	case *Group:
		return layersSize(t.Layers, longer)
	case *Panel:
		size := layersSize(t.Layers, longer)
		if t.Line != nil {
			size = addSize(size, t.Line.waves(longer))
		}
		return size
	case *Use:
		return t.design.size
	}
	return 1
}

func layersSize(layers []Layer, longer float64) int {
	size := 0
	for _, l := range layers {
		size = addSize(size, layerSize(l, longer))
	}
	return size
}

// layerHeight is how many levels a layer nests, counting what it uses. It's bounded by
// maxDepth, since every level was checked as it was read.
func layerHeight(l Layer) int {
	switch t := l.(type) {
	case *Group:
		return 1 + layersHeight(t.Layers)
	case *Panel:
		return 1 + layersHeight(t.Layers)
	case *Use:
		return 1 + t.design.height
	}
	return 1
}

func layersHeight(layers []Layer) int {
	height := 0
	for _, l := range layers {
		height = max(height, layerHeight(l))
	}
	return height
}
