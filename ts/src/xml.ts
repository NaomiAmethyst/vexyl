// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Reads well-formed XML 1.0 with namespaces, as section 8.3 of the format defines it, with no DOM,
// so that it behaves the same in Node and in browsers. The sanitizer's security rests on this
// reading markup exactly one way, so nothing here is lenient.

export const svgNamespace = "http://www.w3.org/2000/svg";
export const xlinkNamespace = "http://www.w3.org/1999/xlink";
const xmlNamespace = "http://www.w3.org/XML/1998/namespace";
const xmlnsNamespace = "http://www.w3.org/2000/xmlns/";

export class XmlError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "XmlError";
	}
}

export interface XmlName {
	/** The namespace it's in, or empty if it's in none. */
	space: string;
	local: string;
}

export interface XmlAttr {
	name: XmlName;
	value: string;
}

export type XmlToken =
	| { type: "start"; name: XmlName; attrs: XmlAttr[]; raw: string; given: { name: string; value: string }[] }
	| { type: "end"; name: XmlName }
	| { type: "text"; data: string }
	| { type: "other" }
	| { type: "directive" };

export function isXmlChar(c: number): boolean {
	return c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff);
}

const isSpaceCode = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

function isNameStart(c: number): boolean {
	return (
		c === 0x3a || c === 0x5f || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) ||
		(c >= 0xc0 && c <= 0xd6) || (c >= 0xd8 && c <= 0xf6) || (c >= 0xf8 && c <= 0x2ff) ||
		(c >= 0x370 && c <= 0x37d) || (c >= 0x37f && c <= 0x1fff) || (c >= 0x200c && c <= 0x200d) ||
		(c >= 0x2070 && c <= 0x218f) || (c >= 0x2c00 && c <= 0x2fef) || (c >= 0x3001 && c <= 0xd7ff) ||
		(c >= 0xf900 && c <= 0xfdcf) || (c >= 0xfdf0 && c <= 0xfffd) || (c >= 0x10000 && c <= 0xeffff)
	);
}

function isNameChar(c: number): boolean {
	return isNameStart(c) || c === 0x2d || c === 0x2e || (c >= 0x30 && c <= 0x39) || c === 0xb7 || (c >= 0x300 && c <= 0x36f) || (c >= 0x203f && c <= 0x2040);
}

const entities: ReadonlyMap<string, string> = new Map([
	["lt", "<"],
	["gt", ">"],
	["amp", "&"],
	["apos", "'"],
	["quot", '"'],
]);

const endOfMarkup = "unexpected end of the markup";

/** Divides a name at its colon, of which it can have one, between two parts. */
function splitQName(raw: string): [string, string] {
	const colon = raw.indexOf(":");
	if (colon < 0) {
		return ["", raw];
	}
	const after = raw.slice(colon + 1);
	if (colon === 0 || after === "" || after.includes(":") || !isNameStart(after.codePointAt(0)!)) {
		throw new XmlError(`"${raw}" isn't a valid qualified name`);
	}
	return [raw.slice(0, colon), after];
}

/** Reads ` version="1.0" encoding="UTF-8" standalone="yes"`, of which only the version is required. */
function checkDeclaration(data: string): void {
	const bad = new XmlError("malformed XML declaration");
	let pos = 0;
	const field = (key: string): string | undefined => {
		let i = pos;
		while (i < data.length && isSpaceCode(data.charCodeAt(i))) {
			i++;
		}
		if (i === pos || !data.startsWith(key, i)) {
			return undefined;
		}
		i += key.length;
		while (i < data.length && isSpaceCode(data.charCodeAt(i))) {
			i++;
		}
		if (data[i] !== "=") {
			throw bad;
		}
		i++;
		while (i < data.length && isSpaceCode(data.charCodeAt(i))) {
			i++;
		}
		const quote = data[i];
		if (quote !== '"' && quote !== "'") {
			throw bad;
		}
		const end = data.indexOf(quote, i + 1);
		if (end < 0) {
			throw bad;
		}
		pos = end + 1;
		return data.slice(i + 1, end);
	};
	const version = field("version");
	if (version === undefined) {
		throw bad;
	}
	if (version !== "1.0") {
		throw new XmlError(`unsupported XML version "${version}"; only 1.0 is`);
	}
	const encoding = field("encoding");
	if (encoding !== undefined && !/^utf-8$/i.test(encoding)) {
		throw new XmlError(`unsupported encoding "${encoding}"; only UTF-8 is`);
	}
	const standalone = field("standalone");
	if (standalone !== undefined && standalone !== "yes" && standalone !== "no") {
		throw bad;
	}
	for (; pos < data.length; pos++) {
		if (!isSpaceCode(data.charCodeAt(pos))) {
			throw bad;
		}
	}
}

