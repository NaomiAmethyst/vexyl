// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// A flag at another proportion, worked out exactly, for a construction sheet. It follows the same
// rules as `withRatio` in adapt.ts, layer by layer, but with fractions, so that a sheet can say what
// an adapted flag's sizes are without rounding. Each number that adapting changes is an `Exact`,
// which acts as a number and which `exactOf` reads back exactly. Anything a sheet doesn't measure
// exactly anyway, a turned bars or band, is only marked as moved.

import { exactNumber, exactOf, half, minus, over, plus, times, zero, type Fraction } from "./exact.js";
import type { Anchor, Flag, Layer, PanelLayer, Point, Shape } from "./types.js";

type AxisName = "fly" | "hoist";

/** Moves a position along the axis, by an anchor, as `move` in adapt.ts does. */
function move(x: Fraction, old: Fraction, next: Fraction, anchor: Anchor): Fraction {
	switch (anchor) {
		case "center":
			return plus(x, half(minus(next, old)));
		case "end":
			return plus(x, minus(next, old));
		case "scale":
			return over(times(x, next), old);
		default:
			return x;
	}
}

const X = (v: number): Fraction => exactOf(v);
const N = exactNumber;

/**
 * The flag at a proportion, as fly divided by hoist, written as the file writes it. The rule is
 * the one `withRatio` would use, which has already checked that the flag can reach it.
 */
export function withRatioExactly(f: Flag, ratio: Fraction, fromBehind: boolean): Flag {
	const H = X(f.hoist);
	const F = X(f.fly);
	const current = over(F, H);
	const wider = ratio.n * current.d > current.n * ratio.d;
	if (ratio.n * current.d === current.n * ratio.d) {
		return f;
	}
	const mode = (wider ? f.adapt?.wider : f.adapt?.narrower) ?? "extend";
	const onHoist = mode.startsWith("hoist-");
	const base = onHoist ? mode.slice("hoist-".length) : mode;
	const anchor: Anchor = base === "extend" ? "start" : base === "center" ? "center" : "scale";
	const out: Flag = { ...f };
	const a = new ExactAdapter(onHoist ? "hoist" : "fly", anchor, onHoist ? F : H, fromBehind);
	if (onHoist) {
		const next = over(F, ratio);
		out.hoist = N(next);
		out.layers = a.layers(f.layers, H, next);
	} else {
		const next = times(H, ratio);
		out.fly = N(next);
		out.layers = a.layers(f.layers, F, next);
	}
	return out;
}

class ExactAdapter {
	private readonly axis: AxisName;
	private readonly anchor: Anchor;
	private passed: Anchor | undefined;
	private readonly fromBehind: boolean;
	private other: Fraction;

	constructor(axis: AxisName, anchor: Anchor, other: Fraction, fromBehind: boolean) {
		this.axis = axis;
		this.anchor = anchor;
		this.other = other;
		this.fromBehind = fromBehind;
	}

	private anchorOf(e: { anchor?: Anchor }): { anchor: Anchor; given: boolean } {
		let anchor = e.anchor ?? this.passed;
		const given = anchor !== undefined;
		anchor ??= this.anchor;
		if (this.fromBehind && this.axis === "fly") {
			anchor = anchor === "start" ? "end" : anchor === "end" ? "start" : anchor;
		}
		return { anchor, given };
	}

