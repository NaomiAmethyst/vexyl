// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Numbers as they're written in a file, worked with exactly, so that restating a flag can say
// which of them it would have to round.

/** A number as an exact fraction. */
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

export function fraction(n: bigint, d: bigint): Fraction {
	const g = gcd(n, d);
	return g === 0n ? { n: 0n, d: 1n } : { n: n / g, d: d / g };
}

/** Reads a number as it's written in a file, or null if it isn't one written in decimal. */
export function readExact(text: string): Fraction | null {
	const m = /^([+-]?)(\d[\d_]*)(?:\.(\d[\d_]*))?(?:[eE]([+-]?\d+))?$/.exec(text.trim());
	if (m === null) {
		const hex = /^([+-]?)0x([0-9a-fA-F_]+);?$/.exec(text.trim());
		if (hex === null) {
			return null;
		}
		const value = BigInt(`0x${hex[2]!.replaceAll("_", "")}`);
		return { n: hex[1] === "-" ? -value : value, d: 1n };
	}
	const whole = m[2]!.replaceAll("_", "");
	const part = (m[3] ?? "").replaceAll("_", "");
	const power = Number(m[4] ?? 0) - part.length;
	if (Math.abs(power) > 400) {
		return null;
	}
	const digits = BigInt(whole + part) * (m[1] === "-" ? -1n : 1n);
	return power >= 0 ? fraction(digits * 10n ** BigInt(power), 1n) : fraction(digits, 10n ** BigInt(-power));
}

/** How many decimal places a number that doesn't end is rounded to. */
const placesKept = 6;

/** Whether a fraction can be written exactly in decimal. */
export function ends(f: Fraction): boolean {
	let d = f.d;
	for (const p of [2n, 5n]) {
		while (d % p === 0n) {
			d /= p;
		}
	}
	return d === 1n;
}

export function decimal(f: Fraction, places: number): string {
	const scale = 10n ** BigInt(places);
	const sign = f.n < 0n ? "-" : "";
	const size = f.n < 0n ? -f.n : f.n;
	const scaled = (size * scale * 2n + f.d) / (f.d * 2n);
	const text = scaled.toString().padStart(places + 1, "0");
	const whole = text.slice(0, text.length - places);
	const rest = text.slice(text.length - places).replace(/0+$/, "");
	return `${sign}${whole}${rest === "" ? "" : `.${rest}`}`;
}

/** Writes a number: exactly if it can be, and otherwise rounded, which it says. */
export function write(f: Fraction): { text: string; exact: boolean } {
	if (ends(f)) {
		let places = 0;
		let d = f.d;
		while (d !== 1n) {
			const g = gcd(d, 10n);
			d /= g;
			places++;
		}
		return { text: decimal(f, places), exact: true };
	}
	const text = decimal(f, placesKept);
	// A tiny size mustn't become no size at all.
	return { text: /^-?0(\.0*)?$/.test(text) ? decimal(f, 12) : text, exact: false };
}

export const times = (a: Fraction, b: Fraction): Fraction => fraction(a.n * b.n, a.d * b.d);

/** The flag's shape, in the smallest whole numbers if they're small enough to read. */
export function shapeText(hoistText: string, flyText: string): string | null {
	const hoist = readExact(hoistText);
	const fly = readExact(flyText);
	if (hoist === null || fly === null || hoist.n <= 0n || fly.n <= 0n) {
		return null;
	}
	const shape = fraction(fly.n * hoist.d, fly.d * hoist.n);
	return shape.n < 10000n && shape.d < 10000n ? `${shape.d}:${shape.n}` : `1:${write(shape).exact ? write(shape).text : decimal(shape, 4)}`;
}

/** How far a shape is from square, in words a reader can check against the flag. */
export function flyPerHoist(hoistText: string, flyText: string): string | null {
	const hoist = readExact(hoistText);
	const fly = readExact(flyText);
	if (hoist === null || fly === null || hoist.n <= 0n || fly.n <= 0n) {
		return null;
	}
	return decimal(fraction(fly.n * hoist.d, fly.d * hoist.n), 4);
}

/** The fly that goes with a new hoist, or the other way around, on the same shape. */
export function matching(value: string, from: string, to: string): string | null {
	const v = readExact(value);
	const a = readExact(from);
	const b = readExact(to);
	if (v === null || a === null || b === null || a.n === 0n) {
		return null;
	}
	return write(times(v, fraction(b.n * a.d, b.d * a.n))).text;
}

export function factorText(factor: Fraction): string {
	return factor.d === 1n ? String(factor.n) : `${factor.n}/${factor.d}`;
}
