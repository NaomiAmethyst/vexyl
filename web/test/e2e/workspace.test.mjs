// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { downloadChoice, fromTopbar, launch, mockWorld, openUrl, readFlag, ready, savedText, serve, startFlag, watch } from "./helpers.mjs";

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

async function page(path, opts = {}) {
	const context = await browser.newContext({ viewport: { width: 1440, height: 1160 }, colorScheme: "dark", acceptDownloads: true, ...opts });
	const log = await mockWorld(context);
	const p = await context.newPage();
	const errors = watch(p);
	if (path !== undefined) {
		await p.goto(openUrl(srv.base, path));
		await ready(p);
	}
	return { p, context, log, errors };
}

const row = (p, path) => p.locator(`.row[data-path="${path}"]`);
const clickFlag = async (p, xShare, yShare) => {
	const box = await p.locator(".stage").boundingBox();
	await p.mouse.click(box.x + box.width * xShare, box.y + box.height * yShare);
};
const hoverFlag = async (p, xShare, yShare) => {
	const box = await p.locator(".stage").boundingBox();
	await p.mouse.move(box.x + box.width * xShare, box.y + box.height * yShare);
};
const panelTitle = (p) => p.locator(".panel-head h2").textContent();

test("the structure list slides to a panel with a breadcrumb, and back", async () => {
	const { p, context, errors } = await page("reviewed/united-states.kdl");
	await row(p, "1.1").click();
	assert.equal(await panelTitle(p), "Star");
	assert.deepEqual(await p.locator(".crumbs .back").allTextContents(), ["‹ Structure", "Canton"]);
	await p.locator(".crumbs .back", { hasText: "Canton" }).click();
	assert.equal(await panelTitle(p), "Canton");
	await p.locator(".crumbs .back", { hasText: "Structure" }).click();
	await row(p, "0").waitFor();
	assert.deepEqual(errors, []);
	await context.close();
});

test("hovering a row outlines its shapes, and hovering the flag marks its row", async () => {
	const { p, context } = await page("reviewed/united-states.kdl");
	await row(p, "1.1").hover();
	await p.waitForFunction(() => document.querySelectorAll(".outline-hover-inner > *").length === 50);
	await p.mouse.move(0, 0);
	await p.waitForFunction(() => document.querySelectorAll(".outline-hover-inner > *").length === 0);
	await hoverFlag(p, 0.8, 0.5);
	await p.waitForSelector('.row.hover[data-path="0"]');
	await context.close();
});

test("a click takes the deepest object, and clicking again steps out", async () => {
	const { p, context } = await page("reviewed/united-states.kdl");
	// The first star of the top row, in the canton.
	const box = await p.locator(".stage").boundingBox();
	const star = { x: box.x + (box.width * 9.88 * (1 / 12)) / 24.7, y: box.y + (box.height * 7 * (1 / 10)) / 13 };
	await p.mouse.click(star.x, star.y);
	assert.equal(await panelTitle(p), "Star", "any star selects the one charge");
	await p.waitForFunction(() => document.querySelectorAll(".outline-selected-inner > *").length === 50);
	await p.mouse.click(star.x, star.y);
	assert.equal(await panelTitle(p), "Canton");
	await p.mouse.click(star.x, star.y);
	assert.equal(await panelTitle(p), "Bars");
	await clickFlag(p, 0.9, 0.9);
	assert.equal(await panelTitle(p), "Bars");
	await context.close();
});

test("selecting works on a turned and on a mirrored form", async () => {
	const { p, context } = await page("reviewed/united-states.kdl");
	await p.locator('.thumb[data-form="reverse"]').click();
	await p.waitForFunction(() => document.querySelector(".pick-tree") !== null);
	await clickFlag(p, 0.95, 0.05);
	assert.ok(["Star", "Canton"].includes(await panelTitle(p)));
	await p.locator('.thumb[data-form="variant:vertical"]').click();
	await p.waitForFunction(() => document.querySelector(".nx-muted")?.textContent?.includes("Vertical"));
	await p.locator(".crumbs .back", { hasText: "Structure" }).click();
	await clickFlag(p, 0.5, 0.95);
	assert.equal(await panelTitle(p), "Bars");
	await context.close();
});

test("Form and Source carry the selection across", async () => {
	const { p, context } = await page("reviewed/united-states.kdl");
	await row(p, "1.1").click();
	await p.getByRole("radio", { name: "Source" }).click();
	await p.waitForSelector(".cm-selected-line");
	const lines = await p.locator(".cm-selected-line").allTextContents();
	assert.ok(lines.some((l) => l.includes("charge star white")), lines.join("|"));
	await p.locator(".cm-line", { hasText: "bars red white" }).click();
	await p.getByRole("radio", { name: "Form" }).click();
	assert.equal(await panelTitle(p), "Bars");
	await context.close();
});

test("each panel has its source collapsed, with a link to its lines in the whole file", async () => {
	const { p, context } = await page("reviewed/united-states.kdl");
	await row(p, "0").click();
	const details = p.locator(".term-source");
	assert.equal(await details.getAttribute("open"), null);
	await details.locator("summary").click();
	assert.ok((await details.locator("textarea").inputValue()).startsWith("bars red white"));
	await details.getByRole("button", { name: "See it in the whole file" }).click();
	await p.waitForSelector(".cm-selected-line");
	await context.close();
});

