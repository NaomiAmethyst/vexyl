// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Inline SVG is the one place where a document can carry another format's markup. Everything here
// is an allowlist, and the output is written afresh from what passed, so nothing the parser saw
// reaches a page except by being copied here on purpose.

import { asciiLower, decimalValue, decimalForm, esc, trimSpace } from "./text.js";
import type { EmbeddedSvg } from "./types.js";
import { svgNamespace, xlinkNamespace, XmlDecoder, XmlError, type XmlAttr } from "./xml.js";

export const maxSvgDepth = 64;

/**
 * Stands in for an ID's prefix in sanitized markup until it's drawn. It can't appear in XML, so it
 * can't be confused with anything in the artwork.
 */
export const idMark = "\0";

export class SanitizeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SanitizeError";
	}
}

const allowedElements = new Set([
	"defs", "g", "path", "rect", "circle", "ellipse", "line", "polyline",
	"polygon", "linearGradient", "radialGradient", "stop", "clipPath", "mask",
]);

// These describe a file rather than draw it.
const droppedElements = new Set(["title", "desc", "metadata"]);

// These are allowed as attributes and in style attributes.
const presentationProps = new Set([
	"fill", "fill-opacity", "fill-rule", "stroke", "stroke-width",
	"stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
	"stroke-dasharray", "stroke-dashoffset", "opacity", "clip-path", "clip-rule", "mask",
	"stop-color", "stop-opacity", "color", "display", "visibility", "paint-order",
	"vector-effect", "shape-rendering", "mix-blend-mode", "isolation",
]);

const allowedAttrs = new Set([
	"id", "transform", "d", "x", "y", "width", "height", "cx", "cy",
	"r", "rx", "ry", "x1", "y1", "x2", "y2", "points", "offset", "fx", "fy", "fr",
	"gradientUnits", "gradientTransform", "spreadMethod", "clipPathUnits", "maskUnits",
	"maskContentUnits", "style", "href",
]);

// These are consumed in working out the root's viewBox, or are replaced when it's placed.
const rootOnlyAttrs: ReadonlySet<string> = new Set([
	"id", "x", "y", "width", "height", "viewBox", "preserveAspectRatio", "version", "baseProfile",
]);

const noAttrs: ReadonlySet<string> = new Set();

