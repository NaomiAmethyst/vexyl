// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"bytes"
	"compress/flate"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"regexp"
	"strings"
	"testing"
)

const shareSample = `vexyl 1
meta { name "T"; }
palette { a "#112233"; b "#445566"; }
proportion hoist=10 fly=20
field a
`

func TestShareDictionaryIsTheNormativeFile(t *testing.T) {
	want, err := os.ReadFile("../share/v1.dict")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(want, ShareDictionary) {
		t.Fatal("the embedded dictionary differs from share/v1.dict")
	}
	sum := sha256.Sum256(want)
	if got := hex.EncodeToString(sum[:]); got != "92062df2fd010bea13d1aefb30c2cfbb2ad6aee5a60e8f8e2d2455516c1c6b97" {
		t.Fatalf("share/v1.dict has changed, which breaks every link already sent: %s", got)
	}
}

func TestShareRoundTrip(t *testing.T) {
	for _, source := range []string{shareSample, "", "é\r\n\xef\xbb\xbf", strings.Repeat("a", ShareMaxBytes)} {
		link, err := ShareEncode(source)
		if err != nil {
			t.Fatal(err)
		}
		if !regexp.MustCompile(`^v1\.[A-Za-z0-9_-]*$`).MatchString(link) {
			t.Fatalf("not a link: %.40s", link)
		}
		back, err := ShareDecode(link)
		if err != nil {
			t.Fatal(err)
		}
		if back != source {
			t.Fatalf("read back %d bytes for %d", len(back), len(source))
		}
	}
}

func TestShareEncodeRefusesTooMuch(t *testing.T) {
	if _, err := ShareEncode(strings.Repeat("a", ShareMaxBytes+1)); err == nil {
		t.Fatal("wrote a link over the limit")
	}
}

func TestShareDecodeStopsAtTheLimit(t *testing.T) {
	var out bytes.Buffer
	w, _ := flate.NewWriterDict(&out, flate.BestCompression, ShareDictionary)
	// Eight times the limit, so a reader that only checks afterward would have made all of it.
	chunk := make([]byte, 1<<20)
	for range 8 * 8 {
		w.Write(chunk)
	}
	w.Close()
	_, err := ShareDecode("v1." + base64.RawURLEncoding.EncodeToString(out.Bytes()))
	if err == nil || !strings.Contains(err.Error(), "limit") {
		t.Fatalf("got %v", err)
	}
}

func TestShareDecodeRefuses(t *testing.T) {
	good, _ := ShareEncode(shareSample)
	for name, link := range map[string]string{
		"no version": good[3:], "v2": "v2" + good[2:], "padding": good + "=", "newline": good[:9] + "\n" + good[9:],
		"plus": good[:9] + "+" + good[10:], "empty": "v1.", "cut": good[:len(good)/2], "extra": "v1." + base64.RawURLEncoding.EncodeToString(append(mustBody(t, good), 0)),
	} {
		if _, err := ShareDecode(link); err == nil {
			t.Errorf("%s: should be refused", name)
		}
	}
}

func mustBody(t *testing.T, link string) []byte {
	t.Helper()
	body, err := base64.RawURLEncoding.DecodeString(link[3:])
	if err != nil {
		t.Fatal(err)
	}
	return body
}

const taggedSample = `vexyl 1
meta { name "T"; }
palette { a "#112233"; b "#445566"; __proto__ "#778899"; }
proportion hoist=10 fly=20
define inner {
  charge disc a { radius 1; }
  field b
}
bars a b
canton {
  fly 8
  hoist 5
  field a
  charge star b { radius 1; repeat grid rows=2 columns=2; }
}
group {
  clip { disc { radius 3; }; }
  cut { disc { radius 1; }; }
  use inner
}
emblem { charge disc b { radius 1; }; charge disc a { radius 1; at fly=2 hoist=0; }; }
reverse { field a; }
variant "a/b%" { field b; }
variant turned { from transpose; }
fold half { over along=fly at=5 move=bottom; }
`

