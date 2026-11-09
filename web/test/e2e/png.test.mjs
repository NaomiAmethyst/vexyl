// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Pictures as PNG: of a view of the flag, at a height in pixels, and of a construction sheet, at so
// many dots per inch, each made smaller when a browser couldn't draw it, which the page then says.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { downloadChoice, launch, mockWorld, openUrl, ready, serve, watch } from "./helpers.mjs";

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
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark", acceptDownloads: true });
	await mockWorld(context, opts);
	// Keeps every SVG the page makes into a picture, so that a test can see what a PNG was drawn from.
	await context.addInitScript(() => {
		const make = URL.createObjectURL.bind(URL);
		globalThis.__svgs = [];
		URL.createObjectURL = (b) => {
			if (b instanceof Blob && b.type === "image/svg+xml") {
				globalThis.__svgs.push(b);
			}
			return make(b);
		};
	});
	const p = await context.newPage();
	const errors = watch(p);
	await p.goto(openUrl(srv.base, path));
	await ready(p);
	return { p, context, errors };
}

/** A PNG's size, from its header. */
function pngSize(bytes) {
	assert.equal(bytes.subarray(0, 8).toString("latin1"), "\x89PNG\r\n\x1a\n");
	assert.equal(bytes.subarray(12, 16).toString("latin1"), "IHDR");
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Some of a PNG's pixels, as [r, g, b, a], at shares of its width and height, decoded by drawing it on a blank page. */
async function pixels(context, bytes, points) {
	const blank = await context.newPage();
	const out = await blank.evaluate(async ({ b64, points }) => {
		const img = new Image();
		img.src = `data:image/png;base64,${b64}`;
		await img.decode();
		const c = document.createElement("canvas");
		c.width = img.naturalWidth;
		c.height = img.naturalHeight;
		const g = c.getContext("2d");
		g.drawImage(img, 0, 0);
		return points.map(([x, y]) => [...g.getImageData(Math.min(c.width - 1, Math.floor(x * c.width)), Math.min(c.height - 1, Math.floor(y * c.height)), 1, 1).data]);
	}, { b64: bytes.toString("base64"), points });
	await blank.close();
	return out;
}

const near = (got, want, what) => {
	assert.ok(got.every((v, i) => Math.abs(v - want[i]) <= 3), `${what}: ${got} isn't ${want}`);
};

const hex = (h, a = 255) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(a);

async function downloaded(p, click) {
	const [file] = await Promise.all([p.waitForEvent("download"), click()]);
	return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test("Advanced downloads the flag as a PNG at a height, shaped flags staying transparent, and remembers the height", async () => {
	const { p, context, errors } = await page("flags/country/nepal.kdl");
	await (await downloadChoice(p, "PNG image…")).click();
	const dialog = p.getByRole("dialog", { name: "Download a PNG" });
	await dialog.waitFor();
	const height = dialog.getByLabel("Height, in pixels");
	assert.equal(await height.inputValue(), "1200");
	await height.fill("600");
	await dialog.getByText("492 × 600 pixels.").waitFor();
	const png = await downloaded(p, () => dialog.getByRole("button", { name: "Download PNG" }).click());
	assert.equal(png.name, "nepal.png");
	assert.deepEqual(pngSize(png.bytes), { width: 492, height: 600 });
	const [corner, crimson, border] = await pixels(context, png.bytes, [[0.97, 0.03], [0.55, 0.9], [0.015, 0.5]]);
	assert.equal(corner[3], 0, "outside the pennants is transparent");
	near(crimson, hex("#dc143c"), "the field");
	near(border, hex("#003893"), "the border");
	await p.getByText("Downloaded the PNG.").first().waitFor();
	assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem("vexyl.picture"))), { format: "svg", height: 600 });
	await p.reload();
	await ready(p);
	await (await downloadChoice(p, "PNG image…")).click();
	assert.equal(await p.getByLabel("Height, in pixels").inputValue(), "600");
	await p.getByRole("button", { name: "Cancel" }).click();
	assert.deepEqual(errors, []);
	await context.close();
});

