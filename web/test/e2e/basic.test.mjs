// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launch, mockWorld, ready, savedText, serve, startFlag, watch } from "./helpers.mjs";

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

async function page(opts = {}, mock = {}) {
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark", acceptDownloads: true, deviceScaleFactor: 1, ...opts });
	const log = await mockWorld(context, { basic: true, ...mock });
	const p = await context.newPage();
	const errors = watch(p);
	return { p, context, log, errors };
}

/** A new flag from a layout, in Basic. */
async function started(layout, opts, shape) {
	const made = await page(opts);
	await made.p.goto(`${srv.base}?view=new`);
	await startFlag(made.p, layout, shape);
	return made;
}

const head = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n  b "#ddeeff"\n}\nproportion hoist=60 fly=90\n\n';

/** Opens a file of its own, in Basic. */
async function opened(text, opts, valid = true) {
	const made = await page(opts);
	await made.p.goto(`${srv.base}?view=open`);
	await made.p.getByRole("tab", { name: "Paste" }).click();
	await made.p.getByLabel("KDL").fill(text);
	await made.p.getByRole("button", { name: "Open", exact: true }).click();
	if (valid) {
		await ready(made.p);
	}
	return made;
}

/** The file as it would be saved in Basic, once it's what's wanted. */
async function basicText(p, wanted = () => true) {
	const until = Date.now() + 15000;
	for (;;) {
		await p.getByRole("button", { name: "Download", exact: true }).click();
		const [file] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "The flag's file, to keep working on" }).click()]);
		const text = readFileSync(await file.path(), "utf8");
		if (wanted(text) || Date.now() > until) {
			return text;
		}
		await p.waitForTimeout(100);
	}
}

const stageBox = (p) => p.locator(".stage").boundingBox();
const at = (box, x, y) => [box.x + box.width * x, box.y + box.height * y];

/** A real drag on the flag, by shares of it, in several moves. */
async function dragFlag(p, from, to, { alt = false, release = true } = {}) {
	const box = await stageBox(p);
	await p.mouse.move(...at(box, ...from));
	await p.mouse.down();
	if (alt) {
		await p.keyboard.down("Alt");
	}
	for (let i = 1; i <= 6; i++) {
		await p.mouse.move(...at(box, from[0] + ((to[0] - from[0]) * i) / 6, from[1] + ((to[1] - from[1]) * i) / 6));
		await p.waitForTimeout(16);
	}
	if (release) {
		await p.mouse.up();
	}
	if (alt) {
		await p.keyboard.up("Alt");
	}
}

/** The same thing, starting on a handle. */
async function dragHandle(p, handle, to, opts) {
	const box = await stageBox(p);
	const h = await handle.boundingBox();
	const from = [(h.x + h.width / 2 - box.x) / box.width, (h.y + h.height / 2 - box.y) / box.height];
	await dragFlag(p, from, to, opts);
}

const row = (p, label) => p.locator(".layer-row", { has: p.locator(".row-label", { hasText: new RegExp(`^${label}$`) }) });
const settled = (p) => p.waitForFunction(() => !document.querySelector(".spinner"));

test("someone new gets Basic, and a switch back and forth is remembered, not per flag", async () => {
	const { p, context, errors } = await started("symbol");
	await p.getByRole("radio", { name: "Basic", checked: true }).waitFor();
	await p.getByRole("radio", { name: "Design", checked: true }).waitFor();
	await p.getByRole("radio", { name: "Advanced" }).click();
	await p.getByRole("button", { name: "Add a term" }).waitFor();
	assert.equal(await p.evaluate(() => localStorage.getItem("vexyl.editor")), "advanced");
	await p.goto(`${srv.base}?view=new`);
	await p.getByText("Rather drag things around").waitFor();
	await startFlag(p, "blank");
	await p.getByRole("button", { name: "Add a term" }).waitFor();
	await p.getByRole("radio", { name: "Basic" }).click();
	await p.getByRole("button", { name: "Add to the flag" }).waitFor();
	assert.equal(await p.evaluate(() => localStorage.getItem("vexyl.editor")), "basic");
	assert.deepEqual(errors, []);
	await context.close();
});

