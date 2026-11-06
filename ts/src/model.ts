// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// The canonical form the conformance suite compares. The field names and the rules for what's left
// out follow the reference's output rather than this library's types, because the suite's fixtures
// are that output.

import type {
	Adaptation, Border, ColorRef, Define, Effects, Fimbriation, Flag, Fold, FoldStep, Gradient, Layer, Meta, Outline, Point, Reference, Repeat, Shape, ShapedEdge, Variant,
} from "./types.js";

export type Plain = string | number | boolean | null | Plain[] | { [key: string]: Plain };
type PlainMap = { [key: string]: Plain };

const nothing = (v: unknown): boolean => v === undefined || v === null || v === 0 || v === "" || v === false;

function empty(v: Plain | undefined): boolean {
	if (nothing(v)) {
		return true;
	}
	if (Array.isArray(v)) {
		return v.length === 0;
	}
	return typeof v === "object" && Object.keys(v as PlainMap).length === 0;
}

/** Builds a map, leaving out anything empty, zero or false. */
function build(fields: Record<string, Plain | undefined>): PlainMap {
	const out: PlainMap = Object.create(null) as PlainMap;
	for (const key of Object.keys(fields)) {
		const v = fields[key];
		if (!empty(v)) {
			out[key] = v as Plain;
		}
	}
	return out;
}

/** A list keeps its places, so that anything empty, zero or false in one is null. */
function list<T>(items: readonly T[] | undefined, each: (item: T) => Plain | undefined): Plain[] | undefined {
	if (items === undefined || items.length === 0) {
		return undefined;
	}
	return items.map((item) => {
		const v = each(item);
		return nothing(v) ? null : (v as Plain);
	});
}

const same = <T extends Plain>(v: T): T => v;

/** A fixed set of numbers is left out only if they're all zero, and otherwise kept in full. */
function fixed(values: readonly number[] | undefined): number[] | undefined {
	return values === undefined || values.every((v) => v === 0) ? undefined : [...values];
}

function mapOf<T>(items: Record<string, T>, each: (item: T) => Plain | undefined): PlainMap | undefined {
	const out: PlainMap = Object.create(null) as PlainMap;
	for (const key of Object.keys(items)) {
		const v = each(items[key] as T);
		if (!nothing(v) && !(Array.isArray(v) && v.length === 0)) {
			out[key] = v as Plain;
		}
	}
	return out;
}

const point = (p: Point | null | undefined): PlainMap | null => (p === null || p === undefined ? null : build({ fly: p.fly, hoist: p.hoist }));
const fimbriation = (e: Fimbriation | undefined): PlainMap | undefined => (e === undefined ? undefined : build({ color: e.color, width: e.width }));
const line = (l: ShapedEdge | undefined): PlainMap | undefined =>
	l === undefined ? undefined : build({ kind: l.kind, depth: l.depth, period: l.period, count: l.count });

function meta(m: Meta): PlainMap {
	return build({
		name: m.name,
		description: m.description,
		version: m.version,
		date: m.date,
		until: m.until,
		series: m.series,
		notes: list(m.notes, same),
		laws: list(m.laws, reference),
		restrictions: list(m.restrictions, reference),
		designers: list(m.designers, same),
		"design-rights": m.designRights,
		encoders: list(m.encoders, same),
		license: m.license,
		"render-license": m.renderLicense,
		"adapted-from": list(m.adaptedFrom, adaptation),
		sources: list(m.sources, same),
	});
}

const reference = (r: Reference): PlainMap => build({ text: r.text, sources: list(r.sources, same) });
const adaptation = (a: Adaptation): PlainMap =>
	build({ "u-r-l": a.url, authors: list(a.authors, same), license: a.license, part: a.part });
const colorRef = (r: ColorRef): PlainMap => build({ system: r.system, value: r.value });
const gradient = (g: Gradient): PlainMap => build({ colors: list(g.colors, same), stops: list(g.stops, same), along: g.along });

