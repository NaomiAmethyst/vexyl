// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { test } from "node:test";
import { load, loadLibrary } from "./load.mjs";

const d = await load("flagdrag");
const v = await load("flagview");
const { applyOps, outline } = await load("document");
const lib = await loadLibrary();

const head = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n  b "#ddeeff"\n}\nproportion hoist=60 fly=90\n\n';
const flag = (body) => head + body + "\n";

/** Drags a handle from where it is to a share of the flag, and gives the file that results. */
function drag(text, path, id, to, free = false) {
	const nodes = outline(text);
	const h = d.handlesOf(path, nodes).find((x) => x.id === id);
	assert.ok(h, `${path} has a handle ${id}`);
	const step = h.mover({ x: h.x, y: h.y }, to, free);
	const out = applyOps(text, step.ops);
	assert.equal(out.error, undefined);
	assert.deepEqual(lib.validate(out.text), [], out.text);
	// What's drawn at once has to be what the file then says.
	const shown = v.withOps(nodes, step.ops);
	const again = outline(out.text);
	assert.deepEqual(d.handlesOf(path, shown).map((x) => [x.id, x.x, x.y]), d.handlesOf(path, again).map((x) => [x.id, x.x, x.y]));
	return { text: out.text, step };
}

test("moving a symbol snaps to a fraction, and writes a whole number", () => {
	const text = flag("field a\ncharge star b {\n  radius 10\n}");
	const { text: out, step } = drag(text, "1", "move", { x: 45 + (0.34 - 0.5) * 90, y: 30 });
	assert.ok(out.includes("  at fly=30 hoist=30\n"), out);
	assert.equal(step.readout, "1/3 across, 1/2 down");
	assert.equal(step.across, 30);
	assert.equal(step.down, 30);
});

test("Alt places a symbol freely, with no guides", () => {
	const { text: out, step } = drag(flag("field a\ncharge star b {\n  radius 10\n}"), "1", "move", { x: 30.5, y: 12.25 }, true);
	assert.ok(out.includes("at fly=30.5 hoist=12.25"), out);
	assert.equal(step.across, undefined);
	assert.equal(step.down, undefined);
});

test("a symbol dropped in the middle with no position stays with none", () => {
	const text = flag("field a\ncharge star b {\n  radius 10\n}");
	assert.equal(drag(text, "1", "move", { x: 45.5, y: 30.5 }).text, text);
	const centered = flag("field a\ncharge star b {\n  at center\n  radius 10\n}");
	assert.ok(drag(centered, "1", "move", { x: 45.5, y: 30.5 }).text.includes("at center"));
});

test("a symbol snaps to the lines of stripes and the edges of blocks", () => {
	const text = flag("bars a b a {\n  ratio 13 34 13\n}\ncanton {\n  fly 37\n  hoist 20\n  field b\n}\ncharge disc b {\n  radius 5\n}");
	const out = drag(text, "2", "move", { x: 45 + 37.6 - 45, y: 30 + 13.5 - 30 }).text;
	assert.ok(out.includes("at fly=37 hoist=13"), out);
});

test("a symbol's position and size are relative to the block it's in", () => {
	const text = flag("field a\ncanton {\n  fly 36\n  hoist 30\n  field b\n  charge star a {\n    radius 5\n  }\n}");
	const nodes = outline(text);
	const out = drag(text, "1.1", "move", { x: 18 + (1 / 3 - 0.5) * 36 + 0.1, y: 15 }).text;
	assert.ok(out.includes("at fly=12 hoist=15"), out);
	const star = v.findLayer(nodes, "1.1");
	assert.equal(v.readCharge(star, nodes).region.h, 30);
	const h = d.handlesOf("1.1", nodes).find((x) => x.id === "se");
	const { step } = (() => {
		const stepped = h.mover({ x: h.x, y: h.y }, { x: 18 + 7.6, y: 15 + 7.6 }, false);
		return { step: stepped };
	})();
	assert.ok(step.readout.startsWith("1/4 of the height"), step.readout);
	assert.equal(step.ops[0].args[0].raw, "7.5", "a quarter of the block");
});

test("corner handles resize, keeping a shape's look", () => {
	const text = flag("field a\ncharge crescent b {\n  radius 10\n  inner 8\n  offset 3\n}");
	const out = drag(text, "1", "se", { x: 45 + 15.1, y: 30 + 15.1 }).text;
	assert.ok(out.includes("radius 15") && out.includes("inner 12") && out.includes("offset 4.5"), out);
});

