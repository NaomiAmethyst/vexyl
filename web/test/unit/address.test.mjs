// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const a = await load("address");

test("references read and write as the address has them", () => {
	for (const text of ["github:NaomiAmethyst/vexyl-flags/flags/country/japan.kdl", "github:me/r@dev/a/b.kdl", "gist:0123456789abcdef", "gist:0123456789abcdef/my-flag.kdl", "url:https://example.org/a.kdl"]) {
		assert.equal(a.refText(a.parseRef(text)), text);
	}
});

test("bad references are refused", () => {
	for (const text of ["", "nothing", "github:only/two", "github:a/b/../secret", "github:a/b/./c", "github:a/b//c", "github:../b/c.kdl", "gist:xyz", "gist:0123456789abcdef/a/b", "url:http://example.org/a.kdl", "url:javascript:alert(1)", "url:https://me:pw@example.org/a.kdl", "url:file:///etc/passwd", "ftp:a/b/c", "github:a b/c/d"]) {
		assert.equal(a.parseRef(text), null, text);
	}
});

test("GitHub's page links become files", () => {
	assert.deepEqual(a.refFromLink("https://github.com/NaomiAmethyst/vexyl-flags/blob/main/flags/country/japan.kdl"), { kind: "github", owner: "NaomiAmethyst", repo: "vexyl-flags", branch: "main", path: "flags/country/japan.kdl" });
	assert.deepEqual(a.refFromLink("https://github.com/me/r/raw/dev/a.kdl"), { kind: "github", owner: "me", repo: "r", branch: "dev", path: "a.kdl" });
	assert.deepEqual(a.refFromLink("https://raw.githubusercontent.com/me/r/refs/heads/dev/a/b.kdl"), { kind: "github", owner: "me", repo: "r", branch: "dev", path: "a/b.kdl" });
	assert.deepEqual(a.refFromLink("https://raw.githubusercontent.com/me/r/dev/a/b.kdl"), { kind: "github", owner: "me", repo: "r", branch: "dev", path: "a/b.kdl" });
	assert.equal(a.rawUrl(a.parseRef("github:me/r@dev/a b.kdl")), "https://raw.githubusercontent.com/me/r/dev/a%20b.kdl");
});

test("a gist's links and IDs are all read", () => {
	assert.deepEqual(a.refFromLink("https://gist.github.com/someone/0123456789abcdef"), { kind: "gist", id: "0123456789abcdef" });
	assert.deepEqual(a.gistRef("0123456789abcdef"), { kind: "gist", id: "0123456789abcdef" });
	assert.equal(a.gistRef("not one"), null);
});

test("anything else needs to be https", () => {
	assert.ok("problem" in a.refFromLink("http://example.org/a.kdl"));
	assert.ok("problem" in a.refFromLink("nonsense"));
	assert.ok("problem" in a.refFromLink("https://me:pw@example.org/a.kdl"));
	assert.deepEqual(a.refFromLink("https://example.org/a.kdl"), { kind: "url", url: "https://example.org/a.kdl" });
});

test("a link from a file is only followed if it's to the web", () => {
	assert.equal(a.linkable("javascript:alert(1)"), null);
	assert.equal(a.linkable("data:text/html,x"), null);
	assert.equal(a.linkable("https://example.org/"), "https://example.org/");
});

test("the address says what's open", () => {
	const got = a.readAddress("?open=github:me/r/a.kdl&view=compare&with=gist:0123456789abcdef", "");
	assert.equal(got.view, "compare");
	assert.equal(got.ref.path, "a.kdl");
	assert.equal(got.with.id, "0123456789abcdef");
	assert.equal(a.readAddress("?view=nonsense", "").view, "work");
	assert.equal(a.readAddress("?open=nonsense", "").badRef, "nonsense");
	assert.equal(a.readAddress("", "#v1.abc").link, "v1.abc");
	assert.equal(a.openHref(a.parseRef("github:me/r/a b.kdl")), "?open=github:me/r/a%20b.kdl");
});