test("a browser that won't keep anything still works, in Basic", async () => {
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	await mockWorld(context, { basic: true });
	await context.addInitScript(() => {
		Object.defineProperty(globalThis, "localStorage", { get() { throw new Error("no storage here"); } });
	});
	const p = await context.newPage();
	const errors = watch(p);
	await p.goto(`${srv.base}?view=new`);
	await startFlag(p, "blank");
	await p.getByRole("radio", { name: "Advanced" }).click();
	await p.getByRole("button", { name: "Add a term" }).waitFor();
	assert.deepEqual(errors, []);
	await context.close();
});

test("the start screen makes a real flag of each layout and shape, from either editor", async () => {
	const { p, context, errors } = await page();
	await p.goto(`${srv.base}?view=open`);
	await p.getByRole("button", { name: "Start a new flag" }).click();
	await p.getByRole("heading", { name: "Start a flag" }).waitFor();
	assert.equal(await p.locator(".start-tile").count(), 9);
	await startFlag(p, "off-cross", "3:5");
	const text = await basicText(p);
	assert.ok(text.includes("proportion hoist=60 fly=100") && text.includes("fly 30 12 58"), text);
	await p.getByRole("button", { name: "New flag", exact: true }).click();
	await p.getByRole("button", { name: "Back to your flag" }).click();
	await p.locator(".stage-image").waitFor();
	await p.getByRole("radio", { name: "Advanced" }).click();
	await p.getByRole("button", { name: "New flag", exact: true }).click();
	await startFlag(p, "swallowtail", "1:1");
	await p.locator(".row", { hasText: "Outline" }).waitFor();
	assert.ok((await savedText(p)).includes("proportion hoist=60 fly=60"));
	assert.deepEqual(errors, []);
	await context.close();
});

test("the panel has its tabs, in plain names, and the real source", async () => {
	const { p, context } = await started("stripes-block");
	assert.deepEqual(await p.locator(".layer-row .row-label").allTextContents(), ["Stripes", "Corner block"]);
	await p.getByRole("button", { name: "Add to the flag" }).click();
	const menu = await p.locator(".pic-menu").textContent();
	for (const word of ["Stripes", "Single stripe", "Diagonal cross", "Checkerboard", "Edge triangle", "Y shape", "Corner block", "Edge block", "Circle", "Diamond"]) {
		assert.ok(menu.includes(word), word);
	}
	const words = await p.locator("main").textContent();
	for (const word of ["Bars", "Canton", "Saltire", "Pile", "Pall", "Disc", "Lozenge", "Fimbriation", "Hoist", "Fly", "grid", "KDL"]) {
		assert.ok(!words.includes(word), word);
	}
	assert.ok(!(await p.locator("header").textContent()).includes("KDL"));
	await p.getByRole("radio", { name: "Details" }).click();
	await p.getByLabel("Name").fill("Mine");
	await p.getByText("Credit and license").click();
	await p.getByLabel("License for this file").fill("CC0-1.0");
	const text = await basicText(p, (t) => t.includes("name Mine") && t.includes("license CC0-1.0"));
	assert.ok(text.includes("name Mine") && text.includes("license CC0-1.0"), text);
	await p.getByRole("radio", { name: "Source" }).click();
	await p.locator(".cm-line", { hasText: "canton" }).waitFor();
	await context.close();
});

