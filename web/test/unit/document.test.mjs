// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load, loadLibrary } from "./load.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const { applyOps, outline } = await load("document");
const lib = await loadLibrary();

const flags = readdirSync(join(repo, "conformance/valid")).filter((f) => f.endsWith(".kdl")).map((f) => join(repo, "conformance/valid", f));
const reviewed = resolve(repo, "../vexyl-flags/reviewed");
if (existsSync(reviewed)) {
	flags.push(...readdirSync(reviewed).filter((f) => f.endsWith(".kdl")).map((f) => join(reviewed, f)));
}

const n = (raw) => ({ v: Number(raw), raw });
const s = (v) => ({ v });

const commented = `// A comment above everything.
vexyl 1
meta {
  name "T"   // how it's named
  /* a block comment */ license "CC0-1.0"
}
palette {
  a   "#112233"    // odd spacing, kept
  b "#445566"; c "#778899"
}
proportion hoist=10    fly=20 // spaced out

// About the bars.
bars a b   {
  count 3
  // about the ratio
  ratio 1 2 1
}

charge disc c { radius 1.50; at fly=1e1 hoist=10; }

/-field a

fold half { over along=fly at=5 move=bottom; }
`;

function changedLines(a, b) {
	const x = a.split("\n");
	const y = b.split("\n");
	assert.equal(x.length, y.length, "the number of lines changed");
	return x.flatMap((line, i) => (line === y[i] ? [] : [[i + 1, line, y[i]]]));
}

test("nothing changes the file if nothing's asked", () => {
	for (const file of flags) {
		const text = readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
		assert.equal(applyOps(text, []).text, text, file);
	}
});

test("changing a value changes only that value", () => {
	const nodes = outline(commented);
	const bars = nodes.find((x) => x.name === "bars");
	const count = bars.kids.find((x) => x.name === "count");
	const { text } = applyOps(commented, [{ op: "entries", at: count.at, args: [n("5")] }]);
	assert.deepEqual(changedLines(commented, text), [[15, "  count 3", "  count 5"]]);
});

test("a number is written as it was typed", () => {
	const nodes = outline(commented);
	const prop = nodes.find((x) => x.name === "proportion");
	const { text } = applyOps(commented, [{ op: "entries", at: prop.at, props: [["fly", n("30.50")]] }]);
	assert.ok(text.includes("proportion hoist=10    fly=30.50 // spaced out"));
});

test("an untouched number keeps how it's written", () => {
	const nodes = outline(commented);
	const charge = nodes.find((x) => x.name === "charge");
	const at = charge.kids.find((x) => x.name === "at");
	const { text } = applyOps(commented, [{ op: "entries", at: at.at, props: [["fly", at.props.find(([k]) => k === "fly")[1]], ["hoist", n("7")]] }]);
	assert.ok(text.includes("charge disc c { radius 1.50; at fly=1e1 hoist=7; }"), text);
});

test("adding and removing a color changes only the list", () => {
	const nodes = outline(commented);
	const bars = nodes.find((x) => x.name === "bars");
	const added = applyOps(commented, [{ op: "entries", at: bars.at, args: [...bars.args, s("c")] }]).text;
	assert.deepEqual(changedLines(commented, added), [[14, "bars a b   {", "bars a b c   {"]]);
	const removed = applyOps(added, [{ op: "entries", at: bars.at, args: [...bars.args, s("c")].slice(0, 2) }]).text;
	assert.equal(removed, commented);
});

test("a new child goes in with its siblings, in their form", () => {
	const nodes = outline(commented);
	const bars = nodes.find((x) => x.name === "bars");
	const { text } = applyOps(commented, [{ op: "child", at: bars.at, name: "rotate", args: [n("5")] }]);
	assert.ok(text.includes("  ratio 1 2 1\n  rotate 5\n}"), text);
	const charge = nodes.find((x) => x.name === "charge");
	const inline = applyOps(commented, [{ op: "child", at: charge.at, name: "rotate", args: [n("5")] }]).text;
	assert.ok(inline.includes("charge disc c { radius 1.50; at fly=1e1 hoist=10; rotate 5; }"), inline);
	assert.deepEqual(lib.validate(inline), []);
});

