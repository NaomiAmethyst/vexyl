// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	xmlNamespace   = "http://www.w3.org/XML/1998/namespace"
	xmlnsNamespace = "http://www.w3.org/2000/xmlns/"
)

// xmlName is a name with its namespace worked out.
type xmlName struct{ space, local string }

type xmlAttr struct {
	name  xmlName
	value string
}

type xmlKind int

const (
	xmlStart xmlKind = iota
	xmlEnd
	xmlText
	xmlOther
	xmlDirective
)

type xmlToken struct {
	kind  xmlKind
	name  xmlName
	attrs []xmlAttr
	text  string
}

// xmlFrame is an open element, with what its namespace declarations replaced.
type xmlFrame struct {
	raw  string
	name xmlName
	undo []xmlBinding
}

type xmlBinding struct {
	prefix, uri string
	had         bool
}

// xmlDecoder reads well-formed XML 1.0 with namespaces, one token at a time, as SPEC
// section 8.3 defines it, and refuses everything else. A sanitizer's security rests on
// reading markup exactly one way, so nothing here is lenient.
type xmlDecoder struct {
	src      string
	pos      int
	stack    []xmlFrame
	ns       map[string]string
	pending  *xmlToken
	sawRoot  bool
	doneRoot bool
}

func newXMLDecoder(markup string) (*xmlDecoder, error) {
	if !utf8.ValidString(markup) {
		return nil, errors.New("isn't UTF-8")
	}
	for _, r := range markup {
		if !xmlChar(r) {
			return nil, fmt.Errorf("U+%04X isn't an XML character", r)
		}
	}
	src := normalizeNewlines(markup)
	return &xmlDecoder{src: src, ns: map[string]string{"xml": xmlNamespace}}, nil
}

func xmlChar(r rune) bool {
	return r == 0x09 || r == 0x0a || r == 0x0d || (r >= 0x20 && r <= 0xd7ff) ||
		(r >= 0xe000 && r <= 0xfffd) || (r >= 0x10000 && r <= 0x10ffff)
}

func xmlSpace(c byte) bool { return c == ' ' || c == '\t' || c == '\n' || c == '\r' }

func xmlNameStart(r rune) bool {
	switch {
	case r == ':' || r == '_' || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z'):
		return true
	case r >= 0xc0 && r <= 0xd6, r >= 0xd8 && r <= 0xf6, r >= 0xf8 && r <= 0x2ff,
		r >= 0x370 && r <= 0x37d, r >= 0x37f && r <= 0x1fff, r >= 0x200c && r <= 0x200d,
		r >= 0x2070 && r <= 0x218f, r >= 0x2c00 && r <= 0x2fef, r >= 0x3001 && r <= 0xd7ff,
		r >= 0xf900 && r <= 0xfdcf, r >= 0xfdf0 && r <= 0xfffd, r >= 0x10000 && r <= 0xeffff:
		return true
	}
	return false
}

func xmlNameChar(r rune) bool {
	return xmlNameStart(r) || r == '-' || r == '.' || (r >= '0' && r <= '9') || r == 0xb7 ||
		(r >= 0x300 && r <= 0x36f) || (r >= 0x203f && r <= 0x2040)
}

var errXMLEnd = errors.New("unexpected end of the markup")

// token gives the next token, or false once the document has ended properly.
func (d *xmlDecoder) token() (xmlToken, bool, error) {
	if d.pending != nil {
		t := *d.pending
		d.pending = nil
		return t, true, nil
	}
	if d.pos >= len(d.src) {
		if len(d.stack) > 0 {
			return xmlToken{}, false, errXMLEnd
		}
		return xmlToken{}, false, nil
	}
	if d.src[d.pos] != '<' {
		return d.text()
	}
	rest := d.src[d.pos:]
	switch {
	case strings.HasPrefix(rest, "</"):
		return d.endTag()
	case strings.HasPrefix(rest, "<?"):
		return d.instruction()
	case strings.HasPrefix(rest, "<!--"):
		return d.comment()
	case strings.HasPrefix(rest, "<![CDATA["):
		return d.cdata()
	case strings.HasPrefix(rest, "<!"):
		// A directive is always refused, so there's no need to find where it ends.
		d.pos = len(d.src)
		return xmlToken{kind: xmlDirective}, true, nil
	}
	return d.startTag()
}

