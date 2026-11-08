// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Text and number handling whose exact behavior the format's checks depend on. JavaScript's
// own `trim`, `\s`, `parseFloat` and `Math.round` each differ from the format's rules at the
// edges, and accepting a different set of documents would be a conformance bug.

import { inLimits } from "./limits.js";
import { isXmlChar } from "./xml.js";

/** A map whose keys can be anything in a document, including `__proto__` and `constructor`. */
export function dict<T>(): Record<string, T> {
	return Object.create(null) as Record<string, T>;
}

/** What counts as whitespace inside strings and inline SVG. */
const isAsciiSpace = (code: number): boolean => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;

export function trimSpace(s: string): string {
	let start = 0;
	let end = s.length;
	while (start < end && isAsciiSpace(s.charCodeAt(start))) {
		start++;
	}
	while (end > start && isAsciiSpace(s.charCodeAt(end - 1))) {
		end--;
	}
	return s.slice(start, end);
}

/** Lowers only ASCII letters, since others like U+212A can lower into them. */
export function asciiLower(s: string): string {
	return s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

/** The one way to write a number inside a string. */
export const decimalForm = "[-+]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][-+]?[0-9]+)?";
const decimalWhole = new RegExp(`^${decimalForm}$`);
/** Separates numbers in a string, as SVG's comma-wsp does: whitespace, or one comma with any whitespace around it. */
export const commaSpace = "(?:[\\t\\n\\f\\r ]*,[\\t\\n\\f\\r ]*|[\\t\\n\\f\\r ]+)";
const numberList = new RegExp(`^[\\t\\n\\f\\r ]*${decimalForm}(?:${commaSpace}${decimalForm})*[\\t\\n\\f\\r ]*$`);
const numberSplit = new RegExp(commaSpace);

/** Reads one number written that way, or gives undefined if it isn't one or is beyond the limits. */
export function decimalValue(text: string): number | undefined {
	if (!decimalWhole.test(text)) {
		return undefined;
	}
	const v = Number(text);
	return inLimits(v) ? v : undefined;
}

/** Reads a string holding numbers, separated by whitespace, a comma or both. */
export function numbersIn(text: string): number[] | undefined {
	if (!numberList.test(text)) {
		return undefined;
	}
	const out: number[] = [];
	for (const part of trimSpace(text).split(numberSplit)) {
		const v = decimalValue(part);
		if (v === undefined) {
			return undefined;
		}
		out.push(v);
	}
	return out;
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

/**
 * Writes a scale, whose size says nothing about how many places it needs: a path drawn in a box
 * tens of thousands wide, on a grid of a few units, is scaled by a very small number.
 */
export function factor(v: number): string {
	return formatNumber(Number(v.toPrecision(10)));
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
				out += isXmlChar(ch.codePointAt(0)!) ? ch : "�";
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
