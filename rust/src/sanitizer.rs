// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! Checks inline SVG against the format's allowlist, as SPEC section 8.3 says, and writes what
//! passes in the canonical form of SDK section 4.2. This is a security boundary: anything that
//! draws has to be on the allowlist, or the markup is refused.

use crate::numbers::{decimal_texts, decimal_value, is_decimal, is_space};
use crate::xml::{self, Attr, Kind, Xml};

pub(crate) const SVG_NAMESPACE: &str = "http://www.w3.org/2000/svg";
pub(crate) const XLINK_NAMESPACE: &str = "http://www.w3.org/1999/xlink";
pub(crate) const MAX_DEPTH: usize = 64;

/// Stands in for an ID's prefix in sanitized markup until it's drawn. It can't appear in XML, so
/// it can't be confused with anything in the artwork.
const ID_MARK: &str = "\0";

const COLOR_PROPS: &[&str] = &[
    "fill",
    "stroke",
    "stop-color",
    "flood-color",
    "lighting-color",
    "color",
];
const ALLOWED_ELEMENTS: &[&str] = &[
    "defs",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
];
/// These describe a file rather than draw it.
const DROPPED_ELEMENTS: &[&str] = &["title", "desc", "metadata"];
/// Allowed as attributes and in style attributes.
const PRESENTATION: &[&str] = &[
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-dasharray",
    "stroke-dashoffset",
    "opacity",
    "clip-path",
    "clip-rule",
    "mask",
    "stop-color",
    "stop-opacity",
    "color",
    "display",
    "visibility",
    "paint-order",
    "vector-effect",
    "shape-rendering",
    "mix-blend-mode",
    "isolation",
];
const ALLOWED_ATTRS: &[&str] = &[
    "id",
    "transform",
    "d",
    "x",
    "y",
    "width",
    "height",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "x1",
    "y1",
    "x2",
    "y2",
    "points",
    "offset",
    "fx",
    "fy",
    "fr",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
    "clipPathUnits",
    "maskUnits",
    "maskContentUnits",
    "style",
    "href",
];
/// Consumed in working out the root's viewBox, or replaced when it's placed on the flag.
const ROOT_ONLY: &[&str] = &[
    "id",
    "x",
    "y",
    "width",
    "height",
    "viewBox",
    "preserveAspectRatio",
    "version",
    "baseProfile",
];

/// Inline SVG that has passed the sanitizer.
#[derive(Debug, Clone, Default)]
pub(crate) struct Artwork {
    view_box: String,
    current_color: bool,
    /// The root element's attributes, each with a leading space.
    attrs: String,
    body: String,
}

impl Artwork {
    /// The root's viewBox, its four numbers joined by single spaces as they were written.
    pub fn view_box(&self) -> &str {
        &self.view_box
    }

    /// Whether the artwork paints in currentColor anywhere.
    pub fn uses_current_color(&self) -> bool {
        self.current_color
    }

    /// The root's attributes, each with a leading space, with every ID given a prefix.
    pub fn attrs(&self, id_prefix: &str) -> String {
        self.attrs.replace(ID_MARK, id_prefix)
    }

    /// What's inside the root, with every ID and reference given a prefix.
    pub fn body(&self, id_prefix: &str) -> String {
        self.body.replace(ID_MARK, id_prefix)
    }

    /// The sanitized artwork as one document, with its IDs as they were written.
    pub fn canonical(&self) -> String {
        format!(
            "<svg xmlns=\"{SVG_NAMESPACE}\" viewBox=\"{}\"{}>{}</svg>",
            xml::escape(&self.view_box),
            self.attrs,
            self.body
        )
        .replace(ID_MARK, "")
    }
}

/// Trims the whitespace of strings and inline SVG from both ends.
pub(crate) fn trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_ascii() && is_space(c as u8))
}

pub(crate) fn ascii_lower(s: &str) -> String {
    s.to_ascii_lowercase()
}

/// Whether all of a text is an ID that artwork can have, `[A-Za-z_][A-Za-z0-9_.:-]*`.
pub(crate) fn local_id(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && (b[0].is_ascii_alphabetic() || b[0] == b'_')
        && b[1..].iter().all(|&c| id_char(c))
}

fn id_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.' | b':' | b'-')
}

