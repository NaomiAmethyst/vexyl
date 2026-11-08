// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const { defaultSheet, pageRule, readSheetPrefs, sheetOptions } = await load("sheet");

test("a sheet is dark on screen by default, in grid units on A4", () => {
	assert.deepEqual(readSheetPrefs(null), defaultSheet);
	assert.equal(defaultSheet.theme, "dark");
	assert.equal(defaultSheet.units, "grid");
	assert.equal(defaultSheet.paper, "a4");
});

test("what was kept is read back, and anything that doesn't make sense is ignored", () => {
	const kept = { units: "mm", hoistMm: 1500, theme: "paper", paper: "fit", sizes: false, positions: true, colors: false, grid: true };
	assert.deepEqual(readSheetPrefs(JSON.stringify(kept)), kept);
	assert.deepEqual(readSheetPrefs("not json"), defaultSheet);
	assert.deepEqual(readSheetPrefs("[1,2]"), defaultSheet);
	const odd = readSheetPrefs(JSON.stringify({ units: "furlongs", hoistMm: -4, theme: 3, paper: "a3", sizes: "yes" }));
	assert.deepEqual(odd, defaultSheet);
	assert.equal(readSheetPrefs(JSON.stringify({ hoistMm: Infinity })).hoistMm, 1000);
});

test("the library's options carry the hoist only in millimetres, and the file's path and tier", () => {
	assert.equal(sheetOptions({ ...defaultSheet, hoistMm: 700 }, undefined, null).hoistMm, undefined);
	const mm = sheetOptions({ ...defaultSheet, units: "mm", hoistMm: 700 }, "flags/country/chile.kdl", "A");
	assert.equal(mm.hoistMm, 700);
	assert.equal(mm.path, "flags/country/chile.kdl");
	assert.equal(mm.tier, "A");
	assert.equal(sheetOptions(defaultSheet, "", null).path, undefined);
});

test("printing is on paper the sheet's own size", () => {
	assert.equal(pageRule(297, 210), "@page { size: 297mm 210mm; margin: 0; }");
});
