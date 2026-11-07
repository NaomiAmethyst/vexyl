// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const v = await load("flagview");
const { outline } = await load("document");

const head = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n  b "#ddeeff"\n}\nproportion hoist=60 fly=90\n\n';
const read = (body) => v.readFlag(outline(head + body + "\n"));
const also = (body) => read(body).also.map((a) => a.label);

test("what's on the flag is said in plain names, in order", () => {
	const { items, also: rest } = read("field a\nbars a b a {\n  ratio 1 2 1\n}\nband b {\n  width 3\n}\ncross a {\n  fly 1 1 1\n  hoist 1 1 1\n}\nsaltire a {\n  width 1\n}\nquarters a b b a\nchecks a b {\n  rows 2\n  columns 2\n}\npile a {\n  depth 1\n}\npall a {\n  width 1\n}\ncanton {\n  fly 3\n  hoist 3\n  field a\n}\npanel {\n  side fly\n  width 1\n  field a\n}\ncharge disc a {\n  radius 1\n}\ncharge lozenge a {\n  fly 1\n  hoist 1\n}");
	assert.deepEqual(items.map((i) => i.label), ["Background", "Stripes", "Single stripe", "Cross", "Diagonal cross", "Quarters", "Checkerboard", "Edge triangle", "Y shape", "Corner block", "Edge block", "Circle", "Diamond"]);
	assert.deepEqual(rest, []);
	assert.equal(items[1].note, "3 stripes");
});

test("a block's own color isn't a thing of its own, and what's in it is indented under it", () => {
	const { items } = read("field a\ncanton {\n  fly 36\n  hoist 30\n  field b\n  charge star a {\n    radius 2\n  }\n}");
	assert.deepEqual(items.map((i) => [i.label, i.depth]), [["Background", 0], ["Corner block", 0], ["Star", 1]]);
	assert.equal(items[1].color, "#ddeeff");
});

test("whole things with no controls are listed by name, with where to go", () => {
	const { also: rest, items } = read('outline swallowtail {\n  depth 3\n}\nborder a 1\nfield a\nemblem {\n  charge star b {\n    radius 1\n  }\n}\ngroup {\n  field a\n}\ncharge polygon a {\n  point fly=0 hoist=0\n  point fly=1 hoist=0\n  point fly=0 hoist=1\n}\ncharge path a {\n  d "M0 0H1V1Z"\n  box "0 0 1 1"\n  fly 1\n}\ncharge svg {\n  fly 1\n  hoist 1\n}\nreverse {\n  field b\n}\nadapt {\n  wider extend\n}\nvariant tall {\n  from rotate\n}\nfold half {\n  over along=fly at=1 move=bottom\n}');
	assert.deepEqual(items.map((i) => i.label), ["Background"]);
	assert.deepEqual(rest.map((a) => a.label), ["Flag outline", "Border", "Symbols drawn together", "Group of layers", "Drawn shape", "Drawn shape", "Artwork", "A different back", "Other proportions", "Other form: tall", "Way of folding: half"]);
	assert.deepEqual(rest.map((a) => a.path), ["outline", "border", "1", "2", "3", "4", "5", "reverse", "adapt", "variant/tall", "fold/half"]);
});

test("a reusable part is listed, and so is its use", () => {
	const { also: rest } = read("define badge {\n  field a\n}\nfield a\nuse badge");
	assert.deepEqual(rest.map((a) => a.label), ["Reusable part: badge", "Reusable part: badge"]);
});

