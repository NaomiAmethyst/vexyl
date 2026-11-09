// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Numbers as a file writes them, worked with exactly, so that a construction sheet can say that a
// bar from `ratio 16 3 16 3 16` on a hoist of 54 is 16 and not 15.999999999999998.

/** A number as an exact fraction, in lowest terms, with a positive denominator. */
export interface Fraction {
	n: bigint;
	d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
	let [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
	while (y !== 0n) {
		[x, y] = [y, x % y];
	}
	return x;
}

export function fraction(n: bigint, d: bigint = 1n): Fraction {
	if (d === 0n) {
		throw new RangeError("a fraction can't have a denominator of 0");
	}
	if (d < 0n) {
		[n, d] = [-n, -d];
	}
	const g = gcd(n, d);
	return g === 0n ? { n: 0n, d: 1n } : { n: n / g, d: d / g };
}

export const zero: Fraction = { n: 0n, d: 1n };

/** Reads a number written in decimal, as KDL and a file's number lists write them, or null. */
export function readExact(text: string): Fraction | null {
	const m = /^([+-]?)(\d[\d_]*)?(?:\.(\d[\d_]*)?)?(?:[eE]([+-]?\d+))?$/.exec(text.trim());
	if (m === null || (m[2] === undefined && m[3] === undefined)) {
		return null;
	}
	const whole = (m[2] ?? "0").replaceAll("_", "");
	const part = (m[3] ?? "").replaceAll("_", "");
	const power = Number(m[4] ?? 0) - part.length;
	if (Math.abs(power) > 400) {
		return null;
	}
	const digits = BigInt(whole + part) * (m[1] === "-" ? -1n : 1n);
	return power >= 0 ? fraction(digits * 10n ** BigInt(power)) : fraction(digits, 10n ** BigInt(-power));
}

/**
 * The number a file wrote, from the parsed value. A parsed number is the double nearest what was
 * written, and its shortest decimal form is what was written, for anything of up to 15 significant
 * digits, so this recovers it exactly, without the double's own binary noise.
 */
export function exactOf(v: number): Fraction {
	if ((v as unknown) instanceof Exact) {
		return (v as unknown as Exact).exact;
	}
	if (!Number.isFinite(v)) {
		throw new RangeError(`${v} isn't a length`);
	}
	return readExact(String(v))!;
}

/**
 * A number that's been worked out, rather than written, such as a position after adapting to
 * another proportion, which carries the exact value it stands for. It acts as the nearest double
 * in arithmetic, and `exactOf` gives the exact value back.
 */
export class Exact extends Number {
	readonly exact: Fraction;

	constructor(exact: Fraction) {
		super(Number(exact.n) / Number(exact.d));
		this.exact = exact;
	}
}

/** An exact value where a number goes, for a flag whose numbers were worked out. */
export const exactNumber = (f: Fraction): number => new Exact(f) as unknown as number;

export const plus = (a: Fraction, b: Fraction): Fraction => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
export const minus = (a: Fraction, b: Fraction): Fraction => fraction(a.n * b.d - b.n * a.d, a.d * b.d);
export const times = (a: Fraction, b: Fraction): Fraction => fraction(a.n * b.n, a.d * b.d);
export const over = (a: Fraction, b: Fraction): Fraction => fraction(a.n * b.d, a.d * b.n);
export const half = (a: Fraction): Fraction => fraction(a.n, a.d * 2n);
export const negate = (a: Fraction): Fraction => ({ n: -a.n, d: a.d });

/** Less than 0, 0 or more than 0, as a is less than, equal to or more than b. */
export function compare(a: Fraction, b: Fraction): number {
	const x = a.n * b.d - b.n * a.d;
	return x < 0n ? -1 : x > 0n ? 1 : 0;
}

export const same = (a: Fraction, b: Fraction): boolean => a.n === b.n && a.d === b.d;

export function sum(list: readonly Fraction[]): Fraction {
	return list.reduce(plus, zero);
}

/** The nearest double, for drawing. */
export function toNumber(f: Fraction): number {
	return Number(f.n) / Number(f.d);
}

/** How many decimal places write a fraction exactly, or null if no number of them does. */
export function placesOf(f: Fraction): number | null {
	let d = f.d;
	let twos = 0;
	let fives = 0;
	while (d % 2n === 0n) {
		d /= 2n;
		twos++;
	}
	while (d % 5n === 0n) {
		d /= 5n;
		fives++;
	}
	return d === 1n ? Math.max(twos, fives) : null;
}

/** Writes a fraction rounded half away from zero to some decimal places, without trailing zeros. */
export function decimal(f: Fraction, places: number): string {
	const scale = 10n ** BigInt(places);
	const size = f.n < 0n ? -f.n : f.n;
	const scaled = (size * scale * 2n + f.d) / (f.d * 2n);
	const sign = f.n < 0n && scaled !== 0n ? "-" : "";
	const text = scaled.toString().padStart(places + 1, "0");
	const whole = text.slice(0, text.length - places);
	const rest = text.slice(text.length - places).replace(/0+$/, "");
	return `${sign}${whole}${rest === "" ? "" : `.${rest}`}`;
}
