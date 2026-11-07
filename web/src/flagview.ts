// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// How Basic reads a file: what's on the flag in plain names, where each thing is, and what it has no
// controls for, which it leaves alone and says is there. Sizes are read from the file's nodes, so that
// everything here is plain arithmetic and can be tested without a page.

import { plus, type Fraction } from "./exact.js";
import { plainLayers, plainName, plainProperties } from "./plain.js";
import { exactOf, shareText } from "./snap.js";
import type { ONode, Op, OVal } from "./protocol.js";

export const vNum = (raw: string): OVal => ({ v: Number(raw), raw });
export const vStr = (v: string): OVal => ({ v });
export const kid = (n: ONode | undefined, name: string, nth = 0): ONode | undefined => n?.kids.filter((k) => k.name === name)[nth];
export const prop = (n: ONode | undefined, name: string): OVal | undefined => n?.props.find(([k]) => k === name)?.[1];
export const rawOf = (o: OVal | undefined, none = "0"): string => (o === undefined || o.v === null ? none : o.raw ?? String(o.v));
export const numOf = (o: OVal | undefined, none = 0): number => (typeof o?.v === "number" ? o.v : none);
const arg0 = (n: ONode | undefined): OVal | undefined => n?.args[0];

/** Finds a node by its path, wherever it is. */
export function findLayer(nodes: readonly ONode[], path: string): ONode | null {
	for (const n of nodes) {
		if (n.path === path) {
			return n;
		}
		const found = findLayer(n.kids, path);
		if (found !== null) {
			return found;
		}
	}
	return null;
}

/** Where a thing sits, in the flag's grid units, with its size as the file writes it. */
export interface Region {
	x: number;
	y: number;
	w: number;
	h: number;
	wText: string;
	hText: string;
	/** The block it's inside, if it isn't on the flag itself. */
	holder: ONode | null;
}

export function flagRegion(nodes: readonly ONode[]): Region | null {
	const p = nodes.find((n) => n.name === "proportion");
	const [w, h] = [numOf(prop(p, "fly")), numOf(prop(p, "hoist"))];
	return p === undefined || !(w > 0) || !(h > 0) ? null : { x: 0, y: 0, w, h, wText: rawOf(prop(p, "fly")), hText: rawOf(prop(p, "hoist")), holder: null };
}

/** The nodes holding this one, outermost first. */
export function holdersOf(node: ONode, nodes: readonly ONode[]): ONode[] {
	const out: ONode[] = [];
	let list = nodes;
	for (const i of node.at.slice(0, -1)) {
		const n = list[i];
		if (n === undefined) {
			break;
		}
		out.push(n);
		list = n.kids;
	}
	return out;
}

/** The region a panel makes within its parent's. */
function blockIn(block: ONode, parent: Region): Region | null {
	const c = (name: string): OVal | undefined => arg0(kid(block, name));
	if (block.name === "canton") {
		return { x: parent.x, y: parent.y, w: numOf(c("fly")), h: numOf(c("hoist")), wText: rawOf(c("fly")), hText: rawOf(c("hoist")), holder: block };
	}
	const side = c("side")?.v;
	if (typeof side === "string") {
		const width = numOf(c("width"));
		const text = rawOf(c("width"));
		switch (side) {
			case "hoist": return { ...parent, w: width, wText: text, holder: block };
			case "fly": return { ...parent, x: parent.x + parent.w - width, w: width, wText: text, holder: block };
			case "top": return { ...parent, h: width, hText: text, holder: block };
			case "bottom": return { ...parent, y: parent.y + parent.h - width, h: width, hText: text, holder: block };
			default: return null;
		}
	}
	const [w, h] = [numOf(c("fly")), numOf(c("hoist"))];
	const corner = c("corner")?.v;
	const placed = { w, h, wText: rawOf(c("fly")), hText: rawOf(c("hoist")), holder: block };
	if (typeof corner === "string") {
		return { ...placed, x: parent.x + (corner.endsWith("fly") ? parent.w - w : 0), y: parent.y + (corner.startsWith("lower") ? parent.h - h : 0) };
	}
	const at = kid(block, "at");
	const [cx, cy] = at === undefined || at.args[0]?.v === "center" ? [parent.w / 2, parent.h / 2] : [numOf(prop(at, "fly"), parent.w / 2), numOf(prop(at, "hoist"), parent.h / 2)];
	return { ...placed, x: parent.x + cx - w / 2, y: parent.y + cy - h / 2 };
}

