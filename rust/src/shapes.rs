// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! Works out the polygons and paths that layers and shapes paint.

use std::f64::consts::PI;

use crate::geometry::{self, Vec2, v};
use crate::limits;
use crate::model::*;

/// A rectangle with its origin at the current coordinate origin. An emblem's frame has no size,
/// and its center is its origin; local is then how far its content could need to reach to cover
/// everything visible.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Region {
    pub w: f64,
    pub h: f64,
    pub local: f64,
}

impl Region {
    pub fn new(w: f64, h: f64) -> Region {
        Region { w, h, local: 0.0 }
    }

    /// The rectangle a mask has to cover.
    pub fn bounds(&self) -> [f64; 4] {
        if self.local > 0.0 {
            return [-self.local, -self.local, 2.0 * self.local, 2.0 * self.local];
        }
        [0.0, 0.0, self.w, self.h]
    }

    pub fn center(&self) -> Vec2 {
        v(self.w / 2.0, self.h / 2.0)
    }

    pub fn reach(&self) -> f64 {
        self.w.hypot(self.h)
    }

    pub fn corners(&self) -> [Vec2; 4] {
        [
            v(0.0, 0.0),
            v(self.w, 0.0),
            v(self.w, self.h),
            v(0.0, self.h),
        ]
    }
}

/// A shape resolved to coordinates.
#[derive(Debug, Clone, Default)]
pub(crate) struct Geom {
    pub circle: bool,
    pub ring: bool,
    pub c: Option<Vec2>,
    pub r: f64,
    pub inner: f64,
    pub poly: Vec<Vec2>,
    /// SVG path data, for shapes that polygons can't draw exactly.
    pub path: String,
    pub evenodd: bool,
    /// Places a path, whose scale strokes have to allow for.
    pub transform: String,
    pub scale: f64,
}

impl Geom {
    pub fn poly(poly: Vec<Vec2>) -> Geom {
        Geom {
            poly,
            ..Geom::default()
        }
    }

    pub fn path(d: String) -> Geom {
        Geom {
            path: d,
            ..Geom::default()
        }
    }

    pub fn stroke_scale(&self) -> f64 {
        if self.scale > 0.0 { self.scale } else { 1.0 }
    }
}

/// Formats a coordinate to a fixed precision, so output is stable and free of floating-point noise.
pub(crate) fn num(x: f64) -> String {
    let scaled = x * 1e6;
    if scaled.abs() < 9e18 {
        // Rounds half up, as Java's Math.round does.
        let l = (scaled + 0.5).floor() as i64;
        if l == 0 {
            return "0".into();
        }
        let negative = l < 0;
        let digits = l.unsigned_abs().to_string();
        let (whole, frac) = if digits.len() > 6 {
            digits.split_at(digits.len() - 6)
        } else {
            ("0", digits.as_str())
        };
        let frac = format!("{frac:0>6}");
        let frac = frac.trim_end_matches('0');
        let mut out = String::new();
        if negative {
            out.push('-');
        }
        out.push_str(whole);
        if !frac.is_empty() {
            out.push('.');
            out.push_str(frac);
        }
        return out;
    }
    format!("{:.0}", x)
}

/// Writes a scale, whose size says nothing about how many places it needs: a path drawn in a
/// box tens of thousands wide, on a grid of a few units, is scaled by a very small number.
pub(crate) fn factor(x: f64) -> String {
    if x == 0.0 {
        return "0".into();
    }
    // Ten significant digits, without an exponent.
    let s = format!("{:.9e}", x);
    let (mantissa, exp) = s.split_once('e').unwrap_or((&s, "0"));
    let exp: i32 = exp.parse().unwrap_or(0);
    let negative = mantissa.starts_with('-');
    let digits: String = mantissa.chars().filter(|c| c.is_ascii_digit()).collect();
    // digits has 10 figures, the first before the point at 10^exp.
    let point = exp + 1;
    let mut out = String::new();
    if negative {
        out.push('-');
    }
    if point <= 0 {
        out.push_str("0.");
        for _ in 0..(-point) {
            out.push('0');
        }
        out.push_str(&digits);
    } else if point as usize >= digits.len() {
        out.push_str(&digits);
        for _ in 0..(point as usize - digits.len()) {
            out.push('0');
        }
    } else {
        out.push_str(&digits[..point as usize]);
        out.push('.');
        out.push_str(&digits[point as usize..]);
    }
    if out.contains('.') {
        while out.ends_with('0') {
            out.pop();
        }
        if out.ends_with('.') {
            out.pop();
        }
    }
    out
}

pub(crate) fn bounds(poly: &[Vec2]) -> [f64; 4] {
    let (mut x0, mut y0) = (f64::INFINITY, f64::INFINITY);
    let (mut x1, mut y1) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in poly {
        x0 = x0.min(p.x);
        y0 = y0.min(p.y);
        x1 = x1.max(p.x);
        y1 = y1.max(p.y);
    }
    [x0, y0, x1 - x0, y1 - y0]
}

