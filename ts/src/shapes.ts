// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { add, clipConvex, mul, regionCenter, regionCorners, regionReach, rotate, sub, sum, type Geom, type Region, type Vec } from "./geometry.js";
import { maxCopies } from "./limits.js";
import { factor, num } from "./text.js";
import { RenderError } from "./types.js";
import type { Axis, Outline, PallShape, PanelLayer, PathShape, PileShape, Point, PolygonShape, RaysLayer, RingShape, Shape, ShapedEdge, SunShape } from "./types.js";

/** A full circle as a path, which can then have a hole or rays in the same outline. */
export function circlePath(c: Vec, radius: number): string {
	const rs = num(radius);
	return `M${num(c.x - radius)} ${num(c.y)}A${rs} ${rs} 0 1 0 ${num(c.x + radius)} ${num(c.y)}A${rs} ${rs} 0 1 0 ${num(c.x - radius)} ${num(c.y)}Z`;
}

/** An ellipse with the given half sizes, turned clockwise by a rotation. */
export function ellipsePath(c: Vec, x: number, y: number, rotation: number): string {
	const a = sub(c, rotate({ x, y: 0 }, rotation));
	const b = add(c, rotate({ x, y: 0 }, rotation));
	const arc = `A${num(x)} ${num(y)} ${num(rotation)} 1 0`;
	return `M${num(a.x)} ${num(a.y)}${arc} ${num(b.x)} ${num(b.y)}${arc} ${num(a.x)} ${num(a.y)}Z`;
}

/** A heart with its lobes either side of the origin and its tip below. */
export function heartPath(radius: number, spread: number, place: (v: Vec) => Vec): string {
	const half = spread / 2;
	const edge = radius / Math.SQRT2;
	const tip = place({ x: 0, y: half + radius * Math.SQRT2 });
	const right = place({ x: half + edge, y: edge });
	const left = place({ x: -half - edge, y: edge });
	const notch = place({ x: 0, y: -Math.sqrt(radius * radius - half * half) });
	// Each arc runs from 45 degrees below the lobe's side, around to the notch.
	const large = 225 - (Math.acos(half / radius) * 180) / Math.PI > 180 ? 1 : 0;
	const r = num(radius);
	return (
		`M${num(tip.x)} ${num(tip.y)}L${num(right.x)} ${num(right.y)}` +
		`A${r} ${r} 0 ${large} 0 ${num(notch.x)} ${num(notch.y)}` +
		`A${r} ${r} 0 ${large} 0 ${num(left.x)} ${num(left.y)}Z`
	);
}

/** A disc with another cut from it, offset toward the fly. */
export function crescentPath(radius: number, inner: number, offset: number, place: (v: Vec) => Vec): string {
	const x = (radius * radius - inner * inner + offset * offset) / (2 * offset);
	const y = Math.sqrt(Math.max(radius * radius - x * x, 0));
	const top = place({ x, y: -y });
	const bottom = place({ x, y });
	const outerLarge = x > 0 ? 1 : 0;
	const innerLarge = x > offset ? 1 : 0;
	return (
		`M${num(top.x)} ${num(top.y)}` +
		`A${num(radius)} ${num(radius)} 0 ${outerLarge} 0 ${num(bottom.x)} ${num(bottom.y)}` +
		`A${num(inner)} ${num(inner)} 0 ${innerLarge} 1 ${num(top.x)} ${num(top.y)}Z`
	);
}

/** A disc and triangular rays, all wound the same way so that where they overlap stays filled. */
export function sunPath(s: SunShape, center: Vec, place: (v: Vec) => Vec): string {
	const out: string[] = [circlePath(center, s.disc)];
	const base = s.disc + (s.gap ?? 0);
	const step = 360 / s.points;
	const half = (step / 2) * s.spread;
	for (let i = 0; i < s.points; i++) {
		const a = i * step;
		const tip = place(rotate({ x: 0, y: -s.radius }, a));
		const left = place(rotate({ x: 0, y: -base }, a - half));
		const right = place(rotate({ x: 0, y: -base }, a + half));
		out.push(` M${num(right.x)} ${num(right.y)}L${num(tip.x)} ${num(tip.y)}L${num(left.x)} ${num(left.y)}Z`);
	}
	return out.join("");
}

