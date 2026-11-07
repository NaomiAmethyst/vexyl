// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Builds the modules that have no page to run in, as the site's build does, for tests to import.

import { build } from "esbuild";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "../..");
const out = join(web, "node_modules/.test-build");
mkdirSync(out, { recursive: true });

export async function load(name) {
	const file = join(out, `${name}-${process.pid}.mjs`);
	await build({
		bundle: true, format: "esm", platform: "neutral", target: "es2022", logLevel: "warning", outfile: file,
		entryPoints: [join(web, "src", `${name}.ts`)],
		mainFields: ["module", "main"],
		alias: {
			"vexyl/paths": resolve(web, "../ts/src/paths.ts"),
			"vexyl/hex": resolve(web, "../ts/src/hex.ts"),
			vexyl: resolve(web, "../ts/src/index.ts"),
			"@bgotink/kdl": resolve(web, "node_modules/@bgotink/kdl/index.js"),
			fflate: resolve(web, "node_modules/fflate/esm/browser.js"),
		},
	});
	return import(file);
}

export const loadLibrary = async () => {
	const file = join(out, `library-${process.pid}.mjs`);
	await build({
		bundle: true, format: "esm", platform: "neutral", target: "es2022", logLevel: "warning", outfile: file,
		entryPoints: [resolve(web, "../ts/src/index.ts")], mainFields: ["module", "main"],
		alias: { "@bgotink/kdl": resolve(web, "node_modules/@bgotink/kdl/index.js"), fflate: resolve(web, "node_modules/fflate/esm/browser.js") },
	});
	return import(file);
};

/** Every .kdl file under a folder, however deep, or none if it isn't there. */
export function kdlFiles(dir) {
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		return statSync(p).isDirectory() ? kdlFiles(p) : f.endsWith(".kdl") ? [p] : [];
	});
}

/** The folders of hand-written flags in a vexyl-flags checkout beside this one, one per family. */
export function handWrittenDirs() {
	const root = resolve(web, "../../vexyl-flags/flags");
	return existsSync(root) ? readdirSync(root).map((f) => join(root, f)).filter((p) => statSync(p).isDirectory()) : [];
}
