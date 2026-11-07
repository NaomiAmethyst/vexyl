// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
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

async function azerbaijan() {
	const context = await browser.newContext({ viewport: { width: 1440, height: 1120 }, colorScheme: "dark" });
	await mockWorld(context);
	const p = await context.newPage();
	const errors = watch(p);
	await p.goto(openUrl(srv.base, "reviewed/azerbaijan-1991.kdl"));
	await ready(p);
	await p.getByRole("link", { name: "Compare" }).click();
	await p.locator(".pick-box", { hasText: "Azerbaijan 2018" }).waitFor({ timeout: 30000 });
	return { p, context, errors };
}

const view = (p, name) => p.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name }).click();

test("the other version in a series is found, and the table says what the mock says", async () => {
	const { p, context, errors } = await azerbaijan();
	await p.locator(".compare-h1", { hasText: "Azerbaijan, 1991 and 2018" }).waitFor();
	const rows = await p.locator("table.changes tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent)));
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
	await p.getByText("Unchanged: the 1:2 proportion, three equal bars, and an eight-pointed star.").waitFor();
	await p.getByText("since these files use different grids").waitFor();
	assert.deepEqual(errors, []);
	await context.close();
});

test("side by side shows both", async () => {
	const { p, context } = await azerbaijan();
	await p.locator(".side-fig img").nth(1).waitFor();
	assert.equal(await p.locator(".side-fig img").count(), 2);
	await context.close();
});

test("the slider drags directly on the flags, and works from the keyboard", async () => {
	const { p, context } = await azerbaijan();
	await view(p, "Slider");
	const stage = p.locator(".slider-stage");
	await stage.waitFor();
	const box = await stage.boundingBox();
	await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await p.mouse.down();
	await p.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 4 });
	await p.mouse.up();
	assert.equal(await stage.getAttribute("data-at"), "20");
	const bar = p.getByRole("slider", { name: "How much of A to show" });
	assert.equal(await bar.inputValue(), "20");
	await bar.focus();
	await p.keyboard.press("ArrowRight");
	await p.keyboard.press("ArrowRight");
	assert.equal(await stage.getAttribute("data-at"), "22");
	await context.close();
});

test("differences are shapes only, zoomed, and the share is the mock's", async () => {
	const { p, context } = await azerbaijan();
	await view(p, "Differences");
	const key = p.locator("[data-percent]");
	await p.waitForFunction(() => document.querySelector("[data-percent]")?.getAttribute("data-percent") !== "");
	const percent = Number(await key.getAttribute("data-percent"));
	assert.ok(Math.abs(percent - 1.23) < 0.15, `they differ in ${percent}%`);
	await p.getByText("Only in A").waitFor();
	await p.getByText("Only in B").waitFor();
	// It has both marks in it, and it's been zoomed from the flag's whole width.
	const counts = await p.locator(".diff-canvas").evaluate((c) => {
		const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
		let a = 0;
		let b = 0;
		for (let i = 0; i < d.length; i += 4) {
			if (d[i] === 255 && d[i + 1] === 92) {
				a++;
			} else if (d[i] === 120 && d[i + 1] === 230) {
				b++;
			}
		}
		return { a, b, share: (a + b) / (c.width * c.height) };
	});
	assert.ok(counts.a > 0 && counts.b > 0, JSON.stringify(counts));
	assert.ok(counts.share > 0.05, `zoomed, it covers ${counts.share}`);
	await context.close();
});

test("the source diff has changed lines or the whole file", async () => {
	const { p, context } = await azerbaijan();
	await view(p, "Source");
	await p.locator(".side-diff-row.changed").first().waitFor();
	const changed = await p.locator(".side-diff-row:not(.head)").count();
	await p.getByRole("radiogroup", { name: "Which lines" }).getByRole("radio", { name: "Whole file" }).click();
	await p.waitForFunction((n) => document.querySelectorAll(".side-diff-row:not(.head)").length > n, changed);
	await p.getByText("A: azerbaijan-1991.kdl").waitFor();
	await p.getByText("B: azerbaijan.kdl").waitFor();
	await context.close();
});

test("either side can be changed to any file, and to a drawing", async () => {
	const { p, context, errors } = await azerbaijan();
	await p.getByRole("button", { name: "Change B" }).click();
	await p.getByRole("radiogroup", { name: "Choose from" }).getByRole("radio", { name: "Any file" }).click();
	await p.getByRole("tab", { name: "Paste" }).click();
	await p.getByLabel("KDL").fill('vexyl 1\nmeta {\n  name "Other"\n}\npalette {\n  a "#123456"\n}\nproportion hoist=1 fly=2\nfield a\n');
	await p.getByRole("button", { name: "Open", exact: true }).click();
	await p.locator(".pick-box", { hasText: "Other" }).waitFor();
	await p.getByRole("button", { name: "Change B" }).click();
	await p.getByRole("radiogroup", { name: "Choose from" }).getByRole("radio", { name: "A drawing" }).click();
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1" width="1200" height="600"><rect width="2" height="1" fill="#00b5e2"/><script>globalThis.pwned=1</script></svg>';
	await p.locator('.chooser input[type="file"]').setInputFiles({ name: "drawing.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
	await p.locator(".pick-box", { hasText: "drawing.svg" }).waitFor();
	await view(p, "Differences");
	await p.waitForFunction(() => document.querySelector("[data-percent]")?.getAttribute("data-percent") !== "");
	await view(p, "Source");
	await p.getByText("A drawing has no source to compare.").waitFor();
	assert.equal(await p.evaluate(() => globalThis.pwned), undefined);
	assert.deepEqual(errors, []);
	await context.close();
});
