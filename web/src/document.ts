// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// One document, read and changed through @bgotink/kdl's format-preserving model. A change here
// touches only the node it's about: everything else, comments, order and spacing included, comes
// back out exactly as it went in.

import { format, getLocation, Identifier, InvalidKdlError, Node as NodeClass, parse as parseKdl, Value, type Document, type Entry, type Node } from "@bgotink/kdl";
import { hasMisreadHex, withoutMisreadHex } from "vexyl/hex";
import { encodePathName } from "vexyl/paths";
import { colorArgs } from "./colors.js";
import { factorText } from "./exact.js";
import { exactGrids, rescale } from "./rescale.js";
import type { ONode, Op, OVal, RescalePreview } from "./protocol.js";

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
		doc = parseKdl(withoutMisreadHex(source), { storeLocations: true });
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
	return ![first.leading, kids.trailing, ...kids.nodes.map((n) => n.trailing)].some((t) => t?.includes("\n"));
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
	// The line break after a block's opening brace belongs to its first child.
	const next = list.nodes[index];
	if (index === 0 && next !== undefined && leading.includes("\n") && !(next.leading ?? "").includes("\n")) {
		next.leading = "\n" + (next.leading ?? "");
	}
}

function colorSpots(n: Node): Entry[] {
	const args = n.getArgumentEntries();
	return colorArgs(n.getName(), args.length).map((i) => args[i]!);
}

/** Every value in the file that names a color, with the term it's in: a gradient's colors, and every color spot outside the palette. */
function colorRefs(doc: Document): { node: Node; entry: Entry; inPalette: boolean }[] {
	const out: { node: Node; entry: Entry; inPalette: boolean }[] = [];
	const visit = (list: Node[], inPalette: boolean): void => {
		for (const n of list) {
			if (inPalette) {
				if (n.getArgument(0) === "gradient") {
					out.push(...n.getArgumentEntries().slice(1).map((entry) => ({ node: n, entry, inPalette })));
				}
				continue;
			}
			out.push(...colorSpots(n).map((entry) => ({ node: n, entry, inPalette })));
			visit(n.children?.nodes ?? [], n.getName() === "palette");
		}
	};
	visit(doc.nodes, false);
	return out;
}

/** Points everything that uses one color at another. */
function pointColor(doc: Document, from: string, to: string): void {
	for (const { entry } of colorRefs(doc)) {
		if (entry.value.value === from) {
			entry.value = new Value(to);
		}
	}
}

function renameColor(doc: Document, from: string, to: string): void {
	for (const p of doc.nodes.filter((n) => n.getName() === "palette")) {
		for (const n of p.children?.nodes ?? []) {
			if (n.getName() === from) {
				n.setName(to);
			}
		}
	}
	pointColor(doc, from, to);
}

/**
 * Takes a color out of the palette. Whatever uses it uses `to` instead, as one change, and without a `to`
 * nothing may use it. A gradient can only take its place where a gradient can be, and not if it's made from it.
 */
function removeColor(doc: Document, name: string, to: string | undefined): void {
	const list = doc.nodes.find((n) => n.getName() === "palette")?.children ?? null;
	const index = list?.nodes.findIndex((n) => n.getName() === name) ?? -1;
	if (list === null || index < 0) {
		throw new Error(`There's no color called ${name} in the palette.`);
	}
	const users = colorRefs(doc).filter(({ entry }) => entry.value.value === name);
	if (to === undefined) {
		if (users.length > 0) {
			throw new Error(`${name} is still used, so something else has to take its place.`);
		}
	} else {
		const into = list.nodes.find((n) => n.getName() === to);
		if (to === name || into === undefined) {
			throw new Error(`There's no other color called ${to} in the palette to use instead.`);
		}
		if (into.getArgument(0) === "gradient") {
			if (into.getArgumentEntries().slice(1).some((e) => e.value.value === name)) {
				throw new Error(`${to} is made from ${name}, so it can't take its place.`);
			}
			if (users.some(({ node, inPalette }) => inPalette || (node.getName() === "charge" && node.getArgument(0) === "svg"))) {
				throw new Error(`${name} is used where only a solid color can be, so a gradient can't take its place.`);
			}
		}
		pointColor(doc, name, to);
	}
	removeFrom(list, index);
}

/** Renames a variant, a fold or a definition, and, for a definition, everything that uses it. */
function renameTerm(doc: Document, kind: string, from: string, to: string): void {
	for (const n of doc.nodes) {
		const name = n.getArgumentEntries()[0];
		if (n.getName() === kind && name?.value.value === from) {
			name.value = new Value(to);
		}
	}
	if (kind !== "define") {
		return;
	}
	const visit = (list: Node[], asShape: boolean): void => {
		for (const n of list) {
			const name = n.getName();
			if (name === "meta" || name === "palette") {
				continue;
			}
			if (asShape && name === from) {
				n.setName(to);
			}
			const first = n.getArgumentEntries()[0];
			if ((name === "use" || name === "charge") && first?.value.value === from) {
				first.value = new Value(to);
			}
			visit(n.children?.nodes ?? [], name === "clip" || name === "cut");
		}
	};
	visit(doc.nodes, false);
}

/** Puts new text in place of one term's, as long as it's still one term and the file can still be read. */
function replaceText(text: string, op: Extract<Op, { op: "replaceText" }>): { text?: string; error?: string } {
	if (text.slice(op.start, op.end) !== op.was) {
		return { error: "That part of the file has changed, so look it over and try again." };
	}
	const to = op.to.trim();
	const unreadable = "That can't be read as KDL yet. Check its braces and quotes.";
	let count: number;
	try {
		count = (parseKdl(to) as Document).nodes.length;
	} catch {
		return { error: unreadable };
	}
	if (count !== 1) {
		return { error: count === 0 ? "To take this out, use Remove." : "This holds one term. Add others from the form, or in the whole file." };
	}
	const out = text.slice(0, op.start) + to + text.slice(op.end);
	try {
		parseKdl(out);
	} catch {
		return { error: unreadable };
	}
	return { text: out };
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
		case "removeColor":
			removeColor(doc, op.name, op.to);
			return;
		case "renameTerm":
			renameTerm(doc, op.kind, op.from, op.to);
			return;
		case "rescale":
			rescale(doc, op.hoist);
			return;
		case "replaceText":
			throw new Error("that change can't be made with others");
	}
}

/** Says what restating a flag on a grid with this hoist would do, changing nothing. */
export function rescalePreview(text: string, hoist: string): RescalePreview {
	try {
		const doc = parseKdl(withoutMisreadHex(text)) as Document;
		const { factor, rounded, values } = rescale(doc, hoist, true);
		return { factor: factorText(factor), changed: values.length, rounded, exact: rounded.length > 0 ? exactGrids(doc) : [], comments: /(^|\s)\/[/*]/m.test(text) };
	} catch (e) {
		return { error: (e as Error).message };
	}
}

/** Makes changes to a document, giving the new text. Everything it doesn't touch stays byte for byte. */
export function applyOps(text: string, ops: Op[]): { text?: string; error?: string } {
	if (hasMisreadHex(text)) {
		return { error: "A hexadecimal number right before a semicolon on the same line stops the form changing this file. Put what follows on its own line in Source." };
	}
	let doc: Document;
	try {
		doc = parseKdl(text);
	} catch {
		return { error: "The file can't be read as KDL just now, so fix it in Source first." };
	}
	if (ops.length === 1 && ops[0]!.op === "replaceText") {
		return replaceText(text, ops[0]!);
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
