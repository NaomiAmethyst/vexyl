// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! Plain data, as the canonical model and the command's JSON are written.

use std::fmt::Write as _;

/// A value of the canonical model of section 4 of the SDK: plain maps, lists, strings, numbers
/// and booleans. A document's names are only ever keys of a [`Map`], never anything else.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    List(Vec<Value>),
    Map(Map),
}

/// A map with string keys, which keeps them in the order they were added.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Map {
    entries: Vec<(String, Value)>,
}

impl Map {
    /// An empty map.
    pub fn new() -> Map {
        Map::default()
    }

    /// The value of a key, if it has one.
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.entries.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    /// Sets a key's value, keeping the key's place if it already has one.
    pub fn insert(&mut self, key: impl Into<String>, value: Value) {
        let key = key.into();
        if let Some(e) = self.entries.iter_mut().find(|(k, _)| *k == key) {
            e.1 = value;
        } else {
            self.entries.push((key, value));
        }
    }

    /// Takes a key and its value out.
    pub fn remove(&mut self, key: &str) -> Option<Value> {
        let i = self.entries.iter().position(|(k, _)| k == key)?;
        Some(self.entries.remove(i).1)
    }

    /// The keys and values, in order.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &Value)> {
        self.entries.iter().map(|(k, v)| (k.as_str(), v))
    }

    /// The keys, in order.
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.entries.iter().map(|(k, _)| k.as_str())
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

impl Value {
    /// The map this is, if it's one.
    pub fn as_map(&self) -> Option<&Map> {
        match self {
            Value::Map(m) => Some(m),
            _ => None,
        }
    }

    /// The list this is, if it's one.
    pub fn as_list(&self) -> Option<&[Value]> {
        match self {
            Value::List(l) => Some(l),
            _ => None,
        }
    }

    /// The string this is, if it's one.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::String(s) => Some(s),
            _ => None,
        }
    }

    /// The number this is, if it's one.
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Number(n) => Some(*n),
            _ => None,
        }
    }

    /// The boolean this is, if it's one.
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Value::Bool(b) => Some(*b),
            _ => None,
        }
    }

    /// A key's value, if this is a map with that key.
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.as_map()?.get(key)
    }

    /// Writes the value as JSON, indented by a space a level if `indent` is set.
    pub fn to_json(&self, indent: bool) -> String {
        let mut b = String::new();
        write(&mut b, self, if indent { Some(0) } else { None });
        b
    }
}

impl From<&str> for Value {
    fn from(s: &str) -> Value {
        Value::String(s.to_string())
    }
}

impl From<String> for Value {
    fn from(s: String) -> Value {
        Value::String(s)
    }
}

impl From<f64> for Value {
    fn from(n: f64) -> Value {
        Value::Number(n)
    }
}

impl From<usize> for Value {
    fn from(n: usize) -> Value {
        Value::Number(n as f64)
    }
}

impl From<bool> for Value {
    fn from(b: bool) -> Value {
        Value::Bool(b)
    }
}

impl From<Map> for Value {
    fn from(m: Map) -> Value {
        Value::Map(m)
    }
}

impl From<Vec<Value>> for Value {
    fn from(l: Vec<Value>) -> Value {
        Value::List(l)
    }
}

/// A number as its shortest decimal, without an exponent.
pub(crate) fn number(v: f64) -> String {
    if v == 0.0 {
        return "0".into();
    }
    format!("{v}")
}

fn newline(b: &mut String, depth: Option<usize>) {
    if let Some(d) = depth {
        b.push('\n');
        for _ in 0..d {
            b.push(' ');
        }
    }
}

fn write(b: &mut String, value: &Value, depth: Option<usize>) {
    let inner = depth.map(|d| d + 1);
    match value {
        Value::Null => b.push_str("null"),
        Value::Bool(v) => b.push_str(if *v { "true" } else { "false" }),
        Value::Number(v) => {
            if v.is_finite() {
                b.push_str(&number(*v));
            } else {
                b.push_str("null");
            }
        }
        Value::String(s) => string(b, s),
        Value::Map(m) => {
            if m.is_empty() {
                b.push_str("{}");
                return;
            }
            b.push('{');
            for (i, (k, v)) in m.iter().enumerate() {
                if i > 0 {
                    b.push(',');
                }
                newline(b, inner);
                string(b, k);
                b.push_str(if depth.is_some() { ": " } else { ":" });
                write(b, v, inner);
            }
            newline(b, depth);
            b.push('}');
        }
        Value::List(l) => {
            if l.is_empty() {
                b.push_str("[]");
                return;
            }
            b.push('[');
            for (i, v) in l.iter().enumerate() {
                if i > 0 {
                    b.push(',');
                }
                newline(b, inner);
                write(b, v, inner);
            }
            newline(b, depth);
            b.push(']');
        }
    }
}

pub(crate) fn string(b: &mut String, s: &str) {
    b.push('"');
    for c in s.chars() {
        match c {
            '"' => b.push_str("\\\""),
            '\\' => b.push_str("\\\\"),
            '\n' => b.push_str("\\n"),
            '\r' => b.push_str("\\r"),
            '\t' => b.push_str("\\t"),
            c if (c as u32) < 0x20 || c == '\u{2028}' || c == '\u{2029}' => {
                let _ = write!(b, "\\u{:04x}", c as u32);
            }
            c => b.push(c),
        }
    }
    b.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_json() {
        let mut m = Map::new();
        m.insert("a", Value::Number(1.0));
        m.insert(
            "b",
            Value::List(vec![Value::Number(0.5), "x\n".into(), Value::Bool(true)]),
        );
        assert_eq!(
            Value::Map(m.clone()).to_json(false),
            "{\"a\":1,\"b\":[0.5,\"x\\n\",true]}"
        );
        assert_eq!(
            Value::Map(m).to_json(true),
            "{\n \"a\": 1,\n \"b\": [\n  0.5,\n  \"x\\n\",\n  true\n ]\n}"
        );
        assert_eq!(number(1e-7), "0.0000001");
        assert_eq!(number(-0.0), "0");
    }
}
