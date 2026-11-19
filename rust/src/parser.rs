// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! Reads a document into a flag, reporting every problem it finds.

use std::collections::HashSet;
use std::sync::Arc;

use crate::Problem;
use crate::geometry;
use crate::kdl::{self, Kind, Node, Value};
use crate::limits;
use crate::model::*;
use crate::numbers;
use crate::sanitizer;
use crate::sha256;
use crate::value;

pub(crate) const FORMAT_VERSION: i32 = 1;
/// In a color list, leaves a gap, and can't be a palette name.
pub(crate) const NO_COLOR: &str = "none";

pub(crate) const ALONG: &[&str] = &["fly", "hoist", "bend", "bend-sinister"];
pub(crate) const FROM: &[&str] = &["hoist", "fly", "top", "bottom"];
const BLEND: &[&str] = &[
    "normal", "multiply", "screen", "overlay", "darken", "lighten",
];
const ANCHOR: &[&str] = &["start", "center", "end", "scale"];
const CORNER: &[&str] = &["upper-hoist", "upper-fly", "lower-hoist", "lower-fly"];
const RAY_FROM: &[&str] = &[
    "center",
    "hoist",
    "fly",
    "top",
    "bottom",
    "upper-hoist",
    "upper-fly",
    "lower-hoist",
    "lower-fly",
];
pub(crate) const SHAPE_KINDS: &[&str] = &[
    "disc", "ring", "rect", "plus", "triangle", "star", "heart", "cardioid", "polygon", "crescent",
    "sun", "lozenge", "ellipse", "path",
];
const VIEW: &[&str] = &[
    "none",
    "rotate",
    "counter-rotate",
    "half-turn",
    "transpose",
    "anti-transpose",
    "invert",
    "mirror",
];
const MODE: &[&str] = &[
    "extend",
    "center",
    "scale",
    "hoist-extend",
    "hoist-center",
    "hoist-scale",
];
/// These put no conditions on a work, so a file adapting one can license its renders as it likes.
const FREE_LICENSES: &[&str] = &["CC0-1.0", "LicenseRef-Public-Domain"];
const HAS_RADIUS: &[&str] = &[
    "disc", "ring", "plus", "triangle", "star", "heart", "cardioid", "crescent", "sun",
];

/// Makes CRLF and a lone CR into LF, as section 4 of the format and XML both do.
pub(crate) fn normalize_newlines(s: &str) -> String {
    crate::xml::normalize_newlines(s)
}

/// Finds where a byte is: lines end at LF, and a column counts code points.
pub(crate) fn place(src: &str, offset: usize) -> (usize, usize) {
    let mut offset = offset.min(src.len());
    while !src.is_char_boundary(offset) {
        offset -= 1;
    }
    let before = &src[..offset];
    let line = 1 + before.bytes().filter(|&b| b == b'\n').count();
    let start = before.rfind('\n').map_or(0, |i| i + 1);
    (line, src[start..offset].chars().count() + 1)
}

/// Quotes a name for a message.
pub(crate) fn quote(s: &str) -> String {
    let mut b = String::from("\"");
    for c in s.chars() {
        if c == '"' || c == '\\' {
            b.push('\\');
        }
        if (c as u32) < 0x20 {
            b.push_str(&format!("\\x{:02x}", c as u32));
        } else {
            b.push(c);
        }
    }
    b.push('"');
    b
}

/// Reads a document, giving its flag, or its problems.
pub(crate) fn parse(text: &str) -> Result<Doc, Vec<Problem>> {
    let src = normalize_newlines(text);
    let nodes = match kdl::parse(&src) {
        Ok(nodes) => nodes,
        Err(e) => {
            let (line, column) = place(&src, e.offset);
            return Err(vec![Problem::at(line, column, None, e.message)]);
        }
    };
    let mut p = Parser {
        src: &src,
        problems: Vec::new(),
        defines: Ordered::default(),
        palette: Ordered::default(),
        gradients: Ordered::default(),
        gradient_names: Vec::new(),
        size: 0,
        longer: 0.0,
    };
    p.prepare(&nodes);
    let mut flag = p.document(&nodes);
    flag.id_prefix = format!("vx-{}-", sha256::hex(&sha256::digest(src.as_bytes()), 8));
    if !p.problems.is_empty() {
        return Err(p.problems);
    }
    Ok(flag)
}

/// Accepts a year, a month or a day, which is as much as many flags' origins are known to.
pub(crate) fn valid_date(text: &str) -> bool {
    let b = text.as_bytes();
    let digits = |s: &[u8]| s.iter().all(|c| c.is_ascii_digit());
    let num = |s: &[u8]| s.iter().fold(0u32, |a, &c| a * 10 + (c - b'0') as u32);
    match b.len() {
        4 if digits(b) => true,
        7 if digits(&b[..4]) && b[4] == b'-' && digits(&b[5..]) => (1..=12).contains(&num(&b[5..])),
        10 if digits(&b[..4])
            && b[4] == b'-'
            && digits(&b[5..7])
            && b[7] == b'-'
            && digits(&b[8..]) =>
        {
            let year = num(&b[..4]);
            let month = num(&b[5..7]);
            let day = num(&b[8..]);
            let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
            let days = match month {
                1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
                4 | 6 | 9 | 11 => 30,
                2 if leap => 29,
                2 => 28,
                _ => return false,
            };
            (1..=days).contains(&day)
        }
        _ => false,
    }
}

fn valid_series(s: &str) -> bool {
    !s.is_empty()
        && s.split('-').all(|w| {
            !w.is_empty()
                && w.bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        })
}

fn valid_color(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 7 && b[0] == b'#' && b[1..].iter().all(|c| c.is_ascii_hexdigit())
}

struct Parser<'a> {
    src: &'a str,
    problems: Vec<Problem>,
    defines: Ordered<Arc<Define>>,
    palette: Ordered<String>,
    gradients: Ordered<Gradient>,
    /// Lets a gradient's colors recognize other gradients, since they're read one at a time.
    gradient_names: Vec<String>,
    /// What the flag has painted so far, as section 15 counts it.
    size: usize,
    /// The longer side of the flag's own grid, for counting shaped edges.
    longer: f64,
}

const STAGE_VERSION: i32 = 0;
const STAGE_META: i32 = 1;
const STAGE_PALETTE: i32 = 2;
const STAGE_PROPORTION: i32 = 3;
const STAGE_DEFINE: i32 = 6;
const STAGE_LAYERS: i32 = 7;
const STAGE_VARIANT: i32 = 10;
const STAGE_FOLD: i32 = 11;

fn stage(name: &str) -> i32 {
    match name {
        "vexyl" => 0,
        "meta" => 1,
        "palette" => 2,
        "proportion" => 3,
        "outline" => 4,
        "border" => 5,
        "define" => 6,
        "reverse" => 8,
        "adapt" => 9,
        "variant" => 10,
        "fold" => 11,
        _ => STAGE_LAYERS,
    }
}

type Handler<'h, 'a> = &'h mut dyn FnMut(&mut Parser<'a>, &Node) -> bool;

impl<'a> Parser<'a> {
    fn errf(&mut self, n: &Node, message: impl Into<String>) {
        let (line, column) = place(self.src, n.start);
        self.problems.push(Problem::at(
            line,
            column,
            Some(n.name.clone()),
            message.into(),
        ));
    }

    fn problem(&mut self, message: impl Into<String>) {
        self.problems.push(Problem::nowhere(message.into()));
    }

    /// Checks what's the same wherever it is in a document.
    fn prepare(&mut self, nodes: &[Node]) {
        for n in nodes {
            if n.annotated {
                self.errf(n, "type annotations aren't used by this format");
            }
            for v in &n.args {
                if v.annotated {
                    self.errf(n, "type annotations aren't used by this format");
                }
            }
            for (_, v) in &n.props {
                if v.annotated {
                    self.errf(n, "type annotations aren't used by this format");
                }
            }
            for key in &n.repeated_props {
                self.errf(n, format!("property {} given more than once", quote(key)));
            }
            self.prepare(&n.children);
        }
    }

    /// Walks the top level, whose nodes have a fixed order.
    fn document(&mut self, nodes: &[Node]) -> Doc {
        let mut flag = Doc::default();
        let mut current = -1;
        let mut seen = HashSet::new();
        for n in nodes {
            let s = stage(&n.name);
            if s < current
                || (s == current
                    && s != STAGE_LAYERS
                    && s != STAGE_DEFINE
                    && s != STAGE_VARIANT
                    && s != STAGE_FOLD)
            {
                self.errf(n, "out of order or repeated");
                continue;
            }
            if s > STAGE_VERSION && current < STAGE_VERSION {
                let (line, column) = place(self.src, n.start);
                self.problems.push(Problem::at(
                    line,
                    column,
                    None,
                    format!("document must start with `vexyl {FORMAT_VERSION}`"),
                ));
                return self.finish(flag);
            }
            current = s;
            seen.insert(s);
            match n.name.as_str() {
                "vexyl" => {
                    if self.number(n) != FORMAT_VERSION as f64 {
                        self.errf(
                            n,
                            format!(
                                "unsupported format version; this renderer reads {FORMAT_VERSION}"
                            ),
                        );
                        return self.finish(flag);
                    }
                    flag.version = FORMAT_VERSION;
                }
                "meta" => self.meta(n, &mut flag.meta),
                "palette" => self.palette_node(n, &mut flag),
                "proportion" => {
                    self.only_args(n, 0, &["hoist", "fly"]);
                    let h = self.prop(n, "hoist");
                    flag.hoist = self.positive(n, h);
                    let f = self.prop(n, "fly");
                    flag.fly = self.positive(n, f);
                    self.longer = flag.hoist.max(flag.fly);
                    self.no_children(n);
                }
                "outline" => flag.outline = self.outline(n),
                "border" => {
                    let (b, outside) = self.border(n);
                    flag.border = b;
                    flag.border_outside = outside;
                    self.check_outside(
                        n,
                        flag.outline.as_ref(),
                        flag.fly,
                        flag.hoist,
                        flag.border.as_ref(),
                        flag.border_outside,
                    );
                }
                "define" => self.define(n),
                "reverse" => self.reverse(n, &mut flag),
                "adapt" => self.adapt(n, &mut flag),
                "variant" => self.variant(n, &mut flag),
                "fold" => self.fold(n, &mut flag),
                _ => {
                    if flag.fly == 0.0 && flag.hoist == 0.0 {
                        self.errf(n, "layers must follow `proportion`");
                        return self.finish(flag);
                    }
                    if let Some(l) = self.layer(n, 1) {
                        self.count(n, std::slice::from_ref(&l));
                        flag.layers.push(l);
                    }
                }
            }
        }
        if !seen.contains(&STAGE_VERSION) {
            self.problem(format!("document must start with `vexyl {FORMAT_VERSION}`"));
        }
        if !seen.contains(&STAGE_META) {
            self.problem("document needs `meta`");
        }
        if !seen.contains(&STAGE_PALETTE) {
            self.problem("document needs `palette`");
        }
        if !seen.contains(&STAGE_PROPORTION) {
            self.problem("document needs `proportion`");
        }
        for (name, v) in flag.variants.iter() {
            if v.ratio != 0.0 && flag.adapt.is_none() {
                let message = format!(
                    "variant {} has a `ratio`, but the flag has no `adapt` rules",
                    quote(name)
                );
                self.problems.push(Problem::nowhere(message));
            }
        }
        let flag = self.finish(flag);
        if flag.fly > 0.0 && flag.hoist > 0.0 && self.problems.is_empty() {
            let mut failed = Vec::new();
            for (name, fold) in flag.folds.iter() {
                let result = geometry::fold_shape(&flag)
                    .and_then(|shape| geometry::fold_facets(&shape, fold, 0));
                if let Err(e) = result {
                    failed.push(format!("fold {}: {e}", quote(name)));
                }
            }
            for message in failed {
                self.problem(message);
            }
        }
        flag
    }

