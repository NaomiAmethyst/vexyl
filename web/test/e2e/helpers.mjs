// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Runs the built site from a subpath, on a plain static server, in a browser whose requests to
// the outside world are all answered here. Nothing in these tests reaches a real service.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
export const web = resolve(here, "../..");
export const repo = resolve(web, "..");
export const flagsDir = process.env.VEXYL_FLAGS ?? resolve(repo, "../vexyl-flags");
export const subpath = "/some/sub/path/";

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain" };

export function serve(dist = process.env.VEXYL_DIST ?? join(web, "dist")) {
	return new Promise((done) => {
		const server = createServer((req, res) => {
			const url = new URL(req.url, "http://x");
			if (!url.pathname.startsWith(subpath)) {
				res.writeHead(404).end("not here");
				return;
			}
			let file = join(dist, url.pathname.slice(subpath.length));
			if (url.pathname.endsWith("/")) {
				file = join(file, "index.html");
			}
			if (!existsSync(file) || !statSync(file).isFile()) {
				res.writeHead(404).end("no");
				return;
			}
			res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
		});
		server.listen(0, "127.0.0.1", () => {
			done({ server, base: `http://127.0.0.1:${server.address().port}${subpath}`, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) });
		});
	});
}

function findChrome() {
	if (process.env.VEXYL_CHROME) {
		return process.env.VEXYL_CHROME;
	}
	const cache = join(process.env.HOME ?? "", ".cache/ms-playwright");
	if (existsSync(cache)) {
		for (const d of readdirSync(cache).sort().reverse()) {
			const p = join(cache, d, "chrome-linux64/chrome");
			if (d.startsWith("chromium-") && existsSync(p)) {
				return p;
			}
		}
	}
	return "/usr/bin/google-chrome";
}

export const launch = () => chromium.launch({ executablePath: findChrome(), headless: true });

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) {
			if (!name.startsWith(".")) {
				walk(p, out);
			}
		} else {
			out.push(p);
		}
	}
	return out;
}

