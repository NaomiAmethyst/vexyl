// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

const svgOpen = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">`

// These tables are also the conformance suite's: `go test . -update` writes them out, since
// they say what every library's sanitizer has to do.

// refusedBodies can't be anywhere in inline SVG.
var refusedBodies = []struct{ name, body string }{
	{"script", `<script>alert(1)</script>`},
	{"foreignObject", `<foreignObject><div/></foreignObject>`},
	{"image", `<image href="https://example.test/x.png"/>`},
	{"anchor", `<a href="javascript:alert(1)"><rect/></a>`},
	{"style element", `<style>@import "https://example.test/x.css";</style>`},
	{"animate", `<animate attributeName="fill"/>`},
	{"set", `<set attributeName="onmouseover" to="alert(1)"/>`},
	{"use", `<use href="#x"/>`},
	{"pattern", `<pattern id="p"/>`},
	{"filter", `<filter id="f"/>`},
	{"text", `<text>hello</text>`},
	{"bare text", `hello`},
	{"nested svg", `<svg/>`},
	{"uppercase script", `<SCRIPT/>`},
	{"event handler", `<rect onclick="alert(1)"/>`},
	{"external href", `<linearGradient href="https://example.test/g.svg#a"/>`},
	{"xlink external", `<linearGradient xmlns:x="http://www.w3.org/1999/xlink" x:href="https://example.test/g.svg#a"/>`},
	{"javascript href", `<linearGradient href="javascript:alert(1)"/>`},
	{"external fill", `<rect fill="url(https://example.test/x.svg#a)"/>`},
	{"uppercase url", `<rect fill="URL(https://example.test/x.svg#a)"/>`},
	{"data url", `<rect fill="url(data:image/svg+xml,x)"/>`},
	{"mixed urls", `<rect fill="url(#ok) url(https://example.test/a)"/>`},
	{"external style", `<rect style="fill:url(https://example.test/x)"/>`},
	{"style escape", `<rect style="fill:\75rl(https://example.test/x)"/>`},
	{"style import", `<rect style="@import 'https://example.test/x'"/>`},
	{"style behavior", `<rect style="behavior:url(x.htc)"/>`},
	{"style comment", `<rect style="fill:u/**/rl(https://example.test/x)"/>`},
	{"bad id", `<rect id="a b"/>`},
	{"css src function", `<rect fill="src('https://example.test/x')"/>`},
	{"css image function", `<rect style="fill:image('https://example.test/x')"/>`},
	{"class", `<rect class="a"/>`},
	{"version on an element", `<g version="1.1"/>`},
	{"viewBox on an element", `<g viewBox="0 0 1 1"/>`},
	{"preserveAspectRatio on an element", `<rect preserveAspectRatio="xMidYMid"/>`},
	{"element with no namespace", `<g xmlns=""><rect/></g>`},
	{"repeated attribute", `<rect fill="red" fill="blue"/>`},
	{"repeated attribute by its expanded name", `<rect xmlns:a="urn:a" xmlns:b="urn:a" a:x="1" b:x="2"/>`},
	{"href and xlink href", `<linearGradient xmlns:x="http://www.w3.org/1999/xlink" href="#h" x:href="#h"/>`},
	{"undeclared element prefix", `<x:rect/>`},
	{"undeclared attribute prefix", `<rect x:fill="red"/>`},
	{"undeclared prefix in a dropped element", `<title x:lang="en"/>`},
	{"surrogate reference", `<rect fill="&#xD800;"/>`},
	{"surrogate reference in decimal", `<rect fill="&#55296;"/>`},
	{"null reference", `<rect fill="&#0;"/>`},
	{"reference to FFFF", `<rect fill="&#xFFFF;"/>`},
	{"text of a no-break space", "\u00a0"},
	{"text of an ideographic space", "\u3000"},
	{"text of a next line", "\u0085"},
	{"text of a byte order mark", "\ufeff"},
	{"style with a no-break space before a property", "<rect style=\"\u00a0fill:red\"/>"},
	{"url with a no-break space", "<rect fill=\"url(\u00a0#a)\"/>"},
	{"url with a long s", "<rect fill=\"url(\u017f)\"/>"},
	{"color with a long s", "<rect fill=\"h\u017fl(1)\"/>"},
	{"style property with a dotted capital", "<rect style=\"f\u0130ll:red\"/>"},
	{"style property with a kelvin sign", "<rect style=\"mas\u212a:url(#a)\"/>"},
	{"no space between attributes", `<rect x="1"y="2"/>`},
	{"xml prefix bound elsewhere", `<g xmlns:xml="urn:a"/>`},
	{"another prefix bound to the xml namespace", `<g xmlns:a="http://www.w3.org/XML/1998/namespace"/>`},
	{"xmlns prefix declared", `<g xmlns:xmlns="urn:a"/>`},
	{"xmlns namespace bound", `<g xmlns:a="http://www.w3.org/2000/xmlns/"/>`},
	{"prefix undeclared", `<g xmlns:a=""/>`},
	{"xml declaration inside", `<?xml version="1.0"?>`},
	{"instruction named xml in capitals", `<?XML x?>`},
	{"instruction with a colon", `<?a:b x?>`},
	{"instruction with no space after its target", `<?a"b"?>`},
	{"comment with a control character", "<!-- \u0001 -->"},
	{"instruction with a noncharacter", "<?a \ufffe?>"},
	{"cdata with a control character", "<![CDATA[\u0001]]>"},
}