test("the gallery loads each form in the big view and the small sizes", async () => {
	const { p, context, errors } = await page("reviewed/united-states.kdl");
	await p.waitForSelector('.thumb[data-form="fold:triangle"] img');
	const big = () => p.locator(".stage-image").getAttribute("src");
	const before = await big();
	await p.locator('.thumb[data-form="reverse"]').click();
	await p.waitForFunction((b) => document.querySelector(".stage-image")?.getAttribute("src") !== b, before);
	await p.waitForFunction(() => {
		const src = (q) => document.querySelector(q)?.getAttribute("src");
		return src(".small-64") === src(".stage-image") && src(".small-16") === src(".stage-image");
	});
	assert.deepEqual(await p.locator(".smalls figcaption").allTextContents(), ["64 px", "32 px", "24 px", "16 px"]);
	await p.locator('.thumb[data-form="variant:vertical"]').click();
	await p.waitForFunction(() => { const i = document.querySelector(".stage-image"); return i.naturalHeight > i.naturalWidth; });
	assert.deepEqual(errors, []);
	await context.close();
});

test("a refused proportion stays visible as needing padding, and it's offered", async () => {
	const { p, context } = await page("reviewed/united-states.kdl");
	const thumb = p.locator('.thumb[data-form="ratio:1:1"]');
	await thumb.locator(".thumb-sub", { hasText: "Needs padding" }).waitFor();
	await thumb.click();
	await p.locator(".refusal .nx-callout", { hasText: "doesn't say how it adapts" }).waitFor();
	await p.getByRole("button", { name: "Pad with transparency" }).click();
	await p.waitForSelector(".stage-image");
	await thumb.locator(".thumb-sub", { hasText: "Padded" }).waitFor();
	const ratio = await p.locator(".stage").evaluate((e) => e.getBoundingClientRect().width / e.getBoundingClientRect().height);
	assert.ok(Math.abs(ratio - 1) < 0.02, String(ratio));
	await context.close();
});

test("a fold has one step control under the big view", async () => {
	const { p, context } = await page("reviewed/united-states.kdl");
	await p.locator('.thumb[data-form="fold:triangle"]').click();
	const range = p.getByRole("slider", { name: "Fold step" });
	await range.waitFor();
	assert.equal(await range.getAttribute("max"), "16");
	await p.waitForSelector(".stage-image");
	const before = await p.locator(".stage-image").getAttribute("src");
	await range.focus();
	await p.keyboard.press("Home");
	await p.locator(".fold-step-label", { hasText: "Step 1 of 16" }).waitFor();
	await p.waitForFunction((b) => document.querySelector(".stage-image")?.getAttribute("src") !== b, before);
	await context.close();
});

test("a large artwork flag opens, draws, and selects its artwork as a whole", async () => {
	const { p, context, errors } = await page("flags/brazil/flag-john-v-of-portugal-with-order-of-christ.kdl");
	assert.equal(await p.locator(".status").textContent(), "Valid");
	// Its grid is over 84 million units wide, which Chromium can't draw without help.
	const colored = await p.locator(".stage-image").evaluate(async (img) => {
		await img.decode();
		const c = document.createElement("canvas");
		c.width = 450;
		c.height = 300;
		const g = c.getContext("2d");
		g.drawImage(img, 0, 0, 450, 300);
		const d = g.getImageData(0, 0, 450, 300).data;
		let n = 0;
		for (let i = 0; i < d.length; i += 4) {
			if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) {
				n++;
			}
		}
		return n;
	});
	assert.ok(colored > 5000, `only ${colored} pixels have any color`);
	const svg = await downloadChoice(p, "SVG image");
	const [file] = await Promise.all([p.waitForEvent("download"), svg.click()]);
	assert.ok(readFileSync(await file.path(), "utf8").includes('viewBox="0 0 84675766 '), "what's downloaded is on the file's own grid");
	const rows = await p.locator(".row-group").nth(1).locator(".row").allTextContents();
	assert.ok(rows.some((r) => r.includes("Inline artwork")), rows.join("|"));
	// Whatever the artwork's shape, a click within its box selects it.
	const box = await p.locator('.pick-tree rect[data-vexyl-layer]').last().boundingBox();
	await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	assert.equal(await panelTitle(p), "Inline artwork");
	await p.waitForFunction(() => document.querySelectorAll(".outline-selected-inner > *").length === 1);
	await p.locator(".field", { hasText: "Artwork" }).getByText(/Inline SVG, [\d,]+ characters/).waitFor();
	assert.deepEqual(errors, []);
	await context.close();
});

test("a flag with a variant proportion shows it", async () => {
	const { p, context } = await page("reviewed/bolivia.kdl");
	const forms = await p.locator(".gallery-group").first().locator(".thumb").allTextContents();
	assert.ok(forms.length >= 3, forms.join("|"));
	const variant = p.locator('.thumb[data-form^="variant:"]').first();
	const sub = await variant.locator(".thumb-sub").textContent();
	assert.match(sub, /^\d+(\.\d+)?:\d+(\.\d+)?$/);
	await variant.click();
	await p.waitForFunction(() => document.querySelector(".nx-muted")?.textContent?.includes("variant"));
	await context.close();
});

test("editing through the form changes the value, and nothing else in the file", async () => {
	const { p, context } = await page("reviewed/united-states.kdl");
	const original = readFlag("reviewed/united-states.kdl");
	await row(p, "0").click();
	const count = p.getByLabel("Count");
	assert.equal(await count.inputValue(), "13");
	const image = await p.locator(".stage-image").getAttribute("src");
	await count.fill("7");
	await p.waitForFunction((b) => document.querySelector(".stage-image")?.getAttribute("src") !== b, image);
	const out = await savedText(p);
	const a = original.split("\n");
	const b = out.split("\n");
	assert.equal(a.length, b.length);
	const diff = a.flatMap((l, i) => (l === b[i] ? [] : [[l, b[i]]]));
	assert.deepEqual(diff, [["  count 13", "  count 7"]]);
	await context.close();
});