/** The region a layer's coordinates are in, or null if it's somewhere that's not on the flag's own face, or that has a frame of its own. */
export function regionOf(node: ONode, nodes: readonly ONode[]): Region | null {
	let r = flagRegion(nodes);
	for (const holder of holdersOf(node, nodes)) {
		if (r === null) {
			return null;
		}
		if (holder.name === "canton" || holder.name === "panel") {
			r = blockIn(holder, r);
		} else {
			return null;
		}
	}
	return r;
}

/** A panel's or canton's own region, within what holds it. */
export function blockRegion(block: ONode, nodes: readonly ONode[]): { parent: Region; own: Region } | null {
	const parent = regionOf(block, nodes);
	const own = parent === null ? null : blockIn(block, parent);
	return parent === null || own === null ? null : { parent, own };
}

const radiusShapes = new Set(["disc", "ring", "plus", "triangle", "star", "crescent", "sun", "heart", "cardioid"]);
const boxShapes = new Set(["ellipse", "rect", "lozenge"]);
export const isOrdinaryShape = (shape: string): boolean => radiusShapes.has(shape) || boxShapes.has(shape);

/** The sizes of a shape that go along with its overall size, and are scaled with it so that it keeps its look. */
export const scaledWith: Readonly<Record<string, readonly string[]>> = { ring: ["inner"], plus: ["width"], star: ["inner"], crescent: ["inner", "offset"], sun: ["disc", "gap"], heart: ["spread"] };

const shapeKids: Readonly<Record<string, readonly string[]>> = { star: ["points"], sun: ["points", "spread"] };

/** A symbol as the things Basic can do to it need it. */
export interface ChargeView {
	node: ONode;
	shape: string;
	region: Region;
	/** Where it is within its region, or null if it's in more than one place or spread over a grid. */
	at: { x: number; y: number } | null;
	written: "none" | "center" | "one" | "many";
	form: string;
	/** From its center to its edge, for a shape with one size, or else its width and height. */
	radius: number;
	width: number;
	height: number;
	boxed: boolean;
	rotate: number;
	points: number | null;
	ringRadius: number;
}

export function readCharge(node: ONode, nodes: readonly ONode[]): ChargeView | null {
	const shape = String(node.args[0]?.v ?? "");
	const region = regionOf(node, nodes);
	if (region === null || node.name !== "charge" || !isOrdinaryShape(shape)) {
		return null;
	}
	const ats = node.kids.filter((k) => k.name === "at");
	const repeat = kid(node, "repeat");
	const form = repeat === undefined ? "one" : String(repeat.args[0]?.v ?? "");
	const written = ats.length > 1 ? "many" : ats.length === 0 ? "none" : ats[0]!.args[0]?.v === "center" ? "center" : "one";
	const one = written === "one" ? ats[0] : undefined;
	const at = written === "many" || form === "grid" ? null : { x: numOf(prop(one, "fly"), region.w / 2), y: numOf(prop(one, "hoist"), region.h / 2) };
	const boxed = boxShapes.has(shape);
	const size = (name: string, none: number): number => numOf(arg0(kid(node, name)), none);
	const points = kid(node, "points") !== undefined ? numOf(arg0(kid(node, "points"))) : shape === "star" ? 5 : shape === "sun" ? 12 : null;
	return {
		node, shape, region, at, written, form, boxed, points,
		radius: size("radius", 0),
		width: size("fly", shape === "lozenge" ? region.w : 0),
		height: size("hoist", shape === "lozenge" ? region.h : 0),
		rotate: numOf(arg0(kid(node, "rotate"))),
		ringRadius: numOf(prop(repeat, "radius")),
	};
}

/** How far a symbol reaches from its position, each way, before it's turned. */
export function chargeReach(c: ChargeView): { left: number; top: number; right: number; bottom: number } {
	const r = c.radius;
	if (c.boxed) {
		return { left: c.width / 2, top: c.height / 2, right: c.width / 2, bottom: c.height / 2 };
	}
	if (c.shape === "heart") {
		const half = numOf(arg0(kid(c.node, "spread")), r * Math.SQRT2) / 2;
		return { left: half + r, top: r, right: half + r, bottom: half + r * Math.SQRT2 };
	}
	if (c.shape === "cardioid") {
		return { left: r * 0.65, top: r * 0.15, right: r * 0.65, bottom: r };
	}
	return { left: r, top: r, right: r, bottom: r };
}

