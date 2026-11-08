// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { num } from "./text.js";
import { RenderError } from "./types.js";
import type { Anchor, Effects, Flag, Layer, Options, PanelLayer, Point, Shape, Turn, Variant } from "./types.js";

type AxisName = "fly" | "hoist";

/**
 * The flag at another proportion, as fly divided by hoist, following its adapt rules. Its layers
 * can be a reverse's own, seen from behind.
 */
export function withRatio(f: Flag, ratio: number, fromBehind = false): Flag {
	const current = f.fly / f.hoist;
	if (Math.abs(ratio - current) < 1e-9 * current) {
		return f;
	}
	if (f.adapt === undefined) {
		throw new RenderError(`${f.meta.name} doesn't say how it adapts to other proportions`);
	}
	const range = f.adapt.range;
	if (range !== undefined && (ratio < range[0] || ratio > range[1])) {
		throw new RenderError(`${f.meta.name} only adapts between ratios of ${range[0]} and ${range[1]}`);
	}
	const mode = ratio > current ? f.adapt.wider : f.adapt.narrower;
	if (mode === undefined) {
		throw new RenderError(`${f.meta.name} has no rule for this direction of change`);
	}
	const out: Flag = { ...f };
	const onHoist = mode.startsWith("hoist-");
	const base = onHoist ? mode.slice("hoist-".length) : mode;
	const anchor: Anchor = base === "extend" ? "start" : base === "center" ? "center" : "scale";
	const a = new Adapter(onHoist ? "hoist" : "fly", anchor, onHoist ? f.fly : f.hoist, fromBehind);
	if (onHoist) {
		out.hoist = f.fly / ratio;
		out.layers = a.layers(f.layers, f.hoist, out.hoist);
	} else {
		out.fly = f.hoist * ratio;
		out.layers = a.layers(f.layers, f.fly, out.fly);
	}
	if (f.outline?.kind === "polygon") {
		// A silhouette has no sensible anchor, so a drawn one stretches with the flag.
		out.outline = {
			kind: "polygon",
			vertices: f.outline.vertices.map((p) => ({ fly: (p.fly * out.fly) / f.fly, hoist: (p.hoist * out.hoist) / f.hoist })),
		};
	}
	if (a.error !== undefined) {
		throw new RenderError(a.error);
	}
	return out;
}

/** Maps a position along the axis, by a layer's anchor. */
function move(x: number, old: number, next: number, anchor: Anchor): number {
	switch (anchor) {
		case "center":
			return x + (next - old) / 2;
		case "end":
			return x + next - old;
		case "scale":
			return (x * next) / old;
		default:
			return x;
	}
}

/** Moves layers along one axis as their region changes size. */
class Adapter {
	error: string | undefined;
	private readonly axis: AxisName;
	private readonly anchor: Anchor;
	/** An anchor that a container passed on to its layers, if one did. */
	private passed: Anchor | undefined;
	/** Says that the layers are a reverse's own, with the hoist on the right. */
	private readonly fromBehind: boolean;
	/** The region's size across the axis, which stays the same. */
	private other: number;

	constructor(axis: AxisName, anchor: Anchor, other: number, fromBehind: boolean) {
		this.axis = axis;
		this.anchor = anchor;
		this.other = other;
		this.fromBehind = fromBehind;
	}

	/**
	 * A layer's anchor: its own, or one passed on to it, or the rule's. It says whether the layer
	 * was given one, by itself or a container.
	 */
	private anchorOf(e: Effects): { anchor: Anchor; given: boolean } {
		let anchor = e.anchor ?? this.passed;
		const given = anchor !== undefined;
		anchor ??= this.anchor;
		if (this.fromBehind && this.axis === "fly") {
			// Seen from behind, the hoist is on the right, and start is still the hoist.
			if (anchor === "start") {
				anchor = "end";
			} else if (anchor === "end") {
				anchor = "start";
			}
		}
		return { anchor, given };
	}

