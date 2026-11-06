// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"bytes"
	"strconv"
	"strings"

	kdl "github.com/calico32/kdl-go"
)

// TagAttribute is the attribute a tagged render marks each drawn element with.
const TagAttribute = "data-vexyl-layer"

// Span is where something in a document is. Lines and columns are counted as a Problem's are.
type Span struct {
	// Path is a layer's path, or the name of what else it is, as SDK.md section 7 says.
	Path string
	// Node is the KDL node's name.
	Node                             string
	Line, Column, EndLine, EndColumn int
}

var layerNames = map[string]bool{"field": true, "bars": true, "chevrons": true, "band": true, "cross": true, "saltire": true,
	"quarters": true, "checks": true, "rays": true, "pile": true, "pall": true, "charge": true, "emblem": true, "group": true,
	"panel": true, "canton": true, "use": true}

var holdsLayers = map[string]bool{"emblem": true, "group": true, "panel": true, "canton": true}

// EncodePathName writes a name in a path, where a slash separates the parts.
func EncodePathName(name string) string {
	return strings.ReplaceAll(strings.ReplaceAll(name, "%", "%25"), "/", "%2F")
}

// DecodePathName undoes EncodePathName.
func DecodePathName(part string) string {
	return strings.ReplaceAll(strings.ReplaceAll(part, "%2F", "/"), "%25", "%")
}

// ParentPath gives the path of what holds a layer, or "" if it's at the top of its scope.
func ParentPath(path string) string {
	dot := strings.LastIndexByte(path, '.')
	if dot > strings.LastIndexByte(path, '/') {
		return path[:dot]
	}
	return ""
}

// Locate finds every layer and other named part of a document, in document order. It reads only
// the document's syntax, so it works on one with other problems, and gives nothing if the syntax
// is bad.
func Locate(text string) []Span {
	src := []byte(normalizeNewlines(text))
	doc, err := kdl.Parse(bytes.NewReader(src), kdl.WithVersion(kdl.Version2))
	if err != nil {
		return nil
	}
	var spans []Span
	add := func(n *kdl.Node, path string) {
		line, column := place(src, int(n.Location().Offset))
		end := int(n.EndLocation().Offset)
		for end > int(n.Location().Offset) && strings.ContainsRune(" \t\n\r\f\v;", rune(src[end-1])) {
			end--
		}
		endLine, endColumn := place(src, end)
		spans = append(spans, Span{path, n.Name(), line, column, endLine, endColumn})
	}
	var layers func(list []*kdl.Node, base string)
	layers = func(list []*kdl.Node, base string) {
		i := 0
		for _, n := range list {
			if layerNames[n.Name()] {
				path := base + strconv.Itoa(i)
				add(n, path)
				if holdsLayers[n.Name()] {
					layers(n.Children().Nodes, path+".")
				}
				i++
			}
		}
	}
	named := func(n *kdl.Node, kind string) (string, bool) {
		args := n.Arguments()
		if len(args) == 0 {
			return "", false
		}
		name, ok := args[0].RawValue().(string)
		return kind + "/" + EncodePathName(name), ok
	}
	index := 0
	for _, n := range doc.Nodes {
		name := n.Name()
		kids := n.Children().Nodes
		switch {
		case layerNames[name]:
			path := strconv.Itoa(index)
			index++
			add(n, path)
			if holdsLayers[name] {
				layers(kids, path+".")
			}
		case name == "palette":
			add(n, name)
			for _, c := range kids {
				add(c, "palette/"+EncodePathName(c.Name()))
			}
		case name == "define" || name == "fold":
			if path, ok := named(n, name); ok {
				add(n, path)
				if name == "define" {
					layers(kids, path+"/")
				}
			}
		case name == "variant":
			if path, ok := named(n, name); ok {
				add(n, path)
				layers(kids, path+"/")
				for _, c := range kids {
					if c.Name() == "outline" || c.Name() == "border" {
						add(c, path+"/"+c.Name())
					}
				}
			}
		case name == "reverse":
			add(n, name)
			layers(kids, "reverse/")
		default:
			add(n, name)
		}
	}
	return spans
}

// LayerAt gives the innermost span holding a line of a document, and so its deepest layer or part.
func LayerAt(spans []Span, line int) (Span, bool) {
	var best Span
	found := false
	for _, s := range spans {
		if line >= s.Line && line <= s.EndLine && (!found || s.Line > best.Line || (s.Line == best.Line && s.Column >= best.Column)) {
			best, found = s, true
		}
	}
	return best, found
}
