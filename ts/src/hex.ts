// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// @bgotink/kdl 0.4.1 counts `;` as a hexadecimal digit, so in `at hoist=0x0A; rotate 5` it reads
// `rotate` and `5` as more of what `at` is given. This finds those numbers before it can.

/** Where a string or comment that starts here ends, or -1 if none starts here. */
function skipText(text: string, i: number): number {
	if (text.startsWith("//", i)) {
		const end = text.indexOf("\n", i);
		return end < 0 ? text.length : end;
	}
	if (text.startsWith("/*", i)) {
		let depth = 1;
		let at = i + 2;
		while (depth > 0 && at < text.length) {
			if (text.startsWith("/*", at)) {
				depth++;
				at += 2;
			} else if (text.startsWith("*/", at)) {
				depth--;
				at += 2;
			} else {
				at++;
			}
		}
		return at;
	}
	const raw = /^#+/.exec(text.slice(i, i + 64))?.[0] ?? "";
	if (text[i + raw.length] !== '"') {
		return -1;
	}
	const open = i + raw.length;
	const triple = text.startsWith('"""', open);
	const close = (triple ? '"""' : '"') + raw;
	let at = open + (triple ? 3 : 1);
	while (at < text.length) {
		if (raw === "" && text[at] === "\\") {
			at += 2;
		} else if (text.startsWith(close, at)) {
			return at + close.length;
		} else {
			at++;
		}
	}
	return text.length;
}

interface Misread {
	start: number;
	end: number;
	decimal: string;
}

function misreads(text: string): Misread[] {
	const found: Misread[] = [];
	const number = /[+-]?0x[0-9a-fA-F_]+;/y;
	let i = 0;
	while (i < text.length) {
		const past = skipText(text, i);
		if (past >= 0) {
			i = past;
			continue;
		}
		number.lastIndex = i;
		const m = /[\s=(){}]/.test(text[i - 1] ?? " ") ? number.exec(text) : null;
		if (m === null) {
			i++;
			continue;
		}
		const end = i + m[0].length - 1;
		const rest = /^[ \t]*(.?.?)/.exec(text.slice(end + 1, end + 80))![1]!;
		if (rest !== "" && !rest.startsWith("}") && !rest.startsWith("//") && !rest.startsWith("/*") && !/^[\r\n]/.test(rest)) {
			const negative = m[0].startsWith("-");
			const digits = BigInt(m[0].slice(0, -1).replace(/^[+-]/, "").replaceAll("_", ""));
			found.push({ start: i, end, decimal: `${negative ? "-" : ""}${digits}` });
		}
		i = end + 1;
	}
	return found;
}

/** Whether the parser would read part of this text wrongly, because of what's above. */
export function hasMisreadHex(text: string): boolean {
	return misreads(text).length > 0;
}

/**
 * Text the parser reads correctly, with every offset the same: those numbers are written in decimal,
 * and spaces make up the difference. One too long to fit stays as it is, and gets refused.
 */
export function withoutMisreadHex(text: string): string {
	let out = text;
	for (const { start, end, decimal } of misreads(text).reverse()) {
		if (decimal.length <= end - start) {
			out = out.slice(0, start) + decimal.padEnd(end - start) + out.slice(end);
		}
	}
	return out;
}
