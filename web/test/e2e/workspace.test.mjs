// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launch, mockWorld, openUrl, readFlag, ready, savedText, serve, watch } from "./helpers.mjs";

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
	assert.ok((await details.locator("pre").textContent()).startsWith("bars red white"));
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
	assert.equal(await p.locator(".small-64").getAttribute("src"), await big());
	assert.equal(await p.locator(".small-16").getAttribute("src"), await big());
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
	const [file] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Download SVG" }).click()]);
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

test("add a term offers a skeleton that's valid, for every kind it offers", async () => {
	const { p, context, errors } = await page("reviewed/japan.kdl");
	const add = p.getByRole("button", { name: "Add a term" });
	await add.click();
	const names = await p.locator(".add-item").allTextContents();
	assert.ok(names.length > 25, names.join("|"));
	await p.keyboard.press("Escape");
	for (const name of ["Bars", "Canton", "Star", "Crescent", "Polygon", "Inline artwork", "Adapt"]) {
		await add.click();
		await p.locator(".add-item", { hasText: new RegExp(`^${name}$`) }).first().click();
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
	await p.getByLabel("Fly").fill("3");
	await p.locator(".dirty").waitFor();
	assert.equal(await savedText(p), body.replace("fly=2", "fly=3"));
	await context.close();
});
