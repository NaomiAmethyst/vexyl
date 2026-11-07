// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Compares two flags by what they mean, from their parsed models. Sizes are a share of the hoist,
// so that files on different grids compare, and what's the same is said to be the same.

type Plain = Record<string, unknown>;

export interface Side {
	text: string;
	color?: string;
}

export interface Change {
	term: string;
	name: string;
	a: Side;
	b: Side;
}

export interface Comparison {
	changes: Change[];
	unchanged: string[];
}

const isPlain = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);
const own = (o: Plain, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** Writes two numbers so that they read differently only if they differ. */
function pair(a: number, b: number): [string, string] {
	for (const digits of [3, 4, 5, 6]) {
		const x = a.toFixed(digits);
		const y = b.toFixed(digits);
		if (x !== y) {
			return [x, y];
		}
	}
	return [a.toFixed(3), b.toFixed(3)];
}

function close(a: number, b: number): boolean {
	return Math.abs(a - b) < 5e-5;
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A shape's sizes, with names that say what they are in that shape. */
const sizeNames: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	star: { radius: "Outer radius", inner: "Inner radius" },
	crescent: { radius: "Outer radius", inner: "Inner radius", offset: "Offset" },
	sun: { radius: "Outer radius", disc: "Disc radius", gap: "Gap" },
	ring: { radius: "Outer radius", inner: "Inner radius" },
};

const scaled = new Set(["radius", "inner", "offset", "width", "disc", "gap", "fly", "hoist", "depth", "flat", "junction", "spread", "tip", "apex", "taper", "tongue", "hollow", "lines"]);
const plainNumbers = new Set(["rotate", "opacity", "points", "angle", "rows", "columns", "count", "from", "to"]);

function layerTerm(l: Plain): string {
	const shape = own(l, "shape");
	const kind = typeof shape === "string" ? shape : String(own(l, "layer"));
	return capital(kind);
}

function describe(l: Plain): string {
	const term = layerTerm(l);
	const colors = own(l, "colors");
	if (own(l, "layer") === "bars" && Array.isArray(colors)) {
		const ratio = own(l, "ratio");
		const equal = Array.isArray(ratio) && ratio.every((r) => r === ratio[0]);
		const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
		return `${words[colors.length] ?? colors.length}${equal ? " equal" : ""} bars`;
	}
	if (own(l, "shape") === "star") {
		const points = num(own(l, "points")) ?? 5;
		const words: Record<number, string> = { 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten", 12: "twelve" };
		const count = words[points] ?? String(points);
		return `${/^[aeiou]/.test(count) ? "an" : "a"} ${count}-pointed star`;
	}
	return `${/^[aeiou]/i.test(term) ? "an" : "a"} ${term.toLowerCase()}`;
}

function compareLayer(term: string, a: Plain, b: Plain, ha: number, hb: number, out: Change[]): boolean {
	let changed = false;
	const add = (name: string, x: Side, y: Side): void => {
		out.push({ term, name, a: x, b: y });
		changed = true;
	};
	const names = sizeNames[String(own(a, "shape"))] ?? {};
	// Sizes first, then where it is, as a construction sheet goes.
	const rank = (k: string): number => (k === "radius" ? 0 : k === "inner" ? 1 : k === "at" ? 3 : 2);
	const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort((x, y) => rank(x) - rank(y));
	for (const k of keys) {
		if (k === "layer" || k === "shape" || k === "layers" || k === "markup") {
			continue;
		}
		const x = own(a, k);
		const y = own(b, k);
		if (scaled.has(k) && (typeof x === "number" || typeof y === "number")) {
			const nx = num(x);
			const ny = num(y);
			if (nx !== undefined && ny !== undefined) {
				if (!close(nx / ha, ny / hb)) {
					const [tx, ty] = pair(nx / ha, ny / hb);
					add(names[k] ?? capital(k), { text: tx }, { text: ty });
				}
			} else {
				add(names[k] ?? capital(k), { text: nx === undefined ? "None" : (nx / ha).toFixed(3) }, { text: ny === undefined ? "None" : (ny / hb).toFixed(3) });
			}
		} else if (plainNumbers.has(k) && (typeof x === "number" || typeof y === "number")) {
			if (x !== y) {
				add(capital(k), { text: x === undefined ? "None" : String(x) }, { text: y === undefined ? "None" : String(y) });
			}
		} else if (k === "at") {
			const pa = Array.isArray(x) ? x : [];
			const pb = Array.isArray(y) ? y : [];
			if (pa.length !== pb.length) {
				add("Positions", { text: String(pa.length) }, { text: String(pb.length) });
				continue;
			}
			pa.forEach((p, i) => {
				const q = pb[i];
				if (!isPlain(p) || !isPlain(q)) {
					if (JSON.stringify(p) !== JSON.stringify(q)) {
						add("Position", { text: String(JSON.stringify(p)) }, { text: String(JSON.stringify(q)) });
					}
					return;
				}
				for (const [axis, label] of [["fly", "Center along the fly"], ["hoist", "Center along the hoist"]] as const) {
					const u = num(own(p, axis));
					const v = num(own(q, axis));
					if (u !== undefined && v !== undefined && !close(u / ha, v / hb)) {
						const [tu, tv] = pair(u / ha, v / hb);
						add(pa.length > 1 ? `${label}, ${i + 1}` : label, { text: tu }, { text: tv });
					}
				}
			});
		} else if (k === "color" || k === "colors") {
			continue;
		} else if (JSON.stringify(x) !== JSON.stringify(y)) {
			add(capital(k), { text: brief(x) }, { text: brief(y) });
		}
	}
	return changed;
}

function brief(v: unknown): string {
	if (v === undefined) {
		return "None";
	}
	if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
		return String(v);
	}
	const text = JSON.stringify(v);
	return text.length > 48 ? text.slice(0, 45) + "…" : text;
}

/** Lines up two lists of layers by what they are, in order. */
function align(a: Plain[], b: Plain[]): [Plain | null, Plain | null][] {
	const kind = (l: Plain): string => `${String(own(l, "layer"))}:${String(own(l, "shape"))}`;
	const n = a.length;
	const m = b.length;
	const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			t[i]![j] = kind(a[i]!) === kind(b[j]!) ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
		}
	}
	const out: [Plain | null, Plain | null][] = [];
	let i = 0;
	let j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && kind(a[i]!) === kind(b[j]!)) {
			out.push([a[i]!, b[j]!]);
			i++;
			j++;
		} else if (j >= m || (i < n && t[i + 1]![j]! >= t[i]![j + 1]!)) {
			out.push([a[i]!, null]);
			i++;
		} else {
			out.push([null, b[j]!]);
			j++;
		}
	}
	return out;
}

