// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! Reads well-formed XML 1.0 with namespaces, one token at a time, as SPEC section 8.3 defines
//! it, and refuses everything else. A sanitizer's security rests on reading markup exactly one
//! way, so nothing here is lenient.

use std::collections::{HashMap, HashSet};

pub(crate) const XML_NAMESPACE: &str = "http://www.w3.org/XML/1998/namespace";
pub(crate) const XMLNS_NAMESPACE: &str = "http://www.w3.org/2000/xmlns/";

/// A name with its namespace worked out.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct Name {
    pub space: String,
    pub local: String,
}

#[derive(Debug, Clone)]
pub(crate) struct Attr {
    pub name: Name,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Start,
    End,
    Text,
    Other,
    Directive,
}

#[derive(Debug, Clone)]
pub(crate) struct Token {
    pub kind: Kind,
    pub name: Option<Name>,
    pub attrs: Vec<Attr>,
    pub text: String,
}

impl Token {
    fn of(kind: Kind) -> Token {
        Token {
            kind,
            name: None,
            attrs: Vec::new(),
            text: String::new(),
        }
    }
}

/// Malformed markup.
#[derive(Debug, Clone)]
pub(crate) struct XmlError(pub String);

type R<T> = Result<T, XmlError>;

fn err<T>(message: impl Into<String>) -> R<T> {
    Err(XmlError(message.into()))
}

/// An open element, with what its namespace declarations replaced.
struct Frame {
    raw: String,
    name: Name,
    undo: Vec<(String, Option<String>)>,
}

pub(crate) struct Xml {
    src: String,
    pos: usize,
    stack: Vec<Frame>,
    ns: HashMap<String, String>,
    pending: Option<Token>,
    done_root: bool,
}

pub(crate) fn xml_char(r: u32) -> bool {
    r == 0x09
        || r == 0x0a
        || r == 0x0d
        || (0x20..=0xd7ff).contains(&r)
        || (0xe000..=0xfffd).contains(&r)
        || (0x10000..=0x10ffff).contains(&r)
}

fn xml_space(c: u8) -> bool {
    matches!(c, b' ' | b'\t' | b'\n' | b'\r')
}

fn name_start(c: char) -> bool {
    let r = c as u32;
    r == ':' as u32
        || r == '_' as u32
        || c.is_ascii_alphabetic()
        || (0xc0..=0xd6).contains(&r)
        || (0xd8..=0xf6).contains(&r)
        || (0xf8..=0x2ff).contains(&r)
        || (0x370..=0x37d).contains(&r)
        || (0x37f..=0x1fff).contains(&r)
        || (0x200c..=0x200d).contains(&r)
        || (0x2070..=0x218f).contains(&r)
        || (0x2c00..=0x2fef).contains(&r)
        || (0x3001..=0xd7ff).contains(&r)
        || (0xf900..=0xfdcf).contains(&r)
        || (0xfdf0..=0xfffd).contains(&r)
        || (0x10000..=0xeffff).contains(&r)
}

fn name_char(c: char) -> bool {
    let r = c as u32;
    name_start(c)
        || c == '-'
        || c == '.'
        || c.is_ascii_digit()
        || r == 0xb7
        || (0x300..=0x36f).contains(&r)
        || (0x203f..=0x2040).contains(&r)
}

fn ended<T>() -> R<T> {
    err("unexpected end of the markup")
}

/// Turns CRLF and lone CR into LF.
pub(crate) fn normalize_newlines(s: &str) -> String {
    if !s.contains('\r') {
        return s.to_string();
    }
    s.replace("\r\n", "\n").replace('\r', "\n")
}

/// Divides a name at its colon, of which it can have one, between two parts.
fn split_qname(raw: &str) -> R<(String, String)> {
    let Some(colon) = raw.find(':') else {
        return Ok((String::new(), raw.to_string()));
    };
    let before = &raw[..colon];
    let after = &raw[colon + 1..];
    if before.is_empty()
        || after.is_empty()
        || after.contains(':')
        || !after.chars().next().is_some_and(name_start)
    {
        return err(format!("\"{raw}\" isn't a valid qualified name"));
    }
    Ok((before.to_string(), after.to_string()))
}

