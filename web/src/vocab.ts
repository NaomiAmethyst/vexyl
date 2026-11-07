// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// The format's vocabulary as tables, from SPEC.md. The form draws itself from these, so a term here
// is a term the form can edit, and anything in a file that isn't here is shown as being only in
// the source. Nothing's ever lost either way, because an edit only touches what it's about.

export type Choice = readonly [value: string, label: string];

/** When a field means something, given the rest of the term. One with a value is always shown. */
export interface When {
	has?: string;
	lacks?: readonly string[];
	is?: readonly [child: string, values: readonly string[]];
	isnt?: readonly [child: string, values: readonly string[]];
	argIs?: readonly [arg: number, values: readonly string[]];
}

export type Field = FieldKind & { when?: When };

type FieldKind =
	| { k: "heading"; label: string; grid?: boolean }
	| { k: "colorArg"; label: string; i: number; optional?: boolean; note?: string }
	| { k: "colorArgs"; label: string; from: number; note?: string }
	| { k: "num"; label: string; child: string; note?: string; wide?: boolean }
	| { k: "nums"; label: string; child: string; count?: number; note?: string; hints?: readonly string[] }
	| { k: "choice"; label: string; child: string; options: readonly Choice[]; none?: string; note?: string }
	| { k: "flag"; label: string; child: string; note?: string }
	| { k: "text"; label: string; child: string; wide?: boolean; note?: string; mono?: boolean; long?: boolean }
	| { k: "texts"; label: string; child: string; add: string; note?: string; link?: boolean }
	| { k: "records"; label: string; child: string; add: string; arg: string; fields: readonly Field[]; note?: string; skeleton: string }
	| { k: "at"; label: string; note?: string; many?: boolean }
	| { k: "props"; label: string; child: string; props: readonly (readonly [string, string])[]; note?: string }
	| { k: "propNum"; label: string; prop: string; note?: string }
	| { k: "argText"; label: string; i: number; note?: string; mono?: boolean; readonly?: boolean }
	| { k: "argNum"; label: string; i: number; note?: string }
	| { k: "argChoice"; label: string; i: number; options: readonly Choice[]; none?: string; note?: string }
	| { k: "edge" }
	| { k: "fimbriate" }
	| { k: "repeat" }
	| { k: "steps" }
	| { k: "reference" }
	| { k: "points"; label: string; child: string }
	| { k: "artwork" }
	| { k: "defineArg" };

export interface Term {
	label: string;
	desc: string;
	fields: readonly Field[];
	/** The node's other args and props that fields don't read, for telling what's only in the source. */
	kind: "layer" | "holder" | "part";
	/** A new one, with `{a}` and `{b}` for colors from the palette. */
	skeleton?: string;
	/** Whether its own children are layers, listed as its rows. */
	layers?: boolean;
	/** Whether it's one of a charge's kinds. */
	note?: string;
}

const axis: readonly Choice[] = [["fly", "Fly"], ["hoist", "Hoist"], ["bend", "Bend"], ["bend-sinister", "Bend sinister"]];
const edge: readonly Choice[] = [["hoist", "Hoist"], ["fly", "Fly"], ["top", "Top"], ["bottom", "Bottom"]];
const corners: readonly Choice[] = [["upper-hoist", "Upper hoist"], ["upper-fly", "Upper fly"], ["lower-hoist", "Lower hoist"], ["lower-fly", "Lower fly"]];

