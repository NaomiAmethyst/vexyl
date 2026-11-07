// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { test } from "node:test";
import { load, loadLibrary } from "./load.mjs";

const t = await load("templates");
const { addGroups, plainLayers, plainShapes } = await load("plain");
const { applyOps, outline } = await load("document");
const { addOps } = await load("flagdrag");
const lib = await loadLibrary();

test("the start screen has the four shapes, on a grid 60 high", () => {
	assert.deepEqual(t.flagShapes.map((s) => [s.id, s.hoist, s.fly]), [["2:3", 60, 90], ["1:2", 60, 120], ["3:5", 60, 100], ["1:1", 60, 60]]);
	for (const s of t.flagShapes) {
		const [h, f] = s.id.split(":").map(Number);
		assert.equal(s.fly / s.hoist, f / h, s.id);
	}
});

test("every layout is valid on every shape", () => {
	assert.ok(t.layouts.length >= 9);
	for (const l of t.layouts) {
		for (const s of t.flagShapes) {
			const text = t.template(l.id, s.id);
			assert.deepEqual(lib.validate(text), [], `${l.id} on ${s.id}`);
			assert.ok(text.includes(`proportion hoist=${s.hoist} fly=${s.fly}`));
			assert.ok(lib.svg(lib.parse(text)).includes("<svg"));
		}
	}
});

test("the layouts ask for the numbers they say they do", () => {
	assert.ok(t.template("off-cross", "2:3").includes("fly 27 12 51"));
	assert.ok(t.template("stripes-block", "2:3").includes("fly 36"));
	assert.ok(t.template("swallowtail", "2:3").indexOf("outline swallowtail") < t.template("swallowtail", "2:3").indexOf("field red"));
	for (const s of t.flagShapes) {
		for (const m of t.template("off-cross", s.id).matchAll(/(fly|hoist) (\S+) (\S+) (\S+)/g)) {
			assert.ok([m[2], m[3], m[4]].every((n) => Number.isInteger(Number(n))), m[0]);
		}
	}
});

test("everything in the add menu is valid, sized for the flag, on any grid", () => {
	const keys = addGroups.flatMap((g) => g.items.map(([k]) => k));
	assert.ok(keys.length >= 20);
	for (const [hoist, fly] of [[60, 90], [60, 60], [2, 3], [7, 11], [1000, 1900]]) {
		const text = `vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n  b "#ddeeff"\n}\nproportion hoist=${hoist} fly=${fly}\n\nfield a\ncharge disc b {\n  radius ${hoist / 10}\n}\n`;
		for (const key of keys) {
			const made = addOps(key, outline(text), null);
			const out = applyOps(text, made.ops);
			assert.deepEqual(lib.validate(out.text), [], `${key} on ${hoist}:${fly}`);
			assert.equal(outline(out.text)[made.at[0]].name, key.startsWith("charge:") ? "charge" : key, key);
		}
	}
});

test("what's added doesn't paint over what should stay on top", () => {
	const text = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n  b "#ddeeff"\n}\nproportion hoist=60 fly=90\n\nfield a\ncanton {\n  fly 30\n  hoist 30\n  field b\n}\ncharge star b {\n  radius 10\n}\nvariant tall {\n  from rotate\n}\n';
	const names = (key) => outline(applyOps(text, addOps(key, outline(text), null).ops).text).map((n) => n.name).slice(4);
	assert.deepEqual(names("bars"), ["field", "bars", "canton", "charge", "variant"]);
	assert.deepEqual(names("panel"), ["field", "canton", "panel", "charge", "variant"]);
	assert.deepEqual(names("charge:star"), ["field", "canton", "charge", "charge", "variant"]);
});

test("a symbol added with a block selected goes in the block, at the block's size", () => {
	const text = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n  b "#ddeeff"\n}\nproportion hoist=60 fly=90\n\nfield a\ncanton {\n  fly 30\n  hoist 20\n  field b\n}\n';
	const nodes = outline(text);
	const made = addOps("charge:star", nodes, nodes.find((n) => n.name === "canton"));
	const out = applyOps(text, made.ops).text;
	assert.deepEqual(lib.validate(out), []);
	const star = outline(out).find((n) => n.name === "canton").kids.find((k) => k.name === "charge");
	assert.equal(star.kids.find((k) => k.name === "radius").args[0].v, 5, "a quarter of the block's height");
	assert.deepEqual(star.at, made.at);
});

test("new colors get a name from how they look, that isn't taken", () => {
	assert.equal(t.colorName("#3a7bd5", []), "blue");
	assert.equal(t.colorName("#3a7bd5", ["blue"]), "blue-2");
	assert.equal(t.colorName("#3a7bd5", ["blue", "blue-2"]), "blue-3");
	assert.equal(t.colorName("#e02020", []), "red");
	assert.equal(t.colorName("#20c040", []), "green");
	assert.equal(t.colorName("#f8f8f8", []), "white");
	assert.equal(t.colorName("#101010", []), "black");
	assert.equal(t.colorName("#808080", []), "gray");
	assert.equal(t.colorName("#ffd020", []), "yellow");
});

test("something new stands out from what it goes on", () => {
	const colors = new Map([["navy", "#27306b"], ["white", "#f6f3ea"], ["gold", "#e8b23a"]]);
	assert.equal(t.contrasting(colors, "#f6f3ea")[0], "navy");
	assert.equal(t.contrasting(colors, "#27306b")[0], "white");
});

test("every plain name in the table is plain", () => {
	for (const [term, plain] of Object.entries({ field: "Background", bars: "Stripes", band: "Single stripe", saltire: "Diagonal cross", checks: "Checkerboard", pile: "Edge triangle", pall: "Y shape", charge: "Symbol", canton: "Corner block", panel: "Edge block" })) {
		assert.equal(plainLayers[term], plain);
	}
	assert.equal(plainShapes.disc, "Circle");
	assert.equal(plainShapes.lozenge, "Diamond");
});