/// Matches `[uU][rR][lL]\(ws*["']?#(ID)["']?ws*\)` at i, giving where it ends and its ID.
fn local_url_at(s: &[u8], i: usize) -> Option<(usize, usize, usize)> {
    if i + 4 > s.len() || !s[i..i + 3].eq_ignore_ascii_case(b"url") || s[i + 3] != b'(' {
        return None;
    }
    let mut j = i + 4;
    while j < s.len() && is_space(s[j]) {
        j += 1;
    }
    if j < s.len() && (s[j] == b'"' || s[j] == b'\'') {
        j += 1;
    }
    if j >= s.len() || s[j] != b'#' {
        return None;
    }
    j += 1;
    let id_start = j;
    if j >= s.len() || !(s[j].is_ascii_alphabetic() || s[j] == b'_') {
        return None;
    }
    while j < s.len() && id_char(s[j]) {
        j += 1;
    }
    let id_end = j;
    if j < s.len() && (s[j] == b'"' || s[j] == b'\'') {
        j += 1;
    }
    while j < s.len() && is_space(s[j]) {
        j += 1;
    }
    if j >= s.len() || s[j] != b')' {
        return None;
    }
    Some((j + 1, id_start, id_end))
}

/// Each url(#id) in a value: where it starts and ends, and its ID's place.
fn local_urls(value: &str) -> Vec<(usize, usize, usize, usize)> {
    let s = value.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < s.len() {
        if let Some((end, a, b)) = local_url_at(s, i) {
            out.push((i, end, a, b));
            i = end;
        } else {
            i += 1;
        }
    }
    out
}

fn without_local_urls(value: &str) -> String {
    let mut out = String::new();
    let mut last = 0;
    for (start, end, _, _) in local_urls(value) {
        out.push_str(&value[last..start]);
        last = end;
    }
    out.push_str(&value[last..]);
    out
}

/// Removes each color function's opening, `(?<![A-Za-z0-9_])(?:rgba?|hsla?)\(` in any case.
fn without_color_funcs(value: &str) -> String {
    let s = value.as_bytes();
    let mut out = String::new();
    let mut last = 0;
    let mut i = 0;
    while i < s.len() {
        let before_ok = i == 0 || !(s[i - 1].is_ascii_alphanumeric() || s[i - 1] == b'_');
        if before_ok && i + 3 <= s.len() {
            let word = &s[i..i + 3];
            if word.eq_ignore_ascii_case(b"rgb") || word.eq_ignore_ascii_case(b"hsl") {
                let mut j = i + 3;
                if j < s.len()
                    && (s[j] == b'a' || s[j] == b'A')
                    && j + 1 < s.len()
                    && s[j + 1] == b'('
                {
                    j += 1;
                }
                if j < s.len() && s[j] == b'(' {
                    out.push_str(&value[last..i]);
                    last = j + 1;
                    i = j + 1;
                    continue;
                }
            }
        }
        i += 1;
    }
    out.push_str(&value[last..]);
    out
}

/// Whether an attribute, or a declaration in a style, paints in currentColor, as its value or as
/// a keyword in it such as a fallback after url(#id). An id or other text containing the word
/// doesn't count.
pub(crate) fn takes_current_color(name: &str, value: &str) -> bool {
    if name == "style" {
        return value.split(';').any(|decl| {
            let (prop, v) = match decl.find(':') {
                Some(colon) => (&decl[..colon], &decl[colon + 1..]),
                None => (decl, ""),
            };
            takes_current_color(&ascii_lower(trim(prop)), v)
        });
    }
    if !COLOR_PROPS.contains(&name) {
        return false;
    }
    let rest = without_local_urls(value);
    rest.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-'))
        .any(|w| w.eq_ignore_ascii_case("currentcolor"))
}

fn fail<T>(message: impl Into<String>) -> Result<T, String> {
    Err(message.into())
}

