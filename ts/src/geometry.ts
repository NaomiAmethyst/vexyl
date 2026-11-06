// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { axisSpan, crescentPath, ellipsePath, heartPath, outlinePoints, pathGeom, ringArcPath, starChords, sunPath, waveEdge } from "./shapes.js";
import type { Axis, BarsLayer, ChevronsLayer, CrossLayer, Flag, Shape } from "./types.js";

export interface Vec {
	x: number;
	y: number;
}

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;

export function rotate(a: Vec, degrees: number): Vec {
	const radians = (degrees * Math.PI) / 180;
	const s = Math.sin(radians);
	const c = Math.cos(radians);
	return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/**
 * A rectangle with its origin at the current coordinate origin. An emblem's frame has no size, and
 * its center is its origin; `local` is then how far its content could need to reach to cover
 * everything visible.
 */
export interface Region {
	w: number;
	h: number;
	local?: number;
}

/** The rectangle a mask has to cover. */
export function regionBounds(r: Region): [number, number, number, number] {
	if (r.local !== undefined && r.local > 0) {
		return [-r.local, -r.local, 2 * r.local, 2 * r.local];
	}
	return [0, 0, r.w, r.h];
}

export const regionCenter = (r: Region): Vec => ({ x: r.w / 2, y: r.h / 2 });
export const regionReach = (r: Region): number => Math.hypot(r.w, r.h);
export const regionCorners = (r: Region): [Vec, Vec, Vec, Vec] => [
	{ x: 0, y: 0 },
	{ x: r.w, y: 0 },
	{ x: r.w, y: r.h },
	{ x: 0, y: r.h },
];

export function rectPoly(x0: number, y0: number, x1: number, y1: number): Vec[] {
	return [
		{ x: x0, y: y0 },
		{ x: x1, y: y0 },
		{ x: x1, y: y1 },
		{ x: x0, y: y1 },
	];
}

/** The flag's shape before any outside border, or null if its outline is curved. */
export function boundary(f: Pick<Flag, "fly" | "hoist" | "outline">): Vec[] | null {
	if (f.outline === undefined) {
		return rectPoly(0, 0, f.fly, f.hoist);
	}
	return outlinePoints(f.outline, f.fly, f.hoist);
}

/**
 * Moves a polygon's edges outward by a distance, keeping its angles mitered. It throws on polygons
 * with no area, repeated points or edges that fold back on themselves, where outward has no meaning.
 */
export function offsetPolygon(poly: Vec[], distance: number): Vec[] {
	let area = 0;
	poly.forEach((p, i) => {
		const q = poly[(i + 1) % poly.length]!;
		area += p.x * q.y - q.x * p.y;
	});
	if (area === 0) {
		throw new Error("shape has no area, so it can't have an outside border");
	}
	const side = area < 0 ? -1 : 1;
	const normal = (a: Vec, b: Vec): Vec | null => {
		const l = Math.hypot(b.x - a.x, b.y - a.y);
		return l === 0 ? null : { x: (side * (b.y - a.y)) / l, y: (-side * (b.x - a.x)) / l };
	};
	return poly.map((p, i) => {
		const n1 = normal(poly[(i + poly.length - 1) % poly.length]!, p);
		const n2 = normal(p, poly[(i + 1) % poly.length]!);
		if (n1 === null || n2 === null) {
			throw new Error("shape repeats a point, so it can't have an outside border");
		}
		const turn = 1 + dot(n1, n2);
		if (turn < 1e-9) {
			throw new Error("shape folds back on itself, so it can't have an outside border");
		}
		return add(p, mul(add(n1, n2), distance / turn));
	});
}

/** The direction of an axis, and the normal that bars are listed along. */
export function axis(r: Region, along: Axis | undefined, rotation: number): { dir: Vec; normal: Vec } {
	const l = regionReach(r);
	let dir: Vec;
	let normal: Vec;
	switch (along) {
		case "hoist":
			dir = { x: 0, y: 1 };
			normal = { x: 1, y: 0 };
			break;
		case "bend":
			dir = { x: r.w / l, y: r.h / l };
			normal = { x: r.h / l, y: -r.w / l };
			break;
		case "bend-sinister":
			dir = { x: r.w / l, y: -r.h / l };
			normal = { x: r.h / l, y: r.w / l };
			break;
		default:
			dir = { x: 1, y: 0 };
			normal = { x: 0, y: 1 };
	}
	return { dir: rotate(dir, rotation), normal: rotate(normal, rotation) };
}

/** Clips a convex polygon to a region (Sutherland-Hodgman). */
export function clipConvex(input: Vec[], r: Region): Vec[] {
	type Edge = { inside: (v: Vec) => boolean; cross: (a: Vec, b: Vec) => Vec };
	const atX = (x: number) => (a: Vec, b: Vec): Vec => ({ x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) });
	const atY = (y: number) => (a: Vec, b: Vec): Vec => ({ x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y), y });
	const edges: Edge[] = [
		{ inside: (v) => v.x >= 0, cross: atX(0) },
		{ inside: (v) => v.x <= r.w, cross: atX(r.w) },
		{ inside: (v) => v.y >= 0, cross: atY(0) },
		{ inside: (v) => v.y <= r.h, cross: atY(r.h) },
	];
	let poly = input;
	for (const e of edges) {
		const out: Vec[] = [];
		poly.forEach((cur, i) => {
			const prev = poly[(i + poly.length - 1) % poly.length]!;
			if (e.inside(cur) && e.inside(prev)) {
				out.push(cur);
			} else if (e.inside(cur)) {
				out.push(e.cross(prev, cur), cur);
			} else if (e.inside(prev)) {
				out.push(e.cross(prev, cur));
			}
		});
		poly = out;
	}
	return poly;
}

