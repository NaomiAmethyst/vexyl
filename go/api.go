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
	"unicode/utf8"
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

// syntaxProblem is what the KDL parser reported, which stops at the first syntax error.
// Its columns count bytes, so that's put right.
func syntaxProblem(err error, src []byte) Problem {
	p := Problem{Message: err.Error()}
	m := syntaxPlace.FindStringSubmatch(err.Error())
	if m == nil {
		return p
	}
	p.Line, _ = strconv.Atoi(m[1])
	p.Column, _ = strconv.Atoi(m[2])
	lines := bytes.Split(src, []byte{'\n'})
	if p.Line >= 1 && p.Line <= len(lines) && p.Column >= 1 && p.Column-1 <= len(lines[p.Line-1]) {
		p.Column = utf8.RuneCount(lines[p.Line-1][:p.Column-1]) + 1
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
	return Problems{{Message: err.Error()}}
}

// ValidateString reports every problem in a document held in a string.
func ValidateString(src, name string) Problems {
	return Validate(strings.NewReader(src), name)
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
	Name  string
	Attrs []Attr
	// Text is what's inside a title or desc, the only elements that hold any.
	Text     string
	Children []*Element
}

// String writes the element out as XML, which draws the same as Flag.SVG.
func (e *Element) String() string {
	var b strings.Builder
	e.write(&b)
	return b.String()
}

func (e *Element) write(b *strings.Builder) {
	b.WriteString("<" + e.Name)
	for _, a := range e.Attrs {
		b.WriteString(" " + a.Name + `="` + esc(a.Value) + `"`)
	}
	if e.Text == "" && len(e.Children) == 0 {
		b.WriteString("/>")
		return
	}
	b.WriteString(">" + esc(e.Text))
	for _, c := range e.Children {
		c.write(b)
	}
	b.WriteString("</" + e.Name + ">")
}

// Attr is an attribute of an Element, as it's written in the document.
type Attr struct {
	Name, Value string
}

// SVGTree renders the flag as a tree of SVG elements. Only a title or desc holds any text.
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
		case xml.CharData:
			if n := len(open); n > 0 && (open[n-1].Name == "title" || open[n-1].Name == "desc") {
				open[n-1].Text += string(t)
			}
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