/// The direction of an axis, and the normal bars are listed along.
pub(crate) fn axis(r: &Region, along: &str, rotation: f64) -> (Vec2, Vec2) {
    let l = r.reach();
    let (dir, normal) = match along {
        "hoist" => (v(0.0, 1.0), v(1.0, 0.0)),
        "bend" => (v(r.w / l, r.h / l), v(r.h / l, -r.w / l)),
        "bend-sinister" => (v(r.w / l, -r.h / l), v(r.h / l, r.w / l)),
        _ => (v(1.0, 0.0), v(0.0, 1.0)),
    };
    (dir.rotate(rotation), normal.rotate(rotation))
}

#[derive(Clone, Copy)]
enum Edge {
    X(f64, bool),
    Y(f64, bool),
}

impl Edge {
    fn inside(self, p: Vec2) -> bool {
        match self {
            Edge::X(x, below) => {
                if below {
                    p.x <= x
                } else {
                    p.x >= x
                }
            }
            Edge::Y(y, below) => {
                if below {
                    p.y <= y
                } else {
                    p.y >= y
                }
            }
        }
    }

    fn cross(self, a: Vec2, b: Vec2) -> Vec2 {
        match self {
            Edge::X(x, _) => v(x, a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x)),
            Edge::Y(y, _) => v(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y), y),
        }
    }
}

/// Clips a convex polygon to a region (Sutherland-Hodgman).
pub(crate) fn clip_convex(poly: &[Vec2], r: &Region) -> Vec<Vec2> {
    let edges = [
        Edge::X(0.0, false),
        Edge::X(r.w, true),
        Edge::Y(0.0, false),
        Edge::Y(r.h, true),
    ];
    let mut poly = poly.to_vec();
    for e in edges {
        let n = poly.len();
        let mut out = Vec::with_capacity(n + 4);
        for i in 0..n {
            let cur = poly[i];
            let prev = poly[(i + n - 1) % n];
            let (inside, was) = (e.inside(cur), e.inside(prev));
            if inside && was {
                out.push(cur);
            } else if inside {
                out.push(e.cross(prev, cur));
                out.push(cur);
            } else if was {
                out.push(e.cross(prev, cur));
            }
        }
        poly = out;
    }
    poly
}

/// The region a layer's axis is measured in.
pub(crate) fn frame(f: &Option<FixedFrame>, r: &Region) -> Region {
    match f {
        None => *r,
        Some(f) => Region::new(f.w, f.h),
    }
}

/// The center a layer is drawn about.
pub(crate) fn frame_center(f: &Option<FixedFrame>, r: &Region) -> Vec2 {
    match f {
        None => r.center(),
        Some(f) => v(f.x, f.y),
    }
}

/// Far enough from a point to cross the whole region, wherever the point is.
pub(crate) fn reach_from(c: Vec2, r: &Region) -> f64 {
    let d = c.sub(r.center());
    r.reach() + d.x.hypot(d.y)
}

/// The rectangle between two offsets along normal.
pub(crate) fn strip_poly(
    c: Vec2,
    dir: Vec2,
    normal: Vec2,
    t0: f64,
    t1: f64,
    reach: f64,
) -> Vec<Vec2> {
    vec![
        c.add(normal.mul(t0)).sub(dir.mul(reach)),
        c.add(normal.mul(t0)).add(dir.mul(reach)),
        c.add(normal.mul(t1)).add(dir.mul(reach)),
        c.add(normal.mul(t1)).sub(dir.mul(reach)),
    ]
}

/// One polygon per bar. Each runs from its bar's start to the far side of the region, so the
/// next bar paints over it and antialiasing can't leave a seam showing what's beneath. A gradient
/// spans the shape it fills, so a bar for which exact is true stays its true width.
pub(crate) fn bar_polys(
    b: &Bars,
    r: &Region,
    exact: &dyn Fn(usize) -> bool,
) -> Result<Vec<Vec<Vec2>>, String> {
    let fr = frame(&b.fixed, r);
    let c = frame_center(&b.fixed, r);
    let (dir, normal) = axis(&fr, &b.along, b.rotate);
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for corner in r.corners() {
        let offset = corner.sub(c).dot(normal);
        lo = lo.min(offset);
        hi = hi.max(offset);
    }
    let total: f64 = b.ratio.iter().sum();
    let reach = reach_from(c, r);
    let mut polys = Vec::new();
    let mut t = lo;
    for i in 0..b.ratio.len() {
        let next = t + (hi - lo) * b.ratio[i] / total;
        let mut end = hi;
        let is_exact = exact(i);
        if is_exact {
            end = next;
        }
        let Some(line) = &b.line else {
            let (mut from, mut to) = (t, end);
            if b.rotate != 0.0 {
                // The outermost lines pass through corners, where rounding in the angle could
                // leave a sliver either side, so the outer ends reach well past the region.
                if i == 0 {
                    from -= reach;
                }
                if end == hi || i == b.ratio.len() - 1 {
                    to = hi + reach;
                }
            }
            polys.push(clip_convex(&strip_poly(c, dir, normal, from, to, reach), r));
            t = next;
            continue;
        };
        // A shaped edge isn't convex, so clipping is left to the region's own clip.
        let margin = line.depth + 1.0;
        let mut near = vec![
            c.add(normal.mul(lo - margin)).sub(dir.mul(reach)),
            c.add(normal.mul(lo - margin)).add(dir.mul(reach)),
        ];
        if i > 0 {
            near = wave_edge(c, dir, normal, t, axis_span(&fr, &b.along), reach, line)?;
        }
        let mut far = vec![
            c.add(normal.mul(hi + margin)).add(dir.mul(reach)),
            c.add(normal.mul(hi + margin)).sub(dir.mul(reach)),
        ];
        if is_exact && i < b.ratio.len() - 1 {
            far = wave_edge(c, dir, normal, next, axis_span(&fr, &b.along), reach, line)?;
            far.reverse();
        }
        near.extend(far);
        polys.push(near);
        t = next;
    }
    Ok(polys)
}

