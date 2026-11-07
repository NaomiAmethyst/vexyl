// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// One document, read and changed through @bgotink/kdl's format-preserving model. A change here
// touches only the node it's about: everything else, comments, order and spacing included, comes
// back out exactly as it went in.

import { format, getLocation, Identifier, InvalidKdlError, Node as NodeClass, parse as parseKdl, Value, type Document, type Entry, type Node } from "@bgotink/kdl";
import { encodePathName } from "vexyl/paths";
import type { ONode, Op, OVal } from "./protocol.js";

const layerNames = new Set(["field", "bars", "chevrons", "band", "cross", "saltire", "quarters", "checks", "rays", "pile", "pall", "charge", "emblem", "group", "panel", "canton", "use"]);
const holdsLayers = new Set(["emblem", "group", "panel", "canton"]);
const biggest = 4096;

function oval(v: Value): OVal {
	const value = v.value;
	if (typeof value === "string" && value.length > biggest) {
		return { v: value.slice(0, biggest), big: value.length };
	}
	if (typeof value === "number" && v.representation !== undefined) {
		// The semicolon is there because of how @bgotink/kdl 0.4.1 reads a hexadecimal number.
		return { v: value, raw: v.representation.replace(/;$/, "") };
	}
	return { v: value };
}

function lineStarts(source: string): number[] {
	const starts = [0];
	for (let i = source.indexOf("\n"); i >= 0; i = source.indexOf("\n", i + 1)) {
		starts.push(i + 1);
	}
	return starts;
}

function lineOf(starts: number[], offset: number): number {
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
	return lo + 1;
}

/** Gives a document's nodes for the form, or null if it isn't KDL. Paths are the same as `locate` gives. */
export function outline(source: string): ONode[] | null {
	let doc: Document;
	try {
		doc = parseKdl(source, { storeLocations: true });
	} catch (e) {
		if (e instanceof InvalidKdlError) {
			return null;
		}
		throw e;
	}
	const starts = lineStarts(source);
	const one = (n: Node, at: number[], path: string | undefined, kids: (list: Node[], at: number[]) => ONode[]): ONode => {
		const place = getLocation(n)!;
		let end = place.end.offset;
		while (end > place.start.offset && /[\s;]/.test(source[end - 1]!)) {
			end--;
		}
		const out: ONode = {
			name: n.getName(),
			args: n.getArgumentEntries().map((e) => oval(e.value)),
			props: n.getPropertyEntries().map((e) => [e.getName()!, oval(e.value)] as [string, OVal]),
			kids: kids(n.children?.nodes ?? [], at),
			at,
			start: place.start.offset,
			end,
			line: lineOf(starts, place.start.offset),
			endLine: lineOf(starts, end),
			block: n.children !== null,
		};
		if (path !== undefined) {
			out.path = path;
		}
		return out;
	};
	const plain = (list: Node[], at: number[]): ONode[] => list.map((n, i) => one(n, [...at, i], undefined, plain));
	const layers = (base: string) => (list: Node[], at: number[]): ONode[] => {
		let index = 0;
		return list.map((n, i) => {
			if (!layerNames.has(n.getName())) {
				return one(n, [...at, i], undefined, plain);
			}
			const path = base + index++;
			return one(n, [...at, i], path, holdsLayers.has(n.getName()) ? layers(path + ".") : plain);
		});
	};
	const named = (n: Node, kind: string): string | undefined => {
		const name = n.getArgument(0);
		return typeof name === "string" ? `${kind}/${encodePathName(name)}` : undefined;
	};
	let index = 0;
	return doc.nodes.map((n, i) => {
		const name = n.getName();
		const at = [i];
		if (layerNames.has(name)) {
			const path = String(index++);
			return one(n, at, path, holdsLayers.has(name) ? layers(path + ".") : plain);
		}
		if (name === "palette") {
			return one(n, at, name, (list, a) => list.map((c, j) => one(c, [...a, j], `palette/${encodePathName(c.getName())}`, plain)));
		}
		if (name === "define" || name === "fold") {
			const path = named(n, name);
			return one(n, at, path, name === "define" && path !== undefined ? layers(path + "/") : plain);
		}
		if (name === "variant") {
			const path = named(n, name);
			return one(n, at, path, (list, a) => {
				const kids = path === undefined ? plain(list, a) : layers(path + "/")(list, a);
				if (path !== undefined) {
					for (const k of kids) {
						if (k.name === "outline" || k.name === "border") {
							k.path = `${path}/${k.name}`;
						}
					}
				}
				return kids;
			});
		}
		if (name === "reverse") {
			return one(n, at, name, layers("reverse/"));
		}
		return one(n, at, name, plain);
	});
}