// text reads character data, which outside the root can only be whitespace.
func (d *xmlDecoder) text() (xmlToken, bool, error) {
	var b strings.Builder
	for d.pos < len(d.src) && d.src[d.pos] != '<' {
		c := d.src[d.pos]
		switch {
		case c == '&':
			if len(d.stack) == 0 {
				return xmlToken{}, false, errors.New("a character reference can't appear outside the root")
			}
			text, err := d.reference()
			if err != nil {
				return xmlToken{}, false, err
			}
			b.WriteString(text)
		case c == ']' && strings.HasPrefix(d.src[d.pos:], "]]>"):
			return xmlToken{}, false, errors.New("]]> can't appear in text")
		default:
			b.WriteByte(c)
			d.pos++
		}
	}
	return xmlToken{kind: xmlText, text: b.String()}, true, nil
}

func (d *xmlDecoder) cdata() (xmlToken, bool, error) {
	if len(d.stack) == 0 {
		return xmlToken{}, false, errors.New("a CDATA section can't appear outside the root")
	}
	start := d.pos + len("<![CDATA[")
	end := strings.Index(d.src[start:], "]]>")
	if end < 0 {
		return xmlToken{}, false, errXMLEnd
	}
	d.pos = start + end + len("]]>")
	return xmlToken{kind: xmlText, text: d.src[start : start+end]}, true, nil
}

func (d *xmlDecoder) comment() (xmlToken, bool, error) {
	start := d.pos + len("<!--")
	end := strings.Index(d.src[start:], "--")
	if end < 0 {
		return xmlToken{}, false, errXMLEnd
	}
	if !strings.HasPrefix(d.src[start+end:], "-->") {
		return xmlToken{}, false, errors.New(`"--" can't appear in a comment`)
	}
	d.pos = start + end + len("-->")
	return xmlToken{kind: xmlOther}, true, nil
}

func (d *xmlDecoder) instruction() (xmlToken, bool, error) {
	begin := d.pos
	d.pos += len("<?")
	target, err := d.name()
	if err != nil {
		return xmlToken{}, false, errors.New("expected a target after <?")
	}
	end := strings.Index(d.src[d.pos:], "?>")
	if end < 0 {
		return xmlToken{}, false, errXMLEnd
	}
	data := d.src[d.pos : d.pos+end]
	if data != "" && !xmlSpace(data[0]) {
		return xmlToken{}, false, errors.New("a processing instruction's target needs a space after it")
	}
	d.pos += end + len("?>")
	if strings.EqualFold(target, "xml") {
		if begin != 0 || target != "xml" {
			return xmlToken{}, false, errors.New("an XML declaration can only come first")
		}
		if err := checkXMLDeclaration(data); err != nil {
			return xmlToken{}, false, err
		}
	} else if strings.Contains(target, ":") {
		return xmlToken{}, false, errors.New("a processing instruction's target can't have a colon")
	}
	return xmlToken{kind: xmlOther}, true, nil
}

// checkXMLDeclaration reads ` version="1.0" encoding="UTF-8" standalone="yes"`, of which
// only the version is required, in that order.
func checkXMLDeclaration(data string) error {
	bad := errors.New("malformed XML declaration")
	pos := 0
	field := func(key string) (string, bool, error) {
		i := pos
		for i < len(data) && xmlSpace(data[i]) {
			i++
		}
		if i == pos || !strings.HasPrefix(data[i:], key) {
			return "", false, nil
		}
		i += len(key)
		for i < len(data) && xmlSpace(data[i]) {
			i++
		}
		if i >= len(data) || data[i] != '=' {
			return "", false, bad
		}
		i++
		for i < len(data) && xmlSpace(data[i]) {
			i++
		}
		if i >= len(data) || (data[i] != '"' && data[i] != '\'') {
			return "", false, bad
		}
		end := strings.IndexByte(data[i+1:], data[i])
		if end < 0 {
			return "", false, bad
		}
		pos = i + 1 + end + 1
		return data[i+1 : i+1+end], true, nil
	}
	version, ok, err := field("version")
	if err != nil {
		return err
	}
	if !ok {
		return bad
	}
	if version != "1.0" {
		return fmt.Errorf("unsupported XML version %q; only 1.0 is", version)
	}
	encoding, ok, err := field("encoding")
	if err != nil {
		return err
	}
	if ok && !strings.EqualFold(encoding, "utf-8") {
		return fmt.Errorf("unsupported encoding %q; only UTF-8 is", encoding)
	}
	standalone, ok, err := field("standalone")
	if err != nil {
		return err
	}
	if ok && standalone != "yes" && standalone != "no" {
		return bad
	}
	for pos < len(data) {
		if !xmlSpace(data[pos]) {
			return bad
		}
		pos++
	}
	return nil
}