/// One polygon per color, from the outermost inward, which is the order they paint in.
pub(crate) fn chevron_polys(ch: &Chevrons, r: &Region) -> Vec<Vec<Vec2>> {
    raw_chevrons(ch, r)
        .0
        .iter()
        .map(|p| clip_convex(p, r))
        .collect()
}

/// Each chevron's polygon reaching well past the region, and each chevron alone between its apex
/// and the next, for when gaps have to show.
pub(crate) fn raw_chevrons(ch: &Chevrons, r: &Region) -> (Vec<Vec<Vec2>>, Vec<Vec<Vec2>>) {
    let (mut origin, u, vv, edge) = match ch.from.as_str() {
        "fly" => (v(r.w, r.h / 2.0), v(-1.0, 0.0), v(0.0, 1.0), r.h),
        "top" => (v(r.w / 2.0, 0.0), v(0.0, 1.0), v(1.0, 0.0), r.w),
        "bottom" => (v(r.w / 2.0, r.h), v(0.0, -1.0), v(1.0, 0.0), r.w),
        _ => (v(0.0, r.h / 2.0), v(1.0, 0.0), v(0.0, 1.0), r.h),
    };
    let mut reach = r.reach();
    if let Some(apex) = ch.apex {
        let shift = apex - edge / 2.0;
        origin = origin.add(vv.mul(shift));
        reach += shift.abs();
    }
    let mut run = ch.depth;
    if ch.angle != 0.0 {
        run = (edge / 2.0) / (ch.angle * PI / 180.0).tan();
    }
    let slope = run / (edge / 2.0);
    let total: f64 = ch.ratio.iter().sum();
    let mut apexes = Vec::with_capacity(ch.ratio.len());
    let mut sum = 0.0;
    for part in &ch.ratio {
        sum += part;
        apexes.push(ch.depth * sum / total);
    }
    let center = r.center();
    let place = |pu: f64, pv: f64| {
        let point = origin.add(u.mul(pu)).add(vv.mul(pv));
        center.add(point.sub(center).rotate(ch.rotate))
    };
    let mut nested = Vec::new();
    let mut bands = Vec::new();
    for i in (0..apexes.len()).rev() {
        let a = apexes[i];
        let arm_end = a - slope * reach;
        let back = arm_end.min(0.0) - reach;
        let poly = vec![
            place(a, 0.0),
            place(arm_end, reach),
            place(back, reach),
            place(back, -reach),
            place(arm_end, -reach),
        ];
        nested.push(poly.clone());
        if i == 0 {
            bands.push(poly);
            continue;
        }
        let inner = apexes[i - 1];
        let inner_end = inner - slope * reach;
        bands.push(vec![
            place(a, 0.0),
            place(arm_end, reach),
            place(inner_end, reach),
            place(inner, 0.0),
            place(inner_end, -reach),
            place(arm_end, -reach),
        ]);
    }
    (nested, bands)
}

/// A band's rectangle, clipped to the region unless it will be stroked.
pub(crate) fn band_poly(
    r: &Region,
    along: &str,
    rotation: f64,
    width: f64,
    offset: f64,
    stroked: bool,
) -> Vec<Vec2> {
    placed_band_poly(r, &None, along, rotation, width, offset, stroked)
}

pub(crate) fn placed_band_poly(
    r: &Region,
    fixed: &Option<FixedFrame>,
    along: &str,
    rotation: f64,
    width: f64,
    offset: f64,
    stroked: bool,
) -> Vec<Vec2> {
    let fr = frame(fixed, r);
    let c = frame_center(fixed, r);
    let (dir, normal) = axis(&fr, along, rotation);
    let poly = strip_poly(
        c,
        dir,
        normal,
        offset - width / 2.0,
        offset + width / 2.0,
        reach_from(c, r),
    );
    if stroked {
        return poly;
    }
    clip_convex(&poly, r)
}

/// A cross's vertical and horizontal arms, with their ends extended by a distance.
pub(crate) fn cross_polys(c: &Cross, r: &Region, extend: f64) -> [Vec<Vec2>; 2] {
    let [a, w, b] = c.fly_parts;
    let x0 = r.w * a / (a + w + b);
    let x1 = r.w * (a + w) / (a + w + b);
    let [d, h, e] = c.hoist_parts;
    let y0 = r.h * d / (d + h + e);
    let y1 = r.h * (d + h) / (d + h + e);
    [
        geometry::rect_poly(x0, -extend, x1, r.h + extend),
        geometry::rect_poly(-extend, y0, r.w + extend, y1),
    ]
}

pub(crate) fn position(s: &Shape, r: &Region) -> Vec2 {
    match &s.at {
        None => r.center(),
        Some(p) => v(p.fly, p.hoist),
    }
}