function outline(o: Outline | undefined): PlainMap | undefined {
	if (o === undefined) {
		return undefined;
	}
	switch (o.kind) {
		case "polygon":
			return build({ kind: o.kind, vertices: list(o.vertices, point) });
		case "path":
			return build({ kind: o.kind, d: o.d, box: fixed(o.box) });
		default: {
			const named = o as { depth?: number; tip?: number; tongue?: number; taper?: number };
			return build({ kind: o.kind, depth: named.depth, tip: named.tip, tongue: named.tongue, taper: named.taper });
		}
	}
}

function define(d: Define): PlainMap {
	return build({ shape: d.shape !== undefined ? shape(d.shape) : undefined, layers: list(d.layers, layer), fly: d.fly, hoist: d.hoist });
}

function effects(e: Effects): Record<string, Plain | undefined> {
	return {
		anchor: e.anchor,
		opacity: e.opacity,
		blend: e.blend,
		clip: e.clip !== undefined ? shape(e.clip) : undefined,
		cuts: list(e.cuts, shape),
	};
}

function shape(s: Shape): PlainMap {
	const common = {
		kind: s.kind as string,
		at: point(s.at),
		ats: list(s.ats, point),
		rotate: s.rotate,
		hollow: s.hollow,
	};
	switch (s.kind) {
		case "disc":
		case "triangle":
		case "cardioid":
			return build({ ...common, radius: s.radius });
		case "ellipse":
		case "rect":
		case "lozenge":
			return build({ ...common, fly: s.fly, hoist: s.hoist });
		case "ring":
			return build({ ...common, radius: s.radius, inner: s.inner, from: s.arc?.from, to: s.arc?.to, "has-arc": s.arc !== undefined });
		case "plus":
			return build({ ...common, radius: s.radius, width: s.width });
		case "star":
			return build({ ...common, radius: s.radius, inner: s.inner, points: s.points, lines: s.lines });
		case "crescent":
			return build({ ...common, radius: s.radius, inner: s.inner, offset: s.offset });
		case "sun":
			return build({ ...common, radius: s.radius, disc: s.disc, gap: s.gap, points: s.points, spread: s.spread });
		case "path":
			return build({ ...common, d: s.d, box: fixed(s.box), fly: s.fly, hoist: s.hoist, "even-odd": s.evenodd });
		case "heart":
			return build({ ...common, radius: s.radius, spread: s.spread });
		case "polygon":
			return build({ ...common, vertices: list(s.vertices, point) });
		case "pile":
			return build({ ...common, edge: s.from, base: fixed(s.base), tip: fixed(s.tip), depth: s.depth, flat: s.flat });
		case "pall":
			return build({ ...common, edge: s.from, width: s.width, junction: s.junction });
		case "svg":
			return build({ ...common, fly: s.fly, hoist: s.hoist, markup: s.markup });
	}
}

function repeat(r: Repeat | undefined): PlainMap | undefined {
	if (r === undefined) {
		return undefined;
	}
	switch (r.kind) {
		case "ring":
			return build({ kind: r.kind, count: r.count, radius: r.radius, turn: r.turn });
		case "arc":
			return build({ kind: r.kind, count: r.count, radius: r.radius, turn: r.turn, from: r.from, to: r.to });
		case "grid":
			return build({ kind: r.kind, rows: r.rows, columns: r.columns, stagger: r.stagger });
		case "line":
			return build({ kind: r.kind, count: r.count, fly: r.fly, hoist: r.hoist });
	}
}

function charge(c: Extract<Layer, { layer: "charge" }>): Record<string, Plain | undefined> {
	return { ...effects(c), shape: shape(c.shape), color: c.color, fimbriate: fimbriation(c.fimbriate), repeat: repeat(c.repeat) };
}

function layer(l: Layer): PlainMap {
	return build({ layer: l.layer, ...layerFields(l) });
}