    /// Gives the flag what was read into the parser itself.
    fn finish(&mut self, mut flag: Doc) -> Doc {
        flag.defines = std::mem::take(&mut self.defines);
        flag.palette = std::mem::take(&mut self.palette);
        flag.gradients = std::mem::take(&mut self.gradients);
        flag
    }

    /// Adds what a top-level node paints to the flag's size, refusing the node that takes it past the limit.
    fn count(&mut self, n: &Node, layers: &[Layer]) {
        let was = self.size;
        self.size = limits::add(self.size, limits::layers_size(layers, self.longer));
        if was <= limits::MAX_SIZE && self.size > limits::MAX_SIZE {
            self.errf(
                n,
                format!(
                    "paints too much: a flag can only come to {} parts",
                    limits::MAX_SIZE
                ),
            );
        }
    }

    /// Dispatches n's children to a handler, which says whether it knows each, refusing unknown
    /// nodes and repeats of anything not repeatable.
    fn children(&mut self, n: &Node, repeatable: &[&str], handle: Handler<'_, 'a>) {
        let mut seen: HashSet<&str> = HashSet::new();
        for c in &n.children {
            if !handle(self, c) {
                self.errf(c, "unknown here");
                continue;
            }
            if seen.contains(c.name.as_str()) && !repeatable.contains(&c.name.as_str()) {
                self.errf(c, "given more than once");
            }
            seen.insert(&c.name);
        }
    }

    fn meta(&mut self, n: &Node, m: &mut Meta) {
        self.no_values(n);
        self.children(
            n,
            &[
                "designer",
                "encoder",
                "source",
                "note",
                "law",
                "restriction",
                "adapted-from",
            ],
            &mut |p, c| {
                match c.name.as_str() {
                    "name" => m.name = p.str(c),
                    "description" => m.description = p.str(c),
                    "version" => m.version = p.str(c),
                    "date" => {
                        m.date = p.str(c);
                        if !m.date.is_empty() && !valid_date(&m.date) {
                            p.errf(
                                c,
                                format!(
                                    "must be YYYY, YYYY-MM or YYYY-MM-DD, got {}",
                                    quote(&m.date)
                                ),
                            );
                        }
                    }
                    "until" => {
                        m.until = p.str(c);
                        if !m.until.is_empty() && !valid_date(&m.until) {
                            p.errf(
                                c,
                                format!(
                                    "must be YYYY, YYYY-MM or YYYY-MM-DD, got {}",
                                    quote(&m.until)
                                ),
                            );
                        }
                    }
                    "series" => {
                        m.series = p.str(c);
                        if !m.series.is_empty() && !valid_series(&m.series) {
                            p.errf(
                                c,
                                format!(
                                    "must be lowercase words joined by hyphens, got {}",
                                    quote(&m.series)
                                ),
                            );
                        }
                    }
                    "note" => {
                        let s = p.str(c);
                        m.notes.push(s);
                    }
                    "law" => {
                        if let Some(r) = p.reference(c) {
                            m.laws.push(r);
                        }
                    }
                    "restriction" => {
                        if let Some(r) = p.reference(c) {
                            if r.sources.is_empty() {
                                p.errf(
                                    c,
                                    "needs a `source`, since an unsourced legal claim can mislead",
                                );
                            }
                            m.restrictions.push(r);
                        }
                    }
                    "designer" => {
                        let s = p.str(c);
                        m.designers.push(s);
                    }
                    "design-rights" => m.design_rights = p.str(c),
                    "encoder" => {
                        let s = p.str(c);
                        m.encoders.push(s);
                    }
                    "license" => m.license = p.str(c),
                    "render-license" => m.render_license = p.str(c),
                    "adapted-from" => {
                        if let Some(a) = p.adaptation(c) {
                            m.adapted_from.push(a);
                        }
                    }
                    "source" => {
                        let s = p.str(c);
                        m.sources.push(s);
                    }
                    _ => return false,
                }
                true
            },
        );
        if !m.render_license.is_empty() {
            for a in &m.adapted_from {
                if a.license != m.render_license && !FREE_LICENSES.contains(&a.license.as_str()) {
                    self.errf(
                        n,
                        format!(
                            "`render-license` {} can't cover work adapted from {} under {}",
                            quote(&m.render_license),
                            a.url,
                            quote(&a.license)
                        ),
                    );
                }
            }
        }
        if m.name.is_empty() {
            self.errf(n, "needs a `name`");
        }
        if !m.date.is_empty() && !m.until.is_empty() {
            // Each is only known to its own precision, so they compare only as far as both go.
            let shared = m.date.len().min(m.until.len());
            if m.until.as_bytes()[..shared] < m.date.as_bytes()[..shared] {
                self.errf(n, "`until` comes before `date`");
            }
        }
    }

    fn adaptation(&mut self, n: &Node) -> Option<Adaptation> {
        self.no_props(n);
        if n.args.len() != 1 || !n.args[0].is_string() {
            self.errf(n, "needs the URL of the original work");
            return None;
        }
        let mut a = Adaptation {
            url: n.args[0].string.clone(),
            ..Adaptation::default()
        };
        self.children(n, &["author"], &mut |p, c| {
            match c.name.as_str() {
                "author" => {
                    let s = p.str(c);
                    a.authors.push(s);
                }
                "license" => a.license = p.str(c),
                "part" => a.part = p.str(c),
                _ => return false,
            }
            true
        });
        Some(a)
    }

    fn palette_node(&mut self, n: &Node, flag: &mut Doc) {
        self.no_values(n);
        // Gradients can name colors defined after them, so they're read second.
        let mut later = Vec::new();
        let mut seen = HashSet::new();
        for c in &n.children {
            if seen.contains(c.name.as_str()) {
                self.errf(c, "color defined twice");
                continue;
            }
            if c.name == NO_COLOR {
                self.errf(
                    c,
                    format!("{} is reserved for leaving a gap", quote(NO_COLOR)),
                );
                continue;
            }
            if c.name.is_empty() {
                self.errf(c, "a color's name can't be empty");
                continue;
            }
            seen.insert(c.name.as_str());
            if !c.args.is_empty() && c.args[0].is_string() && c.args[0].string == "gradient" {
                later.push(c);
                continue;
            }
            let value = self.color(c, flag);
            if !valid_color(&value) {
                self.errf(c, format!("color must be #rrggbb, got {}", quote(&value)));
            }
            // Either case means the same, so the model has only one.
            self.palette.insert(&c.name, value.to_ascii_lowercase());
        }
        for c in &later {
            self.gradient_names.push(c.name.clone());
        }
        for c in later {
            let g = self.gradient(c);
            self.gradients.insert(&c.name, g);
        }
    }

    /// Reads `name gradient COLOR... along=AXIS { stops N... }`.
    fn gradient(&mut self, n: &Node) -> Gradient {
        let mut g = Gradient {
            colors: Vec::new(),
            stops: Vec::new(),
            along: "fly".into(),
        };
        for a in &n.args[1..] {
            if !a.is_string() {
                self.errf(n, "a gradient's colors must be palette names");
                continue;
            }
            let c = self.solid_color(n, &a.string);
            g.colors.push(c);
        }
        if g.colors.len() < 2 {
            self.errf(n, "a gradient needs at least 2 colors");
        }
        for (key, _) in &n.props {
            if key != "along" {
                self.errf(n, format!("unknown property {}", quote(key)));
            }
        }
        if let Some(v) = n.prop("along") {
            if !v.is_string() || !ALONG.contains(&v.string.as_str()) {
                self.errf(n, format!("along must be one of {ALONG:?}"));
            } else {
                g.along = v.string.clone();
            }
        }
        let count = g.colors.len();
        let mut stops = None;
        self.children(n, &[], &mut |p, c| {
            if c.name != "stops" {
                return false;
            }
            stops = Some(p.stops(c, count));
            true
        });
        g.stops = stops.unwrap_or_else(|| {
            (0..count)
                .map(|i| i as f64 / (count.max(2) - 1) as f64)
                .collect()
        });
        g
    }

    fn stops(&mut self, n: &Node, count: usize) -> Vec<f64> {
        let stops = self.numbers(n);
        if stops.len() != count {
            self.errf(n, format!("has {count} colors but {} stops", stops.len()));
        }
        for i in 0..stops.len() {
            if stops[i] < 0.0 || stops[i] > 1.0 {
                self.errf(n, "stops must be between 0 and 1");
            }
            if i > 0 && stops[i] < stops[i - 1] {
                self.errf(n, "stops can't run backward");
            }
        }
        stops
    }

    /// Reads a palette color, with its values in any other color systems.
    fn color(&mut self, n: &Node, flag: &mut Doc) -> String {
        self.no_props(n);
        if n.args.len() != 1 || !n.args[0].is_string() {
            self.errf(n, "needs one string");
            return String::new();
        }
        let mut refs = Vec::new();
        self.children(n, &["dye", "reference"], &mut |p, c| {
            match c.name.as_str() {
                "pantone" | "ncs" | "ral" | "munsell" | "dye" | "thread" => {
                    let value = p.str(c);
                    refs.push(ColorRef {
                        system: c.name.clone(),
                        value,
                        ..ColorRef::default()
                    });
                }
                "cmyk" => {
                    let v = p.numbers(c);
                    if v.len() != 4 {
                        p.errf(c, "needs 4 values from 0 to 100");
                        return true;
                    }
                    let mut parts = Vec::new();
                    for &x in &v {
                        if !(0.0..=100.0).contains(&x) {
                            p.errf(c, "needs 4 values from 0 to 100");
                        }
                        parts.push(value::number(x));
                    }
                    refs.push(ColorRef {
                        system: "cmyk".into(),
                        value: parts.join(" "),
                        numbers: v,
                        other: false,
                    });
                }
                "reference" => {
                    p.no_props(c);
                    p.no_children(c);
                    if c.args.len() != 2 || !c.args[0].is_string() || !c.args[1].is_string() {
                        p.errf(c, "needs a system's name and a value");
                        return true;
                    }
                    refs.push(ColorRef {
                        system: c.args[0].string.clone(),
                        value: c.args[1].string.clone(),
                        numbers: Vec::new(),
                        other: true,
                    });
                }
                _ => return false,
            }
            true
        });
        if !refs.is_empty() {
            flag.color_refs.insert(&n.name, refs);
        }
        n.args[0].string.clone()
    }

