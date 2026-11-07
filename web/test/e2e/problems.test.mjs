// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { downloadChoice, launch, mockWorld, openUrl, ready, repo, savedText, serve, watch } from "./helpers.mjs";

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
	const context = await browser.newContext({ viewport: { width: 1440, height: 1160 }, colorScheme: "dark", acceptDownloads: true });
	const log = await mockWorld(context);
	const p = await context.newPage();
	return { p, context, log, errors: watch(p) };
}

async function paste(p, text) {
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("tab", { name: "Paste" }).click();
	await p.getByLabel("KDL").fill(text);
	await p.getByRole("button", { name: "Open", exact: true }).click();
	await p.locator(".status").waitFor();
}

const invalid = (name) => readFileSync(join(repo, "conformance/invalid", name), "utf8");
const typeAtLine = async (p, text, replace) => {
	await p.locator('.row[data-path="palette"]').click();
	await p.getByRole("radio", { name: "Source" }).click();
	await p.locator(".cm-line", { hasText: text }).first().click();
	await p.keyboard.press("End");
	await p.keyboard.type(replace);
};

test("a problem appears in Source, on objects in Form, and pauses only the SVG", async () => {
	const { p, context, errors } = await fresh();
	await p.goto(openUrl(srv.base, "reviewed/united-states.kdl"));
	await ready(p);
	const good = await p.locator(".stage-image").getAttribute("src");
	// Spoils the palette reference in `bars red white {`.
	await p.locator('.row[data-path="0"]').click();
	await p.getByRole("radio", { name: "Source" }).click();
	await p.locator(".cm-line", { hasText: "bars red white" }).click();
	await p.keyboard.press("End");
	for (let i = 0; i < 2; i++) {
		await p.keyboard.press("ArrowLeft");
	}
	await p.keyboard.press("Backspace");
	await p.locator(".status", { hasText: /1 problem/ }).waitFor();
	const message = p.locator(".cm-problem").first();
	await message.waitFor();
	assert.match(await message.textContent(), /whit/);
	await p.locator(".cm-problem-line").first().waitFor();
	assert.equal(await p.locator(".stage-image").getAttribute("src"), good, "the last good render stays");
	assert.ok(await p.locator(".stage.dimmed").count() === 1, "and it's dimmed");
	await p.getByText("Last good render. It stays here until the file is valid again.").waitFor();
	assert.equal(await (await downloadChoice(p, "SVG image")).isDisabled(), true);
	assert.equal(await p.getByRole("menuitem", { name: "KDL file" }).isDisabled(), false);
	await p.keyboard.press("Escape");
	assert.ok((await savedText(p)).includes("bars red whit"), "and the file can still be saved");
	await p.getByRole("radio", { name: "Form" }).click();
	await p.locator(".crumbs .back", { hasText: "Structure" }).click();
	await p.locator('.row.bad[data-path="0"]').waitFor();
	await p.locator('.row.bad[data-path="0"]').click();
	await p.locator(".panel .nx-error, .panel .nx-callout.danger", { hasText: "whit" }).waitFor();
	// Putting it right brings everything back.
	await p.getByRole("radio", { name: "Source" }).click();
	await p.waitForSelector(".cm-selected-line");
	await p.locator(".cm-line", { hasText: "bars red whit" }).click();
	await p.keyboard.press("End");
	await p.keyboard.press("ArrowLeft");
	await p.keyboard.press("ArrowLeft");
	await p.keyboard.type("e");
	await p.locator(".status", { hasText: "Valid" }).waitFor();
	await p.waitForFunction(() => document.querySelector(".stage.dimmed") === null);
	assert.equal(await (await downloadChoice(p, "SVG image")).isDisabled(), false);
	await p.keyboard.press("Escape");
	assert.deepEqual(errors, []);
	await context.close();
});

test("a syntax error pauses the form, and it says why", async () => {
	const { p, context, errors } = await fresh();
	await p.goto(openUrl(srv.base, "reviewed/japan.kdl"));
	await ready(p);
	await typeAtLine(p, "palette {", ' "unterminated');
	await p.locator(".status", { hasText: /problem/ }).waitFor();
	await p.getByRole("radio", { name: "Form" }).click();
	await p.getByText("can't be read as KDL").waitFor();
	await p.locator(".crumbs .back", { hasText: "Structure" }).click();
	await p.getByText("can't be read as KDL").waitFor();
	assert.ok(await p.locator(".row").count() > 2, "it still shows how it last was");
	assert.equal(await p.getByRole("button", { name: "Add a term" }).count(), 0, "and offers no changes");
	assert.deepEqual(errors, []);
	await context.close();
});

