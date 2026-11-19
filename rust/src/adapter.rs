// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! Moves layers along one axis as their region changes size, as section 11 of the format says.

use std::sync::Arc;

use crate::geometry::{Vec2, v};
use crate::model::*;
use crate::shapes::{self, Region};
use crate::value;

struct Adapter {
    /// fly or hoist.
    axis: &'static str,
    anchor: &'static str,
    /// An anchor that a container passed on to its layers, if one did.
    passed: String,
    /// Says that the layers are a reverse's own, with the hoist on the right.
    from_behind: bool,
    /// The region's size across the axis, which stays the same.
    other: f64,
    err: Option<String>,
}

/// The flag at another proportion, as fly divided by hoist, following its adapt rules, or None
/// if that's its own.
pub(crate) fn with_ratio(f: &Doc, ratio: f64) -> Result<Option<Doc>, String> {
    let current = f.fly / f.hoist;
    if (ratio - current).abs() < 1e-9 * current {
        return Ok(None);
    }
    let Some(adapt) = &f.adapt else {
        return Err(format!(
            "{} doesn't say how it adapts to other proportions",
            f.meta.name
        ));
    };
    if (adapt.min > 0.0 && ratio < adapt.min) || (adapt.max > 0.0 && ratio > adapt.max) {
        return Err(format!(
            "{} only adapts between ratios of {} and {}",
            f.meta.name,
            value::number(adapt.min),
            value::number(adapt.max)
        ));
    }
    let mode = if ratio > current {
        &adapt.wider
    } else {
        &adapt.narrower
    };
    if mode.is_empty() {
        return Err(format!(
            "{} has no rule for this direction of change",
            f.meta.name
        ));
    }
    let mut out = f.clone();
    let on_hoist = mode.starts_with("hoist-");
    let base = mode.strip_prefix("hoist-").unwrap_or(mode);
    let anchor = match base {
        "center" => "center",
        "scale" => "scale",
        _ => "start",
    };
    let mut a = Adapter {
        axis: if on_hoist { "hoist" } else { "fly" },
        anchor,
        passed: String::new(),
        from_behind: f.seen_from_behind,
        other: if on_hoist { f.fly } else { f.hoist },
        err: None,
    };
    if on_hoist {
        out.hoist = f.fly / ratio;
        out.layers = a.layers(&f.layers, f.hoist, out.hoist);
    } else {
        out.fly = f.hoist * ratio;
        out.layers = a.layers(&f.layers, f.fly, out.fly);
    }
    if let Some(o) = &f.outline
        && o.kind == "polygon"
    {
        // A silhouette has no sensible anchor, so a drawn one stretches with the flag.
        let mut o = o.clone();
        o.vertices = o
            .vertices
            .iter()
            .map(|p| Point::new(p.fly * out.fly / f.fly, p.hoist * out.hoist / f.hoist))
            .collect();
        out.outline = Some(o);
    }
    if let Some(e) = a.err {
        return Err(e);
    }
    Ok(Some(out))
}

/// The proportion closest to a target that the flag's rules allow.
pub(crate) fn nearest_ratio(f: &Doc, target: f64) -> f64 {
    let current = f.fly / f.hoist;
    let Some(adapt) = &f.adapt else {
        return current;
    };
    if (target > current && adapt.wider.is_empty())
        || (target < current && adapt.narrower.is_empty())
    {
        return current;
    }
    let mut target = target;
    if adapt.min > 0.0 {
        target = target.max(adapt.min);
    }
    if adapt.max > 0.0 {
        target = target.min(adapt.max);
    }
    target
}

/// Maps a position along the axis, by a layer's anchor.
fn move_by(x: f64, old: f64, now: f64, anchor: &str) -> f64 {
    match anchor {
        "center" => x + (now - old) / 2.0,
        "end" => x + now - old,
        "scale" => x * now / old,
        _ => x,
    }
}

/// How far a region reaches either side of a point, along a normal.
fn spread(r: &Region, c: Vec2, normal: Vec2) -> (f64, f64) {
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for corner in r.corners() {
        let offset = corner.sub(c).dot(normal);
        lo = lo.min(offset);
        hi = hi.max(offset);
    }
    (lo, hi)
}

impl Adapter {
    /// A layer's anchor: its own, or one passed on to it, or the rule's.
    fn anchor_of(&self, e: &Effects) -> String {
        let mut anchor = e.anchor.clone();
        if anchor.is_empty() {
            anchor = self.passed.clone();
        }
        if anchor.is_empty() {
            anchor = self.anchor.to_string();
        }
        if self.from_behind && self.axis == "fly" {
            // Seen from behind, the hoist is on the right, and start is still the hoist.
            if anchor == "start" {
                anchor = "end".into();
            } else if anchor == "end" {
                anchor = "start".into();
            }
        }
        anchor
    }

