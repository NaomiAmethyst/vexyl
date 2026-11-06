// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

import (
	"bytes"
	"compress/flate"
	_ "embed"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"regexp"
	"unicode/utf8"
)

// ShareMaxBytes is the largest document a share link can hold. SDK.md section 8 fixes it.
const ShareMaxBytes = 8 * 1024 * 1024

// ShareDictionary is the normative preset dictionary of version 1 links, a copy of share/v1.dict.
//
//go:embed share_v1.dict
var ShareDictionary []byte

var (
	shareVersion = regexp.MustCompile(`^v([0-9]+)\.`)
	shareBody    = regexp.MustCompile(`^[A-Za-z0-9_-]*$`)
)

// ShareEncode writes a document as the part of a share link after its #.
func ShareEncode(source string) (string, error) {
	if len(source) > ShareMaxBytes {
		return "", fmt.Errorf("a share link can hold up to %d bytes, and this is %d", ShareMaxBytes, len(source))
	}
	var out bytes.Buffer
	w, err := flate.NewWriterDict(&out, flate.BestCompression, ShareDictionary)
	if err != nil {
		return "", err
	}
	if _, err := io.WriteString(w, source); err != nil {
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}
	return "v1." + base64.RawURLEncoding.EncodeToString(out.Bytes()), nil
}

// ShareDecode reads the part of a share link after its #. Anything untrusted can be in one, so it
// stops as soon as the output passes ShareMaxBytes, and it refuses whatever isn't exactly what an
// encoder writes.
func ShareDecode(link string) (string, error) {
	m := shareVersion.FindStringSubmatch(link)
	if m == nil {
		return "", errors.New("it doesn't start with a version")
	}
	if m[1] != "1" {
		return "", fmt.Errorf("it's version %s, and this reads version 1", m[1])
	}
	body := link[len(m[0]):]
	// The decoder would otherwise skip line endings.
	if !shareBody.MatchString(body) {
		return "", errors.New("it has a character that isn't in base64url")
	}
	compressed, err := base64.RawURLEncoding.Strict().DecodeString(body)
	if err != nil {
		return "", errors.New("its base64url isn't in canonical form")
	}
	// A bytes.Reader is an io.ByteReader, so flate reads no further than the stream's end.
	in := bytes.NewReader(compressed)
	r := flate.NewReaderDict(in, ShareDictionary)
	defer r.Close()
	out, err := io.ReadAll(io.LimitReader(r, ShareMaxBytes+1))
	if err != nil {
		return "", fmt.Errorf("its compressed data is corrupt: %w", err)
	}
	if len(out) > ShareMaxBytes {
		return "", fmt.Errorf("what it holds is over the limit of %d bytes", ShareMaxBytes)
	}
	if in.Len() != 0 {
		return "", errors.New("its compressed data is corrupt: there's more after its end")
	}
	if !utf8.Valid(out) {
		return "", errors.New("what it holds isn't UTF-8")
	}
	return string(out), nil
}