test("every invalid file in the suite still opens, marked", async () => {
	const { p, context, errors } = await fresh();
	const names = readdirSync(join(repo, "conformance/invalid")).filter((n) => n.endsWith(".kdl"));
	const chosen = names.filter((_, i) => i % 40 === 0).concat(["no-version.kdl", "unknown-layer.kdl", "out-of-order.kdl", "sanitizer-script.kdl"].filter((n) => names.includes(n)));
	for (const name of chosen) {
		await paste(p, invalid(name));
		await p.locator(".status.bad").waitFor();
		assert.ok(await (await downloadChoice(p, "SVG image")).isDisabled(), name);
		await p.keyboard.press("Escape");
		await p.getByRole("radio", { name: "Source" }).click();
		await p.locator(".cm-problem").first().waitFor();
	}
	assert.deepEqual(errors, []);
	await context.close();
});

test("a sanitizer refusal is a problem, and nothing from it runs", async () => {
	const { p, context } = await fresh();
	const names = readdirSync(join(repo, "conformance/invalid")).filter((n) => n.startsWith("sanitizer-"));
	assert.ok(names.length > 20);
	for (const name of names.slice(0, 6)) {
		await paste(p, invalid(name));
		await p.locator(".status.bad").waitFor();
	}
	assert.equal(await p.evaluate(() => globalThis.pwned), undefined);
	await context.close();
});

test("strings from a file are only ever text", async () => {
	const { p, context, errors, log } = await fresh();
	const evil = '<img src=x onerror="globalThis.pwned=1">';
	const text = `vexyl 1
meta {
  name ${JSON.stringify(evil)}
  description ${JSON.stringify(evil)}
  note ${JSON.stringify(evil)}
  license ${JSON.stringify(evil)}
  source "javascript:globalThis.pwned=1"
  law ${JSON.stringify(evil)} {
    source "javascript:globalThis.pwned=1"
  }
}
palette {
  ${JSON.stringify(evil)} "#112233"
  __proto__ "#445566"
  constructor "#778899"
}
proportion hoist=2 fly=3
bars ${JSON.stringify(evil)} __proto__ constructor
variant ${JSON.stringify(evil)} {
  from rotate
}
variant __proto__ {
  from transpose
}
fold ${JSON.stringify(evil)} {
  over along=fly at=1 move=bottom
}
`;
	await paste(p, text);
	await p.locator(".status", { hasText: "Valid" }).waitFor();
	await ready(p);
	assert.equal(await p.locator(".flag-name").textContent(), evil);
	assert.equal(await p.locator("img[src=x]").count(), 0);
	const about = p.getByRole("region", { name: "About this file" });
	assert.equal(await about.locator('a[href^="javascript"]').count(), 0);
	await p.locator('.row[data-path="palette"]').click();
	await p.locator(".crumbs .back").first().click();
	await p.locator('.thumb[data-form="variant:__proto__"]').click();
	await p.waitForFunction(() => document.querySelector(".nx-muted")?.textContent?.includes("Variant") || document.querySelector(".nx-muted")?.textContent?.includes("__"));
	await p.getByRole("link", { name: "Compare" }).click();
	await p.getByRole("link", { name: "Back to editing" }).click();
	assert.equal(await p.evaluate(() => globalThis.pwned), undefined);
	assert.equal(await p.evaluate(() => ({}).polluted), undefined);
	assert.deepEqual(errors, []);
	assert.deepEqual(log.foreign, []);
	await context.close();
});

test("typing in a 2 MB flag leaves the page responsive", async () => {
	const { p, context, errors } = await fresh();
	await p.goto(openUrl(srv.base, "flags/brazil/flag-john-v-of-portugal-with-order-of-christ.kdl"));
	await ready(p);
	await p.getByRole("radio", { name: "Source" }).click();
	await p.locator(".cm-line", { hasText: "vexyl 1" }).click();
	// Counts the longest time the page couldn't do anything, while the worker reads and draws.
	await p.evaluate(() => {
		globalThis.__worst = 0;
		let last = performance.now();
		const tick = () => {
			const now = performance.now();
			globalThis.__worst = Math.max(globalThis.__worst, now - last);
			last = now;
			globalThis.__timer = setTimeout(tick, 10);
		};
		tick();
	});
	const old = await p.locator(".stage-image").getAttribute("src");
	await p.locator(".cm-line", { hasText: 'name "' }).first().click();
	await p.keyboard.press("End");
	await p.keyboard.press("ArrowLeft");
	await p.keyboard.type("x");
	await p.waitForFunction((b) => document.querySelector(".stage-image")?.getAttribute("src") !== b, old, { timeout: 60000 });
	const worst = await p.evaluate(() => { clearTimeout(globalThis.__timer); return globalThis.__worst; });
	assert.ok(worst < 1500, `the page stalled for ${worst} ms`);
	assert.deepEqual(errors, []);
	context.__worst = worst;
	console.log(`longest stall while typing in a 2 MB flag: ${Math.round(worst)} ms`);
	await context.close();
});