/// Resolves a shape at a center, with its rotation added to the extra.
pub(crate) fn shape_geom(s: &Shape, center: Vec2, extra: f64) -> Geom {
    let rotation = s.rotate + extra;
    let place = |p: Vec2| center.add(p.rotate(rotation));
    let place_all = |points: Vec<Vec2>| points.into_iter().map(place).collect::<Vec<_>>();
    match s.kind.as_str() {
        "disc" => Geom {
            circle: true,
            c: Some(center),
            r: s.radius,
            ..Geom::default()
        },
        "ring" => {
            if s.has_arc {
                return Geom::path(ring_arc_path(s, center, rotation));
            }
            Geom {
                ring: true,
                c: Some(center),
                r: s.radius,
                inner: s.inner,
                ..Geom::default()
            }
        }
        "rect" => {
            let (x, y) = (s.fly / 2.0, s.hoist / 2.0);
            Geom::poly(place_all(geometry::rect_poly(-x, -y, x, y)))
        }
        "plus" => {
            let (a, w) = (s.radius, s.width / 2.0);
            Geom::poly(place_all(vec![
                v(-w, -a),
                v(w, -a),
                v(w, -w),
                v(a, -w),
                v(a, w),
                v(w, w),
                v(w, a),
                v(-w, a),
                v(-w, w),
                v(-a, w),
                v(-a, -w),
                v(-w, -w),
            ]))
        }
        "triangle" => Geom::poly(place_all(star_points(3, s.radius, 0.0))),
        "star" => {
            if s.lines > 0.0 {
                return Geom::path(star_chords(s.points, s.radius, &place));
            }
            Geom::poly(place_all(star_points(s.points, s.radius, s.inner)))
        }
        "heart" => Geom::path(heart_path(s.radius, s.spread, &place)),
        "crescent" => Geom::path(crescent_path(s.radius, s.inner, s.offset, &place)),
        "sun" => Geom::path(sun_path(s, center, &place)),
        "lozenge" => {
            let (x, y) = (s.fly / 2.0, s.hoist / 2.0);
            Geom::poly(place_all(vec![
                v(0.0, -y),
                v(x, 0.0),
                v(0.0, y),
                v(-x, 0.0),
            ]))
        }
        "ellipse" => Geom::path(ellipse_path(center, s.fly / 2.0, s.hoist / 2.0, rotation)),
        "path" => path_geom(s, center, rotation),
        "cardioid" => Geom::poly(place_all(cardioid_points(s.radius))),
        "polygon" => Geom::poly(s.vertices.iter().map(|p| v(p.fly, p.hoist)).collect()),
        _ => Geom::default(),
    }
}

/// A heart with its lobes either side of the origin and its tip below, whose straight sides meet
/// at a right angle and touch the lobes.
fn heart_path(radius: f64, spread: f64, place: &dyn Fn(Vec2) -> Vec2) -> String {
    let half = spread / 2.0;
    let edge = radius / 2f64.sqrt();
    let tip = place(v(0.0, half + radius * 2f64.sqrt()));
    let right = place(v(half + edge, edge));
    let left = place(v(-half - edge, edge));
    let notch = place(v(0.0, -(radius * radius - half * half).sqrt()));
    // Each arc runs from 45 degrees below the lobe's side, around to the notch.
    let large = if 225.0 - (half / radius).acos() * 180.0 / PI > 180.0 {
        1
    } else {
        0
    };
    let r = num(radius);
    format!(
        "M{} {}L{} {}A{r} {r} 0 {large} 0 {} {}A{r} {r} 0 {large} 0 {} {}Z",
        num(tip.x),
        num(tip.y),
        num(right.x),
        num(right.y),
        num(notch.x),
        num(notch.y),
        num(left.x),
        num(left.y)
    )
}

/// Lays out n outer points clockwise from up. An inner radius of 0 gives a regular polygon.
pub(crate) fn star_points(n: usize, radius: f64, inner: f64) -> Vec<Vec2> {
    let mut points = Vec::new();
    let step = 360.0 / n as f64;
    for i in 0..n {
        let a = i as f64 * step;
        points.push(v(0.0, -radius).rotate(a));
        if inner > 0.0 {
            points.push(v(0.0, -inner).rotate(a + step / 2.0));
        }
    }
    points
}

/// Samples a cardioid with its cusp at the origin and its lobe below. 180 segments keep the error
/// under the format's tolerance for any radius up to the flag's hoist.
fn cardioid_points(radius: f64) -> Vec<Vec2> {
    let segments = 180;
    (0..segments)
        .map(|i| {
            let t = 2.0 * PI * i as f64 / segments as f64;
            let rho = radius * (1.0 - t.cos()) / 2.0;
            v(rho * t.sin(), -rho * t.cos())
        })
        .collect()
}