    /// Whether a layer was given an anchor.
    fn given(&self, e: &Effects) -> bool {
        !e.anchor.is_empty() || !self.passed.is_empty()
    }

    /// The region's center, for pinning what's there to an anchor.
    fn center(&self, old: f64) -> Point {
        if self.axis == "hoist" {
            return Point::new(self.other / 2.0, old / 2.0);
        }
        Point::new(old / 2.0, self.other / 2.0)
    }

    fn fail(&mut self, message: String) {
        if self.err.is_none() {
            self.err = Some(message);
        }
    }

    fn layers(&mut self, layers: &[Layer], old: f64, now: f64) -> Vec<Layer> {
        layers.iter().map(|l| self.layer(l, old, now)).collect()
    }

    /// Adapts a container's layers with its anchor, if it gives one.
    fn pass_on(&mut self, e: &Effects, layers: &[Layer], old: f64, now: f64) -> Vec<Layer> {
        let was = self.passed.clone();
        if !e.anchor.is_empty() {
            self.passed = e.anchor.clone();
        }
        let out = self.layers(layers, old, now);
        self.passed = was;
        out
    }

    fn point(&self, p: Option<Point>, old: f64, now: f64, anchor: &str) -> Option<Point> {
        let p = p?;
        if self.axis == "fly" {
            return Some(Point::new(move_by(p.fly, old, now, anchor), p.hoist));
        }
        Some(Point::new(p.fly, move_by(p.hoist, old, now, anchor)))
    }

    /// Moves a shape, which keeps its own form unless it's drawn from points. The center stays the
    /// center, so a charge there follows it unless anchored otherwise.
    fn shape(&self, input: &Shape, old: f64, now: f64, anchor: &str, explicit: bool) -> Shape {
        let mut s = input.clone();
        let k = now / old;
        if s.at.is_none() && explicit && anchor != "scale" && s.kind != "polygon" {
            s.at = Some(self.center(old));
        }
        s.at = self.point(s.at, old, now, anchor);
        s.ats = input
            .ats
            .iter()
            .map(|p| self.point(*p, old, now, anchor))
            .collect();
        s.vertices = input
            .vertices
            .iter()
            .map(|p| self.point(Some(*p), old, now, anchor).expect("a point"))
            .collect();
        if anchor == "scale" && matches!(s.kind.as_str(), "rect" | "lozenge" | "ellipse") {
            if self.axis == "fly" {
                s.fly *= k;
            } else {
                s.hoist *= k;
            }
        }
        // Piles and palls are set from their edge, so depths only change when scaling, and
        // positions along the edge move like any other.
        if s.kind == "pile" || s.kind == "pall" {
            let runs_along_axis = (s.edge == "hoist" || s.edge == "fly") == (self.axis == "fly");
            if runs_along_axis {
                if anchor == "scale" {
                    s.depth *= k;
                    s.junction *= k;
                    if let Some(t) = s.tip {
                        s.tip = Some([t[0], t[1] * k]);
                    }
                }
            } else {
                if let Some(b) = s.base {
                    s.base = Some([
                        move_by(b[0], old, now, anchor),
                        move_by(b[1], old, now, anchor),
                    ]);
                }
                if let Some(t) = s.tip {
                    s.tip = Some([move_by(t[0], old, now, anchor), t[1]]);
                }
            }
        }
        s
    }

    /// Copies a layer's effects with its clip and cuts moved, and gives its anchor.
    fn effects(&self, e: &Effects, old: f64, now: f64) -> (Effects, String) {
        let anchor = self.anchor_of(e);
        let mut c = e.clone();
        if let Some(clip) = &e.clip {
            c.clip = Some(self.shape(clip, old, now, &anchor, false));
        }
        c.cuts = e
            .cuts
            .iter()
            .map(|s| self.shape(s, old, now, &anchor, false))
            .collect();
        (c, anchor)
    }

    /// Shares a change in size across parts along the axis, by a layer's anchor.
    fn parts(&mut self, what: &str, parts: &[f64], old: f64, now: f64, anchor: &str) -> Vec<f64> {
        let total: f64 = parts.iter().sum();
        let mut out: Vec<f64> = parts.iter().map(|p| p * old / total).collect();
        let d = now - old;
        let last = out.len() - 1;
        let changed: Vec<usize> = match anchor {
            "start" => {
                out[last] += d;
                vec![last]
            }
            "end" => {
                out[0] += d;
                vec![0]
            }
            "center" => {
                out[0] += d / 2.0;
                out[last] += d / 2.0;
                vec![0, last]
            }
            _ => return parts.to_vec(),
        };
        for i in changed {
            self.keep(what, out[i], old);
        }
        out
    }

