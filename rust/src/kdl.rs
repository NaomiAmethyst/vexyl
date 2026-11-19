// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! A KDL v2 parser, written to the grammar in the KDL 2.0.0 specification. It keeps what Vexyl
//! needs: where each node and value is, whether a value had a type annotation, and how a string
//! was written. Offsets are in bytes.

/// A document that isn't KDL v2, at the offset where the parser gave up.
#[derive(Debug, Clone)]
pub(crate) struct SyntaxError {
    pub message: String,
    pub offset: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    String,
    Number,
    Bool,
    Null,
}

/// An argument or a property's value.
#[derive(Debug, Clone)]
pub(crate) struct Value {
    pub kind: Kind,
    pub string: String,
    pub number: f64,
    pub boolean: bool,
    /// A string written without quotes.
    #[allow(dead_code)]
    pub bare: bool,
    pub annotated: bool,
    #[allow(dead_code)]
    pub offset: usize,
}

impl Value {
    pub fn is_string(&self) -> bool {
        self.kind == Kind::String
    }

    fn new(kind: Kind, annotated: bool, offset: usize) -> Value {
        Value {
            kind,
            string: String::new(),
            number: 0.0,
            boolean: false,
            bare: false,
            annotated,
            offset,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Node {
    pub name: String,
    pub annotated: bool,
    /// Where it starts, and just past its last character.
    pub start: usize,
    pub end: usize,
    pub args: Vec<Value>,
    /// Properties in order, each key once, with the last given winning.
    pub props: Vec<(String, Value)>,
    /// Properties given more than once, which KDL would let the last of win.
    pub repeated_props: Vec<String>,
    pub children: Vec<Node>,
}

impl Node {
    pub fn prop(&self, key: &str) -> Option<&Value> {
        self.props.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }
}

pub(crate) fn parse(src: &str) -> Result<Vec<Node>, SyntaxError> {
    Reader { s: src, pos: 0 }.document()
}

/// Whether a code point is one of KDL's newlines.
pub(crate) fn is_newline(c: char) -> bool {
    matches!(
        c,
        '\n' | '\r' | '\u{85}' | '\u{0B}' | '\u{0C}' | '\u{2028}' | '\u{2029}'
    )
}

pub(crate) fn is_space(c: char) -> bool {
    matches!(
        c,
        '\t' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}'
    )
}

/// Code points that can't be anywhere in a document, not even in a comment.
pub(crate) fn disallowed(c: char) -> bool {
    let c = c as u32;
    c <= 0x08
        || (0x0E..=0x1F).contains(&c)
        || c == 0x7F
        || (0xD800..=0xDFFF).contains(&c)
        || c == 0x200E
        || c == 0x200F
        || (0x202A..=0x202E).contains(&c)
        || (0x2066..=0x2069).contains(&c)
        || c == 0xFEFF
}

pub(crate) fn identifier_char(c: char) -> bool {
    if is_space(c) || is_newline(c) || disallowed(c) {
        return false;
    }
    !"\\/(){};[]\"#=".contains(c)
}

fn is_digit(c: Option<char>) -> bool {
    matches!(c, Some('0'..='9'))
}

struct Reader<'a> {
    s: &'a str,
    pos: usize,
}

type R<T> = Result<T, SyntaxError>;

impl<'a> Reader<'a> {
    fn error(&self, message: impl Into<String>) -> SyntaxError {
        SyntaxError {
            message: message.into(),
            offset: self.pos,
        }
    }

    fn eof(&self) -> bool {
        self.pos >= self.s.len()
    }

    fn peek(&self) -> Option<char> {
        self.s[self.pos..].chars().next()
    }

    /// The code point after the one at pos.
    fn peek_next(&self) -> Option<char> {
        let mut it = self.s[self.pos..].chars();
        it.next();
        it.next()
    }

    fn peek_next2(&self) -> Option<char> {
        let mut it = self.s[self.pos..].chars();
        it.next();
        it.next();
        it.next()
    }

    fn at(&self, text: &str) -> bool {
        self.s[self.pos..].starts_with(text)
    }

    fn advance(&mut self) {
        if let Some(c) = self.peek() {
            self.pos += c.len_utf8();
        }
    }

