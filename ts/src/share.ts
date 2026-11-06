// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { deflateSync } from "fflate";
import { shareDictionaryBase64 } from "./sharedict.js";

/** The largest document a share link can hold, in bytes. SDK.md section 8 fixes it. */
export const shareMaxBytes = 8 * 1024 * 1024;

/** A share link that can't be read, or a document too large for one. */
export class ShareError extends Error {
	override name = "ShareError";
}

const base64url = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const standard = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBytes(text: string, alphabet: string): Uint8Array {
	const values = new Int8Array(128).fill(-1);
	for (let i = 0; i < 64; i++) {
		values[alphabet.charCodeAt(i)] = i;
	}
	const leftover = text.length % 4;
	if (leftover === 1) {
		throw new ShareError("its base64url has an impossible length");
	}
	const out = new Uint8Array(Math.floor((text.length * 3) / 4));
	let bits = 0;
	let held = 0;
	let n = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		const v = c < 128 ? values[c]! : -1;
		if (v < 0) {
			throw new ShareError("it has a character that isn't in base64url");
		}
		bits = ((bits << 6) | v) & 0xffff;
		held += 6;
		if (held >= 8) {
			held -= 8;
			out[n++] = (bits >> held) & 0xff;
		}
	}
	if ((bits & ((1 << held) - 1)) !== 0) {
		throw new ShareError("its base64url isn't in canonical form");
	}
	return out;
}

function encodeBytes(bytes: Uint8Array): string {
	let out = "";
	let i = 0;
	for (; i + 2 < bytes.length; i += 3) {
		const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
		out += base64url[v >> 18]! + base64url[(v >> 12) & 63]! + base64url[(v >> 6) & 63]! + base64url[v & 63]!;
	}
	if (i + 1 === bytes.length) {
		const v = bytes[i]! << 16;
		out += base64url[v >> 18]! + base64url[(v >> 12) & 63]!;
	} else if (i + 2 === bytes.length) {
		const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
		out += base64url[v >> 18]! + base64url[(v >> 12) & 63]! + base64url[(v >> 6) & 63]!;
	}
	return out;
}

let dictionary: Uint8Array | undefined;

/** The normative preset dictionary of version 1 links. */
export function shareDictionary(): Uint8Array {
	dictionary ??= decodeBytes(shareDictionaryBase64, standard);
	return dictionary;
}

/** Writes a document as the part of a share link after its `#`. */
export function shareEncode(source: string): string {
	const bytes = new TextEncoder().encode(source);
	if (bytes.length > shareMaxBytes) {
		throw new ShareError(`a share link can hold up to ${shareMaxBytes} bytes, and this is ${bytes.length}`);
	}
	return "v1." + encodeBytes(deflateSync(bytes, { level: 9, mem: 8, dictionary: shareDictionary() }));
}

/**
 * Reads the part of a share link after its `#`. Anything untrusted can be in one, so it stops as soon
 * as the output passes `shareMaxBytes`, and it refuses whatever isn't exactly what an encoder writes.
 */
export function shareDecode(link: string): string {
	const m = /^v([0-9]+)\./.exec(link);
	if (m === null) {
		throw new ShareError("it doesn't start with a version");
	}
	if (m[1] !== "1") {
		throw new ShareError(`it's version ${m[1]}, and this reads version 1`);
	}
	const bytes = inflate(decodeBytes(link.slice(m[0].length), base64url), shareDictionary(), shareMaxBytes);
	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch {
		throw new ShareError("what it holds isn't UTF-8");
	}
}

interface Huffman {
	counts: Uint16Array;
	symbols: Uint16Array;
}

const maxBits = 15;

/** Builds a canonical decoding table. A code can't be over-subscribed, and only a single one-bit code can be incomplete. */
function huffman(lengths: Uint8Array): Huffman {
	const counts = new Uint16Array(maxBits + 1);
	for (const l of lengths) {
		counts[l]!++;
	}
	const used = lengths.length - counts[0]!;
	counts[0] = 0;
	let left = 1;
	for (let bits = 1; bits <= maxBits; bits++) {
		left = left * 2 - counts[bits]!;
		if (left < 0) {
			throw new ShareError("its compressed data is corrupt: a code is over-subscribed");
		}
	}
	if (left > 0 && used !== 0 && !(used === 1 && counts[1] === 1)) {
		throw new ShareError("its compressed data is corrupt: a code is incomplete");
	}
	const offsets = new Uint16Array(maxBits + 2);
	for (let bits = 1; bits <= maxBits; bits++) {
		offsets[bits + 1] = offsets[bits]! + counts[bits]!;
	}
	const symbols = new Uint16Array(used);
	lengths.forEach((l, symbol) => {
		if (l !== 0) {
			symbols[offsets[l]!++] = symbol;
		}
	});
	return { counts, symbols };
}

const lengthBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const lengthExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const distanceBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const distanceExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const orderOfLengths = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

let fixedTables: { literals: Huffman; distances: Huffman } | undefined;

function fixed(): { literals: Huffman; distances: Huffman } {
	if (fixedTables === undefined) {
		const lengths = new Uint8Array(288);
		lengths.fill(8, 0, 144);
		lengths.fill(9, 144, 256);
		lengths.fill(7, 256, 280);
		lengths.fill(8, 280, 288);
		fixedTables = { literals: huffman(lengths), distances: huffman(new Uint8Array(32).fill(5)) };
	}
	return fixedTables;
}