function layerFields(l: Layer): Record<string, Plain | undefined> {
	const e = effects(l);
	switch (l.layer) {
		case "field":
			return { ...e, color: l.color };
		case "bars":
			return { ...e, colors: list(l.colors, same), along: l.along, ratio: list(l.ratio, same), rotate: l.rotate, grow: list(l.grow, same), line: line(l.edge) };
		case "chevrons":
			return { ...e, colors: list(l.colors, same), from: l.from, depth: l.depth, angle: l.angle, apex: l.apex, ratio: list(l.ratio, same), rotate: l.rotate, fimbriate: fimbriation(l.fimbriate) };
		case "band":
			return { ...e, color: l.color, along: l.along, width: l.width, offset: l.offset, rotate: l.rotate, fimbriate: fimbriation(l.fimbriate) };
		case "cross":
			return { ...e, color: l.color, "fly-parts": fixed(l.fly), "hoist-part": fixed(l.hoist), fimbriate: fimbriation(l.fimbriate) };
		case "saltire":
			return { ...e, color: l.color, width: l.width, fimbriate: fimbriation(l.fimbriate), counterchange: l.counterchange };
		case "quarters":
			return { ...e, colors: [...l.colors], diagonal: l.diagonal, split: point(l.split) };
		case "checks":
			return { ...e, colors: list(l.colors, same), rows: l.rows, columns: l.columns, flow: l.flow };
		case "rays":
			return { ...e, colors: list(l.colors, same), from: l.from, at: point(l.at), ratio: list(l.ratio, same), rotate: l.rotate, "by-edge": l.measure === "edge" };
		case "charge":
			return charge(l);
		case "emblem":
			// The charges in an emblem can't be anything else, so they don't say what they are.
			return { ...e, at: point(l.at), along: l.along, rotate: l.rotate, charges: list(l.charges, (c) => build(charge(c))) };
		case "group":
			return { ...e, layers: list(l.layers, layer) };
		case "panel":
			return { ...e, side: l.side, width: l.width, corner: l.corner, at: point(l.at), fly: l.fly, hoist: l.hoist, line: line(l.edge), layers: list(l.layers, layer) };
		case "use":
			return { ...e, name: l.name };
	}
}

function border(b: Border | undefined): PlainMap | undefined {
	return fimbriation(b);
}

function variant(v: Variant): PlainMap {
	return build({
		from: v.from,
		upright: v.upright,
		ratio: v.ratio,
		fly: v.fly,
		hoist: v.hoist,
		outline: outline(v.outline),
		border: border(v.border),
		"border-outside": v.border?.side === "outside",
		layers: list(v.layers, layer),
	});
}

const foldStep = (s: FoldStep): PlainMap => build({ kind: s.kind, a: point(s.through[0]), b: point(s.through[1]), moving: point(s.moving) });
const fold = (f: Fold): PlainMap => build({ description: f.description, sources: list(f.sources, same), steps: list(f.steps, foldStep) });

/**
 * Gives the flag as plain maps, lists, strings, numbers and booleans, in the canonical form. Names
 * are in kebab-case, a layer says which kind it is, and anything empty or zero is left out.
 */
export function model(f: Flag): PlainMap {
	return build({
		version: f.version,
		meta: meta(f.meta),
		palette: mapOf(f.palette, same),
		"color-refs": mapOf(f.colorRefs, (refs) => list(refs, colorRef)),
		gradients: mapOf(f.gradients, gradient),
		hoist: f.hoist,
		fly: f.fly,
		outline: outline(f.outline),
		border: border(f.border),
		"border-outside": f.border?.side === "outside",
		defines: mapOf(f.defines, define),
		layers: list(f.layers, layer),
		reverse: f.reverse !== undefined ? build({ layers: list(f.reverse.layers, layer) }) : undefined,
		adapt: f.adapt !== undefined ? build({ min: f.adapt.range?.[0], max: f.adapt.range?.[1], wider: f.adapt.wider, narrower: f.adapt.narrower }) : undefined,
		variants: mapOf(f.variants, variant),
		folds: mapOf(f.folds, fold),
	});
}
