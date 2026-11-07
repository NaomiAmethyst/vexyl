// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "./load.mjs";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const lib = await loadLibrary();

test("the site's bundle of the library reads and writes links", () => {
	const text = readFileSync(resolve(web, "../conformance/valid/united-states.kdl"), "utf8");
	assert.equal(lib.shareDecode(lib.shareEncode(text)), text);
});

test("the page's policy is as tight as it says", () => {
	const html = readFileSync(resolve(web, "src/index.html"), "utf8");
	const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
	assert.ok(csp.includes("default-src 'none'"));
	assert.ok(csp.includes("script-src 'self'"));
	assert.ok(csp.includes("style-src 'self'"));
	assert.ok(!csp.includes("unsafe"), "nothing unsafe is allowed");
	assert.ok(csp.includes("base-uri 'none'"));
	assert.ok(csp.includes("form-action 'none'"));
});

test("nothing is fetched from a font service, or anywhere else, at load", () => {
	const css = readFileSync(resolve(web, "src/style.css"), "utf8") + readFileSync(resolve(web, "build.mjs"), "utf8");
	assert.ok(!css.includes("fonts.googleapis.com"));
	assert.ok(!/url\(["']?https?:/.test(css));
});