// \s here is spelled out, because JavaScript's also matches Unicode spaces and the format's doesn't.
const space = "[\\t\\n\\f\\r ]";
const localId = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const colorFunction = /\b(?:[rR][gG][bB][aA]?|[hH][sS][lL][aA]?)\(/g;
const localUrl = new RegExp(`[uU][rR][lL]\\(${space}*["']?#([A-Za-z_][A-Za-z0-9_.:-]*)["']?${space}*\\)`, "g");
const separator = "[\\t\\n\\f\\r ,]+";
const viewBoxForm = new RegExp(`^${space}*(${decimalForm})${separator}(${decimalForm})${separator}(${decimalForm})${separator}(${decimalForm})${space}*$`);
const lengthForm = new RegExp(`^${space}*(${decimalForm})(?:px)?${space}*$`);

export function usesCurrentColor(e: EmbeddedSvg): boolean {
	return asciiLower(e.attrs + e.body).includes("currentcolor");
}

/** The sanitized artwork as one document, with its IDs as they were written. */
export function canonical(e: EmbeddedSvg): string {
	return `<svg xmlns="${svgNamespace}" viewBox="${esc(e.viewBox)}"${e.attrs}>${e.body}</svg>`.replaceAll(idMark, "");
}

/**
 * Checks inline SVG against the format's allowlist, and gives a copy with marks in place of its
 * IDs' prefixes, so that drawing it can make them unique. Anything drawn has to be on the allowlist
 * or the markup is refused, and only descriptive and foreign-namespace content is removed quietly.
 */
export function sanitizeSvg(markup: string): EmbeddedSvg {
	try {
		return sanitize(markup);
	} catch (e) {
		if (e instanceof XmlError) {
			throw new SanitizeError(`invalid SVG: ${e.message}`);
		}
		throw e;
	}
}

function sanitize(markup: string): EmbeddedSvg {
	const dec = new XmlDecoder(markup);
	const result: EmbeddedSvg = { viewBox: "", attrs: "", body: "" };
	const body: string[] = [];
	let depth = 0;
	let skip = 0;
	let sawRoot = false;
	let closedRoot = false;
	for (let t = dec.token(); t !== null; t = dec.token()) {
		switch (t.type) {
			case "directive":
				throw new SanitizeError("SVG can't contain a DOCTYPE or other directive");
			case "text":
				if (skip === 0 && trimSpace(t.data) !== "") {
					throw new SanitizeError("SVG can't contain text outside elements; convert any lettering to paths");
				}
				break;
			case "start": {
				if (skip > 0) {
					skip++;
					break;
				}
				if (closedRoot) {
					throw new SanitizeError("SVG must have a single root element");
				}
				if (!sawRoot) {
					sawRoot = true;
					if (t.name.space !== svgNamespace || t.name.local !== "svg") {
						throw new SanitizeError(`root must be <svg xmlns="${svgNamespace}">`);
					}
					readRoot(result, t.attrs);
					depth = 1;
					break;
				}
				if ((t.name.space !== svgNamespace && t.name.space !== "") || (t.name.space === svgNamespace && droppedElements.has(t.name.local))) {
					skip = 1;
					break;
				}
				if (t.name.space === "" || !allowedElements.has(t.name.local)) {
					throw new SanitizeError(`SVG element <${t.name.local}> isn't allowed`);
				}
				depth++;
				if (depth > maxSvgDepth) {
					throw new SanitizeError(`SVG is nested more than ${maxSvgDepth} levels deep`);
				}
				let attrs: string;
				try {
					attrs = cleanAttrs(t.attrs, noAttrs);
				} catch (e) {
					throw e instanceof SanitizeError ? new SanitizeError(`SVG element <${t.name.local}>: ${e.message}`) : e;
				}
				body.push("<" + t.name.local + attrs + ">");
				break;
			}
			case "end":
				if (skip > 0) {
					skip--;
					break;
				}
				depth--;
				if (depth === 0) {
					closedRoot = true;
					break;
				}
				body.push("</" + t.name.local + ">");
				break;
			default:
				// Comments and processing instructions don't reach the output.
				break;
		}
	}
	if (!sawRoot) {
		throw new SanitizeError("SVG has no root element");
	}
	result.body = body.join("");
	return result;
}

/** Works out the root's viewBox and keeps its other styling attributes. */
function readRoot(e: EmbeddedSvg, attrs: XmlAttr[]): void {
	let viewBox = "";
	let width = "";
	let height = "";
	for (const a of attrs) {
		if (a.name.space !== "") {
			continue;
		}
		switch (a.name.local) {
			case "viewBox":
				viewBox = a.value;
				break;
			case "width":
				width = a.value;
				break;
			case "height":
				height = a.value;
				break;
		}
	}
	if (viewBox !== "") {
		const m = viewBoxForm.exec(viewBox);
		if (m === null) {
			throw new SanitizeError(`SVG has an invalid viewBox "${viewBox}"`);
		}
		if (m.slice(1).some((part) => decimalValue(part) === undefined)) {
			throw new SanitizeError(`SVG has an invalid viewBox "${viewBox}"`);
		}
		if (Number(m[3]) <= 0 || Number(m[4]) <= 0) {
			throw new SanitizeError(`SVG viewBox "${viewBox}" has no area`);
		}
		e.viewBox = `${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
	} else {
		const wm = lengthForm.exec(width);
		const hm = lengthForm.exec(height);
		if (wm === null || hm === null) {
			throw new SanitizeError("SVG needs a viewBox, or a numeric width and height");
		}
		const w = decimalValue(wm[1]!);
		const h = decimalValue(hm[1]!);
		if (w === undefined || h === undefined || w <= 0 || h <= 0) {
			throw new SanitizeError("SVG's width and height must be positive");
		}
		e.viewBox = `0 0 ${wm[1]} ${hm[1]}`;
	}
	try {
		e.attrs = cleanAttrs(attrs, rootOnlyAttrs);
	} catch (err) {
		throw err instanceof SanitizeError ? new SanitizeError(`SVG root: ${err.message}`) : err;
	}
}

/** Checks attributes against the allowlist and writes them out. */
function cleanAttrs(attrs: XmlAttr[], ignored: ReadonlySet<string>): string {
	let out = "";
	let href = false;
	for (const a of attrs) {
		const name = a.name.local;
		if (a.name.space === xlinkNamespace && name === "href") {
			// Treated the same as the plain href it's equivalent to.
		} else if (a.name.space !== "") {
			// Editor data doesn't affect rendering.
			continue;
		} else if (ignored.has(name)) {
			continue;
		} else if (!allowedAttrs.has(name) && !presentationProps.has(name)) {
			throw new SanitizeError(`attribute "${name}" isn't allowed`);
		}
		if (name === "href") {
			if (href) {
				throw new SanitizeError('attribute "href" is repeated, since xlink:href means the same');
			}
			href = true;
		}
		out += ` ${name}="${cleanValue(name, a.value)}"`;
	}
	return out;
}

/** Gives a value escaped for writing out. */
function cleanValue(name: string, value: string): string {
	if (name === "id") {
		if (!localId.test(value)) {
			throw new SanitizeError(`invalid id "${value}"`);
		}
		return idMark + esc(value);
	}
	if (name === "href") {
		if (!value.startsWith("#") || !localId.test(value.slice(1))) {
			throw new SanitizeError(`href "${value}" must refer to an id in this SVG`);
		}
		return "#" + idMark + esc(value.slice(1));
	}
	if (name === "style") {
		return cleanStyle(value);
	}
	return presentationProps.has(name) ? cleanPresentation(value) : esc(value);
}

/**
 * Marks url(#id) references, and refuses every CSS function other than those and plain color
 * functions, since functions can load things.
 */
function cleanPresentation(value: string): string {
	const remaining = value.replace(localUrl, "").replace(colorFunction, "");
	if (remaining.includes("(")) {
		throw new SanitizeError(`"${value}" uses a function other than url(#id) or a color`);
	}
	let out = "";
	let last = 0;
	for (const m of value.matchAll(localUrl)) {
		out += esc(value.slice(last, m.index)) + "url(#" + idMark + esc(m[1]!) + ")";
		last = m.index + m[0].length;
	}
	return out + esc(value.slice(last));
}

/** Keeps a style's declarations in their order, since a later one can win. */
function cleanStyle(style: string): string {
	if (style.includes("\\") || style.includes("@") || style.includes("/*")) {
		throw new SanitizeError("style can't contain escapes, at-rules or comments");
	}
	const out: string[] = [];
	for (const decl of style.split(";")) {
		if (trimSpace(decl) === "") {
			continue;
		}
		const colon = decl.indexOf(":");
		const prop = asciiLower(trimSpace(colon < 0 ? decl : decl.slice(0, colon)));
		if (colon < 0 || !presentationProps.has(prop)) {
			throw new SanitizeError(`style property "${prop}" isn't allowed`);
		}
		out.push(prop + ":" + cleanPresentation(trimSpace(decl.slice(colon + 1))));
	}
	return out.join(";");
}