test("the form covers a charge's kinds of field, and writes each", async () => {
	const { p, context, errors } = await page("reviewed/united-states.kdl");
	await row(p, "1.1").click();
	await p.getByLabel("Rotate", { exact: true }).fill("15");
	await p.getByRole("radiogroup", { name: "Repeat" }).getByRole("radio", { name: "Ring" }).click();
	await p.getByLabel("Radius", { exact: true }).first().fill("0.5");
	await p.waitForFunction(() => document.querySelector(".status")?.textContent === "Valid");
	const out = await savedText(p);
	assert.ok(out.includes("rotate 15"), out);
	assert.match(out, /repeat ring [^\n]*count=6/);
	assert.ok(!out.includes("rows=9"));
	assert.ok(out.includes("Executive Order 10834"), "the rest of it is still there");
	assert.deepEqual(errors, []);
	await context.close();
});

test("a number that isn't one is said so, and the file isn't touched", async () => {
	const { p, context } = await page("reviewed/united-states.kdl");
	await row(p, "0").click();
	await p.getByLabel("Count").fill("many");
	await p.getByText("That needs to be a number.").waitFor();
	assert.equal(await savedText(p), readFlag("reviewed/united-states.kdl"));
	await context.close();
});

test("anything the form can't edit says so, offers the source, and is left alone", async () => {
	const body = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n  b "#445566"\n}\nproportion hoist=10 fly=20\nbars a b {\n  clip {\n    disc {\n      radius 3\n    }\n  }\n  along hoist\n}\n';
	const { p, context, errors } = await page(undefined);
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "Paste" }).click();
	await p.getByLabel("KDL").fill(body);
	await p.getByRole("button", { name: "Open", exact: true }).click();
	await ready(p);
	await row(p, "0").click();
	await p.getByText("The form can't edit this yet").waitFor();
	await p.locator(".source-only").getByText("clip").waitFor();
	await p.getByRole("radiogroup", { name: "Runs along" }).getByRole("radio", { name: "Fly", exact: true }).click();
	await p.waitForFunction(() => document.querySelector(".status")?.textContent === "Valid");
	const out = await savedText(p);
	assert.ok(out.includes("clip {\n    disc {\n      radius 3\n    }\n  }"), out);
	assert.ok(!out.includes("along"), out);
	await p.getByRole("button", { name: "Edit in the source" }).click();
	await p.locator(".cm-line", { hasText: "clip" }).waitFor();
	assert.deepEqual(errors, []);
	await context.close();
});

test("a variant's own outline and border are said to be in the source", async () => {
	const body = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n}\nproportion hoist=10 fly=20\nfield a\nvariant v {\n  outline pennant\n  border a 1\n}\n';
	const { p, context } = await page(undefined);
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "Paste" }).click();
	await p.getByLabel("KDL").fill(body);
	await p.getByRole("button", { name: "Open", exact: true }).click();
	await ready(p);
	await row(p, "variant/v").click();
	await p.locator(".source-only").getByText("outline, border").waitFor();
	await context.close();
});

test("a new variant gets a name of its own, ready to change", async () => {
	const { p, context, errors } = await page("reviewed/japan.kdl");
	const addVariant = async () => {
		await p.getByRole("button", { name: "Add a term" }).click();
		await p.locator(".add-item[data-label='Variant']").click();
	};
	await addVariant();
	const name = p.getByLabel("Name", { exact: true });
	await name.waitFor();
	await p.waitForFunction(() => document.activeElement?.id?.includes("variant-name"));
	assert.equal(await name.inputValue(), "vertical");
	await p.keyboard.type("distress");
	await p.keyboard.press("Enter");
	await p.locator(".panel-head h2", { hasText: "Distress" }).waitFor();
	await p.locator(".thumb[data-form=\"variant:distress\"]").waitFor();

	await p.getByRole("button", { name: /Structure/ }).click();
	await addVariant();
	await p.waitForFunction(() => document.activeElement?.id?.includes("variant-name") && document.activeElement.value === "vertical");
	await p.keyboard.type("distress");
	await p.getByRole("alert").filter({ hasText: "already a variant" }).waitFor();
	await p.keyboard.press("Enter");
	assert.ok(!(await savedText(p)).includes("variant distress {\n  from transpose\n  upright\n}\nvariant distress"), "it's refused");
	await p.keyboard.press("Escape");
	await p.locator(".status", { hasText: "Valid" }).waitFor();
	assert.deepEqual(errors, []);
	await context.close();
});

test("a variant can be turned upside down or all the way around, and keeps its lines", async () => {
	const { p, context, errors } = await page("reviewed/japan.kdl");
	await p.getByRole("button", { name: "Add a term" }).click();
	await p.locator(".add-item[data-label='Variant']").click();
	const turn = (label) => p.getByLabel("Turns by").selectOption({ label });
	await turn("None");
	await p.waitForFunction(() => !document.querySelector("textarea[aria-label='Source for this variant']")?.value.includes("from"));
	await turn("Half turn");
	await turn("Upside down");
	await p.getByRole("radiogroup", { name: "Keep charges upright" }).getByRole("radio", { name: "No" }).click();
	await p.waitForFunction(() => !document.querySelector("textarea[aria-label='Source for this variant']")?.value.includes("upright"));
	await p.locator(".status", { hasText: "Valid" }).waitFor();
	const out = await savedText(p);
	assert.ok(out.includes("variant vertical {\n  from invert\n}"), out);
	assert.deepEqual(errors, []);
	await context.close();
});

test("a term's source can be edited in its panel", async () => {
	const { p, context, errors } = await page("reviewed/japan.kdl");
	await p.getByRole("button", { name: "Add a term" }).click();
	await p.locator(".add-item[data-label='Variant']").click();
	await p.getByLabel("Turns by").waitFor();
	await p.locator(".term-source summary").click();
	const source = p.getByLabel("Source for this variant");
	await source.fill("variant distress {");
	await p.getByRole("button", { name: "Apply" }).click();
	await p.getByRole("alert").filter({ hasText: "can't be read as KDL" }).waitFor();
	await source.fill("variant distress {\n  from invert\n}");
	await p.getByRole("button", { name: "Apply" }).click();
	await p.locator(".panel-head h2", { hasText: "Distress" }).waitFor();
	assert.equal(await p.getByLabel("Turns by").inputValue(), "invert");
	assert.ok((await savedText(p)).includes("variant distress {\n  from invert\n}"));
	assert.deepEqual(errors, []);
	await context.close();
});