/** Part of a ring, clockwise from one angle to another. */
export function ringArcPath(s: RingShape, center: Vec, rotation: number): string {
	const start = s.arc?.from ?? 0;
	const from = start + rotation;
	// Clockwise from one to the other, by less than a full turn.
	const to = from + ((((s.arc?.to ?? 0) - start) % 360) + 360) % 360;
	const point = (r: number, a: number): Vec => add(center, rotate({ x: 0, y: -r }, a));
	const large = to - from > 180 ? 1 : 0;
	const a = point(s.radius, from);
	const b = point(s.radius, to);
	const c = point(s.inner, to);
	const d = point(s.inner, from);
	return (
		`M${num(a.x)} ${num(a.y)}A${num(s.radius)} ${num(s.radius)} 0 ${large} 1 ${num(b.x)} ${num(b.y)}` +
		`L${num(c.x)} ${num(c.y)}A${num(s.inner)} ${num(s.inner)} 0 ${large} 0 ${num(d.x)} ${num(d.y)}Z`
	);
}

/**
 * Joins a star's points by skipping one each time, which is one closed line for an odd number of
 * points and two for six, as on a hexagram.
 */
export function starChords(n: number, radius: number, place: (v: Vec) => Vec): string {
	const seen = new Array<boolean>(n).fill(false);
	const out: string[] = [];
	const point = (i: number): Vec => place(rotate({ x: 0, y: -radius }, (i * 360) / n));
	for (let start = 0; start < n; start++) {
		if (seen[start]) {
			continue;
		}
		let p = point(start);
		out.push(`M${num(p.x)} ${num(p.y)}`);
		for (let i = (start + 2) % n; i !== start; i = (i + 2) % n) {
			seen[i] = true;
			p = point(i);
			out.push(`L${num(p.x)} ${num(p.y)}`);
		}
		seen[start] = true;
		out.push("Z");
	}
	return out.join("");
}

/** Fits a path's box within a size, keeping its shape, centered on a point. */
export function pathGeom(s: PathShape, center: Vec, rotation: number): Geom {
	let scale = Infinity;
	if (s.fly !== undefined && s.fly > 0) {
		scale = s.fly / s.box[2];
	}
	if (s.hoist !== undefined && s.hoist > 0) {
		scale = Math.min(scale, s.hoist / s.box[3]);
	}
	let transform = `translate(${num(center.x)} ${num(center.y)})`;
	if (rotation !== 0) {
		transform += ` rotate(${num(rotation)})`;
	}
	transform += ` scale(${factor(scale)}) translate(${num(-s.box[0] - s.box[2] / 2)} ${num(-s.box[1] - s.box[3] / 2)})`;
	const geom: Geom = { path: s.d, transform, scale };
	if (s.evenodd) {
		geom.evenodd = true;
	}
	return geom;
}

/** Fills in what a shape takes from the region it's in. */
export function forRegion(s: Shape, r: Region): Shape {
	switch (s.kind) {
		case "lozenge":
			if (s.fly !== undefined && s.fly > 0 && s.hoist !== undefined && s.hoist > 0) {
				return s;
			}
			return { ...s, fly: s.fly || r.w, hoist: s.hoist || r.h };
		case "pile":
			return asPolygon(s, pilePoints(s, r));
		case "pall":
			return asPolygon(s, pallPoints(s, r));
		default:
			return s;
	}
}

function asPolygon(s: PileShape | PallShape, vertices: Point[]): PolygonShape {
	const polygon: PolygonShape = { kind: "polygon", rotate: s.rotate, vertices };
	if (s.hollow !== undefined) {
		polygon.hollow = s.hollow;
	}
	return polygon;
}

/** Maps a distance in from an edge and a distance along it to a point. */
function edgeFrame(edge: string, r: Region): { place: (inward: number, along: number) => Point; length: number } {
	switch (edge) {
		case "fly":
			return { place: (inward, along) => ({ fly: r.w - inward, hoist: along }), length: r.h };
		case "top":
			return { place: (inward, along) => ({ fly: along, hoist: inward }), length: r.w };
		case "bottom":
			return { place: (inward, along) => ({ fly: along, hoist: r.h - inward }), length: r.w };
		default:
			return { place: (inward, along) => ({ fly: inward, hoist: along }), length: r.h };
	}
}

/** Continues a pile's sides back past its edge, so that fimbriation doesn't run along the flag's edge. */
export function pilePoints(s: PileShape, r: Region): Point[] {
	const { place, length } = edgeFrame(s.from, r);
	const a = s.base !== undefined ? s.base[0] : 0;
	const b = s.base !== undefined ? s.base[1] : length;
	let depth = s.depth ?? 0;
	let along = (a + b) / 2;
	if (s.tip !== undefined) {
		along = s.tip[0];
		depth = s.tip[1];
	}
	const flat = s.flat ?? 0;
	const lo = along - flat / 2;
	const hi = along + flat / 2;
	const back = regionReach(r);
	const backA = a - ((lo - a) * back) / depth;
	const backB = b + ((b - hi) * back) / depth;
	return [place(-back, backA), place(depth, lo), place(depth, hi), place(-back, backB)];
}

