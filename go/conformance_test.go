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
	{"a declaration with everything", `<?xml version='1.0' encoding='utf-8' standalone = "no" ?>` + svgOpen + `</svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>`},
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
		cases = append(cases, invalidCase{"sanitizer: " + name, svgDocument(markup)})
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
	return cases
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
	markup := f.Model().(map[string]any)["layers"].([]any)[0].(map[string]any)["shape"].(map[string]any)["markup"]
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

type invalidCase struct{ name, src string }

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
}

// acceptedDocuments have to be valid, and are too big or too odd to be worth drawing. Many
// sit exactly at a limit, with their neighbors over it in TestRejected.
var acceptedDocuments = []invalidCase{
	{"paints exactly the limit", header + strings.Repeat("checks a b { rows 100; columns 100; }\n", 20)},
	{"paints exactly the limit with star points", header + "charge star a { radius 1; points 10000; repeat grid rows=5 columns=4; }\n"},
	{"paints exactly the limit with path data", header + strings.Repeat(pathCopies(127), 10)},
	{"inline svg counted by its bytes", header + svgChain(16)},
	{"nests exactly the limit through uses", header + nestedUses(32)},
	{"a box with every separator", header + "charge path a { d \"M0 0H1V1Z\"; box \" 0,0\\t1 , 1\\n\"; fly 1; }\n"},
	{"a box with every way to write a number", header + "charge path a { d \"M0 0H1V1Z\"; box \"+1. -.5 1e0 1.5E+0\"; fly 1; }\n"},
	{"a number at each end of what's allowed", header + "charge disc a { radius 1e12; at fly=1e-12 hoist=-1e12; }\n"},
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