function makeValue(o: OVal): Value {
	const v = new Value(o.v);
	if (typeof o.v === "number" && o.raw !== undefined) {
		v.representation = o.raw;
	}
	return v;
}

const same = (e: Entry, o: OVal): boolean => e.value.value === o.v && (o.raw === undefined || e.value.representation?.replace(/;$/, "") === o.raw);

/** Replaces a value, keeping a semicolon that @bgotink/kdl 0.4.1 read as part of a hexadecimal number. */
function replaceValue(n: Node, e: Entry, o: OVal): void {
	if (e.value.representation?.endsWith(";") === true && typeof e.value.value === "number") {
		n.trailing = ";" + (n.trailing ?? "");
	}
	e.value = makeValue(o);
}

function setArgs(n: Node, args: OVal[]): void {
	const existing = n.getArgumentEntries();
	args.forEach((a, i) => {
		const e = existing[i];
		if (e === undefined) {
			n.addArgument(a.v, null, i);
			const added = n.getArgumentEntry(i)!;
			added.value = makeValue(a);
		} else if (!same(e, a)) {
			replaceValue(n, e, a);
		}
	});
	for (let i = existing.length - 1; i >= args.length; i--) {
		n.removeArgument(i);
	}
}

function setProps(n: Node, props: [string, OVal | null][]): void {
	for (const [name, o] of props) {
		const e = n.getPropertyEntry(name);
		if (o === null) {
			if (e !== undefined) {
				n.deleteProperty(name);
			}
		} else if (e === undefined) {
			n.setProperty(name, o.v);
			n.getPropertyEntry(name)!.value = makeValue(o);
		} else if (!same(e, o)) {
			replaceValue(n, e, o);
		}
	}
}

function nodeAt(doc: Document, at: number[]): Node {
	let list = doc.nodes;
	let node: Node | undefined;
	for (const i of at) {
		node = list[i];
		if (node === undefined) {
			throw new Error("that part of the file has changed");
		}
		list = node.children?.nodes ?? [];
	}
	if (node === undefined) {
		throw new Error("that part of the file has changed");
	}
	return node;
}

function indentOf(n: Node | undefined): string {
	const m = /(?:^|\n)([ \t]*)$/.exec(n?.leading ?? "");
	return m?.[1] ?? "";
}

function ownIndent(doc: Document, at: number[]): string {
	if (at.length === 0) {
		return "";
	}
	const node = nodeAt(doc, at);
	if (at.length === 1) {
		return indentOf(node);
	}
	return indentOf(node);
}

const childIndent = (parentIndent: string): string => parentIndent + "  ";

/** Gets a node's list of children, making a block for them if it has none. */
function ensureBlock(n: Node, indent: string): Document {
	if (n.children === null) {
		n.children = parseKdl("") as Document;
		n.beforeChildren = " ";
		n.children.trailing = "\n" + indent;
	}
	return n.children;
}

function isInline(kids: Document): boolean {
	const first = kids.nodes[0];
	if (first === undefined) {
		return false;
	}
	return !(first.leading ?? "").includes("\n");
}

/** Whether a node's own text already ends in what separates it from the next. */
function terminated(n: Node): boolean {
	const trailing = n.trailing ?? "";
	if (trailing.includes(";") || trailing.includes("\n")) {
		return true;
	}
	// @bgotink/kdl 0.4.1 keeps a semicolon after a hexadecimal number as part of the number.
	return n.children === null && n.entries.at(-1)?.value.representation?.endsWith(";") === true;
}