/** Outlines a Y whose arms run from the corners of its edge to a junction, then on as one stem. */
export function pallPoints(s: PallShape, r: Region): Point[] {
	const { place, length } = edgeFrame(s.from, r);
	const far = s.from === "top" || s.from === "bottom" ? r.h : r.w;
	const junction = s.junction || length / 2;
	const half = s.width / 2;
	const mid = length / 2;
	const reach = regionReach(r) + s.width;
	const l = Math.hypot(junction, mid);
	const dirIn = junction / l;
	const dirAlong = mid / l;
	// The upper arm runs along direction (dirIn, dirAlong) from the corner at along=0 to the
	// junction, in coordinates of (in, along from the center line).
	const normalIn = dirAlong;
	const normalAlong = -dirIn;
	const line = (offset: number, targetAlong: number): number => {
		// Where the arm's edge at an offset reaches a distance from the center line.
		const startIn = normalIn * offset;
		const startAlong = -mid + normalAlong * offset;
		return startIn + ((targetAlong - startAlong) * dirIn) / dirAlong;
	};
	const shoulder = line(half, -half);
	const notch = line(-half, 0);
	const farOuterIn = normalIn * half - dirIn * reach;
	const farOuterAlong = -mid + normalAlong * half - dirAlong * reach;
	const farInnerIn = -normalIn * half - dirIn * reach;
	const farInnerAlong = -mid - normalAlong * half - dirAlong * reach;
	const at = (inward: number, fromCenter: number): Point => place(inward, mid + fromCenter);
	return [
		at(farOuterIn, farOuterAlong),
		at(shoulder, -half),
		at(far + reach, -half),
		at(far + reach, half),
		at(shoulder, half),
		at(farOuterIn, -farOuterAlong),
		at(farInnerIn, -farInnerAlong),
		at(notch, 0),
		at(farInnerIn, farInnerAlong),
	];
}

/** An outline's corners, or null if it's curved. */
export function outlinePoints(o: Outline, w: number, h: number): Vec[] | null {
	switch (o.kind) {
		case "polygon":
			return o.vertices.map((p) => ({ x: p.fly, y: p.hoist }));
		case "swallowtail": {
			const taper = o.taper ?? 0;
			return [
				{ x: 0, y: 0 },
				{ x: w, y: taper },
				{ x: w - o.depth, y: h / 2 },
				{ x: w, y: h - taper },
				{ x: 0, y: h },
			];
		}
		case "tongued": {
			const a = (h - o.tongue) / 2;
			return [
				{ x: 0, y: 0 },
				{ x: w, y: 0 },
				{ x: w - o.depth, y: a },
				{ x: w, y: h / 2 },
				{ x: w - o.depth, y: h - a },
				{ x: w, y: h },
				{ x: 0, y: h },
			];
		}
		case "pennant": {
			const tip = o.tip ?? 0;
			if (tip === 0) {
				return [
					{ x: 0, y: 0 },
					{ x: w, y: h / 2 },
					{ x: 0, y: h },
				];
			}
			const a = (h - tip) / 2;
			return [
				{ x: 0, y: 0 },
				{ x: w, y: a },
				{ x: w, y: h - a },
				{ x: 0, y: h },
			];
		}
		default:
			return null;
	}
}

/** Resolves an outline for painting and clipping. */
export function outlineGeom(o: Outline, w: number, h: number): Geom {
	if (o.kind !== "path") {
		return { poly: outlinePoints(o, w, h) ?? [] };
	}
	// A flag's own curved outline is stretched to its box.
	const sx = w / o.box[2];
	const sy = h / o.box[3];
	return { path: o.d, scale: 1, transform: `scale(${factor(sx)} ${factor(sy)}) translate(${num(-o.box[0])} ${num(-o.box[1])})` };
}

