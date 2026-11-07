// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { axe, launch, mockWorld, openUrl, readFlag, ready, serve, subpath, watch } from "./helpers.mjs";

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

const screens = {
	workspace: async (p) => { await p.goto(openUrl(srv.base, "reviewed/united-states.kdl")); await ready(p); await p.waitForSelector('.thumb[data-form="fold:triangle"] img'); },
	panel: async (p) => { await p.goto(openUrl(srv.base, "reviewed/united-states.kdl")); await ready(p); await p.locator('.row[data-path="1.1"]').click(); await p.locator(".panel-head h2").waitFor(); },
	source: async (p) => { await p.goto(openUrl(srv.base, "reviewed/united-states.kdl")); await ready(p); await p.getByRole("radio", { name: "Source" }).click(); await p.locator(".cm-line").first().waitFor(); },
	problems: async (p) => {
		await p.goto(`${srv.base}?view=open`);
		await p.getByRole("tab", { name: "Paste" }).click();
		await p.getByLabel("KDL").fill(readFlag("reviewed/united-states.kdl").replace("bars red white", "bars red whit"));
		await p.getByRole("button", { name: "Open", exact: true }).click();
		await p.locator(".status.bad").waitFor();
		await p.getByRole("radio", { name: "Source" }).click();
		await p.locator(".cm-problem").first().waitFor();
	},
	open: async (p) => { await p.goto(`${srv.base}?view=open`); await p.getByRole("button", { name: "reviewed" }).click(); await p.locator('a.file-row[data-file="reviewed/japan.kdl"]').click(); await p.locator(".preview img").waitFor(); },
	"open-paste": async (p) => { await p.goto(`${srv.base}?view=open`); await p.getByRole("tab", { name: "Paste" }).click(); await p.getByLabel("KDL").waitFor(); },
	"open-gist": async (p) => { await p.goto(`${srv.base}?view=open`); await p.getByRole("tab", { name: "Gist" }).click(); await p.getByLabel("Gist link or ID").waitFor(); },
	"open-computer": async (p) => { await p.goto(`${srv.base}?view=open`); await p.getByRole("tab", { name: "This computer" }).click(); await p.getByText("Drop a .kdl file here").waitFor(); },
	"open-link": async (p) => { await p.goto(`${srv.base}?view=open`); await p.getByRole("tab", { name: "Link" }).click(); await p.getByLabel("Link to a KDL file").waitFor(); },
	share: async (p) => { await p.goto(openUrl(srv.base, "reviewed/japan.kdl")); await ready(p); await p.getByRole("link", { name: "Share" }).click(); await p.getByLabel("Link to share").waitFor(); },
};

const themes = [
	{ name: "dark", colorScheme: "dark" },
	{ name: "light", colorScheme: "light" },
	{ name: "dark, high contrast", colorScheme: "dark", contrast: "more" },
	{ name: "light, high contrast", colorScheme: "light", contrast: "more" },
];

for (const theme of themes) {
	test(`no accessibility violations on any screen, ${theme.name}`, async () => {
		const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, colorScheme: theme.colorScheme, ...(theme.contrast ? { contrast: theme.contrast } : {}) });
		await mockWorld(context);
		const found = {};
		for (const [name, go] of Object.entries(screens)) {
			const p = await context.newPage();
			await go(p);
			await p.waitForTimeout(350);
			const violations = await axe(p);
			if (violations.length > 0) {
				found[name] = violations;
			}
			await p.close();
		}
		assert.deepEqual(found, {}, JSON.stringify(found, null, 1));
		await context.close();
	});
}

test("the page follows the device's color scheme and contrast, with the system's own values", async () => {
	for (const [scheme, contrast, bg] of [["dark", undefined, "rgb(9, 8, 12)"], ["light", undefined, "rgb(246, 244, 250)"], ["dark", "more", "rgb(0, 0, 0)"], ["light", "more", "rgb(255, 255, 255)"]]) {
		const context = await browser.newContext({ colorScheme: scheme, ...(contrast ? { contrast } : {}) });
		await mockWorld(context);
		const p = await context.newPage();
		await p.goto(`${srv.base}?view=open`);
		await p.getByRole("tab", { name: "GitHub" }).waitFor();
		assert.equal(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), bg);
		await context.close();
	}
});

test("nothing scrolls sideways at phone width, on any screen", async () => {
	const context = await browser.newContext({ viewport: { width: 360, height: 780 }, colorScheme: "dark", hasTouch: true, isMobile: true });
	await mockWorld(context);
	const found = {};
	for (const [name, go] of Object.entries(screens)) {
		const p = await context.newPage();
		await go(p);
		const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		if (over > 0) {
			found[name] = over;
		}
		await p.close();
	}
	assert.deepEqual(found, {});
	await context.close();
});

test("the Content Security Policy is enforced, and nothing breaks it", async () => {
	const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
	await mockWorld(context);
	const found = [];
	for (const go of Object.values(screens)) {
		const p = await context.newPage();
		await p.addInitScript(() => {
			globalThis.__violations = [];
			document.addEventListener("securitypolicyviolation", (e) => { globalThis.__violations.push(`${e.violatedDirective} ${e.blockedURI}`); });
		});
		await go(p);
		await p.waitForTimeout(100);
		found.push(...(await p.evaluate(() => globalThis.__violations)));
		await p.close();
	}
	assert.deepEqual(found, []);
	const p = await context.newPage();
	await p.goto(`${srv.base}?view=open`);
	// In a later task, since the browser lets evaluate itself run eval, whatever the page's policy.
	const blocked = await p.evaluate(() => new Promise((resolve) => { setTimeout(() => {
		const results = {};
		try { eval("1"); results.eval = "ran"; } catch { results.eval = "blocked"; }
		try { new Function("return 1")(); results.fn = "ran"; } catch { results.fn = "blocked"; }
		try { document.createElement("div").innerHTML = "<b>x</b>"; results.html = "ran"; } catch { results.html = "blocked"; }
		resolve(results);
	}, 0); }));
	assert.deepEqual(blocked, { eval: "blocked", fn: "blocked", html: "blocked" });
	await context.close();
});

