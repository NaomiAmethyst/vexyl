// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"bytes"
	"encoding/xml"
	"errors"
	"flag"
	"io"
	"maps"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

var update = flag.Bool("update", false, "rewrite golden files")

func parse(t *testing.T, src string) *Flag {
	t.Helper()
	f, err := Parse(strings.NewReader(src), "test")
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	return f
}

// header starts a valid document on a 10 by 20 grid.
const header = `vexyl 1
meta { name "T"; }
palette { a "#112233"; b "#445566"; }
proportion hoist=10 fly=20
`

func TestGolden(t *testing.T) {
	flags, _ := filepath.Glob("flags/*.kdl")
	extra, _ := filepath.Glob("testdata/*.kdl")
	paths := append(flags, extra...)
	if len(paths) == 0 {
		t.Fatal("no flags found")
	}
	for _, path := range paths {
		t.Run(filepath.Base(path), func(t *testing.T) {
			src, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			f, err := Parse(bytes.NewReader(src), path)
			if err != nil {
				t.Fatal(err)
			}
			var out bytes.Buffer
			if err := f.WriteSVG(&out, Options{}); err != nil {
				t.Fatal(err)
			}
			assertWellFormed(t, out.Bytes())
			golden := filepath.Join("testdata", "golden", strings.TrimSuffix(filepath.Base(path), ".kdl")+".svg")
			if *update {
				if err := os.MkdirAll(filepath.Dir(golden), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(golden, out.Bytes(), 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(golden)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(out.Bytes(), want) {
				t.Errorf("output differs from %s; rerun with -update if intended", golden)
			}
		})
	}
}

func assertWellFormed(t *testing.T, doc []byte) {
	t.Helper()
	dec := xml.NewDecoder(bytes.NewReader(doc))
	for {
		_, err := dec.Token()
		if errors.Is(err, io.EOF) {
			return
		}
		if err != nil {
			t.Fatalf("output isn't well-formed: %v", err)
		}
	}
}

func near(a, b vec) bool {
	return math.Abs(a.x-b.x) < 1e-9 && math.Abs(a.y-b.y) < 1e-9
}

func hasPoint(poly []vec, want vec) bool {
	return slices.ContainsFunc(poly, func(p vec) bool { return near(p, want) })
}

func TestAxisNormalsPointAwayFromFirstBar(t *testing.T) {
	r := region{30, 20}
	tests := []struct {
		along string
		first vec // a corner in the first bar
	}{
		{"fly", vec{0, 0}},
		{"hoist", vec{0, 0}},
		{"bend", vec{0, 20}},
		{"bend-sinister", vec{0, 0}},
	}
	for _, tt := range tests {
		dir, normal := axis(r, tt.along, 0)
		if math.Abs(dir.dot(normal)) > 1e-12 {
			t.Errorf("%s: direction and normal aren't perpendicular", tt.along)
		}
		if tt.first.sub(r.center()).dot(normal) >= 0 {
			t.Errorf("%s: first bar isn't on the expected side", tt.along)
		}
	}
}

func TestBendsFollowCornersAtAnyProportion(t *testing.T) {
	r := region{30, 20}
	poly := bandPoly(r, "bend-sinister", 0, 2, 0, true)
	// The band's center line must run through the corners.
	dir, normal := axis(r, "bend-sinister", 0)
	for _, corner := range []vec{{0, 20}, {30, 0}} {
		if d := corner.sub(r.center()).dot(normal); math.Abs(d) > 1e-9 {
			t.Errorf("corner %v is %v from the center line", corner, d)
		}
	}
	if len(poly) != 4 || math.Abs(dir.x*20+dir.y*30) > 1e-9 {
		t.Errorf("unexpected band: %v", poly)
	}
}

func TestBarRatios(t *testing.T) {
	f := parse(t, header+`bars a b a { ratio 2 1 2; }`)
	polys := barPolys(f.Layers[0].(*Bars), region{20, 10})
	for i, wantY := range []float64{0, 4, 6} {
		if !hasPoint(polys[i], vec{0, wantY}) || !hasPoint(polys[i], vec{20, 10}) {
			t.Errorf("bar %d: got %v, want a start at %v running to the far edge", i, polys[i], wantY)
		}
	}
}

func TestDiagonalBarsCoverTheFlag(t *testing.T) {
	f := parse(t, header+`bars a b { along bend-sinister; }`)
	polys := barPolys(f.Layers[0].(*Bars), region{20, 10})
	if !hasPoint(polys[0], vec{0, 0}) || !hasPoint(polys[0], vec{20, 10}) {
		t.Errorf("first bar doesn't reach both far corners: %v", polys[0])
	}
	// The second bar starts on the diagonal, so it holds both of its ends.
	if !hasPoint(polys[1], vec{0, 10}) || !hasPoint(polys[1], vec{20, 0}) {
		t.Errorf("second bar doesn't start on the diagonal: %v", polys[1])
	}
}

func TestChevronDefaultMeetsCorners(t *testing.T) {
	f := parse(t, header+`chevrons a { depth 5; }`)
	polys := chevronPolys(f.Layers[0].(*Chevrons), region{20, 10})
	for _, want := range []vec{{5, 5}, {0, 0}, {0, 10}} {
		if !hasPoint(polys[0], want) {
			t.Errorf("triangle %v lacks %v", polys[0], want)
		}
	}
	if len(polys[0]) != 3 {
		t.Errorf("want a triangle, got %v", polys[0])
	}
}

func TestChevronAnglesAndEdges(t *testing.T) {
	f := parse(t, header+`chevrons a b { depth 8; angle 45; from fly; }`)
	polys := chevronPolys(f.Layers[0].(*Chevrons), region{20, 10})
	// Outermost: apex 8 in from the fly, arms meeting the top 5 back from it.
	for _, want := range []vec{{12, 5}, {17, 0}, {20, 0}, {20, 10}, {17, 10}} {
		if !hasPoint(polys[0], want) {
			t.Errorf("outer chevron %v lacks %v", polys[0], want)
		}
	}
	if !hasPoint(polys[1], vec{16, 5}) {
		t.Errorf("inner chevron %v lacks its apex", polys[1])
	}
}

func TestSteepChevronStaysConvex(t *testing.T) {
	// A long run once produced a self-intersecting polygon.
	f := parse(t, header+`chevrons a b { depth 18; }`)
	for i, poly := range chevronPolys(f.Layers[0].(*Chevrons), region{20, 10}) {
		if !isConvex(poly) {
			t.Errorf("polygon %d isn't convex: %v", i, poly)
		}
	}
}

func isConvex(poly []vec) bool {
	sign := 0.0
	for i := range poly {
		a, b, c := poly[i], poly[(i+1)%len(poly)], poly[(i+2)%len(poly)]
		cross := (b.x-a.x)*(c.y-b.y) - (b.y-a.y)*(c.x-b.x)
		if math.Abs(cross) < 1e-9 {
			continue
		}
		if sign != 0 && cross*sign < 0 {
			return false
		}
		sign = cross
	}
	return true
}

func TestCrossReadsLikeConstructionSheet(t *testing.T) {
	f := parse(t, `vexyl 1
meta { name "T"; }
palette { a "#112233"; }
proportion hoist=10 fly=16
cross a { fly 5 2 9; hoist 4 2 4; }`)
	polys := crossPolys(f.Layers[0].(*Cross), region{16, 10})
	if !hasPoint(polys[0], vec{5, 0}) || !hasPoint(polys[0], vec{7, 10}) {
		t.Errorf("vertical arm: %v", polys[0])
	}
	if !hasPoint(polys[1], vec{0, 4}) || !hasPoint(polys[1], vec{16, 6}) {
		t.Errorf("horizontal arm: %v", polys[1])
	}
}

func TestStarGeometry(t *testing.T) {
	f := parse(t, header+`charge star a { radius 1; }`)
	s := f.Layers[0].(*Charge).Shape
	if want := 0.381966; math.Abs(s.Inner-want) > 1e-5 {
		t.Errorf("regular star's inner radius = %v, want %v", s.Inner, want)
	}
	g := shapeGeom(&s, vec{}, 0)
	if len(g.poly) != 10 || !near(g.poly[0], vec{0, -1}) {
		t.Errorf("star should start with a point up: %v", g.poly)
	}
}

func TestCardioidExtent(t *testing.T) {
	points := cardioidPoints(2)
	if !near(points[90], vec{0, 2}) {
		t.Errorf("lobe's far point = %v, want 2 below the cusp", points[90])
	}
	if !near(points[0], vec{}) {
		t.Errorf("cusp = %v, want the origin", points[0])
	}
}

func svgOf(t *testing.T, f *Flag) string {
	t.Helper()
	var out bytes.Buffer
	if err := f.WriteSVG(&out, Options{}); err != nil {
		t.Fatal(err)
	}
	return out.String()
}

func TestUSCantonHasFiftyStars(t *testing.T) {
	src, err := os.ReadFile("flags/united-states.kdl")
	if err != nil {
		t.Fatal(err)
	}
	out := svgOf(t, parse(t, string(src)))
	if got := strings.Count(out, `fill="#ffffff"`); got != 50+6 {
		t.Errorf("found %d white shapes, want 50 stars and 6 white stripes", got)
	}
}

func TestEUStarsStayUpright(t *testing.T) {
	src, err := os.ReadFile("flags/european-union.kdl")
	if err != nil {
		t.Fatal(err)
	}
	f := parse(t, string(src))
	s := f.Layers[1].(*Charge).Shape
	upright := shapeGeom(&s, vec{}, 0).poly
	out := svgOf(t, f)
	// At three o'clock, an upright star's top point is directly above its center.
	want := vec{13.5 + 6, 9}.add(upright[0])
	if !strings.Contains(out, num(want.x)+","+num(want.y)) {
		t.Errorf("no upright star at three o'clock, wanted a point at %v", want)
	}
}

// Every full or fragmentary KDL example in the docs must be valid.
func TestDocExamples(t *testing.T) {
	block := regexp.MustCompile("(?s)```kdl\n(.*?)```")
	for _, doc := range []string{"README.md", "SPEC.md"} {
		src, err := os.ReadFile(doc)
		if err != nil {
			t.Fatal(err)
		}
		blocks := block.FindAllSubmatch(src, -1)
		if len(blocks) == 0 {
			t.Errorf("%s has no examples", doc)
		}
		for _, m := range blocks {
			example := string(m[1])
			if !strings.HasPrefix(example, "vexyl ") {
				example = header + example
			}
			if _, err := Parse(strings.NewReader(example), doc); err != nil {
				t.Errorf("%s: %v\n%s", doc, err, example)
			}
		}
	}
}

func TestRejected(t *testing.T) {
	tests := []struct {
		name, src, want string
	}{
		{"no version", `meta { name "T"; }`, "must start with"},
		{"wrong version", `vexyl 2`, "unsupported format version"},
		{"missing meta name", "vexyl 1\nmeta { description \"x\"; }\n", "needs a `name`"},
		{"incomplete", "vexyl 1\n", "needs `vexyl`"},
		{"out of order", "vexyl 1\npalette { a \"#112233\"; }\nmeta { name \"T\"; }\n", "out of order"},
		{"unknown layer", header + `sparkle a`, "unknown layer"},
		{"unknown child", header + `bars a { sparkle 1; }`, "unknown here"},
		{"unknown color", header + `field c`, `"c" isn't in the palette`},
		{"bad palette value", "vexyl 1\nmeta { name \"T\"; }\npalette { a red; }\n", "must be #rrggbb"},
		{"ratio mismatch", header + `bars a b { ratio 1 2 3; }`, "a ratio of 3 values"},
		{"count mismatch", header + `bars a b { count 3; ratio 1 2; }`, "a ratio of 2 values"},
		{"no depth", header + `chevrons a`, "needs a `depth`"},
		{"bad angle", header + `chevrons a { depth 1; angle 90; }`, "between 0 and 90"},
		{"bad along", header + `bars a { along sideways; }`, "must be one of"},
		{"cross pair", header + `cross a { fly 1 2; hoist 1 2 1; }`, "needs 3 values"},
		{"cross missing", header + `cross a { fly 1 2 1; }`, "needs `fly` and `hoist`"},
		{"unknown shape", header + `charge blob a`, "unknown shape"},
		{"radius missing", header + `charge disc a`, "needs a `radius`"},
		{"ring inner", header + `charge ring a { radius 1; inner 2; }`, "smaller than"},
		{"star inner", header + `charge star a { radius 1; points 3; }`, "fewer than 5"},
		{"grid at", header + `charge disc a { radius 1; at center; repeat grid rows=1 columns=1; }`, "can't have `at`"},
		{"grid at point", header + `charge disc a { radius 1; at fly=1 hoist=1; repeat grid rows=1 columns=1; }`, "can't have `at`"},
		{"too many copies", header + `charge disc a { radius 1; repeat grid rows=1000 columns=1000; }`, "more than"},
		{"polygon at", header + `charge polygon a { at center; point fly=0 hoist=0; }`, "unknown here"},
		{"polygon size", header + `charge polygon a { point fly=0 hoist=0; }`, "at least 3"},
		{"svg color", header + `charge svg a`, "takes none"},
		{"svg cut", header + `field a { cut { svg; }; }`, "can't be used"},
		{"svg repeat", header + `charge svg { fly 1; hoist 1; repeat ring count=2 radius=1; markup "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/>"; }`, "can't be repeated"},
		{"infinite", header + `charge disc a { radius #inf; }`, "finite"},
		{"opacity range", header + `field a { opacity 2; }`, "between 0 and 1"},
		{"duplicate child", header + `field a { opacity 1; opacity 1; }`, "more than once"},
		{"annotation", header + `(x)field a`, "type annotations"},
		{"duplicate property", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; }\nproportion hoist=1 hoist=2 fly=2\n", "hoist"},
		{"no canton size", header + `canton { field a; }`, "needs `fly` and `hoist`"},
		{"empty group", header + `group`, "at least one layer"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Parse(strings.NewReader(tt.src), "test")
			if err == nil {
				t.Fatalf("no error; wanted one containing %q", tt.want)
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Errorf("error %q doesn't contain %q", err, tt.want)
			}
		})
	}
}

func TestOffsetPolygonMitersBothWindings(t *testing.T) {
	want := rectPoly(-1, -1, 11, 21)
	for _, poly := range [][]vec{
		rectPoly(0, 0, 10, 20),
		{{0, 20}, {10, 20}, {10, 0}, {0, 0}},
	} {
		got, err := offsetPolygon(poly, 1)
		if err != nil {
			t.Fatal(err)
		}
		for _, w := range want {
			if !hasPoint(got, w) {
				t.Errorf("offset of %v = %v, lacks %v", poly, got, w)
			}
		}
	}
}

func TestOffsetPolygonRejectsDegenerateShapes(t *testing.T) {
	for name, poly := range map[string][]vec{
		"no area":    {{0, 0}, {1, 1}, {2, 2}},
		"repeated":   {{0, 0}, {1, 0}, {1, 0}, {0, 1}},
		"folds back": {{0, 0}, {2, 0}, {1, 0}, {1, 1}},
	} {
		if out, err := offsetPolygon(poly, 1); err == nil {
			t.Errorf("%s: accepted, giving %v", name, out)
		}
	}
}

func TestBorderSides(t *testing.T) {
	inside := svgOf(t, parse(t, header+`border b 1 inside`+"\n"+`field a`))
	if !strings.Contains(inside, `viewBox="0 0 20 10"`) || !strings.Contains(inside, `fill="none" stroke="#445566"`) {
		t.Errorf("inside border: %s", inside)
	}
	outside := svgOf(t, parse(t, header+`border b 1 outside`+"\n"+`field a`))
	if !strings.Contains(outside, `viewBox="-1 -1 22 12"`) || !strings.Contains(outside, `points="-1,-1 21,-1 21,11 -1,11" fill="#445566"`) {
		t.Errorf("outside border: %s", outside)
	}
	if !strings.Contains(outside, `width="1100" height="600"`) {
		t.Errorf("outside border should grow the image: %s", outside)
	}
	for _, src := range []string{`border b 1 sideways`, `border b`, `border b 1 outside 2`} {
		if _, err := Parse(strings.NewReader(header+src), "test"); err == nil {
			t.Errorf("%q accepted", src)
		}
	}
	bad := `vexyl 1
meta { name "T"; }
palette { a "#112233"; }
proportion hoist=10 fly=20
outline { polygon { point fly=0 hoist=0; point fly=1 hoist=1; point fly=2 hoist=2; }; }
border a 1 outside`
	if _, err := Parse(strings.NewReader(bad), "test"); err == nil || !strings.Contains(err.Error(), "no area") {
		t.Errorf("degenerate outline: err = %v", err)
	}
}

// Nepal's constitution gives the flag no ratio, only a construction. The known
// 1:1.219 emerges once its border is added, so it's a check on the whole of it.
func TestNepalConstruction(t *testing.T) {
	src, err := os.ReadFile("flags/nepal.kdl")
	if err != nil {
		t.Fatal(err)
	}
	f := parse(t, string(src))
	if f.Hoist != 80 || f.Fly != 60 {
		t.Errorf("grid = %v by %v, want Schedule 1's AC = 80 and AB = 60", f.Hoist, f.Fly)
	}
	outer, err := offsetPolygon(f.boundary(), f.Border.Width)
	if err != nil {
		t.Fatal(err)
	}
	_, _, w, h := bounds(outer)
	if ratio := h / w; math.Abs(ratio-1.219) > 0.0005 {
		t.Errorf("finished height/width = %v, want about 1.219", ratio)
	}
}

func TestProgressChevronsRunWhiteToBlack(t *testing.T) {
	src, err := os.ReadFile("flags/progress-pride.kdl")
	if err != nil {
		t.Fatal(err)
	}
	f := parse(t, string(src))
	ch := f.Layers[1].(*Chevrons)
	if ch.Colors[0] != "white" || ch.Colors[len(ch.Colors)-1] != "black" {
		t.Errorf("chevrons from the hoist: %v", ch.Colors)
	}
}

func TestDeepNestingRejected(t *testing.T) {
	src := header + strings.Repeat("group {\n", maxDepth+1) + "field a\n" + strings.Repeat("}\n", maxDepth+1)
	if _, err := Parse(strings.NewReader(src), "test"); err == nil || !strings.Contains(err.Error(), "nested") {
		t.Errorf("err = %v", err)
	}
}

func TestErrorsReportLocationsAndAllProblems(t *testing.T) {
	_, err := Parse(strings.NewReader(header+"field nope\nfield nada\n"), "demo.kdl")
	if err == nil {
		t.Fatal("no error")
	}
	for _, want := range []string{"demo.kdl:5:1", "demo.kdl:6:1"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("%q lacks %q", err, want)
		}
	}
}

const svgOpen = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">`

func TestSanitizeRejects(t *testing.T) {
	tests := []struct{ name, body string }{
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
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if out, err := sanitizeSVG(svgOpen+tt.body+`</svg>`, "p-"); err == nil {
				t.Errorf("accepted, producing %q", out.body)
			}
		})
	}
}

