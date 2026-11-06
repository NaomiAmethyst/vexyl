// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

/** One thing wrong with a document. */
export interface Problem {
	/** The name given for the document, if any. */
	source?: string;
	/** The line it's on, from 1, or absent if it has no one place. */
	line?: number;
	/** The column it's at, from 1, or absent if it has no one place. */
	column?: number;
	/** The KDL node it's about, or absent. */
	node?: string;
	/** What's wrong, for a person to read. */
	message: string;
}

/** Thrown by `parse` when a document has problems. */
export class ParseError extends Error {
	readonly problems: readonly Problem[];

	constructor(problems: readonly Problem[]) {
		super(problems.map(formatProblem).join("\n"));
		this.name = "ParseError";
		this.problems = problems;
	}
}

/** Thrown by `svg` and `svgTree` when a flag can't be drawn as asked. */
export class RenderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RenderError";
	}
}

/** Writes a problem as a line of text: `source:line:column: node: message`. */
export function formatProblem(p: Problem): string {
	let out = "";
	if (p.line !== undefined) {
		if (p.source) {
			out += p.source + ":";
		}
		out += `${p.line}:${p.column ?? 0}: `;
	}
	if (p.node) {
		out += p.node + ": ";
	}
	return out + p.message;
}

/** A position in grid units: `fly` from the hoist edge of the region, `hoist` down from its top. */
export interface Point {
	fly: number;
	hoist: number;
}

export type Axis = "fly" | "hoist" | "bend" | "bend-sinister";
export type EdgeName = "hoist" | "fly" | "top" | "bottom";
export type CornerName = "upper-hoist" | "upper-fly" | "lower-hoist" | "lower-fly";
export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten";
export type Anchor = "start" | "center" | "end" | "scale";
export type AdaptRule = "extend" | "center" | "scale" | "hoist-extend" | "hoist-center" | "hoist-scale";
export type Turn = "none" | "rotate" | "transpose";
export type RayOrigin = "center" | EdgeName | CornerName;

/** A parsed and validated Vexyl document. Rendering never changes it. */
export interface Flag {
	version: number;
	meta: Meta;
	/** Color names to `#rrggbb` values. */
	palette: Record<string, string>;
	/** Colors' values in other systems, which are records and never drawn. */
	colorRefs: Record<string, ColorRef[]>;
	/** Palette names to gradients, usable wherever a color is. */
	gradients: Record<string, Gradient>;
	/** The flag's proportion, which is also its grid. */
	hoist: number;
	fly: number;
	outline?: Outline;
	border?: Border;
	/** Reusable shapes and designs, by name. */
	defines: Record<string, Define>;
	layers: Layer[];
	/** The flag's other side, if it isn't a mirror image. */
	reverse?: Reverse;
	/** How the flag reaches other proportions, if it can. */
	adapt?: Adapt;
	variants: Record<string, Variant>;
	folds: Record<string, Fold>;
	/** Unique to the source document, so that several flags can share a page. */
	readonly idPrefix: string;
}

export interface Meta {
	name: string;
	description?: string;
	version?: string;
	date?: string;
	until?: string;
	series?: string;
	notes: string[];
	laws: Reference[];
	restrictions: Reference[];
	designers: string[];
	designRights?: string;
	encoders: string[];
	license?: string;
	renderLicense?: string;
	adaptedFrom: Adaptation[];
	sources: string[];
}

/** A work that a file derives from, with what its license requires. */
export interface Adaptation {
	url: string;
	authors: string[];
	license?: string;
	/** What was taken, or absent if the whole file derives from it. */
	part?: string;
}

/** A named or described thing, with where it comes from. */
export interface Reference {
	text: string;
	sources: string[];
}

/** A color's value in another system, such as Pantone or a named dye. */
export interface ColorRef {
	system: string;
	value: string;
	/** The same value as numbers, for cmyk. */
	numbers?: number[];
	/** Says the system was named in a `reference`, rather than being one of the format's own. */
	other?: boolean;
}

/** A linear blend between solid palette colors, across the shape it fills. */
export interface Gradient {
	colors: string[];
	/** Each color's position from 0 to 1. */
	stops: number[];
	along: Axis;
}

/** A colored edge of a given width, used for fimbriation. */
export interface Fimbriation {
	color: string;
	width: number;
}

export interface Border extends Fimbriation {
	/** Whether it lies within the flag's shape, or is added around it. */
	side: "inside" | "outside";
}

export type Outline =
	| { kind: "polygon"; vertices: Point[] }
	| { kind: "path"; d: string; box: Box }
	| { kind: "swallowtail"; depth: number; taper?: number }
	| { kind: "tongued"; depth: number; tongue: number }
	| { kind: "pennant"; tip?: number };

/** A path's drawing area: x, y, width and height. */
export type Box = [number, number, number, number];

/** A reusable shape, or a design with layers. */
export interface Define {
	shape?: Shape;
	layers: Layer[];
	/** A design's own grid, scaled to fill where it's used. */
	fly?: number;
	hoist?: number;
	/** What a design paints and how deep it nests, as section 15 of the format counts them. */
	size?: number;
	height?: number;
}

