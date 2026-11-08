// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { getLocation, InvalidKdlError, parse as parseKdl, type Document, type Node } from "@bgotink/kdl";
import { withoutMisreadHex } from "./hex.js";
import { foldFacets, foldShape } from "./fold.js";
import { boundary, offsetPolygon } from "./geometry.js";
import { addSize, inLimits, layersHeight, layersSize, maxCopies, maxSize, waves } from "./limits.js";
import { canonical, sanitizeSvg, usesCurrentColor } from "./sanitize.js";
import { asciiLower, decimalForm, dict, formatNumber, hash, numbersIn } from "./text.js";
import type {
	Adapt, AdaptRule, Adaptation, Anchor, Axis, BandLayer, BarsLayer, BlendMode, Border, Box, ChargeLayer, ChecksLayer, ChevronsLayer,
	ColorRef, CornerName, CrossLayer, Define, EdgeName, Effects, EmblemLayer, EmbeddedSvg, FieldLayer, Fimbriation, Flag, Fold, FoldStep,
	Gradient, GroupLayer, Layer, Meta, Outline, PanelLayer, Point, Problem, QuartersLayer, RaysLayer, RayOrigin, Reference, Repeat, Reverse,
	SaltireLayer, Shape, ShapedEdge, Turn, UseLayer, Variant,
} from "./types.js";

/** The format version this library reads. */
export const formatVersion = 1;

const maxDepth = 32;
/** In a color list this leaves a gap, and it can't be a palette name. */
const noColor = "none";

const colorValue = /^#[0-9a-fA-F]{6}$/;
const seriesValue = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const alongValues = ["fly", "hoist", "bend", "bend-sinister"];
const fromValues = ["hoist", "fly", "top", "bottom"];
const blendValues = ["normal", "multiply", "screen", "overlay", "darken", "lighten"];
const anchorValues = ["start", "center", "end", "scale"];
const cornerValues = ["upper-hoist", "upper-fly", "lower-hoist", "lower-fly"];
const rayFromNames = ["center", "hoist", "fly", "top", "bottom", ...cornerValues];
const shapeKinds = ["disc", "ring", "rect", "plus", "triangle", "star", "heart", "cardioid", "polygon", "crescent", "sun", "lozenge", "ellipse", "path"];
const viewValues = ["none", "rotate", "counter-rotate", "half-turn", "transpose", "anti-transpose", "invert", "mirror"];
const modeValues = ["extend", "center", "scale", "hoist-extend", "hoist-center", "hoist-scale"];

// These put no conditions on a work, so a file that adapts one can license its renders however it likes.
const freeLicenses = new Set(["CC0-1.0", "LicenseRef-Public-Domain"]);

type Handler = (c: Node) => void;
type Handlers = Record<string, Handler>;
type KdlValue = string | number | boolean | null;

/** A shape while it's being read, when not all of what it needs has been seen. */
interface ShapeDraft {
	kind: string;
	/** Records an explicit `at`, even `at center`. */
	placed?: boolean;
	/** Record values worked out from the shape's others, which change if a charge using a definition changes those. */
	autoInner?: boolean;
	autoSpread?: boolean;
	at?: Point | undefined;
	ats?: (Point | null)[] | undefined;
	rotate?: number;
	hollow?: number;
	radius?: number;
	inner?: number;
	points?: number;
	width?: number;
	spread?: number;
	arc?: { from: number; to: number };
	offset?: number;
	disc?: number;
	gap?: number;
	lines?: number;
	d?: string;
	box?: Box;
	evenodd?: boolean;
	from?: string;
	base?: [number, number];
	tip?: [number, number];
	depth?: number;
	flat?: number;
	junction?: number;
	fly?: number;
	hoist?: number;
	vertices?: Point[];
	markup?: string;
	embedded?: EmbeddedSvg;
}

const args = (n: Node): KdlValue[] => n.getArguments() as KdlValue[];
const propNames = (n: Node): string[] => n.getPropertyEntries().map((e) => e.getName()!);
const propValue = (n: Node, key: string): KdlValue | undefined => n.getProperty(key) as KdlValue | undefined;
const childNodes = (n: Node): Node[] => n.children?.nodes ?? [];
const has = (handlers: Handlers, name: string): boolean => Object.hasOwn(handlers, name);

function newEffects(): Effects {
	return { opacity: 1, blend: "normal", cuts: [] };
}

const pathNumber = new RegExp(`^${decimalForm}`);
const pathArguments: ReadonlyMap<string, number> = new Map([["M", 2], ["L", 2], ["H", 1], ["V", 1], ["C", 6], ["S", 4], ["Q", 4], ["T", 2], ["A", 7], ["Z", 0]]);

/**
 * Checks a path against SVG's grammar for path data, within the format's limits on numbers, so that
 * a bad one can't silently draw part of a shape or nothing.
 */
export function validPath(d: string): boolean {
	let i = 0;
	const space = (): void => {
		while (i < d.length && " \t\n\f\r".includes(d[i]!)) {
			i++;
		}
	};
	/** Skips whitespace and at most one comma, and says if there was a comma. */
	const separator = (): boolean => {
		space();
		if (d[i] === ",") {
			i++;
			space();
			return true;
		}
		return false;
	};
	const number = (): boolean => {
		// A window keeps this from copying the rest of a long path, unless the number fills it.
		let m = pathNumber.exec(d.slice(i, i + 64));
		if (m !== null && m[0].length === 64) {
			m = pathNumber.exec(d.slice(i));
		}
		if (m === null || Math.abs(Number(m[0])) > 1e12) {
			return false;
		}
		i += m[0].length;
		return true;
	};
	space();
	if (d[i] !== "M" && d[i] !== "m") {
		return false;
	}
	while (i < d.length) {
		const c = d[i]!.toUpperCase();
		const count = pathArguments.get(c);
		if (count === undefined) {
			return false;
		}
		i++;
		space();
		// A command can repeat its arguments with no letter, except for Z, which has none.
		for (let first = true; count > 0 && (first || (i < d.length && !"MmLlHhVvCcSsQqTtAaZz".includes(d[i]!))); first = false) {
			for (let arg = 0; arg < count; arg++) {
				if (c === "A" && (arg === 3 || arg === 4)) {
					if (d[i] !== "0" && d[i] !== "1") {
						return false;
					}
					i++;
				} else if (!number()) {
					return false;
				}
				if (arg < count - 1) {
					separator();
				}
			}
			if (separator() && (i >= d.length || "MmLlHhVvCcSsQqTtAaZz".includes(d[i]!))) {
				return false;
			}
		}
		space();
	}
	return true;
}

/** Finds where something is, as SDK section 2 says to: lines end at LF, and a column counts code points. */
function place(source: string, offset: number): { line: number; column: number } {
	const before = source.slice(0, offset);
	const start = before.lastIndexOf("\n") + 1;
	let line = 1;
	for (let i = before.indexOf("\n"); i >= 0; i = before.indexOf("\n", i + 1)) {
		line++;
	}
	return { line, column: [...before.slice(start)].length + 1 };
}

function validDate(text: string): boolean {
	const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text);
	if (m === null) {
		return false;
	}
	if (m[2] === undefined) {
		return true;
	}
	const year = Number(m[1]);
	const month = Number(m[2]);
	if (month < 1 || month > 12) {
		return false;
	}
	if (m[3] === undefined) {
		return true;
	}
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
	const day = Number(m[3]);
	return day >= 1 && day <= days;
}

/** Reads a Vexyl document, giving every problem found in it, or its flag. */
export function read(text: string, name?: string): { flag?: Flag; problems: Problem[] } {
	// A document means the same however its lines end.
	const source = text.replace(/\r\n?/g, "\n");
	let doc: Document;
	try {
		doc = parseKdl(withoutMisreadHex(source), { storeLocations: true });
	} catch (e) {
		if (e instanceof InvalidKdlError) {
			return { problems: syntaxProblems(e, source, name) };
		}
		throw e;
	}
	const duplicates = duplicateProperties(doc, source, name);
	if (duplicates.length > 0) {
		return { problems: duplicates };
	}
	const p = new Parser(`vx-${hash(source)}-`, source, name);
	const flag = p.document(doc);
	return p.problems.length > 0 ? { problems: p.problems } : { flag, problems: [] };
}

function syntaxProblems(e: InvalidKdlError, source: string, name?: string): Problem[] {
	const problems: Problem[] = [];
	for (const one of e.flat()) {
		const problem: Problem = { message: one.message };
		if (name !== undefined) {
			problem.source = name;
		}
		if (one.start !== undefined) {
			Object.assign(problem, place(source, one.start.offset));
		}
		problems.push(problem);
	}
	return problems.length > 0 ? problems : [{ message: e.message }];
}

/** KDL lets a later property win, and for a flag's exact numbers that would hide a mistake. */
function duplicateProperties(doc: Document, source: string, name?: string): Problem[] {
	const problems: Problem[] = [];
	const visit = (nodes: Node[]): void => {
		for (const n of nodes) {
			const seen = new Set<string>();
			for (const key of propNames(n)) {
				if (seen.has(key)) {
					const at = getLocation(n)?.start;
					const problem: Problem = { message: `property "${key}" is given twice` };
					if (name !== undefined) {
						problem.source = name;
					}
					if (at !== undefined) {
						Object.assign(problem, place(source, at.offset));
					}
					problem.node = n.getName();
					problems.push(problem);
				}
				seen.add(key);
			}
			visit(childNodes(n));
		}
	};
	visit(doc.nodes);
	return problems;
}

const stageVersion = 0;
const stageMeta = 1;
const stagePalette = 2;
const stageProportion = 3;
const stageOutline = 4;
const stageBorder = 5;
const stageDefine = 6;
const stageLayers = 7;
const stageReverse = 8;
const stageAdapt = 9;
const stageVariant = 10;
const stageFold = 11;

const stages: ReadonlyMap<string, number> = new Map([
	["vexyl", stageVersion], ["meta", stageMeta], ["palette", stagePalette], ["proportion", stageProportion],
	["outline", stageOutline], ["border", stageBorder], ["define", stageDefine],
	["reverse", stageReverse], ["adapt", stageAdapt], ["variant", stageVariant], ["fold", stageFold],
]);