/// A disc with another cut from it, offset toward the fly.
fn crescent_path(radius: f64, inner: f64, offset: f64, place: &dyn Fn(Vec2) -> Vec2) -> String {
    let x = (radius * radius - inner * inner + offset * offset) / (2.0 * offset);
    let y = (radius * radius - x * x).max(0.0).sqrt();
    let top = place(v(x, -y));
    let bottom = place(v(x, y));
    let outer_large = if x > 0.0 { 1 } else { 0 };
    let inner_large = if x > offset { 1 } else { 0 };
    format!(
        "M{} {}A{} {} 0 {outer_large} 0 {} {}A{} {} 0 {inner_large} 1 {} {}Z",
        num(top.x),
        num(top.y),
        num(radius),
        num(radius),
        num(bottom.x),
        num(bottom.y),
        num(inner),
        num(inner),
        num(top.x),
        num(top.y)
    )
}

/// A disc and triangular rays, all wound the same way so that where they overlap stays filled.
fn sun_path(s: &Shape, center: Vec2, place: &dyn Fn(Vec2) -> Vec2) -> String {
    let mut b = circle_path(center, s.disc);
    let base = s.disc + s.gap;
    let step = 360.0 / s.points as f64;
    let half = step / 2.0 * s.spread;
    for i in 0..s.points {
        let a = i as f64 * step;
        let tip = place(v(0.0, -s.radius).rotate(a));
        let left = place(v(0.0, -base).rotate(a - half));
        let right = place(v(0.0, -base).rotate(a + half));
        b.push_str(&format!(
            " M{} {}L{} {}L{} {}Z",
            num(right.x),
            num(right.y),
            num(tip.x),
            num(tip.y),
            num(left.x),
            num(left.y)
        ));
    }
    b
}

/// Part of a ring, clockwise from one angle to another.
fn ring_arc_path(s: &Shape, center: Vec2, rotation: f64) -> String {
    let from = s.from + rotation;
    // Clockwise from one to the other, by less than a full turn.
    let to = from + (((s.to - s.from) % 360.0) + 360.0) % 360.0;
    let large = if to - from > 180.0 { 1 } else { 0 };
    let a = center.add(v(0.0, -s.radius).rotate(from));
    let b = center.add(v(0.0, -s.radius).rotate(to));
    let c = center.add(v(0.0, -s.inner).rotate(to));
    let d = center.add(v(0.0, -s.inner).rotate(from));
    format!(
        "M{} {}A{} {} 0 {large} 1 {} {}L{} {}A{} {} 0 {large} 0 {} {}Z",
        num(a.x),
        num(a.y),
        num(s.radius),
        num(s.radius),
        num(b.x),
        num(b.y),
        num(c.x),
        num(c.y),
        num(s.inner),
        num(s.inner),
        num(d.x),
        num(d.y)
    )
}

/// Joins a star's points by skipping one each time, which is one closed line for an odd number
/// of points and two for six, as on a hexagram.
fn star_chords(n: usize, radius: f64, place: &dyn Fn(Vec2) -> Vec2) -> String {
    let mut seen = vec![false; n];
    let mut b = String::new();
    for start in 0..n {
        if seen[start] {
            continue;
        }
        let p = place(v(0.0, -radius).rotate(start as f64 * 360.0 / n as f64));
        b.push_str(&format!("M{} {}", num(p.x), num(p.y)));
        let mut i = (start + 2) % n;
        while i != start {
            seen[i] = true;
            let p = place(v(0.0, -radius).rotate(i as f64 * 360.0 / n as f64));
            b.push_str(&format!("L{} {}", num(p.x), num(p.y)));
            i = (i + 2) % n;
        }
        seen[start] = true;
        b.push('Z');
    }
    b
}

/// Fits a path's box within a size, keeping its shape, centered on a point.
fn path_geom(s: &Shape, center: Vec2, rotation: f64) -> Geom {
    let mut scale = f64::INFINITY;
    if s.fly > 0.0 {
        scale = s.fly / s.bx[2];
    }
    if s.hoist > 0.0 {
        scale = scale.min(s.hoist / s.bx[3]);
    }
    let mut transform = format!("translate({} {})", num(center.x), num(center.y));
    if rotation != 0.0 {
        transform.push_str(&format!(" rotate({})", num(rotation)));
    }
    transform.push_str(&format!(
        " scale({}) translate({} {})",
        factor(scale),
        num(-s.bx[0] - s.bx[2] / 2.0),
        num(-s.bx[1] - s.bx[3] / 2.0)
    ));
    Geom {
        path: s.d.clone(),
        transform,
        scale,
        evenodd: s.even_odd,
        ..Geom::default()
    }
}

pub(crate) fn circle_path(c: Vec2, radius: f64) -> String {
    let rs = num(radius);
    format!(
        "M{} {}A{rs} {rs} 0 1 0 {} {}A{rs} {rs} 0 1 0 {} {}Z",
        num(c.x - radius),
        num(c.y),
        num(c.x + radius),
        num(c.y),
        num(c.x - radius),
        num(c.y)
    )
}

/// An ellipse with the given half sizes, turned clockwise by a rotation.
fn ellipse_path(c: Vec2, x: f64, y: f64, rotation: f64) -> String {
    let a = c.sub(v(x, 0.0).rotate(rotation));
    let b = c.add(v(x, 0.0).rotate(rotation));
    let arc = format!("A{} {} {} 1 0", num(x), num(y), num(rotation));
    format!(
        "M{} {}{arc} {} {}{arc} {} {}Z",
        num(a.x),
        num(a.y),
        num(b.x),
        num(b.y),
        num(a.x),
        num(a.y)
    )
}