test("a color chip can be changed, moved, or made from nothing", async () => {
	const { p, context, errors } = await page("reviewed/italy.kdl");
	await p.locator(".row", { hasText: "Bars" }).first().click();
	const chips = () => p.locator(".color-chip .chip-name").allTextContents();
	const before = await chips();
	assert.equal(before.length, 3);

	await p.locator(".chip-name").nth(0).click();
	await p.getByRole("button", { name: "Move later" }).click();
	await p.waitForFunction((first) => document.querySelectorAll(".chip-name")[1]?.textContent === first, before[0]);
	await p.getByRole("button", { name: "Move earlier" }).click();
	await p.waitForFunction((first) => document.querySelectorAll(".chip-name")[0]?.textContent === first, before[0]);

	await p.locator('[data-chip="2"]').dragTo(p.locator('[data-chip="0"]'));
	await p.waitForFunction((last) => document.querySelectorAll(".chip-name")[0]?.textContent === last, before[2]);

	if (await p.locator(".chip-name").nth(1).getAttribute("aria-expanded") !== "true") {
		await p.locator(".chip-name").nth(1).click();
	}
	await p.locator(`.chip-editor .color-swatch[data-color="${before[2]}"]`).click();
	await p.waitForFunction((v) => document.querySelectorAll(".chip-name")[1]?.textContent === v, before[2]);

	await p.locator(".chips > .color-select .color-new").click();
	await p.getByLabel("New color's name").fill(before[0]);
	await p.getByRole("alert").filter({ hasText: "already a color" }).waitFor();
	await p.getByLabel("New color's name").fill("sky blue");
	await p.getByRole("button", { name: "Add this color" }).click();
	await p.waitForFunction(() => [...document.querySelectorAll(".chip-name")].some((c) => c.textContent === "sky blue"));
	await p.locator(".status", { hasText: "Valid" }).waitFor();
	const out = await savedText(p);
	assert.ok(out.includes('"sky blue" "#888888"'), out);

	await p.getByRole("button", { name: "Edit this color" }).click();
	await p.locator(".panel-head h2", { hasText: before[2] }).waitFor();
	assert.deepEqual(errors, []);
	await context.close();
});

test("what's chosen is only highlighted for a moment, and when hovered", async () => {
	const { p, context } = await page("reviewed/italy.kdl");
	await row(p, "0").click();
	await p.locator(".panel-head h2", { hasText: "Bars" }).waitFor();
	await p.mouse.move(1, 1);
	await p.waitForFunction(() => document.querySelectorAll(".outline-selected-inner > *, .outline-hover-inner > *").length === 0, null, { timeout: 5000 });
	const box = await p.locator(".stage").boundingBox();
	await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await p.waitForFunction(() => document.querySelectorAll(".outline-hover-inner > *").length > 0);
	await context.close();
});

test("an empty box shows how what it wants is written", async () => {
	const { p, context } = await page("reviewed/italy.kdl");
	await row(p, "0").click();
	assert.equal(await p.getByLabel("Ratio", { exact: true }).getAttribute("placeholder"), "e.g. 1 2 1");
	assert.equal(await p.getByLabel("Rotate", { exact: true }).getAttribute("placeholder"), "e.g. 45");
	await context.close();
});

test("a new variant is what the big view shows", async () => {
	const { p, context } = await page("reviewed/italy.kdl");
	await p.getByRole("button", { name: "Add a term" }).click();
	await p.locator(".add-item[data-label='Variant']").click();
	await p.waitForFunction(() => document.querySelector(".nx-muted")?.textContent?.includes("variant"));
	await context.close();
});

test("the add menu is never cut off, however little room there is", async () => {
	const { p, context } = await page("reviewed/japan.kdl");
	await p.setViewportSize({ width: 1000, height: 480 });
	await p.getByRole("button", { name: "Add a term" }).click();
	for (const name of ["Bars", "Gradient"]) {
		const item = p.locator(`.add-item[data-label='${name}']`).first();
		await item.scrollIntoViewIfNeeded();
		const box = await item.boundingBox();
		const page = await p.locator(".form-page").first().boundingBox();
		assert.ok(box.y >= page.y && box.y + box.height <= page.y + page.height, name);
	}
	assert.ok(await p.evaluate(() => {
		const menu = document.querySelector(".add-menu").getBoundingClientRect();
		const page = document.querySelector(".form-page").getBoundingClientRect();
		return menu.left >= page.left && menu.right <= page.right;
	}));
	await context.close();
});

test("layers can be moved and taken out from the structure, by button or by dragging", async () => {
	const { p, context, errors } = await page("reviewed/united-states.kdl");
	const order = () => p.locator(".row-wrap > .row .row-label").allTextContents();
	const before = await order();
	assert.equal(before[0], "Bars");
	await p.locator('[data-row="1"]').hover();
	await p.getByRole("button", { name: `Move ${before[1]} up the list` }).click();
	await p.waitForFunction((first) => document.querySelector(".row-wrap > .row .row-label")?.textContent === first, before[1]);
	assert.equal(await p.locator(".panel-head").count() === 0 || !(await p.locator(".panel-head").isVisible()), true, "the panel stays closed");
	await p.locator('[data-row="1"]').dragTo(p.locator('[data-row="0"]'));
	await p.waitForFunction((first) => document.querySelector(".row-wrap > .row .row-label")?.textContent === first, before[0]);
	await p.getByRole("button", { name: `Remove ${before[0]}` }).click();
	await p.waitForFunction((gone) => ![...document.querySelectorAll(".row-wrap > .row .row-label")].some((r) => r.textContent === gone), before[0]);
	assert.ok(!(await savedText(p)).includes("count 13"));
	assert.deepEqual(errors, []);
	await context.close();
});

