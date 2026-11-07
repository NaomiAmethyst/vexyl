// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Builds the modules that have no page to run in, as the site's build does, for tests to import.

import { build } from "esbuild";
import { mkdirSync } from "node:fs";
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