test("a rectangle resizes each way on its own", () => {
	const text = flag("field a\ncharge rect b {\n  fly 20\n  hoist 10\n}");
	const { text: out, step } = drag(text, "1", "se", { x: 45 + 15.2, y: 30 + 10.1 });
	assert.ok(out.includes("fly 30") && out.includes("hoist 20"), out);
	assert.equal(step.readout, "1/3 of the width, 1/3 of the height");
});

test("dragging a stripe line writes a ratio on the grid", () => {
	const text = flag("bars a b a");
	const { text: out, step } = drag(text, "0", "line-0", { x: 10, y: 15.3 });
	assert.ok(out.includes("ratio 15 25 20"), out);
	assert.equal(step.readout, "1/4 of the way down");
	assert.equal(step.down, 15);
});

test("a counted set of stripes keeps its count, and gets a ratio for all of them", () => {
	const out = drag(flag("bars a b {\n  count 5\n}"), "0", "line-1", { x: 10, y: 20.1 }).text;
	assert.ok(out.includes("count 5") && out.includes("ratio 12 8 16 12 12"), out);
});

test("a ratio that isn't on the grid is put on it when a line moves", () => {
	const out = drag(flag("bars a b a {\n  ratio 1 2 1\n}"), "0", "line-1", { x: 10, y: 40.2 }).text;
	assert.ok(out.includes("ratio 15 25 20"), out);
});

test("upright stripes drag across, and neighbors can't be crossed", () => {
	const text = flag("bars a b a {\n  along hoist\n}");
	assert.ok(drag(text, "0", "line-0", { x: 22.4, y: 10 }).text.includes("ratio 22.5 37.5 30"));
	const out = drag(text, "0", "line-0", { x: 80, y: 10 }).text;
	const widths = /ratio (\S+) (\S+) (\S+)/.exec(out).slice(1).map(Number);
	assert.ok(widths.every((w) => w > 0), out);
	assert.equal(widths[2], 30, "the stripe past the next line isn't touched");
});

test("stripes that are turned or slanted have no line handles", () => {
	assert.deepEqual(d.handlesOf("0", outline(flag("bars a b {\n  rotate 20\n}"))), []);
	assert.deepEqual(d.handlesOf("0", outline(flag("bars a b {\n  along bend\n}"))), []);
});

test("a corner block resizes by its corner", () => {
	const text = flag("field a\ncanton {\n  fly 30\n  hoist 20\n  field b\n}");
	const { text: out, step } = drag(text, "1", "corner", { x: 45.4, y: 30.3 });
	assert.ok(out.includes("fly 45") && out.includes("hoist 30"), out);
	assert.equal(step.readout, "1/2 of the width, 1/2 of the height");
});

test("a block in another corner measures from there", () => {
	const text = flag("field a\npanel {\n  corner lower-fly\n  fly 30\n  hoist 20\n  field b\n}");
	const out = drag(text, "1", "corner", { x: 90 - 22.5, y: 60 - 15 }).text;
	assert.ok(out.includes("fly 22.5") && out.includes("hoist 15"), out);
});

test("an edge block resizes by its inner edge", () => {
	const out = drag(flag("field a\npanel {\n  side fly\n  width 20\n  field b\n}"), "1", "side", { x: 90 - 30, y: 10 }).text;
	assert.ok(out.includes("width 30"), out);
});

test("a single stripe moves, and thickens", () => {
	const text = flag("field a\nband b {\n  width 10\n}");
	const moved = drag(text, "1", "band", { x: 0, y: 15.2 }, false);
	assert.equal(moved.text.includes("offset"), true);
	const h = d.handlesOf("1", outline(text)).find((x) => x.id === "band");
	const step = h.mover({ x: h.x, y: h.y }, { x: 0, y: 20.1 }, false);
	assert.equal(step.ops[0].args[0].raw, "-10", "1/3 of the way down is ten above the middle");
	const back = applyOps(applyOps(text, step.ops).text, d.handlesOf("1", outline(applyOps(text, step.ops).text)).find((x) => x.id === "band").mover({ x: 0, y: 20 }, { x: 0, y: 30 }, false).ops).text;
	assert.equal(back.includes("offset"), false, "back in the middle, it needs no offset");
	assert.ok(drag(text, "1", "band-width", { x: 67, y: 40.2 }).text.includes("width 20"));
});