func TestSanitizeRejectsBadRoots(t *testing.T) {
	tests := []struct{ name, markup string }{
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
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := sanitizeSVG(tt.markup, "p-"); err == nil {
				t.Error("accepted")
			}
		})
	}
}

func TestSanitizeKeepsArtworkAndPrefixesIDs(t *testing.T) {
	out, err := sanitizeSVG(`<?xml version="1.0"?>
<!-- a comment -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     xmlns:i="http://example.test/editor" width="20px" height="10" fill="#123456" i:zoom="2">
  <title>gone</title>
  <metadata><i:thing>gone</i:thing></metadata>
  <i:panel><script>gone</script></i:panel>
  <defs><linearGradient id="g" xlink:href="#h"/></defs>
  <circle fill="rgb(1, 2, 3)" stroke="hsla(1, 2%, 3%, 0.5)" transform="translate(1 2) rotate(3)"/>
  <rect id="r" fill="url(#g)" style="stroke: url('#g'); opacity: 0.5" clip-path="url(#c)" i:label="gone"/>
</svg>`, "p-")
	if err != nil {
		t.Fatal(err)
	}
	if out.viewBox != "0 0 20 10" {
		t.Errorf("viewBox = %q", out.viewBox)
	}
	if out.attrs != ` fill="#123456"` {
		t.Errorf("root attrs = %q", out.attrs)
	}
	for _, want := range []string{
		`id="p-g"`, `href="#p-h"`, `id="p-r"`, `fill="url(#p-g)"`,
		`style="opacity:0.5;stroke:url(#p-g)"`, `clip-path="url(#p-c)"`,
		`fill="rgb(1, 2, 3)"`, `transform="translate(1 2) rotate(3)"`,
	} {
		if !strings.Contains(out.body, want) {
			t.Errorf("%q lacks %q", out.body, want)
		}
	}
	if strings.Contains(out.body, "gone") {
		t.Errorf("dropped content survived: %q", out.body)
	}
}