test("a flag can be rescaled from its proportion, keeping the picture, and is told what would be rounded", async () => {
	const { p, context, errors } = await page("reviewed/united-states.kdl");
	await p.locator('.row[data-path="proportion"]').click();
	await p.locator(".proportion-shape", { hasText: "10:19" }).waitFor();
	await p.getByLabel("Hoist", { exact: true }).fill("10");
	assert.equal(await p.getByLabel("Fly", { exact: true }).inputValue(), "19");
	await p.locator(".nx-callout.warn", { hasText: "7 becomes 5.384615" }).waitFor();
	await p.getByRole("button", { name: "130:247" }).click();
	await p.waitForFunction(() => !document.querySelector(".nx-callout.warn") && [...document.querySelectorAll("button")].some((b) => b.textContent === "Rescale"));
	await p.getByRole("button", { name: "Rescale", exact: true }).click();
	await p.waitForFunction(() => document.querySelector(".panel .nx-note")?.textContent?.includes("247 wide by 130 tall"));
	const out = await savedText(p);
	assert.ok(out.includes("proportion hoist=130 fly=247") && out.includes("fly 98.8") && out.includes("hoist 70") && out.includes("radius 4.004"), out);
	assert.ok(out.includes("count 13") && out.includes("rows=9"), "what isn't a length stays");
	await p.locator(".status", { hasText: "Valid" }).waitFor();
	assert.deepEqual(errors, []);
	await context.close();
});

test("the source view's cursor can be seen in either theme", async () => {
	for (const colorScheme of ["dark", "light"]) {
		const { p, context } = await page("reviewed/japan.kdl", { colorScheme });
		await p.getByRole("radio", { name: "Source" }).or(p.getByRole("tab", { name: "Source" })).first().click();
		await p.locator(".cm-content").click();
		const [caret, ink] = await p.locator(".cm-content").evaluate((content) => {
			const probe = document.createElement("span");
			probe.style.color = "var(--ink)";
			document.body.append(probe);
			return [getComputedStyle(content).caretColor, getComputedStyle(probe).color];
		});
		assert.equal(caret, ink);
		await context.close();
	}
});

test("a number can be typed one key at a time into any box, without losing its place", async () => {
	const { p, context, errors } = await page(undefined);
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("button", { name: "Start a new flag" }).click();
	await startFlag(p);
	for (const name of ["Lozenge", "Star", "Rectangle", "Band", "Cross", "Canton", "Panel"]) {
		await p.getByRole("button", { name: "Add a term" }).click();
		await p.locator(`.add-item[data-label='${name}']`).first().click();
		await p.locator(".row-wrap .row", { hasText: name }).click();
		await p.locator(".panel-head h2", { hasText: name }).waitFor();
		const boxes = p.locator('.panel input[inputmode="decimal"]:visible');
		assert.ok(await boxes.count() > 0, name);
		// Giving a value can show or hide the boxes that depend on it.
		for (let i = 0; i < await boxes.count(); i++) {
			const box = boxes.nth(i);
			await box.click();
			await box.fill("");
			await p.keyboard.type("1", { delay: 40 });
			await p.waitForTimeout(60);
			await p.keyboard.type(".");
			assert.equal(await p.getByText("That needs to be a number.").count(), 0, `${name} ${i}: mid-number`);
			await p.keyboard.type("5", { delay: 40 });
			await p.waitForTimeout(60);
			assert.equal(await boxes.nth(i).inputValue(), "1.5", `${name} box ${i}`);
			assert.ok(await boxes.nth(i).evaluate((e) => e === document.activeElement), `${name} box ${i} keeps the cursor`);
		}
		await p.getByRole("button", { name: /Structure/ }).click();
		await p.locator(".row-wrap").last().hover();
		await p.getByRole("button", { name: /^Remove / }).last().click();
		await p.waitForFunction(() => document.querySelectorAll(".row-wrap").length <= 1);
	}
	assert.deepEqual(errors, []);
	await context.close();
});

test("a position given on one axis stays centered on the other, and .5 can be typed", async () => {
	const { p, context } = await page(undefined);
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("button", { name: "Start a new flag" }).click();
	await startFlag(p);
	await p.getByRole("button", { name: "Add a term" }).click();
	await p.locator(".add-item[data-label='Lozenge']").click();
	await p.locator(".row-wrap .row", { hasText: "Lozenge" }).click();
	const from = p.getByLabel("From the hoist edge");
	assert.equal(await p.getByLabel("From the top").getAttribute("placeholder"), "Center, 30");
	await from.click();
	await p.keyboard.type(".5", { delay: 40 });
	await p.waitForFunction(() => document.querySelector("textarea[aria-label^='Source']")?.value.includes("at fly=0.5 hoist=30"));
	await from.fill("");
	await p.waitForFunction(() => !document.querySelector("textarea[aria-label^='Source']")?.value.includes("at fly"));
	await context.close();
});

test("a mistake is shown at the box it's about, even far down a panel", async () => {
	const { p, context } = await page("reviewed/united-states.kdl");
	await p.setViewportSize({ width: 1440, height: 700 });
	await row(p, "1.1").click();
	const points = p.getByLabel("Points", { exact: true });
	await points.fill("3");
	const problem = p.locator(".field-problem", { has: p.getByLabel("Inner", { exact: true }) }).locator(".nx-error");
	await problem.waitFor();
	assert.ok(await problem.evaluate((e) => {
		const box = e.getBoundingClientRect();
		const page = e.closest(".form-page").getBoundingClientRect();
		return box.top >= page.top && box.bottom <= page.bottom + 60;
	}), "it can be seen from where the typing is");
	assert.ok(!(await problem.textContent()).includes("`"), "and is in the form's words");
	await context.close();
});