    fn layer(&mut self, n: &Node, depth: usize) -> Option<Layer> {
        if depth > limits::MAX_DEPTH {
            self.errf(
                n,
                format!("nested more than {} levels deep", limits::MAX_DEPTH),
            );
            return None;
        }
        match n.name.as_str() {
            "field" => {
                let color = self.color_arg(n);
                self.no_props(n);
                let mut fx = Effects::default();
                self.children(n, &["cut"], &mut |p, c| p.effect(&mut fx, c));
                Some(Layer {
                    fx,
                    kind: LayerKind::Field(Field { color }),
                })
            }
            "bars" => Some(self.bars(n)),
            "chevrons" => Some(self.chevrons(n)),
            "band" => Some(self.band(n)),
            "cross" => Some(self.cross(n)),
            "saltire" => Some(self.saltire(n)),
            "charge" => self.charge(n),
            "quarters" => Some(self.quarters(n)),
            "checks" => Some(self.checks(n)),
            "rays" => Some(self.rays(n)),
            "pile" | "pall" => Some(self.ordinary_shape(n)),
            "panel" => Some(self.panel(n, depth)),
            "use" => self.use_layer(n, depth),
            "emblem" => Some(self.emblem(n)),
            "group" => {
                self.no_values(n);
                let mut fx = Effects::default();
                let mut layers = Vec::new();
                self.container(n, depth, &mut fx, &mut layers, &mut |_, _| false);
                if layers.is_empty() {
                    self.errf(n, "needs at least one layer");
                }
                Some(Layer {
                    fx,
                    kind: LayerKind::Group(Group { layers }),
                })
            }
            "canton" => {
                let mut l = Panel {
                    corner: "upper-hoist".into(),
                    canton: true,
                    ..Panel::default()
                };
                self.no_values(n);
                let mut fx = Effects::default();
                let mut layers = Vec::new();
                let (mut fly, mut hoist) = (0.0, 0.0);
                self.container(n, depth, &mut fx, &mut layers, &mut |p, c| {
                    match c.name.as_str() {
                        "fly" => {
                            let v = p.number(c);
                            fly = p.positive(c, v);
                        }
                        "hoist" => {
                            let v = p.number(c);
                            hoist = p.positive(c, v);
                        }
                        _ => return false,
                    }
                    true
                });
                l.fly = fly;
                l.hoist = hoist;
                l.layers = layers;
                if l.fly == 0.0 || l.hoist == 0.0 {
                    self.errf(n, "needs `fly` and `hoist`");
                }
                if l.layers.is_empty() {
                    self.errf(n, "needs at least one layer");
                }
                Some(Layer {
                    fx,
                    kind: LayerKind::Panel(l),
                })
            }
            _ => {
                self.errf(n, "unknown layer");
                None
            }
        }
    }

    /// Reads a group, panel or canton, whose children mix settings and layers.
    fn container(
        &mut self,
        n: &Node,
        depth: usize,
        fx: &mut Effects,
        layers: &mut Vec<Layer>,
        settings: Handler<'_, 'a>,
    ) {
        let mut seen: HashSet<&str> = HashSet::new();
        for c in &n.children {
            let handled = settings(self, c) || self.effect(fx, c);
            if !handled {
                if let Some(l) = self.layer(c, depth + 1) {
                    layers.push(l);
                }
                continue;
            }
            if seen.contains(c.name.as_str()) && c.name != "cut" {
                self.errf(c, "given more than once");
            }
            seen.insert(&c.name);
        }
    }

    /// Handles what every layer can have, giving false for anything else.
    fn effect(&mut self, e: &mut Effects, c: &Node) -> bool {
        match c.name.as_str() {
            "opacity" => {
                e.opacity = self.number(c);
                if e.opacity < 0.0 || e.opacity > 1.0 {
                    self.errf(c, "must be between 0 and 1");
                }
            }
            "blend" => e.blend = self.one_of(c, BLEND),
            "anchor" => e.anchor = self.one_of(c, ANCHOR),
            "clip" => {
                if let Some(s) = self.mask_shape(c) {
                    e.clip = Some(s);
                }
            }
            "cut" => {
                if let Some(s) = self.mask_shape(c) {
                    e.cuts.push(s);
                }
            }
            _ => return false,
        }
        true
    }

    /// Reads the single shape inside a clip or cut.
    fn mask_shape(&mut self, n: &Node) -> Option<Shape> {
        self.no_values(n);
        if n.children.len() != 1 {
            self.errf(n, "needs exactly one shape");
            return None;
        }
        let c = &n.children[0];
        self.no_values(c);
        if c.name == "svg" {
            self.errf(c, "inline SVG can't be used as a clip or cut");
            return None;
        }
        let mut s = self.named_shape(&c.name);
        self.shape_body(c, &mut s, None);
        if s.hollow > 0.0 || s.lines > 0.0 {
            self.errf(
                c,
                "a clip or cut uses a shape's whole area, so it can't be `hollow` or `lines`",
            );
        }
        Some(s)
    }

    /// Starts a shape of a kind, or from a definition of that name.
    fn named_shape(&self, name: &str) -> Shape {
        if let Some(d) = self.defines.get(name)
            && let Some(s) = &d.shape
        {
            return s.clone();
        }
        Shape {
            kind: name.to_string(),
            ..Shape::default()
        }
    }

    fn bars(&mut self, n: &Node) -> Layer {
        let colors = self.gap_color_args(n);
        self.no_props(n);
        let mut l = Bars {
            colors,
            along: "fly".into(),
            ratio: Vec::new(),
            rotate: 0.0,
            grow: None,
            line: None,
            fixed: None,
        };
        let mut ratio = None;
        let mut count = 0;
        let mut fx = Effects::default();
        self.children(n, &["cut"], &mut |p, c| {
            match c.name.as_str() {
                "along" => l.along = p.one_of(c, ALONG),
                "ratio" => ratio = Some(p.positives(c)),
                "rotate" => l.rotate = p.number(c),
                "count" => {
                    let v = p.number(c);
                    count = p.integer(c, v, limits::MAX_COPIES);
                }
                "grow" => l.grow = Some(p.numbers(c)),
                "edge" => l.line = p.line(c),
                _ => return p.effect(&mut fx, c),
            }
            true
        });
        if !l.colors.is_empty() {
            l.colors = self.cycle(n, l.colors.clone(), count);
            self.check_waves(n, l.line.as_ref());
            l.ratio = self.ratio(n, ratio, l.colors.len());
            if let Some(grow) = &l.grow {
                if grow.len() != l.colors.len() {
                    self.errf(
                        n,
                        format!(
                            "has {} colors but {} `grow` values",
                            l.colors.len(),
                            grow.len()
                        ),
                    );
                }
                for &g in grow {
                    if g < 0.0 {
                        self.errf(n, "`grow` can't be negative");
                    }
                }
                if l.rotate != 0.0 {
                    self.errf(
                        n,
                        "a rotated bars keeps its widths at other proportions, so it takes no `grow`",
                    );
                }
            }
        } else if let Some(r) = ratio {
            l.ratio = r;
        }
        Layer {
            fx,
            kind: LayerKind::Bars(l),
        }
    }

    fn chevrons(&mut self, n: &Node) -> Layer {
        let colors = self.gap_color_args(n);
        self.no_props(n);
        let mut l = Chevrons {
            colors,
            from: "hoist".into(),
            depth: 0.0,
            angle: 0.0,
            apex: None,
            ratio: Vec::new(),
            rotate: 0.0,
            fimbriate: None,
        };
        let mut ratio = None;
        let mut fx = Effects::default();
        self.children(n, &["cut"], &mut |p, c| {
            match c.name.as_str() {
                "from" => l.from = p.one_of(c, FROM),
                "depth" => {
                    let v = p.number(c);
                    l.depth = p.positive(c, v);
                }
                "angle" => {
                    l.angle = p.number(c);
                    if l.angle <= 0.0 || l.angle >= 90.0 {
                        p.errf(c, "must be between 0 and 90 degrees, exclusive");
                    }
                }
                "apex" => {
                    let apex = p.number(c);
                    if apex < 0.0 {
                        p.errf(c, "can't be negative");
                    }
                    l.apex = Some(apex);
                }
                "ratio" => ratio = Some(p.positives(c)),
                "rotate" => l.rotate = p.number(c),
                "fimbriate" => l.fimbriate = p.edge(c),
                _ => return p.effect(&mut fx, c),
            }
            true
        });
        if l.depth == 0.0 {
            self.errf(n, "needs a `depth`");
        }
        if l.apex.is_some() && l.angle == 0.0 {
            self.errf(
                n,
                "an off-center `apex` needs an `angle`, since its arms can't meet both corners at one slope",
            );
        }
        l.ratio = self.ratio(n, ratio, l.colors.len());
        Layer {
            fx,
            kind: LayerKind::Chevrons(l),
        }
    }

    /// Repeats colors until there are count of them, if count is given. Fewer would drop some silently.
    fn cycle(&mut self, n: &Node, colors: Vec<String>, count: usize) -> Vec<String> {
        if count == 0 {
            return colors;
        }
        if count < colors.len() {
            self.errf(
                n,
                format!(
                    "has {} colors but a `count` of {count}, which would leave some out",
                    colors.len()
                ),
            );
            return colors;
        }
        (0..count)
            .map(|i| colors[i % colors.len()].clone())
            .collect()
    }

    fn check_waves(&mut self, n: &Node, l: Option<&Line>) {
        if let Some(l) = l
            && l.waves(self.longer) > limits::MAX_COPIES
        {
            self.errf(
                n,
                format!(
                    "a shaped edge can't have more than {} waves",
                    limits::MAX_COPIES
                ),
            );
        }
    }

    fn ratio(&mut self, n: &Node, ratio: Option<Vec<f64>>, count: usize) -> Vec<f64> {
        let ratio = ratio.unwrap_or_else(|| vec![1.0; count]);
        if ratio.len() != count {
            self.errf(
                n,
                format!("has {count} colors but a ratio of {} values", ratio.len()),
            );
        }
        ratio
    }

    fn band(&mut self, n: &Node) -> Layer {
        let color = self.color_arg(n);
        self.no_props(n);
        let mut l = Band {
            color,
            along: "fly".into(),
            width: 0.0,
            offset: 0.0,
            rotate: 0.0,
            fimbriate: None,
            fixed: None,
        };
        let mut fx = Effects::default();
        self.children(n, &["cut"], &mut |p, c| {
            match c.name.as_str() {
                "along" => l.along = p.one_of(c, ALONG),
                "width" => {
                    let v = p.number(c);
                    l.width = p.positive(c, v);
                }
                "offset" => l.offset = p.number(c),
                "rotate" => l.rotate = p.number(c),
                "fimbriate" => l.fimbriate = p.edge(c),
                _ => return p.effect(&mut fx, c),
            }
            true
        });
        if l.width == 0.0 {
            self.errf(n, "needs a `width`");
        }
        Layer {
            fx,
            kind: LayerKind::Band(l),
        }
    }