/// Fills in what a shape takes from the region it's in.
pub(crate) fn for_region(s: &Shape, r: &Region) -> Shape {
    match s.kind.as_str() {
        "lozenge" => {
            let mut out = s.clone();
            if out.fly == 0.0 {
                out.fly = r.w;
            }
            if out.hoist == 0.0 {
                out.hoist = r.h;
            }
            out
        }
        "pile" => {
            let mut out = s.clone();
            out.kind = "polygon".into();
            out.vertices = pile_points(s, r);
            out
        }
        "pall" => {
            let mut out = s.clone();
            out.kind = "polygon".into();
            out.vertices = pall_points(s, r);
            out
        }
        _ => s.clone(),
    }
}

fn edge_place(edge: &str, r: &Region, inward: f64, along: f64) -> Point {
    match edge {
        "fly" => Point::new(r.w - inward, along),
        "top" => Point::new(along, inward),
        "bottom" => Point::new(along, r.h - inward),
        _ => Point::new(inward, along),
    }
}

fn edge_length(edge: &str, r: &Region) -> f64 {
    if edge == "top" || edge == "bottom" {
        r.w
    } else {
        r.h
    }
}

/// Continues a pile's sides back past its edge, so that fimbriation doesn't run along the flag's edge.
fn pile_points(s: &Shape, r: &Region) -> Vec<Point> {
    let place = |inward, along| edge_place(&s.edge, r, inward, along);
    let length = edge_length(&s.edge, r);
    let (a, b) = match s.base {
        Some([a, b]) => (a, b),
        None => (0.0, length),
    };
    let (mut depth, mut along) = (s.depth, (a + b) / 2.0);
    if let Some([t0, t1]) = s.tip {
        along = t0;
        depth = t1;
    }
    let lo = along - s.flat / 2.0;
    let hi = along + s.flat / 2.0;
    let back = r.reach();
    let back_a = a - (lo - a) * back / depth;
    let back_b = b + (b - hi) * back / depth;
    vec![
        place(-back, back_a),
        place(depth, lo),
        place(depth, hi),
        place(-back, back_b),
    ]
}

/// Outlines a Y whose arms run from the corners of its edge to a junction, then on as one stem.
fn pall_points(s: &Shape, r: &Region) -> Vec<Point> {
    let length = edge_length(&s.edge, r);
    let far = if s.edge == "top" || s.edge == "bottom" {
        r.h
    } else {
        r.w
    };
    let junction = if s.junction == 0.0 {
        length / 2.0
    } else {
        s.junction
    };
    let half = s.width / 2.0;
    let mid = length / 2.0;
    let reach = r.reach() + s.width;
    let l = junction.hypot(mid);
    let dir_in = junction / l;
    let dir_along = mid / l;
    // The upper arm runs along (dirIn, dirAlong) from the corner at along=0 to the junction,
    // in coordinates of (in, along from the center line).
    let normal_in = dir_along;
    let normal_along = -dir_in;
    let line = |offset: f64, target_along: f64| {
        // Where the arm's edge at an offset reaches a distance from the center line.
        let start_in = normal_in * offset;
        let start_along = -mid + normal_along * offset;
        start_in + (target_along - start_along) * dir_in / dir_along
    };
    let shoulder = line(half, -half);
    let notch = line(-half, 0.0);
    let far_outer_in = normal_in * half - dir_in * reach;
    let far_outer_along = -mid + normal_along * half - dir_along * reach;
    let far_inner_in = -normal_in * half - dir_in * reach;
    let far_inner_along = -mid - normal_along * half - dir_along * reach;
    let at = |inward: f64, from_center: f64| edge_place(&s.edge, r, inward, mid + from_center);
    vec![
        at(far_outer_in, far_outer_along),
        at(shoulder, -half),
        at(far + reach, -half),
        at(far + reach, half),
        at(shoulder, half),
        at(far_outer_in, -far_outer_along),
        at(far_inner_in, -far_inner_along),
        at(notch, 0.0),
        at(far_inner_in, far_inner_along),
    ]
}

/// Resolves an outline for painting and clipping.
pub(crate) fn outline_geom(o: &Outline, w: f64, h: f64) -> Geom {
    if o.kind != "path" {
        return Geom::poly(geometry::outline_points(o, w, h).unwrap_or_default());
    }
    // A flag's own curved outline is stretched to its box.
    let sx = w / o.bx[2];
    let sy = h / o.bx[3];
    Geom {
        path: o.d.clone(),
        scale: 1.0,
        transform: format!(
            "scale({} {}) translate({} {})",
            factor(sx),
            factor(sy),
            num(-o.bx[0]),
            num(-o.bx[1])
        ),
        ..Geom::default()
    }
}

