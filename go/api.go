// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
)

// Problem is one thing wrong with a document. Its Line and Column are 0 if it has
// no one place, and its Node is empty if it isn't about one node.
type Problem struct {
	Source       string
	Line, Column int
	Node         string
	Message      string
}

func (p Problem) Error() string {
	var b strings.Builder
	if p.Line > 0 {
		if p.Source != "" {
			b.WriteString(p.Source + ":")
		}
		fmt.Fprintf(&b, "%d:%d: ", p.Line, p.Column)
	}
	if p.Node != "" {
		b.WriteString(p.Node + ": ")
	}
	b.WriteString(p.Message)
	return b.String()
}

// Problems is every problem found in a document.
type Problems []Problem

func (ps Problems) Error() string {
	lines := make([]string, len(ps))
	for i, p := range ps {
		lines[i] = p.Error()
	}
	return strings.Join(lines, "\n")
}

// syntaxPlace finds where the KDL parser says a syntax error is.
var syntaxPlace = regexp.MustCompile(`:(\d+):(\d+):`)

func syntaxProblem(err error) Problem {
	p := Problem{Message: err.Error()}
	if m := syntaxPlace.FindStringSubmatch(err.Error()); m != nil {
		p.Line, _ = strconv.Atoi(m[1])
		p.Column, _ = strconv.Atoi(m[2])
	}
	return p
}

// Validate reports every problem in a document, or nothing if it's valid.
func Validate(r io.Reader, name string) Problems {
	_, err := Parse(r, name)
	if err == nil {
		return nil
	}
	var ps Problems
	if errors.As(err, &ps) {
		return ps
	}
	return Problems{syntaxProblem(err)}
}

// ParseString reads a Vexyl document from a string.
func ParseString(src, name string) (*Flag, error) {
	return Parse(strings.NewReader(src), name)
}

// SVG renders the flag as an SVG document.
func (f *Flag) SVG(opts Options) (string, error) {
	var out bytes.Buffer
	if err := f.WriteSVG(&out, opts); err != nil {
		return "", err
	}
	return out.String(), nil
}

// Element is a node of an SVG document, for code that wants to change or embed one.
type Element struct {
	Name     string
	Attrs    []Attr
	Children []*Element
}

// Attr is an attribute of an Element, as it's written in the document.
type Attr struct {
	Name, Value string
}

// SVGTree renders the flag as a tree of SVG elements. Vexyl's SVG has no text content.
func (f *Flag) SVGTree(opts Options) (*Element, error) {
	var out bytes.Buffer
	if err := f.WriteSVG(&out, opts); err != nil {
		return nil, err
	}
	var root *Element
	var open []*Element
	d := xml.NewDecoder(&out)
	for {
		tok, err := d.RawToken()
		if err == io.EOF {
			return root, nil
		}
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			e := &Element{Name: rawName(t.Name)}
			for _, a := range t.Attr {
				e.Attrs = append(e.Attrs, Attr{rawName(a.Name), a.Value})
			}
			if len(open) == 0 {
				root = e
			} else {
				parent := open[len(open)-1]
				parent.Children = append(parent.Children, e)
			}
			open = append(open, e)
		case xml.EndElement:
			open = open[:len(open)-1]
		}
	}
}

func rawName(n xml.Name) string {
	if n.Space != "" {
		return n.Space + ":" + n.Local
	}
	return n.Local
}
