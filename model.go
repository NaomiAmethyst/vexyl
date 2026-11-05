// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Package vexyl is the reference implementation of the Vexyl flag format,
// specified in SPEC.md. Parse reads a document, and Flag.WriteSVG renders it.
package vexyl

// Flag is a parsed and validated Vexyl document.
type Flag struct {
	Version int
	Meta    Meta
	// Palette maps color names to #rrggbb values.
	Palette map[string]string
	// Hoist and Fly are the flag's proportion, which is also its grid.
	Hoist, Fly float64
	// Outline is the flag's shape, or nil for a rectangular flag.
	Outline []Point
	Border  *Edge
	// BorderOutside adds the border around the flag's shape rather than within it.
	BorderOutside bool
	Layers        []Layer

	// idPrefix is unique to the source document, so that several flags can be
	// inlined in one page without their definitions colliding.
	idPrefix string
}

// Meta describes a flag and credits the people behind it.
type Meta struct {
	Name         string
	Description  string
	Designers    []string
	DesignRights string
	Encoders     []string
	License      string
	Sources      []string
}

// Point is a position in grid units: Fly from the hoist edge of the region,
// and Hoist down from its top.
type Point struct {
	Fly, Hoist float64
}

// Edge is a colored edge of a given width, used for borders and fimbriation.
type Edge struct {
	Color string
	Width float64
}

// Effects are the properties common to all layers.
type Effects struct {
	// Opacity runs from 0 to 1.
	Opacity float64
	// Blend is a blend mode, or "normal".
	Blend string
	// Clip keeps only what's inside a shape, if set.
	Clip *Shape
	// Cuts remove what's inside each shape.
	Cuts []Shape
}

func (e *Effects) effects() *Effects { return e }

// Layer is one of Field, Bars, Chevrons, Band, Cross, Saltire, Charge, Group or
// Canton.
type Layer interface {
	effects() *Effects
}

// Field fills its region with a color.
type Field struct {
	Effects
	Color string
}

// Bars divides its region into straight bars.
type Bars struct {
	Effects
	// Colors has one entry per bar, with any count already applied.
	Colors []string
	Along  string
	Ratio  []float64
	Rotate float64
}

// Chevrons nests V-shaped bands outward from an edge of its region.
type Chevrons struct {
	Effects
	// Colors are listed from the edge outward.
	Colors []string
	From   string
	Depth  float64
	// Angle is between each arm and the center line, or 0 for arms that meet
	// the edge's corners.
	Angle  float64
	Ratio  []float64
	Rotate float64
}

// Band is a straight band centered on its region.
type Band struct {
	Effects
	Color     string
	Along     string
	Width     float64
	Offset    float64
	Rotate    float64
	Fimbriate *Edge
}

// Cross is a cross of two arms, each described by the distance before the arm,
// its width and the distance after it.
type Cross struct {
	Effects
	Color     string
	FlyParts  [3]float64
	HoistPart [3]float64
	Fimbriate *Edge
}

// Saltire is a diagonal cross following the region's corners.
type Saltire struct {
	Effects
	Color     string
	Width     float64
	Fimbriate *Edge
}

// Charge paints a shape at a position, possibly repeatedly.
type Charge struct {
	Effects
	Shape Shape
	// Color is empty for inline SVG, which has its own colors.
	Color     string
	Fimbriate *Edge
	Repeat    *Repeat
}

// Group treats its layers as one, in its parent's region.
type Group struct {
	Effects
	Layers []Layer
}

// Canton is a new region in the upper hoist corner of its parent.
type Canton struct {
	Effects
	Fly, Hoist float64
	Layers     []Layer
}

// Shape is a shape used by a charge, clip or cut.
type Shape struct {
	// Kind is disc, ring, rect, plus, triangle, star, cardioid, polygon or svg.
	Kind string
	// At is the position, or nil for the center of the region.
	At     *Point
	Rotate float64

	Radius float64
	// Inner is a ring's hole or a star's inner radius.
	Inner float64
	// Points is the number of points on a star.
	Points int
	// Width is the width of a plus's arms.
	Width float64
	// Fly and Hoist are the size of a rect or inline SVG.
	Fly, Hoist float64
	// Vertices are a polygon's points.
	Vertices []Point
	// Markup is the source of an inline SVG.
	Markup string

	// placed records an explicit `at`, even `at center`.
	placed   bool
	embedded *embeddedSVG
}

// Repeat paints a charge several times.
type Repeat struct {
	// Kind is ring or grid.
	Kind string

	// Count, Radius and Turn describe a ring.
	Count  int
	Radius float64
	Turn   bool

	// Rows, Columns and Stagger describe a grid.
	Rows, Columns int
	Stagger       bool
}
