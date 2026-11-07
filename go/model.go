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
	// ColorRefs gives colors' values in other color systems, for print and dye.
	ColorRefs map[string][]ColorRef
	// Gradients maps palette names to gradients, usable wherever a color is.
	Gradients map[string]*Gradient
	// Hoist and Fly are the flag's proportion, which is also its grid.
	Hoist, Fly float64
	// Outline is the flag's shape, or nil for a rectangular flag.
	Outline *Outline
	Border  *Edge
	// BorderOutside adds the border around the flag's shape rather than within it.
	BorderOutside bool
	// Defines are reusable shapes and designs, by name.
	Defines map[string]*Define
	Layers  []Layer
	// Reverse is the flag's other side, or nil for a mirror image.
	Reverse *Reverse
	// Adapt says how the flag reaches other proportions, or nil if it doesn't.
	Adapt *Adapt
	// Variants are named forms of the flag, such as vertical or banner forms.
	Variants map[string]*Variant
	// Folds are named ways to fold the flag.
	Folds map[string]*Fold

	// idPrefix is unique to the source document, so that several flags can be
	// inlined in one page without their definitions colliding.
	idPrefix string
}

// Gradient is a linear blend between palette colors, across the shape it fills.
type Gradient struct {
	// Colors are the names of solid palette colors.
	Colors []string
	// Stops are each color's position from 0 to 1.
	Stops []float64
	// Along is fly, hoist, bend or bend-sinister.
	Along string
}

// Meta describes a flag and credits the people behind it.
type Meta struct {
	Name        string
	Description string
	// Version names this version of the flag, such as "50-star".
	Version string
	// Date is when this version took effect: YYYY, YYYY-MM or YYYY-MM-DD.
	Date string
	// Until is when this version stopped being current, if it has.
	Until string
	// Series links the versions of one flag, whatever each is called.
	Series string
	// Notes are remarks for anyone reading or using the flag or this file.
	Notes []string
	// Laws are the instruments that define or govern the flag.
	Laws []Reference
	// Restrictions are limits on using the flag, apart from copyright.
	Restrictions []Reference
	Designers    []string
	DesignRights string
	Encoders     []string
	License      string
	// RenderLicense is an added permission for images rendered from this file.
	RenderLicense string
	// AdaptedFrom lists the works this file derives from.
	AdaptedFrom []Adaptation
	Sources     []string
}

// Adaptation is a work that a file derives from, with what its license requires.
type Adaptation struct {
	URL     string
	Authors []string
	License string
	// Part says what was taken, or is empty if the whole file derives from it.
	Part string
}

// Reference is a named or described thing, with where it comes from.
type Reference struct {
	Text    string
	Sources []string
}