    fn document(mut self) -> R<Vec<Node>> {
        for (i, c) in self.s.char_indices() {
            if disallowed(c) && !(c == '\u{FEFF}' && i == 0) {
                self.pos = i;
                return Err(self.error(format!("U+{:04X} can't be in a KDL document", c as u32)));
            }
        }
        if self.at("\u{FEFF}") {
            self.pos += 3;
        }
        let nodes = self.nodes(false)?;
        if !self.eof() {
            let c = self.peek().unwrap_or(' ');
            return Err(self.error(format!("unexpected `{c}`")));
        }
        Ok(nodes)
    }

    fn nodes(&mut self, in_children: bool) -> R<Vec<Node>> {
        let mut nodes = Vec::new();
        loop {
            self.line_space()?;
            if self.eof() {
                if in_children {
                    return Err(self.error("a `{` is never closed"));
                }
                return Ok(nodes);
            }
            if self.peek() == Some('}') {
                if in_children {
                    return Ok(nodes);
                }
                return Err(self.error("a `}` closes nothing"));
            }
            if self.at("/-") {
                self.pos += 2;
                self.line_space()?;
                self.node(in_children)?;
                continue;
            }
            nodes.push(self.node(in_children)?);
        }
    }

    /// Skips whitespace, newlines and comments, as KDL's line-space does.
    fn line_space(&mut self) -> R<()> {
        while !self.eof() {
            if self.node_space()? {
                continue;
            }
            let c = self.peek().unwrap();
            if is_newline(c) {
                self.newline();
            } else if self.at("//") {
                self.line_comment();
            } else {
                return Ok(());
            }
        }
        Ok(())
    }

    fn newline(&mut self) {
        if self.at("\r\n") {
            self.pos += 2;
        } else {
            self.advance();
        }
    }

    fn line_comment(&mut self) {
        while let Some(c) = self.peek() {
            if is_newline(c) {
                break;
            }
            self.advance();
        }
    }

    fn block_comment(&mut self) -> R<()> {
        let start = self.pos;
        self.pos += 2;
        let mut depth = 1;
        while depth > 0 {
            if self.eof() {
                self.pos = start;
                return Err(self.error("a `/*` comment is never closed"));
            }
            if self.at("/*") {
                depth += 1;
                self.pos += 2;
            } else if self.at("*/") {
                depth -= 1;
                self.pos += 2;
            } else {
                self.advance();
            }
        }
        Ok(())
    }

    /// Skips node-space, which is whitespace, block comments and escaped newlines.
    fn node_space(&mut self) -> R<bool> {
        let was = self.pos;
        while let Some(c) = self.peek() {
            if is_space(c) {
                self.advance();
            } else if self.at("/*") {
                self.block_comment()?;
            } else if c == '\\' {
                let back = self.pos;
                self.pos += 1;
                while !self.eof() && (self.peek().is_some_and(is_space) || self.at("/*")) {
                    if self.at("/*") {
                        self.block_comment()?;
                    } else {
                        self.advance();
                    }
                }
                if self.at("//") {
                    self.line_comment();
                    if !self.eof() {
                        self.newline();
                    }
                } else if self.peek().is_some_and(is_newline) {
                    self.newline();
                } else if !self.eof() {
                    self.pos = back;
                    return Err(self.error("a `\\` outside a string has to end its line"));
                }
            } else {
                break;
            }
        }
        Ok(self.pos > was)
    }