impl Xml {
    pub fn new(markup: &str) -> R<Xml> {
        for c in markup.chars() {
            if !xml_char(c as u32) {
                return err(format!("U+{:04X} isn't an XML character", c as u32));
            }
        }
        let mut ns = HashMap::new();
        ns.insert("xml".to_string(), XML_NAMESPACE.to_string());
        Ok(Xml {
            src: normalize_newlines(markup),
            pos: 0,
            stack: Vec::new(),
            ns,
            pending: None,
            done_root: false,
        })
    }

    fn rest(&self) -> &str {
        &self.src[self.pos..]
    }

    fn byte(&self) -> u8 {
        self.src.as_bytes()[self.pos]
    }

    /// The next token, or None once the document has ended properly.
    pub fn token(&mut self) -> R<Option<Token>> {
        if let Some(t) = self.pending.take() {
            return Ok(Some(t));
        }
        if self.pos >= self.src.len() {
            if !self.stack.is_empty() {
                return ended();
            }
            return Ok(None);
        }
        if self.byte() != b'<' {
            return self.text().map(Some);
        }
        let rest = self.rest();
        if rest.starts_with("</") {
            return self.end_tag().map(Some);
        }
        if rest.starts_with("<?") {
            return self.instruction().map(Some);
        }
        if rest.starts_with("<!--") {
            return self.comment().map(Some);
        }
        if rest.starts_with("<![CDATA[") {
            return self.cdata().map(Some);
        }
        if rest.starts_with("<!") {
            // A directive is always refused, so there's no need to find where it ends.
            self.pos = self.src.len();
            return Ok(Some(Token::of(Kind::Directive)));
        }
        self.start_tag().map(Some)
    }

    /// Character data, which outside the root can only be whitespace.
    fn text(&mut self) -> R<Token> {
        let mut b = String::new();
        while self.pos < self.src.len() && self.byte() != b'<' {
            let c = self.byte();
            if c == b'&' {
                if self.stack.is_empty() {
                    return err("a character reference can't appear outside the root");
                }
                let r = self.reference()?;
                b.push_str(&r);
            } else if c == b']' && self.rest().starts_with("]]>") {
                return err("]]> can't appear in text");
            } else {
                let ch = self.rest().chars().next().unwrap();
                b.push(ch);
                self.pos += ch.len_utf8();
            }
        }
        Ok(Token {
            kind: Kind::Text,
            name: None,
            attrs: Vec::new(),
            text: b,
        })
    }

    fn cdata(&mut self) -> R<Token> {
        if self.stack.is_empty() {
            return err("a CDATA section can't appear outside the root");
        }
        let start = self.pos + "<![CDATA[".len();
        let Some(end) = self.src[start..].find("]]>").map(|e| e + start) else {
            return ended();
        };
        self.pos = end + 3;
        Ok(Token {
            kind: Kind::Text,
            name: None,
            attrs: Vec::new(),
            text: self.src[start..end].to_string(),
        })
    }

    fn comment(&mut self) -> R<Token> {
        let start = self.pos + "<!--".len();
        let Some(end) = self.src[start..].find("--").map(|e| e + start) else {
            return ended();
        };
        if !self.src[end..].starts_with("-->") {
            return err("\"--\" can't appear in a comment");
        }
        self.pos = end + 3;
        Ok(Token::of(Kind::Other))
    }

    fn instruction(&mut self) -> R<Token> {
        let begin = self.pos;
        self.pos += 2;
        let Ok(target) = self.name() else {
            return err("expected a target after <?");
        };
        let Some(end) = self.src[self.pos..].find("?>").map(|e| e + self.pos) else {
            return ended();
        };
        let data = self.src[self.pos..end].to_string();
        if !data.is_empty() && !xml_space(data.as_bytes()[0]) {
            return err("a processing instruction's target needs a space after it");
        }
        self.pos = end + 2;
        if target.eq_ignore_ascii_case("xml") {
            if begin != 0 || target != "xml" {
                return err("an XML declaration can only come first");
            }
            check_declaration(&data)?;
        } else if target.contains(':') {
            return err("a processing instruction's target can't have a colon");
        }
        Ok(Token::of(Kind::Other))
    }

