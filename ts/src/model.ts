// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// The canonical model, as SDK section 4 defines it and conformance/model.schema.json writes it out.
// Names are the format's own terms. A value is left out only if it equals the format's default, so
// a zero that means something stays.

import { dict } from "./text.js";
import type { Adaptation, Define, Effects, Fimbriation, Flag, Fold, Layer, Meta, Outline, Point, Reference, Repeat, Shape, ShapedEdge, Variant } from "./types.js";

export type Plain = string | number | boolean | null | Plain[] | { [key: string]: Plain };
type PlainMap = { [key: string]: Plain };

const setText = (m: PlainMap, key: string, value: string | undefined): void => {
	if (value !== undefined && value !== "") {
		m[key] = value;
	}
};

/** Leaves out a number that equals its default. */
const setNumber = (m: PlainMap, key: string, value: number | undefined, otherwise = 0): void => {
	if (value !== undefined && value !== otherwise) {
		m[key] = value;
	}
};

const setList = (m: PlainMap, key: string, values: readonly string[]): void => {
	if (values.length > 0) {
		m[key] = [...values];
	}
};

const setFlag = (m: PlainMap, key: string, value: boolean | undefined): void => {
	if (value) {
		m[key] = true;
	}
};

const point = (p: Point): PlainMap => ({ fly: p.fly, hoist: p.hoist });

const setPoint = (m: PlainMap, key: string, p: Point | undefined): void => {
	if (p !== undefined) {
		m[key] = point(p);
	}
};

function meta(source: Meta): PlainMap {
	const m: PlainMap = { name: source.name };
	setText(m, "description", source.description);
	setText(m, "version", source.version);
	setText(m, "date", source.date);
	setText(m, "until", source.until);
	setText(m, "series", source.series);
	setList(m, "note", source.notes);
	const references = (node: string, refs: readonly Reference[]): void => {
		if (refs.length > 0) {
			m[node] = refs.map((r) => {
				const ref: PlainMap = { [node]: r.text };
				setList(ref, "source", r.sources);
				return ref;
			});
		}
	};
	references("law", source.laws);
	references("restriction", source.restrictions);
	setList(m, "designer", source.designers);
	setText(m, "design-rights", source.designRights);
	setList(m, "encoder", source.encoders);
	setText(m, "license", source.license);
	setText(m, "render-license", source.renderLicense);
	if (source.adaptedFrom.length > 0) {
		m["adapted-from"] = source.adaptedFrom.map((a: Adaptation) => {
			const work: PlainMap = { url: a.url };
			setList(work, "author", a.authors);
			setText(work, "license", a.license);
			setText(work, "part", a.part);
			return work;
		});
	}
	setList(m, "source", source.sources);
	return m;
}

function palette(f: Flag): PlainMap {
	const out = dict<Plain>();
	for (const name of Object.keys(f.palette)) {
		const color: PlainMap = { color: f.palette[name]! };
		for (const ref of f.colorRefs[name] ?? []) {
			if (ref.other) {
				((color.reference ??= []) as Plain[]).push({ system: ref.system, value: ref.value });
			} else if (ref.system === "cmyk") {
				color.cmyk = [...(ref.numbers ?? [])];
			} else if (ref.system === "dye") {
				((color.dye ??= []) as Plain[]).push(ref.value);
			} else {
				color[ref.system] = ref.value;
			}
		}
		out[name] = color;
	}
	for (const name of Object.keys(f.gradients)) {
		const g = f.gradients[name]!;
		const gradient: PlainMap = { gradient: [...g.colors], stops: [...g.stops] };
		if (g.along !== "fly") {
			gradient.along = g.along;
		}
		out[name] = gradient;
	}
	return out;
}