	/** Adapts a container's layers with its anchor, if it gives one. */
	private passOn<T>(e: Effects, adapt: () => T): T {
		const passed = this.passed;
		if (e.anchor !== undefined) {
			this.passed = e.anchor;
		}
		try {
			return adapt();
		} finally {
			this.passed = passed;
		}
	}

	/** The region's center, for pinning what's there to an anchor. */
	private center(old: number): Point {
		return this.axis === "hoist" ? { fly: this.other / 2, hoist: old / 2 } : { fly: old / 2, hoist: this.other / 2 };
	}

	private fail(message: string): void {
		this.error ??= message;
	}

	layers(layers: Layer[], old: number, next: number): Layer[] {
		return layers.map((l) => this.layer(l, old, next));
	}

	private point(p: Point, old: number, next: number, anchor: Anchor): Point {
		return this.axis === "fly"
			? { fly: move(p.fly, old, next, anchor), hoist: p.hoist }
			: { fly: p.fly, hoist: move(p.hoist, old, next, anchor) };
	}

	private optionalPoint(p: Point | undefined, old: number, next: number, anchor: Anchor): Point | undefined {
		return p === undefined ? undefined : this.point(p, old, next, anchor);
	}

	/**
	 * Moves a shape, which keeps its own form unless it's drawn from points. The center stays the
	 * center, so a charge there follows it unless anchored otherwise.
	 */
	private shape(input: Shape, old: number, next: number, anchor: Anchor, explicit: boolean): Shape {
		const k = next / old;
		const s = { ...input } as Shape;
		if (s.at === undefined && explicit && anchor !== "scale" && s.kind !== "polygon") {
			s.at = this.center(old);
		}
		if (s.at !== undefined) {
			s.at = this.point(s.at, old, next, anchor);
		}
		if (s.ats !== undefined) {
			s.ats = s.ats.map((p) => (p === null ? null : this.point(p, old, next, anchor)));
		}
		if (s.kind === "polygon") {
			s.vertices = s.vertices.map((p) => this.point(p, old, next, anchor));
		}
		if (anchor === "scale" && (s.kind === "rect" || s.kind === "lozenge" || s.kind === "ellipse")) {
			if (this.axis === "fly") {
				s.fly = (s.fly ?? 0) * k;
			} else {
				s.hoist = (s.hoist ?? 0) * k;
			}
		}
		// Piles and palls are set from their edge, so depths only change when scaling, and
		// positions along the edge move like any other.
		if (s.kind === "pile" || s.kind === "pall") {
			const runsAlongAxis = (s.from === "hoist" || s.from === "fly") === (this.axis === "fly");
			if (s.kind === "pile") {
				if (runsAlongAxis) {
					if (anchor === "scale") {
						if (s.depth !== undefined) {
							s.depth *= k;
						}
						if (s.tip !== undefined) {
							s.tip = [s.tip[0], s.tip[1] * k];
						}
					}
				} else {
					if (s.base !== undefined) {
						s.base = [move(s.base[0], old, next, anchor), move(s.base[1], old, next, anchor)];
					}
					if (s.tip !== undefined) {
						s.tip = [move(s.tip[0], old, next, anchor), s.tip[1]];
					}
				}
			} else if (runsAlongAxis && anchor === "scale" && s.junction !== undefined) {
				s.junction *= k;
			}
		}
		return s;
	}

	private effects<T extends Effects>(input: T, old: number, next: number): { copy: T; anchor: Anchor } {
		const { anchor } = this.anchorOf(input);
		const copy = { ...input };
		if (input.clip !== undefined) {
			copy.clip = this.shape(input.clip, old, next, anchor, false);
		}
		copy.cuts = input.cuts.map((c) => this.shape(c, old, next, anchor, false));
		return { copy, anchor };
	}

