// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { launch, mockWorld, openUrl, readFlag, ready, savedText, serve, watch } from "./helpers.mjs";

let srv;
let browser;
before(async () => {
	srv = await serve();
	browser = await launch();
});
after(async () => {
	await browser.close();
	await srv.close();
});

async function fresh(world = {}) {
	const context = await browser.newContext({ viewport: { width: 1440, height: 1160 }, colorScheme: "dark", acceptDownloads: true });
	const log = await mockWorld(context, world);
	const p = await context.newPage();
	return { p, context, log, errors: watch(p) };
}

const gistId = "0123456789abcdef0123456789abcdef";

test("the GitHub tab lists the default repository's flags, with real links", async () => {
	const { p, context, log, errors } = await fresh();
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "GitHub" }).waitFor();
	assert.equal(await p.getByLabel("Repository").inputValue(), "NaomiAmethyst/vexyl-flags");
	assert.equal(await p.getByLabel("Branch").inputValue(), "main");
	await p.getByRole("button", { name: /^country \d+$/ }).click();
	const row = p.locator('a.file-row[data-file="flags/country/japan.kdl"]');
	await row.waitFor();
	assert.equal(await row.getAttribute("href"), "?open=github:NaomiAmethyst/vexyl-flags/flags/country/japan.kdl");
	await row.click();
	await p.locator(".preview-name", { hasText: "Japan" }).waitFor();
	await p.locator(".preview img").waitFor();
	assert.ok(p.url().includes("view=open"), "a plain click previews it");
	await p.getByRole("searchbox", { name: "Search this folder" }).or(p.getByLabel("Search this folder")).fill("united-st");
	await p.locator('a.file-row[data-file="flags/country/united-states.kdl"]').waitFor();
	assert.equal(await p.locator("a.file-row").count(), 1);
	await p.locator(".preview").getByRole("link", { name: "Open this flag" }).click();
	await ready(p);
	assert.ok(p.url().includes("?open=github:NaomiAmethyst/vexyl-flags/flags/country/japan.kdl"), p.url());
	assert.equal(log.requests.filter((u) => u.includes("api.github.com")).length, 1, "the tree is one request");
	assert.deepEqual(errors, []);
	await context.close();
});

test("a row opens in a new tab on a middle click", async () => {
	const { p, context } = await fresh();
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("button", { name: /^country \d+$/ }).click();
	const row = p.locator('a.file-row[data-file="flags/country/japan.kdl"]');
	const [tab] = await Promise.all([context.waitForEvent("page"), row.click({ button: "middle" })]);
	await ready(tab);
	assert.ok(tab.url().includes("flags/country/japan.kdl"));
	assert.equal(await tab.locator(".flag-name").textContent(), "Japan");
	await context.close();
});

test("the tree is asked for once, and after that with an ETag", async () => {
	const { p, context, log } = await fresh();
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("button", { name: /^country \d+$/ }).waitFor();
	const asked = [];
	p.on("request", (r) => {
		if (r.url().includes("/git/trees/")) {
			asked.push(r.headers()["if-none-match"]);
		}
	});
	await p.reload();
	await p.getByRole("button", { name: /^country \d+$/ }).waitFor();
	assert.deepEqual(asked, ['"tree-etag"']);
	assert.ok(log.requests.length > 0);
	await context.close();
});

test("a repository that isn't there is handled, and the other tabs still work", async () => {
	const { p, context, errors } = await fresh({ repoMissing: true });
	await p.goto(`${srv.base}?view=open`);
	await p.getByText("doesn't have NaomiAmethyst/vexyl-flags").waitFor();
	await p.getByText("Your own repositories work too").first().waitFor();
	await p.getByRole("button", { name: "Start a new flag" }).waitFor();
	await p.getByRole("tab", { name: "Paste" }).click();
	await p.getByLabel("KDL").waitFor();
	assert.deepEqual(errors, []);
	await context.close();
});

test("a file that isn't there says so", async () => {
	const { p, context } = await fresh({ repoMissing: true });
	await p.goto(openUrl(srv.base, "flags/country/japan.kdl"));
	await p.getByRole("heading", { name: "That flag didn't open" }).waitFor();
	await p.getByText("doesn't have flags/country/japan.kdl").waitFor();
	await context.close();
});

test("rate limiting is explained", async () => {
	const { p, context } = await fresh({ rateLimited: true });
	await p.goto(`${srv.base}?view=open`);
	await p.getByText("about 60 requests an hour").waitFor();
	await context.close();
});

test("a gist with one flag opens straight away", async () => {
	const body = readFlag("flags/country/japan.kdl");
	const { p, context } = await fresh({ gists: { [gistId]: { files: { "japan.kdl": { filename: "japan.kdl", raw_url: "https://gist.githubusercontent.com/x/raw/japan.kdl", size: body.length, content: body }, "notes.txt": { filename: "notes.txt", raw_url: "https://gist.githubusercontent.com/x/raw/n", size: 1, content: "x" } } } } });
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "Gist" }).click();
	await p.getByLabel("Gist link or ID").fill(`https://gist.github.com/someone/${gistId}`);
	await p.getByRole("button", { name: "Load" }).click();
	await ready(p);
	assert.ok(p.url().includes(`?open=gist:${gistId}/japan.kdl`), p.url());
	assert.equal(await p.locator(".flag-name").textContent(), "Japan");
	await context.close();
});

