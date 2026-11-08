// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import { bounds } from "../src/svg.js";
import { foldFacets, foldShape } from "../src/fold.js";
import {
	axis, bandPoly, barPolys, boundary, cardioidPoints, chevronPolys, clipConvex, crossPolys, dot, offsetPolygon, position, rectPoly, regionCenter, shapeGeom, sub, type Region, type Vec,
} from "../src/geometry.js";
import { validPath } from "../src/parse.js";
import { pallPoints, rayPolys } from "../src/shapes.js";
import { model, parse, RenderError, svg, svgTree, treeToSvg, validate, type BandLayer, type BarsLayer, type ChargeLayer, type ChevronsLayer, type CrossLayer, type EmblemLayer, type Options, type RaysLayer, type StarShape } from "../src/index.js";
import { num } from "../src/text.js";
import { header, readRepo, render, root, withoutIds } from "./helpers.js";

const near = (a: Vec, b: Vec): boolean => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
const hasPoint = (poly: Vec[], want: Vec): boolean => poly.some((p) => near(p, want));
const contains = (out: string, want: string): void => assert.ok(out.includes(want), `no ${want} in ${out}`);
const v = (x: number, y: number): Vec => ({ x, y });
const r2010: Region = { w: 20, h: 10 };

test("the reference's output, character for character, apart from IDs", () => {
	const dirs = [join(root, "flags"), join(root, "go/testdata")];
	for (const dir of dirs) {
		for (const name of readdirSync(dir).filter((f) => f.endsWith(".kdl"))) {
			const golden = join(root, "go/testdata/golden", basename(name, ".kdl") + ".svg");
			const out = svg(parse(readFileSync(join(dir, name), "utf8")));
			assert.equal(withoutIds(out), withoutIds(readFileSync(golden, "utf8")), name);
		}
	}
});

test("axis normals point away from the first bar", () => {
	const r: Region = { w: 30, h: 20 };
	const tests: ["fly" | "hoist" | "bend" | "bend-sinister", Vec][] = [["fly", v(0, 0)], ["hoist", v(0, 0)], ["bend", v(0, 20)], ["bend-sinister", v(0, 0)]];
	for (const [along, first] of tests) {
		const { dir, normal } = axis(r, along, 0);
		assert.ok(Math.abs(dot(dir, normal)) <= 1e-12, along);
		assert.ok(dot(sub(first, regionCenter(r)), normal) < 0, along);
	}
});

test("bends follow the corners at any proportion", () => {
	const r: Region = { w: 30, h: 20 };
	const poly = bandPoly(r, "bend-sinister", 0, 2, 0, true);
	const { dir, normal } = axis(r, "bend-sinister", 0);
	for (const corner of [v(0, 20), v(30, 0)]) {
		assert.ok(Math.abs(dot(sub(corner, regionCenter(r)), normal)) <= 1e-9);
	}
	assert.equal(poly.length, 4);
	assert.ok(Math.abs(dir.x * 20 + dir.y * 30) <= 1e-9);
});

test("bar ratios", () => {
	const polys = barPolys(parse(header + "bars a b a { ratio 2 1 2; }").layers[0] as BarsLayer, r2010);
	[0, 4, 6].forEach((y, i) => {
		assert.ok(hasPoint(polys[i]!, v(0, y)) && hasPoint(polys[i]!, v(20, 10)), `bar ${i}`);
	});
});

test("diagonal bars cover the flag", () => {
	const polys = barPolys(parse(header + "bars a b { along bend-sinister; }").layers[0] as BarsLayer, r2010);
	assert.ok(hasPoint(polys[0]!, v(0, 0)) && hasPoint(polys[0]!, v(20, 10)));
	assert.ok(hasPoint(polys[1]!, v(0, 10)) && hasPoint(polys[1]!, v(20, 0)));
});

test("a chevron meets the corners by default", () => {
	const polys = chevronPolys(parse(header + "chevrons a { depth 5; }").layers[0] as ChevronsLayer, r2010);
	for (const want of [v(5, 5), v(0, 0), v(0, 10)]) {
		assert.ok(hasPoint(polys[0]!, want));
	}
	assert.equal(polys[0]!.length, 3);
});

test("chevron angles and edges", () => {
	const polys = chevronPolys(parse(header + "chevrons a b { depth 8; angle 45; from fly; }").layers[0] as ChevronsLayer, r2010);
	for (const want of [v(12, 5), v(17, 0), v(20, 0), v(20, 10), v(17, 10)]) {
		assert.ok(hasPoint(polys[0]!, want));
	}
	assert.ok(hasPoint(polys[1]!, v(16, 5)));
});

test("an off-center chevron", () => {
	const doc = (body: string) => `vexyl 1\nmeta { name "T"; }\npalette { a "#112233"; }\nproportion hoist=6 fly=10\n${body}`;
	const r: Region = { w: 10, h: 6 };
	const poly = chevronPolys(parse(doc("chevrons a { depth 4; angle 45; apex 2; }")).layers[0] as ChevronsLayer, r)[0]!;
	for (const want of [v(4, 2), v(2, 0), v(0, 0), v(0, 6)]) {
		assert.ok(hasPoint(poly, want));
	}
	assert.equal(poly.length, 4);
	const top = chevronPolys(parse(doc("chevrons a { from top; depth 4; angle 45; apex 3; }")).layers[0] as ChevronsLayer, r)[0]!;
	assert.ok(hasPoint(top, v(3, 4)));
});

test("a cross reads like a construction sheet", () => {
	const f = parse(`vexyl 1\nmeta { name "T"; }\npalette { a "#112233"; }\nproportion hoist=10 fly=16\ncross a { fly 5 2 9; hoist 4 2 4; }`);
	const polys = crossPolys(f.layers[0] as CrossLayer, { w: 16, h: 10 }, 0);
	assert.ok(hasPoint(polys[0], v(5, 0)) && hasPoint(polys[0], v(7, 10)));
	assert.ok(hasPoint(polys[1], v(0, 4)) && hasPoint(polys[1], v(16, 6)));
});

test("heart geometry", () => {
	const s = (parse(header + "charge heart a { radius 2; spread 2; at fly=5 hoist=5; }").layers[0] as ChargeLayer).shape;
	const g = shapeGeom(s, position(s, r2010), 0);
	assert.ok(g.path!.startsWith("M5 " + num(5 + 1 + 2 * Math.SQRT2)), g.path);
	assert.ok(g.path!.includes("5 " + num(5 - Math.sqrt(3))), g.path);
	const def = (parse(header + "charge heart a { radius 2; }").layers[0] as ChargeLayer).shape;
	assert.ok(Math.abs((def as { spread: number }).spread - 2 * Math.SQRT2) < 1e-9);
	const turned = (parse(header + "charge heart a { radius 2; spread 2; at fly=5 hoist=5; rotate -90; }").layers[0] as ChargeLayer).shape;
	assert.ok(shapeGeom(turned, v(5, 5), 0).path!.startsWith("M" + num(5 + 1 + 2 * Math.SQRT2) + " 5"));
});

