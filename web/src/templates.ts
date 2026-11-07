// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// What a new flag starts as, and what "Add to the flag" puts on one. A new flag's hoist is 60, so that
// halves, thirds, quarters, fifths, sixths, tenths and twelfths of it are all whole numbers.

import { kdlName } from "./vocab.js";
import { exactly, onGrid } from "./snap.js";

/** Height to width, with the grid each gets. */
export const flagShapes: readonly { id: string; hoist: number; fly: number }[] = [
	{ id: "2:3", hoist: 60, fly: 90 },
	{ id: "1:2", hoist: 60, fly: 120 },
	{ id: "3:5", hoist: 60, fly: 100 },
	{ id: "1:1", hoist: 60, fly: 60 },
];

const palette = `palette {
  navy "#27306b"
  white "#f6f3ea"
  gold "#e8b23a"
  red "#c43d3d"
  green "#2f7d5b"
}`;

type Body = (fly: number, hoist: number) => string;

const offCross: Body = (fly) => {
	const before = Math.round(fly * 0.3);
	return `field navy\ncross white {\n  fly ${before} 12 ${fly - before - 12}\n  hoist 24 12 24\n}`;
};

/** The layouts a new flag can start from. */
export const layouts: readonly { id: string; label: string; body: Body }[] = [
	{ id: "blank", label: "Blank", body: () => "field white" },
	{ id: "two-stripes", label: "Two stripes", body: () => "bars navy gold" },
	{ id: "three-stripes", label: "Three stripes", body: () => "bars navy white navy" },
	{ id: "three-upright", label: "Three upright stripes", body: () => "bars green white red {\n  along hoist\n}" },
	{ id: "off-cross", label: "Off-center cross", body: offCross },
	{ id: "diagonal", label: "Diagonal split", body: () => "bars navy gold {\n  along bend-sinister\n}" },
	{ id: "stripes-block", label: "Stripes with a corner block", body: (fly) => `bars white red {\n  count 5\n}\ncanton {\n  fly ${Math.round(fly * 0.4)}\n  hoist 30\n  field navy\n}` },
	{ id: "symbol", label: "Symbol in the middle", body: () => "field green\ncharge disc gold {\n  radius 18\n}" },
	{ id: "swallowtail", label: "Swallowtail", body: () => "field red" },
];

const outlines: Readonly<Record<string, Body>> = {
	swallowtail: (fly) => `outline swallowtail {\n  depth ${Math.round((fly * 4) / 15)}\n}`,
};

/** A new file for a layout on a shape. */
export function template(layout: string, shape: string): string {
	const l = layouts.find((x) => x.id === layout) ?? layouts[0]!;
	const s = flagShapes.find((x) => x.id === shape) ?? flagShapes[0]!;
	const before = outlines[l.id]?.(s.fly, s.hoist);
	return `vexyl 1
meta {
  name "New flag"
}
${palette}
proportion hoist=${s.hoist} fly=${s.fly}
${before !== undefined ? `${before}\n` : ""}
${l.body(s.fly, s.hoist)}
`;
}

/** The region something's being added to, as the file writes its size. */
export interface Room {
	fly: string;
	hoist: string;
}

const shapeBody: Readonly<Record<string, (part: (n: number, d: number) => string) => string>> = {
	disc: (h) => `radius ${h(1, 4)}`,
	ellipse: (h) => `fly ${h(1, 2)}\nhoist ${h(1, 3)}`,
	ring: (h) => `radius ${h(1, 4)}\ninner ${h(1, 6)}`,
	rect: (h) => `fly ${h(1, 2)}\nhoist ${h(1, 3)}`,
	plus: (h) => `radius ${h(1, 4)}\nwidth ${h(1, 12)}`,
	triangle: (h) => `radius ${h(1, 4)}`,
	star: (h) => `radius ${h(1, 4)}`,
	crescent: (h) => `radius ${h(1, 4)}\ninner ${h(1, 5)}\noffset ${h(1, 12)}`,
	sun: (h) => `radius ${h(1, 4)}\ndisc ${h(1, 8)}`,
	lozenge: (h) => `fly ${h(1, 2)}\nhoist ${h(1, 3)}`,
	heart: (h) => `radius ${h(1, 8)}`,
};

