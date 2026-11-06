// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync } from "fflate";
import { layerAt, locate, parentPath, parse, shareDecode, shareDictionary, shareEncode, shareMaxBytes, ShareError, svg } from "../src/index.js";
import type { Options } from "../src/index.js";
import { header, root } from "./helpers.js";

const body = (link: string): Uint8Array => new Uint8Array(Buffer.from(link.slice(3), "base64url"));
const linkOf = (bytes: Uint8Array): string => "v1." + Buffer.from(bytes).toString("base64url");

test("the dictionary is the normative file, which can't change", () => {
	const file = readFileSync(join(root, "share/v1.dict"));
	assert.deepEqual(Buffer.from(shareDictionary()), file);
	assert.equal(createHash("sha256").update(file).digest("hex"), "92062df2fd010bea13d1aefb30c2cfbb2ad6aee5a60e8f8e2d2455516c1c6b97");
});

test("a document comes back exactly", () => {
	for (const source of [header + "field a\n", "", "é\r\n﻿", "__proto__ 🏳️‍🌈"]) {
		const link = shareEncode(source);
		assert.match(link, /^v1\.[A-Za-z0-9_-]*$/);
		assert.equal(shareDecode(link), source);
	}
});

test("a document at the limit comes back, and one over it isn't written", () => {
	const source = "a".repeat(shareMaxBytes);
	assert.equal(shareDecode(shareEncode(source)).length, shareMaxBytes);
	assert.throws(() => shareEncode(source + "a"), ShareError);
});

test("a compression bomb stops at the limit", () => {
	const bomb = linkOf(deflateSync(new Uint8Array(64 * 1024 * 1024), { level: 9, dictionary: shareDictionary() }));
	assert.ok(bomb.length < 300_000);
	assert.throws(() => shareDecode(bomb), /limit/);
});

test("anything an encoder wouldn't write is refused", () => {
	const good = shareEncode(header + "field a\n");
	for (const bad of [good.slice(3), "v2" + good.slice(2), "v01." + good.slice(3), good + "=", good.slice(0, 9) + "\n" + good.slice(9), good.slice(0, 9) + "+" + good.slice(10), "v1.", good.slice(0, good.length >> 1), linkOf(new Uint8Array([...body(good), 0]))]) {
		assert.throws(() => shareDecode(bad), ShareError, bad.slice(0, 30));
	}
});

const sample = `vexyl 1
meta { name "T"; }
palette { a "#112233"; b "#445566"; __proto__ "#778899"; }
proportion hoist=10 fly=20
define inner {
  charge disc a { radius 1; }
  field b
}
bars a b
canton {
  fly 8
  hoist 5
  field a
  charge star b { radius 1; repeat grid rows=2 columns=2; }
}
group {
  clip { disc { radius 3; }; }
  cut { disc { radius 1; }; }
  use inner
}
emblem { charge disc b { radius 1; }; charge disc a { radius 1; at fly=2 hoist=0; }; }
reverse { field a; }
variant "a/b%" { field b; }
variant turned { from transpose; }
fold half { over along=fly at=5 move=bottom; }
`;

const paths = (text: string): string[] => [...new Set([...text.matchAll(/data-vexyl-layer="([^"]*)"/g)].map((m) => m[1]!))].sort();

test("a tagged render differs only in its tags", () => {
	const flag = parse(sample);
	const forms: Options[] = [{}, { side: "reverse" }, { variant: "a/b%" }, { variant: "turned" }, { fold: "half" }, { ratio: 1, fit: "pad" }];
	for (const opts of forms) {
		const plain = svg(flag, opts);
		assert.ok(!plain.includes("data-vexyl-layer"), "a plain render has tags");
		const tagged = svg(flag, { ...opts, tags: true });
		assert.ok(tagged.includes("data-vexyl-layer"));
		assert.equal(tagged.replace(/ data-vexyl-layer="[^"]*"/g, ""), plain);
	}
});

test("tags name the layer that drew each element", () => {
	const flag = parse(sample);
	const own = ["0", "1.0", "1.1", "2.0", "3.0", "3.1"];
	assert.deepEqual(paths(svg(flag, { tags: true })), own);
	assert.deepEqual(paths(svg(flag, { tags: true, side: "reverse" })), ["reverse/0"]);
	assert.deepEqual(paths(svg(flag, { tags: true, variant: "a/b%" })), ["variant/a%2Fb%25/0"]);
	assert.deepEqual(paths(svg(flag, { tags: true, variant: "turned" })), own);
});

test("parts of a document are found on their lines, and lines lead back to them", () => {
	const spans = locate(sample);
	const at = new Map(spans.map((s) => [s.path, s]));
	const lines: Record<string, [number, number]> = {
		meta: [2, 2], "palette/__proto__": [3, 3], "define/inner": [5, 8], "define/inner/1": [7, 7], "0": [9, 9], "1": [10, 15], "1.1": [14, 14],
		"2.0": [19, 19], "reverse/0": [22, 22], "variant/a%2Fb%25/0": [23, 23], "fold/half": [25, 25],
	};
	for (const [path, [line, endLine]] of Object.entries(lines)) {
		assert.equal(at.get(path)?.line, line, path);
		assert.equal(at.get(path)?.endLine, endLine, path);
	}
	assert.equal(layerAt(spans, 14)?.path, "1.1");
	assert.equal(layerAt(spans, 11)?.path, "1");
	assert.deepEqual(locate("bars {"), []);
	assert.equal(locate("vexyl 1\r\nbars a\r\n")[1]?.line, 2);
	assert.equal(parentPath("variant/a.b/1.2"), "variant/a.b/1");
	assert.equal(parentPath("variant/a.b/1"), undefined);
});