interface Frame {
	raw: string;
	name: XmlName;
	undo: { prefix: string; uri: string | undefined }[];
}

/** Reads tokens one at a time. Elements come back matched and nested, or it throws. */
export class XmlDecoder {
	private readonly src: string;
	private pos = 0;
	private readonly stack: Frame[] = [];
	private readonly ns = new Map<string, string>([["xml", xmlNamespace]]);
	private pending: XmlToken | undefined;
	private doneRoot = false;

	constructor(markup: string) {
		for (const ch of markup) {
			const code = ch.codePointAt(0)!;
			if (!isXmlChar(code)) {
				throw new XmlError(`U+${code.toString(16).toUpperCase().padStart(4, "0")} isn't an XML character`);
			}
		}
		this.src = markup.replace(/\r\n?/g, "\n");
	}

	/** The next token, or null once the document has ended properly. */
	token(): XmlToken | null {
		if (this.pending !== undefined) {
			const t = this.pending;
			this.pending = undefined;
			return t;
		}
		const src = this.src;
		if (this.pos >= src.length) {
			if (this.stack.length > 0) {
				throw new XmlError(endOfMarkup);
			}
			return null;
		}
		if (src[this.pos] !== "<") {
			return this.text();
		}
		if (src.startsWith("</", this.pos)) {
			return this.endTag();
		}
		if (src.startsWith("<?", this.pos)) {
			return this.instruction();
		}
		if (src.startsWith("<!--", this.pos)) {
			return this.comment();
		}
		if (src.startsWith("<![CDATA[", this.pos)) {
			return this.cdata();
		}
		if (src.startsWith("<!", this.pos)) {
			// A directive is always refused, so there's no need to find where it ends.
			this.pos = src.length;
			return { type: "directive" };
		}
		return this.startTag();
	}

	/** Reads character data, which outside the root can only be whitespace. */
	private text(): XmlToken {
		const src = this.src;
		let out = "";
		while (this.pos < src.length && src[this.pos] !== "<") {
			const c = src[this.pos]!;
			if (c === "&") {
				if (this.stack.length === 0) {
					throw new XmlError("a character reference can't appear outside the root");
				}
				out += this.reference();
			} else if (c === "]" && src.startsWith("]]>", this.pos)) {
				throw new XmlError("]]> can't appear in text");
			} else {
				out += c;
				this.pos++;
			}
		}
		return { type: "text", data: out };
	}

	private cdata(): XmlToken {
		if (this.stack.length === 0) {
			throw new XmlError("a CDATA section can't appear outside the root");
		}
		const start = this.pos + "<![CDATA[".length;
		const end = this.src.indexOf("]]>", start);
		if (end < 0) {
			throw new XmlError(endOfMarkup);
		}
		this.pos = end + "]]>".length;
		return { type: "text", data: this.src.slice(start, end) };
	}

	private comment(): XmlToken {
		const start = this.pos + "<!--".length;
		const end = this.src.indexOf("--", start);
		if (end < 0) {
			throw new XmlError(endOfMarkup);
		}
		if (!this.src.startsWith("-->", end)) {
			throw new XmlError('"--" can\'t appear in a comment');
		}
		this.pos = end + "-->".length;
		return { type: "other" };
	}