var tagAttr = regexp.MustCompile(` data-vexyl-layer="[^"]*"`)

func TestTagsChangeNothingElse(t *testing.T) {
	f, err := ParseString(taggedSample, "t")
	if err != nil {
		t.Fatal(err)
	}
	for _, opts := range []Options{{}, {Side: "reverse"}, {Variant: "a/b%"}, {Variant: "turned"}, {Fold: "half"}, {Ratio: Float(1), Fit: "pad"}} {
		plain, err := f.SVG(opts)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(plain, TagAttribute) {
			t.Fatalf("%+v: a plain render has tags", opts)
		}
		opts.Tags = true
		tagged, err := f.SVG(opts)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(tagged, TagAttribute) {
			t.Fatalf("%+v: no tags", opts)
		}
		if got := tagAttr.ReplaceAllString(tagged, ""); got != plain {
			t.Fatalf("%+v: differs apart from its tags:\n%s\n---\n%s", opts, got, plain)
		}
	}
}

func TestTagPaths(t *testing.T) {
	f, err := ParseString(taggedSample, "t")
	if err != nil {
		t.Fatal(err)
	}
	found := func(opts Options) map[string]bool {
		opts.Tags = true
		text, err := f.SVG(opts)
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]bool{}
		for _, m := range regexp.MustCompile(`data-vexyl-layer="([^"]*)"`).FindAllStringSubmatch(text, -1) {
			out[m[1]] = true
		}
		return out
	}
	same := func(got map[string]bool, want ...string) {
		t.Helper()
		if len(got) != len(want) {
			t.Fatalf("got %v, want %v", got, want)
		}
		for _, w := range want {
			if !got[w] {
				t.Fatalf("got %v, want %v", got, want)
			}
		}
	}
	same(found(Options{}), "0", "1.0", "1.1", "2.0", "3.0", "3.1")
	same(found(Options{Side: "reverse"}), "reverse/0")
	same(found(Options{Variant: "a/b%"}), "variant/a%2Fb%25/0")
	same(found(Options{Variant: "turned"}), "0", "1.0", "1.1", "2.0", "3.0", "3.1")
}

func TestLocate(t *testing.T) {
	spans := Locate(taggedSample)
	at := map[string]Span{}
	for _, s := range spans {
		at[s.Path] = s
	}
	for path, lines := range map[string][2]int{"meta": {2, 2}, "palette/__proto__": {3, 3}, "define/inner": {5, 8}, "define/inner/1": {7, 7},
		"0": {9, 9}, "1": {10, 15}, "1.1": {14, 14}, "2.0": {19, 19}, "reverse/0": {22, 22}, "variant/a%2Fb%25/0": {23, 23}, "fold/half": {25, 25}} {
		if s, ok := at[path]; !ok || s.Line != lines[0] || s.EndLine != lines[1] {
			t.Errorf("%s: %+v, want %v", path, s, lines)
		}
	}
	if s, ok := LayerAt(spans, 14); !ok || s.Path != "1.1" {
		t.Errorf("line 14 leads to %+v", s)
	}
	if s, ok := LayerAt(spans, 11); !ok || s.Path != "1" {
		t.Errorf("line 11 leads to %+v", s)
	}
	if Locate("bars {") != nil {
		t.Error("found something in a document that isn't KDL")
	}
	if got := Locate("vexyl 1\r\nbars a\r\n"); len(got) != 2 || got[1].Line != 2 {
		t.Errorf("CRLF: %+v", got)
	}
	if ParentPath("variant/a.b/1.2") != "variant/a.b/1" || ParentPath("variant/a.b/1") != "" || ParentPath("3") != "" {
		t.Error("ParentPath")
	}
	if DecodePathName(EncodePathName("a/%2F")) != "a/%2F" {
		t.Error("names don't survive being in a path")
	}
}