export interface Reverse {
	layers: Layer[];
}

export interface Adapt {
	/** The lowest and highest proportion, as fly divided by hoist. */
	range?: [number, number];
	wider?: AdaptRule;
	narrower?: AdaptRule;
}

/** A named form of a flag. */
export interface Variant {
	from: Turn;
	upright: boolean;
	/** Its proportion by the flag's `adapt` rules, as fly divided by hoist before turning. */
	ratio?: number;
	/** Its own true shape and grid. */
	fly?: number;
	hoist?: number;
	outline?: Outline;
	border?: Border;
	/** Replace the flag's own if there are any. */
	layers: Layer[];
}

/** A wavy or zigzag edge between divisions. */
export interface ShapedEdge {
	kind: "wavy" | "zigzag";
	depth: number;
	/** The length of one wave. */
	period?: number;
	/** How many waves fit the edge. */
	count?: number;
}

/** The properties common to all layers. */
export interface Effects {
	anchor?: Anchor;
	opacity: number;
	blend: BlendMode;
	clip?: Shape;
	cuts: Shape[];
}

export interface FieldLayer extends Effects {
	layer: "field";
	color: string;
}

export interface BarsLayer extends Effects {
	layer: "bars";
	/** One per bar, with any `count` already applied. */
	colors: string[];
	along: Axis;
	ratio: number[];
	rotate: number;
	/** Shares out any change of proportion between the bars. */
	grow?: number[];
	edge?: ShapedEdge;
}

export interface ChevronsLayer extends Effects {
	layer: "chevrons";
	/** From the edge outward. */
	colors: string[];
	from: EdgeName;
	depth: number;
	/** Between each arm and the center line, or absent for arms that meet the corners. */
	angle?: number;
	/** How far along the edge the apex sits, or absent for its middle. */
	apex?: number;
	ratio: number[];
	rotate: number;
	fimbriate?: Fimbriation;
}

export interface BandLayer extends Effects {
	layer: "band";
	color: string;
	along: Axis;
	width: number;
	offset: number;
	rotate: number;
	fimbriate?: Fimbriation;
}

export interface CrossLayer extends Effects {
	layer: "cross";
	color: string;
	/** The distance before the arm, its width and the distance after it. */
	fly: [number, number, number];
	hoist: [number, number, number];
	fimbriate?: Fimbriation;
}

export interface SaltireLayer extends Effects {
	layer: "saltire";
	color: string;
	width: number;
	fimbriate?: Fimbriation;
	counterchange: boolean;
}

export interface QuartersLayer extends Effects {
	layer: "quarters";
	colors: [string, string, string, string];
	diagonal: boolean;
	/** Where the division falls, or absent for the middle. */
	split?: Point;
}

export interface ChecksLayer extends Effects {
	layer: "checks";
	colors: string[];
	rows: number;
	columns: number;
	flow: "bend" | "bend-sinister";
}

export interface RaysLayer extends Effects {
	layer: "rays";
	/** One per wedge, with any `count` already applied. */
	colors: string[];
	from: RayOrigin;
	/** Overrides `from`. */
	at?: Point;
	ratio: number[];
	rotate: number;
	measure: "angle" | "edge";
}

/** A shape at a position, possibly repeated. A pile or pall is one of these. */
export interface ChargeLayer extends Effects {
	layer: "charge";
	shape: Shape;
	/** Optional for inline SVG, where it's what `currentColor` means. */
	color?: string;
	fimbriate?: Fimbriation;
	repeat?: Repeat;
}

export interface EmblemLayer extends Effects {
	layer: "emblem";
	/** The frame's origin, or absent for the center of the region. */
	at?: Point;
	along?: Axis;
	rotate: number;
	charges: ChargeLayer[];
}

export interface GroupLayer extends Effects {
	layer: "group";
	layers: Layer[];
}

/** A new region within its parent. A canton is one in the upper hoist corner. */
export interface PanelLayer extends Effects {
	layer: "panel";
	side?: EdgeName;
	/** The depth of a band from its edge. */
	width?: number;
	corner?: CornerName;
	at?: Point;
	fly?: number;
	hoist?: number;
	edge?: ShapedEdge;
	layers: Layer[];
	/** Says it was written as a canton. */
	canton?: boolean;
}

export interface UseLayer extends Effects {
	layer: "use";
	name: string;
	define: Define;
}

export type Layer =
	| FieldLayer
	| BarsLayer
	| ChevronsLayer
	| BandLayer
	| CrossLayer
	| SaltireLayer
	| QuartersLayer
	| ChecksLayer
	| RaysLayer
	| ChargeLayer
	| EmblemLayer
	| GroupLayer
	| PanelLayer
	| UseLayer;

export interface ShapeCommon {
	/** The position, or absent for the center of the region. */
	at?: Point;
	/** Each position of a charge given any, with `null` for the center. */
	ats?: (Point | null)[];
	rotate: number;
	/** Draws the shape as an outline of this width. */
	hollow?: number;
}