test("a child goes in before a holder's layers, so that layers keep their numbers", () => {
	const doc = lib.locate;
	const text = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n}\nproportion hoist=1 fly=2\ncanton {\n  field a\n}\n';
	const canton = outline(text).find((x) => x.name === "canton");
	const out = applyOps(text, [{ op: "child", at: canton.at, name: "fly", args: [n("1")] }, { op: "child", at: canton.at, name: "hoist", args: [n("1")] }]).text;
	assert.ok(out.includes("canton {\n  fly 1\n  hoist 1\n  field a\n}"), out);
	assert.equal(doc(out).find((x) => x.path === "1.0" || x.path === "0.0")?.node, "field");
});

test("a child goes in a node with no block, making one", () => {
	const text = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n}\nproportion hoist=1 fly=2\nbars a a\n';
	const bars = outline(text).find((x) => x.name === "bars");
	const out = applyOps(text, [{ op: "child", at: bars.at, name: "rotate", args: [n("5")] }]).text;
	assert.equal(out, 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n}\nproportion hoist=1 fly=2\nbars a a {\n  rotate 5\n}\n');
	assert.deepEqual(lib.validate(out), []);
	assert.equal(applyOps(out, [{ op: "dropChild", at: bars.at, name: "rotate" }]).error, undefined);
});

test("removing a term keeps the comments above it", () => {
	const nodes = outline(commented);
	const bars = nodes.find((x) => x.name === "bars");
	const { text } = applyOps(commented, [{ op: "remove", at: bars.at }]);
	assert.ok(text.includes("// About the bars."), text);
	assert.ok(!text.includes("bars a b"));
	assert.ok(text.includes("// A comment above everything."));
	assert.ok(text.includes("/-field a"), "a slashdashed node is still there");
});

test("new top-level terms go where the format's order says", () => {
	const text = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n}\nproportion hoist=1 fly=2\nfield a\nfold f {\n  over along=fly at=0.5 move=bottom\n}\n';
	for (const [add, valid] of [["border a 0.1", true], ["charge disc a {\n  radius 0.1\n}", true], ["adapt {\n  wider extend\n}", true], ['define d {\n  field a\n}', true], ["variant v {\n  from rotate\n}", true], ["outline pennant", true], ["reverse {\n  field a\n}", true]]) {
		const out = applyOps(text, [{ op: "add", at: null, text: add }]).text;
		assert.deepEqual(lib.validate(out), valid ? [] : lib.validate(out), add);
		assert.ok(out.endsWith("}\n") || out.endsWith(")\n") || out.endsWith("\n"));
	}
});

test("a new term nested in a holder is indented with it", () => {
	const text = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n}\nproportion hoist=1 fly=2\ncanton {\n  fly 1\n  hoist 1\n  field a\n}\n';
	const canton = outline(text).find((x) => x.name === "canton");
	const out = applyOps(text, [{ op: "add", at: canton.at, text: "charge star a {\n  radius 0.1\n}" }]).text;
	assert.ok(out.includes("  field a\n  charge star a {\n    radius 0.1\n  }\n}"), out);
	assert.deepEqual(lib.validate(out), []);
});

test("moving a term swaps it with its neighbor and keeps the comments with it", () => {
	const text = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n}\nproportion hoist=1 fly=2\n// the field\nfield a\n// the disc\ncharge disc a {\n  radius 0.1\n}\n';
	const nodes = outline(text);
	const field = nodes.find((x) => x.name === "field");
	const out = applyOps(text, [{ op: "move", at: field.at, delta: 1 }]).text;
	assert.equal(out, 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n}\nproportion hoist=1 fly=2\n// the disc\ncharge disc a {\n  radius 0.1\n}\n// the field\nfield a\n');
});

