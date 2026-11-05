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
	flags, _ := filepath.Glob("../flags/*.kdl")
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
	r := region{w: 30, h: 20}
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
	r := region{w: 30, h: 20}
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
	polys := barPolys(f.Layers[0].(*Bars), region{w: 20, h: 10}, nil)
	for i, wantY := range []float64{0, 4, 6} {
		if !hasPoint(polys[i], vec{0, wantY}) || !hasPoint(polys[i], vec{20, 10}) {
			t.Errorf("bar %d: got %v, want a start at %v running to the far edge", i, polys[i], wantY)
		}
	}
}

func TestDiagonalBarsCoverTheFlag(t *testing.T) {
	f := parse(t, header+`bars a b { along bend-sinister; }`)
	polys := barPolys(f.Layers[0].(*Bars), region{w: 20, h: 10}, nil)
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
	polys := chevronPolys(f.Layers[0].(*Chevrons), region{w: 20, h: 10})
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
	polys := chevronPolys(f.Layers[0].(*Chevrons), region{w: 20, h: 10})
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
	for i, poly := range chevronPolys(f.Layers[0].(*Chevrons), region{w: 20, h: 10}) {
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
	polys := crossPolys(f.Layers[0].(*Cross), region{w: 16, h: 10}, 0)
	if !hasPoint(polys[0], vec{5, 0}) || !hasPoint(polys[0], vec{7, 10}) {
		t.Errorf("vertical arm: %v", polys[0])
	}
	if !hasPoint(polys[1], vec{0, 4}) || !hasPoint(polys[1], vec{16, 6}) {
		t.Errorf("horizontal arm: %v", polys[1])
	}
}

// An off-center chevron with 45-degree arms: its apex on a bar boundary at 2, with
// arms reaching the top at 2 back from it and the far corner at the bottom.
func TestChevronApex(t *testing.T) {
	f := parse(t, `vexyl 1
meta { name "T"; }
palette { a "#112233"; }
proportion hoist=6 fly=10
chevrons a { depth 4; angle 45; apex 2; }`)
	poly := chevronPolys(f.Layers[0].(*Chevrons), region{w: 10, h: 6})[0]
	for _, want := range []vec{{4, 2}, {2, 0}, {0, 0}, {0, 6}} {
		if !hasPoint(poly, want) {
			t.Errorf("chevron %v lacks %v", poly, want)
		}
	}
	if len(poly) != 4 {
		t.Errorf("want 4 points, got %v", poly)
	}
}

func TestChevronApexAlongTop(t *testing.T) {
	f := parse(t, `vexyl 1
meta { name "T"; }
palette { a "#112233"; }
proportion hoist=6 fly=10
chevrons a { from top; depth 4; angle 45; apex 3; }`)
	poly := chevronPolys(f.Layers[0].(*Chevrons), region{w: 10, h: 6})[0]
	if !hasPoint(poly, vec{3, 4}) {
		t.Errorf("chevron %v should have its apex 3 from the hoist", poly)
	}
}

func TestHeartGeometry(t *testing.T) {
	// A lobe radius of 2 and spread of 2 put the tip at 1 + 2*sqrt(2).
	f := parse(t, header+`charge heart a { radius 2; spread 2; at fly=5 hoist=5; }`)
	s := f.Layers[0].(*Charge).Shape
	g := shapeGeom(&s, position(&s, region{w: 20, h: 10}), 0)
	tip := "M5 " + num(5+1+2*math.Sqrt2)
	if !strings.HasPrefix(g.path, tip) {
		t.Errorf("path %q doesn't start at the tip %q", g.path, tip)
	}
	// The notch is where the lobes meet: 1 either side, so sqrt(3) above them.
	notch := "5 " + num(5-math.Sqrt(3))
	if !strings.Contains(g.path, notch) {
		t.Errorf("path %q lacks the notch %q", g.path, notch)
	}
}

func TestHeartDefaultsToClassicSpread(t *testing.T) {
	f := parse(t, header+`charge heart a { radius 2; }`)
	if got := f.Layers[0].(*Charge).Shape.Spread; math.Abs(got-2*math.Sqrt2) > 1e-9 {
		t.Errorf("spread = %v", got)
	}
}

func TestHeartRotatesToPointAlongTheFly(t *testing.T) {
	f := parse(t, header+`charge heart a { radius 2; spread 2; at fly=5 hoist=5; rotate -90; }`)
	s := f.Layers[0].(*Charge).Shape
	g := shapeGeom(&s, vec{5, 5}, 0)
	want := "M" + num(5+1+2*math.Sqrt2) + " 5"
	if !strings.HasPrefix(g.path, want) {
		t.Errorf("path %q doesn't start at %q", g.path, want)
	}
}

func TestSVGChargeColor(t *testing.T) {
	const art = `{ fly 1; hoist 1; markup "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'><rect fill='currentColor'/></svg>"; }`
	out := svgOf(t, parse(t, header+`charge svg b `+art))
	if !strings.Contains(out, `<g color="#445566">`) || !strings.Contains(out, `fill="currentColor"`) {
		t.Errorf("artwork doesn't take its palette color: %s", out)
	}
}

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
`

func TestGradientDefinitions(t *testing.T) {
	f := parse(t, gradientHeader)
	if got := f.Gradients["flow"].Stops; !slices.Equal(got, []float64{0, 0.5, 1}) {
		t.Errorf("even stops = %v", got)
	}
	tests := []struct{ name, want string }{
		{"flow", `x1="0" y1="0" x2="1" y2="0"`},
		{"drop", `x1="0" y1="0" x2="0" y2="1"`},
		{"bend", `x1="0" y1="0" x2="1" y2="1"`},
		{"rise", `x1="0" y1="1" x2="1" y2="0"`},
	}
	for _, tt := range tests {
		out := svgOf(t, parse(t, gradientHeader+`field `+tt.name))
		if !strings.Contains(out, tt.want) {
			t.Errorf("%s: no %q in %s", tt.name, tt.want, out)
		}
	}
	if out := svgOf(t, parse(t, gradientHeader+`field drop`)); !strings.Contains(out, `<stop offset="0.25" stop-color="#112233"/>`) {
		t.Errorf("stop position lost: %s", out)
	}
}

// A vertical gradient has to span each bar, so its polygon can't be the usual one
// that runs on beneath the following bars.
func TestGradientBarsAreTheirTrueWidth(t *testing.T) {
	f := parse(t, gradientHeader+`bars a drop b drop`)
	out := svgOf(t, f)
	for _, want := range []string{`0,2.5 20,2.5 20,5 0,5`, `0,7.5 20,7.5 20,10 0,10`} {
		if !strings.Contains(out, want) {
			t.Errorf("no gradient bar with points %q: %s", want, out)
		}
	}
	// Solid bars still run on, to keep antialiasing from leaving seams.
	if !strings.Contains(out, `0,0 20,0 20,10 0,10`) {
		t.Errorf("first bar should reach the far edge: %s", out)
	}
	// One definition serves both bars.
	if got := strings.Count(out, "<linearGradient"); got != 1 {
		t.Errorf("%d definitions: %s", got, out)
	}
}

func TestGradientSpansCrossAsOneShape(t *testing.T) {
	out := svgOf(t, parse(t, gradientHeader+`cross flow { fly 9 2 9; hoist 4 2 4; }`))
	if !strings.Contains(out, `gradientUnits="userSpaceOnUse" gradientTransform="translate(0 0) scale(20 10)"`) {
		t.Errorf("cross gradient isn't across the region: %s", out)
	}
}

func TestGradientFimbriationAndBorder(t *testing.T) {
	out := svgOf(t, parse(t, gradientHeader+`border flow 1 outside`+"\n"+`charge disc a { radius 1; fimbriate flow 0.5; }`))
	if strings.Count(out, "<linearGradient") != 1 || !strings.Contains(out, `stroke="url(#`) {
		t.Errorf("gradient isn't reused for the border and fimbriation: %s", out)
	}
}