let treeCache;
function treeJson(root) {
	treeCache ??= walk(root).filter((p) => p.endsWith(".kdl") && (relative(root, p).startsWith("reviewed/") || /^flags\/(country|pride|brazil)\//.test(relative(root, p)))).map((p) => ({ path: relative(root, p), type: "blob", size: statSync(p).size }));
	return JSON.stringify({ sha: "x", tree: treeCache, truncated: false });
}

const cors = { "access-control-allow-origin": "*", "access-control-expose-headers": "etag, x-ratelimit-remaining, x-ratelimit-reset", "access-control-allow-headers": "*" };

/**
 * Answers everything that would go to GitHub from a checkout of the flags, as GitHub does. It
 * records what was asked, and fails anything else, so that a test sees any other request.
 *
 * It also opens everything in Advanced, as most of these tests want, unless `basic` is given, which
 * leaves the choice to the page, as for someone who's new here.
 */
export async function mockWorld(context, opts = {}) {
	if (opts.basic !== true) {
		await context.addInitScript(() => {
			try {
				localStorage.setItem("vexyl.editor", "advanced");
			} catch {
				// A page without an origin has nowhere to keep it.
			}
		});
	}
	const log = { requests: [], foreign: [], writes: [] };
	const root = opts.root ?? flagsDir;
	await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
		const req = route.request();
		const url = new URL(req.url());
		log.requests.push(req.url());
		if (req.method() !== "GET" && req.method() !== "OPTIONS") {
			log.writes.push(req.url());
		}
		const custom = opts.custom?.(url, req);
		if (custom?.abort === true) {
			await route.abort("failed");
			return;
		}
		if (custom !== undefined) {
			await route.fulfill(custom);
			return;
		}
		if (req.method() === "OPTIONS") {
			await route.fulfill({ status: 204, headers: { ...cors, "access-control-allow-methods": "GET" } });
			return;
		}
		if (url.hostname === "api.github.com") {
			if (opts.repoMissing) {
				await route.fulfill({ status: 404, headers: cors, body: '{"message":"Not Found"}' });
				return;
			}
			if (opts.rateLimited) {
				await route.fulfill({ status: 403, headers: { ...cors, "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 1800) }, body: '{"message":"API rate limit exceeded"}' });
				return;
			}
			if (url.pathname.startsWith("/repos/NaomiAmethyst/vexyl-flags/git/trees/")) {
				if (req.headers()["if-none-match"] === '"tree-etag"') {
					await route.fulfill({ status: 304, headers: { ...cors, etag: '"tree-etag"' } });
					return;
				}
				await route.fulfill({ status: 200, headers: { ...cors, etag: '"tree-etag"', "content-type": "application/json", "x-ratelimit-remaining": "59" }, body: treeJson(root) });
				return;
			}
			if (url.pathname.startsWith("/gists/")) {
				const gist = opts.gists?.[url.pathname.slice(7)];
				await route.fulfill(gist === undefined ? { status: 404, headers: cors, body: "{}" } : { status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(gist) });
				return;
			}
			await route.fulfill({ status: 404, headers: cors, body: '{"message":"Not Found"}' });
			return;
		}
		if (url.hostname === "raw.githubusercontent.com") {
			const parts = url.pathname.split("/").slice(1).map(decodeURIComponent);
			const path = parts.slice(3).join("/");
			const file = join(root, path);
			if (parts[0] === "NaomiAmethyst" && parts[1] === "vexyl-flags" && !opts.repoMissing && existsSync(file) && statSync(file).isFile()) {
				await route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/plain; charset=utf-8" }, body: readFileSync(file) });
				return;
			}
			await route.fulfill({ status: 404, headers: cors, body: "404: Not Found" });
			return;
		}
		log.foreign.push(req.url());
		await route.abort("failed");
	});
	return log;
}

/** Records every way a page can go wrong, and every Content Security Policy violation. */
export function watch(page) {
	const errors = [];
	page.on("pageerror", (e) => { errors.push(`page error: ${e.message}`); });
	page.on("console", (m) => {
		if (m.type() === "error" && !/Failed to load resource|net::ERR_FAILED/.test(m.text())) {
			errors.push(`console: ${m.text()}`);
		}
	});
	return errors;
}

export const readFlag = (p) => readFileSync(join(flagsDir, p), "utf8");
export const fromRepo = (p) => readFileSync(join(repo, p), "utf8");
export const openUrl = (base, path) => `${base}?open=github:NaomiAmethyst/vexyl-flags/${path}`;

/** Waits until the flag has been read and drawn. */
export async function ready(page) {
	await page.locator(".status, .work.basic .stage-image").first().waitFor({ timeout: 60000 });
	await page.locator(".stage-image, .refusal").first().waitFor({ timeout: 60000 });
	await page.waitForFunction(() => document.querySelector(".stage-image")?.complete !== false, null, { timeout: 60000 });
}

/** The file as it would be saved, by saving it. */
export async function savedText(page) {
	const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download KDL" }).first().click()]);
	const path = await file.path();
	return readFileSync(path, "utf8");
}

/** Starts a new flag from the start screen, as a blank one unless told otherwise. */
export async function startFlag(page, layout = "blank", shape) {
	await page.locator(".start-tile").first().waitFor();
	if (shape !== undefined) {
		await page.getByRole("radio", { name: shape, exact: true }).click();
	}
	await page.locator(`.start-tile[data-layout="${layout}"]`).click();
	await ready(page);
}

export const axeSource = () => readFileSync(join(web, "node_modules/axe-core/axe.min.js"), "utf8");

/** Runs every axe rule, with none turned off, and gives what it finds. */
export async function axe(page) {
	await page.evaluate(axeSource());
	const result = await page.evaluate(async () => {
		const r = await globalThis.axe.run(document, { resultTypes: ["violations"] });
		return r.violations.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => `${n.target.join(" ")}: ${n.failureSummary?.split("\n").slice(1, 2).join(" ")}`) }));
	});
	return result;
}