// An embedded file must not be able to refer to the renderer's own IDs, or
// another embed's.
func TestEmbedsAreIsolated(t *testing.T) {
	src, err := os.ReadFile("testdata/inline-svg.kdl")
	if err != nil {
		t.Fatal(err)
	}
	out := svgOf(t, parse(t, string(src)))
	ids := regexp.MustCompile(` id="([^"]+)"`).FindAllStringSubmatch(out, -1)
	seen := map[string]bool{}
	for _, m := range ids {
		if seen[m[1]] {
			t.Errorf("duplicate id %q", m[1])
		}
		seen[m[1]] = true
	}
	for _, want := range []string{"svg1-shade", "svg2-shade"} {
		if !slices.ContainsFunc(slices.Collect(maps.Keys(seen)), func(id string) bool { return strings.HasSuffix(id, want) }) {
			t.Errorf("missing id ending %q; have %v", want, seen)
		}
	}
}

// Several flags inlined in one page mustn't share definitions, since a page
// resolves url(#id) to the first match and would clip them all alike.
func TestFlagsHaveDistinctIDs(t *testing.T) {
	ids := regexp.MustCompile(` id="([^"]+)"`)
	a := ids.FindAllStringSubmatch(svgOf(t, parse(t, header+`field a { clip { disc { radius 1; }; }; }`)), -1)
	b := ids.FindAllStringSubmatch(svgOf(t, parse(t, header+`field b { clip { disc { radius 1; }; }; }`)), -1)
	if len(a) == 0 || len(a) != len(b) {
		t.Fatalf("ids: %v and %v", a, b)
	}
	for i := range a {
		if a[i][1] == b[i][1] {
			t.Errorf("both flags use id %q", a[i][1])
		}
	}
}

