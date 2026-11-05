// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

const (
	svgNamespace   = "http://www.w3.org/2000/svg"
	xlinkNamespace = "http://www.w3.org/1999/xlink"
	maxSVGDepth    = 64
)

func (e *embeddedSVG) usesCurrentColor() bool {
	return strings.Contains(strings.ToLower(e.attrs+e.body), "currentcolor")
}

// embeddedSVG is inline SVG that has passed sanitizeSVG.
type embeddedSVG struct {
	viewBox string
	// attrs are the root element's attributes, each with a leading space.
	attrs string
	body  string
}

var (
	allowedElements = set("defs", "g", "path", "rect", "circle", "ellipse", "line", "polyline",
		"polygon", "linearGradient", "radialGradient", "stop", "clipPath", "mask")

	// droppedElements describe a file rather than draw it.
	droppedElements = set("title", "desc", "metadata")

	// presentationProps are allowed as attributes and in style attributes.
	presentationProps = set("fill", "fill-opacity", "fill-rule", "stroke", "stroke-width",
		"stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
		"stroke-dasharray", "stroke-dashoffset", "opacity", "clip-path", "clip-rule", "mask",
		"stop-color", "stop-opacity", "color", "display", "visibility", "paint-order",
		"vector-effect", "shape-rendering", "mix-blend-mode", "isolation")

	allowedAttrs = set("id", "class", "transform", "d", "x", "y", "width", "height", "cx", "cy",
		"r", "rx", "ry", "x1", "y1", "x2", "y2", "points", "offset", "fx", "fy", "fr",
		"gradientUnits", "gradientTransform", "spreadMethod", "clipPathUnits", "maskUnits",
		"maskContentUnits", "style", "href")

	// rootOnlyAttrs are consumed in working out the root's viewBox or are
	// replaced when it's placed on the flag.
	rootOnlyAttrs = set("id", "x", "y", "width", "height", "viewBox", "preserveAspectRatio",
		"version", "baseProfile")

	localID     = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.:-]*$`)
	colorFunc   = regexp.MustCompile(`(?i)\b(?:rgb|rgba|hsl|hsla)\(`)
	localURL    = regexp.MustCompile(`(?i)url\(\s*["']?#([A-Za-z_][A-Za-z0-9_.:-]*)["']?\s*\)`)
	svgNumber   = `[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?`
	viewBoxForm = regexp.MustCompile(`^\s*(` + svgNumber + `)[\s,]+(` + svgNumber + `)[\s,]+(` + svgNumber + `)[\s,]+(` + svgNumber + `)\s*$`)
	lengthForm  = regexp.MustCompile(`^\s*(` + svgNumber + `)(?:px)?\s*$`)
)

func set(names ...string) map[string]bool {
	m := make(map[string]bool, len(names))
	for _, name := range names {
		m[name] = true
	}
	return m
}

// sanitizeSVG checks inline SVG against the format's allowlist and returns a
// copy with its IDs prefixed, so they can't collide with any others in the
// output. Anything drawn must be on the allowlist or the markup is rejected;
// only descriptive and foreign-namespace content is removed quietly.
func sanitizeSVG(markup, idPrefix string) (*embeddedSVG, error) {
	dec := xml.NewDecoder(strings.NewReader(markup))
	result := &embeddedSVG{}
	var body strings.Builder
	depth := 0
	skip := 0
	sawRoot, closedRoot := false, false
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("invalid SVG: %w", err)
		}
		switch t := tok.(type) {
		case xml.Directive:
			return nil, errors.New("SVG can't contain a DOCTYPE or other directive")
		case xml.CharData:
			if skip == 0 && strings.TrimSpace(string(t)) != "" {
				return nil, errors.New("SVG can't contain text outside elements; convert any lettering to paths")
			}
		case xml.StartElement:
			if skip > 0 {
				skip++
				continue
			}
			if closedRoot {
				return nil, errors.New("SVG must have a single root element")
			}
			if !sawRoot {
				sawRoot = true
				if t.Name.Space != svgNamespace || t.Name.Local != "svg" {
					return nil, fmt.Errorf(`root must be <svg xmlns="%s">`, svgNamespace)
				}
				if err := result.readRoot(t, idPrefix); err != nil {
					return nil, err
				}
				depth = 1
				continue
			}
			if t.Name.Space != svgNamespace || droppedElements[t.Name.Local] {
				skip = 1
				continue
			}
			if !allowedElements[t.Name.Local] {
				return nil, fmt.Errorf("SVG element <%s> isn't allowed", t.Name.Local)
			}
			depth++
			if depth > maxSVGDepth {
				return nil, fmt.Errorf("SVG is nested more than %d levels deep", maxSVGDepth)
			}
			attrs, err := cleanAttrs(t.Attr, idPrefix, nil)
			if err != nil {
				return nil, fmt.Errorf("SVG element <%s>: %w", t.Name.Local, err)
			}
			body.WriteString("<" + t.Name.Local + attrs + ">")
		case xml.EndElement:
			if skip > 0 {
				skip--
				continue
			}
			depth--
			if depth == 0 {
				closedRoot = true
				continue
			}
			body.WriteString("</" + t.Name.Local + ">")
		}
	}
	if !sawRoot {
		return nil, errors.New("SVG has no root element")
	}
	result.body = body.String()
	return result, nil
}