test("moving a symbol snaps to a fraction, writes a whole number, and says so as it goes", async () => {
	const { p, context, errors } = await started("symbol");
	await dragFlag(p, [0.5, 0.5], [0.34, 0.5], { release: false });
	await p.locator(".readout", { hasText: "1/3 across, 1/2 down" }).waitFor();
	assert.equal(await p.locator(".guide-down").count(), 1, "a guide shows while a snap is active");
	assert.equal(await p.locator(".guide-across").count(), 1);
	await p.mouse.up();
	const text = await basicText(p, (t) => t.includes("at fly=30 hoist=30"));
	assert.ok(text.includes("at fly=30 hoist=30"), text);
	assert.equal(await p.locator(".guide-down").count(), 0);
	assert.equal(await p.locator(".layer-row.on .row-label").textContent(), "Circle", "what was dragged is selected");
	assert.deepEqual(errors, []);
	await context.close();
});

test("holding Alt places it freely, with no guide", async () => {
	const { p, context } = await started("symbol");
	await dragFlag(p, [0.5, 0.5], [0.337, 0.43], { alt: true, release: false });
	assert.equal(await p.locator(".guide-down").count(), 0);
	await p.mouse.up();
	const text = await basicText(p, (t) => /at fly=/.test(t));
	const [, fly, hoist] = /at fly=(\S+) hoist=(\S+)/.exec(text).map(Number);
	assert.ok(Math.abs(fly - 30.33) < 1.2 && Math.abs(hoist - 25.8) < 1.2, text);
	assert.ok(!Number.isInteger(fly) || !Number.isInteger(hoist), text);
	await context.close();
});

test("the handles move at once, before the file has caught up", async () => {
	const { p, context } = await started("symbol");
	await dragFlag(p, [0.5, 0.5], [0.25, 0.25], { release: false });
	const box = await stageBox(p);
	const moved = await p.locator(".handle-box").boundingBox();
	assert.ok(Math.abs(moved.x + moved.width / 2 - (box.x + box.width * 0.25)) < 2);
	await p.mouse.up();
	await context.close();
});

test("clicking still selects, and a click doesn't move anything", async () => {
	const { p, context } = await started("stripes-block");
	const before = await basicText(p);
	const box = await stageBox(p);
	await p.mouse.click(...at(box, 0.1, 0.1));
	await row(p, "Corner block").and(p.locator(".on")).waitFor();
	await p.mouse.click(...at(box, 0.8, 0.9));
	await row(p, "Stripes").and(p.locator(".on")).waitFor();
	assert.equal(await basicText(p), before);
	await context.close();
});

test("corner handles resize a symbol, with a readout, and the panel follows", async () => {
	const { p, context } = await started("symbol");
	await p.mouse.click(...at(await stageBox(p), 0.5, 0.5));
	await p.locator(".handle-dot").first().waitFor();
	assert.equal(await p.locator(".handle-dot").count(), 4);
	await dragHandle(p, p.locator(".handle-dot").nth(3), [0.5 + (0.25 * 2) / 3 + 0.002, 0.752], { release: false });
	await p.locator(".readout", { hasText: "1/4 of the height" }).waitFor();
	await p.mouse.up();
	const text = await basicText(p, (t) => t.includes("radius 15"));
	assert.ok(text.includes("radius 15"), text);
	await p.waitForFunction(() => document.querySelector(".share-box")?.value === "1/4");
	await context.close();
});

test("arrow keys nudge a symbol, one step at a time", async () => {
	const { p, context } = await started("symbol");
	await p.mouse.click(...at(await stageBox(p), 0.5, 0.5));
	await p.locator(".handle-box").focus();
	await p.keyboard.press("ArrowLeft");
	await p.keyboard.press("ArrowLeft");
	await p.keyboard.press("ArrowDown");
	await p.locator(".readout", { hasText: "across" }).waitFor();
	assert.equal(await p.evaluate(() => document.activeElement?.classList.contains("handle-box")), true, "the focus stays on it");
	const text = await basicText(p, (t) => t.includes("at fly=43 hoist=31"));
	assert.ok(text.includes("at fly=43 hoist=31"), text);
	await context.close();
});