	private passOn<T>(e: { anchor?: Anchor }, adapt: () => T): T {
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

	private center(old: Fraction): Point {
		return this.axis === "hoist" ? { fly: N(half(this.other)), hoist: N(half(old)) } : { fly: N(half(old)), hoist: N(half(this.other)) };
	}

	layers(layers: Layer[], old: Fraction, next: Fraction): Layer[] {
		return layers.map((l) => this.layer(l, old, next));
	}

	private point(p: Point, old: Fraction, next: Fraction, anchor: Anchor): Point {
		return this.axis === "fly" ? { fly: N(move(X(p.fly), old, next, anchor)), hoist: p.hoist } : { fly: p.fly, hoist: N(move(X(p.hoist), old, next, anchor)) };
	}

	private shape(input: Shape, old: Fraction, next: Fraction, anchor: Anchor, explicit: boolean): Shape {
		const k = over(next, old);
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
				s.fly = N(times(X(s.fly ?? 0), k));
			} else {
				s.hoist = N(times(X(s.hoist ?? 0), k));
			}
		}
		if (s.kind === "pile" || s.kind === "pall") {
			const runsAlongAxis = (s.from === "hoist" || s.from === "fly") === (this.axis === "fly");
			if (s.kind === "pile") {
				if (runsAlongAxis) {
					if (anchor === "scale") {
						if (s.depth !== undefined) {
							s.depth = N(times(X(s.depth), k));
						}
						if (s.tip !== undefined) {
							s.tip = [s.tip[0], N(times(X(s.tip[1]), k))];
						}
					}
				} else {
					if (s.base !== undefined) {
						s.base = [N(move(X(s.base[0]), old, next, anchor)), N(move(X(s.base[1]), old, next, anchor))];
					}
					if (s.tip !== undefined) {
						s.tip = [N(move(X(s.tip[0]), old, next, anchor)), s.tip[1]];
					}
				}
			} else if (runsAlongAxis && anchor === "scale" && s.junction !== undefined) {
				s.junction = N(times(X(s.junction), k));
			}
		}
		return s;
	}

	private effects<T extends Layer>(input: T, old: Fraction, next: Fraction): { copy: T; anchor: Anchor } {
		const { anchor } = this.anchorOf(input);
		const copy = { ...input };
		if (input.clip !== undefined) {
			copy.clip = this.shape(input.clip, old, next, anchor, false);
		}
		copy.cuts = input.cuts.map((c) => this.shape(c, old, next, anchor, false));
		return { copy, anchor };
	}

	/** Shares a change in size across parts along the axis, as `parts` in adapt.ts does. */
	private parts(parts: readonly number[], old: Fraction, next: Fraction, anchor: Anchor): number[] {
		if (anchor === "scale") {
			return [...parts];
		}
		const exact = parts.map(X);
		const total = exact.reduce(plus, zero);
		const out = exact.map((p) => over(times(p, old), total));
		const d = minus(next, old);
		const last = out.length - 1;
		if (anchor === "start") {
			out[last] = plus(out[last]!, d);
		} else if (anchor === "end") {
			out[0] = plus(out[0]!, d);
		} else {
			out[0] = plus(out[0]!, half(d));
			out[last] = plus(out[last]!, half(d));
		}
		return out.map(N);
	}

	private layer(l: Layer, old: Fraction, next: Fraction): Layer {
		const k = over(next, old);
		switch (l.layer) {
			case "field":
			case "saltire":
			case "checks":
				return this.effects(l, old, next).copy;
			case "rays": {
				const { copy, anchor } = this.effects(l, old, next);
				if (l.at !== undefined) {
					copy.at = this.point(l.at, old, next, anchor);
				}
				return copy;
			}
			case "bars": {
				const { copy, anchor } = this.effects(l, old, next);
				if (l.rotate !== 0) {
					// Kept at its angle, which no fraction says, so a sheet doesn't measure it.
					copy.fixed = { center: { x: 0, y: 0 }, w: 0, h: 0 };
					return copy;
				}
				if ((this.axis === "fly") !== (l.along === "hoist") || l.along === "bend" || l.along === "bend-sinister") {
					return copy;
				}
				const weights = (l.grow ?? []).map(X).reduce(plus, zero);
				if (l.grow !== undefined && weights.n > 0n) {
					const parts = l.ratio.map(X);
					const total = parts.reduce(plus, zero);
					copy.ratio = parts.map((p, i) => N(plus(over(times(p, old), total), over(times(minus(next, old), X(l.grow![i]!)), weights))));
					return copy;
				}
				copy.ratio = this.parts(l.ratio, old, next, anchor);
				return copy;
			}
			case "chevrons": {
				const { copy, anchor } = this.effects(l, old, next);
				const alongAxis = (l.from === "hoist" || l.from === "fly") === (this.axis === "fly");
				if (alongAxis && anchor === "scale") {
					copy.depth = N(times(X(l.depth), k));
				} else if (!alongAxis && l.apex !== undefined) {
					copy.apex = N(move(X(l.apex), old, next, anchor));
				}
				return copy;
			}
			case "band": {
				const { copy, anchor } = this.effects(l, old, next);
				if (l.rotate !== 0) {
					copy.fixed = { center: { x: 0, y: 0 }, w: 0, h: 0 };
					return copy;
				}
				const acrossAxis = (this.axis === "fly" && l.along === "hoist") || (this.axis === "hoist" && l.along === "fly");
				if (acrossAxis) {
					const d = half(minus(next, old));
					if (anchor === "start") {
						copy.offset = N(minus(X(l.offset), d));
					} else if (anchor === "end") {
						copy.offset = N(plus(X(l.offset), d));
					} else if (anchor === "scale") {
						copy.offset = N(times(X(l.offset), k));
						copy.width = N(times(X(l.width), k));
					}
				}
				return copy;
			}
			case "cross": {
				const { copy, anchor } = this.effects(l, old, next);
				const moved = this.parts(this.axis === "fly" ? l.fly : l.hoist, old, next, anchor) as [number, number, number];
				if (this.axis === "fly") {
					copy.fly = moved;
				} else {
					copy.hoist = moved;
				}
				return copy;
			}
			case "quarters": {
				const { copy, anchor } = this.effects(l, old, next);
				if (l.split !== undefined) {
					copy.split = this.point(l.split, old, next, anchor);
				}
				return copy;
			}
			case "emblem": {
				const { copy, anchor } = this.effects(l, old, next);
				let at = l.at;
				if (at === undefined && this.anchorOf(l).given && anchor !== "scale") {
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
					copy.repeat = this.axis === "fly" ? { ...l.repeat, fly: N(times(X(l.repeat.fly), k)) } : { ...l.repeat, hoist: N(times(X(l.repeat.hoist), k)) };
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

	private panel(t: PanelLayer, old: Fraction, next: Fraction): Layer {
		const k = over(next, old);
		const { copy: c, anchor } = this.effects(t, old, next);
		let at = t.at;
		if (t.side === undefined && t.corner === undefined && at === undefined && this.anchorOf(t).given && anchor !== "scale") {
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
				this.other = X(t.width ?? 0);
				c.layers = this.layers(t.layers, old, next);
				return c;
			}
			if (anchor !== "scale") {
				return c;
			}
			let size = X(t.fly ?? 0);
			if (t.side) {
				size = X(t.width ?? 0);
				c.width = N(times(size, k));
				this.other = outer;
			} else if (this.axis === "fly") {
				this.other = X(t.hoist ?? 0);
				c.fly = N(times(size, k));
			} else {
				size = X(t.hoist ?? 0);
				this.other = X(t.fly ?? 0);
				c.hoist = N(times(size, k));
			}
			c.layers = this.layers(t.layers, size, times(size, k));
			return c;
		} finally {
			this.other = outer;
			this.passed = passed;
		}
	}
}
