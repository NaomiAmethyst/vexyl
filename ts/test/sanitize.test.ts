// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Inline SVG is a security boundary. The suite's tables are checked here as well as by the suite,
// and these go further, because a tokenizer written for this library has to be right about
// everything an XML parser can be fooled by.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parse, svg, svgTree, treeToSvg, validate, type ChargeLayer, type SvgShape } from "../src/index.js";
import { idMark, maxSvgDepth, SanitizeError, sanitizeSvg, usesCurrentColor } from "../src/sanitize.js";
import { XmlDecoder, XmlError } from "../src/xml.js";
import { header, readRepo, root } from "./helpers.js";

const ns = "http://www.w3.org/2000/svg";
const svgOpen = `<svg xmlns="${ns}" viewBox="0 0 10 10">`;
const accepted = (markup: string) => {
	const e = sanitizeSvg(markup);
	return { ...e, attrs: e.attrs.replaceAll(idMark, "p-"), body: e.body.replaceAll(idMark, "p-") };
};
const refused = (markup: string): void => {
	assert.throws(() => accepted(markup), SanitizeError, `accepted: ${markup}`);
};

const rejectedBodies: [string, string][] = [
	["script", `<script>alert(1)</script>`],
	["foreignObject", `<foreignObject><div/></foreignObject>`],
	["image", `<image href="https://example.test/x.png"/>`],
	["anchor", `<a href="javascript:alert(1)"><rect/></a>`],
	["style element", `<style>@import "https://example.test/x.css";</style>`],
	["animate", `<animate attributeName="fill"/>`],
	["set", `<set attributeName="onmouseover" to="alert(1)"/>`],
	["use", `<use href="#x"/>`],
	["pattern", `<pattern id="p"/>`],
	["filter", `<filter id="f"/>`],
	["text", `<text>hello</text>`],
	["bare text", `hello`],
	["nested svg", `<svg/>`],
	["uppercase script", `<SCRIPT/>`],
	["event handler", `<rect onclick="alert(1)"/>`],
	["external href", `<linearGradient href="https://example.test/g.svg#a"/>`],
	["xlink external", `<linearGradient xmlns:x="http://www.w3.org/1999/xlink" x:href="https://example.test/g.svg#a"/>`],
	["javascript href", `<linearGradient href="javascript:alert(1)"/>`],
	["external fill", `<rect fill="url(https://example.test/x.svg#a)"/>`],
	["uppercase url", `<rect fill="URL(https://example.test/x.svg#a)"/>`],
	["data url", `<rect fill="url(data:image/svg+xml,x)"/>`],
	["mixed urls", `<rect fill="url(#ok) url(https://example.test/a)"/>`],
	["external style", `<rect style="fill:url(https://example.test/x)"/>`],
	["style escape", String.raw`<rect style="fill:\75rl(https://example.test/x)"/>`],
	["style import", `<rect style="@import 'https://example.test/x'"/>`],
	["style behavior", `<rect style="behavior:url(x.htc)"/>`],
	["style comment", `<rect style="fill:u/**/rl(https://example.test/x)"/>`],
	["bad id", `<rect id="a b"/>`],
	["css src function", `<rect fill="src('https://example.test/x')"/>`],
	["css image function", `<rect style="fill:image('https://example.test/x')"/>`],
];

for (const [name, body] of rejectedBodies) {
	test(`sanitizer refuses: ${name}`, () => refused(svgOpen + body + "</svg>"));
}