    fn cross(&mut self, n: &Node) -> Layer {
        let color = self.color_arg(n);
        self.no_props(n);
        let mut l = Cross {
            color,
            fly_parts: [0.0, 1.0, 0.0],
            hoist_parts: [0.0, 1.0, 0.0],
            fimbriate: None,
        };
        let mut seen = [false, false];
        let mut fx = Effects::default();
        self.children(n, &["cut"], &mut |p, c| {
            match c.name.as_str() {
                "fly" => {
                    l.fly_parts = p.triple(c);
                    seen[0] = true;
                }
                "hoist" => {
                    l.hoist_parts = p.triple(c);
                    seen[1] = true;
                }
                "fimbriate" => l.fimbriate = p.edge(c),
                _ => return p.effect(&mut fx, c),
            }
            true
        });
        if !seen[0] || !seen[1] {
            self.errf(n, "needs `fly` and `hoist`");
        }
        Layer {
            fx,
            kind: LayerKind::Cross(l),
        }
    }

    /// Reads the distance before an arm, its width and the distance after.
    fn triple(&mut self, n: &Node) -> [f64; 3] {
        let v = self.numbers(n);
        if v.len() != 3 {
            self.errf(n, "needs 3 values: before the arm, its width, and after it");
            return [0.0, 1.0, 0.0];
        }
        if v[0] < 0.0 || v[1] <= 0.0 || v[2] < 0.0 {
            self.errf(
                n,
                "the arm's width must be positive and its distances not negative",
            );
            return [0.0, 1.0, 0.0];
        }
        [v[0], v[1], v[2]]
    }

    fn saltire(&mut self, n: &Node) -> Layer {
        let color = self.color_arg(n);
        self.no_props(n);
        let mut l = Saltire {
            color,
            width: 0.0,
            fimbriate: None,
            counterchange: false,
        };
        let mut fx = Effects::default();
        self.children(n, &["cut"], &mut |p, c| {
            match c.name.as_str() {
                "width" => {
                    let v = p.number(c);
                    l.width = p.positive(c, v);
                }
                "fimbriate" => l.fimbriate = p.edge(c),
                "counterchange" => l.counterchange = p.flag_value(c),
                _ => return p.effect(&mut fx, c),
            }
            true
        });
        if l.width == 0.0 {
            self.errf(n, "needs a `width`");
        }
        if l.counterchange && l.fimbriate.is_some() {
            self.errf(n, "a counterchanged saltire can't be fimbriated");
        }
        Layer {
            fx,
            kind: LayerKind::Saltire(l),
        }
    }

    fn charge(&mut self, n: &Node) -> Option<Layer> {
        let args = &n.args;
        self.no_props(n);
        if args.is_empty() || !args[0].is_string() {
            self.errf(n, "needs a shape");
            return None;
        }
        let name = &args[0].string;
        if name == "pile" || name == "pall" {
            self.errf(
                n,
                format!("a {name} is a layer of its own, not a charge's shape"),
            );
            return None;
        }
        let mut shape = self.named_shape(name);
        let mut color = String::new();
        if shape.kind == "svg" && args.len() == 1 {
            // Inline SVG can bring its own colors.
        } else if args.len() != 2 {
            self.errf(n, "needs a shape and a color");
            return None;
        } else if !args[1].is_string() {
            self.errf(n, "color must be a palette name");
            return None;
        } else if shape.kind == "svg" {
            color = self.solid_color(n, &args[1].string);
        } else {
            color = self.palette_color(n, &args[1].string);
        }
        let mut fx = Effects::default();
        let mut fimbriate = None;
        let mut repeat = None;
        self.shape_body(
            n,
            &mut shape,
            Some(&mut |p, c| {
                match c.name.as_str() {
                    "fimbriate" => fimbriate = p.edge(c),
                    "repeat" => repeat = p.repeat(c),
                    _ => return p.effect(&mut fx, c),
                }
                true
            }),
        );
        let s = &shape;
        if s.embedded.as_ref().is_some_and(|e| e.uses_current_color()) && color.is_empty() {
            self.errf(
                n,
                "inline SVG uses currentColor, so it needs a palette color",
            );
        } else if s.kind == "svg" && fimbriate.is_some() {
            self.errf(n, "inline SVG can't be fimbriated");
        } else if fimbriate.is_some() && (s.hollow > 0.0 || s.lines > 0.0) {
            self.errf(
                n,
                "fimbriation edges a filled shape, so it can't go with `hollow` or `lines`",
            );
        } else if s.kind == "svg" && repeat.is_some() {
            self.errf(n, "inline SVG can't be repeated");
        } else if s.kind == "polygon" && repeat.is_some() {
            self.errf(n, "a polygon can't be repeated");
        } else if repeat.is_some() && s.ats.len() > 1 {
            self.errf(n, "several positions and a repeat can't be combined");
        } else if s.kind == "svg" && s.ats.len() > 1 {
            self.errf(n, "inline SVG can't be repeated");
        } else if repeat.as_ref().is_some_and(|r: &Repeat| r.kind == "grid") && s.placed {
            self.errf(
                n,
                "a grid repeat spreads across the region, so it can't have `at`",
            );
        }
        Some(Layer {
            fx,
            kind: LayerKind::Charge(Charge {
                shape,
                color,
                fimbriate,
                repeat,
            }),
        })
    }

    fn emblem(&mut self, n: &Node) -> Layer {
        let mut l = Emblem {
            at: None,
            along: String::new(),
            rotate: 0.0,
            charges: Vec::new(),
        };
        self.no_values(n);
        let mut fx = Effects::default();
        let mut seen: HashSet<&str> = HashSet::new();
        for c in &n.children {
            if c.name == "charge" {
                if let Some(got) = self.layer(c, 1) {
                    if let LayerKind::Charge(charge) = &got.kind {
                        if charge.repeat.as_ref().is_some_and(|r| r.kind == "grid") {
                            self.errf(
                                c,
                                "a grid repeat needs a region, which an emblem doesn't have",
                            );
                        }
                        self.frame_shape(c, &charge.shape);
                        if let Some(clip) = &got.fx.clip {
                            self.frame_shape(c, clip);
                        }
                        for cut in &got.fx.cuts {
                            self.frame_shape(c, cut);
                        }
                    }
                    l.charges.push(got);
                }
                continue;
            }
            let handled = match c.name.as_str() {
                "at" => {
                    l.at = self.at(c);
                    true
                }
                "along" => {
                    l.along = self.one_of(c, ALONG);
                    true
                }
                "rotate" => {
                    l.rotate = self.number(c);
                    true
                }
                _ => self.effect(&mut fx, c),
            };
            if !handled {
                self.errf(c, "an emblem can only hold charges");
                continue;
            }
            if seen.contains(c.name.as_str()) && c.name != "cut" {
                self.errf(c, "given more than once");
            }
            seen.insert(&c.name);
        }
        if l.charges.is_empty() {
            self.errf(n, "needs at least one charge");
        }
        Layer {
            fx,
            kind: LayerKind::Emblem(l),
        }
    }

    /// Refuses what needs a region's size, which an emblem's frame doesn't have.
    fn frame_shape(&mut self, n: &Node, s: &Shape) {
        if s.kind == "lozenge" && (s.fly == 0.0 || s.hoist == 0.0) {
            self.errf(
                n,
                "a lozenge in an emblem needs `fly` and `hoist`, since a frame has no size to take",
            );
        } else if s.kind == "pile" || s.kind == "pall" {
            self.errf(
                n,
                format!(
                    "a {} needs a region's edges, which an emblem doesn't have",
                    s.kind
                ),
            );
        }
    }

    fn repeat(&mut self, n: &Node) -> Option<Repeat> {
        self.no_children(n);
        if n.args.len() != 1 || !n.args[0].is_string() {
            self.errf(n, "needs a kind: ring or grid");
            return None;
        }
        let mut r = Repeat {
            kind: n.args[0].string.clone(),
            ..Repeat::default()
        };
        match r.kind.as_str() {
            "ring" => {
                self.only_args(n, 1, &["count", "radius", "turn"]);
                let v = self.prop(n, "count");
                r.count = self.integer(n, v, limits::MAX_COPIES);
                let v = self.prop(n, "radius");
                r.radius = self.positive(n, v);
                r.turn = self.bool_prop(n, "turn");
            }
            "grid" => {
                self.only_args(n, 1, &["rows", "columns", "stagger"]);
                let v = self.prop(n, "rows");
                r.rows = self.integer(n, v, limits::MAX_COPIES);
                let v = self.prop(n, "columns");
                r.columns = self.integer(n, v, limits::MAX_COPIES);
                r.stagger = self.bool_prop(n, "stagger");
                if r.rows * r.columns > limits::MAX_COPIES {
                    self.errf(n, format!("makes more than {} copies", limits::MAX_COPIES));
                }
            }
            "line" => {
                self.only_args(n, 1, &["count", "fly", "hoist"]);
                let v = self.prop(n, "count");
                r.count = self.integer(n, v, limits::MAX_COPIES);
                if let Some(v) = n.prop("fly") {
                    r.fly = self.number_value(n, v);
                }
                if let Some(v) = n.prop("hoist") {
                    r.hoist = self.number_value(n, v);
                }
                if r.fly == 0.0 && r.hoist == 0.0 {
                    self.errf(n, "needs a step: fly= or hoist=");
                }
            }
            "arc" => {
                self.only_args(n, 1, &["count", "radius", "turn", "from", "to"]);
                let v = self.prop(n, "count");
                r.count = self.integer(n, v, limits::MAX_COPIES);
                let v = self.prop(n, "radius");
                r.radius = self.positive(n, v);
                r.turn = self.bool_prop(n, "turn");
                r.from = self.prop(n, "from");
                r.to = self.prop(n, "to");
                if r.count < 2 && r.count != 0 {
                    self.errf(n, "an arc needs at least 2 copies");
                }
                if n.prop("from").is_some()
                    && n.prop("to").is_some()
                    && (r.to - r.from) % 360.0 == 0.0
                {
                    self.errf(
                        n,
                        "`from` and `to` are the same place, so there's no arc to repeat along",
                    );
                }
            }
            _ => {
                let message = format!("unknown repeat {}", quote(&r.kind));
                self.errf(n, message);
            }
        }
        Some(r)
    }