test("every view downloads as a PNG of that view, and one too big is made smaller, saying so", async () => {
	const { p, context, errors } = await page("flags/country/united-states.kdl");
	// A fold, partway through.
	await p.locator('.thumb[data-form="fold:triangle"]').click();
	await p.getByRole("slider", { name: "Fold step" }).waitFor();
	await p.getByRole("slider", { name: "Fold step" }).fill("2");
	await p.waitForFunction(() => /step 2/i.test(document.querySelector(".fold-step-label")?.textContent ?? ""));
	const svgOf = async () => {
		const [svg] = await Promise.all([p.waitForEvent("download"), (await downloadChoice(p, "SVG image")).click()]);
		const text = readFileSync(await svg.path(), "utf8");
		const root = /<svg\b[^>]*>/.exec(text)[0];
		return { width: Number(/\swidth="([^"]*)"/.exec(root)[1]), height: Number(/\sheight="([^"]*)"/.exec(root)[1]) };
	};
	const own = await svgOf();
	await (await downloadChoice(p, "PNG image…")).click();
	await p.getByLabel("Height, in pixels").fill("300");
	const png = await downloaded(p, () => p.getByRole("button", { name: "Download PNG" }).click());
	const size = pngSize(png.bytes);
	assert.equal(size.height, 300);
	assert.equal(size.width, Math.round((300 * own.width) / own.height), "the fold step's own shape");
	// The reverse, which has its own colours in the same places, at a size no browser draws.
	await p.locator('.thumb[data-form="reverse"]').click();
	await p.waitForFunction(() => document.querySelector('.thumb[data-form="reverse"]')?.getAttribute("aria-pressed") === "true");
	await (await downloadChoice(p, "PNG image…")).click();
	await p.getByLabel("Height, in pixels").fill("20000");
	const note = p.locator(".picture-dialog .png-capped");
	await note.waitFor();
	const told = /so the PNG will be (\d+) × (\d+) pixels/.exec(await note.textContent());
	assert.ok(told !== null, await note.textContent());
	const big = await downloaded(p, () => p.getByRole("button", { name: "Download PNG" }).click());
	const bigSize = pngSize(big.bytes);
	assert.deepEqual(bigSize, { width: Number(told[1]), height: Number(told[2]) });
	assert.ok(bigSize.width * bigSize.height <= 16777216 && bigSize.width <= 16384);
	await p.getByText(`Downloaded the PNG, at ${told[1]} × ${told[2]}, the most a browser can draw.`).first().waitFor();
	// Its canton is at the fly, as the reverse's is.
	const [canton, hoistStripe] = await pixels(context, big.bytes, [[0.8, 0.25], [0.2, 0.02]]);
	near(canton, hex("#0a3161"), "the canton, at the fly");
	near(hoistStripe, hex("#b31942"), "a red stripe");
	assert.deepEqual(errors, []);
	await context.close();
});

test("the Share page and Basic choose between SVG and PNG, and the choice is remembered", async () => {
	const { p, context, errors } = await page("flags/country/japan.kdl");
	await p.getByRole("link", { name: "Share" }).click();
	await p.getByRole("radio", { name: "PNG" }).click();
	await p.getByLabel("Height, in pixels").fill("200");
	await p.getByText("300 × 200 pixels.").waitFor();
	const png = await downloaded(p, () => p.getByRole("button", { name: "Download PNG" }).click());
	assert.equal(png.name, "japan.png");
	assert.deepEqual(pngSize(png.bytes), { width: 300, height: 200 });
	const [field, disc] = await pixels(context, png.bytes, [[0.05, 0.05], [0.5, 0.5]]);
	near(field, hex("#ffffff"), "the field");
	near(disc, hex("#b0000f"), "the disc");
	await p.getByRole("link", { name: "Done" }).click();
	await p.getByRole("radio", { name: "Basic" }).click();
	const [picture] = await Promise.all([p.waitForEvent("download"), (async () => {
		await (await downloadChoice(p, "A picture of the flag…")).click();
		const dialog = p.getByRole("dialog", { name: "Download a picture" });
		assert.equal(await dialog.getByRole("radio", { name: "PNG" }).getAttribute("aria-checked"), "true", "PNG, as chosen before");
		assert.equal(await dialog.getByLabel("Height, in pixels").inputValue(), "200");
		await dialog.getByRole("button", { name: "Download PNG" }).click();
	})()]);
	assert.equal(picture.suggestedFilename(), "japan.png");
	assert.deepEqual(pngSize(readFileSync(await picture.path())), { width: 300, height: 200 });
	assert.deepEqual(errors, []);
	await context.close();
});

