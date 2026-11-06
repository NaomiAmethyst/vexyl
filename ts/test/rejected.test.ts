// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatProblem, parse, ParseError, validate } from "../src/index.js";
import { header } from "./helpers.js";

// Every document here must be refused, with a problem saying why.
const tests: [string, string, string][] = [
	["no version", `meta { name "T"; }`, "must start with"],
	["wrong version", `vexyl 2`, "unsupported format version"],
	["missing meta name", "vexyl 1\nmeta { description \"x\"; }\n", "needs a `name`"],
	["incomplete", "vexyl 1\n", "needs `meta`"],
	["out of order", "vexyl 1\npalette { a \"#112233\"; }\nmeta { name \"T\"; }\n", "out of order"],
	["unknown layer", header + `sparkle a`, "unknown layer"],
	["unknown child", header + `bars a { sparkle 1; }`, "unknown here"],
	["unknown color", header + `field c`, `"c" isn't in the palette`],
	["bad palette value", "vexyl 1\nmeta { name \"T\"; }\npalette { a red; }\n", "must be #rrggbb"],
	["ratio mismatch", header + `bars a b { ratio 1 2 3; }`, "a ratio of 3 values"],
	["count mismatch", header + `bars a b { count 3; ratio 1 2; }`, "a ratio of 2 values"],
	["no depth", header + `chevrons a`, "needs a `depth`"],
	["bad angle", header + `chevrons a { depth 1; angle 90; }`, "between 0 and 90"],
	["bad along", header + `bars a { along sideways; }`, "must be one of"],
	["cross pair", header + `cross a { fly 1 2; hoist 1 2 1; }`, "needs 3 values"],
	["cross missing", header + `cross a { fly 1 2 1; }`, "needs `fly` and `hoist`"],
	["unknown shape", header + `charge blob a`, "unknown shape"],
	["radius missing", header + `charge disc a`, "needs a `radius`"],
	["ellipse without a size", header + `charge ellipse a { fly 1; }`, "needs `fly` and `hoist`"],
	["ring inner", header + `charge ring a { radius 1; inner 2; }`, "smaller than"],
	["star inner", header + `charge star a { radius 1; points 3; }`, "fewer than 5"],
	["grid at", header + `charge disc a { radius 1; at center; repeat grid rows=1 columns=1; }`, "can't have `at`"],
	["grid at point", header + `charge disc a { radius 1; at fly=1 hoist=1; repeat grid rows=1 columns=1; }`, "can't have `at`"],
	["too many copies", header + `charge disc a { radius 1; repeat grid rows=1000 columns=1000; }`, "more than"],
	["polygon at", header + `charge polygon a { at center; point fly=0 hoist=0; }`, "unknown here"],
	["polygon size", header + `charge polygon a { point fly=0 hoist=0; }`, "at least 3"],
	["svg unknown color", header + `charge svg nope { fly 1; hoist 1; markup "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/>"; }`, "isn't in the palette"],
	["svg currentColor without color", header + `charge svg { fly 1; hoist 1; markup "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'><rect fill='currentColor'/></svg>"; }`, "needs a palette color"],
	["gradient unknown color", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a b; }\n", `"b" isn't in the palette`],
	["gradient of one", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a; }\n", "at least 2 colors"],
	["gradient of gradients", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a a; h gradient g a; }\n", "solid color is needed"],
	["gradient bad axis", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a a along=up; }\n", "along must be"],
	["gradient bad property", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a a up=1; }\n", "unknown property"],
	["gradient stop count", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a a { stops 0; }; }\n", "2 colors but 1 stops"],
	["gradient stop range", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a a { stops 0 2; }; }\n", "between 0 and 1"],
	["gradient stop order", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a a { stops 1 0; }; }\n", "backward"],
	["gradient on svg", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a a; }\nproportion hoist=1 fly=1\ncharge svg g { fly 1; hoist 1; markup \"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/>\"; }", "solid color is needed"],
	["none in the palette", "vexyl 1\nmeta { name \"T\"; }\npalette { none \"#112233\"; }\n", "reserved"],
	["crescent circles apart", header + `charge crescent a { radius 1; inner 1; offset 3; }`, "cross"],
	["sun disc too big", header + `charge sun a { radius 1; disc 1; }`, "smaller than"],
	["path not path data", header + `charge path a { d "<script>"; box "0 0 1 1"; fly 1; }`, "isn't SVG path data"],
	["path no box", header + `charge path a { d "M0 0"; fly 1; }`, "needs a `box`"],
	["pile without reach", header + `pile a`, "needs a `depth`"],
	["pall without width", header + `pall a`, "needs a `width`"],
	["quarters count", header + `quarters a b`, "needs 4"],
	["checks size", header + `checks a b`, "needs `rows`"],
	["panel both", header + `panel { side top; corner upper-fly; width 1; field a; }`, "not both"],
	["panel size", header + `panel { field a; }`, "needs a `side`"],
	["panel edge", header + `panel { fly 1; hoist 1; edge wavy depth=1 count=1; field a; }`, "only a side panel"],
	["edge kind", header + `bars a { edge curly depth=1 count=1; }`, "wavy or zigzag"],
	["edge size", header + `bars a { edge wavy depth=1; }`, "needs `period`"],
	["repeat with ats", header + `charge disc a { radius 1; at center; at center; repeat ring count=2 radius=1; }`, "can't be combined"],
	["arc of one", header + `charge disc a { radius 1; repeat arc count=1 radius=1 from=0 to=1; }`, "at least 2"],
	["lines and hollow", header + `charge star a { radius 1; lines 1; hollow 1; }`, "can't be combined"],
	["grow length", header + `bars a b { grow 1; }`, "`grow` values"],
	["use unknown", header + `use nope`, "isn't a defined design"],
	["define taken", header + "define disc { rect { fly 1; hoist 1; }; }\n", "already taken"],
	["counterchange fimbriated", header + `saltire a { width 1; counterchange; fimbriate b 1; }`, "can't be fimbriated"],
	["adapt empty", header + `adapt`, "needs `wider`"],
	["adapt bad rule", header + `adapt { wider stretch; }`, "must be one of"],
	["adapt bad range", header + `adapt { wider extend; range 2 1; }`, "lowest and highest"],
	["variant unknown turn", header + `variant v { from flip; }`, "must be one of"],
	["outline unknown", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; }\nproportion hoist=1 fly=1\noutline flag\n", "unknown form"],
	["layers after adapt", header + "adapt { wider extend; }\nfield a\n", "out of order"],
	["bad until", "vexyl 1\nmeta { name \"T\"; until \"soon\"; }\n", "must be YYYY"],
	["until first", "vexyl 1\nmeta { name \"T\"; date \"2000\"; until \"1999\"; }\n", "comes before"],
	["bad series", "vexyl 1\nmeta { name \"T\"; series \"United States\"; }\n", "lowercase words"],
	["unsourced restriction", "vexyl 1\nmeta { name \"T\"; restriction \"No\"; }\n", "needs a `source`"],
	["law with no name", "vexyl 1\nmeta { name \"T\"; law; }\n", "needs one string"],
	["bad date", "vexyl 1\nmeta { name \"T\"; date \"last year\"; }\n", "must be YYYY"],
	["impossible date", "vexyl 1\nmeta { name \"T\"; date \"2026-02-30\"; }\n", "must be YYYY"],
	["cmyk count", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\" { cmyk 1 2; }; }\n", "4 values"],
	["cmyk range", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\" { cmyk 101 0 0 0; }; }\n", "from 0 to 100"],
	["unknown color system", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\" { hsl \"x\"; }; }\n", "unknown here"],
	["apex without angle", header + `chevrons a { depth 1; apex 2; }`, "needs an `angle`"],
	["negative apex", header + `chevrons a { depth 1; angle 45; apex -2; }`, "can't be negative"],
	["heart radius", header + `charge heart a`, "needs a `radius`"],
	["heart spread", header + `charge heart a { radius 1; spread 2; }`, "must be less than"],
	["svg cut", header + `field a { cut { svg; }; }`, "can't be used"],
	["svg repeat", header + `charge svg { fly 1; hoist 1; repeat ring count=2 radius=1; markup "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/>"; }`, "can't be repeated"],
	["infinite", header + `charge disc a { radius #inf; }`, "finite"],
	["opacity range", header + `field a { opacity 2; }`, "between 0 and 1"],
	["duplicate child", header + `field a { opacity 1; opacity 1; }`, "more than once"],
	["annotation", header + `(x)field a`, "type annotations"],
	["duplicate property", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; }\nproportion hoist=1 hoist=2 fly=2\n", "hoist"],
	["no canton size", header + `canton { field a; }`, "needs `fly` and `hoist`"],
	["empty group", header + `group`, "at least one layer"],
	["empty emblem", header + `emblem { along bend; }`, "at least one charge"],
	["emblem with a field", header + `emblem { field a; charge disc a { radius 1; }; }`, "only hold charges"],
	["nested emblem", header + `emblem { emblem { charge disc a { radius 1; }; }; }`, "only hold charges"],
	["emblem grid", header + `emblem { charge disc a { radius 1; repeat grid rows=2 columns=2; }; }`, "needs a region"],
	["emblem bad axis", header + `emblem { along sideways; charge disc a { radius 1; }; }`, "must be one of"],
	["emblem arguments", header + `emblem 1 { charge disc a { radius 1; }; }`, "takes no arguments"],
	["line without step", header + `charge disc a { radius 1; repeat line count=2; }`, "needs a step"],
	["line unknown property", header + `charge disc a { radius 1; repeat line count=2 fly=1 radius=2; }`, "unknown property"],
];