	/** Shares a change in size across parts along the axis, by a layer's anchor. */
	private parts(what: string, parts: number[], old: number, next: number, anchor: Anchor): number[] {
		let total = 0;
		for (const p of parts) {
			total += p;
		}
		const out = parts.map((p) => (p * old) / total);
		const d = next - old;
		const last = out.length - 1;
		let changed = [last];
		switch (anchor) {
			case "start":
				out[last]! += d;
				break;
			case "end":
				out[0]! += d;
				changed = [0];
				break;
			case "center":
				out[0]! += d / 2;
				out[last]! += d / 2;
				changed = [0, last];
				break;
			default:
				return parts;
		}
		for (const i of changed) {
			this.keep(what, out[i]!, old);
		}
		return out;
	}

	/**
	 * Refuses a part that a change of size has brought to nothing, allowing for floating-point
	 * error in what should be exactly zero.
	 */
	private keep(what: string, part: number, old: number): void {
		if (part <= 1e-9 * old) {
			this.fail(`${what} can't be cut to this proportion`);
		}
	}

	private layer(l: Layer, old: number, next: number): Layer {
		const k = next / old;
		switch (l.layer) {
			case "field":
			case "saltire":
			case "checks":
				return this.effects(l, old, next).copy;
			case "bars": {
				const { copy, anchor } = this.effects(l, old, next);
				if ((this.axis === "fly") !== (l.along === "hoist") || l.along === "bend" || l.along === "bend-sinister") {
					return copy;
				}
				if (l.grow !== undefined) {
					let total = 0;
					let weights = 0;
					l.ratio.forEach((part, i) => {
						total += part;
						weights += l.grow![i]!;
					});
					if (weights > 0) {
						copy.ratio = l.ratio.map((part, i) => {
							const size = (part * old) / total + ((next - old) * l.grow![i]!) / weights;
							if (l.grow![i]! > 0) {
								this.keep("bars", size, old);
							}
							return size;
						});
						return copy;
					}
				}
				copy.ratio = this.parts("bars", l.ratio, old, next, anchor);
				return copy;
			}
			case "chevrons": {
				const { copy, anchor } = this.effects(l, old, next);
				const alongAxis = (l.from === "hoist" || l.from === "fly") === (this.axis === "fly");
				if (alongAxis && anchor === "scale") {
					copy.depth *= k;
				} else if (!alongAxis && l.apex !== undefined) {
					copy.apex = move(l.apex, old, next, anchor);
				}
				return copy;
			}
			case "band": {
				const { copy, anchor } = this.effects(l, old, next);
				const acrossAxis = (this.axis === "fly" && l.along === "hoist") || (this.axis === "hoist" && l.along === "fly");
				if (acrossAxis) {
					switch (anchor) {
						case "start":
							copy.offset -= (next - old) / 2;
							break;
						case "end":
							copy.offset += (next - old) / 2;
							break;
						case "scale":
							copy.offset *= k;
							copy.width *= k;
							break;
					}
				}
				return copy;
			}
			case "cross": {
				const { copy, anchor } = this.effects(l, old, next);
				const moved = this.parts("a cross", this.axis === "fly" ? l.fly : l.hoist, old, next, anchor) as [number, number, number];
				if (this.axis === "fly") {
					copy.fly = moved;
				} else {
					copy.hoist = moved;
				}
				return copy;
			}
			case "quarters": {
				const { copy, anchor } = this.effects(l, old, next);
				const split = this.optionalPoint(l.split, old, next, anchor);
				if (split !== undefined) {
					copy.split = split;
				}
				return copy;
			}
			case "rays": {
				const { copy, anchor } = this.effects(l, old, next);
				const at = this.optionalPoint(l.at, old, next, anchor);
				if (at !== undefined) {
					copy.at = at;
				}
				return copy;
			}
			case "emblem": {
				const { copy, anchor } = this.effects(l, old, next);
				let at = l.at;
				if (at === undefined && this.anchorOf(l).given && anchor !== "scale") {
					// One at the center that's given an anchor is pinned to it, as a charge is.
					at = this.center(old);
				}
				if (at !== undefined) {
					copy.at = this.point(at, old, next, anchor);
				}
				return copy;
			}
			case "charge": {
				const { copy, anchor } = this.effects(l, old, next);
				copy.shape = this.shape(l.shape, old, next, anchor, this.anchorOf(l).given);
				if (l.repeat?.kind === "line" && anchor === "scale") {
					copy.repeat = this.axis === "fly" ? { ...l.repeat, fly: l.repeat.fly * k } : { ...l.repeat, hoist: l.repeat.hoist * k };
				}
				return copy;
			}
			case "group": {
				const { copy } = this.effects(l, old, next);
				copy.layers = this.passOn(l, () => this.layers(l.layers, old, next));
				return copy;
			}
			case "panel":
				return this.panel(l, old, next);
			case "use": {
				const { copy } = this.effects(l, old, next);
				if (l.define.fly === undefined) {
					copy.define = { ...l.define, layers: this.passOn(l, () => this.layers(l.define.layers, old, next)) };
				}
				return copy;
			}
		}
	}

