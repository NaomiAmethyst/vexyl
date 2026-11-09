// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Construction sheets. Their goldens are rewritten by running the tests with VEXYL_UPDATE=1, after
// which the diff is what to review.

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { withRatioExactly } from "../src/adapt-exact.js";
import { withRatio } from "../src/adapt.js";
import { constructionSheet, gridText, hoistText, labelOverlap, mmText, proportionText, sheetValueProblems, valueProblem, type ConstructionOptions, type LabelBox } from "../src/construction.js";
import { decimal, exactOf, fraction, over, placesOf, plus, readExact, sum, times } from "../src/exact.js";
import { constructionSvg, parse, sheetFaces, type Flag, type SheetFont } from "../src/index.js";
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
			if (labelOverlap(a, b) > 0.5) {
				out.push(`${a.text} on ${b.text}`);
			}
		}
	});
	return out;
}

/** A sheet's text, with its wrapped lines run together. */
const textOf = (out: string): string => [...out.matchAll(/>([^<]*)<\/text>/g)].map((m) => m[1]).join(" ");

const fixtures = ["chile", "germany", "switzerland", "sweden", "jamaica", "bahamas", "united-states", "south-korea", "czech-republic", "south-africa", "chevrons-fly", "chevrons-top", "chevrons-bottom", "guyana", "kuwait", "pile-tip", "european-union", "venezuela", "bahrain", "shaped-edges"];

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