export interface DiscShape extends ShapeCommon {
	kind: "disc";
	radius: number;
}
export interface EllipseShape extends ShapeCommon {
	kind: "ellipse";
	fly: number;
	hoist: number;
}
export interface RingShape extends ShapeCommon {
	kind: "ring";
	radius: number;
	inner: number;
	/** Limits it to an arc, clockwise from up. */
	arc?: { from: number; to: number };
}
export interface RectShape extends ShapeCommon {
	kind: "rect";
	fly: number;
	hoist: number;
}
export interface PlusShape extends ShapeCommon {
	kind: "plus";
	radius: number;
	width: number;
}
export interface TriangleShape extends ShapeCommon {
	kind: "triangle";
	radius: number;
}
export interface StarShape extends ShapeCommon {
	kind: "star";
	radius: number;
	points: number;
	inner: number;
	/** Draws its chords, at this width. */
	lines?: number;
}
export interface CrescentShape extends ShapeCommon {
	kind: "crescent";
	radius: number;
	inner: number;
	offset: number;
}
export interface SunShape extends ShapeCommon {
	kind: "sun";
	radius: number;
	disc: number;
	/** The space around the disc. */
	gap?: number;
	points: number;
	spread: number;
}
export interface LozengeShape extends ShapeCommon {
	kind: "lozenge";
	/** Each size defaults to its region's. */
	fly?: number;
	hoist?: number;
}
export interface PathShape extends ShapeCommon {
	kind: "path";
	d: string;
	box: Box;
	fly?: number;
	hoist?: number;
	evenodd?: boolean;
}
export interface HeartShape extends ShapeCommon {
	kind: "heart";
	radius: number;
	spread: number;
}
export interface CardioidShape extends ShapeCommon {
	kind: "cardioid";
	radius: number;
}
export interface PolygonShape extends ShapeCommon {
	kind: "polygon";
	vertices: Point[];
}
export interface PileShape extends ShapeCommon {
	kind: "pile";
	from: EdgeName;
	base?: [number, number];
	/** Its point along the edge, then in from it. */
	tip?: [number, number];
	depth?: number;
	flat?: number;
}
export interface PallShape extends ShapeCommon {
	kind: "pall";
	from: EdgeName;
	width: number;
	junction?: number;
}
export interface SvgShape extends ShapeCommon {
	kind: "svg";
	fly: number;
	hoist: number;
	/** The inline SVG after being sanitized, with its IDs as they were written. */
	markup: string;
	/** The same, in the pieces that drawing it needs. */
	embedded: EmbeddedSvg;
}

export type Shape =
	| DiscShape
	| EllipseShape
	| RingShape
	| RectShape
	| PlusShape
	| TriangleShape
	| StarShape
	| CrescentShape
	| SunShape
	| LozengeShape
	| PathShape
	| HeartShape
	| CardioidShape
	| PolygonShape
	| PileShape
	| PallShape
	| SvgShape;

/** Inline SVG that has passed the sanitizer. */
export interface EmbeddedSvg {
	viewBox: string;
	/** The root element's attributes, each with a leading space, marked where IDs get their prefixes. */
	attrs: string;
	/** Its contents, marked the same way. */
	body: string;
}

export type Repeat =
	| { kind: "ring"; count: number; radius: number; turn: boolean }
	| { kind: "arc"; count: number; radius: number; turn: boolean; from: number; to: number }
	| { kind: "grid"; rows: number; columns: number; stagger: boolean }
	| { kind: "line"; count: number; fly: number; hoist: number };

/** A sequence of flat folds, for storage or ceremony. */
export interface Fold {
	description?: string;
	sources: string[];
	steps: FoldStep[];
}

export interface FoldStep {
	kind: "over" | "under" | "tuck";
	/** Two points on the crease, where the folded flag lies at that step. */
	through: [Point, Point];
	/** A point on the side that moves. */
	moving: Point;
	/** The crease as it was written. */
	written: { along?: string; at?: number; move?: string; through?: number[]; moveTo?: number[] };
}

/** What to draw. Every option is optional, and none gives the flag as it is. */
export interface Options {
	/** The image's height in pixels, by default 600. */
	height?: number;
	/** The proportion wanted, as fly divided by hoist. */
	ratio?: number;
	/** What to do if the flag can't reach `ratio`. */
	fit?: "error" | "pad";
	/** Where a padded flag sits. */
	align?: "start" | "center" | "end";
	/** Which form of the flag. */
	variant?: string;
	side?: "obverse" | "reverse";
	/** Shows the flag folded. */
	fold?: string;
	/** Stops a fold after that many steps. */
	foldStep?: number;
}

/** A node of an SVG document. Vexyl's SVG has no text content, apart from a title and description. */
export interface SvgElement {
	name: string;
	attrs: SvgAttr[];
	children: SvgElement[];
}

export interface SvgAttr {
	name: string;
	value: string;
}