    /// Handles a child that a shape of its kind takes, giving false for anything else.
    fn shape_child(&mut self, s: &mut Shape, c: &Node) -> bool {
        let kind = s.kind.as_str();
        let positioned = !matches!(kind, "pile" | "pall" | "polygon");
        match c.name.as_str() {
            "at" if positioned => {
                let at = self.at(c);
                if !s.placed {
                    s.at = at;
                }
                s.placed = true;
                s.ats.push(at);
            }
            "rotate" if positioned => s.rotate = self.number(c),
            "hollow" if kind != "svg" => {
                let v = self.number(c);
                s.hollow = self.positive(c, v);
            }
            "radius"
                if matches!(
                    kind,
                    "disc"
                        | "triangle"
                        | "cardioid"
                        | "crescent"
                        | "sun"
                        | "heart"
                        | "ring"
                        | "plus"
                        | "star"
                ) =>
            {
                let v = self.number(c);
                s.radius = self.positive(c, v);
            }
            "inner" if matches!(kind, "crescent" | "ring" | "star") => {
                let v = self.number(c);
                s.inner = self.positive(c, v);
            }
            "offset" if kind == "crescent" => {
                let v = self.number(c);
                s.offset = self.positive(c, v);
            }
            "disc" if kind == "sun" => {
                let v = self.number(c);
                s.disc = self.positive(c, v);
            }
            "gap" if kind == "sun" => {
                let v = self.number(c);
                s.gap = self.not_negative(c, v);
            }
            "points" if kind == "sun" => {
                let v = self.number(c);
                s.points = self.integer(c, v, limits::MAX_COPIES);
            }
            "points" if kind == "star" => {
                let v = self.number(c);
                s.points = self.integer(c, v, limits::MAX_COPIES);
                if s.points > 0 && s.points < 3 {
                    self.errf(c, "needs at least 3 points");
                }
            }
            "spread" if matches!(kind, "sun" | "heart") => {
                let v = self.number(c);
                s.spread = self.positive(c, v);
            }
            "fly" if matches!(kind, "lozenge" | "ellipse" | "rect" | "path" | "svg") => {
                let v = self.number(c);
                s.fly = self.positive(c, v);
            }
            "hoist" if matches!(kind, "lozenge" | "ellipse" | "rect" | "path" | "svg") => {
                let v = self.number(c);
                s.hoist = self.positive(c, v);
            }
            "d" if kind == "path" => s.d = self.path_data(c),
            "box" if kind == "path" => {
                let text = self.str(c);
                s.bx = self.box_value(c, &text);
            }
            "evenodd" if kind == "path" => s.even_odd = self.flag_value(c),
            "from" if matches!(kind, "pile" | "pall") => s.edge = self.one_of(c, FROM),
            "base" if kind == "pile" => {
                let v = self.numbers(c);
                if v.len() == 2 {
                    s.base = Some([v[0], v[1]]);
                } else {
                    self.errf(c, "needs 2 values: where it starts and ends along the edge");
                }
            }
            "tip" if kind == "pile" => {
                let v = self.numbers(c);
                if v.len() == 2 {
                    s.tip = Some([v[0], v[1]]);
                } else {
                    self.errf(c, "needs 2 values: along the edge, then in from it");
                }
            }
            "depth" if kind == "pile" => {
                let v = self.number(c);
                s.depth = self.positive(c, v);
            }
            "flat" if kind == "pile" => {
                let v = self.number(c);
                s.flat = self.not_negative(c, v);
                s.has_flat = true;
            }
            "width" if matches!(kind, "pall" | "plus") => {
                let v = self.number(c);
                s.width = self.positive(c, v);
            }
            "junction" if kind == "pall" => {
                let v = self.number(c);
                s.junction = self.positive(c, v);
            }
            "from" if kind == "ring" => {
                s.from = self.number(c);
                s.has_arc = true;
            }
            "to" if kind == "ring" => {
                s.to = self.number(c);
                s.has_arc = true;
            }
            "lines" if kind == "star" => {
                let v = self.number(c);
                s.lines = self.positive(c, v);
            }
            "point" if kind == "polygon" => {
                self.only_args(c, 0, &["fly", "hoist"]);
                self.no_children(c);
                let fly = self.prop(c, "fly");
                let hoist = self.prop(c, "hoist");
                s.vertices.push(Point::new(fly, hoist));
            }
            "markup" if kind == "svg" => s.markup = self.str(c),
            _ => return false,
        }
        true
    }

    /// Reads a shape's children, along with any extra handler, which goes first.
    fn shape_body(&mut self, n: &Node, s: &mut Shape, extra: Option<Handler<'_, 'a>>) {
        s.placed = false;
        s.ats = Vec::new();
        // What was only worked out from a definition's other values is worked out again.
        if s.auto_inner {
            s.inner = 0.0;
            s.auto_inner = false;
        }
        if s.auto_spread {
            s.spread = 0.0;
            s.auto_spread = false;
        }
        match s.kind.as_str() {
            "disc" | "triangle" | "cardioid" | "crescent" | "lozenge" | "ellipse" | "rect"
            | "path" | "heart" | "ring" | "plus" | "polygon" | "svg" => {}
            "sun" => {
                if s.points == 0 {
                    s.points = 12;
                }
                if s.spread == 0.0 {
                    s.spread = 1.0;
                }
            }
            "star" => {
                if s.points == 0 {
                    s.points = 5;
                }
            }
            "pile" | "pall" => {
                if s.edge.is_empty() {
                    s.edge = "hoist".into();
                }
            }
            _ => {
                let message = format!("unknown shape {}", quote(&s.kind));
                self.errf(n, message);
                return;
            }
        }
        let has_extra = extra.is_some();
        let mut extra = extra;
        let mut repeatable = vec!["cut", "point"];
        if has_extra {
            repeatable.push("at");
        }
        self.children(n, &repeatable, &mut |p, c| {
            if let Some(e) = extra.as_mut()
                && e(p, c)
            {
                return true;
            }
            p.shape_child(s, c)
        });
        self.check_shape(n, s);
    }

    fn check_shape(&mut self, n: &Node, s: &mut Shape) {
        if HAS_RADIUS.contains(&s.kind.as_str()) && s.radius == 0.0 {
            self.errf(n, "needs a `radius`");
        }
        match s.kind.as_str() {
            "ring" => {
                if s.inner == 0.0 || s.inner >= s.radius {
                    self.errf(n, "needs an `inner` smaller than its `radius`");
                }
                if s.has_arc && (s.to - s.from) % 360.0 == 0.0 {
                    self.errf(
                        n,
                        "`from` and `to` are the same place, so there's no arc to draw",
                    );
                }
            }
            "star" => {
                if s.lines > 0.0 && s.hollow > 0.0 {
                    self.errf(n, "`lines` and `hollow` can't be combined");
                }
                if s.lines > 0.0 && s.points < 5 {
                    self.errf(n, "`lines` needs at least 5 points");
                }
                if s.inner >= s.radius && s.radius > 0.0 {
                    self.errf(n, "`inner` must be smaller than `radius`");
                }
                if s.inner == 0.0 && s.points < 5 {
                    self.errf(n, "needs an `inner` with fewer than 5 points");
                }
                if s.inner == 0.0 {
                    let k = s.points as f64;
                    s.inner = s.radius * (2.0 * std::f64::consts::PI / k).cos()
                        / (std::f64::consts::PI / k).cos();
                    s.auto_inner = true;
                }
            }
            "rect" | "ellipse" => {
                if s.fly == 0.0 || s.hoist == 0.0 {
                    self.errf(n, "needs `fly` and `hoist`");
                }
            }
            "crescent" => {
                if s.inner == 0.0 || s.offset == 0.0 {
                    self.errf(n, "needs `inner` and `offset`");
                } else if s.radius > 0.0
                    && (s.offset >= s.radius + s.inner || s.offset <= (s.radius - s.inner).abs())
                {
                    self.errf(n, "`offset` has to make its two circles cross");
                }
            }
            "sun" => {
                if s.disc == 0.0 {
                    self.errf(n, "needs a `disc`");
                }
                if s.radius > 0.0 && s.disc + s.gap >= s.radius {
                    self.errf(n, "`disc` and `gap` must be smaller than `radius`");
                }
                if s.points < 3 && s.points != 0 {
                    self.errf(n, "needs at least 3 points");
                }
                if s.spread > 1.0 {
                    self.errf(n, "`spread` can't be more than 1");
                }
            }
            "path" => {
                if s.d.is_empty() {
                    self.errf(n, "needs `d`");
                }
                if s.bx[2] <= 0.0 || s.bx[3] <= 0.0 {
                    self.errf(n, "needs a `box` with an area");
                }
                if s.fly == 0.0 && s.hoist == 0.0 {
                    self.errf(n, "needs `fly` or `hoist`");
                }
            }
            "pile" => {
                if s.tip.is_none() && s.depth == 0.0 {
                    self.errf(n, "needs a `depth` or a `tip`");
                } else if s.tip.is_some() && s.depth != 0.0 {
                    self.errf(n, "takes a `depth` or a `tip`, not both");
                } else if s.tip.is_some() && s.has_flat {
                    self.errf(n, "a `flat` goes with a `depth`, not a `tip`");
                }
            }
            "pall" => {
                if s.width == 0.0 {
                    self.errf(n, "needs a `width`");
                }
            }
            "heart" => {
                if s.spread == 0.0 {
                    s.spread = s.radius * 2f64.sqrt();
                    s.auto_spread = true;
                }
                if s.spread >= 2.0 * s.radius && s.radius > 0.0 {
                    self.errf(
                        n,
                        "`spread` must be less than twice `radius`, so that the lobes meet",
                    );
                }
            }
            "plus" => {
                if s.width == 0.0 || s.width >= 2.0 * s.radius {
                    self.errf(n, "needs a `width` less than twice its `radius`");
                }
            }
            "polygon" => {
                if s.vertices.len() < 3 {
                    self.errf(n, "needs at least 3 `point`s");
                }
            }
            "svg" => {
                if s.fly == 0.0 || s.hoist == 0.0 {
                    self.errf(n, "needs `fly` and `hoist`");
                }
                if s.markup.is_empty() {
                    self.errf(n, "needs `markup`");
                    return;
                }
                match sanitizer::sanitize(&s.markup) {
                    Ok(art) => {
                        // Only what passed is kept, so that nothing can read what the sanitizer removed.
                        s.markup = art.canonical();
                        s.embedded = Some(Arc::new(art));
                    }
                    Err(e) => self.errf(n, e),
                }
            }
            _ => {}
        }
    }

    fn at(&mut self, n: &Node) -> Option<Point> {
        self.no_children(n);
        if !n.args.is_empty() {
            if n.args.len() != 1
                || !n.args[0].is_string()
                || n.args[0].string != "center"
                || !n.props.is_empty()
            {
                self.errf(n, "must be `center` or `fly=A hoist=B`");
            }
            return None;
        }
        self.only_args(n, 0, &["fly", "hoist"]);
        let fly = self.prop(n, "fly");
        let hoist = self.prop(n, "hoist");
        Some(Point::new(fly, hoist))
    }

