// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Construction sheets. Their goldens are rewritten by running the tests with VEXYL_UPDATE=1, after
// which the diff is what to review.

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { constructionSheet, gridText, hoistText, mmText, proportionText, type ConstructionOptions } from "../src/construction.js";
import { decimal, exactOf, fraction, over, placesOf, plus, readExact, sum, times } from "../src/exact.js";
import { constructionSvg, parse, type Flag } from "../src/index.js";
import { header, readRepo, root } from "./helpers.js";

const data = join(root, "ts/test/testdata/construction");
const flagFile = (name: string): string => (existsSync(join(data, `${name}.kdl`)) ? join("ts/test/testdata/construction", `${name}.kdl`) : `flags/${name}.kdl`);
const flagOf = (name: string): Flag => parse(readRepo(flagFile(name)));
const update = process.env["VEXYL_UPDATE"] === "1";

const golden = (file: string, out: string): void => {
	const path = join(data, "golden", file);
	if (update) {
		writeFileSync(path, out);
		return;
	}
	assert.equal(out, readFileSync(path, "utf8"), `${file} differs; VEXYL_UPDATE=1 rewrites it`);
};

const overlap = (a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }): number =>
	Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** Every label that overlaps another, crosses the flag's edge or leaves the sheet. */
function collisions(flag: Flag, opts: ConstructionOptions): string[] {
	const sheet = constructionSheet(flag, opts);
	const out: string[] = [];
	sheet.labels.forEach((a, i) => {
		if (a.x0 < 0 || a.y0 < 0 || a.x1 > sheet.width || a.y1 > sheet.height) {
			out.push(`off the sheet: ${a.text}`);
		}
		const inside = a.x0 >= sheet.flag.x0 && a.x1 <= sheet.flag.x1 && a.y0 >= sheet.flag.y0 && a.y1 <= sheet.flag.y1;
		if (a.onFlag ? !inside : overlap(a, sheet.flag) > 0.5) {
			out.push(`across the flag's edge: ${a.text}`);
		}
		for (const b of sheet.labels.slice(i + 1)) {
			if (overlap(a, b) > 0.5) {
				out.push(`${a.text} on ${b.text}`);
			}
		}
	});
	return out;
}

/** A sheet's text, with its wrapped lines run together. */
const textOf = (out: string): string => [...out.matchAll(/>([^<]*)<\/text>/g)].map((m) => m[1]).join(" ");

const fixtures = ["chile", "germany", "switzerland", "sweden", "jamaica", "bahamas", "united-states", "south-korea"];

test("golden sheets, Chile in both themes and every kind of unit", () => {
	const chile = flagOf("chile");
	for (const theme of ["paper", "dark"] as const) {
		for (const units of ["grid", "hoist", "mm"] as const) {
			golden(`chile-${theme}-${units}.svg`, constructionSvg(chile, { theme, units, hoistMm: 1200, path: "flags/country/chile.kdl", tier: "A" }));
		}
	}
	golden("chile-fit-letter.svg", constructionSvg(chile, { paper: "letter", grid: true, colors: false }));
	golden("chile-fit.svg", constructionSvg(chile, { paper: "fit", sizes: false }));
});

test("golden sheets, a flag of each kind", () => {
	for (const name of fixtures.slice(1)) {
		golden(`${name}.svg`, constructionSvg(flagOf(name), { path: flagFile(name) }));
	}
	golden("united-states-dark-hoist.svg", constructionSvg(flagOf("united-states"), { theme: "dark", units: "hoist" }));
});

test("no label on a fixture's sheet overlaps another or leaves the sheet", () => {
	for (const name of fixtures) {
		for (const opts of [{}, { units: "hoist" }, { units: "mm", hoistMm: 900 }, { paper: "letter" }, { paper: "fit", grid: true }] as ConstructionOptions[]) {
			assert.deepEqual(collisions(flagOf(name), opts), [], `${name} ${JSON.stringify(opts)}`);
		}
	}
});

