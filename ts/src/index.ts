// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

/**
 * Vexyl describes a flag the way a flag specification does. This library reads a document and
 * renders it to SVG, and it runs anywhere JavaScript does: it never reads the network or the
 * filesystem, because a document is self-contained.
 */

import { read } from "./parse.js";
import { ParseError, type Flag, type Problem } from "./types.js";

export { formatVersion } from "./parse.js";
export { model, type Plain } from "./model.js";
export { svg, svgTree, treeToSvg } from "./svg.js";
// Beyond the SDK: a flag's construction sheet, with its sizes marked.
export { constructionSvg, sheetFaces, type ConstructionOptions, type SheetFont, type SheetForm } from "./construction.js";
export { layerAt, locate, type Span } from "./locate.js";
export { decodePathName, encodePathName, parentPath, tagAttribute } from "./paths.js";
export { shareDecode, shareEncode, shareDictionary, shareMaxBytes, ShareError } from "./share.js";
export * from "./types.js";

/** Gives every problem in a document, or nothing if it's valid. */
export function validate(source: string, name?: string): Problem[] {
	return read(source, name).problems;
}

/** Reads a document. It throws a `ParseError` holding every problem found if there are any. */
export function parse(source: string, name?: string): Flag {
	const { flag, problems } = read(source, name);
	if (flag === undefined) {
		throw new ParseError(problems);
	}
	return flag;
}
