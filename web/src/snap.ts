// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Basic's numbers. A person thinks in simple fractions of the flag and in turns, and the file keeps
// plain numbers on its grid and degrees. This is what goes between them, and none of it reaches the file
// except as those numbers.

import { fraction, readExact, times, write, type Fraction } from "./exact.js";

/** A place as a share of its region, from 0 to 1, and how it got there. */
export interface Snapped {
	v: number;
	kind: "middle" | "edge" | "fraction" | "free";
	/** The fraction it's exactly on, which is what gets written if it's on one. */
	fraction?: readonly [n: number, d: number];
}

const denominators = [2, 3, 4, 5, 6, 8, 10, 12];
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** The simple fractions a drag snaps to, in lowest terms. */
export const fractions: readonly { n: number; d: number; v: number }[] = denominators.flatMap((d) => Array.from({ length: d - 1 }, (_, i) => i + 1).filter((n) => gcd(n, d) === 1).map((n) => ({ n, d, v: n / d })));

const middleReach = 0.025;
const edgeReach = 0.018;
const fractionReach = 0.012;

function nearest<T>(list: readonly T[], value: (t: T) => number, v: number, reach: number): T | undefined {
	let best: T | undefined;
	let gap = reach;
	for (const item of list) {
		const d = Math.abs(value(item) - v);
		if (d < gap) {
			best = item;
			gap = d;
		}
	}
	return best;
}

/** The nearest simple fraction close enough, or the place as it is. */
export function snapFraction(v: number, free = false, reach = fractionReach): Snapped {
	const near = free ? undefined : nearest(fractions, (f) => f.v, v, reach);
	return near === undefined ? { v, kind: "free" } : { v: near.v, kind: "fraction", fraction: [near.n, near.d] };
}

/** The middle first, then the edges of other things, then simple fractions. Alt asks for none of them. */
export function snap(v: number, edges: readonly number[] = [], free = false): Snapped {
	if (free) {
		return { v, kind: "free" };
	}
	if (Math.abs(v - 0.5) < middleReach) {
		return { v: 0.5, kind: "middle", fraction: [1, 2] };
	}
	const edge = nearest(edges, (e) => e, v, edgeReach);
	return edge !== undefined ? { v: edge, kind: "edge" } : snapFraction(v);
}

/** The same place, measured from the other side. */
export function complement(s: Snapped): Snapped {
	return s.fraction !== undefined ? { ...s, v: 1 - s.v, fraction: [s.fraction[1] - s.fraction[0], s.fraction[1]] } : { ...s, v: 1 - s.v };
}

export const exactly = (n: number, d: number): Snapped => ({ v: n / d, kind: "fraction", fraction: [n, d] });

/** A number as a file writes it, with no more digits than it can use. */
export function gridText(value: number): string {
	const text = String(Number(value.toFixed(6)));
	return text.includes("e") ? value.toFixed(6) : text;
}

/** Enough places that a free placement is under a pixel of a large flag out, and no more. */
function freeText(value: number, size: number): string {
	const places = Math.min(6, Math.max(2, Math.ceil(Math.log10(5000 / Math.max(size, 1e-6)))));
	return String(Number(value.toFixed(places)));
}

/** What a size or position is on the flag's grid, as the file should write it, so that 1/3 of 60 is `20`. */
export function onGrid(s: Snapped, size: string): string {
	const whole = readExact(size);
	if (s.fraction !== undefined && whole !== null) {
		return write(times(fraction(BigInt(s.fraction[0]), BigInt(s.fraction[1])), whole)).text;
	}
	const number = Number(size);
	return s.kind === "free" ? freeText(s.v * number, number) : gridText(s.v * number);
}

/** A number on the grid as an exact fraction, for adding up. */
export const exactOf = (text: string): Fraction => readExact(text) ?? fraction(BigInt(Math.round(Number(text) * 1e6)), 1000000n);