/** Puts new nodes in a list, in the same form as the ones there. */
function insert(list: Document, nodes: Node[], index: number, indent: string, top: boolean): void {
	const inline = !top && isInline(list);
	for (const [k, n] of nodes.entries()) {
		const at = index + k;
		const before = list.nodes[at - 1];
		const after = list.nodes[at];
		if (inline) {
			n.leading = " ";
			n.trailing = ";";
			if (before !== undefined) {
				// What separated the last one from the closing brace now follows this one.
				const space = /[ \t]*$/.exec(before.trailing ?? "")![0];
				before.trailing = (before.trailing ?? "").slice(0, (before.trailing ?? "").length - space.length);
				n.trailing = ";" + space;
				if (!terminated(before)) {
					before.trailing = ";" + (before.trailing ?? "");
				}
			}
		} else if (top) {
			n.leading = "";
			n.trailing = "\n";
			if (before !== undefined && !terminated(before)) {
				before.trailing = (before.trailing ?? "") + "\n";
			}
		} else {
			n.leading = indent;
			n.trailing = "\n";
			if (before === undefined) {
				// A block's first node starts on the line after its brace, and what was first moves down.
				n.leading = "\n" + indent;
				if (after !== undefined && (after.leading ?? "").startsWith("\n")) {
					after.leading = (after.leading ?? "").slice(1);
				} else if (after === undefined) {
					list.trailing = indent.slice(0, -2);
				}
			} else if (!terminated(before)) {
				before.trailing = (before.trailing ?? "") + "\n";
			}
		}
		list.nodes.splice(at, 0, n);
	}
}

/** Where a new child's line goes: after what describes the node, before any layers, so layers keep their numbers. */
function childPlace(n: Node): number {
	const kids = n.children?.nodes ?? [];
	const first = kids.findIndex((k) => layerNames.has(k.getName()));
	return first < 0 ? kids.length : first;
}

const topOrder = ["vexyl", "meta", "palette", "proportion", "outline", "border", "define", "<layers>", "reverse", "adapt", "variant", "fold"];
const stageOf = (name: string): number => topOrder.indexOf(topOrder.includes(name) ? name : "<layers>");

/** Where a new top-level node goes, since the format fixes their order. */
export function topPlace(doc: Document, name: string): number {
	const stage = stageOf(name);
	let i = 0;
	for (const [k, n] of doc.nodes.entries()) {
		if (stageOf(n.getName()) <= stage) {
			i = k + 1;
		}
	}
	return i;
}