// name reads an XML 1.0 Name.
func (d *xmlDecoder) name() (string, error) {
	start := d.pos
	for d.pos < len(d.src) {
		r, size := utf8.DecodeRuneInString(d.src[d.pos:])
		if d.pos == start {
			if !xmlNameStart(r) {
				break
			}
		} else if !xmlNameChar(r) {
			break
		}
		d.pos += size
	}
	if d.pos == start {
		return "", errors.New("expected a name")
	}
	return d.src[start:d.pos], nil
}

func (d *xmlDecoder) space() bool {
	start := d.pos
	for d.pos < len(d.src) && xmlSpace(d.src[d.pos]) {
		d.pos++
	}
	return d.pos > start
}

// splitQName divides a name at its colon, of which it can have one, between two parts.
func splitQName(raw string) (prefix, local string, err error) {
	before, after, found := strings.Cut(raw, ":")
	if !found {
		return "", raw, nil
	}
	if before == "" || after == "" || strings.Contains(after, ":") {
		return "", "", fmt.Errorf("%q isn't a valid qualified name", raw)
	}
	first, _ := utf8.DecodeRuneInString(after)
	if !xmlNameStart(first) {
		return "", "", fmt.Errorf("%q isn't a valid qualified name", raw)
	}
	return before, after, nil
}

func (d *xmlDecoder) endTag() (xmlToken, bool, error) {
	d.pos += len("</")
	raw, err := d.name()
	if err != nil {
		return xmlToken{}, false, errors.New("expected a name after </")
	}
	d.space()
	if d.pos >= len(d.src) {
		return xmlToken{}, false, errXMLEnd
	}
	if d.src[d.pos] != '>' {
		return xmlToken{}, false, fmt.Errorf("unexpected characters in </%s>", raw)
	}
	d.pos++
	if len(d.stack) == 0 {
		return xmlToken{}, false, fmt.Errorf("</%s> closes nothing", raw)
	}
	top := d.stack[len(d.stack)-1]
	if top.raw != raw {
		return xmlToken{}, false, fmt.Errorf("<%s> is closed by </%s>", top.raw, raw)
	}
	return d.closeElement(), true, nil
}

func (d *xmlDecoder) closeElement() xmlToken {
	top := d.stack[len(d.stack)-1]
	d.stack = d.stack[:len(d.stack)-1]
	for i := len(top.undo) - 1; i >= 0; i-- {
		u := top.undo[i]
		if u.had {
			d.ns[u.prefix] = u.uri
		} else {
			delete(d.ns, u.prefix)
		}
	}
	if len(d.stack) == 0 {
		d.doneRoot = true
	}
	return xmlToken{kind: xmlEnd, name: top.name}
}

type rawAttr struct{ name, value string }

func (d *xmlDecoder) startTag() (xmlToken, bool, error) {
	d.pos++
	raw, err := d.name()
	if err != nil {
		return xmlToken{}, false, errors.New("expected a name after <")
	}
	if d.doneRoot {
		return xmlToken{}, false, errors.New("markup can only have one root element")
	}
	var attrs []rawAttr
	seen := map[string]bool{}
	selfClosing := false
	for {
		spaced := d.space()
		if d.pos >= len(d.src) {
			return xmlToken{}, false, errXMLEnd
		}
		c := d.src[d.pos]
		if c == '>' {
			d.pos++
			break
		}
		if c == '/' {
			if !strings.HasPrefix(d.src[d.pos:], "/>") {
				return xmlToken{}, false, errors.New("expected /> in an element")
			}
			d.pos += len("/>")
			selfClosing = true
			break
		}
		if !spaced {
			return xmlToken{}, false, fmt.Errorf("<%s> needs a space before each attribute", raw)
		}
		name, err := d.name()
		if err != nil {
			return xmlToken{}, false, fmt.Errorf("expected an attribute name in <%s>", raw)
		}
		if seen[name] {
			return xmlToken{}, false, fmt.Errorf("attribute %q is repeated", name)
		}
		seen[name] = true
		d.space()
		if d.pos >= len(d.src) || d.src[d.pos] != '=' {
			return xmlToken{}, false, fmt.Errorf("attribute %q has no value", name)
		}
		d.pos++
		d.space()
		value, err := d.attrValue()
		if err != nil {
			return xmlToken{}, false, err
		}
		attrs = append(attrs, rawAttr{name, value})
	}
	frame := xmlFrame{raw: raw}
	tok := xmlToken{kind: xmlStart}
	// Declarations apply to the element they're on, so they're read first.
	for _, a := range attrs {
		if err := d.declare(a, &frame); err != nil {
			return xmlToken{}, false, err
		}
	}
	prefix, local, err := splitQName(raw)
	if err != nil {
		return xmlToken{}, false, err
	}
	if prefix == "xmlns" {
		return xmlToken{}, false, errors.New("an element can't use the xmlns prefix")
	}
	space := d.ns[prefix]
	if prefix != "" && space == "" {
		return xmlToken{}, false, fmt.Errorf("prefix %q isn't declared", prefix)
	}
	tok.name = xmlName{space, local}
	frame.name = tok.name
	expanded := map[xmlName]bool{}
	for _, a := range attrs {
		if a.name == "xmlns" || strings.HasPrefix(a.name, "xmlns:") {
			continue
		}
		prefix, local, err := splitQName(a.name)
		if err != nil {
			return xmlToken{}, false, err
		}
		var space string
		if prefix != "" {
			if space = d.ns[prefix]; space == "" {
				return xmlToken{}, false, fmt.Errorf("prefix %q isn't declared", prefix)
			}
		}
		name := xmlName{space, local}
		if expanded[name] {
			return xmlToken{}, false, fmt.Errorf("attribute %q is repeated", a.name)
		}
		expanded[name] = true
		tok.attrs = append(tok.attrs, xmlAttr{name, a.value})
	}
	d.stack = append(d.stack, frame)
	d.sawRoot = true
	if selfClosing {
		end := d.closeElement()
		d.pending = &end
	}
	return tok, true, nil
}

