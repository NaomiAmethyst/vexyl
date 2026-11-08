// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"fmt"
	"math"
	"strings"
)

// withRatio returns the flag at another proportion, given as fly divided by hoist,
// following its adapt rules.
func (f *Flag) withRatio(ratio float64) (*Flag, error) {
	current := f.Fly / f.Hoist
	if math.Abs(ratio-current) < 1e-9*current {
		return f, nil
	}
	if f.Adapt == nil {
		return nil, fmt.Errorf("%s doesn't say how it adapts to other proportions", f.Meta.Name)
	}
	if (f.Adapt.Min > 0 && ratio < f.Adapt.Min) || (f.Adapt.Max > 0 && ratio > f.Adapt.Max) {
		return nil, fmt.Errorf("%s only adapts between ratios of %v and %v", f.Meta.Name, f.Adapt.Min, f.Adapt.Max)
	}
	mode := f.Adapt.Narrower
	if ratio > current {
		mode = f.Adapt.Wider
	}
	if mode == "" {
		return nil, fmt.Errorf("%s has no rule for this direction of change", f.Meta.Name)
	}
	out := *f
	base, onHoist := strings.CutPrefix(mode, "hoist-")
	a := &adapter{axis: "fly", anchor: map[string]string{"extend": "start", "center": "center", "scale": "scale"}[base],
		fromBehind: f.seenFromBehind}
	if onHoist {
		a.axis = "hoist"
		a.other = f.Fly
		out.Hoist = f.Fly / ratio
		out.Layers = a.layers(f.Layers, f.Hoist, out.Hoist)
	} else {
		a.other = f.Hoist
		out.Fly = f.Hoist * ratio
		out.Layers = a.layers(f.Layers, f.Fly, out.Fly)
	}
	if f.Outline != nil && f.Outline.Kind == "polygon" {
		// A silhouette has no sensible anchor, so a drawn one stretches with the flag.
		o := *f.Outline
		o.Vertices = make([]Point, len(f.Outline.Vertices))
		for i, p := range f.Outline.Vertices {
			o.Vertices[i] = Point{p.Fly * out.Fly / f.Fly, p.Hoist * out.Hoist / f.Hoist}
		}
		out.Outline = &o
	}
	return &out, a.err
}

// adapter moves layers along one axis as their region changes size.
type adapter struct {
	axis, anchor string
	// passed is an anchor that a container passed on to its layers, if one did.
	passed string
	// fromBehind says that the layers are a reverse's own, with the hoist on the right.
	fromBehind bool
	// other is the region's size across the axis, which stays the same.
	other float64
	err   error
}

// anchorOf finds a layer's anchor: its own, or one passed on to it, or the rule's. It
// says whether the layer was given one, by itself or a container.
func (a *adapter) anchorOf(e *Effects) (anchor string, given bool) {
	anchor, given = e.Anchor, true
	if anchor == "" {
		anchor = a.passed
	}
	if anchor == "" {
		anchor, given = a.anchor, false
	}
	if a.fromBehind && a.axis == "fly" {
		// Seen from behind, the hoist is on the right, and start is still the hoist.
		switch anchor {
		case "start":
			anchor = "end"
		case "end":
			anchor = "start"
		}
	}
	return anchor, given
}

// passOn adapts a container's layers with its anchor, if it gives one.
func (a *adapter) passOn(e *Effects, adapt func()) {
	passed := a.passed
	if e.Anchor != "" {
		a.passed = e.Anchor
	}
	adapt()
	a.passed = passed
}

// center is the region's center, for pinning what's there to an anchor.
func (a *adapter) center(old float64) *Point {
	if a.axis == "hoist" {
		return &Point{a.other / 2, old / 2}
	}
	return &Point{old / 2, a.other / 2}
}

func (a *adapter) fail(format string, args ...any) {
	if a.err == nil {
		a.err = fmt.Errorf(format, args...)
	}
}