    /// Reads `border COLOR W`, with an optional side of inside or outside.
    fn border(&mut self, n: &Node) -> (Option<Edge>, bool) {
        let mut args: &[Value] = &n.args;
        let mut outside = false;
        if args.len() == 3 {
            let side = &args[2];
            if !side.is_string() || (side.string != "inside" && side.string != "outside") {
                self.errf(n, "side must be inside or outside");
                return (None, false);
            }
            outside = side.string == "outside";
            args = &args[..2];
        }
        (self.edge_args(n, args), outside)
    }

    /// Refuses an outside border that can't go around the shape it's given.
    fn check_outside(
        &mut self,
        n: &Node,
        o: Option<&Outline>,
        fly: f64,
        hoist: f64,
        border: Option<&Edge>,
        outside: bool,
    ) {
        let Some(border) = border else {
            return;
        };
        if !outside || border.width <= 0.0 || fly <= 0.0 || hoist <= 0.0 {
            return;
        }
        let shape = match o {
            None => Some(geometry::rect_poly(0.0, 0.0, fly, hoist)),
            Some(o) => geometry::outline_points(o, fly, hoist),
        };
        let Some(shape) = shape else {
            self.errf(n, "an outside border can't go around a `path` outline");
            return;
        };
        if let Err(e) = geometry::offset_polygon(&shape, border.width) {
            self.errf(n, e);
        }
    }

    fn edge(&mut self, n: &Node) -> Option<Edge> {
        self.edge_args(n, &n.args)
    }

    fn edge_args(&mut self, n: &Node, args: &[Value]) -> Option<Edge> {
        self.no_props(n);
        self.no_children(n);
        if args.len() != 2 || !args[0].is_string() {
            self.errf(n, "needs a color and a width");
            return None;
        }
        let color = self.palette_color(n, &args[0].string);
        let w = self.number_value(n, &args[1]);
        let width = self.positive(n, w);
        Some(Edge { color, width })
    }

    fn no_values(&mut self, n: &Node) {
        if !n.args.is_empty() {
            self.errf(n, "takes no arguments");
        }
        self.no_props(n);
    }

    fn no_props(&mut self, n: &Node) {
        if !n.props.is_empty() {
            self.errf(n, "takes no properties");
        }
    }

    fn no_children(&mut self, n: &Node) {
        if !n.children.is_empty() {
            self.errf(n, "takes no children");
        }
    }

    /// Checks n's argument count and refuses any property not listed.
    fn only_args(&mut self, n: &Node, args: usize, props: &[&str]) {
        if n.args.len() != args {
            self.errf(n, format!("takes {args} arguments, got {}", n.args.len()));
        }
        for (key, _) in &n.props {
            if !props.contains(&key.as_str()) {
                self.errf(n, format!("unknown property {}", quote(key)));
            }
        }
    }

    fn str(&mut self, n: &Node) -> String {
        self.no_props(n);
        self.no_children(n);
        if n.args.len() != 1 || !n.args[0].is_string() {
            self.errf(n, "needs one string");
            return String::new();
        }
        n.args[0].string.clone()
    }

    fn one_of(&mut self, n: &Node, allowed: &[&str]) -> String {
        let value = self.str(n);
        if !value.is_empty() && !allowed.contains(&value.as_str()) {
            self.errf(
                n,
                format!("must be one of {allowed:?}, got {}", quote(&value)),
            );
        }
        value
    }

    /// Reads a child that's either bare or holds #true or #false.
    fn flag_value(&mut self, n: &Node) -> bool {
        self.no_props(n);
        self.no_children(n);
        if n.args.is_empty() {
            return true;
        }
        if n.args.len() != 1 || n.args[0].kind != Kind::Bool {
            self.errf(n, "must be #true or #false");
            return false;
        }
        n.args[0].boolean
    }

    fn color_arg(&mut self, n: &Node) -> String {
        if n.args.len() != 1 || !n.args[0].is_string() {
            self.errf(n, "needs one color");
            return String::new();
        }
        self.palette_color(n, &n.args[0].string)
    }

    /// Reads a color list that can leave gaps with `none`.
    fn gap_color_args(&mut self, n: &Node) -> Vec<String> {
        if n.args.is_empty() {
            self.errf(n, "needs at least one color");
        }
        let mut colors = Vec::new();
        for a in &n.args {
            if !a.is_string() {
                self.errf(n, "colors must be palette names");
            } else if a.string == NO_COLOR {
                colors.push(NO_COLOR.to_string());
            } else {
                let c = self.palette_color(n, &a.string);
                colors.push(c);
            }
        }
        colors
    }

    fn palette_color(&mut self, n: &Node, name: &str) -> String {
        if self.gradients.contains(name) {
            return name.to_string();
        }
        self.solid_color(n, name)
    }

    /// For the places a gradient has no meaning.
    fn solid_color(&mut self, n: &Node, name: &str) -> String {
        if self.palette.contains(name) {
            return name.to_string();
        }
        if self.gradients.contains(name) || self.gradient_names.iter().any(|g| g == name) {
            self.errf(
                n,
                format!(
                    "{} is a gradient, and a solid color is needed here",
                    quote(name)
                ),
            );
            return name.to_string();
        }
        self.errf(n, format!("color {} isn't in the palette", quote(name)));
        name.to_string()
    }

    fn number_value(&mut self, n: &Node, v: &Value) -> f64 {
        if v.kind != Kind::Number {
            self.errf(n, "needs a number");
            return 0.0;
        }
        if !limits::in_limits(v.number) {
            self.errf(n, "needs a finite number of a reasonable size");
            return 0.0;
        }
        v.number
    }

    fn number(&mut self, n: &Node) -> f64 {
        self.no_props(n);
        self.no_children(n);
        if n.args.len() != 1 {
            self.errf(n, "needs one number");
            return 0.0;
        }
        self.number_value(n, &n.args[0])
    }

    fn numbers(&mut self, n: &Node) -> Vec<f64> {
        self.no_props(n);
        self.no_children(n);
        n.args.iter().map(|v| self.number_value(n, v)).collect()
    }

    fn positives(&mut self, n: &Node) -> Vec<f64> {
        let values = self.numbers(n);
        for &v in &values {
            self.positive(n, v);
        }
        values
    }

    fn positive(&mut self, n: &Node, v: f64) -> f64 {
        if v <= 0.0 {
            self.errf(n, "needs a positive number");
        }
        v
    }

    /// Reads a size that defaults to 0, which can also be written as 0.
    fn not_negative(&mut self, n: &Node, v: f64) -> f64 {
        if v < 0.0 {
            self.errf(n, "can't be negative");
        }
        v
    }

    fn integer(&mut self, n: &Node, v: f64, limit: usize) -> usize {
        if v != v.round_ties_even() || v < 1.0 {
            self.errf(n, "needs a positive whole number");
            return 0;
        }
        if v > limit as f64 {
            self.errf(n, format!("can't be more than {limit}"));
            return 0;
        }
        v as usize
    }

    fn prop(&mut self, n: &Node, key: &str) -> f64 {
        match n.prop(key) {
            None => {
                self.errf(n, format!("needs {key}="));
                0.0
            }
            Some(v) => self.number_value(n, v),
        }
    }

    fn bool_prop(&mut self, n: &Node, key: &str) -> bool {
        match n.prop(key) {
            None => false,
            Some(v) if v.kind != Kind::Bool => {
                self.errf(n, format!("{key} must be #true or #false"));
                false
            }
            Some(v) => v.boolean,
        }
    }

    fn path_data(&mut self, n: &Node) -> String {
        let d = self.str(n);
        if !numbers::valid_path(&d) {
            self.errf(n, "isn't SVG path data");
            return String::new();
        }
        d
    }

    fn box_value(&mut self, n: &Node, text: &str) -> [f64; 4] {
        match numbers::list(text) {
            Some(v) if v.len() == 4 => [v[0], v[1], v[2], v[3]],
            _ => {
                self.errf(
                    n,
                    "box must be \"x y width height\", with each a finite decimal number of a reasonable size",
                );
                [0.0; 4]
            }
        }
    }

    /// Reads `edge wavy depth=N period=N` or `edge zigzag depth=N count=N`.
    fn line(&mut self, n: &Node) -> Option<Line> {
        self.no_children(n);
        if n.args.len() != 1
            || !n.args[0].is_string()
            || (n.args[0].string != "wavy" && n.args[0].string != "zigzag")
        {
            self.errf(n, "needs a kind: wavy or zigzag");
            return None;
        }
        self.only_args(n, 1, &["depth", "period", "count"]);
        let mut l = Line {
            kind: n.args[0].string.clone(),
            ..Line::default()
        };
        let d = self.prop(n, "depth");
        l.depth = self.positive(n, d);
        if let Some(v) = n.prop("period") {
            let p = self.number_value(n, v);
            l.period = self.positive(n, p);
        }
        if let Some(v) = n.prop("count") {
            let c = self.number_value(n, v);
            l.count = self.integer(n, c, limits::MAX_COPIES);
        }
        if l.period == 0.0 && l.count == 0 {
            self.errf(n, "needs `period` or `count`");
            return None;
        }
        if l.period != 0.0 && l.count != 0 {
            self.errf(n, "needs `period` or `count`, not both");
        }
        Some(l)
    }

    fn quarters(&mut self, n: &Node) -> Layer {
        let colors = self.gap_color_args(n);
        self.no_props(n);
        let mut l = Quarters {
            colors: Default::default(),
            diagonal: false,
            split: None,
        };
        if colors.len() != 4 {
            self.errf(n, "needs 4 colors");
        } else {
            for (i, c) in colors.into_iter().enumerate() {
                l.colors[i] = c;
            }
        }
        let mut fx = Effects::default();
        self.children(n, &["cut"], &mut |p, c| {
            match c.name.as_str() {
                "diagonal" => l.diagonal = p.flag_value(c),
                "split" => l.split = p.at(c),
                _ => return p.effect(&mut fx, c),
            }
            true
        });
        if l.diagonal && l.split.is_some() {
            self.errf(n, "`split` only applies to upright quarters");
        }
        Layer {
            fx,
            kind: LayerKind::Quarters(l),
        }
    }

    fn checks(&mut self, n: &Node) -> Layer {
        let colors = self.gap_color_args(n);
        self.no_props(n);
        let mut l = Checks {
            colors,
            rows: 0,
            columns: 0,
            flow: "bend-sinister".into(),
        };
        let mut fx = Effects::default();
        self.children(n, &["cut"], &mut |p, c| {
            match c.name.as_str() {
                "rows" => {
                    let v = p.number(c);
                    l.rows = p.integer(c, v, limits::MAX_COPIES);
                }
                "columns" => {
                    let v = p.number(c);
                    l.columns = p.integer(c, v, limits::MAX_COPIES);
                }
                "flow" => l.flow = p.one_of(c, &["bend", "bend-sinister"]),
                _ => return p.effect(&mut fx, c),
            }
            true
        });
        if l.colors.len() < 2 {
            self.errf(n, "needs at least 2 colors");
        }
        if l.rows == 0 || l.columns == 0 {
            self.errf(n, "needs `rows` and `columns`");
        }
        if l.rows * l.columns > limits::MAX_COPIES {
            self.errf(n, format!("makes more than {} cells", limits::MAX_COPIES));
        }
        Layer {
            fx,
            kind: LayerKind::Checks(l),
        }
    }

