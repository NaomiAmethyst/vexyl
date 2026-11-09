// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const { defaultSheet, pageRule, readSheetPrefs, sheetForm, sheetForms, sheetOptions } = await load("sheet");

test("a sheet is dark on screen by default, in grid units on A4", () => {
	assert.deepEqual(readSheetPrefs(null), defaultSheet);
	assert.equal(defaultSheet.theme, "dark");
	assert.equal(defaultSheet.units, "grid");
	assert.equal(defaultSheet.paper, "a4");
	assert.equal(defaultSheet.dpi, 300);
});

test("what was kept is read back, and anything that doesn't make sense is ignored", () => {
	const kept = { units: "mm", hoistMm: 1500, theme: "paper", paper: "fit", sizes: false, positions: true, colors: false, grid: true, dpi: 600, form: "variant:vertical" };
	assert.deepEqual(readSheetPrefs(JSON.stringify(kept)), kept);
	assert.deepEqual(readSheetPrefs("not json"), defaultSheet);
	assert.deepEqual(readSheetPrefs("[1,2]"), defaultSheet);
	const odd = readSheetPrefs(JSON.stringify({ units: "furlongs", hoistMm: -4, theme: 3, paper: "a3", sizes: "yes", dpi: 72 }));
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

test("the form is the flag, its reverse or a variant it has, and otherwise the flag", () => {
	assert.equal(defaultSheet.form, "flag");
	assert.deepEqual(sheetForms(["vertical"]), [["flag", "Flag"], ["reverse", "Reverse"], ["variant:vertical", "Vertical"]]);
	assert.deepEqual(sheetForm("reverse", []), { side: "reverse" });
	assert.deepEqual(sheetForm("variant:vertical", ["vertical"]), { variant: "vertical" });
	assert.deepEqual(sheetForm("variant:vertical", ["hanging"]), {}, "one this flag doesn't have");
	assert.equal(sheetOptions(defaultSheet, undefined, null).form, undefined);
	assert.deepEqual(sheetOptions({ ...defaultSheet, form: "variant:hanging" }, undefined, null, ["hanging"]).form, { variant: "hanging" });
	assert.equal(readSheetPrefs(JSON.stringify({ form: "sideways" })).form, "flag");
	assert.equal(readSheetPrefs(JSON.stringify({ form: "variant:a b" })).form, "variant:a b");
});

test("printing is on paper the sheet's own size", () => {
	assert.equal(pageRule(297, 210), "@page { size: 297mm 210mm; margin: 0; }");
});
