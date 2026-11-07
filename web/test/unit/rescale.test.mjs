// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load, loadLibrary, handWrittenDirs } from "./load.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const { applyOps, rescalePreview } = await load("document");
const { flyPerHoist, matching, readExact, shapeText } = await load("exact");
const lib = await loadLibrary();

const head = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n  b "#445566" {\n    cmyk 10 20 30 40\n  }\n}\n';
const restate = (text, hoist) => {
	const out = applyOps(text, [{ op: "rescale", hoist }]);
	assert.equal(out.error, undefined);
	return out.text;
};

test("every kind of length is restated, and what isn't one stays", () => {
	const text = `${head}proportion hoist=10 fly=20
outline swallowtail {
  depth 2
  taper 1
}
border a 0.5
define own hoist=3 fly=4 {
  charge disc a {
    radius 1
    at fly=2 hoist=1
  }
}
define heart-shape {
  heart {
    radius 1
    spread 1.5
  }
}
bars a b a {
  ratio 1 2 1
  rotate 15
  opacity 0.5
  edge wavy depth=0.5 period=2
}
band a {
  along fly
  width 2
  offset 1
  fimbriate b 0.25
}
cross a {
  fly 8 2 10
  hoist 4 2 4
}
charge sun b {
  radius 2
  disc 1
  gap 0.25
  spread 0.5
  points 8
  at fly=3 hoist=4
}
charge star a {
  radius 1
  repeat line count=3 fly=2
  at center
}
charge heart-shape a {
  at fly=1 hoist=1
}
use own
adapt {
  wider extend
}
variant v {
  from invert
  ratio 2
  charge disc a {
    radius 3
  }
}
variant fixed {
  proportion hoist=1 fly=1
  charge disc a {
    radius 0.5
  }
}
fold half {
  over along=fly at=5 move=bottom
  over through="0 0 5 5" move="0 5"
}
`;
	assert.deepEqual(lib.validate(text), []);
	const out = restate(text, "20");
	assert.deepEqual(lib.validate(out), []);
	for (const want of ["proportion hoist=20 fly=40", "depth 4", "taper 2", "border a 1", "ratio 1 2 1", "rotate 15", "opacity 0.5", "edge wavy depth=1 period=4", "fimbriate b 0.5",
		"width 4", "offset 2", "fly 16 4 20", "hoist 8 4 8", "gap 0.5", "points 8", "at fly=6 hoist=8", "repeat line count=3 fly=4", "at center", "ratio 2", "over along=fly at=10 move=bottom", 'through="0 0 10 10"', 'move="0 10"', "cmyk 10 20 30 40"]) {
		assert.ok(out.includes(want), want);
	}
	assert.ok(out.includes("define own hoist=3 fly=4 {\n  charge disc a {\n    radius 1\n    at fly=2 hoist=1"), "a definition's own grid is its own");
	assert.ok(out.includes("proportion hoist=1 fly=1\n  charge disc a {\n    radius 0.5"), "as is a variant's");
	assert.ok(out.includes("radius 2\n    spread 3"), "a heart's spread is a distance");
	assert.ok(out.includes("  spread 0.5\n"), "a sun's is a share");
});

test("a number nobody knows the meaning of stops it, rather than being guessed at", () => {
	const text = `${head}proportion hoist=10 fly=20\nfield a\nmystery 5\n`;
	assert.match(applyOps(text, [{ op: "rescale", hoist: "20" }]).error, /mystery/);
	assert.match(rescalePreview(text, "20").error, /mystery/);
});

test("it says what it would round, and which grids wouldn't need to", () => {
	const text = `${head}proportion hoist=13 fly=24.7\ncanton {\n  fly 9.88\n  hoist 7\n  field a\n}\n`;
	const preview = rescalePreview(text, "10");
	assert.equal(preview.factor, "10/13");
	assert.ok(preview.rounded.some(([a, b]) => a === "7" && b === "5.384615"));
	assert.deepEqual(preview.exact[0], ["130", "247"]);
	assert.deepEqual(rescalePreview(text, "130").rounded, []);
	assert.match(rescalePreview(text, "0").error, /above 0/);
	assert.match(rescalePreview(text, "ten").error, /above 0/);
	assert.equal(rescalePreview(`// a comment\n${text}`, "130").comments, true);
	assert.equal(rescalePreview(text, "130").comments, false);
});

test("it leaves everything but the numbers alone", () => {
	const text = `// first\n${head}proportion hoist=10 fly=20 // grid\n\n// the field\nfield a\n`;
	assert.equal(restate(text, "20"), text.replace("hoist=10 fly=20", "hoist=20 fly=40"));
});

test("shapes read in the smallest whole numbers, exactly", () => {
	assert.equal(shapeText("13", "24.7"), "10:19");
	assert.equal(shapeText("2", "3"), "2:3");
	assert.equal(shapeText("1", "1.61803398875"), "1:1.61803398875");
	assert.equal(shapeText("0", "3"), null);
	assert.equal(flyPerHoist("13", "24.7"), "1.9");
	assert.equal(matching("10", "13", "24.7"), "19");
	assert.deepEqual(readExact("1_000.5e-1"), { n: 2001n, d: 20n });
	assert.deepEqual(readExact("0x10"), { n: 16n, d: 1n });
	assert.equal(readExact("ten"), null);
});

test("every flag there is can be restated and is still valid", () => {
	const dirs = [join(repo, "conformance/valid"), ...handWrittenDirs()].filter(existsSync);
	let count = 0;
	for (const dir of dirs) {
		for (const file of readdirSync(dir).filter((f) => f.endsWith(".kdl"))) {
			const text = readFileSync(join(dir, file), "utf8").replace(/\r\n?/g, "\n");
			const hoist = /^proportion hoist=(\S+)/m.exec(text)?.[1];
			if (hoist === undefined || lib.validate(text).length > 0) {
				continue;
			}
			const out = applyOps(text, [{ op: "rescale", hoist: String(Number(hoist) * 2) }]);
			assert.equal(out.error, undefined, `${file}: ${out.error}`);
			assert.deepEqual(lib.validate(out.text), [], file);
			count++;
		}
	}
	assert.ok(count > 40, String(count));
});