/// Samples a wavy or zigzag line along a span, as distances along it and displacements from it.
pub(crate) fn line_points(l: &Line, span: f64) -> Result<(Vec<f64>, Vec<f64>), String> {
    let mut period = l.period;
    if l.count > 0 {
        period = span / l.count as f64;
    }
    if span / period > limits::MAX_COPIES as f64 {
        return Err(format!(
            "a shaped edge can't have more than {} waves",
            limits::MAX_COPIES
        ));
    }
    let half = l.depth / 2.0;
    let mut along = Vec::new();
    let mut offset = Vec::new();
    if l.kind == "zigzag" {
        let mut sign = -1.0;
        let mut s = 0.0;
        while s <= span + period / 4.0 {
            along.push(s);
            offset.push(sign * half);
            sign = -sign;
            s += period / 2.0;
        }
    } else {
        let per_wave = 24.0;
        let mut s = 0.0;
        while s <= span + period / per_wave / 2.0 {
            along.push(s);
            offset.push(half * (2.0 * PI * s / period).sin());
            s += period / per_wave;
        }
    }
    Ok((along, offset))
}

/// A shaped line across a region, at offset t along normal, continued flat past the region.
#[allow(clippy::too_many_arguments)]
pub(crate) fn wave_edge(
    c: Vec2,
    dir: Vec2,
    normal: Vec2,
    t: f64,
    span: f64,
    reach: f64,
    l: &Line,
) -> Result<Vec<Vec2>, String> {
    let (along, offset) = line_points(l, span)?;
    let mut points = Vec::with_capacity(along.len() + 2);
    points.push(c.add(normal.mul(t + offset[0])).sub(dir.mul(reach)));
    for i in 0..along.len() {
        points.push(
            c.add(normal.mul(t + offset[i]))
                .add(dir.mul(along[i] - span / 2.0)),
        );
    }
    points.push(
        c.add(normal.mul(t + offset[offset.len() - 1]))
            .add(dir.mul(reach)),
    );
    Ok(points)
}

/// How far an axis runs across a region.
pub(crate) fn axis_span(r: &Region, along: &str) -> f64 {
    match along {
        "fly" => r.w,
        "hoist" => r.h,
        _ => r.reach(),
    }
}

/// One wedge per color, each with an angle under 180 degrees or split so that it clips cleanly.
pub(crate) fn ray_polys(l: &Rays, r: &Region) -> Vec<Vec<Vec2>> {
    let (apex, from, sweep, walk) = ray_frame(l, r);
    if l.by_edge {
        return ray_polys_by_edge(l, r, apex, &walk);
    }
    let from = from + l.rotate;
    let total: f64 = l.ratio.iter().sum();
    let reach = r.reach() + (apex.x - r.w / 2.0).hypot(apex.y - r.h / 2.0);
    let mut polys = Vec::new();
    let mut a = from;
    for part in &l.ratio {
        let width = sweep * part / total;
        let steps = (width / 60.0).ceil() as usize;
        let mut poly = vec![apex];
        for i in 0..=steps {
            poly.push(apex.add(v(0.0, -reach * 2.0).rotate(a + width * i as f64 / steps as f64)));
        }
        polys.push(clip_convex(&poly, r));
        a += width;
    }
    polys
}

/// Shares the region's far edges out by length, going clockwise.
fn ray_polys_by_edge(l: &Rays, r: &Region, apex: Vec2, path: &[Vec2]) -> Vec<Vec<Vec2>> {
    let mut length = 0.0;
    for i in 1..path.len() {
        length += (path[i].x - path[i - 1].x).hypot(path[i].y - path[i - 1].y);
    }
    let total: f64 = l.ratio.iter().sum();
    // From outside the region, a wedge would cover what's between the point and the region.
    let outside = apex.x < 0.0 || apex.x > r.w || apex.y < 0.0 || apex.y > r.h;
    let mut polys = Vec::new();
    let mut leg = 0;
    let mut into = 0.0;
    let mut at = path[0];
    for part in &l.ratio {
        let mut remaining = length * part / total;
        let mut poly = vec![apex, at];
        while remaining > 1e-9 && leg < path.len() - 1 {
            let next = path[leg + 1];
            let leg_length = (next.x - path[leg].x).hypot(next.y - path[leg].y);
            let left = leg_length - into;
            if remaining < left {
                into += remaining;
                at = path[leg].add(next.sub(path[leg]).mul(into / leg_length));
                remaining = 0.0;
                break;
            }
            remaining -= left;
            at = next;
            poly.push(at);
            leg += 1;
            into = 0.0;
        }
        if remaining == 0.0 {
            poly.push(at);
        }
        if outside {
            poly = clip_convex(&poly, r);
        }
        polys.push(poly);
    }
    polys
}

/// Where rays start: a named point, or one given by position.
fn ray_point(l: &Rays, r: &Region) -> Vec2 {
    if let Some(at) = &l.at {
        return v(at.fly, at.hoist);
    }
    match l.from.as_str() {
        "upper-hoist" => v(0.0, 0.0),
        "lower-hoist" => v(0.0, r.h),
        "upper-fly" => v(r.w, 0.0),
        "lower-fly" => v(r.w, r.h),
        "hoist" => v(0.0, r.h / 2.0),
        "fly" => v(r.w, r.h / 2.0),
        "top" => v(r.w / 2.0, 0.0),
        "bottom" => v(r.w / 2.0, r.h),
        _ => r.center(),
    }
}

