// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! What a document says, as the parser reads it. These are the library's own, and change only
//! while a document is read: rendering copies what it changes, so a flag stays as it was.

use std::sync::Arc;

use crate::limits;
use crate::sanitizer::Artwork;

/// A map that keeps its keys in the order they were added.
#[derive(Debug, Clone)]
pub(crate) struct Ordered<V> {
    entries: Vec<(String, V)>,
}

impl<V> Default for Ordered<V> {
    fn default() -> Self {
        Ordered {
            entries: Vec::new(),
        }
    }
}

impl<V> Ordered<V> {
    pub fn get(&self, key: &str) -> Option<&V> {
        self.entries.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn contains(&self, key: &str) -> bool {
        self.get(key).is_some()
    }

    /// Adds a value, replacing one of the same key where it is.
    pub fn insert(&mut self, key: &str, value: V) {
        if let Some(e) = self.entries.iter_mut().find(|(k, _)| k == key) {
            e.1 = value;
        } else {
            self.entries.push((key.to_string(), value));
        }
    }

    pub fn iter(&self) -> impl Iterator<Item = (&String, &V)> {
        self.entries.iter().map(|(k, v)| (k, v))
    }

    pub fn keys(&self) -> impl Iterator<Item = &String> {
        self.entries.iter().map(|(k, _)| k)
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Doc {
    pub version: i32,
    pub meta: Meta,
    /// Color names to #rrggbb values, in lowercase.
    pub palette: Ordered<String>,
    /// Colors' values in other systems, for print and dye.
    pub color_refs: Ordered<Vec<ColorRef>>,
    pub gradients: Ordered<Gradient>,
    pub hoist: f64,
    pub fly: f64,
    pub outline: Option<Outline>,
    pub border: Option<Edge>,
    pub border_outside: bool,
    pub defines: Ordered<Arc<Define>>,
    pub layers: Vec<Layer>,
    pub reverse: Option<Reverse>,
    pub adapt: Option<Adapt>,
    pub variants: Ordered<Variant>,
    pub folds: Ordered<Fold>,
    /// Unique to the source, so that several flags can be inlined in one page.
    pub id_prefix: String,
    /// Says that the layers are a reverse's own, as seen from behind, while it's drawn.
    pub seen_from_behind: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct Gradient {
    pub colors: Vec<String>,
    pub stops: Vec<f64>,
    pub along: String,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Meta {
    pub name: String,
    pub description: String,
    pub version: String,
    pub date: String,
    pub until: String,
    pub series: String,
    pub notes: Vec<String>,
    pub laws: Vec<Reference>,
    pub restrictions: Vec<Reference>,
    pub designers: Vec<String>,
    pub design_rights: String,
    pub encoders: Vec<String>,
    pub license: String,
    pub render_license: String,
    pub adapted_from: Vec<Adaptation>,
    pub sources: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Adaptation {
    pub url: String,
    pub authors: Vec<String>,
    pub license: String,
    pub part: String,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Reference {
    pub text: String,
    pub sources: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct ColorRef {
    pub system: String,
    pub value: String,
    /// The same value as numbers, for cmyk.
    pub numbers: Vec<f64>,
    /// A system named in a `reference`, rather than one of the format's own.
    pub other: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Point {
    pub fly: f64,
    pub hoist: f64,
}

impl Point {
    pub fn new(fly: f64, hoist: f64) -> Point {
        Point { fly, hoist }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct Edge {
    pub color: String,
    pub width: f64,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Outline {
    /// polygon, path, swallowtail, tongued or pennant.
    pub kind: String,
    pub vertices: Vec<Point>,
    pub d: String,
    pub bx: [f64; 4],
    pub depth: f64,
    pub tip: f64,
    pub tongue: f64,
    pub taper: f64,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Define {
    pub shape: Option<Shape>,
    pub layers: Vec<Layer>,
    /// A design's own grid, scaled to fill where it's used.
    pub fly: f64,
    pub hoist: f64,
    /// Worked out when it's read, as SPEC section 15 counts them.
    pub size: usize,
    pub height: usize,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Reverse {
    pub layers: Vec<Layer>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Adapt {
    /// Limits on the proportion as fly divided by hoist. Zero is no limit.
    pub min: f64,
    pub max: f64,
    /// extend, center, scale, hoist-extend, hoist-center or hoist-scale, or "" for none.
    pub wider: String,
    pub narrower: String,
}

#[derive(Debug, Clone)]
pub(crate) struct Variant {
    pub from: String,
    pub upright: bool,
    pub ratio: f64,
    pub fly: f64,
    pub hoist: f64,
    pub outline: Option<Outline>,
    pub border: Option<Edge>,
    pub border_outside: bool,
    pub layers: Vec<Layer>,
}

impl Default for Variant {
    fn default() -> Self {
        Variant {
            from: "none".into(),
            upright: false,
            ratio: 0.0,
            fly: 0.0,
            hoist: 0.0,
            outline: None,
            border: None,
            border_outside: false,
            layers: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Fold {
    pub description: String,
    pub sources: Vec<String>,
    pub steps: Vec<FoldStep>,
}

#[derive(Debug, Clone)]
pub(crate) struct FoldStep {
    /// over, under or tuck.
    pub kind: String,
    /// For a crease along an axis.
    pub along: String,
    pub mv: String,
    pub at: f64,
    /// For a crease through two points, as written.
    pub through: Option<Vec<f64>>,
    pub move_to: Option<Vec<f64>>,
    /// The crease's two points, and a point on the side that moves.
    pub a: Point,
    pub b: Point,
    pub moving: Point,
}

/// A wavy or zigzag edge between divisions.
#[derive(Debug, Clone, Default)]
pub(crate) struct Line {
    pub kind: String,
    pub depth: f64,
    pub period: f64,
    pub count: usize,
}

impl Line {
    /// How many waves it has across the flag's longer side.
    pub fn waves(&self, longer: f64) -> usize {
        if self.count > 0 {
            return self.count;
        }
        if self.period <= 0.0 {
            return 0;
        }
        let waves = (longer / self.period).ceil();
        if waves > limits::MAX_COPIES as f64 {
            return limits::MAX_COPIES + 1;
        }
        waves as usize
    }
}

/// What every layer of section 6 of the format has.
#[derive(Debug, Clone)]
pub(crate) struct Effects {
    /// start, center, end or scale, or "" to follow the flag's rule.
    pub anchor: String,
    pub opacity: f64,
    pub blend: String,
    pub clip: Option<Shape>,
    pub cuts: Vec<Shape>,
}

impl Default for Effects {
    fn default() -> Self {
        Effects {
            anchor: String::new(),
            opacity: 1.0,
            blend: "normal".into(),
            clip: None,
            cuts: Vec::new(),
        }
    }
}

/// One of the layers of section 6 of the format.
#[derive(Debug, Clone)]
pub(crate) struct Layer {
    pub fx: Effects,
    pub kind: LayerKind,
}

// Layers are few and short-lived, so their sizes don't matter.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone)]
pub(crate) enum LayerKind {
    Field(Field),
    Bars(Bars),
    Chevrons(Chevrons),
    Band(Band),
    Cross(Cross),
    Saltire(Saltire),
    Quarters(Quarters),
    Checks(Checks),
    Rays(Rays),
    Charge(Charge),
    Emblem(Emblem),
    Group(Group),
    Panel(Panel),
    Use(Use),
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Field {
    pub color: String,
}

/// Where adapting put a rotated bars or band, if it did.
#[derive(Debug, Clone, Copy)]
pub(crate) struct FixedFrame {
    /// The region it was drawn in, and where its center moved to in the new one.
    pub w: f64,
    pub h: f64,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone)]
pub(crate) struct Bars {
    pub colors: Vec<String>,
    pub along: String,
    pub ratio: Vec<f64>,
    pub rotate: f64,
    pub grow: Option<Vec<f64>>,
    pub line: Option<Line>,
    pub fixed: Option<FixedFrame>,
}

#[derive(Debug, Clone)]
pub(crate) struct Chevrons {
    pub colors: Vec<String>,
    pub from: String,
    pub depth: f64,
    pub angle: f64,
    pub apex: Option<f64>,
    pub ratio: Vec<f64>,
    pub rotate: f64,
    pub fimbriate: Option<Edge>,
}

#[derive(Debug, Clone)]
pub(crate) struct Band {
    pub color: String,
    pub along: String,
    pub width: f64,
    pub offset: f64,
    pub rotate: f64,
    pub fimbriate: Option<Edge>,
    pub fixed: Option<FixedFrame>,
}

#[derive(Debug, Clone)]
pub(crate) struct Cross {
    pub color: String,
    pub fly_parts: [f64; 3],
    pub hoist_parts: [f64; 3],
    pub fimbriate: Option<Edge>,
}

#[derive(Debug, Clone)]
pub(crate) struct Saltire {
    pub color: String,
    pub width: f64,
    pub fimbriate: Option<Edge>,
    pub counterchange: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct Quarters {
    pub colors: [String; 4],
    pub diagonal: bool,
    pub split: Option<Point>,
}

#[derive(Debug, Clone)]
pub(crate) struct Checks {
    pub colors: Vec<String>,
    pub rows: usize,
    pub columns: usize,
    pub flow: String,
}

#[derive(Debug, Clone)]
pub(crate) struct Rays {
    pub colors: Vec<String>,
    /// center, a corner or the middle of an edge. At overrides it.
    pub from: String,
    pub at: Option<Point>,
    pub ratio: Vec<f64>,
    pub rotate: f64,
    pub by_edge: bool,
}

/// A charge, or a pile or pall, which are read as charges of their own shapes.
#[derive(Debug, Clone, Default)]
pub(crate) struct Charge {
    pub shape: Shape,
    /// Optional for inline SVG, where it's what currentColor means.
    pub color: String,
    pub fimbriate: Option<Edge>,
    pub repeat: Option<Repeat>,
}

#[derive(Debug, Clone)]
pub(crate) struct Emblem {
    pub at: Option<Point>,
    pub along: String,
    pub rotate: f64,
    /// Each a charge.
    pub charges: Vec<Layer>,
}

#[derive(Debug, Clone)]
pub(crate) struct Group {
    pub layers: Vec<Layer>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Panel {
    pub side: String,
    pub width: f64,
    pub corner: String,
    pub at: Option<Point>,
    pub fly: f64,
    pub hoist: f64,
    pub line: Option<Line>,
    pub layers: Vec<Layer>,
    /// Written as a canton.
    pub canton: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct Use {
    pub name: String,
    /// The definition it names, which isn't part of the use itself.
    pub design: Arc<Define>,
}

/// A shape used by a charge, clip or cut, or a definition.
#[derive(Debug, Clone, Default)]
pub(crate) struct Shape {
    pub kind: String,
    /// The position, or None for the center of the region.
    pub at: Option<Point>,
    /// The positions of a charge given several, each None for the center.
    pub ats: Vec<Option<Point>>,
    pub rotate: f64,
    pub radius: f64,
    pub inner: f64,
    pub points: usize,
    pub width: f64,
    pub spread: f64,
    pub from: f64,
    pub to: f64,
    pub has_arc: bool,
    pub offset: f64,
    pub disc: f64,
    pub gap: f64,
    pub hollow: f64,
    pub lines: f64,
    pub d: String,
    pub bx: [f64; 4],
    pub even_odd: bool,
    /// The edge a pile or pall starts from.
    pub edge: String,
    pub base: Option<[f64; 2]>,
    pub tip: Option<[f64; 2]>,
    pub depth: f64,
    pub flat: f64,
    pub junction: f64,
    pub fly: f64,
    pub hoist: f64,
    pub vertices: Vec<Point>,
    /// Inline SVG after being sanitized, in its canonical form.
    pub markup: String,
    /// An explicit `at`, even `at center`.
    pub placed: bool,
    /// Values worked out from the shape's others, which a charge using a definition works out again.
    pub auto_inner: bool,
    pub auto_spread: bool,
    /// A pile's `flat`, even `flat 0`.
    pub has_flat: bool,
    pub embedded: Option<Arc<Artwork>>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Repeat {
    /// ring, arc, grid or line.
    pub kind: String,
    pub count: usize,
    pub radius: f64,
    pub turn: bool,
    pub from: f64,
    pub to: f64,
    pub rows: usize,
    pub columns: usize,
    pub stagger: bool,
    pub fly: f64,
    pub hoist: f64,
}
