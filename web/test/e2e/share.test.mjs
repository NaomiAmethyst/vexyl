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

async function fresh() {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
	const log = await mockWorld(context);
	const p = await context.newPage();
	return { p, context, log, errors: watch(p) };
}

const linkBox = (p) => p.getByLabel("Link to share");

test("a flag from GitHub shares as a link to the file, or a copy of what's on screen", async () => {
	const { p, context, errors } = await fresh();
	await p.goto(openUrl(srv.base, "reviewed/japan.kdl"));
	await ready(p);
	await p.getByRole("link", { name: "Share" }).click();
	await p.getByRole("heading", { name: "Share Japan" }).waitFor();
	assert.equal(await linkBox(p).inputValue(), `${srv.base}?open=github:NaomiAmethyst/vexyl-flags/reviewed/japan.kdl`);
	await p.getByText("it follows any changes made there").waitFor();
	await p.getByRole("radio", { name: "A copy of what's on screen" }).click();
	await p.waitForFunction(() => document.querySelector('[aria-label="Link to share"]')?.value.includes("#v1."));
	const link = await linkBox(p).inputValue();
	const next = await context.newPage();
	await next.goto(link);
	await ready(next);
	assert.equal(await savedText(next), readFlag("reviewed/japan.kdl"));
	assert.deepEqual(errors, []);
	await context.close();
});

test("an edited flag shares by holding it, and a link gives exactly that", async () => {
	const { p, context, log } = await fresh();
	await p.goto(openUrl(srv.base, "reviewed/japan.kdl"));
	await ready(p);
	await p.locator('.row[data-path="proportion"]').click();
	await p.getByRole("radio", { name: "Change the shape" }).click();
	await p.getByLabel("Fly").fill("31");
	await p.locator(".dirty").waitFor();
	await p.getByRole("link", { name: "Share" }).click();
	await p.waitForFunction(() => document.querySelector('[aria-label="Link to share"]')?.value.includes("#v1."));
	const link = await linkBox(p).inputValue();
	assert.ok(link.startsWith(srv.base + "#v1."), link.slice(0, 80));
	await p.getByText("The flag travels inside this link").waitFor();
	const count = log.requests.length;
	const next = await context.newPage();
	await next.goto(link);
	await ready(next);
	assert.equal(log.requests.length, count, "opening a link with the flag in it asks nothing of anyone");
	assert.ok((await savedText(next)).includes("fly=31"));
	await context.close();
});

test("a pasted flag can only share by holding it", async () => {
	const { p, context } = await fresh();
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "Paste" }).click();
	await p.getByLabel("KDL").fill(readFlag("reviewed/sweden.kdl"));
	await p.getByRole("button", { name: "Open", exact: true }).click();
	await ready(p);
	await p.getByRole("link", { name: "Share" }).click();
	await p.waitForFunction(() => document.querySelector('[aria-label="Link to share"]')?.value.includes("#v1."));
	assert.equal(await p.getByRole("radiogroup", { name: "What the link gives" }).count(), 0);
	await context.close();
});

test("a flag too large for a link says what to do instead", async () => {
	const { p, context } = await fresh();
	await p.goto(openUrl(srv.base, "flags/brazil/flag-john-v-of-portugal-with-order-of-christ.kdl"));
	await ready(p);
	await p.locator('.row[data-path="proportion"]').click();
	await p.getByRole("radio", { name: "Change the shape" }).click();
	await p.getByLabel("Fly").fill("31");
	await p.locator(".dirty").waitFor({ timeout: 30000 });
	await p.getByRole("link", { name: "Share" }).click();
	await p.getByText("This file is too large to fit in a link").waitFor({ timeout: 60000 });
	await p.getByText("Put it in a gist or a repository").waitFor();
	assert.equal(await linkBox(p).count(), 0);
	await context.close();
});

test("KDL and SVG can be downloaded or copied, and a bad link is explained", async () => {
	const { p, context } = await fresh();
	await p.goto(openUrl(srv.base, "reviewed/japan.kdl"));
	await ready(p);
	await p.getByRole("link", { name: "Share" }).click();
	const [svg] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Download SVG" }).click()]);
	assert.equal(svg.suggestedFilename(), "japan.svg");
	const [kdl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Download KDL" }).click()]);
	assert.equal(kdl.suggestedFilename(), "japan.kdl");
	await p.getByRole("button", { name: "Copy KDL" }).click();
	await p.getByText("Copied the KDL.").waitFor();
	assert.equal(await p.evaluate(() => navigator.clipboard.readText()), readFlag("reviewed/japan.kdl"));
	await p.getByRole("button", { name: "Copy SVG" }).click();
	await p.getByText("Copied the SVG.").waitFor();
	assert.ok((await p.evaluate(() => navigator.clipboard.readText())).startsWith("<svg"));
	const bad = await context.newPage();
	await bad.goto(`${srv.base}#v1.AAAA`);
	await bad.getByRole("heading", { name: "That flag didn't open" }).waitFor();
	await bad.getByText("share link can't be read").waitFor();
	await context.close();
});