func (a *adapter) layers(layers []Layer, old, new float64) []Layer {
	out := make([]Layer, len(layers))
	for i, l := range layers {
		out[i] = a.layer(l, old, new)
	}
	return out
}

// move maps a position along the axis, by a layer's anchor.
func move(x, old, new float64, anchor string) float64 {
	switch anchor {
	case "center":
		return x + (new-old)/2
	case "end":
		return x + new - old
	case "scale":
		return x * new / old
	}
	return x
}

func (a *adapter) point(p *Point, old, new float64, anchor string) *Point {
	if p == nil {
		return nil
	}
	out := *p
	if a.axis == "fly" {
		out.Fly = move(p.Fly, old, new, anchor)
	} else {
		out.Hoist = move(p.Hoist, old, new, anchor)
	}
	return &out
}

// shape moves a shape, which keeps its own form unless it's drawn from points. The
// center stays the center, so a charge there follows it unless anchored otherwise.
func (a *adapter) shape(s Shape, old, new float64, anchor string, explicit bool) Shape {
	k := new / old
	if s.At == nil && explicit && anchor != "scale" && s.Kind != "polygon" {
		s.At = a.center(old)
	}
	s.At = a.point(s.At, old, new, anchor)
	if s.Ats != nil {
		ats := make([]*Point, len(s.Ats))
		for i, p := range s.Ats {
			ats[i] = a.point(p, old, new, anchor)
		}
		s.Ats = ats
	}
	if s.Vertices != nil {
		v := make([]Point, len(s.Vertices))
		for i, p := range s.Vertices {
			v[i] = *a.point(&p, old, new, anchor)
		}
		s.Vertices = v
	}
	if anchor == "scale" {
		switch s.Kind {
		case "rect", "lozenge", "ellipse":
			if a.axis == "fly" {
				s.Fly *= k
			} else {
				s.Hoist *= k
			}
		}
	}
	// Piles and palls are set from their edge, so depths only change when scaling,
	// and positions along the edge move like any other.
	if s.Kind == "pile" || s.Kind == "pall" {
		runsAlongAxis := (s.Edge == "hoist" || s.Edge == "fly") == (a.axis == "fly")
		if runsAlongAxis {
			if anchor == "scale" {
				s.Depth *= k
				s.Junction *= k
				if s.Tip != nil {
					s.Tip = &[2]float64{s.Tip[0], s.Tip[1] * k}
				}
			}
		} else {
			if s.Base != nil {
				s.Base = &[2]float64{move(s.Base[0], old, new, anchor), move(s.Base[1], old, new, anchor)}
			}
			if s.Tip != nil {
				s.Tip = &[2]float64{move(s.Tip[0], old, new, anchor), s.Tip[1]}
			}
		}
	}
	return s
}

func (a *adapter) effects(e Effects, old, new float64) (Effects, string) {
	anchor, _ := a.anchorOf(&e)
	if e.Clip != nil {
		s := a.shape(*e.Clip, old, new, anchor, false)
		e.Clip = &s
	}
	if e.Cuts != nil {
		cuts := make([]Shape, len(e.Cuts))
		for i, c := range e.Cuts {
			cuts[i] = a.shape(c, old, new, anchor, false)
		}
		e.Cuts = cuts
	}
	return e, anchor
}

// parts shares a change in size across parts along the axis, by a layer's anchor.
func (a *adapter) parts(what string, parts []float64, old, new float64, anchor string) []float64 {
	total := 0.0
	for _, p := range parts {
		total += p
	}
	out := make([]float64, len(parts))
	for i, p := range parts {
		out[i] = p * old / total
	}
	d := new - old
	last := len(out) - 1
	changed := []int{last}
	switch anchor {
	case "start":
		out[last] += d
	case "end":
		out[0] += d
		changed = []int{0}
	case "center":
		out[0] += d / 2
		out[last] += d / 2
		changed = []int{0, last}
	default:
		return parts
	}
	for _, i := range changed {
		a.keep(what, out[i], old)
	}
	return out
}