test("star and cardioid geometry", () => {
	const s = (parse(header + "charge star a { radius 1; }").layers[0] as ChargeLayer).shape as StarShape;
	assert.ok(Math.abs(s.inner - 0.381966) < 1e-5);
	const g = shapeGeom(s, v(0, 0), 0);
	assert.equal(g.poly!.length, 10);
	assert.ok(near(g.poly![0]!, v(0, -1)));
	const points = cardioidPoints(2);
	assert.ok(near(points[90]!, v(0, 2)));
	assert.ok(near(points[0]!, v(0, 0)));
});

const gradientHeader = `vexyl 1
meta { name "T"; }
palette {
  a "#112233"
  b "#445566"
  c "#778899"
  flow gradient a b c
  drop gradient a b along=hoist { stops 0.25 1; }
  bend gradient a b along=bend
  rise gradient a b along=bend-sinister
}
proportion hoist=10 fly=20
`;

test("gradient definitions", () => {
	assert.deepEqual(parse(gradientHeader).gradients["flow"]!.stops, [0, 0.5, 1]);
	const tests = [
		["flow", `x1="0" y1="0" x2="1" y2="0"`],
		["drop", `x1="0" y1="0" x2="0" y2="1"`],
		["bend", `x1="0" y1="0" x2="1" y2="1"`],
		["rise", `x1="0" y1="1" x2="1" y2="0"`],
	] as const;
	for (const [name, want] of tests) {
		contains(render(gradientHeader + "field " + name), want);
	}
	contains(render(gradientHeader + "field drop"), `<stop offset="0.25" stop-color="#112233"/>`);
});

test("gradient bars are their true width", () => {
	const out = render(gradientHeader + "bars a drop b drop");
	for (const want of ["0,2.5 20,2.5 20,5 0,5", "0,7.5 20,7.5 20,10 0,10", "0,0 20,0 20,10 0,10"]) {
		contains(out, want);
	}
	assert.equal(out.split("<linearGradient").length - 1, 1);
});

test("a gradient spans a cross as one shape", () => {
	contains(render(gradientHeader + "cross flow { fly 9 2 9; hoist 4 2 4; }"), `gradientUnits="userSpaceOnUse" gradientTransform="translate(0 0) scale(20 10)"`);
});

test("a gradient spans the flag for its outside border, and is reused for fimbriation", () => {
	const out = render(gradientHeader + "border flow 1 outside\ncharge disc a { radius 1; fimbriate flow 0.5; }");
	contains(out, `gradientUnits="userSpaceOnUse" gradientTransform="translate(0 0) scale(20 10)"`);
	assert.equal(out.split("<linearGradient").length - 1, 2);
	contains(out, 'stroke="url(#');
});

test("a gradient spans only what's inside the region", () => {
	contains(render(gradientHeader + "pile flow { depth 5; }"), "translate(0 0) scale(5 10)");
	contains(render(gradientHeader + "pall flow { width 2; }"), "translate(0 0) scale(20 10)");
	contains(render(gradientHeader + "chevrons a { depth 5; fimbriate flow 1; }"), "translate(0 0) scale(5 10)");
});

test("an arc goes clockwise", () => {
	const out = render(gradientHeader + "charge disc a { radius 1; repeat arc count=3 radius=3 from=300 to=60; }");
	contains(out, `cx="10" cy="2"`);
	assert.ok(!out.includes(`cx="10" cy="8"`));
});

test("a turned variant's reverse is its turned front, mirrored", () => {
	const src = gradientHeader + "field a\nvariant v { from transpose; }\n";
	contains(svg(parse(src), { variant: "v", side: "reverse" }), `transform="matrix(0 -1 -1 0 10 20) matrix(-1 0 0 1 20 0)"`);
});

test("a band's fimbriation doesn't run along the flag's edge", () => {
	const out = render(gradientHeader + "band flow { width 2; fimbriate a 1; }");
	contains(out, `stroke-width="2"`);
	contains(out, `points="0,4 20,4 20,6 0,6" fill="url(#`);
});

test("the US canton has fifty stars", () => {
	const out = svg(parse(readRepo("flags/united-states.kdl")));
	assert.equal(out.split(`fill="#ffffff"`).length - 1, 50 + 6);
});

test("the EU's stars stay upright", () => {
	const f = parse(readRepo("flags/european-union.kdl"));
	const s = (f.layers[1] as ChargeLayer).shape;
	const upright = shapeGeom(s, v(0, 0), 0).poly!;
	contains(svg(f), num(13.5 + 6 + upright[0]!.x) + "," + num(9 + upright[0]!.y));
});

// Every full or fragmentary KDL example in the docs must be valid.
test("examples in the docs", () => {
	for (const doc of ["README.md", "SPEC.md"]) {
		const blocks = [...readRepo(doc).matchAll(/```kdl\n([\s\S]*?)```/g)];
		assert.ok(blocks.length > 0, doc);
		for (const m of blocks) {
			let example = m[1]!;
			if (example.startsWith("palette ")) {
				example = `vexyl 1\nmeta { name "T"; }\n${example}proportion hoist=1 fly=1\n`;
			} else if (!example.startsWith("vexyl ")) {
				example = header + example;
			}
			assert.deepEqual(validate(example, doc), [], example);
		}
	}
});

test("polygon offsets miter both windings", () => {
	const want = rectPoly(-1, -1, 11, 21);
	for (const poly of [rectPoly(0, 0, 10, 20), [v(0, 20), v(10, 20), v(10, 0), v(0, 0)]]) {
		const got = offsetPolygon(poly, 1);
		for (const w of want) {
			assert.ok(hasPoint(got, w));
		}
	}
});

test("polygon offsets refuse degenerate shapes", () => {
	for (const poly of [[v(0, 0), v(1, 1), v(2, 2)], [v(0, 0), v(1, 0), v(1, 0), v(0, 1)], [v(0, 0), v(2, 0), v(1, 0), v(1, 1)]]) {
		assert.throws(() => offsetPolygon(poly, 1));
	}
});

test("border sides", () => {
	const inside = render(header + "border b 1 inside\nfield a");
	contains(inside, `viewBox="0 0 20 10"`);
	contains(inside, `fill="none" stroke="#445566"`);
	const outside = render(header + "border b 1 outside\nfield a");
	contains(outside, `viewBox="-1 -1 22 12"`);
	contains(outside, `points="-1,-1 21,-1 21,11 -1,11" fill="#445566"`);
	contains(outside, `width="1100" height="600"`);
	for (const src of ["border b 1 sideways", "border b", "border b 1 outside 2"]) {
		assert.ok(validate(header + src).length > 0, src);
	}
	const bad = `vexyl 1\nmeta { name "T"; }\npalette { a "#112233"; }\nproportion hoist=10 fly=20\noutline { polygon { point fly=0 hoist=0; point fly=1 hoist=1; point fly=2 hoist=2; }; }\nborder a 1 outside`;
	assert.ok(validate(bad).some((p) => p.message.includes("no area")));
});

test("Nepal's constitution gives the known 1:1.219 once its border is added", () => {
	const f = parse(readRepo("flags/nepal.kdl"));
	assert.equal(f.hoist, 80);
	assert.equal(f.fly, 60);
	const [, , w, h] = bounds(offsetPolygon(boundary(f)!, f.border!.width));
	assert.ok(Math.abs(h / w - 1.219) <= 0.0005);
});

