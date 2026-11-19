// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! Points, polygons and folds, which reading a document checks and rendering draws.

use crate::limits;
use crate::model::{Doc, Fold, Outline};

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Vec2 {
    pub x: f64,
    pub y: f64,
}

pub(crate) fn v(x: f64, y: f64) -> Vec2 {
    Vec2 { x, y }
}

impl Vec2 {
    pub fn add(self, b: Vec2) -> Vec2 {
        v(self.x + b.x, self.y + b.y)
    }

    pub fn sub(self, b: Vec2) -> Vec2 {
        v(self.x - b.x, self.y - b.y)
    }

    pub fn mul(self, k: f64) -> Vec2 {
        v(self.x * k, self.y * k)
    }

    pub fn dot(self, b: Vec2) -> f64 {
        self.x * b.x + self.y * b.y
    }

    /// Turns clockwise as seen by the viewer, since y points down.
    pub fn rotate(self, degrees: f64) -> Vec2 {
        let r = degrees.to_radians();
        let (s, c) = (r.sin(), r.cos());
        v(self.x * c - self.y * s, self.x * s + self.y * c)
    }
}

pub(crate) fn rect_poly(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Vec2> {
    vec![v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)]
}

/// An outline's corners on a flag w wide and h high, or None if it's curved.
pub(crate) fn outline_points(o: &Outline, w: f64, h: f64) -> Option<Vec<Vec2>> {
    match o.kind.as_str() {
        "polygon" => Some(o.vertices.iter().map(|p| v(p.fly, p.hoist)).collect()),
        "swallowtail" => Some(vec![
            v(0.0, 0.0),
            v(w, o.taper),
            v(w - o.depth, h / 2.0),
            v(w, h - o.taper),
            v(0.0, h),
        ]),
        "tongued" => {
            let a = (h - o.tongue) / 2.0;
            Some(vec![
                v(0.0, 0.0),
                v(w, 0.0),
                v(w - o.depth, a),
                v(w, h / 2.0),
                v(w - o.depth, h - a),
                v(w, h),
                v(0.0, h),
            ])
        }
        "pennant" => {
            let a = (h - o.tip) / 2.0;
            if o.tip == 0.0 {
                return Some(vec![v(0.0, 0.0), v(w, h / 2.0), v(0.0, h)]);
            }
            Some(vec![v(0.0, 0.0), v(w, a), v(w, h - a), v(0.0, h)])
        }
        _ => None,
    }
}

/// The flag's shape before any outside border, or None for a curved outline.
pub(crate) fn boundary(f: &Doc) -> Option<Vec<Vec2>> {
    match &f.outline {
        None => Some(rect_poly(0.0, 0.0, f.fly, f.hoist)),
        Some(o) => outline_points(o, f.fly, f.hoist),
    }
}

/// Moves a polygon's edges outward by a distance, keeping its angles mitered. It fails on
/// polygons with no area, repeated points or edges that fold back on themselves, where outward
/// has no meaning.
pub(crate) fn offset_polygon(poly: &[Vec2], distance: f64) -> Result<Vec<Vec2>, String> {
    let n = poly.len();
    let mut area = 0.0;
    for i in 0..n {
        let (p, q) = (poly[i], poly[(i + 1) % n]);
        area += p.x * q.y - q.x * p.y;
    }
    if area == 0.0 {
        return Err("shape has no area, so it can't have an outside border".into());
    }
    let side = if area < 0.0 { -1.0 } else { 1.0 };
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let p = poly[i];
        let n1 = normal(poly[(i + n - 1) % n], p, side);
        let n2 = normal(p, poly[(i + 1) % n], side);
        let (Some(n1), Some(n2)) = (n1, n2) else {
            return Err("shape repeats a point, so it can't have an outside border".into());
        };
        let turn = 1.0 + n1.dot(n2);
        if turn < 1e-9 {
            return Err("shape folds back on itself, so it can't have an outside border".into());
        }
        out.push(p.add(n1.add(n2).mul(distance / turn)));
    }
    Ok(out)
}

fn normal(a: Vec2, b: Vec2, side: f64) -> Option<Vec2> {
    let l = (b.x - a.x).hypot(b.y - a.y);
    if l == 0.0 {
        return None;
    }
    Some(v(side * (b.y - a.y) / l, -side * (b.x - a.x) / l))
}

pub(crate) fn poly_area(poly: &[Vec2]) -> f64 {
    let n = poly.len();
    let mut sum = 0.0;
    for i in 0..n {
        let (p, q) = (poly[i], poly[(i + 1) % n]);
        sum += p.x * q.y - q.x * p.y;
    }
    sum.abs() / 2.0
}

