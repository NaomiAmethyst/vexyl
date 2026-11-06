// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { getLocation, InvalidKdlError, parse as parseKdl, type Document, type Node } from "@bgotink/kdl";
import { foldFacets, foldShape } from "./fold.js";
import { boundary, offsetPolygon, type Vec } from "./geometry.js";
import { sanitizeSvg, usesCurrentColor } from "./sanitize.js";
import { dict, fields, formatNumber, hash, parseNumber } from "./text.js";
import type {
	Adapt, AdaptRule, Adaptation, Anchor, Axis, BandLayer, BarsLayer, BlendMode, Border, Box, ChargeLayer, ChecksLayer, ChevronsLayer,
	ColorRef, CornerName, CrossLayer, Define, EdgeName, Effects, EmblemLayer, EmbeddedSvg, FieldLayer, Fimbriation, Flag, Fold, FoldStep,
	Gradient, GroupLayer, Layer, Meta, Outline, PanelLayer, Point, Problem, QuartersLayer, RaysLayer, RayOrigin, Reference, Repeat, Reverse,
	SaltireLayer, Shape, ShapedEdge, Turn, UseLayer, Variant,
} from "./types.js";

/** The format version this library reads. */
export const formatVersion = 1;

const maxDepth = 32;
const maxCopies = 10000;
/** In a color list this leaves a gap, and it can't be a palette name. */
const noColor = "none";

const colorValue = /^#[0-9a-fA-F]{6}$/;
const seriesValue = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// \s is spelled out, because JavaScript's also matches Unicode spaces and the reference's doesn't.
const pathValue = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\t\n\f\r ]+$/;

const alongValues = ["fly", "hoist", "bend", "bend-sinister"];
const fromValues = ["hoist", "fly", "top", "bottom"];
const blendValues = ["normal", "multiply", "screen", "overlay", "darken", "lighten"];
const anchorValues = ["start", "center", "end", "scale"];
const cornerValues = ["upper-hoist", "upper-fly", "lower-hoist", "lower-fly"];
const rayFromNames = ["center", "hoist", "fly", "top", "bottom", ...cornerValues];
const shapeKinds = ["disc", "ring", "rect", "plus", "triangle", "star", "heart", "cardioid", "polygon", "crescent", "sun", "lozenge", "ellipse", "path"];
const viewValues = ["none", "rotate", "transpose"];
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
export function read(source: string, name?: string): { flag?: Flag; problems: Problem[] } {
	let doc: Document;
	try {
		doc = parseKdl(source, { storeLocations: true });
	} catch (e) {
		if (e instanceof InvalidKdlError) {
			return { problems: syntaxProblems(e, name) };
		}
		throw e;
	}
	const duplicates = duplicateProperties(doc, name);
	if (duplicates.length > 0) {
		return { problems: duplicates };
	}
	const p = new Parser(`vx-${hash(source)}-`, name);
	const flag = p.document(doc);
	return p.problems.length > 0 ? { problems: p.problems } : { flag, problems: [] };
}

function syntaxProblems(e: InvalidKdlError, name?: string): Problem[] {
	const problems: Problem[] = [];
	for (const one of e.flat()) {
		const problem: Problem = { message: one.message };
		if (name !== undefined) {
			problem.source = name;
		}
		if (one.start !== undefined) {
			problem.line = one.start.line;
			problem.column = one.start.column;
		}
		problems.push(problem);
	}
	return problems.length > 0 ? problems : [{ message: e.message }];
}

