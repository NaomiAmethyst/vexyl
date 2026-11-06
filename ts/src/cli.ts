#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

/// <reference types="node" />

import { readFileSync, writeFileSync } from "node:fs";
import { model, parse, svg, svgTree, validate, type Flag, type Options, type SvgElement } from "./index.js";

const usage = `usage:
  vexyl render [options] FILE   render a flag to SVG
  vexyl check [-json] FILE...   validate flags, with -json listing one file's problems
  vexyl model FILE              print a flag's parsed model as JSON
  vexyl tree [options] FILE     print a render as a tree of elements, as JSON

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

function render(args: string[], asTree: boolean): void {
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
		if (!renderFlags.has(name)) {
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
	const files = args.slice(i);
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
	const out = asTree ? JSON.stringify(treeJson(svgTree(doc, opts))) + "\n" : svg(doc, opts);
	const output = given.get("o");
	if (output) {
		writeFileSync(output, out);
	} else {
		process.stdout.write(out);
	}
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
