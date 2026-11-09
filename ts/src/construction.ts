// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Construction sheets: a flag on its grid with its sizes marked, as the drawings attached to flag
// laws are. This isn't part of the format or the SDK. Every number on a sheet comes from the file,
// worked out exactly, and nothing is measured from the drawing.

import {
	compare, decimal, exactOf, fraction, half, minus, over, placesOf, plus, readExact, same, sum, times, toNumber, zero, type Fraction,
} from "./exact.js";
import { withRatioExactly } from "./adapt-exact.js";
import { resolve } from "./adapt.js";
import { axis, rotate, shapeGeom } from "./geometry.js";
import { outlinePoints } from "./shapes.js";
import { svg } from "./svg.js";
import { esc, num } from "./text.js";
import type { Axis, BandLayer, BarsLayer, ChargeLayer, ChevronsLayer, CrossLayer, EdgeName, EmblemLayer, Flag, Layer, Outline, PallShape, PanelLayer, PileShape, Point, Repeat, Shape, ShapedEdge } from "./types.js";

/** What a sheet shows, and how. Every option is optional. */
export interface ConstructionOptions {
	/** What sizes are written in: grid units as the file has them (the default), parts of the hoist, or millimetres. */
	units?: "grid" | "hoist" | "mm";
	/** The hoist in millimetres, for `units: "mm"`, by default 1000. */
	hoistMm?: number;
	/** Black lines on white (the default), or purple lines on a dark ground. */
	theme?: "paper" | "dark";
	/** A4 or US Letter, both landscape, or a sheet just the size of the drawing. A4 is the default. */
	paper?: "a4" | "letter" | "fit";
	/** The sizes of the flag and its parts, by default shown. */
	sizes?: boolean;
	/** Where each charge is, by default shown. */
	positions?: boolean;
	/** The colour key, by default shown. */
	colors?: boolean;
	/** The construction grid over the flag, by default not shown. */
	grid?: boolean;
	/** Where the file is, such as "flags/country/chile.kdl", for the sheet's footer. */
	path?: string;
	/** The file's evidence tier, for the footer. */
	tier?: string;
	/**
	 * Which form of the flag to draw, named as `svg` names them: one of its variants, and its
	 * obverse or reverse. By default, the flag's obverse.
	 */
	form?: SheetForm;
	/** Starts every ID in the output, as for `svg`. */
	idPrefix?: string;
	/**
	 * Fonts for the sheet to carry inside it, for a reader that won't load any, as a browser drawing
	 * an SVG as an image won't. Only the faces the sheet's text is set in are kept; see `sheetFaces`.
	 */
	fonts?: readonly SheetFont[];
}

/** A form of a flag, as `svg`'s options name it. */
export interface SheetForm {
	variant?: string;
	side?: "obverse" | "reverse";
}

/** A face of a font, as a WOFF2 file, which the caller supplies, since this library holds none. */
export interface SheetFont {
	family: string;
	weight: number;
	woff2: Uint8Array;
}

/** The faces a sheet's text can be set in: Geist and Geist Mono, each at 400 and 500. */
export const sheetFaces: readonly { family: string; weight: number }[] = [
	{ family: "Geist", weight: 400 }, { family: "Geist", weight: 500 }, { family: "Geist Mono", weight: 400 }, { family: "Geist Mono", weight: 500 },
];

/** A sheet, with where its text is, which is what tests of its layout need. */
export interface Sheet {
	svg: string;
	/** Its size in its own units, which are CSS pixels. */
	width: number;
	height: number;
	/** Its size on paper. */
	widthMm: number;
	heightMm: number;
	/** Every piece of text, as a box. Text drawn on the flag says so. */
	labels: LabelBox[];
	/** The flag's grid, on the sheet. */
	flag: Box;
	/**
	 * Says the colour key or the laws are cut short for room, with how many more there are, which
	 * only a palette or laws too long for the sheet need.
	 */
	condensed: boolean;
	/** Every size and angle the sheet writes, with the exact value it stands for, which tests check its text against. */
	values: SheetValue[];
	/** The hoist of the form drawn, which sizes in parts of the hoist are parts of. */
	hoist: Fraction;
}

/** A size or angle as a sheet writes it, and exactly what it is. */
export interface SheetValue {
	text: string;
	exact: Fraction;
	unit: "grid" | "hoist" | "mm" | "degrees";
}

/**
 * What's wrong with how a sheet wrote a value, or null if nothing is: its text has to say the value
 * exactly, or be marked ~ and right to the places it gives. Millimetres are rounded as the footer
 * says, so they're only checked to that. `hoist` is the flag's, which parts of the hoist are of.
 */
export function valueProblem(v: SheetValue, hoist: Fraction): string | null {
	const marked = v.text.startsWith("~");
	const text = marked ? v.text.slice(1) : v.text;
	const patterns: Record<SheetValue["unit"], RegExp> = {
		grid: /^(-?\d+(?:\.\d+)?)(?:\/(\d+))?$/,
		hoist: /^(-?\d*(?:\.\d+)?)H(?:\/(\d+))?$/,
		mm: /^(-?\d+(?:\.\d+)?)()$/,
		degrees: /^(-?\d+(?:\.\d+)?)°(?:\/(\d+))?$/,
	};
	const m = patterns[v.unit].exec(text);
	if (m === null) {
		return `can't read ${v.unit} value "${v.text}"`;
	}
	const top = m[1] === "" ? fraction(1n) : m[1] === "-" ? fraction(-1n) : readExact(m[1]!);
	if (top === null) {
		return `can't read ${v.unit} value "${v.text}"`;
	}
	let said = m[2] !== undefined && m[2] !== "" ? over(top, fraction(BigInt(m[2]))) : top;
	if (v.unit === "hoist") {
		said = times(said, hoist);
	}
	const off = Math.abs(toNumber(minus(said, v.exact)));
	if (v.unit === "mm") {
		return marked || off > (Math.abs(toNumber(v.exact)) < 10 ? 0.005 : 0.05) + 1e-12 ? `"${v.text}" isn't ${toNumber(v.exact)} mm to the places it gives` : null;
	}
	if (marked) {
		const scale = v.unit === "hoist" ? Math.abs(toNumber(hoist)) : 1;
		return off > 0.00005 * scale + 1e-12 ? `"${v.text}" isn't ${toNumber(v.exact)} to four places` : null;
	}
	return same(said, v.exact) ? null : `"${v.text}" is rounded from ${v.exact.n}/${v.exact.d} but isn't marked ~`;
}

/** Every value a sheet writes wrongly, and a footer that doesn't say a ~ marks rounding when one does. */
export function sheetValueProblems(sheet: Sheet): string[] {
	const out = sheet.values.map((v) => valueProblem(v, sheet.hoist)).filter((x): x is string => x !== null);
	if (sheet.values.some((v) => v.unit !== "mm" && v.text.startsWith("~")) && !sheet.labels.map((l) => l.text).join(" ").includes(roundingNote)) {
		out.push("a value is marked ~ but the footer doesn't say what that means");
	}
	return out;
}

/** What the sheet being drawn has written so far. Drawing a sheet is synchronous, so one at a time. */
let recording: SheetValue[] | null = null;

/** Notes a value a sheet writes, and gives its text back. */
function recordValue(text: string, exact: Fraction, unit: SheetValue["unit"]): string {
	recording?.push({ text, exact, unit });
	return text;
}

export interface Box {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export interface LabelBox extends Box {
	text: string;
	onFlag: boolean;
	/** For text set at a slant, the corners of its own box, which the box above holds. */
	corners?: { x: number; y: number }[];
}

/** The corners of a label, in order around it. */
const cornersOf = (b: LabelBox): { x: number; y: number }[] => b.corners ?? [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];

/** The area two labels share, slanted ones by their own boxes, so that labels that only touch share none. */
export function labelOverlap(a: LabelBox, b: LabelBox): number {
	if (a.corners === undefined && b.corners === undefined) {
		return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
	}
	if (Math.min(a.x1, b.x1) <= Math.max(a.x0, b.x0) || Math.min(a.y1, b.y1) <= Math.max(a.y0, b.y0)) {
		return 0;
	}
	// Clips one convex box by each side of the other, and measures what's left.
	let poly = cornersOf(a);
	const clip = cornersOf(b);
	const turn = Math.sign(area(clip));
	for (let i = 0; i < clip.length && poly.length > 0; i++) {
		const p = clip[i]!;
		const q = clip[(i + 1) % clip.length]!;
		const side = (v: { x: number; y: number }): number => turn * ((q.x - p.x) * (v.y - p.y) - (q.y - p.y) * (v.x - p.x));
		const out: { x: number; y: number }[] = [];
		poly.forEach((v, j) => {
			const w = poly[(j + 1) % poly.length]!;
			const [sv, sw] = [side(v), side(w)];
			if (sv >= 0) {
				out.push(v);
			}
			if ((sv >= 0) !== (sw >= 0)) {
				const k = sv / (sv - sw);
				out.push({ x: v.x + (w.x - v.x) * k, y: v.y + (w.y - v.y) * k });
			}
		});
		poly = out;
	}
	return Math.abs(area(poly));
}

function area(poly: readonly { x: number; y: number }[]): number {
	let sum = 0;
	poly.forEach((p, i) => {
		const q = poly[(i + 1) % poly.length]!;
		sum += p.x * q.y - q.x * p.y;
	});
	return sum / 2;
}

/** Draws a flag's construction sheet, as a standalone SVG document. */
export function constructionSvg(flag: Flag, options: ConstructionOptions = {}): string {
	return constructionSheet(flag, options).svg;
}

// --- Look -------------------------------------------------------------------------------------

interface Ink {
	c: string;
	o?: number;
}

interface Theme {
	paper: string;
	ink: string;
	label: string;
	ink2: string;
	muted: string;
	dim: string;
	ext: Ink;
	outline: Ink;
	rule: string;
	onFlag: string;
	halo: string;
}

const themes: Record<"paper" | "dark", Theme> = {
	paper: { paper: "#ffffff", ink: "#1c1b22", label: "#1c1b22", ink2: "#3b3947", muted: "#55525f", dim: "#2a2833", ext: { c: "#8d8a99" }, outline: { c: "#c9c6d2" }, rule: "#1c1b22", onFlag: "#1c1b22", halo: "#ffffff" },
	dark: { paper: "#0c0b11", ink: "#f0eef5", label: "#efe9ff", ink2: "#cdc9d8", muted: "#a39fb3", dim: "#b69cff", ext: { c: "#b69cff", o: 0.5 }, outline: { c: "#ffffff", o: 0.16 }, rule: "#b69cff", onFlag: "#4a2fb8", halo: "#ffffff" },
};

const sansFamily = "Geist, system-ui, sans-serif";
const monoFamily = "Geist Mono, ui-monospace, monospace";

const stroke = (i: Ink): string => `stroke="${i.c}"${i.o !== undefined ? ` stroke-opacity="${i.o}"` : ""}`;

// Geist's advance widths for printable ASCII, in thousandths of an em, at 400 and 500. Geist Mono's
// are all 600, as most monospaced fonts' are, which is what makes a dimension's label predictable.
const sans400 = [250, 217, 360, 478, 649, 770, 622, 188, 313, 313, 436, 570, 203, 426, 203, 483, 672, 385, 619, 613, 636, 626, 624, 585, 604, 624, 293, 293, 549, 660, 553, 567, 914, 672, 681, 702, 703, 604, 591, 709, 704, 272, 598, 653, 581, 878, 739, 748, 651, 742, 673, 649, 578, 690, 670, 912, 629, 631, 543, 337, 478, 337, 402, 564, 252, 576, 599, 553, 599, 568, 399, 598, 582, 246, 261, 591, 284, 878, 582, 580, 599, 599, 383, 531, 397, 576, 538, 820, 587, 538, 550, 424, 264, 424, 538];
const sans500 = [243, 230, 369, 515, 659, 794, 651, 192, 325, 325, 433, 565, 215, 425, 215, 496, 680, 406, 630, 626, 651, 641, 636, 589, 625, 638, 298, 298, 545, 648, 549, 577, 930, 695, 688, 711, 708, 610, 596, 718, 709, 282, 608, 670, 584, 890, 742, 756, 658, 750, 681, 659, 596, 695, 694, 938, 659, 652, 561, 352, 492, 352, 408, 564, 256, 590, 611, 569, 611, 582, 416, 611, 592, 258, 284, 610, 299, 885, 592, 594, 611, 611, 398, 546, 414, 587, 562, 830, 608, 555, 565, 426, 275, 426, 532];
const sansOther: Record<string, number> = { "’": 210, "‘": 210, "“": 390, "”": 390, "–": 598, "—": 914, "·": 210, "×": 490, "…": 614, "°": 400 };

/** Whether a character is one of the scripts that are a whole em wide, as Chinese, Japanese and Korean are. */
const wide = (code: number): boolean => (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) || code >= 0x20000;

/**
 * How wide some text in Geist is. A reader without Geist sees a fallback, which can be a little
 * wider, so this allows for that, and anything not in the table counts as wide.
 */
function sansWidth(text: string, size: number, weight: 400 | 500 = 400): number {
	const table = weight === 500 ? sans500 : sans400;
	let w = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0)!;
		w += code >= 32 && code <= 126 ? table[code - 32]! : sansOther[ch] ?? (wide(code) ? 1000 : 700);
	}
	return (w / 1000) * size * 1.05;
}

const monoWidth = (text: string, size: number): number => [...text].reduce((w, ch) => w + (wide(ch.codePointAt(0)!) ? 1 : 0.6), 0) * size;

/** Breaks text into lines no wider than `width`, between its pieces, which are kept whole where they can be. */
function wrap(pieces: readonly string[], size: number, width: number, weight: 400 | 500 = 400): string[] {
	const words: string[] = [];
	for (const p of pieces) {
		if (sansWidth(p, size, weight) <= width) {
			words.push(p);
			continue;
		}
		// Too wide for any line, so it has to break: at its spaces if it has any, and only a word too
		// wide on its own breaks between characters.
		for (const word of p.split(" ")) {
			if (sansWidth(word, size, weight) <= width) {
				words.push(word);
				continue;
			}
			let line = "";
			for (const ch of word) {
				if (sansWidth(line + ch, size, weight) > width && line !== "") {
					words.push(line);
					line = "";
				}
				line += ch;
			}
			words.push(line);
		}
	}
	const lines: string[] = [];
	let line = "";
	for (const w of words) {
		const next = line === "" ? w : `${line} ${w}`;
		if (line !== "" && sansWidth(next, size, weight) > width) {
			lines.push(line);
			line = w;
		} else {
			line = next;
		}
	}
	if (line !== "") {
		lines.push(line);
	}
	return lines;
}

const words = (text: string): string[] => text.split(/\s+/).filter((w) => w !== "");

// --- Numbers ----------------------------------------------------------------------------------

type Format = (f: Fraction) => string;

/** A size in grid units: exactly if a decimal can say it, and otherwise as a small fraction, or rounded to four places and marked
 * with ~, since Geist Mono has no ≈. */
export function gridText(f: Fraction): string {
	const places = placesOf(f);
	if (places !== null) {
		return decimal(f, places);
	}
	const size = f.n < 0n ? -f.n : f.n;
	if (f.d <= 99n && size < 100000n) {
		return `${f.n}/${f.d}`;
	}
	return `~${decimal(f, 4)}`;
}

/** A share of the hoist, written as laws write them: H, H/2, 3H/2, H/48, 0.76H, or ~ and four places. */
export function hoistText(q: Fraction): string {
	const size = q.n < 0n ? -q.n : q.n;
	const asFraction = (): string => `${q.n < 0n ? "-" : ""}${size === 1n ? "" : size}H${q.d === 1n ? "" : `/${q.d}`}`;
	const places = placesOf(q);
	if (q.d <= 12n && size < 10000n) {
		return asFraction();
	}
	if (places !== null && places <= 3) {
		return `${decimal(q, places)}H`;
	}
	if (q.d <= 999n && size <= 9999n) {
		return asFraction();
	}
	if (places !== null && places <= 6) {
		return `${decimal(q, places)}H`;
	}
	return `~${decimal(q, 4)}H`;
}

/** Millimetres, to the nearest 0.1, or 0.01 under 10 mm. */
export function mmText(f: Fraction): string {
	const size = f.n < 0n ? -f.n : f.n;
	return decimal(f, size < 10n * f.d ? 2 : 1);
}

function formatFor(units: "grid" | "hoist" | "mm", hoist: Fraction, hoistMm: Fraction): Format {
	switch (units) {
		case "hoist":
			return (f) => hoistText(over(f, hoist));
		case "mm":
			return (f) => mmText(times(f, over(hoistMm, hoist)));
		case "grid":
			return gridText;
	}
}

/** The flag's shape, hoist to fly, in the smallest whole numbers if they're small enough to read. */
export function proportionText(hoist: Fraction, fly: Fraction): string {
	const shape = over(fly, hoist);
	if (shape.n < 10000n && shape.d < 10000n) {
		return `${shape.d}:${shape.n}`;
	}
	const places = placesOf(shape);
	return `1:${places !== null && places <= 4 ? decimal(shape, places) : `~${decimal(shape, 4)}`}`;
}

// --- Measuring --------------------------------------------------------------------------------

/** A rectangle of the flag, in grid units from its upper hoist corner. */
interface Frame {
	x: Fraction;
	y: Fraction;
	w: Fraction;
	h: Fraction;
}

interface ChargeMark {
	/** The marked center. */
	x: Fraction;
	y: Fraction;
	/** Where the measured copy is, and how far it reaches each way from there, in grid units. */
	at: { x: number; y: number };
	reach: { x: number; y: number };
	/** Its radius, for a dashed circle through its points. */
	circle?: number;
	size?: (t: Format) => string;
	name: string;
}

interface SaltireMark {
	frame: Frame;
	width: Fraction;
	name: string;
}

/** A point or a direction, in grid units or on the sheet. */
interface Vec {
	x: number;
	y: number;
}

/** Where the flag is on the sheet: a point's place there, and the way a direction on the flag goes. */
interface Placing {
	at: (p: Vec) => Vec;
	/** A direction on the flag as one on the sheet, of length 1. */
	way: (v: Vec) => Vec;
	/** Sheet units to a grid unit. */
	s: number;
}

/** One way to draw a mark on the flag: its lines on the sheet, and where its label could go, best first. */
interface MarkOption {
	solid: Vec[][];
	dashed: Vec[][];
	spots: Box[];
}

/**
 * Something measured on the flag itself, such as an angle or the width of a slanting arm, which is
 * drawn where it is, as a charge's size is. It's left for the notes if its label has no room.
 */
interface FlagMark {
	text: (t: Format) => string;
	options: (p: Placing, w: number, h: number) => MarkOption[];
	fallback: (text: string) => string;
}

/** A straight dimension in a detail, between two points of its frame, with its label. */
interface DetailDim {
	a: Vec;
	b: Vec;
	text: (t: Format) => string;
	/** Left out if its label has no room, as the caption says it too. */
	optional?: boolean;
}

/**
 * A row of dimensions along a slanting axis, drawn over the flag: places along the axis of a frame
 * from its origin, which `frame` maps to the flag's, and one dimension across the axis at its end.
 */
interface FlagRow {
	frame: Affine;
	stops: Fraction[];
	/** How far across the axis what it measures reaches, which the row is drawn beyond. */
	reach: number;
	across: { at: number; from: Fraction; to: Fraction };
	/** What the notes say instead, if its labels have no room. */
	fallback: (t: Format) => string;
}

/**
 * Part of the flag enlarged in the sidebar, as a repeated charge's first copies are, with what's
 * measured there. Its points are in a frame of its own, such as an emblem's, which `frame` maps to the flag's.
 */
interface Detail {
	title: string;
	frame: Affine;
	/** What's shown, in its frame. */
	window: Box;
	/** The copies whose circle is shown dashed, if they have one. */
	copies: Vec[];
	circle?: number;
	dims: DetailDim[];
	radius?: { centre: Vec; to: Vec; text: (t: Format) => string };
	angle?: { centre: Vec; from: Vec; to: Vec; text: string };
	caption: (t: Format) => string;
	/** Turns the drawing so that its frame's fly runs level, as a diagonal emblem's is shown. */
	level?: boolean;
}

interface Measured {
	fly: Set<string>;
	hoist: Set<string>;
	flyParts: Fraction[];
	hoistParts: Fraction[];
	charges: ChargeMark[];
	saltires: SaltireMark[];
	marks: FlagMark[];
	rows: FlagRow[];
	/** Construction lines on the flag, such as a slanting axis, in grid units. */
	guides: Vec[][];
	/** Whether anything is measured along a slanting axis, which the notes then say. */
	slanting: boolean;
	details: Detail[];
	notes: ((t: Format) => string)[];
	unmeasured: Map<string, number>;
	circles: boolean;
	/** How many palls have been measured, so that one inside another is measured further along. */
	palls: number;
	turned: Set<string>;
	/** Charges past the most a sheet measures. */
	extra: number;
}

/** The most charges one sheet measures. Past that, the drawing would be more marks than flag. */
const mostCharges = 24;

const kindWords: Partial<Record<Shape["kind"], string>> = { svg: "artwork" };
const plurals: Record<string, string> = { cross: "crosses", plus: "pluses", artwork: "pieces of artwork" };

const plural = (count: number, word: string): string => {
	if (count === 1) {
		return word;
	}
	const parts = word.split(" ");
	const last = parts.pop()!;
	return [...parts, plurals[last] ?? `${last}s`].join(" ");
};

const colorWord = (c: string | undefined): string => (c === undefined ? "" : c.replaceAll("-", " "));
const named = (color: string | undefined, kind: string): string => [colorWord(color), kind].filter((w) => w !== "").join(" ");

function describe(l: Layer): string {
	switch (l.layer) {
		case "charge":
			return named(l.color, kindWords[l.shape.kind] ?? l.shape.kind);
		case "band":
		case "cross":
		case "saltire":
		case "field":
			return named(l.color, l.layer);
		case "chevrons":
			return l.colors.length === 1 ? named(l.colors[0], "chevron") : "chevrons";
		case "panel":
			return l.canton === true ? "canton" : "panel";
		case "use":
			return `design “${l.name}”`;
		default:
			return l.layer;
	}
}

const point = (p: Point): { x: Fraction; y: Fraction } => ({ x: exactOf(p.fly), y: exactOf(p.hoist) });

/**
 * Measures a form of a flag: `shown` is the flag as that form has it, with its layers, outline and
 * border, and `flag` the file's own, whose other forms the notes point to.
 */