test("repeat line", () => {
	const out = render(header + "charge disc a { radius 1; at fly=2 hoist=3; repeat line count=3 fly=4 hoist=-1; }");
	for (const want of [`cx="2" cy="3"`, `cx="6" cy="2"`, `cx="10" cy="1"`]) {
		contains(out, want);
	}
});

test("an emblem's frame", () => {
	const bend = (Math.atan2(10, 20) * 180) / Math.PI;
	const tests = [
		["emblem { charge disc a { radius 1; }; }", "translate(10 5) rotate(0)"],
		["emblem { at fly=2 hoist=3; rotate 90; charge disc a { radius 1; }; }", "translate(2 3) rotate(90)"],
		["emblem { along bend; charge disc a { radius 1; }; }", `translate(10 5) rotate(${num(bend)})`],
		["emblem { along bend-sinister; charge disc a { radius 1; }; }", `translate(10 5) rotate(${num(-bend)})`],
		["emblem { along hoist; rotate 10; charge disc a { radius 1; }; }", "translate(10 5) rotate(100)"],
	] as const;
	for (const [src, want] of tests) {
		contains(render(header + src), want);
	}
	const out = render(header + "emblem { at fly=2 hoist=3; charge disc a { radius 1; }; charge disc b { radius 1; at center; }; }");
	assert.equal(out.split(`cx="0" cy="0"`).length - 1, 2);
	const reach = num(Math.hypot(20, 10));
	contains(render(header + "emblem { at fly=0 hoist=0; charge disc a { radius 1; cut { disc { radius 1; }; }; }; }"), `x="-${reach}" y="-${reach}"`);
});

test("a charge's cuts go with its copies", () => {
	const cut = "cut { disc { radius 0.5; at fly=2 hoist=3; }; }";
	const count = (out: string, text: string): number => out.split(text).length - 1;
	const tests: [string, string, number, string[]][] = [
		["line", `charge disc a { radius 1; at fly=2 hoist=3; repeat line count=3 fly=4; ${cut} }`, 3, [`transform="translate(4 0)"`, `transform="translate(8 0)"`]],
		["positions", `charge disc a { radius 1; at fly=2 hoist=3; at fly=5 hoist=1; ${cut} }`, 2, [`transform="translate(3 -2)"`]],
		["grid", `charge disc a { radius 1; repeat grid rows=1 columns=3; ${cut} }`, 3, [`transform="translate(5 0)"`, `transform="translate(10 0)"`]],
		["ring without turning", `charge disc a { radius 1; at fly=2 hoist=5; repeat ring count=2 radius=2; ${cut} }`, 2, [`transform="translate(0 4)"`]],
		[
			"ring turning",
			`charge disc a { radius 1; at fly=2 hoist=5; repeat ring count=4 radius=2 turn=#true; ${cut} }`,
			4,
			[`transform="translate(4 5) rotate(90) translate(-2 -3)"`, `transform="translate(2 7) rotate(180) translate(-2 -3)"`],
		],
		[
			"arc turning",
			`charge disc a { radius 1; at fly=4 hoist=3; repeat arc count=2 radius=2 from=-90 to=90 turn=#true; ${cut} }`,
			2,
			[`transform="translate(6 3) rotate(180) translate(-2 -3)"`],
		],
		["one copy", `charge disc a { radius 1; at fly=2 hoist=3; ${cut} }`, 1, []],
		["group", `group { ${cut}; charge disc a { radius 1; at fly=2 hoist=3; repeat line count=3 fly=4; }; }`, 1, []],
	];
	for (const [name, src, cuts, wants] of tests) {
		const out = render(header + src);
		assert.equal(count(out, `fill="#000"`), cuts, name);
		assert.equal(count(out, " transform="), Math.max(cuts - 1, 0), name);
		for (const want of wants) {
			contains(out, want);
		}
	}
	// The other clip is the flag's own.
	const out = render(header + "charge disc a { radius 1; repeat line count=3 fly=4; clip { disc { radius 0.5; }; }; }");
	assert.equal(count(out, "<clipPath "), 2);
	assert.ok(!out.includes(" transform="), out);
});

test("South Korea's construction", () => {
	const f = parse(readRepo("flags/south-korea.kdl"));
	const emblems = f.layers.filter((l): l is EmblemLayer => l.layer === "emblem");
	assert.equal(emblems.length, 2);
	assert.equal(emblems[0]!.along, "bend");
	assert.equal(emblems[1]!.along, "bend-sinister");
	for (const e of emblems) {
		for (const c of e.charges) {
			if (c.shape.kind === "rect") {
				assert.equal(c.shape.fly, f.hoist / 24);
				assert.equal(c.shape.hoist, f.hoist / 4);
			}
		}
	}
});

const newShapes: [string, string, string][] = [
	["panel on a side", `panel { side hoist; width 5; field a; }`, `translate(0 0)`],
	["panel on the far side", `panel { side fly; width 5; field a; }`, `translate(15 0)`],
	["panel in a corner", `panel { corner lower-fly; fly 4; hoist 2; field a; }`, `translate(16 8)`],
	["panel centered", `panel { fly 4; hoist 2; field a; }`, `translate(8 4)`],
	["canton", `canton { fly 4; hoist 2; field a; }`, `translate(0 0)`],
	["quarters", `quarters a b b a`, `points="10,5 20,5 20,10 10,10"`],
	["quarters split", `quarters a b b a { split fly=4 hoist=2; }`, `points="4,2 20,2 20,10 4,10"`],
	["quarters diagonal", `quarters a b b a { diagonal; }`, `points="10,5 0,0 20,0"`],
	["pile", `pile a { depth 5; flat 2; }`, `5,4 5,6`],
	["crescent", `charge crescent a { radius 5; inner 4; offset 2; at center; }`, `<path d="M`],
	["sun", `charge sun a { radius 3; disc 1; points 3; }`, `Z M`],
	["lozenge throughout", `charge lozenge a`, `points="10,0 20,5 10,10 0,5"`],
	["hollow", `charge disc a { radius 1; hollow 0.5; }`, `fill="none" stroke="#112233" stroke-width="0.5"`],
	["ellipse", `charge ellipse a { fly 4; hoist 2; at fly=5 hoist=5; }`, `d="M3 5A2 1 0 1 0 7 5A2 1 0 1 0 3 5Z"`],
	["turned ellipse", `charge ellipse a { fly 4; hoist 2; at fly=5 hoist=5; rotate 90; }`, `d="M5 3A2 1 90 1 0 5 7A2 1 90 1 0 5 3Z"`],
	["hollow ellipse", `charge ellipse a { fly 4; hoist 2; hollow 0.5; }`, `fill="none" stroke="#112233" stroke-width="0.5"`],
	["lines", `charge star a { radius 1; lines 0.1; }`, `fill="none"`],
	["path", `charge path a { d "M0 0H1V1Z"; box "0 0 1 1"; fly 2; }`, `scale(2) translate(-0.5 -0.5)`],
	["partial ring", `charge ring a { radius 2; inner 1; from 0; to 90; }`, `A2 2 0 0 1`],
	["arc", `charge disc a { radius 1; repeat arc count=3 radius=2 from=-90 to=90; }`, `cx="10" cy="3"`],
	["several positions", `charge disc a { radius 1; at fly=1 hoist=1; at fly=2 hoist=2; }`, `cx="2" cy="2"`],
	["counterchange", `saltire a { width 1; counterchange; }`, `clip-path`],
	["chevron fimbriation", `chevrons a { depth 5; fimbriate b 1; }`, `stroke="#445566"`],
];