/** Takes a node out, keeping any comments written above it. */
function removeFrom(list: Document, index: number): void {
	const n = list.nodes[index]!;
	const leading = n.leading ?? "";
	list.nodes.splice(index, 1);
	if (/\/[/*]/.test(leading)) {
		const next = list.nodes[index];
		if (next !== undefined) {
			next.leading = leading.replace(/[ \t]*$/, "") + (next.leading ?? "");
		} else {
			list.trailing = leading + (list.trailing ?? "");
		}
	}
}

function colorSpots(n: Node): Entry[] {
	const args = n.getArgumentEntries();
	switch (n.getName()) {
		case "field": case "band": case "cross": case "saltire": case "pile": case "pall": case "fimbriate": case "border":
			return args.slice(0, 1);
		case "bars": case "chevrons": case "quarters": case "checks": case "rays":
			return args;
		case "charge":
			return args.slice(1, 2);
		default:
			return [];
	}
}

function renameColor(doc: Document, from: string, to: string): void {
	const visit = (list: Node[], inPalette: boolean): void => {
		for (const n of list) {
			if (inPalette) {
				if (n.getName() === from) {
					n.setName(to);
				}
				if (n.getArgument(0) === "gradient") {
					for (const e of n.getArgumentEntries().slice(1)) {
						if (e.value.value === from) {
							e.value = new Value(to);
						}
					}
				}
				continue;
			}
			for (const e of colorSpots(n)) {
				if (e.value.value === from) {
					e.value = new Value(to);
				}
			}
			visit(n.children?.nodes ?? [], n.getName() === "palette");
		}
	};
	visit(doc.nodes, false);
}

function apply(doc: Document, op: Op): void {
	switch (op.op) {
		case "entries": {
			const n = nodeAt(doc, op.at);
			if (op.args !== undefined) {
				setArgs(n, op.args);
			}
			if (op.props !== undefined) {
				setProps(n, op.props);
			}
			return;
		}
		case "child": {
			const n = nodeAt(doc, op.at);
			const all = (n.children?.nodes ?? []).filter((k) => k.getName() === op.name);
			let child = all[op.nth ?? 0];
			if (child === undefined) {
				const parent = ownIndent(doc, op.at);
				const kids = ensureBlock(n, parent);
				const made = new NodeClass(new Identifier(op.name));
				const lastSame = all.at(-1);
				insert(kids, [made], lastSame !== undefined ? kids.nodes.indexOf(lastSame) + 1 : childPlace(n), childIndent(parent), false);
				child = made;
			}
			if (op.args !== undefined) {
				setArgs(child, op.args);
			}
			if (op.props !== undefined) {
				setProps(child, op.props);
			}
			return;
		}
		case "dropChild": {
			const n = nodeAt(doc, op.at);
			const kids = n.children;
			if (kids === null) {
				return;
			}
			const child = kids.nodes.filter((k) => k.getName() === op.name)[op.nth ?? 0];
			if (child !== undefined) {
				removeFrom(kids, kids.nodes.indexOf(child));
			}
			return;
		}
		case "remove": {
			const parentAt = op.at.slice(0, -1);
			const list = parentAt.length > 0 ? nodeAt(doc, parentAt).children! : doc;
			if (list.nodes[op.at.at(-1)!] === undefined) {
				throw new Error("that part of the file has changed");
			}
			removeFrom(list, op.at.at(-1)!);
			return;
		}
		case "add": {
			const parent = op.at === null ? null : nodeAt(doc, op.at);
			const indent = op.at === null ? "" : childIndent(ownIndent(doc, op.at));
			const text = op.text
				.split("\n")
				.map((l, i) => (i === 0 || l === "" ? l : indent + l))
				.join("\n");
			const made = (parseKdl(text) as Document).nodes;
			if (parent === null) {
				insert(doc, made, op.index ?? topPlace(doc, made[0]!.getName()), "", true);
			} else {
				const kids = ensureBlock(parent, ownIndent(doc, op.at!));
				insert(kids, made, op.index ?? kids.nodes.length, indent, false);
			}
			return;
		}
		case "move": {
			const parentAt = op.at.slice(0, -1);
			const list = parentAt.length > 0 ? nodeAt(doc, parentAt).children! : doc;
			const from = op.at.at(-1)!;
			const to = from + op.delta;
			const a = list.nodes[from];
			const b = list.nodes[to];
			if (a === undefined || b === undefined) {
				return;
			}
			// Each keeps the spacing of where it now is, and its own comments go with it.
			const swap = (x: Node, y: Node): void => {
				const [xt, yt] = [x.trailing, y.trailing];
				x.trailing = yt;
				y.trailing = xt;
			};
			swap(a, b);
			list.nodes[from] = b;
			list.nodes[to] = a;
			return;
		}
		case "renameColor":
			renameColor(doc, op.from, op.to);
			return;
	}
}

/** Makes changes to a document, giving the new text. Everything it doesn't touch stays byte for byte. */
export function applyOps(text: string, ops: Op[]): { text?: string; error?: string } {
	let doc: Document;
	try {
		doc = parseKdl(text);
	} catch {
		return { error: "The file can't be read as KDL just now, so fix it in Source first." };
	}
	try {
		for (const op of ops) {
			apply(doc, op);
		}
		return { text: format(doc) };
	} catch (e) {
		return { error: (e as Error).message };
	}
}