/** What a term from the add menu is written as, sized for where it's going. */
export function addedText(key: string, room: Room, a: string, b: string): string {
	const w = (n: number, d: number): string => onGrid(exactly(n, d), room.fly);
	const h = (n: number, d: number): string => onGrid(exactly(n, d), room.hoist);
	const [ca, cb] = [kdlName(a), kdlName(b)];
	const block = (body: string): string => body.split("\n").map((l) => `  ${l}`).join("\n");
	if (key.startsWith("charge:")) {
		const shape = key.slice(7);
		return `charge ${shape} ${ca} {\n${block(shapeBody[shape]!(h))}\n}`;
	}
	switch (key) {
		case "bars":
			return `bars ${ca} ${cb} ${ca}`;
		case "band":
			return `band ${ca} {\n  width ${h(1, 5)}\n}`;
		case "cross": {
			const arm = onGrid(exactly(1, 5), room.hoist);
			const rest = (size: string): string => String(Number(((Number(size) - Number(arm)) / 2).toFixed(6)));
			return `cross ${ca} {\n  fly ${rest(room.fly)} ${arm} ${rest(room.fly)}\n  hoist ${rest(room.hoist)} ${arm} ${rest(room.hoist)}\n}`;
		}
		case "saltire":
			return `saltire ${ca} {\n  width ${h(1, 10)}\n}`;
		case "quarters":
			return `quarters ${ca} ${cb} ${cb} ${ca}`;
		case "checks":
			return `checks ${ca} ${cb} {\n  rows 4\n  columns 6\n}`;
		case "chevrons":
			return `chevrons ${ca} ${cb} {\n  depth ${w(1, 3)}\n}`;
		case "rays":
			return `rays ${ca} ${cb} {\n  count 12\n}`;
		case "pile":
			return `pile ${ca} {\n  depth ${w(1, 2)}\n}`;
		case "pall":
			return `pall ${ca} {\n  width ${h(1, 6)}\n}`;
		case "canton":
			return `canton {\n  fly ${w(2, 5)}\n  hoist ${h(1, 2)}\n  field ${ca}\n}`;
		case "panel":
			return `panel {\n  side hoist\n  width ${w(1, 4)}\n  field ${ca}\n}`;
		default:
			throw new Error(`nothing to add for ${key}`);
	}
}

/** Which colors something new should use: whichever stand out most from what it's going on. */
export function contrasting(colors: ReadonlyMap<string, string>, under: string | undefined): [string, string] {
	const light = (hex: string | undefined): number => {
		const m = hex === undefined ? null : /^#(..)(..)(..)$/.exec(hex);
		return m === null ? 0.5 : (0.3 * parseInt(m[1]!, 16) + 0.59 * parseInt(m[2]!, 16) + 0.11 * parseInt(m[3]!, 16)) / 255;
	};
	const base = light(under);
	const names = [...colors.keys()].sort((x, y) => Math.abs(light(colors.get(y)) - base) - Math.abs(light(colors.get(x)) - base));
	return [names[0] ?? "none", names[1] ?? names[0] ?? "none"];
}

const hues: readonly (readonly [number, string])[] = [[15, "red"], [45, "orange"], [70, "yellow"], [160, "green"], [195, "teal"], [255, "blue"], [295, "purple"], [340, "pink"], [360, "red"]];

/** A name for a new color, in a word for how it looks, that isn't taken. */
export function colorName(hex: string, taken: readonly string[]): string {
	const m = /^#(..)(..)(..)$/.exec(hex);
	const [r, g, b] = m === null ? [128, 128, 128] : [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
	const [hi, lo] = [Math.max(r, g, b), Math.min(r, g, b)];
	let word: string;
	if (hi - lo < 24) {
		word = hi > 220 ? "white" : hi < 40 ? "black" : "gray";
	} else {
		const span = hi - lo;
		const sector = hi === r ? ((g - b) / span + 6) % 6 : hi === g ? (b - r) / span + 2 : (r - g) / span + 4;
		word = hues.find(([top]) => sector * 60 < top)?.[1] ?? "red";
	}
	let name = word;
	for (let i = 2; taken.includes(name) || name === "none"; i++) {
		name = `${word}-${i}`;
	}
	return name;
}