    /// Refuses a part that a change of size has brought to nothing, allowing for rounding.
    fn keep(&mut self, what: &str, part: f64, old: f64) {
        if part <= 1e-9 * old {
            self.fail(format!("{what} can't be cut to this proportion"));
        }
    }

    fn layer(&mut self, l: &Layer, old: f64, now: f64) -> Layer {
        let k = now / old;
        let (fx, anchor) = self.effects(&l.fx, old, now);
        let kind = match &l.kind {
            LayerKind::Bars(t) => {
                let mut c = t.clone();
                if t.rotate != 0.0 {
                    self.rotated_bars(&mut c, old, now, &anchor);
                } else if (self.axis == "fly") != (t.along == "hoist")
                    || t.along == "bend"
                    || t.along == "bend-sinister"
                {
                    // It runs across the axis, so it follows its region.
                } else {
                    let mut grown = false;
                    if let Some(grow) = &t.grow {
                        let total: f64 = t.ratio.iter().sum();
                        let weights: f64 = grow.iter().sum();
                        if weights > 0.0 {
                            c.ratio = (0..t.ratio.len())
                                .map(|i| t.ratio[i] * old / total + (now - old) * grow[i] / weights)
                                .collect();
                            for i in 0..t.ratio.len() {
                                if grow[i] > 0.0 {
                                    let part = c.ratio[i];
                                    self.keep("bars", part, old);
                                }
                            }
                            grown = true;
                        }
                    }
                    if !grown {
                        c.ratio = self.parts("bars", &t.ratio, old, now, &anchor);
                    }
                }
                LayerKind::Bars(c)
            }
            LayerKind::Chevrons(t) => {
                let mut c = t.clone();
                let along_axis = (t.from == "hoist" || t.from == "fly") == (self.axis == "fly");
                if along_axis && anchor == "scale" {
                    c.depth *= k;
                } else if !along_axis && let Some(apex) = t.apex {
                    c.apex = Some(move_by(apex, old, now, &anchor));
                }
                LayerKind::Chevrons(c)
            }
            LayerKind::Band(t) => {
                let mut c = t.clone();
                if t.rotate != 0.0 {
                    // It keeps its angle and width, and its center line moves like any position.
                    let before = self.regions(old, now).0;
                    let frame = shapes::frame(&t.fixed, &before);
                    let center = shapes::frame_center(&t.fixed, &before);
                    let normal = shapes::axis(&frame, &t.along, t.rotate).1;
                    let moved = self.move_vec(center.add(normal.mul(t.offset)), old, now, &anchor);
                    c.fixed = Some(FixedFrame {
                        w: frame.w,
                        h: frame.h,
                        x: moved.x,
                        y: moved.y,
                    });
                    c.offset = 0.0;
                } else {
                    let across = (self.axis == "fly" && t.along == "hoist")
                        || (self.axis == "hoist" && t.along == "fly");
                    if across {
                        match anchor.as_str() {
                            "start" => c.offset -= (now - old) / 2.0,
                            "end" => c.offset += (now - old) / 2.0,
                            "scale" => {
                                c.offset *= k;
                                c.width *= k;
                            }
                            _ => {}
                        }
                    }
                }
                LayerKind::Band(c)
            }
            LayerKind::Cross(t) => {
                let mut c = t.clone();
                if self.axis == "fly" {
                    let p = self.parts("a cross", &t.fly_parts, old, now, &anchor);
                    c.fly_parts = [p[0], p[1], p[2]];
                } else {
                    let p = self.parts("a cross", &t.hoist_parts, old, now, &anchor);
                    c.hoist_parts = [p[0], p[1], p[2]];
                }
                LayerKind::Cross(c)
            }
            LayerKind::Quarters(t) => {
                let mut c = t.clone();
                c.split = self.point(t.split, old, now, &anchor);
                LayerKind::Quarters(c)
            }
            LayerKind::Rays(t) => {
                let mut c = t.clone();
                c.at = self.point(t.at, old, now, &anchor);
                LayerKind::Rays(c)
            }
            LayerKind::Charge(t) => {
                let mut c = t.clone();
                c.shape = self.shape(&t.shape, old, now, &anchor, self.given(&l.fx));
                if let Some(r) = &t.repeat
                    && r.kind == "line"
                    && anchor == "scale"
                {
                    let mut r = r.clone();
                    if self.axis == "fly" {
                        r.fly *= k;
                    } else {
                        r.hoist *= k;
                    }
                    c.repeat = Some(r);
                }
                LayerKind::Charge(c)
            }
            LayerKind::Emblem(t) => {
                let mut c = t.clone();
                if c.at.is_none() && self.given(&l.fx) && anchor != "scale" {
                    // One at the center that's given an anchor is pinned to it, as a charge is.
                    c.at = Some(self.center(old));
                }
                c.at = self.point(c.at, old, now, &anchor);
                LayerKind::Emblem(c)
            }
            LayerKind::Group(t) => LayerKind::Group(Group {
                layers: self.pass_on(&l.fx, &t.layers, old, now),
            }),
            LayerKind::Panel(t) => LayerKind::Panel(self.panel(t, &l.fx, old, now, &anchor)),
            LayerKind::Use(t) => {
                let mut c = t.clone();
                if t.design.fly == 0.0 {
                    let d = Define {
                        shape: t.design.shape.clone(),
                        layers: self.pass_on(&l.fx, &t.design.layers, old, now),
                        fly: t.design.fly,
                        hoist: t.design.hoist,
                        size: t.design.size,
                        height: t.design.height,
                    };
                    c.design = Arc::new(d);
                }
                LayerKind::Use(c)
            }
            // A field, saltire or checks follows its region.
            other => other.clone(),
        };
        Layer { fx, kind }
    }