// keep refuses a part that a change of size has brought to nothing, allowing for
// floating-point error in what should be exactly zero.
func (a *adapter) keep(what string, part, old float64) {
	if part <= 1e-9*old {
		a.fail("%s can't be cut to this proportion", what)
	}
}

func (a *adapter) layer(l Layer, old, new float64) Layer {
	k := new / old
	switch t := l.(type) {
	case *Field:
		c := *t
		c.Effects, _ = a.effects(t.Effects, old, new)
		return &c
	case *Bars:
		c := *t
		var anchor string
		c.Effects, anchor = a.effects(t.Effects, old, new)
		if (a.axis == "fly") != (t.Along == "hoist") || t.Along == "bend" || t.Along == "bend-sinister" {
			return &c
		}
		if t.Grow != nil {
			total, weights := 0.0, 0.0
			for i := range t.Ratio {
				total += t.Ratio[i]
				weights += t.Grow[i]
			}
			if weights > 0 {
				c.Ratio = make([]float64, len(t.Ratio))
				for i := range t.Ratio {
					c.Ratio[i] = t.Ratio[i]*old/total + (new-old)*t.Grow[i]/weights
					if t.Grow[i] > 0 {
						a.keep("bars", c.Ratio[i], old)
					}
				}
				return &c
			}
		}
		c.Ratio = a.parts("bars", t.Ratio, old, new, anchor)
		return &c
	case *Chevrons:
		c := *t
		var anchor string
		c.Effects, anchor = a.effects(t.Effects, old, new)
		alongAxis := (t.From == "hoist" || t.From == "fly") == (a.axis == "fly")
		switch {
		case alongAxis && anchor == "scale":
			c.Depth *= k
		case !alongAxis && t.Apex != nil:
			apex := move(*t.Apex, old, new, anchor)
			c.Apex = &apex
		}
		return &c
	case *Band:
		c := *t
		var anchor string
		c.Effects, anchor = a.effects(t.Effects, old, new)
		acrossAxis := (a.axis == "fly" && t.Along == "hoist") || (a.axis == "hoist" && t.Along == "fly")
		if acrossAxis {
			switch anchor {
			case "start":
				c.Offset -= (new - old) / 2
			case "end":
				c.Offset += (new - old) / 2
			case "scale":
				c.Offset *= k
				c.Width *= k
			}
		}
		return &c
	case *Cross:
		c := *t
		var anchor string
		c.Effects, anchor = a.effects(t.Effects, old, new)
		parts := t.FlyParts
		if a.axis == "hoist" {
			parts = t.HoistPart
		}
		moved := a.parts("a cross", parts[:], old, new, anchor)
		if a.axis == "fly" {
			copy(c.FlyParts[:], moved)
		} else {
			copy(c.HoistPart[:], moved)
		}
		return &c
	case *Saltire:
		c := *t
		c.Effects, _ = a.effects(t.Effects, old, new)
		return &c
	case *Quarters:
		c := *t
		var anchor string
		c.Effects, anchor = a.effects(t.Effects, old, new)
		c.Split = a.point(t.Split, old, new, anchor)
		return &c
	case *Checks:
		c := *t
		c.Effects, _ = a.effects(t.Effects, old, new)
		return &c
	case *Rays:
		c := *t
		var anchor string
		c.Effects, anchor = a.effects(t.Effects, old, new)
		c.At = a.point(t.At, old, new, anchor)
		return &c
	case *Charge:
		c := *t
		var anchor string
		c.Effects, anchor = a.effects(t.Effects, old, new)
		_, given := a.anchorOf(&t.Effects)
		c.Shape = a.shape(t.Shape, old, new, anchor, given)
		if t.Repeat != nil && t.Repeat.Kind == "line" && anchor == "scale" {
			r := *t.Repeat
			if a.axis == "fly" {
				r.Fly *= k
			} else {
				r.Hoist *= k
			}
			c.Repeat = &r
		}
		return &c
	case *Emblem:
		c := *t
		var anchor string
		c.Effects, anchor = a.effects(t.Effects, old, new)
		c.At = t.At
		if _, given := a.anchorOf(&t.Effects); c.At == nil && given && anchor != "scale" {
			// One at the center that's given an anchor is pinned to it, as a charge is.
			c.At = a.center(old)
		}
		c.At = a.point(c.At, old, new, anchor)
		return &c
	case *Group:
		c := *t
		c.Effects, _ = a.effects(t.Effects, old, new)
		a.passOn(&t.Effects, func() { c.Layers = a.layers(t.Layers, old, new) })
		return &c
	case *Panel:
		return a.panel(t, old, new)
	case *Use:
		c := *t
		c.Effects, _ = a.effects(t.Effects, old, new)
		if t.design.Fly == 0 {
			d := *t.design
			a.passOn(&t.Effects, func() { d.Layers = a.layers(t.design.Layers, old, new) })
			c.design = &d
		}
		return &c
	}
	return l
}