for (const [name, src, want] of newShapes) {
	test(`draws: ${name}`, () => contains(render(header + src), want));
}

test("a sun's gap is optional", () => {
	const out = render(header + "charge sun a { radius 3; disc 1; points 3; }");
	assert.ok(!out.includes("NaN"), out);
});

test("an outside border around a curved outline is refused", () => {
	const src = `${header}outline { path "M0 0H1V1Z" box="0 0 1 1"; }\nborder a 1 outside\nfield a\nfold f { over along=hoist at=10 move=fly; }\n`;
	assert.ok(validate(src).length > 0);
});

test("checks flow along their diagonal", () => {
	const fills = [...render(header + "checks a b { rows 2; columns 2; }").matchAll(/fill="(#\w+)"/g)].map((m) => m[1]);
	assert.deepEqual(fills, ["#112233", "#445566", "#445566", "#112233"]);
});

test("rays by edge", () => {
	const f = parse(`vexyl 1\nmeta { name "T"; }\npalette { a "#112233"; }\nproportion hoist=3 fly=6\nrays a a a a a { from lower-hoist; measure edge; ratio 2 2 3 1 1; }`);
	const polys = rayPolys(f.layers[0] as RaysLayer, { w: 6, h: 3 });
	for (const want of [v(0, 3), v(4, 0), v(6, 0), v(6, 1)]) {
		assert.ok(hasPoint(polys[2]!, want), JSON.stringify(polys[2]));
	}
	assert.ok(hasPoint(polys[4]!, v(6, 3)));
});

test("rays by angle cover their sweep", () => {
	const polys = rayPolys(parse(header + "rays a b { count 4; from hoist; }").layers[0] as RaysLayer, r2010);
	assert.equal(polys.length, 4);
	assert.ok(hasPoint(polys[0]!, v(0, 5)) && hasPoint(polys[0]!, v(0, 0)));
});

test("a pall is one shape", () => {
	const points = pallPoints({ kind: "pall", rotate: 0, from: "hoist", width: 2, junction: 5 }, r2010);
	assert.equal(points.length, 9);
	assert.ok(points.some((p) => Math.abs(p.hoist - 5) < 1e-9 && p.fly > 0 && p.fly < 5));
});

test("a panel's edge is centered on its width", () => {
	contains(render(header + "panel { side hoist; width 5; edge zigzag depth=2 count=2; field a; }"), "0,0 4,0 6,2.5 4,5 6,7.5 4,10 0,10");
});

test("gaps show what's beneath", () => {
	assert.ok(!render(header + "bars a none b").includes(`0,0 20,0 20,10 0,10" fill`));
	assert.equal(render(header + "chevrons none a { depth 8; ratio 1 1; }").split("<polygon").length - 1, 2);
});

test("defines and uses", () => {
	const out = render(`vexyl 1
meta { name "T"; }
palette { a "#112233"; b "#445566"; }
proportion hoist=10 fly=20
define square { path "M0 0H1V1H0Z" box="0 0 1 1"; }
define mini hoist=1 fly=2 { field a; }
define loose { bars a b; }
charge square b { fly 2; hoist 2; repeat line count=2 fly=4; }
use mini
panel { side top; width 2; use loose; }
`);
	assert.equal(out.split(`d="M0 0H1V1H0Z"`).length - 1, 2);
	contains(out, "scale(10 10)");
});

test("outlines", () => {
	const tests = [
		["outline swallowtail { depth 5; }", "0,0 20,0 15,5 20,10 0,10"],
		["outline swallowtail { depth 5; taper 1; }", "0,0 20,1 15,5 20,9 0,10"],
		["outline tongued { depth 5; tongue 2; }", "0,0 20,0 15,4 20,5 15,6 20,10 0,10"],
		["outline pennant", "0,0 20,5 0,10"],
		["outline pennant { tip 2; }", "0,0 20,4 20,6 0,10"],
		[`outline { path "M0 0H1V1Z" box="0 0 1 1"; }`, "scale(20 10)"],
	] as const;
	const base = `vexyl 1\nmeta { name "T"; }\npalette { a "#112233"; }\nproportion hoist=10 fly=20\n`;
	for (const [outline, want] of tests) {
		contains(render(`${base}${outline}\nfield a\n`), want);
	}
});

const cross = "cross a { fly 5 2 13; hoist 4 2 4; }\n";
const adaptHeader = header;
const adaptRules: [string, string, number, string][] = [
	["extend keeps the arm's place", cross + `adapt { wider extend; }`, 3, `5,0 7,0 7,10 5,10`],
	["cut keeps the arm's place", cross + `adapt { narrower cut; }`, 1, `5,0 7,0 7,10 5,10`],
	["center moves the arm with the center", cross + `adapt { wider center; }`, 3, `10,0 12,0 12,10 10,10`],
	["scale keeps the arm's share", cross + `adapt { wider scale; }`, 3, `7.5,0 10.5,0 10.5,10 7.5,10`],
	["the hoist can change instead", cross + `adapt { narrower hoist-extend; }`, 1, `0,4 20,4 20,6 0,6`],
	["extend grows the last bar", "bars a b { along hoist; }\n" + `adapt { wider extend; }`, 3, `10,0 10,10 30,10 30,0`],
	["grow shares it out", "bars a b { along hoist; ratio 1 1; grow 1 0; }\n" + `adapt { wider extend; }`, 3, `20,0 20,10 30,10 30,0`],
	["bars along the axis are unchanged", "bars a b\n" + `adapt { wider extend; }`, 3, `0,5 30,5 30,10 0,10`],
	["a charge at the center follows it", "charge disc a { radius 1; }\n" + `adapt { wider extend; }`, 3, `cx="15" cy="5"`],
	["an ellipse's size scales", "charge ellipse a { fly 4; hoist 2; at fly=10 hoist=5; anchor scale; }\n" + `adapt { wider extend; }`, 3, `A3 1 0 1 0`],
	["an explicit position stays", "charge disc a { radius 1; at fly=4 hoist=5; }\n" + `adapt { wider extend; }`, 3, `cx="4" cy="5"`],
	["an anchor overrides the rule", "charge disc a { radius 1; at fly=18 hoist=5; anchor end; }\n" + `adapt { wider extend; }`, 3, `cx="28" cy="5"`],
	["center charges can be held to the hoist", "charge disc a { radius 1; anchor start; }\n" + `adapt { wider extend; }`, 3, `cx="10" cy="5"`],
	["a far side panel stays on its edge", "panel { side fly; width 2; field a; }\n" + `adapt { wider extend; }`, 3, `translate(28 0)`],
	["a top panel grows", "panel { side top; width 2; bars a b { along hoist; }; }\n" + `adapt { wider extend; }`, 3, `10,0 10,2 30,2 30,0`],
	["a canton keeps its size", "canton { fly 8; hoist 5; field a; }\n" + `adapt { wider extend; }`, 3, `0,0 8,0 8,5 0,5`],
	["scaling scales a canton", "canton { fly 8; hoist 5; field a; }\n" + `adapt { wider scale; }`, 3, `0,0 12,0 12,5 0,5`],
];