/// Checks inline SVG and gives a copy with marks in place of its IDs' prefixes, so that drawing it
/// can make them unique. Anything drawn must be on the allowlist or the markup is refused; only
/// descriptive and foreign-namespace content is removed quietly.
pub(crate) fn sanitize(markup: &str) -> Result<Artwork, String> {
    let mut dec = Xml::new(markup).map_err(|e| format!("invalid SVG: {}", e.0))?;
    let mut result = Artwork::default();
    let mut body = String::new();
    let mut depth = 0usize;
    let mut skip = 0usize;
    let mut saw_root = false;
    let mut closed_root = false;
    loop {
        let t = dec.token().map_err(|e| format!("invalid SVG: {}", e.0))?;
        let Some(t) = t else {
            break;
        };
        match t.kind {
            Kind::Directive => return fail("SVG can't contain a DOCTYPE or other directive"),
            Kind::Text => {
                if skip == 0 && !trim(&t.text).is_empty() {
                    return fail(
                        "SVG can't contain text outside elements; convert any lettering to paths",
                    );
                }
            }
            Kind::Start => {
                if skip > 0 {
                    skip += 1;
                    continue;
                }
                if closed_root {
                    return fail("SVG must have a single root element");
                }
                let name = t.name.expect("a start tag's name");
                if !saw_root {
                    saw_root = true;
                    if name.space != SVG_NAMESPACE || name.local != "svg" {
                        return fail(format!("root must be <svg xmlns=\"{SVG_NAMESPACE}\">"));
                    }
                    read_root(&mut result, &t.attrs)?;
                    depth = 1;
                    continue;
                }
                if (name.space != SVG_NAMESPACE && !name.space.is_empty())
                    || (name.space == SVG_NAMESPACE
                        && DROPPED_ELEMENTS.contains(&name.local.as_str()))
                {
                    skip = 1;
                    continue;
                }
                if name.space.is_empty() || !ALLOWED_ELEMENTS.contains(&name.local.as_str()) {
                    return fail(format!("SVG element <{}> isn't allowed", name.local));
                }
                depth += 1;
                if depth > MAX_DEPTH {
                    return fail(format!("SVG is nested more than {MAX_DEPTH} levels deep"));
                }
                let attrs = clean_attrs(&t.attrs, &[], &mut result)
                    .map_err(|e| format!("SVG element <{}>: {e}", name.local))?;
                body.push('<');
                body.push_str(&name.local);
                body.push_str(&attrs);
                body.push('>');
            }
            Kind::End => {
                if skip > 0 {
                    skip -= 1;
                    continue;
                }
                depth -= 1;
                if depth == 0 {
                    closed_root = true;
                    continue;
                }
                body.push_str("</");
                body.push_str(&t.name.expect("an end tag's name").local);
                body.push('>');
            }
            Kind::Other => {}
        }
    }
    if !saw_root {
        return fail("SVG has no root element");
    }
    result.body = body;
    Ok(result)
}

/// Whether a value is `ws*(DEC)(?:px)?ws*`, giving the number's text.
fn length(value: &str) -> Option<&str> {
    let t = trim(value);
    let t = t.strip_suffix("px").unwrap_or(t);
    if is_decimal(t) { Some(t) } else { None }
}

/// Whether a value is `ws*xMidYMid(?:ws+meet)?ws*`, SVG's default, the only way artwork is
/// ever fitted.
fn default_fit(value: &str) -> bool {
    let t = trim(value);
    let Some(rest) = t.strip_prefix("xMidYMid") else {
        return false;
    };
    if rest.is_empty() {
        return true;
    }
    let Some(meet) = rest.strip_suffix("meet") else {
        return false;
    };
    !meet.is_empty() && meet.bytes().all(is_space)
}

/// Works out the root's viewBox and keeps its other styling attributes.
fn read_root(e: &mut Artwork, attrs: &[Attr]) -> Result<(), String> {
    let mut view_box = "";
    let mut width = "";
    let mut height = "";
    for a in attrs {
        if !a.name.space.is_empty() {
            continue;
        }
        match a.name.local.as_str() {
            "viewBox" => view_box = &a.value,
            "width" => width = &a.value,
            "height" => height = &a.value,
            "preserveAspectRatio" if !default_fit(&a.value) => {
                return fail(format!(
                    "SVG's preserveAspectRatio \"{}\" isn't the default, which is how artwork is always fitted",
                    a.value
                ));
            }
            _ => {}
        }
    }
    if !view_box.is_empty() {
        let invalid = || format!("SVG has an invalid viewBox \"{view_box}\"");
        let Some(parts) = decimal_texts(view_box).filter(|p| p.len() == 4) else {
            return Err(invalid());
        };
        let mut values = [0.0; 4];
        for (i, p) in parts.iter().enumerate() {
            values[i] = decimal_value(p).ok_or_else(invalid)?;
        }
        if values[2] <= 0.0 || values[3] <= 0.0 {
            return fail(format!("SVG viewBox \"{view_box}\" has no area"));
        }
        e.view_box = parts.join(" ");
    } else {
        let (Some(w), Some(h)) = (length(width), length(height)) else {
            return fail("SVG needs a viewBox, or a numeric width and height");
        };
        match (decimal_value(w), decimal_value(h)) {
            (Some(wv), Some(hv)) if wv > 0.0 && hv > 0.0 => {}
            _ => return fail("SVG's width and height must be positive"),
        }
        e.view_box = format!("0 0 {w} {h}");
    }
    e.attrs = clean_attrs(attrs, ROOT_ONLY, e).map_err(|err| format!("SVG root: {err}"))?;
    Ok(())
}

