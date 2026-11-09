#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

/// <reference types="node" />

import { readFileSync, writeFileSync } from "node:fs";
import { constructionSvg, layerAt, locate, model, parse, shareDecode, shareEncode, svg, svgTree, validate, type ConstructionOptions, type Flag, type Options, type SvgElement } from "./index.js";

const usage = `usage:
  vexyl render [options] FILE   render a flag to SVG
  vexyl check [-json] FILE...   validate flags, with -json listing one file's problems
  vexyl model FILE              print a flag's parsed model as JSON
  vexyl tree [options] FILE     print a render as a tree of elements, as JSON
  vexyl construct [options] FILE
                                draw a flag's construction sheet, with its sizes
                                marked, as SVG
  vexyl locate [-line N] FILE   print where each layer and part of a document is, as JSON,
                                or just what's innermost at a line
  vexyl share encode FILE       print a document as a share link's part after its #
  vexyl share decode FILE       print the document in a file holding that part

render options:
  -o FILE         write to a file instead of standard output
  -height PIXELS  the image's height
  -ratio H:F      another proportion, by the flag's adapt rules, written hoist
                  then fly, such as 1:2
  -variant NAME   one of the flag's variants, such as vertical or banner
  -side SIDE      obverse or reverse
  -fit FIT        error, the default, or pad with transparency if the flag
                  can't reach the ratio
  -align WHERE    place a padded flag: left, top or start; center; or right,
                  bottom or end
  -fold NAME      show one of the flag's folds
  -fold-step N    stop the fold after N steps
  -id-prefix TEXT start every ID in the output with this
  -tags           mark each drawn element with the layer that drew it

construct options:
  -o FILE         write to a file instead of standard output
  -units UNITS    grid, the default, for grid units as the file gives them;
                  hoist, for parts of the hoist; or mm, for millimetres
  -hoist-mm MM    the hoist in millimetres, for -units mm, by default 1000
  -theme THEME    paper, the default, for black on white, or dark
  -paper PAPER    a4, the default, or letter, both landscape, or fit, for a
                  sheet just the size of the drawing
  -variant NAME   one of the flag's variants, such as vertical or banner
  -side SIDE      obverse or reverse
  -no-sizes       leave out the sizes of the flag and its parts
  -no-positions   leave out where each charge is
  -no-colors      leave out the colour key
  -grid           draw the construction grid over the flag
  -path TEXT      where the file is, such as flags/country/chile.kdl, for the
                  footer
  -tier TEXT      the file's evidence tier, for the footer
  -id-prefix TEXT start every ID in the output with this

FILE can be - for standard input.
`;

const alignments: ReadonlyMap<string, Options["align"]> = new Map([
	["left", "start"],
	["top", "start"],
	["start", "start"],
	["center", "center"],
	["right", "end"],
	["bottom", "end"],
	["end", "end"],
]);

const renderFlags = new Set(["o", "height", "ratio", "variant", "side", "fit", "align", "fold", "fold-step", "id-prefix"]);
const renderSwitches = new Set(["tags"]);

