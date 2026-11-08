// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const (
	svgNamespace   = "http://www.w3.org/2000/svg"
	xlinkNamespace = "http://www.w3.org/1999/xlink"
	maxSVGDepth    = 64
)

func (e *embeddedSVG) usesCurrentColor() bool { return e.currentColor }

// colorProps are the properties that can take currentColor: the paints, and color itself.
var colorProps = set("fill", "stroke", "stop-color", "flood-color", "lighting-color", "color")

// cssWord finds the keywords in a value, so that currentColor counts only as a whole one.
var cssWord = regexp.MustCompile(`[A-Za-z0-9_-]+`)

// takesCurrentColor says whether an attribute, or a declaration in a style, paints in
// currentColor, as its value or as a keyword in it such as a fallback after url(#id). An id
// or other text containing the word doesn't count.
func takesCurrentColor(name, value string) bool {
	if name == "style" {
		for decl := range strings.SplitSeq(value, ";") {
			prop, v, _ := strings.Cut(decl, ":")
			if takesCurrentColor(asciiLower(strings.Trim(prop, asciiSpace)), v) {
				return true
			}
		}
		return false
	}
	if !colorProps[name] {
		return false
	}
	for _, word := range cssWord.FindAllString(localURL.ReplaceAllString(value, ""), -1) {
		if asciiLower(word) == "currentcolor" {
			return true
		}
	}
	return false
}

// idMark stands in for an ID's prefix in sanitized markup until it's drawn. It can't
// appear in XML, so it can't be confused with anything in the artwork.
const idMark = "\x00"

// embeddedSVG is inline SVG that has passed sanitizeSVG.
type embeddedSVG struct {
	viewBox string
	// currentColor says whether the artwork paints in currentColor anywhere.
	currentColor bool
	// attrs are the root element's attributes, each with a leading space.
	attrs string
	body  string
}