function measure(flag: Flag, shown: Flag, form: SheetForm): Measured {
	const m: Measured = { fly: new Set(), hoist: new Set(), flyParts: [], hoistParts: [], charges: [], saltires: [], marks: [], rows: [], guides: [], slanting: false, details: [], notes: [], unmeasured: new Map(), circles: false, palls: 0, turned: new Set(), extra: 0 };
	const root: Frame = { x: zero, y: zero, w: exactOf(shown.fly), h: exactOf(shown.hoist) };
	walk(shown.layers, root, m);
	const ratio = form.variant !== undefined ? flag.variants[form.variant]?.ratio : undefined;
	if (ratio !== undefined && ratio > 0) {
		const rule = ratio > flag.fly / flag.hoist ? flag.adapt?.wider : flag.adapt?.narrower;
		m.notes.push(() => `The ${form.variant} variant is the flag at a proportion of ${ratio}, by its rule for ${ratio > flag.fly / flag.hoist ? "a wider" : "a narrower"} flag, ${rule}. Every size here is worked out from the file’s by that rule, exactly.`);
	}
	if (m.slanting) {
		m.notes.push(() => "Sizes along a slanting axis are measured along it, and across it square to it.");
	}
	if (m.extra > 0) {
		skip(m, `${m.extra} more ${m.extra === 1 ? "charge" : "charges"}, past the first ${mostCharges}`);
	}
	if (shown.outline !== undefined) {
		outline(shown.outline, root, m);
	}
	if (shown.border !== undefined) {
		border(shown, m);
	}
	// The other forms that have sheets of their own, and those that don't yet.
	const others: string[] = [];
	if (flag.reverse !== undefined && form.side !== "reverse") {
		others.push("the reverse");
	}
	for (const name of Object.keys(flag.variants)) {
		if (name === form.variant) {
			continue;
		}
		others.push(`the ${name} variant`);
	}
	if (others.length > 0) {
		const list = others.length === 1 ? others[0]! : `${others.slice(0, -1).join(", ")} and ${others.at(-1)!}`;
		const text = `${list.charAt(0).toUpperCase()}${list.slice(1)} ${others.length === 1 ? "has a sheet" : "have sheets"} of ${others.length === 1 ? "its" : "their"} own.`;
		m.notes.push(() => text);
	}
	for (const name of Object.keys(flag.folds)) {
		skip(m, `the ${name} fold`);
	}
	return m;
}

/** The most corners of a polygon outline whose places are each marked; past that, only its box is. */
const mostCorners = 12;

/**
 * A flag's outline: the places its named forms are cut to, along the edges, with what they are in
 * the notes, or a polygon's corners, or for a path, how it's fitted to the grid.
 */
function outline(o: Outline, f: Frame, m: Measured): void {
	const middle = half(f.h);
	switch (o.kind) {
		case "swallowtail": {
			const depth = exactOf(o.depth);
			const taper = exactOf(o.taper ?? 0);
			part(m, "fly", minus(f.w, depth));
			m.guides.push([vec({ x: minus(f.w, depth), y: middle }), vec({ x: f.w, y: middle })]);
			if (taper.n !== 0n) {
				part(m, "hoist", taper);
				part(m, "hoist", minus(f.h, taper));
			}
			m.notes.push((t) => `The swallowtail is cut ${t(depth)} in from the fly, to a point on the middle line, and its tails end ${taper.n === 0n ? "at the fly’s corners" : `${t(taper)} in from the fly’s corners, along it`}.`);
			return;
		}
		case "tongued": {
			const depth = exactOf(o.depth);
			const tongue = exactOf(o.tongue);
			const a = half(minus(f.h, tongue));
			part(m, "fly", minus(f.w, depth));
			part(m, "hoist", a);
			part(m, "hoist", minus(f.h, a));
			m.guides.push([vec({ x: minus(f.w, depth), y: middle }), vec({ x: f.w, y: middle })]);
			m.notes.push((t) => `The fly is cut ${t(depth)} in, to two notches ${t(tongue)} apart either side of the middle line, and the tongue between them comes to a point at the middle of the fly.`);
			return;
		}
		case "pennant": {
			const tip = exactOf(o.tip ?? 0);
			if (tip.n === 0n) {
				m.notes.push(() => "The pennant narrows from the whole hoist to a point at the middle of the fly.");
				return;
			}
			const a = half(minus(f.h, tip));
			part(m, "hoist", a);
			part(m, "hoist", minus(f.h, a));
			m.notes.push((t) => `The pennant narrows from the whole hoist to an end ${t(tip)} wide at the fly, on the middle line.`);
			return;
		}
		case "polygon": {
			const xs = o.vertices.map((v) => exactOf(v.fly));
			const ys = o.vertices.map((v) => exactOf(v.hoist));
			const corners = new Set(o.vertices.map((v) => `${v.fly} ${v.hoist}`)).size;
			if (corners <= mostCorners) {
				xs.forEach((x) => part(m, "fly", x));
				ys.forEach((y) => part(m, "hoist", y));
				m.notes.push(() => `The outline is the polygon through the ${corners} corners the file lists, each at places marked along the edges.`);
				return;
			}
			const lo = (list: Fraction[]): Fraction => list.reduce((a, b) => (compare(a, b) <= 0 ? a : b));
			const hi = (list: Fraction[]): Fraction => list.reduce((a, b) => (compare(a, b) >= 0 ? a : b));
			for (const [along, list] of [["fly", xs], ["hoist", ys]] as const) {
				part(m, along, lo(list));
				part(m, along, hi(list));
			}
			const whole = same(lo(xs), zero) && same(lo(ys), zero) && same(hi(xs), f.w) && same(hi(ys), f.h);
			m.notes.push(() => `The outline is the polygon through the ${corners} corners the file lists, ${whole ? "which reaches each edge of the grid" : "within the box marked along the edges"}.`);
			return;
		}
		case "path": {
			const [x, y, w, h] = o.box.map(exactOf) as [Fraction, Fraction, Fraction, Fraction];
			m.notes.push((t) => `The outline is the file’s path, stretched from its box, ${gridText(w)} by ${gridText(h)} from (${gridText(x)}, ${gridText(y)}) in its own units, to the flag’s grid, ${t(f.w)} by ${t(f.h)}.`);
			return;
		}
	}
}

/** The middles of a polygon's sides, longest first, each with the way out of it there, square to it. */
function sidesOf(poly: readonly Vec[]): { at: Vec; out: Vec }[] {
	const turn = Math.sign(area(poly));
	if (turn === 0) {
		return [];
	}
	const out = poly.map((p, i) => {
		const q = poly[(i + 1) % poly.length]!;
		const len = Math.hypot(q.x - p.x, q.y - p.y);
		return { at: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, out: { x: (turn * (q.y - p.y)) / len, y: (turn * -(q.x - p.x)) / len }, len };
	}).filter((x) => x.len > 1e-9);
	// Longest first, and of sides as long, the first.
	return out.map((x, i) => ({ ...x, i })).sort((x, y) => (Math.abs(y.len - x.len) > 1e-9 ? y.len - x.len : x.i - y.i)).map(({ at, out }) => ({ at, out }));
}

const longestSide = (poly: readonly Vec[]): { at: Vec; out: Vec } | null => sidesOf(poly)[0] ?? null;

/**
 * A fimbriation's width, measured once, across it at a clear spot: `at` is a point on the edge of
 * what it edges, in grid units, and `out` the way out of that, which the fimbriation lies along.
 */
function fimbriation(m: Measured, name: string, fim: { color: string; width: number }, at: Vec | null, out: Vec | null): void {
	const width = exactOf(fim.width);
	const said = (text: string): string => `The ${name} is fimbriated ${colorWord(fim.color)}, ${text} wide.`;
	if (at === null || out === null) {
		m.notes.push((t) => said(t(width)));
		return;
	}
	lineMark(m, at, { x: at.x + out.x * fim.width, y: at.y + out.y * fim.width }, (t) => t(width), said, "beyond");
}

/** A border's width, across it, inside the outline or outside it. */
function border(shown: Flag, m: Measured): void {
	const b = shown.border!;
	const w = exactOf(b.width);
	const inside = b.side === "inside";
	const said = (text: string): string => `The border is ${colorWord(b.color)}, ${text} wide, ${inside ? "inside" : "outside"} the flag’s ${shown.outline !== undefined ? "outline" : "edge"}.`;
	const poly = shown.outline === undefined ? [{ x: 0, y: 0 }, { x: shown.fly, y: 0 }, { x: shown.fly, y: shown.hoist }, { x: 0, y: shown.hoist }] : outlinePoints(shown.outline, shown.fly, shown.hoist);
	const sides = poly !== null ? sidesOf(poly) : [];
	if (sides.length === 0) {
		m.notes.push((t) => said(t(w)));
		return;
	}
	// At the middle of the outline's longest side, or of another if that has no room.
	const k = (inside ? -1 : 1) * b.width;
	const [first, ...rest] = sides.map((x): [Vec, Vec] => [x.at, { x: x.at.x + x.out.x * k, y: x.at.y + x.out.y * k }]);
	lineMark(m, first![0], first![1], (t) => t(w), said, "beyond", [], rest);
}

/** Where to measure a charge's fimbriation, in the frame its shape is placed in, or nulls for a shape with no straight side or circle to measure from. */
function chargeEdge(s: Shape, at: Vec): { at: Vec | null; out: Vec | null } {
	const turn = (v: Vec): Vec => rotate(v, s.rotate);
	const place = (p: Vec, out: Vec): { at: Vec; out: Vec } => {
		const q = turn(p);
		return { at: { x: at.x + q.x, y: at.y + q.y }, out: turn(out) };
	};
	const diagonal = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
	switch (s.kind) {
		case "disc":
		case "ring":
			return place({ x: diagonal.x * s.radius, y: diagonal.y * s.radius }, diagonal);
		case "rect":
		case "ellipse":
			return place({ x: s.fly / 2, y: 0 }, { x: 1, y: 0 });
		case "polygon": {
			const side = longestSide(s.vertices.map((v) => ({ x: at.x + v.fly, y: at.y + v.hoist })));
			return side !== null ? side : { at: null, out: null };
		}
		case "lozenge":
		case "star":
		case "triangle":
		case "plus":
		case "cardioid": {
			const geom = shapeGeom(s, at, 0);
			const side = geom.poly !== undefined ? longestSide(geom.poly) : null;
			return side !== null ? side : { at: null, out: null };
		}
		default:
			return { at: null, out: null };
	}
}

function skip(m: Measured, what: string): void {
	m.unmeasured.set(what, (m.unmeasured.get(what) ?? 0) + 1);
}

function part(m: Measured, along: "fly" | "hoist", at: Fraction): void {
	const seen = along === "fly" ? m.fly : m.hoist;
	const key = `${at.n}/${at.d}`;
	if (!seen.has(key)) {
		seen.add(key);
		(along === "fly" ? m.flyParts : m.hoistParts).push(at);
	}
}

function effects(m: Measured, l: Layer): void {
	if (l.clip !== undefined) {
		skip(m, `the clip on the ${describe(l)}`);
	}
	if (l.cuts.length > 0) {
		skip(m, `the ${l.cuts.length === 1 ? "cut" : "cuts"} in the ${describe(l)}`);
	}
}

function walk(layers: readonly Layer[], f: Frame, m: Measured): void {
	for (const l of layers) {
		effects(m, l);
		switch (l.layer) {
			case "field":
				break;
			case "bars":
				bars(l, f, m);
				break;
			case "band":
				band(l, f, m);
				break;
			case "cross":
				cross(l, f, m);
				break;
			case "saltire":
				if (l.counterchange) {
					const width = exactOf(l.width);
					m.notes.push((t) => `The ${describe(l)} is counterchanged: each arm is ${t(width)} wide, on one side of its diagonal.`);
				} else {
					m.saltires.push({ frame: f, width: exactOf(l.width), name: describe(l) });
				}
				if (l.fimbriate !== undefined) {
					// On the arm toward the upper fly, three tenths of the way out, where the width isn't measured.
					const { c, dir, normal } = slant(f, "bend-sinister", 0);
					const len = Math.hypot(toNumber(f.w), toNumber(f.h));
					fimbriation(m, describe(l), l.fimbriate, { x: c.x + dir.x * len * 0.3 + (normal.x * l.width) / 2, y: c.y + dir.y * len * 0.3 + (normal.y * l.width) / 2 }, normal);
				}
				break;
			case "quarters":
				if (!l.diagonal) {
					const at = l.split !== undefined ? point(l.split) : { x: half(f.w), y: half(f.h) };
					part(m, "fly", plus(f.x, at.x));
					part(m, "hoist", plus(f.y, at.y));
				}
				break;
			case "checks": {
				const rows = l.rows;
				const columns = l.columns;
				const w = over(f.w, fraction(BigInt(columns)));
				const h = over(f.h, fraction(BigInt(rows)));
				m.notes.push((t) => `Checks of ${rows} rows by ${columns} columns, each ${t(w)} along the fly by ${t(h)} down.`);
				break;
			}
			case "charge":
				charge(l, { x: f.x, y: f.y }, { x: plus(f.x, half(f.w)), y: plus(f.y, half(f.h)) }, f, m);
				break;
			case "emblem":
				if (l.along !== undefined || l.rotate !== 0) {
					emblemRows(l, f, m);
				} else {
					// An emblem that's only moved is a frame the sheet can measure in, from its origin.
					const origin = l.at !== undefined ? { x: plus(f.x, exactOf(l.at.fly)), y: plus(f.y, exactOf(l.at.hoist)) } : { x: plus(f.x, half(f.w)), y: plus(f.y, half(f.h)) };
					for (const c of l.charges) {
						effects(m, c);
						charge(c, origin, origin, null, m);
					}
				}
				break;
			case "group":
				walk(l.layers, f, m);
				break;
			case "panel":
				panel(l, f, m);
				break;
			case "use":
				skip(m, `the ${describe(l)}`);
				break;
			case "chevrons":
				chevrons(l, f, m);
				break;
			case "rays":
				skip(m, `the ${l.layer}`);
				break;
		}
	}
}

const axisWords = (along: string): string => (along === "bend-sinister" ? "bend sinister" : along);

/** A slanting layer's frame: its center, and the directions along its axis and across it, square to it. */
function slant(f: Frame, along: Axis | undefined, rotate: number): { c: Vec; dir: Vec; normal: Vec } {
	const r = { w: toNumber(f.w), h: toNumber(f.h) };
	const { dir, normal } = axis(r, along, rotate);
	return { c: { x: toNumber(f.x) + r.w / 2, y: toNumber(f.y) + r.h / 2 }, dir, normal };
}

/** The part of a line through a point that's within a region, for a construction line. */
function lineIn(p: Vec, dir: Vec, f: Frame): Vec[] {
	const [x0, y0, x1, y1] = [toNumber(f.x), toNumber(f.y), toNumber(f.x) + toNumber(f.w), toNumber(f.y) + toNumber(f.h)];
	let lo = -Infinity;
	let hi = Infinity;
	for (const [d, q, a, b] of [[dir.x, p.x, x0, x1], [dir.y, p.y, y0, y1]] as const) {
		if (Math.abs(d) < 1e-12) {
			continue;
		}
		const [t0, t1] = [(a - q) / d, (b - q) / d];
		lo = Math.max(lo, Math.min(t0, t1));
		hi = Math.min(hi, Math.max(t0, t1));
	}
	return hi > lo ? [{ x: p.x + dir.x * lo, y: p.y + dir.y * lo }, { x: p.x + dir.x * hi, y: p.y + dir.y * hi }] : [];
}

/**
 * A straight dimension on the flag between two of its points, in grid units, with ticks square to
 * it, and its label past either end or beside its middle, on the side of the flag's direction
 * `prefer` first if it's one. `dashed` are construction lines drawn with it, and `others` are other
 * places it could be measured, in order. It's left for the notes if its label has no room.
 */
function lineMark(m: Measured, a: Vec, b: Vec, text: (t: Format) => string, fallback: (text: string) => string, prefer: "beyond" | Vec, dashed: Vec[][] = [], others: [Vec, Vec][] = []): void {
	m.marks.push({
		text,
		fallback,
		options: (p, tw, th) => [[a, b] as [Vec, Vec], ...others].flatMap(([a, b]): MarkOption[] => {
			const [pa, pb] = [p.at(a), p.at(b)];
			const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
			if (!(len > 1e-9)) {
				return [];
			}
			const d = { x: (pb.x - pa.x) / len, y: (pb.y - pa.y) / len };
			let n = { x: -d.y, y: d.x };
			if (prefer !== "beyond") {
				const w = p.way(prefer);
				if (w.x * n.x + w.y * n.y < 0) {
					n = { x: -n.x, y: -n.y };
				}
			}
			const tick = (q: Vec): Vec[] => [{ x: q.x - n.x * 5, y: q.y - n.y * 5 }, { x: q.x + n.x * 5, y: q.y + n.y * 5 }];
			const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
			const beside = (g: number): Box[] => [spotAt(mid, n, tw, th, g), spotAt(mid, { x: -n.x, y: -n.y }, tw, th, g)];
			const beyond = (g: number): Box[] => [spotAt(pb, d, tw, th, g), spotAt(pa, { x: -d.x, y: -d.y }, tw, th, g)];
			const spots = [6, 14, 28].flatMap((g) => (prefer === "beyond" ? [...beyond(g), ...beside(g)] : [...beside(g), ...beyond(g)]));
			return [{ solid: [[pa, pb], tick(pa), tick(pb)], dashed: dashed.map((l) => l.map(p.at)), spots }];
		}),
	});
}

/**
 * A shaped edge: one period near its middle, on the flag, with its depth across it from extreme to
 * extreme, and its period along it, between two of the extremes on the side it starts on, and the
 * notes say how many periods there are and where it starts. `at` gives the point `s` along the edge
 * and `off` across it, toward its positive side, from where a straight edge would be, in grid
 * units. `span` is the edge's length exactly, or null if it's a diagonal's, which no fraction says.
 */
function shapedEdge(m: Measured, e: ShapedEdge, what: string, span: Fraction | null, length: number, at: (s: number, off: number) => Vec, start: string, side: string): void {
	const depth = exactOf(e.depth);
	const counted = e.count !== undefined && e.count > 0;
	const period = counted ? (span !== null ? over(span, fraction(BigInt(e.count!))) : null) : exactOf(e.period ?? 0);
	const p = period !== null ? toNumber(period) : length / e.count!;
	const d = e.depth / 2;
	const how = e.kind === "zigzag" ? `with a point toward ${side}` : `at its middle, heading away from ${side}`;
	const along = (t: Format): string => (span !== null ? `its ${t(span)}` : "the diagonal");
	m.notes.push((t) => `The ${what} is centered on where a straight edge would be, and ${counted ? `has ${e.count} periods along ${along(t)}` : `repeats along ${along(t)}`}. It starts at ${start}, ${how}.`);
	// The extremes on the side it starts on are at the start of each period for a zigzag, and a
	// quarter of one before it for a wave. The period measured is the middle one of those that fit.
	const phase = e.kind === "zigzag" ? 0 : 0.75 * p;
	const fit = Math.floor((length - phase - p) / p + 1e-9);
	if (!(p > 0) || fit < 0) {
		m.notes.push((t) => `The ${what} is ${t(depth)} deep, from one extreme to the other.`);
		return;
	}
	const sa = phase + Math.floor(fit / 2) * p;
	const guides = [-d, d].map((off) => [at(sa, off), at(sa + p, off)]);
	lineMark(m, at(sa + p / 2, -d), at(sa + p / 2, d), (t) => t(depth), (text) => `The ${what} is ${text} deep, from one extreme to the other.`, "beyond", guides);
	if (period !== null) {
		// Its label away from the edge, where the depth isn't.
		const away = { x: at(sa, -d - 1).x - at(sa, -d).x, y: at(sa, -d - 1).y - at(sa, -d).y };
		lineMark(m, at(sa, -d), at(sa + p, -d), (t) => t(period), (text) => `Each period of the ${what} is ${text} long.`, away);
	} else {
		m.notes.push(() => `Its period is the diagonal’s length divided by ${e.count}.`);
	}
}

/** A shaped edge between bars, measured on the first of them, and the rest are the same. */
function barsEdge(l: BarsLayer, f: Frame, m: Measured): void {
	const e = l.edge!;
	const r = { w: toNumber(f.w), h: toNumber(f.h) };
	const { dir, normal } = axis(r, l.along, l.rotate);
	const c = { x: toNumber(f.x) + r.w / 2, y: toNumber(f.y) + r.h / 2 };
	const offsets = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ((x! * r.w) / 2) * normal.x + ((y! * r.h) / 2) * normal.y);
	const lo = Math.min(...offsets);
	const hi = Math.max(...offsets);
	const total = l.ratio.reduce((a, b) => a + b, 0);
	const t = lo + ((hi - lo) * l.ratio[0]!) / total;
	const span = l.along === "fly" ? f.w : l.along === "hoist" ? f.h : null;
	const length = span !== null ? toNumber(span) : Math.hypot(r.w, r.h);
	const at = (s: number, off: number): Vec => ({ x: c.x - (dir.x * length) / 2 + dir.x * s + normal.x * (t + off), y: c.y - (dir.y * length) / 2 + dir.y * s + normal.y * (t + off) });
	const ends: Record<Axis, string> = { fly: "the hoist", hoist: "the top", bend: "the upper hoist corner", "bend-sinister": "the lower hoist corner" };
	const begins = l.rotate !== 0 ? `its first end, which is ${ends[l.along]} before the bars are turned` : ends[l.along];
	const name = l.colors.length > 2 ? `${e.kind} edge between the first two bars, and each of the others,` : `${e.kind} edge between the bars`;
	shapedEdge(m, e, name, span, length, at, begins, "the bar listed before it");
}

/** A side panel's shaped edge, along its inner side. */
function panelEdgeMark(p: PanelLayer, f: Frame, m: Measured): void {
	const e = p.edge!;
	const width = toNumber(exactOf(p.width ?? 0));
	const [x0, y0, w, h] = [toNumber(f.x), toNumber(f.y), toNumber(f.w), toNumber(f.h)];
	const ways: Record<EdgeName, { span: Fraction; at: (s: number, off: number) => Vec; start: string }> = {
		hoist: { span: f.h, at: (s, off) => ({ x: x0 + width + off, y: y0 + s }), start: "the top" },
		fly: { span: f.h, at: (s, off) => ({ x: x0 + w - width - off, y: y0 + s }), start: "the top" },
		top: { span: f.w, at: (s, off) => ({ x: x0 + s, y: y0 + width + off }), start: "the hoist" },
		bottom: { span: f.w, at: (s, off) => ({ x: x0 + s, y: y0 + h - width - off }), start: "the hoist" },
	};
	const way = ways[p.side!];
	shapedEdge(m, e, `${e.kind} edge of the ${describe(p)}`, way.span, toNumber(way.span), way.at, way.start, `the ${describe(p)}`);
}

/**
 * Bars along a bend, or turned: their widths are shares of the width across them all, which runs
 * corner to corner and is seldom a grid size, so the notes give the shares, exactly as the file does.
 */
