// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, svg, type Options } from "../src/index.js";

/** The repository's root, wherever the compiled tests ended up. */
export const root = (() => {
	let dir = dirname(fileURLToPath(import.meta.url));
	while (!existsSync(join(dir, "SDK.md"))) {
		const parent = dirname(dir);
		if (parent === dir) {
			throw new Error("can't find the repository");
		}
		dir = parent;
	}
	return dir;
})();

export const readRepo = (path: string): string => readFileSync(join(root, path), "utf8");

/** Starts a valid document on a 10 by 20 grid. */
export const header = `vexyl 1
meta { name "T"; }
palette { a "#112233"; b "#445566"; }
proportion hoist=10 fly=20
`;

export const render = (src: string, opts: Options = {}): string => svg(parse(src), opts);

/** Takes out what's unique to a document, so that two forms of the same drawing can be compared. */
export const withoutIds = (text: string): string => text.replace(/vx-[0-9a-f]+-([0-9a-f]{4}-)?/g, "vx-");
