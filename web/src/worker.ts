// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { model, RenderError, shareDecode, shareEncode, svg, svgTree, tagAttribute, validate, locate, parse, type Flag, type SvgElement } from "vexyl";
import { applyOps, outline } from "./document.js";
import { largestGrid, scaleFlag } from "./grid.js";
import type { Analysis, PickNode, Request, RenderResult } from "./protocol.js";

/** Each document being looked at, by slot, with its last valid flag. */
const flags = new Map<string, Flag>();
/** The same flags as the file has them, where the one for showing has had to be on a smaller grid. */
const exact = new Map<string, Flag>();
let renders = 0;

function analyze(slot: string, text: string): Analysis {
	const problems = validate(text);
	const source = text.replace(/\r\n?/g, "\n");
	const nodes = outline(source);
	const spans = nodes === null ? [] : locate(source);
	let m: Record<string, unknown> | null = null;
	if (problems.length === 0) {
		const flag = parse(text);
		const side = Math.max(flag.fly, flag.hoist);
		exact.set(slot, flag);
		flags.set(slot, side > largestGrid ? scaleFlag(flag, 1000 / side) : flag);
		m = model(flag) as Record<string, unknown>;
	}
	return { problems, valid: problems.length === 0, readable: nodes !== null, nodes: nodes ?? [], spans, model: m };
}

const drawn = new Set(["path", "polygon", "circle", "rect", "ellipse", "line", "polyline"]);
const kept = new Set(["viewBox", "points", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "transform", "fill-rule", "clip-rule", "id", "clip-path", "stroke-width", "stroke-linejoin", "stroke-miterlimit", tagAttribute]);

/**
 * What the page needs in order to know what's under a click: only geometry, with artwork as its
 * box, because it selects as a whole. It never holds anything from the file's artwork but numbers.
 */
function pickTree(e: SvgElement): PickNode | null {
	if (e.name === "title" || e.name === "desc" || e.name === "defs" || e.name === "mask" || e.name === "linearGradient" || e.name === "radialGradient" || e.name === "use") {
		return null;
	}
	const a: [string, string][] = [];
	const get = (name: string): string | undefined => e.attrs.find((x) => x.name === name)?.value;
	if (e.name === "svg" && get(tagAttribute) !== undefined) {
		for (const name of ["x", "y", "width", "height", tagAttribute]) {
			a.push([name, get(name) ?? "0"]);
		}
		return { n: "rect", a };
	}
	for (const { name, value } of e.attrs) {
		if (kept.has(name)) {
			a.push([name, value]);
		}
	}
	if (drawn.has(e.name)) {
		const fill = get("fill");
		a.push(["fill", fill === "none" ? "none" : "#000"]);
		const stroke = get("stroke");
		if (stroke !== undefined) {
			a.push(["stroke", "#000"]);
		}
	}
	const c: PickNode[] = [];
	for (const child of e.children) {
		const p = pickTree(child);
		if (p !== null) {
			c.push(p);
		}
	}
	return c.length > 0 ? { n: e.name, a, c } : { n: e.name, a };
}

function render(slot: string, options: Parameters<typeof svg>[1], pick: boolean | undefined, asFiled: boolean | undefined): RenderResult {
	const flag = (asFiled === true ? exact : flags).get(slot);
	if (flag === undefined) {
		return { refused: "There's nothing valid to draw yet." };
	}
	renders++;
	const opts = { ...options, idPrefix: `vx${renders}-` };
	try {
		const text = svg(flag, opts);
		const m = /viewBox="[^"]*" width="([0-9.e+-]+)" height="([0-9.e+-]+)"/.exec(text);
		const out: RenderResult = { svg: text, width: Number(m?.[1] ?? 0), height: Number(m?.[2] ?? 0) };
		if (pick === true) {
			const tree = pickTree(svgTree(flag, { ...opts, tags: true }));
			if (tree !== null) {
				out.pick = tree;
			}
		}
		return out;
	} catch (e) {
		if (e instanceof RenderError) {
			return { refused: e.message };
		}
		throw e;
	}
}

function handle(req: Request): unknown {
	switch (req.kind) {
		case "analyze":
			return analyze(req.slot, req.text);
		case "render":
			return render(req.slot, req.options, req.pick, req.exact);
		case "edit":
			return applyOps(req.text, req.ops);
		case "shareEncode":
			return { link: shareEncode(req.text) };
		case "shareDecode":
			return { text: shareDecode(req.link) };
	}
}

self.onmessage = (event: MessageEvent<{ id: number; req: Request }>): void => {
	const { id, req } = event.data;
	try {
		self.postMessage({ id, result: handle(req) });
	} catch (e) {
		self.postMessage({ id, result: { error: (e as Error).message, refused: (e as Error).message } });
	}
};