// readRoot works out the root's viewBox and keeps its other styling attributes.
func (e *embeddedSVG) readRoot(root xml.StartElement, idPrefix string) error {
	var viewBox, width, height string
	for _, a := range root.Attr {
		if a.Name.Space != "" {
			continue
		}
		switch a.Name.Local {
		case "viewBox":
			viewBox = a.Value
		case "width":
			width = a.Value
		case "height":
			height = a.Value
		}
	}
	switch {
	case viewBox != "":
		m := viewBoxForm.FindStringSubmatch(viewBox)
		if m == nil {
			return fmt.Errorf("SVG has an invalid viewBox %q", viewBox)
		}
		w, _ := strconv.ParseFloat(m[3], 64)
		h, _ := strconv.ParseFloat(m[4], 64)
		if w <= 0 || h <= 0 {
			return fmt.Errorf("SVG viewBox %q has no area", viewBox)
		}
		e.viewBox = m[1] + " " + m[2] + " " + m[3] + " " + m[4]
	default:
		wm, hm := lengthForm.FindStringSubmatch(width), lengthForm.FindStringSubmatch(height)
		if wm == nil || hm == nil {
			return errors.New("SVG needs a viewBox, or a numeric width and height")
		}
		w, _ := strconv.ParseFloat(wm[1], 64)
		h, _ := strconv.ParseFloat(hm[1], 64)
		if w <= 0 || h <= 0 {
			return errors.New("SVG's width and height must be positive")
		}
		e.viewBox = "0 0 " + wm[1] + " " + hm[1]
	}
	attrs, err := cleanAttrs(root.Attr, idPrefix, rootOnlyAttrs)
	if err != nil {
		return fmt.Errorf("SVG root: %w", err)
	}
	e.attrs = attrs
	return nil
}

// cleanAttrs checks attributes against the allowlist and renders them.
func cleanAttrs(attrs []xml.Attr, idPrefix string, ignored map[string]bool) (string, error) {
	var b strings.Builder
	for _, a := range attrs {
		name := a.Name.Local
		switch {
		case a.Name.Space == xlinkNamespace && name == "href":
			// Treated the same as the plain href it's equivalent to.
		case a.Name.Space == "" && name == "xmlns":
			continue
		case a.Name.Space != "":
			// Editor data and namespace declarations don't affect rendering.
			continue
		case ignored[name]:
			continue
		case !allowedAttrs[name] && !presentationProps[name]:
			return "", fmt.Errorf("attribute %q isn't allowed", name)
		}
		value, err := cleanValue(name, a.Value, idPrefix)
		if err != nil {
			return "", err
		}
		b.WriteString(" " + name + `="` + esc(value) + `"`)
	}
	return b.String(), nil
}

func cleanValue(name, value, idPrefix string) (string, error) {
	switch name {
	case "id":
		if !localID.MatchString(value) {
			return "", fmt.Errorf("invalid id %q", value)
		}
		return idPrefix + value, nil
	case "href":
		if !strings.HasPrefix(value, "#") || !localID.MatchString(value[1:]) {
			return "", fmt.Errorf("href %q must refer to an id in this SVG", value)
		}
		return "#" + idPrefix + value[1:], nil
	case "style":
		return cleanStyle(value, idPrefix)
	}
	if presentationProps[name] {
		return cleanPresentation(value, idPrefix)
	}
	return value, nil
}

// cleanPresentation prefixes url(#id) references and rejects every CSS function
// other than those and plain color functions, since functions can load things.
func cleanPresentation(value, idPrefix string) (string, error) {
	remaining := colorFunc.ReplaceAllString(localURL.ReplaceAllString(value, ""), "")
	if strings.Contains(remaining, "(") {
		return "", fmt.Errorf("%q uses a function other than url(#id) or a color", value)
	}
	return localURL.ReplaceAllString(value, "url(#"+idPrefix+"$1)"), nil
}

func cleanStyle(style, idPrefix string) (string, error) {
	if strings.ContainsAny(style, `\@`) || strings.Contains(style, "/*") {
		return "", errors.New("style can't contain escapes, at-rules or comments")
	}
	var out []string
	for decl := range strings.SplitSeq(style, ";") {
		if strings.TrimSpace(decl) == "" {
			continue
		}
		prop, value, ok := strings.Cut(decl, ":")
		prop = strings.ToLower(strings.TrimSpace(prop))
		if !ok || !presentationProps[prop] {
			return "", fmt.Errorf("style property %q isn't allowed", prop)
		}
		value, err := cleanPresentation(strings.TrimSpace(value), idPrefix)
		if err != nil {
			return "", err
		}
		out = append(out, prop+":"+value)
	}
	slices.Sort(out)
	return strings.Join(out, ";"), nil
}