// panel keeps a panel at its edge or corner. One running along the axis grows with
// its parent, and only scaling changes the size of any other.
func (a *adapter) panel(t *Panel, old, new float64) Layer {
	k := new / old
	c := *t
	var anchor string
	c.Effects, anchor = a.effects(t.Effects, old, new)
	c.At = t.At
	if _, given := a.anchorOf(&t.Effects); t.Side == "" && t.Corner == "" && c.At == nil && given && anchor != "scale" {
		// One at the center that's given an anchor is pinned to it, as a charge is.
		c.At = a.center(old)
	}
	c.At = a.point(c.At, old, new, anchor)
	runsAlong := (a.axis == "fly" && (t.Side == "top" || t.Side == "bottom")) ||
		(a.axis == "hoist" && (t.Side == "hoist" || t.Side == "fly"))
	outer, passed := a.other, a.passed
	defer func() { a.other, a.passed = outer, passed }()
	if t.Anchor != "" {
		a.passed = t.Anchor
	}
	if runsAlong {
		a.other = t.Width
		c.Layers = a.layers(t.Layers, old, new)
		return &c
	}
	if anchor != "scale" {
		return &c
	}
	// Everything inside is measured against the panel's own size along the axis.
	size := t.Fly
	switch {
	case t.Side != "":
		size = t.Width
		c.Width *= k
		a.other = outer
	case a.axis == "fly":
		a.other = t.Hoist
		c.Fly *= k
	default:
		size = t.Hoist
		a.other = t.Fly
		c.Hoist *= k
	}
	c.Layers = a.layers(t.Layers, size, size*k)
	return &c
}

// view is how a variant turns a flag, as a transform and what undoes it for charges.
func view(kind string, x0, y0, width, tall float64) (transform, upright string) {
	switch kind {
	case "transpose":
		return "matrix(0 1 1 0 0 0)", "matrix(0 1 1 0 0 0)"
	case "rotate":
		return fmt.Sprintf("matrix(0 1 -1 0 %s 0)", num(2*y0+tall)), "matrix(0 -1 1 0 0 0)"
	case "anti-transpose":
		return fmt.Sprintf("matrix(0 -1 -1 0 %s %s)", num(2*y0+tall), num(2*x0+width)), "matrix(0 -1 -1 0 0 0)"
	case "counter-rotate":
		return fmt.Sprintf("matrix(0 -1 1 0 0 %s)", num(2*x0+width)), "matrix(0 1 -1 0 0 0)"
	case "mirror":
		return fmt.Sprintf("matrix(-1 0 0 1 %s 0)", num(2*x0+width)), "matrix(-1 0 0 1 0 0)"
	case "half-turn":
		return fmt.Sprintf("matrix(-1 0 0 -1 %s %s)", num(2*x0+width), num(2*y0+tall)), "matrix(-1 0 0 -1 0 0)"
	case "invert":
		return fmt.Sprintf("matrix(1 0 0 -1 0 %s)", num(2*y0+tall)), "matrix(1 0 0 -1 0 0)"
	}
	return "", ""
}

