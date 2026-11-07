// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Section 15 of the format: how much a whole flag can paint, counted without expanding anything.

import type { ChargeLayer, Layer, Shape, ShapedEdge } from "./types.js";

/** Limits how much a whole flag can paint. */
export const maxSize = 200000;
/** Limits how many pieces a fold can make, since each step can double them. */
export const maxFacets = 10000;
export const maxCopies = 10000;
/** How many bytes of path data or inline SVG count as one part. */
const bytesPerPart = 64;
/** The largest size a number can have, and its inverse the smallest, so nothing worked out from them can overflow. */
const numberLimit = 1e12;

export function inLimits(v: number): boolean {
	const a = Math.abs(v);
	return Number.isFinite(v) && a <= numberLimit && (a === 0 || a >= 1 / numberLimit);
}

/** Sizes stop mattering past the limit, and a chain of definitions can double them many times. */
export const addSize = (a: number, b: number): number => Math.min(a + b, maxSize + 1);
const mulSize = (a: number, b: number): number => Math.min(a * b, maxSize + 1);

/** How many waves a shaped edge has across the flag's longer side. */
export function waves(l: ShapedEdge, longer: number): number {
	if (l.count !== undefined && l.count > 0) {
		return l.count;
	}
	if (l.period === undefined || l.period <= 0) {
		return 0;
	}
	return Math.min(Math.ceil(longer / l.period), maxCopies + 1);
}

const bytesOf = (s: string): number => new TextEncoder().encode(s).length;

/** How many parts one copy of a shape counts as. */
function shapeParts(s: Shape): number {
	switch (s.kind) {
		case "star":
		case "sun":
			return Math.max(s.points, 1);
		case "polygon":
			return Math.max(s.vertices?.length ?? 0, 1);
		case "path":
			return 1 + Math.floor(bytesOf(s.d ?? "") / bytesPerPart);
		case "svg":
			return 1 + Math.floor(bytesOf(s.markup ?? "") / bytesPerPart);
		default:
			return 1;
	}
}

function chargeCopies(c: ChargeLayer): number {
	const r = c.repeat;
	if (r !== undefined) {
		return r.kind === "grid" ? r.rows * r.columns : r.count;
	}
	return (c.shape.ats?.length ?? 0) > 1 ? c.shape.ats!.length : 1;
}

/** What a layer paints. A definition's size was worked out when it was read, so a chain of them is never walked. */
export function layerSize(l: Layer, longer: number): number {
	const size = l.clip !== undefined ? shapeParts(l.clip) : 0;
	let cuts = 0;
	for (const cut of l.cuts) {
		cuts = addSize(cuts, shapeParts(cut));
	}
	// A charge's cuts go with each of its copies.
	if (l.layer === "charge") {
		cuts = mulSize(chargeCopies(l), cuts);
	}
	return addSize(addSize(size, cuts), contentSize(l, longer));
}

function contentSize(l: Layer, longer: number): number {
	switch (l.layer) {
		case "bars":
			return l.edge !== undefined ? mulSize(l.colors.length, 1 + waves(l.edge, longer)) : l.colors.length;
		case "chevrons":
		case "rays":
			return l.colors.length;
		case "quarters":
			return 4;
		case "checks":
			return mulSize(l.rows, l.columns);
		case "charge":
			return mulSize(chargeCopies(l), shapeParts(l.shape));
		case "emblem":
			return layersSize(l.charges, longer);
		case "group":
			return layersSize(l.layers, longer);
		case "panel":
			return addSize(layersSize(l.layers, longer), l.edge !== undefined ? waves(l.edge, longer) : 0);
		case "use":
			return l.define.size ?? 0;
		default:
			return 1;
	}
}

export function layersSize(layers: readonly Layer[], longer: number): number {
	let size = 0;
	for (const l of layers) {
		size = addSize(size, layerSize(l, longer));
	}
	return size;
}

/** How many levels layers nest, counting what they use. It's bounded, since every level was checked as it was read. */
export function layersHeight(layers: readonly Layer[]): number {
	let height = 0;
	for (const l of layers) {
		let h = 1;
		if (l.layer === "group" || l.layer === "panel") {
			h = 1 + layersHeight(l.layers);
		} else if (l.layer === "use") {
			h = 1 + (l.define.height ?? 0);
		}
		height = Math.max(height, h);
	}
	return height;
}