for (const [name, src, ratio, want] of adaptRules) {
	test(`adapts: ${name}`, () => contains(render(adaptHeader + src, { ratio }), want));
}

test("refusals when adapting", () => {
	const tests = [
		["field a", 3, "doesn't say how"],
		["adapt { wider extend; }", 1, "no rule for this direction"],
		["adapt { range 1 2.5; wider extend; }", 3, "only adapts between"],
		["cross a { fly 5 2 3; hoist 4 2 4; }\nadapt { narrower cut; }", 0.5, "can't be cut"],
	] as const;
	for (const [src, ratio, want] of tests) {
		assert.throws(() => render(header + src, { ratio }), (e: Error) => e instanceof RenderError && e.message.includes(want));
	}
	contains(render(header + "field a", { ratio: 2 }), `viewBox="0 0 20 10"`);
});

test("variants", () => {
	const src = readRepo("go/testdata/variants.kdl");
	const vertical = render(src, { variant: "vertical" });
	contains(vertical, `viewBox="0 0 20 40"`);
	contains(vertical, "matrix(0 1 1 0 0 0)");
	contains(vertical, "translate(20 10) matrix(0 1 1 0 0 0) translate(-20 -10)");
	const banner = render(src, { variant: "banner" });
	contains(banner, "matrix(0 1 -1 0 20 0)");
	contains(banner, "0,0 30,0 24,10 30,20 0,20");
	assert.ok(!render(src, { variant: "plain" }).includes("<path"));
	assert.throws(() => render(src, { variant: "nope" }), RenderError);
});

test("a variant's own proportion", () => {
	const src = header + "charge disc a { radius 2; at center; }\nvariant long { proportion hoist=5 fly=10; field b; charge disc a { radius 1; at center; }; }";
	const long = render(src, { variant: "long" });
	contains(long, `viewBox="0 0 10 5"`);
	contains(long, `cx="5" cy="2.5" r="1"`);
	assert.ok(!render(src).includes(`viewBox="0 0 10 5"`));
	const tests = [
		[header + "variant v { proportion hoist=5 fly=10; }", "needs its own layers"],
		[header + "variant v { proportion hoist=5 fly=10; ratio 2; field a; }", "both `proportion` and `ratio`"],
		[header + "variant v { proportion hoist=5; field a; }", "fly"],
		[header + "variant tall { ratio 3; }", "no `adapt` rules"],
	] as const;
	for (const [text, want] of tests) {
		assert.ok(validate(text).some((p) => p.message.includes(want)), text);
	}
	const variant = "variant v { proportion hoist=5 fly=10; field b; }";
	assert.equal(withoutIds(render(`${header}outline swallowtail { depth 2; }\nfield a\n${variant}`, { variant: "v" })), withoutIds(render(`${header}field a\n${variant}`, { variant: "v" })));
});

test("the reverse", () => {
	contains(render(header + "field a", { side: "reverse" }), "matrix(-1 0 0 1 20 0)");
	const own = render(header + "field a\nreverse {\n  field b\n}\n", { side: "reverse" });
	assert.ok(!own.includes("matrix"));
	contains(own, "#445566");
	assert.ok(!render(header + "field a\nreverse {\n  field b\n}\n").includes("#445566"));
});

test("forms of one flag have distinct IDs", () => {
	const src = header + "field a\nadapt { wider extend; }\n";
	const id = (opts: Options) => / id="([^"]+)"/.exec(render(src, opts))![1];
	assert.notEqual(id({}), id({ ratio: 3 }));
});

test("padding", () => {
	const src = header + "field a\n";
	const tests: [Options, string][] = [
		[{ ratio: 4, fit: "pad" }, `viewBox="-10 0 40 10"`],
		[{ ratio: 4, fit: "pad", align: "start" }, `viewBox="0 0 40 10"`],
		[{ ratio: 4, fit: "pad", align: "end" }, `viewBox="-20 0 40 10"`],
		[{ ratio: 1, fit: "pad" }, `viewBox="0 -5 20 20"`],
		[{ ratio: 1, fit: "pad", align: "start" }, `viewBox="0 0 20 20"`],
		[{ ratio: 1, fit: "pad", align: "end" }, `viewBox="0 -10 20 20"`],
	];
	for (const [opts, want] of tests) {
		contains(render(src, opts), want);
	}
	const nearest = render(header + "field a\nadapt { range 1 3; wider extend; }\n", { ratio: 4, fit: "pad", height: 100 });
	contains(nearest, `viewBox="-5 0 40 10"`);
	contains(nearest, `points="0,0 30,0 30,10 0,10"`);
	contains(nearest, `width="400" height="100"`);
	contains(render(header + "cross a { fly 5 2 3; hoist 4 2 4; }\nadapt { narrower cut; }\n", { ratio: 0.5, fit: "pad" }), `viewBox="0 -15 20 40"`);
	contains(render(header + "field a\nvariant v { from transpose; }\n", { variant: "v", ratio: 4, fit: "pad" }), `viewBox="0 -10 10 40"`);
});

test("unknown values are errors", () => {
	const f = parse(header + "field a\n");
	const bad: Options[] = [
		{ ratio: 4 },
		{ ratio: 4, fit: "squash" as "pad" },
		{ ratio: 4, fit: "pad", align: "up" as "start" },
		{ side: "front" as "obverse" },
		{ variant: "nope" },
		{ fold: "nope" },
		{ height: 0 },
		{ height: -1 },
		{ height: Infinity },
		{ ratio: 0 },
		{ ratio: -1 },
		{ ratio: NaN },
		{ foldStep: -1 },
		{ foldStep: 1.5 },
	];
	for (const opts of bad) {
		assert.throws(() => svg(f, opts), RenderError, JSON.stringify(opts));
	}
});

test("meta records", () => {
	const f = parse(`vexyl 1
meta {
  name "T"
  series "united-states"
  version "49-star"
  date "1959-07-04"
  until "1960-07-04"
  note "First"
  note "Second"
  law "A Flag Code" {
    source "https://example.test/a"
    source "https://example.test/b"
  }
  law "An Unsourced Act"
  restriction "Commercial use" {
    source "https://example.test/c"
  }
}
palette { a "#112233"; }
proportion hoist=1 fly=1`);
	assert.equal(f.meta.series, "united-states");
	assert.deepEqual(f.meta.notes, ["First", "Second"]);
	assert.equal(f.meta.laws.length, 2);
	assert.equal(f.meta.laws[0]!.sources.length, 2);
	assert.equal(f.meta.restrictions[0]!.sources[0], "https://example.test/c");
	assert.ok(!svg(f).includes("First"));
	for (const date of ["1960", "1960-07", "1960-07-04", "2024-02-29", "0000"]) {
		assert.deepEqual(validate(`vexyl 1\nmeta { name "T"; date "${date}"; }\npalette { a "#112233"; }\nproportion hoist=1 fly=1\n`), [], date);
	}
	for (const date of ["60", "19600", "1960-7", "1960-13", "1960-00", "1960-01-00", "1960-01-32", "2023-02-29", "1900-02-29", "1960/01", "1960-01-01T00:00", "٢٠٢٠"]) {
		assert.ok(validate(`vexyl 1\nmeta { name "T"; date "${date}"; }\n`).length > 0, date);
	}
});