test("a sheet is self-contained SVG, with nothing to run and nothing to fetch", () => {
	for (const name of fixtures) {
		for (const theme of ["paper", "dark"] as const) {
			const out = constructionSvg(flagOf(name), { theme });
			assert.ok(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm"'), name);
			assert.doesNotMatch(out, /<script|\bon[a-z]+=|href=|url\((?!#)|<image|<foreignObject|@import/i, name);
			assert.doesNotMatch(out, /rgba\(/, "opacity is its own attribute, which every renderer reads");
		}
	}
	const inline = parse(readRepo("go/testdata/inline-svg.kdl"));
	assert.doesNotMatch(constructionSvg(inline), /<script|\bon[a-z]+=|href="(?!#)/i);
});

test("every character set in Geist Mono is one it has", () => {
	// Geist Mono's Latin set: ASCII, Latin-1 and a few marks. It has no ≈, which is why rounding is ~.
	const has = /^[\x20-\x7e\u00a0-\u00ff’‘“”–—…]*$/;
	for (const name of fixtures) {
		for (const units of ["grid", "hoist", "mm"] as const) {
			const out = constructionSvg(flagOf(name), { units, path: flagFile(name) });
			for (const m of out.matchAll(/<text [^>]*font-family="Geist Mono[^"]*"[^>]*>([^<]*)<\/text>/g)) {
				assert.match(m[1]!, has, `${name} ${units}: ${m[1]}`);
			}
		}
	}
});

test("papers, and the units they're given in", () => {
	const chile = flagOf("chile");
	assert.match(constructionSvg(chile, { paper: "letter" }), /^<svg [^>]* width="279\.4mm" height="215\.9mm" viewBox="0 0 1056 816">/);
	const fit = constructionSheet(chile, { paper: "fit" });
	assert.ok(fit.width < 1400 && fit.height < 900 && fit.width > fit.height);
	const tall = parse(`${header.replace("hoist=10 fly=20", "hoist=40 fly=4")}field a\n`);
	const sheet = constructionSheet(tall, {});
	assert.ok(sheet.flag.y1 - sheet.flag.y0 > 400, "a tall flag fills the height");
	const wide = parse(`${header.replace("hoist=10 fly=20", "hoist=1 fly=30")}field a\nbars a b a { along hoist; ratio 1 28 1; }\n`);
	assert.deepEqual(collisions(wide, {}), []);
	assert.throws(() => constructionSvg(chile, { hoistMm: 0 }), RangeError);
});

test("what's measured, as the file writes it", () => {
	const chile = constructionSvg(flagOf("chile"));
	for (const want of [">6<", ">2<", ">4<", ">1<", ">r 0.5<", ">2:3 · grid 4 × 6<", "the vertical variant"]) {
		assert.ok(chile.includes(want), want);
	}
	const us = constructionSvg(flagOf("united-states"));
	assert.ok(textOf(us).includes("A ~ marks a size rounded to four places."));
	assert.ok(!textOf(constructionSvg(flagOf("chile"))).includes("~"));
	for (const want of [">24.7<", ">9.88<", ">14.82<", ">r 0.4004<", ">10:19 · grid 13 × 24.7<", "50 white stars on a grid of 9 rows by 11 columns", "the triangle fold"]) {
		assert.ok(us.includes(want), want);
	}
	const sweden = constructionSvg(flagOf("sweden"), { units: "mm", hoistMm: 1000 });
	for (const want of [">500<", ">200<", ">900<", ">400<", ">1600<"]) {
		assert.ok(sweden.includes(want), want);
	}
	const korea = constructionSvg(flagOf("south-korea"));
	assert.ok(textOf(korea).includes("Not measured on this sheet: the emblem along the bend, the emblem along the bend sinister."));
	const bahamas = constructionSvg(flagOf("bahamas"));
	assert.ok(textOf(bahamas).includes("Not measured on this sheet: the black pile."));
	const jamaica = constructionSvg(flagOf("jamaica"), { units: "hoist" });
	assert.ok(jamaica.includes(">H/6<"), "the saltire's width");
	const swiss = constructionSvg(flagOf("switzerland"));
	assert.ok(swiss.includes(">r 10 · width 6<") && swiss.includes(">16<"));
});

test("a bar from a ratio is an exact fraction of its hoist", () => {
	const flag = parse(`${header.replace("hoist=10 fly=20", "hoist=54 fly=81")}bars a b a b a { ratio 16 3 16 3 16; }\n`);
	const out = constructionSvg(flag);
	for (const want of [">16<", ">3<", ">54<", ">81<"]) {
		assert.ok(out.includes(want), want);
	}
	const thirds = parse(`${header.replace("hoist=10 fly=20", "hoist=7 fly=10")}bars a b a\n`);
	assert.ok(constructionSvg(thirds).includes(">7/3<"));
	assert.ok(constructionSvg(thirds, { units: "hoist" }).includes(">H/3<"));
	assert.ok(constructionSvg(thirds, { units: "mm", hoistMm: 700 }).includes(">233.3<"));
	// Written decimals add up exactly, where doubles wouldn't: 0.1 + 0.2 is 0.3.
	const decimals = parse(`${header.replace("hoist=10 fly=20", "hoist=0.3 fly=0.6")}bars a b { ratio 0.1 0.2; }\n`);
	const text = constructionSvg(decimals);
	assert.ok(text.includes(">0.1<") && text.includes(">0.2<") && text.includes(">0.3<"));
	assert.doesNotMatch(text, /0\.30000000000000004|0\.19999999/);
});

test("charges in a canton are measured from the flag's edges, and repeats say how they repeat", () => {
	const flag = parse(`${header}canton { fly 8; hoist 6; field a; charge disc b { radius 1; at fly=2 hoist=3; repeat line count=3 fly=2; } }
panel { side fly; width 4; charge star a { radius 1; } }
`);
	const out = constructionSvg(flag);
	assert.ok(out.includes(">2<") && out.includes(">3<"), "the first disc, from the hoist and the top");
	assert.ok(textOf(out).includes("3 b discs in a line, each 2 along the fly from the one before. The first is measured."));
	assert.ok(out.includes(">r 1<"));
	// The star is in the middle of a side panel 4 wide: 18 from the hoist, and 5 down.
	assert.ok(out.includes(">16<") && out.includes(">4<"));
	const sheet = constructionSheet(flag, { units: "grid" });
	assert.ok(sheet.labels.some((l) => l.text === "8"), "the canton's fly");
});

test("what isn't measured is listed, never left out", () => {
	const flag = parse(`${header}outline swallowtail { depth 4; }
field a
chevrons b { depth 5; }
band b { along bend; width 2; }
charge star b { radius 1; fimbriate a 0.1; cut { disc { radius 0.2; } } }
`);
	const out = constructionSvg(flag);
	assert.ok(textOf(out).includes("Not measured on this sheet: the chevrons, the b band along the bend, the cut in the b star, the b star’s fimbriation, the swallowtail outline."), out);
});

test("a crowded sheet still overlaps nothing, and says what it leaves out", () => {
	let layers = "field a\n";
	for (let i = 0; i < 40; i++) {
		layers += `charge disc b { radius 0.1; at fly=${(0.37 * i + 0.3).toFixed(2)} hoist=${((i * 7) % 10) + 0.25}; }\n`;
	}
	const flag = parse(header + layers);
	assert.deepEqual(collisions(flag, {}), []);
	assert.ok(constructionSvg(flag).includes("16 more charges, past the first 24"));
});

test("exact numbers", () => {
	assert.deepEqual(readExact("9.88"), fraction(247n, 25n));
	assert.deepEqual(readExact("1e-3"), fraction(1n, 1000n));
	assert.deepEqual(readExact("-1_000.5"), fraction(-2001n, 2n));
	assert.equal(readExact("x"), null);
	assert.deepEqual(exactOf(0.4004), fraction(1001n, 2500n));
	assert.deepEqual(plus(exactOf(0.1), exactOf(0.2)), fraction(3n, 10n));
	assert.deepEqual(sum([16, 3, 16, 3, 16].map(exactOf)), fraction(54n));
	assert.deepEqual(times(exactOf(54), over(exactOf(16), exactOf(54))), fraction(16n));
	assert.equal(placesOf(fraction(1n, 8n)), 3);
	assert.equal(placesOf(fraction(1n, 3n)), null);
	assert.equal(decimal(fraction(2n, 3n), 4), "0.6667");
	assert.equal(decimal(fraction(-1n, 2000n), 3), "-0.001");
	assert.equal(decimal(fraction(-1n, 3000n), 3), "0");
});

test("label formats", () => {
	const f = (n: bigint, d = 1n): ReturnType<typeof fraction> => fraction(n, d);
	assert.equal(gridText(f(988n, 100n)), "9.88");
	assert.equal(gridText(f(7n, 3n)), "7/3");
	assert.equal(gridText(f(247n, 300n)), "~0.8233");
	assert.equal(gridText(f(6n)), "6");
	assert.equal(hoistText(f(1n)), "H");
	assert.equal(hoistText(f(1n, 2n)), "H/2");
	assert.equal(hoistText(f(3n, 2n)), "3H/2");
	assert.equal(hoistText(f(1n, 48n)), "H/48");
	assert.equal(hoistText(f(19n, 25n)), "0.76H");
	assert.equal(hoistText(f(77n, 2500n)), "0.0308H");
	assert.equal(hoistText(f(247n, 3900n)), "19H/300");
	assert.equal(hoistText(f(2471n, 39000n)), "~0.0634H");
	assert.equal(mmText(f(1000n, 3n)), "333.3");
	assert.equal(mmText(f(25n, 3n)), "8.33");
	assert.equal(mmText(f(250n)), "250");
	assert.equal(proportionText(f(13n), f(247n, 10n)), "10:19");
	assert.equal(proportionText(f(2n), f(3n)), "2:3");
	assert.equal(proportionText(f(42333n, 100n), f(84667n, 100n)), "1:~2");
});
