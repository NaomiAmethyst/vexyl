// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { load, loadLibrary } from "./load.mjs";

const { cappedNote, defaultPicture, fitPng, maxArea, maxSide, pngForHeight, pngForPaper, readPicturePrefs, sizedSvg, svgSize, withResolution } = await load("png");
const { sheetFontFiles } = await load("sheet");

test("a PNG is the size asked for, in whole pixels, keeping the flag's shape", () => {
	assert.deepEqual(pngForHeight(492.201975, 600, 1200), { width: 984, height: 1200, capped: false });
	assert.deepEqual(pngForHeight(1200, 600, 600), { width: 1200, height: 600, capped: false });
	assert.deepEqual(pngForHeight(3, 2, 1), { width: 2, height: 1, capped: false });
	assert.deepEqual(fitPng(0.2, 0.4), { width: 1, height: 1, capped: false }, "never less than a pixel");
	assert.equal(cappedNote(pngForHeight(3, 2, 1200)), "");
});

test("a PNG too big for a browser is made smaller, and says so", () => {
	// A side's limit: a long flag at a height that's fine on its own.
	const long = pngForHeight(100, 1, 1000);
	assert.equal(long.capped, true);
	assert.equal(long.width, maxSide);
	assert.equal(long.height, 163);
	// The area's limit: a square under the side's limit, but too many pixels in all.
	const square = pngForHeight(1, 1, 10000);
	assert.deepEqual(square, { width: 4096, height: 4096, capped: true });
	for (const [w, h, px] of [[2, 3, 100000], [3, 2, 9000], [1, 1, 4096], [1, 1, 4097], [19, 10, 16384], [1, 30, 20000]]) {
		const s = pngForHeight(w, h, px);
		assert.ok(s.width <= maxSide && s.height <= maxSide && s.width * s.height <= maxArea, `${w}:${h} at ${px}`);
		assert.ok(Math.abs(s.width / s.height - w / h) < 0.02 * (w / h) + 1 / s.height, `${w}:${h} keeps its shape`);
	}
	assert.equal(pngForHeight(1, 1, 4096).capped, false, "exactly at the limit is allowed");
	assert.equal(pngForHeight(1, 1, 4097).capped, true);
	assert.equal(cappedNote(square), "That's more than a browser can draw, so the PNG will be 4096 × 4096 pixels.");
});

test("a sheet's PNG is its paper at so many dots per inch", () => {
	assert.deepEqual(pngForPaper(297, 210, 300), { width: 3508, height: 2480, capped: false });
	assert.deepEqual(pngForPaper(279.4, 215.9, 300), { width: 3300, height: 2550, capped: false });
	assert.deepEqual(pngForPaper(297, 210, 150), { width: 1754, height: 1240, capped: false });
	const fine = pngForPaper(297, 210, 600);
	assert.equal(fine.capped, true, "A4 at 600 dpi is 7016 × 4961, which is too many pixels");
	assert.ok(fine.width * fine.height <= maxArea && fine.width > 4800);
});

/** A PNG's chunks, as their types and data, each checked against its CRC. */
function chunks(png) {
	const out = [];
	for (let at = 8; at < png.length;) {
		const length = png.readUInt32BE(at);
		const body = png.subarray(at + 4, at + 8 + length);
		assert.equal(png.readUInt32BE(at + 8 + length), crc32(body), "its CRC is right");
		out.push({ type: body.subarray(0, 4).toString("latin1"), data: body.subarray(4) });
		at += 12 + length;
	}
	return out;
}

/** A PNG of one transparent pixel, with any chunks given after its header. */
function tinyPng(extra = []) {
	const chunk = (type, data) => {
		const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body));
		return Buffer.concat([length, body, crc]);
	};
	const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), ...extra.map(([t, d]) => chunk(t, d)), chunk("IDAT", deflateSync(Buffer.alloc(5))), chunk("IEND", Buffer.alloc(0))]);
}