function slantBars(l: BarsLayer, f: Frame, m: Measured): void {
	const what = l.rotate !== 0 ? `turned ${l.rotate}° from the ${axisWords(l.along)}` : `along the ${axisWords(l.along)}`;
	const { c, dir } = slant(f, l.along, l.rotate);
	m.guides.push(lineIn(c, dir, f));
	const shares = l.ratio.map((r) => decimal(exactOf(r), placesOf(exactOf(r)) ?? 4)).join(" : ");
	m.notes.push(() => `The ${l.colors.length} bars ${what} share the width across them, square to their axis, as ${shares}, from the one ${l.rotate === 0 && l.along === "bend-sinister" ? "nearest the upper hoist" : "listed first"}.`);
	if (l.edge !== undefined) {
		barsEdge(l, f, m);
	}
}

/** A band along a bend, or turned: its width, measured across it on the flag, and how far it's moved off center. */
function slantBand(l: BandLayer, f: Frame, m: Measured): void {
	const name = describe(l);
	const { c, dir, normal } = slant(f, l.along, l.rotate);
	const offset = exactOf(l.offset);
	const centre = { x: c.x + normal.x * l.offset, y: c.y + normal.y * l.offset };
	m.guides.push(lineIn(centre, dir, f));
	if (l.rotate !== 0) {
		m.notes.push(() => `The ${name} is turned ${l.rotate}° from the ${axisWords(l.along)}, clockwise about the center.`);
	} else {
		m.notes.push(() => `The ${name} runs along the ${axisWords(l.along)}, from corner to corner.`);
	}
	if (offset.n !== 0n) {
		m.notes.push((t) => `The ${name}’s center line is ${t(offset)} from the center, square to it.`);
	}
	const width = exactOf(l.width);
	const reach = Math.min(toNumber(f.w), toNumber(f.h)) * 0.3;
	const at = { x: centre.x + dir.x * reach, y: centre.y + dir.y * reach };
	m.marks.push({
		text: (t) => t(width),
		fallback: (text) => `The ${name} is ${text} wide, square to its axis.`,
		options: (p, tw, th) => {
			const ends = [-1, 1].map((k) => p.at({ x: at.x + (normal.x * k * l.width) / 2, y: at.y + (normal.y * k * l.width) / 2 }));
			const along = p.way(dir);
			const tick = (q: Vec): Vec[] => [{ x: q.x - along.x * 5, y: q.y - along.y * 5 }, { x: q.x + along.x * 5, y: q.y + along.y * 5 }];
			const out = [-1, 1].map((k) => p.way({ x: normal.x * k, y: normal.y * k }));
			const spots = [6, 14, 28].flatMap((g) => [spotAt(ends[1]!, out[1]!, tw, th, g), spotAt(ends[0]!, out[0]!, tw, th, g)]);
			return [{ solid: [[ends[0]!, ends[1]!], tick(ends[0]!), tick(ends[1]!)], dashed: [], spots }];
		},
	});
	if (l.fimbriate !== undefined) {
		// As far the other way along it as its width is measured, on its side away from the center line.
		fimbriation(m, name, l.fimbriate, { x: centre.x - dir.x * reach + (normal.x * l.width) / 2, y: centre.y - dir.y * reach + (normal.y * l.width) / 2 }, normal);
	}
}

/** What an emblem's charge covers in its frame, exactly, or null for a shape whose reach isn't a size the file gives. */
function halfSize(s: Shape): XY | null {
	if (s.rotate !== 0) {
		return null;
	}
	switch (s.kind) {
		case "disc":
		case "ring":
			return { x: exactOf(s.radius), y: exactOf(s.radius) };
		case "rect":
		case "ellipse":
			return { x: half(exactOf(s.fly)), y: half(exactOf(s.hoist)) };
		case "lozenge":
			return s.fly !== undefined && s.hoist !== undefined ? { x: half(exactOf(s.fly)), y: half(exactOf(s.hoist)) } : null;
		default:
			return null;
	}
}

/** Where a charge's copies are, in its frame, exactly, or null for a repeat that isn't a line. */
function copiesOf(l: ChargeLayer): XY[] | null {
	const s = l.shape;
	const firsts = (s.ats ?? [s.at ?? null]).map((p) => (p === null ? { x: zero, y: zero } : point(p)));
	if (l.repeat === undefined) {
		return firsts;
	}
	const rep = l.repeat;
	if (rep.kind !== "line") {
		return null;
	}
	const step = { x: exactOf(rep.fly), y: exactOf(rep.hoist) };
	return firsts.flatMap((p) => Array.from({ length: rep.count }, (_, i) => ({ x: plus(p.x, times(step.x, fraction(BigInt(i)))), y: plus(p.y, times(step.y, fraction(BigInt(i)))) })));
}

/**
 * An emblem along a bend, or turned: what's in it is measured in its own frame, along its axis from
 * its origin, on a row drawn slanting over the flag, with the axis as a construction line. The
 * outermost group is measured across too, and the first repeated charge in it has a detail.
 */
function emblemRows(l: EmblemLayer, f: Frame, m: Measured): void {
	const name = l.along !== undefined ? `emblem along the ${axisWords(l.along)}` : "turned emblem";
	const origin = l.at !== undefined ? { x: plus(f.x, exactOf(l.at.fly)), y: plus(f.y, exactOf(l.at.hoist)) } : { x: plus(f.x, half(f.w)), y: plus(f.y, half(f.h)) };
	const o = vec(origin);
	const { dir } = slant(f, l.along ?? "fly", l.rotate);
	const frame: Affine = [dir.x, dir.y, -dir.y, dir.x, o.x, o.y];
	m.guides.push(lineIn(o, dir, f));
	if (l.at !== undefined) {
		m.charges.push({ x: origin.x, y: origin.y, at: o, reach: { x: 0, y: 0 }, name: `${name}’s origin` });
	}
	// What each charge covers, along the axis and across it.
	const covers: { x0: Fraction; x1: Fraction; y0: Fraction; y1: Fraction }[] = [];
	let detail: { c: ChargeLayer; copies: XY[]; size: XY } | null = null;
	const breaks: Fraction[] = [];
	for (const c of l.charges) {
		if (c.clip !== undefined) {
			skip(m, `the clip on the ${describe(c)}`);
		}
		if (c.fimbriate !== undefined) {
			// Measured on the first copy, in the emblem's frame, and drawn where that is on the flag.
			const first = c.shape.ats?.[0] ?? c.shape.at;
			const edge = chargeEdge(c.shape, first !== undefined && first !== null ? { x: first.fly, y: first.hoist } : { x: 0, y: 0 });
			fimbriation(m, describe(c), c.fimbriate, edge.at !== null ? apply(frame, edge.at) : null, edge.out !== null ? turnVec(frame, edge.out) : null);
		}
		const size = halfSize(c.shape);
		const copies = copiesOf(c);
		if (size === null || copies === null) {
			skip(m, `the ${describe(c)} in the ${name}`);
			continue;
		}
		// A charge's copies are one group, as a trigram's bars are, which the detail measures one by one.
		const lo = (list: Fraction[]): Fraction => list.reduce((a, b) => (compare(a, b) <= 0 ? a : b));
		const hi = (list: Fraction[]): Fraction => list.reduce((a, b) => (compare(a, b) >= 0 ? a : b));
		covers.push({ x0: minus(lo(copies.map((p) => p.x)), size.x), x1: plus(hi(copies.map((p) => p.x)), size.x), y0: minus(lo(copies.map((p) => p.y)), size.y), y1: plus(hi(copies.map((p) => p.y)), size.y) });
		if (c.repeat?.kind === "line" && copies.length > 1 && (detail === null || (detail.c.cuts.length === 0 && c.cuts.length > 0))) {
			detail = { c, copies, size };
		}
		// A level rect cut across a charge is a break in it, as long as the rect is; anything else isn't measured.
		for (const cut of c.cuts) {
			if (cut.kind === "rect" && cut.rotate === 0) {
				const long = exactOf(cut.hoist);
				if (!breaks.some((b) => same(b, long))) {
					breaks.push(long);
				}
			} else {
				skip(m, `the cut in the ${describe(c)}`);
			}
		}
	}
	if (breaks.length > 0) {
		m.notes.push((t) => `The cuts in the ${name} are breaks across the charges, ${breaks.map(t).join(" or ")} long.`);
	}
	if (covers.length === 0) {
		return;
	}
	// The groups along the axis, where what's in the emblem overlaps or touches.
	covers.sort((a, b) => compare(a.x0, b.x0));
	const groups: typeof covers = [];
	for (const c of covers) {
		const last = groups.at(-1);
		if (last !== undefined && compare(c.x0, last.x1) <= 0) {
			last.x1 = compare(c.x1, last.x1) > 0 ? c.x1 : last.x1;
			last.y0 = compare(c.y0, last.y0) < 0 ? c.y0 : last.y0;
			last.y1 = compare(c.y1, last.y1) > 0 ? c.y1 : last.y1;
		} else {
			groups.push({ ...c });
		}
	}
	// From the origin outward, each group's near and far ends: one way if the emblem is the same both ways.
	const ends = (sign: 1 | -1): Fraction[] => {
		const out: Fraction[] = [zero];
		for (const g of sign === 1 ? groups : [...groups].reverse()) {
			for (const e of sign === 1 ? [g.x0, g.x1] : [g.x1, g.x0]) {
				const d = sign === 1 ? e : minus(zero, e);
				if (compare(d, out.at(-1)!) > 0) {
					out.push(d);
				}
			}
		}
		return out;
	};
	const ahead = ends(1);
	const behind = ends(-1);
	const symmetric = ahead.length === behind.length && ahead.every((x, i) => same(x, behind[i]!));
	const stops = symmetric || behind.length < 2 ? ahead : ahead.length < 2 ? behind.map((x) => minus(zero, x)).reverse() : [...behind.slice(1).map((x) => minus(zero, x)).reverse(), ...ahead];
	if (stops.length < 2) {
		return;
	}
	const outer = compare(stops.at(-1)!, zero) > 0 ? groups.at(-1)! : groups[0]!;
	const reach = Math.max(...groups.map((g) => Math.max(Math.abs(toNumber(g.y0)), Math.abs(toNumber(g.y1)))));
	const across = { at: toNumber(compare(stops.at(-1)!, zero) > 0 ? outer.x1 : outer.x0), from: outer.y0, to: outer.y1 };
	m.rows.push({
		frame,
		stops,
		reach,
		across,
		fallback: (t) => {
			const steps = stops.slice(1).map((s, i) => t(minus(s, stops[i]!))).join(", ");
			return `Along the ${name}’s axis, from ${symmetric ? "its origin, and the same the other way" : "end to end"}: ${steps}, and ${t(minus(across.to, across.from))} across at the end.`;
		},
	});
	m.slanting = true;
	if (detail !== null) {
		emblemDetail(detail.c, detail.copies, detail.size, frame, name, m);
	}
}

/** The detail of a repeated charge in an emblem's frame: its copies' widths and the gaps between them, its length, and any break a cut makes. */
function emblemDetail(c: ChargeLayer, copies: XY[], size: XY, frame: Affine, emblem: string, m: Measured): void {
	const shown = copies.slice(0, 3);
	const xs = shown.flatMap((p) => [minus(p.x, size.x), plus(p.x, size.x)]).sort(compare).filter((v, i, all) => i === 0 || !same(v, all[i - 1]!));
	const ys = [minus(shown[0]!.y, size.y), plus(shown[0]!.y, size.y)];
	const dims: DetailDim[] = [];
	const y0 = toNumber(ys[0]!);
	const x0 = toNumber(xs[0]!);
	for (let i = 0; i + 1 < xs.length; i++) {
		const [a, b] = [xs[i]!, xs[i + 1]!];
		dims.push({ a: { x: toNumber(a), y: y0 }, b: { x: toNumber(b), y: y0 }, text: (t) => t(minus(b, a)), optional: xs.length > 2 });
	}
	if (xs.length > 2) {
		const [a, b] = [xs[0]!, xs.at(-1)!];
		dims.push({ a: { x: toNumber(a), y: y0 }, b: { x: toNumber(b), y: y0 }, text: (t) => t(minus(b, a)) });
	}
	dims.push({ a: { x: x0, y: y0 }, b: { x: x0, y: toNumber(ys[1]!) }, text: (t) => t(minus(ys[1]!, ys[0]!)) });
	// A cut across the first copy is a break in it, as long as the cut is.
	const cut = c.cuts[0];
	let broken: Fraction | null = null;
	if (cut !== undefined && cut.kind === "rect" && cut.rotate === 0 && cut.at !== undefined) {
		const ch = half(exactOf(cut.hoist));
		const cy = exactOf(cut.at.hoist);
		const [b0, b1] = [minus(cy, ch), plus(cy, ch)];
		if (compare(b0, ys[0]!) > 0 && compare(b1, ys[1]!) < 0) {
			broken = exactOf(cut.hoist);
			const x = toNumber(xs.at(-1)!);
			for (const [a, b] of [[ys[0]!, b0], [b0, b1], [b1, ys[1]!]] as const) {
				dims.push({ a: { x, y: toNumber(a) }, b: { x, y: toNumber(b) }, text: (t) => t(minus(b, a)), optional: true });
			}
		}
	}
	const pad = toNumber(minus(ys[1]!, ys[0]!)) * 0.08;
	const width = exactOf((c.shape as { fly?: number }).fly ?? 0);
	const gap = shown.length > 1 ? minus(minus(shown[1]!.x, shown[0]!.x), times(size.x, fraction(2n))) : null;
	const name = plural(2, named(c.color, kindWords[c.shape.kind] ?? c.shape.kind));
	m.details.push({
		title: name,
		frame,
		level: true,
		window: { x0: x0 - pad, y0: y0 - pad, x1: toNumber(xs.at(-1)!) + pad, y1: toNumber(ys[1]!) + pad },
		copies: [],
		dims,
		caption: (t) => `One group of ${name} in the ${emblem}, turned level: each ${t(width)} by ${t(minus(ys[1]!, ys[0]!))}${gap !== null && compare(gap, zero) > 0 ? `, ${t(gap)} apart` : ""}${broken !== null ? `, broken by a gap ${t(broken)} long` : ""}.`,
	});
}

function bars(l: BarsLayer, f: Frame, m: Measured): void {
	if (l.fixed !== undefined) {
		skip(m, "the bars, which adapting moved");
		return;
	}
	if ((l.along !== "fly" && l.along !== "hoist") || l.rotate !== 0) {
		slantBars(l, f, m);
		return;
	}
	const ratio = l.ratio.map(exactOf);
	const total = sum(ratio);
	const across = l.along === "fly" ? "hoist" : "fly";
	const span = across === "hoist" ? f.h : f.w;
	const start = across === "hoist" ? f.y : f.x;
	let run = zero;
	for (const r of ratio.slice(0, -1)) {
		run = plus(run, r);
		part(m, across, plus(start, times(span, over(run, total))));
	}
	if (l.edge !== undefined) {
		barsEdge(l, f, m);
	}
}

function band(l: BandLayer, f: Frame, m: Measured): void {
	if (l.fixed !== undefined) {
		skip(m, `the ${describe(l)}, which adapting moved`);
		return;
	}
	if ((l.along !== "fly" && l.along !== "hoist") || l.rotate !== 0) {
		slantBand(l, f, m);
		return;
	}
	const across = l.along === "fly" ? "hoist" : "fly";
	const middle = plus(across === "hoist" ? plus(f.y, half(f.h)) : plus(f.x, half(f.w)), exactOf(l.offset));
	const width = exactOf(l.width);
	part(m, across, minus(middle, half(width)));
	part(m, across, plus(middle, half(width)));
	if (l.fimbriate !== undefined) {
		// On its upper or hoist side, three quarters of the way along it.
		const edge = toNumber(minus(middle, half(width)));
		const at = l.along === "fly" ? { x: toNumber(f.x) + toNumber(f.w) * 0.75, y: edge } : { x: edge, y: toNumber(f.y) + toNumber(f.h) * 0.75 };
		fimbriation(m, describe(l), l.fimbriate, at, l.along === "fly" ? { x: 0, y: -1 } : { x: -1, y: 0 });
	}
}

function cross(l: CrossLayer, f: Frame, m: Measured): void {
	const arm = (triple: readonly number[], start: Fraction, span: Fraction, along: "fly" | "hoist"): void => {
		const [a, w, b] = triple.map(exactOf) as [Fraction, Fraction, Fraction];
		const total = plus(plus(a, w), b);
		part(m, along, plus(start, times(span, over(a, total))));
		part(m, along, plus(start, times(span, over(plus(a, w), total))));
	};
	arm(l.fly, f.x, f.w, "fly");
	arm(l.hoist, f.y, f.h, "hoist");
	if (l.fimbriate !== undefined) {
		// On the hoist side of the upright arm, halfway down to the level one.
		const [a, w, b] = l.fly.map(exactOf) as [Fraction, Fraction, Fraction];
		const x = toNumber(plus(f.x, times(f.w, over(a, plus(plus(a, w), b)))));
		const [c, h, d] = l.hoist.map(exactOf) as [Fraction, Fraction, Fraction];
		const y = toNumber(f.y) + toNumber(times(f.h, over(c, plus(plus(c, h), d)))) / 2;
		fimbriation(m, describe(l), l.fimbriate, { x, y }, { x: -1, y: 0 });
	}
}

/**
 * An edge of a region, as the format places things by one: how long it is, a point some way in
 * from it and along it, which axis runs along it, and the directions in and along on the flag.
 */
interface EdgeFrame {
	length: Fraction;
	place: (inward: Fraction, along: Fraction) => { x: Fraction; y: Fraction };
	along: "fly" | "hoist";
	u: Vec;
	v: Vec;
}

function edgeOf(from: EdgeName, f: Frame): EdgeFrame {
	switch (from) {
		case "fly":
			return { length: f.h, along: "hoist", u: { x: -1, y: 0 }, v: { x: 0, y: 1 }, place: (i, a) => ({ x: minus(plus(f.x, f.w), i), y: plus(f.y, a) }) };
		case "top":
			return { length: f.w, along: "fly", u: { x: 0, y: 1 }, v: { x: 1, y: 0 }, place: (i, a) => ({ x: plus(f.x, a), y: plus(f.y, i) }) };
		case "bottom":
			return { length: f.w, along: "fly", u: { x: 0, y: -1 }, v: { x: 1, y: 0 }, place: (i, a) => ({ x: plus(f.x, a), y: minus(plus(f.y, f.h), i) }) };
		default:
			return { length: f.h, along: "hoist", u: { x: 1, y: 0 }, v: { x: 0, y: 1 }, place: (i, a) => ({ x: plus(f.x, i), y: plus(f.y, a) }) };
	}
}

const across = (along: "fly" | "hoist"): "fly" | "hoist" => (along === "fly" ? "hoist" : "fly");
const coord = (p: { x: Fraction; y: Fraction }, along: "fly" | "hoist"): Fraction => (along === "fly" ? p.x : p.y);
const vec = (p: { x: Fraction; y: Fraction }): Vec => ({ x: toNumber(p.x), y: toNumber(p.y) });
const pathOf = (points: readonly Vec[]): string => points.map((q, i) => `${i === 0 ? "M" : "L"}${num(q.x)} ${num(q.y)}`).join("");

/** A label's box `w` by `h`, a gap `g` from a point in a direction on the sheet, centered across it. */
function spotAt(q: Vec, n: Vec, w: number, h: number, g: number): Box {
	const reach = g + (Math.abs(n.x) * w + Math.abs(n.y) * h) / 2;
	const c = { x: q.x + n.x * reach, y: q.y + n.y * reach };
	return { x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 };
}

/**
 * Chevrons: each apex is a place on the row across their edge, so that the chain there gives the
 * depth and each chevron's share of it, and an `apex` is a place along the edge. An `angle` is
 * marked at the outermost apex, and without one the arms meet the edge's corners, which the notes say.
 */
function chevrons(l: ChevronsLayer, f: Frame, m: Measured): void {
	const name = describe(l);
	if (l.rotate !== 0) {
		skip(m, `the turned ${name}`);
		return;
	}
	const e = edgeOf(l.from, f);
	const ratio = l.ratio.map(exactOf);
	const total = sum(ratio);
	const depth = exactOf(l.depth);
	const middle = l.apex !== undefined ? exactOf(l.apex) : half(e.length);
	let run = zero;
	let apex = e.place(zero, middle);
	for (const r of ratio) {
		run = plus(run, r);
		apex = e.place(times(depth, over(run, total)), middle);
		part(m, across(e.along), coord(apex, across(e.along)));
	}
	if (l.apex !== undefined) {
		part(m, e.along, coord(apex, e.along));
	}
	if (l.fimbriate !== undefined) {
		// Across the outermost chevron's arm, a little way from its apex toward the edge's end.
		const len = toNumber(e.length);
		const d = toNumber(depth);
		const slope = l.angle !== undefined ? 1 / Math.tan((l.angle * Math.PI) / 180) : d / (len / 2);
		const q = Math.min(len / 4, d / (2 * slope));
		const tip = vec(apex);
		const n = Math.hypot(1, slope);
		fimbriation(m, name, l.fimbriate, { x: tip.x - e.u.x * slope * q + e.v.x * q, y: tip.y - e.u.y * slope * q + e.v.y * q }, { x: (e.u.x + e.v.x * slope) / n, y: (e.u.y + e.v.y * slope) / n });
	}
	const edge = l.from === "hoist" || l.from === "fly" ? `the ${l.from}` : `the ${l.from} edge`;
	if (l.angle === undefined) {
		m.notes.push(() => `The outermost arms of the ${name} meet the corners of ${edge}.`);
		return;
	}
	const degrees = l.angle;
	const theta = (degrees * Math.PI) / 180;
	const tip = vec(apex);
	const foot = vec(e.place(zero, middle));
	const { u, v } = e;
	m.marks.push({
		text: () => recordValue(`${degrees}°`, exactOf(degrees), "degrees"),
		fallback: (text) => `The outermost arms of the ${name} are at ${text} to the line through their apexes.`,
		// The angle is between the line back to the edge and an arm, on whichever side has room.
		options: (p, w, h) => [1, -1].map((side) => {
			const toward = (a: number): Vec => p.way({ x: -u.x * Math.cos(a) + side * v.x * Math.sin(a), y: -u.y * Math.cos(a) + side * v.y * Math.sin(a) });
			const at = p.at(tip);
			const r = 34;
			const arc = Array.from({ length: 13 }, (_, i) => {
				const d = toward((theta * i) / 12);
				return { x: at.x + d.x * r, y: at.y + d.y * r };
			});
			const mid = toward(theta / 2);
			const edgeAt = { x: at.x + mid.x * r, y: at.y + mid.y * r };
			return { solid: [arc], dashed: [[at, p.at(foot)]], spots: [6, 16, 30].map((g) => spotAt(edgeAt, mid, w, h, g)) };
		}),
	});
}