    fn rays(&mut self, n: &Node) -> Layer {
        let colors = self.gap_color_args(n);
        self.no_props(n);
        let mut l = Rays {
            colors,
            from: "center".into(),
            at: None,
            ratio: Vec::new(),
            rotate: 0.0,
            by_edge: false,
        };
        let mut ratio = None;
        let mut count = 0;
        let mut fx = Effects::default();
        self.children(n, &["cut"], &mut |p, c| {
            match c.name.as_str() {
                "from" => {
                    if !c.args.is_empty() {
                        l.from = p.one_of(c, RAY_FROM);
                    } else {
                        l.at = p.at(c);
                    }
                }
                "count" => {
                    let v = p.number(c);
                    count = p.integer(c, v, limits::MAX_COPIES);
                }
                "ratio" => ratio = Some(p.positives(c)),
                "rotate" => l.rotate = p.number(c),
                "measure" => l.by_edge = p.one_of(c, &["angle", "edge"]) == "edge",
                _ => return p.effect(&mut fx, c),
            }
            true
        });
        if l.by_edge && l.rotate != 0.0 {
            self.errf(
                n,
                "`measure edge` follows the region's edges, so it can't also have a `rotate`",
            );
        }
        if !l.colors.is_empty() {
            l.colors = self.cycle(n, l.colors.clone(), count);
            l.ratio = self.ratio(n, ratio, l.colors.len());
        } else if let Some(r) = ratio {
            l.ratio = r;
        }
        Layer {
            fx,
            kind: LayerKind::Rays(l),
        }
    }

    /// Reads a pile or pall, which are shapes tied to their region's edges.
    fn ordinary_shape(&mut self, n: &Node) -> Layer {
        let mut shape = Shape {
            kind: n.name.clone(),
            ..Shape::default()
        };
        let color = self.color_arg(n);
        self.no_props(n);
        let mut fx = Effects::default();
        let mut fimbriate = None;
        self.shape_body(
            n,
            &mut shape,
            Some(&mut |p, c| {
                if c.name == "fimbriate" {
                    fimbriate = p.edge(c);
                    return true;
                }
                p.effect(&mut fx, c)
            }),
        );
        if fimbriate.is_some() && shape.hollow > 0.0 {
            self.errf(
                n,
                "fimbriation edges a filled shape, so it can't go with `hollow` or `lines`",
            );
        }
        Layer {
            fx,
            kind: LayerKind::Charge(Charge {
                shape,
                color,
                fimbriate,
                repeat: None,
            }),
        }
    }

    fn panel(&mut self, n: &Node, depth: usize) -> Layer {
        let mut l = Panel::default();
        // An `at center` gives no position, but it's still an `at`.
        let mut placed = false;
        self.no_values(n);
        let mut fx = Effects::default();
        let mut layers = Vec::new();
        {
            let l = &mut l;
            let placed = &mut placed;
            self.container(n, depth, &mut fx, &mut layers, &mut |p, c| {
                match c.name.as_str() {
                    "side" => l.side = p.one_of(c, FROM),
                    "corner" => l.corner = p.one_of(c, CORNER),
                    "at" => {
                        l.at = p.at(c);
                        *placed = true;
                    }
                    "width" => {
                        let v = p.number(c);
                        l.width = p.positive(c, v);
                    }
                    "fly" => {
                        let v = p.number(c);
                        l.fly = p.positive(c, v);
                    }
                    "hoist" => {
                        let v = p.number(c);
                        l.hoist = p.positive(c, v);
                    }
                    "edge" => l.line = p.line(c),
                    _ => return false,
                }
                true
            });
        }
        l.layers = layers;
        self.check_waves(n, l.line.as_ref());
        if !l.side.is_empty() && !l.corner.is_empty() {
            self.errf(n, "needs either `side` or `corner`, not both");
        } else if !l.side.is_empty() {
            if l.width == 0.0 {
                self.errf(n, "a side panel needs a `width`");
            }
            if l.fly != 0.0 || l.hoist != 0.0 || placed {
                self.errf(
                    n,
                    "a side panel takes a `width`, and no `fly`, `hoist` or `at`",
                );
            }
        } else {
            if l.fly == 0.0 || l.hoist == 0.0 {
                self.errf(n, "needs a `side` and `width`, or a `fly` and `hoist`");
            }
            if l.line.is_some() {
                self.errf(n, "only a side panel can have an `edge`");
            }
            if !l.corner.is_empty() && placed {
                self.errf(n, "needs either `corner` or `at`, not both");
            }
            if l.width != 0.0 {
                self.errf(n, "only a side panel has a `width`");
            }
        }
        if l.layers.is_empty() {
            self.errf(n, "needs at least one layer");
        }
        Layer {
            fx,
            kind: LayerKind::Panel(l),
        }
    }

    fn use_layer(&mut self, n: &Node, depth: usize) -> Option<Layer> {
        self.no_props(n);
        if n.args.len() != 1 || !n.args[0].is_string() {
            self.errf(n, "needs the name of a definition");
            return None;
        }
        let name = n.args[0].string.clone();
        let design = match self.defines.get(&name) {
            Some(d) if d.shape.is_none() => d.clone(),
            _ => {
                self.errf(n, format!("{} isn't a defined design", quote(&name)));
                return None;
            }
        };
        if depth + design.height > limits::MAX_DEPTH {
            self.errf(
                n,
                format!(
                    "{} nests more than {} levels deep where it's used",
                    quote(&name),
                    limits::MAX_DEPTH
                ),
            );
        }
        let mut fx = Effects::default();
        self.children(n, &["cut"], &mut |p, c| p.effect(&mut fx, c));
        Some(Layer {
            fx,
            kind: LayerKind::Use(Use { name, design }),
        })
    }

    /// Reads a reusable shape or design: `define NAME hoist=H fly=F { ... }`.
    fn define(&mut self, n: &Node) {
        if n.args.len() != 1 || !n.args[0].is_string() {
            self.errf(n, "needs a name");
            return;
        }
        let name = n.args[0].string.clone();
        if name.is_empty() {
            self.errf(n, "needs a name");
            return;
        }
        if self.defines.contains(&name)
            || SHAPE_KINDS.contains(&name.as_str())
            || name == "svg"
            || name == "pile"
            || name == "pall"
        {
            self.errf(n, format!("{} is already taken", quote(&name)));
            return;
        }
        self.only_args(n, 1, &["hoist", "fly"]);
        let mut d = Define::default();
        if n.prop("fly").is_some() || n.prop("hoist").is_some() {
            let f = self.prop(n, "fly");
            d.fly = self.positive(n, f);
            let h = self.prop(n, "hoist");
            d.hoist = self.positive(n, h);
        }
        if n.children.is_empty() {
            self.errf(n, "needs a shape or layers");
            return;
        }
        let nodes = &n.children;
        if nodes.len() == 1 && SHAPE_KINDS.contains(&nodes[0].name.as_str()) {
            let c = &nodes[0];
            if d.fly != 0.0 {
                self.errf(
                    n,
                    "only a design has its own grid, and a shape takes its size from what uses it",
                );
            }
            let mut s = Shape {
                kind: c.name.clone(),
                ..Shape::default()
            };
            if s.kind == "path" && !c.args.is_empty() {
                // The usual form, `path "M..." box="0 0 10 10"`, puts it all on one line. Its size
                // comes from each charge using it, so nothing more can be checked yet.
                let (path, bx) = self.line_path(c);
                s.d = path;
                s.bx = bx;
                d.shape = Some(s);
                self.defines.insert(&name, Arc::new(d));
                return;
            }
            self.no_values(c);
            self.shape_body(c, &mut s, None);
            d.shape = Some(s);
            self.defines.insert(&name, Arc::new(d));
            return;
        }
        for c in nodes {
            if let Some(l) = self.layer(c, 2) {
                d.layers.push(l);
            }
        }
        d.size = limits::layers_size(&d.layers, self.longer);
        d.height = limits::layers_height(&d.layers);
        self.defines.insert(&name, Arc::new(d));
    }

    /// Reads the one-line form of a path, `path "M..." box="x y width height"`, which takes nothing else.
    fn line_path(&mut self, n: &Node) -> (String, [f64; 4]) {
        self.only_args(n, 1, &["box"]);
        self.no_children(n);
        let mut d = String::new();
        let mut bx = [0.0; 4];
        if n.args.len() == 1 && n.args[0].is_string() && numbers::valid_path(&n.args[0].string) {
            d = n.args[0].string.clone();
        } else {
            self.errf(n, "isn't SVG path data");
        }
        if let Some(b) = n.prop("box")
            && b.is_string()
        {
            bx = self.box_value(n, &b.string);
        }
        if bx[2] <= 0.0 || bx[3] <= 0.0 {
            self.errf(n, "needs a `box` with an area");
        }
        (d, bx)
    }

    /// Reads a flag's silhouette: a polygon or path inside it, or a named form.
    fn outline(&mut self, n: &Node) -> Option<Outline> {
        self.no_props(n);
        let mut o = Outline::default();
        let args = &n.args;
        if args.len() > 1 || (args.len() == 1 && !args[0].is_string()) {
            self.errf(n, "takes a named form, or a polygon or path inside it");
            return None;
        }
        if args.len() == 1 {
            o.kind = args[0].string.clone();
            match o.kind.as_str() {
                "swallowtail" | "tongued" | "pennant" => {}
                _ => {
                    self.errf(n, format!("unknown form {}", quote(&o.kind)));
                    return None;
                }
            }
            let mut given: HashSet<&str> = HashSet::new();
            self.children(n, &[], &mut |p, c| {
                match c.name.as_str() {
                    "depth" => {
                        let v = p.number(c);
                        o.depth = p.positive(c, v);
                        given.insert("depth");
                    }
                    "tip" => {
                        let v = p.number(c);
                        o.tip = p.not_negative(c, v);
                        given.insert("tip");
                    }
                    "tongue" => {
                        let v = p.number(c);
                        o.tongue = p.positive(c, v);
                        given.insert("tongue");
                    }
                    "taper" => {
                        let v = p.number(c);
                        o.taper = p.not_negative(c, v);
                        given.insert("taper");
                    }
                    _ => return false,
                }
                true
            });
            if o.kind != "pennant" && o.depth == 0.0 {
                self.errf(n, "needs a `depth`");
            }
            if o.kind == "tongued" && o.tongue == 0.0 {
                self.errf(n, "needs a `tongue`");
            }
            if (given.contains("tip") && o.kind != "pennant")
                || (given.contains("tongue") && o.kind != "tongued")
                || (given.contains("taper") && o.kind != "swallowtail")
                || (given.contains("depth") && o.kind == "pennant")
            {
                self.errf(n, format!("has a value that a {} doesn't use", o.kind));
            }
            return Some(o);
        }
        let mut shapes = 0;
        self.children(n, &[], &mut |p, c| {
            match c.name.as_str() {
                "polygon" => {
                    shapes += 1;
                    if shapes > 1 {
                        p.errf(c, "an outline holds one shape");
                    }
                    let mut s = Shape {
                        kind: "polygon".into(),
                        ..Shape::default()
                    };
                    p.no_values(c);
                    p.shape_body(c, &mut s, None);
                    if s.hollow > 0.0 {
                        p.errf(c, "an outline is a whole shape, so it can't be `hollow`");
                    }
                    o.kind = "polygon".into();
                    o.vertices = s.vertices;
                }
                "path" => {
                    shapes += 1;
                    if shapes > 1 {
                        p.errf(c, "an outline holds one shape");
                    }
                    o.kind = "path".into();
                    let (d, bx) = p.line_path(c);
                    o.d = d;
                    o.bx = bx;
                }
                _ => return false,
            }
            true
        });
        if o.kind.is_empty() {
            self.errf(n, "needs a form, a `polygon` or a `path`");
            return None;
        }
        Some(o)
    }