test("a sheet's PNG says how big its pixels are, so that it prints on its paper", () => {
	// A4 at 300 dpi: 3508 pixels across 297 mm is 11811 to the metre, as 300 dpi is.
	const size = pngForPaper(297, 210, 300);
	const png = Buffer.from(withResolution(tinyPng(), (size.width * 1000) / 297, (size.height * 1000) / 210));
	const list = chunks(png);
	assert.deepEqual(list.map((c) => c.type), ["IHDR", "pHYs", "IDAT", "IEND"], "just after the header, before the pixels");
	const phys = list[1].data;
	assert.equal(phys.length, 9);
	assert.equal(phys.readUInt32BE(0), 11811);
	assert.equal(phys.readUInt32BE(4), 11810);
	assert.equal(phys[8], 1, "in metres");
	assert.ok(Math.abs((phys.readUInt32BE(0) * 0.0254) - 300) < 0.01);
	// One there already is replaced, not repeated, and the rest is kept as it was.
	const old = tinyPng([["pHYs", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 0])], ["tEXt", Buffer.from("Software\0x", "latin1")]]);
	const again = chunks(Buffer.from(withResolution(old, 5906, 5906)));
	assert.deepEqual(again.map((c) => c.type), ["IHDR", "pHYs", "tEXt", "IDAT", "IEND"]);
	assert.equal(again[1].data.readUInt32BE(4), 5906);
	assert.deepEqual(again[2].data, Buffer.from("Software\0x", "latin1"));
	// What isn't a PNG is left alone.
	const text = new TextEncoder().encode("not a picture at all, but long enough to look at");
	assert.equal(withResolution(text, 1, 1), text);
});

test("an SVG's size is read from its root, and it's given the size it's drawn at", () => {
	const flag = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2.5 -4.6 71.5 87.2" width="492.2" height="600">\n<rect width="5" height="5"/></svg>';
	assert.deepEqual(svgSize(flag), { width: 492.2, height: 600 });
	const sized = sizedSvg(flag, 984, 1200);
	assert.ok(sized.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2.5 -4.6 71.5 87.2" width="984" height="1200">'));
	assert.ok(sized.includes('<rect width="5" height="5"/>'), "only the root changes");
	const sheet = '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 1123 794">';
	assert.deepEqual(svgSize(sheet), { width: 297, height: 210 });
	assert.equal(sizedSvg(sheet, 3508, 2480), '<svg xmlns="http://www.w3.org/2000/svg" width="3508" height="2480" viewBox="0 0 1123 794">');
	assert.equal(svgSize("<svg/>"), null);
});

test("the picture's format and height are remembered, and nonsense is ignored", () => {
	assert.deepEqual(readPicturePrefs(null), defaultPicture);
	assert.deepEqual(readPicturePrefs(JSON.stringify({ format: "png", height: 640 })), { format: "png", height: 640 });
	assert.deepEqual(readPicturePrefs(JSON.stringify({ format: "gif", height: 0.5 })), defaultPicture);
	assert.deepEqual(readPicturePrefs("[]"), defaultPicture);
	assert.equal(readPicturePrefs(JSON.stringify({ height: 50000 })).height, 50000, "more than a browser draws can be asked for, and is then capped");
});

test("the sheet's fonts are the faces the library sets its text in, and they're files this site has", async () => {
	const { sheetFaces } = await loadLibrary();
	assert.deepEqual(sheetFontFiles.map(({ family, weight }) => ({ family, weight })), sheetFaces);
	for (const { file } of sheetFontFiles) {
		const name = file.replace(/^fonts\//, "");
		const pack = name.replace(/-latin-.*$/, "");
		const path = join(import.meta.dirname, "../../node_modules/@fontsource", pack, "files", name);
		assert.ok(existsSync(path), path);
		assert.equal(readFileSync(path).subarray(0, 4).toString("latin1"), "wOF2");
	}
	const build = readFileSync(join(import.meta.dirname, "../../build.mjs"), "utf8");
	for (const [family, pack, weight] of [["Geist", "geist-sans", 400], ["Geist", "geist-sans", 500], ["Geist Mono", "geist-mono", 400], ["Geist Mono", "geist-mono", 500]]) {
		assert.ok(build.includes(`["${family}", "${pack}", ${weight}, "normal"]`), `the build serves ${pack} ${weight}`);
	}
});