test("the form and the flag use the room there is, and the flag stops when it fills its width", async () => {
	const { p, context } = await page("reviewed/japan.kdl");
	await p.setViewportSize({ width: 1500, height: 1500 });
	await p.waitForTimeout(300);
	const sizes = () => p.evaluate(() => {
		const r = (q) => document.querySelector(q).getBoundingClientRect();
		const stage = r(".stage");
		return { form: r(".editor-body").height, formBottom: r(".editor").bottom, about: r('[aria-label="About this file"]').bottom, box: r(".stage-box").width, stage: stage.width, stageHeight: stage.height, h: innerHeight };
	});
	let s = await sizes();
	assert.ok(s.form > 640, `the form grows: ${s.form}`);
	assert.ok(s.about >= s.h - 60, `the left column reaches the bottom: ${s.about} of ${s.h}`);
	assert.ok(s.stage > s.box * 0.9, `the flag fills its width: ${s.stage} of ${s.box}`);
	assert.ok(Math.abs(s.stage / s.stageHeight - 1.5) < 0.02, "at its own shape");
	await p.setViewportSize({ width: 1440, height: 700 });
	await p.waitForTimeout(300);
	s = await sizes();
	assert.equal(Math.round(s.form), 640, "and stays usable when there's little room");
	await context.close();
});

test("what depends on something else appears once that's given", async () => {
	const { p, context } = await page("reviewed/japan.kdl");
	await p.getByRole("button", { name: "Add a term" }).click();
	await p.locator(".add-item[data-label='Chevrons']").click();
	await p.locator(".row-wrap .row", { hasText: "Chevrons" }).click();
	assert.equal(await p.getByLabel("Apex").count(), 0);
	await p.getByLabel("Angle", { exact: true }).fill("30");
	await p.getByLabel("Apex").waitFor();
	await context.close();
});

test("colors and shapes are chosen by seeing them", async () => {
	const { p, context, errors } = await page("reviewed/united-states.kdl");
	await row(p, "1.1").click();
	await p.locator('.shape-tile[data-shape="disc"]').click();
	await p.locator('.shape-tile.on[data-shape="disc"]').waitFor();
	await p.locator('[aria-label="Color"] .color-swatch[data-color="red"]').click();
	await p.locator('[aria-label="Color"] .color-swatch.on[data-color="red"]').waitFor();
	await p.locator('[aria-label="Color"] .color-name', { hasText: "red" }).waitFor();
	await p.locator('[aria-label="Fimbriation color"] .color-swatch[data-color="blue"]').click();
	await p.waitForFunction(() => document.querySelector("textarea[aria-label^='Source']") !== null);
	const out = await savedText(p);
	assert.ok(out.includes("charge disc red") && out.includes("fimbriate blue"), out);
	assert.deepEqual(errors, []);
	await context.close();
});

test("a long palette names each color", async () => {
	const colors = Array.from({ length: 13 }, (_, i) => `  c${i} "#${String(i + 10).padStart(2, "0")}3344"`).join("\n");
	const body = `vexyl 1\nmeta {\n  name "T"\n}\npalette {\n${colors}\n}\nproportion hoist=2 fly=3\nfield c0\n`;
	const { p, context } = await page(undefined);
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "Paste" }).click();
	await p.getByLabel("KDL").fill(body);
	await p.getByRole("button", { name: "Open", exact: true }).click();
	await ready(p);
	await row(p, "0").click();
	await p.locator('.color-named[data-color="c12"]', { hasText: "c12" }).click();
	await p.locator('.color-named.on[data-color="c12"]').waitFor();
	await context.close();
});

test("what a flag can only have one of isn't offered twice, and a new flag can be started at any time", async () => {
	const { p, context } = await page("reviewed/japan.kdl");
	const add = p.getByRole("button", { name: "Add a term" });
	await add.click();
	await p.locator(".add-item[data-label='Adapt']").click();
	await p.locator(".status", { hasText: "Valid" }).waitFor();
	await p.waitForFunction(() => document.querySelector(".row[data-path='adapt']") !== null);
	await add.click();
	assert.equal(await p.locator(".add-item[data-label='Adapt']").count(), 0);
	await p.keyboard.press("Escape");
	await p.getByRole("link", { name: "Open a flag" }).click();
	await p.getByRole("button", { name: "Start a new flag" }).waitFor();
	await context.close();
	const fresh = await page("reviewed/japan.kdl");
	await fresh.p.getByRole("button", { name: "New flag" }).click();
	await startFlag(fresh.p);
	await fresh.p.locator(".row", { hasText: "Field" }).first().waitFor();
	assert.ok((await savedText(fresh.p)).includes('name "New flag"'));
	await fresh.p.locator(".status", { hasText: "Valid" }).waitFor();
	await fresh.context.close();
});

test("add a term offers a skeleton that's valid, for every kind it offers", async () => {
	const { p, context, errors } = await page("reviewed/japan.kdl");
	const add = p.getByRole("button", { name: "Add a term" });
	await add.click();
	const names = await p.locator(".add-item").allTextContents();
	assert.ok(names.length > 25, names.join("|"));
	await p.keyboard.press("Escape");
	for (const name of ["Bars", "Canton", "Star", "Crescent", "Polygon", "Inline artwork", "Adapt"]) {
		await add.click();
		await p.locator(`.add-item[data-label='${name}']`).first().click();
		await p.waitForFunction(() => !document.querySelector(".spinner"));
		await p.locator(".status", { hasText: "Valid" }).waitFor();
	}
	const out = await savedText(p);
	assert.ok(out.includes("Act") || out.includes("//"), "what was there still is");
	assert.deepEqual(errors, []);
	await context.close();
});