/** Reads the source as UTF-8, refusing anything that isn't rather than replacing it. */
function readSource(path: string): string {
	const bytes = readFileSync(path === "-" ? 0 : path);
	return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

function load(path: string): Flag {
	return parse(readSource(path), path === "-" ? "<stdin>" : path);
}

/** Reads a hoist:fly proportion into fly over hoist. */
function parseRatio(text: string): number {
	const parts = text.split(":");
	const hoist = Number(parts[0]);
	const fly = Number(parts[1]);
	if (parts.length !== 2 || parts[0] === "" || parts[1] === "" || !(hoist > 0) || !(fly > 0) || !Number.isFinite(hoist) || !Number.isFinite(fly)) {
		throw new Error(`-ratio must look like 1:2, hoist then fly, got "${text}"`);
	}
	return fly / hoist;
}

/** Reads a command's options, up to its files: flags that take a value, and switches that don't. */
function readOptions(args: string[], flags: ReadonlySet<string>, switches: ReadonlySet<string>): { given: Map<string, string>; files: string[] } {
	const given = new Map<string, string>();
	let i = 0;
	for (; i < args.length; i++) {
		const arg = args[i]!;
		if (arg === "--") {
			i++;
			break;
		}
		if (!arg.startsWith("-") || arg === "-") {
			break;
		}
		const body = arg.replace(/^--?/, "");
		const equals = body.indexOf("=");
		const name = equals < 0 ? body : body.slice(0, equals);
		if (switches.has(name) && equals < 0) {
			given.set(name, "");
			continue;
		}
		if (!flags.has(name)) {
			throw new Error(`unknown flag ${arg}\n${usage}`);
		}
		if (equals >= 0) {
			given.set(name, body.slice(equals + 1));
		} else if (i + 1 < args.length) {
			given.set(name, args[++i]!);
		} else {
			throw new Error(`flag needs an argument: ${arg}\n${usage}`);
		}
	}
	return { given, files: args.slice(i) };
}

/** Writes a command's output to the file `-o` names, or to standard output. */
function emit(given: ReadonlyMap<string, string>, out: string): void {
	const output = given.get("o");
	if (output) {
		writeFileSync(output, out);
	} else {
		process.stdout.write(out);
	}
}

function render(args: string[], asTree: boolean): void {
	const { given, files } = readOptions(args, renderFlags, renderSwitches);
	if (files.length !== 1) {
		throw new Error(`render needs one file\n${usage}`);
	}
	const doc = load(files[0]!);
	const opts: Options = {};
	const height = given.get("height");
	if (height !== undefined) {
		opts.height = Number(height);
		if (!(opts.height > 0)) {
			throw new Error("-height must be positive");
		}
	}
	const ratio = given.get("ratio");
	if (ratio) {
		opts.ratio = parseRatio(ratio);
	}
	const variant = given.get("variant");
	if (variant) {
		opts.variant = variant;
	}
	const side = given.get("side");
	if (side) {
		opts.side = side as Options["side"];
	}
	const fit = given.get("fit");
	if (fit) {
		opts.fit = fit as Options["fit"];
	}
	const align = given.get("align");
	if (align) {
		const where = alignments.get(align);
		if (where === undefined) {
			throw new Error(`-align must be left, right, top, bottom or center, got "${align}"`);
		}
		opts.align = where;
	}
	const fold = given.get("fold");
	if (fold) {
		opts.fold = fold;
	}
	const foldStep = given.get("fold-step");
	if (foldStep !== undefined) {
		opts.foldStep = foldStep === "" ? NaN : Number(foldStep);
	}
	const idPrefix = given.get("id-prefix");
	if (idPrefix) {
		opts.idPrefix = idPrefix;
	}
	if (given.has("tags")) {
		opts.tags = true;
	}
	emit(given, asTree ? JSON.stringify(treeJson(svgTree(doc, opts))) + "\n" : svg(doc, opts));
}

const constructFlags = new Set(["o", "units", "hoist-mm", "theme", "paper", "variant", "side", "path", "tier", "id-prefix"]);
const constructSwitches = new Set(["no-sizes", "no-positions", "no-colors", "grid"]);

/** An option that's one of a few words, or absent, refusing any other. */
function oneOf<T extends string>(given: ReadonlyMap<string, string>, name: string, words: readonly T[]): T | undefined {
	const value = given.get(name);
	if (value === undefined) {
		return undefined;
	}
	if (!(words as readonly string[]).includes(value)) {
		throw new Error(`-${name} must be ${words.slice(0, -1).join(", ")} or ${words.at(-1)!}, got "${value}"`);
	}
	return value as T;
}

function construct(args: string[]): void {
	const { given, files } = readOptions(args, constructFlags, constructSwitches);
	if (files.length !== 1) {
		throw new Error(`construct needs one file\n${usage}`);
	}
	const doc = load(files[0]!);
	const opts: ConstructionOptions = {};
	const units = oneOf(given, "units", ["grid", "hoist", "mm"] as const);
	if (units !== undefined) {
		opts.units = units;
	}
	const hoistMm = given.get("hoist-mm");
	if (hoistMm !== undefined) {
		if (units !== "mm") {
			throw new Error("-hoist-mm goes with -units mm");
		}
		opts.hoistMm = hoistMm === "" ? NaN : Number(hoistMm);
		if (!(opts.hoistMm > 0 && Number.isFinite(opts.hoistMm))) {
			throw new Error("-hoist-mm must be positive");
		}
	}
	const theme = oneOf(given, "theme", ["paper", "dark"] as const);
	if (theme !== undefined) {
		opts.theme = theme;
	}
	const paper = oneOf(given, "paper", ["a4", "letter", "fit"] as const);
	if (paper !== undefined) {
		opts.paper = paper;
	}
	const variant = given.get("variant");
	const side = oneOf(given, "side", ["obverse", "reverse"] as const);
	if (variant || side !== undefined) {
		opts.form = { ...(variant ? { variant } : {}), ...(side !== undefined ? { side } : {}) };
	}
	if (given.has("no-sizes")) {
		opts.sizes = false;
	}
	if (given.has("no-positions")) {
		opts.positions = false;
	}
	if (given.has("no-colors")) {
		opts.colors = false;
	}
	if (given.has("grid")) {
		opts.grid = true;
	}
	for (const [name, key] of [["path", "path"], ["tier", "tier"], ["id-prefix", "idPrefix"]] as const) {
		const value = given.get(name);
		if (value) {
			opts[key] = value;
		}
	}
	emit(given, constructionSvg(doc, opts));
}

function treeJson(e: SvgElement): unknown {
	return { ...e, children: e.children.map(treeJson) };
}

function run(args: string[]): void {
	switch (args[0]) {
		case "render":
			render(args.slice(1), false);
			return;
		case "tree":
			render(args.slice(1), true);
			return;
		case "construct":
			construct(args.slice(1));
			return;
		case "check": {
			if (args[1] === "-json") {
				if (args.length !== 3) {
					throw new Error(`check -json needs one file\n${usage}`);
				}
				const problems = validate(readSource(args[2]!));
				process.stdout.write(JSON.stringify(problems, null, 1) + "\n");
				if (problems.length > 0) {
					throw new Error(`${problems.length} problems`);
				}
				return;
			}
			const paths = args.slice(1);
			if (paths.length === 0) {
				throw new Error(`check needs at least one file\n${usage}`);
			}
			let failed = 0;
			for (const path of paths) {
				try {
					load(path);
				} catch (e) {
					process.stderr.write((e as Error).message + "\n");
					failed++;
				}
			}
			if (failed > 0) {
				throw new Error(`${failed} of ${paths.length} files failed`);
			}
			return;
		}
		case "locate": {
			if (args[1] === "-line" && args.length === 4) {
				const spans = locate(readSource(args[3]!));
				process.stdout.write(JSON.stringify(layerAt(spans, Number(args[2])) ?? null) + "\n");
				return;
			}
			if (args.length !== 2) {
				throw new Error(`locate needs one file\n${usage}`);
			}
			process.stdout.write(JSON.stringify(locate(readSource(args[1]!))) + "\n");
			return;
		}
		case "share": {
			if (args.length !== 3 || (args[1] !== "encode" && args[1] !== "decode")) {
				throw new Error(`share needs encode or decode, and one file\n${usage}`);
			}
			const text = readSource(args[2]!);
			process.stdout.write(args[1] === "encode" ? shareEncode(text) + "\n" : shareDecode(text.replace(/\n+$/, "")));
			return;
		}
		case "model":
			if (args.length !== 2) {
				throw new Error(`model needs one file\n${usage}`);
			}
			process.stdout.write(JSON.stringify(model(load(args[1]!)), null, 1) + "\n");
			return;
		case "help":
		case "-h":
		case "--help":
			process.stdout.write(usage);
			return;
		case undefined:
			throw new Error(usage);
		default:
			throw new Error(`unknown command "${args[0]}"\n${usage}`);
	}
}

try {
	run(process.argv.slice(2));
} catch (e) {
	process.stderr.write((e as Error).message + "\n");
	process.exitCode = 1;
}