class Parser {
	readonly problems: Problem[] = [];
	private readonly idPrefix: string;
	private readonly source: string;
	private readonly name: string | undefined;
	private defines: Record<string, Define> = dict();
	private palette: Record<string, string> = dict();
	private gradients: Record<string, Gradient> = dict();
	/** Lets a gradient's colors recognize other gradients, since they're defined one at a time. */
	private gradientNames: string[] = [];
	/** What the flag has painted so far, as section 15 of the format counts it. */
	private size = 0;
	/** The longer side of the flag's own grid, for counting shaped edges. */
	private longer = 0;

	constructor(idPrefix: string, source: string, name?: string) {
		this.idPrefix = idPrefix;
		this.source = source;
		this.name = name;
	}

	private errf(n: Node, message: string): void {
		const at = getLocation(n)?.start;
		const problem: Problem = { message, node: n.getName() };
		if (this.name !== undefined) {
			problem.source = this.name;
		}
		if (at !== undefined) {
			Object.assign(problem, place(this.source, at.offset));
		}
		this.problems.push(problem);
	}

	/** Walks the top level, whose nodes have a fixed order. */
	document(doc: Document): Flag {
		const flag: Flag = {
			version: 0,
			meta: { name: "", notes: [], laws: [], restrictions: [], designers: [], encoders: [], adaptedFrom: [], sources: [] },
			palette: dict(),
			colorRefs: dict(),
			gradients: dict(),
			hoist: 0,
			fly: 0,
			defines: this.defines,
			layers: [],
			variants: dict(),
			folds: dict(),
			idPrefix: this.idPrefix,
		};
		let stage = -1;
		const seen = new Set<number>();
		this.prepare(doc.nodes);
		for (const n of doc.nodes) {
			const name = n.getName();
			const s = stages.get(name) ?? stageLayers;
			if (s < stage || (s === stage && s !== stageLayers && s !== stageDefine && s !== stageVariant && s !== stageFold)) {
				this.errf(n, "out of order or repeated");
				continue;
			}
			if (s > stageVersion && stage < stageVersion) {
				const at = getLocation(n)?.start;
				const problem: Problem = { message: `document must start with \`vexyl ${formatVersion}\`` };
				if (at !== undefined) {
					Object.assign(problem, place(this.source, at.offset));
				}
				this.problems.push(problem);
				return flag;
			}
			stage = s;
			seen.add(s);
			switch (name) {
				case "vexyl":
					if (this.number(n) !== formatVersion) {
						this.errf(n, `unsupported format version; this renderer reads ${formatVersion}`);
						return flag;
					}
					flag.version = formatVersion;
					break;
				case "meta":
					this.meta(n, flag.meta);
					break;
				case "palette":
					this.paletteNode(n, flag);
					break;
				case "proportion":
					this.proportion(n, flag);
					break;
				case "outline": {
					const outline = this.outline(n);
					if (outline !== undefined) {
						flag.outline = outline;
					}
					break;
				}
				case "border": {
					const border = this.border(n);
					if (border !== undefined) {
						flag.border = border;
						this.checkOutside(n, flag.outline, flag.fly, flag.hoist, border);
					}
					break;
				}
				case "define":
					this.define(n);
					break;
				case "reverse":
					this.reverse(n, flag);
					break;
				case "adapt":
					this.adapt(n, flag);
					break;
				case "variant":
					this.variant(n, flag);
					break;
				case "fold":
					this.fold(n, flag);
					break;
				default: {
					if (flag.fly === 0 && flag.hoist === 0) {
						this.errf(n, "layers must follow `proportion`");
						return flag;
					}
					const layer = this.layer(n, 1);
					if (layer !== null) {
						flag.layers.push(layer);
						this.count(n, [layer]);
					}
				}
			}
		}
		if (!seen.has(stageVersion)) {
			this.problems.push({ message: `document must start with \`vexyl ${formatVersion}\`` });
		}
		for (const [stageNeeded, needed] of [[stageMeta, "meta"], [stagePalette, "palette"], [stageProportion, "proportion"]] as const) {
			if (!seen.has(stageNeeded)) {
				this.problems.push({ message: `document needs \`${needed}\`` });
			}
		}
		for (const [name, v] of Object.entries(flag.variants)) {
			if (v.ratio !== undefined && v.ratio !== 0 && flag.adapt === undefined) {
				this.problems.push({ message: `variant "${name}" has a \`ratio\`, but the flag has no \`adapt\` rules` });
			}
		}
		if (flag.fly > 0 && flag.hoist > 0 && this.problems.length === 0) {
			for (const [name, fold] of Object.entries(flag.folds)) {
				try {
					foldFacets(foldShape(flag), fold, 0);
				} catch (e) {
					this.problems.push({ message: `fold "${name}": ${(e as Error).message}` });
				}
			}
		}
		return flag;
	}

	/**
	 * Adds what a top-level node paints to the flag's size, and refuses the node that takes it past
	 * the limit, so that a document can't demand unbounded work.
	 */
	private count(n: Node, layers: Layer[]): void {
		const was = this.size;
		this.size = addSize(this.size, layersSize(layers, this.longer));
		if (was <= maxSize && this.size > maxSize) {
			this.errf(n, `paints too much: a flag can only come to ${maxSize} parts`);
		}
	}

	private meta(n: Node, m: Meta): void {
		this.noValues(n);
		this.children(n, ["designer", "encoder", "source", "note", "law", "restriction", "adapted-from"], {
			name: (c) => { m.name = this.str(c); },
			description: (c) => { m.description = this.str(c); },
			version: (c) => { m.version = this.str(c); },
			date: (c) => {
				m.date = this.str(c);
				if (m.date !== "" && !validDate(m.date)) {
					this.errf(c, `must be YYYY, YYYY-MM or YYYY-MM-DD, got "${m.date}"`);
				}
			},
			until: (c) => {
				m.until = this.str(c);
				if (m.until !== "" && !validDate(m.until)) {
					this.errf(c, `must be YYYY, YYYY-MM or YYYY-MM-DD, got "${m.until}"`);
				}
			},
			series: (c) => {
				m.series = this.str(c);
				if (m.series !== "" && !seriesValue.test(m.series)) {
					this.errf(c, `must be lowercase words joined by hyphens, got "${m.series}"`);
				}
			},
			note: (c) => { m.notes.push(this.str(c)); },
			law: (c) => {
				const r = this.reference(c);
				if (r !== null) {
					m.laws.push(r);
				}
			},
			restriction: (c) => {
				const r = this.reference(c);
				if (r !== null) {
					if (r.sources.length === 0) {
						this.errf(c, "needs a `source`, since an unsourced legal claim can mislead");
					}
					m.restrictions.push(r);
				}
			},
			designer: (c) => { m.designers.push(this.str(c)); },
			"design-rights": (c) => { m.designRights = this.str(c); },
			encoder: (c) => { m.encoders.push(this.str(c)); },
			license: (c) => { m.license = this.str(c); },
			"render-license": (c) => { m.renderLicense = this.str(c); },
			"adapted-from": (c) => {
				const a = this.adaptation(c);
				if (a !== null) {
					m.adaptedFrom.push(a);
				}
			},
			source: (c) => { m.sources.push(this.str(c)); },
		});
		if (m.renderLicense) {
			for (const a of m.adaptedFrom) {
				const license = a.license ?? "";
				if (license !== m.renderLicense && !freeLicenses.has(license)) {
					this.errf(n, `\`render-license\` "${m.renderLicense}" can't cover work adapted from ${a.url} under "${license}"`);
				}
			}
		}
		if (m.name === "") {
			this.errf(n, "needs a `name`");
		}
		if (m.date && m.until) {
			// Each is only known to its own precision, so they compare only as far as both go.
			const shared = Math.min(m.date.length, m.until.length);
			if (m.until.slice(0, shared) < m.date.slice(0, shared)) {
				this.errf(n, "`until` comes before `date`");
			}
		}
	}

	private adaptation(n: Node): Adaptation | null {
		this.noProps(n);
		const a0 = args(n);
		const url = a0[0];
		if (a0.length !== 1 || typeof url !== "string") {
			this.errf(n, "needs the URL of the original work");
			return null;
		}
		const a: Adaptation = { url, authors: [] };
		this.children(n, ["author"], {
			author: (c) => { a.authors.push(this.str(c)); },
			license: (c) => { a.license = this.str(c); },
			part: (c) => { a.part = this.str(c); },
		});
		return a;
	}

	private paletteNode(n: Node, flag: Flag): void {
		this.noValues(n);
		this.palette = flag.palette;
		this.gradients = flag.gradients;
		// Gradients can name colors defined after them, so they're read second.
		const gradients: Node[] = [];
		const seen = new Set<string>();
		for (const c of childNodes(n)) {
			const name = c.getName();
			if (seen.has(name)) {
				this.errf(c, "color defined twice");
				continue;
			}
			if (name === noColor) {
				this.errf(c, `"${noColor}" is reserved for leaving a gap`);
				continue;
			}
			if (name === "") {
				this.errf(c, "a color's name can't be empty");
				continue;
			}
			seen.add(name);
			const a0 = args(c);
			if (a0.length > 0 && a0[0] === "gradient") {
				gradients.push(c);
				continue;
			}
			const value = this.color(c, flag);
			if (!colorValue.test(value)) {
				this.errf(c, `color must be #rrggbb, got "${value}"`);
			}
			// Either case means the same, so the model has only one.
			flag.palette[name] = asciiLower(value);
		}
		for (const c of gradients) {
			this.gradientNames.push(c.getName());
		}
		for (const c of gradients) {
			flag.gradients[c.getName()] = this.gradient(c);
		}
	}

