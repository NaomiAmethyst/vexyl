// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Where a file uses its colors. document.ts changes the same places this reads, so that what's said to
// use a color before it's taken out is exactly what gets the color that replaces it.

import type { ONode } from "./protocol.js";

/** Which of a term's arguments are colors, by the term's name and how many arguments it has. */
export function colorArgs(name: string, count: number): number[] {
	switch (name) {
		case "field": case "band": case "cross": case "saltire": case "pile": case "pall": case "fimbriate": case "border":
			return count > 0 ? [0] : [];
		case "bars": case "chevrons": case "quarters": case "checks": case "rays":
			return Array.from({ length: count }, (_, i) => i);
		case "charge":
			return count > 1 ? [1] : [];
		default:
			return [];
	}
}

/** A palette entry's colors, if it's a gradient between others. */
export const gradientStops = (entry: { args: readonly { v: unknown }[] }): unknown[] => (entry.args[0]?.v === "gradient" ? entry.args.slice(1).map((a) => a.v) : []);

export interface ColorUse {
	/** What uses the color: a layer, something of one's like its fimbriation, or a gradient in the palette. */
	node: ONode;
	/** What it's inside, from the top of the file down. */
	holders: ONode[];
}

/** Everything that uses a color, wherever it is: in a gradient, on the flag, or in a variant, the reverse or a definition. */
export function colorUses(nodes: readonly ONode[], color: string): ColorUse[] {
	const out: ColorUse[] = [];
	const visit = (list: readonly ONode[], holders: ONode[]): void => {
		for (const n of list) {
			if (n.name === "palette") {
				for (const entry of n.kids) {
					if (entry.name !== color && gradientStops(entry).includes(color)) {
						out.push({ node: entry, holders: [...holders, n] });
					}
				}
				continue;
			}
			if (colorArgs(n.name, n.args.length).some((i) => n.args[i]!.v === color)) {
				out.push({ node: n, holders });
			}
			visit(n.kids, [...holders, n]);
		}
	};
	visit(nodes, []);
	return out;
}

const paletteOf = (nodes: readonly ONode[]): readonly ONode[] => nodes.find((n) => n.name === "palette")?.kids ?? [];

/**
 * The colors nothing uses, gradients first, so that they can be taken out in that order. A color that only
 * an unused gradient is made from is unused too, since it goes with the gradient.
 */
export function unusedColors(nodes: readonly ONode[]): string[] {
	const entries = paletteOf(nodes);
	const used = new Set<string>();
	for (const entry of entries) {
		if (colorUses(nodes, entry.name).some((u) => !u.holders.some((h) => h.name === "palette"))) {
			used.add(entry.name);
		}
	}
	for (const entry of entries) {
		if (used.has(entry.name)) {
			for (const stop of gradientStops(entry)) {
				used.add(String(stop));
			}
		}
	}
	const unused = entries.filter((e) => !used.has(e.name));
	return [...unused.filter((e) => gradientStops(e).length > 0), ...unused.filter((e) => gradientStops(e).length === 0)].map((e) => e.name);
}

/** Whether a use needs a solid color, as a gradient's own colors and artwork's color do. */
const needsSolid = (u: ColorUse): boolean => u.holders.some((h) => h.name === "palette") || (u.node.name === "charge" && u.node.args[0]?.v === "svg");

/**
 * The colors that can take another's place everywhere it's used. A gradient can't where a solid color is
 * needed, or if it's made from the color it would replace, since it would then be made from itself.
 */
export function replacementsFor(nodes: readonly ONode[], color: string): string[] {
	const uses = colorUses(nodes, color);
	const solid = uses.some(needsSolid);
	return paletteOf(nodes).filter((e) => {
		const stops = gradientStops(e);
		return e.name !== color && (stops.length === 0 || (!solid && !stops.includes(color)));
	}).map((e) => e.name);
}

/** A list in words: "a", "a and b", "a, b and c", or the first few and how many more. */
export function listText(items: readonly string[], most = 4): string {
	const shown = items.length > most ? [...items.slice(0, most - 1), `${items.length - most + 1} more`] : [...items];
	return shown.length < 2 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)!}`;
}
