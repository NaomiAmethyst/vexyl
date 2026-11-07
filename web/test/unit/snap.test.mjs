// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const s = await load("snap");

test("the middle comes first, within 2.5%", () => {
	assert.deepEqual(s.snap(0.49), { v: 0.5, kind: "middle", fraction: [1, 2] });
	assert.equal(s.snap(0.524).kind, "middle");
	assert.notEqual(s.snap(0.526).kind, "middle");
	// Even with an edge closer than the middle is, the middle wins.
	assert.equal(s.snap(0.49, [0.488]).kind, "middle");
});

test("then the edges of other things, within 1.8%, and the nearest of them", () => {
	assert.deepEqual(s.snap(0.715, [0.7, 0.72]), { v: 0.72, kind: "edge" });
	assert.deepEqual(s.snap(0.705, [0.7, 0.72]), { v: 0.7, kind: "edge" });
	assert.equal(s.snap(0.7185, [0.7]).kind, "free");
});

test("then simple fractions, within 1.2%", () => {
	for (const [v, n, d] of [[0.34, 1, 3], [0.26, 1, 4], [0.597, 3, 5], [0.84, 5, 6], [0.123, 1, 8], [0.405, 2, 5], [0.92, 11, 12], [0.095, 1, 10]]) {
		assert.deepEqual(s.snap(v).fraction, [n, d], String(v));
	}
	assert.equal(s.snap(0.355).kind, "free", "between fractions it stays where it is");
	assert.equal(s.snap(0.005).kind, "free", "a fraction doesn't reach as far as nothing at all");
});

test("only the listed denominators are snapped to", () => {
	assert.deepEqual([...new Set(s.fractions.map((f) => f.d))].sort((a, b) => a - b), [2, 3, 4, 5, 6, 8, 10, 12]);
	assert.ok(s.fractions.every((f) => f.n < f.d));
	assert.equal(s.fractions.length, new Set(s.fractions.map((f) => f.v)).size, "each only once, in lowest terms");
});

test("Alt places things freely", () => {
	assert.deepEqual(s.snap(0.5, [0.5], true), { v: 0.5, kind: "free" });
	assert.deepEqual(s.snap(0.337, [], true), { v: 0.337, kind: "free" });
});

test("values go on the grid exactly, so that 1/3 of 60 is 20", () => {
	assert.equal(s.onGrid(s.snap(0.33), "60"), "20");
	assert.equal(s.onGrid(s.snap(0.33), "90"), "30");
	assert.equal(s.onGrid(s.exactly(1, 8), "60"), "7.5");
	assert.equal(s.onGrid(s.exactly(1, 3), "2"), "0.666667");
	assert.equal(s.onGrid(s.exactly(1, 2), "1e3"), "500");
	assert.equal(s.onGrid({ v: 20 / 60, kind: "edge" }, "60"), "20", "floating point doesn't show");
	assert.equal(s.onGrid({ v: 0.3372, kind: "free" }, "60"), "20.23");
	assert.equal(s.onGrid({ v: 0.3372, kind: "free" }, "2"), "0.6744", "a small grid still places things finely");
});

test("complement measures from the other side", () => {
	assert.deepEqual(s.complement(s.exactly(1, 3)).fraction, [2, 3]);
	assert.equal(s.complement({ v: 0.3, kind: "free" }).v, 0.7);
});

test("the size box reads fractions, percentages and shares", () => {
	assert.deepEqual(s.readAmount("1/3").fraction, [1, 3]);
	assert.deepEqual(s.readAmount(" 3 / 8 ").fraction, [3, 8]);
	assert.deepEqual(s.readAmount("1/7").fraction, [1, 7], "any fraction can be typed");
	assert.equal(s.onGrid(s.readAmount("1/7"), "60"), "8.571429");
	assert.deepEqual(s.readAmount("25%").fraction, [1, 4]);
	assert.equal(s.readAmount("37%").kind, "free");
	assert.ok(Math.abs(s.readAmount("37%").v - 0.37) < 1e-9);
	assert.deepEqual(s.readAmount("0.5").fraction, [1, 2]);
	assert.deepEqual(s.readAmount(".25").fraction, [1, 4]);
	assert.deepEqual(s.readAmount("25").fraction, [1, 4], "above 1, a plain number is a percentage");
	assert.equal(s.readAmount("1").v, 1);
	for (const bad of ["", "a", "1/0", "1/", "/3", "-1/3", "1/3/4"]) {
		assert.equal(s.readAmount(bad), null, bad);
	}
});

test("a share is said as plainly as it can be", () => {
	assert.equal(s.shareText(1 / 3), "1/3");
	assert.equal(s.shareText(0.5), "1/2");
	assert.equal(s.shareText(0), "0");
	assert.equal(s.shareText(1), "all");
	assert.equal(s.shareText(0.37), "37%");
});

test("turning is offered only as far as it makes a difference", () => {
	assert.equal(s.turnPeriod("star", 5), 72);
	assert.equal(s.turnPeriod("star", 6), 60);
	assert.equal(s.turnPeriod("sun", 12), 30);
	assert.equal(s.turnPeriod("disc", null), null);
	assert.equal(s.turnPeriod("ring", null), null);
	assert.equal(s.turnPeriod("ring", null, true), 360);
	assert.equal(s.turnPeriod("rect", null), 180);
	assert.equal(s.turnPeriod("plus", null), 90);
	assert.deepEqual(s.turnsFor(72, 5).map((t) => t.label), ["Upright", "1/12 turn", "1/10 turn, point down", "1/8 turn", "1/6 turn"]);
	assert.equal(s.turnsFor(72, 5).find((t) => t.label.endsWith("point down")).deg, 36);
	assert.deepEqual(s.turnsFor(120, 3).map((t) => t.label), ["Upright", "1/12 turn", "1/8 turn", "1/6 turn, point down", "1/4 turn"]);
	assert.deepEqual(s.turnsFor(90, null).map((t) => t.label), ["Upright", "1/12 turn", "1/8 turn", "1/6 turn"]);
});

test("the turn box takes a fraction or degrees, and says both", () => {
	assert.equal(s.readTurn("1/8"), 45);
	assert.equal(s.readTurn("45"), 45);
	assert.equal(s.readTurn("45°"), 45);
	assert.equal(s.readTurn("22.5 degrees"), 22.5);
	assert.equal(s.readTurn("1/4 turn"), 90);
	assert.equal(s.readTurn("-10"), -10);
	assert.equal(s.readTurn("a"), null);
	assert.equal(s.turnText(45), "1/8 turn (45°)");
	assert.equal(s.turnText(0), "Upright");
	assert.equal(s.turnText(36), "1/10 turn (36°)");
	assert.equal(s.turnText(405), "1/8 turn (45°)");
	assert.equal(s.turnText(33.3), "0.0925 of a turn (33.3°)");
	assert.equal(s.turnFraction(45), "1/8");
});