/** Whether its box turns with it. A round or pointed symbol stays in the same box however it's turned. */
export const boxTurns = (c: ChargeView): boolean => c.boxed || c.shape === "heart" || c.shape === "cardioid" || c.shape === "crescent";

/** Stripes as a list, however the file writes them. */
export interface BarsView {
	node: ONode;
	colors: OVal[];
	/** The widths as written, one for each stripe, in the file's own numbers. */
	widths: string[];
	along: string;
	counted: boolean;
}

export function readBars(node: ONode): BarsView {
	const given = node.args;
	const count = numOf(arg0(kid(node, "count")));
	const colors = count > 0 ? Array.from({ length: count }, (_, i) => given[i % Math.max(given.length, 1)]!) : [...given];
	const ratio = kid(node, "ratio")?.args.map((o) => rawOf(o)) ?? [];
	return { node, colors, widths: ratio.length === colors.length ? ratio : colors.map(() => "1"), along: String(arg0(kid(node, "along"))?.v ?? "fly"), counted: count > 0 };
}

/** How far across each stripe's end is, as shares from 0 to 1, for all but the last. */
export function barLines(b: BarsView): number[] {
	const exact = b.widths.map(exactOf);
	const total = exact.reduce(plus);
	const out: number[] = [];
	let run: Fraction = { n: 0n, d: 1n };
	for (const w of exact.slice(0, -1)) {
		run = plus(run, w);
		out.push((Number(run.n) * Number(total.d)) / (Number(run.d) * Number(total.n)));
	}
	return out;
}

/** Stripes run straight along the flag only if nothing's turned them. */
export const barsAreStraight = (b: BarsView): boolean => (b.along === "fly" || b.along === "hoist") && kid(b.node, "rotate") === undefined;

export interface Item {
	path: string;
	node: ONode;
	label: string;
	note: string;
	color?: string | undefined;
	depth: number;
}

export interface AlsoItem {
	/** The part to go to in Advanced, if it has one. */
	path: string | null;
	label: string;
}

/** The children Basic reads for each term it has controls for. Anything else is left alone and listed. */
const readKids: Readonly<Record<string, readonly string[]>> = {
	field: [], bars: ["along", "count", "ratio"], band: ["along", "width", "offset"], cross: ["fly", "hoist"], saltire: ["width"], quarters: ["split"], checks: ["rows", "columns"],
	chevrons: ["from", "depth"], rays: ["count"], pile: ["from", "depth"], pall: ["from", "width"], canton: ["fly", "hoist"], panel: ["side", "corner", "width", "fly", "hoist", "at"],
};

const wholeParts: Readonly<Record<string, (n: ONode) => string>> = {
	outline: () => "Flag outline",
	border: () => "Border",
	reverse: () => "A different back",
	adapt: () => "Other proportions",
	variant: (n) => `Other form: ${String(n.args[0]?.v)}`,
	fold: (n) => `Way of folding: ${String(n.args[0]?.v)}`,
	define: (n) => `Reusable part: ${String(n.args[0]?.v)}`,
};
const known = new Set(["vexyl", "meta", "palette", "proportion"]);
const holds = new Set(["canton", "panel"]);

const safeHex = (c: unknown): string | undefined => (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c) ? c : undefined);

export const colorsOf = (nodes: readonly ONode[]): Map<string, string> => {
	const out = new Map<string, string>();
	for (const k of nodes.find((n) => n.name === "palette")?.kids ?? []) {
		const hex = safeHex(k.args[0]?.v);
		if (hex !== undefined) {
			out.set(k.name, hex);
		}
	}
	return out;
};

/** A block's first field is its color, so it's part of the block, not a thing of its own. */
export const ownField = (block: ONode): ONode | undefined => {
	const first = block.kids.find((k) => k.path !== undefined);
	return first?.name === "field" ? first : undefined;
};

