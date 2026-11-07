// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Restates every flag on other grids and writes out both, for rescale_corpus.py to compare as
// pictures, which is the only way to know that nothing moved.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load, loadLibrary } from "./unit/load.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.argv[2];
const { applyOps } = await load("document");
const lib = await loadLibrary();
mkdirSync(out, { recursive: true });
const dirs = [join(repo, "conformance/valid"), resolve(repo, "../vexyl-flags/reviewed")].filter(existsSync);
let count = 0;
for (const dir of dirs) {
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".kdl"))) {
		const text = readFileSync(join(dir, file), "utf8").replace(/\r\n?/g, "\n");
		const hoist = Number(/^proportion hoist=(\S+)/m.exec(text)?.[1]);
		if (!(hoist > 0) || lib.validate(text).length > 0) {
			continue;
		}
		const stem = `${dir.endsWith("valid") ? "c" : "f"}-${file.slice(0, -4)}`;
		const flag = lib.parse(text);
		writeFileSync(join(out, `${stem}.svg`), lib.svg(flag, { height: 512 }));
		for (const [label, next] of [["double", hoist * 2], ["third", hoist / 3 * 1.0]]) {
			const done = applyOps(text, [{ op: "rescale", hoist: String(next) }]);
			if (done.error !== undefined) {
				throw new Error(`${file}: ${done.error}`);
			}
			writeFileSync(join(out, `${stem}.${label}.svg`), lib.svg(lib.parse(done.text), { height: 512 }));
		}
		count++;
	}
}
console.log(`${count} flags`);
process.exit(0);