	/**
	 * Keeps a panel at its edge or corner. One running along the axis grows with its parent, and
	 * only scaling changes the size of any other.
	 */
	private panel(t: PanelLayer, old: number, next: number): Layer {
		const k = next / old;
		const { copy: c, anchor } = this.effects(t, old, next);
		let at = t.at;
		if (t.side === undefined && t.corner === undefined && at === undefined && this.anchorOf(t).given && anchor !== "scale") {
			// One at the center that's given an anchor is pinned to it, as a charge is.
			at = this.center(old);
		}
		if (at !== undefined) {
			c.at = this.point(at, old, next, anchor);
		}
		const runsAlong = (this.axis === "fly" && (t.side === "top" || t.side === "bottom")) || (this.axis === "hoist" && (t.side === "hoist" || t.side === "fly"));
		const outer = this.other;
		const passed = this.passed;
		if (t.anchor !== undefined) {
			this.passed = t.anchor;
		}
		try {
			if (runsAlong) {
				this.other = t.width ?? 0;
				c.layers = this.layers(t.layers, old, next);
				return c;
			}
			if (anchor !== "scale") {
				return c;
			}
			// Everything inside is measured against the panel's own size along the axis.
			let size = t.fly ?? 0;
			if (t.side) {
				size = t.width ?? 0;
				c.width = size * k;
				this.other = outer;
			} else if (this.axis === "fly") {
				this.other = t.hoist ?? 0;
				c.fly = size * k;
			} else {
				size = t.hoist ?? 0;
				this.other = t.fly ?? 0;
				c.hoist = size * k;
			}
			c.layers = this.layers(t.layers, size, size * k);
			return c;
		} finally {
			this.other = outer;
			this.passed = passed;
		}
	}
}

/** How a variant turns a flag, as a transform and what undoes it for charges. */
export function view(kind: Turn, x0: number, y0: number, width: number, tall: number): { transform: string; upright: string } {
	switch (kind) {
		case "transpose":
			return { transform: "matrix(0 1 1 0 0 0)", upright: "matrix(0 1 1 0 0 0)" };
		case "rotate":
			return { transform: `matrix(0 1 -1 0 ${num(2 * y0 + tall)} 0)`, upright: "matrix(0 -1 1 0 0 0)" };
		case "anti-transpose":
			return { transform: `matrix(0 -1 -1 0 ${num(2 * y0 + tall)} ${num(2 * x0 + width)})`, upright: "matrix(0 -1 -1 0 0 0)" };
		case "counter-rotate":
			return { transform: `matrix(0 -1 1 0 0 ${num(2 * x0 + width)})`, upright: "matrix(0 1 -1 0 0 0)" };
		case "mirror":
			return { transform: `matrix(-1 0 0 1 ${num(2 * x0 + width)} 0)`, upright: "matrix(-1 0 0 1 0 0)" };
		case "half-turn":
			return { transform: `matrix(-1 0 0 -1 ${num(2 * x0 + width)} ${num(2 * y0 + tall)})`, upright: "matrix(-1 0 0 -1 0 0)" };
		case "invert":
			return { transform: `matrix(1 0 0 -1 0 ${num(2 * y0 + tall)})`, upright: "matrix(1 0 0 -1 0 0)" };
		default:
			return { transform: "", upright: "" };
	}
}