	/** Reads `name gradient COLOR... along=AXIS { stops N... }`. */
	private gradient(n: Node): Gradient {
		const g: Gradient = { colors: [], stops: [], along: "fly" };
		for (const a of args(n).slice(1)) {
			if (typeof a !== "string") {
				this.errf(n, "a gradient's colors must be palette names");
				continue;
			}
			g.colors.push(this.solidColor(n, a));
		}
		if (g.colors.length < 2) {
			this.errf(n, "a gradient needs at least 2 colors");
		}
		for (const key of propNames(n)) {
			if (key !== "along") {
				this.errf(n, `unknown property "${key}"`);
			}
		}
		const along = propValue(n, "along");
		if (along !== undefined) {
			if (typeof along !== "string" || !alongValues.includes(along)) {
				this.errf(n, `along must be one of [${alongValues.join(" ")}]`);
			} else {
				g.along = along as Axis;
			}
		}
		let stops: number[] | undefined;
		this.children(n, [], {
			stops: (c) => { stops = this.stops(c, g.colors.length); },
		});
		g.stops = stops ?? g.colors.map((_, i) => i / Math.max(g.colors.length - 1, 1));
		return g;
	}

	private stops(n: Node, count: number): number[] {
		const stops = this.numbers(n);
		if (stops.length !== count) {
			this.errf(n, `has ${count} colors but ${stops.length} stops`);
		}
		stops.forEach((s, i) => {
			if (s < 0 || s > 1) {
				this.errf(n, "stops must be between 0 and 1");
			}
			if (i > 0 && s < stops[i - 1]!) {
				this.errf(n, "stops can't run backward");
			}
		});
		return stops;
	}

	private proportion(n: Node, flag: Flag): void {
		this.only(n, 0, ["hoist", "fly"]);
		flag.hoist = this.positive(n, this.prop(n, "hoist"));
		flag.fly = this.positive(n, this.prop(n, "fly"));
		this.longer = Math.max(flag.hoist, flag.fly);
		this.noChildren(n);
	}

	private layer(n: Node, depth: number): Layer | null {
		if (depth > maxDepth) {
			this.errf(n, `nested more than ${maxDepth} levels deep`);
			return null;
		}
		switch (n.getName()) {
			case "field": {
				const l: FieldLayer = { layer: "field", ...newEffects(), color: this.colorArg(n) };
				this.noProps(n);
				this.children(n, ["cut"], this.withEffects(l, {}));
				return l;
			}
			case "bars":
				return this.bars(n);
			case "chevrons":
				return this.chevrons(n);
			case "band":
				return this.band(n);
			case "cross":
				return this.cross(n);
			case "saltire":
				return this.saltire(n);
			case "charge":
				return this.charge(n);
			case "quarters":
				return this.quarters(n);
			case "checks":
				return this.checks(n);
			case "rays":
				return this.rays(n);
			case "pile":
			case "pall":
				return this.ordinaryShape(n);
			case "panel":
				return this.panel(n, depth);
			case "use":
				return this.use(n, depth);
			case "emblem":
				return this.emblem(n);
			case "group": {
				const l: GroupLayer = { layer: "group", ...newEffects(), layers: [] };
				this.noValues(n);
				this.container(n, depth, l, l.layers, {});
				if (l.layers.length === 0) {
					this.errf(n, "needs at least one layer");
				}
				return l;
			}
			case "canton": {
				const l: PanelLayer = { layer: "panel", ...newEffects(), corner: "upper-hoist", layers: [], canton: true };
				this.noValues(n);
				this.container(n, depth, l, l.layers, {
					fly: (c) => { l.fly = this.positive(c, this.number(c)); },
					hoist: (c) => { l.hoist = this.positive(c, this.number(c)); },
				});
				if (!l.fly || !l.hoist) {
					this.errf(n, "needs `fly` and `hoist`");
				}
				if (l.layers.length === 0) {
					this.errf(n, "needs at least one layer");
				}
				return l;
			}
		}
		this.errf(n, "unknown layer");
		return null;
	}

	/** Reads a group, canton or panel, whose children mix settings and layers. */
	private container(n: Node, depth: number, e: Effects, layers: Layer[], settings: Handlers): void {
		const handlers = this.withEffects(e, settings);
		const seen = new Set<string>();
		for (const c of childNodes(n)) {
			const name = c.getName();
			if (!has(handlers, name)) {
				const l = this.layer(c, depth + 1);
				if (l !== null) {
					layers.push(l);
				}
				continue;
			}
			if (seen.has(name) && name !== "cut") {
				this.errf(c, "given more than once");
			}
			seen.add(name);
			handlers[name]!(c);
		}
	}

	private withEffects(e: Effects, handlers: Handlers): Handlers {
		return {
			opacity: (c) => {
				e.opacity = this.number(c);
				if (e.opacity < 0 || e.opacity > 1) {
					this.errf(c, "must be between 0 and 1");
				}
			},
			blend: (c) => { e.blend = this.oneOf(c, blendValues) as BlendMode; },
			anchor: (c) => { e.anchor = this.oneOf(c, anchorValues) as Anchor; },
			clip: (c) => {
				const s = this.maskShape(c);
				if (s !== null) {
					e.clip = s;
				}
			},
			cut: (c) => {
				const s = this.maskShape(c);
				if (s !== null) {
					e.cuts.push(s);
				}
			},
			...handlers,
		};
	}

	/** Reads the single shape inside a clip or cut. */
	private maskShape(n: Node): Shape | null {
		this.noValues(n);
		const nodes = childNodes(n);
		if (nodes.length !== 1) {
			this.errf(n, "needs exactly one shape");
			return null;
		}
		const c = nodes[0]!;
		this.noValues(c);
		if (c.getName() === "svg") {
			this.errf(c, "inline SVG can't be used as a clip or cut");
			return null;
		}
		const s = this.namedShape(c.getName());
		this.shapeBody(c, s, null);
		if ((s.hollow ?? 0) > 0 || (s.lines ?? 0) > 0) {
			this.errf(c, "a clip or cut uses a shape's whole area, so it can't be `hollow` or `lines`");
		}
		return finishShape(s);
	}

	/** Starts a shape of a kind, or from a definition of that name. */
	private namedShape(name: string): ShapeDraft {
		const d = this.defines[name];
		if (d?.shape !== undefined) {
			return { ...(d.shape as ShapeDraft) };
		}
		return { kind: name };
	}

	private bars(n: Node): Layer {
		const l: BarsLayer = { layer: "bars", ...newEffects(), colors: this.gapColorArgs(n), along: "fly", ratio: [], rotate: 0 };
		this.noProps(n);
		let count = 0;
		let ratio: number[] | undefined;
		this.children(n, ["cut"], this.withEffects(l, {
			along: (c) => { l.along = this.oneOf(c, alongValues) as Axis; },
			ratio: (c) => { ratio = this.positives(c); },
			rotate: (c) => { l.rotate = this.number(c); },
			count: (c) => { count = this.integer(c, this.number(c), maxCopies); },
			grow: (c) => { l.grow = this.numbers(c); },
			edge: (c) => {
				const line = this.line(c);
				if (line !== null) {
					l.edge = line;
				}
			},
		}));
		if (l.colors.length === 0) {
			return l;
		}
		l.colors = this.cycle(n, l.colors, count);
		this.checkWaves(n, l.edge);
		l.ratio = this.ratio(n, ratio, l.colors.length);
		if (l.grow !== undefined && l.grow.length !== l.colors.length) {
			this.errf(n, `has ${l.colors.length} colors but ${l.grow.length} \`grow\` values`);
		}
		for (const g of l.grow ?? []) {
			if (g < 0) {
				this.errf(n, "`grow` can't be negative");
			}
		}
		if (l.grow !== undefined && l.rotate !== 0) {
			this.errf(n, "a rotated bars keeps its widths at other proportions, so it takes no `grow`");
		}
		return l;
	}

	private chevrons(n: Node): Layer {
		const l: ChevronsLayer = { layer: "chevrons", ...newEffects(), colors: this.gapColorArgs(n), from: "hoist", depth: 0, ratio: [], rotate: 0 };
		this.noProps(n);
		let ratio: number[] | undefined;
		this.children(n, ["cut"], this.withEffects(l, {
			from: (c) => { l.from = this.oneOf(c, fromValues) as EdgeName; },
			depth: (c) => { l.depth = this.positive(c, this.number(c)); },
			angle: (c) => {
				l.angle = this.number(c);
				if (l.angle <= 0 || l.angle >= 90) {
					this.errf(c, "must be between 0 and 90 degrees, exclusive");
				}
			},
			apex: (c) => {
				const apex = this.number(c);
				if (apex < 0) {
					this.errf(c, "can't be negative");
				}
				l.apex = apex;
			},
			ratio: (c) => { ratio = this.positives(c); },
			rotate: (c) => { l.rotate = this.number(c); },
			fimbriate: (c) => this.setFimbriate(l, c),
		}));
		if (l.depth === 0) {
			this.errf(n, "needs a `depth`");
		}
		if (l.apex !== undefined && !l.angle) {
			this.errf(n, "an off-center `apex` needs an `angle`, since its arms can't meet both corners at one slope");
		}
		l.ratio = this.ratio(n, ratio, l.colors.length);
		return l;
	}

	private setFimbriate(l: { fimbriate?: Fimbriation }, c: Node): void {
		const edge = this.edge(c);
		if (edge !== null) {
			l.fimbriate = edge;
		} else {
			delete l.fimbriate;
		}
	}

	private checkWaves(n: Node, l: ShapedEdge | undefined): void {
		if (l !== undefined && waves(l, this.longer) > maxCopies) {
			this.errf(n, `a shaped edge can't have more than ${maxCopies} waves`);
		}
	}

	private ratio(n: Node, ratio: number[] | undefined, count: number): number[] {
		const out = ratio ?? new Array<number>(count).fill(1);
		if (out.length !== count) {
			this.errf(n, `has ${count} colors but a ratio of ${out.length} values`);
		}
		return out;
	}

	private band(n: Node): Layer {
		const l: BandLayer = { layer: "band", ...newEffects(), color: this.colorArg(n), along: "fly", width: 0, offset: 0, rotate: 0 };
		this.noProps(n);
		this.children(n, ["cut"], this.withEffects(l, {
			along: (c) => { l.along = this.oneOf(c, alongValues) as Axis; },
			width: (c) => { l.width = this.positive(c, this.number(c)); },
			offset: (c) => { l.offset = this.number(c); },
			rotate: (c) => { l.rotate = this.number(c); },
			fimbriate: (c) => this.setFimbriate(l, c),
		}));
		if (l.width === 0) {
			this.errf(n, "needs a `width`");
		}
		return l;
	}