const edgeName = (from: EdgeName): string => (from === "hoist" || from === "fly" ? `the ${from}` : `the ${from} edge`);

/**
 * A pile: both ends of its base are places along its edge, and its depth, or its tip, a place
 * across it. A flat end is two places along the edge, at its depth. The notes say which is which.
 */
function pile(name: string, s: PileShape, f: Frame, m: Measured): void {
	const e = edgeOf(s.from, f);
	const a = s.base !== undefined ? exactOf(s.base[0]) : zero;
	const b = s.base !== undefined ? exactOf(s.base[1]) : e.length;
	part(m, e.along, coord(e.place(zero, a), e.along));
	part(m, e.along, coord(e.place(zero, b), e.along));
	const line = s.hollow !== undefined ? exactOf(s.hollow) : undefined;
	const outline = (t: Format): string => (line !== undefined ? ` It’s drawn as an outline ${t(line)} wide.` : "");
	if (s.tip !== undefined) {
		const along = exactOf(s.tip[0]);
		const inward = exactOf(s.tip[1]);
		const tip = e.place(inward, along);
		part(m, e.along, coord(tip, e.along));
		part(m, across(e.along), coord(tip, across(e.along)));
		m.notes.push((t) => `The ${name} stands on ${edgeName(s.from)} from ${t(a)} to ${t(b)}, with its point ${t(inward)} in from it and ${t(along)} along it.${outline(t)}`);
		return;
	}
	const depth = exactOf(s.depth ?? 0);
	const mid = half(plus(a, b));
	part(m, across(e.along), coord(e.place(depth, mid), across(e.along)));
	if (s.flat !== undefined && s.flat > 0) {
		const flat = exactOf(s.flat);
		part(m, e.along, coord(e.place(depth, minus(mid, half(flat))), e.along));
		part(m, e.along, coord(e.place(depth, plus(mid, half(flat))), e.along));
		m.notes.push((t) => `The ${name} stands on ${edgeName(s.from)} from ${t(a)} to ${t(b)}, and reaches ${t(depth)} in from it, where its end is ${t(flat)} wide.${outline(t)}`);
		return;
	}
	m.notes.push((t) => `The ${name} stands on ${edgeName(s.from)} from ${t(a)} to ${t(b)}, and reaches ${t(depth)} in from it, to a point.${outline(t)}`);
}

/**
 * A pall: its junction is a place across its edge, and its stem's sides places along it. Its arms
 * slant, so their width is measured across one, at its middle.
 */
function pall(name: string, s: PallShape, f: Frame, m: Measured): void {
	const e = edgeOf(s.from, f);
	const width = exactOf(s.width);
	const mid = half(e.length);
	const junction = s.junction !== undefined && s.junction !== 0 ? exactOf(s.junction) : mid;
	part(m, across(e.along), coord(e.place(junction, mid), across(e.along)));
	part(m, e.along, coord(e.place(junction, minus(mid, half(width))), e.along));
	part(m, e.along, coord(e.place(junction, plus(mid, half(width))), e.along));
	if (s.hollow !== undefined) {
		const line = exactOf(s.hollow);
		m.notes.push((t) => `The ${name} is drawn as an outline ${t(line)} wide.`);
	}
	// The arm from the edge's first corner to the junction, as a direction on the flag and its middle.
	const { u, v } = e;
	const j = toNumber(junction);
	const c = toNumber(mid);
	const d = { x: u.x * j + v.x * c, y: u.y * j + v.y * c };
	const length = Math.hypot(d.x, d.y);
	const dir = { x: d.x / length, y: d.y / length };
	const normal = { x: -dir.y, y: dir.x };
	// The middle of the arm, or for a pall inside another, which shares its arm, a little along it.
	const share = [0.5, 0.68, 0.32, 0.82][m.palls++ % 4]!;
	const corner = vec(e.place(zero, zero));
	const centre = { x: corner.x + d.x * share, y: corner.y + d.y * share };
	const w = toNumber(width);
	m.marks.push({
		text: (t) => t(width),
		fallback: (text) => `The ${name}’s arms are ${text} wide, measured across them.`,
		options: (p, tw, th) => {
			const ends = [-1, 1].map((k) => p.at({ x: centre.x + (normal.x * k * w) / 2, y: centre.y + (normal.y * k * w) / 2 }));
			const along = p.way(dir);
			const tick = (q: Vec): Vec[] => [{ x: q.x - along.x * 5, y: q.y - along.y * 5 }, { x: q.x + along.x * 5, y: q.y + along.y * 5 }];
			const solid = [[ends[0]!, ends[1]!], tick(ends[0]!), tick(ends[1]!)];
			const out = [-1, 1].map((k) => p.way({ x: normal.x * k, y: normal.y * k }));
			const spots = [6, 14, 28].flatMap((g) => [spotAt(ends[1]!, out[1]!, tw, th, g), spotAt(ends[0]!, out[0]!, tw, th, g)]);
			return [{ solid, dashed: [], spots }];
		},
	});
}

/** Where to measure a pile's fimbriation: across the middle of its side from the start of its base. */
function pileEdge(s: PileShape, f: Frame): { at: Vec; out: Vec } {
	const e = edgeOf(s.from, f);
	const a = s.base !== undefined ? s.base[0] : 0;
	const b = s.base !== undefined ? s.base[1] : toNumber(e.length);
	const [inward, lo] = s.tip !== undefined ? [s.tip[1], s.tip[0]] : [s.depth ?? 0, (a + b) / 2 - (s.flat ?? 0) / 2];
	const n = Math.hypot(lo - a, inward);
	const corner = vec(e.place(zero, zero));
	const [i, al] = [inward / 2, (a + lo) / 2];
	const [ni, na] = [(lo - a) / n, -inward / n];
	return { at: { x: corner.x + e.u.x * i + e.v.x * al, y: corner.y + e.u.y * i + e.v.y * al }, out: { x: e.u.x * ni + e.v.x * na, y: e.u.y * ni + e.v.y * na } };
}

/** Where to measure a pall's fimbriation: across its stem, halfway from the junction to the far side. */
function pallEdge(s: PallShape, f: Frame): { at: Vec; out: Vec } {
	const e = edgeOf(s.from, f);
	const len = toNumber(e.length);
	const far = s.from === "top" || s.from === "bottom" ? toNumber(f.h) : toNumber(f.w);
	const junction = s.junction !== undefined && s.junction !== 0 ? s.junction : len / 2;
	const corner = vec(e.place(zero, zero));
	const [i, al] = [(junction + far) / 2, len / 2 + s.width / 2];
	return { at: { x: corner.x + e.u.x * i + e.v.x * al, y: corner.y + e.u.y * i + e.v.y * al }, out: e.v };
}

/** Where a panel is, exactly, as `panelRect` draws it, with the region its layers use. */
function panelFrames(p: PanelLayer, f: Frame): { drawn: Frame; region: Frame } {
	const extra = p.edge !== undefined ? half(exactOf(p.edge.depth)) : zero;
	const width = exactOf(p.width ?? 0);
	const fly = exactOf(p.fly ?? 0);
	const hoist = exactOf(p.hoist ?? 0);
	const right = (w: Fraction): Fraction => plus(f.x, minus(f.w, w));
	const lower = (h: Fraction): Fraction => plus(f.y, minus(f.h, h));
	switch (p.side) {
		case "hoist":
			return { drawn: { x: f.x, y: f.y, w: width, h: f.h }, region: { x: f.x, y: f.y, w: plus(width, extra), h: f.h } };
		case "fly":
			return { drawn: { x: right(width), y: f.y, w: width, h: f.h }, region: { x: right(plus(width, extra)), y: f.y, w: plus(width, extra), h: f.h } };
		case "top":
			return { drawn: { x: f.x, y: f.y, w: f.w, h: width }, region: { x: f.x, y: f.y, w: f.w, h: plus(width, extra) } };
		case "bottom":
			return { drawn: { x: f.x, y: lower(width), w: f.w, h: width }, region: { x: f.x, y: lower(plus(width, extra)), w: f.w, h: plus(width, extra) } };
	}
	let x: Fraction;
	let y: Fraction;
	switch (p.corner) {
		case "upper-hoist":
			[x, y] = [f.x, f.y];
			break;
		case "upper-fly":
			[x, y] = [right(fly), f.y];
			break;
		case "lower-hoist":
			[x, y] = [f.x, lower(hoist)];
			break;
		case "lower-fly":
			[x, y] = [right(fly), lower(hoist)];
			break;
		default: {
			const at = p.at !== undefined ? point(p.at) : { x: half(f.w), y: half(f.h) };
			[x, y] = [plus(f.x, minus(at.x, half(fly))), plus(f.y, minus(at.y, half(hoist)))];
		}
	}
	const r = { x, y, w: fly, h: hoist };
	return { drawn: r, region: r };
}

function panel(p: PanelLayer, f: Frame, m: Measured): void {
	const { drawn, region } = panelFrames(p, f);
	part(m, "fly", drawn.x);
	part(m, "fly", plus(drawn.x, drawn.w));
	part(m, "hoist", drawn.y);
	part(m, "hoist", plus(drawn.y, drawn.h));
	if (p.edge !== undefined) {
		panelEdgeMark(p, f, m);
	}
	walk(p.layers, region, m);
}

/** A charge's sizes, as its label gives them, and how far it reaches from its center. */
function sizeOf(s: Shape, region: Frame | null): { size?: (t: Format) => string; reach: { x: number; y: number }; circle?: number } {
	const r = "radius" in s ? s.radius : 0;
	const round = { x: r, y: r };
	const line = s.hollow !== undefined ? exactOf(s.hollow) : undefined;
	const withLine = (text: (t: Format) => string): ((t: Format) => string) => (line === undefined ? text : (t) => `${text(t)} · line ${t(line)}`);
	const box = (fly: Fraction, hoist: Fraction, prefix = ""): { size: (t: Format) => string; reach: { x: number; y: number } } => {
		const reach = { x: toNumber(fly) / 2, y: toNumber(hoist) / 2 };
		if (s.rotate !== 0) {
			const d = Math.hypot(reach.x, reach.y);
			reach.x = d;
			reach.y = d;
		}
		return { size: withLine((t) => `${prefix}${t(fly)} × ${t(hoist)}`), reach };
	};
	switch (s.kind) {
		case "disc":
		case "triangle":
		case "cardioid":
			return { size: withLine((t) => `r ${t(exactOf(s.radius))}`), reach: s.kind === "cardioid" ? { x: r * 0.65, y: r } : round, ...(s.kind === "triangle" ? { circle: r } : {}) };
		case "ring": {
			const inner = exactOf(s.inner);
			return { size: withLine((t) => `r ${t(exactOf(s.radius))} · inner ${t(inner)}`), reach: round };
		}
		case "star": {
			const auto = (s as { autoInner?: boolean }).autoInner === true;
			const inner = exactOf(s.inner);
			return { size: withLine((t) => `r ${t(exactOf(s.radius))}${auto ? "" : ` · inner ${t(inner)}`}`), reach: round, circle: r };
		}
		case "sun": {
			const disc = exactOf(s.disc);
			const gap = s.gap !== undefined ? exactOf(s.gap) : undefined;
			return { size: withLine((t) => `r ${t(exactOf(s.radius))} · disc ${t(disc)}${gap !== undefined ? ` · gap ${t(gap)}` : ""}`), reach: round, circle: r };
		}
		case "plus": {
			const width = exactOf(s.width);
			return { size: withLine((t) => `r ${t(exactOf(s.radius))} · width ${t(width)}`), reach: s.rotate !== 0 ? { x: r * 1.42, y: r * 1.42 } : round };
		}
		case "crescent": {
			const inner = exactOf(s.inner);
			const offset = exactOf(s.offset);
			return { size: withLine((t) => `r ${t(exactOf(s.radius))} · inner ${t(inner)} · offset ${t(offset)}`), reach: round };
		}
		case "heart": {
			const spread = exactOf(s.spread);
			return { size: withLine((t) => `r ${t(exactOf(s.radius))} · spread ${t(spread)}`), reach: { x: s.spread / 2 + r, y: r * 2 } };
		}
		case "rect":
		case "ellipse":
			return box(exactOf(s.fly), exactOf(s.hoist));
		case "svg":
			return box(exactOf(s.fly), exactOf(s.hoist), "box ");
		case "lozenge":
			if ((s.fly === undefined || s.hoist === undefined) && region === null) {
				return { reach: { x: 0, y: 0 } };
			}
			return box(s.fly !== undefined ? exactOf(s.fly) : region!.w, s.hoist !== undefined ? exactOf(s.hoist) : region!.h);
		case "path": {
			const [, , bw, bh] = s.box.map(exactOf) as [Fraction, Fraction, Fraction, Fraction];
			const fly = s.fly !== undefined ? exactOf(s.fly) : s.hoist !== undefined ? times(exactOf(s.hoist), over(bw, bh)) : undefined;
			const hoist = s.hoist !== undefined ? exactOf(s.hoist) : fly !== undefined ? times(fly, over(bh, bw)) : undefined;
			if (fly === undefined || hoist === undefined) {
				return { reach: { x: 0, y: 0 } };
			}
			return box(fly, hoist, "box ");
		}
		case "polygon":
		case "pile":
		case "pall":
			return { reach: { x: 0, y: 0 } };
	}
}

/**
 * Measures a charge, or the first of its copies. `base` is where its positions are measured from,
 * and `center` where it is if it doesn't say.
 */
function charge(l: ChargeLayer, base: { x: Fraction; y: Fraction }, center: { x: Fraction; y: Fraction }, region: Frame | null, m: Measured): void {
	const s = l.shape;
	const name = describe(l);
	if (s.kind === "pile" || s.kind === "pall") {
		if (region === null) {
			skip(m, `the ${name}`);
		} else if (s.kind === "pile") {
			pile(name, s, region, m);
		} else {
			pall(name, s, region, m);
		}
		if (l.fimbriate !== undefined && region !== null) {
			const edge = s.kind === "pile" ? pileEdge(s, region) : pallEdge(s, region);
			fimbriation(m, name, l.fimbriate, edge.at, edge.out);
		}
		return;
	}
	if (m.charges.length >= mostCharges) {
		m.extra++;
		return;
	}
	/** Measures its fimbriation on the copy at a place, once that's known. */
	const fimbriated = (copy: Vec): void => {
		if (l.fimbriate === undefined) {
			return;
		}
		const sized = s.kind === "lozenge" && region !== null ? { ...s, fly: s.fly ?? toNumber(region.w), hoist: s.hoist ?? toNumber(region.h) } : s;
		const edge = chargeEdge(sized, s.kind === "polygon" ? vec(base) : copy);
		fimbriation(m, name, l.fimbriate, edge.at, edge.out);
	};
	if (s.rotate !== 0 && s.kind !== "polygon") {
		m.turned.add(`The ${name} is turned ${s.rotate}°.`);
	}
	const at = (p: Point | null | undefined): { x: Fraction; y: Fraction } => (p === null || p === undefined ? center : { x: plus(base.x, exactOf(p.fly)), y: plus(base.y, exactOf(p.hoist)) });
	if (s.kind === "polygon") {
		const xs = s.vertices.map((v) => plus(base.x, exactOf(v.fly)));
		const ys = s.vertices.map((v) => plus(base.y, exactOf(v.hoist)));
		const lo = (list: Fraction[]): Fraction => list.reduce((a, b) => (compare(a, b) <= 0 ? a : b));
		const hi = (list: Fraction[]): Fraction => list.reduce((a, b) => (compare(a, b) >= 0 ? a : b));
		const w = minus(hi(xs), lo(xs));
		const h = minus(hi(ys), lo(ys));
		const x = plus(lo(xs), half(w));
		const y = plus(lo(ys), half(h));
		m.charges.push({ x, y, at: { x: toNumber(x), y: toNumber(y) }, reach: { x: toNumber(w) / 2, y: toNumber(h) / 2 }, size: (t) => `box ${t(w)} × ${t(h)}`, name });
		fimbriated({ x: 0, y: 0 });
		return;
	}
	const { size, reach, circle } = sizeOf(s, region);
	let mark = at(s.ats !== undefined ? s.ats[0] : s.at);
	let copy = { x: toNumber(mark.x), y: toNumber(mark.y) };
	const kind = kindWords[s.kind] ?? s.kind;
	const many = (count: number): string => `${count} ${plural(count, named(l.color, kind))}`;
	const rep = l.repeat;
	if (s.ats !== undefined && s.ats.length > 1) {
		const count = s.ats.length;
		m.notes.push(() => `${many(count)} at the places the file lists, of which the first is measured.`);
	}
	if (rep !== undefined) {
		switch (rep.kind) {
			case "ring":
			case "arc": {
				const radius = exactOf(rep.radius);
				const from = rep.kind === "arc" ? rep.from : 0;
				copy = { x: copy.x + rep.radius * Math.sin((from * Math.PI) / 180), y: copy.y - rep.radius * Math.cos((from * Math.PI) / 180) };
				const turn = rep.turn ? ", turned with it" : "";
				if (rep.kind === "ring") {
					m.notes.push((t) => `${many(rep.count)} in a ring of radius ${t(radius)} around the center marked +, starting at the top${turn}.`);
				} else {
					m.notes.push((t) => `${many(rep.count)} on an arc of radius ${t(radius)} around the center marked +, from ${rep.from}° to ${rep.to}° clockwise from the top${turn}.`);
				}
				break;
			}
			case "grid": {
				const f = region!;
				const dx = over(f.w, fraction(BigInt(rep.columns + 1)));
				const dy = over(f.h, fraction(BigInt(rep.rows + 1)));
				mark = { x: plus(f.x, dx), y: plus(f.y, dy) };
				copy = { x: toNumber(mark.x), y: toNumber(mark.y) };
				let count = 0;
				for (let r = 1; r <= rep.rows; r++) {
					for (let c = 1; c <= rep.columns; c++) {
						count += rep.stagger && (r + c) % 2 === 1 ? 0 : 1;
					}
				}
				const cells = rep.stagger ? ", in alternate cells from the top left" : "";
				m.notes.push((t) => `${many(count)} on a grid of ${rep.rows} rows by ${rep.columns} columns${cells}, ${t(dx)} apart along the fly and ${t(dy)} down. The first is measured.`);
				break;
			}
			case "line": {
				const fly = exactOf(rep.fly);
				const hoist = exactOf(rep.hoist);
				m.notes.push((t) => {
					const steps = [fly.n !== 0n ? `${t(fly)} along the fly` : "", hoist.n !== 0n ? `${t(hoist)} down` : ""].filter((x) => x !== "").join(" and ");
					return `${many(rep.count)} in a line, each ${steps} from the one before. The first is measured.`;
				});
				break;
			}
		}
	}
	if (circle !== undefined) {
		m.circles = true;
	}
	const ats = s.ats !== undefined && s.ats.length > 1 ? s.ats.slice(0, 3).map(at) : null;
	const detail = repeatDetail(plural(2, named(l.color, kind)), rep, ats, mark, region, reach, circle, size);
	if (detail !== null) {
		m.details.push(detail);
	}
	m.charges.push({ x: mark.x, y: mark.y, at: copy, reach, ...(circle !== undefined ? { circle } : {}), ...(size !== undefined ? { size } : {}), name });
	fimbriated(copy);
}

type XY = { x: Fraction; y: Fraction };

/** Chains of dimensions along the fly and down, through the places some copies are at, from `start` if it's given. */
function chainsThrough(points: readonly XY[], start: XY | null, label: (along: "fly" | "hoist", step: Fraction) => (t: Format) => string): DetailDim[] {
	const out: DetailDim[] = [];
	for (const along of ["fly", "hoist"] as const) {
		const stops = [...(start !== null ? [start] : []), ...points].map((p) => coord(p, along)).sort(compare).filter((v, i, all) => i === 0 || !same(v, all[i - 1]!));
		if (stops.length < 2) {
			continue;
		}
		// The other coordinate, where the chain is measured from: the least, which is nearest the top or the hoist.
		const level = points.map((p) => toNumber(coord(p, across(along)))).reduce((a, b) => Math.min(a, b));
		const from = start !== null ? toNumber(coord(start, across(along))) : level;
		for (let i = 0; i + 1 < stops.length; i++) {
			const [a, b] = [toNumber(stops[i]!), toNumber(stops[i + 1]!)];
			const text = label(along, minus(stops[i + 1]!, stops[i]!));
			out.push(along === "fly" ? { a: { x: a, y: from }, b: { x: b, y: from }, text } : { a: { x: from, y: a }, b: { x: from, y: b }, text });
		}
	}
	return out;
}

/**
 * The detail of a repeated charge, for the sidebar: its first copies, the steps between them, and,
 * for a ring or an arc, its radius and the angle between copies. A grid's steps are from the
 * region's corner, as its margins are a step too.
 */