test("adapted works", () => {
	const src = (meta: string) => `vexyl 1\nmeta {\n  name "T"\n${meta}\n}\npalette { a "#112233"; }\nproportion hoist=10 fly=20\nfield a\n`;
	const f = parse(src(`license "CC-BY-SA-4.0"
  render-license "CC0-1.0"
  adapted-from "https://example.org/a" {
    author "A"
    author "B"
    license "LicenseRef-Public-Domain"
    part "the emblem"
  }
  adapted-from "https://example.org/b"  { license "CC0-1.0"; }`));
	assert.equal(f.meta.renderLicense, "CC0-1.0");
	assert.deepEqual(f.meta.adaptedFrom[0], { url: "https://example.org/a", authors: ["A", "B"], license: "LicenseRef-Public-Domain", part: "the emblem" });
	const refused = [
		[`render-license "CC0-1.0"\n  adapted-from "https://example.org/a" { license "CC-BY-SA-4.0"; }`, "can't cover"],
		[`render-license "CC0-1.0"\n  adapted-from "https://example.org/a"`, "can't cover"],
		[`adapted-from { license "CC0-1.0"; }`, "needs the URL"],
		[`adapted-from "https://example.org/a" { nonsense "x"; }`, "nonsense"],
	] as const;
	for (const [meta, want] of refused) {
		assert.ok(validate(src(meta)).some((p) => (p.node + p.message).includes(want)), meta);
	}
	parse(src(`render-license "CC-BY-SA-4.0"\n  adapted-from "https://example.org/a" { license "CC-BY-SA-4.0"; }`));
});

test("color references are records", () => {
	const f = parse(`vexyl 1
meta { name "T"; }
palette {
  a "#112233" {
    pantone "301 C"
    ncs "4055-R95B"
    cmyk 100 50.5 0 10
    dye "One"
    dye "Two"
    reference "CIE xyY" "0.1 0.2 3"
  }
  b "#445566"
}
proportion hoist=1 fly=1
field a`);
	assert.deepEqual(f.colorRefs["a"], [
		{ system: "pantone", value: "301 C" },
		{ system: "ncs", value: "4055-R95B" },
		{ system: "cmyk", value: "100 50.5 0 10", numbers: [100, 50.5, 0, 10] },
		{ system: "dye", value: "One" },
		{ system: "dye", value: "Two" },
		{ system: "CIE xyY", value: "0.1 0.2 3", other: true },
	]);
	assert.equal(f.colorRefs["b"], undefined);
	assert.ok(!svg(f).includes("301 C"));
});

const foldHeader = `${header}field a\n`;
const facetsOf = (fold: string) => {
	const f = parse(foldHeader + fold);
	return foldFacets(foldShape(f), f.folds["f"]!, 0);
};

test("folding in half", () => {
	const stack = facetsOf("fold f { over along=hoist at=10 move=fly; }");
	assert.equal(stack.length, 2);
	assert.deepEqual(stack.map((s) => s.flipped), [false, true]);
	const [x, , w] = bounds([...stack[0]!.poly, ...stack[1]!.poly]);
	assert.equal(x, 0);
	assert.equal(w, 10);
	const m = stack[1]!.place;
	assert.ok(near({ x: m.a * 20 + m.e, y: m.b * 20 + m.f }, v(0, 0)));
});

test("fold directions", () => {
	assert.deepEqual(facetsOf("fold f { under along=hoist at=10 move=fly; }").map((s) => s.flipped), [true, false]);
	assert.deepEqual(facetsOf("fold f { tuck along=hoist at=10 move=fly; }").map((s) => s.flipped), [false]);
});

test("folding twice over reverses the moved layers", () => {
	assert.deepEqual(facetsOf("fold f { over along=hoist at=10 move=fly; over along=fly at=5 move=bottom; }").map((s) => s.flipped), [false, true, false, true]);
});

test("a diagonal fold", () => {
	const stack = facetsOf(`fold f { over through="20 0 10 10" move="20 10"; }`);
	assert.equal(stack.length, 2);
	const m = stack[1]!.place;
	assert.ok(near({ x: m.a * 20 + m.c * 10 + m.e, y: m.b * 20 + m.d * 10 + m.f }, v(10, 0)));
});

test("rendering a fold", () => {
	const out = render(foldHeader + "fold f { over along=hoist at=10 move=fly; }", { fold: "f" });
	contains(out, `viewBox="0 0 10 10"`);
	contains(out, `<use href="#`);
	contains(out, "matrix(-1 0 0 1 20 0)");
	contains(render(foldHeader + "fold f { over along=hoist at=10 move=fly; over along=fly at=5 move=top; }", { fold: "f", foldStep: 1 }), `viewBox="0 0 10 10"`);
	const own = render(foldHeader + "reverse {\n  field b\n}\nfold f { over along=hoist at=10 move=fly; }", { fold: "f" });
	contains(own, "#445566");
	assert.equal(own.split("<use").length - 1, 2);
});

test("refusing a fold", () => {
	const tests = [
		["fold f { over along=hoist at=30 move=fly; }", "nothing is on the side"],
		["fold f { over along=hoist at=30 move=hoist; }", "nothing is left"],
		[`fold f { over through="0 0 1 1" move="5 5"; }`, "on its crease"],
		["fold f { over along=hoist at=5 move=top; }", "moves hoist or fly"],
		[`fold f { over through="1 2" move="3 4"; }`, "4 finite"],
		["fold f { over move=top; }", "needs along"],
		[`fold f { description "x"; }`, "at least one step"],
		["fold f", "at least one step"],
		["fold f { }", "at least one step"],
	] as const;
	for (const [fold, want] of tests) {
		assert.ok(validate(foldHeader + fold).some((p) => p.message.includes(want)), fold);
	}
	const f = parse(`${foldHeader}variant v { from rotate; }\nfold f { over along=hoist at=10 move=fly; }`);
	assert.throws(() => svg(f, { fold: "nope" }), RenderError);
	assert.throws(() => svg(f, { fold: "f", variant: "v" }), RenderError);
});

test("the finished US fold is a blue triangle", () => {
	const f = parse(readRepo("flags/united-states.kdl"));
	const stack = foldFacets(foldShape(f), f.folds["triangle"]!, 0);
	const [, , w, h] = bounds(stack.flatMap((s) => s.poly));
	assert.ok(Math.abs(w - h) <= 1e-6);
	const top = stack.at(-1)!;
	const m = top.place;
	const det = m.a * m.d - m.b * m.c;
	for (const p of top.poly) {
		const q = v(p.x - m.e, p.y - m.f);
		assert.ok((m.d * q.x - m.c * q.y) / det <= 9.88 + 1e-6);
		assert.ok((m.a * q.y - m.b * q.x) / det <= 7 + 1e-6);
	}
});

test("deep nesting is refused", () => {
	const doc = (n: number) => header + "group {\n".repeat(n) + "field a\n" + "}\n".repeat(n);
	assert.ok(validate(doc(33)).some((p) => p.message.includes("nested")));
	assert.deepEqual(validate(doc(31)), []);
});

test("the tree writes out as the same drawing", () => {
	const f = parse(header + "field a");
	const tree = svgTree(f);
	assert.equal(tree.name, "svg");
	assert.ok(tree.children.length > 0);
	assert.ok(svg(f).startsWith("<svg"));
	const written = treeToSvg(tree);
	assert.ok(written.includes(`points="0,0 20,0 20,10 0,10"`));
	assert.equal(treeToSvg(svgTree(f)), written);
});