test("renaming a color changes it everywhere it's used, and nowhere else", () => {
	const text = 'vexyl 1\nmeta {\n  name "a"\n}\npalette {\n  a "#112233"\n  b "#445566"\n  g gradient a b\n}\nproportion hoist=1 fly=2\nbars a b g\ncharge disc a {\n  radius 0.1\n  fimbriate a 0.01\n}\nborder a 0.1\n'.replace("bars a b g\ncharge disc a {\n  radius 0.1\n  fimbriate a 0.01\n}\nborder a 0.1\n", "border a 0.1\nbars a b g\ncharge disc a {\n  radius 0.1\n  fimbriate a 0.01\n}\n");
	const out = applyOps(text, [{ op: "renameColor", from: "a", to: "sky" }]).text;
	assert.ok(out.includes('name "a"'), "it isn't a color there");
	assert.ok(out.includes('sky "#112233"') && out.includes("g gradient sky b") && out.includes("bars sky b g") && out.includes("charge disc sky") && out.includes("fimbriate sky 0.01") && out.includes("border sky 0.1"), out);
	assert.deepEqual(lib.validate(out), []);
});

test("a change to a file that isn't KDL is refused, and leaves it alone", () => {
	assert.ok(applyOps("bars {", [{ op: "remove", at: [0] }]).error !== undefined);
});

test("a stale change is refused", () => {
	assert.ok(applyOps(commented, [{ op: "remove", at: [99] }]).error !== undefined);
});

test("a name like __proto__ is only ever a name", () => {
	const text = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  __proto__ "#112233"\n  constructor "#445566"\n}\nproportion hoist=1 fly=2\nbars __proto__ constructor\n';
	const nodes = outline(text);
	assert.equal(nodes.find((x) => x.name === "palette").kids[0].path, "palette/__proto__");
	const out = applyOps(text, [{ op: "renameColor", from: "__proto__", to: "a" }]).text;
	assert.ok(out.includes("bars a constructor"));
	assert.equal({}.polluted, undefined);
	assert.equal(Object.getPrototypeOf({}), Object.prototype);
});

test("the form's paths are the same as the library's, on every flag", () => {
	for (const file of flags) {
		const text = readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
		const paths = new Map();
		const visit = (list) => {
			for (const x of list) {
				if (x.path !== undefined) {
					paths.set(x.path, [x.line, x.endLine]);
				}
				visit(x.kids);
			}
		};
		visit(outline(text));
		const spans = lib.locate(text).filter((x) => /^(\d|reverse\/|variant\/|define\/|palette\/|fold\/)/.test(x.path));
		for (const span of spans) {
			if (span.path.startsWith("define/") && span.path.split("/").length > 2 && !paths.has(span.path)) {
				continue;
			}
			assert.deepEqual(paths.get(span.path), [span.line, span.endLine], `${file}: ${span.path}`);
		}
	}
});

test("changing each number of each flag, one at a time, changes one line and nothing else", () => {
	let tried = 0;
	for (const file of flags.slice(0, 80)) {
		const text = readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
		const nodes = outline(text);
		const visit = (list) => {
			for (const x of list) {
				if (x.line === x.endLine && x.kids.length === 0) {
					const i = x.args.findIndex((a) => typeof a.v === "number");
					if (i >= 0 && tried < 1500) {
						const args = x.args.map((a, j) => (j === i ? n("7.25") : a));
						const out = applyOps(text, [{ op: "entries", at: x.at, args }]).text;
						const changes = changedLines(text, out);
						assert.equal(changes.length, 1, `${file} line ${x.line}`);
						assert.equal(changes[0][0], x.line);
						tried++;
					}
				}
				if (x.kids.length < 40) {
					visit(x.kids);
				}
			}
		};
		visit(nodes);
	}
	assert.ok(tried > 200, `only ${tried}`);
});

test("a hexadecimal number before a semicolon keeps both, despite how the parser reads it", () => {
	const text = "charge disc a { at fly=1 hoist=0x0A; }\n";
	const at = outline(text)[0].kids[0];
	assert.equal(at.props[1][1].raw, "0x0A");
	assert.equal(applyOps(text, [{ op: "entries", at: at.at, props: [["hoist", n("7")]] }]).text, "charge disc a { at fly=1 hoist=7; }\n");
});