func TestGradientBandKeepsStrokeBeyondRegion(t *testing.T) {
	// A fimbriated band mustn't stroke along the flag's edge, and the fill mustn't
	// stretch a gradient over the part of the band outside the flag.
	out := svgOf(t, parse(t, gradientHeader+`band flow { width 2; fimbriate a 1; }`))
	if !strings.Contains(out, `stroke-width="2"`) {
		t.Fatalf("no fimbriation: %s", out)
	}
	if !strings.Contains(out, `points="0,4 20,4 20,6 0,6" fill="url(#`) {
		t.Errorf("fill isn't the band within the flag: %s", out)
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
	src, err := os.ReadFile("../flags/united-states.kdl")
	if err != nil {
		t.Fatal(err)
	}
	out := svgOf(t, parse(t, string(src)))
	if got := strings.Count(out, `fill="#ffffff"`); got != 50+6 {
		t.Errorf("found %d white shapes, want 50 stars and 6 white stripes", got)
	}
}

func TestEUStarsStayUpright(t *testing.T) {
	src, err := os.ReadFile("../flags/european-union.kdl")
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
	for _, doc := range []string{"../README.md", "../SPEC.md"} {
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
			switch {
			case strings.HasPrefix(example, "vexyl "):
			case strings.HasPrefix(example, "palette "):
				example = "vexyl 1\nmeta { name \"T\"; }\n" + example + "proportion hoist=1 fly=1\n"
			default:
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
		{"svg unknown color", header + `charge svg nope { fly 1; hoist 1; markup "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/>"; }`, "isn't in the palette"},
		{"svg currentColor without color", header + `charge svg { fly 1; hoist 1; markup "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'><rect fill='currentColor'/></svg>"; }`, "needs a palette color"},
		{"gradient unknown color", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a b; }\n", `"b" isn't in the palette`},
		{"gradient of one", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a; }\n", "at least 2 colors"},
		{"gradient of gradients", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a a; h gradient g a; }\n", "solid color is needed"},
		{"gradient bad axis", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a a along=up; }\n", "along must be"},
		{"gradient bad property", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a a up=1; }\n", "unknown property"},
		{"gradient stop count", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a a { stops 0; }; }\n", "2 colors but 1 stops"},
		{"gradient stop range", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a a { stops 0 2; }; }\n", "between 0 and 1"},
		{"gradient stop order", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a a { stops 1 0; }; }\n", "backward"},
		{"gradient on svg", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; g gradient a a; }\nproportion hoist=1 fly=1\ncharge svg g { fly 1; hoist 1; markup \"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/>\"; }", "solid color is needed"},
		{"none in the palette", "vexyl 1\nmeta { name \"T\"; }\npalette { none \"#112233\"; }\n", "reserved"},
		{"crescent circles apart", header + `charge crescent a { radius 1; inner 1; offset 3; }`, "cross"},
		{"sun disc too big", header + `charge sun a { radius 1; disc 1; }`, "smaller than"},
		{"path not path data", header + `charge path a { d "<script>"; box "0 0 1 1"; fly 1; }`, "isn't SVG path data"},
		{"path no box", header + `charge path a { d "M0 0"; fly 1; }`, "needs a `box`"},
		{"pile without reach", header + `pile a`, "needs a `depth`"},
		{"pall without width", header + `pall a`, "needs a `width`"},
		{"quarters count", header + `quarters a b`, "needs 4"},
		{"checks size", header + `checks a b`, "needs `rows`"},
		{"panel both", header + `panel { side top; corner upper-fly; width 1; field a; }`, "not both"},
		{"panel size", header + `panel { field a; }`, "needs a `side`"},
		{"panel edge", header + `panel { fly 1; hoist 1; edge wavy depth=1 count=1; field a; }`, "only a side panel"},
		{"edge kind", header + `bars a { edge curly depth=1 count=1; }`, "wavy or zigzag"},
		{"edge size", header + `bars a { edge wavy depth=1; }`, "needs `period`"},
		{"repeat with ats", header + `charge disc a { radius 1; at center; at center; repeat ring count=2 radius=1; }`, "can't be combined"},
		{"arc of one", header + `charge disc a { radius 1; repeat arc count=1 radius=1 from=0 to=1; }`, "at least 2"},
		{"lines and hollow", header + `charge star a { radius 1; lines 1; hollow 1; }`, "can't be combined"},
		{"grow length", header + `bars a b { grow 1; }`, "`grow` values"},
		{"use unknown", header + `use nope`, "isn't a defined design"},
		{"define taken", header + "define disc { rect { fly 1; hoist 1; }; }\n", "already taken"},
		{"counterchange fimbriated", header + `saltire a { width 1; counterchange; fimbriate b 1; }`, "can't be fimbriated"},
		{"adapt empty", header + `adapt`, "needs `wider`"},
		{"adapt bad rule", header + `adapt { wider stretch; }`, "must be one of"},
		{"adapt bad range", header + `adapt { wider extend; range 2 1; }`, "lowest and highest"},
		{"variant unknown turn", header + `variant v { from flip; }`, "must be one of"},
		{"outline unknown", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; }\nproportion hoist=1 fly=1\noutline flag\n", "unknown form"},
		{"layers after adapt", header + "adapt { wider extend; }\nfield a\n", "out of order"},
		{"bad until", "vexyl 1\nmeta { name \"T\"; until \"soon\"; }\n", "must be YYYY"},
		{"until first", "vexyl 1\nmeta { name \"T\"; date \"2000\"; until \"1999\"; }\n", "comes before"},
		{"bad series", "vexyl 1\nmeta { name \"T\"; series \"United States\"; }\n", "lowercase words"},
		{"unsourced restriction", "vexyl 1\nmeta { name \"T\"; restriction \"No\"; }\n", "needs a `source`"},
		{"law with no name", "vexyl 1\nmeta { name \"T\"; law; }\n", "needs one string"},
		{"bad date", "vexyl 1\nmeta { name \"T\"; date \"last year\"; }\n", "must be YYYY"},
		{"impossible date", "vexyl 1\nmeta { name \"T\"; date \"2026-02-30\"; }\n", "must be YYYY"},
		{"cmyk count", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\" { cmyk 1 2; }; }\n", "4 values"},
		{"cmyk range", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\" { cmyk 101 0 0 0; }; }\n", "from 0 to 100"},
		{"unknown color system", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\" { hsl \"x\"; }; }\n", "unknown here"},
		{"apex without angle", header + `chevrons a { depth 1; apex 2; }`, "needs an `angle`"},
		{"negative apex", header + `chevrons a { depth 1; angle 45; apex -2; }`, "can't be negative"},
		{"heart radius", header + `charge heart a`, "needs a `radius`"},
		{"heart spread", header + `charge heart a { radius 1; spread 2; }`, "must be less than"},
		{"svg cut", header + `field a { cut { svg; }; }`, "can't be used"},
		{"svg repeat", header + `charge svg { fly 1; hoist 1; repeat ring count=2 radius=1; markup "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/>"; }`, "can't be repeated"},
		{"infinite", header + `charge disc a { radius #inf; }`, "finite"},
		{"opacity range", header + `field a { opacity 2; }`, "between 0 and 1"},
		{"duplicate child", header + `field a { opacity 1; opacity 1; }`, "more than once"},
		{"annotation", header + `(x)field a`, "type annotations"},
		{"duplicate property", "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; }\nproportion hoist=1 hoist=2 fly=2\n", "hoist"},
		{"no canton size", header + `canton { field a; }`, "needs `fly` and `hoist`"},
		{"empty group", header + `group`, "at least one layer"},
		{"empty emblem", header + `emblem { along bend; }`, "at least one charge"},
		{"emblem with a field", header + `emblem { field a; charge disc a { radius 1; }; }`, "only hold charges"},
		{"nested emblem", header + `emblem { emblem { charge disc a { radius 1; }; }; }`, "only hold charges"},
		{"emblem grid", header + `emblem { charge disc a { radius 1; repeat grid rows=2 columns=2; }; }`, "needs a region"},
		{"emblem bad axis", header + `emblem { along sideways; charge disc a { radius 1; }; }`, "must be one of"},
		{"emblem arguments", header + `emblem 1 { charge disc a { radius 1; }; }`, "takes no arguments"},
		{"line without step", header + `charge disc a { radius 1; repeat line count=2; }`, "needs a step"},
		{"line unknown property", header + `charge disc a { radius 1; repeat line count=2 fly=1 radius=2; }`, "unknown property"},
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
	src, err := os.ReadFile("../flags/nepal.kdl")
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
	src, err := os.ReadFile("../flags/progress-pride.kdl")
	if err != nil {
		t.Fatal(err)
	}
	f := parse(t, string(src))
	ch := f.Layers[1].(*Chevrons)
	if ch.Colors[0] != "white" || ch.Colors[len(ch.Colors)-1] != "black" {
		t.Errorf("chevrons from the hoist: %v", ch.Colors)
	}
}

func TestRepeatLine(t *testing.T) {
	out := svgOf(t, parse(t, header+`charge disc a { radius 1; at fly=2 hoist=3; repeat line count=3 fly=4 hoist=-1; }`))
	for _, want := range []string{`cx="2" cy="3"`, `cx="6" cy="2"`, `cx="10" cy="1"`} {
		if !strings.Contains(out, want) {
			t.Errorf("no copy at %s: %s", want, out)
		}
	}
}

func TestEmblemFrame(t *testing.T) {
	bend := math.Atan2(10, 20) * 180 / math.Pi
	tests := []struct{ src, want string }{
		{`emblem { charge disc a { radius 1; }; }`, `translate(10 5) rotate(0)`},
		{`emblem { at fly=2 hoist=3; rotate 90; charge disc a { radius 1; }; }`, `translate(2 3) rotate(90)`},
		{`emblem { along bend; charge disc a { radius 1; }; }`, `translate(10 5) rotate(` + num(bend) + `)`},
		{`emblem { along bend-sinister; charge disc a { radius 1; }; }`, `translate(10 5) rotate(` + num(-bend) + `)`},
		{`emblem { along hoist; rotate 10; charge disc a { radius 1; }; }`, `translate(10 5) rotate(100)`},
	}
	for _, tt := range tests {
		if out := svgOf(t, parse(t, header+tt.src)); !strings.Contains(out, tt.want) {
			t.Errorf("%s: no %q in %s", tt.src, tt.want, out)
		}
	}
}

func TestEmblemChargesDefaultToItsOrigin(t *testing.T) {
	out := svgOf(t, parse(t, header+`emblem { at fly=2 hoist=3; charge disc a { radius 1; }; charge disc b { radius 1; at center; }; }`))
	if got := strings.Count(out, `cx="0" cy="0"`); got != 2 {
		t.Errorf("found %d charges at the frame's origin, want 2: %s", got, out)
	}
}

// A cut in an emblem has negative local coordinates, and its mask has to cover
// the whole visible flag, or the charge would be cut away outside it.
func TestEmblemMaskCoversVisibleArea(t *testing.T) {
	out := svgOf(t, parse(t, header+`emblem { at fly=0 hoist=0; charge disc a { radius 1; cut { disc { radius 1; }; }; }; }`))
	reach := num(math.Hypot(20, 10))
	if want := `x="-` + reach + `" y="-` + reach + `"`; !strings.Contains(out, want) {
		t.Errorf("no %q in %s", want, out)
	}
}

func TestSouthKoreaConstruction(t *testing.T) {
	src, err := os.ReadFile("../flags/south-korea.kdl")
	if err != nil {
		t.Fatal(err)
	}
	f := parse(t, string(src))
	var emblems []*Emblem
	for _, l := range f.Layers {
		if e, ok := l.(*Emblem); ok {
			emblems = append(emblems, e)
		}
	}
	if len(emblems) != 2 || emblems[0].Along != "bend" || emblems[1].Along != "bend-sinister" {
		t.Fatalf("emblems should follow both diagonals: %+v", emblems)
	}
	// Each bar is the decree's 1/24 of the hoist across and 1/4 long.
	for _, e := range emblems {
		for _, c := range e.Charges {
			if c.Shape.Kind == "rect" && (c.Shape.Fly != f.Hoist/24 || c.Shape.Hoist != f.Hoist/4) {
				t.Errorf("bar is %v by %v", c.Shape.Fly, c.Shape.Hoist)
			}
		}
	}
}

// Imported flags are mechanical conversions, so they get no golden files, but they
// have to stay valid as the format changes.
func TestImportedFlagsRender(t *testing.T) {
	paths, _ := filepath.Glob("../flags/imported/*/*.kdl")
	for _, path := range paths {
		src, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		f, err := Parse(bytes.NewReader(src), path)
		if err != nil {
			t.Errorf("%v", err)
			continue
		}
		var out bytes.Buffer
		if err := f.WriteSVG(&out, Options{}); err != nil {
			t.Errorf("%s: %v", path, err)
			continue
		}
		assertWellFormed(t, out.Bytes())
	}
}

func render(t *testing.T, src string, opts Options) string {
	t.Helper()
	var out bytes.Buffer
	if err := parse(t, src).WriteSVG(&out, opts); err != nil {
		t.Fatal(err)
	}
	return out.String()
}

func TestNewShapesDraw(t *testing.T) {
	tests := []struct{ name, src, want string }{
		{"panel on a side", `panel { side hoist; width 5; field a; }`, `translate(0 0)`},
		{"panel on the far side", `panel { side fly; width 5; field a; }`, `translate(15 0)`},
		{"panel in a corner", `panel { corner lower-fly; fly 4; hoist 2; field a; }`, `translate(16 8)`},
		{"panel centered", `panel { fly 4; hoist 2; field a; }`, `translate(8 4)`},
		{"canton", `canton { fly 4; hoist 2; field a; }`, `translate(0 0)`},
		{"quarters", `quarters a b b a`, `points="10,5 20,5 20,10 10,10"`},
		{"quarters split", `quarters a b b a { split fly=4 hoist=2; }`, `points="4,2 20,2 20,10 4,10"`},
		{"quarters diagonal", `quarters a b b a { diagonal; }`, `points="10,5 0,0 20,0"`},
		{"pile", `pile a { depth 5; flat 2; }`, `5,4 5,6`},
		{"crescent", `charge crescent a { radius 5; inner 4; offset 2; at center; }`, `<path d="M`},
		{"sun", `charge sun a { radius 3; disc 1; points 3; }`, `Z M`},
		{"lozenge throughout", `charge lozenge a`, `points="10,0 20,5 10,10 0,5"`},
		{"hollow", `charge disc a { radius 1; hollow 0.5; }`, `fill="none" stroke="#112233" stroke-width="0.5"`},
		{"lines", `charge star a { radius 1; lines 0.1; }`, `fill="none"`},
		{"path", `charge path a { d "M0 0H1V1Z"; box "0 0 1 1"; fly 2; }`, `scale(2) translate(-0.5 -0.5)`},
		{"partial ring", `charge ring a { radius 2; inner 1; from 0; to 90; }`, `A2 2 0 0 1`},
		{"arc", `charge disc a { radius 1; repeat arc count=3 radius=2 from=-90 to=90; }`, `cx="10" cy="3"`},
		{"several positions", `charge disc a { radius 1; at fly=1 hoist=1; at fly=2 hoist=2; }`, `cx="2" cy="2"`},
		{"counterchange", `saltire a { width 1; counterchange; }`, `clip-path`},
		{"chevron fimbriation", `chevrons a { depth 5; fimbriate b 1; }`, `stroke="#445566"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := render(t, header+tt.src, Options{})
			if !strings.Contains(out, tt.want) {
				t.Errorf("no %q in %s", tt.want, out)
			}
		})
	}
}

func TestChecksFlow(t *testing.T) {
	cells := func(src string) []string {
		var fills []string
		for _, m := range regexp.MustCompile(`fill="(#\w+)"`).FindAllStringSubmatch(render(t, header+src, Options{}), -1) {
			fills = append(fills, m[1])
		}
		return fills
	}
	want := []string{"#112233", "#445566", "#445566", "#112233"}
	if got := cells(`checks a b { rows 2; columns 2; }`); !slices.Equal(got, want) {
		t.Errorf("got %v", got)
	}
}

func TestRaysByEdge(t *testing.T) {
	f := parse(t, `vexyl 1
meta { name "T"; }
palette { a "#112233"; }
proportion hoist=3 fly=6
rays a a a a a { from lower-hoist; measure edge; ratio 2 2 3 1 1; }`)
	polys := rayPolys(f.Layers[0].(*Rays), region{w: 6, h: 3})
	// The third wedge turns the corner: 4 along the top, the corner, then 1 down.
	for _, want := range []vec{{0, 3}, {4, 0}, {6, 0}, {6, 1}} {
		if !hasPoint(polys[2], want) {
			t.Errorf("wedge %v lacks %v", polys[2], want)
		}
	}
	if !hasPoint(polys[4], vec{6, 3}) {
		t.Errorf("last wedge %v doesn't reach the corner", polys[4])
	}
}

func TestRaysByAngleCoverTheirSweep(t *testing.T) {
	f := parse(t, header+`rays a b { count 4; from hoist; }`)
	polys := rayPolys(f.Layers[0].(*Rays), region{w: 20, h: 10})
	if len(polys) != 4 || !hasPoint(polys[0], vec{0, 5}) || !hasPoint(polys[0], vec{0, 0}) {
		t.Errorf("first wedge should start from the hoist, going up: %v", polys)
	}
}

func TestPallIsOneShapeReachingTheCorners(t *testing.T) {
	s := Shape{Kind: "pall", Edge: "hoist", Width: 2, Junction: 5}
	points := pallPoints(&s, region{w: 20, h: 10})
	if len(points) != 9 {
		t.Fatalf("%d points", len(points))
	}
	// The notch between the arms lies on the center line, and the stem at its width.
	seenNotch := false
	for _, p := range points {
		if math.Abs(p.Hoist-5) < 1e-9 && p.Fly > 0 && p.Fly < 5 {
			seenNotch = true
		}
	}
	if !seenNotch {
		t.Errorf("no notch: %v", points)
	}
}

func TestPanelEdgeIsCenteredOnItsWidth(t *testing.T) {
	out := render(t, header+`panel { side hoist; width 5; edge zigzag depth=2 count=2; field a; }`, Options{})
	// A base at 4 and points at 6, on the line at 5.
	if !strings.Contains(out, `0,0 4,0 6,2.5 4,5 6,7.5 4,10 0,10`) {
		t.Errorf("unexpected edge: %s", out)
	}
}

func TestGapsShowWhatsBeneath(t *testing.T) {
	out := render(t, header+`bars a none b`, Options{})
	if strings.Contains(out, `0,0 20,0 20,10 0,10" fill`) {
		t.Errorf("a bar ran on beneath a gap: %s", out)
	}
	out = render(t, header+`chevrons none a { depth 8; ratio 1 1; }`, Options{})
	if strings.Count(out, "<polygon") != 2 { // the flag's clip and one band
		t.Errorf("want one band: %s", out)
	}
}

func TestDefinesAndUses(t *testing.T) {
	src := `vexyl 1
meta { name "T"; }
palette { a "#112233"; b "#445566"; }
proportion hoist=10 fly=20
define square { path "M0 0H1V1H0Z" box="0 0 1 1"; }
define mini hoist=1 fly=2 { field a; }
define loose { bars a b; }
charge square b { fly 2; hoist 2; repeat line count=2 fly=4; }
use mini
panel { side top; width 2; use loose; }
`
	out := render(t, src, Options{})
	if got := strings.Count(out, `d="M0 0H1V1H0Z"`); got != 2 {
		t.Errorf("%d squares: %s", got, out)
	}
	if !strings.Contains(out, `scale(10 10)`) {
		t.Errorf("design with a grid isn't scaled: %s", out)
	}
}

func TestOutlines(t *testing.T) {
	tests := []struct{ outline, want string }{
		{`outline swallowtail { depth 5; }`, `0,0 20,0 15,5 20,10 0,10`},
		{`outline swallowtail { depth 5; taper 1; }`, `0,0 20,1 15,5 20,9 0,10`},
		{`outline tongued { depth 5; tongue 2; }`, `0,0 20,0 15,4 20,5 15,6 20,10 0,10`},
		{`outline pennant`, `0,0 20,5 0,10`},
		{`outline pennant { tip 2; }`, `0,0 20,4 20,6 0,10`},
		{`outline { path "M0 0H1V1Z" box="0 0 1 1"; }`, `scale(20 10)`},
	}
	base := "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; }\nproportion hoist=10 fly=20\n"
	for _, tt := range tests {
		if out := render(t, base+tt.outline+"\nfield a\n", Options{}); !strings.Contains(out, tt.want) {
			t.Errorf("%s: no %q in %s", tt.outline, tt.want, out)
		}
	}
}

const adaptHeader = `vexyl 1
meta { name "T"; }
palette { a "#112233"; b "#445566"; }
proportion hoist=10 fly=20
`

func TestAdaptRules(t *testing.T) {
	cross := "cross a { fly 5 2 13; hoist 4 2 4; }\n"
	tests := []struct {
		name, src string
		ratio     float64
		want      string
	}{
		{"extend keeps the arm's place", cross + `adapt { wider extend; }`, 3, `5,0 7,0 7,10 5,10`},
		{"cut keeps the arm's place", cross + `adapt { narrower cut; }`, 1, `5,0 7,0 7,10 5,10`},
		{"center moves the arm with the center", cross + `adapt { wider center; }`, 3, `10,0 12,0 12,10 10,10`},
		{"scale keeps the arm's share", cross + `adapt { wider scale; }`, 3, `7.5,0 10.5,0 10.5,10 7.5,10`},
		{"the hoist can change instead", cross + `adapt { narrower hoist-extend; }`, 1, `0,4 20,4 20,6 0,6`},
		{"extend grows the last bar", "bars a b { along hoist; }\n" + `adapt { wider extend; }`, 3, `10,0 10,10 30,10 30,0`},
		{"grow shares it out", "bars a b { along hoist; ratio 1 1; grow 1 0; }\n" + `adapt { wider extend; }`, 3, `20,0 20,10 30,10 30,0`},
		{"bars along the axis are unchanged", "bars a b\n" + `adapt { wider extend; }`, 3, `0,5 30,5 30,10 0,10`},
		{"a charge at the center follows it", "charge disc a { radius 1; }\n" + `adapt { wider extend; }`, 3, `cx="15" cy="5"`},
		{"an explicit position stays", "charge disc a { radius 1; at fly=4 hoist=5; }\n" + `adapt { wider extend; }`, 3, `cx="4" cy="5"`},
		{"an anchor overrides the rule", "charge disc a { radius 1; at fly=18 hoist=5; anchor end; }\n" + `adapt { wider extend; }`, 3, `cx="28" cy="5"`},
		{"center charges can be held to the hoist", "charge disc a { radius 1; anchor start; }\n" + `adapt { wider extend; }`, 3, `cx="10" cy="5"`},
		{"a far side panel stays on its edge", "panel { side fly; width 2; field a; }\n" + `adapt { wider extend; }`, 3, `translate(28 0)`},
		{"a top panel grows", "panel { side top; width 2; bars a b { along hoist; }; }\n" + `adapt { wider extend; }`, 3, `10,0 10,2 30,2 30,0`},
		{"a canton keeps its size", "canton { fly 8; hoist 5; field a; }\n" + `adapt { wider extend; }`, 3, `0,0 8,0 8,5 0,5`},
		{"scaling scales a canton", "canton { fly 8; hoist 5; field a; }\n" + `adapt { wider scale; }`, 3, `0,0 12,0 12,5 0,5`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := render(t, adaptHeader+tt.src, Options{Ratio: tt.ratio})
			if !strings.Contains(out, tt.want) {
				t.Errorf("no %q in %s", tt.want, out)
			}
		})
	}
}

func TestAdaptRefusals(t *testing.T) {
	tests := []struct {
		name, src string
		ratio     float64
		want      string
	}{
		{"no rules", `field a`, 3, "doesn't say how"},
		{"wrong direction", `adapt { wider extend; }`, 1, "no rule for this direction"},
		{"out of range", `adapt { range 1 2.5; wider extend; }`, 3, "only adapts between"},
		{"cut too far", "cross a { fly 5 2 3; hoist 4 2 4; }\n" + `adapt { narrower cut; }`, 0.5, "can't be cut"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var out bytes.Buffer
			err := parse(t, adaptHeader+tt.src).WriteSVG(&out, Options{Ratio: tt.ratio})
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Errorf("err = %v, want %q", err, tt.want)
			}
		})
	}
}

func TestOwnProportionNeedsNoRules(t *testing.T) {
	if out := render(t, adaptHeader+`field a`, Options{Ratio: 2}); !strings.Contains(out, `viewBox="0 0 20 10"`) {
		t.Errorf("unexpected output: %s", out)
	}
}

func TestVariants(t *testing.T) {
	src, err := os.ReadFile("testdata/variants.kdl")
	if err != nil {
		t.Fatal(err)
	}
	vertical := render(t, string(src), Options{Variant: "vertical"})
	if !strings.Contains(vertical, `viewBox="0 0 20 40"`) || !strings.Contains(vertical, `matrix(0 1 1 0 0 0)`) {
		t.Errorf("vertical should be transposed at 2: %s", vertical)
	}
	// The crescent turns back around the center of the adapted flag.
	if !strings.Contains(vertical, `translate(20 10) matrix(0 1 1 0 0 0) translate(-20 -10)`) {
		t.Errorf("charge isn't kept upright: %s", vertical)
	}
	banner := render(t, string(src), Options{Variant: "banner"})
	if !strings.Contains(banner, `matrix(0 1 -1 0 20 0)`) || !strings.Contains(banner, `0,0 30,0 24,10 30,20 0,20`) {
		t.Errorf("banner should rotate and be swallowtailed: %s", banner)
	}
	plain := render(t, string(src), Options{Variant: "plain"})
	if strings.Contains(plain, "<path") {
		t.Errorf("variant layers should replace the flag's: %s", plain)
	}
	var out bytes.Buffer
	if err := parse(t, string(src)).WriteSVG(&out, Options{Variant: "nope"}); err == nil {
		t.Error("unknown variant accepted")
	}
}

func TestVariantRatioNeedsRules(t *testing.T) {
	_, err := Parse(strings.NewReader(adaptHeader+`variant tall { ratio 3; }`), "test")
	if err == nil || !strings.Contains(err.Error(), "no `adapt` rules") {
		t.Errorf("err = %v", err)
	}
}

func TestReverse(t *testing.T) {
	mirrored := render(t, adaptHeader+`field a`, Options{Side: "reverse"})
	if !strings.Contains(mirrored, `matrix(-1 0 0 1 20 0)`) {
		t.Errorf("default reverse should mirror: %s", mirrored)
	}
	own := render(t, adaptHeader+"field a\nreverse {\n  field b\n}\n", Options{Side: "reverse"})
	if strings.Contains(own, "matrix") || !strings.Contains(own, "#445566") {
		t.Errorf("own reverse should be painted as written: %s", own)
	}
	front := render(t, adaptHeader+"field a\nreverse {\n  field b\n}\n", Options{})
	if strings.Contains(front, "#445566") {
		t.Errorf("reverse leaked onto the front: %s", front)
	}
}

func TestFormsOfAFlagHaveDistinctIDs(t *testing.T) {
	src := adaptHeader + "field a\nadapt { wider extend; }\n"
	id := regexp.MustCompile(` id="([^"]+)"`)
	a := id.FindStringSubmatch(render(t, src, Options{}))[1]
	b := id.FindStringSubmatch(render(t, src, Options{Ratio: 3}))[1]
	if a == b {
		t.Errorf("both use id %q", a)
	}
}

func TestFitPadding(t *testing.T) {
	src := adaptHeader + "field a\n"
	tests := []struct {
		name string
		opts Options
		want string
	}{
		{"center by default", Options{Ratio: 4, Fit: "pad"}, `viewBox="-10 0 40 10"`},
		{"start", Options{Ratio: 4, Fit: "pad", Align: "start"}, `viewBox="0 0 40 10"`},
		{"end", Options{Ratio: 4, Fit: "pad", Align: "end"}, `viewBox="-20 0 40 10"`},
		{"taller, centered", Options{Ratio: 1, Fit: "pad"}, `viewBox="0 -5 20 20"`},
		{"taller, top", Options{Ratio: 1, Fit: "pad", Align: "start"}, `viewBox="0 0 20 20"`},
		{"taller, bottom", Options{Ratio: 1, Fit: "pad", Align: "end"}, `viewBox="0 -10 20 20"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if out := render(t, src, tt.opts); !strings.Contains(out, tt.want) {
				t.Errorf("no %q in %s", tt.want, out)
			}
		})
	}
}

func TestFitPadsFromNearestProportion(t *testing.T) {
	src := adaptHeader + "field a\nadapt { range 1 3; wider extend; }\n"
	// The rules reach 3, so the flag is 30 wide, then padded to 4.
	out := render(t, src, Options{Ratio: 4, Fit: "pad", Height: 100})
	if !strings.Contains(out, `viewBox="-5 0 40 10"`) || !strings.Contains(out, `points="0,0 30,0 30,10 0,10"`) {
		t.Errorf("should adapt to 3, then pad: %s", out)
	}
	if !strings.Contains(out, `width="400" height="100"`) {
		t.Errorf("image should have the canvas's shape: %s", out)
	}
}

func TestFitPadsFromOwnProportionWhenTheDesignCantReach(t *testing.T) {
	src := adaptHeader + "cross a { fly 5 2 3; hoist 4 2 4; }\nadapt { narrower cut; }\n"
	out := render(t, src, Options{Ratio: 0.5, Fit: "pad"})
	if !strings.Contains(out, `viewBox="0 -15 20 40"`) {
		t.Errorf("should pad from the flag's own shape: %s", out)
	}
}

func TestFitPadsTurnedFlagsInTheirFinalShape(t *testing.T) {
	src := adaptHeader + "field a\nvariant v { from transpose; }\n"
	// A ratio of 4 before turning is a canvas 4 times taller than wide.
	out := render(t, src, Options{Variant: "v", Ratio: 4, Fit: "pad"})
	if !strings.Contains(out, `viewBox="0 -10 10 40"`) {
		t.Errorf("unexpected canvas: %s", out)
	}
}

func TestFitRefusals(t *testing.T) {
	var out bytes.Buffer
	f := parse(t, adaptHeader+"field a\n")
	if err := f.WriteSVG(&out, Options{Ratio: 4}); err == nil || !strings.Contains(err.Error(), "doesn't say how") {
		t.Errorf("should refuse by default: %v", err)
	}
	if err := f.WriteSVG(&out, Options{Ratio: 4, Fit: "squash"}); err == nil {
		t.Error("unknown fit accepted")
	}
	if err := f.WriteSVG(&out, Options{Ratio: 4, Fit: "pad", Align: "up"}); err == nil {
		t.Error("unknown align accepted")
	}
}

func TestMetaVersionAndDate(t *testing.T) {
	f := parse(t, `vexyl 1
meta { name "T"; version "50-star"; date "1960-07-04"; }
palette { a "#112233"; }
proportion hoist=1 fly=1`)
	if f.Meta.Version != "50-star" || f.Meta.Date != "1960-07-04" {
		t.Errorf("got %+v", f.Meta)
	}
	for _, date := range []string{"1960", "1960-07", "1960-07-04"} {
		parse(t, `vexyl 1
meta { name "T"; date "`+date+`"; }
palette { a "#112233"; }
proportion hoist=1 fly=1`)
	}
}

func TestMetaRecords(t *testing.T) {
	f := parse(t, `vexyl 1
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
proportion hoist=1 fly=1`)
	m := f.Meta
	if m.Series != "united-states" || m.Until != "1960-07-04" || !slices.Equal(m.Notes, []string{"First", "Second"}) {
		t.Errorf("got %+v", m)
	}
	if len(m.Laws) != 2 || m.Laws[0].Text != "A Flag Code" || len(m.Laws[0].Sources) != 2 || len(m.Laws[1].Sources) != 0 {
		t.Errorf("laws: %+v", m.Laws)
	}
	if len(m.Restrictions) != 1 || m.Restrictions[0].Sources[0] != "https://example.test/c" {
		t.Errorf("restrictions: %+v", m.Restrictions)
	}
	// They're records, so they don't reach the drawing.
	if out := svgOf(t, f); strings.Contains(out, "First") {
		t.Errorf("note leaked into output: %s", out)
	}
}

func TestColorReferences(t *testing.T) {
	f := parse(t, `vexyl 1
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
field a`)
	want := []ColorRef{{"pantone", "301 C"}, {"ncs", "4055-R95B"}, {"cmyk", "100 50.5 0 10"},
		{"dye", "One"}, {"dye", "Two"}, {"CIE xyY", "0.1 0.2 3"}}
	if !slices.Equal(f.ColorRefs["a"], want) {
		t.Errorf("got %v", f.ColorRefs["a"])
	}
	if len(f.ColorRefs["b"]) != 0 {
		t.Errorf("b has references: %v", f.ColorRefs["b"])
	}
	// They're records only, so they must not reach the drawing.
	var out bytes.Buffer
	if err := f.WriteSVG(&out, Options{}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "301 C") {
		t.Errorf("reference leaked into output: %s", out.String())
	}
}

const foldHeader = `vexyl 1
meta { name "T"; }
palette { a "#112233"; b "#445566"; }
proportion hoist=10 fly=20
field a
`

func foldedFacets(t *testing.T, fold string) []facet {
	t.Helper()
	f := parse(t, foldHeader+fold)
	shape, err := f.foldShape()
	if err != nil {
		t.Fatal(err)
	}
	stack, err := foldFacets(shape, f.Folds["f"], 0)
	if err != nil {
		t.Fatal(err)
	}
	return stack
}

func TestFoldInHalf(t *testing.T) {
	stack := foldedFacets(t, `fold f { over along=hoist at=10 move=fly; }`)
	if len(stack) != 2 {
		t.Fatalf("%d facets", len(stack))
	}
	if stack[0].flipped || !stack[1].flipped {
		t.Errorf("the moved half should be flipped and on top: %+v", stack)
	}
	x, _, w, _ := bounds(append(stack[0].poly, stack[1].poly...))
	if x != 0 || w != 10 {
		t.Errorf("should lie over the hoist half: x=%v w=%v", x, w)
	}
	// The fly end's corner lands back on the hoist's.
	if got := stack[1].place.apply(vec{20, 0}); !near(got, vec{0, 0}) {
		t.Errorf("fly corner went to %v", got)
	}
}

func TestFoldDirections(t *testing.T) {
	under := foldedFacets(t, `fold f { under along=hoist at=10 move=fly; }`)
	if !under[0].flipped || under[1].flipped {
		t.Errorf("under should put the moved half at the back: %+v", under)
	}
	tuck := foldedFacets(t, `fold f { tuck along=hoist at=10 move=fly; }`)
	if len(tuck) != 1 || tuck[0].flipped {
		t.Errorf("a tuck should hide the moved part: %+v", tuck)
	}
}

// Folding twice over reverses the moved layers: what was on top ends up lowest.
func TestFoldStacksInReverse(t *testing.T) {
	stack := foldedFacets(t, `fold f { over along=hoist at=10 move=fly; over along=fly at=5 move=bottom; }`)
	if len(stack) != 4 {
		t.Fatalf("%d facets", len(stack))
	}
	// Kept: the upper halves, back then front. Moved: their lower halves, with the one
	// that was on top flipping face up again and landing lowest.
	want := []bool{false, true, false, true}
	for i, f := range stack {
		if f.flipped != want[i] {
			t.Errorf("facet %d flipped = %v, want %v", i, f.flipped, want[i])
		}
	}
}

func TestFoldDiagonal(t *testing.T) {
	stack := foldedFacets(t, `fold f { over through="20 0 10 10" move="20 10"; }`)
	if len(stack) != 2 {
		t.Fatalf("%d facets", len(stack))
	}
	// The lower fly corner lands on the top edge.
	if got := stack[1].place.apply(vec{20, 10}); !near(got, vec{10, 0}) {
		t.Errorf("corner went to %v", got)
	}
}

func TestFoldRendering(t *testing.T) {
	out := render(t, foldHeader+`fold f { over along=hoist at=10 move=fly; }`, Options{Fold: "f"})
	if !strings.Contains(out, `viewBox="0 0 10 10"`) {
		t.Errorf("should crop to the folded flag: %s", out)
	}
	if !strings.Contains(out, `<use href="#`) || !strings.Contains(out, `matrix(-1 0 0 1 20 0)`) {
		t.Errorf("should place artwork through each facet: %s", out)
	}
	assertWellFormed(t, []byte(out))
	first := render(t, foldHeader+`fold f { over along=hoist at=10 move=fly; over along=fly at=5 move=top; }`, Options{Fold: "f", FoldStep: 1})
	if !strings.Contains(first, `viewBox="0 0 10 10"`) {
		t.Errorf("should stop after the step asked for: %s", first)
	}
}

func TestFoldUsesTheFlagsOwnReverse(t *testing.T) {
	out := render(t, foldHeader+"reverse {\n  field b\n}\n"+`fold f { over along=hoist at=10 move=fly; }`, Options{Fold: "f"})
	if !strings.Contains(out, "#445566") || strings.Count(out, "<use") != 2 {
		t.Errorf("flipped facets should show the back: %s", out)
	}
}

func TestFoldRefusals(t *testing.T) {
	bad := []struct{ name, fold, want string }{
		{"crease misses the flag", `fold f { over along=hoist at=30 move=fly; }`, "nothing is on the side"},
		{"everything moves", `fold f { over along=hoist at=30 move=hoist; }`, "nothing is left"},
		{"point on the crease", `fold f { over through="0 0 1 1" move="5 5"; }`, "on its crease"},
		{"wrong side name", `fold f { over along=hoist at=5 move=top; }`, "moves hoist or fly"},
		{"bad numbers", `fold f { over through="1 2" move="3 4"; }`, "4 numbers"},
		{"no crease", `fold f { over move=top; }`, "needs along"},
		{"no steps", `fold f { description "x"; }`, "at least one step"},
	}
	for _, tt := range bad {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Parse(strings.NewReader(foldHeader+tt.fold), "test")
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Errorf("err = %v, want %q", err, tt.want)
			}
		})
	}
	f := parse(t, foldHeader+"variant v { from rotate; }\n"+`fold f { over along=hoist at=10 move=fly; }`)
	var out bytes.Buffer
	if err := f.WriteSVG(&out, Options{Fold: "nope"}); err == nil {
		t.Error("unknown fold accepted")
	}
	if err := f.WriteSVG(&out, Options{Fold: "f", Variant: "v"}); err == nil {
		t.Error("a fold of a turned variant was accepted")
	}
}

