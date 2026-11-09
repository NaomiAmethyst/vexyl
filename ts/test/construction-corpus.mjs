// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Draws a construction sheet for every form of every flag in a vexyl-flags checkout, in each kind of units, and
// counts the labels that overlap each other, cross the flag's edge or leave the sheet. It needs the
// library built first, and takes the checkout's path, or finds one beside this repository. It draws
// --jobs flags at once, by default $VEXYL_JOBS or one for each CPU, each in a worker, and reports
// them in the same order whatever that is.
//
//   node test/construction-corpus.mjs [../vexyl-flags] [-v] [--jobs=N]

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { parse } from "../dist/index.js";
import { constructionSheet } from "../dist/construction.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = isMainThread ? process.argv.slice(2) : workerData.args;
const verbose = args.includes("-v");
const jobs = Number(args.find((a) => a.startsWith("--jobs="))?.slice("--jobs=".length) || process.env.VEXYL_JOBS || availableParallelism());
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
// A checkout in some other layout, or part way through a rebase, would otherwise pass with nothing checked.
if (files.length === 0) {
	console.error(`no flags in ${join(root, "flags")} or ${join(root, "imported")}`);
	process.exit(2);
}
const runs = [{ units: "grid" }, { units: "hoist" }, { units: "mm", hoistMm: 1000 }, { units: "grid", paper: "fit", theme: "dark", grid: true }];

/** Every form of a flag: the flag, its reverse, and each variant, from the front and from behind. */
function formsOf(flag) {
	const forms = [{}, { side: "reverse" }];
	for (const variant of Object.keys(flag.variants)) {
		forms.push({ variant }, { variant, side: "reverse" });
	}
	return forms;
}

/** Draws every sheet of one file, and says what went wrong with them. */
function sheetsOf(file) {
	let flag;
	try {
		flag = parse(readFileSync(file, "utf8"), file);
	} catch {
		// A file that doesn't parse has no sheet, and the corpus's own checks report it.
		return { skipped: true };
	}
	const path = relative(root, file);
	const name = path.split("/").at(-1).replace(/\.kdl$/, "");
	const crashes = [];
	const found = [];
	let sheets = 0;
	let count = 0;
	for (const form of formsOf(flag)) {
		const which = [form.variant, form.side].filter((x) => x !== undefined).join(" ");
		for (const run of runs) {
			let sheet;
			try {
				sheet = constructionSheet(flag, { ...run, form, path, ...(tiers.has(name) ? { tier: tiers.get(name) } : {}) });
			} catch (e) {
				crashes.push(`CRASH ${path} ${JSON.stringify({ ...run, form })}: ${e.stack}`);
				continue;
			}
			sheets++;
			const list = collisions(sheet);
			count += list.length;
			for (const c of list) {
				found.push({ kind: c.slice(0, c.indexOf(":")), text: `${which === "" ? "" : `${which}, `}${run.units}${run.paper === "fit" ? " fit" : ""}: ${c}` });
			}
		}
	}
	return { skipped: false, path, crashes, sheets, count, found };
}

/** Each file's sheets, in the files' order, from workers that each take every jobs-th file. */
function allSheets() {
	if (jobs <= 1) {
		return Promise.resolve(files.map(sheetsOf));
	}
	const results = new Array(files.length);
	return Promise.all(Array.from({ length: Math.min(jobs, files.length) }, (_, k) => new Promise((done, failed) => {
		const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { args, k, jobs } });
		worker.on("message", ({ index, result }) => {
			results[index] = result;
		});
		worker.on("error", failed);
		worker.on("exit", (code) => (code === 0 ? done() : failed(new Error(`a worker exited with ${code}`))));
	}))).then(() => results);
}

/** Adds up every file's sheets, and reports them as one run through all of them would. */
async function report() {
	let sheets = 0;
	let crashes = 0;
	let skipped = 0;
	let total = 0;
	const kinds = new Map();
	const worst = [];
	const started = Date.now();
	for (const result of await allSheets()) {
		if (result.skipped) {
			skipped++;
			continue;
		}
		for (const crash of result.crashes) {
			crashes++;
			console.log(crash);
		}
		sheets += result.sheets;
		for (const { kind } of result.found) {
			kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
		}
		total += result.count;
		if (result.count > 0) {
			worst.push({ path: result.path, count: result.count, found: result.found.map((f) => f.text) });
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
}

if (isMainThread) {
	await report();
} else {
	for (let index = workerData.k; index < files.length; index += workerData.jobs) {
		parentPort.postMessage({ index, result: sheetsOf(files[index]) });
	}
}