/** KDL lets a later property win, and for a flag's exact numbers that would hide a mistake. */
function duplicateProperties(doc: Document, name?: string): Problem[] {
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
						problem.line = at.line;
						problem.column = at.column;
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
const stageTail = 8;

const stages: ReadonlyMap<string, number> = new Map([
	["vexyl", stageVersion], ["meta", stageMeta], ["palette", stagePalette], ["proportion", stageProportion],
	["outline", stageOutline], ["border", stageBorder], ["define", stageDefine],
	["reverse", stageTail], ["adapt", stageTail], ["variant", stageTail], ["fold", stageTail],
]);

class Parser {
	readonly problems: Problem[] = [];
	private readonly idPrefix: string;
	private readonly name: string | undefined;
	private defines: Record<string, Define> = dict();
	private palette: Record<string, string> = dict();
	private gradients: Record<string, Gradient> = dict();
	/** Lets a gradient's colors recognize other gradients, since they're defined one at a time. */
	private gradientNames: string[] = [];
	private embeds = 0;

	constructor(idPrefix: string, name?: string) {
		this.idPrefix = idPrefix;
		this.name = name;
	}

	private errf(n: Node, message: string): void {
		const at = getLocation(n)?.start;
		const problem: Problem = { message, node: n.getName() };
		if (this.name !== undefined) {
			problem.source = this.name;
		}
		if (at !== undefined) {
			problem.line = at.line;
			problem.column = at.column;
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
		for (const n of doc.nodes) {
			const name = n.getName();
			const s = stages.get(name) ?? stageLayers;
			if (s < stage || (s === stage && s !== stageLayers && s !== stageDefine && s !== stageTail)) {
				this.errf(n, "out of order or repeated");
				continue;
			}
			if (s > stageVersion && stage < stageVersion) {
				const at = getLocation(n)?.start;
				const problem: Problem = { message: `document must start with \`vexyl ${formatVersion}\`` };
				if (at !== undefined) {
					problem.line = at.line;
					problem.column = at.column;
				}
				this.problems.push(problem);
				return flag;
			}
			stage = s;
			switch (name) {
				case "vexyl":
					this.plain(n);
					flag.version = Math.trunc(this.number(n));
					if (flag.version !== formatVersion) {
						this.errf(n, `unsupported format version; this renderer reads ${formatVersion}`);
						return flag;
					}
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
					const border = this.border(n, boundary(flag));
					if (border !== undefined) {
						flag.border = border;
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
					}
				}
			}
		}
		if (stage < stageProportion) {
			this.problems.push({ message: "document needs `vexyl`, `meta`, `palette` and `proportion`" });
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

	private meta(n: Node, m: Meta): void {
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
		if (m.date && m.until && m.until < m.date) {
			this.errf(n, "`until` comes before `date`");
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
		if (n.children !== null) {
			this.children(n, ["author"], {
				author: (c) => { a.authors.push(this.str(c)); },
				license: (c) => { a.license = this.str(c); },
				part: (c) => { a.part = this.str(c); },
			});
		}
		return a;
	}

	private paletteNode(n: Node, flag: Flag): void {
		this.noValues(n);
		this.palette = flag.palette;
		this.gradients = flag.gradients;
		if (n.children === null) {
			return;
		}
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
			flag.palette[name] = value;
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
		this.plain(n);
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
		this.plain(n);
		this.only(n, 0, ["hoist", "fly"]);
		flag.hoist = this.positive(n, this.prop(n, "hoist"));
		flag.fly = this.positive(n, this.prop(n, "fly"));
		this.noChildren(n);
	}

	private layer(n: Node, depth: number): Layer | null {
		if (depth > maxDepth) {
			this.errf(n, `nested more than ${maxDepth} levels deep`);
			return null;
		}
		this.plain(n);
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
				return this.use(n);
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
				const l: PanelLayer = { layer: "panel", ...newEffects(), corner: "upper-hoist", layers: [] };
				this.noValues(n);
				this.container(n, depth, l, l.layers, {
					fly: (c) => { l.fly = this.positive(c, this.number(c)); },
					hoist: (c) => { l.hoist = this.positive(c, this.number(c)); },
				});
				if (!l.fly || !l.hoist) {
					this.errf(n, "needs `fly` and `hoist`");
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
		if (n.children === null) {
			return;
		}
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
			this.plain(c);
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
		if (n.children === null || nodes.length !== 1) {
			this.errf(n, "needs exactly one shape");
			return null;
		}
		const c = nodes[0]!;
		this.plain(c);
		this.noValues(c);
		if (c.getName() === "svg") {
			this.errf(c, "inline SVG can't be used as a clip or cut");
			return null;
		}
		const s = this.namedShape(c.getName());
		this.shapeBody(c, s, null);
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
		if (count > 0) {
			const cycle = l.colors;
			l.colors = Array.from({ length: count }, (_, i) => cycle[i % cycle.length]!);
		}
		l.ratio = this.ratio(n, ratio, l.colors.length);
		if (l.grow !== undefined && l.grow.length !== l.colors.length) {
			this.errf(n, `has ${l.colors.length} colors but ${l.grow.length} \`grow\` values`);
		}
		for (const g of l.grow ?? []) {
			if (g < 0) {
				this.errf(n, "`grow` can't be negative");
			}
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
			this.plain(c);
			placed[name]!(c);
		}
		if (l.charges.length === 0) {
			this.errf(n, "needs at least one charge");
		}
		return l;
	}

	private repeat(n: Node): Repeat | null {
		this.plain(n);
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
				return { kind, count, radius, turn, from, to };
			}
		}
		this.errf(n, `unknown repeat "${kind}"`);
		return null;
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
				s.points = 12;
				s.spread = 1;
				handlers.radius = radius;
				handlers.disc = (c) => { s.disc = this.positive(c, this.number(c)); };
				handlers.gap = (c) => { s.gap = this.positive(c, this.number(c)); };
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
				handlers.flat = (c) => { s.flat = this.positive(c, this.number(c)); };
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
				s.points = 5;
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
					this.plain(c);
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
				break;
			case "star": {
				const points = s.points ?? 0;
				if ((s.lines ?? 0) > 0 && (s.hollow ?? 0) > 0) {
					this.errf(n, "`lines` and `hollow` can't be combined");
				}
				if (inner >= radius && radius > 0) {
					this.errf(n, "`inner` must be smaller than `radius`");
				}
				if (inner === 0 && points < 5) {
					this.errf(n, "needs an `inner` with fewer than 5 points");
				}
				if (inner === 0) {
					s.inner = (radius * Math.cos((2 * Math.PI) / points)) / Math.cos(Math.PI / points);
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
				this.embeds++;
				try {
					s.embedded = sanitizeSvg(s.markup, `${this.idPrefix}svg${this.embeds}-`);
				} catch (e) {
					this.errf(n, (e as Error).message);
				}
				break;
			}
		}
	}

	private at(n: Node): Point | null {
		this.plain(n);
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

	/**
	 * Reads `border COLOR W`, with an optional side of inside or outside. A shape given to it is
	 * checked for having an outside at all.
	 */
	private border(n: Node, shape: Vec[] | null): Border | undefined {
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
		if (edge === null) {
			return undefined;
		}
		if (edge.width > 0 && side === "outside" && shape !== null) {
			try {
				offsetPolygon(shape, edge.width);
			} catch (e) {
				this.errf(n, (e as Error).message);
			}
		}
		return { ...edge, side };
	}

	private edge(n: Node): Fimbriation | null {
		return this.edgeArgs(n, args(n));
	}

	private edgeArgs(n: Node, a0: KdlValue[]): Fimbriation | null {
		this.plain(n);
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
			this.plain(c);
			handlers[name]!(c);
		}
	}

	private plain(n: Node): void {
		if (n.getTag() !== null) {
			this.errf(n, "type annotations aren't used by this format");
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
		if (!Number.isFinite(v) || Math.abs(v) > 1e12) {
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
		if (!pathValue.test(d)) {
			this.errf(n, "isn't SVG path data");
			return "";
		}
		return d;
	}

	private boxValue(n: Node, text: string): Box {
		const box: Box = [0, 0, 0, 0];
		const parts = text.split(/[ ,]/).filter((part) => part !== "");
		if (parts.length !== 4) {
			this.errf(n, 'box must be "x y width height"');
			return box;
		}
		for (let i = 0; i < 4; i++) {
			const v = parseNumber(parts[i]!);
			if (v === undefined) {
				this.errf(n, 'box must be "x y width height"');
				return box;
			}
			box[i] = v;
		}
		return box;
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
				this.plain(c);
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
		if (l.colors.length === 0) {
			return l;
		}
		if (count > 0) {
			const cycle = l.colors;
			l.colors = Array.from({ length: count }, (_, i) => cycle[i % cycle.length]!);
		}
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
		l.shape = finishShape(s);
		return l;
	}

	private panel(n: Node, depth: number): Layer {
		const l: PanelLayer = { layer: "panel", ...newEffects(), layers: [] };
		this.noValues(n);
		this.container(n, depth, l, l.layers, {
			side: (c) => { l.side = this.oneOf(c, fromValues) as EdgeName; },
			corner: (c) => { l.corner = this.oneOf(c, cornerValues) as CornerName; },
			at: (c) => {
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
		if (l.side && l.corner) {
			this.errf(n, "needs either `side` or `corner`, not both");
		} else if (l.side) {
			if (!l.width) {
				this.errf(n, "a side panel needs a `width`");
			}
			if (l.fly || l.hoist || l.at !== undefined) {
				this.errf(n, "a side panel takes a `width`, and no `fly`, `hoist` or `at`");
			}
		} else {
			if (!l.fly || !l.hoist) {
				this.errf(n, "needs a `side` and `width`, or a `fly` and `hoist`");
			}
			if (l.edge !== undefined) {
				this.errf(n, "only a side panel can have an `edge`");
			}
			if (l.corner && l.at !== undefined) {
				this.errf(n, "needs either `corner` or `at`, not both");
			}
		}
		if (l.layers.length === 0) {
			this.errf(n, "needs at least one layer");
		}
		return l;
	}

	private use(n: Node): Layer | null {
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
		const l: UseLayer = { layer: "use", ...newEffects(), name, define: d };
		this.children(n, ["cut"], this.withEffects(l, {}));
		return l;
	}

	/** Reads a reusable shape or design: `define NAME hoist=H fly=F { ... }`. */
	private define(n: Node): void {
		this.plain(n);
		const a0 = args(n);
		const name = a0[0];
		if (a0.length !== 1 || typeof name !== "string") {
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
			this.plain(c);
			const s: ShapeDraft = { kind: c.getName() };
			if (s.kind === "path" && c.hasArguments()) {
				// The usual form, `path "M..." box="0 0 10 10"`, puts it all on one line.
				const a1 = args(c);
				if (a1.length === 1 && typeof a1[0] === "string" && pathValue.test(a1[0])) {
					s.d = a1[0];
				} else {
					this.errf(c, "isn't SVG path data");
				}
				const b = propValue(c, "box");
				if (typeof b === "string") {
					s.box = this.boxValue(c, b);
				}
				// Its size comes from each charge using it, so nothing can be checked yet.
				const box = s.box ?? [0, 0, 0, 0];
				if (box[2] <= 0 || box[3] <= 0) {
					this.errf(c, "needs a `box` with an area");
				}
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
		this.defines[name] = d;
	}

	/** Reads a flag's silhouette: a polygon or path inside it, or a named form. */
	private outline(n: Node): Outline | undefined {
		this.plain(n);
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
			this.children(n, [], {
				depth: (c) => { depth = this.positive(c, this.number(c)); },
				tip: (c) => { tip = this.positive(c, this.number(c)); },
				tongue: (c) => { tongue = this.positive(c, this.number(c)); },
				taper: (c) => { taper = this.positive(c, this.number(c)); },
			});
			if (kind !== "pennant" && depth === 0) {
				this.errf(n, "needs a `depth`");
			}
			if (kind === "tongued" && tongue === 0) {
				this.errf(n, "needs a `tongue`");
			}
			// Each form reads all four, so a stray one is kept for the model to report.
			return { kind, depth, tip, tongue, taper } as Outline;
		}
		let outline: Outline | undefined;
		this.children(n, [], {
			polygon: (c) => {
				const s: ShapeDraft = { kind: "polygon" };
				this.noValues(c);
				this.shapeBody(c, s, null);
				outline = { kind: "polygon", vertices: s.vertices ?? [] };
			},
			path: (c) => {
				const a1 = args(c);
				const d = a1[0];
				if (a1.length !== 1 || typeof d !== "string" || !pathValue.test(d)) {
					this.errf(c, "isn't SVG path data");
					return;
				}
				const b = propValue(c, "box");
				const box: Box = typeof b === "string" ? this.boxValue(c, b) : [0, 0, 0, 0];
				if (box[2] <= 0 || box[3] <= 0) {
					this.errf(c, "needs a `box` with an area");
				}
				outline = { kind: "path", d, box };
			},
		});
		if (outline === undefined) {
			this.errf(n, "needs a form, a `polygon` or a `path`");
		}
		return outline;
	}

	private reverse(n: Node, flag: Flag): void {
		this.plain(n);
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
			const l = this.layer(c, 2);
			if (l !== null) {
				r.layers.push(l);
			}
		}
		if (r.layers.length === 0) {
			this.errf(n, "needs layers, or `mirror`");
		}
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
		this.plain(n);
		const a0 = args(n);
		const name = a0[0];
		if (a0.length !== 1 || typeof name !== "string") {
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
				const border = this.border(c, null);
				if (border !== undefined) {
					v.border = border;
				}
			},
		};
		const seen = new Set<string>();
		for (const c of childNodes(n)) {
			const child = c.getName();
			if (!has(settings, child)) {
				const l = this.layer(c, 2);
				if (l !== null) {
					v.layers.push(l);
				}
				continue;
			}
			if (seen.has(child)) {
				this.errf(c, "given more than once");
			}
			seen.add(child);
			this.plain(c);
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
				refs.push({ system: "cmyk", value: v.map(formatNumber).join(" ") });
			},
			reference: (c) => {
				this.noProps(c);
				this.noChildren(c);
				const a1 = args(c);
				if (a1.length !== 2 || typeof a1[0] !== "string" || typeof a1[1] !== "string") {
					this.errf(c, "needs a system's name and a value");
					return;
				}
				refs.push({ system: a1[0], value: a1[1] });
			},
		});
		if (refs.length > 0) {
			flag.colorRefs[n.getName()] = refs;
		}
		return value;
	}

	/** Reads a named sequence of folds. */
	private fold(n: Node, flag: Flag): void {
		this.plain(n);
		const a0 = args(n);
		const name = a0[0];
		if (a0.length !== 1 || typeof name !== "string") {
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
			const line = this.pointList(n, through, 4);
			const point = this.pointList(n, move, 2);
			if (line === null || point === null) {
				return null;
			}
			return {
				kind,
				through: [{ fly: line[0]!, hoist: line[1]! }, { fly: line[2]!, hoist: line[3]! }],
				moving: { fly: point[0]!, hoist: point[1]! },
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
			return { kind, through: [{ fly: 0, hoist: at }, { fly: 1, hoist: at }], moving: { fly: 0, hoist: move === "top" ? at - 1 : at + 1 } };
		}
		if (along === "hoist") {
			if (move !== "hoist" && move !== "fly") {
				this.errf(n, "a crease along the hoist moves hoist or fly");
				return null;
			}
			return { kind, through: [{ fly: at, hoist: 0 }, { fly: at, hoist: 1 }], moving: { fly: move === "hoist" ? at - 1 : at + 1, hoist: 0 } };
		}
		this.errf(n, "along must be fly or hoist");
		return null;
	}

	private pointList(n: Node, v: KdlValue, count: number): number[] | null {
		const message = `needs ${count} numbers in a string`;
		if (typeof v !== "string") {
			this.errf(n, message);
			return null;
		}
		const parts = fields(v);
		if (parts.length !== count) {
			this.errf(n, message);
			return null;
		}
		const out: number[] = [];
		for (const part of parts) {
			const x = parseNumber(part);
			if (x === undefined) {
				this.errf(n, message);
				return null;
			}
			out.push(x);
		}
		return out;
	}
}

/** Fills in what a shape left unsaid, once it has been checked. */
function finishShape(s: ShapeDraft): Shape {
	const { placed: _placed, ...rest } = s;
	return { rotate: 0, ...rest } as unknown as Shape;
}