function repeatDetail(name: string, rep: Repeat | undefined, ats: XY[] | null, first: XY, region: Frame | null, reach: { x: number; y: number }, circle: number | undefined, size: ((t: Format) => string) | undefined): Detail | null {
	if ((rep === undefined && ats === null) || (reach.x <= 0 && reach.y <= 0)) {
		return null;
	}
	const sizeText = (t: Format): string => (size !== undefined ? ` Each is ${size(t)}.` : "");
	const plain = (_: "fly" | "hoist", step: Fraction) => (t: Format): string => t(step);
	let copies: XY[];
	let dims: DetailDim[] = [];
	let corner: XY | null = null;
	let caption: (t: Format) => string;
	const detail: Partial<Detail> = {};
	if (rep === undefined) {
		copies = ats!;
		dims = chainsThrough(copies, null, plain);
		caption = (t) => `The first ${copies.length} of the ${name}, and the steps between them.${sizeText(t)}`;
	} else {
		switch (rep.kind) {
			case "grid": {
				const f = region!;
				const cols = Math.min(rep.columns, 2);
				const rows = Math.min(rep.rows, 2);
				const dx = over(f.w, fraction(BigInt(rep.columns + 1)));
				const dy = over(f.h, fraction(BigInt(rep.rows + 1)));
				copies = [];
				for (let r = 1; r <= rows; r++) {
					for (let c = 1; c <= cols; c++) {
						if (!(rep.stagger && (r + c) % 2 === 1)) {
							copies.push({ x: plus(f.x, times(dx, fraction(BigInt(c)))), y: plus(f.y, times(dy, fraction(BigInt(r)))) });
						}
					}
				}
				corner = { x: f.x, y: f.y };
				// A step a decimal can't say is said as the share of the region it is, as laws do.
				const exactly = (along: "fly" | "hoist", step: Fraction) => (t: Format): string => {
					const text = t(step);
					const whole = t(along === "fly" ? f.w : f.h);
					// In grid units only: a share of a part of the hoist is said as that part already.
					return text.startsWith("~") && /^\d+(\.\d+)?$/.test(whole) ? recordValue(`${whole}/${along === "fly" ? rep.columns + 1 : rep.rows + 1}`, step, "grid") : text;
				};
				const allAt = [...copies, ...(rows > 1 ? [{ x: plus(f.x, dx), y: plus(f.y, times(dy, fraction(2n))) }] : []), ...(cols > 1 ? [{ x: plus(f.x, times(dx, fraction(2n))), y: plus(f.y, dy) }] : [])];
				dims = chainsThrough(allAt, corner, exactly);
				caption = (t) => `The grid’s corner, enlarged: its rows are ${exactly("hoist", dy)(t)} apart and its columns ${exactly("fly", dx)(t)}, and so are its margins.${sizeText(t)}`;
				break;
			}
			case "line": {
				const step = { x: exactOf(rep.fly), y: exactOf(rep.hoist) };
				copies = Array.from({ length: Math.min(rep.count, 3) }, (_, i) => ({ x: plus(first.x, times(step.x, fraction(BigInt(i)))), y: plus(first.y, times(step.y, fraction(BigInt(i)))) }));
				dims = chainsThrough(copies, null, plain);
				caption = (t) => `The first ${copies.length} of ${rep.count} ${name} in a line, and the steps between them.${sizeText(t)}`;
				break;
			}
			case "ring":
			case "arc": {
				const from = rep.kind === "arc" ? exactOf(rep.from) : zero;
				const span = rep.kind === "arc" ? (() => {
					const d = minus(exactOf(rep.to), from);
					return compare(d, zero) > 0 ? d : plus(d, fraction(360n));
				})() : fraction(360n);
				const step = over(span, fraction(BigInt(rep.kind === "arc" ? rep.count - 1 : rep.count)));
				const r = rep.radius;
				const toward = (deg: number): Vec => ({ x: Math.sin((deg * Math.PI) / 180), y: -Math.cos((deg * Math.PI) / 180) });
				const c = vec(first);
				const a0 = toNumber(from);
				const a1 = a0 + toNumber(step);
				const p0 = { x: c.x + toward(a0).x * r, y: c.y + toward(a0).y * r };
				const p1 = { x: c.x + toward(a1).x * r, y: c.y + toward(a1).y * r };
				const radius = exactOf(rep.radius);
				const places = placesOf(step);
				const stepText = recordValue(places !== null && places <= 4 ? `${decimal(step, places)}°` : `${decimal(span, placesOf(span) ?? 4)}°/${rep.kind === "arc" ? rep.count - 1 : rep.count}`, step, "degrees");
				detail.radius = { centre: c, to: p0, text: (t) => `r ${t(radius)}` };
				detail.angle = { centre: c, from: toward(a0), to: toward(a1), text: stepText };
				const pts = [c, p0, p1];
				const pad = Math.max(reach.x, reach.y) * 1.3;
				detail.window = { x0: Math.min(...pts.map((p) => p.x)) - pad, y0: Math.min(...pts.map((p) => p.y)) - pad, x1: Math.max(...pts.map((p) => p.x)) + pad, y1: Math.max(...pts.map((p) => p.y)) + pad };
				copies = [];
				detail.copies = [p0, p1];
				caption = (t) => `The center and the first two of ${rep.count} ${name} ${rep.kind === "ring" ? "in a ring" : "on an arc"}, ${stepText} apart, ${t(radius)} from it.${sizeText(t)}`;
				break;
			}
		}
	}
	const shown = detail.copies ?? copies.map(vec);
	if (detail.window === undefined) {
		const pad = Math.max(reach.x, reach.y) * 1.3;
		const xs = [...shown.map((p) => p.x), ...(corner !== null ? [toNumber(corner.x) + pad] : [])];
		const ys = [...shown.map((p) => p.y), ...(corner !== null ? [toNumber(corner.y) + pad] : [])];
		detail.window = { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
		if (corner !== null) {
			detail.window.x0 = toNumber(corner.x);
			detail.window.y0 = toNumber(corner.y);
		}
	}
	return { ...detail, title: name, frame: identity, window: detail.window, copies: shown, dims, caption, ...(circle !== undefined ? { circle } : {}) } as Detail;
}

// --- Laying out -------------------------------------------------------------------------------

const pxPerMm = 96 / 25.4;
/** Landscape, in millimetres. */
const papers = { a4: [297, 210], letter: [279.4, 215.9] } as const;

const margin = { top: 36, side: 40, bottom: 28 };
/** From the flag's edge to the first dimension row, and from one row to the next. */
const rowGap = 26;
const pitch = 26;
const tick = 6;
const labelSize = 13;
const sidebarWidth = 250;

interface Seg {
	a: number;
	b: number;
	text: string;
	/** Positions, then parts, then the whole, from the flag outward. */
	cat: 0 | 1 | 2;
	/** The grid values of its ends, for extension lines. */
	ends: [number, number];
}

interface Placed extends Seg {
	row: number;
	lo: number;
	hi: number;
}

const openOverlap = (a0: number, a1: number, b0: number, b1: number): boolean => a0 < b1 - 0.01 && b0 < a1 - 0.01;

/**
 * Gives each dimension a row and a place for its label: between its ticks if it fits, and
 * otherwise just outside one of them. Rows go out from the flag, positions first and the whole
 * flag last, and no two dimensions in a row cross, nor do their labels.
 */
function placeRows(segs: readonly Seg[], lo: number, hi: number): { placed: Placed[]; rows: number } {
	const placed: Placed[] = [];
	let base = 0;
	for (const cat of [0, 1, 2] as const) {
		const rows: Placed[][] = [];
		for (const seg of segs.filter((s) => s.cat === cat).sort((x, y) => x.a - y.a || x.b - y.b)) {
			const w = monoWidth(seg.text, labelSize);
			const mid = (seg.a + seg.b) / 2;
			const cands: [number, number][] = [];
			if (seg.b - seg.a >= w + 6) {
				cands.push([mid - w / 2, mid + w / 2]);
			}
			cands.push([seg.b + 4, seg.b + 4 + w], [seg.a - 4 - w, seg.a - 4], [mid - w / 2, mid + w / 2]);
			const inside = cands.filter(([a, b]) => a >= lo && b <= hi);
			const fits = (row: Placed[], c: [number, number]): boolean => {
				const outside = c[0] < seg.a - 0.01 || c[1] > seg.b + 0.01;
				for (const p of row) {
					if (openOverlap(seg.a, seg.b, p.a, p.b) || openOverlap(c[0] - 6, c[1] + 6, p.lo, p.hi)) {
						return false;
					}
					if (outside && openOverlap(c[0] - 3, c[1] + 3, p.a, p.b)) {
						return false;
					}
					const theirs = p.lo < p.a - 0.01 || p.hi > p.b + 0.01;
					if (theirs && openOverlap(p.lo - 3, p.hi + 3, seg.a, seg.b)) {
						return false;
					}
				}
				return true;
			};
			let done = false;
			for (let r = 0; r <= rows.length && !done; r++) {
				const row = rows[r] ?? [];
				for (const c of inside) {
					if (fits(row, c)) {
						if (r === rows.length) {
							rows.push(row);
						}
						const p = { ...seg, row: base + r, lo: c[0], hi: c[1] };
						row.push(p);
						placed.push(p);
						done = true;
						break;
					}
				}
			}
			if (!done) {
				// Wider than the room there is, so it's centered as near as it can be, on a row of its own.
				const c0 = Math.min(Math.max(mid - w / 2, lo), hi - w);
				const p = { ...seg, row: base + rows.length, lo: c0, hi: c0 + w };
				rows.push([p]);
				placed.push(p);
			}
		}
		base += rows.length;
	}
	return { placed, rows: base };
}

/** A row of dimensions: a chain of them, or ordinates, each measured from the flag's edge. */
interface Row {
	kind: "chain" | "ordinate";
	/** How far its line is from the flag's edge. */
	at: number;
}

/** An ordinate: a place along a row, with its distance from the edge as a label turned across the row. */
interface Ordinate {
	row: number;
	/** Where it is, and where its label is, along the row. */
	p: number;
	c: number;
	text: string;
	end: number;
}

interface SideLayout {
	rows: Row[];
	chains: Placed[];
	ords: Ordinate[];
	/** How far from the flag's edge its labels reach. */
	extent: number;
	/** Ordinates with no room for a label. */
	dropped: number;
}

interface OrdinatePoint {
	p: number;
	text: string;
	end: number;
}

/** The most rows of chained positions or parts, past which they're given as ordinates. */
const mostChainRows = 2;
const ordinateGap = 15;

/**
 * Spreads ordinates' labels along a row so that none overlap, moving each as little as it can. If
 * there are more than the row can hold, only some are labelled.
 */
function spread(points: readonly OrdinatePoint[], lo: number, hi: number): { kept: (OrdinatePoint & { c: number })[]; dropped: number } {
	const sorted = [...points].sort((a, b) => a.p - b.p);
	const room = Math.max(1, Math.floor((hi - lo) / ordinateGap));
	let list = sorted;
	if (sorted.length > room) {
		const step = Math.ceil(sorted.length / room);
		list = sorted.filter((_, i) => i % step === 0);
	}
	const c = list.map((x) => x.p);
	for (let i = 0; i < c.length; i++) {
		c[i] = Math.max(c[i]!, i === 0 ? lo + ordinateGap / 2 : c[i - 1]! + ordinateGap);
	}
	for (let i = c.length - 1; i >= 0; i--) {
		c[i] = Math.min(c[i]!, i === c.length - 1 ? hi - ordinateGap / 2 : c[i + 1]! - ordinateGap);
	}
	return { kept: list.map((x, i) => ({ ...x, c: c[i]! })), dropped: sorted.length - list.length };
}

/**
 * Lays out one side's rows, from the flag outward: positions, parts, then the whole. A chain that
 * would need more than a couple of rows is given as ordinates instead, in one row.
 */
function laySide(segs: readonly Seg[], ordinates: Record<0 | 1, OrdinatePoint[]>, lo: number, hi: number): SideLayout {
	const out: SideLayout = { rows: [], chains: [], ords: [], extent: 10, dropped: 0 };
	let at = rowGap;
	for (const cat of [0, 1, 2] as const) {
		const list = segs.filter((x) => x.cat === cat);
		if (list.length === 0) {
			continue;
		}
		const chain = placeRows(list, lo, hi);
		if (cat !== 2 && chain.rows > mostChainRows) {
			const { kept, dropped } = spread(ordinates[cat], lo, hi);
			const row = out.rows.length;
			out.rows.push({ kind: "ordinate", at });
			const longest = Math.max(...kept.map((k) => monoWidth(k.text, labelSize)));
			out.ords.push(...kept.map((k) => ({ row, p: k.p, c: k.c, text: k.text, end: k.end })));
			out.dropped += dropped;
			out.extent = at + 14 + longest + 4;
			at = out.extent + 14;
		} else {
			const base = out.rows.length;
			for (let r = 0; r < chain.rows; r++) {
				out.rows.push({ kind: "chain", at });
				out.extent = at + 20;
				at += pitch;
			}
			out.chains.push(...chain.placed.map((x) => ({ ...x, row: x.row + base })));
		}
	}
	return out;
}

/** A row's label, wherever it is: `top` for the rows above the flag, and otherwise those beside it. */
interface RowText {
	text: string;
	x: number;
	y: number;
	attrs: string;
	box: Box;
}

/** A side of the flag on the sheet, which a row of dimensions runs along. */
type Side = "top" | "bottom" | "left" | "right";

const across90 = (side: Side): boolean => side === "left" || side === "right";

/** Where a row's line is, `at` out from a side of the flag. */
function rowLine(side: Side, at: number, flag: Box): number {
	switch (side) {
		case "top":
			return flag.y0 - at;
		case "bottom":
			return flag.y1 + at;
		case "left":
			return flag.x0 - at;
		case "right":
			return flag.x1 + at;
	}
}

/** A row's labels, on the far side of its line from the flag, and turned to read along a side row. */
function rowTexts(l: SideLayout, side: Side, flag: Box): RowText[] {
	const out: RowText[] = [];
	for (const p of l.chains) {
		const at = rowLine(side, l.rows[p.row]!.at, flag);
		const mid = (p.lo + p.hi) / 2;
		switch (side) {
			case "top":
				out.push({ text: p.text, x: mid, y: at - 8, attrs: 'text-anchor="middle"', box: { x0: p.lo, y0: at - 18, x1: p.hi, y1: at - 5 } });
				break;
			case "bottom":
				out.push({ text: p.text, x: mid, y: at + 15, attrs: 'text-anchor="middle"', box: { x0: p.lo, y0: at + 5, x1: p.hi, y1: at + 18 } });
				break;
			case "left":
				out.push({ text: p.text, x: at - 8, y: mid, attrs: `text-anchor="middle" transform="rotate(-90 ${num(at - 8)} ${num(mid)})"`, box: { x0: at - 18, y0: p.lo, x1: at - 5, y1: p.hi } });
				break;
			case "right":
				out.push({ text: p.text, x: at + 15, y: mid, attrs: `text-anchor="middle" transform="rotate(-90 ${num(at + 15)} ${num(mid)})"`, box: { x0: at + 5, y0: p.lo, x1: at + 18, y1: p.hi } });
				break;
		}
	}
	for (const o of l.ords) {
		const at = rowLine(side, l.rows[o.row]!.at, flag);
		const len = monoWidth(o.text, labelSize);
		const bx = o.c + 4.5;
		switch (side) {
			case "top":
				out.push({ text: o.text, x: bx, y: at - 14, attrs: `transform="rotate(-90 ${num(bx)} ${num(at - 14)})"`, box: { x0: o.c - 5.5, y0: at - 14 - len, x1: o.c + 7.5, y1: at - 14 } });
				break;
			case "bottom":
				out.push({ text: o.text, x: bx, y: at + 14, attrs: `text-anchor="end" transform="rotate(-90 ${num(bx)} ${num(at + 14)})"`, box: { x0: o.c - 5.5, y0: at + 14, x1: o.c + 7.5, y1: at + 14 + len } });
				break;
			case "left":
				out.push({ text: o.text, x: at - 14, y: bx, attrs: 'text-anchor="end"', box: { x0: at - 14 - len, y0: o.c - 5.5, x1: at - 14, y1: o.c + 7.5 } });
				break;
			case "right":
				out.push({ text: o.text, x: at + 14, y: bx, attrs: "", box: { x0: at + 14, y0: o.c - 5.5, x1: at + 14 + len, y1: o.c + 7.5 } });
				break;
		}
	}
	return out;
}

class Out {
	readonly lines: string[] = [];
	readonly labels: LabelBox[] = [];
	/** The faces text is set in, as family and weight, such as "Geist Mono 500". */
	readonly faces = new Set<string>();
	add(line: string): void {
		this.lines.push(line);
	}
	/** Text, recorded as a box, which `y` is the baseline of. */
	text(x: number, y: number, text: string, attrs: string, box: Box, onFlag = false): void {
		this.lines.push(`<text x="${num(x)}" y="${num(y)}" ${attrs}>${esc(text)}</text>`);
		this.labels.push({ ...box, text, onFlag });
		this.faces.add(`${/font-family="([^",]*)/.exec(attrs)?.[1] ?? ""} ${/font-weight="([0-9]+)"/.exec(attrs)?.[1] ?? "400"}`);
	}
}

const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const n = bytes.length - i;
		const v = (bytes[i]! << 16) | ((n > 1 ? bytes[i + 1]! : 0) << 8) | (n > 2 ? bytes[i + 2]! : 0);
		out += base64Chars[v >> 18]! + base64Chars[(v >> 12) & 63]! + (n > 1 ? base64Chars[(v >> 6) & 63]! : "=") + (n > 2 ? base64Chars[v & 63]! : "=");
	}
	return out;
}

/**
 * The style that carries a sheet's fonts, with only the faces it uses. It's built here, from the
 * fonts' bytes, so that nothing a caller passes can become CSS that runs or fetches anything.
 */
function fontStyle(fonts: readonly SheetFont[], used: ReadonlySet<string>): string {
	const rules: string[] = [];
	const seen = new Set<string>();
	for (const f of fonts) {
		const b = f.woff2;
		if (!(b instanceof Uint8Array) || b.length < 4 || b[0] !== 0x77 || b[1] !== 0x4f || b[2] !== 0x46 || b[3] !== 0x32) {
			throw new RangeError("a sheet's font must be a WOFF2 file");
		}
		const key = `${f.family} ${f.weight}`;
		if (!used.has(key) || seen.has(key)) {
			continue;
		}
		seen.add(key);
		rules.push(`@font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.weight};src:url(data:font/woff2;base64,${base64(b)}) format("woff2")}`);
	}
	return rules.length === 0 ? "" : `<defs><style>${rules.join("")}</style></defs>`;
}

interface SidebarItem {
	height: number;
	draw: (o: Out, x: number, y: number) => void;
	/** Says it stands for what the sidebar had no room to list. */
	condensed?: boolean;
}