test("dragging a stripe line writes a ratio, on the grid", async () => {
	const { p, context, errors } = await started("three-stripes");
	await row(p, "Stripes").click();
	const lines = p.locator(".handle-across");
	assert.equal(await lines.count(), 2);
	await dragHandle(p, lines.first(), [0.5, 0.255], { release: false });
	await p.locator(".readout", { hasText: "1/4 of the way down" }).waitFor();
	await p.mouse.up();
	const text = await basicText(p, (t) => t.includes("ratio 15 25 20"));
	assert.ok(text.includes("bars navy white navy {\n  ratio 15 25 20\n}"), text);
	assert.deepEqual(errors, []);
	await context.close();
});

test("a counted set of stripes gets its ratio when first dragged, and keeps its count", async () => {
	const { p, context } = await started("stripes-block");
	await row(p, "Stripes").click();
	await dragHandle(p, p.locator(".handle-across").nth(3), [0.8, 0.875]);
	const text = await basicText(p, (t) => t.includes("ratio"));
	assert.ok(text.includes("count 5\n  ratio 12 12 12 16.5 7.5"), text);
	await context.close();
});

test("a corner block resizes by its corner, and snaps", async () => {
	const { p, context } = await started("stripes-block");
	await row(p, "Corner block").click();
	await dragHandle(p, p.locator(".handle-dot"), [0.502, 0.335], { release: false });
	await p.locator(".readout", { hasText: "1/2 of the width, 1/3 of the height" }).waitFor();
	await p.mouse.up();
	const text = await basicText(p, (t) => t.includes("fly 45"));
	assert.ok(text.includes("fly 45\n  hoist 20"), text);
	await context.close();
});

test("typing fractions works, in size and turn", async () => {
	const { p, context, errors } = await opened(`${head}field a\ncharge star b {\n  radius 10\n}\n`);
	await row(p, "Star").click();
	await p.getByLabel("Size", { exact: true }).nth(1).fill("1/3");
	await p.keyboard.press("Enter");
	let text = await basicText(p, (t) => t.includes("radius 20"));
	assert.ok(text.includes("radius 20"), text);
	await p.getByText("1/3 of the height").waitFor();
	const turn = p.locator(".field", { has: p.locator('label:text-is("Turn")') }).locator(".share-box");
	await turn.fill("1/8");
	await p.keyboard.press("Enter");
	text = await basicText(p, (t) => t.includes("rotate 45"));
	assert.ok(text.includes("rotate 45"), text);
	await p.getByText("1/8 turn (45°)").waitFor();
	await turn.fill("36");
	await p.keyboard.press("Enter");
	await p.getByRole("button", { name: "1/10 turn, point down", pressed: true }).waitFor();
	const box = p.getByLabel("Size", { exact: true }).nth(1);
	await box.fill("nonsense");
	await p.keyboard.press("Enter");
	await p.getByText("That needs to be a fraction, like 1/3.").waitFor();
	assert.deepEqual(errors, []);
	await context.close();
});

test("a star's controls: spots, points, and how many", async () => {
	const { p, context } = await opened(`${head}field a\ncharge star b {\n  radius 10\n}\n`);
	await row(p, "Star").click();
	await p.getByRole("button", { name: "Top left" }).click();
	assert.ok((await basicText(p, (t) => t.includes("at fly="))).includes("at fly=22.5 hoist=15"));
	await p.getByRole("radio", { name: "Grid" }).click();
	let text = await basicText(p, (t) => t.includes("repeat grid"));
	assert.ok(text.includes("repeat grid rows=3 columns=3") && !text.includes("at fly"), text);
	assert.equal(await p.locator(".handle-dot").count(), 0, "a grid has no handles");
	await p.getByLabel("Rows").fill("2");
	await p.keyboard.press("Enter");
	await p.getByRole("radio", { name: "Ring" }).click();
	text = await basicText(p, (t) => t.includes("repeat ring"));
	assert.ok(text.includes("repeat ring count=6 radius=18") && !text.includes("rows"), text);
	await p.getByRole("radio", { name: "Just one" }).click();
	text = await basicText(p, (t) => !t.includes("repeat"));
	assert.ok(!text.includes("repeat"));
	await context.close();
});

