// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// A strict XML tokenizer with no DOM, so that it behaves the same in Node and in browsers. The
// sanitizer's security rests on this reading markup exactly one way: anything it can't read for
// certain is an error. It accepts the same documents as the reference's XML decoder.

import { inCharacterRange } from "./text.js";

export const svgNamespace = "http://www.w3.org/2000/svg";
export const xlinkNamespace = "http://www.w3.org/1999/xlink";
const xmlNamespace = "http://www.w3.org/XML/1998/namespace";

export class XmlError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "XmlError";
	}
}

export interface XmlName {
	/** The namespace once translated, or the prefix when read raw or when it's undeclared. */
	space: string;
	local: string;
}

export interface XmlAttr {
	name: XmlName;
	value: string;
}

export type XmlToken =
	| { type: "start"; name: XmlName; attrs: XmlAttr[] }
	| { type: "end"; name: XmlName }
	| { type: "text"; data: string }
	| { type: "comment" }
	| { type: "instruction"; target: string }
	| { type: "directive" };

// XML 1.0's Letter, '_' and ':', and its other NameChars, by code point.
const firstRanges = "3a,41-5a,5f,61-7a,c0-d6,d8-f6,f8-131,134-13e,141-148,14a-17e,180-1c3,1cd-1f0,1f4-1f5,1fa-217,250-2a8,2bb-2c1,386,388-38a,38c,38e-3a1,3a3-3ce,3d0-3d6,3da,3dc,3de,3e0,3e2-3f3,401-40c,40e-44f,451-45c,45e-481,490-4c4,4c7-4c8,4cb-4cc,4d0-4eb,4ee-4f5,4f8-4f9,531-556,559,561-586,5d0-5ea,5f0-5f2,621-63a,641-64a,671-6b7,6ba-6be,6c0-6ce,6d0-6d3,6d5,6e5-6e6,905-939,93d,958-961,985-98c,98f-990,993-9a8,9aa-9b0,9b2,9b6-9b9,9dc-9dd,9df-9e1,9f0-9f1,a05-a0a,a0f-a10,a13-a28,a2a-a30,a32-a33,a35-a36,a38-a39,a59-a5c,a5e,a72-a74,a85-a8b,a8d,a8f-a91,a93-aa8,aaa-ab0,ab2-ab3,ab5-ab9,b05-b0c,b0f-b10,b13-b28,b2a-b30,b32-b33,b36-b39,b3d,b5c-b5d,b5f-b61,b85-b8a,b8e-b90,b92-b95,b99-b9a,b9c,b9e-b9f,ba3-ba4,ba8-baa,bae-bb5,bb7-bb9,c05-c0c,c0e-c10,c12-c28,c2a-c33,c35-c39,c60-c61,c85-c8c,c8e-c90,c92-ca8,caa-cb3,cb5-cb9,cde,ce0-ce1,d05-d0c,d0e-d10,d12-d28,d2a-d39,d60-d61,e01-e2e,e30,e32-e33,e40-e45,e81-e82,e84,e87-e88,e8a,e8d,e94-e97,e99-e9f,ea1-ea3,ea5,ea7,eaa-eab,ead-eae,eb0,eb2-eb3,ebd,ec0-ec4,f40-f47,f49-f69,10a0-10c5,10d0-10f6,1100,1102-1103,1105-1107,1109,110b-110c,110e-1112,113c,113e,1140,114c,114e,1150,1154-1155,1159,115f-1161,1163,1165,1167,1169,116d-116e,1172-1173,11ae-11af,11b7-11b8,11ba,11bc-11c2,11f9,1e00-1e9b,1ea0-1ef9,1f00-1f15,1f18-1f1d,1f20-1f45,1f48-1f4d,1f50-1f57,1f5d,1f5f-1f7d,1f80-1fb4,1fb6-1fbc,1fbe,1fc2-1fc4,1fc6-1fcc,1fd0-1fd3,1fd6-1fdb,1fe0-1fec,1ff2-1ff4,1ff6-1ffc,2126,212a-212b,212e,2180-2182,3007,3021-3029,3041-3094,30a1-30fa,3105-312c,4e00-9fa5,ac00-d7a3";
const secondRanges = "2d-2e,30-39,b7,2d0-2d1,300-345,360-361,387,483-486,591-5a1,5a3-5b9,5bb-5bd,5bf,5c1-5c2,64b-652,660-669,670,6d6-6e4,6e7-6e8,6ea-6ed,6f0-6f9,901-903,93c,93e-94d,951-954,962-963,966-96f,981-983,9bc,9be-9c4,9c7-9c8,9cb-9cd,9d7,9e2-9e3,9e6-9ef,a3e-a42,a47-a48,a4b-a4d,a66-a71,a81-a83,abc,abe-ac5,ac7-ac9,acb-acd,ae6-aef,b01-b03,b3c,b3e-b43,b47-b48,b4b-b4d,b56-b57,b66-b6f,b82-b83,bbe-bc2,bc6-bc8,bca-bcd,bd7,be7-bef,c01-c03,c3e-c44,c46-c48,c4a-c4d,c55-c56,c66-c6f,c82-c83,cbe-cc4,cc6-cc8,cca-ccd,cd5-cd6,ce6-cef,d02-d03,d3e-d43,d46-d48,d4a-d4d,d57,d66-d6f,e31,e34-e3a,e46-e4e,e50-e59,eb1,eb4-eb9,ebb-ebc,ec6,ec8-ecd,ed0-ed9,f18-f19,f20-f29,f35,f37,f39,f3e-f3f,f71-f84,f86-f8b,f90-f95,f97,f99-fad,fb1-fb7,fb9,20d0-20dc,302a-302f,3031-3035,3099-309a,309d-309e,30fc-30fe";