	private instruction(): XmlToken {
		const begin = this.pos;
		this.pos += "<?".length;
		let target: string;
		try {
			target = this.name();
		} catch {
			throw new XmlError("expected a target after <?");
		}
		const end = this.src.indexOf("?>", this.pos);
		if (end < 0) {
			throw new XmlError(endOfMarkup);
		}
		const data = this.src.slice(this.pos, end);
		if (data !== "" && !isSpaceCode(data.charCodeAt(0))) {
			throw new XmlError("a processing instruction's target needs a space after it");
		}
		this.pos = end + "?>".length;
		if (/^xml$/i.test(target)) {
			if (begin !== 0 || target !== "xml") {
				throw new XmlError("an XML declaration can only come first");
			}
			checkDeclaration(data);
		} else if (target.includes(":")) {
			throw new XmlError("a processing instruction's target can't have a colon");
		}
		return { type: "other" };
	}

	/** Reads an XML 1.0 Name. */
	private name(): string {
		const src = this.src;
		const start = this.pos;
		while (this.pos < src.length) {
			const c = src.codePointAt(this.pos)!;
			if (this.pos === start ? !isNameStart(c) : !isNameChar(c)) {
				break;
			}
			this.pos += c > 0xffff ? 2 : 1;
		}
		if (this.pos === start) {
			throw new XmlError("expected a name");
		}
		return src.slice(start, this.pos);
	}

	private space(): boolean {
		const start = this.pos;
		while (this.pos < this.src.length && isSpaceCode(this.src.charCodeAt(this.pos))) {
			this.pos++;
		}
		return this.pos > start;
	}

	private endTag(): XmlToken {
		this.pos += "</".length;
		let raw: string;
		try {
			raw = this.name();
		} catch {
			throw new XmlError("expected a name after </");
		}
		this.space();
		if (this.pos >= this.src.length) {
			throw new XmlError(endOfMarkup);
		}
		if (this.src[this.pos] !== ">") {
			throw new XmlError(`unexpected characters in </${raw}>`);
		}
		this.pos++;
		const top = this.stack.at(-1);
		if (top === undefined) {
			throw new XmlError(`</${raw}> closes nothing`);
		}
		if (top.raw !== raw) {
			throw new XmlError(`<${top.raw}> is closed by </${raw}>`);
		}
		return this.closeElement();
	}

	private closeElement(): XmlToken {
		const top = this.stack.pop()!;
		for (let i = top.undo.length - 1; i >= 0; i--) {
			const u = top.undo[i]!;
			if (u.uri !== undefined) {
				this.ns.set(u.prefix, u.uri);
			} else {
				this.ns.delete(u.prefix);
			}
		}
		if (this.stack.length === 0) {
			this.doneRoot = true;
		}
		return { type: "end", name: top.name };
	}

