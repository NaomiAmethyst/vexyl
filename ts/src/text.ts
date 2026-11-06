// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Text and number handling whose exact behavior the format's checks depend on. JavaScript's
// own `trim`, `\s`, `parseFloat` and `Math.round` each differ from the reference at the edges,
// and accepting a different set of documents would be a conformance bug.

/** A map whose keys can be anything in a document, including `__proto__` and `constructor`. */
export function dict<T>(): Record<string, T> {
	return Object.create(null) as Record<string, T>;
}

/** The reference's definition of whitespace, which is Unicode's White_Space. */
export function isSpace(code: number): boolean {
	return (
		(code >= 0x09 && code <= 0x0d) ||
		code === 0x20 ||
		code === 0x85 ||
		code === 0xa0 ||
		code === 0x1680 ||
		(code >= 0x2000 && code <= 0x200a) ||
		code === 0x2028 ||
		code === 0x2029 ||
		code === 0x202f ||
		code === 0x205f ||
		code === 0x3000
	);
}

export function trimSpace(s: string): string {
	let start = 0;
	let end = s.length;
	while (start < end && isSpace(s.charCodeAt(start))) {
		start++;
	}
	while (end > start && isSpace(s.charCodeAt(end - 1))) {
		end--;
	}
	return s.slice(start, end);
}

/** Splits around runs of whitespace, leaving out empty fields. */
export function fields(s: string): string[] {
	const out: string[] = [];
	let start = -1;
	for (let i = 0; i < s.length; i++) {
		if (isSpace(s.charCodeAt(i))) {
			if (start >= 0) {
				out.push(s.slice(start, i));
				start = -1;
			}
		} else if (start < 0) {
			start = i;
		}
	}
	if (start >= 0) {
		out.push(s.slice(start));
	}
	return out;
}

function underscoresOK(text: string): boolean {
	let s = text;
	if (s[0] === "-" || s[0] === "+") {
		s = s.slice(1);
	}
	let saw = "^";
	let i = 0;
	let hex = false;
	if (s.length >= 2 && s[0] === "0" && /[boxBOX]/.test(s[1]!)) {
		i = 2;
		saw = "0";
		hex = /[xX]/.test(s[1]!);
	}
	for (; i < s.length; i++) {
		const c = s[i]!;
		if ((c >= "0" && c <= "9") || (hex && /[a-fA-F]/.test(c))) {
			saw = "0";
		} else if (c === "_") {
			if (saw !== "0") {
				return false;
			}
			saw = "_";
		} else {
			if (saw === "_") {
				return false;
			}
			saw = "!";
		}
	}
	return saw !== "_";
}

function hexFloat(digits: string, exponent: number): number {
	let value = 0;
	let scale = exponent;
	let dot = false;
	for (const c of digits) {
		if (c === ".") {
			dot = true;
		} else {
			value = value * 16 + parseInt(c, 16);
			if (dot) {
				scale -= 4;
			}
		}
	}
	return value === 0 ? 0 : value * 2 ** scale;
}

/** Reads a number as the reference does, or gives undefined if it isn't one or is out of range. */
export function parseNumber(s: string): number | undefined {
	const special = /^([+-]?)(inf|infinity)$/i.exec(s);
	if (special) {
		return special[1] === "-" ? -Infinity : Infinity;
	}
	if (/^nan$/i.test(s)) {
		return NaN;
	}
	const hex = /^[+-]?0[xX]([0-9a-fA-F_.]*)[pP]([+-]?[0-9][0-9_]*)$/.exec(s);
	const form = hex ?? /^[+-]?([0-9_.]*)(?:[eE]([+-]?[0-9][0-9_]*))?$/.exec(s);
	if (!form) {
		return undefined;
	}
	const mantissa = form[1]!;
	if ((mantissa.match(/\./g) ?? []).length > 1 || !/[0-9a-fA-F]/.test(mantissa)) {
		return undefined;
	}
	if (s.includes("_") && !underscoresOK(s)) {
		return undefined;
	}
	const clean = mantissa.replaceAll("_", "");
	const exponent = form[2]?.replaceAll("_", "");
	const value = hex ? hexFloat(clean, Number(exponent)) : Number(clean + (exponent === undefined ? "" : "e" + exponent));
	if (!Number.isFinite(value)) {
		return undefined;
	}
	return s[0] === "-" ? -value : value;
}

/** Writes a number in full, with as few digits as read back the same and never an exponent. */
export function formatNumber(v: number): string {
	if (Number.isNaN(v)) {
		return "NaN";
	}
	if (!Number.isFinite(v)) {
		return v > 0 ? "+Inf" : "-Inf";
	}
	if (Object.is(v, -0)) {
		return "-0";
	}
	const text = String(v);
	const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
	if (!m) {
		return text;
	}
	const digits = m[2]! + (m[3] ?? "");
	const point = 1 + Number(m[4]);
	if (point <= 0) {
		return m[1]! + "0." + "0".repeat(-point) + digits;
	}
	if (point >= digits.length) {
		return m[1]! + digits + "0".repeat(point - digits.length);
	}
	return m[1]! + digits.slice(0, point) + "." + digits.slice(point);
}

/** Rounds half away from zero, unlike `Math.round`. */
export function round(v: number): number {
	const whole = Math.trunc(v);
	return Math.abs(v - whole) >= 0.5 ? whole + Math.sign(v) : whole;
}

/** Writes a coordinate to a fixed precision, free of floating-point noise. */
export function num(v: number): string {
	const rounded = round(v * 1e6) / 1e6;
	return rounded === 0 ? "0" : formatNumber(rounded);
}

export function inCharacterRange(code: number): boolean {
	return (
		code === 0x09 ||
		code === 0x0a ||
		code === 0x0d ||
		(code >= 0x20 && code <= 0xd7ff) ||
		(code >= 0xe000 && code <= 0xfffd) ||
		(code >= 0x10000 && code <= 0x10ffff)
	);
}

/** Escapes text for XML, whether in an attribute or not. */
export function esc(s: string): string {
	if (!/[^\x20\x21\x23-\x25\x28-\x3b\x3d\x3f-\x7e]/.test(s)) {
		return s;
	}
	let out = "";
	for (const ch of s) {
		switch (ch) {
			case '"':
				out += "&#34;";
				break;
			case "'":
				out += "&#39;";
				break;
			case "&":
				out += "&amp;";
				break;
			case "<":
				out += "&lt;";
				break;
			case ">":
				out += "&gt;";
				break;
			case "\t":
				out += "&#x9;";
				break;
			case "\n":
				out += "&#xA;";
				break;
			case "\r":
				out += "&#xD;";
				break;
			default:
				out += inCharacterRange(ch.codePointAt(0)!) ? ch : "�";
		}
	}
	return out;
}

/** A small hash for IDs, which only have to differ between documents. It's 64 bits, as hex. */
export function hash(s: string): string {
	let a = 0xdeadbeef;
	let b = 0x41c6ce57;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		a = Math.imul(a ^ c, 2654435761);
		b = Math.imul(b ^ c, 1597334677);
	}
	a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
	b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
	return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