test("what Basic can't change about a known term is listed, with that term's name", () => {
	assert.deepEqual(also("field a {\n  opacity 0.5\n}"), ["See-through setting on Background"]);
	assert.deepEqual(also("bars a b {\n  rotate 10\n  edge wavy depth=1 count=3\n  grow 1 0\n}"), ["Turn on Stripes", "Shaped edge on Stripes", "Setting for other proportions on Stripes"]);
	assert.deepEqual(also('charge star a {\n  radius 2\n  fimbriate b 1\n  blend multiply\n  clip {\n    field a\n  }\n}'), ["Edging on Star", "Blending on Star", "Clipped shape on Star"]);
	assert.deepEqual(also("charge disc a {\n  radius 2\n  hollow 1\n}"), ["Outline-only setting on Circle"]);
	assert.deepEqual(also("charge star a {\n  radius 2\n  repeat line count=3 fly=1\n}"), ["Arrangement on Star"]);
	assert.deepEqual(also("charge star a {\n  radius 2\n  repeat ring count=3 radius=4\n  at fly=1 hoist=1\n  rotate 3\n  points 6\n  inner 1\n}"), []);
	assert.deepEqual(also("canton {\n  fly 1\n  hoist 1\n  field a\n  anchor start\n}"), ["Setting for other proportions on Corner block"]);
	assert.deepEqual(also("saltire a {\n  width 1\n  counterchange\n}"), ["Woven arms on Diagonal cross"]);
});

test("each thing goes to its owner, and a repeated property is listed once", () => {
	const { also: rest } = read("field a\ncharge star a {\n  radius 2\n  cut {\n    field a\n  }\n  cut {\n    field b\n  }\n}");
	assert.deepEqual(rest, [{ path: "1", label: "Cut-out on Star" }]);
});

test("regions follow what holds a thing", () => {
	const nodes = outline(head + "panel {\n  side bottom\n  width 12\n  charge disc a {\n    radius 1\n  }\n}\npanel {\n  corner upper-fly\n  fly 20\n  hoist 10\n  charge disc a {\n    radius 1\n  }\n}\npanel {\n  fly 20\n  hoist 10\n  at fly=30 hoist=30\n  charge disc a {\n    radius 1\n  }\n}\ngroup {\n  charge disc a {\n    radius 1\n  }\n}\n");
	const r = (p) => { const { x, y, w, h } = v.regionOf(v.findLayer(nodes, p), nodes); return [x, y, w, h]; };
	assert.deepEqual(r("0.0"), [0, 48, 90, 12]);
	assert.deepEqual(r("1.0"), [70, 0, 20, 10]);
	assert.deepEqual(r("2.0"), [20, 25, 20, 10]);
	assert.equal(v.regionOf(v.findLayer(nodes, "3.0"), nodes), null, "a group's charges are left alone");
});

test("edges to snap to come from other things, not the one being moved", () => {
	const nodes = outline(head + "bars a b a {\n  ratio 15 30 15\n}\ncanton {\n  fly 36\n  hoist 30\n  field a\n}\nband a {\n  along hoist\n  width 10\n}\n");
	const e = v.edgesOf(nodes, null);
	assert.deepEqual(e.down.sort((a, b) => a - b), [15, 30, 45]);
	assert.deepEqual(e.across.sort((a, b) => a - b), [36, 40, 50]);
	assert.deepEqual(v.edgesOf(nodes, "0").down, [30]);
	assert.deepEqual(v.edgesWithin([10, 36, 100], 0, 90), [10 / 90, 0.4]);
});

test("what's drawn at once is what the edits will make it", () => {
	const nodes = outline(head + "charge star a {\n  radius 2\n}\n");
	const at = nodes.find((n) => n.name === "charge").at;
	const moved = v.withOps(nodes, [{ op: "child", at, name: "at", args: [], props: [["fly", { v: 3, raw: "3" }], ["hoist", { v: 4, raw: "4" }]] }, { op: "child", at, name: "radius", args: [{ v: 9, raw: "9" }] }]);
	const c = v.readCharge(moved.find((n) => n.name === "charge"), moved);
	assert.deepEqual(c.at, { x: 3, y: 4 });
	assert.equal(c.radius, 9);
	assert.equal(v.readCharge(nodes.find((n) => n.name === "charge"), nodes).radius, 2, "the nodes themselves aren't changed");
	const dropped = v.withOps(moved, [{ op: "dropChild", at, name: "at" }]);
	assert.equal(dropped.find((n) => n.name === "charge").kids.some((k) => k.name === "at"), false);
	const centered = v.withOps(moved, [{ op: "child", at, name: "at", args: [{ v: "center" }], props: [["fly", null], ["hoist", null]] }]);
	assert.deepEqual(centered.find((n) => n.name === "charge").kids.find((k) => k.name === "at").props, []);
});