	private cross(n: Node): Layer {
		const l: CrossLayer = { layer: "cross", ...newEffects(), color: this.colorArg(n), fly: [0, 0, 0], hoist: [0, 0, 0] };
		this.noProps(n);
		let seenFly = false;
		let seenHoist = false;
		this.children(n, ["cut"], this.withEffects(l, {
			fly: (c) => { l.fly = this.triple(c); seenFly = true; },
			hoist: (c) => { l.hoist = this.triple(c); seenHoist = true; },
			fimbriate: (c) => this.setFimbriate(l, c),
		}));
		if (!seenFly || !seenHoist) {
			this.errf(n, "needs `fly` and `hoist`");
		}
		return l;
	}

	/** Reads the distance before an arm, its width and the distance after. */
	private triple(n: Node): [number, number, number] {
		const v = this.numbers(n);
		if (v.length !== 3) {
			this.errf(n, "needs 3 values: before the arm, its width, and after it");
			return [0, 1, 0];
		}
		if (v[0]! < 0 || v[1]! <= 0 || v[2]! < 0) {
			this.errf(n, "the arm's width must be positive and its distances not negative");
			return [0, 1, 0];
		}
		return [v[0]!, v[1]!, v[2]!];
	}

	private saltire(n: Node): Layer {
		const l: SaltireLayer = { layer: "saltire", ...newEffects(), color: this.colorArg(n), width: 0, counterchange: false };
		this.noProps(n);
		this.children(n, ["cut"], this.withEffects(l, {
			width: (c) => { l.width = this.positive(c, this.number(c)); },
			fimbriate: (c) => this.setFimbriate(l, c),
			counterchange: (c) => { l.counterchange = this.flagValue(c); },
		}));
		if (l.width === 0) {
			this.errf(n, "needs a `width`");
		}
		if (l.counterchange && l.fimbriate !== undefined) {
			this.errf(n, "a counterchanged saltire can't be fimbriated");
		}
		return l;
	}

	private charge(n: Node): Layer | null {
		const a0 = args(n);
		this.noProps(n);
		const shapeName = a0[0];
		if (a0.length === 0 || typeof shapeName !== "string") {
			this.errf(n, "needs a shape");
			return null;
		}
		if (shapeName === "pile" || shapeName === "pall") {
			this.errf(n, `a ${shapeName} is a layer of its own, not a charge's shape`);
			return null;
		}
		const s = this.namedShape(shapeName);
		const l: ChargeLayer = { layer: "charge", ...newEffects(), shape: s as unknown as Shape };
		if (s.kind === "svg" && a0.length === 1) {
			// Inline SVG can bring its own colors.
		} else if (a0.length !== 2) {
			this.errf(n, "needs a shape and a color");
			return null;
		} else if (typeof a0[1] !== "string") {
			this.errf(n, "color must be a palette name");
			return null;
		} else if (s.kind === "svg") {
			l.color = this.solidColor(n, a0[1]);
		} else {
			l.color = this.paletteColor(n, a0[1]);
		}
		this.shapeBody(n, s, this.withEffects(l, {
			fimbriate: (c) => this.setFimbriate(l, c),
			repeat: (c) => {
				const r = this.repeat(c);
				if (r !== null) {
					l.repeat = r;
				}
			},
		}));
		const positions = s.ats?.length ?? 0;
		if (s.embedded !== undefined && l.color === undefined && usesCurrentColor(s.embedded)) {
			this.errf(n, "inline SVG uses currentColor, so it needs a palette color");
		} else if (s.kind === "svg" && l.fimbriate !== undefined) {
			this.errf(n, "inline SVG can't be fimbriated");
		} else if (l.fimbriate !== undefined && ((s.hollow ?? 0) > 0 || (s.lines ?? 0) > 0)) {
			this.errf(n, "fimbriation edges a filled shape, so it can't go with `hollow` or `lines`");
		} else if (s.kind === "svg" && l.repeat !== undefined) {
			this.errf(n, "inline SVG can't be repeated");
		} else if (s.kind === "polygon" && l.repeat !== undefined) {
			this.errf(n, "a polygon can't be repeated");
		} else if (l.repeat !== undefined && positions > 1) {
			this.errf(n, "several positions and a repeat can't be combined");
		} else if (s.kind === "svg" && positions > 1) {
			this.errf(n, "inline SVG can't be repeated");
		} else if (l.repeat?.kind === "grid" && s.placed) {
			this.errf(n, "a grid repeat spreads across the region, so it can't have `at`");
		}
		l.shape = finishShape(s);
		return l;
	}

	private emblem(n: Node): Layer {
		const l: EmblemLayer = { layer: "emblem", ...newEffects(), rotate: 0, charges: [] };
		this.noValues(n);
		const placed = this.withEffects(l, {
			at: (c) => {
				const at = this.at(c);
				if (at !== null) {
					l.at = at;
				} else {
					delete l.at;
				}
			},
			along: (c) => { l.along = this.oneOf(c, alongValues) as Axis; },
			rotate: (c) => { l.rotate = this.number(c); },
		});
		const seen = new Set<string>();
		for (const c of childNodes(n)) {
			const name = c.getName();
			if (name === "charge") {
				const charge = this.layer(c, 1);
				if (charge !== null) {
					const held = charge as ChargeLayer;
					if (held.repeat?.kind === "grid") {
						this.errf(c, "a grid repeat needs a region, which an emblem doesn't have");
					}
					this.frameShape(c, held.shape);
					if (held.clip !== undefined) {
						this.frameShape(c, held.clip);
					}
					for (const cut of held.cuts) {
						this.frameShape(c, cut);
					}
					l.charges.push(held);
				}
				continue;
			}
			if (!has(placed, name)) {
				this.errf(c, "an emblem can only hold charges");
				continue;
			}
			if (seen.has(name) && name !== "cut") {
				this.errf(c, "given more than once");
			}
			seen.add(name);
			placed[name]!(c);
		}
		if (l.charges.length === 0) {
			this.errf(n, "needs at least one charge");
		}
		return l;
	}

	/** Refuses what needs a region's size, which an emblem's frame doesn't have. */
	private frameShape(n: Node, s: Shape): void {
		if (s.kind === "lozenge" && (!s.fly || !s.hoist)) {
			this.errf(n, "a lozenge in an emblem needs `fly` and `hoist`, since a frame has no size to take");
		} else if (s.kind === "pile" || s.kind === "pall") {
			this.errf(n, `a ${s.kind} needs a region's edges, which an emblem doesn't have`);
		}
	}

	private repeat(n: Node): Repeat | null {
		this.noChildren(n);
		const a0 = args(n);
		const kind = a0[0];
		if (a0.length !== 1 || typeof kind !== "string") {
			this.errf(n, "needs a kind: ring or grid");
			return null;
		}
		switch (kind) {
			case "ring": {
				this.only(n, 1, ["count", "radius", "turn"]);
				return {
					kind,
					count: this.integer(n, this.prop(n, "count"), maxCopies),
					radius: this.positive(n, this.prop(n, "radius")),
					turn: this.boolProp(n, "turn"),
				};
			}
			case "grid": {
				this.only(n, 1, ["rows", "columns", "stagger"]);
				const rows = this.integer(n, this.prop(n, "rows"), maxCopies);
				const columns = this.integer(n, this.prop(n, "columns"), maxCopies);
				const stagger = this.boolProp(n, "stagger");
				if (rows * columns > maxCopies) {
					this.errf(n, `makes more than ${maxCopies} copies`);
				}
				return { kind, rows, columns, stagger };
			}
			case "line": {
				this.only(n, 1, ["count", "fly", "hoist"]);
				const count = this.integer(n, this.prop(n, "count"), maxCopies);
				const flyValue = propValue(n, "fly");
				const fly = flyValue !== undefined ? this.numberValue(n, flyValue) : 0;
				const hoistValue = propValue(n, "hoist");
				const hoist = hoistValue !== undefined ? this.numberValue(n, hoistValue) : 0;
				if (fly === 0 && hoist === 0) {
					this.errf(n, "needs a step: fly= or hoist=");
				}
				return { kind, count, fly, hoist };
			}
			case "arc": {
				this.only(n, 1, ["count", "radius", "turn", "from", "to"]);
				const count = this.integer(n, this.prop(n, "count"), maxCopies);
				const radius = this.positive(n, this.prop(n, "radius"));
				const turn = this.boolProp(n, "turn");
				const from = this.prop(n, "from");
				const to = this.prop(n, "to");
				if (count < 2 && count !== 0) {
					this.errf(n, "an arc needs at least 2 copies");
				}
				if (propValue(n, "from") !== undefined && propValue(n, "to") !== undefined && (to - from) % 360 === 0) {
					this.errf(n, "`from` and `to` are the same place, so there's no arc to repeat along");
				}
				return { kind, count, radius, turn, from, to };
			}
		}
		this.errf(n, `unknown repeat "${kind}"`);
		return null;
	}

	/** Repeats colors until there are count of them, if count is given. Fewer would drop colors without a word. */
	private cycle(n: Node, colors: string[], count: number): string[] {
		if (count === 0) {
			return colors;
		}
		if (count < colors.length) {
			this.errf(n, `has ${colors.length} colors but a \`count\` of ${count}, which would leave some out`);
			return colors;
		}
		return Array.from({ length: count }, (_, i) => colors[i % colors.length]!);
	}

