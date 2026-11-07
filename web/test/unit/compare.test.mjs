// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load, loadLibrary } from "./load.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const flags = resolve(repo, "../vexyl-flags/reviewed");
const { compareModels, unchangedSentence } = await load("whatchanged");
const { lineDiff } = await load("linediff");
const { diffShapes } = await load("shapediff");
const lib = await loadLibrary();

const hasFlags = existsSync(flags);

test("Azerbaijan 1991 and 2018 come to what the mock says", { skip: !hasFlags }, () => {
	const model = (f) => lib.model(lib.parse(readFileSync(resolve(flags, f), "utf8")));
	const { changes, unchanged } = compareModels(model("azerbaijan-1991.kdl"), model("azerbaijan.kdl"));
	const rows = changes.map((c) => [c.term, c.name, c.a.text, c.b.text]);
	assert.deepEqual(rows, [
		["Crescent", "Outer radius", "0.150", "0.143"],
		["Crescent", "Inner radius", "0.125", "0.110"],
		["Crescent", "Offset", "0.033", "0.035"],
		["Crescent", "Center along the fly", "0.950", "0.965"],
		["Star", "Outer radius", "0.0833", "0.0830"],
		["Star", "Inner radius", "0.042", "0.039"],
		["Star", "Center along the fly", "1.117", "1.105"],
		["Colors", "Blue", "#0092bc, 313 C", "#00b5e2, 306 C"],
		["Colors", "Red", "#e4002b, 185 C", "#ef3340, Red 032 C"],
		["Colors", "Green", "#00af66, 3405 C", "#509e2f, 362 C"],
	]);
	const sentence = unchangedSentence(unchanged);
	assert.ok(sentence.includes("the 1:2 proportion"), sentence);
	assert.ok(sentence.includes("three equal bars"), sentence);
	assert.ok(sentence.includes("an eight-pointed star"), sentence);
});

test("two grids of the same flag have no differences", () => {
	const head = 'vexyl 1\nmeta { name "T"; }\npalette { a "#112233"; b "#445566"; }\n';
	const a = lib.model(lib.parse(head + 'proportion hoist=10 fly=20\ncharge disc a { radius 1; at fly=5 hoist=5; }\n'));
	const b = lib.model(lib.parse(head + 'proportion hoist=100 fly=200\ncharge disc a { radius 10; at fly=50 hoist=50; }\n'));
	const { changes } = compareModels(a, b);
	assert.deepEqual(changes, []);
});

test("a name like __proto__ in a palette is compared as a name", () => {
	const head = (c) => `vexyl 1\nmeta { name "T"; }\npalette { __proto__ "${c}"; constructor "#445566"; }\nproportion hoist=1 fly=2\nfield __proto__\n`;
	const { changes } = compareModels(lib.model(lib.parse(head("#112233"))), lib.model(lib.parse(head("#aabbcc"))));
	assert.deepEqual(changes.map((c) => c.name), ["__proto__".charAt(0).toUpperCase() + "__proto__".slice(1)]);
	assert.equal(changes[0].b.color, "#aabbcc");
});

test("a line diff pairs up what changed", () => {
	const rows = lineDiff("a\nb\nc\nd\n", "a\nx\nc\nd\ne\n");
	assert.deepEqual(rows.map((r) => [r.kind, r.left, r.right]), [["same", "a", "a"], ["changed", "b", "x"], ["same", "c", "c"], ["same", "d", "d"], ["changed", null, "e"]]);
	assert.deepEqual(rows.filter((r) => r.kind === "changed").map((r) => [r.leftNo, r.rightNo]), [[2, 2], [null, 5]]);
	assert.deepEqual(lineDiff("same\n", "same\n").map((r) => r.kind), ["same"]);
});

function image(width, height, paint) {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const [r, g, b] = paint(x, y);
			data.set([r, g, b, 255], (y * width + x) * 4);
		}
	}
	return data;
}

test("a change of color alone isn't a difference in shapes", () => {
	const a = image(100, 50, (x) => (x < 50 ? [0, 0, 200] : [200, 0, 0]));
	const b = image(100, 50, (x) => (x < 50 ? [0, 100, 255] : [255, 90, 90]));
	const d = diffShapes(a, b, 100, 50);
	assert.equal(d.percent, 0);
	assert.equal(d.box, null);
});

test("a shape that moves is marked as only in each", () => {
	const disc = (cx) => (x, y) => ((x - cx) ** 2 + (y - 50) ** 2 < 400 ? [255, 255, 255] : [0, 0, 200]);
	const d = diffShapes(image(200, 100, disc(90)), image(200, 100, disc(110)), 200, 100);
	assert.ok(d.percent > 1 && d.percent < 20, String(d.percent));
	assert.ok(d.box.x >= 60 && d.box.x + d.box.w <= 140, JSON.stringify(d.box));
	// The left of the old disc is only in A, and the right of the new one only in B.
	assert.equal(d.marks[50 * 200 + 75], 1);
	assert.equal(d.marks[50 * 200 + 125], 2);
});

test("edges drawn a little differently don't count", () => {
	const a = image(100, 50, (x, y) => (y < 25 ? [10, 10, 10] : [200, 200, 200]));
	const b = image(100, 50, (x, y) => (y < 25 ? [10, 10, 10] : y === 25 ? [100, 100, 100] : [200, 200, 200]));
	assert.equal(diffShapes(a, b, 100, 50).percent, 0);
});
