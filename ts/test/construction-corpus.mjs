// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Draws a construction sheet for every flag in a vexyl-flags checkout, in each kind of units, and
// counts the labels that overlap each other, cross the flag's edge or leave the sheet. It needs the
// library built first, and takes the checkout's path, or finds one beside this repository.
//
//   node test/construction-corpus.mjs [../vexyl-flags] [-v]

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../dist/index.js";
import { constructionSheet } from "../dist/construction.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const verbose = args.includes("-v");
const root = resolve(args.find((a) => !a.startsWith("-")) ?? join(here, "../../../vexyl-flags"));
if (!existsSync(root)) {
	console.error(`no vexyl-flags checkout at ${root}`);
	process.exit(2);
}

function kdlFiles(dir) {
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir).sort().flatMap((f) => {
		const p = join(dir, f);
		return statSync(p).isDirectory() ? kdlFiles(p) : f.endsWith(".kdl") ? [p] : [];
	});
}

const tiers = new Map();
if (existsSync(join(root, "evidence.tsv"))) {
	for (const line of readFileSync(join(root, "evidence.tsv"), "utf8").split("\n").slice(1)) {
		const [name, tier] = line.split("\t");
		if (name && tier) {
			tiers.set(name, tier);
		}
	}
}

/** How much two boxes overlap, as an area, so that boxes that only touch don't count. */
const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** Every way a sheet's labels collide, as short descriptions. */
export function collisions(sheet) {
	const out = [];
	const { labels, flag } = sheet;
	for (let i = 0; i < labels.length; i++) {
		const a = labels[i];
		if (a.x0 < -0.5 || a.y0 < -0.5 || a.x1 > sheet.width + 0.5 || a.y1 > sheet.height + 0.5) {
			out.push(`leaves the sheet: ${a.text}`);
		}
		const inside = a.x0 >= flag.x0 - 0.5 && a.x1 <= flag.x1 + 0.5 && a.y0 >= flag.y0 - 0.5 && a.y1 <= flag.y1 + 0.5;
		if (a.onFlag ? !inside : overlap(a, flag) > 0.5) {
			out.push(`crosses the flag's edge: ${a.text}`);
		}
		for (let j = i + 1; j < labels.length; j++) {
			if (overlap(a, labels[j]) > 0.5) {
				out.push(`overlap: ${a.text} | ${labels[j].text}`);
			}
		}
	}
	return out;
}

const files = [...kdlFiles(join(root, "flags")), ...kdlFiles(join(root, "imported"))];
const runs = [{ units: "grid" }, { units: "hoist" }, { units: "mm", hoistMm: 1000 }, { units: "grid", paper: "fit", theme: "dark", grid: true }];
let sheets = 0;
let crashes = 0;
let skipped = 0;
let total = 0;
const kinds = new Map();
const worst = [];
const started = Date.now();
for (const file of files) {
	let flag;
	try {
		flag = parse(readFileSync(file, "utf8"), file);
	} catch {
		// A file that doesn't parse has no sheet, and the corpus's own checks report it.
		skipped++;
		continue;
	}
	const path = relative(root, file);
	const name = path.split("/").at(-1).replace(/\.kdl$/, "");
	let count = 0;
	const found = [];
	for (const run of runs) {
		let sheet;
		try {
			sheet = constructionSheet(flag, { ...run, path, ...(tiers.has(name) ? { tier: tiers.get(name) } : {}) });
		} catch (e) {
			crashes++;
			console.log(`CRASH ${path} ${JSON.stringify(run)}: ${e.stack}`);
			continue;
		}
		sheets++;
		const list = collisions(sheet);
		count += list.length;
		for (const c of list) {
			const kind = c.slice(0, c.indexOf(":"));
			kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
			found.push(`${run.units}${run.paper === "fit" ? " fit" : ""}: ${c}`);
		}
	}
	total += count;
	if (count > 0) {
		worst.push({ path, count, found });
	}
}
worst.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
console.log(`${files.length} files, ${skipped} not valid, ${sheets} sheets in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(`${crashes} crashes, ${total} collisions on ${worst.length} flags`);
for (const [kind, n] of kinds) {
	console.log(`  ${kind}: ${n}`);
}
for (const w of verbose ? worst : worst.slice(0, 10)) {
	console.log(`${w.count}\t${w.path}`);
	for (const f of w.found.slice(0, verbose ? Infinity : 4)) {
		console.log(`\t${f}`);
	}
}
process.exit(crashes > 0 ? 1 : 0);