/**
 * One polygon per bar. Each runs from its bar's start to the far side of the region, so the next
 * bar paints over it and antialiasing can't leave a seam showing what's beneath. A gradient spans
 * the shape it fills, so a bar for which `exact` returns true stays its true width.
 */
export function barPolys(b: BarsLayer, r: Region, exact?: (i: number) => boolean): Vec[][] {
	const { dir, normal } = axis(r, b.along, b.rotate);
	const c = regionCenter(r);
	let lo = Infinity;
	let hi = -Infinity;
	for (const corner of regionCorners(r)) {
		const offset = dot(sub(corner, c), normal);
		lo = Math.min(lo, offset);
		hi = Math.max(hi, offset);
	}
	const total = sum(b.ratio);
	const reach = regionReach(r);
	const polys: Vec[][] = [];
	let t = lo;
	b.ratio.forEach((part, i) => {
		const next = t + ((hi - lo) * part) / total;
		let end = hi;
		const isExact = exact !== undefined && exact(i);
		if (isExact) {
			end = next;
		}
		if (b.edge === undefined) {
			polys.push(clipConvex(stripPoly(c, dir, normal, t, end, reach), r));
			t = next;
			return;
		}
		// A shaped edge isn't convex, so clipping is left to the region's own clip.
		const margin = b.edge.depth + 1;
		let near = [
			sub(add(c, mul(normal, lo - margin)), mul(dir, reach)),
			add(add(c, mul(normal, lo - margin)), mul(dir, reach)),
		];
		if (i > 0) {
			near = waveEdge(c, dir, normal, t, axisSpan(r, b.along), reach, b.edge);
		}
		let far = [
			add(add(c, mul(normal, hi + margin)), mul(dir, reach)),
			sub(add(c, mul(normal, hi + margin)), mul(dir, reach)),
		];
		if (isExact && i < b.ratio.length - 1) {
			far = waveEdge(c, dir, normal, next, axisSpan(r, b.along), reach, b.edge).reverse();
		}
		polys.push([...near, ...far]);
		t = next;
	});
	return polys;
}

export function sum(parts: readonly number[]): number {
	let total = 0;
	for (const part of parts) {
		total += part;
	}
	return total;
}

/** The rectangle between two offsets along a normal. */
export function stripPoly(c: Vec, dir: Vec, normal: Vec, t0: number, t1: number, reach: number): Vec[] {
	return [
		sub(add(c, mul(normal, t0)), mul(dir, reach)),
		add(add(c, mul(normal, t0)), mul(dir, reach)),
		add(add(c, mul(normal, t1)), mul(dir, reach)),
		sub(add(c, mul(normal, t1)), mul(dir, reach)),
	];
}