const rejectedRoots: [string, string][] = [
	["empty", ``],
	["not svg", `<html xmlns="http://www.w3.org/1999/xhtml"/>`],
	["no namespace", `<svg viewBox="0 0 1 1"/>`],
	["no size", `<svg xmlns="http://www.w3.org/2000/svg"/>`],
	["percent size", `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"/>`],
	["empty viewBox", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0"/>`],
	["handler on root", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" onload="alert(1)"/>`],
	["two roots", svgOpen + `</svg>` + svgOpen + `</svg>`],
	["doctype", `<!DOCTYPE svg [<!ENTITY x "y">]>` + svgOpen + `</svg>`],
	["malformed", svgOpen + `<rect>`],
	["too deep", svgOpen + "<g>".repeat(maxSvgDepth + 1) + "</g>".repeat(maxSvgDepth + 1) + `</svg>`],
];

for (const [name, markup] of rejectedRoots) {
	test(`sanitizer refuses a root: ${name}`, () => refused(markup));
}

test("sanitizer keeps artwork and prefixes IDs", () => {
	const out = accepted(`<?xml version="1.0"?>
<!-- a comment -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     xmlns:i="http://example.test/editor" width="20px" height="10" fill="#123456" i:zoom="2">
  <title>gone</title>
  <metadata><i:thing>gone</i:thing></metadata>
  <i:panel><script>gone</script></i:panel>
  <defs><linearGradient id="g" xlink:href="#h"/></defs>
  <circle fill="rgb(1, 2, 3)" stroke="hsla(1, 2%, 3%, 0.5)" transform="translate(1 2) rotate(3)"/>
  <rect id="r" fill="url(#g)" style="stroke: url('#g'); opacity: 0.5" clip-path="url(#c)" i:label="gone"/>
</svg>`);
	assert.equal(out.viewBox, "0 0 20 10");
	assert.equal(out.attrs, ` fill="#123456"`);
	for (const want of [
		`id="p-g"`, `href="#p-h"`, `id="p-r"`, `fill="url(#p-g)"`,
		`style="stroke:url(#p-g);opacity:0.5"`, `clip-path="url(#p-c)"`,
		`fill="rgb(1, 2, 3)"`, `transform="translate(1 2) rotate(3)"`,
	]) {
		assert.ok(out.body.includes(want), `${out.body} lacks ${want}`);
	}
	assert.ok(!out.body.includes("gone"));
});

test("an embedded file can't refer to the renderer's IDs or another embed's", () => {
	const out = svg(parse(readRepo("go/testdata/inline-svg.kdl")));
	const ids = [...out.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!);
	assert.equal(new Set(ids).size, ids.length);
	assert.equal(ids.filter((id) => id.endsWith("-shade")).length, 2, `${ids}`);
});

test("several flags in one page don't share definitions", () => {
	const ids = (color: string) => [...svg(parse(header + `field ${color} { clip { disc { radius 1; }; }; }`)).matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
	const a = ids("a");
	const b = ids("b");
	assert.ok(a.length > 0);
	assert.equal(a.length, b.length);
	a.forEach((id, i) => assert.notEqual(id, b[i]));
});

test("inline SVG needing a palette color says so", () => {
	const art = (fill: string) => `charge svg { fly 1; hoist 1; markup "<svg xmlns='${ns}' viewBox='0 0 1 1'><rect fill='${fill}'/></svg>"; }`;
	assert.ok(validate(header + art("currentColor")).length > 0);
	assert.ok(validate(header + art("CURRENTCOLOR")).length > 0);
	assert.deepEqual(validate(header + art("red")), []);
	assert.ok(usesCurrentColor(accepted(`${svgOpen}<rect fill="currentcolor"/></svg>`)));
	// A comment isn't drawn, so it can't need a color.
	assert.ok(!usesCurrentColor(accepted(`${svgOpen}<!-- currentColor --><rect/></svg>`)));
});

test("a charge's artwork takes its palette color", () => {
	const art = `{ fly 1; hoist 1; markup "<svg xmlns='${ns}' viewBox='0 0 1 1'><rect fill='currentColor'/></svg>"; }`;
	const out = svg(parse(header + "charge svg b " + art));
	assert.ok(out.includes(`<g color="#445566">`), out);
	assert.ok(out.includes(`fill="currentColor"`), out);
});

// What an attacker tries against a parser that isn't the browser's.
const hostile: [string, string][] = [
	["script by entity-free prefix", `<x:script xmlns:x="${ns}">alert(1)</x:script>`],
	["script in a nested default namespace", `<script xmlns="${ns}">alert(1)</script>`],
	["event handler in any case", `<rect ONCLICK="alert(1)"/>`],
	["event handler with no namespace via an empty prefix", `<rect xmlns:e="" e:onclick="alert(1)"/>`],
	["handler spelled with an entity", `<rect on&#99;lick="alert(1)"/>`],
	["href with an entity for the scheme", `<linearGradient href="java&#115;cript:alert(1)"/>`],
	["href with a leading space", `<linearGradient href=" #a"/>`],
	["href with a tab inside the scheme", `<linearGradient href="java&#9;script:alert(1)"/>`],
	["href with a fragment after a hash", `<linearGradient href="#a#b"/>`],
	["href that's only a hash", `<linearGradient href="#"/>`],
	["href with a path after the hash", `<linearGradient href="#a/../b"/>`],
	["href with spaces", `<linearGradient href="#a b"/>`],
	["xlink href to another file", `<linearGradient xmlns:l="http://www.w3.org/1999/xlink" l:href="other.svg#a"/>`],
	["url by entity", `<rect fill="u&#114;l(https://example.test/x)"/>`],
	["url with an escaped paren", `<rect fill="url&#40;https://example.test/x)"/>`],
	["url in mixed case", `<rect fill="uRl(https://example.test/x)"/>`],
	["url with a fragment and a host", `<rect fill="url(https://example.test/#a)"/>`],
	["url to a protocol-relative place", `<rect fill="url(//example.test/x)"/>`],
	["url with a space in its id", `<rect fill="url(#a b)"/>`],
	["url with an unmatched quote and a load", `<rect fill="url('#a') url('https://example.test/')"/>`],
	["a color function hiding a url", `<rect fill="rgb(url(https://example.test/x))"/>`],
	["a load after a color", `<rect fill="rgb(1,2,3) image('https://example.test/x')"/>`],
	["a function name a color only starts", `<rect fill="rgbx(1)"/>`],
	["a function a color only ends", `<rect fill="xrgb(1)"/>`],
	["expression", `<rect fill="expression(alert(1))"/>`],
	["var", `<rect fill="var(--x)"/>`],
	["calc", `<rect fill="calc(1)"/>`],
	["attr", `<rect fill="attr(x)"/>`],
	["paint with a load in a stroke", `<rect stroke="url(https://example.test/x)"/>`],
	["paint with a load in a mask", `<rect mask="url(https://example.test/x)"/>`],
	["paint with a load in a clip-path", `<rect clip-path="url(https://example.test/x)"/>`],
	["filter attribute", `<rect filter="url(#a)"/>`],
	["marker attribute", `<path marker-start="url(#a)"/>`],
	["cursor attribute", `<rect cursor="url(https://example.test/x)"/>`],
	["font attribute", `<rect font-family="x"/>`],
	["style with an unlisted property", `<rect style="background:red"/>`],
	["style with an unlisted property after a good one", `<rect style="fill:red;background:url(x)"/>`],
	["style with no colon", `<rect style="fill"/>`],
	["style with a property in an escape", String.raw`<rect style="f\ill:red"/>`],
	["style hiding a load in a url in a good property", `<rect style="fill:url(https://example.test/x)"/>`],
	["style with a load after a semicolon inside a url", `<rect style="fill:url(#a;b)"/>`],
	["style with a load after a good url", `<rect style="fill:url(#a) url(//example.test)"/>`],
	["style with a comment", `<rect style="fill/**/:red"/>`],
	["style with an at-rule", `<rect style="@charset 'x'"/>`],
	["style with an entity for a backslash", `<rect style="fill:&#92;75rl(x)"/>`],
	["style with an entity for an at", `<rect style="fill:&#64;x"/>`],
	["style with an entity for a comment", `<rect style="fill:&#47;&#42;x"/>`],
	["id with a space", `<rect id="a b"/>`],
	["id starting with a digit", `<rect id="1a"/>`],
	["id with a quote", `<rect id="a&quot;b"/>`],
	["id with an angle bracket", `<rect id="a&lt;b"/>`],
	["empty id", `<rect id=""/>`],
	["uppercase element that isn't allowed", `<RECT/>`],
	["element differing only in case", `<lineargradient/>`],
	["animate in a prefix", `<y:animate xmlns:y="${ns}" attributeName="href"/>`],
	["unknown element in the namespace, nested in an allowed one", `<g><g><marquee/></g></g>`],
	["symbol", `<symbol/>`],
	["marker", `<marker/>`],
	["view", `<view/>`],
	["switch", `<switch/>`],
	["tspan", `<tspan/>`],
	["textPath", `<textPath/>`],
	["feImage", `<feImage/>`],
	["iframe", `<iframe/>`],
	["cdata text", `<![CDATA[alert(1)]]>`],
	["text after an element", `<rect/>x`],
	["text inside an allowed element", `<g>x</g>`],
	["a character reference as text", `&#120;`],
	["a nested doctype", `<!DOCTYPE svg>`],
	["an entity declaration", `<!ENTITY x "y">`],
	["a directive inside a dropped element", `<title><!DOCTYPE svg></title>`],
	["a directive inside a foreign element", `<i:x xmlns:i="http://example.test/"><!ELEMENT y ANY></i:x>`],
];

for (const [name, body] of hostile) {
	test(`sanitizer refuses hostile markup: ${name}`, () => refused(svgOpen + body + "</svg>"));
}

const malformed: [string, string][] = [
	["no closing tag", svgOpen],
	["unclosed child", svgOpen + "<g></svg>"],
	["mismatched close", svgOpen + "<g></rect></svg>"],
	["stray close", svgOpen + "</g></svg>"],
	["close after the root", svgOpen + "</svg></svg>"],
	["text after the root", svgOpen + "</svg>x"],
	["two roots of different kinds", svgOpen + "</svg><g/>"],
	["unterminated tag", svgOpen + "<rect"],
	["unterminated attribute", svgOpen + `<rect fill="red`],
	["attribute with no value", svgOpen + "<rect fill/></svg>"],
	["attribute with an unquoted value", svgOpen + "<rect fill=red/></svg>"],
	["angle bracket in an attribute", svgOpen + `<rect fill="<"/></svg>`],
	["an attribute with two prefixes", svgOpen + `<rect a:b:c="1"/></svg>`],
	["an element with two prefixes", svgOpen + `<a:b:c/></svg>`],
	["a close with two prefixes", svgOpen + `<g></a:b:c></svg>`],
	["a close with another prefix", svgOpen + `<x:g xmlns:x="${ns}"></y:g></svg>`],
	["a name starting with a digit", svgOpen + "<1a/></svg>"],
	["a name starting with a hyphen", svgOpen + "<-a/></svg>"],
	["a space before a name", svgOpen + "< rect/></svg>"],
	["a slash in a tag", svgOpen + "<rect / ></svg>"],
	["an unknown entity", svgOpen + `<rect fill="&nbsp;"/></svg>`],
	["an entity with no semicolon", svgOpen + `<rect fill="&amp"/></svg>`],
	["a bare ampersand", svgOpen + `<rect fill="&"/></svg>`],
	["an entity out of range", svgOpen + `<rect fill="&#x110000;"/></svg>`],
	["a huge entity", svgOpen + `<rect fill="&#99999999999999999999;"/></svg>`],
	["a null by entity", svgOpen + `<rect fill="&#0;"/></svg>`],
	["a control character by entity", svgOpen + `<rect fill="&#1;"/></svg>`],
	["a noncharacter by entity", svgOpen + `<rect fill="&#xFFFE;"/></svg>`],
	["an uppercase X in a reference", svgOpen + `<rect fill="&#X41;"/></svg>`],
	["an empty reference", svgOpen + `<rect fill="&#;"/></svg>`],
	["a raw control character", svgOpen + `<rect fill="\u0001"/></svg>`],
	["a null in text", svgOpen + "\u0000</svg>"],
	["]]> in text", svgOpen + "]]></svg>"],
	["an unterminated comment", svgOpen + "<!-- </svg>"],
	["a double hyphen in a comment", svgOpen + "<!-- a -- b --></svg>"],
	["a comment ending in three hyphens", svgOpen + "<!-- a ---></svg>"],
	["a broken comment open", svgOpen + "<!- a --></svg>"],
	["an unterminated CDATA", svgOpen + "<![CDATA[ </svg>"],
	["a lowercase CDATA", svgOpen + "<![cdata[ ]]></svg>"],
	["an unterminated instruction", svgOpen + "<?x </svg>"],
	["an instruction with no target", svgOpen + "<? ?></svg>"],
	["another XML version", `<?xml version="1.1"?>` + svgOpen + "</svg>"],
	["another encoding", `<?xml version="1.0" encoding="latin1"?>` + svgOpen + "</svg>"],
	["a lone surrogate", svgOpen + `<rect fill="\ud800"/></svg>`],
];

for (const [name, markup] of malformed) {
	test(`sanitizer refuses malformed markup: ${name}`, () => refused(markup));
}

test("sanitizer accepts the XML that editors write", () => {
	for (const markup of [
		`<?xml version="1.0" encoding="UTF-8" standalone="no"?>${svgOpen}</svg>`,
		`<?xml version='1.0' encoding='utf-8'?>${svgOpen}</svg>`,
		`\n  <!-- leading -->\n${svgOpen}\n  <!-- inside -->\n</svg>\n<!-- trailing -->\n`,
		`<?editor x?>${svgOpen}<?editor y?></svg>`,
		`${svgOpen}<![CDATA[   ]]></svg>`,
		`<s:svg xmlns:s="${ns}" viewBox="0 0 1 1"><s:rect/></s:svg>`,
		`<svg xmlns='${ns}' viewBox='0,0,1,1'/>`,
		`<svg\n  xmlns="${ns}"\n  viewBox = "0 0 1 1"\n></svg >`,
		`<svg xmlns="${ns}" viewBox="-1.5e1 .5 +2 3."/>`,
	]) {
		accepted(markup);
	}
});

test("foreign content goes, without being looked at", () => {
	const out = accepted(`${svgOpen}<i:x xmlns:i="http://example.test/" onclick="alert(1)"><script>alert(1)</script>text<y:z xmlns:y="urn:y"/></i:x><rect/></svg>`);
	assert.equal(out.body, "<rect></rect>");
	// Its text and elements needn't pass, but it still has to be well formed.
	refused(`${svgOpen}<i:x xmlns:i="http://example.test/"><script></i:x></svg>`);
});

test("a namespace ends with its element", () => {
	const out = accepted(`<svg xmlns="${ns}" xmlns:a="urn:other" viewBox="0 0 1 1"><g xmlns:a="${ns}"><a:rect/></g><a:rect/></svg>`);
	assert.equal(out.body, "<g><rect></rect></g>");
});

test("a default namespace can be changed for a subtree", () => {
	const out = accepted(`${svgOpen}<g xmlns="urn:other"><script/></g><rect/></svg>`);
	assert.equal(out.body, "<rect></rect>");
	assert.equal(accepted(`${svgOpen}<g xmlns="urn:other"><rect xmlns="${ns}"/></g></svg>`).body, "");
});

test("an attribute in another namespace goes, and a prefixed allowed one doesn't return", () => {
	const out = accepted(`${svgOpen}<rect xmlns:z="urn:z" z:onclick="alert(1)" z:fill="url(https://example.test/)"/></svg>`);
	assert.equal(out.body, "<rect></rect>");
	const declared = accepted(`${svgOpen}<rect xmlns:q="${ns}" q:onclick="alert(1)"/></svg>`);
	assert.equal(declared.body, "<rect></rect>");
});

test("output is written afresh, so nothing comes through unescaped", () => {
	const out = accepted(`${svgOpen}<rect transform="&quot; onclick=&quot;alert(1)&quot;" fill="red&gt;&lt;script&gt;"/></svg>`);
	assert.ok(!out.body.includes(`" onclick`), out.body);
	assert.ok(!out.body.includes("<script"), out.body);
	assert.equal(out.body, `<rect transform="&#34; onclick=&#34;alert(1)&#34;" fill="red&gt;&lt;script&gt;"></rect>`);
	const lines = accepted(`${svgOpen}<rect d="a&#10;b&#13;c&#9;d"/></svg>`);
	assert.equal(lines.body, `<rect d="a&#xA;b&#xD;c&#x9;d"></rect>`);
});

test("line endings in attributes are normalized as XML says", () => {
	assert.equal(accepted(`${svgOpen}<rect d="a\r\nb\rc\td"/></svg>`).body, `<rect d="a b c d"></rect>`);
});

test("only the five named entities exist", () => {
	assert.equal(accepted(`${svgOpen}<rect d="&lt;&gt;&amp;&apos;&quot;"/></svg>`).body, `<rect d="&lt;&gt;&amp;&#39;&#34;"></rect>`);
	assert.equal(accepted(`${svgOpen}<rect d="&#65;&#x41;&#x0041;&#000065;"/></svg>`).body, `<rect d="AAAA"></rect>`);
	// A surrogate isn't a character, however it's written.
	refused(`${svgOpen}<rect d="&#xD800;"/></svg>`);
});

test("depth counts the root, up to the limit", () => {
	const deep = (n: number) => svgOpen + "<g>".repeat(n) + "</g>".repeat(n) + "</svg>";
	accepted(deep(maxSvgDepth - 1));
	refused(deep(maxSvgDepth));
});

test("depth doesn't count what's dropped", () => {
	const inner = "<title>".repeat(100) + "</title>".repeat(100);
	assert.equal(accepted(`${svgOpen}${inner}</svg>`).body, "");
});

test("very deep or very long markup doesn't overflow anything", () => {
	refused(svgOpen + "<g>".repeat(200000));
	accepted(svgOpen + `<path d="${"M0 0".repeat(200000)}"/></svg>`);
	refused(svgOpen + `<rect fill="${"(".repeat(100000)}"/></svg>`);
	accepted(svgOpen + "<!--" + "x".repeat(1000000) + "--></svg>");
});

test("the root's attributes go through the same checks", () => {
	refused(`<svg xmlns="${ns}" viewBox="0 0 1 1" onload="alert(1)"/>`);
	refused(`<svg xmlns="${ns}" viewBox="0 0 1 1" fill="url(https://example.test/)"/>`);
	refused(`<svg xmlns="${ns}" viewBox="0 0 1 1" style="fill:url(https://example.test/)"/>`);
	const out = accepted(`<svg xmlns="${ns}" viewBox="0 0 1 1" id="x" x="1" y="1" width="9" height="9" version="1.1" baseProfile="full" preserveAspectRatio="none" fill="red"/>`);
	assert.equal(out.attrs, ` fill="red"`);
});

test("a viewBox has to be four numbers with an area", () => {
	for (const box of ["", "0 0 1", "0 0 1 1 1", "0 0 1px 1", "a b c d", "0 0 -1 1", "0 0 1 -1", "0 0 0 1", "0 0 1 0", "NaN 0 1 1", "0 0 1 1", "0 0 1 1;", "Infinity 0 1 1"]) {
		refused(`<svg xmlns="${ns}" viewBox="${box}"/>`);
	}
	assert.equal(accepted(`<svg xmlns="${ns}" viewBox=" 1,2 ,3  4 "/>`).viewBox, "1 2 3 4");
});

test("a size with no viewBox has to be a plain number", () => {
	for (const size of ["100%", "1em", "", "-1", "0", "1 px", "1pt"]) {
		refused(`<svg xmlns="${ns}" width="${size}" height="1"/>`);
	}
	assert.equal(accepted(`<svg xmlns="${ns}" width="2px" height=" 3 "/>`).viewBox, "0 0 2 3");
});

test("whitespace is ASCII's, everywhere", () => {
	for (const space of ["\u00a0", "\u3000", "\u0085", "\u2028", "\ufeff"]) {
		refused(`${svgOpen}${space}</svg>`);
		refused(`<svg xmlns="${ns}" viewBox="0${space}0 1 1"/>`);
		refused(`<svg xmlns="${ns}" viewBox="${space}0 0 1 1"/>`);
		refused(`${svgOpen}<rect fill="url(${space}#a)"/></svg>`);
		refused(`${svgOpen}<rect style="${space}fill:red"/></svg>`);
	}
});

test("a repeated attribute is refused, however it's spelled", () => {
	refused(`${svgOpen}<rect fill="red" fill="url(https://example.test/)"/></svg>`);
	refused(`<svg xmlns="${ns}" xmlns:x="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"><linearGradient href="#a" x:href="#a"/></svg>`);
	refused(`<svg xmlns="${ns}" xmlns:a="urn:a" xmlns:b="urn:a" viewBox="0 0 1 1"><rect a:x="1" b:x="2"/></svg>`);
});

test("style is rewritten in a fixed form", () => {
	assert.equal(accepted(`${svgOpen}<rect style=" STROKE : red ; ; fill:blue; "/></svg>`).body, `<rect style="stroke:red;fill:blue"></rect>`);
});

test("references are prefixed everywhere they can be", () => {
	const out = accepted(`${svgOpen}<rect fill="url(#a)" stroke="URL( '#b' )" mask='url("#c")' clip-path="url(#d)" style="fill:url(#e)"/><linearGradient href="#f"/></svg>`);
	for (const id of ["a", "b", "c", "d", "e"]) {
		assert.ok(out.body.includes(`url(#p-${id})`), out.body);
	}
	assert.ok(out.body.includes(`href="#p-f"`), out.body);
});

test("the tokenizer rejects what's after the root's close, whether or not it's a tag", () => {
	assert.throws(() => {
		const d = new XmlDecoder("<a></a></a>");
		while (d.token() !== null);
	}, XmlError);
});

test("a flag holding hostile markup is refused whole", () => {
	const doc = (markup: string) => `${header}charge svg { fly 1; hoist 1; markup #"${markup}"#; }`;
	assert.deepEqual(validate(doc(`${svgOpen}<rect/></svg>`)), []);
	const problems = validate(doc(`${svgOpen}<script/></svg>`));
	assert.equal(problems.length, 1);
	assert.equal(problems[0]!.line, 5);
	assert.equal(problems[0]!.node, "charge");
});

test("what a page gets has passed the sanitizer, and the tree matches", () => {
	const flag = parse(`${header}charge svg { fly 1; hoist 1; markup #"${svgOpen}<title>hidden</title><rect id="r" fill="url(#g)" i:x="1" xmlns:i="urn:i"/></svg>"#; }`);
	const out = svg(flag);
	assert.ok(!out.includes("hidden"));
	assert.ok(!out.includes("urn:i"));
	const tree = svgTree(flag);
	const again = treeToSvg(tree);
	assert.match(again, new RegExp(`fill="url\\(#${flag.idPrefix}svg\\d+-g\\)"`));
	assert.ok(!again.includes("urn:i"));
});

test("the suite's documents, without needing its rasterizer", () => {
	const invalid = JSON.parse(readRepo("conformance/invalid.json")) as { name: string; file: string; line?: number }[];
	for (const c of invalid) {
		const bytes = readFileSync(join(root, "conformance", c.file));
		let text: string;
		try {
			text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
		} catch {
			continue;
		}
		const problems = validate(text);
		assert.ok(problems.length > 0, `accepted: ${c.name}`);
		if (c.line !== undefined) {
			assert.ok(problems.some((p) => p.line === c.line), `${c.name}: lines ${problems.map((p) => p.line).join()}`);
		}
	}
	for (const c of JSON.parse(readRepo("conformance/accepted.json")) as { name: string; file: string }[]) {
		assert.deepEqual(validate(readRepo(`conformance/${c.file}`)), [], c.name);
	}
	for (const c of JSON.parse(readRepo("conformance/sanitize.json")) as { name: string; file: string; markup: string }[]) {
		const flag = parse(readRepo(`conformance/${c.file}`));
		const charge = flag.layers[0] as ChargeLayer;
		assert.equal((charge.shape as SvgShape).markup, c.markup, c.name);
	}
});
