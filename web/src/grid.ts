// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Blink keeps some of an SVG's coordinates in a form that runs out at 33,554,432, and past that it
// draws clips and shapes wrongly, or not at all. A file's grid can be far larger, so for showing such a
// flag on screen, this gives the same flag on a smaller grid. The file, and what's downloaded, are untouched.

import type { Flag } from "vexyl";

/** Over this, a flag is drawn on a smaller grid. It's well under the limit, because padding adds to it. */
export const largestGrid = 1e7;

const lengths = new Set(["hoist", "fly", "width", "depth", "taper", "tongue", "tip", "apex", "offset", "radius", "inner", "disc", "gap", "spread", "hollow", "lines", "flat", "junction", "period", "base"]);

function scaled(value: unknown, k: number): unknown {
	if (typeof value === "number") {
		return value * k;
	}
	return Array.isArray(value) ? value.map((v) => (typeof v === "number" ? v * k : v)) : value;
}

/** Multiplies every length in path data, which is every number but an arc's rotation and flags. */
export function scalePathData(d: string, k: number): string {
	const out: string[] = [];
	let command = "";
	let index = 0;
	let afterNumber = false;
	for (const part of d.match(/[a-zA-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []) {
		if (/^[a-zA-Z]$/.test(part)) {
			command = part;
			index = 0;
			afterNumber = false;
			out.push(part);
			continue;
		}
		const position = index % 7;
		const asIs = (command === "A" || command === "a") && (position === 2 || position === 3 || position === 4);
		out.push(`${afterNumber ? " " : ""}${asIs ? part : Number(part) * k}`);
		afterNumber = true;
		index++;
	}
	return out.join("");
}

/** Artwork has its own grid, which can have the same trouble, so that goes inside a smaller one. */
function smallerArtwork(embedded: { viewBox: string; body: string }): { viewBox: string; body: string } {
	const numbers = embedded.viewBox.trim().split(/[\s,]+/).map(Number);
	const side = Math.max(...numbers.map(Math.abs));
	if (numbers.length !== 4 || !(side > largestGrid)) {
		return embedded;
	}
	const k = 1000 / side;
	const viewBox = numbers.map((n) => n * k).join(" ");
	// Blink loses shapes whose own transforms reach past its limit, even inside something that scales them
	// back. So where the art is a flat list, as an import is, each transform itself is made smaller.
	if (!/<(g|clipPath|mask|defs|linearGradient|radialGradient)\b/.test(embedded.body)) {
		const elements = embedded.body.match(/<[a-z]+\b[^>]*>/g) ?? [];
		const opening = elements.filter((e) => !e.startsWith("</"));
		if (opening.every((e) => /\stransform="matrix\([^)]*\)"/.test(e))) {
			const body = embedded.body.replace(/\stransform="matrix\(([^)]*)\)"/g, (_, m: string) => ` transform="matrix(${m.trim().split(/[\s,]+/).map((n) => Number(n) * k).join(" ")})"`);
			return { ...embedded, viewBox, body };
		}
	}
	return { ...embedded, viewBox, body: `<g transform="scale(${k})">${embedded.body}</g>` };
}

function pathIsLarge(value: object): boolean {
	const box = (value as { box?: unknown }).box;
	return Array.isArray(box) && box.some((n) => typeof n === "number" && Math.abs(n) > largestGrid);
}

/** The same flag, with every length in it multiplied, and nothing else changed. */
export function scaleFlag(flag: Flag, k: number): Flag {
	const seen = new Map<object, object>();
	const copy = (value: unknown): unknown => {
		if (typeof value !== "object" || value === null || value instanceof Map || value instanceof Set) {
			return value;
		}
		const known = seen.get(value);
		if (known !== undefined) {
			return known;
		}
		if (Array.isArray(value)) {
			const list: unknown[] = [];
			seen.set(value, list);
			for (const item of value) {
				list.push(copy(item));
			}
			return list;
		}
		const out = Object.create(Object.getPrototypeOf(value) as object | null) as object;
		seen.set(value, out);
		const isSun = (value as { kind?: unknown }).kind === "sun";
		for (const key of Object.keys(value)) {
			const v = (value as Record<string, unknown>)[key];
			// A path's own coordinates can be just as large, and they're fit to its box.
			if (key === "d" && typeof v === "string" && pathIsLarge(value)) {
				Object.defineProperty(out, key, { value: scalePathData(v, k), enumerable: true, writable: true, configurable: true });
				continue;
			}
			if (key === "box" && Array.isArray(v) && pathIsLarge(value)) {
				Object.defineProperty(out, key, { value: v.map((n: number) => n * k), enumerable: true, writable: true, configurable: true });
				continue;
			}
			if (key === "embedded" && typeof v === "object" && v !== null) {
				Object.defineProperty(out, key, { value: smallerArtwork(v as { viewBox: string; body: string }), enumerable: true, writable: true, configurable: true });
				continue;
			}
			// A sun's spread is a share of its slot, not a length.
			const next = lengths.has(key) && !(isSun && key === "spread") && (typeof v === "number" || (Array.isArray(v) && v.every((x) => typeof x === "number"))) ? scaled(v, k) : copy(v);
			Object.defineProperty(out, key, { value: next, enumerable: true, writable: true, configurable: true });
		}
		return out;
	};
	return copy(flag) as Flag;
}