    /// The regions before and after the change.
    fn regions(&self, old: f64, now: f64) -> (Region, Region) {
        if self.axis == "hoist" {
            return (Region::new(self.other, old), Region::new(self.other, now));
        }
        (Region::new(old, self.other), Region::new(now, self.other))
    }

    /// Moves a point along the axis, by a layer's anchor.
    fn move_vec(&self, p: Vec2, old: f64, now: f64, anchor: &str) -> Vec2 {
        if self.axis == "hoist" {
            return v(p.x, move_by(p.y, old, now, anchor));
        }
        v(move_by(p.x, old, now, anchor), p.y)
    }

    /// Keeps a rotated bars' angle, and the lines between its bars where they were about its center,
    /// which moves like any position. The first and last bars reach the new region's corners.
    fn rotated_bars(&mut self, c: &mut Bars, old: f64, now: f64, anchor: &str) {
        let (before, after) = self.regions(old, now);
        let frame = shapes::frame(&c.fixed, &before);
        let center = shapes::frame_center(&c.fixed, &before);
        let normal = shapes::axis(&frame, &c.along, c.rotate).1;
        let moved = self.move_vec(center, old, now, anchor);
        let (lo, hi) = spread(&before, center, normal);
        let will = spread(&after, moved, normal);
        let total: f64 = c.ratio.iter().sum();
        let n = c.ratio.len();
        let mut ratio = vec![0.0; n];
        let mut line = lo;
        let mut start = will.0;
        for i in 0..n {
            line += (hi - lo) * c.ratio[i] / total;
            let end = if i == n - 1 { will.1 } else { line };
            ratio[i] = end - start;
            start = end;
        }
        self.keep("bars", ratio[0], old);
        self.keep("bars", ratio[n - 1], old);
        c.ratio = ratio;
        c.fixed = Some(FixedFrame {
            w: frame.w,
            h: frame.h,
            x: moved.x,
            y: moved.y,
        });
    }

    /// Keeps a panel at its edge or corner. One running along the axis grows with its parent, and
    /// only scaling changes the size of any other.
    fn panel(&mut self, t: &Panel, fx: &Effects, old: f64, now: f64, anchor: &str) -> Panel {
        let k = now / old;
        let mut c = t.clone();
        if t.side.is_empty()
            && t.corner.is_empty()
            && c.at.is_none()
            && self.given(fx)
            && anchor != "scale"
        {
            // One at the center that's given an anchor is pinned to it, as a charge is.
            c.at = Some(self.center(old));
        }
        c.at = self.point(c.at, old, now, anchor);
        let runs_along = (self.axis == "fly" && (t.side == "top" || t.side == "bottom"))
            || (self.axis == "hoist" && (t.side == "hoist" || t.side == "fly"));
        let outer = self.other;
        let was = self.passed.clone();
        if !fx.anchor.is_empty() {
            self.passed = fx.anchor.clone();
        }
        if runs_along {
            self.other = t.width;
            c.layers = self.layers(&t.layers, old, now);
        } else if anchor == "scale" {
            // Everything inside is measured against the panel's own size along the axis.
            let mut size = t.fly;
            if !t.side.is_empty() {
                size = t.width;
                c.width *= k;
                self.other = outer;
            } else if self.axis == "fly" {
                self.other = t.hoist;
                c.fly *= k;
            } else {
                size = t.hoist;
                self.other = t.fly;
                c.hoist *= k;
            }
            c.layers = self.layers(&t.layers, size, size * k);
        }
        self.other = outer;
        self.passed = was;
        c
    }
}
