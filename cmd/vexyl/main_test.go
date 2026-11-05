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

const sweden = "../../flags/sweden.kdl"

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
