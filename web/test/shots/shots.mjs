// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Takes a picture of each screen, in dark and light, at desktop and phone widths. It isn't a test:
// these are for a person to look at against the design.
//
//   node test/shots/shots.mjs OUTPUT-DIRECTORY

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, mockWorld, openUrl, ready, serve } from "../e2e/helpers.mjs";

const out = process.argv[2];
mkdirSync(out, { recursive: true });
const srv = await serve();

const screens = {
	"workspace": async (p) => { await p.goto(openUrl(srv.base, "reviewed/united-states.kdl")); await ready(p); await p.waitForSelector('.thumb[data-form="fold:triangle"] img'); },
	"panel-selected": async (p) => { await screens.workspace(p); await p.locator('.row[data-path="1.1"]').click(); await p.locator(".panel-head h2").waitFor(); await p.waitForTimeout(300); },
	"panel-details": async (p) => { await screens.workspace(p); await p.locator('.row[data-path="meta"]').click(); await p.locator(".panel-head h2").waitFor(); await p.waitForTimeout(300); },
	"panel-color": async (p) => { await screens.workspace(p); await p.locator('.row[data-path="palette"]').click(); await p.locator('.color-chip[data-path="palette/red"]').click(); await p.waitForTimeout(300); },
	"add-term": async (p) => { await screens.workspace(p); await p.getByRole("button", { name: "Add a term" }).click(); await p.locator(".add-menu").waitFor(); },
	"source": async (p) => { await screens.workspace(p); await p.locator('.row[data-path="1.1"]').click(); await p.getByRole("radio", { name: "Source" }).click(); await p.waitForSelector(".cm-selected-line"); await p.waitForTimeout(200); },
	"refused": async (p) => { await screens.workspace(p); await p.locator('.thumb[data-form="ratio:1:1"]').click(); await p.locator(".refusal").waitFor(); },
	"folded": async (p) => { await screens.workspace(p); await p.locator('.thumb[data-form="fold:triangle"]').click(); await p.locator(".fold-step").waitFor(); await p.waitForTimeout(400); },
	"problems-source": async (p) => {
		await screens.workspace(p);
		await p.locator('.row[data-path="0"]').click();
		await p.getByRole("radio", { name: "Source" }).click();
		await p.waitForSelector(".cm-selected-line");
		await p.locator(".cm-line", { hasText: "bars red white" }).click();
		await p.keyboard.press("End");
		await p.keyboard.press("ArrowLeft");
		await p.keyboard.press("ArrowLeft");
		await p.keyboard.press("Backspace");
		await p.locator(".cm-problem").first().waitFor();
		await p.waitForTimeout(200);
	},
	"problems-form": async (p) => { await screens["problems-source"](p); await p.getByRole("radio", { name: "Form" }).click(); await p.locator(".crumbs .back", { hasText: "Structure" }).click(); await p.locator(".row.bad").first().waitFor(); await p.waitForTimeout(300); },
	"artwork": async (p) => { await p.goto(openUrl(srv.base, "flags/brazil/flag-john-v-of-portugal-with-order-of-christ.kdl")); await ready(p); await p.waitForTimeout(1500); },
	"bolivia": async (p) => { await p.goto(openUrl(srv.base, "reviewed/bolivia.kdl")); await ready(p); await p.waitForTimeout(700); },
	"open-github": async (p) => { await p.goto(`${srv.base}?view=open`); await p.getByRole("button", { name: "reviewed" }).click(); await p.locator('a.file-row[data-file="reviewed/japan.kdl"]').click(); await p.locator(".preview img").waitFor(); await p.waitForTimeout(900); },
	"open-gist": async (p) => { await p.goto(`${srv.base}?view=open`); await p.getByRole("tab", { name: "Gist" }).click(); await p.getByLabel("Gist link or ID").waitFor(); },
	"open-computer": async (p) => { await p.goto(`${srv.base}?view=open`); await p.getByRole("tab", { name: "This computer" }).click(); await p.getByText("Drop a .kdl file here").waitFor(); },
	"open-paste": async (p) => { await p.goto(`${srv.base}?view=open`); await p.getByRole("tab", { name: "Paste" }).click(); await p.getByLabel("KDL").waitFor(); },
	"open-link": async (p) => { await p.goto(`${srv.base}?view=open`); await p.getByRole("tab", { name: "Link" }).click(); await p.getByLabel("Link to a KDL file").waitFor(); },
	"share-github": async (p) => { await p.goto(openUrl(srv.base, "reviewed/united-states.kdl")); await ready(p); await p.getByRole("link", { name: "Share" }).click(); await p.getByLabel("Link to share").waitFor(); },
	"share-edited": async (p) => {
		await p.goto(openUrl(srv.base, "reviewed/united-states.kdl")); await ready(p);
		await p.locator('.row[data-path="proportion"]').click(); await p.getByLabel("Fly").fill("25");
		await p.getByRole("link", { name: "Share" }).click();
		await p.waitForFunction(() => document.querySelector('[aria-label="Link to share"]')?.value.includes("#v1."));
	},
	"share-large": async (p) => {
		await p.goto(openUrl(srv.base, "flags/brazil/flag-john-v-of-portugal-with-order-of-christ.kdl")); await ready(p);
		await p.locator('.row[data-path="proportion"]').click(); await p.getByLabel("Fly").fill("31"); await p.locator(".dirty").waitFor({ timeout: 30000 });
		await p.getByRole("link", { name: "Share" }).click();
		await p.getByText("This file is too large").waitFor({ timeout: 60000 });
	},
	"compare-side": async (p) => { await p.goto(openUrl(srv.base, "reviewed/azerbaijan-1991.kdl")); await ready(p); await p.getByRole("link", { name: "Compare" }).click(); await p.locator(".pick-box", { hasText: "Azerbaijan 2018" }).waitFor(); await p.locator("table.changes").waitFor(); await p.waitForTimeout(300); },
	"compare-slider": async (p) => { await screens["compare-side"](p); await p.getByRole("radio", { name: "Slider" }).click(); await p.waitForTimeout(300); },
	"compare-differences": async (p) => { await screens["compare-side"](p); await p.getByRole("radio", { name: "Differences" }).click(); await p.waitForFunction(() => document.querySelector("[data-percent]")?.getAttribute("data-percent") !== ""); },
	"compare-source": async (p) => { await screens["compare-side"](p); await p.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name: "Source" }).click(); await p.locator(".side-diff-row.changed").first().waitFor(); },
	"not-found": async (p, world) => { world.repoMissing = true; await p.goto(`${srv.base}?view=open`); await p.getByText("doesn't have").waitFor(); world.repoMissing = false; },
	"no-file": async (p) => { await p.goto(openUrl(srv.base, "reviewed/no-such-flag.kdl")); await p.getByRole("heading", { name: "That flag didn't open" }).waitFor(); },
};

const only = process.argv[3]?.split(",");
for (const scheme of ["dark", "light"]) {
	for (const [width, height, label] of [[1440, 1160, "desktop"], [390, 844, "phone"]]) {
		const world = {};
		const browser = await launch();
		const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 1, ...(label === "phone" ? { hasTouch: true, isMobile: true } : {}) });
		await mockWorld(context, new Proxy(world, {}));
		for (const [name, go] of Object.entries(screens)) {
			if (only !== undefined && !only.includes(name)) {
				continue;
			}
			const p = await context.newPage();
			try {
				await go(p, world);
				await p.screenshot({ path: join(out, `${name}-${scheme}-${label}.png`), fullPage: label === "phone" || name.startsWith("compare") });
			} catch (e) {
				console.log(`${name} ${scheme} ${label}: ${e.message.split("\n")[0]}`);
			}
			await p.close();
		}
		await context.close();
		await browser.close();
	}
}
await srv.close();