function luminance(hex: string): number {
	const c = [1, 3, 5].map((i) => {
		const v = parseInt(hex.slice(i, i + 2), 16) / 255;
		return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

const systemNames: Record<string, string> = { pantone: "Pantone", cmyk: "CMYK", ncs: "NCS", ral: "RAL", munsell: "Munsell", dye: "Dye", thread: "Thread" };

/** A color's other values, one to a line, each as pieces that wrap only between them. */
function refLines(flag: Flag, name: string): string[][] {
	return (flag.colorRefs[name] ?? []).map((r) => {
		if (r.other !== true) {
			return [...words(systemNames[r.system] ?? r.system), r.value];
		}
		// A value in words is what a document calls the color, and a value in figures is a measurement.
		return /\d|^#/.test(r.value) ? [...words(r.system), r.value] : [`“${r.value}”`, "in", ...words(r.system)];
	});
}

interface SidebarLook {
	size: number;
	line: number;
	swatch: number;
	gap: number;
	/** How many of a color's other values are listed, or all of them. */
	refs: number;
	laws: boolean;
}

const looks: SidebarLook[] = [
	{ size: 13, line: 19, swatch: 26, gap: 12, refs: Infinity, laws: true },
	{ size: 12, line: 17, swatch: 22, gap: 10, refs: Infinity, laws: true },
	{ size: 12, line: 16, swatch: 20, gap: 8, refs: Infinity, laws: true },
	{ size: 11, line: 15, swatch: 18, gap: 6, refs: Infinity, laws: true },
	{ size: 11, line: 14, swatch: 16, gap: 4, refs: Infinity, laws: true },
	{ size: 12, line: 16, swatch: 20, gap: 8, refs: 3, laws: true },
	{ size: 11, line: 15, swatch: 18, gap: 6, refs: 1, laws: true },
	{ size: 11, line: 14, swatch: 16, gap: 4, refs: 0, laws: false },
	{ size: 10, line: 13, swatch: 12, gap: 3, refs: 0, laws: false },
];

function sidebarHeading(text: string, theme: Theme, gap: number): SidebarItem {
	return {
		height: 16 + gap,
		draw: (o, x, y) => {
			o.text(x, y + 11, text.toUpperCase(), `font-family="${monoFamily}" font-size="11" font-weight="500" letter-spacing="0.88" fill="${theme.muted}"`, { x0: x, y0: y, x1: x + monoWidth(text, 11) + 0.88 * text.length, y1: y + 14 });
		},
	};
}

/** Gives dimensions rows, nearest the picture first, so that a row is a chain whose dimensions only meet at their ends. */
function detailRows(spans: readonly { lo: number; hi: number }[]): number[] {
	const rows: { lo: number; hi: number }[][] = [];
	return spans.map((s) => {
		let r = rows.findIndex((row) => row.every((x) => s.hi <= x.lo + 0.01 || x.hi <= s.lo + 0.01));
		if (r < 0) {
			r = rows.length;
			rows.push([]);
		}
		rows[r]!.push(s);
		return r;
	});
}

/**
 * A detail as items of the sidebar: its heading, then the picture, enlarged as far as it fits,
 * with its dimensions above and beside it, and its caption. It's null if a label can't be read at
 * any size that fits, and the notes then say what it would have.
 */
function detailItems(d: Detail, map: Affine, picture: (idPrefix: string) => string, idPrefix: string, theme: Theme, t: Format, width: number, maxHeight = Infinity): SidebarItem[] | null {
	let level: Affine = identity;
	let p = compose(map, d.frame);
	if (d.level === true) {
		const v = turnVec(p, { x: 1, y: 0 });
		const a = -Math.atan2(v.y, v.x);
		level = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
		p = compose(level, p);
	}
	const w = d.window;
	const corners = [{ x: w.x0, y: w.y0 }, { x: w.x1, y: w.y0 }, { x: w.x0, y: w.y1 }, { x: w.x1, y: w.y1 }].map((q) => apply(p, q));
	const vx = Math.min(...corners.map((q) => q.x));
	const vy = Math.min(...corners.map((q) => q.y));
	const vw = Math.max(...corners.map((q) => q.x)) - vx;
	const vh = Math.max(...corners.map((q) => q.y)) - vy;
	if (!(vw > 0 && vh > 0)) {
		return null;
	}
	const size = 11;
	const caption = wrap(words(d.caption(t)), 12, width);
	const dims = d.dims.map((dm) => {
		const a = apply(p, dm.a);
		const b = apply(p, dm.b);
		const flat = Math.abs(a.y - b.y) <= Math.abs(a.x - b.x);
		return { a, b, level: flat, optional: dm.optional === true, text: dm.text(t), lo: flat ? Math.min(a.x, b.x) : Math.min(a.y, b.y), hi: flat ? Math.max(a.x, b.x) : Math.max(a.y, b.y) };
	});
	// Rows are worked out at the scale of the grid, and then the picture is as large as their room allows.
	const pitchIn = 20;
	let kept = dims;
	let across = kept;
	let down = kept;
	let tops: number[] = [];
	let lefts: number[] = [];
	let top = 30;
	let left = 34;
	let k = 1;
	for (;;) {
		across = kept.filter((x) => x.level);
		down = kept.filter((x) => !x.level);
		tops = detailRows(across);
		lefts = detailRows(down);
		top = 30 + pitchIn * Math.max(0, ...tops);
		left = 34 + pitchIn * Math.max(0, ...lefts);
		// As large as its room allows, under its heading, rows and caption.
		k = Math.min((width - left - 6) / vw, 200 / vh, (maxHeight - 24 - top - 24 - caption.length * 16) / vh);
		const small = kept.filter((x) => (x.hi - x.lo) * k < monoWidth(x.text, size) + 6);
		if (small.length === 0) {
			break;
		}
		// What the caption says too can be left out, and anything else that can't be read means no detail.
		if (small.some((x) => !x.optional)) {
			return null;
		}
		kept = kept.filter((x) => !small.includes(x));
	}
	// Too small to be worth enlarging.
	if (k * Math.max(vw, vh) < 80) {
		return null;
	}
	const picW = vw * k;
	const picH = vh * k;
	const drawn = picture(idPrefix);
	const vb = `${num(vx)} ${num(vy)} ${num(vw)} ${num(vh)}`;
	const body = drawn.replace(/^<svg [^>]*>\n?/, "").replace(/<\/svg>\n?$/, "").replace(/\n$/, "");
	const item: SidebarItem = {
		height: top + picH + 10 + caption.length * 16 + 14,
		draw: (o, x, y) => {
			const px0 = x + left;
			const py0 = y + top;
			const at = (q: Vec): Vec => ({ x: px0 + (q.x - vx) * k, y: py0 + (q.y - vy) * k });
			const atLocal = (q: Vec): Vec => at(apply(p, q));
			o.add(`<svg x="${num(px0)}" y="${num(py0)}" width="${num(picW)}" height="${num(picH)}" viewBox="${vb}" overflow="hidden">`);
			o.add(level === identity ? body : `<g transform="matrix(${level.map(num).join(" ")})">\n${body}\n</g>`);
			o.add("</svg>");
			o.add(`<rect x="${num(px0)}" y="${num(py0)}" width="${num(picW)}" height="${num(picH)}" fill="none" ${stroke(theme.outline)} stroke-width="1"/>`);
			const ext: string[] = [];
			const lines: string[] = [];
			const onPicture: string[] = [];
			const label = `font-family="${monoFamily}" font-size="${size}" fill="${theme.label}" stroke="${theme.paper}" stroke-width="3" stroke-linejoin="round" paint-order="stroke"`;
			across.forEach((dm, i) => {
				const ry = py0 - 12 - pitchIn * tops[i]!;
				const [a, b] = [at(dm.a), at(dm.b)];
				lines.push(`M${num(a.x)} ${num(ry)}H${num(b.x)}M${num(a.x)} ${num(ry - 5)}V${num(ry + 5)}M${num(b.x)} ${num(ry - 5)}V${num(ry + 5)}`);
				for (const q of [a, b]) {
					if (q.y > ry + 7) {
						ext.push(`M${num(q.x)} ${num(q.y - 2)}V${num(ry + 3)}`);
					}
				}
				const mid = (a.x + b.x) / 2;
				const tw = monoWidth(dm.text, size);
				o.text(mid, ry - 4, dm.text, `${label} text-anchor="middle"`, { x0: mid - tw / 2, y0: ry - 14, x1: mid + tw / 2, y1: ry - 3 });
			});
			down.forEach((dm, i) => {
				const rx = px0 - 12 - pitchIn * lefts[i]!;
				const [a, b] = [at(dm.a), at(dm.b)];
				lines.push(`M${num(rx)} ${num(a.y)}V${num(b.y)}M${num(rx - 5)} ${num(a.y)}H${num(rx + 5)}M${num(rx - 5)} ${num(b.y)}H${num(rx + 5)}`);
				for (const q of [a, b]) {
					if (q.x > rx + 7) {
						ext.push(`M${num(q.x - 2)} ${num(q.y)}H${num(rx + 3)}`);
					}
				}
				const mid = (a.y + b.y) / 2;
				const tw = monoWidth(dm.text, size);
				o.text(rx - 4, mid, dm.text, `${label} text-anchor="middle" transform="rotate(-90 ${num(rx - 4)} ${num(mid)})"`, { x0: rx - 14, y0: mid - tw / 2, x1: rx - 3, y1: mid + tw / 2 });
			});
			if (d.circle !== undefined) {
				for (const c of d.copies) {
					const q = atLocal(c);
					onPicture.push(`<circle cx="${num(q.x)}" cy="${num(q.y)}" r="${num(d.circle * k)}" fill="none" stroke="${theme.halo}" stroke-width="2.5" stroke-opacity="0.6"/>`, `<circle cx="${num(q.x)}" cy="${num(q.y)}" r="${num(d.circle * k)}" fill="none" stroke="${theme.onFlag}" stroke-width="1" stroke-dasharray="4 3"/>`);
				}
			}
			const chips: { text: string; box: Box }[] = [];
			const halo: string[] = [];
			if (d.radius !== undefined && d.angle !== undefined) {
				const c = atLocal(d.radius.centre);
				const e = atLocal(d.radius.to);
				const len = Math.hypot(e.x - c.x, e.y - c.y);
				const u = { x: (e.x - c.x) / len, y: (e.y - c.y) / len };
				const n = { x: -u.y, y: u.x };
				// The angle's arc, from the first copy's direction to the next one's, clockwise on the flag.
				const from = Math.atan2(d.angle.from.y, d.angle.from.x);
				let to = Math.atan2(d.angle.to.y, d.angle.to.x);
				while (to <= from) {
					to += 2 * Math.PI;
				}
				const ra = Math.min(len * 0.45, 40) / k;
				const arc = Array.from({ length: 17 }, (_, i) => {
					const a = from + ((to - from) * i) / 16;
					return atLocal({ x: d.radius!.centre.x + Math.cos(a) * ra, y: d.radius!.centre.y + Math.sin(a) * ra });
				});
				const ticks = (q: Vec): string => `M${num(q.x - n.x * 4)} ${num(q.y - n.y * 4)}L${num(q.x + n.x * 4)} ${num(q.y + n.y * 4)}`;
				halo.push(`M${num(c.x)} ${num(c.y)}L${num(e.x)} ${num(e.y)}${ticks(c)}${ticks(e)}`, pathOf(arc));
				// The radius's label on the side away from the angle, and the angle's beyond its arc.
				const mid = arc[8]!;
				const out = { x: mid.x - c.x, y: mid.y - c.y };
				const ol = Math.hypot(out.x, out.y);
				const side = n.x * out.x + n.y * out.y > 0 ? -1 : 1;
				const rText = d.radius.text(t);
				const aText = d.angle.text;
				// The angle's label first, and then the radius's wherever it's clear of it. Either is in the
				// caption as well, so one with no room is left to it.
				const picture = { x0: px0, y0: py0, x1: px0 + picW, y1: py0 + picH };
				const inside = (b: Box): boolean => b.x0 >= picture.x0 && b.x1 <= picture.x1 && b.y0 >= picture.y0 && b.y1 <= picture.y1;
				const angleSpot = [4, 16, 30].map((g) => spotAt(mid, { x: out.x / ol, y: out.y / ol }, monoWidth(aText, size), 13, g)).find(inside);
				if (angleSpot !== undefined) {
					chips.push({ text: aText, box: angleSpot });
				}
				const radiusSpot = [0.5, 0.3, 0.7, 0.15, 0.85].flatMap((f) => [4, 14].flatMap((g) => [side, -side].map((sd) => spotAt({ x: c.x + (e.x - c.x) * f, y: c.y + (e.y - c.y) * f }, { x: n.x * sd, y: n.y * sd }, monoWidth(rText, size), 13, g))))
					.find((b) => inside(b) && (angleSpot === undefined || !hits(b, angleSpot, 3)));
				if (radiusSpot !== undefined) {
					chips.push({ text: rText, box: radiusSpot });
				}
			}
			if (ext.length > 0) {
				o.add(`<path d="${ext.join("")}" fill="none" ${stroke(theme.ext)} stroke-width="0.8" stroke-dasharray="3 3"/>`);
			}
			o.add(`<path d="${lines.join("")}" fill="none" stroke="${theme.dim}" stroke-width="1"/>`);
			o.lines.push(...onPicture);
			if (halo.length > 0) {
				o.add(`<path d="${halo.join("")}" fill="none" stroke="${theme.halo}" stroke-width="2.6" stroke-opacity="0.7" stroke-linecap="round"/>`);
				o.add(`<path d="${halo.join("")}" fill="none" stroke="${theme.onFlag}" stroke-width="1"/>`);
			}
			for (const chip of chips) {
				const b = chip.box;
				o.add(`<rect x="${num(b.x0 - 2)}" y="${num(b.y0)}" width="${num(b.x1 - b.x0 + 4)}" height="${num(b.y1 - b.y0)}" rx="3" fill="${theme.paper}" fill-opacity="0.88"/>`);
				o.text((b.x0 + b.x1) / 2, b.y1 - 3, chip.text, `font-family="${monoFamily}" font-size="${size}" fill="${theme.label}" text-anchor="middle"`, b);
			}
			let cy = py0 + picH + 10 + 12;
			for (const line of caption) {
				o.text(x, cy, line, `font-family="${sansFamily}" font-size="12" fill="${theme.ink2}"`, { x0: x, y0: cy - 10, x1: x + sansWidth(line, 12), y1: cy + 3 });
				cy += 16;
			}
		},
	};
	return [sidebarHeading(`Detail: ${d.title}`, theme, 8), item];
}

function sidebarItems(flag: Flag, theme: Theme, opts: { colors: boolean }, look: SidebarLook, width: number, prefix: string, room: number): SidebarItem[] {
	const items: SidebarItem[] = [];
	const heading = (text: string): SidebarItem => sidebarHeading(text, theme, look.gap);
	const names = [...Object.keys(flag.palette), ...Object.keys(flag.gradients)];
	if (opts.colors && names.length > 0) {
		const colorItems: SidebarItem[] = [];
		names.forEach((key, index) => {
			const hex = flag.palette[key];
			const gradient = flag.gradients[key];
			const textX = look.swatch + 10;
			const avail = width - textX;
			const title = key.replaceAll("-", " ");
			const display = title.charAt(0).toUpperCase() + title.slice(1);
			const first: string[] = [];
			const nameWidth = sansWidth(display, look.size, 500);
			const hexText = hex ?? "";
			// The name and its hex share a line if they fit, and the hex is never split.
			const together = hex !== undefined && nameWidth + 6 + monoWidth(hexText, look.size) <= avail;
			let lines: { text: string; mono?: boolean; indent?: boolean }[] = [];
			const nameLines = wrap(words(display), look.size, avail, 500);
			first.push(...nameLines);
			if (hex !== undefined && !together) {
				lines.push({ text: hexText, mono: true });
			}
			const refs = hex !== undefined ? refLines(flag, key) : [];
			const shown = refs.slice(0, look.refs);
			for (const pieces of shown) {
				wrap(pieces, look.size, avail - 10).forEach((t, i) => lines.push(i === 0 ? { text: t } : { text: t, indent: true }));
			}
			if (refs.length > shown.length) {
				const more = refs.length - shown.length;
				lines.push({ text: `and ${more} more ${more === 1 ? "value" : "values"} in the file` });
			}
			if (gradient !== undefined) {
				for (const t of wrap(words(`A gradient of ${gradient.colors.map(colorWord).join(", ")}, along the ${gradient.along}.`), look.size, avail)) {
					lines.push({ text: t });
				}
			}
			lines = lines.slice(0, 40);
			const height = Math.max(look.swatch, (first.length + lines.length) * look.line) + look.gap;
			colorItems.push({
				height,
				draw: (o, x, y) => {
					const r = look.swatch / 2;
					const ring = hex !== undefined && Math.abs(luminance(hex) - luminance(theme.paper)) < 0.12;
					if (gradient !== undefined) {
						const id = `${prefix}swatch${index}`;
						const stops = gradient.colors.map((c, i) => `<stop offset="${num(gradient.stops[i] ?? i / Math.max(1, gradient.colors.length - 1))}" stop-color="${flag.palette[c] ?? "#000000"}"/>`).join("");
						o.add(`<linearGradient id="${id}">${stops}</linearGradient>`);
						o.add(`<circle cx="${num(x + r)}" cy="${num(y + r)}" r="${num(r)}" fill="url(#${id})"/>`);
					} else {
						o.add(`<circle cx="${num(x + r)}" cy="${num(y + r)}" r="${num(r - (ring ? 0.5 : 0))}" fill="${hex}"${ring ? ` ${stroke(theme.outline)} stroke-width="1"` : ""}/>`);
					}
					let ly = y + look.size + 1;
					const tx = x + textX;
					first.forEach((t, i) => {
						const w = sansWidth(t, look.size, 500);
						o.text(tx, ly, t, `font-family="${sansFamily}" font-size="${look.size}" font-weight="500" fill="${theme.ink}"`, { x0: tx, y0: ly - look.size * 0.8, x1: tx + w, y1: ly + look.size * 0.25 });
						if (together && i === first.length - 1) {
							const hx = tx + w + 6;
							o.text(hx, ly, hexText, `font-family="${monoFamily}" font-size="${look.size}" fill="${theme.ink2}"`, { x0: hx, y0: ly - look.size * 0.8, x1: hx + monoWidth(hexText, look.size), y1: ly + look.size * 0.25 });
						}
						ly += look.line;
					});
					for (const line of lines) {
						const lx = tx + (line.indent === true ? 10 : 0);
						const w = line.mono === true ? monoWidth(line.text, look.size) : sansWidth(line.text, look.size);
						o.text(lx, ly, line.text, `font-family="${line.mono === true ? monoFamily : sansFamily}" font-size="${look.size}" fill="${theme.ink2}"`, { x0: lx, y0: ly - look.size * 0.8, x1: lx + w, y1: ly + look.size * 0.25 });
						ly += look.line;
					}
				},
			});
		});
		// However small it gets, a long palette can still be too long, and then it says how many are left.
		let used = 16 + look.gap;
		let kept = 0;
		for (const item of colorItems) {
			if (used + item.height > room - (flag.meta.laws.length > 0 ? 40 : 0) - look.line && kept < colorItems.length) {
				break;
			}
			used += item.height;
			kept++;
		}
		items.push(heading("Colours"), ...colorItems.slice(0, kept));
		if (kept < colorItems.length) {
			const more = colorItems.length - kept;
			const text = `and ${more} more ${more === 1 ? "color" : "colors"} in the file`;
			items.push({
				height: look.line + look.gap,
				condensed: true,
				draw: (o, x, y) => {
					o.text(x, y + look.size, text, `font-family="${sansFamily}" font-size="${look.size}" fill="${theme.ink2}"`, { x0: x, y0: y, x1: x + sansWidth(text, look.size), y1: y + look.line });
				},
			});
		}
		items.push({ height: 22 - look.gap, draw: () => undefined });
	}
	const laws = flag.meta.laws;
	if (laws.length > 0) {
		const lawLines = look.laws ? laws.map((l) => wrap(words(l.text), look.size, width)) : [[`${laws.length} ${laws.length === 1 ? "law" : "laws"}, named in the file`]];
		items.push(heading(laws.length === 1 ? "From the law" : "From the laws"));
		for (const lines of lawLines) {
			items.push({
				height: lines.length * look.line + 8,
				draw: (o, x, y) => {
					lines.forEach((t, i) => {
						const ly = y + look.size + i * look.line;
						o.text(x, ly, t, `font-family="${sansFamily}" font-size="${look.size}" fill="${theme.ink}"`, { x0: x, y0: ly - look.size * 0.8, x1: x + sansWidth(t, look.size), y1: ly + look.size * 0.25 });
					});
				},
			});
		}
	}
	return items;
}

const heightOf = (items: readonly SidebarItem[]): number => items.reduce((a, i) => a + i.height, 0);

/** An affine map, as SVG's matrix(a b c d e f) writes one. */
type Affine = [number, number, number, number, number, number];

const identity: Affine = [1, 0, 0, 1, 0, 0];

/** The map that applies `inner`, then `outer`. */
const compose = (outer: Affine, inner: Affine): Affine => {
	const [a, b, c, d, e, f] = outer;
	const [p, q, r, s, t, u] = inner;
	return [a * p + c * q, b * p + d * q, a * r + c * s, b * r + d * s, a * t + c * u + e, b * t + d * u + f];
};

const apply = (m: Affine, v: Vec): Vec => ({ x: m[0] * v.x + m[2] * v.y + m[4], y: m[1] * v.x + m[3] * v.y + m[5] });
const turnVec = (m: Affine, v: Vec): Vec => ({ x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y });

/** A form of the flag as the sheet draws it. */
interface FormView {
	/** The flag as the form has it, in its own frame, before any turn. */
	flag: Flag;
	/** The form as the library draws it. */
	drawn: string;
	/** From the flag's own frame to the drawing's, as the library turns it. */
	map: Affine;
	/** Whether the turn swaps the flag's width and height. */
	sideways: boolean;
	/** Whether charges are kept the right way up as it turns. */
	upright: boolean;
	/** What the header calls it, after the flag's name, if it isn't the flag itself. */
	label: string;
}

/**
 * Works out a form of the flag: what it has, and how the library turns it, which is read from the
 * drawing itself, so that every mark on the sheet turns just as the flag does.
 */
function formView(flag: Flag, form: SheetForm, idPrefix?: string): FormView {
	const opts = { ...form, ...(idPrefix !== undefined ? { idPrefix } : {}) };
	const resolved = resolve(flag, form);
	const drawn = svg(flag, opts);
	let map = identity;
	const turn = /\n {2}<g transform="((?:matrix\([^)]*\) ?)+)">\n/.exec(drawn);
	if (turn !== null) {
		for (const m of turn[1]!.matchAll(/matrix\(([^)]*)\)/g)) {
			map = compose(map, m[1]!.split(" ").map(Number) as Affine);
		}
	}
	const variant = form.variant !== undefined ? flag.variants[form.variant] : undefined;
	const label = [form.variant, form.side === "reverse" ? "reverse" : undefined].filter((x) => x !== undefined).join(" · ");
	let shown = resolved.flag;
	if (variant?.ratio !== undefined && variant.ratio > 0) {
		// The library adapted it with doubles, having checked that it can; the sheet adapts it again
		// exactly, from the form before adapting, by the same rules.
		const plain = { ...flag, variants: { ...flag.variants, [form.variant!]: { ...variant, ratio: undefined } } } as Flag;
		const before = resolve(plain, form).flag;
		const fromBehind = form.side === "reverse" && flag.reverse !== undefined && variant.layers.length === 0;
		shown = withRatioExactly(before, exactOf(variant.ratio), fromBehind);
	}
	return {
		flag: shown,
		drawn,
		map,
		sideways: Math.abs(map[0]) < 0.5,
		upright: resolved.upright,
		label,
	};
}
/** Lays out a sheet, and draws it. */
export function constructionSheet(flag: Flag, options: ConstructionOptions = {}): Sheet {
	const sheet = drawSheet(flag, options, false);
	// The footer says what ~ means if any size is rounded, which it can only know for certain once
	// every size is written, so a sheet that rounds one it didn't foresee is drawn again saying so.
	return sheet.values.some((v) => v.unit !== "mm" && v.text.startsWith("~")) && !sheet.labels.map((l) => l.text).join(" ").includes(roundingNote) ? drawSheet(flag, options, true) : sheet;
}

const roundingNote = "A ~ marks a size rounded to four places.";

function drawSheet(flag: Flag, options: ConstructionOptions, rounds: boolean): Sheet {
	const units = options.units ?? "grid";
	const theme = themes[options.theme ?? "paper"];
	const paper = options.paper ?? "a4";
	const showSizes = options.sizes !== false;
	const showPositions = options.positions !== false;
	const showColors = options.colors !== false;
	const showGrid = options.grid === true;
	if (options.hoistMm !== undefined && !(Number.isFinite(options.hoistMm) && options.hoistMm > 0)) {
		throw new RangeError("hoistMm must be a positive number");
	}
	const hoistMm = exactOf(options.hoistMm ?? 1000);
	const prefix = options.idPrefix ?? `${flag.idPrefix}cs-`;
	const form: SheetForm = {};
	if (options.form?.variant !== undefined) {
		form.variant = options.form.variant;
	}
	if (options.form?.side === "reverse") {
		form.side = "reverse";
	}
	const view = formView(flag, form, `${prefix}f-`);
	const H = exactOf(view.flag.hoist);
	const F = exactOf(view.flag.fly);
	const written = formatFor(units, H, hoistMm);
	// Millimetres are recorded as millimetres; grid units and parts of the hoist as grid units.
	const t: Format = (f) => recordValue(written(f), units === "mm" ? times(f, over(hoistMm, H)) : f, units);
	const values: SheetValue[] = [];
	// Each sheet starts its own record, so one that threw part way leaves nothing in the next.
	recording = values;
	const m = measure(flag, view.flag, form);

	// Whether any size has to be rounded, which the footer then says, worked out by writing them all.
	const rounded = ((): boolean => {
		const all: string[] = [];
		const f = (x: Fraction): string => {
			const text = t(x);
			all.push(text);
			return text;
		};
		const chain = (points: Fraction[], end: Fraction): void => {
			const sorted = [...points, zero, end].sort(compare);
			sorted.forEach((p, i) => {
				f(p);
				if (i > 0) {
					f(minus(p, sorted[i - 1]!));
				}
			});
		};
		chain([...m.flyParts, ...m.charges.map((c) => c.x)], F);
		chain([...m.hoistParts, ...m.charges.map((c) => c.y)], H);
		for (const c of m.charges) {
			c.size?.(f);
		}
		for (const sal of m.saltires) {
			f(sal.width);
		}
		for (const mark of m.marks) {
			mark.text(f);
		}
		for (const row of m.rows) {
			row.fallback(f);
		}
		for (const d of m.details) {
			d.caption(f);
			d.dims.forEach((x) => x.text(f));
		}
		for (const n of m.notes) {
			n(f);
		}
		return rounds || all.some((x) => x.startsWith("~")) || proportionText(H, F).includes("~");
	})();

	// What the footer says, which the room for the drawing depends on.
	const marked = showPositions && m.charges.length > 0 ? (m.charges.length === 1 ? ` The ${m.charges[0]!.name}’s center is marked +.` : " Each charge’s center is marked +.") : "";
	const unitNote = (units === "grid" ? "Sizes in grid units, as the file gives them." : units === "hoist" ? "Sizes as parts of the hoist, H." : `Sizes in millimetres for a hoist of ${decimal(hoistMm, 3)} mm, to the nearest 0.1 mm, or 0.01 mm under 10 mm.`) + (rounded && units !== "mm" ? ` ${roundingNote}` : "") + marked;
	const footRight = [options.path, options.tier !== undefined ? `tier ${options.tier}` : undefined, `Vexyl ${flag.version}`].filter((x): x is string => x !== undefined && x !== "").join(" · ");

	const name = view.label !== "" ? `${flag.meta.name} · ${view.label}` : flag.meta.name;
	const unitsTail = units === "hoist" ? ` · H = ${gridText(H)}` : units === "mm" ? ` · H = ${decimal(hoistMm, 3)} mm` : "";
	const headRight = `${proportionText(H, F)} · grid ${gridText(H)} × ${gridText(F)}${unitsTail}`;

	/**
	 * The notes under the drawing, in at most `room` lines. What's left out for room is never a
	 * size: the list of what isn't measured always stays, and anything else dropped is counted.
	 */
	const notesFor = (fallbacks: readonly string[], width: number, dropped: number, room: number): string[][] => {
		const list: string[] = [];
		if (showSizes && m.circles && m.charges.some((c) => c.circle !== undefined)) {
			list.push("A star’s or sun’s size is the circle through its points, shown dashed.");
		}
		// The same note for several charges is said once, with how many.
		const seen = new Map<string, number>();
		for (const n of m.notes) {
			const text = n(t);
			seen.set(text, (seen.get(text) ?? 0) + 1);
		}
		for (const [text, n] of seen) {
			list.push(n > 1 ? `${text} That’s so for ${n} charges.` : text);
		}
		const turned = [...m.turned];
		list.push(...(turned.length > 4 ? [`${turned.length} charges are turned, by the angles the file gives.`] : turned));
		list.push(...(fallbacks.length > 3 ? [`There’s no room on the drawing for the sizes of ${fallbacks.length} charges.`] : fallbacks));
		if (dropped > 0) {
			list.push(`There’s no room to label ${dropped} of the places marked along the edges.`);
		}
		if (showGrid && gridStep(toNumber(F), toNumber(H)) !== 1) {
			list.push(`The grid is drawn every ${gridStep(toNumber(F), toNumber(H))} units.`);
		}
		let last: string[] = [];
		if (m.unmeasured.size > 0) {
			let items = [...m.unmeasured].map(([what, n]) => (n > 1 ? `${what}, ${n} times` : what));
			if (items.length > 12) {
				items = [...items.slice(0, 11), `and ${items.length - 11} other things`];
			}
			last = wrap(words(`Not measured on this sheet: ${items.join(", ")}.`), 12, width);
		}
		const out: string[][] = [];
		let lines = last.length;
		for (let i = 0; i < list.length; i++) {
			const wrapped = wrap(words(list[i]!), 12, width);
			const left = list.length - i - 1;
			// Room for this one, and for a line saying how many more there are, if there are any.
			if (lines + wrapped.length + (left > 0 ? 1 : 0) > room && out.length + 1 < list.length) {
				const more = list.length - i;
				out.push(wrap(words(`${more} more ${more === 1 ? "note, about a repeat or a turn, is" : "notes, about repeats and turns, are"} left out for lack of room.`), 12, width));
				break;
			}
			out.push(wrapped);
			lines += wrapped.length;
		}
		if (last.length > 0) {
			out.push(last);
		}
		return out;
	};
	const notesHeight = (notes: readonly string[][]): number => (notes.length === 0 ? 0 : notes.reduce((a, n) => a + n.length * 16 + 4, 0) + 14);

	// The sheet's size, fixed by its paper or worked out from the drawing.
	const fit = paper === "fit";
	let W: number = fit ? 0 : papers[paper][0] * pxPerMm;
	let Hpx: number = fit ? 0 : papers[paper][1] * pxPerMm;

	const footFor = (width: number): string[] => {
		const room = width - 2 * margin.side - monoWidth(footRight, 12) - 16;
		return wrap(words(unitNote), 12, Math.max(room, 200));
	};

	const bodyTop = 100;
	// Details of repeated charges, at most two. The colours and the laws come first: a detail takes
	// what room the sidebar has left, enlarged as far as that allows, and one that doesn't fit there
	// goes under the drawing instead, which then gets a little smaller.
	const detailFor = (i: number, maxHeight: number): SidebarItem[] | null => detailItems(m.details[i]!, view.map, (idPrefix) => svg(flag, { ...form, idPrefix }), `${prefix}d${i}-`, theme, t, sidebarWidth, maxHeight);
	const detailCount = showSizes ? Math.min(m.details.length, 2) : 0;
	/** The tallest a detail under the drawing gets, so that the flag stays the sheet's main thing. */
	const belowHeight = 240;
	const sideItemsFor = (room: number): { side: SidebarItem[]; below: SidebarItem[][]; condensed: boolean } => {
		// The looks that list every colour and law in full, and fit, least condensed first.
		const full = looks.map((look) => ({ look, items: sidebarItems(flag, theme, { colors: showColors }, look, sidebarWidth, prefix, room) }))
			.filter(({ look, items }) => look.refs === Infinity && look.laws && !items.some((x) => x.condensed === true) && heightOf(items) <= room);
		/** Details in the sidebar under a look's colours and laws, as many as fit, and the rest under the drawing. */
		const withDetails = (items: SidebarItem[]): { side: SidebarItem[]; below: SidebarItem[][]; inSide: number } => {
			const side: SidebarItem[] = [];
			const below: SidebarItem[][] = [];
			let left = room - heightOf(items);
			let inSide = 0;
			for (let i = 0; i < detailCount; i++) {
				const here = detailFor(i, left - 10);
				if (here !== null) {
					side.push(...here, { height: 10, draw: () => undefined });
					left -= heightOf(here) + 10;
					inSide++;
					continue;
				}
				// One beside the notes at most, which leaves them room to read.
				const under = below.length === 0 ? detailFor(i, belowHeight) : null;
				if (under !== null) {
					below.push(under);
				}
			}
			return { side: [...side, ...items], below, inSide };
		};
		// A smaller look that leaves room for every detail is better than a detail that shrinks the drawing.
		const tries = full.map(({ items }) => withDetails(items));
		const best = tries.find((x) => x.inSide === detailCount) ?? tries[0];
		if (best !== undefined) {
			return { side: best.side, below: best.below, condensed: false };
		}
		// A palette or laws too long to list in full, whichever look: the last resort is to say how many more there are.
		for (const look of looks) {
			const items = sidebarItems(flag, theme, { colors: showColors }, look, sidebarWidth, prefix, room);
			if (heightOf(items) <= room || look === looks[looks.length - 1]) {
				const below = Array.from({ length: detailCount }, (_, i) => detailFor(i, belowHeight)).filter((x): x is SidebarItem[] => x !== null).slice(0, 1);
				return { side: items, below, condensed: true };
			}
		}
		return { side: [], below: [], condensed: false };
	};

	// The drawing: the flag's scale, where it goes, its rows and its notes.
	interface Drawing {
		s: number;
		fx: number;
		fy: number;
		/** The rows along the fly and along the hoist, on whichever sides of the drawing the form puts them. */
		rows: Record<"fly" | "hoist", SideLayout>;
		notes: string[][];
		notesY: number;
		right: number;
		bottom: number;
	}

	// The form's turn puts each row on a side of the drawing: the one its side of the flag turns to.
	const map = view.map;
	const sideOf = (v: Vec): Side => (Math.abs(v.x) > Math.abs(v.y) ? (v.x < 0 ? "left" : "right") : v.y < 0 ? "top" : "bottom");
	const sides: Record<"fly" | "hoist", Side> = { fly: sideOf(turnVec(map, { x: 0, y: -1 })), hoist: sideOf(turnVec(map, { x: -1, y: 0 })) };

	const segsFor = (s: number, fx: number, fy: number): { segs: Record<"fly" | "hoist", Seg[]>; ords: Record<"fly" | "hoist", Record<0 | 1, OrdinatePoint[]>> } => {
		const segs: Record<"fly" | "hoist", Seg[]> = { fly: [], hoist: [] };
		const ords: Record<"fly" | "hoist", Record<0 | 1, OrdinatePoint[]>> = { fly: { 0: [], 1: [] }, hoist: { 0: [], 1: [] } };
		/** Where a place along an axis of the flag is, along the side of the drawing its row is on. */
		const at = (along: "fly" | "hoist", v: Fraction): number => {
			const d = apply(map, along === "fly" ? { x: toNumber(v), y: 0 } : { x: 0, y: toNumber(v) });
			return across90(sides[along]) ? fy + d.y * s : fx + d.x * s;
		};
		const add = (along: "fly" | "hoist", cat: 0 | 1 | 2, a: Fraction, b: Fraction): void => {
			if (compare(a, b) >= 0) {
				return;
			}
			const [pa, pb] = [at(along, a), at(along, b)];
			segs[along].push({ a: Math.min(pa, pb), b: Math.max(pa, pb), text: t(minus(b, a)), cat, ends: pa <= pb ? [toNumber(a), toNumber(b)] : [toNumber(b), toNumber(a)] });
		};
		const chain = (along: "fly" | "hoist", cat: 0 | 1, points: Fraction[], end: Fraction | null): void => {
			const sorted = [...points].sort(compare).filter((p, i, all) => (i === 0 || !same(p, all[i - 1]!)) && compare(p, zero) > 0 && (end === null || compare(p, end) < 0));
			const stops = [zero, ...sorted, ...(end !== null ? [end] : [])];
			for (let i = 0; i + 1 < stops.length; i++) {
				add(along, cat, stops[i]!, stops[i + 1]!);
			}
			ords[along][cat] = stops.map((p) => ({ p: at(along, p), text: t(p), end: toNumber(p) }));
		};
		if (showPositions) {
			chain("fly", 0, m.charges.filter((c) => compare(c.x, F) <= 0).map((c) => c.x), null);
			chain("hoist", 0, m.charges.filter((c) => compare(c.y, H) <= 0).map((c) => c.y), null);
		}
		if (showSizes) {
			if (m.flyParts.some((p) => compare(p, zero) > 0 && compare(p, F) < 0)) {
				chain("fly", 1, m.flyParts, F);
			}
			if (m.hoistParts.some((p) => compare(p, zero) > 0 && compare(p, H) < 0)) {
				chain("hoist", 1, m.hoistParts, H);
			}
			add("fly", 2, zero, F);
			add("hoist", 2, zero, H);
		}
		return { segs, ords };
	};

	const fl = toNumber(F);
	const ho = toNumber(H);
	// The drawing's own width and height, which a turn can swap.
	const dw = view.sideways ? ho : fl;
	const dh = view.sideways ? fl : ho;

	/** Details beside the notes, under the drawing: how wide and tall they are together. */
	let beside = { w: 0, h: 0 };
	const layDrawing = (box: Box, fixedScale: number | null, fallbacks: readonly string[]): Drawing => {
		const first = showSizes ? rowGap + pitch + 20 : showPositions ? rowGap + 20 : 10;
		const ext: Record<Side, number> = { top: 0, bottom: 0, left: 0, right: 0 };
		ext[sides.fly] = first;
		ext[sides.hoist] = first;
		let result: Drawing | null = null;
		let dropped = 0;
		for (let pass = 0; pass < 8; pass++) {
			const room = fixedScale === null ? Math.max(3, Math.floor(((box.y1 - box.y0) * 0.24) / 16)) : 40;
			const notes = notesFor(fallbacks, Math.max(box.x1 - box.x0 - (beside.w > 0 ? beside.w + 24 : 0), 300), dropped, room);
			const nh = notesHeight(notes);
			const availW = box.x1 - box.x0 - ext.left - ext.right - 14;
			const availH = box.y1 - box.y0 - ext.top - ext.bottom - Math.max(nh, beside.h) - 8;
			const s = fixedScale ?? Math.max(0.01, Math.min(availW / dw, availH / dh));
			const spareW = fixedScale === null ? Math.max(0, availW - dw * s) : 0;
			const spareH = fixedScale === null ? Math.max(0, availH - dh * s) : 0;
			const fx = box.x0 + ext.left + spareW / 2;
			const fy = box.y0 + ext.top + spareH / 2;
			const { segs, ords } = segsFor(s, fx, fy);
			const lay = (along: "fly" | "hoist"): SideLayout => (across90(sides[along]) ? laySide(segs[along], ords[along], Math.max(box.y0, fy - 14), fy + dh * s + 14) : laySide(segs[along], ords[along], box.x0, box.x1));
			const rows = { fly: lay("fly"), hoist: lay("hoist") };
			const flagBox = { x0: fx, y0: fy, x1: fx + dw * s, y1: fy + dh * s };
			const texts = (along: "fly" | "hoist"): RowText[] => rowTexts(rows[along], sides[along], flagBox);
			const all = [...texts("fly"), ...texts("hoist")];
			const right = Math.max(fx + dw * s, ...all.map((r) => r.box.x1));
			// Rows under the drawing push its notes down.
			const below = Math.max(0, ...(["fly", "hoist"] as const).filter((a) => sides[a] === "bottom").flatMap((a) => texts(a)).map((r) => r.box.y1 - flagBox.y1));
			result = { s, fx, fy, rows, notes, notesY: fy + dh * s + below + 26, right, bottom: fy + dh * s + below + nh + 12 };
			const lost = rows.fly.dropped + rows.hoist.dropped;
			if (rows.fly.extent <= ext[sides.fly] + 0.01 && rows.hoist.extent <= ext[sides.hoist] + 0.01 && lost <= dropped) {
				break;
			}
			dropped = Math.max(dropped, lost);
			ext[sides.fly] = Math.max(ext[sides.fly], rows.fly.extent);
			ext[sides.hoist] = Math.max(ext[sides.hoist], rows.hoist.extent);
		}
		return result!;
	};

	let drawing: Drawing;
	let sideX: number;
	let side: SidebarItem[];
	// Details under the drawing, with where they start, and whether the sidebar had to be condensed.
	let below: SidebarItem[][] = [];
	let condensed = false;
	let foot: string[];
	let charges: ChargePlan;
	let fallbacks: string[] = [];
	for (let attempt = 0; ; attempt++) {
		if (fit) {
			const s = Math.min(1000 / dw, 480 / dh);
			const probe = layDrawing({ x0: margin.side, y0: bodyTop + 8, x1: 1e6, y1: 1e6 }, s, fallbacks);
			const drawRight = Math.max(probe.right, probe.fx + dw * s) + 12;
			const width = Math.max(drawRight - margin.side, 420);
			drawing = layDrawing({ x0: margin.side, y0: bodyTop + 8, x1: margin.side + width, y1: 1e6 }, s, fallbacks);
			({ side, below, condensed } = sideItemsFor(1e6));
			const hasSide = heightOf(side) > 0;
			sideX = margin.side + width + 20;
			W = Math.max(sideX + (hasSide ? sidebarWidth : -20) + margin.side, margin.side * 2 + sansWidth(name, 28, 500) + monoWidth(headRight, 13) + 40);
			foot = footFor(W);
			const footH = foot.length * 16 + 26;
			Hpx = Math.max(drawing.bottom, bodyTop + 30 + heightOf(side)) + 12 + footH + margin.bottom;
		} else {
			foot = footFor(W);
			const footH = foot.length * 16 + 26;
			const bodyBottom = Hpx - margin.bottom - footH - 10;
			({ side, below, condensed } = sideItemsFor(bodyBottom - (bodyTop + 30)));
			const hasSide = heightOf(side) > 0;
			sideX = W - margin.side - sidebarWidth;
			beside = below.length === 0 ? { w: 0, h: 0 } : { w: below.length * (sidebarWidth + 24) - 24, h: Math.max(...below.map(heightOf)) + 14 };
			drawing = layDrawing({ x0: margin.side, y0: bodyTop + 8, x1: hasSide ? sideX - 20 : W - margin.side, y1: bodyBottom }, null, fallbacks);
		}
		const flagBox = { x0: drawing.fx, y0: drawing.fy, x1: drawing.fx + dw * drawing.s, y1: drawing.fy + dh * drawing.s };
		const area = { x0: margin.side, y0: bodyTop, x1: fit || heightOf(side) > 0 ? sideX - 20 : W - margin.side, y1: drawing.notesY - 16 };
		const taken = [...rowTexts(drawing.rows.fly, sides.fly, flagBox), ...rowTexts(drawing.rows.hoist, sides.hoist, flagBox)].map((r) => r.box);
		// A label off the flag stays out of the rows below it and beside it, whose lines it would cross.
		for (const a of ["fly", "hoist"] as const) {
			const rows = drawing.rows[a].rows;
			const out = rows.length === 0 ? 0 : rows.at(-1)!.at + 6;
			if (sides[a] === "bottom") {
				taken.push({ x0: flagBox.x0, y0: flagBox.y1 + 4, x1: flagBox.x1, y1: flagBox.y1 + out });
			} else if (sides[a] === "right") {
				taken.push({ x0: flagBox.x1 + 4, y0: flagBox.y0, x1: flagBox.x1 + out, y1: flagBox.y1 });
			} else if (sides[a] === "top") {
				taken.push({ x0: flagBox.x0, y0: flagBox.y0 - out, x1: flagBox.x1, y1: flagBox.y0 - 4 });
			} else {
				taken.push({ x0: flagBox.x0 - out, y0: flagBox.y0, x1: flagBox.x0 - 4, y1: flagBox.y1 });
			}
		}
		charges = planCharges(m, placingFor(map, drawing.s, drawing.fx, drawing.fy), view.sideways && !view.upright, taken, flagBox, area, t, showSizes, showPositions);
		if (charges.fallbacks.length === 0 || attempt > 0) {
			break;
		}
		fallbacks = charges.fallbacks;
	}

	const o = new Out();
	const { s, fx, fy } = drawing;
	const fw = dw * s;
	const fh = dh * s;
	const place = placingFor(map, s, fx, fy);
	const flagBox = { x0: fx, y0: fy, x1: fx + fw, y1: fy + fh };
		// A paper's size is given as it's known, and a fitted sheet's to a tenth of a millimetre.
	const mmW = fit ? Math.ceil((W / pxPerMm) * 10) / 10 : papers[paper as "a4" | "letter"][0];
	const mmH = fit ? Math.ceil((Hpx / pxPerMm) * 10) / 10 : papers[paper as "a4" | "letter"][1];
	o.add(`<svg xmlns="http://www.w3.org/2000/svg" width="${num(mmW)}mm" height="${num(mmH)}mm" viewBox="0 0 ${num(W)} ${num(Hpx)}">`);
	o.add(`<title>${esc(`${name}: construction sheet`)}</title>`);
	o.add(`<rect x="0" y="0" width="${num(W)}" height="${num(Hpx)}" fill="${theme.paper}"/>`);

	// The header.
	const headRightW = monoWidth(headRight, 13);
	let nameSize = 28;
	const nameRoom = W - 2 * margin.side - headRightW - 24;
	while (nameSize > 16 && sansWidth(name, nameSize, 500) > nameRoom) {
		nameSize--;
	}
	let shownName = name;
	while (sansWidth(shownName, nameSize, 500) > nameRoom && shownName.length > 1) {
		shownName = `${[...shownName].slice(0, -2).join("")}…`;
	}
	o.text(margin.side, 49, "CONSTRUCTION SHEET", `font-family="${monoFamily}" font-size="11" letter-spacing="0.88" fill="${theme.muted}"`, { x0: margin.side, y0: 40, x1: margin.side + monoWidth("CONSTRUCTION SHEET", 11) + 0.88 * 18, y1: 51 });
	o.text(margin.side, 80, shownName, `font-family="${sansFamily}" font-size="${nameSize}" font-weight="500" letter-spacing="-0.28" fill="${theme.ink}"`, { x0: margin.side, y0: 80 - nameSize * 0.78, x1: margin.side + sansWidth(shownName, nameSize, 500), y1: 80 + nameSize * 0.22 });
	o.text(W - margin.side, 80, headRight, `font-family="${monoFamily}" font-size="13" text-anchor="end" fill="${theme.ink2}"`, { x0: W - margin.side - headRightW, y0: 70, x1: W - margin.side, y1: 83 });
	o.add(`<path d="M${num(margin.side)} 90H${num(W - margin.side)}" stroke="${theme.rule}" stroke-width="1.5"/>`);

	// The flag, as the library draws it.
	const drawn = view.drawn;
	const vb = /viewBox="([^"]*)"/.exec(drawn)![1]!.split(" ").map(Number) as [number, number, number, number];
	const body = drawn.replace(/^<svg [^>]*>\n?/, "").replace(/<\/svg>\n?$/, "");
	o.add(`<svg x="${num(fx + vb[0] * s)}" y="${num(fy + vb[1] * s)}" width="${num(vb[2] * s)}" height="${num(vb[3] * s)}" viewBox="${vb.map(num).join(" ")}" overflow="hidden">`);
	o.add(body.replace(/\n$/, ""));
	o.add("</svg>");
	o.add(`<rect x="${num(fx)}" y="${num(fy)}" width="${num(fw)}" height="${num(fh)}" fill="none" ${stroke(theme.outline)} stroke-width="1"/>`);

	if (showGrid) {
		drawGrid(o, theme, fl, ho, place);
	}

	// Extension lines, from the flag's edge to the furthest row that uses each place.
	const ext: string[] = [];
	const furthest = (l: SideLayout): Map<string, { at: number; dist: number }> => {
		const out = new Map<string, { at: number; dist: number }>();
		const note = (end: number, at: number, dist: number): void => {
			const key = end.toFixed(9);
			const was = out.get(key);
			if (was === undefined || was.dist < dist) {
				out.set(key, { at, dist });
			}
		};
		for (const p of l.chains) {
			note(p.ends[0], p.a, l.rows[p.row]!.at);
			note(p.ends[1], p.b, l.rows[p.row]!.at);
		}
		for (const o of l.ords) {
			note(o.end, o.p, l.rows[o.row]!.at);
		}
		return out;
	};
	/** A line across a row, at a place along it, from `d0` to `d1` out from the flag's edge. */
	const crossing = (side: Side, at: number, d0: number, d1: number): string => {
		switch (side) {
			case "top":
				return `M${num(at)} ${num(fy - d0)}V${num(fy - d1)}`;
			case "bottom":
				return `M${num(at)} ${num(fy + fh + d0)}V${num(fy + fh + d1)}`;
			case "left":
				return `M${num(fx - d0)} ${num(at)}H${num(fx - d1)}`;
			case "right":
				return `M${num(fx + fw + d0)} ${num(at)}H${num(fx + fw + d1)}`;
		}
	};
	/** A row's own line, `d` out from the flag's edge, between two places along it. */
	const rowPath = (side: Side, d: number, from: number, to: number): string => {
		const line = rowLine(side, d, flagBox);
		return across90(side) ? `M${num(line)} ${num(from)}V${num(to)}` : `M${num(from)} ${num(line)}H${num(to)}`;
	};
	for (const a of ["fly", "hoist"] as const) {
		for (const { at, dist } of furthest(drawing.rows[a]).values()) {
			ext.push(crossing(sides[a], at, 5, dist + tick));
		}
	}
	if (ext.length > 0) {
		o.add(`<path d="${ext.join("")}" fill="none" ${stroke(theme.ext)} stroke-width="0.8" stroke-dasharray="3 3"/>`);
	}

	// The dimensions themselves, with their labels.
	const dims: string[] = [];
	const label = `font-family="${monoFamily}" font-size="${labelSize}" fill="${theme.label}" stroke="${theme.paper}" stroke-width="3" stroke-linejoin="round" paint-order="stroke"`;
	for (const a of ["fly", "hoist"] as const) {
		const l = drawing.rows[a];
		const sd = sides[a];
		for (const p of l.chains) {
			const d = l.rows[p.row]!.at;
			dims.push(`${rowPath(sd, d, Math.min(p.a, p.lo), Math.max(p.b, p.hi))}${crossing(sd, p.a, d + tick, d - tick)}${crossing(sd, p.b, d + tick, d - tick)}`);
		}
		// Ordinates: a line from the edge, a tick at each place, and a leader out to its label.
		for (let r = 0; r < l.rows.length; r++) {
			const ords = l.ords.filter((x) => x.row === r);
			if (ords.length === 0) {
				continue;
			}
			const d = l.rows[r]!.at;
			dims.push(rowPath(sd, d, Math.min(...ords.map((x) => x.p)), Math.max(...ords.map((x) => x.p))));
			for (const x of ords) {
				const end = across90(sd) ? { x: rowLine(sd, d + 12, flagBox), y: x.c } : { x: x.c, y: rowLine(sd, d + 12, flagBox) };
				dims.push(`${crossing(sd, x.p, d - tick / 2, d + tick)}L${num(end.x)} ${num(end.y)}`);
			}
		}
		for (const r of rowTexts(l, sd, flagBox)) {
			o.text(r.x, r.y, r.text, `${label} ${r.attrs}`, r.box);
		}
	}

	// What's drawn on the flag: centers, the lines from them to the edges, and charges' sizes.
	const onFlag: string[] = [];
	const halo: string[] = [];
	if (showPositions) {
		for (const c of m.charges) {
			const x = toNumber(c.x);
			const y = toNumber(c.y);
			const at = place.at({ x, y });
			// From the top and the hoist, wherever the turn puts them, to just short of the center.
			const short = (q: Vec): Vec => {
				const len = Math.hypot(at.x - q.x, at.y - q.y);
				return len <= 8 ? q : { x: at.x + ((q.x - at.x) * 8) / len, y: at.y + ((q.y - at.y) * 8) / len };
			};
			const lines = [place.at({ x, y: 0 }), place.at({ x: 0, y })].map((q) => straight(q, short(q))).join("");
			onFlag.push(`<path d="${lines}" fill="none" stroke="${theme.onFlag}" stroke-width="0.8" stroke-dasharray="3 3"/>`);
			halo.push(lines);
			const plusMark = `M${num(at.x - 6)} ${num(at.y)}H${num(at.x + 6)}M${num(at.x)} ${num(at.y - 6)}V${num(at.y + 6)}`;
			halo.push(plusMark);
			onFlag.push(`<path d="${plusMark}" stroke="${theme.onFlag}" stroke-width="1.5"/>`);
		}
	}
	const circles: string[] = [];
	for (const plan of charges.labels) {
		if (plan.circle !== undefined) {
			circles.push(`<circle cx="${num(plan.cx)}" cy="${num(plan.cy)}" r="${num(plan.circle)}" fill="none" stroke="${theme.halo}" stroke-width="2.5" stroke-opacity="0.6"/>`);
			circles.push(`<circle cx="${num(plan.cx)}" cy="${num(plan.cy)}" r="${num(plan.circle)}" fill="none" stroke="${theme.onFlag}" stroke-width="1" stroke-dasharray="4 3"/>`);
		}
		if (plan.leader !== undefined) {
			halo.push(plan.leader);
			onFlag.push(`<path d="${plan.leader}" fill="none" stroke="${theme.onFlag}" stroke-width="0.8"/>`);
		}
	}
	for (const d of charges.dims) {
		halo.push(d);
		onFlag.push(`<path d="${d}" fill="none" stroke="${theme.onFlag}" stroke-width="1"/>`);
	}
	for (const d of charges.dashed) {
		halo.push(d);
		onFlag.push(`<path d="${d}" fill="none" stroke="${theme.onFlag}" stroke-width="0.8" stroke-dasharray="3 3"/>`);
	}
	// Construction lines, such as a slanting axis, under everything else drawn on the flag.
	const guides = showSizes ? m.guides.filter((g) => g.length > 1).map((g) => pathOf(g.map(place.at))) : [];
	if (guides.length > 0) {
		o.add(`<path d="${guides.join("")}" fill="none" stroke="${theme.halo}" stroke-width="2" stroke-opacity="0.5"/>`);
		o.add(`<path d="${guides.join("")}" fill="none" stroke="${theme.onFlag}" stroke-width="0.8" stroke-opacity="0.6" stroke-dasharray="5 4"/>`);
	}
	if (halo.length > 0) {
		o.add(`<path d="${halo.join("")}" fill="none" stroke="${theme.halo}" stroke-width="2.6" stroke-opacity="0.7" stroke-linecap="round"/>`);
	}
	o.lines.push(...circles, ...onFlag);
	if (dims.length > 0) {
		o.add(`<path d="${dims.join("")}" fill="none" stroke="${theme.dim}" stroke-width="1"/>`);
	}
	// On the flag, a size sits on a small chip of the sheet's own color, which reads on any field.
	for (const plan of charges.labels) {
		if (plan.text !== undefined && plan.box !== undefined) {
			const b = plan.box;
			const inside = b.x0 >= fx && b.x1 <= fx + fw && b.y0 >= fy && b.y1 <= fy + fh;
			if (inside) {
				o.add(`<rect x="${num(b.x0 - 2)}" y="${num(b.y0)}" width="${num(b.x1 - b.x0 + 4)}" height="${num(b.y1 - b.y0)}" rx="3" fill="${theme.paper}" fill-opacity="0.88"/>`);
			}
			o.text((b.x0 + b.x1) / 2, b.y1 - 3.5, plan.text, `font-family="${monoFamily}" font-size="12" fill="${theme.label}" text-anchor="middle"`, b, inside);
		}
	}
	// Along a slanting row, a label is haloed instead, since a chip would have to slant too.
	for (const l of charges.slanted) {
		o.text(l.c.x, l.c.y + 4.2, l.text, `font-family="${monoFamily}" font-size="12" fill="${theme.onFlag}" stroke="${theme.halo}" stroke-width="3" stroke-linejoin="round" paint-order="stroke" text-anchor="middle" transform="rotate(${num(l.deg)} ${num(l.c.x)} ${num(l.c.y)})"`, l.box, true);
	}

	// The notes under the drawing.
	let ny = drawing.notesY;
	drawing.notes.forEach((lines, i) => {
		const last = i === drawing.notes.length - 1 && m.unmeasured.size > 0;
		for (const line of lines) {
			o.text(margin.side, ny, line, `font-family="${sansFamily}" font-size="12" fill="${last ? theme.ink2 : theme.muted}"`, { x0: margin.side, y0: ny - 10, x1: margin.side + sansWidth(line, 12), y1: ny + 3 });
			ny += 16;
		}
		ny += 4;
	});

	// The sidebar, and any details under the drawing.
	let sy = bodyTop + 30;
	for (const item of side) {
		item.draw(o, sideX, sy);
		sy += item.height;
	}
	// Beside the notes, at the right of the drawing's column.
	const besideX = (heightOf(side) > 0 ? sideX - 20 : W - margin.side) - beside.w;
	below.forEach((items, i) => {
		let y = drawing.notesY - 12;
		for (const item of items) {
			item.draw(o, besideX + i * (sidebarWidth + 24), y);
			y += item.height;
		}
	});

	// The footer.
	const footH = foot.length * 16 + 26;
	const footTop = Hpx - margin.bottom - footH + 10;
	o.add(`<path d="M${num(margin.side)} ${num(footTop)}H${num(W - margin.side)}" ${stroke(theme.outline)} stroke-width="1"/>`);
	foot.forEach((line, i) => {
		const y = footTop + 22 + i * 16;
		o.text(margin.side, y, line, `font-family="${sansFamily}" font-size="12" fill="${theme.ink2}"`, { x0: margin.side, y0: y - 10, x1: margin.side + sansWidth(line, 12), y1: y + 3 });
	});
	const footRightW = monoWidth(footRight, 12);
	o.text(W - margin.side, footTop + 22, footRight, `font-family="${monoFamily}" font-size="12" text-anchor="end" fill="${theme.ink2}"`, { x0: W - margin.side - footRightW, y0: footTop + 12, x1: W - margin.side, y1: footTop + 25 });
	o.add("</svg>");
	const style = fontStyle(options.fonts ?? [], o.faces);
	if (style !== "") {
		// After the title, which readers look for first.
		o.lines.splice(2, 0, style);
	}

	recording = null;
	return { svg: o.lines.join("\n") + "\n", width: W, height: Hpx, widthMm: mmW, heightMm: mmH, labels: o.labels, flag: { x0: fx, y0: fy, x1: fx + fw, y1: fy + fh }, condensed, hoist: H, values: [...new Map(values.map((v) => [`${v.unit} ${v.text} ${v.exact.n}/${v.exact.d}`, v])).values()] };
}