test("a cross moves its arms, and keeps them on the grid", () => {
	const text = flag("field a\ncross b {\n  fly 27 12 51\n  hoist 24 12 24\n}");
	const h = d.handlesOf("1", outline(text)).find((x) => x.id === "cross");
	assert.equal(h.x, 33);
	assert.equal(h.y, 30);
	const out = drag(text, "1", "cross", { x: 45.4, y: 30 }).text;
	assert.ok(out.includes("fly 39 12 39") && out.includes("hoist 24 12 24"), out);
	const thick = drag(text, "1", "cross-width", { x: 33 + 7.6, y: 7 }).text;
	assert.ok(thick.includes("fly 25.5 15 49.5") || thick.includes("hoist 22.5 15 22.5"), thick);
});

test("a cross written as a ratio is put on the grid when it moves", () => {
	const out = drag(flag("field a\ncross b {\n  fly 5 2 9\n  hoist 4 2 4\n}"), "1", "cross", { x: 45, y: 30.2 }).text;
	assert.ok(/fly \S+ 11.25 \S+/.test(out), out);
	assert.deepEqual(lib.validate(out), []);
});

test("a saltire thickens, and quarters move where they meet", () => {
	assert.ok(drag(flag("field a\nsaltire b {\n  width 6\n}"), "1", "saltire", { x: 45 - 15, y: 30 - 15 - 6 }).text.match(/width \S+/));
	const q = flag("quarters a b b a");
	assert.ok(drag(q, "0", "quarters", { x: 30.2, y: 20.1 }).text.includes("split fly=30 hoist=20"));
	assert.deepEqual(d.handlesOf("0", outline(flag("quarters a b b a {\n  diagonal\n}"))), []);
});

test("a symbol in a grid or in several places can't be picked up, and one in a ring can", () => {
	const paths = (body) => d.movableCharges(outline(flag(body))).map((z) => z.path);
	assert.deepEqual(paths("field a\ncharge star b {\n  radius 2\n  repeat grid rows=2 columns=2\n}"), []);
	assert.deepEqual(paths("field a\ncharge star b {\n  radius 2\n  at fly=1 hoist=1\n  at fly=2 hoist=2\n}"), []);
	assert.deepEqual(paths("field a\ncharge star b {\n  radius 2\n  repeat ring count=6 radius=9\n}"), ["1"]);
	assert.deepEqual(paths('field a\ncharge path b {\n  d "M0 0H1V1Z"\n  box "0 0 1 1"\n  fly 1\n}'), []);
	assert.deepEqual(paths("field a\nemblem {\n  charge star b {\n    radius 2\n  }\n}"), [], "a frame of its own isn't the flag's");
});

test("panel edits leave a valid flag", () => {
	const star = flag("field a\ncharge star b {\n  at fly=30 hoist=20\n  radius 10\n  rotate 10\n}");
	const c = (t) => { const n = outline(t); return v.readCharge(v.findLayer(n, "1"), n); };
	const ok = (t, ops) => { const out = applyOps(t, ops).text; assert.deepEqual(lib.validate(out), [], out); return out; };
	const three = ok(star, d.pointsOps(c(star), 3));
	assert.ok(three.includes("points 3") && three.includes("inner 4.5") && !three.includes("rotate"), three);
	const backTo = ok(three, d.pointsOps(c(three), 5));
	assert.ok(!backTo.includes("points") && !backTo.includes("inner"), backTo);
	const grid = ok(star, d.repeatOps(c(star), "grid"));
	assert.ok(grid.includes("repeat grid rows=3 columns=3") && !grid.includes("at fly"), grid);
	const ring = ok(grid, d.repeatOps(c(grid), "ring"));
	assert.ok(ring.includes("repeat ring") && ring.includes("radius=18") && !ring.includes("rows"), ring);
	assert.ok(!ok(ring, d.repeatOps(c(ring), "one")).includes("repeat"));
	assert.ok(ok(star, d.turnOps(c(star), 36)).includes("rotate 36"));
	assert.ok(!ok(star, d.turnOps(c(star), 0)).includes("rotate"));
	const lifted = ok(star, d.placeOps(c(star), { v: 0.25, kind: "fraction", fraction: [1, 4] }, { v: 0.75, kind: "fraction", fraction: [3, 4] }));
	assert.ok(lifted.includes("at fly=22.5 hoist=45"), lifted);
});