/// Checks attributes against the allowlist and writes them out, noting whether any of them paints
/// in currentColor.
fn clean_attrs(attrs: &[Attr], ignored: &[&str], e: &mut Artwork) -> Result<String, String> {
    let mut b = String::new();
    let mut href = false;
    for a in attrs {
        let name = a.name.local.as_str();
        let space = a.name.space.as_str();
        if space == XLINK_NAMESPACE && name == "href" {
            // The same as the plain href it's equivalent to.
        } else if !space.is_empty() {
            // Editor data doesn't affect rendering.
            continue;
        } else if ignored.contains(&name) {
            continue;
        } else if !ALLOWED_ATTRS.contains(&name) && !PRESENTATION.contains(&name) {
            return fail(format!("attribute \"{name}\" isn't allowed"));
        }
        if name == "href" {
            if href {
                return fail("attribute \"href\" is repeated, since xlink:href means the same");
            }
            href = true;
        }
        let value = clean_value(name, &a.value)?;
        if takes_current_color(name, &a.value) {
            e.current_color = true;
        }
        b.push(' ');
        b.push_str(name);
        b.push_str("=\"");
        b.push_str(&value);
        b.push('"');
    }
    Ok(b)
}

/// A value escaped for writing out.
fn clean_value(name: &str, value: &str) -> Result<String, String> {
    match name {
        "id" => {
            if !local_id(value) {
                return fail(format!("invalid id \"{value}\""));
            }
            return Ok(format!("{ID_MARK}{}", xml::escape(value)));
        }
        "href" => {
            let Some(id) = value.strip_prefix('#').filter(|id| local_id(id)) else {
                return fail(format!("href \"{value}\" must refer to an id in this SVG"));
            };
            return Ok(format!("#{ID_MARK}{}", xml::escape(id)));
        }
        "style" => return clean_style(value),
        _ => {}
    }
    if PRESENTATION.contains(&name) {
        return clean_presentation(value);
    }
    Ok(xml::escape(value))
}

/// Marks url(#id) references and refuses every CSS function other than those and plain color
/// functions, since functions can load things.
fn clean_presentation(value: &str) -> Result<String, String> {
    let remaining = without_color_funcs(&without_local_urls(value));
    if remaining.contains('(') {
        return fail(format!(
            "\"{value}\" uses a function other than url(#id) or a color"
        ));
    }
    let mut b = String::new();
    let mut last = 0;
    for (start, end, a, z) in local_urls(value) {
        b.push_str(&xml::escape(&value[last..start]));
        b.push_str("url(#");
        b.push_str(ID_MARK);
        b.push_str(&xml::escape(&value[a..z]));
        b.push(')');
        last = end;
    }
    b.push_str(&xml::escape(&value[last..]));
    Ok(b)
}

/// Keeps a style's declarations in their order, since a later one can win.
fn clean_style(style: &str) -> Result<String, String> {
    if style.contains('\\') || style.contains('@') || style.contains("/*") {
        return fail("style can't contain escapes, at-rules or comments");
    }
    let mut out = Vec::new();
    for decl in style.split(';') {
        if trim(decl).is_empty() {
            continue;
        }
        let colon = decl.find(':');
        let prop = ascii_lower(trim(match colon {
            Some(c) => &decl[..c],
            None => decl,
        }));
        let Some(colon) = colon.filter(|_| PRESENTATION.contains(&prop.as_str())) else {
            return fail(format!("style property \"{prop}\" isn't allowed"));
        };
        out.push(format!(
            "{prop}:{}",
            clean_presentation(trim(&decl[colon + 1..]))?
        ));
    }
    Ok(out.join(";"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_the_canonical_form() {
        let a = sanitize(
            "<s:svg xmlns:s=\"http://www.w3.org/2000/svg\" version=\"1.1\" width=\"20px\" height=\"10\"><s:rect style=\"FILL : URL( '#g' ) ; ;\"/></s:svg>",
        )
        .unwrap();
        assert_eq!(
            a.canonical(),
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 20 10\"><rect style=\"fill:url(#g)\"></rect></svg>"
        );
    }

    #[test]
    fn refuses_what_could_load_or_script() {
        let svg = |body: &str| {
            format!("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\">{body}</svg>")
        };
        assert!(sanitize(&svg("<script/>")).is_err());
        assert!(sanitize(&svg("<rect onclick=\"x\"/>")).is_err());
        assert!(sanitize(&svg("<rect fill=\"url(http://x/#a)\"/>")).is_err());
        assert!(sanitize(&svg("<rect style=\"fill:var(--a)\"/>")).is_err());
        assert!(sanitize(&svg("<use href=\"#a\"/>")).is_err());
        assert!(sanitize(&svg("<path href=\"http://x\"/>")).is_err());
        assert!(sanitize(&svg("<rect fill=\"rgb(1,2,3)\"/>")).is_ok());
        assert!(sanitize(&svg("<rect fill=\"xrgb(1,2,3)\"/>")).is_err());
    }

    #[test]
    fn notices_current_color() {
        assert!(takes_current_color("fill", "currentColor"));
        assert!(takes_current_color("style", "stroke: url(#a) CURRENTCOLOR"));
        assert!(!takes_current_color("fill", "url(#currentColor)"));
        assert!(!takes_current_color("id", "currentColor"));
    }
}