	/** Reads a shape's children, along with any extra handlers. */
	private shapeBody(n: Node, s: ShapeDraft, extra: Handlers | null): void {
		const handlers: Handlers = {
			at: (c) => {
				const at = this.at(c);
				if (!s.placed) {
					s.at = at ?? undefined;
				}
				s.placed = true;
				(s.ats ??= []).push(at);
			},
			rotate: (c) => { s.rotate = this.number(c); },
			hollow: (c) => { s.hollow = this.positive(c, this.number(c)); },
		};
		s.placed = false;
		s.ats = undefined;
		// What was only worked out from a definition's other values is worked out again.
		if (s.autoInner) {
			delete s.inner;
			s.autoInner = false;
		}
		if (s.autoSpread) {
			delete s.spread;
			s.autoSpread = false;
		}
		const radius: Handler = (c) => { s.radius = this.positive(c, this.number(c)); };
		const inner: Handler = (c) => { s.inner = this.positive(c, this.number(c)); };
		const sizeFly: Handler = (c) => { s.fly = this.positive(c, this.number(c)); };
		const sizeHoist: Handler = (c) => { s.hoist = this.positive(c, this.number(c)); };
		switch (s.kind) {
			case "disc":
			case "triangle":
			case "cardioid":
				handlers.radius = radius;
				break;
			case "crescent":
				handlers.radius = radius;
				handlers.inner = inner;
				handlers.offset = (c) => { s.offset = this.positive(c, this.number(c)); };
				break;
			case "sun":
				s.points ??= 12;
				s.spread ??= 1;
				handlers.radius = radius;
				handlers.disc = (c) => { s.disc = this.positive(c, this.number(c)); };
				handlers.gap = (c) => { s.gap = this.notNegative(c, this.number(c)); };
				handlers.points = (c) => { s.points = this.integer(c, this.number(c), maxCopies); };
				handlers.spread = (c) => { s.spread = this.positive(c, this.number(c)); };
				break;
			case "lozenge":
			case "ellipse":
				handlers.fly = sizeFly;
				handlers.hoist = sizeHoist;
				break;
			case "path":
				handlers.fly = sizeFly;
				handlers.hoist = sizeHoist;
				handlers.d = (c) => { s.d = this.pathData(c); };
				handlers.box = (c) => { s.box = this.boxValue(c, this.str(c)); };
				handlers.evenodd = (c) => { s.evenodd = this.flagValue(c); };
				break;
			case "pile":
				delete handlers.at;
				delete handlers.rotate;
				s.from ??= "hoist";
				handlers.from = (c) => { s.from = this.oneOf(c, fromValues); };
				handlers.base = (c) => {
					const v = this.numbers(c);
					if (v.length === 2) {
						s.base = [v[0]!, v[1]!];
					} else {
						this.errf(c, "needs 2 values: where it starts and ends along the edge");
					}
				};
				handlers.tip = (c) => {
					const v = this.numbers(c);
					if (v.length === 2) {
						s.tip = [v[0]!, v[1]!];
					} else {
						this.errf(c, "needs 2 values: along the edge, then in from it");
					}
				};
				handlers.depth = (c) => { s.depth = this.positive(c, this.number(c)); };
				handlers.flat = (c) => { s.flat = this.notNegative(c, this.number(c)); };
				break;
			case "pall":
				delete handlers.at;
				delete handlers.rotate;
				s.from ??= "hoist";
				handlers.from = (c) => { s.from = this.oneOf(c, fromValues); };
				handlers.width = (c) => { s.width = this.positive(c, this.number(c)); };
				handlers.junction = (c) => { s.junction = this.positive(c, this.number(c)); };
				break;
			case "heart":
				handlers.radius = radius;
				handlers.spread = (c) => { s.spread = this.positive(c, this.number(c)); };
				break;
			case "ring":
				handlers.radius = radius;
				handlers.inner = inner;
				handlers.from = (c) => { s.arc = { from: this.number(c), to: s.arc?.to ?? 0 }; };
				handlers.to = (c) => { s.arc = { from: s.arc?.from ?? 0, to: this.number(c) }; };
				break;
			case "rect":
				handlers.fly = sizeFly;
				handlers.hoist = sizeHoist;
				break;
			case "plus":
				handlers.radius = radius;
				handlers.width = (c) => { s.width = this.positive(c, this.number(c)); };
				break;
			case "star":
				s.points ??= 5;
				handlers.radius = radius;
				handlers.inner = inner;
				handlers.lines = (c) => { s.lines = this.positive(c, this.number(c)); };
				handlers.points = (c) => {
					s.points = this.integer(c, this.number(c), maxCopies);
					if (s.points > 0 && s.points < 3) {
						this.errf(c, "needs at least 3 points");
					}
				};
				break;
			case "polygon":
				delete handlers.at;
				delete handlers.rotate;
				handlers.point = (c) => {
					this.only(c, 0, ["fly", "hoist"]);
					this.noChildren(c);
					(s.vertices ??= []).push({ fly: this.prop(c, "fly"), hoist: this.prop(c, "hoist") });
				};
				break;
			case "svg":
				handlers.fly = sizeFly;
				handlers.hoist = sizeHoist;
				handlers.markup = (c) => { s.markup = this.str(c); };
				break;
			default:
				this.errf(n, `unknown shape "${s.kind}"`);
				return;
		}
		if (extra !== null) {
			Object.assign(handlers, extra);
		}
		const repeatable = ["cut", "point"];
		if (extra !== null) {
			repeatable.push("at");
		}
		if (s.kind === "svg") {
			delete handlers.hollow;
		}
		this.children(n, repeatable, handlers);
		this.checkShape(n, s);
	}

	private checkShape(n: Node, s: ShapeDraft): void {
		const radius = s.radius ?? 0;
		const inner = s.inner ?? 0;
		const fly = s.fly ?? 0;
		const hoist = s.hoist ?? 0;
		if (["disc", "ring", "plus", "triangle", "star", "heart", "cardioid", "crescent", "sun"].includes(s.kind) && radius === 0) {
			this.errf(n, "needs a `radius`");
		}
		switch (s.kind) {
			case "ring":
				if (inner === 0 || inner >= radius) {
					this.errf(n, "needs an `inner` smaller than its `radius`");
				}
				if (s.arc !== undefined && (s.arc.to - s.arc.from) % 360 === 0) {
					this.errf(n, "`from` and `to` are the same place, so there's no arc to draw");
				}
				break;
			case "star": {
				const points = s.points ?? 0;
				if ((s.lines ?? 0) > 0 && (s.hollow ?? 0) > 0) {
					this.errf(n, "`lines` and `hollow` can't be combined");
				}
				if ((s.lines ?? 0) > 0 && points < 5) {
					this.errf(n, "`lines` needs at least 5 points");
				}
				if (inner >= radius && radius > 0) {
					this.errf(n, "`inner` must be smaller than `radius`");
				}
				if (inner === 0 && points < 5) {
					this.errf(n, "needs an `inner` with fewer than 5 points");
				}
				if (inner === 0) {
					s.inner = (radius * Math.cos((2 * Math.PI) / points)) / Math.cos(Math.PI / points);
					s.autoInner = true;
				}
				break;
			}
			case "rect":
			case "ellipse":
				if (fly === 0 || hoist === 0) {
					this.errf(n, "needs `fly` and `hoist`");
				}
				break;
			case "crescent": {
				const offset = s.offset ?? 0;
				if (inner === 0 || offset === 0) {
					this.errf(n, "needs `inner` and `offset`");
				} else if (radius > 0 && (offset >= radius + inner || offset <= Math.abs(radius - inner))) {
					this.errf(n, "`offset` has to make its two circles cross");
				}
				break;
			}
			case "sun": {
				const disc = s.disc ?? 0;
				if (disc === 0) {
					this.errf(n, "needs a `disc`");
				}
				if (radius > 0 && disc + (s.gap ?? 0) >= radius) {
					this.errf(n, "`disc` and `gap` must be smaller than `radius`");
				}
				if ((s.points ?? 0) < 3 && (s.points ?? 0) !== 0) {
					this.errf(n, "needs at least 3 points");
				}
				if ((s.spread ?? 0) > 1) {
					this.errf(n, "`spread` can't be more than 1");
				}
				break;
			}
			case "path": {
				const box = s.box ?? [0, 0, 0, 0];
				if (!s.d) {
					this.errf(n, "needs `d`");
				}
				if (box[2] <= 0 || box[3] <= 0) {
					this.errf(n, "needs a `box` with an area");
				}
				if (fly === 0 && hoist === 0) {
					this.errf(n, "needs `fly` or `hoist`");
				}
				break;
			}
			case "pile":
				if (s.tip === undefined && !s.depth) {
					this.errf(n, "needs a `depth` or a `tip`");
				} else if (s.tip !== undefined && s.depth) {
					this.errf(n, "takes a `depth` or a `tip`, not both");
				} else if (s.tip !== undefined && s.flat !== undefined) {
					this.errf(n, "a `flat` goes with a `depth`, not a `tip`");
				}
				break;
			case "pall":
				if (!s.width) {
					this.errf(n, "needs a `width`");
				}
				break;
			case "heart":
				if (!s.spread) {
					s.spread = radius * Math.SQRT2;
					s.autoSpread = true;
				}
				if (s.spread >= 2 * radius && radius > 0) {
					this.errf(n, "`spread` must be less than twice `radius`, so that the lobes meet");
				}
				break;
			case "plus":
				if (!s.width || s.width >= 2 * radius) {
					this.errf(n, "needs a `width` less than twice its `radius`");
				}
				break;
			case "polygon":
				if ((s.vertices?.length ?? 0) < 3) {
					this.errf(n, "needs at least 3 `point`s");
				}
				break;
			case "svg": {
				if (fly === 0 || hoist === 0) {
					this.errf(n, "needs `fly` and `hoist`");
				}
				if (!s.markup) {
					this.errf(n, "needs `markup`");
					return;
				}
				try {
					s.embedded = sanitizeSvg(s.markup);
					// Only what passed is kept, so that nothing can read what the sanitizer removed.
					s.markup = canonical(s.embedded);
				} catch (e) {
					this.errf(n, (e as Error).message);
				}
				break;
			}
		}
	}

	private at(n: Node): Point | null {
		this.noChildren(n);
		const a0 = args(n);
		if (a0.length > 0) {
			if (a0.length !== 1 || a0[0] !== "center" || propNames(n).length > 0) {
				this.errf(n, "must be `center` or `fly=A hoist=B`");
			}
			return null;
		}
		this.only(n, 0, ["fly", "hoist"]);
		return { fly: this.prop(n, "fly"), hoist: this.prop(n, "hoist") };
	}