/** One polygon per color, from the outermost inward, which is the order they paint in. */
export function chevronPolys(ch: ChevronsLayer, r: Region): Vec[][] {
	return rawChevrons(ch, r).nested.map((poly) => clipConvex(poly, r));
}

/**
 * Each chevron's polygon reaching well past the region, and each chevron alone between its apex and
 * the next, for when gaps have to show.
 */
export function rawChevrons(ch: ChevronsLayer, r: Region): { nested: Vec[][]; bands: Vec[][] } {
	let origin: Vec;
	let u: Vec;
	let v: Vec;
	let edge: number;
	switch (ch.from) {
		case "fly":
			origin = { x: r.w, y: r.h / 2 };
			u = { x: -1, y: 0 };
			v = { x: 0, y: 1 };
			edge = r.h;
			break;
		case "top":
			origin = { x: r.w / 2, y: 0 };
			u = { x: 0, y: 1 };
			v = { x: 1, y: 0 };
			edge = r.w;
			break;
		case "bottom":
			origin = { x: r.w / 2, y: r.h };
			u = { x: 0, y: -1 };
			v = { x: 1, y: 0 };
			edge = r.w;
			break;
		default:
			origin = { x: 0, y: r.h / 2 };
			u = { x: 1, y: 0 };
			v = { x: 0, y: 1 };
			edge = r.h;
	}
	let reach = regionReach(r);
	if (ch.apex !== undefined) {
		const shift = ch.apex - edge / 2;
		origin = add(origin, mul(v, shift));
		reach += Math.abs(shift);
	}
	let run = ch.depth;
	if (ch.angle !== undefined && ch.angle !== 0) {
		run = edge / 2 / Math.tan((ch.angle * Math.PI) / 180);
	}
	const slope = run / (edge / 2);
	const total = sum(ch.ratio);
	const apexes: number[] = [];
	let running = 0;
	for (const part of ch.ratio) {
		running += part;
		apexes.push((ch.depth * running) / total);
	}
	const center = regionCenter(r);
	const place = (pu: number, pv: number): Vec => {
		const point = add(add(origin, mul(u, pu)), mul(v, pv));
		return add(center, rotate(sub(point, center), ch.rotate));
	};
	const nested: Vec[][] = [];
	const bands: Vec[][] = [];
	for (let i = apexes.length - 1; i >= 0; i--) {
		const a = apexes[i]!;
		const armEnd = a - slope * reach;
		const back = Math.min(armEnd, 0) - reach;
		const poly = [place(a, 0), place(armEnd, reach), place(back, reach), place(back, -reach), place(armEnd, -reach)];
		nested.push(poly);
		if (i === 0) {
			bands.push(poly);
			continue;
		}
		const inner = apexes[i - 1]!;
		const innerEnd = inner - slope * reach;
		bands.push([
			place(a, 0),
			place(armEnd, reach),
			place(innerEnd, reach),
			place(inner, 0),
			place(innerEnd, -reach),
			place(armEnd, -reach),
		]);
	}
	return { nested, bands };
}

/**
 * A band's rectangle. It's clipped to the region unless it will be stroked, since a clipped
 * polygon's new edges would pick up fimbriation.
 */
export function bandPoly(r: Region, along: Axis, rotation: number, width: number, offset: number, stroked: boolean): Vec[] {
	const { dir, normal } = axis(r, along, rotation);
	const poly = stripPoly(regionCenter(r), dir, normal, offset - width / 2, offset + width / 2, regionReach(r));
	return stroked ? poly : clipConvex(poly, r);
}

/** A cross's vertical and horizontal arms, with their ends extended by a distance. */
export function crossPolys(c: CrossLayer, r: Region, extend: number): [Vec[], Vec[]] {
	const [a, w, b] = c.fly;
	const x0 = (r.w * a) / (a + w + b);
	const x1 = (r.w * (a + w)) / (a + w + b);
	const [d, h, e] = c.hoist;
	const y0 = (r.h * d) / (d + h + e);
	const y1 = (r.h * (d + h)) / (d + h + e);
	return [rectPoly(x0, -extend, x1, r.h + extend), rectPoly(-extend, y0, r.w + extend, y1)];
}