function decodeRanges(text: string): number[] {
	const out: number[] = [];
	for (const part of text.split(",")) {
		const [a, b] = part.split("-");
		out.push(parseInt(a!, 16), parseInt(b ?? a!, 16));
	}
	return out;
}

let firstTable: number[] | undefined;
let secondTable: number[] | undefined;

function inRanges(table: number[], code: number): boolean {
	let lo = 0;
	let hi = table.length / 2 - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >>> 1;
		if (code < table[mid * 2]!) {
			hi = mid - 1;
		} else if (code > table[mid * 2 + 1]!) {
			lo = mid + 1;
		} else {
			return true;
		}
	}
	return false;
}

function isFirst(code: number): boolean {
	firstTable ??= decodeRanges(firstRanges);
	return inRanges(firstTable, code);
}

function isSecond(code: number): boolean {
	secondTable ??= decodeRanges(secondRanges);
	return inRanges(secondTable, code);
}

function isName(s: string): boolean {
	if (s.length === 0) {
		return false;
	}
	let start = true;
	for (const ch of s) {
		const code = ch.codePointAt(0)!;
		if (start ? !isFirst(code) : !isFirst(code) && !isSecond(code)) {
			return false;
		}
		start = false;
	}
	return true;
}

function isNameCode(c: number): boolean {
	return (
		(c >= 0x41 && c <= 0x5a) ||
		(c >= 0x61 && c <= 0x7a) ||
		(c >= 0x30 && c <= 0x39) ||
		c === 0x5f ||
		c === 0x3a ||
		c === 0x2e ||
		c === 0x2d
	);
}

const entities: ReadonlyMap<string, string> = new Map([
	["lt", "<"],
	["gt", ">"],
	["amp", "&"],
	["apos", "'"],
	["quot", '"'],
]);

/** Finds `param="value"` in the XML declaration, as loosely as the reference does. */
function declared(param: string, s: string): string {
	const key = param + "=";
	let i = 0;
	let sep = "";
	while (i < s.length) {
		const sub = s.slice(i);
		const k = sub.indexOf(key);
		if (k < 0 || key.length + k >= sub.length) {
			return "";
		}
		i += key.length + k + 1;
		const c = sub[key.length + k]!;
		if (c === "'" || c === '"') {
			sep = c;
			break;
		}
	}
	if (sep === "") {
		return "";
	}
	const j = s.indexOf(sep, i);
	return j < 0 ? "" : s.slice(i, j);
}

type StackEntry = { kind: "start"; name: XmlName } | { kind: "ns"; local: string; url: string | undefined };

/** Reads tokens one at a time. Elements come back matched and nested, or it throws. */
export class XmlDecoder {
	private readonly src: string;
	private pos = 0;
	private toClose: XmlName | undefined;
	private readonly ns = new Map<string, string>();
	private readonly stack: StackEntry[] = [];

	constructor(src: string) {
		this.src = src;
	}

	/** The next token with its namespaces worked out, or null at the end of the document. */
	token(): XmlToken | null {
		const t = this.rawToken();
		if (t === null) {
			if (this.stack.length > 0) {
				throw new XmlError("unexpected end of the document");
			}
			return null;
		}
		if (t.type === "start") {
			for (const a of t.attrs) {
				if (a.name.space === "xmlns") {
					this.stack.push({ kind: "ns", local: a.name.local, url: this.ns.get(a.name.local) });
					this.ns.set(a.name.local, a.value);
				}
				if (a.name.space === "" && a.name.local === "xmlns") {
					this.stack.push({ kind: "ns", local: "", url: this.ns.get("") });
					this.ns.set("", a.value);
				}
			}
			this.stack.push({ kind: "start", name: { ...t.name } });
			this.translate(t.name, true);
			for (const a of t.attrs) {
				this.translate(a.name, false);
			}
		} else if (t.type === "end") {
			this.popElement(t.name);
		}
		return t;
	}