// resolve applies a side, a variant and a proportion to the flag. A non-zero canvas
// is the proportion to pad the result to.
func (f *Flag) resolve(opts Options) (flag *Flag, turn string, upright, mirror bool, canvas float64, err error) {
	out := *f
	ratio := 0.0
	if opts.Ratio != nil {
		ratio = *opts.Ratio
	}
	turn = "none"
	fail := func(err error) (*Flag, string, bool, bool, float64, error) {
		return nil, "", false, false, 0, err
	}
	var variant *Variant
	if opts.Variant != "" {
		var ok bool
		if variant, ok = f.Variants[opts.Variant]; !ok {
			return fail(fmt.Errorf("%s has no variant %q", f.Meta.Name, opts.Variant))
		}
	}
	switch opts.Fit {
	case "", "error", "pad":
	default:
		return fail(fmt.Errorf("unknown fit %q", opts.Fit))
	}
	switch opts.Align {
	case "", "start", "center", "end":
	default:
		return fail(fmt.Errorf("unknown align %q", opts.Align))
	}
	switch opts.Side {
	case "", "obverse":
	case "reverse":
		if f.Reverse != nil {
			out.Layers, out.seenFromBehind = f.Reverse.Layers, true
		} else {
			mirror = true
		}
	default:
		return fail(fmt.Errorf("unknown side %q", opts.Side))
	}
	if variant != nil {
		turn, upright = variant.From, variant.Upright
		// The flag's outline and border were drawn for its own shape.
		if variant.Fly > 0 {
			out.Fly, out.Hoist = variant.Fly, variant.Hoist
			out.Outline, out.Border, out.BorderOutside = nil, nil, false
		}
		if len(variant.Layers) > 0 {
			// Its own design has nothing to do with the flag's reverse, so it's mirrored.
			out.Layers, out.Reverse, out.seenFromBehind = variant.Layers, nil, false
			mirror = opts.Side == "reverse"
		}
		if variant.Outline != nil {
			out.Outline = variant.Outline
		}
		if variant.Border != nil {
			out.Border, out.BorderOutside = variant.Border, variant.BorderOutside
		}
		if ratio == 0 {
			ratio = variant.Ratio
		}
	}
	if ratio == 0 {
		return &out, turn, upright, mirror, 0, nil
	}
	if opts.Fit == "pad" {
		adapted, err := out.withRatio(out.nearestRatio(ratio))
		if err != nil {
			// The rules allow that proportion, but this design can't reach it.
			adapted = &out
		}
		return adapted, turn, upright, mirror, ratio, nil
	}
	adapted, err := out.withRatio(ratio)
	if err != nil {
		return fail(err)
	}
	if opts.Fold != "" && out.Reverse != nil {
		// A fold shows the back as well, which adapts as it's seen from behind.
		back := out
		back.Layers, back.seenFromBehind = out.Reverse.Layers, true
		adaptedBack, err := back.withRatio(ratio)
		if err != nil {
			return fail(err)
		}
		adapted.Reverse = &Reverse{Layers: adaptedBack.Layers}
	}
	return adapted, turn, upright, mirror, 0, nil
}

// nearestRatio finds the proportion closest to a target that the flag's rules allow.
func (f *Flag) nearestRatio(target float64) float64 {
	current := f.Fly / f.Hoist
	if f.Adapt == nil {
		return current
	}
	if target > current && f.Adapt.Wider == "" || target < current && f.Adapt.Narrower == "" {
		return current
	}
	if f.Adapt.Min > 0 {
		target = max(target, f.Adapt.Min)
	}
	if f.Adapt.Max > 0 {
		target = min(target, f.Adapt.Max)
	}
	return target
}