	/** Reads `border COLOR W`, with an optional side of inside or outside. */
	private border(n: Node): Border | undefined {
		let a0 = args(n);
		let side: Border["side"] = "inside";
		if (a0.length === 3) {
			if (a0[2] !== "inside" && a0[2] !== "outside") {
				this.errf(n, "side must be inside or outside");
				return undefined;
			}
			side = a0[2];
			a0 = a0.slice(0, 2);
		}
		const edge = this.edgeArgs(n, a0);
		return edge === null ? undefined : { ...edge, side };
	}

	/** Refuses an outside border that can't go around the shape it's given. */
	private checkOutside(n: Node, outline: Outline | undefined, fly: number, hoist: number, border: Border | undefined): void {
		if (border === undefined || border.side !== "outside" || border.width <= 0 || fly <= 0 || hoist <= 0) {
			return;
		}
		const shape = outline === undefined ? boundary({ fly, hoist }) : boundary({ fly, hoist, outline });
		if (shape === null) {
			this.errf(n, "an outside border can't go around a `path` outline");
			return;
		}
		try {
			offsetPolygon(shape, border.width);
		} catch (e) {
			this.errf(n, (e as Error).message);
		}
	}

	private edge(n: Node): Fimbriation | null {
		return this.edgeArgs(n, args(n));
	}

	private edgeArgs(n: Node, a0: KdlValue[]): Fimbriation | null {
		this.noProps(n);
		this.noChildren(n);
		if (a0.length !== 2 || typeof a0[0] !== "string") {
			this.errf(n, "needs a color and a width");
			return null;
		}
		return { color: this.paletteColor(n, a0[0]), width: this.positive(n, this.numberValue(n, a0[1]!)) };
	}

	/** Dispatches a node's children to handlers, refusing unknown nodes and repeats of anything not listed as repeatable. */
	private children(n: Node, repeatable: string[], handlers: Handlers): void {
		const seen = new Set<string>();
		for (const c of childNodes(n)) {
			const name = c.getName();
			if (!has(handlers, name)) {
				this.errf(c, "unknown here");
				continue;
			}
			if (seen.has(name) && !repeatable.includes(name)) {
				this.errf(c, "given more than once");
			}
			seen.add(name);
			handlers[name]!(c);
		}
	}

	/** Checks what's the same wherever it is in a document. */
	private prepare(nodes: Node[]): void {
		for (const n of nodes) {
			if (n.getTag() !== null || n.entries.some((e) => e.getTag() !== null)) {
				this.errf(n, "type annotations aren't used by this format");
			}
			this.prepare(childNodes(n));
		}
	}

	private noValues(n: Node): void {
		if (n.hasArguments()) {
			this.errf(n, "takes no arguments");
		}
		this.noProps(n);
	}

	private noProps(n: Node): void {
		if (n.hasProperties()) {
			this.errf(n, "takes no properties");
		}
	}

	private noChildren(n: Node): void {
		if (childNodes(n).length > 0) {
			this.errf(n, "takes no children");
		}
	}

	/** Checks a node's argument count and refuses any property not listed. */
	private only(n: Node, count: number, props: string[]): void {
		const got = args(n).length;
		if (got !== count) {
			this.errf(n, `takes ${count} arguments, got ${got}`);
		}
		for (const key of propNames(n)) {
			if (!props.includes(key)) {
				this.errf(n, `unknown property "${key}"`);
			}
		}
	}

	private str(n: Node): string {
		this.noProps(n);
		this.noChildren(n);
		const a0 = args(n);
		const value = a0[0];
		if (a0.length !== 1 || typeof value !== "string") {
			this.errf(n, "needs one string");
			return "";
		}
		return value;
	}

	private oneOf(n: Node, allowed: string[]): string {
		const value = this.str(n);
		if (value !== "" && !allowed.includes(value)) {
			this.errf(n, `must be one of [${allowed.join(" ")}], got "${value}"`);
		}
		return value;
	}

	private colorArg(n: Node): string {
		const a0 = args(n);
		const color = a0[0];
		if (a0.length !== 1 || typeof color !== "string") {
			this.errf(n, "needs one color");
			return "";
		}
		return this.paletteColor(n, color);
	}

	/** Reads a color list that can leave gaps with `none`. */
	private gapColorArgs(n: Node): string[] {
		const a0 = args(n);
		if (a0.length === 0) {
			this.errf(n, "needs at least one color");
		}
		const colors: string[] = [];
		for (const a of a0) {
			if (typeof a !== "string") {
				this.errf(n, "colors must be palette names");
			} else if (a === noColor) {
				colors.push(noColor);
			} else {
				colors.push(this.paletteColor(n, a));
			}
		}
		return colors;
	}

	private paletteColor(n: Node, name: string): string {
		return this.gradients[name] !== undefined ? name : this.solidColor(n, name);
	}

	/** For the places a gradient has no meaning. */
	private solidColor(n: Node, name: string): string {
		if (this.palette[name] !== undefined) {
			return name;
		}
		if (this.gradients[name] !== undefined || this.gradientNames.includes(name)) {
			this.errf(n, `"${name}" is a gradient, and a solid color is needed here`);
			return name;
		}
		this.errf(n, `color "${name}" isn't in the palette`);
		return name;
	}

	private numberValue(n: Node, v: KdlValue): number {
		if (typeof v !== "number") {
			this.errf(n, "needs a number");
			return 0;
		}
		if (!inLimits(v)) {
			this.errf(n, "needs a finite number of a reasonable size");
			return 0;
		}
		return v;
	}

	private number(n: Node): number {
		this.noProps(n);
		this.noChildren(n);
		const a0 = args(n);
		if (a0.length !== 1) {
			this.errf(n, "needs one number");
			return 0;
		}
		return this.numberValue(n, a0[0]!);
	}

	private numbers(n: Node): number[] {
		this.noProps(n);
		this.noChildren(n);
		return args(n).map((a) => this.numberValue(n, a));
	}

	private positives(n: Node): number[] {
		const values = this.numbers(n);
		for (const v of values) {
			this.positive(n, v);
		}
		return values;
	}

	private positive(n: Node, v: number): number {
		if (v <= 0) {
			this.errf(n, "needs a positive number");
		}
		return v;
	}

	/** Reads a size that defaults to 0, which can also be written as 0. */
	private notNegative(n: Node, v: number): number {
		if (v < 0) {
			this.errf(n, "can't be negative");
		}
		return v;
	}

	private integer(n: Node, v: number, limit: number): number {
		if (v !== Math.trunc(v) || v < 1) {
			this.errf(n, "needs a positive whole number");
			return 0;
		}
		if (v > limit) {
			this.errf(n, `can't be more than ${limit}`);
			return 0;
		}
		return v;
	}

	private prop(n: Node, key: string): number {
		const v = propValue(n, key);
		if (v === undefined) {
			this.errf(n, `needs ${key}=`);
			return 0;
		}
		return this.numberValue(n, v);
	}

	private boolProp(n: Node, key: string): boolean {
		const v = propValue(n, key);
		if (v === undefined) {
			return false;
		}
		if (typeof v !== "boolean") {
			this.errf(n, `${key} must be #true or #false`);
			return false;
		}
		return v;
	}

	/** Reads a child that's either bare or holds #true or #false. */
	private flagValue(n: Node): boolean {
		this.noProps(n);
		this.noChildren(n);
		const a0 = args(n);
		if (a0.length === 0) {
			return true;
		}
		if (a0.length !== 1 || typeof a0[0] !== "boolean") {
			this.errf(n, "must be #true or #false");
			return false;
		}
		return a0[0];
	}

	private pathData(n: Node): string {
		const d = this.str(n);
		if (!validPath(d)) {
			this.errf(n, "isn't SVG path data");
			return "";
		}
		return d;
	}

	private boxValue(n: Node, text: string): Box {
		const values = numbersIn(text);
		if (values === undefined || values.length !== 4) {
			this.errf(n, 'box must be "x y width height", with each a finite decimal number of a reasonable size');
			return [0, 0, 0, 0];
		}
		return values as Box;
	}

	/** Reads `edge wavy depth=N period=N` or `edge zigzag depth=N count=N`. */
	private line(n: Node): ShapedEdge | null {
		this.noChildren(n);
		const a0 = args(n);
		const kind = a0[0];
		if (a0.length !== 1 || (kind !== "wavy" && kind !== "zigzag")) {
			this.errf(n, "needs a kind: wavy or zigzag");
			return null;
		}
		this.only(n, 1, ["depth", "period", "count"]);
		const l: ShapedEdge = { kind, depth: this.positive(n, this.prop(n, "depth")) };
		const period = propValue(n, "period");
		if (period !== undefined) {
			l.period = this.positive(n, this.numberValue(n, period));
		}
		const count = propValue(n, "count");
		if (count !== undefined) {
			l.count = this.integer(n, this.numberValue(n, count), maxCopies);
		}
		if (!l.period && !l.count) {
			this.errf(n, "needs `period` or `count`");
			return null;
		}
		if (l.period && l.count) {
			this.errf(n, "needs `period` or `count`, not both");
		}
		return l;
	}

	private quarters(n: Node): Layer {
		const colors = this.gapColorArgs(n);
		const l: QuartersLayer = { layer: "quarters", ...newEffects(), colors: ["", "", "", ""], diagonal: false };
		this.noProps(n);
		if (colors.length !== 4) {
			this.errf(n, "needs 4 colors");
		} else {
			l.colors = colors as [string, string, string, string];
		}
		this.children(n, ["cut"], this.withEffects(l, {
			diagonal: (c) => { l.diagonal = this.flagValue(c); },
			split: (c) => {
				const at = this.at(c);
				if (at !== null) {
					l.split = at;
				} else {
					delete l.split;
				}
			},
		}));
		if (l.diagonal && l.split !== undefined) {
			this.errf(n, "`split` only applies to upright quarters");
		}
		return l;
	}