test("a sheet can carry its fonts, only the faces it uses, and still runs and fetches nothing", () => {
	// Not real fonts, but they start as a WOFF2 file does, which is all the library checks.
	const face = (family: string, weight: number, n: number): SheetFont => ({ family, weight, woff2: Uint8Array.from([0x77, 0x4f, 0x46, 0x32, ...Array.from({ length: n }, (_, i) => (i * 37 + weight) & 255)]) });
	const fonts = [...sheetFaces.map((f, i) => face(f.family, f.weight, 40 + i)), face("Geist", 700, 9), face("Other", 400, 9)];
	for (const name of fixtures) {
		for (const theme of ["paper", "dark"] as const) {
			const plain = constructionSvg(flagOf(name), { theme });
			const out = constructionSvg(flagOf(name), { theme, fonts });
			assert.doesNotMatch(plain, /@font-face|<style/, "nothing is embedded unless asked");
			const faces = [...out.matchAll(/@font-face\{font-family:"([^"]+)";font-style:normal;font-weight:([0-9]+);src:url\(data:font\/woff2;base64,([A-Za-z0-9+/]+=*)\) format\("woff2"\)\}/g)];
			assert.deepEqual(faces.map((m) => `${m[1]} ${m[2]}`), ["Geist 400", "Geist 500", "Geist Mono 400", "Geist Mono 500"], name);
			for (const m of faces) {
				const want = fonts.find((f) => `${f.family} ${f.weight}` === `${m[1]} ${m[2]}`)!;
				assert.deepEqual(Buffer.from(m[3]!, "base64"), Buffer.from(want.woff2));
			}
			// The same checks as a sheet without them, once the fonts themselves, which are data, are set aside.
			const rest = out.replace(/url\(data:font\/woff2;base64,[A-Za-z0-9+/]+=*\)/g, "");
			assert.doesNotMatch(rest, /<script|\bon[a-z]+=|href=|url\((?!#)|<image|<foreignObject|@import|data:/i, name);
			assert.equal(out.match(/<style>/g)?.length, 1);
			assert.equal(rest.replace(/\n<defs><style>[^<]*<\/style><\/defs>/, ""), plain, "and the sheet is otherwise the same");
		}
	}
	const chile = flagOf("chile");
	assert.match(constructionSvg(chile, { fonts }), /^<svg [^>]*>\n<title>[^<]*<\/title>\n<defs><style>@font-face/);
	assert.doesNotMatch(constructionSvg(chile, { fonts: [face("Other", 400, 9)] }), /<style/, "a face the sheet doesn't use is left out");
	assert.throws(() => constructionSvg(chile, { fonts: [{ family: "Geist", weight: 400, woff2: new TextEncoder().encode("@import url(https://example.com/x.css)") }] }), RangeError);
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
	for (const want of [">6<", ">2<", ">4<", ">1<", ">r 0.5<", ">2:3 · grid 4 × 6<", "The vertical variant has a sheet of its own."]) {
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
	assert.ok(textOf(korea).includes("Not measured on this sheet: the clip on the red disc."));
	const bahamas = constructionSvg(flagOf("bahamas"));
	assert.ok(textOf(bahamas).includes("The black pile stands on the hoist from 0 to 3, and reaches 2.6 in from it, to a point."));
	assert.doesNotMatch(textOf(bahamas), /Not measured/);
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

test("piles: their base along their edge, and their depth and end or their point", () => {
	// Guyana's two piles stand on the hoist a little in from its corners, and reach in to points.
	const guyana = constructionSheet(flagOf("guyana"), {});
	for (const want of ["1.044", "1.1662", "28.8338", "28.956", "23.0563"]) {
		assert.ok(guyana.labels.some((l) => l.text === want), want);
	}
	assert.ok(textOf(constructionSvg(flagOf("guyana"))).includes("The gold pile stands on the hoist from 1.044 to 28.956, and reaches 46.5199 in from it, to a point."));
	// Kuwait's is cut flat, 2 wide, 3 in: so 2, 2 and 2 down the hoist, and 3 along the fly.
	const kuwait = constructionSvg(flagOf("kuwait"));
	assert.ok(textOf(kuwait).includes("The black pile stands on the hoist from 0 to 6, and reaches 3 in from it, where its end is 2 wide."));
	assert.ok(kuwait.includes(">3<") && kuwait.includes(">9<"));
	const tips = constructionSheet(flagOf("pile-tip"), {});
	// From the top, 4 to 16 along, its point 12 along and 15 down; from the fly, 5 to 15 down, 8 in, at 22.
	for (const want of ["4", "8", "6", "5", "10"]) {
		assert.ok(tips.labels.some((l) => l.text === want), want);
	}
	const text = textOf(constructionSvg(flagOf("pile-tip")));
	assert.ok(text.includes("The blue pile stands on the top edge from 4 to 16, with its point 15 in from it and 12 along it."));
	assert.ok(text.includes("The red pile stands on the fly from 5 to 15, and reaches 8 in from it, to a point. It’s drawn as an outline 0.5 wide."));
});

test("palls: their junction and stem along the rows, and their arms' width across one", () => {
	const za = constructionSheet(flagOf("south-africa"), { units: "hoist" });
	// Arms 20 and 12 wide, a third and a fifth of the hoist, drawn on the flag.
	assert.ok(za.labels.some((l) => l.text === "H/3" && l.onFlag) && za.labels.some((l) => l.text === "H/5" && l.onFlag));
	// The junction is 45 in, and the stems' sides 20, 24, 36 and 40 down.
	const grid = constructionSvg(flagOf("south-africa"));
	assert.ok(grid.includes(">45<") && grid.includes(">20<") && grid.includes(">4<") && grid.includes(">6<"));
	assert.doesNotMatch(textOf(grid), /Not measured/);
	// With no room for the width on the flag, it goes in the notes.
	const tiny = constructionSvg(parse(`${header.replace("hoist=10 fly=20", "hoist=1 fly=30")}pall a { width 0.1; }\n`));
	assert.ok(textOf(tiny).includes("The a pall’s arms are 0.1 wide, measured across them.") || tiny.includes(">0.1<"));
});

/** Which sides of the flag the labels with some text are on, with "on" for any over it. */
function sideOfLabel(sheet: ReturnType<typeof constructionSheet>, text: string): string {
	const f = sheet.flag;
	const sides = sheet.labels.filter((l) => l.text === text).map((l) => (l.y1 <= f.y0 ? "top" : l.y0 >= f.y1 ? "bottom" : l.x1 <= f.x0 ? "left" : l.x0 >= f.x1 ? "right" : "on"));
	assert.ok(sides.length > 0, `no label ${text}`);
	return [...new Set(sides)].sort().join(" ");
}
test("golden sheets of other forms: turned, from behind, and upright", () => {
	const chile = flagOf("chile");
	golden("chile-vertical.svg", constructionSvg(chile, { form: { variant: "vertical" }, path: "flags/country/chile.kdl" }));
	golden("chile-reverse.svg", constructionSvg(chile, { form: { side: "reverse" }, units: "hoist" }));
	golden("chile-vertical-reverse-dark.svg", constructionSvg(chile, { form: { variant: "vertical", side: "reverse" }, theme: "dark" }));
	golden("united-states-vertical.svg", constructionSvg(flagOf("united-states"), { form: { variant: "vertical" } }));
	golden("germany-hanging.svg", constructionSvg(flagOf("germany"), { form: { variant: "hanging" }, paper: "fit" }));
});

test("a turned form is measured in the flag's own frame, and its rows turn with it", () => {
	const chile = flagOf("chile");
	// As it hangs, the hoist runs along the top, so the fly's 6 is down the left and the hoist's 4 across the top.
	const vertical = constructionSheet(chile, { form: { variant: "vertical" } });
	assert.equal(sideOfLabel(vertical, "6"), "left");
	assert.equal(sideOfLabel(vertical, "4"), "left top", "the hoist, and a part of the fly");
	assert.ok(vertical.svg.includes(">Chile · vertical<") && vertical.svg.includes("<title>Chile · vertical: construction sheet</title>"));
	assert.ok(vertical.flag.y1 - vertical.flag.y0 > vertical.flag.x1 - vertical.flag.x0, "it's drawn tall");
	// From behind, the hoist is on the right, and its row with it.
	const back = constructionSheet(chile, { form: { side: "reverse" } });
	assert.equal(sideOfLabel(back, "6"), "top");
	assert.equal(sideOfLabel(back, "4"), "right top");
	assert.ok(back.svg.includes(">Chile · reverse<"));
	// Every turn the format has, with the rows on the sides the flag's top and hoist turn to.
	const turns = flagOf("turns");
	const want: Record<string, [string, string]> = {
		rotate: ["right", "top"], counter: ["left", "bottom"], half: ["bottom", "right"], transpose: ["left", "top"], anti: ["right", "bottom"], invert: ["bottom", "left"], mirror: ["top", "right"],
	};
	for (const [variant, [fly, hoist]] of Object.entries(want)) {
		for (const side of ["obverse", "reverse"] as const) {
			const sheet = constructionSheet(turns, { form: { variant, side } });
			if (side === "obverse") {
				assert.equal(sideOfLabel(sheet, "16"), fly, `${variant}: the fly`);
				assert.equal(sideOfLabel(sheet, "10"), hoist, `${variant}: the hoist`);
			}
			assert.ok(sheet.labels.some((l) => l.text === "r 0.8"), `${variant} ${side}: the star's size`);
			for (const opts of [{}, { units: "hoist" }, { paper: "fit", grid: true }] as ConstructionOptions[]) {
				assert.deepEqual(collisions(turns, { ...opts, form: { variant, side } }), [], `${variant} ${side} ${JSON.stringify(opts)}`);
			}
		}
	}
	// A charge's centre mark is where the library draws it: the star in the turned flag's frame.
	const rotated = constructionSheet(turns, { form: { variant: "rotate" } });
	const f = rotated.flag;
	const scale = (f.x1 - f.x0) / 10;
	// The star is 5 along the fly and 3 down; turned clockwise, that's 10 - 3 across and 5 down.
	assert.ok(rotated.svg.includes(`M${(f.x0 + 7 * scale - 6).toFixed(6).replace(/\.?0+$/, "")} `), "its + is at the turned place");
	assert.throws(() => constructionSvg(chile, { form: { variant: "none-such" } }), /no variant/);
});

test("a form with a proportion of its own is measured on its own grid, and one that adapts, exactly", () => {
	// Guyana at sea: its own grid of 30 by 60, with its own piles.
	const guyana = flagOf("guyana");
	const sea = constructionSheet(guyana, { form: { variant: "sea" } });
	assert.ok(sea.svg.includes(">1:2 · grid 30 × 60<") && sea.labels.some((l) => l.text === "60"));
	assert.ok(textOf(sea.svg).includes("The gold pile stands on the hoist from 1.0308 to 28.9692, and reaches 55.8769 in from it, to a point."));
	assert.ok(textOf(constructionSvg(guyana)).includes("The sea variant has a sheet of its own."));
	golden("guyana-sea.svg", sea.svg);
	// Longer, by extending: the cross's fly end grows to 13, and the disc stays 2.5 from the hoist.
	const flag = flagOf("adapt");
	const long = constructionSheet(flag, { form: { variant: "long" } });
	for (const want of ["5", "2", "13", "20", "2.5"]) {
		assert.ok(long.labels.some((l) => l.text === want), want);
	}
	assert.ok(textOf(long.svg).includes("The long variant is the flag at a proportion of 2, by its rule for a wider flag, extend."));
	// Shorter, by scaling the hoist to 40/3: everything down it is a third longer, which no decimal says.
	const short = constructionSheet(flag, { form: { variant: "short" } });
	for (const want of ["16/3", "8/3", "40/3"]) {
		assert.ok(short.labels.some((l) => l.text === want), want);
	}
	assert.ok(short.svg.includes(">5:6 · grid 40/3 × 16<"));
	assert.ok(!textOf(short.svg).includes("~"), "nothing is rounded");
	const hoist = constructionSheet(flag, { form: { variant: "short" }, units: "hoist" });
	assert.ok(hoist.labels.some((l) => l.text === "2H/5") && hoist.labels.some((l) => l.text === "H/5"));
	// Turned as well as adapted.
	const hanging = constructionSheet(flag, { form: { variant: "hanging" } });
	assert.equal(sideOfLabel(hanging, "20"), "left");
	golden("adapt-short.svg", short.svg);
	for (const variant of ["long", "short", "hanging"]) {
		for (const side of ["obverse", "reverse"] as const) {
			for (const opts of [{}, { units: "hoist" }, { paper: "fit", grid: true }] as ConstructionOptions[]) {
				assert.deepEqual(collisions(flag, { ...opts, form: { variant, side } }), [], `${variant} ${side} ${JSON.stringify(opts)}`);
			}
		}
	}
});

test("adapting exactly gives what the library draws", () => {
	// Every number the exact adapter gives is the library's own, to within a double's error.
	const flag = flagOf("adapt");
	for (const ratio of [2, 1.2, 1.55]) {
		const drawn = withRatio(flag, ratio);
		const exact = withRatioExactly(flag, exactOf(ratio), false);
		const numbers = (f: Flag): number[] => JSON.stringify(f.layers, (_, v: unknown) => (v instanceof Number ? Number(v) : v)).match(/-?[0-9.]+(e-?[0-9]+)?/g)!.map(Number);
		const [a, b] = [numbers(drawn), numbers(exact)];
		assert.equal(a.length, b.length);
		a.forEach((x, i) => assert.ok(Math.abs(x - b[i]!) < 1e-9 * Math.max(1, Math.abs(x)), `${ratio}: ${x} and ${b[i]}`));
		assert.ok(Math.abs(Number(exact.fly) / Number(exact.hoist) - ratio) < 1e-12);
	}
});

/** The text set in a sheet's sidebar, which starts right of the drawing. */
const sidebarText = (sheet: ReturnType<typeof constructionSheet>): string[] => sheet.labels.filter((l) => l.x0 > sheet.flag.x1 + 10).map((l) => l.text);

test("a repeated charge's first copies are enlarged in the sidebar, with their steps exactly", () => {
	// The US's stars: the grid's corner, with steps of 0.7 down and 9.88/12 along, which no decimal says.
	const us = constructionSheet(flagOf("united-states"), {});
	const side = sidebarText(us);
	assert.ok(side.includes("DETAIL: WHITE STARS"));
	assert.equal(side.filter((x) => x === "9.88/12").length, 2, "the margin and a column");
	assert.equal(side.filter((x) => x === "0.7").length, 2, "the margin and a row");
	assert.ok(textOf(us.svg).includes("its rows are 0.7 apart and its columns 9.88/12, and so are its margins. Each is r 0.4004."));
	assert.ok(sidebarText(constructionSheet(flagOf("united-states"), { units: "hoist" })).includes("19H/300"), "hoists say it exactly anyway");
	// Hung vertically, the corner turns with the flag: the columns' steps run down.
	const vertical = constructionSheet(flagOf("united-states"), { form: { variant: "vertical" } });
	const steps = vertical.labels.filter((l) => l.text === "9.88/12");
	assert.equal(steps.length, 2);
	assert.ok(steps.every((l) => l.y1 - l.y0 > l.x1 - l.x0), "set down the side");
	// The EU's ring: its radius, and 30° between stars.
	const eu = sidebarText(constructionSheet(flagOf("european-union"), {}));
	assert.ok(eu.includes("30°") && eu.includes("r 6"));
	// Venezuela's arc, from -66.5° to 66.5° with 8 stars: 19° apart.
	assert.ok(textOf(constructionSvg(flagOf("venezuela"))).includes("19° apart, 36.72 from it"));
	// Bosnia's line: 125 along and 125 down each time.
	assert.equal(sidebarText(constructionSheet(flagOf("bosnia-and-herzegovina"), {})).filter((x) => x === "125").length, 4);
	// Several places: the steps between the first few.
	const ats = parse(`${header}field a\ncharge disc b { radius 0.5; at fly=2 hoist=2; at fly=5 hoist=2; at fly=6.5 hoist=4; }\n`);
	const atsSide = sidebarText(constructionSheet(ats, {}));
	for (const want of ["3", "1.5", "2"]) {
		assert.ok(atsSide.includes(want), want);
	}
	// An arc whose step no decimal says is given as its span over its steps.
	const sevenths = parse(`${header}field a\ncharge star b { radius 0.4; repeat ring count=7 radius=3; }\n`);
	assert.ok(textOf(constructionSvg(sevenths)).includes("360°/7 apart"));
	for (const name of ["united-states", "european-union", "venezuela", "bosnia-and-herzegovina"]) {
		for (const opts of [{}, { theme: "dark" }, { units: "mm", hoistMm: 900 }, { paper: "letter" }, { paper: "fit" }, { form: { side: "reverse" } }] as ConstructionOptions[]) {
			assert.deepEqual(collisions(flagOf(name), opts), [], `${name} ${JSON.stringify(opts)}`);
		}
	}
});

test("an emblem along a diagonal is measured along it, over the flag, and its trigram in a detail", () => {
	const korea = constructionSheet(flagOf("south-korea"), {});
	const slanted = korea.labels.filter((l) => l.corners !== undefined);
	// Along the bend: the taegeuk's radius 24, the gap of 12 to the trigram, and the trigram's 16, which is 24 long.
	for (const want of ["24", "12", "16"]) {
		assert.ok(slanted.some((l) => l.text === want && l.onFlag), want);
	}
	assert.ok(slanted.filter((l) => l.text === "24").length >= 2, "the radius, and a trigram's length");
	// Each label reads along its row, never upside down.
	for (const m of korea.svg.matchAll(/transform="rotate\((-?[0-9.]+) [^"]*\)"[^>]*>([^<]*)</g)) {
		const deg = Number(m[1]);
		assert.ok(deg >= -90 && deg <= 90, `${m[2]} at ${deg}°`);
	}
	// The detail: one broken trigram, with its bars and length, and its gaps and break in the caption.
	const side = korea.labels.filter((l) => l.y0 > korea.flag.y1).map((l) => l.text);
	assert.ok(side.includes("DETAIL: BLACK RECTS"));
	for (const want of ["4", "16", "11", "24"]) {
		assert.ok(side.includes(want), want);
	}
	const text = textOf(korea.svg);
	assert.ok(text.includes("each 4 by 24, 2 apart, broken by a gap 2 long"));
	assert.ok(text.includes("Sizes along a slanting axis are measured along it, and across it square to it."));
	assert.match(korea.svg, /stroke-dasharray="5 4"/, "the diagonals, as construction lines");
	assert.ok(textOf(constructionSvg(flagOf("south-korea"), { units: "hoist" })).includes("each H/24 by H/4, H/48 apart, broken by a gap H/48 long"), "too narrow to label at this size, but in the caption");
	for (const opts of [{}, { theme: "dark" }, { units: "hoist" }, { units: "mm", hoistMm: 900 }, { paper: "letter" }, { paper: "fit", grid: true }, { form: { side: "reverse" } }] as ConstructionOptions[]) {
		assert.deepEqual(collisions(flagOf("south-korea"), opts), [], JSON.stringify(opts));
	}
	// A band along a bend, or turned: its width across it, on the flag, and its angle in the notes.
	const band = constructionSheet(parse(`${header}field a\nband b { along bend-sinister; width 2; offset 1; }\nband a { width 1.5; rotate 20; }\n`), {});
	assert.ok(band.labels.some((l) => l.text === "2" && l.onFlag) && band.labels.some((l) => l.text === "1.5" && l.onFlag));
	const bandText = textOf(band.svg);
	assert.ok(bandText.includes("The b band runs along the bend sinister, from corner to corner.") && bandText.includes("The b band’s center line is 1 from the center, square to it."));
	assert.ok(bandText.includes("The a band is turned 20° from the fly, clockwise about the center."));
	// Bars along a bend share a width that's seldom a grid size, so they're given as shares.
	const bars = textOf(constructionSvg(parse(`${header}bars a b a { along bend; ratio 1 3 1; }\n`)));
	assert.ok(bars.includes("The 3 bars along the bend share the width across them, square to their axis, as 1 : 3 : 1"));
	assert.doesNotMatch(bars, /Not measured/);
});

test("slanting labels are checked by their own boxes", () => {
	const box = (cx: number, cy: number, deg: number): LabelBox => {
		const r = (deg * Math.PI) / 180;
		const corners = [[-10, -3], [10, -3], [10, 3], [-10, 3]].map(([x, y]) => ({ x: cx + x! * Math.cos(r) - y! * Math.sin(r), y: cy + x! * Math.sin(r) + y! * Math.cos(r) }));
		return { x0: Math.min(...corners.map((c) => c.x)), y0: Math.min(...corners.map((c) => c.y)), x1: Math.max(...corners.map((c) => c.x)), y1: Math.max(...corners.map((c) => c.y)), text: "", onFlag: true, corners };
	};
	// Side by side along a 45° row, their upright boxes overlap, but they don't.
	assert.equal(labelOverlap(box(0, 0, 45), box(15, 15, 45)), 0);
	assert.ok(labelOverlap(box(0, 0, 45), box(3, 3, 45)) > 50);
	assert.ok(Math.abs(labelOverlap(box(0, 0, 0), { x0: 0, y0: 0, x1: 20, y1: 20, text: "", onFlag: false }) - 30) < 1e-9);
});

test("every size and angle is written exactly, or marked ~ and the footer says so", () => {
	const forms = (flag: Flag): ConstructionOptions["form"][] => [{}, { side: "reverse" }, ...Object.keys(flag.variants).flatMap((variant) => [{ variant }, { variant, side: "reverse" as const }])];
	for (const name of [...fixtures, "turns", "adapt", "bosnia-and-herzegovina", "tanzania"]) {
		const flag = flagOf(name);
		for (const form of forms(flag)) {
			for (const opts of [{}, { units: "hoist" }, { units: "mm", hoistMm: 1234 }] as ConstructionOptions[]) {
				const sheet = constructionSheet(flag, { ...opts, form });
				assert.ok(sheet.values.length > 0);
				assert.deepEqual(sheetValueProblems(sheet), [], `${name} ${JSON.stringify({ ...opts, form })}`);
			}
		}
	}
	// South Africa's apexes and angle are the file's own numbers, so they're exact, and unmarked.
	const za = constructionSheet(flagOf("south-africa"), {});
	for (const text of ["26.9722", "18.0278", "33.6901°"]) {
		assert.ok(za.values.some((v) => v.text === text), text);
	}
	// A third of a depth no decimal says, written with a denominator too large to read, is marked.
	const thirds = constructionSheet(parse(`${header}field a\nchevrons b a b { depth 1; }\npall a { width 0.123; }\n`), {});
	assert.ok(thirds.labels.some((l) => l.text === "1/3"));
	const odd = constructionSheet(parse(`${header.replace("hoist=10 fly=20", "hoist=10 fly=20.01")}field a\nchevrons b a b { depth 10.01; }\n`), {});
	assert.ok(odd.labels.some((l) => l.text === "~3.3367") && textOf(odd.svg).includes("A ~ marks a size rounded to four places."));
	assert.deepEqual(sheetValueProblems(odd), []);
	// And the check itself catches what it's for.
	const third = fraction(1n, 3n);
	assert.match(valueProblem({ text: "0.3333", exact: third, unit: "grid" }, fraction(10n))!, /isn't marked ~/);
	assert.equal(valueProblem({ text: "~0.3333", exact: third, unit: "grid" }, fraction(10n)), null);
	assert.equal(valueProblem({ text: "1/3", exact: third, unit: "grid" }, fraction(10n)), null);
	assert.equal(valueProblem({ text: "H/30", exact: third, unit: "hoist" }, fraction(10n)), null);
	assert.match(valueProblem({ text: "33.69°", exact: exactOf(33.6901), unit: "degrees" }, fraction(10n))!, /isn't marked ~/);
	assert.equal(valueProblem({ text: "333.3", exact: fraction(1000n, 3n), unit: "mm" }, fraction(10n)), null);
});

test("the colour key and the laws are never cut short for a detail", () => {
	for (const name of ["south-korea", "united-states", "european-union", "venezuela", "bosnia-and-herzegovina"]) {
		for (const opts of [{}, { theme: "dark" }, { paper: "letter" }, { units: "hoist" }] as ConstructionOptions[]) {
			const sheet = constructionSheet(flagOf(name), opts);
			assert.equal(sheet.condensed, false, `${name} ${JSON.stringify(opts)}`);
			assert.doesNotMatch(textOf(sheet.svg), /more values? in the file|more colou?rs? in the file|named in the file/, `${name} ${JSON.stringify(opts)}`);
			assert.ok(sheet.labels.some((l) => l.text.startsWith("DETAIL:")), `${name} keeps its detail`);
		}
	}
	// South Korea's detail goes beside the notes, under the drawing, since its colours fill the sidebar.
	const korea = constructionSheet(flagOf("south-korea"), {});
	const detail = korea.labels.find((l) => l.text.startsWith("DETAIL:"))!;
	assert.ok(detail.x0 < korea.flag.x1 && detail.y0 > korea.flag.y1, "under the drawing");
});

test("what isn't measured is listed, never left out", () => {
	const flag = parse(`${header}outline swallowtail { depth 4; }
field a
chevrons b { depth 5; }
band b { along bend; width 2; }
charge star b { radius 1; fimbriate a 0.1; cut { disc { radius 0.2; } } }
fold half { over along=fly at=5 move=bottom; }
fold quarter { over along=fly at=5 move=bottom; over along=hoist at=10 move=fly; }
`);
	const out = constructionSvg(flag);
	assert.ok(textOf(out).includes("Not measured on this sheet: the half fold, the quarter fold."), out);
	assert.ok(textOf(out).includes("The b star has a disc cut out of it, drawn dashed."), out);
});

test("chevrons: their apexes on the row across their edge, an apex along it, and an angle at the outermost", () => {
	// Czechia's, from the hoist, whose arms meet its corners.
	const czechia = constructionSheet(flagOf("czech-republic"), {});
	assert.ok(czechia.labels.some((l) => l.text === "1.5") && czechia.labels.some((l) => l.text === "3"));
	assert.ok(textOf(constructionSvg(flagOf("czech-republic"))).includes("The outermost arms of the blue chevron meet the corners of the hoist."));
	// South Africa's black chevron gives its angle, and the gold one doesn't.
	const za = constructionSheet(flagOf("south-africa"), {});
	assert.ok(za.labels.some((l) => l.text === "33.6901°" && l.onFlag));
	assert.ok(za.labels.some((l) => l.text === "26.9722") && za.labels.some((l) => l.text === "18.0278"), "the black apex, then the gold one");
	// From the fly, off the middle: 10 deep in shares 1 1 3 from the fly, so apexes at 22, 20 and 14 from the hoist, and 5 down.
	const fly = constructionSheet(flagOf("chevrons-fly"), {});
	for (const want of ["14", "6", "2", "5", "7", "50°"]) {
		assert.ok(fly.labels.some((l) => l.text === want), want);
	}
	// From the top, the apexes are on the row down the hoist side.
	const top = constructionSvg(flagOf("chevrons-top"));
	assert.ok(top.includes(">12<") && top.includes(">8<") && textOf(top).includes("meet the corners of the top edge"));
	// From the bottom: 1.2 deep in shares 2 1, so apexes 0.8 and 1.2 up from the bottom, 1.25 from the hoist.
	const bottom = constructionSheet(flagOf("chevrons-bottom"), { units: "hoist" });
	for (const want of ["2H/5", "H/5", "5H/8", "7H/8", "40°"]) {
		assert.ok(bottom.labels.some((l) => l.text === want), want);
	}
	for (const name of ["czech-republic", "south-africa", "chevrons-fly", "chevrons-top", "chevrons-bottom"]) {
		assert.doesNotMatch(textOf(constructionSvg(flagOf(name))), /Not measured[^.]*chevron/, name);
		for (const opts of [{}, { units: "hoist" }, { paper: "fit", grid: true }] as ConstructionOptions[]) {
			assert.deepEqual(collisions(flagOf(name), opts), [], `${name} ${JSON.stringify(opts)}`);
		}
	}
});

test("shaped edges: their depth across a period near the middle, the period along it, and where they start", () => {
	// Bahrain's zigzag: 3 deep, in 5 periods of 12/5 down the hoist panel's side, measured on the middle one.
	const bahrain = constructionSheet(flagOf("bahrain"), {});
	assert.ok(bahrain.labels.some((l) => l.text === "3" && l.onFlag) && bahrain.labels.some((l) => l.text === "2.4" && l.onFlag));
	const text = textOf(bahrain.svg);
	assert.ok(text.includes("The zigzag edge of the panel is centered on where a straight edge would be, and has 5 periods along its 12. It starts at the top, with a point toward the panel."), text);
	assert.doesNotMatch(text, /Not measured/);
	// Waves between bars and on a fly panel, and a zigzag along the bend, whose period is the diagonal's.
	const edges = flagOf("shaped-edges");
	const waves = constructionSheet(edges, {});
	for (const want of ["1.5", "6", "2", "5"]) {
		assert.ok(waves.labels.some((l) => l.text === want && l.onFlag), want);
	}
	const wavesText = textOf(waves.svg);
	assert.ok(wavesText.includes("The wavy edge between the first two bars, and each of the others, is centered on where a straight edge would be, and repeats along its 30. It starts at the hoist, at its middle, heading away from the bar listed before it."));
	assert.ok(wavesText.includes("has 4 periods along its 20. It starts at the top, at its middle, heading away from the panel."));
	const bend = constructionSheet(edges, { form: { variant: "bend" } });
	assert.ok(bend.labels.some((l) => l.text === "2" && l.onFlag));
	assert.ok(textOf(bend.svg).includes("has 7 periods along the diagonal. It starts at the upper hoist corner, with a point toward the bar listed before it. Its period is the diagonal’s length divided by 7."));
	assert.ok(constructionSheet(edges, { units: "hoist" }).labels.some((l) => l.text === "0.075H"), "the bars' depth, as a part of the hoist");
	for (const name of ["bahrain", "shaped-edges"]) {
		assert.doesNotMatch(textOf(constructionSvg(flagOf(name))), /Not measured/, name);
	}
	golden("shaped-edges-bend.svg", bend.svg);
	for (const opts of [{}, { units: "hoist" }, { paper: "fit", grid: true }, { theme: "dark" }] as ConstructionOptions[]) {
		assert.deepEqual(collisions(edges, { ...opts, form: { variant: "bend" } }), [], JSON.stringify(opts));
	}
});

test("outlines: where a named form is cut, along the edges, and a polygon's corners", () => {
	// Signal flag A's swallowtail is 150 deep, from the middle of the fly.
	const alfa = constructionSheet(flagOf("ics-alfa"), {});
	assert.ok(alfa.labels.some((l) => l.text === "150") && alfa.labels.some((l) => l.text === "300"));
	assert.ok(textOf(alfa.svg).includes("The swallowtail is cut 150 in from the fly, to a point on the middle line, and its tails end at the fly’s corners."));
	assert.doesNotMatch(textOf(alfa.svg), /Not measured[^.]*outline/);
	// Norway's state flag: notches 11 in from the fly, 6 from the top and the bottom, so 4 apart.
	const norway = constructionSheet(flagOf("norway-state"), {});
	for (const want of ["11", "6", "1"]) {
		assert.ok(norway.labels.some((l) => l.text === want), want);
	}
	assert.ok(textOf(norway.svg).includes("The fly is cut 11 in, to two notches 4 apart either side of the middle line, and the tongue between them comes to a point at the middle of the fly."));
	// Nepal's polygon: its inner corner, 17.5736 along and 37.5736 down.
	const nepal = constructionSheet(flagOf("nepal"), {});
	assert.ok(nepal.labels.some((l) => l.text === "17.5736") && nepal.labels.some((l) => l.text === "37.5736"));
	assert.ok(textOf(nepal.svg).includes("The outline is the polygon through the 5 corners the file lists, each at places marked along the edges."));
	// A tapered swallowtail, pennants with an end and with a point, a path, and a polygon of many corners.
	const flag = flagOf("outlines");
	const tapered = constructionSheet(flag, {});
	assert.ok(tapered.labels.some((l) => l.text === "2.5") && tapered.labels.some((l) => l.text === "22"));
	assert.ok(textOf(tapered.svg).includes("its tails end 2.5 in from the fly’s corners, along it."));
	const pennant = constructionSheet(flag, { form: { variant: "pennant" }, units: "hoist" });
	assert.ok(pennant.labels.some((l) => l.text === "0.35H"), "from the top to the end");
	assert.ok(textOf(pennant.svg).includes("The pennant narrows from the whole hoist to an end 3H/10 wide at the fly, on the middle line."));
	assert.ok(textOf(constructionSvg(flag, { form: { variant: "point" } })).includes("The pennant narrows from the whole hoist to a point at the middle of the fly."));
	assert.ok(textOf(constructionSvg(flag, { form: { variant: "curved" } })).includes("The outline is the file’s path, stretched from its box, 40 by 30 from (0, 0) in its own units, to the flag’s grid, 30 by 20."));
	assert.ok(textOf(constructionSvg(flag, { form: { variant: "saw" } })).includes("The outline is the polygon through the 14 corners the file lists, which reaches each edge of the grid."));
	for (const variant of [undefined, "pennant", "point", "curved", "saw"]) {
		assert.doesNotMatch(textOf(constructionSvg(flag, variant !== undefined ? { form: { variant } } : {})), /Not measured/, variant);
		for (const opts of [{}, { units: "hoist" }, { units: "mm", hoistMm: 900 }, { paper: "fit", grid: true }] as ConstructionOptions[]) {
			assert.deepEqual(collisions(flag, { ...opts, ...(variant !== undefined ? { form: { variant } } : {}) }), [], `${variant} ${JSON.stringify(opts)}`);
		}
	}
	golden("outlines.svg", tapered.svg);
	golden("norway-state.svg", norway.svg);
});

test("fimbriations and borders: each one's width, once, across it", () => {
	// Norway's state flag: its cross's white edge, 1 wide, on the flag.
	const norway = constructionSheet(flagOf("norway-state"), {});
	assert.ok(norway.labels.some((l) => l.text === "1" && l.onFlag));
	// Nepal's blue border, outside its outline, and signal flag A's black one, inside its.
	assert.ok(constructionSheet(flagOf("nepal"), {}).labels.some((l) => l.text === "2.5823" && l.onFlag));
	assert.ok(constructionSheet(flagOf("ics-alfa"), {}).labels.some((l) => l.text === "2.5" && l.onFlag));
	// New Zealand's stars, each edged in white, 0.5 wide.
	assert.equal(constructionSheet(flagOf("new-zealand"), {}).labels.filter((l) => l.text === "0.5" && l.onFlag).length, 3);
	// A chevron, a band, a pall, a disc and a path, and a border inside; and a saltire and a band along the bend.
	const flag = flagOf("fimbriated");
	const sheet = constructionSheet(flag, {});
	for (const want of ["0.5", "0.6", "0.7", "0.8", "0.9"]) {
		assert.ok(sheet.labels.some((l) => l.text === want && l.onFlag), want);
	}
	assert.ok(textOf(sheet.svg).includes("The gold path is fimbriated white, 0.4 wide."), "a shape with no side to measure across is given in the notes");
	const saltire = constructionSheet(flag, { form: { variant: "saltire" } });
	assert.ok(saltire.labels.some((l) => l.text === "1" && l.onFlag) && saltire.labels.filter((l) => l.text === "0.5" && l.onFlag).length === 2);
	for (const name of ["norway-state", "nepal", "ics-alfa", "new-zealand", "guyana", "fimbriated"]) {
		assert.doesNotMatch(textOf(constructionSvg(flagOf(name))), /Not measured[^.]*(fimbriation|border)/, name);
	}
	for (const form of [{}, { variant: "saltire" }, { side: "reverse" }] as ConstructionOptions["form"][]) {
		for (const opts of [{}, { units: "hoist" }, { units: "mm", hoistMm: 900 }, { paper: "fit", grid: true }, { theme: "dark" }] as ConstructionOptions[]) {
			assert.deepEqual(collisions(flag, { ...opts, form }), [], `${JSON.stringify(form)} ${JSON.stringify(opts)}`);
		}
	}
	golden("fimbriated.svg", sheet.svg);
	golden("nepal.svg", constructionSvg(flagOf("nepal")));
});

test("rays: the point they come from, and each wedge's share, by angle or along the edges", () => {
	// Seychelles' rays share the top and the fly by length: 2, 2 and 2 along the top, then 1, 1 and 1 down the fly.
	const seychelles = constructionSheet(flagOf("seychelles"), {});
	assert.equal(seychelles.labels.filter((l) => l.text === "2").length, 3);
	assert.equal(seychelles.labels.filter((l) => l.text === "1").length, 3);
	assert.ok(textOf(seychelles.svg).includes("The rays come from the lower hoist corner, and share the edges they reach by length, walking clockwise, as 2 : 2 : 3 : 1 : 1, from the blue one. Each wedge ends at a place marked along the edges."));
	assert.doesNotMatch(textOf(seychelles.svg), /Not measured/);
	// By angle from the center, turned: 12 wedges of 30°, the first marked at the center, which is marked +.
	const flag = flagOf("rays");
	const turned = constructionSheet(flag, {});
	assert.ok(turned.labels.some((l) => l.text === "30°" && l.onFlag) && turned.labels.some((l) => l.text === "15"));
	const text = textOf(turned.svg);
	assert.ok(text.includes("The rays come from the center, going clockwise from straight up, turned 15° clockwise, in 12 wedges of 30° each."));
	assert.ok(text.includes("The point the rays come from is marked +."));
	assert.ok(textOf(constructionSvg(flag, { form: { variant: "hoist" } })).includes("The rays come from the middle of the hoist, going clockwise from straight up, in wedges of 30°, red; 60°, white; 90°, blue."));
	// From a point beyond the flag, the angles are no fraction of a turn, so they're rounded and marked.
	const beyond = constructionSheet(flag, { form: { variant: "point" } });
	assert.ok(textOf(beyond.svg).includes("The rays come from the point -10 along the fly and 6 down, beyond the flag, going clockwise from ~59.0362° past straight up, in 6 wedges of ~14.2377° each."));
	assert.ok(textOf(beyond.svg).includes("A ~ marks a size rounded to four places."));
	// By the edges from the center: the walk round from the top is 100 long, so the wedges end 10 down the fly, 15 along the bottom and 10 up the hoist.
	const edges = constructionSheet(flag, { form: { variant: "edges" } });
	for (const want of ["10", "15"]) {
		assert.ok(edges.labels.some((l) => l.text === want), want);
	}
	for (const variant of [undefined, "hoist", "point", "edges"]) {
		const form = variant !== undefined ? { variant } : {};
		assert.doesNotMatch(textOf(constructionSvg(flag, { form })), /Not measured/);
		for (const opts of [{}, { units: "hoist" }, { units: "mm", hoistMm: 900 }, { paper: "fit", grid: true }, { form: { ...form, side: "reverse" } }] as ConstructionOptions[]) {
			const sheet = constructionSheet(flag, { form, ...opts });
			assert.deepEqual(collisions(flag, { form, ...opts }), [], `${variant} ${JSON.stringify(opts)}`);
			assert.deepEqual(sheetValueProblems(sheet), [], `${variant} ${JSON.stringify(opts)}`);
		}
	}
	golden("seychelles.svg", seychelles.svg);
	golden("rays.svg", turned.svg);
});

test("clips and cuts: each shape measured as a charge is, with its outline drawn dashed", () => {
	// Nepal's moon: a disc cut by one of radius 12.8401, 18.7868 down, and a star clipped to a rect.
	const nepal = constructionSheet(flagOf("nepal"), {});
	for (const want of ["r 12.8401", "15.4462 × 7.7231"]) {
		assert.ok(nepal.labels.some((l) => l.text === want && l.onFlag), want);
	}
	assert.ok(nepal.labels.some((l) => l.text === "18.7868"), "the cut's center, down the hoist");
	const nepalText = textOf(nepal.svg);
	assert.ok(nepalText.includes("The white disc has a disc cut out of it, drawn dashed.") && nepalText.includes("The white star keeps only what’s inside its clip, a rect, drawn dashed."));
	assert.doesNotMatch(nepalText, /Not measured/);
	// A cut in a band, a group clipped to a polygon, a path cut from each of a row of copies, and an ellipse's clip.
	const flag = flagOf("clips");
	const sheet = constructionSheet(flag, {});
	for (const want of ["r 2", "box 12 × 8", "box 1 × 1", "4 × 2"]) {
		assert.ok(sheet.labels.some((l) => l.text === want && l.onFlag), want);
	}
	const text = textOf(sheet.svg);
	for (const want of ["The white band has a disc cut out of it, drawn dashed.", "The group keeps only what’s inside its clip, a polygon, drawn dashed.", "The white rect has a path cut out of it, drawn dashed, and so does each of its copies.", "The red disc keeps only what’s inside its clip, an ellipse, drawn dashed."]) {
		assert.ok(text.includes(want), want);
	}
	assert.doesNotMatch(text, /Not measured/);
	assert.match(sheet.svg, /stroke-dasharray="5 4"/, "the outlines, as construction lines");
	for (const opts of [{}, { units: "hoist" }, { units: "mm", hoistMm: 900 }, { paper: "fit", grid: true }, { form: { side: "reverse" } }, { theme: "dark" }] as ConstructionOptions[]) {
		assert.deepEqual(collisions(flag, opts), [], JSON.stringify(opts));
	}
	golden("clips.svg", sheet.svg);
});

test("designs: measured in their own frame, at the scale they're drawn at", () => {
	// New Zealand's union fills its canton at its own size: the cross 6 wide, its fimbriation 2.
	const nz = constructionSheet(flagOf("new-zealand"), {});
	assert.ok(nz.labels.some((l) => l.text === "6" && l.onFlag) && nz.labels.some((l) => l.text === "2" && l.onFlag));
	assert.doesNotMatch(textOf(nz.svg), /Not measured/);
	// A badge on a grid of 5 by 6, twice its size in a canton: its cross's arms and its disc, on the flag's grid.
	const flag = flagOf("designs");
	const sheet = constructionSheet(flag, {});
	for (const want of ["4", "2", "6", "9", "3", "0.5"]) {
		assert.ok(sheet.labels.some((l) => l.text === want), want);
	}
	assert.equal(sheet.labels.filter((l) => l.text === "r 2" && l.onFlag).length, 2, "the badge's disc, and the star in the panel");
	assert.ok(textOf(sheet.svg).includes("The design “badge” is drawn on a grid of its own, 5 by 6, at 2 times its size, so that it fills 10 by 12. Its sizes here are the flag’s."));
	assert.doesNotMatch(textOf(sheet.svg), /Not measured/);
	assert.ok(constructionSheet(flag, { units: "hoist" }).labels.some((l) => l.text === "0.025H"), "the fimbriation, as a part of the hoist");
	// One stretched more one way than the other has no one scale, so it says so.
	assert.ok(textOf(constructionSvg(flag, { form: { variant: "stretched" } })).includes("Not measured on this sheet: the design “badge”, which is stretched to fill its region, more one way than the other."));
	for (const opts of [{}, { units: "hoist" }, { units: "mm", hoistMm: 900 }, { paper: "fit", grid: true }, { form: { side: "reverse" } }] as ConstructionOptions[]) {
		assert.deepEqual(collisions(flag, opts), [], JSON.stringify(opts));
		assert.deepEqual(sheetValueProblems(constructionSheet(flag, opts)), [], JSON.stringify(opts));
	}
	golden("designs.svg", sheet.svg);
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