/** A share in the plainest words there are: a fraction if it's on one, or else a percentage. */
export function shareText(v: number): string {
	if (Math.abs(v) < 0.0015) {
		return "0";
	}
	if (Math.abs(v - 1) < 0.0015) {
		return "all";
	}
	const hit = nearest(fractions, (f) => f.v, v, 0.0015);
	return hit !== undefined ? `${hit.n}/${hit.d}` : `${Math.round(v * 100)}%`;
}

/** Reads what's typed in a size box: a fraction, a percentage, or a plain share. */
export function readAmount(text: string): Snapped | null {
	const t = text.trim();
	const f = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
	if (f !== null && Number(f[2]) > 0) {
		const [n, d] = [Number(f[1]), Number(f[2])];
		return { v: n / d, kind: "fraction", fraction: [n, d] };
	}
	const p = /^(\d+(?:\.\d+)?|\.\d+)\s*%$/.exec(t);
	if (p !== null) {
		return snapFraction(Number(p[1]) / 100, false, 0.0005);
	}
	if (/^(\d+(?:\.\d+)?|\.\d+)$/.test(t)) {
		// Above 1 it can only mean a percentage, and 1 itself means all of it.
		const n = Number(t);
		return snapFraction(n > 1 ? n / 100 : n, false, 0.0005);
	}
	return null;
}

/** How far a symbol turns before it looks the same, in degrees, or null if turning it shows nothing. */
export function turnPeriod(shape: string, points: number | null, arc = false): number | null {
	switch (shape) {
		case "disc":
			return null;
		case "ring":
			return arc ? 360 : null;
		case "star": case "sun":
			return 360 / (points ?? (shape === "star" ? 5 : 12));
		case "triangle":
			return 120;
		case "plus":
			return 90;
		case "rect": case "ellipse": case "lozenge":
			return 180;
		default:
			return 360;
	}
}

/** The turns worth a button: only those within its symmetry, since past that it looks the same. */
export function turnsFor(period: number, pointed: number | null): { deg: number; label: string }[] {
	const out = [{ deg: 0, label: "Upright" }];
	const add = (n: number, d: number, note?: string): void => {
		const deg = (360 * n) / d;
		if (deg < period - 0.01 && !out.some((t) => Math.abs(t.deg - deg) < 0.001)) {
			out.push({ deg, label: `${n}/${d} turn${note !== undefined ? `, ${note}` : ""}` });
		}
	};
	if (pointed !== null && pointed % 2 === 1) {
		add(1, 2 * pointed, "point down");
	}
	for (const [n, d] of [[1, 12], [1, 8], [1, 6], [1, 4], [1, 3], [1, 2]] as const) {
		add(n, d);
	}
	return out.sort((a, b) => a.deg - b.deg);
}

/** A turn in degrees as a fraction if it's near one, without the word, or as a decimal share. */
export function turnFraction(deg: number): string {
	const turned = ((deg % 360) + 360) % 360;
	const halves = turned * 2;
	if (Math.abs(halves - Math.round(halves)) < 1e-6) {
		const g = gcd(Math.round(halves), 720);
		if (720 / g <= 48) {
			return `${Math.round(halves) / g}/${720 / g}`;
		}
	}
	return gridText(turned / 360);
}

/** A turn in words, like "1/8 turn (45°)". */
export function turnText(deg: number): string {
	const turned = ((deg % 360) + 360) % 360;
	if (turned === 0) {
		return "Upright";
	}
	const part = turnFraction(deg);
	return `${part.includes("/") ? `${part} turn` : `${part} of a turn`} (${gridText(turned)}°)`;
}

/** Reads what's typed in the turn box: a fraction of a turn, or degrees. */
export function readTurn(text: string): number | null {
	const t = text.trim().toLowerCase().replace(/\s*(turns?|of a turn)$/, "");
	const f = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
	if (f !== null && Number(f[2]) > 0) {
		return (360 * Number(f[1])) / Number(f[2]);
	}
	const d = /^(-?\d+(?:\.\d+)?)\s*(°|deg|degrees?)?$/.exec(t);
	return d === null ? null : Number(d[1]);
}