/** A shape resolved to coordinates. */
export interface Geom {
	circle?: boolean;
	ring?: boolean;
	c?: Vec;
	r?: number;
	inner?: number;
	poly?: Vec[];
	/** SVG path data, for shapes that polygons can't draw exactly. */
	path?: string;
	evenodd?: boolean;
	/** Places a path, whose scale strokes have to allow for. */
	transform?: string;
	scale?: number;
}

export function position(s: Shape, r: Region): Vec {
	return s.at === undefined ? regionCenter(r) : { x: s.at.fly, y: s.at.hoist };
}

/** Resolves a shape at a center, with its rotation added to the extra. */
export function shapeGeom(s: Shape, center: Vec, extra: number): Geom {
	const rotation = s.rotate + extra;
	const place = (p: Vec): Vec => add(center, rotate(p, rotation));
	switch (s.kind) {
		case "disc":
			return { circle: true, c: center, r: s.radius };
		case "ring":
			if (s.arc !== undefined) {
				return { path: ringArcPath(s, center, rotation) };
			}
			return { ring: true, c: center, r: s.radius, inner: s.inner };
		case "rect": {
			const x = s.fly / 2;
			const y = s.hoist / 2;
			return { poly: rectPoly(-x, -y, x, y).map(place) };
		}
		case "plus": {
			const a = s.radius;
			const w = s.width / 2;
			const points: [number, number][] = [
				[-w, -a], [w, -a], [w, -w], [a, -w], [a, w], [w, w],
				[w, a], [-w, a], [-w, w], [-a, w], [-a, -w], [-w, -w],
			];
			return { poly: points.map(([x, y]) => place({ x, y })) };
		}
		case "triangle":
			return { poly: starPoints(3, s.radius, 0).map(place) };
		case "star":
			if (s.lines !== undefined && s.lines > 0) {
				return { path: starChords(s.points, s.radius, place) };
			}
			return { poly: starPoints(s.points, s.radius, s.inner).map(place) };
		case "heart":
			return { path: heartPath(s.radius, s.spread, place) };
		case "crescent":
			return { path: crescentPath(s.radius, s.inner, s.offset, place) };
		case "sun":
			return { path: sunPath(s, center, place) };
		case "lozenge": {
			const x = (s.fly ?? 0) / 2;
			const y = (s.hoist ?? 0) / 2;
			return {
				poly: [
					{ x: 0, y: -y },
					{ x, y: 0 },
					{ x: 0, y },
					{ x: -x, y: 0 },
				].map(place),
			};
		}
		case "ellipse":
			return { path: ellipsePath(center, s.fly / 2, s.hoist / 2, rotation) };
		case "path":
			return pathGeom(s, center, rotation);
		case "cardioid":
			return { poly: cardioidPoints(s.radius).map(place) };
		case "polygon":
			return { poly: s.vertices.map((p) => ({ x: p.fly, y: p.hoist })) };
		default:
			return {};
	}
}

/** Lays out n outer points clockwise from up. An inner radius of 0 gives a regular polygon. */
export function starPoints(n: number, radius: number, inner: number): Vec[] {
	const points: Vec[] = [];
	const step = 360 / n;
	for (let i = 0; i < n; i++) {
		const a = i * step;
		points.push(rotate({ x: 0, y: -radius }, a));
		if (inner > 0) {
			points.push(rotate({ x: 0, y: -inner }, a + step / 2));
		}
	}
	return points;
}

/**
 * Samples a cardioid with its cusp at the origin and its lobe below. 180 segments keep the error
 * under the format's tolerance for any radius up to the flag's hoist.
 */
export function cardioidPoints(radius: number): Vec[] {
	const segments = 180;
	const points: Vec[] = [];
	for (let i = 0; i < segments; i++) {
		const t = (2 * Math.PI * i) / segments;
		const rho = (radius * (1 - Math.cos(t))) / 2;
		points.push({ x: rho * Math.sin(t), y: -rho * Math.cos(t) });
	}
	return points;
}