    /// An XML 1.0 Name.
    fn name(&mut self) -> R<String> {
        let start = self.pos;
        while let Some(c) = self.src[self.pos..].chars().next() {
            let ok = if self.pos == start {
                name_start(c)
            } else {
                name_char(c)
            };
            if !ok {
                break;
            }
            self.pos += c.len_utf8();
        }
        if self.pos == start {
            return err("expected a name");
        }
        Ok(self.src[start..self.pos].to_string())
    }

    fn space(&mut self) -> bool {
        let start = self.pos;
        while self.pos < self.src.len() && xml_space(self.byte()) {
            self.pos += 1;
        }
        self.pos > start
    }

    fn end_tag(&mut self) -> R<Token> {
        self.pos += 2;
        let Ok(raw) = self.name() else {
            return err("expected a name after </");
        };
        self.space();
        if self.pos >= self.src.len() {
            return ended();
        }
        if self.byte() != b'>' {
            return err(format!("unexpected characters in </{raw}>"));
        }
        self.pos += 1;
        let Some(top) = self.stack.last() else {
            return err(format!("</{raw}> closes nothing"));
        };
        if top.raw != raw {
            return err(format!("<{}> is closed by </{raw}>", top.raw));
        }
        Ok(self.close_element())
    }

    fn close_element(&mut self) -> Token {
        let top = self.stack.pop().expect("an open element");
        for (prefix, was) in top.undo.into_iter().rev() {
            match was {
                Some(v) => {
                    self.ns.insert(prefix, v);
                }
                None => {
                    self.ns.remove(&prefix);
                }
            }
        }
        if self.stack.is_empty() {
            self.done_root = true;
        }
        Token {
            kind: Kind::End,
            name: Some(top.name),
            attrs: Vec::new(),
            text: String::new(),
        }
    }

    fn start_tag(&mut self) -> R<Token> {
        self.pos += 1;
        let Ok(raw) = self.name() else {
            return err("expected a name after <");
        };
        if self.done_root {
            return err("markup can only have one root element");
        }
        let mut attrs: Vec<(String, String)> = Vec::new();
        let mut seen = HashSet::new();
        let mut self_closing = false;
        loop {
            let spaced = self.space();
            if self.pos >= self.src.len() {
                return ended();
            }
            let c = self.byte();
            if c == b'>' {
                self.pos += 1;
                break;
            }
            if c == b'/' {
                if !self.rest().starts_with("/>") {
                    return err("expected /> in an element");
                }
                self.pos += 2;
                self_closing = true;
                break;
            }
            if !spaced {
                return err(format!("<{raw}> needs a space before each attribute"));
            }
            let Ok(name) = self.name() else {
                return err(format!("expected an attribute name in <{raw}>"));
            };
            if !seen.insert(name.clone()) {
                return err(format!("attribute \"{name}\" is repeated"));
            }
            self.space();
            if self.pos >= self.src.len() || self.byte() != b'=' {
                return err(format!("attribute \"{name}\" has no value"));
            }
            self.pos += 1;
            self.space();
            let value = self.attr_value()?;
            attrs.push((name, value));
        }
        let mut frame = Frame {
            raw: raw.clone(),
            name: Name {
                space: String::new(),
                local: String::new(),
            },
            undo: Vec::new(),
        };
        // Declarations apply to the element they're on, so they're read first.
        for (n, v) in &attrs {
            self.declare(n, v, &mut frame)?;
        }
        let (prefix, local) = match split_qname(&raw) {
            Ok(q) => q,
            Err(e) => {
                self.undo(frame);
                return Err(e);
            }
        };
        if prefix == "xmlns" {
            return err("an element can't use the xmlns prefix");
        }
        let space = self.ns.get(&prefix).cloned().unwrap_or_default();
        if !prefix.is_empty() && space.is_empty() {
            return err(format!("prefix \"{prefix}\" isn't declared"));
        }
        frame.name = Name { space, local };
        let mut expanded = HashSet::new();
        let mut out = Vec::new();
        for (n, v) in attrs {
            if n == "xmlns" || n.starts_with("xmlns:") {
                continue;
            }
            let (ap, al) = split_qname(&n)?;
            let mut aspace = String::new();
            if !ap.is_empty() {
                aspace = self.ns.get(&ap).cloned().unwrap_or_default();
                if aspace.is_empty() {
                    return err(format!("prefix \"{ap}\" isn't declared"));
                }
            }
            let name = Name {
                space: aspace,
                local: al,
            };
            if !expanded.insert(name.clone()) {
                return err(format!("attribute \"{n}\" is repeated"));
            }
            out.push(Attr { name, value: v });
        }
        let name = frame.name.clone();
        self.stack.push(frame);
        let tok = Token {
            kind: Kind::Start,
            name: Some(name),
            attrs: out,
            text: String::new(),
        };
        if self_closing {
            self.pending = Some(self.close_element());
        }
        Ok(tok)
    }