function outline(o: Outline): PlainMap {
	const m: PlainMap = { form: o.kind };
	switch (o.kind) {
		case "polygon":
			m.point = o.vertices.map(point);
			break;
		case "path":
			m.d = o.d;
			m.box = [...o.box];
			break;
		default: {
			const named = o as { depth?: number; taper?: number; tongue?: number; tip?: number };
			setNumber(m, "depth", named.depth);
			setNumber(m, "taper", named.taper);
			setNumber(m, "tongue", named.tongue);
			setNumber(m, "tip", named.tip);
		}
	}
	return m;
}

function border(b: Fimbriation & { side: "inside" | "outside" }): PlainMap {
	const m: PlainMap = { color: b.color, width: b.width };
	if (b.side === "outside") {
		m.side = "outside";
	}
	return m;
}

const edge = (e: Fimbriation): PlainMap => ({ color: e.color, width: e.width });

function define(d: Define): PlainMap {
	if (d.shape !== undefined) {
		return shape(d.shape);
	}
	const m: PlainMap = { layers: layers(d.layers) };
	if (d.fly) {
		m.proportion = { hoist: d.hoist!, fly: d.fly };
	}
	return m;
}

function shape(s: Shape): PlainMap {
	const m: PlainMap = { shape: s.kind };
	const ats = s.ats ?? [];
	if (ats.length > 1 || (ats.length === 1 && ats[0] !== null)) {
		m.at = ats.map((p) => (p === null ? "center" : point(p)));
	} else if (ats.length === 0 && s.at !== undefined) {
		m.at = [point(s.at)];
	}
	setNumber(m, "rotate", s.rotate);
	setNumber(m, "hollow", s.hollow);
	switch (s.kind) {
		case "disc":
		case "triangle":
		case "cardioid":
			m.radius = s.radius;
			break;
		case "ellipse":
		case "rect":
		case "lozenge":
			setNumber(m, "fly", s.fly);
			setNumber(m, "hoist", s.hoist);
			break;
		case "ring":
			m.radius = s.radius;
			m.inner = s.inner;
			if (s.arc !== undefined) {
				m.from = s.arc.from;
				m.to = s.arc.to;
			}
			break;
		case "plus":
			m.radius = s.radius;
			m.width = s.width;
			break;
		case "star":
			m.radius = s.radius;
			m.inner = s.inner;
			setNumber(m, "points", s.points, 5);
			setNumber(m, "lines", s.lines);
			break;
		case "crescent":
			m.radius = s.radius;
			m.inner = s.inner;
			m.offset = s.offset;
			break;
		case "sun":
			m.radius = s.radius;
			m.disc = s.disc;
			setNumber(m, "gap", s.gap);
			setNumber(m, "points", s.points, 12);
			setNumber(m, "spread", s.spread, 1);
			break;
		case "heart":
			m.radius = s.radius;
			m.spread = s.spread;
			break;
		case "path":
			m.d = s.d;
			m.box = [...s.box];
			setNumber(m, "fly", s.fly);
			setNumber(m, "hoist", s.hoist);
			setFlag(m, "evenodd", s.evenodd);
			break;
		case "polygon":
			m.point = s.vertices.map(point);
			break;
		case "pile":
			if (s.from !== "hoist") {
				m.from = s.from;
			}
			if (s.base !== undefined) {
				m.base = [...s.base];
			}
			if (s.tip !== undefined) {
				m.tip = [...s.tip];
			}
			setNumber(m, "depth", s.depth);
			setNumber(m, "flat", s.flat);
			break;
		case "pall":
			if (s.from !== "hoist") {
				m.from = s.from;
			}
			m.width = s.width;
			setNumber(m, "junction", s.junction);
			break;
		case "svg":
			m.fly = s.fly;
			m.hoist = s.hoist;
			m.markup = s.markup;
			break;
	}
	return m;
}

function effects(m: PlainMap, e: Effects): void {
	setText(m, "anchor", e.anchor);
	setNumber(m, "opacity", e.opacity, 1);
	if (e.blend !== "normal") {
		m.blend = e.blend;
	}
	if (e.clip !== undefined) {
		m.clip = shape(e.clip);
	}
	if (e.cuts.length > 0) {
		m.cut = e.cuts.map(shape);
	}
}