	private translate(n: XmlName, isElement: boolean): void {
		if (n.space === "xmlns" || (n.space === "" && !isElement)) {
			return;
		}
		if (n.space === "xml") {
			n.space = xmlNamespace;
		} else if (n.space === "" && n.local === "xmlns") {
			return;
		}
		const url = this.ns.get(n.space);
		if (url !== undefined) {
			n.space = url;
		}
	}

	private popElement(name: XmlName): void {
		const s = this.stack.pop();
		if (s === undefined || s.kind !== "start") {
			throw new XmlError(`unexpected end element </${name.local}>`);
		}
		if (s.name.local !== name.local) {
			throw new XmlError(`element <${s.name.local}> closed by </${name.local}>`);
		}
		if (s.name.space !== name.space) {
			throw new XmlError(`element <${s.name.local}> in space ${s.name.space} closed by </${name.local}> in space ${name.space}`);
		}
		this.translate(name, true);
		for (let top = this.stack.at(-1); top !== undefined && top.kind === "ns"; top = this.stack.at(-1)) {
			this.stack.pop();
			if (top.url !== undefined) {
				this.ns.set(top.local, top.url);
			} else {
				this.ns.delete(top.local);
			}
		}
	}

	/** The next token as written, with no checks on nesting and no namespaces worked out. */
	rawToken(): XmlToken | null {
		if (this.toClose !== undefined) {
			const name = this.toClose;
			this.toClose = undefined;
			return { type: "end", name };
		}
		const src = this.src;
		if (this.pos >= src.length) {
			return null;
		}
		if (src[this.pos] !== "<") {
			return { type: "text", data: this.text("", false) };
		}
		this.pos++;
		const b = this.next();
		if (b === "/") {
			const name = this.nsname("expected element name after </");
			this.space();
			if (this.next() !== ">") {
				throw new XmlError(`invalid characters between </${name.local} and >`);
			}
			return { type: "end", name };
		}
		if (b === "?") {
			return this.instruction();
		}
		if (b === "!") {
			return this.bang();
		}
		this.pos--;
		return this.startElement();
	}

	private instruction(): XmlToken {
		const target = this.readName();
		if (target === null || !isName(target)) {
			throw new XmlError("expected target name after <?");
		}
		this.space();
		const end = this.src.indexOf("?>", this.pos);
		if (end < 0) {
			throw new XmlError("unexpected end of the document");
		}
		const data = this.src.slice(this.pos, end);
		this.pos = end + 2;
		if (target === "xml") {
			const version = declared("version", data);
			if (version !== "" && version !== "1.0") {
				throw new XmlError(`unsupported version "${version}"; only version 1.0 is supported`);
			}
			const encoding = declared("encoding", data);
			if (encoding !== "" && encoding.toLowerCase() !== "utf-8") {
				throw new XmlError(`unsupported encoding "${encoding}"`);
			}
		}
		return { type: "instruction", target };
	}

	private bang(): XmlToken {
		const b = this.next();
		if (b === "-") {
			if (this.next() !== "-") {
				throw new XmlError("invalid sequence <!- not part of <!--");
			}
			let b0 = "";
			let b1 = "";
			for (;;) {
				const c = this.next();
				if (b0 === "-" && b1 === "-") {
					if (c !== ">") {
						throw new XmlError('invalid sequence "--" not allowed in comments');
					}
					return { type: "comment" };
				}
				b0 = b1;
				b1 = c;
			}
		}
		if (b === "[") {
			for (const expected of "CDATA[") {
				if (this.next() !== expected) {
					throw new XmlError("invalid <![ sequence");
				}
			}
			return { type: "text", data: this.text("", true) };
		}
		// A directive is always refused, so there's no need to find where it ends.
		return { type: "directive" };
	}

	private startElement(): XmlToken {
		const name = this.nsname("expected element name after <");
		const attrs: XmlAttr[] = [];
		for (;;) {
			this.space();
			const b = this.next();
			if (b === "/") {
				if (this.next() !== ">") {
					throw new XmlError("expected /> in element");
				}
				this.toClose = { ...name };
				break;
			}
			if (b === ">") {
				break;
			}
			this.pos--;
			const attr = this.nsname("expected attribute name in element");
			this.space();
			if (this.next() !== "=") {
				throw new XmlError("attribute name without = in element");
			}
			this.space();
			const quote = this.next();
			if (quote !== '"' && quote !== "'") {
				throw new XmlError("unquoted or missing attribute value in element");
			}
			attrs.push({ name: attr, value: this.text(quote, false) });
		}
		return { type: "start", name, attrs };
	}