    /// Puts back what a frame that's never pushed declared. Every error stops reading, so this
    /// only keeps the reader's state tidy.
    fn undo(&mut self, frame: Frame) {
        for (prefix, was) in frame.undo.into_iter().rev() {
            match was {
                Some(v) => {
                    self.ns.insert(prefix, v);
                }
                None => {
                    self.ns.remove(&prefix);
                }
            }
        }
    }

    /// Applies a namespace declaration, if an attribute is one.
    fn declare(&mut self, name: &str, value: &str, frame: &mut Frame) -> R<()> {
        let prefix;
        if name == "xmlns" {
            // The default namespace.
            prefix = String::new();
        } else if let Some(p) = name.strip_prefix("xmlns:") {
            prefix = p.to_string();
            split_qname(name)?;
            if prefix == "xmlns" {
                return err("the xmlns prefix can't be declared");
            }
            if value.is_empty() {
                return err(format!("prefix \"{prefix}\" can't be undeclared"));
            }
        } else {
            return Ok(());
        }
        if (prefix == "xml") != (value == XML_NAMESPACE) || value == XMLNS_NAMESPACE {
            return err(format!(
                "namespace \"{value}\" can't be bound to that prefix"
            ));
        }
        let was = self.ns.insert(prefix.clone(), value.to_string());
        frame.undo.push((prefix, was));
        Ok(())
    }

    /// A quoted value, with literal whitespace turned into spaces as XML says.
    fn attr_value(&mut self) -> R<String> {
        if self.pos >= self.src.len() || (self.byte() != b'"' && self.byte() != b'\'') {
            return err("an attribute's value needs quotes");
        }
        let quote = self.byte();
        self.pos += 1;
        let mut b = String::new();
        loop {
            if self.pos >= self.src.len() {
                return ended();
            }
            let c = self.byte();
            if c == quote {
                self.pos += 1;
                return Ok(b);
            }
            match c {
                b'<' => return err("< can't appear in an attribute's value"),
                b'&' => {
                    let r = self.reference()?;
                    b.push_str(&r);
                }
                b'\t' | b'\n' | b'\r' => {
                    b.push(' ');
                    self.pos += 1;
                }
                _ => {
                    let ch = self.rest().chars().next().unwrap();
                    b.push(ch);
                    self.pos += ch.len_utf8();
                }
            }
        }
    }

    /// One of XML's five named entities, or a reference to a character.
    fn reference(&mut self) -> R<String> {
        let Some(end) = self.src[self.pos..].find(';').map(|e| e + self.pos) else {
            return err("& needs to begin a reference ending in ;");
        };
        let body = self.src[self.pos + 1..end].to_string();
        self.pos = end + 1;
        match body.as_str() {
            "lt" => return Ok("<".into()),
            "gt" => return Ok(">".into()),
            "amp" => return Ok("&".into()),
            "apos" => return Ok("'".into()),
            "quot" => return Ok("\"".into()),
            _ => {}
        }
        let (digits, base) = if let Some(d) = body.strip_prefix("#x") {
            (d, 16)
        } else if let Some(d) = body.strip_prefix('#') {
            (d, 10)
        } else {
            return err(format!("unknown entity &{body};"));
        };
        let mut v: u64 = 0;
        let mut ok = !digits.is_empty();
        for c in digits.chars() {
            if !ok {
                break;
            }
            match c.to_digit(base) {
                Some(d) if c.is_ascii() => {
                    v = v * base as u64 + d as u64;
                    ok = v <= 0x10ffff;
                }
                _ => ok = false,
            }
        }
        if !ok || !xml_char(v as u32) {
            return err(format!("invalid reference &{body};"));
        }
        Ok(char::from_u32(v as u32)
            .map(String::from)
            .unwrap_or_default())
    }
}