// ColorRef is a color's value in another system, such as Pantone or a named dye.
// Vexyl doesn't convert between systems, so it's only ever passed along.
type ColorRef struct {
	System, Value string
	// Numbers are the same value as numbers, for cmyk.
	Numbers []float64
	// Other is for a system named in a `reference`, rather than one of the format's own.
	Other bool
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

// Outline is a flag's silhouette.
type Outline struct {
	// Kind is polygon, path, swallowtail, tongued or pennant.
	Kind     string
	Vertices []Point
	D        string
	Box      [4]float64
	// Depth is how far a swallowtail or tongued flag is cut in from the fly.
	Depth float64
	// Tip is the width of a pennant's end, and Tongue of a tongued flag's tongue.
	Tip, Tongue float64
	// Taper narrows a swallowtail's ends by this much on each side.
	Taper float64
}

// Define is a reusable shape, or a design with layers.
type Define struct {
	Shape  *Shape
	Layers []Layer
	// Fly and Hoist give a design its own grid, scaled to fill where it's used.
	Fly, Hoist float64

	// size and height are worked out when it's read, as SPEC section 15 counts them.
	size, height int
}

// Reverse is a flag's other side, as seen from that side.
type Reverse struct {
	Layers []Layer
}

// Adapt says how a flag's layers reach another proportion.
type Adapt struct {
	// Min and Max limit the proportion as fly divided by hoist. Zero is no limit.
	Min, Max float64
	// Wider and Narrower are modes: extend, center, scale, hoist-extend,
	// hoist-center or hoist-scale. An empty mode means the flag can't go that way.
	Wider, Narrower string
}

// Variant is a named form of a flag.
type Variant struct {
	// From is how the design turns: none, rotate, transpose, half-turn or invert.
	From string
	// Upright keeps charges and emblems the right way up as the design turns.
	Upright bool
	// Ratio is the form's proportion as fly divided by hoist, or zero to keep it.
	Ratio float64
	// Fly and Hoist give the form its own true shape and grid, or are zero to keep the flag's.
	Fly, Hoist float64
	Outline    *Outline
	Border     *Edge
	// BorderOutside is as on a Flag.
	BorderOutside bool
	// Layers replace the flag's own if there are any.
	Layers []Layer
}

// Line is a wavy or zigzag edge between divisions.
type Line struct {
	// Kind is wavy or zigzag.
	Kind  string
	Depth float64
	// Period is the length of one wave, or Count how many fit the edge.
	Period float64
	Count  int
}

// Effects are the properties common to all layers.
type Effects struct {
	// Anchor is how this layer follows a change of proportion: start, center,
	// end or scale, or empty to follow the flag's rule.
	Anchor string
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

// Layer is one of Field, Bars, Chevrons, Band, Cross, Saltire, Quarters, Checks,
// Rays, Charge, Emblem, Group, Panel or Use.
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
	// Grow shares out any change of proportion between the bars.
	Grow []float64
	// Line shapes the edges between the bars.
	Line *Line
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
	Angle float64
	// Apex is how far along the edge the apex sits, or nil for the edge's middle.
	Apex      *float64
	Ratio     []float64
	Rotate    float64
	Fimbriate *Edge
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
	// Counterchange shows each arm on one side of its diagonal only, as the red
	// does on the Union Flag.
	Counterchange bool
}

// Quarters divides its region into four, by color from the upper hoist.
type Quarters struct {
	Effects
	Colors [4]string
	// Diagonal divides per saltire, with colors from the top going clockwise.
	Diagonal bool
	// Split is where the division falls, or nil for the middle.
	Split *Point
}

// Checks divides its region into a checkerboard, cycling through its colors.
type Checks struct {
	Effects
	Colors        []string
	Rows, Columns int
	// Flow is the diagonal that like colors run along: bend or bend-sinister.
	Flow string
}

// Rays divides its region into wedges from a point, going clockwise.
type Rays struct {
	Effects
	// Colors has one entry per wedge, with any count already applied.
	Colors []string
	// From is center, a corner or the middle of an edge. At overrides it.
	From   string
	At     *Point
	Ratio  []float64
	Rotate float64
	// ByEdge measures the ratio along the region's edge instead of by angle.
	ByEdge bool
}

// Charge paints a shape at a position, possibly repeatedly.
type Charge struct {
	Effects
	Shape Shape
	// Color is optional for inline SVG, where it's what currentColor means.
	Color     string
	Fimbriate *Edge
	Repeat    *Repeat
}

// Emblem places charges in their own frame: its origin is at a position, and its
// axes can run along one of the region's axes and be rotated further.
type Emblem struct {
	Effects
	// At is the frame's origin, or nil for the center of the region.
	At *Point
	// Along is an axis of the region for the frame's fly direction, or empty.
	Along   string
	Rotate  float64
	Charges []*Charge
}

// Group treats its layers as one, in its parent's region.
type Group struct {
	Effects
	Layers []Layer
}

// Panel is a new region within its parent, holding its own layers. A canton is a
// panel in the upper hoist corner.
type Panel struct {
	Effects
	// Side is hoist, fly, top or bottom, for a band along that edge.
	Side string
	// Width is the depth of a band from its edge.
	Width float64
	// Corner is upper-hoist, upper-fly, lower-hoist or lower-fly.
	Corner string
	// At places the panel's center, instead of a side or corner.
	At *Point
	// Fly and Hoist are the size of a corner or placed panel.
	Fly, Hoist float64
	// Line shapes a band's inner edge.
	Line   *Line
	Layers []Layer
	// Canton says it was written as a canton.
	Canton bool
}

// Use paints a design from a Define in the current region.
type Use struct {
	Effects
	Name string
	// design is the definition it names, which isn't part of the use itself.
	design *Define
}

// Shape is a shape used by a charge, clip or cut.
type Shape struct {
	// Kind is disc, ring, rect, plus, triangle, star, heart, cardioid, polygon,
	// crescent, sun, lozenge, path, pile, pall or svg.
	Kind string
	// At is the position, or nil for the center of the region.
	At *Point
	// Ats are the positions of a charge given several, each nil for the center.
	Ats    []*Point
	Rotate float64

	Radius float64
	// Inner is a ring's hole or a star's inner radius.
	Inner float64
	// Points is the number of points on a star.
	Points int
	// Width is the width of a plus's arms.
	Width float64
	// Spread is the distance between a heart's lobes, or the share from 0 to 1 of
	// its slot that each of a sun's rays fills.
	Spread float64
	// From and To limit a ring to an arc, clockwise from up, if HasArc is set.
	From, To float64
	HasArc   bool
	// Offset is how far a crescent's cut is from its center, toward the fly.
	Offset float64
	// Disc and Gap are a sun's disc radius and the space around it.
	Disc, Gap float64
	// Hollow draws the shape as an outline of this width.
	Hollow float64
	// Lines draws a star's chords, at this width.
	Lines float64
	// D and Box are a path's data and the box it's drawn in.
	D   string
	Box [4]float64
	// EvenOdd is a path's fill rule.
	EvenOdd bool
	// Edge is the edge a pile or pall starts from.
	Edge string
	// Base is the part of the edge a pile covers, or nil for all of it.
	Base *[2]float64
	// Tip is a pile's point along the edge, then in from it.
	Tip *[2]float64
	// Depth and Flat are how far in a pile reaches and the width it's cut at.
	Depth, Flat float64
	// Junction is how far in from its edge a pall's arms meet, if not zero.
	Junction float64
	// Fly and Hoist are the size of a rect or inline SVG.
	Fly, Hoist float64
	// Vertices are a polygon's points.
	Vertices []Point
	// Markup is an inline SVG after being sanitized, with its IDs as they were written.
	Markup string

	// placed records an explicit `at`, even `at center`.
	placed bool
	// autoInner and autoSpread record values worked out from the shape's others, which
	// change if a charge using a definition changes those.
	autoInner, autoSpread bool
	embedded              *embeddedSVG
}

// Repeat paints a charge several times.
type Repeat struct {
	// Kind is ring, arc, grid or line.
	Kind string

	// Count, Radius and Turn describe a ring or arc.
	Count  int
	Radius float64
	Turn   bool
	// From and To are an arc's ends, clockwise from up.
	From, To float64

	// Rows, Columns and Stagger describe a grid.
	Rows, Columns int
	Stagger       bool

	// Count, Fly and Hoist describe a line, with Fly and Hoist the step between
	// copies.
	Fly, Hoist float64
}