test("a page with nothing open asks nothing of anyone until someone does", async () => {
	const context = await browser.newContext();
	const log = await mockWorld(context);
	const p = await context.newPage();
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "Paste" }).click();
	const local = await p.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => !n.includes("/some/sub/path/")));
	assert.deepEqual(local.filter((u) => !u.includes("github")), [], "fonts and scripts are all this site's own");
	assert.deepEqual(log.foreign, []);
	assert.ok(log.requests.every((u) => u.startsWith("https://api.github.com/") || u.startsWith("https://raw.githubusercontent.com/")), log.requests.join(" "));
	await context.close();
});

test("everything works under a subpath, with relative references", async () => {
	assert.ok(srv.base.endsWith(subpath));
	const context = await browser.newContext();
	await mockWorld(context);
	const p = await context.newPage();
	const missing = [];
	p.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(srv.base.split("/some")[0])) { missing.push(r.url()); } });
	await p.goto(openUrl(srv.base, "reviewed/japan.kdl"));
	await ready(p);
	assert.deepEqual(missing, []);
	assert.equal(await p.evaluate(() => document.fonts.check('13px "Geist"')), true);
	await context.close();
});

/** Presses Tab until something matching has the focus. */
async function tabTo(p, test_, limit = 80) {
	for (let i = 0; i < limit; i++) {
		await p.keyboard.press("Tab");
		if (await p.evaluate(test_)) {
			return true;
		}
	}
	return false;
}

test("a whole edit can be done from the keyboard alone", async () => {
	const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
	await mockWorld(context);
	const p = await context.newPage();
	const errors = watch(p);
	await p.goto(openUrl(srv.base, "reviewed/united-states.kdl"));
	await ready(p);
	// Rows are reachable, and Enter opens one.
	assert.ok(await tabTo(p, () => document.activeElement?.getAttribute("data-path") === "0"));
	await p.keyboard.press("Enter");
	await p.locator(".panel-head h2", { hasText: "Bars" }).waitFor();
	// A radio group moves by arrow keys, and focus can be seen.
	assert.ok(await tabTo(p, () => document.activeElement?.closest('[aria-label="Runs along"]') !== null));
	const outline = await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
	assert.equal(outline, "solid", "focus shows");
	await p.keyboard.press("ArrowRight");
	await p.locator('[aria-label="Runs along"] [aria-checked="true"]', { hasText: "Hoist" }).waitFor();
	// Back to the list, into Source, and out of it with Escape then Tab.
	await p.keyboard.press("ArrowLeft");
	await p.locator('[aria-label="Edit as"] button').first().focus();
	await p.keyboard.press("ArrowRight");
	await p.locator(".cm-line").first().waitFor();
	await p.keyboard.press("Tab");
	await p.waitForFunction(() => document.activeElement?.classList.contains("source-host"));
	await p.keyboard.press("Escape");
	await p.keyboard.press("Tab");
	assert.ok(await p.evaluate(() => !document.activeElement?.classList.contains("source-host")), "the editor isn't a trap");
	// The gallery, with Space.
	assert.ok(await tabTo(p, () => document.activeElement?.getAttribute("data-form") === "reverse"));
	await p.keyboard.press("Space");
	await p.locator('.thumb[data-form="reverse"][aria-pressed="true"]').waitFor();
	assert.deepEqual(errors, []);
	await context.close();
});

test("Open and Share work from the keyboard", async () => {
	const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
	await mockWorld(context);
	const p = await context.newPage();
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("button", { name: "reviewed" }).waitFor();
	await p.getByRole("tab", { name: "GitHub" }).focus();
	await p.keyboard.press("ArrowRight");
	await p.getByRole("tab", { name: "Gist", selected: true }).waitFor();
	await p.keyboard.press("End");
	await p.getByRole("tab", { name: "Link", selected: true }).waitFor();
	await p.keyboard.press("Home");
	await p.getByRole("button", { name: "reviewed" }).focus();
	await p.keyboard.press("Enter");
	const row = p.locator('a.file-row[data-file="reviewed/japan.kdl"]');
	await row.focus();
	await p.keyboard.press("Enter");
	await p.locator(".preview-name", { hasText: "Japan" }).waitFor();
	await p.locator(".preview").getByRole("link", { name: "Open this flag" }).focus();
	await p.keyboard.press("Enter");
	await ready(p);
	await p.getByRole("link", { name: "Share" }).focus();
	await p.keyboard.press("Enter");
	await p.getByRole("radio", { name: "The file, where it is" }).focus();
	await p.keyboard.press("ArrowRight");
	await p.getByRole("radio", { name: "A copy of what's on screen", checked: true }).waitFor();
	await context.close();
});

test("with reduced motion, nothing animates", async () => {
	const context = await browser.newContext({ reducedMotion: "reduce" });
	await mockWorld(context);
	const p = await context.newPage();
	await p.goto(openUrl(srv.base, "reviewed/japan.kdl"));
	await ready(p);
	await p.locator('.row[data-path="0"]').click();
	assert.equal(await p.locator(".form-page.panel").evaluate((e) => getComputedStyle(e).animationName), "none");
	await context.close();
});