    fn reverse(&mut self, n: &Node, flag: &mut Doc) {
        let args = &n.args;
        if args.len() == 1 && args[0].is_string() && args[0].string == "mirror" {
            // The default, for saying so outright.
            self.no_props(n);
            self.no_children(n);
            return;
        }
        self.no_values(n);
        let mut r = Reverse::default();
        for c in &n.children {
            // It holds the flag's layers for that side, so they're at the top level.
            if let Some(l) = self.layer(c, 1) {
                r.layers.push(l);
            }
        }
        if r.layers.is_empty() {
            self.errf(n, "needs layers, or `mirror`");
        }
        self.count(n, &r.layers);
        flag.reverse = Some(r);
    }

    fn adapt(&mut self, n: &Node, flag: &mut Doc) {
        self.no_values(n);
        let mut a = Adapt::default();
        let mode = |p: &mut Parser<'a>, c: &Node| -> String {
            if c.args.len() == 1 && c.args[0].is_string() && c.args[0].string == "cut" {
                return "extend".into();
            }
            p.one_of(c, MODE)
        };
        self.children(n, &[], &mut |p, c| {
            match c.name.as_str() {
                "range" => {
                    let v = p.numbers(c);
                    if v.len() != 2 || v[0] <= 0.0 || v[1] < v[0] {
                        p.errf(c, "needs a lowest and highest fly-to-hoist ratio");
                        return true;
                    }
                    a.min = v[0];
                    a.max = v[1];
                }
                "wider" => a.wider = mode(p, c),
                "narrower" => a.narrower = mode(p, c),
                _ => return false,
            }
            true
        });
        if a.wider.is_empty() && a.narrower.is_empty() {
            self.errf(n, "needs `wider`, `narrower` or both");
        }
        flag.adapt = Some(a);
    }

    fn variant(&mut self, n: &Node, flag: &mut Doc) {
        if n.args.len() != 1 || !n.args[0].is_string() {
            self.errf(n, "needs a name");
            return;
        }
        self.no_props(n);
        let name = n.args[0].string.clone();
        if name.is_empty() {
            self.errf(n, "needs a name");
            return;
        }
        if flag.variants.contains(&name) {
            self.errf(n, format!("{} is defined twice", quote(&name)));
            return;
        }
        let mut v = Variant::default();
        let mut seen: HashSet<&str> = HashSet::new();
        for c in &n.children {
            let handled = match c.name.as_str() {
                "from" => {
                    v.from = self.one_of(c, VIEW);
                    true
                }
                "upright" => {
                    v.upright = self.flag_value(c);
                    true
                }
                "ratio" => {
                    let r = self.number(c);
                    v.ratio = self.positive(c, r);
                    true
                }
                "proportion" => {
                    self.only_args(c, 0, &["hoist", "fly"]);
                    let h = self.prop(c, "hoist");
                    v.hoist = self.positive(c, h);
                    let f = self.prop(c, "fly");
                    v.fly = self.positive(c, f);
                    self.no_children(c);
                    true
                }
                "outline" => {
                    v.outline = self.outline(c);
                    true
                }
                "border" => {
                    let (b, outside) = self.border(c);
                    v.border = b;
                    v.border_outside = outside;
                    true
                }
                _ => false,
            };
            if !handled {
                // Its layers replace the flag's, so they're at the top level.
                if let Some(l) = self.layer(c, 1) {
                    v.layers.push(l);
                }
                continue;
            }
            if seen.contains(c.name.as_str()) {
                self.errf(c, "given more than once");
            }
            seen.insert(&c.name);
        }
        if seen.contains("proportion") {
            if seen.contains("ratio") {
                self.errf(n, "can't have both `proportion` and `ratio`");
            }
            if v.layers.is_empty() {
                self.errf(n, "with a `proportion` needs its own layers");
            }
        }
        if v.outline.is_some() || v.border.is_some() || v.fly > 0.0 {
            // What it draws within is its own or the flag's, as it would be when rendered.
            let (mut fly, mut hoist) = (flag.fly, flag.hoist);
            let mut outline = flag.outline.as_ref();
            let mut border = flag.border.as_ref();
            let mut outside = flag.border_outside;
            if v.fly > 0.0 {
                fly = v.fly;
                hoist = v.hoist;
                outline = None;
                border = None;
                outside = false;
            }
            if v.outline.is_some() {
                outline = v.outline.as_ref();
            }
            if v.border.is_some() {
                border = v.border.as_ref();
                outside = v.border_outside;
            }
            self.check_outside(n, outline, fly, hoist, border, outside);
        }
        self.count(n, &v.layers);
        flag.variants.insert(&name, v);
    }

    /// Reads a text with any sources for it as children.
    fn reference(&mut self, n: &Node) -> Option<Reference> {
        self.no_props(n);
        if n.args.len() != 1 || !n.args[0].is_string() {
            self.errf(n, "needs one string");
            return None;
        }
        let mut r = Reference {
            text: n.args[0].string.clone(),
            sources: Vec::new(),
        };
        self.children(n, &["source"], &mut |p, c| {
            if c.name != "source" {
                return false;
            }
            let s = p.str(c);
            r.sources.push(s);
            true
        });
        Some(r)
    }

    /// Reads a named sequence of folds.
    fn fold(&mut self, n: &Node, flag: &mut Doc) {
        if n.args.len() != 1 || !n.args[0].is_string() {
            self.errf(n, "needs a name");
            return;
        }
        self.no_props(n);
        let name = n.args[0].string.clone();
        if name.is_empty() {
            self.errf(n, "needs a name");
            return;
        }
        if flag.folds.contains(&name) {
            self.errf(n, format!("{} is defined twice", quote(&name)));
            return;
        }
        let mut f = Fold::default();
        self.children(n, &["source", "over", "under", "tuck"], &mut |p, c| {
            match c.name.as_str() {
                "description" => f.description = p.str(c),
                "source" => {
                    let s = p.str(c);
                    f.sources.push(s);
                }
                "over" | "under" | "tuck" => {
                    if let Some(s) = p.fold_step(c) {
                        f.steps.push(s);
                    }
                }
                _ => return false,
            }
            true
        });
        if f.steps.is_empty() {
            self.errf(n, "needs at least one step");
        }
        flag.folds.insert(&name, f);
    }

    /// Reads `over along=fly at=5 move=bottom`, or for any line, `over through="a b c d" move="e f"`.
    fn fold_step(&mut self, n: &Node) -> Option<FoldStep> {
        self.no_children(n);
        self.only_args(n, 0, &["along", "at", "move", "through"]);
        let Some(move_value) = n.prop("move").filter(|v| v.is_string()) else {
            self.errf(n, "needs move=, the part that moves");
            return None;
        };
        let mv = move_value.string.clone();
        let origin = Point::new(0.0, 0.0);
        let mut s = FoldStep {
            kind: n.name.clone(),
            along: String::new(),
            mv: String::new(),
            at: 0.0,
            through: None,
            move_to: None,
            a: origin,
            b: origin,
            moving: origin,
        };
        if let Some(through) = n.prop("through") {
            if n.prop("along").is_some() || n.prop("at").is_some() {
                self.errf(n, "a crease is `through=` or `along=` and `at=`, not both");
                return None;
            }
            let line = self.point_list(n, through, 4);
            let point = self.point_list(n, move_value, 2);
            let (Some(line), Some(point)) = (line, point) else {
                return None;
            };
            s.a = Point::new(line[0], line[1]);
            s.b = Point::new(line[2], line[3]);
            s.moving = Point::new(point[0], point[1]);
            s.through = Some(line);
            s.move_to = Some(point);
            return Some(s);
        }
        let along = n.prop("along");
        let Some(along) = along.filter(|a| a.is_string() && n.prop("at").is_some()) else {
            self.errf(n, "needs along= and at=, or through=");
            return None;
        };
        let at = self.prop(n, "at");
        s.along = along.string.clone();
        s.at = at;
        s.mv = mv.clone();
        match along.string.as_str() {
            "fly" => {
                s.a = Point::new(0.0, at);
                s.b = Point::new(1.0, at);
                if mv == "top" {
                    s.moving = Point::new(0.0, at - 1.0);
                } else if mv == "bottom" {
                    s.moving = Point::new(0.0, at + 1.0);
                } else {
                    self.errf(n, "a crease along the fly moves top or bottom");
                    return None;
                }
            }
            "hoist" => {
                s.a = Point::new(at, 0.0);
                s.b = Point::new(at, 1.0);
                if mv == "hoist" {
                    s.moving = Point::new(at - 1.0, 0.0);
                } else if mv == "fly" {
                    s.moving = Point::new(at + 1.0, 0.0);
                } else {
                    self.errf(n, "a crease along the hoist moves hoist or fly");
                    return None;
                }
            }
            _ => {
                self.errf(n, "along must be fly or hoist");
                return None;
            }
        }
        Some(s)
    }

    fn point_list(&mut self, n: &Node, v: &Value, count: usize) -> Option<Vec<f64>> {
        if !v.is_string() {
            self.errf(n, format!("needs {count} numbers in a string"));
            return None;
        }
        match numbers::list(&v.string) {
            Some(values) if values.len() == count => Some(values),
            _ => {
                self.errf(
                    n,
                    format!(
                        "needs {count} finite decimal numbers of a reasonable size in a string"
                    ),
                );
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_dates() {
        assert!(valid_date("0000-02-29"));
        assert!(valid_date("2024-02-29"));
        assert!(!valid_date("1900-02-29"));
        assert!(!valid_date("2023-4"));
        assert!(valid_date("2023-04"));
        assert!(!valid_date("2023-13"));
        assert!(valid_date("1999"));
    }

    #[test]
    fn places_offsets() {
        assert_eq!(place("ab\ncé d", 7), (2, 4));
        assert_eq!(place("abc", 0), (1, 1));
    }
}