test("colors of counted stripes are written out when one changes", () => {
	const text = flag("bars a b {\n  count 3\n}");
	const b = v.readBars(outline(text)[4]);
	assert.equal(b.colors.length, 3);
	const out = applyOps(text, d.stripesOps(b, [{ v: "a" }, { v: "a" }, { v: "b" }], null)).text;
	assert.ok(out.includes("bars a a b") && !out.includes("count"), out);
	assert.deepEqual(lib.validate(out), []);
});

test("a very big ratio or a value with an exponent still works", () => {
	assert.ok(drag(flag("bars a b {\n  ratio 1e3 3e3\n}"), "0", "line-0", { x: 0, y: 20.1 }).text.includes("ratio 20 40"));
});

const layered = flag("border a 1\nfield a\nbars a b\ncharge disc b {\n  radius 3\n}\ncanton {\n  fly 30\n  hoist 30\n  field b\n  charge star a {\n    radius 2\n  }\n  charge disc a {\n    radius 1\n  }\n}");

test("a layer moves among the layers beside it, and nothing that isn't one", () => {
	const nodes = outline(layered);
	const among = (path) => d.layerSiblings(v.findLayer(nodes, path), nodes).map((n) => n.path);
	assert.deepEqual(among("1"), ["0", "1", "2", "3"], "the border isn't a layer");
	assert.deepEqual(among("3.1"), ["3.1", "3.2"], "a block's own color isn't one either");
	assert.deepEqual(among("3"), among("0"));
});

test("moving a layer forward or back swaps it with the next one, and leaves the rest as it was", () => {
	const block = (first, second) => `canton {\n  fly 30\n  hoist 30\n  field b\n${first}${second}}`;
	const star = "  charge star a {\n    radius 2\n  }\n";
	const disc = "  charge disc a {\n    radius 1\n  }\n";
	const cases = [
		// What moves, to which place among its siblings, and the layers as they then are.
		["1", 2, `border a 1\nfield a\ncharge disc b {\n  radius 3\n}\nbars a b\n${block(star, disc)}`],
		["2", 1, `border a 1\nfield a\ncharge disc b {\n  radius 3\n}\nbars a b\n${block(star, disc)}`],
		["3", 2, `border a 1\nfield a\nbars a b\n${block(star, disc)}\ncharge disc b {\n  radius 3\n}`],
		["3.1", 1, `border a 1\nfield a\nbars a b\ncharge disc b {\n  radius 3\n}\n${block(disc, star)}`],
		["3.2", 0, `border a 1\nfield a\nbars a b\ncharge disc b {\n  radius 3\n}\n${block(disc, star)}`],
	];
	for (const [path, to, body] of cases) {
		const nodes = outline(layered);
		const node = v.findLayer(nodes, path);
		const out = applyOps(layered, d.moveOps(node, d.layerSiblings(node, nodes), to));
		assert.equal(out.text, flag(body), `${path} to ${to}`);
		assert.deepEqual(lib.validate(out.text), []);
	}
});

test("a layer at either end, or moved nowhere, has nothing to do", () => {
	const nodes = outline(layered);
	const first = v.findLayer(nodes, "0");
	const last = v.findLayer(nodes, "3");
	const siblings = d.layerSiblings(first, nodes);
	assert.deepEqual(d.moveOps(first, siblings, -1), []);
	assert.deepEqual(d.moveOps(last, siblings, 4), []);
	assert.deepEqual(d.moveOps(first, siblings, 0), []);
	assert.deepEqual(d.moveOps(v.findLayer(nodes, "3.1"), siblings, 1), [], "it isn't among those");
});

test("a layer moved past several steps by each of them, as one change", () => {
	const nodes = outline(layered);
	const first = v.findLayer(nodes, "0");
	const ops = d.moveOps(first, d.layerSiblings(first, nodes), 3);
	assert.equal(ops.length, 3);
	const moved = outline(applyOps(layered, ops).text);
	assert.deepEqual(moved.filter((n) => n.path !== undefined && /^\d+$/.test(n.path)).map((n) => n.name), ["bars", "charge", "canton", "field"]);
});