test("the model", () => {
	const m = model(parse(header + "bars a b { along hoist; }")) as { layers: { layer: string; along: string }[]; proportion: { fly: number }; outline?: unknown };
	assert.equal(m.layers[0]!.layer, "bars");
	assert.equal(m.layers[0]!.along, "hoist");
	assert.equal(m.proportion.fly, 20);
	assert.ok(!("outline" in m));
	// Numbers stay numbers, and a zero that means something stays.
	const cmyk = model(parse('vexyl 1\nmeta { name "T"; }\npalette { a "#112233" { cmyk 100 0.0000001 0 40; }; }\nproportion hoist=1 fly=1\n')) as { palette: { a: { cmyk: number[] } } };
	assert.deepEqual(cmyk.palette.a.cmyk, [100, 0.0000001, 0, 40]);
});

function deepFreeze(value: unknown): void {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const key of Object.keys(value)) {
			deepFreeze((value as Record<string, unknown>)[key]);
		}
	}
}

test("rendering doesn't change a flag", () => {
	for (const name of ["flags/united-states.kdl", "flags/nepal.kdl", "go/testdata/variants.kdl", "go/testdata/vocabulary.kdl", "go/testdata/effects.kdl"]) {
		const f = parse(readRepo(name));
		const before = JSON.stringify(model(f));
		const copy = JSON.stringify(f);
		// Any write to a frozen object throws, so this finds what a comparison couldn't.
		deepFreeze(f);
		svg(f);
		svg(f, { side: "reverse" });
		svg(f, { ratio: 1, fit: "pad" });
		for (const variant of Object.keys(f.variants)) {
			svg(f, { variant });
		}
		for (const fold of Object.keys(f.folds)) {
			svg(f, { fold });
		}
		assert.equal(JSON.stringify(model(f)), before, name);
		assert.equal(JSON.stringify(f), copy, name);
	}
});

test("rendering is repeatable", () => {
	const f = parse(readRepo("flags/united-states.kdl"));
	assert.equal(svg(f), svg(f));
	assert.equal(svg(f), svg(parse(readRepo("flags/united-states.kdl"))));
});

test("clipping a shape entirely outside gives nothing", () => {
	assert.deepEqual(clipConvex(rectPoly(30, 30, 40, 40), r2010), []);
});