    fn node(&mut self, in_children: bool) -> R<Node> {
        let mut n = Node {
            start: self.pos,
            ..Node::default()
        };
        if self.peek() == Some('(') {
            self.annotation()?;
            n.annotated = true;
            self.node_space()?;
        }
        let Some(name) = self.string()? else {
            return Err(self.error("expected a node's name"));
        };
        n.name = name.string;
        n.end = self.pos;
        let mut children_done = false;
        loop {
            let spaced = self.node_space()?;
            let Some(c) = self.peek() else {
                return Ok(n);
            };
            if is_newline(c) || c == ';' || self.at("//") {
                if c == ';' {
                    self.pos += 1;
                }
                return Ok(n);
            }
            if c == '}' {
                if !in_children {
                    return Err(self.error("a `}` closes nothing"));
                }
                return Ok(n);
            }
            if self.at("/-") {
                self.pos += 2;
                self.line_space()?;
                if self.peek() == Some('{') {
                    let mut ignored = Node::default();
                    self.children(&mut ignored)?;
                } else if children_done {
                    return Err(self.error("nothing but children can follow a node's children"));
                } else {
                    let mut ignored = Node::default();
                    self.entry(&mut ignored)?;
                }
                continue;
            }
            if c == '{' {
                if children_done {
                    return Err(self.error("a node has one block of children"));
                }
                self.children(&mut n)?;
                n.end = self.pos;
                children_done = true;
                continue;
            }
            if children_done {
                return Err(self.error("nothing but children can follow a node's children"));
            }
            if !spaced {
                return Err(self.error("expected a space"));
            }
            self.entry(&mut n)?;
            n.end = self.pos;
        }
    }

    fn children(&mut self, n: &mut Node) -> R<()> {
        self.pos += 1;
        let nodes = self.nodes(true)?;
        n.children.extend(nodes);
        self.pos += 1;
        Ok(())
    }

    fn annotation(&mut self) -> R<()> {
        self.pos += 1;
        self.node_space()?;
        if self.string()?.is_none() {
            return Err(self.error("expected a type in the annotation"));
        }
        self.node_space()?;
        if self.peek() != Some(')') {
            return Err(self.error("expected `)`"));
        }
        self.pos += 1;
        Ok(())
    }

    /// Reads an argument or a property into n.
    fn entry(&mut self, n: &mut Node) -> R<()> {
        let start = self.pos;
        let mut annotated = false;
        if self.peek() == Some('(') {
            self.annotation()?;
            annotated = true;
            self.node_space()?;
        }
        let v = self.value(annotated, start)?;
        if v.kind == Kind::String && !annotated {
            let back = self.pos;
            self.node_space()?;
            if self.peek() == Some('=') {
                self.pos += 1;
                self.node_space()?;
                let value_start = self.pos;
                let mut value_annotated = false;
                if self.peek() == Some('(') {
                    self.annotation()?;
                    value_annotated = true;
                    self.node_space()?;
                }
                let value = self.value(value_annotated, value_start)?;
                if let Some(i) = n.props.iter().position(|(k, _)| *k == v.string) {
                    n.repeated_props.push(v.string.clone());
                    n.props.remove(i);
                }
                n.props.push((v.string, value));
                return Ok(());
            }
            self.pos = back;
        } else if self.peek() == Some('=') || self.look_ahead_equals()? {
            return Err(self.error("a property's name has to be a string, without a type"));
        }
        n.args.push(v);
        Ok(())
    }

    fn look_ahead_equals(&mut self) -> R<bool> {
        let back = self.pos;
        self.node_space()?;
        let equals = self.peek() == Some('=');
        self.pos = back;
        Ok(equals)
    }

    fn value(&mut self, annotated: bool, start: usize) -> R<Value> {
        let c = self.peek();
        let at = self.pos;
        let next = self.peek_next();
        if c == Some('#') && next != Some('"') && next != Some('#') {
            return self.keyword(annotated, start);
        }
        if is_digit(c) || (matches!(c, Some('+') | Some('-')) && is_digit(next)) {
            return self.number(annotated, start);
        }
        match self.string()? {
            Some(mut v) => {
                v.annotated = annotated;
                v.offset = start;
                Ok(v)
            }
            None => {
                self.pos = at;
                Err(self.error("expected a value"))
            }
        }
    }

    fn delimited(&self) -> R<()> {
        if let Some(c) = self.peek()
            && identifier_char(c)
        {
            return Err(self.error(format!("unexpected `{c}` after a value")));
        }
        Ok(())
    }