	private startTag(): XmlToken {
		this.pos++;
		let raw: string;
		try {
			raw = this.name();
		} catch {
			throw new XmlError("expected a name after <");
		}
		if (this.doneRoot) {
			throw new XmlError("markup can only have one root element");
		}
		const given: { name: string; value: string }[] = [];
		const seen = new Set<string>();
		let selfClosing = false;
		for (;;) {
			const spaced = this.space();
			if (this.pos >= this.src.length) {
				throw new XmlError(endOfMarkup);
			}
			const c = this.src[this.pos];
			if (c === ">") {
				this.pos++;
				break;
			}
			if (c === "/") {
				if (!this.src.startsWith("/>", this.pos)) {
					throw new XmlError("expected /> in an element");
				}
				this.pos += "/>".length;
				selfClosing = true;
				break;
			}
			if (!spaced) {
				throw new XmlError(`<${raw}> needs a space before each attribute`);
			}
			let name: string;
			try {
				name = this.name();
			} catch {
				throw new XmlError(`expected an attribute name in <${raw}>`);
			}
			if (seen.has(name)) {
				throw new XmlError(`attribute "${name}" is repeated`);
			}
			seen.add(name);
			this.space();
			if (this.src[this.pos] !== "=") {
				throw new XmlError(`attribute "${name}" has no value`);
			}
			this.pos++;
			this.space();
			given.push({ name, value: this.attrValue() });
		}
		const frame: Frame = { raw, name: { space: "", local: "" }, undo: [] };
		// Declarations apply to the element they're on, so they're read first.
		for (const a of given) {
			this.declare(a.name, a.value, frame);
		}
		const [prefix, local] = splitQName(raw);
		if (prefix === "xmlns") {
			throw new XmlError("an element can't use the xmlns prefix");
		}
		const space = this.ns.get(prefix) ?? "";
		if (prefix !== "" && space === "") {
			throw new XmlError(`prefix "${prefix}" isn't declared`);
		}
		frame.name = { space, local };
		const attrs: XmlAttr[] = [];
		const expanded = new Set<string>();
		for (const a of given) {
			if (a.name === "xmlns" || a.name.startsWith("xmlns:")) {
				continue;
			}
			const [aPrefix, aLocal] = splitQName(a.name);
			let aSpace = "";
			if (aPrefix !== "") {
				aSpace = this.ns.get(aPrefix) ?? "";
				if (aSpace === "") {
					throw new XmlError(`prefix "${aPrefix}" isn't declared`);
				}
			}
			const key = `${aSpace} ${aLocal}`;
			if (expanded.has(key)) {
				throw new XmlError(`attribute "${a.name}" is repeated`);
			}
			expanded.add(key);
			attrs.push({ name: { space: aSpace, local: aLocal }, value: a.value });
		}
		this.stack.push(frame);
		if (selfClosing) {
			this.pending = this.closeElement();
		}
		return { type: "start", name: frame.name, attrs, raw, given };
	}

	/** Applies a namespace declaration, if an attribute is one. */
	private declare(name: string, value: string, frame: Frame): void {
		let prefix = "";
		if (name.startsWith("xmlns:")) {
			splitQName(name);
			prefix = name.slice("xmlns:".length);
			if (prefix === "xmlns") {
				throw new XmlError("the xmlns prefix can't be declared");
			}
			if (value === "") {
				throw new XmlError(`prefix "${prefix}" can't be undeclared`);
			}
		} else if (name !== "xmlns") {
			return;
		}
		if ((prefix === "xml") !== (value === xmlNamespace) || value === xmlnsNamespace) {
			throw new XmlError(`namespace "${value}" can't be bound to that prefix`);
		}
		frame.undo.push({ prefix, uri: this.ns.get(prefix) });
		this.ns.set(prefix, value);
	}

	/** Reads a quoted value, turning literal whitespace into spaces as XML says. */
	private attrValue(): string {
		const src = this.src;
		const quote = src[this.pos];
		if (quote !== '"' && quote !== "'") {
			throw new XmlError("an attribute's value needs quotes");
		}
		this.pos++;
		let out = "";
		for (;;) {
			if (this.pos >= src.length) {
				throw new XmlError(endOfMarkup);
			}
			const c = src[this.pos]!;
			if (c === quote) {
				this.pos++;
				return out;
			}
			if (c === "<") {
				throw new XmlError("< can't appear in an attribute's value");
			}
			if (c === "&") {
				out += this.reference();
			} else {
				out += c === "\t" || c === "\n" || c === "\r" ? " " : c;
				this.pos++;
			}
		}
	}

	/** Reads one of XML's five named entities, or a reference to a character. */
	private reference(): string {
		const end = this.src.indexOf(";", this.pos);
		if (end < 0) {
			throw new XmlError("& needs to begin a reference ending in ;");
		}
		const body = this.src.slice(this.pos + 1, end);
		this.pos = end + 1;
		const named = entities.get(body);
		if (named !== undefined) {
			return named;
		}
		const m = /^#(?:x([0-9a-fA-F]+)|([0-9]+))$/.exec(body);
		if (m === null) {
			throw new XmlError(body.startsWith("#") ? `invalid reference &${body};` : `unknown entity &${body};`);
		}
		const code = m[1] !== undefined ? parseInt(m[1], 16) : parseInt(m[2]!, 10);
		if (!isXmlChar(code)) {
			throw new XmlError(`invalid reference &${body};`);
		}
		return String.fromCodePoint(code);
	}
}