function noteOf(n: ONode, nodes: readonly ONode[]): string {
	switch (n.name) {
		case "bars":
			return `${readBars(n).colors.length} stripes`;
		case "canton": {
			const place = blockRegion(n, nodes);
			return place === null ? "" : `${shareText(place.own.w / place.parent.w)} wide`;
		}
		case "charge": {
			const c = readCharge(n, nodes);
			if (c === null) {
				return "";
			}
			if (c.written === "many") {
				return `In ${n.kids.filter((k) => k.name === "at").length} places`;
			}
			const repeat = kid(n, "repeat");
			if (c.form === "grid") {
				return `${numOf(prop(repeat, "rows")) * numOf(prop(repeat, "columns"))} in a grid`;
			}
			if (c.form !== "one") {
				return `${numOf(prop(repeat, "count"))} in a ${c.form}`;
			}
			return c.shape === "star" ? `${c.points ?? 5} points` : "";
		}
		default:
			return "";
	}
}

function colorOf(n: ONode, colors: ReadonlyMap<string, string>): string | undefined {
	if (n.name === "charge") {
		return colors.get(String(n.args[1]?.v));
	}
	if (holds.has(n.name)) {
		const own = ownField(n);
		return own !== undefined ? colors.get(String(own.args[0]?.v)) : undefined;
	}
	return colors.get(String(n.args[0]?.v));
}

function kidsLeftAlone(n: ONode, name: string, also: AlsoItem[]): void {
	const reads = n.name === "charge" ? chargeReads(n) : new Set(readKids[n.name] ?? []);
	const seen = new Set<string>();
	for (const k of n.kids) {
		if (reads.has(k.name) || seen.has(k.name) || (k.path !== undefined && holds.has(n.name))) {
			continue;
		}
		seen.add(k.name);
		also.push({ path: n.path ?? null, label: `${Object.hasOwn(plainProperties, k.name) ? plainProperties[k.name]! : k.name} on ${name}` });
	}
}

/** What Basic reads of a symbol, which depends on its shape. */
function chargeReads(n: ONode): Set<string> {
	const shape = String(n.args[0]?.v);
	const reads = new Set(["at", "rotate", ...(scaledWith[shape] ?? []), ...(shapeKids[shape] ?? []), ...(boxShapes.has(shape) ? ["fly", "hoist"] : ["radius"])]);
	const form = kid(n, "repeat")?.args[0]?.v;
	if (form === undefined || form === "grid" || form === "ring") {
		reads.add("repeat");
	}
	return reads;
}

/** Whether Basic can work with this layer at all. */
export function hasControls(n: ONode): boolean {
	return n.name === "charge" ? isOrdinaryShape(String(n.args[0]?.v)) : Object.hasOwn(readKids, n.name);
}

/** What's on the flag, in plain names, and everything Basic has no controls for. */
export function readFlag(nodes: readonly ONode[]): { items: Item[]; also: AlsoItem[] } {
	const colors = colorsOf(nodes);
	const items: Item[] = [];
	const also: AlsoItem[] = [];
	const layer = (n: ONode, depth: number, holder: ONode | null): void => {
		if (n.path === undefined || (holder !== null && ownField(holder) === n)) {
			return;
		}
		const name = plainName(n);
		if (!hasControls(n)) {
			also.push({ path: n.path, label: n.name === "use" ? `Reusable part: ${String(n.args[0]?.v)}` : name });
			return;
		}
		items.push({ path: n.path, node: n, label: name, note: noteOf(n, nodes), color: colorOf(n, colors), depth });
		kidsLeftAlone(n, name, also);
		if (holds.has(n.name)) {
			for (const k of n.kids) {
				layer(k, depth + 1, n);
			}
		}
	};
	for (const n of nodes) {
		if (known.has(n.name)) {
			continue;
		}
		const whole = Object.hasOwn(wholeParts, n.name) ? wholeParts[n.name] : undefined;
		if (whole !== undefined) {
			also.push({ path: n.path ?? null, label: whole(n) });
		} else if (n.path !== undefined && Object.hasOwn(plainLayers, n.name)) {
			layer(n, 0, null);
		} else {
			also.push({ path: n.path ?? null, label: n.name });
		}
	}
	return { items, also };
}