// declare applies a namespace declaration, if an attribute is one.
func (d *xmlDecoder) declare(a rawAttr, frame *xmlFrame) error {
	prefix := ""
	switch {
	case a.name == "xmlns":
	case strings.HasPrefix(a.name, "xmlns:"):
		prefix = strings.TrimPrefix(a.name, "xmlns:")
		if _, _, err := splitQName(a.name); err != nil {
			return err
		}
		if prefix == "xmlns" {
			return errors.New("the xmlns prefix can't be declared")
		}
		if a.value == "" {
			return fmt.Errorf("prefix %q can't be undeclared", prefix)
		}
	default:
		return nil
	}
	if (prefix == "xml") != (a.value == xmlNamespace) || a.value == xmlnsNamespace {
		return fmt.Errorf("namespace %q can't be bound to that prefix", a.value)
	}
	old, had := d.ns[prefix]
	frame.undo = append(frame.undo, xmlBinding{prefix, old, had})
	d.ns[prefix] = a.value
	return nil
}

// attrValue reads a quoted value, turning literal whitespace into spaces as XML says.
func (d *xmlDecoder) attrValue() (string, error) {
	if d.pos >= len(d.src) || (d.src[d.pos] != '"' && d.src[d.pos] != '\'') {
		return "", errors.New("an attribute's value needs quotes")
	}
	quote := d.src[d.pos]
	d.pos++
	var b strings.Builder
	for {
		if d.pos >= len(d.src) {
			return "", errXMLEnd
		}
		c := d.src[d.pos]
		switch c {
		case quote:
			d.pos++
			return b.String(), nil
		case '<':
			return "", errors.New("< can't appear in an attribute's value")
		case '&':
			text, err := d.reference()
			if err != nil {
				return "", err
			}
			b.WriteString(text)
		case '\t', '\n', '\r':
			b.WriteByte(' ')
			d.pos++
		default:
			b.WriteByte(c)
			d.pos++
		}
	}
}

// reference reads one of XML's five named entities, or a reference to a character.
func (d *xmlDecoder) reference() (string, error) {
	end := strings.IndexByte(d.src[d.pos:], ';')
	if end < 0 {
		return "", errors.New("& needs to begin a reference ending in ;")
	}
	body := d.src[d.pos+1 : d.pos+end]
	d.pos += end + 1
	switch body {
	case "lt":
		return "<", nil
	case "gt":
		return ">", nil
	case "amp":
		return "&", nil
	case "apos":
		return "'", nil
	case "quot":
		return `"`, nil
	}
	digits, base := "", 0
	switch {
	case strings.HasPrefix(body, "#x"):
		digits, base = body[2:], 16
	case strings.HasPrefix(body, "#"):
		digits, base = body[1:], 10
	default:
		return "", fmt.Errorf("unknown entity &%s;", body)
	}
	if digits == "" || digits[0] == '+' || digits[0] == '-' || strings.Contains(digits, "_") {
		return "", fmt.Errorf("invalid reference &%s;", body)
	}
	v, err := strconv.ParseUint(digits, base, 32)
	if err != nil || !xmlChar(rune(v)) || v > 0x10ffff {
		return "", fmt.Errorf("invalid reference &%s;", body)
	}
	return string(rune(v)), nil
}

// normalizeNewlines turns CRLF and lone CR into LF.
func normalizeNewlines(s string) string {
	if !strings.Contains(s, "\r") {
		return s
	}
	return strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
}
