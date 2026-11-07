// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Restates a flag on another grid: every length is multiplied by the same factor, and the picture
// doesn't change. A number the tables here don't know stops it, because guessing would quietly
// change the flag.

import { Value, type Document, type Entry, type Node } from "@bgotink/kdl";
import { ends, fraction, readExact, times, write, type Fraction } from "./exact.js";

/** Children whose arguments are all lengths. */
const lengths = new Set(["fly", "hoist", "width", "offset", "depth", "apex", "radius", "inner", "disc", "gap", "hollow", "lines", "flat", "junction", "tongue", "taper", "tip", "base", "spread"]);
/** Terms whose numbers aren't lengths, and so stay as they are. */
const notLengths = new Set(["vexyl", "rotate", "count", "opacity", "ratio", "grow", "stops", "rows", "columns", "points", "from", "to", "angle"]);
/** Terms whose fly= and hoist= are a position or a size. */
const positions = new Set(["at", "point", "split", "from", "proportion"]);
/** The second argument is a width: `border gold 1`, `fimbriate white 0.5`. */
const edged = new Set(["border", "fimbriate"]);
/** Which of a term's properties are lengths, and which aren't. */
const lengthProps: Readonly<Record<string, readonly string[]>> = {
	repeat: ["radius", "fly", "hoist"],
	edge: ["depth", "period"],
};
const plainProps: Readonly<Record<string, readonly string[]>> = {
	repeat: ["count", "rows", "columns", "stagger", "turn", "from", "to"],
	edge: ["count"],
};
const foldSteps = new Set(["over", "under", "tuck"]);

interface Walk {
	factor: Fraction;
	rounded: Map<string, string>;
	values: Fraction[];
	defined: ReadonlyMap<string, string>;
	dry: boolean;
}

function stop(n: Node, what: string): never {
	throw new Error(`\`${n.getName()}\` has ${what} that this can't tell the meaning of, so nothing was changed.`);
}

function scaled(w: Walk, was: string): string {
	const value = readExact(was);
	if (value === null) {
		throw new Error(`"${was}" isn't a number this can restate exactly, so nothing was changed.`);
	}
	w.values.push(value);
	const next = write(times(value, w.factor));
	if (!next.exact) {
		w.rounded.set(was, next.text);
	}
	return next.text;
}

function scaleEntry(w: Walk, e: Entry): void {
	const raw = (e.value.representation ?? String(e.value.value)).replace(/;$/, "");
	const text = scaled(w, raw);
	if (w.dry) {
		return;
	}
	const value = new Value(Number(text));
	value.representation = e.value.representation?.endsWith(";") === true ? `${text};` : text;
	e.value = value;
}

function scaleWords(w: Walk, n: Node, name: string, count: number): void {
	const e = n.getPropertyEntry(name);
	if (e === undefined || typeof e.value.value !== "string") {
		return;
	}
	const words = e.value.value.trim().split(/\s+/);
	if (words.length !== count || readExact(words[0]!) === null) {
		return;
	}
	const next = words.map((word) => scaled(w, word)).join(" ");
	if (!w.dry) {
		e.value = new Value(next);
	}
}

const hasOwnGrid = (n: Node): boolean => n.getName() === "define"
	? n.getPropertyEntry("hoist") !== undefined || n.getPropertyEntry("fly") !== undefined
	: n.getName() === "variant" && (n.children?.nodes ?? []).some((k) => k.getName() === "proportion");

/** The kind of shape a node with a shape's sizes is, seeing through a definition. */
function shapeOf(w: Walk, parent: Node | null): string {
	if (parent === null) {
		return "";
	}
	const name = parent.getName() === "charge" ? String(parent.getArgument(0)) : parent.getName();
	return w.defined.get(name) ?? name;
}

