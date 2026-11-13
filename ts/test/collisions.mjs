// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// How a construction sheet's labels collide: with each other, with the sheet's edge, and with the
// drawing they'd hide. The corpus counts these over every flag, and a sheet can be checked alone.

import { labelOverlap } from "../dist/construction.js";

/** How much two boxes overlap, as an area, so that boxes that only touch don't count. */
const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** Whether one box holds another, to half a unit. */
const holds = (outer, b) => b.x0 >= outer.x0 - 0.5 && b.x1 <= outer.x1 + 0.5 && b.y0 >= outer.y0 - 0.5 && b.y1 <= outer.y1 + 0.5;

/** A label's corners, in order around it, a unit inside it, so that a line that only grazes it doesn't count. */
function cornersOf(a) {
	const c = a.corners ?? [{ x: a.x0, y: a.y0 }, { x: a.x1, y: a.y0 }, { x: a.x1, y: a.y1 }, { x: a.x0, y: a.y1 }];
	const mx = c.reduce((s, p) => s + p.x, 0) / c.length;
	const my = c.reduce((s, p) => s + p.y, 0) / c.length;
	return c.map((p) => {
		const d = Math.hypot(p.x - mx, p.y - my);
		return d < 1 ? p : { x: p.x + (mx - p.x) / d, y: p.y + (my - p.y) / d };
	});
}

/** Whether a line from a to b passes through a label, clipped to each of the label's sides in turn. */
export function crosses(label, a, b) {
	const poly = cornersOf(label);
	const turn = Math.sign(poly.reduce((s, p, i) => s + p.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * p.y, 0));
	let [t0, t1] = [0, 1];
	for (let i = 0; i < poly.length; i++) {
		const p = poly[i];
		const q = poly[(i + 1) % poly.length];
		// Inside the label is where this isn't negative.
		const f = (v) => turn * ((q.x - p.x) * (v.y - p.y) - (q.y - p.y) * (v.x - p.x));
		const fa = f(a);
		const fb = f(b);
		if (fa < 0 && fb < 0) {
			return false;
		}
		if (fa < 0) {
			t0 = Math.max(t0, fa / (fa - fb));
		} else if (fb < 0) {
			t1 = Math.min(t1, fa / (fa - fb));
		}
	}
	return t0 < t1;
}

/** Every way a sheet's labels collide, as short descriptions. */
export function collisions(sheet) {
	const out = [];
	const { labels, flag, drawn } = sheet;
	for (let i = 0; i < labels.length; i++) {
		const a = labels[i];
		if (a.x0 < -0.5 || a.y0 < -0.5 || a.x1 > sheet.width + 0.5 || a.y1 > sheet.height + 0.5) {
			out.push(`leaves the sheet: ${a.text}`);
		}
		// Off the flag, a label stays off all of its drawing, which a border or an outline can take past its grid.
		if (a.onFlag ? !holds(flag, a) : overlap(a, drawn) > 0.5) {
			out.push(`crosses the flag's edge: ${a.text}`);
		}
		// A label hides what it sits across: a charge's edge, or the outline's or a border's.
		if (sheet.charges.some((c) => labelOverlap(a, { ...c, text: "", onFlag: true }) > 0.5 && !holds(c, a))) {
			out.push(`covers a charge: ${a.text}`);
		} else if (sheet.edges.some((e) => crosses(a, e.a, e.b))) {
			out.push(`crosses the outline: ${a.text}`);
		}
		for (let j = i + 1; j < labels.length; j++) {
			if (labelOverlap(a, labels[j]) > 0.5) {
				out.push(`overlap: ${a.text} | ${labels[j].text}`);
			}
		}
	}
	return out;
}