/// Where rays start, the angle they cover going clockwise from up, and the region's far edges,
/// which are the ones the point is inside of, walked clockwise.
fn ray_frame(l: &Rays, r: &Region) -> (Vec2, f64, f64, Vec<Vec2>) {
    let apex = ray_point(l, r);
    let corners = r.corners();
    // Edge i runs clockwise from corner i: the top, the fly, the bottom and the hoist.
    let inward = [v(0.0, 1.0), v(-1.0, 0.0), v(0.0, -1.0), v(1.0, 0.0)];
    let mut far = [false; 4];
    for i in 0..4 {
        far[i] = apex.sub(corners[i]).dot(inward[i]) > 0.0;
    }
    let mut first = None;
    for i in 0..4 {
        if far[i] && !far[(i + 3) % 4] {
            first = Some(i);
        }
    }
    let Some(first) = first else {
        // Every edge is far, so the point is inside, and the rays go all the way round from up.
        let top = v(apex.x, 0.0);
        return (
            apex,
            0.0,
            360.0,
            vec![top, corners[1], corners[2], corners[3], corners[0], top],
        );
    };
    let mut walk = vec![corners[first]];
    let mut i = first;
    while far[i % 4] {
        walk.push(corners[(i + 1) % 4]);
        i += 1;
    }
    let from = bearing(walk[0].sub(apex));
    let sweep = (bearing(walk[walk.len() - 1].sub(apex)) - from + 360.0) % 360.0;
    (apex, from, sweep, walk)
}

/// A direction's angle clockwise from up, exactly for the four straight ones.
fn bearing(d: Vec2) -> f64 {
    if d.x == 0.0 && d.y < 0.0 {
        return 0.0;
    }
    if d.y == 0.0 && d.x > 0.0 {
        return 90.0;
    }
    if d.x == 0.0 && d.y > 0.0 {
        return 180.0;
    }
    if d.y == 0.0 && d.x < 0.0 {
        return 270.0;
    }
    (d.x.atan2(-d.y) * 180.0 / PI + 360.0) % 360.0
}

/// A panel's place in its parent, in the parent's coordinates.
pub(crate) fn panel_rect(p: &Panel, r: &Region) -> [f64; 4] {
    let extra = p.line.as_ref().map_or(0.0, |l| l.depth / 2.0);
    match p.side.as_str() {
        "hoist" => return [0.0, 0.0, p.width + extra, r.h],
        "fly" => return [r.w - p.width - extra, 0.0, p.width + extra, r.h],
        "top" => return [0.0, 0.0, r.w, p.width + extra],
        "bottom" => return [0.0, r.h - p.width - extra, r.w, p.width + extra],
        _ => {}
    }
    match p.corner.as_str() {
        "upper-hoist" => return [0.0, 0.0, p.fly, p.hoist],
        "upper-fly" => return [r.w - p.fly, 0.0, p.fly, p.hoist],
        "lower-hoist" => return [0.0, r.h - p.hoist, p.fly, p.hoist],
        "lower-fly" => return [r.w - p.fly, r.h - p.hoist, p.fly, p.hoist],
        _ => {}
    }
    let at = match &p.at {
        Some(a) => v(a.fly, a.hoist),
        None => r.center(),
    };
    [at.x - p.fly / 2.0, at.y - p.hoist / 2.0, p.fly, p.hoist]
}

/// A panel's outline when it has a shaped edge, in its own coordinates. A line whose last point
/// falls short of the side's end runs on flat to it, as one between bars does.
pub(crate) fn panel_edge(p: &Panel, w: f64, h: f64) -> Result<Vec<Vec2>, String> {
    let line = p.line.as_ref().expect("a shaped edge");
    let span = if p.side == "hoist" || p.side == "fly" {
        h
    } else {
        w
    };
    let (mut along, mut offset) = line_points(line, span)?;
    let last = along.len() - 1;
    if span - along[last] > 1e-9 * span {
        along.push(span);
        offset.push(offset[last]);
    }
    let half = line.depth / 2.0;
    let mut points = Vec::new();
    match p.side.as_str() {
        "hoist" => {
            points.push(v(0.0, 0.0));
            for i in 0..along.len() {
                points.push(v(w - half + offset[i], along[i]));
            }
            points.push(v(0.0, h));
        }
        "fly" => {
            points.push(v(w, 0.0));
            for i in 0..along.len() {
                points.push(v(half - offset[i], along[i]));
            }
            points.push(v(w, h));
        }
        "top" => {
            points.push(v(0.0, 0.0));
            for i in 0..along.len() {
                points.push(v(along[i], h - half + offset[i]));
            }
            points.push(v(w, 0.0));
        }
        _ => {
            points.push(v(0.0, h));
            for i in 0..along.len() {
                points.push(v(along[i], half - offset[i]));
            }
            points.push(v(w, h));
        }
    }
    Ok(points)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_numbers() {
        assert_eq!(num(0.0), "0");
        assert_eq!(num(1.5), "1.5");
        assert_eq!(num(-0.0000004), "0");
        assert_eq!(num(-2.25), "-2.25");
        assert_eq!(num(1234567.1234567), "1234567.123457");
        assert_eq!(num(0.00001), "0.00001");
        assert_eq!(factor(0.000012345678912345), "0.00001234567891");
        assert_eq!(factor(2.0), "2");
        assert_eq!(factor(1234.5), "1234.5");
        assert_eq!(factor(-0.5), "-0.5");
        assert_eq!(factor(12345678901234.0), "12345678900000");
    }
}
