// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launch, mockWorld, openUrl, ready, serve, watch } from "./helpers.mjs";

let srv;
let browser;
before(async () => {
	srv = await serve();
	browser = await launch();
});
after(async () => {
	await browser.close();
	await srv.close();
});

async function chile(viewport = { width: 1440, height: 1000 }) {
	const context = await browser.newContext({ viewport, colorScheme: "dark", acceptDownloads: true });
	await mockWorld(context);
	const p = await context.newPage();
	const errors = watch(p);
	await p.goto(openUrl(srv.base, "flags/country/chile.kdl"));
	await ready(p);
	await p.getByRole("link", { name: /^Sheet/ }).click();
	await sheetShown(p);
	return { p, context, errors };
}

/**
 * Waits for the sheet to be drawn anew, and gives the SVG it shows, by downloading it, since the
 * page's own policy rightly won't let a script read it back.
 */
async function sheetShown(p, previous) {
	await p.waitForFunction((was) => {
		const img = document.querySelector(".print-sheet");
		return img !== null && img.complete && img.naturalWidth > 0 && img.src !== was;
	}, previous ?? null, { timeout: 30000 });
	const src = await p.locator(".print-sheet").getAttribute("src");
	const [file] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Download SVG" }).click()]);
	return { src, text: readFileSync(await file.path(), "utf8") };
}

/** Whether the choice of units is all on one line. */
const oneLine = (p) => p.getByRole("radiogroup", { name: "Sizes in" }).evaluate((g) => new Set([...g.children].map((b) => Math.round(b.getBoundingClientRect().top))).size === 1);

const pick = (p, group, name) => p.getByRole("radiogroup", { name: group }).getByRole("radio", { name }).click();

test("the view opens from the gallery, dark, with the flag's own numbers", async () => {
	const { p, context, errors } = await chile();
	assert.match(p.url(), /view=construction/);
	assert.equal(await oneLine(p), true, "the units' choices sit on one line");
	const { text } = await sheetShown(p);
	assert.ok(text.includes('fill="#0c0b11"'), "dark by default on screen");
	assert.ok(text.includes(">r 0.5<") && text.includes(">2:3 · grid 4 × 6<"));
	assert.ok(text.includes("flags/country/chile.kdl"));
	await p.getByRole("link", { name: "Back to editing" }).click();
	await p.locator(".big-view").waitFor();
	assert.deepEqual(errors, []);
	await context.close();
});

test("units and the sheet's look switch, and are remembered", async () => {
	const { p, context, errors } = await chile();
	let shown = await sheetShown(p);
	await pick(p, "Sizes in", "Hoist");
	shown = await sheetShown(p, shown.src);
	assert.ok(shown.text.includes(">3H/2<") && shown.text.includes(">r H/8<"));
	await pick(p, "Sizes in", "mm");
	const box = p.getByLabel("Hoist, in millimetres");
	await box.fill("1200");
	await box.press("Enter");
	shown = await sheetShown(p, shown.src);
	if (!shown.text.includes(">1800<")) {
		// The units and the hoist can each draw a sheet, so the second is the one with both.
		shown = await sheetShown(p, shown.src);
	}
	assert.ok(shown.text.includes(">1800<") && shown.text.includes(">r 150<"), "1200 mm of hoist on a grid of 4");
	await pick(p, "Sheet", "Paper");
	shown = await sheetShown(p, shown.src);
	assert.ok(shown.text.includes('fill="#ffffff"/>') && !shown.text.includes("#0c0b11"));
	await p.getByLabel("The grid").check();
	shown = await sheetShown(p, shown.src);
	const kept = await p.evaluate(() => JSON.parse(localStorage.getItem("vexyl.construction")));
	assert.deepEqual({ units: kept.units, hoistMm: kept.hoistMm, theme: kept.theme, grid: kept.grid }, { units: "mm", hoistMm: 1200, theme: "paper", grid: true });
	await p.reload();
	const again = await sheetShown(p);
	assert.ok(again.text.includes(">1800<") && again.text.includes('fill="#ffffff"/>'));
	assert.deepEqual(errors, []);
	await context.close();
});

