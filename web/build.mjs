// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Builds the editor into static files that work from any host, under any path. Everything it
// refers to is relative, and nothing is fetched from anywhere at runtime unless someone asks for a flag.

import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? join(here, "dist"));
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "fonts"), { recursive: true });

/** The design system's four themes as CSS variables, following the device with no script at all. */
export function themeCss(tokens) {
	const themes = ["dark", "light", "dark-high", "light-high"];
	const triples = {
		dark: { "ink-rgb": "255, 255, 255", "acc-rgb": "182, 156, 255", "fill-rgb": "122, 92, 240", "bg-rgb": "9, 8, 12", "warn-rgb": "232, 192, 122", "danger-rgb": "240, 160, 138", glow: "0.28" },
		light: { "ink-rgb": "40, 20, 90", "acc-rgb": "106, 75, 220", "fill-rgb": "122, 92, 240", "bg-rgb": "246, 244, 250", "warn-rgb": "168, 116, 31", "danger-rgb": "194, 85, 61", glow: "0.28" },
		"dark-high": { "ink-rgb": "255, 255, 255", "acc-rgb": "212, 196, 255", "fill-rgb": "122, 92, 240", "bg-rgb": "0, 0, 0", "warn-rgb": "232, 192, 122", "danger-rgb": "240, 160, 138", glow: "0" },
		"light-high": { "ink-rgb": "0, 0, 0", "acc-rgb": "58, 31, 160", "fill-rgb": "122, 92, 240", "bg-rgb": "255, 255, 255", "warn-rgb": "168, 116, 31", "danger-rgb": "194, 85, 61", glow: "0" },
	};
	const blocks = {};
	for (const theme of themes) {
		const lines = [`color-scheme: ${theme.startsWith("dark") ? "dark" : "light"};`];
		for (const t of tokens.color.tokens) {
			const v = typeof t.value === "string" ? t.value : t.value[theme];
			if (v !== undefined) {
				lines.push(`--${t.name}: ${v};`);
			}
		}
		for (const [name, v] of Object.entries(triples[theme])) {
			lines.push(`--${name}: ${v};`);
		}
		for (const t of tokens.shadow.tokens) {
			const v = typeof t.value === "string" ? t.value : t.value[theme];
			lines.push(`--${t.name}: ${v};`);
		}
		blocks[theme] = lines.join("\n    ");
	}
	const shared = [];
	for (const [name, family] of Object.entries(tokens.type.families)) {
		shared.push(`--font-${name}: ${family};`, `--${name}: ${family};`);
	}
	for (const t of tokens.radius.tokens) {
		shared.push(`--${t.name}: ${t.value};`);
	}
	return `:root {\n  ${shared.join("\n  ")}\n}
:root {\n    ${blocks.dark}\n}
@media (prefers-color-scheme: light) {\n  :root {\n    ${blocks.light}\n  }\n}
@media (prefers-contrast: more) {\n  :root {\n    ${blocks["dark-high"]}\n  }\n  :focus-visible {\n    outline: 3px solid var(--ink) !important;\n    outline-offset: 2px;\n  }\n  p a:not([class]), li a:not([class]) {\n    text-decoration: underline;\n    text-underline-offset: 2px;\n  }\n}
@media (prefers-contrast: more) and (prefers-color-scheme: light) {\n  :root {\n    ${blocks["light-high"]}\n  }\n}
`;
}

/** The design system's kit, without its own theme switches, which are above. */
function kitCss() {
	const kit = readFileSync(join(here, "design/kit.css"), "utf8");
	const body = kit.slice(kit.indexOf("/* --- Base"));
	return body.replace(/\[data-theme='[a-z-]+'\][^{}]*\{[^{}]*\}/g, "");
}

const fonts = [
	["Geist", "geist-sans", 400, "normal"], ["Geist", "geist-sans", 500, "normal"], ["Geist", "geist-sans", 600, "normal"], ["Geist", "geist-sans", 700, "normal"],
	["Geist Mono", "geist-mono", 400, "normal"], ["Geist Mono", "geist-mono", 500, "normal"],
	["Instrument Serif", "instrument-serif", 400, "normal"], ["Instrument Serif", "instrument-serif", 400, "italic"],
];

function fontCss() {
	let css = "";
	for (const [family, pack, weight, style] of fonts) {
		const name = `${pack}-latin-${weight}-${style}.woff2`;
		copyFileSync(join(here, `node_modules/@fontsource/${pack}/files/${name}`), join(out, "fonts", name));
		css += `@font-face {\n  font-family: "${family}";\n  font-style: ${style};\n  font-weight: ${weight};\n  font-display: swap;\n  src: url("fonts/${name}") format("woff2");\n}\n`;
	}
	for (const pack of ["geist-sans", "instrument-serif"]) {
		copyFileSync(join(here, `node_modules/@fontsource/${pack}/LICENSE`), join(out, "fonts", `LICENSE-${pack}.txt`));
	}
	return css;
}

const css = fontCss() + themeCss(JSON.parse(readFileSync(join(here, "design/tokens.json"), "utf8"))) + kitCss() + readFileSync(join(here, "src/style.css"), "utf8");

const shared = {
	bundle: true,
	minify: true,
	format: "esm",
	target: ["es2022"],
	legalComments: "none",
	sourcemap: false,
	jsx: "automatic",
	jsxImportSource: "preact",
	define: { "process.env.NODE_ENV": '"production"' },
	alias: {
		"vexyl/paths": resolve(here, "../ts/src/paths.ts"),
		vexyl: resolve(here, "../ts/src/index.ts"),
		"@bgotink/kdl": resolve(here, "node_modules/@bgotink/kdl/index.js"),
		fflate: resolve(here, "node_modules/fflate/esm/browser.js"),
	},
	nodePaths: [join(here, "node_modules")],
	logLevel: "warning",
	metafile: true,
};

const app = await build({ ...shared, entryPoints: [join(here, "src/main.tsx")], outfile: join(out, "app.js") });
const worker = await build({ ...shared, format: "iife", entryPoints: [join(here, "src/worker.ts")], outfile: join(out, "worker.js") });

writeFileSync(join(out, "style.css"), (await import("esbuild")).transformSync(css, { loader: "css", minify: true }).code);
copyFileSync(resolve(here, "../docs/logo/vexyl.svg"), join(out, "favicon.svg"));
copyFileSync(resolve(here, "../LICENSE"), join(out, "LICENSE.txt"));
copyFileSync(join(here, "NOTICE"), join(out, "NOTICE.txt"));
copyFileSync(join(here, "src/index.html"), join(out, "index.html"));

const size = (m) => Object.values(m.outputs).reduce((a, o) => a + o.bytes, 0);
if (process.env.VEXYL_ANALYZE) {
	const inputs = Object.entries(app.metafile.outputs)[0][1].inputs;
	for (const [k, v] of Object.entries(inputs).sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput).slice(0, 25)) {
		console.log(v.bytesInOutput, k);
	}
}
console.log(`built ${out}: app.js ${size(app.metafile)} bytes, worker.js ${size(worker.metafile)} bytes`);
