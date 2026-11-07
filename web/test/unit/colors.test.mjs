// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { test } from "node:test";
import { load, loadLibrary } from "./load.mjs";

const { applyOps, outline } = await load("document");
const { colorUses, replacementsFor, unusedColors } = await load("colors");
const lib = await loadLibrary();

const text = `vexyl 1
meta {
  name "red"
}
palette {
  red "#c8102e"
  white "#ffffff"
  blue "#002868"
  gold "#ffd700"
  dawn gradient red white
  dusk gradient gold blue
}
proportion hoist=10 fly=20
border red 0.2
define badge {
  charge disc red {
    radius 1
  }
}
bars red white dawn
canton {
  fly 8
  hoist 5
  field red
  charge star white {
    radius 1
    fimbriate red 0.1
  }
}
reverse {
  saltire red {
    width 1
  }
}
variant vertical {
  from transpose
  field red
}
`;

test("a color's uses are everywhere it's named, in the order of the file", () => {
	const nodes = outline(text);
	const uses = colorUses(nodes, "red").map((u) => [u.node.name, u.holders.map((h) => h.name).join("/")]);
	assert.deepEqual(uses, [["dawn", "palette"], ["border", ""], ["charge", "define"], ["bars", ""], ["field", "canton"], ["fimbriate", "canton/charge"], ["saltire", "reverse"], ["field", "variant"]]);
	assert.deepEqual(colorUses(nodes, "dawn").map((u) => u.node.name), ["bars"]);
	// Its own entry, and the name of the flag, aren't uses.
	assert.deepEqual(colorUses(nodes, "dusk"), []);
});

test("what can take a color's place depends on where it's used", () => {
	const nodes = outline(text);
	const cases = [
		// A gradient is made from it, which needs a solid color.
		["red", ["white", "blue", "gold"]],
		["white", ["red", "blue", "gold"]],
		// Only layers use it, so a gradient can, unless it's made from it.
		["dawn", ["red", "white", "blue", "gold", "dusk"]],
		["blue", ["red", "white", "gold"]],
	];
	for (const [color, wanted] of cases) {
		assert.deepEqual(replacementsFor(nodes, color), wanted, color);
		for (const to of wanted) {
			const done = applyOps(text, [{ op: "removeColor", name: color, to }]);
			assert.deepEqual(lib.validate(done.text), [], `${color} to ${to}`);
			assert.deepEqual(colorUses(outline(done.text), color), [], `${color} to ${to}`);
		}
	}
});

test("unused colors are those nothing uses, with what only an unused gradient is made from", () => {
	const nodes = outline(text);
	assert.deepEqual(unusedColors(nodes), ["dusk", "blue", "gold"]);
	const ops = unusedColors(nodes).map((name) => ({ op: "removeColor", name }));
	const done = applyOps(text, ops);
	assert.deepEqual(lib.validate(done.text), []);
	assert.equal(done.text, text.replace('  blue "#002868"\n  gold "#ffd700"\n', "").replace("  dusk gradient gold blue\n", ""));
	assert.deepEqual(unusedColors(outline(done.text)), []);
});