test("the sheet is drawn for any form the gallery lists, and the choice is remembered", async () => {
	const { p, context, errors } = await chile();
	let shown = await sheetShown(p);
	const forms = await p.getByRole("radiogroup", { name: "Form" }).getByRole("radio").allTextContents();
	assert.deepEqual(forms, ["Flag", "Reverse", "Vertical"]);
	await pick(p, "Form", "Vertical");
	shown = await sheetShown(p, shown.src);
	assert.ok(shown.text.includes(">Chile · vertical<"), "the header names the form");
	await pick(p, "Form", "Reverse");
	shown = await sheetShown(p, shown.src);
	assert.ok(shown.text.includes(">Chile · reverse<"));
	const kept = await p.evaluate(() => JSON.parse(localStorage.getItem("vexyl.construction")));
	assert.equal(kept.form, "reverse");
	await p.reload();
	const again = await sheetShown(p);
	assert.ok(again.text.includes(">Chile · reverse<"));
	await pick(p, "Form", "Flag");
	await sheetShown(p, again.src);
	assert.deepEqual(errors, []);
	await context.close();
});

test("the SVG it downloads parses, and printing is set up for the sheet's paper", async () => {
	const { p, context, errors } = await chile();
	const [file] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Download SVG" }).click()]);
	assert.equal(file.suggestedFilename(), "chile-construction.svg");
	const text = readFileSync(await file.path(), "utf8");
	// Read on a blank page, since the editor's own allows no markup to be parsed from a string.
	const blank = await context.newPage();
	const parsed = await blank.evaluate((t) => {
		const doc = new DOMParser().parseFromString(t, "image/svg+xml");
		return { error: doc.querySelector("parsererror") !== null, root: doc.documentElement.localName, width: doc.documentElement.getAttribute("width") };
	}, text);
	await blank.close();
	assert.deepEqual(parsed, { error: false, root: "svg", width: "297mm" });
	const rules = await p.evaluate(() => document.adoptedStyleSheets.flatMap((s) => [...s.cssRules].map((r) => r.cssText)));
	assert.ok(rules.some((r) => /@page/.test(r) && /297mm 210mm/.test(r)), rules.join("\n"));
	await pick(p, "Paper", "Letter");
	await p.waitForFunction(() => document.adoptedStyleSheets.some((s) => [...s.cssRules].some((r) => /279\.4mm 215\.9mm/.test(r.cssText))));
	await p.emulateMedia({ media: "print" });
	const seen = await p.evaluate(() => ({
		sheet: getComputedStyle(document.querySelector(".print-sheet")).visibility,
		options: getComputedStyle(document.querySelector(".sheet-options")).visibility,
		header: getComputedStyle(document.querySelector(".topbar")).visibility,
	}));
	assert.deepEqual(seen, { sheet: "visible", options: "hidden", header: "hidden" });
	await p.emulateMedia({ media: "screen" });
	assert.deepEqual(errors, []);
	await context.close();
});

test("on a phone, the sheet comes first and nothing is wider than the screen", async () => {
	const { p, context, errors } = await chile({ width: 390, height: 844 });
	const layout = await p.evaluate(() => ({
		wide: document.documentElement.scrollWidth,
		sheetTop: document.querySelector(".sheet-view").getBoundingClientRect().top,
		optionsTop: document.querySelector(".sheet-options").getBoundingClientRect().top,
	}));
	assert.ok(layout.wide <= 390, `${layout.wide} wide`);
	assert.ok(layout.sheetTop < layout.optionsTop);
	assert.equal(await oneLine(p), true, "the units' choices sit on one line");
	assert.deepEqual(errors, []);
	await context.close();
});