func FuzzSanitize(f *testing.F) {
	f.Add(svgOpen + `<rect fill="url(#a)"/></svg>`)
	f.Add(svgOpen + `<script>x</script></svg>`)
	banned := regexp.MustCompile(`(?i)<\s*(script|foreignObject|image|style|a|use|set|animate)\b|\son\w+=`)
	f.Fuzz(func(t *testing.T, markup string) {
		out, err := sanitizeSVG(markup, "p-")
		if err != nil {
			return
		}
		if loc := banned.FindString(out.body + out.attrs); loc != "" {
			t.Errorf("banned %q survived in %q", loc, out.body)
		}
		wrapped := `<svg xmlns="` + svgNamespace + `"` + out.attrs + `>` + out.body + `</svg>`
		assertWellFormed(t, []byte(wrapped))
	})
}

func FuzzParse(f *testing.F) {
	f.Add(header + `bars a b { ratio 1 2; }`)
	f.Add(header + `charge star a { radius 1; repeat ring count=5 radius=2; }`)
	f.Fuzz(func(t *testing.T, src string) {
		flag, err := Parse(strings.NewReader(src), "fuzz")
		if err != nil {
			return
		}
		var out bytes.Buffer
		if err := flag.WriteSVG(&out, Options{}); err != nil {
			t.Fatal(err)
		}
		assertWellFormed(t, out.Bytes())
	})
}