for (const [name, src, want] of tests) {
	test(`refuses: ${name}`, () => {
		const problems = validate(src, "test");
		assert.ok(problems.length > 0, "no problems");
		const text = problems.map(formatProblem).join("\n");
		assert.ok(text.includes(want), `${text} lacks ${want}`);
		assert.throws(() => parse(src), ParseError);
	});
}

test("problems say where they are", () => {
	const ps = validate(header + "sparkle a\n", "f");
	assert.equal(ps.length, 1);
	assert.equal(ps[0]!.line, 5);
	assert.equal(ps[0]!.column, 1);
	assert.equal(ps[0]!.node, "sparkle");
	assert.deepEqual(validate(header + "field a\n", "f"), []);
	const syntax = validate("vexyl 1\nmeta {\n", "f");
	assert.ok(syntax.length >= 1);
	assert.ok(syntax.some((p) => p.line !== undefined), "a syntax error has a place");
});

test("every problem is reported, not just the first", () => {
	assert.throws(() => parse(header + "field nope\nfield nada\n", "demo.kdl"), (e: ParseError) => {
		assert.ok(e.message.includes("demo.kdl:5:1"), e.message);
		assert.ok(e.message.includes("demo.kdl:6:1"), e.message);
		assert.equal(e.problems.length, 2);
		return true;
	});
});

