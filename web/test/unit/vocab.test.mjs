// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load, loadLibrary } from "./load.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const v = await load("vocab");
const { outline, applyOps } = await load("document");
const lib = await loadLibrary();
const sdk = readFileSync(join(repo, "SDK.md"), "utf8");

/** The names in the first column of a table in SDK.md that starts with this heading. */
function column(heading) {
	const start = sdk.indexOf(`| ${heading} |`);
	assert.ok(start >= 0, heading);
	const rows = [];
	for (const line of sdk.slice(start).split("\n").slice(2)) {
		if (!line.startsWith("|")) {
			break;
		}
		rows.push(...[...line.split("|")[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]));
	}
	return rows;
}

test("every layer in the SDK's table is in the form's", () => {
	for (const name of column("`layer`")) {
		assert.ok(Object.hasOwn(v.layers, name), name);
	}
});

test("every shape in the SDK's table is in the form's", () => {
	for (const name of column("`shape`").filter((s) => s !== "pile" && s !== "pall")) {
		assert.ok(Object.hasOwn(v.shapes, name), name);
	}
});

test("every skeleton is valid, on a flag with colors", () => {
	const head = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n  b "#445566"\n}\nproportion hoist=10 fly=20\nfield a\n';
	const keys = v.addable.flatMap((g) => g.items.map(([k]) => k));
	assert.ok(keys.length > 30);
	for (const key of keys) {
		const text = v.skeletonFor(key, ["a", "b"]);
		const palette = outline(head).find((n) => n.name === "palette");
		const out = applyOps(head, [{ op: "add", at: key === "color" || key === "gradient" ? palette.at : null, text }]);
		assert.equal(out.error, undefined, key);
		assert.deepEqual(lib.validate(out.text), [], `${key}:\n${out.text}`);
	}
});

test("a skeleton copes with a palette of awkward names, or none", () => {
	assert.equal(v.skeletonFor("field", ["__proto__"]), "field __proto__");
	assert.equal(v.skeletonFor("field", ["has space"]), 'field "has space"');
	assert.equal(v.skeletonFor("field", ["true"]), 'field "true"');
	assert.equal(v.skeletonFor("field", []), "field none");
});

const walk = (dir, out = []) => {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) {
			walk(p, out);
		} else if (p.endsWith(".kdl") && statSync(p).size < 512 * 1024) {
			out.push(p);
		}
	}
	return out;
};

test("across real flags, the only things the form leaves to the source are the known ones", () => {
	const dirs = [join(repo, "conformance/valid"), join(repo, "conformance/accepted"), resolve(repo, "../vexyl-flags/reviewed"), resolve(repo, "../vexyl-flags/flags/pride")].filter(existsSync);
	const left = new Map();
	let looked = 0;
	const visit = (nodes, parent) => {
		for (const n of nodes) {
			const inPalette = parent === "palette";
			const { term, fields, extra } = v.fieldsFor(n, inPalette);
			const hasTable = term !== null || inPalette;
			if (n.path !== undefined && hasTable) {
				looked++;
				const handled = v.handledChildren([...fields, ...extra]);
				for (const k of n.kids) {
					if (!handled.has(k.name) && !(term?.layers === true && k.path !== undefined)) {
						const key = `${n.name} > ${k.name}`;
						left.set(key, (left.get(key) ?? 0) + 1);
					}
				}
			}
			visit(n.kids, n.name);
		}
	};
	for (const d of dirs) {
		for (const f of walk(d)) {
			const nodes = outline(readFileSync(f, "utf8").replace(/\r\n?/g, "\n"));
			if (nodes !== null) {
				visit(nodes, null);
			}
		}
	}
	assert.ok(looked > 1000, String(looked));
	// What a definition holds is itself left to the source if it's one shape rather than layers.
	const allowed = /^(define > .*|outline > (polygon|path)|[a-z]+ > (clip|cut))$/;
	const other = [...left.keys()].filter((k) => !allowed.test(k));
	assert.deepEqual(other, [], JSON.stringify([...left.entries()]));
});
