// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { getLocation, InvalidKdlError, parse as parseKdl, type Node } from "@bgotink/kdl";
import { encodePathName } from "./paths.js";

/** Where something in a document is. Lines and columns are counted as a problem's are. */
export interface Span {
	/** The path of a layer, or the name of what else it is, as SDK.md section 7 says. */
	path: string;
	/** The KDL node's name. */
	node: string;
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
}

const layerNames = new Set(["field", "bars", "chevrons", "band", "cross", "saltire", "quarters", "checks", "rays", "pile", "pall", "charge", "emblem", "group", "panel", "canton", "use"]);
const holdsLayers = new Set(["emblem", "group", "panel", "canton"]);

/**
 * Finds every layer and other named part of a document, in document order. It reads only the
 * document's syntax, so it works on one with other problems, and gives nothing if the syntax is bad.
 */
export function locate(text: string): Span[] {
	const source = text.replace(/\r\n?/g, "\n");
	let nodes: Node[];
	try {
		nodes = parseKdl(source, { storeLocations: true }).nodes;
	} catch (e) {
		if (e instanceof InvalidKdlError) {
			return [];
		}
		throw e;
	}
	const spans: Span[] = [];
	const placeOf = placer(source);
	const add = (n: Node, path: string): void => {
		const at = getLocation(n);
		if (at === undefined) {
			return;
		}
		const start = placeOf(at.start.offset);
		const end = placeOf(endOf(source, at.start.offset, at.end.offset));
		spans.push({ path, node: n.getName(), line: start.line, column: start.column, endLine: end.line, endColumn: end.column });
	};
	const layers = (list: Node[], base: string): void => {
		let i = 0;
		for (const n of list) {
			if (layerNames.has(n.getName())) {
				const path = base + i;
				add(n, path);
				if (holdsLayers.has(n.getName())) {
					layers(n.children?.nodes ?? [], path + ".");
				}
				i++;
			}
		}
	};
	const named = (n: Node, kind: string): string | undefined => {
		const name = n.getArgument(0);
		return typeof name === "string" ? `${kind}/${encodePathName(name)}` : undefined;
	};
	const top = (list: Node[]): void => {
		let i = 0;
		for (const n of list) {
			const name = n.getName();
			const kids = n.children?.nodes ?? [];
			if (layerNames.has(name)) {
				const path = String(i++);
				add(n, path);
				if (holdsLayers.has(name)) {
					layers(kids, path + ".");
				}
			} else if (name === "palette") {
				add(n, name);
				for (const c of kids) {
					add(c, `palette/${encodePathName(c.getName())}`);
				}
			} else if (name === "define" || name === "fold") {
				const path = named(n, name);
				if (path !== undefined) {
					add(n, path);
					if (name === "define") {
						layers(kids, path + "/");
					}
				}
			} else if (name === "variant") {
				const path = named(n, name);
				if (path !== undefined) {
					add(n, path);
					layers(kids, path + "/");
					for (const c of kids) {
						if (c.getName() === "outline" || c.getName() === "border") {
							add(c, `${path}/${c.getName()}`);
						}
					}
				}
			} else if (name === "reverse") {
				add(n, name);
				layers(kids, "reverse/");
			} else {
				add(n, name);
			}
		}
	};
	top(nodes);
	return spans;
}

/** The innermost span holding a place in a document, and so its deepest layer or part. */
export function layerAt(spans: readonly Span[], line: number, column?: number): Span | undefined {
	let best: Span | undefined;
	for (const s of spans) {
		const after = line > s.line || (line === s.line && (column === undefined || column >= s.column));
		const before = line < s.endLine || (line === s.endLine && (column === undefined || column <= s.endColumn));
		if (after && before && (best === undefined || s.line > best.line || (s.line === best.line && s.column >= best.column))) {
			best = s;
		}
	}
	return best;
}

/** Finds places in a document, as SDK.md section 2 says to: lines end at LF, and a column counts code points. */
function placer(source: string): (offset: number) => { line: number; column: number } {
	const starts = [0];
	for (let i = source.indexOf("\n"); i >= 0; i = source.indexOf("\n", i + 1)) {
		starts.push(i + 1);
	}
	return (offset) => {
		let lo = 0;
		let hi = starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (starts[mid]! <= offset) {
				lo = mid;
			} else {
				hi = mid - 1;
			}
		}
		return { line: lo + 1, column: [...source.slice(starts[lo]!, offset)].length + 1 };
	};
}

/** Where a node's last character ends, leaving out what separates it from the next. */
function endOf(source: string, start: number, end: number): number {
	let e = end;
	while (e > start && /[\s;]/.test(source[e - 1]!)) {
		e--;
	}
	return e;
}
