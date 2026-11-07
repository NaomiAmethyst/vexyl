// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const { isExpired } = await load("drafts");
const day = 24 * 60 * 60 * 1000;

test("an unsaved draft is kept for 30 days", () => {
	const now = 100 * day;
	assert.equal(isExpired({ updated: now }, now), false);
	assert.equal(isExpired({ updated: now - 30 * day }, now), false);
	assert.equal(isExpired({ updated: now - 30 * day - 1 }, now), true);
});