/** A line across its region, or a point, that something else can snap to, in the flag's grid units. */
export function edgesOf(nodes: readonly ONode[], skip: string | null): { across: number[]; down: number[] } {
	const across: number[] = [];
	const down: number[] = [];
	const visit = (list: readonly ONode[], r: Region): void => {
		for (const n of list) {
			if (n.path === undefined || n.path === skip) {
				continue;
			}
			if (n.name === "bars") {
				const b = readBars(n);
				if (barsAreStraight(b)) {
					for (const at of barLines(b)) {
						if (b.along === "fly") {
							down.push(r.y + at * r.h);
						} else {
							across.push(r.x + at * r.w);
						}
					}
				}
			} else if (n.name === "canton" || n.name === "panel") {
				const own = blockIn(n, r);
				if (own !== null) {
					if (own.w < r.w) {
						across.push(own.x === r.x ? own.x + own.w : own.x);
					}
					if (own.h < r.h) {
						down.push(own.y === r.y ? own.y + own.h : own.y);
					}
					visit(n.kids, own);
				}
			} else if (n.name === "cross") {
				const arm = (name: string): number[] => {
					const v = kid(n, name)?.args.map((o) => numOf(o)) ?? [];
					const total = v.reduce((s, x) => s + x, 0);
					return total > 0 && v.length === 3 ? [v[0]! / total, (v[0]! + v[1]!) / total] : [];
				};
				across.push(...arm("fly").map((s) => r.x + s * r.w));
				down.push(...arm("hoist").map((s) => r.y + s * r.h));
			} else if (n.name === "band") {
				const along = String(arg0(kid(n, "along"))?.v ?? "fly");
				const half = numOf(arg0(kid(n, "width"))) / 2;
				const offset = numOf(arg0(kid(n, "offset")));
				if (along === "fly") {
					down.push(r.y + r.h / 2 + offset - half, r.y + r.h / 2 + offset + half);
				} else if (along === "hoist") {
					across.push(r.x + r.w / 2 + offset - half, r.x + r.w / 2 + offset + half);
				}
			}
		}
	};
	const flag = flagRegion(nodes);
	if (flag !== null) {
		visit(nodes, flag);
	}
	return { across, down };
}

/** The same edges, as shares of a region. */
export function edgesWithin(edges: readonly number[], start: number, size: number): number[] {
	return edges.map((e) => (e - start) / size).filter((s) => s > 0 && s < 1);
}

function withOp(list: readonly ONode[], at: readonly number[], change: (n: ONode) => ONode): ONode[] {
	const out = [...list];
	const i = at[0]!;
	const n = out[i];
	if (n !== undefined) {
		out[i] = at.length === 1 ? change(n) : { ...n, kids: withOp(n.kids, at.slice(1), change) };
	}
	return out;
}

function setEntries(n: ONode, args: OVal[] | undefined, props: readonly [string, OVal | null][] | undefined): ONode {
	const list = [...n.props];
	for (const [k, v] of props ?? []) {
		const i = list.findIndex(([p]) => p === k);
		if (v === null) {
			if (i >= 0) {
				list.splice(i, 1);
			}
		} else if (i >= 0) {
			list[i] = [k, v];
		} else {
			list.push([k, v]);
		}
	}
	return { ...n, args: args ?? n.args, props: list };
}

/**
 * Makes the same changes to the nodes as the file will get, for showing them at once, before the
 * file has caught up. Only what a drag changes is needed, which is a node's own entries and children.
 */
export function withOps(nodes: readonly ONode[], ops: readonly Op[]): ONode[] {
	let out = [...nodes];
	for (const op of ops) {
		if (op.op === "entries") {
			out = withOp(out, op.at, (n) => setEntries(n, op.args, op.props));
		} else if (op.op === "child") {
			out = withOp(out, op.at, (n) => {
				const same = n.kids.filter((k) => k.name === op.name);
				const old = same[op.nth ?? 0];
				if (old !== undefined) {
					return { ...n, kids: n.kids.map((k) => (k === old ? setEntries(k, op.args, op.props) : k)) };
				}
				const made: ONode = { name: op.name, args: op.args ?? [], props: setEntries({ props: [] } as unknown as ONode, undefined, op.props).props, kids: [], at: [...n.at, n.kids.length], start: n.end, end: n.end, line: n.line, endLine: n.line, block: false };
				return { ...n, kids: [...n.kids, made] };
			});
		} else if (op.op === "dropChild") {
			out = withOp(out, op.at, (n) => {
				const old = n.kids.filter((k) => k.name === op.name)[op.nth ?? 0];
				return { ...n, kids: n.kids.filter((k) => k !== old) };
			});
		}
	}
	return out;
}
