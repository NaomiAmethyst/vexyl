// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// What each handle on the flag does, and the edits Basic's panel makes. Every one of them works out
// the change from where things started, as plain numbers and edit operations, so the page only has to
// draw the results and pass them on, and each can be tested without one.

import { fraction, minus, plus, times, write, type Fraction } from "./exact.js";
import { barLines, barsAreStraight, blockRegion, boxTurns, chargeReach, colorsOf, edgesOf, edgesWithin, findLayer, flagRegion, kid, numOf, ownField, prop, readBars, readCharge, regionOf, scaledWith, vNum, vStr, type BarsView, type ChargeView, type Region } from "./flagview.js";
import type { ONode, Op, OVal } from "./protocol.js";
import { complement, exactly, exactOf, gridText, onGrid, shareText, snap, snapFraction, type Snapped } from "./snap.js";
import { addedText, colorName, contrasting } from "./templates.js";
import { kdlName } from "./vocab.js";

/** A point in the flag's grid units. */
export interface Point {
	x: number;
	y: number;
}

/** One moment of a drag: the change to make, what to say, and where any guide lines are. */
export interface Step {
	ops: Op[];
	readout: string;
	across?: number;
	down?: number;
}

export type Mover = (from: Point, to: Point, free: boolean) => Step;

export interface Handle {
	id: string;
	label: string;
	look: "dot" | "move" | "across" | "down";
	x: number;
	y: number;
	/** How far a line reaches, or the box a symbol's in, in the flag's grid units. */
	span?: { x: number; y: number; w: number; h: number };
	/** How far that box is turned, about the point. */
	turn?: number;
	cursor: string;
	mover: Mover;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const toNumber = (f: Fraction): number => Number(f.n) / Number(f.d);
const guide = (s: Snapped, at: number): number | undefined => (s.kind === "free" ? undefined : at);
const within = (r: Region): string => (r.holder === null ? "" : r.holder.name === "canton" ? ", in the corner block" : ", in the edge block");

export const whereText = (r: Region, x: number, y: number): string => `${shareText(x)} across, ${shareText(y)} down${within(r)}`;

const setChild = (node: ONode, name: string, text: string): Op => ({ op: "child", at: node.at, name, args: [vNum(text)] });
const withGuides = (step: Step, across: number | undefined, down: number | undefined): Step => ({ ...step, ...(across !== undefined ? { across } : {}), ...(down !== undefined ? { down } : {}) });

/** Puts a symbol somewhere in its region, writing as little as it can. */
export function placeOps(c: ChargeView, x: Snapped, y: Snapped): Op[] {
	const atMiddle = Math.abs(x.v - 0.5) < 1e-9 && Math.abs(y.v - 0.5) < 1e-9;
	if (atMiddle && c.written === "none") {
		return [{ op: "dropChild", at: c.node.at, name: "at" }];
	}
	if (atMiddle && c.written === "center") {
		return [{ op: "child", at: c.node.at, name: "at", args: [vStr("center")], props: [["fly", null], ["hoist", null]] }];
	}
	return [{ op: "child", at: c.node.at, name: "at", args: [], props: [["fly", vNum(onGrid(x, c.region.wText))], ["hoist", vNum(onGrid(y, c.region.hText))]] }];
}

/** What a symbol's size is as a share of its region's height. */
export const sizeShare = (c: ChargeView): number => (c.boxed ? c.height : c.radius) / c.region.h;

/** Makes a symbol this size, with the other numbers of its shape following, so that it keeps its look. */
export function sizeOps(c: ChargeView, s: Snapped): Op[] {
	const text = onGrid(s, c.region.hText);
	const was = c.boxed ? c.height : c.radius;
	const factor = was > 0 ? Number(text) / was : 1;
	if (c.boxed) {
		return [setChild(c.node, "hoist", text), setChild(c.node, "fly", gridText(c.width * factor))];
	}
	const ops = [setChild(c.node, "radius", text)];
	for (const name of scaledWith[c.shape] ?? []) {
		const k = kid(c.node, name);
		if (k !== undefined) {
			ops.push(setChild(c.node, name, gridText(numOf(k.args[0]) * factor)));
		}
	}
	return ops;
}

function moveCharge(c: ChargeView, nodes: readonly ONode[]): Mover {
	const edges = edgesOf(nodes, c.node.path ?? null);
	const r = c.region;
	const across = edgesWithin(edges.across, r.x, r.w);
	const down = edgesWithin(edges.down, r.y, r.h);
	return (from, to, free) => {
		const x = snap(clamp((c.at!.x + to.x - from.x) / r.w, 0, 1), across, free);
		const y = snap(clamp((c.at!.y + to.y - from.y) / r.h, 0, 1), down, free);
		return withGuides({ ops: placeOps(c, x, y), readout: whereText(r, x.v, y.v) }, guide(x, r.x + x.v * r.w), guide(y, r.y + y.v * r.h));
	};
}

const turned = (p: Point, deg: number): Point => {
	const a = (deg * Math.PI) / 180;
	return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
};

function resizeCharge(c: ChargeView, corner: Point): Mover {
	const r = c.region;
	const center = { x: r.x + c.at!.x, y: r.y + c.at!.y };
	const out = { x: corner.x - center.x, y: corner.y - center.y };
	if (c.boxed) {
		return (_from, to, free) => {
			const local = turned({ x: to.x - center.x, y: to.y - center.y }, -c.rotate);
			const w = snapFraction(clamp((2 * Math.abs(local.x)) / r.w, 0.01, 1), free);
			const h = snapFraction(clamp((2 * Math.abs(local.y)) / r.h, 0.01, 1), free);
			const ops = [setChild(c.node, "fly", onGrid(w, r.wText)), setChild(c.node, "hoist", onGrid(h, r.hText))];
			return withGuides({ ops, readout: `${shareText(w.v)} of the width, ${shareText(h.v)} of the height` }, guide(w, center.x + (Math.sign(local.x) * w.v * r.w) / 2), guide(h, center.y + (Math.sign(local.y) * h.v * r.h) / 2));
		};
	}
	const length = out.x * out.x + out.y * out.y;
	return (_from, to, free) => {
		const along = ((to.x - center.x) * out.x + (to.y - center.y) * out.y) / length;
		const s = snapFraction(clamp((c.radius * along) / r.h, 0.01, 1), free);
		const edge = (s.v * r.h) / c.radius;
		return withGuides({ ops: sizeOps(c, s), readout: `${shareText(s.v)} of the height${within(r)}` }, guide(s, center.x + out.x * edge), guide(s, center.y + out.y * edge));
	};
}

/** How deep a star's notches are when it has too few points to work that out. */
const autoInner = 0.45;

/** Whatever the handles of a symbol are. A grid spreads over its region, so it has none. */
function chargeHandles(c: ChargeView, nodes: readonly ONode[]): Handle[] {
	if (c.at === null) {
		return [];
	}
	const r = c.region;
	const center = { x: r.x + c.at.x, y: r.y + c.at.y };
	const name = c.shape === "disc" ? "circle" : c.shape === "lozenge" ? "diamond" : c.shape === "rect" ? "rectangle" : c.shape === "ellipse" ? "oval" : c.shape;
	const reach = chargeReach(c);
	const turn = boxTurns(c) ? c.rotate : 0;
	const span = { x: center.x - reach.left, y: center.y - reach.top, w: reach.left + reach.right, h: reach.top + reach.bottom };
	const out: Handle[] = [{ id: "move", label: `Move the ${name}. Arrow keys move it.`, look: "move", x: center.x, y: center.y, span, turn, cursor: "move", mover: moveCharge(c, nodes) }];
	if (c.form !== "one") {
		return out;
	}
	const corners: readonly [string, number, number, string][] = [["nw", -reach.left, -reach.top, "nwse-resize"], ["ne", reach.right, -reach.top, "nesw-resize"], ["sw", -reach.left, reach.bottom, "nesw-resize"], ["se", reach.right, reach.bottom, "nwse-resize"]];
	for (const [id, dx, dy, cursor] of corners) {
		const off = turned({ x: dx, y: dy }, turn);
		const corner = { x: center.x + off.x, y: center.y + off.y };
		out.push({ id, label: `Resize the ${name}`, look: "dot", x: corner.x, y: corner.y, cursor, mover: resizeCharge(c, corner) });
	}
	return out;
}

/** The widths of stripes on the flag's grid, however they were written, as exact numbers. */
export function widthsOnGrid(b: BarsView, axis: string): Fraction[] {
	const exact = b.widths.map(exactOf);
	const total = exact.reduce(plus);
	const whole = exactOf(axis);
	return exact.map((w) => times(w, fraction(whole.n * total.d, whole.d * total.n)));
}

/** Moves one line between stripes, with the two beside it sharing what they had. Nothing else changes size. */
export function ratioWith(widths: readonly Fraction[], line: number, at: Fraction): string[] {
	let before: Fraction = { n: 0n, d: 1n };
	for (const w of widths.slice(0, line)) {
		before = plus(before, w);
	}
	const pair = plus(widths[line]!, widths[line + 1]!);
	const first = minus(at, before);
	return widths.map((w, i) => write(i === line ? first : i === line + 1 ? minus(pair, first) : w).text);
}

function barHandles(n: ONode, r: Region, nodes: readonly ONode[]): Handle[] {
	const b = readBars(n);
	if (!barsAreStraight(b)) {
		return [];
	}
	const down = b.along === "fly";
	const lines = barLines(b);
	const axis = down ? r.hText : r.wText;
	const edges = edgesOf(nodes, n.path ?? null);
	const others = down ? edgesWithin(edges.down, r.y, r.h) : edgesWithin(edges.across, r.x, r.w);
	const widths = widthsOnGrid(b, axis);
	const start = down ? r.y : r.x;
	const size = down ? r.h : r.w;
	return lines.map((at, i) => {
		const lo = i === 0 ? 0 : lines[i - 1]!;
		const hi = lines[i + 1] ?? 1;
		const margin = (hi - lo) * 0.02;
		const mover: Mover = (_from, to, free) => {
			const raw = ((down ? to.y : to.x) - start) / size;
			const wanted = snap(clamp(raw, lo + margin, hi - margin), others, free);
			const s: Snapped = wanted.v > lo + margin / 2 && wanted.v < hi - margin / 2 ? wanted : { v: clamp(raw, lo + margin, hi - margin), kind: "free" };
			const ops: Op[] = [{ op: "child", at: n.at, name: "ratio", args: ratioWith(widths, i, exactOf(onGrid(s, axis))).map(vNum) }];
			const line = start + s.v * size;
			return withGuides({ ops, readout: `${shareText(s.v)} of the way ${down ? "down" : "across"}${within(r)}` }, down ? undefined : guide(s, line), down ? guide(s, line) : undefined);
		};
		return { id: `line-${i}`, label: "Move the line between stripes", look: down ? "across" : "down", x: down ? r.x : start + at * size, y: down ? start + at * size : r.y, span: { x: r.x, y: r.y, w: r.w, h: r.h }, cursor: down ? "row-resize" : "col-resize", mover } satisfies Handle;
	});
}

function cornerHandle(n: ONode, parent: Region, own: Region, nodes: readonly ONode[]): Handle {
	const place = String(kid(n, "corner")?.args[0]?.v ?? "upper-hoist");
	const onRight = place.endsWith("fly");
	const onLower = place.startsWith("lower");
	const edges = edgesOf(nodes, n.path ?? null);
	const across = edgesWithin(edges.across, parent.x, parent.w);
	const down = edgesWithin(edges.down, parent.y, parent.h);
	const name = n.name === "canton" ? "corner block" : "edge block";
	const mover: Mover = (_from, to, free) => {
		const x = snap(clamp((to.x - parent.x) / parent.w, onRight ? 0 : 0.05, onRight ? 0.95 : 1), across, free);
		const y = snap(clamp((to.y - parent.y) / parent.h, onLower ? 0 : 0.05, onLower ? 0.95 : 1), down, free);
		const w = onRight ? complement(x) : x;
		const h = onLower ? complement(y) : y;
		const ops = [setChild(n, "fly", onGrid(w, parent.wText)), setChild(n, "hoist", onGrid(h, parent.hText))];
		return withGuides({ ops, readout: `${shareText(w.v)} of the width, ${shareText(h.v)} of the height` }, guide(x, parent.x + x.v * parent.w), guide(y, parent.y + y.v * parent.h));
	};
	return { id: "corner", label: `Resize the ${name}`, look: "dot", x: onRight ? own.x : own.x + own.w, y: onLower ? own.y : own.y + own.h, cursor: onRight === onLower ? "nwse-resize" : "nesw-resize", mover };
}

function sideHandle(n: ONode, side: string, parent: Region, own: Region, nodes: readonly ONode[]): Handle {
	const upright = side === "hoist" || side === "fly";
	const far = side === "fly" || side === "bottom";
	const edges = edgesOf(nodes, n.path ?? null);
	const others = upright ? edgesWithin(edges.across, parent.x, parent.w) : edgesWithin(edges.down, parent.y, parent.h);
	const mover: Mover = (_from, to, free) => {
		const raw = upright ? (to.x - parent.x) / parent.w : (to.y - parent.y) / parent.h;
		const s = snap(clamp(raw, far ? 0.05 : 0.02, far ? 0.98 : 0.95), others, free);
		const width = far ? complement(s) : s;
		const line = upright ? parent.x + s.v * parent.w : parent.y + s.v * parent.h;
		return withGuides({ ops: [setChild(n, "width", onGrid(width, upright ? parent.wText : parent.hText))], readout: `${shareText(width.v)} of the ${upright ? "width" : "height"}` }, upright ? guide(s, line) : undefined, upright ? undefined : guide(s, line));
	};
	return { id: "side", label: "Resize the edge block", look: upright ? "down" : "across", x: upright ? (far ? own.x : own.x + own.w) : parent.x, y: upright ? parent.y : (far ? own.y : own.y + own.h), span: parent, cursor: upright ? "col-resize" : "row-resize", mover };
}

function bandHandles(n: ONode, r: Region, nodes: readonly ONode[]): Handle[] {
	const along = String(kid(n, "along")?.args[0]?.v ?? "fly");
	if ((along !== "fly" && along !== "hoist") || kid(n, "rotate") !== undefined) {
		return [];
	}
	const lies = along === "fly";
	const size = lies ? r.h : r.w;
	const start = lies ? r.y : r.x;
	const axis = lies ? r.hText : r.wText;
	const center = start + size / 2 + numOf(kid(n, "offset")?.args[0]);
	const half = numOf(kid(n, "width")?.args[0]) / 2;
	const edges = edgesOf(nodes, n.path ?? null);
	const others = lies ? edgesWithin(edges.down, r.y, r.h) : edgesWithin(edges.across, r.x, r.w);
	const move: Mover = (from, to, free) => {
		const moved = lies ? to.y - from.y : to.x - from.x;
		const s = snap(clamp((center + moved - start) / size, 0, 1), others, free);
		const at = start + s.v * size;
		const offset = exactOf(onGrid(s, axis));
		const ops: Op[] = s.kind === "middle" ? [{ op: "dropChild", at: n.at, name: "offset" }] : [setChild(n, "offset", write(minus(offset, times(exactOf(axis), fraction(1n, 2n)))).text)];
		return withGuides({ ops, readout: `${shareText(s.v)} of the way ${lies ? "down" : "across"}${within(r)}` }, lies ? undefined : guide(s, at), lies ? guide(s, at) : undefined);
	};
	const width: Mover = (_from, to, free) => {
		const s = snapFraction(clamp((2 * Math.abs((lies ? to.y : to.x) - center)) / size, 0.01, 1), free);
		const line = center + (s.v * size) / 2;
		return withGuides({ ops: [setChild(n, "width", onGrid(s, axis))], readout: `${shareText(s.v)} of the ${lies ? "height" : "width"}` }, lies ? undefined : guide(s, line), lies ? guide(s, line) : undefined);
	};
	return [
		{ id: "band", label: "Move the single stripe", look: lies ? "across" : "down", x: lies ? r.x : center, y: lies ? center : r.y, span: r, cursor: lies ? "row-resize" : "col-resize", mover: move },
		{ id: "band-width", label: "Change how thick the single stripe is", look: "dot", x: lies ? r.x + r.w * 0.75 : center + half, y: lies ? center + half : r.y + r.h * 0.75, cursor: lies ? "ns-resize" : "ew-resize", mover: width },
	];
}

function arm(n: ONode, name: "fly" | "hoist", axis: string): { before: Fraction; width: Fraction; whole: Fraction } | null {
	const parts = kid(n, name)?.args.map((o) => exactOf(o.raw ?? String(o.v))) ?? [];
	if (parts.length !== 3) {
		return null;
	}
	const total = parts.reduce(plus);
	const whole = exactOf(axis);
	const k = fraction(whole.n * total.d, whole.d * total.n);
	return { before: times(parts[0]!, k), width: times(parts[1]!, k), whole };
}

function armOps(n: ONode, name: "fly" | "hoist", a: NonNullable<ReturnType<typeof arm>>, before: Fraction, width: Fraction): Op {
	const room = minus(a.whole, width);
	const first = before.n < 0n ? fraction(0n, 1n) : toNumber(minus(room, before)) < 0 ? room : before;
	return { op: "child", at: n.at, name, args: [first, width, minus(room, first)].map((f) => vNum(write(f).text)) };
}

function crossHandles(n: ONode, r: Region, nodes: readonly ONode[]): Handle[] {
	const across = arm(n, "fly", r.wText);
	const down = arm(n, "hoist", r.hText);
	if (across === null || down === null) {
		return [];
	}
	const half = fraction(1n, 2n);
	const centerOf = (a: NonNullable<typeof across>): Fraction => plus(a.before, times(a.width, half));
	const [cx, cy] = [toNumber(centerOf(across)), toNumber(centerOf(down))];
	const edges = edgesOf(nodes, n.path ?? null);
	const edgeX = edgesWithin(edges.across, r.x, r.w);
	const edgeY = edgesWithin(edges.down, r.y, r.h);
	const move: Mover = (from, to, free) => {
		const x = snap(clamp((cx + to.x - from.x) / r.w, 0, 1), edgeX, free);
		const y = snap(clamp((cy + to.y - from.y) / r.h, 0, 1), edgeY, free);
		const place = (a: NonNullable<typeof across>, s: Snapped, axis: string): Fraction => minus(exactOf(onGrid(s, axis)), times(a.width, half));
		const ops = [armOps(n, "fly", across, place(across, x, r.wText), across.width), armOps(n, "hoist", down, place(down, y, r.hText), down.width)];
		return withGuides({ ops, readout: whereText(r, x.v, y.v) }, guide(x, r.x + x.v * r.w), guide(y, r.y + y.v * r.h));
	};
	const thick: Mover = (_from, to, free) => {
		const far = Math.max(Math.abs(to.x - r.x - cx), 0);
		const s = snapFraction(clamp((2 * far) / r.h, 0.01, 0.9), free);
		const width = exactOf(onGrid(s, r.hText));
		const ops = [armOps(n, "fly", across, minus(centerOf(across), times(width, half)), width), armOps(n, "hoist", down, minus(centerOf(down), times(width, half)), width)];
		return withGuides({ ops, readout: `${shareText(s.v)} of the height${within(r)}` }, guide(s, r.x + cx + (s.v * r.h) / 2), undefined);
	};
	return [
		{ id: "cross", label: "Move the cross", look: "dot", x: r.x + cx, y: r.y + cy, cursor: "move", mover: move },
		{ id: "cross-width", label: "Change how thick the cross is", look: "dot", x: r.x + cx + toNumber(across.width) / 2, y: r.y + r.h * 0.12, cursor: "ew-resize", mover: thick },
	];
}

function saltireHandle(n: ONode, r: Region): Handle {
	const length = Math.hypot(r.w, r.h);
	const dir = { x: r.w / length, y: r.h / length };
	const normal = { x: r.h / length, y: -r.w / length };
	const center = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
	const half = numOf(kid(n, "width")?.args[0]) / 2;
	const mover: Mover = (_from, to, free) => {
		const away = Math.abs((to.x - center.x) * normal.x + (to.y - center.y) * normal.y);
		const s = snapFraction(clamp((2 * away) / r.h, 0.01, 0.6), free);
		return { ops: [setChild(n, "width", onGrid(s, r.hText))], readout: `${shareText(s.v)} of the height${within(r)}` };
	};
	return { id: "saltire", label: "Change how thick the diagonal cross is", look: "dot", x: center.x - (dir.x * length) / 4 + normal.x * half, y: center.y - (dir.y * length) / 4 + normal.y * half, cursor: "nesw-resize", mover };
}

function quartersHandle(n: ONode, r: Region, nodes: readonly ONode[]): Handle[] {
	if (kid(n, "diagonal") !== undefined) {
		return [];
	}
	const split = kid(n, "split");
	const [x0, y0] = [numOf(prop(split, "fly"), r.w / 2), numOf(prop(split, "hoist"), r.h / 2)];
	const edges = edgesOf(nodes, n.path ?? null);
	const edgeX = edgesWithin(edges.across, r.x, r.w);
	const edgeY = edgesWithin(edges.down, r.y, r.h);
	const mover: Mover = (from, to, free) => {
		const x = snap(clamp((x0 + to.x - from.x) / r.w, 0.02, 0.98), edgeX, free);
		const y = snap(clamp((y0 + to.y - from.y) / r.h, 0.02, 0.98), edgeY, free);
		const ops: Op[] = x.kind === "middle" && y.kind === "middle" ? [{ op: "dropChild", at: n.at, name: "split" }] : [{ op: "child", at: n.at, name: "split", args: [], props: [["fly", vNum(onGrid(x, r.wText))], ["hoist", vNum(onGrid(y, r.hText))]] }];
		return withGuides({ ops, readout: whereText(r, x.v, y.v) }, guide(x, r.x + x.v * r.w), guide(y, r.y + y.v * r.h));
	};
	return [{ id: "quarters", label: "Move where the quarters meet", look: "dot", x: r.x + x0, y: r.y + y0, cursor: "move", mover }];
}

/** The handles a thing on the flag has while it's selected. A term that isn't here only has panel controls. */
export function handlesOf(path: string, nodes: readonly ONode[]): Handle[] {
	const n = findLayer(nodes, path);
	const r = n === null ? null : regionOf(n, nodes);
	if (n === null || r === null) {
		return [];
	}
	switch (n.name) {
		case "charge": {
			const c = readCharge(n, nodes);
			return c === null ? [] : chargeHandles(c, nodes);
		}
		case "bars":
			return barHandles(n, r, nodes);
		case "band":
			return bandHandles(n, r, nodes);
		case "cross":
			return crossHandles(n, r, nodes);
		case "saltire":
			return [saltireHandle(n, r)];
		case "quarters":
			return quartersHandle(n, r, nodes);
		case "canton": case "panel": {
			const place = blockRegion(n, nodes);
			if (place === null) {
				return [];
			}
			const side = kid(n, "side")?.args[0]?.v;
			if (typeof side === "string") {
				return [sideHandle(n, side, place.parent, place.own, nodes)];
			}
			return n.name === "canton" || kid(n, "corner") !== undefined ? [cornerHandle(n, place.parent, place.own, nodes)] : [];
		}
		default:
			return [];
	}
}

/** Every symbol that can be picked up and moved, and how far it reaches, for grabbing it wherever it is. */
export function movableCharges(nodes: readonly ONode[]): { path: string; x: number; y: number; reach: number }[] {
	const out: { path: string; x: number; y: number; reach: number }[] = [];
	const visit = (list: readonly ONode[]): void => {
		for (const n of list) {
			if (n.name === "canton" || n.name === "panel") {
				visit(n.kids);
			} else if (n.name === "charge" && n.path !== undefined) {
				const c = readCharge(n, nodes);
				if (c !== null && c.at !== null) {
					const e = chargeReach(c);
					// A line's copies can go anywhere, so it can be grabbed anywhere. What's under the pointer still decides.
					const spread = c.form === "line" ? Math.max(c.region.w, c.region.h) : c.form === "one" ? 0 : c.ringRadius;
					const far = Math.max(e.left, e.top, e.right, e.bottom) * (c.rotate !== 0 ? Math.SQRT2 : 1) + spread;
					out.push({ path: n.path, x: c.region.x + c.at.x, y: c.region.y + c.at.y, reach: far });
				}
			}
		}
	};
	visit(nodes);
	return out;
}

/** The mover for picking up a symbol, which starts from where it is. */
export function chargeMover(path: string, nodes: readonly ONode[]): Mover | null {
	const n = findLayer(nodes, path);
	const c = n === null ? null : readCharge(n, nodes);
	return c === null || c.at === null ? null : moveCharge(c, nodes);
}

/** Changes the color at an argument. */
export function colorOp(node: ONode, i: number, color: string): Op {
	const args = [...node.args];
	args[i] = vStr(color);
	return { op: "entries", at: node.at, args };
}

/** Gives a block its color, which is its first field. */
export function blockColorOp(block: ONode, color: string): Op {
	const own = ownField(block);
	if (own !== undefined) {
		return colorOp(own, 0, color);
	}
	const first = block.kids.find((k) => k.path !== undefined);
	return { op: "add", at: block.at, text: `field ${kdlName(color)}`, index: first?.at.at(-1) ?? block.kids.length };
}

/** Makes a new color, under a name of its own. */
export function newColorOp(hex: string, nodes: readonly ONode[]): { name: string; op: Op } | null {
	const palette = nodes.find((n) => n.name === "palette");
	if (palette === undefined) {
		return null;
	}
	const name = colorName(hex, palette.kids.map((k) => k.name));
	return { name, op: { op: "add", at: palette.at, text: `${name} "${hex}"` } };
}

/** Changes a list of stripes, writing out any colors that were cycled by a count. */
export function stripesOps(b: BarsView, colors: readonly OVal[], ratio: readonly string[] | null): Op[] {
	const ops: Op[] = [{ op: "entries", at: b.node.at, args: [...colors] }];
	if (b.counted) {
		ops.push({ op: "dropChild", at: b.node.at, name: "count" });
	}
	if (ratio !== null) {
		ops.push(ratio.length > 0 ? { op: "child", at: b.node.at, name: "ratio", args: ratio.map(vNum) } : { op: "dropChild", at: b.node.at, name: "ratio" });
	}
	return ops;
}

/** Sets a star's points. Under five it has to say how deep its notches are, and turning goes back to upright. */
export function pointsOps(c: ChargeView, points: number): Op[] {
	const ops: Op[] = [points === 5 ? { op: "dropChild", at: c.node.at, name: "points" } : setChild(c.node, "points", String(points)), { op: "dropChild", at: c.node.at, name: "rotate" }];
	const inner = kid(c.node, "inner");
	if (points < 5 && inner === undefined) {
		ops.push(setChild(c.node, "inner", gridText(c.radius * autoInner)));
	} else if (points >= 5 && inner !== undefined && Math.abs(numOf(inner.args[0]) / c.radius - autoInner) < 0.001) {
		ops.push({ op: "dropChild", at: c.node.at, name: "inner" });
	}
	return ops;
}

/** Turns a symbol. Upright is written by not writing anything. */
export function turnOps(c: ChargeView, deg: number): Op[] {
	return [Math.abs(deg) < 1e-9 ? { op: "dropChild", at: c.node.at, name: "rotate" } : setChild(c.node, "rotate", gridText(deg))];
}

/** Sets how many of a symbol there are. A grid spreads itself over its region, so it can't have a position. */
export function repeatOps(c: ChargeView, form: "one" | "grid" | "ring"): Op[] {
	const at = c.node.at;
	if (form === "one") {
		return [{ op: "dropChild", at, name: "repeat" }];
	}
	const old = kid(c.node, "repeat")?.props.map(([k]) => [k, null] as [string, null]) ?? [];
	if (form === "grid") {
		const positions = c.node.kids.filter((k) => k.name === "at").map(() => ({ op: "dropChild", at, name: "at" }) as Op);
		return [...positions, { op: "child", at, name: "repeat", args: [vStr("grid")], props: [...old, ["rows", vNum("3")], ["columns", vNum("3")]] }];
	}
	return [{ op: "child", at, name: "repeat", args: [vStr("ring")], props: [...old, ["count", vNum("6")], ["radius", vNum(onGrid(exactly(3, 10), c.region.hText))]] }];
}

/** Where a new layer goes, so that what's added doesn't paint over what's on top of it. */
function layerIndex(key: string, nodes: readonly ONode[]): number {
	const tail = new Set(["reverse", "adapt", "variant", "fold"]);
	const end = nodes.reduce((last, n, i) => (tail.has(n.name) ? last : i + 1), 0);
	if (key.startsWith("charge:")) {
		return end;
	}
	const above = key === "canton" || key === "panel" ? ["charge", "emblem"] : ["charge", "emblem", "canton", "panel"];
	const first = nodes.findIndex((n) => above.includes(n.name));
	return first < 0 ? end : first;
}

/** What adding something from the menu does, and where it'll be, once it's there. */
export function addOps(key: string, nodes: readonly ONode[], selected: ONode | null): { ops: Op[]; at: number[] } | null {
	const colors = colorsOf(nodes);
	const block = key.startsWith("charge:") && selected !== null && (selected.name === "canton" || selected.name === "panel") ? selected : null;
	const region = block !== null ? blockRegion(block, nodes)?.own ?? null : flagRegion(nodes);
	if (region === null) {
		return null;
	}
	const under = block !== null ? ownField(block) : nodes.find((n) => n.name === "field" || n.name === "bars");
	const [a, b] = contrasting(colors, colors.get(String(under?.args[0]?.v)));
	const text = addedText(key, { fly: region.wText, hoist: region.hText }, a, b);
	if (block !== null) {
		return { ops: [{ op: "add", at: block.at, text }], at: [...block.at, block.kids.length] };
	}
	const index = layerIndex(key, nodes);
	return { ops: [{ op: "add", at: null, text, index }], at: [index] };
}