/// Maps (x, y) to (a*x + c*y + e, b*x + d*y + f), as SVG writes it.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Matrix {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl Matrix {
    pub const IDENTITY: Matrix = Matrix {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        e: 0.0,
        f: 0.0,
    };

    pub fn new(a: f64, b: f64, c: f64, d: f64, e: f64, f: f64) -> Matrix {
        Matrix { a, b, c, d, e, f }
    }

    pub fn apply(&self, p: Vec2) -> Vec2 {
        v(
            self.a * p.x + self.c * p.y + self.e,
            self.b * p.x + self.d * p.y + self.f,
        )
    }

    /// The transform that applies this, followed by n.
    pub fn then(&self, n: &Matrix) -> Matrix {
        Matrix::new(
            n.a * self.a + n.c * self.b,
            n.b * self.a + n.d * self.b,
            n.a * self.c + n.c * self.d,
            n.b * self.c + n.d * self.d,
            n.a * self.e + n.c * self.f + n.e,
            n.b * self.e + n.d * self.f + n.f,
        )
    }

    /// Reflects across the line through p and q.
    pub fn reflection(p: Vec2, q: Vec2) -> Matrix {
        let d = q.sub(p);
        let l = d.dot(d);
        let cos = (d.x * d.x - d.y * d.y) / l;
        let sin = 2.0 * d.x * d.y / l;
        Matrix::new(
            cos,
            sin,
            sin,
            -cos,
            p.x - cos * p.x - sin * p.y,
            p.y - sin * p.x + cos * p.y,
        )
    }
}

/// A flat piece of the folded flag. Its polygon is where it now lies, and its transform takes
/// the flag's coordinates there. Facets are kept from back to front, and flipped ones show the
/// flag's other side.
#[derive(Debug, Clone)]
pub(crate) struct Facet {
    pub poly: Vec<Vec2>,
    pub place: Matrix,
    pub flipped: bool,
}

/// Keeps the part of a polygon on one side of a line.
pub(crate) fn half_plane(poly: &[Vec2], a: Vec2, b: Vec2, side: f64) -> Vec<Vec2> {
    let d = b.sub(a);
    let n = poly.len();
    let mut out = Vec::new();
    for i in 0..n {
        let cur = poly[i];
        let prev = poly[(i + n - 1) % n];
        let vc = side * (d.x * (cur.y - a.y) - d.y * (cur.x - a.x));
        let vp = side * (d.x * (prev.y - a.y) - d.y * (prev.x - a.x));
        if (vc >= 0.0) != (vp >= 0.0) {
            out.push(prev.add(cur.sub(prev).mul(vp / (vp - vc))));
        }
        if vc >= 0.0 {
            out.push(cur);
        }
    }
    out
}

/// Folds a flat shape through a number of steps, or all of them if steps is 0.
pub(crate) fn fold_facets(shape: &[Vec2], fold: &Fold, steps: usize) -> Result<Vec<Facet>, String> {
    let mut stack = vec![Facet {
        poly: shape.to_vec(),
        place: Matrix::IDENTITY,
        flipped: false,
    }];
    let limit = poly_area(shape) * 1e-9;
    for (i, step) in fold.steps.iter().enumerate() {
        if steps > 0 && i == steps {
            break;
        }
        let a = v(step.a.fly, step.a.hoist);
        let b = v(step.b.fly, step.b.hoist);
        let moving = v(step.moving.fly, step.moving.hoist);
        let d = b.sub(a);
        let side = d.x * (moving.y - a.y) - d.y * (moving.x - a.x);
        if side == 0.0 || d.dot(d) == 0.0 {
            return Err(format!(
                "fold step {}: its point to move is on its crease",
                i + 1
            ));
        }
        let side = if side < 0.0 { -1.0 } else { 1.0 };
        let mirror = Matrix::reflection(a, b);
        let mut kept = Vec::new();
        let mut moved = Vec::new();
        for f in &stack {
            let part = half_plane(&f.poly, a, b, -side);
            if poly_area(&part) > limit {
                kept.push(Facet {
                    poly: part,
                    place: f.place,
                    flipped: f.flipped,
                });
            }
            let part = half_plane(&f.poly, a, b, side);
            if poly_area(&part) > limit {
                moved.push(Facet {
                    poly: part.iter().map(|&p| mirror.apply(p)).collect(),
                    place: f.place.then(&mirror),
                    flipped: !f.flipped,
                });
            }
        }
        if moved.is_empty() {
            return Err(format!(
                "fold step {}: nothing is on the side it moves",
                i + 1
            ));
        }
        if kept.is_empty() {
            return Err(format!(
                "fold step {}: nothing is left on the other side of its crease",
                i + 1
            ));
        }
        if kept.len() + moved.len() > limits::MAX_FACETS {
            return Err(format!(
                "fold step {}: makes more than {} pieces",
                i + 1,
                limits::MAX_FACETS
            ));
        }
        // Whichever way it goes, the moving stack lands in reverse order.
        moved.reverse();
        stack = match step.kind.as_str() {
            "over" => {
                kept.extend(moved);
                kept
            }
            "under" => {
                moved.extend(kept);
                moved
            }
            // A tuck goes inside the fold, out of sight.
            _ => kept,
        };
    }
    Ok(stack)
}

/// The flat shape a flag folds as, including an outside border.
pub(crate) fn fold_shape(f: &Doc) -> Result<Vec<Vec2>, String> {
    // A curved outline folds as its rectangle, with the flag's own clip inside.
    let shape = boundary(f).unwrap_or_else(|| rect_poly(0.0, 0.0, f.fly, f.hoist));
    if let Some(b) = &f.border
        && f.border_outside
    {
        return offset_polygon(&shape, b.width);
    }
    Ok(shape)
}