/** How far apart the grid's lines are drawn, which is one unit unless that's too many lines. */
function gridStep(fl: number, ho: number): number {
	for (const step of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) {
		if (fl / step <= 60 && ho / step <= 60) {
			return step;
		}
	}
	return 10000;
}

/** A line from one point to another, as path data, which is shorter for one that's level or upright. */
function straight(a: Vec, b: Vec): string {
	if (Math.abs(a.x - b.x) < 1e-9) {
		return `M${num(a.x)} ${num(a.y)}V${num(b.y)}`;
	}
	if (Math.abs(a.y - b.y) < 1e-9) {
		return `M${num(a.x)} ${num(a.y)}H${num(b.x)}`;
	}
	return pathOf([a, b]);
}

function drawGrid(o: Out, theme: Theme, fl: number, ho: number, p: Placing): void {
	const step = gridStep(fl, ho);
	const d: string[] = [];
	for (let x = step; x < fl - 1e-9; x += step) {
		d.push(straight(p.at({ x, y: 0 }), p.at({ x, y: ho })));
	}
	for (let y = step; y < ho - 1e-9; y += step) {
		d.push(straight(p.at({ x: 0, y }), p.at({ x: fl, y })));
	}
	if (d.length > 0) {
		o.add(`<path d="${d.join("")}" fill="none" stroke="${theme.halo}" stroke-width="1.6" stroke-opacity="0.35"/>`);
		o.add(`<path d="${d.join("")}" fill="none" stroke="${theme.onFlag}" stroke-width="0.5" stroke-opacity="0.55"/>`);
	}
}

