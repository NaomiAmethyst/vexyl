// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"reflect"
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

// Model returns the flag as plain maps, lists and values, in the canonical form that
// the conformance suite compares. Fields are named in kebab-case, a layer says which
// kind it is, and anything empty or zero is left out.
func (f *Flag) Model() any {
	return modelOf(reflect.ValueOf(f))
}

var upperCase = regexp.MustCompile(`[A-Z]`)

func kebab(name string) string {
	s := upperCase.ReplaceAllStringFunc(name, func(c string) string { return "-" + strings.ToLower(c) })
	return strings.TrimPrefix(s, "-")
}

func modelOf(v reflect.Value) any {
	switch v.Kind() {
	case reflect.Pointer:
		if v.IsNil() {
			return nil
		}
		return modelOf(v.Elem())
	case reflect.Interface:
		if v.IsNil() {
			return nil
		}
		out := modelOf(v.Elem())
		// A layer's type is the only thing that says what it is.
		if m, ok := out.(map[string]any); ok {
			t := v.Elem().Type()
			if t.Kind() == reflect.Pointer {
				t = t.Elem()
			}
			m["layer"] = kebab(t.Name())
		}
		return out
	case reflect.Struct:
		out := map[string]any{}
		modelFields(v, out)
		return out
	case reflect.Map:
		if v.Len() == 0 {
			return nil
		}
		out := map[string]any{}
		for _, k := range v.MapKeys() {
			if item := modelOf(v.MapIndex(k)); item != nil {
				out[fmt.Sprint(k.Interface())] = item
			}
		}
		return out
	case reflect.Slice:
		if v.Len() == 0 {
			return nil
		}
		out := make([]any, v.Len())
		for i := range out {
			out[i] = modelOf(v.Index(i))
		}
		return out
	}
	if v.IsZero() {
		return nil
	}
	return v.Interface()
}

func modelFields(v reflect.Value, out map[string]any) {
	t := v.Type()
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if field.Anonymous {
			modelFields(v.Field(i), out)
			continue
		}
		if !field.IsExported() {
			continue
		}
		item := modelOf(v.Field(i))
		if m, ok := item.(map[string]any); ok && len(m) == 0 {
			continue
		}
		if item != nil {
			out[kebab(field.Name)] = item
		}
	}
}