export const common: readonly Field[] = [
	{ k: "num", label: "Opacity", child: "opacity", note: "From 0, invisible, to 1, solid." },
	{ k: "choice", label: "Blend", child: "blend", none: "normal", options: [["normal", "Normal"], ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"], ["darken", "Darken"], ["lighten", "Lighten"]] },
	{ k: "choice", label: "Anchor", child: "anchor", none: "", options: [["", "By the rule"], ["start", "Start"], ["center", "Center"], ["end", "End"], ["scale", "Scale"]], note: "Where this stays if the flag is made wider or narrower." },
];

const size2: readonly Field[] = [{ k: "num", label: "Width, along the fly", child: "fly" }, { k: "num", label: "Height, along the hoist", child: "hoist" }];
const rotated: Field = { k: "num", label: "Rotate", child: "rotate", note: "Degrees clockwise." };
const unevenly: Field = { k: "nums", label: "Ratio", child: "ratio", note: "One number for each color, so 1 2 1 makes the middle twice as wide. Without one, they're equal." };
const hollowLayer: Field = { k: "num", label: "Hollow", child: "hollow", note: "Draws only an outline this thick. Leave it empty for solid." };

export const layers: Readonly<Record<string, Term>> = {
	field: {
		label: "Field", desc: "A solid background that fills its region.", kind: "layer", skeleton: "field {a}",
		fields: [{ k: "colorArg", label: "Color", i: 0 }],
	},
	bars: {
		label: "Bars", desc: "Straight stripes across the region, repeating the colors you give.", kind: "layer", skeleton: "bars {a} {b}",
		fields: [
			{ k: "colorArgs", label: "Colors, in order", from: 0 },
			{ k: "choice", label: "Runs along", child: "along", options: axis, none: "fly" },
			{ k: "num", label: "Count", child: "count", note: "Cycles through the colors until there are this many bars." },
			unevenly,
			{ k: "heading", label: "More" },
			rotated,
			{ k: "edge" },
			{ k: "nums", label: "Grow", child: "grow", note: "How the bars share a change of proportion." },
		],
	},
	chevrons: {
		label: "Chevrons", desc: "V shapes nested out from one edge. The first color is the innermost.", kind: "layer", skeleton: "chevrons {a} {b} {\n  depth 1\n}",
		fields: [
			{ k: "colorArgs", label: "Colors, from the edge out", from: 0 },
			{ k: "choice", label: "From", child: "from", options: edge, none: "hoist" },
			{ k: "heading", label: "Size", grid: true },
			{ k: "num", label: "Depth", child: "depth", note: "From the edge to the outermost apex." },
			{ k: "num", label: "Angle", child: "angle", note: "Between each arm and the center line, in degrees." },
			{ k: "num", label: "Apex", child: "apex", note: "Moves the center line along the edge.", when: { has: "angle" } },
			unevenly,
			{ k: "heading", label: "More" },
			rotated,
			{ k: "fimbriate" },
		],
	},
	band: {
		label: "Band", desc: "One straight stripe, centered on its region unless it's offset.", kind: "layer", skeleton: "band {a} {\n  width 1\n}",
		fields: [
			{ k: "colorArg", label: "Color", i: 0 },
			{ k: "choice", label: "Runs along", child: "along", options: axis, none: "fly" },
			{ k: "heading", label: "Size", grid: true },
			{ k: "num", label: "Width", child: "width" },
			{ k: "num", label: "Offset", child: "offset", note: "How far it sits from the middle." },
			{ k: "heading", label: "More" },
			rotated,
			{ k: "fimbriate" },
		],
	},
	cross: {
		label: "Cross", desc: "Reads as a construction sheet does: the distance before each arm, its width, and the distance after.", kind: "layer", skeleton: "cross {a} {\n  fly 5 2 9\n  hoist 4 2 4\n}",
		fields: [
			{ k: "colorArg", label: "Color", i: 0 },
			{ k: "heading", label: "Size", grid: true },
			{ k: "nums", label: "Along the fly", child: "fly", count: 3, hints: ["Before", "Width", "After"] },
			{ k: "nums", label: "Along the hoist", child: "hoist", count: 3, hints: ["Before", "Width", "After"] },
			{ k: "heading", label: "More" },
			{ k: "fimbriate" },
		],
	},
	saltire: {
		label: "Saltire", desc: "Two bands that cross along the diagonals.", kind: "layer", skeleton: "saltire {a} {\n  width 1\n}",
		fields: [
			{ k: "colorArg", label: "Color", i: 0 },
			{ k: "heading", label: "Size", grid: true },
			{ k: "num", label: "Width", child: "width" },
			{ k: "heading", label: "More" },
			{ k: "flag", label: "Counterchange", child: "counterchange", note: "Each arm shows only on one side of its diagonal, as on the Union Flag." },
			{ k: "fimbriate" },
		],
	},
	quarters: {
		label: "Quarters", desc: "Divides its region in four: upper hoist, upper fly, lower hoist, lower fly.", kind: "layer", skeleton: "quarters {a} {b} {b} {a}",
		fields: [
			{ k: "colorArgs", label: "Four colors", from: 0 },
			{ k: "flag", label: "Diagonal", child: "diagonal", note: "Divides per saltire: top, fly, bottom, hoist.", when: { lacks: ["split"] } },
			{ k: "props", label: "Crossing point", child: "split", props: [["fly", "Fly"], ["hoist", "Hoist"]], note: "Leave it empty for the middle.", when: { lacks: ["diagonal"] } },
		],
	},
	checks: {
		label: "Checks", desc: "A checkerboard.", kind: "layer", skeleton: "checks {a} {b} {\n  rows 2\n  columns 3\n}",
		fields: [
			{ k: "colorArgs", label: "Colors", from: 0 },
			{ k: "num", label: "Rows", child: "rows" },
			{ k: "num", label: "Columns", child: "columns" },
			{ k: "choice", label: "Flow", child: "flow", options: [["bend-sinister", "Bend sinister"], ["bend", "Bend"]], none: "bend-sinister" },
		],
	},
	rays: {
		label: "Rays", desc: "Wedges spreading from a point, going clockwise.", kind: "layer", skeleton: "rays {a} {b} {\n  count 8\n}",
		fields: [
			{ k: "colorArgs", label: "Colors", from: 0 },
			{ k: "choice", label: "From", child: "from", none: "center", options: [["center", "Center"], ...corners, ...edge], note: "A position elsewhere is kept, and can be changed in the source." },
			{ k: "num", label: "Count", child: "count" },
			unevenly,
			{ k: "choice", label: "Measure", child: "measure", options: [["angle", "Angle"], ["edge", "Edge"]], none: "angle" },
			{ ...rotated, when: { isnt: ["measure", ["edge"]] } },
		],
	},
	pile: {
		label: "Pile", desc: "A triangle or trapezoid pointing in from one edge.", kind: "layer", skeleton: "pile {a} {\n  depth 2\n}",
		fields: [
			{ k: "colorArg", label: "Color", i: 0 },
			{ k: "choice", label: "From", child: "from", options: edge, none: "hoist" },
			{ k: "heading", label: "Size", grid: true },
			{ k: "num", label: "Depth", child: "depth", note: "How far in its point reaches.", when: { lacks: ["tip"] } },
			{ k: "nums", label: "Base", child: "base", count: 2, hints: ["Starts", "Ends"], note: "The part of the edge it stands on. Leave it empty for all of it." },
			{ k: "nums", label: "Tip", child: "tip", count: 2, hints: ["Along the edge", "In from it"], note: "Along the edge and in from it, instead of a depth.", when: { lacks: ["depth"] } },
			{ k: "num", label: "Flat", child: "flat", note: "Cuts its point off at this width." },
			{ k: "heading", label: "More" },
			hollowLayer,
			{ k: "fimbriate" },
		],
	},
	pall: {
		label: "Pall", desc: "A Y: two arms from an edge's corners, then one stem.", kind: "layer", skeleton: "pall {a} {\n  width 1\n}",
		fields: [
			{ k: "colorArg", label: "Color", i: 0 },
			{ k: "choice", label: "From", child: "from", options: edge, none: "hoist" },
			{ k: "heading", label: "Size", grid: true },
			{ k: "num", label: "Width", child: "width" },
			{ k: "num", label: "Junction", child: "junction", note: "How far in from the edge." },
			{ k: "heading", label: "More" },
			hollowLayer,
			{ k: "fimbriate" },
		],
	},
	charge: { label: "Charge", desc: "A shape placed at a position.", kind: "layer", skeleton: "charge disc {a} {\n  radius 1\n}", fields: [] },
	emblem: {
		label: "Emblem", desc: "Charges drawn together in their own frame, measured from each other, so they move and turn as one.", kind: "holder", layers: true, skeleton: "emblem {\n  charge disc {a} {\n    radius 1\n  }\n}",
		fields: [
			{ k: "at", label: "Frame's origin" },
			{ k: "choice", label: "Follows", child: "along", none: "", options: [["", "Nothing"], ...axis] },
			rotated,
		],
	},
	group: { label: "Group", desc: "Holds layers so that opacity, blending or cutting applies to all of them at once.", kind: "holder", layers: true, skeleton: "group {\n  field {a}\n}", fields: [] },
	panel: {
		label: "Panel", desc: "A new region within its parent, with its own origin: along an edge, in a corner, or anywhere.", kind: "holder", layers: true, skeleton: "panel {\n  side hoist\n  width 1\n  field {a}\n}",
		fields: [
			{ k: "heading", label: "Placement" },
			{ k: "choice", label: "Side", child: "side", none: "", options: [["", "None"], ...edge], when: { lacks: ["corner"] } },
			{ k: "choice", label: "Corner", child: "corner", none: "", options: [["", "None"], ...corners], when: { lacks: ["side"] } },
			{ k: "at", label: "Center", when: { lacks: ["side", "corner"] } },
			{ k: "heading", label: "Size", grid: true },
			{ k: "num", label: "Width", child: "width", when: { has: "side" } },
			...size2.map((f) => ({ ...f, when: { lacks: ["side"] } })),
			{ k: "heading", label: "More" },
			{ k: "edge" },
		],
	},
	canton: {
		label: "Canton", desc: "A panel in the upper hoist corner, with its own field and charges.", kind: "holder", layers: true, skeleton: "canton {\n  fly 2\n  hoist 1\n  field {a}\n}",
		fields: [
			{ k: "heading", label: "Size", grid: true },
			...size2,
		],
	},
	use: {
		label: "Use", desc: "Paints a definition here.", kind: "layer",
		fields: [{ k: "defineArg" }],
	},
};

const radius: Field = { k: "num", label: "Radius", child: "radius", note: "From its center to its edge." };
const hollow: Field = { k: "num", label: "Hollow", child: "hollow", note: "Draws only an outline this thick. Leave it empty for solid." };
const size: readonly Field[] = size2;

export interface ShapeTerm {
	label: string;
	desc?: string;
	fields: readonly Field[];
	skeleton: string;
	/** Whether it takes `at` and `rotate`. A polygon is placed by its points. */
	unplaced?: boolean;
}

export const shapes: Readonly<Record<string, ShapeTerm>> = {
	disc: { label: "Disc", desc: "A filled circle.", fields: [radius, hollow], skeleton: "radius 1" },
	ellipse: { label: "Ellipse", desc: "An oval.", fields: [...size, hollow], skeleton: "fly 2\nhoist 1" },
	ring: { label: "Ring", desc: "A circle with a hole, or part of one.", fields: [radius, { k: "num", label: "Inner", child: "inner" }, { k: "num", label: "From", child: "from", note: "An arc's start, in degrees clockwise from up." }, { k: "num", label: "To", child: "to", when: { has: "from" } }], skeleton: "radius 1\ninner 0.5" },
	rect: { label: "Rectangle", desc: "A rectangle of any size.", fields: [...size, hollow], skeleton: "fly 2\nhoist 1" },
	plus: { label: "Plus", desc: "An equal-armed cross.", fields: [{ ...radius, note: "From its center to the end of an arm." }, { k: "num", label: "Width", child: "width" }, hollow], skeleton: "radius 1\nwidth 0.25" },
	triangle: { label: "Triangle", desc: "An equilateral triangle, point up.", fields: [radius, hollow], skeleton: "radius 1" },
	star: {
		label: "Star", desc: "A star with any number of points, one straight up.",
		fields: [{ ...radius, note: "From its center to a point." }, { k: "num", label: "Points", child: "points", note: "5 if it's left out. Under 5, it needs an inner." }, { k: "num", label: "Inner", child: "inner", note: "From its center to the notches. Leave it empty for a regular star." }, { k: "num", label: "Lines", child: "lines", note: "Draws it as lines between its points, like a pentagram.", when: { lacks: ["hollow"] } }, { ...hollow, when: { lacks: ["lines"] } }],
		skeleton: "radius 1",
	},
	crescent: { label: "Crescent", desc: "A circle with another cut from it, opening to the right.", fields: [radius, { k: "num", label: "Inner", child: "inner", note: "The size of the circle cut away." }, { k: "num", label: "Offset", child: "offset", note: "How far right of center that circle sits." }, hollow], skeleton: "radius 1\ninner 0.8\noffset 0.3" },
	sun: {
		label: "Sun", desc: "A circle with triangular rays, one straight up.",
		fields: [{ ...radius, note: "From its center to a ray's tip." }, { k: "num", label: "Disc", child: "disc" }, { k: "num", label: "Gap", child: "gap", note: "Between the circle and the rays." }, { k: "num", label: "Points", child: "points", note: "12 if it's left out." }, { k: "num", label: "Spread", child: "spread", note: "The share of its slice each ray fills." }, hollow],
		skeleton: "radius 2\ndisc 1",
	},
	lozenge: { label: "Lozenge", desc: "A rhombus.", fields: [...size, hollow], skeleton: "fly 2\nhoist 1" },
	heart: { label: "Heart", desc: "A heart, tip down.", fields: [{ ...radius, note: "The radius of each lobe." }, { k: "num", label: "Spread", child: "spread", note: "Between the lobes' centers." }, hollow], skeleton: "radius 1" },
	cardioid: { label: "Cardioid", desc: "A heart-like curve, with its dip at the position and its lobe below.", fields: [{ ...radius, note: "From the dip to its farthest point." }, hollow], skeleton: "radius 1" },
	path: {
		label: "Path", desc: "Any shape, from SVG path data.",
		fields: [
			{ k: "text", label: "Path data", child: "d", wide: true, mono: true, long: true, note: "As in an SVG path's d attribute." },
			{ k: "text", label: "Box", child: "box", mono: true, note: "The area it's drawn in: x y width height." },
			...size,
			{ k: "flag", label: "Even-odd", child: "evenodd", note: "Leaves overlaps as holes." },
			hollow,
		],
		skeleton: 'd "M0 0H1V1Z"\nbox "0 0 1 1"\nfly 1',
	},
	polygon: { label: "Polygon", desc: "A straight-edged shape, from its corner points.", fields: [{ k: "points", label: "Points", child: "point" }, hollow], skeleton: "point fly=0 hoist=0\npoint fly=1 hoist=0\npoint fly=0 hoist=1", unplaced: true },
	svg: { label: "Inline artwork", desc: "An SVG drawing, for lettering, seals or detailed artwork.", fields: [...size, { k: "artwork" }], skeleton: 'fly 1\nhoist 1\nmarkup #"""\n  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#888888"/></svg>\n  """#' },
};

const textField = (label: string, child: string, wide = false, note?: string): Field => (note === undefined ? { k: "text", label, child, wide } : { k: "text", label, child, wide, note });

const sources: Field = { k: "texts", label: "Sources", child: "source", add: "Add a source", link: true };

export const parts: Readonly<Record<string, Term>> = {
	meta: {
		label: "Details", desc: "What this flag is, what it rests on, and who made it. None of this changes how it looks.", kind: "part",
		fields: [
			{ k: "heading", label: "The flag" },
			textField("Name", "name", true),
			textField("Description", "description", true),
			textField("Version", "version", false, "Which one this is, if it has changed over time, such as 50-star."),
			textField("Date", "date", false, "When this version came into use: a year, a month or a day."),
			textField("Until", "until", false, "When this version stopped being current."),
			textField("Series", "series", false, "Links the versions of one flag, in lowercase words joined by hyphens."),
			{ k: "texts", label: "Notes", child: "note", add: "Add a note" },
			{ k: "heading", label: "What it rests on" },
			{ k: "records", label: "Laws", child: "law", add: "Add a law", arg: "Law", skeleton: 'law "New law"', fields: [sources] },
			{ k: "records", label: "Restrictions", child: "restriction", add: "Add a restriction", arg: "Restriction", skeleton: 'restriction "New restriction" {\n  source "https://example.org/"\n}', fields: [sources], note: "A limit on using the flag, apart from copyright. It needs a source." },
			{ k: "heading", label: "Credit and license" },
			{ k: "texts", label: "Designers", child: "designer", add: "Add a designer", note: "Who designed the flag itself." },
			textField("Design rights", "design-rights", false, "Any rights in the design itself, in words or as an SPDX ID."),
			{ k: "texts", label: "Encoders", child: "encoder", add: "Add an encoder", note: "Who wrote this file." },
			textField("License", "license", false, "How others may use this file, as an SPDX ID."),
			textField("Render license", "render-license", false, "A more generous license for images made from it, if you want one."),
			{
				k: "records", label: "Adapted from", child: "adapted-from", add: "Add a work", arg: "URL", skeleton: 'adapted-from "https://example.org/"',
				fields: [{ k: "texts", label: "Authors", child: "author", add: "Add an author" }, textField("License", "license"), textField("Part", "part", true, "What was taken. Leaving it out means the whole file derives from the work.")],
			},
			sources,
		],
	},
	proportion: {
		label: "Proportion", desc: "The flag's height, called its hoist, and its width, called its fly. Together they set its shape and the grid every size is measured on.", kind: "part",
		fields: [{ k: "propNum", label: "Hoist", prop: "hoist" }, { k: "propNum", label: "Fly", prop: "fly" }],
	},
	outline: {
		label: "Outline", desc: "A shape other than a rectangle, such as a swallowtail or a pennant, which everything paints inside.", kind: "part", skeleton: "outline swallowtail {\n  depth 1\n}",
		fields: [
			{ k: "argChoice", label: "Form", i: 0, none: "", options: [["swallowtail", "Swallowtail"], ["tongued", "Tongued"], ["pennant", "Pennant"]], note: "A polygon or path outline is edited in the source." },
			{ k: "num", label: "Depth", child: "depth", note: "How far the cut reaches in from the fly.", when: { argIs: [0, ["swallowtail", "tongued"]] } },
			{ k: "num", label: "Taper", child: "taper", note: "Narrows the ends of the tails.", when: { argIs: [0, ["swallowtail"]] } },
			{ k: "num", label: "Tongue", child: "tongue", when: { argIs: [0, ["tongued"]] } },
			{ k: "num", label: "Tip", child: "tip", note: "Leave it empty to narrow all the way to a point.", when: { argIs: [0, ["pennant"]] } },
		],
	},
	border: {
		label: "Border", desc: "A band of color around the flag's edge.", kind: "part", skeleton: "border {a} 1",
		fields: [
			{ k: "colorArg", label: "Color", i: 0 },
			{ k: "argNum", label: "Width", i: 1 },
			{ k: "argChoice", label: "Side", i: 2, none: "inside", options: [["inside", "Inside"], ["outside", "Outside"]], note: "Outside makes the finished flag larger than its grid." },
		],
	},
	reverse: { label: "Reverse", desc: "The back of the flag, if it isn't the mirror image of the front. Its layers are written as seen from that side.", kind: "part", layers: true, skeleton: "reverse {\n  field {a}\n}", fields: [] },
	adapt: {
		label: "Adapt", desc: "How the flag reaches other proportions. A design whose shape is fixed by law says nothing here.", kind: "part", skeleton: "adapt {\n  wider extend\n  narrower cut\n}",
		fields: [
			{ k: "nums", label: "Range", child: "range", count: 2, hints: ["Lowest", "Highest"], note: "As fly divided by hoist." },
			{ k: "choice", label: "Wider", child: "wider", none: "", options: [["", "Refuse"], ["extend", "Extend"], ["center", "Center"], ["scale", "Scale"], ["hoist-extend", "Hoist extend"], ["hoist-center", "Hoist center"], ["hoist-scale", "Hoist scale"]] },
			{ k: "choice", label: "Narrower", child: "narrower", none: "", options: [["", "Refuse"], ["cut", "Cut"], ["extend", "Extend"], ["center", "Center"], ["scale", "Scale"], ["hoist-extend", "Hoist extend"], ["hoist-center", "Hoist center"], ["hoist-scale", "Hoist scale"]] },
		],
	},
	variant: {
		label: "Variant", desc: "Another form of this flag, such as one hung vertically or flown upside down.", kind: "part", layers: true, skeleton: "variant {name} {\n  from transpose\n  upright\n}",
		fields: [
			{ k: "choice", label: "Turns by", child: "from", none: "none", options: [["none", "None"], ["rotate", "Quarter turn clockwise"], ["counter-rotate", "Quarter turn counterclockwise"], ["half-turn", "Half turn"], ["transpose", "Across the diagonal"], ["anti-transpose", "Across the other diagonal"], ["invert", "Upside down"], ["mirror", "Mirrored"]] },
			{ k: "flag", label: "Keep charges upright", child: "upright", note: "Turns each charge back the right way up, where it now sits.", when: { isnt: ["from", ["", "none"]] } },
			{ k: "num", label: "Ratio", child: "ratio", note: "As fly divided by hoist, before turning. It needs the flag's adapt rules.", when: { lacks: ["proportion"] } },
			{ k: "props", label: "Its own proportion", child: "proportion", props: [["hoist", "Hoist"], ["fly", "Fly"]], note: "For a form with its own design. It needs its own layers, drawn on this grid.", when: { lacks: ["ratio"] } },
		],
	},
	fold: {
		label: "Fold", desc: "A way to fold the flag for storage or ceremony, shown step by step.", kind: "part", skeleton: 'fold {name} {\n  description "In half lengthwise"\n  over along=fly at=1 move=bottom\n}',
		fields: [textField("Description", "description", true), sources, { k: "steps" }],
	},
	define: {
		label: "Definition", desc: "A shape or design with a name, for using several times in this flag, still all in one file.", kind: "part", layers: true, skeleton: "define {name} {\n  charge disc {a} {\n    radius 1\n  }\n}",
		fields: [{ k: "propNum", label: "Its own hoist", prop: "hoist" }, { k: "propNum", label: "Its own fly", prop: "fly" }],
	},
};

/** A palette entry's fields, for a solid color. */
export const colorFields: readonly Field[] = [
	{ k: "argText", label: "On screen", i: 0, mono: true, note: "The color that's drawn, as #rrggbb." },
	{ k: "heading", label: "For printing and manufacture" },
	textField("Pantone", "pantone"),
	textField("NCS", "ncs"),
	textField("RAL", "ral"),
	textField("Munsell", "munsell"),
	textField("Thread", "thread"),
	{ k: "texts", label: "Dyes", child: "dye", add: "Add a dye" },
	{ k: "nums", label: "CMYK", child: "cmyk", count: 4, hints: ["C", "M", "Y", "K"] },
	{ k: "reference" },
];

export const gradientFields: readonly Field[] = [
	{ k: "colorArgs", label: "Colors", from: 1 },
	{ k: "choice", label: "Along", child: "along", options: axis, none: "fly" },
	{ k: "nums", label: "Stops", child: "stops", note: "Where each color sits, from 0 at the start to 1 at the end." },
];

/** A charge's own fields, before its shape's. */
export const chargeFields: readonly Field[] = [
	{ k: "colorArg", label: "Color", i: 1 },
];

/** Where a symbol goes, once its size has been given. */
export const placeFields: readonly Field[] = [
	{ k: "heading", label: "Placement" },
	{ k: "at", label: "Positions", many: true, note: "Empty means the center. More than one draws it several times." },
	{ k: "num", label: "Rotate", child: "rotate", note: "Degrees clockwise, about its position." },
	{ k: "repeat" },
	{ k: "heading", label: "More" },
	{ k: "fimbriate" },
];

export const repeatForms: Readonly<Record<string, readonly (readonly [string, string, "num" | "bool"])[]>> = {
	grid: [["rows", "Rows", "num"], ["columns", "Columns", "num"], ["stagger", "Stagger", "bool"]],
	ring: [["count", "Count", "num"], ["radius", "Radius", "num"], ["turn", "Turn each to face out", "bool"]],
	arc: [["count", "Count", "num"], ["radius", "Radius", "num"], ["from", "From", "num"], ["to", "To", "num"], ["turn", "Turn each to face out", "bool"]],
	line: [["count", "Count", "num"], ["fly", "Step along the fly", "num"], ["hoist", "Step along the hoist", "num"]],
};

export const stepKinds: readonly Choice[] = [["over", "Over"], ["under", "Under"], ["tuck", "Tuck"]];

/** Where something sits, in the words the form uses. */
export const placeLabel = (value: string): string => [...edge, ...corners].find(([v]) => v === value)?.[1] ?? value;

/** What "Add to the flag" offers. */
export const addable: readonly { group: string; top?: boolean; items: readonly (readonly [string, string])[] }[] = [
	{ group: "Divisions", items: ["field", "bars", "band", "cross", "saltire", "quarters", "chevrons", "checks", "rays", "pile", "pall"].map((k) => [k, layers[k]!.label] as const) },
	{ group: "Charges", items: Object.entries(shapes).map(([k, sh]) => [`charge:${k}`, sh.label] as const) },
	{ group: "Holders", items: ["canton", "panel", "emblem", "group"].map((k) => [k, layers[k]!.label] as const) },
	{ group: "Flag", top: true, items: [["outline", "Outline"], ["border", "Border"], ["define", "Definition"], ["reverse", "Reverse"], ["adapt", "Adapt"], ["variant", "Variant"], ["fold", "Fold"]] },
	{ group: "Colors", top: true, items: [["color", "Color"], ["gradient", "Gradient"]] },
];

/** A line saying what something in the add menu is. */
export function describeTerm(key: string): string {
	if (key === "color") {
		return "A new color in this flag's palette.";
	}
	if (key === "gradient") {
		return "A blend between colors, usable wherever a color is.";
	}
	if (key.startsWith("charge:")) {
		return shapes[key.slice(7)]?.desc ?? "";
	}
	return layers[key]?.desc ?? parts[key]?.desc ?? "";
}

/** What the flag can only have one of, so isn't offered again. */
export const onlyOnce: ReadonlySet<string> = new Set(["outline", "border", "reverse", "adapt"]);

export type NameKind = "variant" | "fold" | "define" | "color";

const firstNames: Readonly<Record<string, string>> = { variant: "vertical", fold: "half", define: "badge", color: "new-color", gradient: "new-gradient" };

/** The names a kind of term already uses. */
export function takenNames(kind: NameKind, nodes: readonly { name: string; args: readonly { v: unknown }[]; kids: readonly { name: string }[] }[]): string[] {
	if (kind === "color") {
		return nodes.find((n) => n.name === "palette")?.kids.map((k) => k.name) ?? [];
	}
	return nodes.filter((n) => n.name === kind).map((n) => String(n.args[0]?.v));
}

/** The name a new term starts with, if it's the kind that has one, unused so far. */
export function freshName(key: string, taken: readonly string[]): string | undefined {
	const first = Object.hasOwn(firstNames, key) ? firstNames[key] : undefined;
	if (first === undefined) {
		return undefined;
	}
	let name = first;
	for (let i = 2; taken.includes(name); i++) {
		name = `${first}-${i}`;
	}
	return name;
}

/** Why a term can't have a name, if it can't. */
export function nameProblem(kind: NameKind, name: string, taken: readonly string[]): string | null {
	if (name === "") {
		return "It needs a name.";
	}
	if (taken.includes(name)) {
		return `There's already ${kind === "define" ? "a definition" : `a ${kind}`} called "${name}".`;
	}
	if (kind === "color" && name === "none") {
		return `"none" means leaving a gap, so a color can't use it.`;
	}
	if (kind === "define" && (Object.hasOwn(shapes, name) || ["svg", "pile", "pall"].includes(name))) {
		return `"${name}" is the name of a shape, so a definition can't use it.`;
	}
	return null;
}

/** What a box wants, as an example of how it's written. */
const examples: Readonly<Record<string, string>> = {
	Opacity: "0.5", Rotate: "45", Angle: "30", Count: "3", Rows: "2", Columns: "3", Points: "5", From: "0", To: "180", Hoist: "20", Fly: "30", "Width, along the fly": "6", "Height, along the hoist": "4", Radius: "4", Inner: "3", Offset: "1.5",
	C: "100", M: "90", Y: "0", K: "0", Lowest: "1", Highest: "2",
	Name: "Flag of Somewhere", Description: "In half lengthwise", Version: "1.0", Date: "1912-07-04", Until: "1959-07-04", Series: "flag-of-somewhere",
	Notes: "Anything a reader should know", Law: "Flag Act 1912", Restriction: "Not for commercial use", Sources: "https://example.org/flag-act", Designers: "Their full name", Encoders: "Their full name", Authors: "Their full name",
	"Design rights": "CC0-1.0", License: "CC-BY-SA-4.0", "Render license": "CC0-1.0", URL: "https://example.org/flag.svg", Part: "The emblem",
	"On screen": "#c8102e", Pantone: "186 C", NCS: "S 1080-R", RAL: "3020", Munsell: "5R 4/14", Thread: "Madeira 1147", Dyes: "Madder", System: "HKS", Value: "13 K",
	"Path data": "M0 0H10V10H0Z", Box: "0 0 10 10", Through: "0 0 10 10", "Part that moves": "bottom",
};
const manyExamples: Readonly<Record<string, string>> = { Ratio: "1 2 1", Grow: "1 0 1", Stops: "0 0.5 1" };

/** The example a box shows while it's empty. Any other number is written the same way. */
export function exampleFor(label: string, number: boolean, many = false): string | undefined {
	const name = label.replace(/, \d+$/, "");
	const example = (many ? manyExamples[name] : undefined) ?? (Object.hasOwn(examples, name) ? examples[name] : undefined) ?? (many ? "1 2 1" : number ? "2" : undefined);
	return example === undefined ? undefined : `e.g. ${example}`;
}

/** A name as KDL writes it. */
export const kdlName = (s: string): string => (/^[A-Za-z_][\w-]*$/.test(s) && !["true", "false", "null", "inf", "nan"].includes(s) ? s : JSON.stringify(s));

/** A new term, ready to read, using colors the palette already has. */
export function skeletonFor(key: string, colors: readonly string[], chosen?: string): string {
	const a = kdlName(colors[0] ?? "none");
	const b = kdlName(colors[1] ?? colors[0] ?? "none");
	const given = chosen ?? firstNames[key] ?? "";
	const fill = (t: string): string => t.replaceAll("{a}", a).replaceAll("{b}", b).replaceAll("{name}", given);
	if (key.startsWith("charge:")) {
		const shape = key.slice(7);
		const s = shapes[shape]!;
		const inner = s.skeleton.split("\n").map((l) => "  " + l).join("\n");
		return shape === "svg" ? `charge svg {\n${inner}\n}` : `charge ${shape} ${a} {\n${inner}\n}`;
	}
	if (key === "color") {
		return `${given} "#888888"`;
	}
	if (key === "gradient") {
		return `${given} gradient ${a} ${b}`;
	}
	const t = layers[key] ?? parts[key];
	return fill(t?.skeleton ?? key);
}

/** A charge using a defined shape can change any of that shape's sizes. */
const definedShapeFields: readonly Field[] = [radius, { k: "num", label: "Inner", child: "inner" }, { k: "num", label: "Points", child: "points" }, ...size, hollow];

/** What the file's node can be read as: its table, for anything the form knows. */
export function fieldsFor(node: { name: string; args: readonly { v: unknown }[] }, inPalette = false): { term: Term | null; fields: readonly Field[]; extra: readonly Field[] } {
	if (inPalette) {
		const gradient = node.args[0]?.v === "gradient";
		return { term: null, fields: gradient ? gradientFields : colorFields, extra: [] };
	}
	if (node.name === "charge") {
		const name = String(node.args[0]?.v);
		const shape = Object.hasOwn(shapes, name) ? shapes[name] : undefined;
		const kept = placeFields.filter((f) => !(shape?.unplaced === true && (f.k === "at" || f.k === "repeat" || f.k === "num")) && !(name === "svg" && (f.k === "repeat" || f.k === "fimbriate")));
		return { term: layers.charge!, fields: [...chargeFields, { k: "heading", label: "Size", grid: true }, ...(shape?.fields ?? definedShapeFields), ...kept], extra: common };
	}
	const layer = layers[node.name];
	if (layer !== undefined) {
		return { term: layer, fields: layer.fields, extra: common };
	}
	const part = parts[node.name];
	return { term: part ?? null, fields: part?.fields ?? [], extra: [] };
}

/** The node's children that the fields read, so that any others can be said to be only in the source. */
export function handledChildren(fields: readonly Field[], names: Set<string> = new Set()): Set<string> {
	for (const f of fields) {
		switch (f.k) {
			case "num": case "nums": case "choice": case "flag": case "text": case "texts": case "props": case "points":
				names.add(f.child);
				break;
			case "records":
				names.add(f.child);
				break;
			case "at":
				names.add("at");
				break;
			case "edge":
				names.add("edge");
				break;
			case "fimbriate":
				names.add("fimbriate");
				break;
			case "repeat":
				names.add("repeat");
				break;
			case "reference":
				names.add("reference");
				break;
			case "artwork":
				names.add("markup");
				break;
			case "steps":
				for (const s of ["over", "under", "tuck"]) {
					names.add(s);
				}
				break;
			default:
				break;
		}
	}
	return names;
}

export const shortLabel = (name: string): string => layers[name]?.label ?? parts[name]?.label ?? name;