test("removing and moving layers keep the file's other text", async () => {
	const { p, context } = await page("reviewed/united-states.kdl");
	await row(p, "1").click();
	await p.getByRole("button", { name: "Move down a layer" }).click();
	await row(p, "0").waitFor();
	await p.waitForFunction(() => document.querySelector('.row[data-path="0"]')?.textContent?.includes("Canton"));
	const moved = await savedText(p);
	assert.ok(moved.indexOf("canton {") < moved.indexOf("bars red white"));
	assert.ok(moved.includes("variant vertical"));
	await row(p, "0").click();
	await p.getByRole("button", { name: "Remove" }).last().click();
	await p.waitForFunction(() => !document.querySelector('.row[data-path="1"]'));
	const removed = await savedText(p);
	assert.ok(!removed.includes("canton {"));
	assert.ok(removed.includes("Executive Order 10834"));
	await context.close();
});

test("About this file shows laws, licenses and the evidence tier", async () => {
	const { p, context } = await page("reviewed/united-states.kdl");
	const about = p.getByRole("region", { name: "About this file" });
	await about.getByRole("link", { name: "Executive Order 10834" }).waitFor();
	await about.getByText("File: CC BY-SA 4.0").waitFor();
	await about.getByText("Renders: CC0").waitFor();
	await about.getByText("Law read, tier A").waitFor();
	const link = about.getByRole("link", { name: "Executive Order 10834" });
	assert.equal(await link.getAttribute("rel"), "noopener noreferrer nofollow");
	await context.close();
});

test("a CRLF file stays CRLF", async () => {
	const { p, context } = await page(undefined);
	const body = 'vexyl 1\r\n// kept\r\nmeta {\r\n  name "T"\r\n}\r\npalette {\r\n  a "#112233"\r\n}\r\nproportion hoist=1 fly=2\r\nfield a\r\n';
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "This computer" }).click();
	await p.locator('input[type="file"]').setInputFiles({ name: "crlf.kdl", mimeType: "text/plain", buffer: Buffer.from(body) });
	await ready(p);
	assert.equal(await savedText(p), body);
	await p.locator('.row[data-path="proportion"]').click();
	await p.getByRole("radio", { name: "Change the shape" }).click();
	await p.getByLabel("Fly").fill("3");
	await p.locator(".dirty").waitFor();
	assert.equal(await savedText(p), body.replace("fly=2", "fly=3"));
	await context.close();
});

const focused = (p) => p.evaluate(() => document.activeElement?.textContent ?? "");

/** The file as it's saved, once it's what's wanted, or as it is after a while. */
async function savedUntil(p, wanted) {
	const until = Date.now() + 15000;
	for (;;) {
		const text = await savedText(p);
		if (wanted(text) || Date.now() > until) {
			return text;
		}
		await p.waitForTimeout(100);
	}
}

