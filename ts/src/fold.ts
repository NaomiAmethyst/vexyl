// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { add, boundary, dot, mul, offsetPolygon, rectPoly, sub, type Vec } from "./geometry.js";
import { maxFacets } from "./limits.js";
import type { Flag, Fold } from "./types.js";

/** Maps (x, y) to (a*x + c*y + e, b*x + d*y + f), as SVG writes it. */
export interface Matrix {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

export function apply(m: Matrix, p: Vec): Vec {
	return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** The transform that applies m, followed by n. */
export function then(m: Matrix, n: Matrix): Matrix {
	return {
		a: n.a * m.a + n.c * m.b,
		b: n.b * m.a + n.d * m.b,
		c: n.a * m.c + n.c * m.d,
		d: n.b * m.c + n.d * m.d,
		e: n.a * m.e + n.c * m.f + n.e,
		f: n.b * m.e + n.d * m.f + n.f,
	};
}

/** Reflects across the line through a and b. */
function reflection(a: Vec, b: Vec): Matrix {
	const d = sub(b, a);
	const l = dot(d, d);
	const cos = (d.x * d.x - d.y * d.y) / l;
	const sin = (2 * d.x * d.y) / l;
	return { a: cos, b: sin, c: sin, d: -cos, e: a.x - cos * a.x - sin * a.y, f: a.y - sin * a.x + cos * a.y };
}

/**
 * A flat piece of the folded flag. Its polygon is where it now lies, and its transform takes the
 * flag's coordinates there. Facets are kept from back to front, and flipped ones show the flag's
 * other side.
 */
export interface Facet {
	poly: Vec[];
	place: Matrix;
	flipped: boolean;
}

/** Keeps the part of a polygon on one side of a line. */
function halfPlane(poly: Vec[], a: Vec, b: Vec, side: number): Vec[] {
	const d = sub(b, a);
	const value = (p: Vec): number => side * (d.x * (p.y - a.y) - d.y * (p.x - a.x));
	const out: Vec[] = [];
	poly.forEach((cur, i) => {
		const prev = poly[(i + poly.length - 1) % poly.length]!;
		const vc = value(cur);
		const vp = value(prev);
		if (vc >= 0 !== vp >= 0) {
			out.push(add(prev, mul(sub(cur, prev), vp / (vp - vc))));
		}
		if (vc >= 0) {
			out.push(cur);
		}
	});
	return out;
}

function polyArea(poly: Vec[]): number {
	let total = 0;
	poly.forEach((p, i) => {
		const q = poly[(i + 1) % poly.length]!;
		total += p.x * q.y - q.x * p.y;
	});
	return Math.abs(total) / 2;
}

/** Folds a flat shape through a number of steps, or all of them if that's 0. */
export function foldFacets(shape: Vec[], fold: Fold, steps: number): Facet[] {
	let stack: Facet[] = [{ poly: shape, place: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, flipped: false }];
	const limit = polyArea(shape) * 1e-9;
	for (let i = 0; i < fold.steps.length; i++) {
		if (steps > 0 && i === steps) {
			break;
		}
		const step = fold.steps[i]!;
		const a = { x: step.through[0].fly, y: step.through[0].hoist };
		const b = { x: step.through[1].fly, y: step.through[1].hoist };
		const moving = { x: step.moving.fly, y: step.moving.hoist };
		const d = sub(b, a);
		const raw = d.x * (moving.y - a.y) - d.y * (moving.x - a.x);
		if (raw === 0 || dot(d, d) === 0) {
			throw new Error(`fold step ${i + 1}: its point to move is on its crease`);
		}
		const side = raw < 0 ? -1 : 1;
		const mirror = reflection(a, b);
		const kept: Facet[] = [];
		const moved: Facet[] = [];
		for (const f of stack) {
			const stays = halfPlane(f.poly, a, b, -side);
			if (polyArea(stays) > limit) {
				kept.push({ poly: stays, place: f.place, flipped: f.flipped });
			}
			const goes = halfPlane(f.poly, a, b, side);
			if (polyArea(goes) > limit) {
				moved.push({ poly: goes.map((p) => apply(mirror, p)), place: then(f.place, mirror), flipped: !f.flipped });
			}
		}
		if (moved.length === 0) {
			throw new Error(`fold step ${i + 1}: nothing is on the side it moves`);
		}
		if (kept.length === 0) {
			throw new Error(`fold step ${i + 1}: nothing is left on the other side of its crease`);
		}
		if (kept.length + moved.length > maxFacets) {
			throw new Error(`fold step ${i + 1}: makes more than ${maxFacets} pieces`);
		}
		// Whichever way it goes, the moving stack lands in reverse order.
		moved.reverse();
		if (step.kind === "over") {
			stack = [...kept, ...moved];
		} else if (step.kind === "under") {
			stack = [...moved, ...kept];
		} else {
			// A tuck goes inside the fold, out of sight.
			stack = kept;
		}
	}
	return stack;
}

/** The flat shape a flag folds as, including an outside border. */
export function foldShape(f: Pick<Flag, "fly" | "hoist" | "outline" | "border">): Vec[] {
	// A curved outline folds as its rectangle, with the flag's own clip inside.
	const shape = boundary(f) ?? rectPoly(0, 0, f.fly, f.hoist);
	return f.border?.side === "outside" ? offsetPolygon(shape, f.border.width) : shape;
}