/** Samples a wavy or zigzag line along a span, as distances along it and displacements from it. */
export function linePoints(l: ShapedEdge, span: number): { along: number[]; offset: number[] } {
	let period = l.period ?? 0;
	if (l.count !== undefined && l.count > 0) {
		period = span / l.count;
	}
	if (span / period > maxCopies) {
		throw new RenderError(`a shaped edge can't have more than ${maxCopies} waves`);
	}
	const half = l.depth / 2;
	const along: number[] = [];
	const offset: number[] = [];
	if (l.kind === "zigzag") {
		let sign = -1;
		for (let s = 0; s <= span + period / 4; s += period / 2) {
			along.push(s);
			offset.push(sign * half);
			sign = -sign;
		}
		return { along, offset };
	}
	const perWave = 24;
	for (let s = 0; s <= span + period / perWave / 2; s += period / perWave) {
		along.push(s);
		offset.push(half * Math.sin((2 * Math.PI * s) / period));
	}
	return { along, offset };
}

/** A shaped line across a region, in a direction at an offset along a normal, flat past both ends. */
export function waveEdge(c: Vec, dir: Vec, normal: Vec, t: number, span: number, reach: number, l: ShapedEdge): Vec[] {
	const { along, offset } = linePoints(l, span);
	const points: Vec[] = [sub(add(c, mul(normal, t + offset[0]!)), mul(dir, reach))];
	along.forEach((s, i) => {
		points.push(add(add(c, mul(normal, t + offset[i]!)), mul(dir, s - span / 2)));
	});
	points.push(add(add(c, mul(normal, t + offset[offset.length - 1]!)), mul(dir, reach)));
	return points;
}

/** How far an axis runs across a region. */
export function axisSpan(r: Region, along: Axis): number {
	switch (along) {
		case "fly":
			return r.w;
		case "hoist":
			return r.h;
		default:
			return regionReach(r);
	}
}

/** One wedge per color, each with an angle under 180 degrees or split so that it clips cleanly. */
export function rayPolys(l: RaysLayer, r: Region): Vec[][] {
	const { apex, from: start, sweep, walk } = rayFrame(l, r);
	if (l.measure === "edge") {
		return rayPolysByEdge(l, r, apex, walk);
	}
	const from = start + l.rotate;
	const total = sum(l.ratio);
	const reach = regionReach(r) + Math.hypot(apex.x - r.w / 2, apex.y - r.h / 2);
	const polys: Vec[][] = [];
	let a = from;
	for (const part of l.ratio) {
		const width = (sweep * part) / total;
		const steps = Math.ceil(width / 60);
		const poly: Vec[] = [apex];
		for (let i = 0; i <= steps; i++) {
			poly.push(add(apex, rotate({ x: 0, y: -reach * 2 }, a + (width * i) / steps)));
		}
		polys.push(clipConvex(poly, r));
		a += width;
	}
	return polys;
}

/** Shares the region's far edges out by length, going clockwise. */
function rayPolysByEdge(l: RaysLayer, r: Region, apex: Vec, path: Vec[]): Vec[][] {
	let length = 0;
	for (let i = 1; i < path.length; i++) {
		length += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
	}
	const total = sum(l.ratio);
	// From outside the region, a wedge would cover what's between the point and the region.
	const outside = apex.x < 0 || apex.x > r.w || apex.y < 0 || apex.y > r.h;
	const polys: Vec[][] = [];
	let leg = 0;
	let into = 0;
	let at = path[0]!;
	for (const part of l.ratio) {
		let remaining = (length * part) / total;
		let poly: Vec[] = [apex, at];
		while (remaining > 1e-9 && leg < path.length - 1) {
			const next = path[leg + 1]!;
			const legLength = Math.hypot(next.x - path[leg]!.x, next.y - path[leg]!.y);
			const left = legLength - into;
			if (remaining < left) {
				into += remaining;
				at = add(path[leg]!, mul(sub(next, path[leg]!), into / legLength));
				remaining = 0;
				break;
			}
			remaining -= left;
			at = next;
			poly.push(at);
			leg++;
			into = 0;
		}
		if (remaining === 0) {
			poly.push(at);
		}
		if (outside) {
			poly = clipConvex(poly, r);
		}
		polys.push(poly);
	}
	return polys;
}

/** Where rays start: a named point, or one given by position. */
function rayPoint(l: RaysLayer, r: Region): Vec {
	if (l.at !== undefined) {
		return { x: l.at.fly, y: l.at.hoist };
	}
	switch (l.from) {
		case "upper-hoist":
			return { x: 0, y: 0 };
		case "lower-hoist":
			return { x: 0, y: r.h };
		case "upper-fly":
			return { x: r.w, y: 0 };
		case "lower-fly":
			return { x: r.w, y: r.h };
		case "hoist":
			return { x: 0, y: r.h / 2 };
		case "fly":
			return { x: r.w, y: r.h / 2 };
		case "top":
			return { x: r.w / 2, y: 0 };
		case "bottom":
			return { x: r.w / 2, y: r.h };
		default:
			return regionCenter(r);
	}
}

