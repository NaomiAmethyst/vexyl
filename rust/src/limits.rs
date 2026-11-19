// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! The limits of section 15 of the format, so that a small document can't demand unbounded work.

use crate::model::{Charge, Layer, LayerKind, Shape};

pub(crate) const MAX_DEPTH: usize = 32;
/// How much a whole flag can paint.
pub(crate) const MAX_SIZE: usize = 200_000;
pub(crate) const MAX_COPIES: usize = 10_000;
/// How many pieces a fold can make, since each step can double them.
pub(crate) const MAX_FACETS: usize = 10_000;
/// How many bytes of path data or inline SVG count as one part.
pub(crate) const BYTES_PER_PART: usize = 64;
/// The largest size a number can have, and its inverse the smallest.
pub(crate) const NUMBER_LIMIT: f64 = 1e12;

/// Whether a number is finite and of a reasonable size.
pub(crate) fn in_limits(v: f64) -> bool {
    let a = v.abs();
    !v.is_nan() && a <= NUMBER_LIMIT && (a == 0.0 || a >= 1.0 / NUMBER_LIMIT)
}

/// Adds sizes without passing the point where they stop mattering.
pub(crate) fn add(a: usize, b: usize) -> usize {
    a.saturating_add(b).min(MAX_SIZE + 1)
}

pub(crate) fn mul(a: usize, b: usize) -> usize {
    if a == 0 || b == 0 {
        return 0;
    }
    a.saturating_mul(b).min(MAX_SIZE + 1)
}

/// How many parts one copy of a shape counts as.
pub(crate) fn shape_parts(s: &Shape) -> usize {
    match s.kind.as_str() {
        "star" | "sun" => s.points.max(1),
        "polygon" => s.vertices.len().max(1),
        "path" => 1 + s.d.len() / BYTES_PER_PART,
        "svg" => 1 + s.markup.len() / BYTES_PER_PART,
        _ => 1,
    }
}

pub(crate) fn charge_copies(c: &Charge) -> usize {
    if let Some(r) = &c.repeat {
        if r.kind == "grid" {
            return r.rows * r.columns;
        }
        return r.count;
    }
    if c.shape.ats.len() > 1 {
        return c.shape.ats.len();
    }
    1
}

/// What a layer paints. A definition's size was worked out when it was read.
pub(crate) fn layer_size(l: &Layer, longer: f64) -> usize {
    let size = l.fx.clip.as_ref().map_or(0, shape_parts);
    let mut cuts = 0;
    for s in &l.fx.cuts {
        cuts = add(cuts, shape_parts(s));
    }
    // A charge's cuts go with each of its copies.
    if let LayerKind::Charge(c) = &l.kind {
        cuts = mul(charge_copies(c), cuts);
    }
    add(add(size, cuts), content_size(l, longer))
}

fn content_size(l: &Layer, longer: f64) -> usize {
    match &l.kind {
        LayerKind::Bars(t) => match &t.line {
            Some(line) => mul(t.colors.len(), 1 + line.waves(longer)),
            None => t.colors.len(),
        },
        LayerKind::Chevrons(t) => t.colors.len(),
        LayerKind::Rays(t) => t.colors.len(),
        LayerKind::Quarters(_) => 4,
        LayerKind::Checks(t) => mul(t.rows, t.columns),
        LayerKind::Charge(t) => mul(charge_copies(t), shape_parts(&t.shape)),
        LayerKind::Emblem(e) => {
            let mut size = 0;
            for c in &e.charges {
                size = add(size, layer_size(c, longer));
            }
            size
        }
        LayerKind::Group(g) => layers_size(&g.layers, longer),
        LayerKind::Panel(p) => {
            let mut size = layers_size(&p.layers, longer);
            if let Some(line) = &p.line {
                size = add(size, line.waves(longer));
            }
            size
        }
        LayerKind::Use(u) => u.design.size,
        _ => 1,
    }
}

pub(crate) fn layers_size(layers: &[Layer], longer: f64) -> usize {
    let mut size = 0;
    for l in layers {
        size = add(size, layer_size(l, longer));
    }
    size
}

/// How many levels a layer nests, counting what it uses.
pub(crate) fn layer_height(l: &Layer) -> usize {
    match &l.kind {
        LayerKind::Group(g) => 1 + layers_height(&g.layers),
        LayerKind::Panel(p) => 1 + layers_height(&p.layers),
        LayerKind::Use(u) => 1 + u.design.height,
        _ => 1,
    }
}

pub(crate) fn layers_height(layers: &[Layer]) -> usize {
    layers.iter().map(layer_height).max().unwrap_or(0)
}