test("on a narrow screen the top bar's other buttons are in a menu, which works from the keyboard", async () => {
	const { p, context, errors } = await page("reviewed/united-states.kdl", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	for (const name of ["New flag", "Open a flag", "Share", "Compare"]) {
		assert.equal(await p.locator(".topbar").getByRole(name === "New flag" ? "button" : "link", { name, exact: true }).count(), 0, name);
	}
	assert.equal(await p.locator(".topbar").getByRole("radiogroup", { name: "Editor" }).count(), 0);
	const menu = p.getByRole("button", { name: "Menu", exact: true });
	const top = await menu.boundingBox();
	for (const other of [p.locator(".brand"), p.locator(".topbar .file-name"), p.locator(".topbar .status"), p.getByRole("button", { name: "Download", exact: true })]) {
		const box = await other.boundingBox();
		assert.ok(Math.abs(box.y + box.height / 2 - (top.y + top.height / 2)) < 4, "it's all one row");
	}
	// It's reached by Tab, like anything else.
	await p.locator("body").focus();
	for (let i = 0; i < 10 && (await p.evaluate(() => document.activeElement?.getAttribute("aria-haspopup") !== "menu" || document.activeElement.textContent !== "Menu")); i++) {
		await p.keyboard.press("Tab");
	}
	assert.equal(await focused(p), "Menu");
	assert.equal(await menu.getAttribute("aria-expanded"), "false");
	await p.keyboard.press("Enter");
	assert.equal(await menu.getAttribute("aria-expanded"), "true");
	const items = p.getByRole("menu", { name: "Menu" }).locator('[role^="menuitem"]');
	assert.deepEqual(await items.allTextContents(), ["New flag", "Open a flag", "Share", "Compare", "Basic", "✓Advanced"]);
	assert.equal(await focused(p), "New flag");
	await p.keyboard.press("ArrowDown");
	assert.equal(await focused(p), "Open a flag");
	await p.keyboard.press("End");
	assert.equal(await focused(p), "✓Advanced");
	await p.keyboard.press("ArrowDown");
	assert.equal(await focused(p), "New flag", "it goes round");
	await p.keyboard.press("ArrowUp");
	assert.equal(await focused(p), "✓Advanced");
	await p.keyboard.press("Home");
	assert.equal(await focused(p), "New flag");
	await p.keyboard.press("Escape");
	assert.equal(await menu.getAttribute("aria-expanded"), "false");
	assert.equal(await focused(p), "Menu", "the focus goes back to the button");
	// Up opens it at its end, and Enter picks what's focused.
	await p.keyboard.press("ArrowUp");
	assert.equal(await focused(p), "✓Advanced");
	await p.keyboard.press("ArrowUp");
	await p.keyboard.press("ArrowUp");
	assert.equal(await focused(p), "Compare");
	await p.keyboard.press("Enter");
	await p.locator(".compare").waitFor();
	assert.deepEqual(errors, []);
	await context.close();
});

test("the narrow screen's menu works by pointer, and closes when anywhere else is clicked", async () => {
	const { p, context, errors } = await page("reviewed/united-states.kdl", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	const menu = p.getByRole("button", { name: "Menu", exact: true });
	await menu.click();
	await p.getByRole("menu", { name: "Menu" }).waitFor();
	await p.locator(".flag-name").click();
	assert.equal(await p.getByRole("menu").count(), 0);
	assert.equal(await menu.getAttribute("aria-expanded"), "false");
	assert.equal(await focused(p), "Menu", "the focus goes back to the button");
	// It switches editors, and Basic has the same menu, without Compare.
	await menu.click();
	await p.getByRole("menuitemradio", { name: "Basic" }).click();
	await p.getByRole("button", { name: "Add to the flag" }).waitFor();
	await menu.click();
	assert.deepEqual(await p.getByRole("menu", { name: "Menu" }).locator('[role^="menuitem"]').allTextContents(), ["New flag", "Open a flag", "Share", "✓Basic", "Advanced"]);
	assert.equal(await p.getByRole("menuitemradio", { name: "Basic" }).getAttribute("aria-checked"), "true");
	await p.getByRole("menuitem", { name: "Share" }).click();
	await p.getByLabel("Link to share").waitFor();
	assert.deepEqual(errors, []);
	await context.close();
});

test("the editor's switch never wraps at phone width, and its hint goes below it", async () => {
	const { p, context } = await page(undefined, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	await p.goto(`${srv.base}?view=new`);
	await startFlag(p, "stripes-block");
	const oneLine = async (label, count) => {
		const boxes = await Promise.all((await p.getByRole("radiogroup", { name: label }).getByRole("radio").all()).map((r) => r.boundingBox()));
		assert.equal(boxes.length, count, label);
		assert.ok(boxes.every((b) => Math.abs(b.y - boxes[0].y) < 1 && b.height < 40), `${label}: ${JSON.stringify(boxes)}`);
		return boxes[0];
	};
	await oneLine("Edit as", 2);
	await p.getByRole("radio", { name: "Source" }).click();
	const seg = await oneLine("Edit as", 2);
	const hint = await p.getByText("Escape, then Tab, leaves the editor").boundingBox();
	assert.ok(hint.y > seg.y + seg.height - 1, "the hint is on a line of its own");
	await fromTopbar(p, "Basic");
	await p.getByRole("radiogroup", { name: "What to work on" }).waitFor();
	for (const tab of ["Design", "Details", "Source"]) {
		await p.getByRole("radio", { name: tab }).click();
		const first = await oneLine("What to work on", 3);
		if (tab === "Source") {
			const below = await p.getByText("Escape, then Tab, leaves the editor").boundingBox();
			assert.ok(below.y > first.y + first.height - 1, "the hint is on a line of its own");
		}
	}
	assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
	await context.close();
});

test("Advanced has one Download, for an SVG image or the KDL file, and the file is saved by it", async () => {
	const { p, context, errors } = await page("reviewed/japan.kdl");
	assert.equal(await p.locator(".topbar").getByRole("button", { name: /^Download/ }).count(), 1);
	const kdl = await downloadChoice(p, "KDL file");
	assert.deepEqual(await p.getByRole("menu", { name: "What to download" }).getByRole("menuitem").allTextContents(), ["SVG image", "KDL file"]);
	await p.keyboard.press("Escape");
	assert.equal(await focused(p), "Download");
	assert.equal(await kdl.count(), 0);
	await p.locator('.row[data-path="0"]').click();
	await p.locator(".color-swatch[data-color='red']").click();
	await p.locator(".dirty").waitFor();
	const [file] = await Promise.all([p.waitForEvent("download"), (await downloadChoice(p, "KDL file")).click()]);
	assert.equal(file.suggestedFilename(), "japan.kdl");
	await p.waitForFunction(() => document.querySelector(".dirty") === null);
	await p.getByText("Downloaded the KDL.").first().waitFor();
	const [svg] = await Promise.all([p.waitForEvent("download"), (await downloadChoice(p, "SVG image")).click()]);
	assert.equal(svg.suggestedFilename(), "japan.svg");
	assert.deepEqual(errors, []);
	await context.close();
});

test("removing a color something uses asks what's to take its place, and that's one thing to undo", async () => {
	const { p, context, errors } = await page("reviewed/united-states.kdl");
	const before = await savedText(p);
	await row(p, "palette").click();
	// One that nothing uses goes at once, as before.
	await p.getByRole("button", { name: "Add a color" }).click();
	await p.locator(".panel-head h2", { hasText: "color" }).waitFor();
	const made = await panelTitle(p);
	await p.getByRole("button", { name: "Remove", exact: true }).click();
	await row(p, "palette").waitFor();
	assert.ok(!(await savedText(p)).includes(`${made} "`), "the new color's gone");
	await row(p, "palette").click();
	await p.locator('.color-chip[data-path="palette/red"]').click();
	const remove = p.getByRole("button", { name: "Remove", exact: true });
	await remove.click();
	assert.equal(await remove.getAttribute("aria-expanded"), "true");
	const ask = p.getByRole("group", { name: "Replace red" });
	assert.match(await ask.textContent(), /^red is used by bars\. Replace it with:/);
	assert.deepEqual(await ask.locator(".color-named").allTextContents(), ["white", "blue"]);
	await ask.getByRole("button", { name: "Cancel" }).click();
	assert.equal(await ask.count(), 0);
	assert.equal(await savedText(p), before, "nothing changed until a color was chosen");
	await remove.click();
	await ask.getByRole("button", { name: "Replace it with white" }).click();
	await row(p, "palette").waitFor();
	assert.equal(await savedText(p), before.replace(/\n {2}red "#b31942" \{\n[^}]*\n {2}\}\n/, "\n").replace("bars red white {", "bars white white {"));
	await p.locator(".status", { hasText: "Valid" }).waitFor();
	await p.locator(".flag-name").click();
	await p.keyboard.press("Control+z");
	assert.equal(await savedUntil(p, (t) => t === before), before, "one undo puts it all back");
	assert.deepEqual(errors, []);
	await context.close();
});
