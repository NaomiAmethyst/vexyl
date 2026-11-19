// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! Reads, checks and renders [Vexyl](https://github.com/NaomiAmethyst/vexyl) flag documents, a
//! KDL format for flag designs, as SPEC.md and SDK.md define them.
//!
//! ```
//! let source = r##"vexyl 1
//! meta { name "Sweden" }
//! palette { blue "#006aa7"; yellow "#fecc02" }
//! proportion hoist=10 fly=16
//! field blue
//! cross yellow { fly 5 2 9; hoist 4 2 4 }
//! "##;
//! assert!(vexyl::validate(source).is_empty());
//! let flag = vexyl::parse(source).unwrap();
//! let svg = flag.svg(&vexyl::RenderOptions::new().height(300.0)).unwrap();
//! assert!(svg.starts_with("<svg"));
//! let model = flag.model();
//! assert_eq!(model.get("meta").and_then(|m| m.get("name")).and_then(|n| n.as_str()), Some("Sweden"));
//! ```
//!
//! Nothing here reads the network or the filesystem, since a document is self-contained.

// Geometry indexes several lists in step, as the format's algorithms are written.
#![allow(clippy::needless_range_loop)]

use std::fmt;

mod adapter;
mod canonical;
mod geometry;
mod kdl;
mod limits;
mod locate;
mod model;
mod numbers;
mod parser;
mod render;
mod sanitizer;
mod sha256;
mod shapes;
mod share;
mod value;
mod xml;

pub use share::MAX_BYTES as SHARE_MAX_BYTES;
pub use value::{Map, Value};

/// The format version this library reads.
pub const FORMAT_VERSION: i32 = parser::FORMAT_VERSION;

/// The attribute a tagged render marks each drawn element with.
pub const TAG_ATTRIBUTE: &str = "data-vexyl-layer";

/// The height an image has without the `height` option.
pub const DEFAULT_HEIGHT: f64 = 600.0;

/// One thing wrong with a document, as section 2 of the SDK describes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Problem {
    /// Where it is, from 1, or None if it has no one place. A line ends at LF, once line endings
    /// are normalized.
    pub line: Option<usize>,
    /// The column on that line, counting code points from 1.
    pub column: Option<usize>,
    /// The name of the KDL node it's about, if it's about one.
    pub node: Option<String>,
    /// What's wrong, for a person to read. Programs mustn't depend on its wording.
    pub message: String,
}

impl Problem {
    pub(crate) fn at(line: usize, column: usize, node: Option<String>, message: String) -> Problem {
        Problem {
            line: Some(line),
            column: Some(column),
            node: node.filter(|n| !n.is_empty()),
            message,
        }
    }

    pub(crate) fn nowhere(message: String) -> Problem {
        Problem {
            line: None,
            column: None,
            node: None,
            message,
        }
    }
}

impl fmt::Display for Problem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let (Some(line), Some(column)) = (self.line, self.column) {
            write!(f, "{line}:{column}: ")?;
        }
        if let Some(node) = &self.node {
            write!(f, "{node}: ")?;
        }
        f.write_str(&self.message)
    }
}

/// A document that isn't valid, with every problem found in it, of which there's at least one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Problems(pub Vec<Problem>);

impl fmt::Display for Problems {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (i, p) in self.0.iter().enumerate() {
            if i > 0 {
                f.write_str("\n")?;
            }
            write!(f, "{p}")?;
        }
        Ok(())
    }
}

impl std::error::Error for Problems {}

/// An option, a render or a share link that Vexyl refuses, saying why for a person to read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    message: String,
}

impl Error {
    fn new(message: String) -> Error {
        Error { message }
    }