// canonical is the sanitized artwork as one document, with its IDs as they were written.
func (e *embeddedSVG) canonical() string {
	return strings.ReplaceAll(`<svg xmlns="`+svgNamespace+`" viewBox="`+esc(e.viewBox)+`"`+e.attrs+`>`+e.body+`</svg>`, idMark, "")
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

	allowedAttrs = set("id", "transform", "d", "x", "y", "width", "height", "cx", "cy",
		"r", "rx", "ry", "x1", "y1", "x2", "y2", "points", "offset", "fx", "fy", "fr",
		"gradientUnits", "gradientTransform", "spreadMethod", "clipPathUnits", "maskUnits",
		"maskContentUnits", "style", "href")

	// rootOnlyAttrs are consumed in working out the root's viewBox or are
	// replaced when it's placed on the flag.
	rootOnlyAttrs = set("id", "x", "y", "width", "height", "viewBox", "preserveAspectRatio",
		"version", "baseProfile")

	localID = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.:-]*$`)
	// These spell their cases out, because (?i) would also take letters like U+017F as an s.
	colorFunc   = regexp.MustCompile(`\b(?:[rR][gG][bB][aA]?|[hH][sS][lL][aA]?)\(`)
	localURL    = regexp.MustCompile(`[uU][rR][lL]\(\s*["']?#([A-Za-z_][A-Za-z0-9_.:-]*)["']?\s*\)`)
	viewBoxForm = regexp.MustCompile(`^\s*(` + decimalForm + `)` + commaSpace + `(` + decimalForm + `)` + commaSpace + `(` + decimalForm + `)` + commaSpace + `(` + decimalForm + `)\s*$`)
	lengthForm  = regexp.MustCompile(`^\s*(` + decimalForm + `)(?:px)?\s*$`)
	// defaultFit is SVG's default preserveAspectRatio, the only way artwork is ever fitted.
	defaultFit = regexp.MustCompile(`^\s*xMidYMid(?:\s+meet)?\s*$`)
)

func set(names ...string) map[string]bool {
	m := make(map[string]bool, len(names))
	for _, name := range names {
		m[name] = true
	}
	return m
}

// sanitizeSVG checks inline SVG against the format's allowlist and returns a copy with
// marks in place of its IDs' prefixes, so that drawing it can make them unique. Anything
// drawn must be on the allowlist or the markup is rejected; only descriptive and
// foreign-namespace content is removed quietly.
func sanitizeSVG(markup string) (*embeddedSVG, error) {
	dec, err := newXMLDecoder(markup)
	if err != nil {
		return nil, fmt.Errorf("invalid SVG: %w", err)
	}
	result := &embeddedSVG{}
	var body strings.Builder
	depth := 0
	skip := 0
	sawRoot, closedRoot := false, false
	for {
		t, ok, err := dec.token()
		if err != nil {
			return nil, fmt.Errorf("invalid SVG: %w", err)
		}
		if !ok {
			break
		}
		switch t.kind {
		case xmlDirective:
			return nil, errors.New("SVG can't contain a DOCTYPE or other directive")
		case xmlText:
			if skip == 0 && strings.Trim(t.text, asciiSpace) != "" {
				return nil, errors.New("SVG can't contain text outside elements; convert any lettering to paths")
			}
		case xmlStart:
			if skip > 0 {
				skip++
				continue
			}
			if closedRoot {
				return nil, errors.New("SVG must have a single root element")
			}
			if !sawRoot {
				sawRoot = true
				if t.name.space != svgNamespace || t.name.local != "svg" {
					return nil, fmt.Errorf(`root must be <svg xmlns="%s">`, svgNamespace)
				}
				if err := result.readRoot(t.attrs); err != nil {
					return nil, err
				}
				depth = 1
				continue
			}
			if (t.name.space != svgNamespace && t.name.space != "") || (t.name.space == svgNamespace && droppedElements[t.name.local]) {
				skip = 1
				continue
			}
			if t.name.space == "" || !allowedElements[t.name.local] {
				return nil, fmt.Errorf("SVG element <%s> isn't allowed", t.name.local)
			}
			depth++
			if depth > maxSVGDepth {
				return nil, fmt.Errorf("SVG is nested more than %d levels deep", maxSVGDepth)
			}
			attrs, err := cleanAttrs(t.attrs, nil, &result.currentColor)
			if err != nil {
				return nil, fmt.Errorf("SVG element <%s>: %w", t.name.local, err)
			}
			body.WriteString("<" + t.name.local + attrs + ">")
		case xmlEnd:
			if skip > 0 {
				skip--
				continue
			}
			depth--
			if depth == 0 {
				closedRoot = true
				continue
			}
			body.WriteString("</" + t.name.local + ">")
		}
	}
	if !sawRoot {
		return nil, errors.New("SVG has no root element")
	}
	result.body = body.String()
	return result, nil
}

// readRoot works out the root's viewBox and keeps its other styling attributes.
func (e *embeddedSVG) readRoot(attrs []xmlAttr) error {
	var viewBox, width, height string
	for _, a := range attrs {
		if a.name.space != "" {
			continue
		}
		switch a.name.local {
		case "viewBox":
			viewBox = a.value
		case "width":
			width = a.value
		case "height":
			height = a.value
		case "preserveAspectRatio":
			if !defaultFit.MatchString(a.value) {
				return fmt.Errorf("SVG's preserveAspectRatio %q isn't the default, which is how artwork is always fitted", a.value)
			}
		}
	}
	switch {
	case viewBox != "":
		m := viewBoxForm.FindStringSubmatch(viewBox)
		if m == nil {
			return fmt.Errorf("SVG has an invalid viewBox %q", viewBox)
		}
		for _, part := range m[1:] {
			if _, ok := decimalValue(part); !ok {
				return fmt.Errorf("SVG has an invalid viewBox %q", viewBox)
			}
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
		w, wok := decimalValue(wm[1])
		h, hok := decimalValue(hm[1])
		if !wok || !hok || w <= 0 || h <= 0 {
			return errors.New("SVG's width and height must be positive")
		}
		e.viewBox = "0 0 " + wm[1] + " " + hm[1]
	}
	cleaned, err := cleanAttrs(attrs, rootOnlyAttrs, &e.currentColor)
	if err != nil {
		return fmt.Errorf("SVG root: %w", err)
	}
	e.attrs = cleaned
	return nil
}

// cleanAttrs checks attributes against the allowlist and renders them, noting whether any
// of them paints in currentColor.
func cleanAttrs(attrs []xmlAttr, ignored map[string]bool, currentColor *bool) (string, error) {
	var b strings.Builder
	href := false
	for _, a := range attrs {
		name := a.name.local
		switch {
		case a.name.space == xlinkNamespace && name == "href":
			// Treated the same as the plain href it's equivalent to.
		case a.name.space != "":
			// Editor data doesn't affect rendering.
			continue
		case ignored[name]:
			continue
		case !allowedAttrs[name] && !presentationProps[name]:
			return "", fmt.Errorf("attribute %q isn't allowed", name)
		}
		if name == "href" {
			if href {
				return "", errors.New("attribute \"href\" is repeated, since xlink:href means the same")
			}
			href = true
		}
		value, err := cleanValue(name, a.value)
		if err != nil {
			return "", err
		}
		if takesCurrentColor(name, a.value) {
			*currentColor = true
		}
		b.WriteString(" " + name + `="` + value + `"`)
	}
	return b.String(), nil
}

// cleanValue gives a value escaped for writing out.
func cleanValue(name, value string) (string, error) {
	switch name {
	case "id":
		if !localID.MatchString(value) {
			return "", fmt.Errorf("invalid id %q", value)
		}
		return idMark + esc(value), nil
	case "href":
		if !strings.HasPrefix(value, "#") || !localID.MatchString(value[1:]) {
			return "", fmt.Errorf("href %q must refer to an id in this SVG", value)
		}
		return "#" + idMark + esc(value[1:]), nil
	case "style":
		return cleanStyle(value)
	}
	if presentationProps[name] {
		return cleanPresentation(value)
	}
	return esc(value), nil
}

// cleanPresentation marks url(#id) references and rejects every CSS function other than
// those and plain color functions, since functions can load things.
func cleanPresentation(value string) (string, error) {
	remaining := colorFunc.ReplaceAllString(localURL.ReplaceAllString(value, ""), "")
	if strings.Contains(remaining, "(") {
		return "", fmt.Errorf("%q uses a function other than url(#id) or a color", value)
	}
	var b strings.Builder
	last := 0
	for _, m := range localURL.FindAllStringSubmatchIndex(value, -1) {
		b.WriteString(esc(value[last:m[0]]) + "url(#" + idMark + esc(value[m[2]:m[3]]) + ")")
		last = m[1]
	}
	b.WriteString(esc(value[last:]))
	return b.String(), nil
}

// cleanStyle keeps a style's declarations in their order, since a later one can win.
func cleanStyle(style string) (string, error) {
	if strings.ContainsAny(style, `\@`) || strings.Contains(style, "/*") {
		return "", errors.New("style can't contain escapes, at-rules or comments")
	}
	var out []string
	for decl := range strings.SplitSeq(style, ";") {
		if strings.Trim(decl, asciiSpace) == "" {
			continue
		}
		prop, value, ok := strings.Cut(decl, ":")
		prop = asciiLower(strings.Trim(prop, asciiSpace))
		if !ok || !presentationProps[prop] {
			return "", fmt.Errorf("style property %q isn't allowed", prop)
		}
		value, err := cleanPresentation(strings.Trim(value, asciiSpace))
		if err != nil {
			return "", err
		}
		out = append(out, prop+":"+value)
	}
	return strings.Join(out, ";"), nil
}

func asciiLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 'a' - 'A'
		}
	}
	return string(b)
}