export interface Resolved {
	flag: Flag;
	turn: Turn;
	upright: boolean;
	mirror: boolean;
	/** The proportion to pad the result to, if any. */
	canvas: number;
}

/** Applies a side, a variant and a proportion to the flag. */
export function resolve(f: Flag, opts: Options): Resolved {
	const out: Flag = { ...f };
	let ratio = opts.ratio ?? 0;
	let turn: Turn = "none";
	let upright = false;
	let mirror = false;
	// Says that the layers are the reverse's own, as seen from behind.
	let fromBehind = false;
	let variant: Variant | undefined;
	if (opts.variant !== undefined) {
		variant = f.variants[opts.variant];
		if (variant === undefined) {
			throw new RenderError(`${f.meta.name} has no variant "${opts.variant}"`);
		}
	}
	if (opts.fit !== undefined && opts.fit !== "error" && opts.fit !== "pad") {
		throw new RenderError(`unknown fit "${opts.fit as string}"`);
	}
	if (opts.align !== undefined && opts.align !== "start" && opts.align !== "center" && opts.align !== "end") {
		throw new RenderError(`unknown align "${opts.align as string}"`);
	}
	switch (opts.side) {
		case undefined:
		case "obverse":
			break;
		case "reverse":
			if (f.reverse !== undefined) {
				out.layers = f.reverse.layers;
				fromBehind = true;
			} else {
				mirror = true;
			}
			break;
		default:
			throw new RenderError(`unknown side "${opts.side as string}"`);
	}
	if (variant !== undefined) {
		turn = variant.from;
		upright = variant.upright;
		// The flag's outline and border were drawn for its own shape.
		if (variant.fly !== undefined && variant.fly > 0) {
			out.fly = variant.fly;
			out.hoist = variant.hoist ?? 0;
			delete out.outline;
			delete out.border;
		}
		if (variant.layers.length > 0) {
			// Its own design has nothing to do with the flag's reverse, so it's mirrored.
			out.layers = variant.layers;
			delete out.reverse;
			fromBehind = false;
			mirror = opts.side === "reverse";
		}
		if (variant.outline !== undefined) {
			out.outline = variant.outline;
		}
		if (variant.border !== undefined) {
			out.border = variant.border;
		}
		if (ratio === 0) {
			ratio = variant.ratio ?? 0;
		}
	}
	if (ratio === 0) {
		return { flag: out, turn, upright, mirror, canvas: 0 };
	}
	if (opts.fit === "pad") {
		let adapted = out;
		try {
			adapted = withRatio(out, nearestRatio(out, ratio), fromBehind);
		} catch (e) {
			// The rules allow that proportion, but this design can't reach it.
			if (!(e instanceof RenderError)) {
				throw e;
			}
		}
		return { flag: adapted, turn, upright, mirror, canvas: ratio };
	}
	const adapted = withRatio(out, ratio, fromBehind);
	if (opts.fold !== undefined && out.reverse !== undefined) {
		// A fold shows the back as well, which adapts as it's seen from behind.
		const back = withRatio({ ...out, layers: out.reverse.layers }, ratio, true);
		return { flag: { ...adapted, reverse: { ...out.reverse, layers: back.layers } }, turn, upright, mirror, canvas: 0 };
	}
	return { flag: adapted, turn, upright, mirror, canvas: 0 };
}

/** The proportion closest to a target that the flag's rules allow. */
function nearestRatio(f: Flag, target: number): number {
	const current = f.fly / f.hoist;
	if (f.adapt === undefined) {
		return current;
	}
	if ((target > current && !f.adapt.wider) || (target < current && !f.adapt.narrower)) {
		return current;
	}
	let out = target;
	if (f.adapt.range !== undefined) {
		out = Math.min(Math.max(out, f.adapt.range[0]), f.adapt.range[1]);
	}
	return out;
}