    /// Why, for a person to read. Programs mustn't depend on its wording.
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Error {}

/// How to render a flag, as section 3 of the SDK describes. Every option is optional, and
/// rendering with none gives the flag as it is. A value that can't be used is refused when the
/// flag is rendered, so that no option is ever silently ignored.
///
/// ```
/// let opts = vexyl::RenderOptions::new().height(300.0).variant("vertical");
/// assert_eq!(opts.variant, "vertical");
/// ```
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RenderOptions {
    /// The image's height in pixels, [`DEFAULT_HEIGHT`] if None. Its width follows the proportion.
    pub height: Option<f64>,
    /// The proportion wanted, as fly divided by hoist, measured before a variant turns it.
    pub ratio: Option<f64>,
    /// One of the flag's variants, by name, or empty for none.
    pub variant: String,
    /// `obverse`, the default, or `reverse`.
    pub side: String,
    /// What to do when the flag can't reach the ratio: `error`, the default, or `pad`.
    pub fit: String,
    /// Where a padded flag sits: `start`, `center`, the default, or `end`.
    pub align: String,
    /// One of the flag's folds, by name, to show it folded.
    pub fold: String,
    /// Stops a fold after this many steps, from 1 to the fold's number of steps.
    pub fold_step: Option<i64>,
    /// Starts every ID in the output with this, instead of a prefix worked out from the document.
    /// A page showing documents it doesn't trust should pass one it knows is unique.
    pub id_prefix: String,
    /// Marks each drawn element with the path of the layer that drew it, as section 7 of the SDK says.
    pub tags: bool,
}

impl RenderOptions {
    /// No options: the flag as it is, at the default height.
    pub fn new() -> RenderOptions {
        RenderOptions::default()
    }

    pub fn height(mut self, pixels: f64) -> Self {
        self.height = Some(pixels);
        self
    }

    pub fn ratio(mut self, fly_over_hoist: f64) -> Self {
        self.ratio = Some(fly_over_hoist);
        self
    }

    pub fn variant(mut self, name: impl Into<String>) -> Self {
        self.variant = name.into();
        self
    }

    pub fn side(mut self, side: impl Into<String>) -> Self {
        self.side = side.into();
        self
    }

    pub fn fit(mut self, fit: impl Into<String>) -> Self {
        self.fit = fit.into();
        self
    }

    pub fn align(mut self, align: impl Into<String>) -> Self {
        self.align = align.into();
        self
    }

    pub fn fold(mut self, name: impl Into<String>) -> Self {
        self.fold = name.into();
        self
    }

    pub fn fold_step(mut self, steps: i64) -> Self {
        self.fold_step = Some(steps);
        self
    }

    pub fn id_prefix(mut self, prefix: impl Into<String>) -> Self {
        self.id_prefix = prefix.into();
        self
    }

    pub fn tags(mut self, tags: bool) -> Self {
        self.tags = tags;
        self
    }
}

/// An element of a rendered SVG document, for code that wants to change or embed one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Element {
    /// Its name, as it's written.
    pub name: String,
    /// Its attributes' names and values, in order.
    pub attrs: Vec<(String, String)>,
    /// What's inside a `title` or `desc`, the only elements that hold any, or the empty string.
    pub text: String,
    /// Its child elements, in order.
    pub children: Vec<Element>,
}

impl Element {
    pub(crate) fn new(
        name: String,
        attrs: Vec<(String, String)>,
        text: String,
        children: Vec<Element>,
    ) -> Element {
        Element {
            name,
            attrs,
            text,
            children,
        }
    }

    /// The value of an attribute, if it has one of that name.
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }

    fn write(&self, b: &mut String) {
        b.push('<');
        b.push_str(&self.name);
        for (n, v) in &self.attrs {
            b.push(' ');
            b.push_str(n);
            b.push_str("=\"");
            b.push_str(&xml::escape(v));
            b.push('"');
        }
        if self.text.is_empty() && self.children.is_empty() {
            b.push_str("/>");
            return;
        }
        b.push('>');
        b.push_str(&xml::escape(&self.text));
        for c in &self.children {
            c.write(b);
        }
        b.push_str("</");
        b.push_str(&self.name);
        b.push('>');
    }
}

/// Writes the element out as XML, which draws the same as [`Flag::svg`].
impl fmt::Display for Element {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut b = String::new();
        self.write(&mut b);
        f.write_str(&b)
    }
}

/// Where a layer or other part of a document is, as section 7.3 of the SDK describes it. Lines and
/// columns are counted as a [`Problem`]'s are, and a part ends just past its last character, not
/// counting a `;` or line ending.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Span {
    /// A layer's path, such as `3.1` or `variant/NAME/0`, or what else it is, such as `palette/NAME`.
    pub path: String,
    /// The KDL node's name.
    pub node: String,
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
}