func TestFinishedUSFoldIsABlueTriangle(t *testing.T) {
	src, err := os.ReadFile("../flags/united-states.kdl")
	if err != nil {
		t.Fatal(err)
	}
	f := parse(t, string(src))
	shape, err := f.foldShape()
	if err != nil {
		t.Fatal(err)
	}
	stack, err := foldFacets(shape, f.Folds["triangle"], 0)
	if err != nil {
		t.Fatal(err)
	}
	var all []vec
	for _, fc := range stack {
		all = append(all, fc.poly...)
	}
	_, _, w, h := bounds(all)
	if math.Abs(w-h) > 1e-6 {
		t.Errorf("finished shape is %v by %v, not a right triangle's square bounds", w, h)
	}
	// Every point visible on top has to come from the canton, within 9.88 of the hoist.
	top := stack[len(stack)-1]
	det := top.place.a*top.place.d - top.place.b*top.place.c
	for _, p := range top.poly {
		q := p.sub(vec{top.place.e, top.place.f})
		flat := vec{(top.place.d*q.x - top.place.c*q.y) / det, (top.place.a*q.y - top.place.b*q.x) / det}
		if flat.x > 9.88+1e-6 || flat.y > 7+1e-6 {
			t.Errorf("top facet shows %v, outside the canton", flat)
		}
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
	f.Add(header + `emblem { along bend; charge rect a { fly 1; hoist 2; repeat line count=2 fly=3; cut { disc { radius 1; }; }; }; }`)
	f.Add(header + `border a 1 outside` + "\n" + `field a`)
	f.Add(header + `panel { side hoist; width 2; edge zigzag depth=1 count=3; rays a b { count 5; measure edge; }; }`)
	f.Add(header + "field a\nfold f { over along=hoist at=5 move=fly; under through=\"0 0 1 1\" move=\"0 1\"; tuck along=fly at=2 move=top; }\n")
	f.Add(header + `pall a { width 1; }` + "\n" + `pile b { depth 1; }` + "\n" + `quarters a b a b { diagonal; }` + "\n" + `checks a b { rows 2; columns 2; }`)
	f.Add(header + `charge sun a { radius 2; disc 1; }` + "\n" + `charge crescent a { radius 2; inner 2; offset 1; }`)
	f.Add(header + "bars a b { edge wavy depth=1 period=2; }\nadapt { wider extend; narrower hoist-center; }\nvariant v { from rotate; upright; ratio 3; }\nreverse { field a; }\n")
	f.Fuzz(func(t *testing.T, src string) {
		flag, err := Parse(strings.NewReader(src), "fuzz")
		if err != nil {
			return
		}
		var out bytes.Buffer
		if err := flag.WriteSVG(&out, Options{}); err != nil {
			// A border needing an outside on a shape with none is refused here.
			return
		}
		assertWellFormed(t, out.Bytes())
		for name := range flag.Folds {
			out.Reset()
			if err := flag.WriteSVG(&out, Options{Fold: name}); err == nil {
				assertWellFormed(t, out.Bytes())
			}
		}
		for _, opts := range []Options{{Ratio: 1}, {Ratio: 3}, {Side: "reverse"}, {Ratio: 5, Fit: "pad"}} {
			out.Reset()
			if err := flag.WriteSVG(&out, opts); err == nil {
				assertWellFormed(t, out.Bytes())
			}
		}
		for name := range flag.Variants {
			out.Reset()
			if err := flag.WriteSVG(&out, Options{Variant: name}); err == nil {
				assertWellFormed(t, out.Bytes())
			}
		}
	})
}