// refusedMarkup is refused whole, including markup that isn't well-formed XML.
var refusedMarkup = []struct{ name, markup string }{
	{"empty", ``},
	{"not svg", `<html xmlns="http://www.w3.org/1999/xhtml"/>`},
	{"no namespace", `<svg viewBox="0 0 1 1"/>`},
	{"no size", `<svg xmlns="http://www.w3.org/2000/svg"/>`},
	{"percent size", `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"/>`},
	{"empty viewBox", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0"/>`},
	{"handler on root", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" onload="alert(1)"/>`},
	{"two roots", svgOpen + `</svg>` + svgOpen + `</svg>`},
	{"doctype", `<!DOCTYPE svg [<!ENTITY x "y">]>` + svgOpen + `</svg>`},
	{"malformed", svgOpen + `<rect>`},
	{"too deep", svgOpen + strings.Repeat("<g>", maxSVGDepth+1) + strings.Repeat("</g>", maxSVGDepth+1) + `</svg>`},
	{"text before the root", `x` + svgOpen + `</svg>`},
	{"a reference before the root", `&#32;` + svgOpen + `</svg>`},
	{"a reference after the root", svgOpen + `</svg>&#32;`},
	{"cdata after the root", svgOpen + `</svg><![CDATA[ ]]>`},
	{"space before the declaration", ` <?xml version="1.0"?>` + svgOpen + `</svg>`},
	{"a declaration with no version", `<?xml encoding="UTF-8"?>` + svgOpen + `</svg>`},
	{"a declaration out of order", `<?xml encoding="UTF-8" version="1.0"?>` + svgOpen + `</svg>`},
	{"a declaration with something else", `<?xml version="1.0" other="x"?>` + svgOpen + `</svg>`},
	{"a declaration with no spaces", `<?xml version="1.0"encoding="UTF-8"?>` + svgOpen + `</svg>`},
	{"a viewBox with a no-break space", "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0\u00a00 1 1\"/>"},
	{"a viewBox beyond the limit", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1e13 1"/>`},
	{"a viewBox too small", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1e-13 1"/>`},
	{"a viewBox past what a number can hold", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1e999 1"/>`},
	{"a size beyond the limit", `<svg xmlns="http://www.w3.org/2000/svg" width="1e13" height="1"/>`},
	{"a preserveAspectRatio of none", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none"/>`},
	{"a preserveAspectRatio that slices", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid slice"/>`},
	{"a preserveAspectRatio aligned elsewhere", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="xMinYMin meet"/>`},
	{"a preserveAspectRatio in another case", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="xmidymid"/>`},
}

// hostileBodies are what an attacker tries against a parser that is not the browser's.
var hostileBodies = []struct{ name, body string }{
	{"script by entity-free prefix", "<x:script xmlns:x=\"http://www.w3.org/2000/svg\">alert(1)</x:script>"},
	{"script in a nested default namespace", "<script xmlns=\"http://www.w3.org/2000/svg\">alert(1)</script>"},
	{"event handler in any case", "<rect ONCLICK=\"alert(1)\"/>"},
	{"event handler with no namespace via an empty prefix", "<rect xmlns:e=\"\" e:onclick=\"alert(1)\"/>"},
	{"handler spelled with an entity", "<rect on&#99;lick=\"alert(1)\"/>"},
	{"href with an entity for the scheme", "<linearGradient href=\"java&#115;cript:alert(1)\"/>"},
	{"href with a leading space", "<linearGradient href=\" #a\"/>"},
	{"href with a tab inside the scheme", "<linearGradient href=\"java&#9;script:alert(1)\"/>"},
	{"href with a fragment after a hash", "<linearGradient href=\"#a#b\"/>"},
	{"href that's only a hash", "<linearGradient href=\"#\"/>"},
	{"href with a path after the hash", "<linearGradient href=\"#a/../b\"/>"},
	{"href with spaces", "<linearGradient href=\"#a b\"/>"},
	{"xlink href to another file", "<linearGradient xmlns:l=\"http://www.w3.org/1999/xlink\" l:href=\"other.svg#a\"/>"},
	{"url by entity", "<rect fill=\"u&#114;l(https://example.test/x)\"/>"},
	{"url with an escaped paren", "<rect fill=\"url&#40;https://example.test/x)\"/>"},
	{"url in mixed case", "<rect fill=\"uRl(https://example.test/x)\"/>"},
	{"url with a fragment and a host", "<rect fill=\"url(https://example.test/#a)\"/>"},
	{"url to a protocol-relative place", "<rect fill=\"url(//example.test/x)\"/>"},
	{"url with a space in its id", "<rect fill=\"url(#a b)\"/>"},
	{"url with an unmatched quote and a load", "<rect fill=\"url('#a') url('https://example.test/')\"/>"},
	{"a color function hiding a url", "<rect fill=\"rgb(url(https://example.test/x))\"/>"},
	{"a load after a color", "<rect fill=\"rgb(1,2,3) image('https://example.test/x')\"/>"},
	{"a function name a color only starts", "<rect fill=\"rgbx(1)\"/>"},
	{"a function a color only ends", "<rect fill=\"xrgb(1)\"/>"},
	{"expression", "<rect fill=\"expression(alert(1))\"/>"},
	{"var", "<rect fill=\"var(--x)\"/>"},
	{"calc", "<rect fill=\"calc(1)\"/>"},
	{"attr", "<rect fill=\"attr(x)\"/>"},
	{"paint with a load in a stroke", "<rect stroke=\"url(https://example.test/x)\"/>"},
	{"paint with a load in a mask", "<rect mask=\"url(https://example.test/x)\"/>"},
	{"paint with a load in a clip-path", "<rect clip-path=\"url(https://example.test/x)\"/>"},
	{"filter attribute", "<rect filter=\"url(#a)\"/>"},
	{"marker attribute", "<path marker-start=\"url(#a)\"/>"},
	{"cursor attribute", "<rect cursor=\"url(https://example.test/x)\"/>"},
	{"font attribute", "<rect font-family=\"x\"/>"},
	{"style with an unlisted property", "<rect style=\"background:red\"/>"},
	{"style with an unlisted property after a good one", "<rect style=\"fill:red;background:url(x)\"/>"},
	{"style with no colon", "<rect style=\"fill\"/>"},
	{"style with a property in an escape", "<rect style=\"f\\ill:red\"/>"},
	{"style hiding a load in a url in a good property", "<rect style=\"fill:url(https://example.test/x)\"/>"},
	{"style with a load after a semicolon inside a url", "<rect style=\"fill:url(#a;b)\"/>"},
	{"style with a load after a good url", "<rect style=\"fill:url(#a) url(//example.test)\"/>"},
	{"style with a comment", "<rect style=\"fill/**/:red\"/>"},
	{"style with an at-rule", "<rect style=\"@charset 'x'\"/>"},
	{"style with an entity for a backslash", "<rect style=\"fill:&#92;75rl(x)\"/>"},
	{"style with an entity for an at", "<rect style=\"fill:&#64;x\"/>"},
	{"style with an entity for a comment", "<rect style=\"fill:&#47;&#42;x\"/>"},
	{"id with a space", "<rect id=\"a b\"/>"},
	{"id starting with a digit", "<rect id=\"1a\"/>"},
	{"id with a quote", "<rect id=\"a&quot;b\"/>"},
	{"id with an angle bracket", "<rect id=\"a&lt;b\"/>"},
	{"empty id", "<rect id=\"\"/>"},
	{"uppercase element that isn't allowed", "<RECT/>"},
	{"element differing only in case", "<lineargradient/>"},
	{"animate in a prefix", "<y:animate xmlns:y=\"http://www.w3.org/2000/svg\" attributeName=\"href\"/>"},
	{"unknown element in the namespace, nested in an allowed one", "<g><g><marquee/></g></g>"},
	{"symbol", "<symbol/>"},
	{"marker", "<marker/>"},
	{"view", "<view/>"},
	{"switch", "<switch/>"},
	{"tspan", "<tspan/>"},
	{"textPath", "<textPath/>"},
	{"feImage", "<feImage/>"},
	{"iframe", "<iframe/>"},
	{"cdata text", "<![CDATA[alert(1)]]>"},
	{"text after an element", "<rect/>x"},
	{"text inside an allowed element", "<g>x</g>"},
	{"a character reference as text", "&#120;"},
	{"a nested doctype", "<!DOCTYPE svg>"},
	{"an entity declaration", "<!ENTITY x \"y\">"},
	{"a directive inside a dropped element", "<title><!DOCTYPE svg></title>"},
	{"a directive inside a foreign element", "<i:x xmlns:i=\"http://example.test/\"><!ELEMENT y ANY></i:x>"},
}

// malformedMarkup is not well-formed XML.
var malformedMarkup = []struct{ name, markup string }{
	{"no closing tag", svgOpen},
	{"unclosed child", svgOpen + "<g></svg>"},
	{"mismatched close", svgOpen + "<g></rect></svg>"},
	{"stray close", svgOpen + "</g></svg>"},
	{"close after the root", svgOpen + "</svg></svg>"},
	{"text after the root", svgOpen + "</svg>x"},
	{"two roots of different kinds", svgOpen + "</svg><g/>"},
	{"unterminated tag", svgOpen + "<rect"},
	{"unterminated attribute", svgOpen + "<rect fill=\"red"},
	{"attribute with no value", svgOpen + "<rect fill/></svg>"},
	{"attribute with an unquoted value", svgOpen + "<rect fill=red/></svg>"},
	{"angle bracket in an attribute", svgOpen + "<rect fill=\"<\"/></svg>"},
	{"an attribute with two prefixes", svgOpen + "<rect a:b:c=\"1\"/></svg>"},
	{"an element with two prefixes", svgOpen + "<a:b:c/></svg>"},
	{"a close with two prefixes", svgOpen + "<g></a:b:c></svg>"},
	{"a close with another prefix", svgOpen + "<x:g xmlns:x=\"http://www.w3.org/2000/svg\"></y:g></svg>"},
	{"a name starting with a digit", svgOpen + "<1a/></svg>"},
	{"a name starting with a hyphen", svgOpen + "<-a/></svg>"},
	{"a space before a name", svgOpen + "< rect/></svg>"},
	{"a slash in a tag", svgOpen + "<rect / ></svg>"},
	{"an unknown entity", svgOpen + "<rect fill=\"&nbsp;\"/></svg>"},
	{"an entity with no semicolon", svgOpen + "<rect fill=\"&amp\"/></svg>"},
	{"a bare ampersand", svgOpen + "<rect fill=\"&\"/></svg>"},
	{"an entity out of range", svgOpen + "<rect fill=\"&#x110000;\"/></svg>"},
	{"a huge entity", svgOpen + "<rect fill=\"&#99999999999999999999;\"/></svg>"},
	{"a null by entity", svgOpen + "<rect fill=\"&#0;\"/></svg>"},
	{"a control character by entity", svgOpen + "<rect fill=\"&#1;\"/></svg>"},
	{"a noncharacter by entity", svgOpen + "<rect fill=\"&#xFFFE;\"/></svg>"},
	{"an uppercase X in a reference", svgOpen + "<rect fill=\"&#X41;\"/></svg>"},
	{"an empty reference", svgOpen + "<rect fill=\"&#;\"/></svg>"},
	{"a raw control character", svgOpen + "<rect fill=\"\u0001\"/></svg>"},
	{"a null in text", svgOpen + "\u0000</svg>"},
	{"]]> in text", svgOpen + "]]></svg>"},
	{"an unterminated comment", svgOpen + "<!-- </svg>"},
	{"a double hyphen in a comment", svgOpen + "<!-- a -- b --></svg>"},
	{"a comment ending in three hyphens", svgOpen + "<!-- a ---></svg>"},
	{"a broken comment open", svgOpen + "<!- a --></svg>"},
	{"an unterminated CDATA", svgOpen + "<![CDATA[ </svg>"},
	{"a lowercase CDATA", svgOpen + "<![cdata[ ]]></svg>"},
	{"an unterminated instruction", svgOpen + "<?x </svg>"},
	{"an instruction with no target", svgOpen + "<? ?></svg>"},
	{"another XML version", "<?xml version=\"1.1\"?><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"></svg>"},
	{"another encoding", "<?xml version=\"1.0\" encoding=\"latin1\"?><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"></svg>"},
}

// keptMarkup is accepted, and has exactly this canonical form afterward.
var keptMarkup = []struct{ name, markup, want string }{
	{"artwork with its descriptions and foreign content removed", `<?xml version="1.0"?>
<!-- a comment -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     xmlns:i="http://example.test/editor" width="20px" height="10" fill="#123456" i:zoom="2">
  <title>gone</title>
  <desc>gone</desc>
  <metadata><i:thing>gone</i:thing></metadata>
  <i:panel><script>gone</script></i:panel>
  <?gone?>
  <defs><linearGradient id="g" xlink:href="#h"/></defs>
  <circle fill="rgb(1, 2, 3)" stroke="hsla(1, 2%, 3%, 0.5)" transform="translate(1 2) rotate(3)"/>
  <rect id="r" fill="url(#g)" style="stroke: url('#g'); opacity: 0.5" clip-path="url(#c)" i:label="gone"/>
</svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10" fill="#123456"><defs><linearGradient id="g" href="#h"></linearGradient></defs><circle fill="rgb(1, 2, 3)" stroke="hsla(1, 2%, 3%, 0.5)" transform="translate(1 2) rotate(3)"></circle><rect id="r" fill="url(#g)" style="stroke:url(#g);opacity:0.5" clip-path="url(#c)"></rect></svg>`},
	{"a style's order, which decides what wins", svgOpen + `<rect style="fill:red;fill:blue"/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect style="fill:red;fill:blue"></rect></svg>`},
	{"a prefixed root and elements", `<s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0,0 1 ,1"><s:rect/></s:svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect></rect></svg>`},
	{"what's dropped needn't pass", svgOpen + `<i:x xmlns:i="urn:i"><script>x</script>text</i:x><title><script/></title><rect/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect></rect></svg>`},
	{"attributes in another namespace", svgOpen + `<rect xmlns:z="urn:z" xml:space="preserve" z:onclick="x" z:fill="url(https://example.test/)"/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect></rect></svg>`},
	{"entities and references, written afresh", svgOpen + `<rect fill="&lt;&#65;&#x41;&amp;&apos;&quot;&gt;"/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect fill="&lt;AA&amp;&#39;&#34;&gt;"></rect></svg>`},
	{"literal whitespace in an attribute becomes spaces, and references stay", svgOpen + "<path d=\"M0 0\n\tL1 1&#10;Z\"/></svg>",
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0  L1 1&#xA;Z"></path></svg>`},
	{"whitespace between elements, in text and cdata", svgOpen + "\n\t <g>&#32;<![CDATA[ ]]></g>\n</svg>\n",
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g></g></svg>`},
	{"every way to write a url", svgOpen + `<rect fill="url(#a)" stroke="URL( '#b' )" mask='url("#c")' clip-path="uRl(#d)"/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect fill="url(#a)" stroke="url(#b)" mask="url(#c)" clip-path="url(#d)"></rect></svg>`},
	{"nesting up to the limit", svgOpen + strings.Repeat("<g>", maxSVGDepth-1) + strings.Repeat("</g>", maxSVGDepth-1) + `</svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">` + strings.Repeat("<g>", maxSVGDepth-1) + strings.Repeat("</g>", maxSVGDepth-1) + `</svg>`},
	{"the default preserveAspectRatio, said outright", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" preserveAspectRatio=" xMidYMid` + "\t" + `meet "></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>`},
	{"the default preserveAspectRatio's alignment alone", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" preserveAspectRatio="xMidYMid"></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>`},
	{"a declaration with everything", `<?xml version='1.0' encoding='utf-8' standalone = "no" ?>` + svgOpen + `</svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>`},
	{"root-only attributes, read and removed", `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" baseProfile="full" id="r" x="1" y="2" viewBox="0 0 10 10" fill="red"><rect id="s" x="1" y="2"/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" fill="red"><rect id="s" x="1" y="2"></rect></svg>`},
	{"the root's attributes after its viewBox, in their order", `<svg fill="red" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" stroke="blue"></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" fill="red" stroke="blue"></svg>`},
	{"a viewBox's numbers as written", `<svg xmlns="http://www.w3.org/2000/svg" viewBox=" +0,0.50 1e0  1E0 "></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="+0 0.50 1e0 1E0"></svg>`},
	{"a style written afresh", `<s:svg xmlns:s="http://www.w3.org/2000/svg" version="1.1" width="20px" height="10"><s:rect style="FILL : URL( '#g' ) ; ;"/></s:svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect style="fill:url(#g)"></rect></svg>`},
	{"a presentation value kept as written around its url", svgOpen + `<rect fill=" url( #g ) red"/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect fill=" url(#g) red"></rect></svg>`},
}

// kdlString writes any text as a KDL string, including what can't be written literally.
func kdlString(text string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range text {
		switch {
		case r == '"' || r == '\\':
			b.WriteRune('\\')
			b.WriteRune(r)
		case r == '\n':
			b.WriteString(`\n`)
		case r < 0x20 || (r >= 0x7f && r <= 0xa0) || r == 0x2028 || r == 0x2029 || r == 0xfeff || (r >= 0x200e && r <= 0x200f) || (r >= 0x202a && r <= 0x202e) || (r >= 0x2066 && r <= 0x2069) || r >= 0xfffe && r <= 0xffff:
			fmt.Fprintf(&b, `\u{%x}`, r)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

// svgDocument is a valid flag but for its inline SVG, which is on line 6.
func svgDocument(markup string) string {
	return header + "charge svg a {\n  markup " + kdlString(markup) + "\n  fly 1\n  hoist 1\n}\n"
}

// sanitizerCases are the tables' refusals as whole documents.
func sanitizerCases() []invalidCase {
	var cases []invalidCase
	add := func(name, markup string) {
		cases = append(cases, invalidCase{name: "sanitizer: " + name, src: svgDocument(markup)})
	}
	for _, tt := range refusedBodies {
		add(tt.name, svgOpen+tt.body+`</svg>`)
	}
	for _, tt := range hostileBodies {
		add(tt.name, svgOpen+tt.body+`</svg>`)
	}
	for _, tt := range refusedMarkup {
		add(tt.name, tt.markup)
	}
	for _, tt := range malformedMarkup {
		add(tt.name, tt.markup)
	}
	return append(cases, placedCases...)
}

func TestSanitizerRefusals(t *testing.T) {
	for _, c := range sanitizerCases() {
		t.Run(c.name, func(t *testing.T) {
			f, err := Parse(strings.NewReader(c.src), "test")
			if err == nil {
				t.Fatalf("accepted, producing %q", f.Layers[0].(*Charge).Shape.Markup)
			}
		})
	}
}

// A document's problem with its inline SVG is on the charge holding it.
func TestSanitizerProblemsAreOnTheCharge(t *testing.T) {
	ps := Validate(strings.NewReader(svgDocument(svgOpen+`<script/></svg>`)), "f")
	if len(ps) != 1 || ps[0].Line != 5 || ps[0].Node != "charge" {
		t.Errorf("problems: %+v", ps)
	}
}

func TestSanitizerKeeps(t *testing.T) {
	for _, tt := range keptMarkup {
		t.Run(tt.name, func(t *testing.T) {
			f := parse(t, svgDocument(tt.markup))
			if got := f.Layers[0].(*Charge).Shape.Markup; got != tt.want {
				t.Errorf("markup:\n got %s\nwant %s", got, tt.want)
			}
			svg := svgOf(t, f)
			for _, gone := range []string{"gone", "script", "example.test", "urn:"} {
				if strings.Contains(svg, gone) {
					t.Errorf("%q survived in %s", gone, svg)
				}
			}
			assertWellFormed(t, []byte(svg))
		})
	}
}

// The model and a render both come from what passed, and only a render has prefixes.
func TestModelHoldsSanitizedMarkup(t *testing.T) {
	f := parse(t, svgDocument(svgOpen+`<title>hidden</title><rect id="r" fill="url(#g)"/></svg>`))
	markup := f.Model().(map[string]any)["layers"].([]any)[0].(map[string]any)["markup"]
	want := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect id="r" fill="url(#g)"></rect></svg>`
	if markup != want {
		t.Errorf("markup = %v", markup)
	}
	svg := svgOf(t, f)
	if strings.Contains(svg, "hidden") || strings.Contains(svg, `id="r"`) || !strings.Contains(svg, `-r"`) {
		t.Errorf("render: %s", svg)
	}
}

// A definition can draw the same artwork many times, and each needs its own IDs.
func TestArtworkDrawnTwiceHasDistinctIDs(t *testing.T) {
	out := svgOf(t, parse(t, header+"define d {\n  charge svg { fly 1; hoist 1; markup "+kdlString(svgOpen+`<rect id="r"/></svg>`)+"; }\n}\nuse d\nuse d\n"))
	seen := map[string]bool{}
	for _, m := range regexp.MustCompile(` id="([^"]+)"`).FindAllStringSubmatch(out, -1) {
		if seen[m[1]] {
			t.Errorf("duplicate id %q", m[1])
		}
		seen[m[1]] = true
	}
	if len(seen) < 2 {
		t.Errorf("ids: %v", seen)
	}
}

type invalidCase struct {
	name, src string
	// place says to record the column of its first problem as well.
	place bool
}

// placedCases test how lines and columns count: code points, and only LF ends a line.
var placedCases = []invalidCase{
	{"column after characters beyond the basic plane", header + "/* 𝒳é */ field nope\n", true},
	{"line after a next line and a line separator", header + "/*\u0085\u2028*/ field nope\n", true},
	{"line after a form feed", header + "/*\f*/ field nope\n", true},
	{"column in a crlf document", strings.ReplaceAll(header, "\n", "\r\n") + "  field nope\r\n", true},
}

var slugChars = regexp.MustCompile(`[^a-z0-9]+`)

func slug(name string) string {
	return strings.Trim(slugChars.ReplaceAllString(strings.ToLower(name), "-"), "-")
}

func writeJSON(t *testing.T, path string, value any) {
	t.Helper()
	out, err := json.MarshalIndent(value, "", " ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(out, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
}

// writeInvalidFixtures saves documents that must be refused, for the conformance suite.
// It records the line of the first problem, except for syntax errors, whose place depends
// on the KDL parser.
func writeInvalidFixtures(t *testing.T, cases []invalidCase) {
	t.Helper()
	dir := filepath.Join("..", "conformance", "invalid")
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	type entry struct {
		Name string `json:"name"`
		File string `json:"file"`
		Line int    `json:"line,omitempty"`
		// Column is only there for documents that test how columns count.
		Column int `json:"column,omitempty"`
	}
	seen := map[string]bool{}
	var list []entry
	for _, c := range cases {
		name := slug(c.name)
		if seen[name] {
			t.Fatalf("two cases come to %q", name)
		}
		seen[name] = true
		if err := os.WriteFile(filepath.Join(dir, name+".kdl"), []byte(c.src), 0o644); err != nil {
			t.Fatal(err)
		}
		e := entry{Name: c.name, File: "invalid/" + name + ".kdl"}
		if ps := Validate(strings.NewReader(c.src), name); len(ps) > 0 && ps[0].Node != "" {
			e.Line = ps[0].Line
			if c.place {
				e.Column = ps[0].Column
			}
		}
		list = append(list, e)
	}
	writeJSON(t, filepath.Join("..", "conformance", "invalid.json"), list)
}

// TestWriteSuiteTables writes the documents that have to be accepted, and the artwork that
// has to come out a certain way, for the conformance suite.
func TestWriteSuiteTables(t *testing.T) {
	if !*update {
		t.Skip("only writes with -update")
	}
	dir := filepath.Join("..", "conformance")
	type kept struct {
		Name   string `json:"name"`
		File   string `json:"file"`
		Markup string `json:"markup"`
	}
	if err := os.RemoveAll(filepath.Join(dir, "sanitize")); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "sanitize"), 0o755); err != nil {
		t.Fatal(err)
	}
	var keeps []kept
	for _, tt := range keptMarkup {
		file := filepath.Join("sanitize", slug(tt.name)+".kdl")
		if err := os.WriteFile(filepath.Join(dir, file), []byte(svgDocument(tt.markup)), 0o644); err != nil {
			t.Fatal(err)
		}
		keeps = append(keeps, kept{tt.name, filepath.ToSlash(file), tt.want})
	}
	writeJSON(t, filepath.Join(dir, "sanitize.json"), keeps)
	type accepted struct {
		Name string `json:"name"`
		File string `json:"file"`
	}
	if err := os.RemoveAll(filepath.Join(dir, "accepted")); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "accepted"), 0o755); err != nil {
		t.Fatal(err)
	}
	var accepts []accepted
	for _, tt := range acceptedDocuments {
		file := filepath.Join("accepted", slug(tt.name)+".kdl")
		if err := os.WriteFile(filepath.Join(dir, file), []byte(tt.src), 0o644); err != nil {
			t.Fatal(err)
		}
		accepts = append(accepts, accepted{tt.name, filepath.ToSlash(file)})
	}
	writeJSON(t, filepath.Join(dir, "accepted.json"), accepts)
	type distinct struct {
		Name string `json:"name"`
		A    string `json:"a"`
		B    string `json:"b"`
	}
	var pairs []distinct
	for _, tt := range distinctDocuments {
		pairs = append(pairs, distinct{tt.name, tt.a, tt.b})
	}
	writeJSON(t, filepath.Join(dir, "distinct.json"), pairs)
}

// distinctDocuments differ in what they mean, so their models have to differ. Most are
// pairs where a zero or a default could be mistaken for leaving something out.
var distinctDocuments = []struct{ name, a, b string }{
	{"a position at the origin, and none", `charge disc a { radius 1; at fly=0 hoist=0; }`, `charge disc a { radius 1; }`},
	{"two positions, and only one", `charge disc a { radius 1; at center; at fly=0 hoist=0; }`, `charge disc a { radius 1; at fly=0 hoist=0; }`},
	{"an apex at the start, and none", `chevrons a { depth 1; angle 45; apex 0; }`, `chevrons a { depth 1; angle 45; }`},
	{"no opacity, and full", `field a { opacity 0; }`, `field a`},
	{"a split at the origin, and none", `quarters a b a b { split fly=0 hoist=0; }`, `quarters a b a b`},
	{"an emblem at the origin, and none", `emblem { at fly=0 hoist=0; charge disc a { radius 1; }; }`, `emblem { charge disc a { radius 1; }; }`},
	{"a panel at the origin, and none", `panel { at fly=0 hoist=0; fly 1; hoist 1; field a; }`, `panel { fly 1; hoist 1; field a; }`},
	{"rays from the origin, and the center", `rays a b { from fly=0 hoist=0; }`, `rays a b`},
	{"a ring's arc from up, and no arc", `charge ring a { radius 2; inner 1; from 0; to 90; }`, `charge ring a { radius 2; inner 1; }`},
	{"an arc ending at up, and at another place", `charge ring a { radius 2; inner 1; from 90; to 0; }`, `charge ring a { radius 2; inner 1; from 90; to 10; }`},
	{"a bar that doesn't grow, and one that does", `bars a b { grow 0 1; }`, `bars a b { grow 1 1; }`},
	{"a grow of evens, and none", `bars a b { grow 1 1; }`, `bars a b`},
	{"a stop at the start, and elsewhere", "G 0 1", "G 0.5 1"},
	{"a point at the origin, and elsewhere", `charge polygon a { point fly=0 hoist=0; point fly=1 hoist=0; point fly=1 hoist=1; }`, `charge polygon a { point fly=0 hoist=1; point fly=1 hoist=0; point fly=1 hoist=1; }`},
	{"a line stepping only one way, and the other", `charge disc a { radius 1; repeat line count=2 fly=1; }`, `charge disc a { radius 1; repeat line count=2 hoist=1; }`},
	{"an arc's start at up, and elsewhere", `charge disc a { radius 1; repeat arc count=2 radius=1 from=0 to=90; }`, `charge disc a { radius 1; repeat arc count=2 radius=1 from=1 to=90; }`},
	{"a box at the origin, and elsewhere", `charge path a { d "M0 0Z"; box "0 0 1 1"; fly 1; }`, `charge path a { d "M0 0Z"; box "1 0 1 1"; fly 1; }`},
	{"a box's fly, and hoist", `charge path a { d "M0 0Z"; box "0 0 1 1"; fly 1; }`, `charge path a { d "M0 0Z"; box "0 0 1 1"; hoist 1; }`},
	{"a cross's fly, and hoist", `cross a { fly 0 1 1; hoist 1 1 0; }`, `cross a { fly 1 1 0; hoist 0 1 1; }`},
	{"a pile's base at the start", `pile a { depth 1; base 0 1; }`, `pile a { depth 1; }`},
	{"a pile's tip at the start", `pile a { tip 0 1; }`, `pile a { tip 1 1; }`},
	{"a pile's edge", `pile a { depth 1; from top; }`, `pile a { depth 1; }`},
	{"a pile's flat", `pile a { depth 1; flat 1; }`, `pile a { depth 1; }`},
	{"a pall's junction", `pall a { width 1; junction 1; }`, `pall a { width 1; }`},
	{"a pile, and a pall", `pile a { depth 1; }`, `pall a { width 1; }`},
	{"a canton, and a panel in another corner", `canton { fly 1; hoist 1; field a; }`, `panel { corner upper-fly; fly 1; hoist 1; field a; }`},
	{"edge and angle measures", `rays a b { measure edge; }`, `rays a b`},
	{"evenodd", `charge path a { d "M0 0Z"; box "0 0 1 1"; fly 1; evenodd; }`, `charge path a { d "M0 0Z"; box "0 0 1 1"; fly 1; }`},
	{"a hollow shape", `charge disc a { radius 1; hollow 0.5; }`, `charge disc a { radius 1; }`},
	{"a star's lines", `charge star a { radius 1; lines 0.5; }`, `charge star a { radius 1; }`},
	{"a star's points", `charge star a { radius 1; points 6; }`, `charge star a { radius 1; }`},
	{"a star's inner", `charge star a { radius 1; inner 0.1; }`, `charge star a { radius 1; }`},
	{"a sun's gap", `charge sun a { radius 2; disc 1; gap 0.1; }`, `charge sun a { radius 2; disc 1; }`},
	{"a sun's spread", `charge sun a { radius 2; disc 1; spread 0.5; }`, `charge sun a { radius 2; disc 1; }`},
	{"a turn", `charge disc a { radius 1; repeat ring count=2 radius=1 turn=#true; }`, `charge disc a { radius 1; repeat ring count=2 radius=1; }`},
	{"a stagger", `charge disc a { radius 1; repeat grid rows=2 columns=2 stagger=#true; }`, `charge disc a { radius 1; repeat grid rows=2 columns=2; }`},
	{"rotations", `band a { width 1; rotate 1; }`, `band a { width 1; }`},
	{"offsets", `band a { width 1; offset 1; }`, `band a { width 1; }`},
	{"axes", `band a { width 1; along hoist; }`, `band a { width 1; }`},
	{"blends", `field a { blend multiply; }`, `field a`},
	{"anchors", `charge disc a { radius 1; anchor end; }`, `charge disc a { radius 1; }`},
	{"clips", `field a { clip { disc { radius 1; }; }; }`, `field a`},
	{"a pile as a clip, and a pall", `field a { clip { pile { depth 1; }; }; }`, `field a { clip { pall { width 1; }; }; }`},
	{"cuts", `field a { cut { disc { radius 1; }; }; }`, `field a`},
	{"diagonal quarters", `quarters a b a b { diagonal; }`, `quarters a b a b`},
	{"a counterchange", `saltire a { width 1; counterchange; }`, `saltire a { width 1; }`},
	{"a check's flow", `checks a b { rows 2; columns 2; flow bend; }`, `checks a b { rows 2; columns 2; }`},
	{"what a definition holds", "define d { field a; }\nuse d\n", "define d { field b; }\nuse d\n"},
	{"a definition's grid", "define d hoist=1 fly=1 { field a; }\nuse d\n", "define d { field a; }\nuse d\n"},
	{"a reverse", "field a\nreverse { field b; }\n", "field a\n"},
	{"an outside border", "border a 1 outside\nfield a\n", "border a 1\nfield a\n"},
	{"wider and narrower", "field a\nadapt { wider extend; }\n", "field a\nadapt { narrower extend; }\n"},
	{"a range", "field a\nadapt { wider extend; range 1 2; }\n", "field a\nadapt { wider extend; }\n"},
	{"a variant turning", "field a\nvariant v { from rotate; }\n", "field a\nvariant v { from transpose; }\n"},
	{"a variant turned either way", "field a\nvariant v { from rotate; }\n", "field a\nvariant v { from counter-rotate; }\n"},
	{"a variant reflected across either diagonal", "field a\nvariant v { from transpose; }\n", "field a\nvariant v { from anti-transpose; }\n"},
	{"a variant mirrored or turned all the way around", "field a\nvariant v { from mirror; }\n", "field a\nvariant v { from half-turn; }\n"},
	{"a variant turned upside down or all the way around", "field a\nvariant v { from half-turn; }\n", "field a\nvariant v { from invert; }\n"},
	{"a variant upright", "field a\nvariant v { from rotate; upright; }\n", "field a\nvariant v { from rotate; }\n"},
	{"a variant's outside border", "field a\nvariant v { border a 1 outside; }\n", "field a\nvariant v { border a 1; }\n"},
	{"a fold's crease", "field a\nfold f { over along=hoist at=5 move=fly; }\n", "field a\nfold f { over along=hoist at=5 move=hoist; }\n"},
	{"a fold's direction", "field a\nfold f { over along=hoist at=5 move=fly; }\n", "field a\nfold f { under along=hoist at=5 move=fly; }\n"},
	{"a fold through any line", `field a` + "\nfold f { over through=\"0 0 1 1\" move=\"0 1\"; }\n", `field a` + "\nfold f { over through=\"0 0 1 1\" move=\"1 0\"; }\n"},
}

func distinctDocument(body string) string {
	if strings.HasPrefix(body, "G ") {
		return "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; b \"#445566\"; g gradient a b { stops " + body[2:] + "; }; }\nproportion hoist=10 fly=20\nfield g\n"
	}
	return header + body + "\n"
}

func TestModelsOfDifferentFlagsDiffer(t *testing.T) {
	for _, tt := range distinctDocuments {
		t.Run(tt.name, func(t *testing.T) {
			a, err := json.Marshal(parse(t, distinctDocument(tt.a)).Model())
			if err != nil {
				t.Fatal(err)
			}
			b, err := json.Marshal(parse(t, distinctDocument(tt.b)).Model())
			if err != nil {
				t.Fatal(err)
			}
			if string(a) == string(b) {
				t.Errorf("both have the model %s", a)
			}
		})
	}
}

func TestCMYKIsNumbers(t *testing.T) {
	m := parse(t, "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\" { cmyk 100 0.0000001 0 40; }; }\nproportion hoist=1 fly=1\n").Model().(map[string]any)
	cmyk := m["palette"].(map[string]any)["a"].(map[string]any)["cmyk"].([]any)
	if len(cmyk) != 4 || cmyk[0] != 100.0 || cmyk[1] != 0.0000001 || cmyk[2] != 0.0 {
		t.Errorf("cmyk: %v", cmyk)
	}
}

// acceptedDocuments have to be valid, and are too big or too odd to be worth drawing. Many
// sit exactly at a limit, with their neighbors over it in TestRejected.
var acceptedDocuments = []invalidCase{
	{name: "a hexadecimal number right before a semicolon", src: header + "charge disc a { radius 2; at fly=5 hoist=0x0A; rotate 5; }\n"},
	{name: "paints exactly the limit", src: header + strings.Repeat("checks a b { rows 100; columns 100; }\n", 20)},
	{name: "paints exactly the limit with star points", src: header + "charge star a { radius 1; points 10000; repeat grid rows=5 columns=4; }\n"},
	{name: "paints exactly the limit with path data", src: header + strings.Repeat(pathCopies(127), 10)},
	{name: "paints exactly the limit with cuts on copies", src: header + "charge disc a { radius 1; repeat grid rows=100 columns=100; cut { star { radius 1; points 19; }; }; }\n"},
	{name: "inline svg counted by its bytes", src: header + svgChain(16)},
	{name: "nests exactly the limit through uses", src: header + nestedUses(32)},
	{name: "a box with every separator", src: header + "charge path a { d \"M0 0H1V1Z\"; box \" 0,0\\t1 , 1\\n\"; fly 1; }\n"},
	{name: "a box with every way to write a number", src: header + "charge path a { d \"M0 0H1V1Z\"; box \"+1. -.5 1e0 1.5E+0\"; fly 1; }\n"},
	{name: "a quoted negative infinity is only text", src: header + `define "-inf" { field a; }` + "\nuse \"-inf\"\n"},
	{name: "a meta's date within the same year as its end", src: "vexyl 1\nmeta { name \"T\"; date \"2000\"; until \"2001\"; }\npalette { a \"#112233\"; }\nproportion hoist=1 fly=1\n"},
	{name: "an end known only to the year of its beginning", src: "vexyl 1\nmeta { name \"T\"; date \"2000-06\"; until \"2000\"; }\npalette { a \"#112233\"; }\nproportion hoist=1 fly=1\n"},
	{name: "palette colors in capitals", src: "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#ABCDEF\"; b \"#aBcDeF\"; }\nproportion hoist=1 fly=1\nbars a b\n"},
	{name: "whole numbers written as decimals", src: "vexyl 1.0\nmeta { name \"T\"; }\npalette { a \"#112233\"; b \"#445566\"; }\nproportion hoist=10 fly=20\nbars a b { count 4.0; }\ncharge star a { radius 1; points 5.0; repeat grid rows=2e0 columns=1.0; }\n"},
	{name: "nests exactly the limit in a variant", src: header + "field a\nvariant v {\n" + strings.Repeat("group {\n", 31) + "field a\n" + strings.Repeat("}\n", 32)},
	{name: "nests exactly the limit in a reverse", src: header + "field a\nreverse {\n" + strings.Repeat("group {\n", 31) + "field a\n" + strings.Repeat("}\n", 32)},
	{name: "a count as large as the colors", src: header + "bars a b a { count 3; }\nrays a b a { count 3; }\n"},
	{name: "a number at each end of what's allowed", src: header + "charge disc a { radius 1e12; at fly=1e-12 hoist=-1e12; }\n"},
	{name: "switches written with #true and #false", src: header + "quarters a b a b { diagonal #false; }\nsaltire a { width 1; counterchange #true; }\ncharge path a { d \"M0 0H1V1Z\"; box \"0 0 1 1\"; fly 1; evenodd #false; }\nvariant v { from rotate; upright #false; }\n"},
	{name: "stops at the same place", src: "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; b \"#445566\"; g gradient a b a { stops 0 0.5 0.5; }; }\nproportion hoist=1 fly=1\nfield g\n"},
	{name: "a series with digits", src: "vexyl 1\nmeta { name \"T\"; series \"flag-2\"; }\npalette { a \"#112233\"; }\nproportion hoist=1 fly=1\n"},
	{name: "a render license over a work under the same one", src: "vexyl 1\nmeta {\n  name \"T\"\n  render-license \"CC-BY-4.0\"\n  adapted-from \"https://example.test/a\" {\n    license \"CC-BY-4.0\"\n  }\n  adapted-from \"https://example.test/b\" {\n    license \"CC0-1.0\"\n  }\n}\npalette { a \"#112233\"; }\nproportion hoist=1 fly=1\n"},
	{name: "an apex past the end of its edge", src: header + "chevrons a { depth 2; angle 30; apex 15; }\n"},
	{name: "a path defined either way", src: header + "define p1 { path \"M0 0H1V1Z\" box=\"0 0 1 1\"; }\ndefine p2 { path { d \"M0 0H1V1Z\"; box \"0 0 1 1\"; hoist 2; }; }\ncharge p1 a { fly 1; }\ncharge p2 a\n"},
	{name: "a lone pile defined as a design", src: header + "define d { pile a { depth 2; }; }\nuse d\n"},
	{name: "edges of either kind by either measure", src: header + "bars a b { edge wavy depth=1 count=3; }\nbars a b { along hoist; edge zigzag depth=1 period=3; }\n"},
	{name: "sizes that can be zero or negative", src: header + "band a { width 1; offset -2; }\ncross a { fly 0 1 0; hoist 0 1 0; }\npile a { base -1 12; tip 5 3; }\ncharge disc a { radius 1; at fly=-1 hoist=0; rotate -30; repeat line count=2 fly=-1 hoist=0; }\n"},
}

// pathCopies is 10000 copies of a path of about that many bytes.
func pathCopies(size int) string {
	d := "M0 0" + strings.Repeat(" ", size-5) + "Z"
	return `charge path a { d "` + d + `"; box "0 0 1 1"; fly 1; repeat line count=10000 fly=1; }` + "\n"
}

// svgChain uses a definition holding inline SVG 2^n times, by doubling.
func svgChain(n int) string {
	var b strings.Builder
	b.WriteString("define d0 {\n  charge svg { fly 1; hoist 1; markup " + kdlString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>`) + "; }\n}\n")
	for i := 1; i <= n; i++ {
		fmt.Fprintf(&b, "define d%d { use d%d; use d%d; }\n", i, i-1, i-1)
	}
	fmt.Fprintf(&b, "use d%d\n", n)
	return b.String()
}

// nestedUses is a chain of definitions n levels deep where the last is used.
func nestedUses(n int) string {
	var b strings.Builder
	b.WriteString("define d1 { field a; }\n")
	for i := 2; i < n; i++ {
		fmt.Fprintf(&b, "define d%d { use d%d; }\n", i, i-1)
	}
	fmt.Fprintf(&b, "use d%d\n", n-1)
	return b.String()
}

func TestAcceptedDocuments(t *testing.T) {
	for _, tt := range acceptedDocuments {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := Parse(strings.NewReader(tt.src), "test"); err != nil {
				t.Error(err)
			}
		})
	}
}

// The doubling document from the TypeScript port's report, which ran for ever before.
func exponentialDocument(n int) string {
	var b strings.Builder
	b.WriteString("define d0 { field a; }\n")
	for i := 1; i <= n; i++ {
		fmt.Fprintf(&b, "define d%d { use d%d; use d%d; }\n", i, i-1, i-1)
	}
	fmt.Fprintf(&b, "use d%d\n", n)
	return b.String()
}

func TestExponentialUseIsRefusedQuickly(t *testing.T) {
	ps := Validate(strings.NewReader(header+exponentialDocument(28)), "f")
	if len(ps) != 1 || !strings.Contains(ps[0].Message, "paints too much") || ps[0].Line != 34 {
		t.Errorf("problems: %+v", ps)
	}
}

func TestSizeCountsWhatIsPainted(t *testing.T) {
	sizes := []struct {
		name, src string
		want      int
	}{
		{"field", `field a`, 1},
		{"bars", `bars a b { count 5; }`, 5},
		{"edge", `bars a b { edge zigzag depth=1 count=3; }`, 8},
		{"edge by period", `bars a b { edge wavy depth=1 period=3; }`, 16},
		{"quarters", `quarters a b a b`, 4},
		{"checks", `checks a b { rows 2; columns 3; }`, 6},
		{"chevrons", `chevrons a b { depth 1; }`, 2},
		{"rays", `rays a b { count 7; }`, 7},
		{"disc", `charge disc a { radius 1; }`, 1},
		{"copies", `charge disc a { radius 1; repeat grid rows=2 columns=3; }`, 6},
		{"positions", `charge disc a { radius 1; at center; at fly=1 hoist=1; }`, 2},
		{"star points", `charge star a { radius 1; points 7; repeat ring count=2 radius=1; }`, 14},
		{"sun points", `charge sun a { radius 2; disc 1; }`, 12},
		{"polygon", `charge polygon a { point fly=0 hoist=0; point fly=1 hoist=0; point fly=1 hoist=1; point fly=0 hoist=1; }`, 4},
		{"path", `charge path a { d "M0 0Z"; box "0 0 1 1"; fly 1; }`, 1},
		{"clip and cut", `field a { clip { star { radius 1; }; }; cut { disc { radius 1; }; }; }`, 7},
		{"cuts go with copies", `charge disc a { radius 1; repeat line count=3 fly=2; cut { star { radius 1; }; }; }`, 18},
		{"cuts go with positions", `charge disc a { radius 1; at center; at fly=1 hoist=1; cut { star { radius 1; }; }; }`, 12},
		{"a clip on copies applies once", `charge disc a { radius 1; repeat line count=3 fly=2; clip { star { radius 1; }; }; }`, 8},
		{"a group's cut applies once", `group { cut { star { radius 1; }; }; charge disc a { radius 1; repeat line count=3 fly=2; }; }`, 8},
		{"group", `group { field a; field b; }`, 2},
		{"panel with an edge", `panel { side top; width 1; edge zigzag depth=1 count=3; field a; }`, 4},
		{"emblem", `emblem { charge disc a { radius 1; }; charge disc b { radius 1; }; }`, 2},
	}
	for _, tt := range sizes {
		t.Run(tt.name, func(t *testing.T) {
			f := parse(t, header+tt.src)
			if got := layersSize(f.Layers, 20); got != tt.want {
				t.Errorf("size = %d, want %d", got, tt.want)
			}
		})
	}
}
