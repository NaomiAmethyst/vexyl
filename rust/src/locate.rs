// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! Finds where each layer and other part of a document is, from its syntax alone.

use crate::Span;
use crate::kdl::{self, Node};
use crate::parser::{normalize_newlines, place};

const LAYER_NAMES: &[&str] = &[
    "field", "bars", "chevrons", "band", "cross", "saltire", "quarters", "checks", "rays", "pile",
    "pall", "charge", "emblem", "group", "panel", "canton", "use",
];
const HOLDS_LAYERS: &[&str] = &["emblem", "group", "panel", "canton"];

/// Writes a name in a path, where a slash separates the parts.
pub(crate) fn encode_name(name: &str) -> String {
    name.replace('%', "%25").replace('/', "%2F")
}

pub(crate) fn decode_name(part: &str) -> String {
    part.replace("%2F", "/").replace("%25", "%")
}

/// The path of what holds a layer, or "" if it's at the top of its scope.
pub(crate) fn parent_path(path: &str) -> &str {
    match (path.rfind('.'), path.rfind('/')) {
        (Some(dot), Some(slash)) if dot > slash => &path[..dot],
        (Some(dot), None) => &path[..dot],
        _ => "",
    }
}

pub(crate) fn locate(text: &str) -> Vec<Span> {
    let src = normalize_newlines(text);
    let Ok(doc) = kdl::parse(&src) else {
        return Vec::new();
    };
    let mut spans = Vec::new();
    let mut index = 0;
    for n in &doc {
        let name = n.name.as_str();
        if LAYER_NAMES.contains(&name) {
            let path = index.to_string();
            index += 1;
            add(&mut spans, &src, n, &path);
            if HOLDS_LAYERS.contains(&name) {
                layers(&mut spans, &src, &n.children, &format!("{path}."));
            }
        } else if name == "palette" {
            add(&mut spans, &src, n, name);
            for c in &n.children {
                add(
                    &mut spans,
                    &src,
                    c,
                    &format!("palette/{}", encode_name(&c.name)),
                );
            }
        } else if name == "define" || name == "fold" {
            if let Some(path) = named(n, name) {
                add(&mut spans, &src, n, &path);
                if name == "define" {
                    layers(&mut spans, &src, &n.children, &format!("{path}/"));
                }
            }
        } else if name == "variant" {
            if let Some(path) = named(n, name) {
                add(&mut spans, &src, n, &path);
                layers(&mut spans, &src, &n.children, &format!("{path}/"));
                for c in &n.children {
                    if c.name == "outline" || c.name == "border" {
                        add(&mut spans, &src, c, &format!("{path}/{}", c.name));
                    }
                }
            }
        } else if name == "reverse" {
            add(&mut spans, &src, n, name);
            layers(&mut spans, &src, &n.children, "reverse/");
        } else {
            add(&mut spans, &src, n, name);
        }
    }
    spans
}

fn named(n: &Node, kind: &str) -> Option<String> {
    let first = n.args.first().filter(|a| a.is_string())?;
    Some(format!("{kind}/{}", encode_name(&first.string)))
}

fn layers(spans: &mut Vec<Span>, src: &str, list: &[Node], base: &str) {
    let mut i = 0;
    for n in list {
        if LAYER_NAMES.contains(&n.name.as_str()) {
            let path = format!("{base}{i}");
            add(spans, src, n, &path);
            if HOLDS_LAYERS.contains(&n.name.as_str()) {
                layers(spans, src, &n.children, &format!("{path}."));
            }
            i += 1;
        }
    }
}

fn add(spans: &mut Vec<Span>, src: &str, n: &Node, path: &str) {
    let (line, column) = place(src, n.start);
    // The end is just past the last character, as the reference counts it.
    let (end_line, end_column) = place(src, n.end);
    spans.push(Span {
        path: path.to_string(),
        node: n.name.clone(),
        line,
        column,
        end_line,
        end_column,
    });
}

/// The innermost span holding a line: the one that starts latest, and in a tie, the last.
pub(crate) fn layer_at(spans: &[Span], line: usize) -> Option<&Span> {
    let mut best: Option<&Span> = None;
    for s in spans {
        if line >= s.line
            && line <= s.end_line
            && best.is_none_or(|b| s.line > b.line || (s.line == b.line && s.column >= b.column))
        {
            best = Some(s);
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_names() {
        assert_eq!(encode_name("a/b%c"), "a%2Fb%25c");
        assert_eq!(decode_name("a%2Fb%25c"), "a/b%c");
        assert_eq!(decode_name(&encode_name("%2F")), "%2F");
    }

    #[test]
    fn finds_parents() {
        assert_eq!(parent_path("3.1"), "3");
        assert_eq!(parent_path("3"), "");
        assert_eq!(parent_path("variant/a.b/0"), "");
        assert_eq!(parent_path("variant/x/2.0"), "variant/x/2");
    }
}