/// Reads `version="1.0" encoding="UTF-8" standalone="yes"`, of which only the version is
/// required, in that order.
fn check_declaration(data: &str) -> R<()> {
    let mut pos = 0;
    let Some(version) = field(data, &mut pos, "version")? else {
        return bad();
    };
    if version != "1.0" {
        return err(format!(
            "unsupported XML version \"{version}\"; only 1.0 is"
        ));
    }
    if let Some(encoding) = field(data, &mut pos, "encoding")?
        && !encoding.eq_ignore_ascii_case("utf-8")
    {
        return err(format!(
            "unsupported encoding \"{encoding}\"; only UTF-8 is"
        ));
    }
    if let Some(standalone) = field(data, &mut pos, "standalone")?
        && standalone != "yes"
        && standalone != "no"
    {
        return bad();
    }
    if data.as_bytes()[pos..].iter().any(|&c| !xml_space(c)) {
        return bad();
    }
    Ok(())
}

fn bad<T>() -> R<T> {
    err("malformed XML declaration")
}

/// One field of a declaration, or None if the next isn't that one.
fn field(data: &str, pos: &mut usize, key: &str) -> R<Option<String>> {
    let d = data.as_bytes();
    let mut i = *pos;
    while i < d.len() && xml_space(d[i]) {
        i += 1;
    }
    if i == *pos || !data[i..].starts_with(key) {
        return Ok(None);
    }
    i += key.len();
    while i < d.len() && xml_space(d[i]) {
        i += 1;
    }
    if i >= d.len() || d[i] != b'=' {
        return bad();
    }
    i += 1;
    while i < d.len() && xml_space(d[i]) {
        i += 1;
    }
    if i >= d.len() || (d[i] != b'"' && d[i] != b'\'') {
        return bad();
    }
    let q = d[i];
    let Some(end) = d[i + 1..].iter().position(|&c| c == q).map(|e| e + i + 1) else {
        return bad();
    };
    *pos = end + 1;
    Ok(Some(data[i + 1..end].to_string()))
}

/// Escapes text for an attribute's value or an element's text, as Go's xml.EscapeText does and
/// SDK section 4.2 says, so that tabs and line endings in a value survive being read again.
pub(crate) fn escape(s: &str) -> String {
    let mut b = String::with_capacity(s.len() + 16);
    for c in s.chars() {
        match c {
            '&' => b.push_str("&amp;"),
            '<' => b.push_str("&lt;"),
            '>' => b.push_str("&gt;"),
            '"' => b.push_str("&#34;"),
            '\'' => b.push_str("&#39;"),
            '\t' => b.push_str("&#x9;"),
            '\n' => b.push_str("&#xA;"),
            '\r' => b.push_str("&#xD;"),
            _ if !xml_char(c as u32) => b.push('\u{FFFD}'),
            _ => b.push(c),
        }
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tokens(markup: &str) -> R<Vec<Token>> {
        let mut x = Xml::new(markup)?;
        let mut out = Vec::new();
        while let Some(t) = x.token()? {
            out.push(t);
        }
        Ok(out)
    }

    #[test]
    fn reads_namespaces() {
        let t =
            tokens("<s:svg xmlns:s=\"http://www.w3.org/2000/svg\"><s:g a='1'/></s:svg>").unwrap();
        assert_eq!(t[0].kind, Kind::Start);
        assert_eq!(
            t[0].name.as_ref().unwrap().space,
            "http://www.w3.org/2000/svg"
        );
        assert_eq!(t[1].attrs[0].value, "1");
        assert_eq!(t[2].kind, Kind::End);
    }

    #[test]
    fn refuses_what_isnt_well_formed() {
        assert!(tokens("<a><b></a></b>").is_err());
        assert!(tokens("<a b='1' b='2'/>").is_err());
        assert!(tokens("<a/><b/>").is_err());
        assert!(tokens("<x:a/>").is_err());
        assert!(tokens(" <?xml version=\"1.0\"?><a/>").is_err());
        assert!(tokens("<a>&bogus;</a>").is_err());
        assert!(tokens("<a>&#0;</a>").is_err());
    }

    #[test]
    fn escapes_as_go_does() {
        assert_eq!(
            escape("a&<>\"'\t\n\r"),
            "a&amp;&lt;&gt;&#34;&#39;&#x9;&#xA;&#xD;"
        );
    }
}