/** How a form's flag is placed on the sheet: turned by `map`, at a scale of `s`, from (`fx`, `fy`). */
function placingFor(map: Affine, s: number, fx: number, fy: number): Placing {
	return {
		at: (q) => {
			const d = apply(map, q);
			return { x: fx + d.x * s, y: fy + d.y * s };
		},
		way: (v) => {
			const d = turnVec(map, v);
			const l = Math.hypot(d.x, d.y);
			return { x: d.x / l, y: d.y / l };
		},
		s,
	};
}

// --- Charges' labels --------------------------------------------------------------------------

interface ChargeLabel {
	cx: number;
	cy: number;
	circle?: number;
	text?: string;
	box?: Box;
	leader?: string;
}

interface ChargePlan {
	labels: ChargeLabel[];
	/** Dimension lines drawn on the flag, as path data. */
	dims: string[];
	/** Construction lines drawn on the flag, dashed. */
	dashed: string[];
	/** Labels set at a slant, along rows over the flag. */
	slanted: SlantLabel[];
	/** Sizes with nowhere to go on the drawing, for the notes. */
	fallbacks: string[];
}

const hits = (a: Box, b: Box, gap = 2): boolean => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

/**
 * Finds a place for each charge's size, on the flag if it can, beside the copy it measures, and
 * clear of every other label. What can't go anywhere goes in the notes instead. `swap` says that
 * the form's turn has turned charges a quarter turn, so that each reaches across where it reached down.
 */
function planCharges(m: Measured, place: Placing, swap: boolean, rowBoxes: readonly Box[], flag: Box, area: Box, t: Format, sizes: boolean, positions: boolean): ChargePlan {
	const s = place.s;
	const taken: Box[] = [...rowBoxes];
	if (positions) {
		for (const c of m.charges) {
			const q = place.at({ x: toNumber(c.x), y: toNumber(c.y) });
			taken.push({ x0: q.x - 6, y0: q.y - 6, x1: q.x + 6, y1: q.y + 6 });
		}
	}
	const plan: ChargePlan = { labels: [], dims: [], dashed: [], slanted: [], fallbacks: [] };
	if (!sizes) {
		return plan;
	}
	const within = (b: Box, outer: Box): boolean => b.x0 >= outer.x0 && b.x1 <= outer.x1 && b.y0 >= outer.y0 && b.y1 <= outer.y1;
	/** Takes the first of some places that's free, on the flag before off it. */
	const first = (cands: { box: Box; leader?: string }[][]): { box: Box; leader?: string } | null => {
		for (const outside of [false, true]) {
			for (const group of cands) {
				for (const c of group) {
					const ok = outside ? within(c.box, area) && !hits(c.box, flag, 3) : within(c.box, flag);
					if (ok && !taken.some((b) => hits(b, c.box))) {
						taken.push(c.box);
						return c;
					}
				}
			}
		}
		return null;
	};
	const h = 14;
	for (const c of m.charges) {
		const { x: cx, y: cy } = place.at(c.at);
		const out: ChargeLabel = { cx, cy };
		if (c.circle !== undefined) {
			out.circle = c.circle * s;
		}
		if (c.size !== undefined) {
			const text = c.size(t);
			const w = monoWidth(text, 12);
			const rx = Math.max((swap ? c.reach.y : c.reach.x) * s, 2);
			const ry = Math.max((swap ? c.reach.x : c.reach.y) * s, 2);
			const line = (x0: number, y0: number, x1: number, y1: number, g: number): string | undefined => (g > 6 ? `M${num(x0)} ${num(y0)}L${num(x1)} ${num(y1)}` : undefined);
			const at = (g: number): { box: Box; leader?: string }[] => [
				{ box: { x0: cx - w / 2, y0: cy + ry + g, x1: cx + w / 2, y1: cy + ry + g + h }, leader: line(cx, cy + ry, cx, cy + ry + g, g) },
				{ box: { x0: cx - w / 2, y0: cy - ry - g - h, x1: cx + w / 2, y1: cy - ry - g }, leader: line(cx, cy - ry, cx, cy - ry - g, g) },
				{ box: { x0: cx + rx + g, y0: cy - h / 2, x1: cx + rx + g + w, y1: cy + h / 2 }, leader: line(cx + rx, cy, cx + rx + g, cy, g) },
				{ box: { x0: cx - rx - g - w, y0: cy - h / 2, x1: cx - rx - g, y1: cy + h / 2 }, leader: line(cx - rx, cy, cx - rx - g, cy, g) },
			].map((x) => (x.leader === undefined ? { box: x.box } : { box: x.box, leader: x.leader }));
			const got = first([at(4), at(12), at(24), at(40)]);
			if (got === null) {
				plan.fallbacks.push(`The ${c.name}’s size: ${text}.`);
			} else {
				out.text = text;
				out.box = got.box;
				if (got.leader !== undefined) {
					out.leader = got.leader;
				}
			}
		}
		plan.labels.push(out);
	}
	for (const sal of m.saltires) {
		// Across the arm along the bend, three tenths of the way from the center to its corner.
		const w = toNumber(sal.frame.w);
		const hh = toNumber(sal.frame.h);
		const len = Math.hypot(w, hh);
		const along = { x: w / len, y: hh / len };
		const p = place.at({ x: toNumber(sal.frame.x) + w / 2 + along.x * len * 0.3, y: toNumber(sal.frame.y) + hh / 2 + along.y * len * 0.3 });
		const dir = place.way(along);
		const n = place.way({ x: -along.y, y: along.x });
		const half = (toNumber(sal.width) * s) / 2;
		const a = { x: p.x - n.x * half, y: p.y - n.y * half };
		const b = { x: p.x + n.x * half, y: p.y + n.y * half };
		const ticks = (q: { x: number; y: number }): string => `M${num(q.x - dir.x * 5)} ${num(q.y - dir.y * 5)}L${num(q.x + dir.x * 5)} ${num(q.y + dir.y * 5)}`;
		const text = t(sal.width);
		const tw = monoWidth(text, 12);
		const around = (g: number): { box: Box }[] => [1, -1].map((sign) => {
			const q = { x: p.x + n.x * sign * (half + g), y: p.y + n.y * sign * (half + g) };
			const bx = q.x + (n.x * sign >= 0 ? 0 : -tw);
			const by = q.y + (n.y * sign >= 0 ? 0 : -h);
			return { box: { x0: bx, y0: by, x1: bx + tw, y1: by + h } };
		});
		const centered = { box: { x0: p.x - tw / 2 + dir.x * 16, y0: p.y - h / 2 + dir.y * 16, x1: p.x + tw / 2 + dir.x * 16, y1: p.y + h / 2 + dir.y * 16 } };
		const got = first([around(6), around(14), [centered], around(28)]);
		if (got === null) {
			plan.fallbacks.push(`The ${sal.name} is ${text} wide.`);
			continue;
		}
		plan.dims.push(`M${num(a.x)} ${num(a.y)}L${num(b.x)} ${num(b.y)}${ticks(a)}${ticks(b)}`);
		plan.labels.push({ cx: p.x, cy: p.y, text, box: got.box });
	}
	for (const mark of m.marks) {
		const text = mark.text(t);
		const options = mark.options(place, monoWidth(text, 12), h);
		let got: { o: MarkOption; box: Box } | null = null;
		for (const outside of [false, true]) {
			for (const o of options) {
				const box = o.spots.find((b) => (outside ? within(b, area) && !hits(b, flag, 3) : within(b, flag)) && !taken.some((x) => hits(x, b)));
				if (box !== undefined) {
					got = { o, box };
					break;
				}
			}
			if (got !== null) {
				break;
			}
		}
		if (got === null) {
			plan.fallbacks.push(mark.fallback(text));
			continue;
		}
		taken.push(got.box);
		plan.dims.push(...got.o.solid.map(pathOf));
		plan.dashed.push(...got.o.dashed.map(pathOf));
		plan.labels.push({ cx: (got.box.x0 + got.box.x1) / 2, cy: (got.box.y0 + got.box.y1) / 2, text, box: got.box });
	}
	for (const row of m.rows) {
		const got = planRow(row, place, t, taken, flag);
		if (got === null) {
			plan.fallbacks.push(row.fallback(t));
			continue;
		}
		taken.push(...got.labels.map((l) => l.box));
		plan.dims.push(...got.solid);
		plan.dashed.push(...got.dashed);
		plan.slanted.push(...got.labels);
	}
	return plan;
}

/** A label set at a slant, along a row over the flag: its center, its angle, and its box. */
interface SlantLabel {
	text: string;
	c: Vec;
	deg: number;
	box: LabelBox;
}

/**
 * Places a slanting row over the flag, on whichever side of its axis has room: its line, its ticks
 * and its labels, turned to read along it the right way up. It's null if any label has no room.
 */
function planRow(row: FlagRow, p: Placing, t: Format, taken: readonly Box[], flag: Box): { solid: string[]; dashed: string[]; labels: SlantLabel[] } | null {
	const s = p.s;
	const at = (x: number, y: number): Vec => p.at(apply(row.frame, { x, y }));
	const way = (v: Vec): Vec => p.way(turnVec(row.frame, v));
	const within = (b: Box): boolean => b.x0 >= flag.x0 && b.x1 <= flag.x1 && b.y0 >= flag.y0 && b.y1 <= flag.y1;
	/** A label centered on a point, reading along a direction, turned so that it's never upside down. */
	const slanted = (text: string, c: Vec, d: Vec): SlantLabel => {
		let deg = (Math.atan2(d.y, d.x) * 180) / Math.PI;
		if (deg > 90.001) {
			deg -= 180;
		} else if (deg <= -90) {
			deg += 180;
		}
		const rad = (deg * Math.PI) / 180;
		const u = { x: Math.cos(rad), y: Math.sin(rad) };
		const up = { x: Math.sin(rad), y: -Math.cos(rad) };
		const w = monoWidth(text, 12) / 2 + 1;
		const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: c.x + u.x * w * a! + up.x * 7 * b!, y: c.y + u.y * w * a! + up.y * 7 * b! }));
		const box: LabelBox = { x0: Math.min(...corners.map((q) => q.x)), y0: Math.min(...corners.map((q) => q.y)), x1: Math.max(...corners.map((q) => q.x)), y1: Math.max(...corners.map((q) => q.y)), text, onFlag: true, corners };
		return { text, c, deg, box };
	};
	const end = compare(row.stops.at(-1)!, zero) > 0 ? 1 : -1;
	// Above the axis on the sheet first, where a reader looks for it.
	const sides = way({ x: 0, y: -1 }).y <= 0 ? [-1, 1] : [1, -1];
	for (const side of sides) {
		const off = row.reach + 16 / s;
		const xs = row.stops.map(toNumber);
		const line = xs.map((x) => at(x, side * off));
		const along = way({ x: 1, y: 0 });
		const out = way({ x: 0, y: side });
		const labels: SlantLabel[] = [];
		let ok = true;
		for (let i = 0; i + 1 < line.length && ok; i++) {
			const [a, b] = [line[i]!, line[i + 1]!];
			const text = t(minus(row.stops[i + 1]!, row.stops[i]!));
			if (monoWidth(text, 12) + 8 > Math.hypot(b.x - a.x, b.y - a.y)) {
				ok = false;
				break;
			}
			labels.push(slanted(text, { x: (a.x + b.x) / 2 + out.x * 10, y: (a.y + b.y) / 2 + out.y * 10 }, along));
		}
		// Across the outermost group, just beyond its end.
		const ax = row.across.at + (end * 16) / s;
		const [a0, a1] = [at(ax, toNumber(row.across.from)), at(ax, toNumber(row.across.to))];
		const acrossText = t(minus(row.across.to, row.across.from));
		const beyond = way({ x: end, y: 0 });
		if (ok && monoWidth(acrossText, 12) + 8 <= Math.hypot(a1.x - a0.x, a1.y - a0.y)) {
			labels.push(slanted(acrossText, { x: (a0.x + a1.x) / 2 + beyond.x * 10, y: (a0.y + a1.y) / 2 + beyond.y * 10 }, { x: a1.x - a0.x, y: a1.y - a0.y }));
		} else {
			ok = false;
		}
		ok &&= labels.every((l, i) => within(l.box) && !taken.some((b) => hits(b, l.box)) && labels.slice(i + 1).every((o) => labelOverlap(l.box, o.box) === 0));
		if (!ok) {
			continue;
		}
		const tick = (q: Vec, d: Vec): string => `M${num(q.x - d.x * 5)} ${num(q.y - d.y * 5)}L${num(q.x + d.x * 5)} ${num(q.y + d.y * 5)}`;
		const solid = [pathOf([line[0]!, line.at(-1)!]), ...line.map((q) => tick(q, out)), pathOf([a0, a1]), tick(a0, beyond), tick(a1, beyond)];
		const dashed = [...xs.map((x) => pathOf([at(x, 0), at(x, side * (off - 5 / s))])), pathOf([at(row.across.at, toNumber(row.across.from)), a0]), pathOf([at(row.across.at, toNumber(row.across.to)), a1])];
		return { solid, dashed, labels };
	}
	return null;
}