function line(m: PlainMap, l: ShapedEdge | undefined): void {
	if (l === undefined) {
		return;
	}
	const out: PlainMap = { form: l.kind, depth: l.depth };
	setNumber(out, "period", l.period);
	setNumber(out, "count", l.count);
	m.edge = out;
}

function repeat(r: Repeat): PlainMap {
	const m: PlainMap = { form: r.kind };
	switch (r.kind) {
		case "ring":
		case "arc":
			m.count = r.count;
			m.radius = r.radius;
			setFlag(m, "turn", r.turn);
			if (r.kind === "arc") {
				m.from = r.from;
				m.to = r.to;
			}
			break;
		case "grid":
			m.rows = r.rows;
			m.columns = r.columns;
			setFlag(m, "stagger", r.stagger);
			break;
		case "line":
			m.count = r.count;
			setNumber(m, "fly", r.fly);
			setNumber(m, "hoist", r.hoist);
			break;
	}
	return m;
}

const layers = (list: readonly Layer[]): Plain[] => list.map(layer);

function setAlong(m: PlainMap, along: string): void {
	if (along !== "fly") {
		m.along = along;
	}
}

function setFimbriate(m: PlainMap, e: Fimbriation | undefined): void {
	if (e !== undefined) {
		m.fimbriate = edge(e);
	}
}

function layer(l: Layer): PlainMap {
	const m: PlainMap = { layer: l.layer };
	effects(m, l);
	switch (l.layer) {
		case "field":
			m.color = l.color;
			break;
		case "bars":
			m.colors = [...l.colors];
			m.ratio = [...l.ratio];
			setAlong(m, l.along);
			setNumber(m, "rotate", l.rotate);
			if (l.grow !== undefined) {
				m.grow = [...l.grow];
			}
			line(m, l.edge);
			break;
		case "chevrons":
			m.colors = [...l.colors];
			m.ratio = [...l.ratio];
			m.depth = l.depth;
			if (l.from !== "hoist") {
				m.from = l.from;
			}
			setNumber(m, "angle", l.angle);
			if (l.apex !== undefined) {
				m.apex = l.apex;
			}
			setNumber(m, "rotate", l.rotate);
			setFimbriate(m, l.fimbriate);
			break;
		case "band":
			m.color = l.color;
			m.width = l.width;
			setAlong(m, l.along);
			setNumber(m, "offset", l.offset);
			setNumber(m, "rotate", l.rotate);
			setFimbriate(m, l.fimbriate);
			break;
		case "cross":
			m.color = l.color;
			m.fly = [...l.fly];
			m.hoist = [...l.hoist];
			setFimbriate(m, l.fimbriate);
			break;
		case "saltire":
			m.color = l.color;
			m.width = l.width;
			setFimbriate(m, l.fimbriate);
			setFlag(m, "counterchange", l.counterchange);
			break;
		case "quarters":
			m.colors = [...l.colors];
			setFlag(m, "diagonal", l.diagonal);
			setPoint(m, "split", l.split);
			break;
		case "checks":
			m.colors = [...l.colors];
			m.rows = l.rows;
			m.columns = l.columns;
			if (l.flow !== "bend-sinister") {
				m.flow = l.flow;
			}
			break;
		case "rays":
			m.colors = [...l.colors];
			m.ratio = [...l.ratio];
			if (l.at !== undefined) {
				m.from = point(l.at);
			} else if (l.from !== "center") {
				m.from = l.from;
			}
			setNumber(m, "rotate", l.rotate);
			if (l.measure === "edge") {
				m.measure = "edge";
			}
			break;
		case "charge":
			Object.assign(m, shape(l.shape));
			// A pile or pall is a layer of its own, so it has no shape to name.
			if (l.shape.kind === "pile" || l.shape.kind === "pall") {
				m.layer = l.shape.kind;
				delete m.shape;
			}
			setText(m, "color", l.color);
			setFimbriate(m, l.fimbriate);
			if (l.repeat !== undefined) {
				m.repeat = repeat(l.repeat);
			}
			break;
		case "emblem":
			setPoint(m, "at", l.at);
			if (l.along !== undefined) {
				m.along = l.along;
			}
			setNumber(m, "rotate", l.rotate);
			m.layers = layers(l.charges);
			break;
		case "group":
			m.layers = layers(l.layers);
			break;
		case "panel":
			m.layers = layers(l.layers);
			if (l.canton) {
				m.layer = "canton";
				m.fly = l.fly!;
				m.hoist = l.hoist!;
				break;
			}
			setText(m, "side", l.side);
			setNumber(m, "width", l.width);
			setText(m, "corner", l.corner);
			setPoint(m, "at", l.at);
			setNumber(m, "fly", l.fly);
			setNumber(m, "hoist", l.hoist);
			line(m, l.edge);
			break;
		case "use":
			m.name = l.name;
			break;
	}
	return m;
}