const listOf = (m: Plain, k: string): Plain[] => {
	const v = own(m, k);
	return Array.isArray(v) ? v.filter(isPlain) : [];
};

function colorText(c: Plain): string {
	const hex = own(c, "color");
	const parts = [typeof hex === "string" ? hex.toLowerCase() : "gradient"];
	const pantone = own(c, "pantone");
	if (typeof pantone === "string") {
		parts.push(pantone);
	}
	return parts.join(", ");
}

const hexOf = (c: Plain): string | undefined => {
	const v = own(c, "color");
	return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined;
};

function side(text: string, color: string | undefined): Side {
	return color === undefined ? { text } : { text, color };
}

export function compareModels(a: Plain, b: Plain): Comparison {
	const changes: Change[] = [];
	const unchanged: string[] = [];
	const pa = own(a, "proportion") as Plain;
	const pb = own(b, "proportion") as Plain;
	const ha = num(own(pa, "hoist")) ?? 1;
	const hb = num(own(pb, "hoist")) ?? 1;
	const ra = (num(own(pa, "fly")) ?? 1) / ha;
	const rb = (num(own(pb, "fly")) ?? 1) / hb;
	const ratioText = (r: number): string => {
		for (const h of [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13]) {
			const f = r * h;
			if (Math.abs(f - Math.round(f)) < 1e-6) {
				return `${h}:${Math.round(f)}`;
			}
		}
		return `1:${r.toFixed(3)}`;
	};
	if (close(ra, rb)) {
		unchanged.push(`the ${ratioText(ra)} proportion`);
	} else {
		changes.push({ term: "Proportion", name: "Hoist to fly", a: { text: ratioText(ra) }, b: { text: ratioText(rb) } });
	}
	for (const [la, lb] of align(listOf(a, "layers"), listOf(b, "layers"))) {
		if (la !== null && lb !== null) {
			const before = changes.length;
			compareLayer(layerTerm(la), la, lb, ha, hb, changes);
			if (changes.length === before || (own(la, "shape") === "star" && own(la, "points") === own(lb, "points"))) {
				unchanged.push(describe(la));
			}
		} else if (la !== null) {
			changes.push({ term: layerTerm(la), name: "Only in A", a: { text: "Present" }, b: { text: "None" } });
		} else if (lb !== null) {
			changes.push({ term: layerTerm(lb), name: "Only in B", a: { text: "None" }, b: { text: "Present" } });
		}
	}
	// Colors go by the name each file gives them, as the table's most useful question is what the blue became.
	const ca = own(a, "palette");
	const cb = own(b, "palette");
	const namesA = isPlain(ca) ? Object.keys(ca) : [];
	const namesB = isPlain(cb) ? Object.keys(cb) : [];
	let sameColors = 0;
	for (const name of [...namesA, ...namesB.filter((n) => !namesA.includes(n))]) {
		const x = isPlain(ca) ? own(ca, name) : undefined;
		const y = isPlain(cb) ? own(cb, name) : undefined;
		const label = capital(name);
		if (isPlain(x) && isPlain(y)) {
			const tx = colorText(x);
			const ty = colorText(y);
			if (tx !== ty) {
				changes.push({ term: "Colors", name: label, a: side(tx, hexOf(x)), b: side(ty, hexOf(y)) });
			} else {
				sameColors++;
			}
		} else if (isPlain(x)) {
			changes.push({ term: "Colors", name: label, a: side(colorText(x), hexOf(x)), b: { text: "None" } });
		} else if (isPlain(y)) {
			changes.push({ term: "Colors", name: label, a: { text: "None" }, b: side(colorText(y), hexOf(y)) });
		}
	}
	if (sameColors > 1) {
		unchanged.push(`${sameColors} colors`);
	}
	return { changes, unchanged };
}

/** Says what's the same, as a sentence. */
export function unchangedSentence(list: readonly string[]): string {
	if (list.length === 0) {
		return "";
	}
	const items = list.length === 1 ? list[0]! : `${list.slice(0, -1).join(", ")}${list.length > 2 ? "," : ""} and ${list.at(-1)!}`;
	return `Unchanged: ${items}.`;
}