    fn keyword(&mut self, annotated: bool, start: usize) -> R<Value> {
        let from = self.pos;
        self.pos += 1;
        while self.peek().is_some_and(identifier_char) {
            self.advance();
        }
        let word = &self.s[from..self.pos];
        let mut v = Value::new(Kind::Number, annotated, start);
        match word {
            "#true" => {
                v.kind = Kind::Bool;
                v.boolean = true;
            }
            "#false" => v.kind = Kind::Bool,
            "#null" => v.kind = Kind::Null,
            "#inf" => v.number = f64::INFINITY,
            "#-inf" => v.number = f64::NEG_INFINITY,
            "#nan" => v.number = f64::NAN,
            _ => {
                let message = format!("unknown keyword `{word}`");
                self.pos = from;
                return Err(self.error(message));
            }
        }
        Ok(v)
    }

    fn number(&mut self, annotated: bool, start: usize) -> R<Value> {
        let from = self.pos;
        let mut negative = false;
        if let Some(c @ ('+' | '-')) = self.peek() {
            negative = c == '-';
            self.pos += 1;
        }
        let radix = if self.at("0x") {
            16
        } else if self.at("0o") {
            8
        } else if self.at("0b") {
            2
        } else {
            10
        };
        let value = if radix != 10 {
            self.pos += 2;
            let digit = |c: Option<char>| c.and_then(|c| c.to_digit(radix));
            if digit(self.peek()).is_none() {
                return Err(self.error("expected a digit"));
            }
            let mut whole = 0f64;
            while let Some(c) = self.peek() {
                if let Some(d) = c.to_digit(radix) {
                    whole = whole * radix as f64 + d as f64;
                } else if c != '_' {
                    break;
                }
                self.pos += 1;
            }
            if negative { -whole } else { whole }
        } else {
            self.digits();
            if self.peek() == Some('.') {
                self.pos += 1;
                if !is_digit(self.peek()) {
                    return Err(self.error("expected a digit after `.`"));
                }
                self.digits();
            }
            if matches!(self.peek(), Some('e' | 'E')) {
                self.pos += 1;
                if matches!(self.peek(), Some('+' | '-')) {
                    self.pos += 1;
                }
                if !is_digit(self.peek()) {
                    return Err(self.error("expected an exponent"));
                }
                self.digits();
            }
            let text: String = self.s[from..self.pos]
                .chars()
                .filter(|&c| c != '_')
                .collect();
            let mut v: f64 = text.parse().unwrap_or(f64::NAN);
            // A value too small to hold isn't zero, so it's kept as the smallest there is, which
            // is still beyond the format's limits.
            if v == 0.0 && crate::numbers::written_nonzero(&text) {
                v = if negative {
                    -f64::from_bits(1)
                } else {
                    f64::from_bits(1)
                };
            }
            v
        };
        self.delimited()?;
        let mut v = Value::new(Kind::Number, annotated, start);
        v.number = value;
        Ok(v)
    }

    fn digits(&mut self) {
        while matches!(self.peek(), Some('0'..='9' | '_')) {
            self.pos += 1;
        }
    }

    /// Reads a string in any of its forms, or gives None if none starts here.
    fn string(&mut self) -> R<Option<Value>> {
        let start = self.pos;
        let c = self.peek();
        let next = self.peek_next();
        let mut v = Value::new(Kind::String, false, start);
        if c == Some('"') {
            v.string = self.quoted()?;
            return Ok(Some(v));
        }
        if c == Some('#') && (next == Some('"') || next == Some('#')) {
            v.string = self.raw()?;
            return Ok(Some(v));
        }
        let Some(c) = c else {
            return Ok(None);
        };
        if !identifier_char(c) {
            return Ok(None);
        }
        if c.is_ascii_digit() {
            return Err(self.error("a bare string can't start with a digit"));
        }
        if (c == '+' || c == '-')
            && (is_digit(next) || (next == Some('.') && is_digit(self.peek_next2())))
        {
            return Err(self.error("a bare string can't look like a number"));
        }
        if c == '.' && is_digit(next) {
            return Err(self.error("a bare string can't look like a number"));
        }
        while self.peek().is_some_and(identifier_char) {
            self.advance();
        }
        let word = &self.s[start..self.pos];
        match word {
            "true" | "false" | "null" | "inf" | "-inf" | "nan" => {
                let message =
                    format!("`{word}` has to be quoted to be a string, or written `#{word}`");
                self.pos = start;
                Err(self.error(message))
            }
            _ => {
                v.string = word.to_string();
                v.bare = true;
                Ok(Some(v))
            }
        }
    }