test("colors can be chosen, and made", async () => {
	const { p, context } = await started("symbol");
	await row(p, "Circle").click();
	await p.getByRole("group", { name: "Color" }).getByRole("button", { name: "red" }).click();
	assert.ok((await basicText(p, (t) => t.includes("charge disc red"))).includes("charge disc red"));
	await p.getByRole("button", { name: "New color" }).click();
	await p.getByRole("button", { name: "Add this color" }).click();
	const text = await basicText(p, (t) => t.includes("charge disc blue"));
	assert.ok(text.includes('blue "#3a7bd5"') && text.includes("charge disc blue"), text);
	await context.close();
});

test("one drag is one thing to undo", async () => {
	const { p, context } = await started("symbol");
	const before = await basicText(p);
	await dragFlag(p, [0.5, 0.5], [0.25, 0.25]);
	await basicText(p, (t) => t.includes("at fly=22.5 hoist=15"));
	await p.locator("h1").click();
	await p.keyboard.press("Control+z");
	assert.equal(await basicText(p, (t) => t === before), before, "one undo goes all the way back");
	await p.keyboard.press("Control+Shift+z");
	assert.ok((await basicText(p, (t) => t.includes("at fly=22.5 hoist=15"))).includes("at fly=22.5 hoist=15"));
	// Two drags, one right after the other, are two.
	await dragFlag(p, [0.25, 0.25], [0.75, 0.25]);
	await basicText(p, (t) => t.includes("at fly=67.5 hoist=15"));
	await p.locator("h1").click();
	await p.keyboard.press("Control+z");
	assert.ok((await basicText(p, (t) => t.includes("at fly=22.5 hoist=15"))).includes("at fly=22.5 hoist=15"));
	await context.close();
});

test("Escape puts a drag back", async () => {
	const { p, context } = await started("symbol");
	const before = await basicText(p);
	await dragFlag(p, [0.5, 0.5], [0.25, 0.25], { release: false });
	await p.keyboard.press("Escape");
	await p.mouse.up();
	await p.locator(".readout.empty").waitFor({ state: "attached" });
	await settled(p);
	assert.equal(await basicText(p, (t) => t === before), before);
	await context.close();
});

test("everything else in a file stays byte for byte through a drag", async () => {
	const body = `// A comment about the whole thing.
vexyl 1
meta {
    name   "Spaced  out"   // with its own comment
    note "keep me"
}
palette {
  a "#112233" ;  b "#ddeeff"
}
proportion hoist=60 fly=90

/* before the field */
field a
bars a b { ratio 1 2; along hoist; rotate 30; opacity 0.5; }

charge star b { // and one here
      radius 10
}
`;
	const { p, context, errors } = await opened(body);
	await dragFlag(p, [0.5, 0.5], [0.25, 0.5]);
	const text = await basicText(p, (t) => t.includes("at fly="));
	assert.equal(text, body.replace("      radius 10\n", "      radius 10\n  at fly=22.5 hoist=30\n"));
	assert.deepEqual(errors, []);
	await context.close();
});

const kept = `${head}field a {
  clip {
    rect {
      fly 80
      hoist 50
    }
  }
}
charge star b {
  // stays with it
  radius 10
  fimbriate a 0.5
  cut {
    disc { radius 1; at fly=1 hoist=1; }
  }
}
charge polygon b {
  point fly=0 hoist=0
  point fly=4 hoist=0
  point fly=0 hoist=4
}
variant vertical {
  from transpose
  upright
}
`;