test("a gist with several flags lists them, by real links", async () => {
	const a = readFlag("flags/country/japan.kdl");
	const b = readFlag("flags/country/sweden.kdl");
	const { p, context } = await fresh({ gists: { [gistId]: { files: { "a.kdl": { filename: "a.kdl", raw_url: "https://gist.githubusercontent.com/x/raw/a", size: a.length, content: a }, "b.kdl": { filename: "b.kdl", raw_url: "https://gist.githubusercontent.com/x/raw/b", size: b.length, content: b } } } } });
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "Gist" }).click();
	await p.getByLabel("Gist link or ID").fill(gistId);
	await p.getByRole("button", { name: "Load" }).click();
	const link = p.getByRole("link", { name: "b.kdl" });
	await link.waitFor();
	await link.click();
	await ready(p);
	assert.equal(await p.locator(".flag-name").textContent(), "Sweden");
	await context.close();
});

test("a gist that doesn't exist, and something that isn't one, are told apart", async () => {
	const { p, context } = await fresh();
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "Gist" }).click();
	await p.getByLabel("Gist link or ID").fill("what");
	await p.getByRole("button", { name: "Load" }).click();
	await p.getByText("isn't a gist's link or ID").waitFor();
	await p.getByLabel("Gist link or ID").fill(gistId);
	await p.getByRole("button", { name: "Load" }).click();
	await p.getByText("GitHub has no gist with that ID.").waitFor();
	await context.close();
});

test("a file from this computer stays in the browser, and survives a reload", async () => {
	const { p, context, log } = await fresh();
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "This computer" }).click();
	await p.getByText("It stays in your browser. Nothing is uploaded.").waitFor();
	await p.locator('input[type="file"]').setInputFiles({ name: "mine.kdl", mimeType: "text/plain", buffer: Buffer.from(readFlag("flags/country/sweden.kdl")) });
	await ready(p);
	assert.equal(await p.locator(".file-name").textContent(), "mine.kdl");
	assert.deepEqual(log.writes, [], "nothing's sent anywhere");
	assert.ok(!log.requests.some((u) => u.includes("mine")));
	await p.waitForTimeout(600);
	await p.reload();
	await ready(p);
	assert.equal(await p.locator(".flag-name").textContent(), "Sweden");
	assert.equal(await p.locator(".file-name").textContent(), "mine.kdl");
	await context.close();
});

test("a file too large is refused before it's read", async () => {
	const { p, context } = await fresh();
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "This computer" }).click();
	await p.locator('input[type="file"]').setInputFiles({ name: "big.kdl", mimeType: "text/plain", buffer: Buffer.alloc(17 * 1024 * 1024, 32) });
	await p.getByText("reads up to 16 MB").waitFor();
	await context.close();
});

test("pasting opens a file, problems and all", async () => {
	const { p, context } = await fresh();
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "Paste" }).click();
	await p.getByLabel("KDL").fill("vexyl 1\nbars {");
	await p.getByRole("button", { name: "Open", exact: true }).click();
	await p.locator(".status.bad").waitFor();
	await context.close();
});

test("a GitHub page link becomes the raw file", async () => {
	const { p, context, log } = await fresh();
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "Link" }).click();
	await p.getByLabel("Link to a KDL file").fill("https://github.com/NaomiAmethyst/vexyl-flags/blob/main/flags/country/japan.kdl");
	await p.getByRole("button", { name: "Open", exact: true }).click();
	await ready(p);
	assert.ok(p.url().includes("?open=github:NaomiAmethyst/vexyl-flags/flags/country/japan.kdl"), p.url());
	assert.ok(log.requests.some((u) => u === "https://raw.githubusercontent.com/NaomiAmethyst/vexyl-flags/main/flags/country/japan.kdl"));
	assert.ok(!log.requests.some((u) => u.startsWith("https://github.com/")), "the page itself is never fetched");
	await context.close();
});

test("a link to a site that allows it opens, and one that doesn't is explained", async () => {
	const body = readFlag("flags/country/japan.kdl");
	const { p, context } = await fresh({
		custom: (url) => {
			if (url.hostname === "allowed.test") {
				return { status: 200, headers: { "access-control-allow-origin": "*" }, body };
			}
			if (url.hostname === "refuses.test") {
				// A browser gives a page the same failure for this as for no network at all.
				return { abort: true };
			}
			return undefined;
		},
	});
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "Link" }).click();
	await p.getByLabel("Link to a KDL file").fill("https://refuses.test/a.kdl");
	await p.getByRole("button", { name: "Open", exact: true }).click();
	await p.getByText("doesn't allow other sites to read its files").waitFor();
	await p.getByLabel("Link to a KDL file").fill("http://allowed.test/a.kdl");
	await p.getByRole("button", { name: "Open", exact: true }).click();
	await p.getByText("Only https links").waitFor();
	await p.getByLabel("Link to a KDL file").fill("https://allowed.test/a.kdl");
	await p.getByRole("button", { name: "Open", exact: true }).click();
	await ready(p);
	assert.ok(p.url().includes("?open=url:https:"), p.url());
	assert.equal(await p.locator(".flag-name").textContent(), "Japan");
	await context.close();
});