test("taking out a block's first child keeps the block on its lines", () => {
	const head = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n}\nproportion hoist=10 fly=20\nfield a\n';
	const at = [5];
	let text = `${head}variant d {\n  from transpose\n  upright\n}\n`;
	text = applyOps(text, [{ op: "dropChild", at, name: "from" }]).text;
	assert.ok(text.endsWith("variant d {\n  upright\n}\n"), text);
	text = applyOps(text, [{ op: "child", at, name: "from", args: [s("invert")] }]).text;
	assert.ok(text.endsWith("variant d {\n  upright\n  from invert\n}\n"), text);
	text = applyOps(text, [{ op: "dropChild", at, name: "upright" }]).text;
	assert.ok(text.endsWith("variant d {\n  from invert\n}\n"), text);
	assert.deepEqual(lib.validate(text), []);
	const inline = applyOps(`${head}variant d { from invert; upright; }\n`, [{ op: "dropChild", at, name: "from" }]).text;
	assert.ok(inline.endsWith("variant d { upright; }\n"), inline);
});

test("a block a past edit left misshapen is no longer taken for a one-liner", () => {
	const head = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n}\nproportion hoist=10 fly=20\nfield a\n';
	const out = applyOps(`${head}variant d {  upright\n}\n`, [{ op: "child", at: [5], name: "from", args: [s("invert")] }]).text;
	assert.ok(!out.includes(";"), out);
	assert.deepEqual(lib.validate(out), []);
});

test("renaming a variant or a fold changes only it", () => {
	const text = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n}\nproportion hoist=10 fly=20\nfield a\n// its own comment\nvariant old {\n  from invert\n}\nvariant other\nfold old {\n  over along=fly at=5 move=bottom\n}\n';
	const out = applyOps(text, [{ op: "renameTerm", kind: "variant", from: "old", to: "has space" }]).text;
	assert.ok(out.includes('// its own comment\nvariant "has space" {\n  from invert') && out.includes("fold old {"), out);
	assert.deepEqual(lib.validate(out), []);
});

test("renaming a definition changes everything that uses it, and nothing else", () => {
	const text = 'vexyl 1\nmeta {\n  name "badge"\n}\npalette {\n  badge "#112233"\n}\nproportion hoist=10 fly=20\ndefine badge {\n  path "M0 0H1V1Z" box="0 0 1 1"\n}\ndefine scene {\n  charge badge badge {\n    fly 1\n    hoist 1\n    at center\n  }\n}\nfield badge {\n  clip {\n    badge {\n      fly 5\n      hoist 5\n      at center\n    }\n  }\n}\nuse scene\nvariant badge {\n  charge badge badge {\n    fly 2\n    hoist 2\n    at center\n  }\n}\n';
	assert.deepEqual(lib.validate(text), []);
	const out = applyOps(text, [{ op: "renameTerm", kind: "define", from: "badge", to: "mark" }]).text;
	assert.deepEqual(lib.validate(out), []);
	assert.ok(out.includes('define mark {') && out.includes("charge mark badge") && out.includes("clip {\n    mark {"), out);
	assert.ok(out.includes('name "badge"') && out.includes('badge "#112233"') && out.includes("field badge") && out.includes("variant badge"), out);
	const scene = applyOps(text, [{ op: "renameTerm", kind: "define", from: "scene", to: "view" }]).text;
	assert.ok(scene.includes("use view") && scene.includes("define view"), scene);
});

test("a term's source can be replaced, if it's still one term that can be read", () => {
	const text = 'vexyl 1\nmeta {\n  name "T"\n}\npalette {\n  a "#112233"\n}\nproportion hoist=10 fly=20\nfield a\n// kept\nvariant v {\n  from rotate\n}\n';
	const node = outline(text).find((x) => x.name === "variant");
	const was = text.slice(node.start, node.end);
	const op = (to, w = was) => [{ op: "replaceText", start: node.start, end: node.end, was: w, to }];
	const out = applyOps(text, op("variant distress {\n  from invert\n}\n")).text;
	assert.ok(out.endsWith('// kept\nvariant distress {\n  from invert\n}\n'), out);
	assert.deepEqual(lib.validate(out), []);
	assert.match(applyOps(text, op("variant v {")).error, /KDL/);
	assert.match(applyOps(text, op("")).error, /Remove/);
	assert.match(applyOps(text, op("variant v\nvariant w")).error, /one term/);
	assert.match(applyOps(text, op("variant w", "variant x")).error, /changed/);
});