	private next(): string {
		if (this.pos >= this.src.length) {
			throw new XmlError("unexpected end of the document");
		}
		return this.src[this.pos++]!;
	}

	private space(): void {
		while (this.pos < this.src.length) {
			const c = this.src.charCodeAt(this.pos);
			if (c !== 0x20 && c !== 0x0d && c !== 0x0a && c !== 0x09) {
				return;
			}
			this.pos++;
		}
	}

	/** Reads up to the first ASCII character not valid in a name, or null if there's no name. */
	private readName(): string | null {
		const start = this.pos;
		while (this.pos < this.src.length) {
			const c = this.src.charCodeAt(this.pos);
			if (c < 0x80 && !isNameCode(c)) {
				break;
			}
			this.pos++;
		}
		if (this.pos === start) {
			if (this.pos >= this.src.length) {
				throw new XmlError("unexpected end of the document");
			}
			return null;
		}
		return this.src.slice(start, this.pos);
	}

	private nsname(missing: string): XmlName {
		const s = this.readName();
		if (s === null) {
			throw new XmlError(missing);
		}
		if (!isName(s)) {
			throw new XmlError(`invalid XML name: ${s}`);
		}
		const colon = s.indexOf(":");
		if (colon < 0) {
			return { space: "", local: s };
		}
		if (s.indexOf(":", colon + 1) >= 0) {
			throw new XmlError(missing);
		}
		if (colon === 0 || colon === s.length - 1) {
			return { space: "", local: s };
		}
		return { space: s.slice(0, colon), local: s.slice(colon + 1) };
	}

	/** Reads text, up to a quote if one is given, or to `]]>` in a CDATA section. */
	private text(quote: string, cdata: boolean): string {
		const src = this.src;
		let out = "";
		let b0 = "";
		let b1 = "";
		for (;;) {
			if (this.pos >= src.length) {
				if (cdata) {
					throw new XmlError("unexpected end of the document in a CDATA section");
				}
				if (quote !== "") {
					throw new XmlError("unexpected end of the document");
				}
				break;
			}
			const b = src[this.pos++]!;
			if (quote === "" && b0 === "]" && b1 === "]" && b === ">") {
				if (cdata) {
					out = out.slice(0, -2);
					break;
				}
				throw new XmlError("unescaped ]]> not in a CDATA section");
			}
			if (b === "<" && !cdata) {
				if (quote !== "") {
					throw new XmlError("unescaped < inside a quoted string");
				}
				this.pos--;
				break;
			}
			if (quote !== "" && b === quote) {
				break;
			}
			if (b === "&" && !cdata) {
				out += this.entity();
				b0 = "";
				b1 = "";
				continue;
			}
			if (b === "\r") {
				out += "\n";
			} else if (!(b1 === "\r" && b === "\n")) {
				out += b;
			}
			b0 = b1;
			b1 = b;
		}
		for (const ch of out) {
			if (!inCharacterRange(ch.codePointAt(0)!)) {
				throw new XmlError(`illegal character code U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
			}
		}
		return out;
	}

	private entity(): string {
		const start = this.pos - 1;
		const invalid = (): XmlError => new XmlError(`invalid character entity ${this.src.slice(start, Math.min(this.pos, start + 32))}`);
		let b = this.next();
		if (b === "#") {
			b = this.next();
			let base = 10;
			if (b === "x") {
				base = 16;
				b = this.next();
			}
			let digits = "";
			while ((b >= "0" && b <= "9") || (base === 16 && ((b >= "a" && b <= "f") || (b >= "A" && b <= "F")))) {
				digits += b;
				b = this.next();
			}
			if (b !== ";" || digits === "") {
				throw invalid();
			}
			const value = digits.replace(/^0+(?=.)/, "");
			// A long run of digits is out of range, and big enough to lose precision.
			const code = value.length > 8 ? Infinity : parseInt(value, base);
			if (code > 0x10ffff) {
				throw invalid();
			}
			// A surrogate isn't a character, and the reference reads it as a replacement.
			return code >= 0xd800 && code <= 0xdfff ? "�" : String.fromCodePoint(code);
		}
		this.pos--;
		const name = this.readName();
		if (this.next() !== ";" || name === null) {
			throw invalid();
		}
		const text = entities.get(name);
		if (text === undefined) {
			throw invalid();
		}
		return text;
	}
}