/**
 * Inflates raw DEFLATE with a preset dictionary. It's here rather than from a library because a
 * reader of untrusted links has to stop at a limit and see where the stream ends, and has to agree
 * with every other library about what it refuses.
 */
export function inflate(input: Uint8Array, dict: Uint8Array, limit: number): Uint8Array {
	const corrupt = (why: string): never => {
		throw new ShareError(`its compressed data is corrupt: ${why}`);
	};
	const start = dict.length;
	let out = new Uint8Array(Math.min(start + Math.max(1024, input.length * 4), start + limit + 1));
	out.set(dict);
	let n = start;
	const room = (extra: number): void => {
		if (n - start + extra > limit) {
			throw new ShareError(`what it holds is over the limit of ${limit} bytes`);
		}
		if (n + extra > out.length) {
			const grown = new Uint8Array(Math.min(Math.max(out.length * 2, n + extra), start + limit + 1));
			grown.set(out.subarray(0, n));
			out = grown;
		}
	};
	let pos = 0;
	let bitBuffer = 0;
	let bitCount = 0;
	const bits = (need: number): number => {
		while (bitCount < need) {
			if (pos >= input.length) {
				corrupt("it ends early");
			}
			bitBuffer |= input[pos++]! << bitCount;
			bitCount += 8;
		}
		const value = bitBuffer & ((1 << need) - 1);
		bitBuffer >>>= need;
		bitCount -= need;
		return value;
	};
	const decode = (h: Huffman): number => {
		let code = 0;
		let first = 0;
		let index = 0;
		for (let len = 1; len <= maxBits; len++) {
			code |= bits(1);
			const count = h.counts[len]!;
			if (code - count < first) {
				return h.symbols[index + (code - first)]!;
			}
			index += count;
			first = (first + count) << 1;
			code <<= 1;
		}
		return corrupt("a code doesn't exist");
	};
	for (let last = false; !last; ) {
		last = bits(1) === 1;
		const type = bits(2);
		if (type === 0) {
			bitBuffer = 0;
			bitCount = 0;
			if (pos + 4 > input.length) {
				corrupt("it ends early");
			}
			const len = input[pos]! | (input[pos + 1]! << 8);
			if ((len ^ 0xffff) !== (input[pos + 2]! | (input[pos + 3]! << 8))) {
				corrupt("a stored block's lengths disagree");
			}
			pos += 4;
			if (pos + len > input.length) {
				corrupt("it ends early");
			}
			room(len);
			out.set(input.subarray(pos, pos + len), n);
			n += len;
			pos += len;
			continue;
		}
		if (type === 3) {
			corrupt("a block has an unknown type");
		}
		let literals: Huffman;
		let distances: Huffman;
		if (type === 1) {
			({ literals, distances } = fixed());
		} else {
			const nlen = bits(5) + 257;
			const ndist = bits(5) + 1;
			const ncode = bits(4) + 4;
			if (nlen > 286) {
				corrupt("too many length codes");
			}
			const lengths = new Uint8Array(320);
			for (let i = 0; i < ncode; i++) {
				lengths[orderOfLengths[i]!] = bits(3);
			}
			const codes = huffman(lengths.subarray(0, 19));
			lengths.fill(0, 0, 19);
			for (let i = 0; i < nlen + ndist; ) {
				const symbol = decode(codes);
				if (symbol < 16) {
					lengths[i++] = symbol;
					continue;
				}
				let previous = 0;
				let repeat: number;
				if (symbol === 16) {
					if (i === 0) {
						corrupt("a repeat has nothing to repeat");
					}
					previous = lengths[i - 1]!;
					repeat = 3 + bits(2);
				} else {
					repeat = symbol === 17 ? 3 + bits(3) : 11 + bits(7);
				}
				if (i + repeat > nlen + ndist) {
					corrupt("too many code lengths");
				}
				lengths.fill(previous, i, i + repeat);
				i += repeat;
			}
			if (lengths[256] === 0) {
				corrupt("no code ends a block");
			}
			literals = huffman(lengths.slice(0, nlen));
			distances = huffman(lengths.slice(nlen, nlen + ndist));
		}
		for (;;) {
			const symbol = decode(literals);
			if (symbol < 256) {
				room(1);
				out[n++] = symbol;
			} else if (symbol === 256) {
				break;
			} else {
				if (symbol > 285) {
					corrupt("a length code doesn't exist");
				}
				const length = lengthBase[symbol - 257]! + bits(lengthExtra[symbol - 257]!);
				const d = decode(distances);
				if (d > 29) {
					corrupt("a distance code doesn't exist");
				}
				const distance = distanceBase[d]! + bits(distanceExtra[d]!);
				if (distance > n) {
					corrupt("a distance reaches back too far");
				}
				room(length);
				for (let i = 0; i < length; i++) {
					out[n] = out[n - distance]!;
					n++;
				}
			}
		}
	}
	if (pos !== input.length) {
		corrupt("there's more after its end");
	}
	return out.subarray(start, n);
}
