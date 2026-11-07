// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load, loadLibrary } from "./load.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const lib = await loadLibrary();
const { scaleFlag, scalePathData } = await load("grid");

test("a flag on a smaller grid draws the same, on every flag in the suite", () => {
	const dir = resolve(repo, "conformance/valid");
	let compared = 0;
	for (const name of readdirSync(dir).filter((f) => f.endsWith(".kdl"))) {
		const flag = lib.parse(readFileSync(resolve(dir, name), "utf8"));
		const k = 0.001;
		// Artwork has its own grid, which stays as it is.
		const noArt = (text) => text.replace(/<svg x=[\s\S]*?<\/svg>/g, "");
		const small = noArt(lib.svg(scaleFlag(flag, k), { idPrefix: "x-" }));
		const big = noArt(lib.svg(flag, { idPrefix: "x-" }));
		// Every polygon's corners, and each circle, are the same multiplied by k. A polygon too small to
		// see can be dropped once it's smaller, so it's the ones that are left that are compared.
		// One that reaches past the flag has run on by a fixed distance, which the clip removes.
		const side = Math.max(flag.fly, flag.hoist);
		const numbers = (text, re, limit) => [...text.matchAll(re)].map((m) => m[1].split(/[ ,]+/).map(Number)).filter((list) => list.every((n) => n >= 0 && n <= limit)).flat();
		for (const re of [/ r="([^"]+)"/g, / cx="([^"]+)"/g, / cy="([^"]+)"/g, / points="([^"]+)"/g]) {
			const a = numbers(big, re, side);
			const b = numbers(small, re, side * k);
			if (a.length !== b.length) {
				assert.ok(re.source.includes("points"), `${name}: ${re.source}: ${a.length} and ${b.length}`);
				continue;
			}
			a.forEach((x, i) => {
				assert.ok(Math.abs(x * k - b[i]) < 1e-3 * Math.max(Math.abs(x * k), 1e-3) + 2e-4, `${name}: ${x} became ${b[i]}`);
				compared++;
			});
		}
		assert.ok(flag.fly > 0 && scaleFlag(flag, k).fly === flag.fly * k);
	}
	assert.ok(compared > 1000, String(compared));
});

test("making a flag smaller doesn't change the flag it came from", () => {
	const text = readFileSync(resolve(repo, "conformance/valid/united-states.kdl"), "utf8");
	const flag = lib.parse(text);
	const before = lib.svg(flag, { idPrefix: "x-" });
	scaleFlag(flag, 0.5);
	assert.equal(lib.svg(flag, { idPrefix: "x-" }), before);
});

test("path data scales everything but an arc's rotation and flags", () => {
	assert.equal(scalePathData("M10 20L30,40", 0.5), "M5 10L15 20");
	assert.equal(scalePathData("m10 20h-30 1e2z", 2), "m20 40h-60 200z");
	assert.equal(scalePathData("M0 0A10 20 30 1 0 40 50", 2), "M0 0A20 40 30 1 0 80 100");
});