test("what Basic has no control for is listed, left byte for byte, and one click from Advanced", async () => {
	const { p, context, errors } = await opened(kept);
	const also = await p.locator(".also li").allTextContents();
	const said = also.join("|");
	for (const word of ["Clipped shape on Background", "Edging on Star", "Cut-out on Star", "Drawn shape", "Other form: vertical"]) {
		assert.ok(said.includes(word), `${word} in ${said}`);
	}
	await dragFlag(p, [0.5, 0.5], [0.75, 0.5]);
	const text = await basicText(p, (t) => t.includes("at fly=67.5"));
	assert.equal(text, kept.replace("    disc { radius 1; at fly=1 hoist=1; }\n  }\n", "    disc { radius 1; at fly=1 hoist=1; }\n  }\n  at fly=67.5 hoist=30\n"));
	await p.getByRole("button", { name: "Edit in Advanced: Other form: vertical" }).click();
	await p.locator(".panel-head h2", { hasText: "Vertical" }).waitFor();
	await p.getByRole("radio", { name: "Advanced", checked: true }).waitFor();
	assert.equal(await p.locator(".handles").count(), 0);
	assert.equal(await savedText(p), text);
	assert.deepEqual(errors, []);
	await context.close();
});

test("switching to Advanced and back keeps everything, and Advanced has no dragging", async () => {
	const { p, context, errors } = await started("stripes-block");
	await row(p, "Corner block").click();
	await dragHandle(p, p.locator(".handle-dot"), [0.502, 0.335]);
	const text = await basicText(p, (t) => t.includes("fly 45"));
	await p.getByRole("radio", { name: "Advanced" }).click();
	await p.locator(".panel-head h2", { hasText: "Canton" }).waitFor();
	assert.equal(await p.locator(".handles, .handle-dot, .layer-row").count(), 0);
	assert.equal(await savedText(p), text);
	assert.equal(await p.getByText("Corner block").count(), 0, "Advanced keeps its own words");
	await p.getByRole("radio", { name: "Source" }).click();
	await p.locator(".cm-line", { hasText: "canton" }).waitFor();
	await p.getByRole("radio", { name: "Basic" }).click();
	await p.getByRole("radio", { name: "Source", checked: true }).waitFor();
	await p.getByRole("radio", { name: "Design" }).click();
	await row(p, "Corner block").and(p.locator(".on")).waitFor();
	assert.equal(await basicText(p), text);
	await p.locator("h1").click();
	await p.keyboard.press("Control+z");
	assert.ok(!(await basicText(p, (t) => !t.includes("fly 45"))).includes("fly 45"), "what can be undone came through too");
	assert.deepEqual(errors, []);
	await context.close();
});

test("a file with a law suggests Advanced, and doesn't switch", async () => {
	const { p, context } = await opened(head.replace('name "T"', 'name "T"\n  law "Flag Act"') + "field a\n");
	await p.getByRole("radio", { name: "Basic", checked: true }).waitFor();
	await p.getByText("This flag is written from a law.").waitFor();
	await p.getByRole("button", { name: "Dismiss" }).click();
	assert.equal(await p.getByText("This flag is written from a law.").count(), 0);
	await p.getByRole("radio", { name: "Basic", checked: true }).waitFor();
	await context.close();
});

test("with something wrong in the file, nothing can be dragged, and it says where to look", async () => {
	const { p, context } = await opened(`${head}field a\ncharge star b {\n  radius 10\n}\nbars a nope\n`, undefined, false);
	await p.locator(".status.bad").waitFor();
	await p.getByRole("button", { name: "See what's wrong" }).click();
	await p.locator(".cm-problem").first().waitFor();
	await p.getByRole("radio", { name: "Design" }).click();
	assert.equal(await p.locator(".handles").count(), 0);
	await context.close();
});