    fn quoted(&mut self) -> R<String> {
        if self.at("\"\"\"") {
            let start = self.pos;
            self.pos += 3;
            if !self.peek().is_some_and(is_newline) {
                return Err(self.error("a multi-line string starts a new line after its `\"\"\"`"));
            }
            let body_start = self.pos;
            loop {
                if self.eof() {
                    self.pos = start;
                    return Err(self.error("a string is never closed"));
                }
                if self.peek() == Some('\\') {
                    self.pos += 1;
                    self.advance();
                } else if self.at("\"\"\"") {
                    break;
                } else {
                    self.advance();
                }
            }
            let body = &self.s[body_start..self.pos];
            self.pos += 3;
            let dedented = self.dedent(body, start)?;
            return self.unescape(&dedented, start);
        }
        let start = self.pos;
        self.pos += 1;
        loop {
            let Some(c) = self.peek() else {
                self.pos = start;
                return Err(self.error("a string is never closed"));
            };
            if c == '\\' {
                self.pos += 1;
                self.advance();
            } else if c == '"' {
                break;
            } else if is_newline(c) {
                return Err(self.error("a string on one line can't hold a newline; use `\"\"\"`"));
            } else {
                self.advance();
            }
        }
        let body = &self.s[start + 1..self.pos];
        self.pos += 1;
        self.unescape(body, start + 1)
    }

    fn raw(&mut self) -> R<String> {
        let start = self.pos;
        let mut hashes = 0;
        while self.peek() == Some('#') {
            hashes += 1;
            self.pos += 1;
        }
        let mut close = format!("\"{}", "#".repeat(hashes));
        let multi = self.at("\"\"\"");
        if multi {
            self.pos += 3;
            if !self.peek().is_some_and(is_newline) {
                return Err(self.error("a multi-line string starts a new line after its `\"\"\"`"));
            }
            close = format!("\"\"\"{}", "#".repeat(hashes));
        } else {
            self.pos += 1;
        }
        let body_start = self.pos;
        let Some(found) = self.s[self.pos..].find(&close) else {
            self.pos = start;
            return Err(self.error("a raw string is never closed"));
        };
        let end = self.pos + found;
        let body = &self.s[body_start..end];
        self.pos = end + close.len();
        if multi {
            return self.dedent(body, start);
        }
        for (i, c) in body.char_indices() {
            if is_newline(c) {
                self.pos = body_start + i;
                return Err(self.error("a raw string on one line can't hold a newline"));
            }
        }
        Ok(body.to_string())
    }

    /// Removes a multi-line string's indentation, which is whatever is before its closing quotes,
    /// from each of its lines. KDL does this before it resolves escapes.
    fn dedent(&mut self, body: &str, start: usize) -> R<String> {
        let mut lines = Vec::new();
        let mut from = 0;
        let mut iter = body.char_indices().peekable();
        while let Some((i, c)) = iter.next() {
            if is_newline(c) {
                lines.push(&body[from..i]);
                let mut next = i + c.len_utf8();
                if c == '\r' && body[next..].starts_with('\n') {
                    iter.next();
                    next += 1;
                }
                from = next;
            }
        }
        lines.push(&body[from..]);
        let prefix = lines[lines.len() - 1];
        if !blank(prefix) {
            self.pos = start;
            return Err(
                self.error("a multi-line string's closing `\"\"\"` has to be on a line of its own")
            );
        }
        let mut out = String::new();
        for (i, line) in lines.iter().enumerate().take(lines.len() - 1).skip(1) {
            if i > 1 {
                out.push('\n');
            }
            if blank(line) {
                continue;
            }
            let Some(rest) = line.strip_prefix(prefix) else {
                self.pos = start;
                return Err(self.error(
                    "each line of a multi-line string has to start with the indentation of its last",
                ));
            };
            out.push_str(rest);
        }
        Ok(out)
    }