/// A parsed and valid Vexyl document. It never changes, rendering included, so one flag can be
/// rendered with many options, from many threads at once.
#[derive(Debug, Clone)]
pub struct Flag {
    doc: model::Doc,
}

impl Flag {
    /// The flag's name, from its `meta`.
    pub fn name(&self) -> &str {
        &self.doc.meta.name
    }

    /// The flag's proportion, which is also its grid: its height.
    pub fn hoist(&self) -> f64 {
        self.doc.hoist
    }

    /// The flag's proportion, which is also its grid: its width.
    pub fn fly(&self) -> f64 {
        self.doc.fly
    }

    /// The names of the flag's variants, in document order.
    pub fn variants(&self) -> Vec<String> {
        self.doc.variants.keys().cloned().collect()
    }

    /// The names of the flag's folds, in document order.
    pub fn folds(&self) -> Vec<String> {
        self.doc.folds.keys().cloned().collect()
    }

    /// The flag as plain data, in the canonical form of section 4 of the SDK.
    pub fn model(&self) -> Value {
        canonical::model(&self.doc)
    }

    /// The canonical model as JSON, as the conformance suite compares it.
    pub fn model_json(&self) -> String {
        self.model().to_json(true)
    }

    /// Renders the flag as an SVG document, or refuses an option it can't use or a form it can't draw.
    pub fn svg(&self, options: &RenderOptions) -> Result<String, Error> {
        render::svg(&self.doc, options).map_err(Error::new)
    }

    /// Renders the flag as a tree of SVG elements, which writes out as a document that draws the
    /// same as [`Flag::svg`]. Only a `title` or `desc` holds any text.
    pub fn svg_tree(&self, options: &RenderOptions) -> Result<Element, Error> {
        Ok(render::tree(&self.svg(options)?))
    }
}

/// Reads a document, giving every problem found if it isn't valid.
pub fn parse(document: &str) -> Result<Flag, Problems> {
    parser::parse(document)
        .map(|doc| Flag { doc })
        .map_err(Problems)
}

/// Reads a document from its bytes, which have to be UTF-8.
pub fn parse_bytes(document: &[u8]) -> Result<Flag, Problems> {
    match std::str::from_utf8(document) {
        Ok(text) => parse(text),
        Err(_) => Err(Problems(vec![Problem::nowhere(
            "a document has to be UTF-8".into(),
        )])),
    }
}

/// Every problem in a document, or none if it's valid.
pub fn validate(document: &str) -> Vec<Problem> {
    parse(document).err().map(|p| p.0).unwrap_or_default()
}

/// Every problem in a document given as bytes, or none if it's valid UTF-8 and a valid document.
pub fn validate_bytes(document: &[u8]) -> Vec<Problem> {
    parse_bytes(document).err().map(|p| p.0).unwrap_or_default()
}

/// Where each layer and other part of a document is, in document order. It reads only the
/// document's syntax, so it works on one with other problems, and gives nothing if the document
/// isn't KDL.
pub fn locate(document: &str) -> Vec<Span> {
    locate::locate(document)
}

/// The innermost of a document's parts holding a line, if any does.
pub fn layer_at(spans: &[Span], line: usize) -> Option<&Span> {
    locate::layer_at(spans, line)
}

/// Writes a name as part of a path, where `%` is `%25` and `/` is `%2F`.
pub fn encode_path_name(name: &str) -> String {
    locate::encode_name(name)
}

/// Reads a name written in a path.
pub fn decode_path_name(part: &str) -> String {
    locate::decode_name(part)
}

/// The path of the layer holding another, or the empty string for one at the top of its scope.
pub fn parent_path(path: &str) -> &str {
    locate::parent_path(path)
}

/// Writes a document as the part of a share link after its `#`, or refuses one larger than a link
/// can hold.
pub fn share_encode(document: &str) -> Result<String, Error> {
    share::encode(document).map_err(Error::new)
}

/// Reads the document a share link holds, given the part after its `#`, refusing a link that's
/// malformed, corrupt, too large, or of a version this library doesn't read.
pub fn share_decode(link: &str) -> Result<String, Error> {
    share::decode(link).map_err(Error::new)
}