	private checks(n: Node): Layer {
		const l: ChecksLayer = { layer: "checks", ...newEffects(), colors: this.gapColorArgs(n), rows: 0, columns: 0, flow: "bend-sinister" };
		this.noProps(n);
		this.children(n, ["cut"], this.withEffects(l, {
			rows: (c) => { l.rows = this.integer(c, this.number(c), maxCopies); },
			columns: (c) => { l.columns = this.integer(c, this.number(c), maxCopies); },
			flow: (c) => { l.flow = this.oneOf(c, ["bend", "bend-sinister"]) as ChecksLayer["flow"]; },
		}));
		if (l.colors.length < 2) {
			this.errf(n, "needs at least 2 colors");
		}
		if (l.rows === 0 || l.columns === 0) {
			this.errf(n, "needs `rows` and `columns`");
		}
		if (l.rows * l.columns > maxCopies) {
			this.errf(n, `makes more than ${maxCopies} cells`);
		}
		return l;
	}

	private rays(n: Node): Layer {
		const l: RaysLayer = { layer: "rays", ...newEffects(), colors: this.gapColorArgs(n), from: "center", ratio: [], rotate: 0, measure: "angle" };
		this.noProps(n);
		let count = 0;
		let ratio: number[] | undefined;
		this.children(n, ["cut"], this.withEffects(l, {
			from: (c) => {
				if (c.hasArguments()) {
					l.from = this.oneOf(c, rayFromNames) as RayOrigin;
				} else {
					const at = this.at(c);
					if (at !== null) {
						l.at = at;
					} else {
						delete l.at;
					}
				}
			},
			count: (c) => { count = this.integer(c, this.number(c), maxCopies); },
			ratio: (c) => { ratio = this.positives(c); },
			rotate: (c) => { l.rotate = this.number(c); },
			measure: (c) => { l.measure = this.oneOf(c, ["angle", "edge"]) === "edge" ? "edge" : "angle"; },
		}));
		if (l.measure === "edge" && l.rotate !== 0) {
			this.errf(n, "`measure edge` follows the region's edges, so it can't also have a `rotate`");
		}
		if (l.colors.length === 0) {
			return l;
		}
		l.colors = this.cycle(n, l.colors, count);
		l.ratio = this.ratio(n, ratio, l.colors.length);
		return l;
	}

	/** Reads a pile or pall, which are shapes tied to their region's edges. */
	private ordinaryShape(n: Node): Layer {
		const s: ShapeDraft = { kind: n.getName() };
		const l: ChargeLayer = { layer: "charge", ...newEffects(), shape: s as unknown as Shape, color: this.colorArg(n) };
		this.noProps(n);
		this.shapeBody(n, s, this.withEffects(l, {
			fimbriate: (c) => this.setFimbriate(l, c),
		}));
		if (l.fimbriate !== undefined && (s.hollow ?? 0) > 0) {
			this.errf(n, "fimbriation edges a filled shape, so it can't go with `hollow` or `lines`");
		}
		l.shape = finishShape(s);
		return l;
	}

	private panel(n: Node, depth: number): Layer {
		const l: PanelLayer = { layer: "panel", ...newEffects(), layers: [] };
		// An `at center` gives no position, but it's still an `at`.
		let placed = false;
		this.noValues(n);
		this.container(n, depth, l, l.layers, {
			side: (c) => { l.side = this.oneOf(c, fromValues) as EdgeName; },
			corner: (c) => { l.corner = this.oneOf(c, cornerValues) as CornerName; },
			at: (c) => {
				placed = true;
				const at = this.at(c);
				if (at !== null) {
					l.at = at;
				} else {
					delete l.at;
				}
			},
			width: (c) => { l.width = this.positive(c, this.number(c)); },
			fly: (c) => { l.fly = this.positive(c, this.number(c)); },
			hoist: (c) => { l.hoist = this.positive(c, this.number(c)); },
			edge: (c) => {
				const line = this.line(c);
				if (line !== null) {
					l.edge = line;
				} else {
					delete l.edge;
				}
			},
		});
		this.checkWaves(n, l.edge);
		if (l.side && l.corner) {
			this.errf(n, "needs either `side` or `corner`, not both");
		} else if (l.side) {
			if (!l.width) {
				this.errf(n, "a side panel needs a `width`");
			}
			if (l.fly || l.hoist || placed) {
				this.errf(n, "a side panel takes a `width`, and no `fly`, `hoist` or `at`");
			}
		} else {
			if (!l.fly || !l.hoist) {
				this.errf(n, "needs a `side` and `width`, or a `fly` and `hoist`");
			}
			if (l.edge !== undefined) {
				this.errf(n, "only a side panel can have an `edge`");
			}
			if (l.corner && placed) {
				this.errf(n, "needs either `corner` or `at`, not both");
			}
			if (l.width) {
				this.errf(n, "only a side panel has a `width`");
			}
		}
		if (l.layers.length === 0) {
			this.errf(n, "needs at least one layer");
		}
		return l;
	}

	private use(n: Node, depth: number): Layer | null {
		const a0 = args(n);
		this.noProps(n);
		const name = a0[0];
		if (a0.length !== 1 || typeof name !== "string") {
			this.errf(n, "needs the name of a definition");
			return null;
		}
		const d = this.defines[name];
		if (d === undefined || d.shape !== undefined) {
			this.errf(n, `"${name}" isn't a defined design`);
			return null;
		}
		if (depth + (d.height ?? 0) > maxDepth) {
			this.errf(n, `"${name}" nests more than ${maxDepth} levels deep where it's used`);
		}
		const l: UseLayer = { layer: "use", ...newEffects(), name, define: d };
		this.children(n, ["cut"], this.withEffects(l, {}));
		return l;
	}

	/** Reads a reusable shape or design: `define NAME hoist=H fly=F { ... }`. */
	private define(n: Node): void {
		const a0 = args(n);
		const name = a0[0];
		if (a0.length !== 1 || typeof name !== "string" || name === "") {
			this.errf(n, "needs a name");
			return;
		}
		if (this.defines[name] !== undefined || shapeKinds.includes(name) || name === "svg" || name === "pile" || name === "pall") {
			this.errf(n, `"${name}" is already taken`);
			return;
		}
		this.only(n, 1, ["hoist", "fly"]);
		const d: Define = { layers: [] };
		if (propValue(n, "fly") !== undefined || propValue(n, "hoist") !== undefined) {
			d.fly = this.positive(n, this.prop(n, "fly"));
			d.hoist = this.positive(n, this.prop(n, "hoist"));
		}
		const nodes = childNodes(n);
		if (nodes.length === 0) {
			this.errf(n, "needs a shape or layers");
			return;
		}
		if (nodes.length === 1 && shapeKinds.includes(nodes[0]!.getName())) {
			const c = nodes[0]!;
			if (d.fly) {
				this.errf(n, "only a design has its own grid, and a shape takes its size from what uses it");
			}
			const s: ShapeDraft = { kind: c.getName() };
			if (s.kind === "path" && c.hasArguments()) {
				// The usual form, `path "M..." box="0 0 10 10"`, puts it all on one line. Its size
				// comes from each charge using it, so nothing more can be checked yet.
				const { d: data, box } = this.linePath(c);
				if (data !== "") {
					s.d = data;
				}
				s.box = box;
				d.shape = finishShape(s);
				this.defines[name] = d;
				return;
			}
			this.noValues(c);
			this.shapeBody(c, s, null);
			d.shape = finishShape(s);
			this.defines[name] = d;
			return;
		}
		for (const c of nodes) {
			const l = this.layer(c, 2);
			if (l !== null) {
				d.layers.push(l);
			}
		}
		d.size = layersSize(d.layers, this.longer);
		d.height = layersHeight(d.layers);
		this.defines[name] = d;
	}

	/** Reads the one-line form of a path, `path "M..." box="x y width height"`, which takes nothing else. */
	private linePath(n: Node): { d: string; box: Box } {
		this.only(n, 1, ["box"]);
		this.noChildren(n);
		const a1 = args(n);
		let d = "";
		if (a1.length === 1 && typeof a1[0] === "string" && validPath(a1[0])) {
			d = a1[0];
		} else {
			this.errf(n, "isn't SVG path data");
		}
		const b = propValue(n, "box");
		const box: Box = typeof b === "string" ? this.boxValue(n, b) : [0, 0, 0, 0];
		if (box[2] <= 0 || box[3] <= 0) {
			this.errf(n, "needs a `box` with an area");
		}
		return { d, box };
	}

	/** Reads a flag's silhouette: a polygon or path inside it, or a named form. */
	private outline(n: Node): Outline | undefined {
		this.noProps(n);
		const a0 = args(n);
		if (a0.length > 1 || (a0.length === 1 && typeof a0[0] !== "string")) {
			this.errf(n, "takes a named form, or a polygon or path inside it");
			return undefined;
		}
		if (a0.length === 1) {
			const kind = a0[0] as string;
			if (kind !== "swallowtail" && kind !== "tongued" && kind !== "pennant") {
				this.errf(n, `unknown form "${kind}"`);
				return undefined;
			}
			let depth = 0;
			let tip = 0;
			let tongue = 0;
			let taper = 0;
			const given = new Set<string>();
			this.children(n, [], {
				depth: (c) => { depth = this.positive(c, this.number(c)); given.add("depth"); },
				tip: (c) => { tip = this.notNegative(c, this.number(c)); given.add("tip"); },
				tongue: (c) => { tongue = this.positive(c, this.number(c)); given.add("tongue"); },
				taper: (c) => { taper = this.notNegative(c, this.number(c)); given.add("taper"); },
			});
			if (kind !== "pennant" && depth === 0) {
				this.errf(n, "needs a `depth`");
			}
			if (kind === "tongued" && tongue === 0) {
				this.errf(n, "needs a `tongue`");
			}
			if ((given.has("tip") && kind !== "pennant") || (given.has("tongue") && kind !== "tongued") || (given.has("taper") && kind !== "swallowtail") || (given.has("depth") && kind === "pennant")) {
				this.errf(n, `has a value that a ${kind} doesn't use`);
			}
			// Each form reads all four, so a stray one is kept for the model to report.
			return { kind, depth, tip, tongue, taper } as Outline;
		}
		let outline: Outline | undefined;
		let shapes = 0;
		this.children(n, [], {
			polygon: (c) => {
				if (++shapes > 1) {
					this.errf(c, "an outline holds one shape");
				}
				const s: ShapeDraft = { kind: "polygon" };
				this.noValues(c);
				this.shapeBody(c, s, null);
				if ((s.hollow ?? 0) > 0) {
					this.errf(c, "an outline is a whole shape, so it can't be `hollow`");
				}
				outline = { kind: "polygon", vertices: s.vertices ?? [] };
			},
			path: (c) => {
				if (++shapes > 1) {
					this.errf(c, "an outline holds one shape");
				}
				const { d, box } = this.linePath(c);
				outline = { kind: "path", d, box };
			},
		});
		if (outline === undefined) {
			this.errf(n, "needs a form, a `polygon` or a `path`");
		}
		return outline;
	}

