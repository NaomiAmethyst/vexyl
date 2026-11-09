// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// The command, run as a reader would run it, from the build that `npm test` makes first.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { constructionSvg, parse } from "../src/index.js";
import { readRepo, root } from "./helpers.js";

const cli = join(root, "ts/dist/cli.js");
const chile = join(root, "ts/test/testdata/construction/chile.kdl");
const unitedStates = join(root, "flags/united-states.kdl");

/** Runs the command, with what it writes and whether it failed. */
function run(args: string[], input?: string): { out: string; err: string; status: number } {
	const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", ...(input !== undefined ? { input } : {}) });
	return { out: r.stdout, err: r.stderr, status: r.status ?? -1 };
}

test("construct writes the sheet the library draws, to standard output", () => {
	const r = run(["construct", chile]);
	assert.equal(r.status, 0, r.err);
	assert.equal(r.out, constructionSvg(parse(readFileSync(chile, "utf8"), chile)));
	assert.ok(r.out.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm"'));
});

test("construct writes to a file, and reads standard input", () => {
	const dir = mkdtempSync(join(tmpdir(), "vexyl-cli-"));
	try {
		const path = join(dir, "sheet.svg");
		const r = run(["construct", "-o", path, chile]);
		assert.equal(r.status, 0, r.err);
		assert.equal(r.out, "", "nothing on standard output");
		assert.match(readFileSync(path, "utf8"), /<title>Chile: construction sheet<\/title>/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	const r = run(["construct", "-"], readFileSync(chile, "utf8"));
	assert.equal(r.status, 0, r.err);
	assert.match(r.out, /<title>Chile: construction sheet<\/title>/);
});

test("construct's options are the library's", () => {
	const flag = parse(readFileSync(chile, "utf8"));
	const cases: [string[], Parameters<typeof constructionSvg>[1]][] = [
		[["-units", "hoist"], { units: "hoist" }],
		[["-units", "mm", "-hoist-mm", "1200"], { units: "mm", hoistMm: 1200 }],
		[["-units=mm", "-hoist-mm=900"], { units: "mm", hoistMm: 900 }],
		[["-theme", "dark", "-paper", "letter"], { theme: "dark", paper: "letter" }],
		[["-paper", "fit", "-grid", "-no-colors"], { paper: "fit", grid: true, colors: false }],
		[["-no-sizes", "-no-positions"], { sizes: false, positions: false }],
		[["-variant", "vertical", "-side", "reverse"], { form: { variant: "vertical", side: "reverse" } }],
		[["-side", "reverse"], { form: { side: "reverse" } }],
		[["-path", "flags/country/chile.kdl", "-tier", "A"], { path: "flags/country/chile.kdl", tier: "A" }],
		[["-id-prefix", "mine-"], { idPrefix: "mine-" }],
	];
	for (const [args, opts] of cases) {
		const r = run(["construct", ...args, chile]);
		assert.equal(r.status, 0, `${args.join(" ")}: ${r.err}`);
		assert.equal(r.out, constructionSvg(flag, opts), args.join(" "));
	}
	const footer = run(["construct", "-path", "flags/country/chile.kdl", "-tier", "A", chile]).out;
	assert.ok(footer.includes(">flags/country/chile.kdl · tier A · Vexyl 1<"), "the footer says where the file is");
	const us = run(["construct", "-variant", "vertical", unitedStates]);
	assert.equal(us.out, constructionSvg(parse(readRepo("flags/united-states.kdl")), { form: { variant: "vertical" } }));
});

test("construct refuses what it can't do, and says why", () => {
	const cases: [string[], RegExp][] = [
		[["construct"], /construct needs one file/],
		[["construct", chile, chile], /construct needs one file/],
		[["construct", "-units", "inches", chile], /-units must be grid, hoist or mm, got "inches"/],
		[["construct", "-hoist-mm", "900", chile], /-hoist-mm goes with -units mm/],
		[["construct", "-units", "mm", "-hoist-mm", "0", chile], /-hoist-mm must be positive/],
		[["construct", "-units", "mm", "-hoist-mm", "wide", chile], /-hoist-mm must be positive/],
		[["construct", "-theme", "light", chile], /-theme must be paper or dark/],
		[["construct", "-paper", "a3", chile], /-paper must be a4, letter or fit/],
		[["construct", "-side", "edge", chile], /-side must be obverse or reverse/],
		[["construct", "-variant", "nope", chile], /no variant/],
		[["construct", "-height", "100", chile], /unknown flag -height/],
		[["construct", "-units"], /flag needs an argument: -units/],
		[["construct", "no-such.kdl"], /no-such\.kdl/],
	];
	for (const [args, want] of cases) {
		const r = run(args);
		assert.equal(r.status, 1, args.join(" "));
		assert.equal(r.out, "", args.join(" "));
		assert.match(r.err, want, args.join(" "));
	}
});

test("the help lists construct and its options", () => {
	const r = run(["help"]);
	assert.equal(r.status, 0);
	for (const want of ["vexyl construct [options] FILE", "construct options:", "-hoist-mm MM", "-no-colors", "-tier TEXT"]) {
		assert.ok(r.out.includes(want), want);
	}
});