function variant(v: Variant): PlainMap {
	const m: PlainMap = {};
	if (v.from !== "none") {
		m.from = v.from;
	}
	setFlag(m, "upright", v.upright);
	setNumber(m, "ratio", v.ratio);
	if (v.fly) {
		m.proportion = { hoist: v.hoist!, fly: v.fly };
	}
	if (v.outline !== undefined) {
		m.outline = outline(v.outline);
	}
	if (v.border !== undefined) {
		m.border = border(v.border);
	}
	if (v.layers.length > 0) {
		m.layers = layers(v.layers);
	}
	return m;
}

function fold(f: Fold): PlainMap {
	const m: PlainMap = {};
	setText(m, "description", f.description);
	setList(m, "source", f.sources);
	m.steps = f.steps.map((s) => {
		const step: PlainMap = { step: s.kind };
		if (s.written.through !== undefined) {
			step.through = [...s.written.through];
			step.move = [...s.written.moveTo!];
		} else {
			step.along = s.written.along!;
			step.at = s.written.at!;
			step.move = s.written.move!;
		}
		return step;
	});
	return m;
}

function mapOf<T>(items: Record<string, T>, each: (item: T) => PlainMap): PlainMap {
	const out = dict<Plain>();
	for (const name of Object.keys(items)) {
		out[name] = each(items[name] as T);
	}
	return out;
}

/** Gives the flag as plain maps, lists, strings, numbers and booleans, in the canonical form. */
export function model(f: Flag): PlainMap {
	const m: PlainMap = dict<Plain>();
	m.vexyl = f.version;
	m.meta = meta(f.meta);
	m.palette = palette(f);
	m.proportion = { hoist: f.hoist, fly: f.fly };
	if (f.outline !== undefined) {
		m.outline = outline(f.outline);
	}
	if (f.border !== undefined) {
		m.border = border(f.border);
	}
	if (Object.keys(f.defines).length > 0) {
		m.define = mapOf(f.defines, define);
	}
	if (f.layers.length > 0) {
		m.layers = layers(f.layers);
	}
	if (f.reverse !== undefined) {
		m.reverse = { layers: layers(f.reverse.layers) };
	}
	if (f.adapt !== undefined) {
		const adapt: PlainMap = {};
		if (f.adapt.range !== undefined) {
			adapt.range = [...f.adapt.range];
		}
		setText(adapt, "wider", f.adapt.wider);
		setText(adapt, "narrower", f.adapt.narrower);
		m.adapt = adapt;
	}
	if (Object.keys(f.variants).length > 0) {
		m.variant = mapOf(f.variants, variant);
	}
	if (Object.keys(f.folds).length > 0) {
		m.fold = mapOf(f.folds, fold);
	}
	return m;
}