	private reverse(n: Node, flag: Flag): void {
		const a0 = args(n);
		if (a0.length === 1 && a0[0] === "mirror") {
			// The default, for saying so outright.
			this.noProps(n);
			this.noChildren(n);
			return;
		}
		this.noValues(n);
		const r: Reverse = { layers: [] };
		for (const c of childNodes(n)) {
			// It holds the flag's layers for that side, so they're at the top level.
			const l = this.layer(c, 1);
			if (l !== null) {
				r.layers.push(l);
			}
		}
		if (r.layers.length === 0) {
			this.errf(n, "needs layers, or `mirror`");
		}
		this.count(n, r.layers);
		flag.reverse = r;
	}

	private adapt(n: Node, flag: Flag): void {
		this.noValues(n);
		const a: Adapt = {};
		const mode = (c: Node): AdaptRule => {
			const a0 = args(c);
			if (a0.length === 1 && a0[0] === "cut") {
				return "extend";
			}
			return this.oneOf(c, modeValues) as AdaptRule;
		};
		this.children(n, [], {
			range: (c) => {
				const v = this.numbers(c);
				if (v.length !== 2 || v[0]! <= 0 || v[1]! < v[0]!) {
					this.errf(c, "needs a lowest and highest fly-to-hoist ratio");
					return;
				}
				a.range = [v[0]!, v[1]!];
			},
			wider: (c) => { a.wider = mode(c); },
			narrower: (c) => { a.narrower = mode(c); },
		});
		if (!a.wider && !a.narrower) {
			this.errf(n, "needs `wider`, `narrower` or both");
		}
		flag.adapt = a;
	}

	private variant(n: Node, flag: Flag): void {
		const a0 = args(n);
		const name = a0[0];
		if (a0.length !== 1 || typeof name !== "string" || name === "") {
			this.errf(n, "needs a name");
			return;
		}
		this.noProps(n);
		if (flag.variants[name] !== undefined) {
			this.errf(n, `"${name}" is defined twice`);
			return;
		}
		const v: Variant = { from: "none", upright: false, layers: [] };
		const settings: Handlers = {
			from: (c) => { v.from = this.oneOf(c, viewValues) as Turn; },
			upright: (c) => { v.upright = this.flagValue(c); },
			ratio: (c) => { v.ratio = this.positive(c, this.number(c)); },
			proportion: (c) => {
				this.only(c, 0, ["hoist", "fly"]);
				v.hoist = this.positive(c, this.prop(c, "hoist"));
				v.fly = this.positive(c, this.prop(c, "fly"));
				this.noChildren(c);
			},
			outline: (c) => {
				const outline = this.outline(c);
				if (outline !== undefined) {
					v.outline = outline;
				}
			},
			border: (c) => {
				const border = this.border(c);
				if (border !== undefined) {
					v.border = border;
				}
			},
		};
		const seen = new Set<string>();
		for (const c of childNodes(n)) {
			const child = c.getName();
			if (!has(settings, child)) {
				// Its layers replace the flag's, so they're at the top level.
				const l = this.layer(c, 1);
				if (l !== null) {
					v.layers.push(l);
				}
				continue;
			}
			if (seen.has(child)) {
				this.errf(c, "given more than once");
			}
			seen.add(child);
			settings[child]!(c);
		}
		if (seen.has("proportion")) {
			if (seen.has("ratio")) {
				this.errf(n, "can't have both `proportion` and `ratio`");
			}
			if (v.layers.length === 0) {
				this.errf(n, "with a `proportion` needs its own layers");
			}
		}
		if (v.outline !== undefined || v.border !== undefined || v.fly !== undefined) {
			// What it draws within is its own or the flag's, as it would be when rendered.
			const own = v.fly !== undefined;
			this.checkOutside(n, v.outline ?? (own ? undefined : flag.outline), v.fly ?? flag.fly, v.hoist ?? flag.hoist, v.border ?? (own ? undefined : flag.border));
		}
		this.count(n, v.layers);
		flag.variants[name] = v;
	}

	/** Reads a text with any sources for it as children. */
	private reference(n: Node): Reference | null {
		this.noProps(n);
		const a0 = args(n);
		const text = a0[0];
		if (a0.length !== 1 || typeof text !== "string") {
			this.errf(n, "needs one string");
			return null;
		}
		const r: Reference = { text, sources: [] };
		this.children(n, ["source"], {
			source: (c) => { r.sources.push(this.str(c)); },
		});
		return r;
	}

	/** Reads a palette color, with its values in any other color systems. */
	private color(n: Node, flag: Flag): string {
		this.noProps(n);
		const a0 = args(n);
		const value = a0[0];
		if (a0.length !== 1 || typeof value !== "string") {
			this.errf(n, "needs one string");
			return "";
		}
		const refs: ColorRef[] = [];
		const named: Handler = (c) => { refs.push({ system: c.getName(), value: this.str(c) }); };
		this.children(n, ["dye", "reference"], {
			pantone: named,
			ncs: named,
			ral: named,
			munsell: named,
			dye: named,
			thread: named,
			cmyk: (c) => {
				const v = this.numbers(c);
				if (v.length !== 4) {
					this.errf(c, "needs 4 values from 0 to 100");
					return;
				}
				for (const x of v) {
					if (x < 0 || x > 100) {
						this.errf(c, "needs 4 values from 0 to 100");
					}
				}
				refs.push({ system: "cmyk", value: v.map(formatNumber).join(" "), numbers: v });
			},
			reference: (c) => {
				this.noProps(c);
				this.noChildren(c);
				const a1 = args(c);
				if (a1.length !== 2 || typeof a1[0] !== "string" || typeof a1[1] !== "string") {
					this.errf(c, "needs a system's name and a value");
					return;
				}
				refs.push({ system: a1[0], value: a1[1], other: true });
			},
		});
		if (refs.length > 0) {
			flag.colorRefs[n.getName()] = refs;
		}
		return value;
	}

	/** Reads a named sequence of folds. */
	private fold(n: Node, flag: Flag): void {
		const a0 = args(n);
		const name = a0[0];
		if (a0.length !== 1 || typeof name !== "string" || name === "") {
			this.errf(n, "needs a name");
			return;
		}
		this.noProps(n);
		if (flag.folds[name] !== undefined) {
			this.errf(n, `"${name}" is defined twice`);
			return;
		}
		const f: Fold = { sources: [], steps: [] };
		const step: Handler = (c) => {
			const s = this.foldStep(c);
			if (s !== null) {
				f.steps.push(s);
			}
		};
		this.children(n, ["source", "over", "under", "tuck"], {
			description: (c) => { f.description = this.str(c); },
			source: (c) => { f.sources.push(this.str(c)); },
			over: step,
			under: step,
			tuck: step,
		});
		if (f.steps.length === 0) {
			this.errf(n, "needs at least one step");
		}
		flag.folds[name] = f;
	}

	/** Reads `over along=fly at=5 move=bottom`, or for any line, `over through="a b c d" move="e f"`. */
	private foldStep(n: Node): FoldStep | null {
		this.noChildren(n);
		this.only(n, 0, ["along", "at", "move", "through"]);
		const kind = n.getName() as FoldStep["kind"];
		const move = propValue(n, "move");
		if (typeof move !== "string") {
			this.errf(n, "needs move=, the part that moves");
			return null;
		}
		const through = propValue(n, "through");
		if (through !== undefined) {
			if (propValue(n, "along") !== undefined || propValue(n, "at") !== undefined) {
				this.errf(n, "a crease is `through=` or `along=` and `at=`, not both");
				return null;
			}
			const line = this.pointList(n, through, 4);
			const point = this.pointList(n, move, 2);
			if (line === null || point === null) {
				return null;
			}
			return {
				kind,
				through: [{ fly: line[0]!, hoist: line[1]! }, { fly: line[2]!, hoist: line[3]! }],
				moving: { fly: point[0]!, hoist: point[1]! },
				written: { through: line, moveTo: point },
			};
		}
		const along = propValue(n, "along");
		if (typeof along !== "string" || propValue(n, "at") === undefined) {
			this.errf(n, "needs along= and at=, or through=");
			return null;
		}
		const at = this.prop(n, "at");
		if (along === "fly") {
			if (move !== "top" && move !== "bottom") {
				this.errf(n, "a crease along the fly moves top or bottom");
				return null;
			}
			return { kind, through: [{ fly: 0, hoist: at }, { fly: 1, hoist: at }], moving: { fly: 0, hoist: move === "top" ? at - 1 : at + 1 }, written: { along, at, move } };
		}
		if (along === "hoist") {
			if (move !== "hoist" && move !== "fly") {
				this.errf(n, "a crease along the hoist moves hoist or fly");
				return null;
			}
			return { kind, through: [{ fly: at, hoist: 0 }, { fly: at, hoist: 1 }], moving: { fly: move === "hoist" ? at - 1 : at + 1, hoist: 0 }, written: { along, at, move } };
		}
		this.errf(n, "along must be fly or hoist");
		return null;
	}

	private pointList(n: Node, v: KdlValue, count: number): number[] | null {
		const values = typeof v === "string" ? numbersIn(v) : undefined;
		if (values === undefined || values.length !== count) {
			this.errf(n, `needs ${count} finite decimal numbers of a reasonable size in a string`);
			return null;
		}
		return values;
	}
}

/** Fills in what a shape left unsaid, once it has been checked. */
function finishShape(s: ShapeDraft): Shape {
	const { placed: _placed, ...rest } = s;
	return { rotate: 0, ...rest } as unknown as Shape;
}