test("a download is cut off at the limit", async () => {
	const { p, context } = await fresh({
		custom: (url) => (url.hostname === "huge.test" ? { status: 200, headers: { "access-control-allow-origin": "*" }, body: Buffer.alloc(17 * 1024 * 1024, 32) } : undefined),
	});
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "Link" }).click();
	await p.getByLabel("Link to a KDL file").fill("https://huge.test/a.kdl");
	await p.getByRole("button", { name: "Open", exact: true }).click();
	await p.getByText("reads up to 16 MB").waitFor();
	await context.close();
});

test("a bad address says so", async () => {
	const { p, context } = await fresh();
	await p.goto(`${srv.base}?open=github:../../etc/passwd`);
	await p.getByRole("heading", { name: "That flag didn't open" }).waitFor();
	await context.close();
});

test("each tab keeps its own draft, through a reload", async () => {
	const { p, context } = await fresh();
	await p.goto(openUrl(srv.base, "flags/country/japan.kdl"));
	await ready(p);
	await p.locator('.row[data-path="proportion"]').click();
	await p.getByRole("radio", { name: "Change the shape" }).click();
	await p.getByLabel("Fly").fill("31");
	await p.locator(".dirty").waitFor();
	await p.waitForTimeout(600);
	const one = await savedText(p);
	assert.ok(one.includes("fly=31"), one);
	await p.getByLabel("Fly").fill("32");
	await p.waitForTimeout(600);
	p.on("dialog", (d) => d.accept());
	await p.reload();
	await ready(p);
	const kept = await savedText(p);
	assert.ok(kept.includes("fly=32"), "the draft came back");
	await context.close();
});

test("two tabs on one flag keep separate drafts, and each is told", async () => {
	const { p, context } = await fresh();
	const url = openUrl(srv.base, "flags/country/japan.kdl");
	await p.goto(url);
	await ready(p);
	const other = await context.newPage();
	await other.goto(url);
	await ready(other);
	await p.getByText("also open in another tab").waitFor();
	await other.getByText("also open in another tab").waitFor();
	await p.locator('.row[data-path="proportion"]').click();
	await p.getByRole("radio", { name: "Change the shape" }).click();
	await p.getByLabel("Fly").fill("31");
	await other.locator('.row[data-path="proportion"]').click();
	await other.getByRole("radio", { name: "Change the shape" }).click();
	await other.getByLabel("Fly").fill("44");
	await p.waitForTimeout(700);
	p.on("dialog", (d) => d.accept());
	other.on("dialog", (d) => d.accept());
	await p.reload();
	await ready(p);
	await other.reload();
	await ready(other);
	assert.ok((await savedText(p)).includes("fly=31"), "the first kept its own");
	assert.ok((await savedText(other)).includes("fly=44"), "and so did the second");
	await context.close();
});

test("closing with unsaved work warns, and after saving it doesn't", async () => {
	const { p, context } = await fresh();
	await p.goto(openUrl(srv.base, "flags/country/japan.kdl"));
	await ready(p);
	await p.locator('.row[data-path="proportion"]').click();
	await p.getByRole("radio", { name: "Change the shape" }).click();
	await p.getByLabel("Fly").fill("31");
	await p.locator(".dirty").waitFor();
	// Only a page a person has used is allowed to ask.
	const dialog = new Promise((resolve) => { p.once("dialog", async (d) => { resolve(d.type()); await d.dismiss(); }); });
	const stay = p.close({ runBeforeUnload: true });
	assert.equal(await dialog, "beforeunload");
	await stay;
	assert.equal(p.isClosed(), false);
	await savedText(p);
	let asked = false;
	p.on("dialog", (d) => { asked = true; void d.accept(); });
	await p.close({ runBeforeUnload: true });
	await new Promise((r) => { setTimeout(r, 300); });
	assert.equal(asked, false);
	await context.close();
});

test("a draft from a closed tab is offered back", async () => {
	const { p, context } = await fresh();
	const keeper = await context.newPage();
	await keeper.goto(srv.base + "favicon.svg");
	await p.goto(openUrl(srv.base, "flags/country/japan.kdl"));
	await ready(p);
	await p.locator('.row[data-path="proportion"]').click();
	await p.getByRole("radio", { name: "Change the shape" }).click();
	await p.getByLabel("Fly").fill("31");
	await p.waitForTimeout(700);
	await p.close();
	const next = await context.newPage();
	await next.goto(openUrl(srv.base, "flags/country/japan.kdl"));
	await ready(next);
	await next.getByText("There's an unsaved draft of this flag").waitFor();
	await next.getByRole("button", { name: "Restore it" }).click();
	await next.waitForFunction(() => document.querySelector(".dirty") !== null);
	assert.ok((await savedText(next)).includes("fly=31"));
	await context.close();
});