    fn unescape(&mut self, body: &str, start: usize) -> R<String> {
        if !body.contains('\\') {
            return Ok(body.to_string());
        }
        let mut out = String::new();
        let bytes = body.as_bytes();
        let mut i = 0;
        while i < body.len() {
            let c = body[i..].chars().next().unwrap();
            if c != '\\' {
                out.push(c);
                i += c.len_utf8();
                continue;
            }
            if i + 1 >= body.len() {
                self.pos = start;
                return Err(self.error("a string ends in the middle of an escape"));
            }
            let e = body[i + 1..].chars().next().unwrap();
            let simple = match e {
                'n' => Some('\n'),
                'r' => Some('\r'),
                't' => Some('\t'),
                '\\' => Some('\\'),
                '"' => Some('"'),
                'b' => Some('\u{8}'),
                'f' => Some('\u{C}'),
                's' => Some(' '),
                _ => None,
            };
            if let Some(r) = simple {
                out.push(r);
                i += 2;
                continue;
            }
            if e == 'u' {
                let bad = "a `\\u` escape is written `\\u{` and 1 to 6 hexadecimal digits `}`";
                let close = body[i..].find('}').map(|p| p + i);
                let ok = i + 2 < body.len() && bytes[i + 2] == b'{';
                let Some(close) = close.filter(|&c| ok && c >= i + 4 && c - (i + 3) <= 6) else {
                    self.pos = start;
                    return Err(self.error(bad));
                };
                let hex = &body[i + 3..close];
                if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                    self.pos = start;
                    return Err(self.error(bad));
                }
                let code = u32::from_str_radix(hex, 16).unwrap_or(u32::MAX);
                let Some(ch) = char::from_u32(code) else {
                    self.pos = start;
                    return Err(self.error("a `\\u` escape has to be a Unicode scalar value"));
                };
                out.push(ch);
                i = close + 1;
                continue;
            }
            if is_space(e) || is_newline(e) {
                i += 1;
                while let Some(c) = body[i..].chars().next() {
                    if !(is_space(c) || is_newline(c)) {
                        break;
                    }
                    i += c.len_utf8();
                }
                continue;
            }
            self.pos = start;
            return Err(self.error(format!("unknown escape `\\{e}`")));
        }
        Ok(out)
    }
}

fn blank(text: &str) -> bool {
    text.chars().all(is_space)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_nodes_values_and_children() {
        let nodes = parse("a 1 \"two\" k=#true { b; c 0x10 }\n").unwrap();
        assert_eq!(nodes.len(), 1);
        let a = &nodes[0];
        assert_eq!(a.name, "a");
        assert_eq!(a.args.len(), 2);
        assert_eq!(a.args[0].number, 1.0);
        assert_eq!(a.args[1].string, "two");
        assert!(a.prop("k").unwrap().boolean);
        assert_eq!(a.children.len(), 2);
        assert_eq!(a.children[1].args[0].number, 16.0);
    }

    #[test]
    fn refuses_bare_keywords() {
        assert!(parse("a true").is_err());
        assert!(parse("a -inf").is_err());
        assert!(parse("a #inf").is_ok());
    }

    #[test]
    fn dedents_multi_line_strings() {
        let nodes = parse("a \"\"\"\n    x\n      y\n    \"\"\"").unwrap();
        assert_eq!(nodes[0].args[0].string, "x\n  y");
        let raw = parse("a #\"\"\"\n  \\n\n  \"\"\"#").unwrap();
        assert_eq!(raw[0].args[0].string, "\\n");
    }

    #[test]
    fn keeps_a_tiny_number_from_being_zero() {
        let nodes = parse("a 1e-400").unwrap();
        assert!(nodes[0].args[0].number != 0.0);
        let zero = parse("a 0e-400").unwrap();
        assert_eq!(zero[0].args[0].number, 0.0);
    }

    #[test]
    fn notes_repeated_properties() {
        let nodes = parse("a k=1 k=2").unwrap();
        assert_eq!(nodes[0].repeated_props, vec!["k"]);
        assert_eq!(nodes[0].prop("k").unwrap().number, 2.0);
    }

    #[test]
    fn reports_where_it_gave_up() {
        let err = parse("a \"x").unwrap_err();
        assert_eq!(err.offset, 2);
        let err = parse("a\u{1}").unwrap_err();
        assert_eq!(err.offset, 1);
    }
}
