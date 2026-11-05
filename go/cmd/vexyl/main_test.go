// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const sweden = "../../../flags/sweden.kdl"

func TestRenderToStdout(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"render", "-height", "100", sweden}, nil, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), `width="160" height="100"`) {
		t.Errorf("unexpected output: %s", out.String())
	}
}

func TestRenderToFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "out.svg")
	var out bytes.Buffer
	if err := run([]string{"render", "-o", path, sweden}, nil, &out); err != nil {
		t.Fatal(err)
	}
	if out.Len() != 0 {
		t.Errorf("wrote to stdout too: %s", out.String())
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(data, []byte("<svg ")) {
		t.Errorf("unexpected file: %s", data)
	}
}

func TestRenderFromStdin(t *testing.T) {
	src, err := os.ReadFile(sweden)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := run([]string{"render", "-"}, bytes.NewReader(src), &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "<title>Sweden</title>") {
		t.Errorf("unexpected output: %s", out.String())
	}
}

func TestRenderOptions(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"render", "-ratio", "1:2", "-height", "100", sweden}, nil, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), `width="200" height="100"`) {
		t.Errorf("unexpected output: %s", out.String())
	}
	out.Reset()
	if err := run([]string{"render", "-variant", "vertical", "-height", "190", "../../../flags/united-states.kdl"}, nil, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), `width="100" height="190"`) {
		t.Errorf("unexpected output: %s", out.String()[:200])
	}
	out.Reset()
	if err := run([]string{"render", "-side", "reverse", sweden}, nil, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "matrix(-1 0 0 1 16 0)") {
		t.Errorf("unexpected output: %s", out.String()[:200])
	}
}

func TestRenderPaddedAndFolded(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"render", "-ratio", "1:4", "-fit", "pad", "-align", "left", "-height", "10", sweden}, nil, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), `width="40" height="10"`) {
		t.Errorf("unexpected output: %s", out.String()[:200])
	}
	out.Reset()
	if err := run([]string{"render", "-fold", "triangle", "-fold-step", "1", "../../../flags/united-states.kdl"}, nil, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "<use") {
		t.Errorf("unexpected output: %s", out.String()[:200])
	}
}

func TestInfo(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"info", "../../../flags/united-states.kdl"}, nil, &out); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"name: United States", "version: 50-star", "date: 1960-07-04", "variants: vertical", "folds: triangle"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("no %q in %s", want, out.String())
		}
	}
	out.Reset()
	if err := run([]string{"info", "../../../flags/sweden.kdl"}, nil, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "ncs 4055-R95B") {
		t.Errorf("no color reference in %s", out.String())
	}
}

func TestErrors(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want string
	}{
		{"no command", nil, "usage"},
		{"unknown command", []string{"paint"}, "unknown command"},
		{"render no file", []string{"render"}, "one file"},
		{"render two files", []string{"render", sweden, sweden}, "one file"},
		{"bad height", []string{"render", "-height", "0", sweden}, "positive"},
		{"missing file", []string{"render", "no-such.kdl"}, "no-such.kdl"},
		{"check no file", []string{"check"}, "at least one"},
		{"check missing", []string{"check", "no-such.kdl"}, "1 of 1"},
		{"bad ratio", []string{"render", "-ratio", "wide", sweden}, "hoist then fly"},
		{"bad align", []string{"render", "-align", "up", sweden}, "-align must be"},
		{"unknown fold", []string{"render", "-fold", "nope", sweden}, "no fold"},
		{"info no file", []string{"info"}, "one file"},
		{"unknown variant", []string{"render", "-variant", "nope", sweden}, "no variant"},
		{"unknown side", []string{"render", "-side", "edge", sweden}, "unknown side"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := run(tt.args, strings.NewReader(""), &bytes.Buffer{})
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Errorf("err = %v, want one containing %q", err, tt.want)
			}
		})
	}
}