function visit(w: Walk, list: readonly Node[], parent: Node | null): void {
	for (const n of list) {
		const name = n.getName();
		if (name === "meta" || name === "palette" || name === "adapt" || hasOwnGrid(n) || name === "markup" || name === "d" || name === "box") {
			continue;
		}
		const args = n.getArgumentEntries();
		const numbers = args.filter((e) => typeof e.value.value === "number");
		const props = n.getPropertyEntries();
		if (edged.has(name)) {
			for (const e of numbers) {
				scaleEntry(w, e);
			}
		} else if (foldSteps.has(name)) {
			const at = n.getPropertyEntry("at");
			if (at !== undefined) {
				scaleEntry(w, at);
			}
			scaleWords(w, n, "through", 4);
			scaleWords(w, n, "move", 2);
		} else if (positions.has(name)) {
			for (const e of props) {
				if (e.getName() === "fly" || e.getName() === "hoist") {
					scaleEntry(w, e);
				} else {
					stop(n, `\`${e.getName()}=\``);
				}
			}
			if (numbers.length > 0 && !notLengths.has(name)) {
				stop(n, "a number");
			}
		} else if (name === "spread" && shapeOf(w, parent) === "sun") {
			// A sun's is a share of each ray's width, where a heart's is a distance.
		} else if (lengths.has(name)) {
			for (const e of numbers) {
				scaleEntry(w, e);
			}
		} else if (!notLengths.has(name) && numbers.length > 0) {
			stop(n, "a number");
		}
		if (!foldSteps.has(name) && !positions.has(name)) {
			for (const e of props) {
				const key = e.getName() ?? "";
				if (lengthProps[name]?.includes(key) === true) {
					scaleEntry(w, e);
				} else if (typeof e.value.value === "number" && plainProps[name]?.includes(key) !== true) {
					stop(n, `\`${key}=\``);
				}
			}
		}
		visit(w, n.children?.nodes ?? [], n);
	}
}

export interface Restated {
	/** The numbers that had to be rounded, as they were and as they'd become. */
	rounded: [string, string][];
	/** The number of lengths restated. */
	values: Fraction[];
	factor: Fraction;
}

function definedShapes(doc: Document): Map<string, string> {
	const out = new Map<string, string>();
	for (const n of doc.nodes) {
		const name = n.getArgument(0);
		const only = n.children?.nodes;
		if (n.getName() === "define" && typeof name === "string" && only?.length === 1) {
			out.set(name, only[0]!.getName());
		}
	}
	return out;
}

function proportionOf(doc: Document): { node: Node; hoist: Fraction; fly: Fraction } {
	const node = doc.nodes.find((n) => n.getName() === "proportion");
	const read = (key: string): Fraction | null => {
		const e = node?.getPropertyEntry(key);
		return e === undefined ? null : readExact((e.value.representation ?? String(e.value.value)).replace(/;$/, ""));
	};
	const hoist = read("hoist");
	const fly = read("fly");
	if (node === undefined || hoist === null || fly === null || hoist.n <= 0n || fly.n <= 0n) {
		throw new Error("The flag needs a proportion before it can be rescaled.");
	}
	return { node, hoist, fly };
}

/** Restates a document so that its hoist is a new one, in place, or just works out what would happen. */
export function rescale(doc: Document, hoistText: string, dry = false): Restated {
	const target = readExact(hoistText);
	if (target === null || target.n <= 0n) {
		throw new Error("The new hoist needs to be a number above 0.");
	}
	const { hoist } = proportionOf(doc);
	const factor = fraction(target.n * hoist.d, target.d * hoist.n);
	const w: Walk = { factor, rounded: new Map(), values: [], defined: definedShapes(doc), dry };
	visit(w, doc.nodes, null);
	return { rounded: [...w.rounded], values: w.values, factor };
}

/** The whole-number grids nearest the flag's own shape on which every length stays exact. */
export function exactGrids(doc: Document, most = 2): [string, string][] {
	const { hoist, fly } = proportionOf(doc);
	const shape = fraction(fly.n * hoist.d, fly.d * hoist.n);
	const { values } = rescale(doc, write(hoist).text, true);
	const distinct = [...new Map(values.map((v) => [`${v.n}/${v.d}`, v])).values()];
	const found: [string, string][] = [];
	for (let m = 1n; m <= 2000n && found.length < most; m++) {
		const h = shape.d * m;
		const f = shape.n * m;
		const factor = fraction(h * hoist.d, hoist.n);
		if ((h !== hoist.n || hoist.d !== 1n) && distinct.every((v) => ends(times(v, factor)))) {
			found.push([String(h), String(f)]);
		}
	}
	return found;
}