test("names from a document can't reach the language's own properties", () => {
	for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
		assert.ok(validate(header + `field ${name}`).length > 0, `field ${name}`);
		assert.ok(validate(header + `charge ${name} a`).length > 0, `charge ${name}`);
		assert.ok(validate(header + `use ${name}`).length > 0, `use ${name}`);
		assert.ok(validate(header + `bars a { ${name} 1; }`).length > 0, `child ${name}`);
		assert.ok(validate(header + `${name} a`).length > 0, `layer ${name}`);
		assert.ok(validate(header + `field a { cut { ${name}; }; }`).length > 0, `cut ${name}`);
		assert.ok(validate(`vexyl 1\nmeta { name "T"; ${name} "x"; }\n`).length > 0, `meta ${name}`);
		const palette = `vexyl 1\nmeta { name "T"; }\npalette { ${name} "#112233"; }\nproportion hoist=1 fly=1\nfield ${name}\n`;
		assert.deepEqual(validate(palette), [], `palette ${name}`);
		const flag = parse(palette);
		assert.equal(flag.palette[name], "#112233");
		assert.equal(Object.getPrototypeOf({}).polluted, undefined);
	}
});

test("a document can be valid with a variant or fold of any name", () => {
	const flag = parse(header + 'field a\nvariant "__proto__" { from rotate; }\nfold "constructor" { over along=hoist at=10 move=fly; }\n');
	assert.equal(Object.keys(flag.variants).length, 1);
	assert.equal(flag.variants["__proto__"]!.from, "rotate");
	assert.equal(flag.folds["constructor"]!.steps.length, 1);
});