test("the other handles: a single stripe, a cross, a diagonal cross, quarters and an edge block", async () => {
	const { p, context, errors } = await opened(`${head}field a\nquarters a b b a\nband b {\n  width 12\n}\ncross a {\n  fly 39 12 39\n  hoist 24 12 24\n}\nsaltire a {\n  width 6\n}\npanel {\n  side hoist\n  width 15\n  field b\n}\n`);
	await row(p, "Single stripe").click();
	await dragHandle(p, p.locator(".handle-across"), [0.5, 0.25]);
	assert.ok((await basicText(p, (t) => t.includes("offset -15"))).includes("offset -15"));
	await row(p, "Cross").click();
	await dragHandle(p, p.getByRole("button", { name: "Move the cross" }), [0.334, 0.5]);
	assert.ok((await basicText(p, (t) => t.includes("fly 24 12 54"))).includes("fly 24 12 54"));
	await row(p, "Diagonal cross").click();
	await p.getByRole("button", { name: "Change how thick the diagonal cross is" }).waitFor();
	await row(p, "Quarters").click();
	await dragHandle(p, p.getByRole("button", { name: "Move where the quarters meet" }), [0.6, 0.75]);
	assert.ok((await basicText(p, (t) => t.includes("split fly=54 hoist=45"))).includes("split fly=54 hoist=45"));
	await row(p, "Edge block").click();
	await dragHandle(p, p.getByRole("button", { name: "Resize the edge block" }), [0.2, 0.5]);
	assert.ok((await basicText(p, (t) => t.includes("width 18"))).includes("width 18"));
	assert.deepEqual(errors, []);
	await context.close();
});

test("a drag lands in the right place on a flag with an outside border", async () => {
	const { p, context } = await opened(`${head.replace("\n\n", "\nborder a 6 outside\n\n")}field b\ncharge disc a {\n  radius 6\n}\n`);
	const box = await stageBox(p);
	// The flag's grid doesn't fill the picture, and half of it is still half of it.
	const inFlag = (x, y) => [(6 + x * 90) / 102, (6 + y * 60) / 72];
	await dragFlag(p, [0.5, 0.5], inFlag(0.25, 0.25));
	assert.ok((await basicText(p, (t) => t.includes("at fly=22.5 hoist=15"))).includes("at fly=22.5 hoist=15"), JSON.stringify(box));
	await context.close();
});

test("a real finger can drag a symbol, at phone width", async () => {
	const { p, context, errors } = await started("symbol", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	const box = await stageBox(p);
	const cdp = await context.newCDPSession(p);
	const point = (x, y) => { const [cx, cy] = at(box, x, y); return { x: cx, y: cy }; };
	await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(0.5, 0.5)] });
	for (let i = 1; i <= 8; i++) {
		await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(0.5 - (0.25 * i) / 8, 0.5 - (0.25 * i) / 8)] });
		await p.waitForTimeout(16);
	}
	await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	const text = await basicText(p, (t) => t.includes("at fly=22.5 hoist=15"));
	assert.ok(text.includes("at fly=22.5 hoist=15"), text);
	assert.equal(await p.locator(".layer-row.on .row-label").textContent(), "Circle");
	assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector(".grab-zone")).touchAction), "none");
	assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
	assert.deepEqual(errors, []);
	await context.close();
});

test("the panel's slider is immediate, and a slide is one thing to undo", async () => {
	const { p, context } = await started("symbol");
	await row(p, "Circle").click();
	const before = await basicText(p);
	const slider = p.getByRole("slider", { name: "Size" });
	const box = await slider.boundingBox();
	await p.mouse.move(box.x + box.width * 0.72, box.y + box.height / 2);
	await p.mouse.down();
	await p.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 5 });
	await p.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 5 });
	await p.mouse.up();
	const moved = await basicText(p, (t) => !t.includes("radius 18"));
	assert.ok(!moved.includes("radius 18"));
	await p.locator("h1").click();
	await p.keyboard.press("Control+z");
	assert.equal(await basicText(p, (t) => t === before), before);
	await context.close();
});
