// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// What Basic calls things. Advanced keeps the format's own words, from vocab.ts, and these never
// appear there.

import { listText, type ColorUse } from "./colors.js";

export const plainLayers: Readonly<Record<string, string>> = {
	field: "Background", bars: "Stripes", band: "Single stripe", cross: "Cross", saltire: "Diagonal cross", quarters: "Quarters", checks: "Checkerboard",
	chevrons: "Chevrons", rays: "Rays", pile: "Edge triangle", pall: "Y shape", charge: "Symbol", canton: "Corner block", panel: "Edge block",
	emblem: "Symbols drawn together", group: "Group of layers", use: "Reusable part",
};

export const plainShapes: Readonly<Record<string, string>> = {
	disc: "Circle", ellipse: "Oval", ring: "Ring", rect: "Rectangle", plus: "Plus", triangle: "Triangle", star: "Star", crescent: "Crescent", sun: "Sun", lozenge: "Diamond",
	heart: "Heart", cardioid: "Rounded heart", path: "Drawn shape", polygon: "Drawn shape", svg: "Artwork",
};

/** Things a term can have that Basic leaves alone, for saying what's there. */
export const plainProperties: Readonly<Record<string, string>> = {
	clip: "Clipped shape", cut: "Cut-out", opacity: "See-through setting", blend: "Blending", anchor: "Setting for other proportions", edge: "Shaped edge", rotate: "Turn", fimbriate: "Edging",
	hollow: "Outline-only setting", lines: "Drawn-in-lines setting", grow: "Setting for other proportions", counterchange: "Woven arms", diagonal: "Diagonal division", flow: "Color direction", from: "Direction", to: "Where an arc ends",
	along: "Direction", angle: "Angle", apex: "Middle point", base: "Base", tip: "Tip", flat: "Flat end", junction: "Where its arms meet", depth: "Depth", ratio: "Uneven widths", measure: "How widths are measured", repeat: "Arrangement", count: "Number of parts",
};

export const plainName = (n: { name: string; args: readonly { v: unknown }[] }): string => {
	if (n.name === "charge") {
		const shape = String(n.args[0]?.v ?? "");
		return Object.hasOwn(plainShapes, shape) ? plainShapes[shape]! : "Symbol";
	}
	return Object.hasOwn(plainLayers, n.name) ? plainLayers[n.name]! : n.name;
};

export interface AddGroup {
	label: string;
	wide?: boolean;
	items: readonly (readonly [key: string, label: string])[];
}

const named = (keys: readonly string[]): (readonly [string, string])[] => keys.map((k) => [k, k.startsWith("charge:") ? plainShapes[k.slice(7)]! : plainLayers[k]!]);

/** What "Add to the flag" offers, as pictures. The keys are the same as termart.tsx's. */
export const addGroups: readonly AddGroup[] = [
	{ label: "Divide the background", items: named(["bars", "band", "cross", "saltire", "quarters", "checks", "chevrons", "rays", "pile", "pall"]) },
	{ label: "Blocks", items: named(["canton", "panel"]) },
	{ label: "Symbols", wide: true, items: named(["charge:star", "charge:disc", "charge:crescent", "charge:lozenge", "charge:ring", "charge:rect", "charge:ellipse", "charge:plus", "charge:triangle", "charge:sun", "charge:heart"]) },
];

/** The word for a side of the flag, or of a block on it. */
export const sideNames: readonly (readonly [string, string])[] = [["hoist", "Left"], ["top", "Top"], ["fly", "Right"], ["bottom", "Bottom"]];
export const cornerNames: readonly (readonly [string, string])[] = [["upper-hoist", "Top left"], ["upper-fly", "Top right"], ["lower-hoist", "Bottom left"], ["lower-fly", "Bottom right"]];

const holdsOwnField = new Set(["canton", "panel"]);

/** What uses a color, in plain words, like "the stripes and the star", each said once. */
export function usedByText(uses: readonly ColorUse[]): string {
	const said = uses.map(({ node, holders }) => {
		const top = holders[0];
		if (top?.name === "palette") {
			return `the gradient ${node.name}`;
		}
		const parent = holders.at(-1);
		const parentName = parent === undefined ? "" : plainName(parent).toLowerCase();
		const thing = node.name === "fimbriate" ? `the edging of the ${parentName}`
			: node.name === "border" ? "the border"
			: node.name === "field" && parent !== undefined && holdsOwnField.has(parent.name) && parent.kids.find((k) => k.path !== undefined) === node ? `the ${parentName}`
			: `the ${plainName(node).toLowerCase()}`;
		switch (top?.name) {
			case "variant": return `${thing} in the other form ${String(top.args[0]?.v)}`;
			case "reverse": return `${thing} on the back`;
			case "define": return `${thing} in the reusable part ${String(top.args[0]?.v)}`;
			default: return thing;
		}
	});
	return listText([...new Set(said)]);
}