/**
 * Finds where rays start, the angle they cover going clockwise from up, and the region's far
 * edges, which are the ones the point is inside of, walked clockwise.
 */
export function rayFrame(l: RaysLayer, r: Region): { apex: Vec; from: number; sweep: number; walk: Vec[] } {
	const apex = rayPoint(l, r);
	const corners = regionCorners(r);
	// Edge i runs clockwise from corner i: the top, the fly, the bottom and the hoist.
	const inward: Vec[] = [{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }];
	const far = corners.map((c, i) => (apex.x - c.x) * inward[i]!.x + (apex.y - c.y) * inward[i]!.y > 0);
	let first = -1;
	for (let i = 0; i < 4; i++) {
		if (far[i] && !far[(i + 3) % 4]) {
			first = i;
		}
	}
	if (first < 0) {
		// Every edge is far, so the point is inside, and the rays go all the way round from up.
		const top = { x: apex.x, y: 0 };
		return { apex, from: 0, sweep: 360, walk: [top, corners[1]!, corners[2]!, corners[3]!, corners[0]!, top] };
	}
	const walk = [corners[first]!];
	for (let i = first; far[i % 4]; i++) {
		walk.push(corners[(i + 1) % 4]!);
	}
	const from = bearing(sub(walk[0]!, apex));
	const sweep = (bearing(sub(walk[walk.length - 1]!, apex)) - from + 360) % 360;
	return { apex, from, sweep, walk };
}

/** A direction's angle clockwise from up, exactly for the four straight ones. */
function bearing(v: Vec): number {
	if (v.x === 0 && v.y < 0) {
		return 0;
	}
	if (v.y === 0 && v.x > 0) {
		return 90;
	}
	if (v.x === 0 && v.y > 0) {
		return 180;
	}
	if (v.y === 0 && v.x < 0) {
		return 270;
	}
	return ((Math.atan2(v.x, -v.y) * 180) / Math.PI + 360) % 360;
}

/** A panel's place in its parent, in the parent's coordinates: x, y, width and height. */
export function panelRect(p: PanelLayer, r: Region): [number, number, number, number] {
	const extra = p.edge !== undefined ? p.edge.depth / 2 : 0;
	const width = p.width ?? 0;
	const fly = p.fly ?? 0;
	const hoist = p.hoist ?? 0;
	switch (p.side) {
		case "hoist":
			return [0, 0, width + extra, r.h];
		case "fly":
			return [r.w - width - extra, 0, width + extra, r.h];
		case "top":
			return [0, 0, r.w, width + extra];
		case "bottom":
			return [0, r.h - width - extra, r.w, width + extra];
	}
	switch (p.corner) {
		case "upper-hoist":
			return [0, 0, fly, hoist];
		case "upper-fly":
			return [r.w - fly, 0, fly, hoist];
		case "lower-hoist":
			return [0, r.h - hoist, fly, hoist];
		case "lower-fly":
			return [r.w - fly, r.h - hoist, fly, hoist];
	}
	const at = p.at !== undefined ? { x: p.at.fly, y: p.at.hoist } : regionCenter(r);
	return [at.x - fly / 2, at.y - hoist / 2, fly, hoist];
}

/** A panel's outline when it has a shaped edge, in its own coordinates. */
export function panelEdge(p: PanelLayer, w: number, h: number): Vec[] {
	const edge = p.edge!;
	const { along, offset } = linePoints(edge, p.side === "hoist" || p.side === "fly" ? h : w);
	const half = edge.depth / 2;
	const points: Vec[] = [];
	switch (p.side) {
		case "hoist":
			points.push({ x: 0, y: 0 });
			along.forEach((s, i) => points.push({ x: w - half + offset[i]!, y: s }));
			points.push({ x: 0, y: h });
			break;
		case "fly":
			points.push({ x: w, y: 0 });
			along.forEach((s, i) => points.push({ x: half - offset[i]!, y: s }));
			points.push({ x: w, y: h });
			break;
		case "top":
			points.push({ x: 0, y: 0 });
			along.forEach((s, i) => points.push({ x: s, y: h - half + offset[i]! }));
			points.push({ x: w, y: 0 });
			break;
		default:
			points.push({ x: 0, y: h });
			along.forEach((s, i) => points.push({ x: s, y: half - offset[i]! }));
			points.push({ x: w, y: h });
	}
	return points;
}