test("the library stays free of Node's modules, so that browsers can run it", () => {
	const dist = join(root, "ts/dist");
	for (const name of readdirSync(dist).filter((f) => f.endsWith(".js") && f !== "cli.js")) {
		const text = readFileSync(join(dist, name), "utf8");
		const imports = [...text.matchAll(/(?:^|\s)(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g), ...text.matchAll(/import\(["']([^"']+)["']\)/g)].map((m) => m[1]!);
		for (const target of imports) {
			assert.ok(target.startsWith("./") || target === "@bgotink/kdl" || target === "fflate", `${name} imports ${target}`);
		}
		for (const global of ["process.", "Buffer.", "require(", "__dirname", "crypto."]) {
			assert.ok(!text.includes(global), `${name} uses ${global}`);
		}
	}
});

test("defined shapes keep their values, and what was worked out follows a charge's changes", () => {
	const f = parse(header + `define hex { star { radius 2; points 6; }; }
define ray { sun { radius 4; disc 1; points 8; spread 0.5; }; }
define lobe { heart { radius 2; }; }
charge hex a
charge hex a { radius 4; }
charge hex a { points 7; }
charge ray a
charge lobe a { radius 4; }
`);
	const shape = (i: number): any => (f.layers[i] as ChargeLayer).shape;
	const inner = (radius: number, n: number): number => radius * Math.cos((2 * Math.PI) / n) / Math.cos(Math.PI / n);
	assert.equal(shape(0).points, 6);
	assert.ok(Math.abs(shape(0).inner - inner(2, 6)) < 1e-12);
	assert.ok(Math.abs(shape(1).inner - inner(4, 6)) < 1e-12);
	assert.ok(Math.abs(shape(2).inner - inner(2, 7)) < 1e-12);
	assert.equal(shape(3).points, 8);
	assert.equal(shape(3).spread, 0.5);
	assert.ok(Math.abs(shape(4).spread - 4 * Math.SQRT2) < 1e-12);
	const given = parse(header + "define s { star { radius 2; inner 1; }; }\ncharge s a { radius 4; }\n");
	assert.equal(((given.layers[0] as ChargeLayer).shape as any).inner, 1);
});

test("a variant's own layers mirror on the reverse", () => {
	const f = parse(header + `field a
reverse { field b; }
variant own { field a; charge disc b { radius 1; }; }
variant same { from none; }
`);
	assert.ok(svg(f, { variant: "own", side: "reverse" }).includes("matrix(-1 0 0 1 20 0)"));
	assert.ok(!svg(f, { variant: "own" }).includes("matrix(-1"));
	const same = svg(f, { variant: "same", side: "reverse" });
	assert.ok(!same.includes("matrix(-1") && same.includes("#445566"));
});

test("gradients span their own cell", () => {
	const src = 'vexyl 1\nmeta { name "T"; }\npalette { a "#112233"; b "#445566"; g gradient a b; }\nproportion hoist=10 fly=20\n';
	const checks = svg(parse(src + "checks g b { rows 2; columns 2; }"));
	assert.ok(checks.includes('points="0,0 10,0 10,5 0,5"'), checks);
	assert.ok(checks.includes('points="10,0 20,0 20,10 10,10"'), checks);
	const quarters = svg(parse(src + "quarters g b b g"));
	assert.ok(quarters.includes('points="0,0 10,0 10,5 0,5"'), quarters);
	assert.ok(quarters.includes('points="10,5 20,5 20,10 10,10"'), quarters);
});

test("option combinations are defined or refused", () => {
	const f = parse(header + `field a
adapt { wider extend; narrower extend; }
variant v { ratio 3; }
variant w { from none; }
variant t { from rotate; }
fold f { over along=hoist at=10 move=fly; under along=fly at=5 move=top; }
`);
	const refused: Options[] = [
		{ height: 0 }, { height: -1 }, { height: Infinity }, { height: NaN },
		{ ratio: 0 }, { ratio: -1 }, { ratio: Infinity }, { ratio: NaN },
		{ ratio: 1, fit: "stretch" as "pad" }, { ratio: 1, fit: "pad", align: "left" as "start" },
		{ side: "front" as "obverse" }, { variant: "nope" }, { fold: "nope" },
		{ fit: "pad" }, { fit: "error" }, { variant: "w", fit: "pad" },
		{ ratio: 1, align: "start" }, { ratio: 1, fit: "error", align: "center" },
		{ fold: "f", side: "reverse" }, { fold: "f", ratio: 1, fit: "pad" }, { fold: "f", variant: "t" },
		{ foldStep: 1 }, { fold: "f", foldStep: 0 }, { fold: "f", foldStep: -1 }, { fold: "f", foldStep: 3 }, { fold: "f", foldStep: 1.5 },
	];
	for (const opts of refused) {
		assert.throws(() => svg(f, opts), RenderError, JSON.stringify(opts));
	}
	const allowed: Options[] = [
		{ height: 100 }, { variant: "v", fit: "pad" }, { ratio: 1, fit: "error" }, { ratio: 1, fit: "pad", align: "end" },
		{ fold: "f", side: "obverse" }, { fold: "f", foldStep: 1 }, { fold: "f", foldStep: 2 }, { fold: "f", ratio: 2 },
	];
	for (const opts of allowed) {
		svg(f, opts);
	}
});

test("nothing non-finite reaches output", () => {
	for (const body of [
		`charge path a { d "M0 0H1V1Z"; box "0 0 1e-12 1e-12"; fly 1e12; }`,
		`define d hoist=1e-12 fly=1e-12 { field a; }\nuse d\n`,
		"bars a b { rotate 1e12; ratio 1e12 1e-12; }",
		"chevrons a b { depth 1e12; angle 1e-12; rotate 1e12; }",
		"charge star a { radius 1e12; points 5; rotate 1e12; at fly=1e12 hoist=-1e12; }",
		"charge ring a { radius 2; inner 1; from 1e12; to -1e12; }",
	]) {
		assert.ok(!/NaN|Inf/.test(svg(parse(header + body))), body);
	}
});

test("a shaped edge in a larger region is refused when it's drawn", () => {
	const f = parse(header + "bars a b { edge wavy depth=1 period=0.002; }\nadapt { wider extend; }\n");
	svg(f);
	assert.throws(() => svg(f, { ratio: 100 }), /waves/);
});

test("a problem's line doesn't depend on how lines end", () => {
	const doc = 'vexyl 1\nmeta { name "T"; }\npalette { a "#112233"; }\nproportion hoist=1 fly=1\nfield nope\n';
	for (const end of ["\r\n", "\r"]) {
		assert.equal(validate(doc.replaceAll("\n", end))[0]!.line, 5);
	}
	const note = (end: string) => parse(`vexyl 1${end}meta {${end}name "T"${end}note """${end}  a${end}  b${end}  """${end}}${end}palette { a "#112233"; }${end}proportion hoist=1 fly=1${end}`).meta.notes[0];
	assert.equal(note("\r\n"), "a\nb");
	assert.equal(note("\r"), "a\nb");
});

test("path data follows SVG's grammar", () => {
	for (const d of ["M0 0", "m1,2", " M 0 0 L 1 1 ", "M0 0 1 1 2 2z", "M0 0H1V1Z", "M0 0h1v1z M1 1", "M0-1.5.5.5", "M0 0C1 2 3 4 5 6 7 8 9 10 11 12", "M0 0S1 2 3 4Q1 2 3 4T1 2", "M0 0A1 1 0 0 1 2 2", "M0 0a1 1 0 012 2", "M1e2 -1E-2", "M0 0Zm1 1l1 1"]) {
		assert.ok(validPath(d), d);
	}
	for (const d of ["", " ", "Z", "L0 0", "M", "M0", "M0 0 1", "M0 0L", "M0 0H", "eee", "M0 0X1", "M0,,0", "M0 0,", "M0 0,L1 1", "M0 0Z1", "M0 0A1 1 0 2 0 1 1", "M.", "M1e 0", "M+ 1", "M0x1 0", "M1_0 0", "M1\u00a00"]) {
		assert.ok(!validPath(d), d);
	}
});

test("a problem's place counts code points, and only LF ends a line", () => {
	const at = (body: string) => validate(header + body)[0]!;
	assert.deepEqual([at("/* 𝒳é */ field nope\n").line, at("/* 𝒳é */ field nope\n").column], [5, 10]);
	assert.deepEqual([at("/*\u0085\u2028*/ field nope\n").line, at("/*\u0085\u2028*/ field nope\n").column], [5, 8]);
});

test("an ID prefix starts every ID", () => {
	const f = parse(header + "field a { clip { disc { radius 1; }; }; }\ncharge svg { fly 1; hoist 1; markup \"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'><rect id='r'/></svg>\"; }\n");
	const ids = [...svg(f, { idPrefix: "mine-", side: "reverse" }).matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!);
	assert.ok(ids.length >= 3);
	assert.ok(ids.every((id) => id.startsWith("mine-")), `${ids}`);
	for (const bad of ["1a", "a b", 'a"', "a<", ""]) {
		assert.throws(() => svg(f, { idPrefix: bad }), RenderError, bad);
	}
});

test("a tree keeps the title and description", () => {
	const f = parse('vexyl 1\nmeta { name "A & B"; description "<C>"; }\npalette { a "#112233"; }\nproportion hoist=1 fly=1\nfield a\n');
	const root = svgTree(f);
	assert.equal(root.children[0]!.name, "title");
	assert.equal(root.children[0]!.text, "A & B");
	assert.equal(root.children[1]!.text, "<C>");
	const written = treeToSvg(root);
	assert.ok(written.includes("<title>A &amp; B</title>") && written.includes("<desc>&lt;C&gt;</desc>"), written);
});

test("an end date compares only as far as both dates go", () => {
	const doc = (date: string, until: string) => `vexyl 1\nmeta { name "T"; date "${date}"; until "${until}"; }\npalette { a "#112233"; }\nproportion hoist=1 fly=1\n`;
	assert.deepEqual(validate(doc("2000-06", "2000")), []);
	assert.ok(validate(doc("2000-06", "1999")).length > 0);
	assert.ok(validate(doc("2000-06-15", "2000-05")).length > 0);
});

test("a rotated bars or band keeps its widths at another proportion, and its center moves as a position does", async () => {
	const { withRatio } = await import("../src/adapt.js");
	const { placeIn } = await import("../src/geometry.js");
	const f = parse(header + "bars a b a { ratio 1 2 1; rotate 20; }\nband b { along hoist; width 2; offset 3; rotate 20; }\nadapt { wider extend; narrower scale; }\n");
	const middleBar = (g: typeof f): number => {
		const b = g.layers[0] as BarsLayer;
		const r = { w: g.fly, h: g.hoist };
		const { frame, center } = placeIn(b.fixed, r);
		const { normal } = axis(frame, b.along, b.rotate);
		const offsets = [v(0, 0), v(r.w, 0), v(r.w, r.h), v(0, r.h)].map((p) => dot(sub(p, center), normal));
		const total = b.ratio.reduce((s, x) => s + x, 0);
		return ((Math.max(...offsets) - Math.min(...offsets)) * b.ratio[1]!) / total;
	};
	const bandMiddle = (g: typeof f): Vec => {
		const b = g.layers[1] as BandLayer;
		const poly = bandPoly({ w: g.fly, h: g.hoist }, b.along, b.rotate, b.width, b.offset, true, b.fixed);
		return v((poly[0]!.x + poly[2]!.x) / 2, (poly[0]!.y + poly[2]!.y) / 2);
	};
	const wider = withRatio(f, 3);
	const narrower = withRatio(f, 1);
	for (const g of [wider, narrower]) {
		assert.ok(Math.abs(middleBar(g) - middleBar(f)) < 1e-9);
		assert.equal((g.layers[1] as BandLayer).width, 2);
	}
	assert.ok(near(bandMiddle(wider), bandMiddle(f)), "under extend, it stays put");
	const before = bandMiddle(f);
	assert.ok(near(bandMiddle(narrower), v(before.x / 2, before.y)), "under scale, it moves as a position does");
});