test("a construction sheet downloads as a PNG at 300 dpi for its paper, with its fonts inside the SVG it's drawn from", async () => {
	const { p, context, errors } = await page("flags/country/chile.kdl");
	await p.getByRole("link", { name: /^Sheet/ }).click();
	await p.waitForFunction(() => document.querySelector(".print-sheet")?.complete === true);
	await p.getByText("The PNG is 3508 × 2480 pixels.").waitFor();
	const before = await p.evaluate(() => globalThis.__svgs.length);
	const png = await downloaded(p, () => p.getByRole("button", { name: "Download PNG" }).click());
	assert.equal(png.name, "chile-construction.png");
	assert.deepEqual(pngSize(png.bytes), { width: 3508, height: 2480 });
	const [paper] = await pixels(context, png.bytes, [[0.005, 0.005]]);
	near(paper, hex("#0c0b11"), "a dark sheet, as on screen");
	const used = await p.evaluate(async (n) => Promise.all(globalThis.__svgs.slice(n).map((b) => b.text())), before);
	const drawn = used.find((t) => t.includes('width="3508" height="2480"'));
	assert.ok(drawn !== undefined, "the PNG was drawn from a sheet its own size");
	const faces = [...drawn.matchAll(/@font-face\{font-family:"([^"]+)";font-style:normal;font-weight:(\d+);src:url\(data:font\/woff2;base64,/g)].map((m) => `${m[1]} ${m[2]}`);
	assert.deepEqual(faces, ["Geist 400", "Geist 500", "Geist Mono 400", "Geist Mono 500"]);
	// The SVG to download stays without them, as small as it was.
	const [svg] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Download SVG" }).click()]);
	assert.doesNotMatch(readFileSync(await svg.path(), "utf8"), /@font-face/);
	// Letter at 150 dpi, then 600 dpi on A4, which is more than a browser draws.
	await p.getByRole("radiogroup", { name: "Paper" }).getByRole("radio", { name: "Letter" }).click();
	await p.getByRole("radiogroup", { name: "PNG resolution" }).getByRole("radio", { name: "150 dpi" }).click();
	await p.getByText("The PNG is 1650 × 1275 pixels.").waitFor();
	await p.waitForFunction(() => document.querySelector(".sheet-frame")?.style.aspectRatio.startsWith("279.4"));
	const letter = await downloaded(p, () => p.getByRole("button", { name: "Download PNG" }).click());
	assert.deepEqual(pngSize(letter.bytes), { width: 1650, height: 1275 });
	await p.getByRole("radiogroup", { name: "Paper" }).getByRole("radio", { name: "A4" }).click();
	await p.getByRole("radiogroup", { name: "PNG resolution" }).getByRole("radio", { name: "600 dpi" }).click();
	const note = p.locator(".sheet-options .png-capped");
	await note.waitFor();
	const told = /so the PNG will be (\d+) × (\d+) pixels/.exec(await note.textContent());
	await p.waitForFunction(() => document.querySelector(".sheet-frame")?.style.aspectRatio.startsWith("297"));
	const fine = await downloaded(p, () => p.getByRole("button", { name: "Download PNG" }).click());
	assert.deepEqual(pngSize(fine.bytes), { width: Number(told[1]), height: Number(told[2]) });
	assert.equal((await p.evaluate(() => JSON.parse(localStorage.getItem("vexyl.construction")))).dpi, 600);
	assert.deepEqual(errors, []);
	await context.close();
});
