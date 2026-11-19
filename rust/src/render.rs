// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! Renders a flag as SVG, as section 6 of the format paints it.

use std::collections::HashMap;

use crate::adapter;
use crate::geometry::{self, Matrix, Vec2, v};
use crate::locate;
use crate::model::*;
use crate::parser::{NO_COLOR, quote};
use crate::sanitizer::local_id;
use crate::sha256;
use crate::shapes::{self, Geom, Region, factor, num};
use crate::value;
use crate::xml;
use crate::{Element, RenderOptions, TAG_ATTRIBUTE};

const NONE: &str = NO_COLOR;

type R<T> = Result<T, String>;

/// How a flag's back turns in a variant, so that it's the mirror image of the turned front.
fn reverse_turn(turn: &str) -> &'static str {
    match turn {
        "mirror" => "mirror",
        "half-turn" => "half-turn",
        "invert" => "invert",
        "transpose" => "anti-transpose",
        "anti-transpose" => "transpose",
        "rotate" => "counter-rotate",
        "counter-rotate" => "rotate",
        _ => "none",
    }
}

/// Refuses what would otherwise be silently ignored, or can't be drawn.
fn check_options(f: &Doc, opts: &RenderOptions) -> R<()> {
    if let Some(h) = opts.height
        && (h <= 0.0 || !crate::limits::in_limits(h))
    {
        return Err("height must be a positive number of a reasonable size".into());
    }
    if let Some(r) = opts.ratio
        && (r <= 0.0 || !crate::limits::in_limits(r))
    {
        return Err("ratio must be a positive number of a reasonable size".into());
    }
    if !opts.id_prefix.is_empty() && !local_id(&opts.id_prefix) {
        return Err(format!(
            "idPrefix {} isn't what an ID can start with",
            quote(&opts.id_prefix)
        ));
    }
    let mut has_ratio = opts.ratio.is_some();
    if !opts.variant.is_empty()
        && let Some(v) = f.variants.get(&opts.variant)
        && v.ratio != 0.0
    {
        has_ratio = true;
    }
    if !opts.fit.is_empty() && !has_ratio {
        return Err("fit says what to do about a ratio, and there isn't one".into());
    }
    if !opts.align.is_empty() && opts.fit != "pad" {
        return Err("align places a padded flag, so it needs a fit of pad".into());
    }
    if opts.fold.is_empty() {
        if opts.fold_step.is_some() {
            return Err("foldStep needs a fold".into());
        }
        return Ok(());
    }
    if opts.side == "reverse" {
        return Err("a fold shows both sides, so it can't be asked for the reverse".into());
    }
    if opts.fit == "pad" {
        return Err("a fold is cropped to its pieces, so it can't be padded".into());
    }
    if let Some(fold) = f.folds.get(&opts.fold)
        && let Some(step) = opts.fold_step
        && (step < 1 || step as usize > fold.steps.len())
    {
        return Err(format!("foldStep must be from 1 to {}", fold.steps.len()));
    }
    Ok(())
}

/// A flag with a side, a variant and a proportion applied, and how it's then shown.
struct Resolved {
    flag: Doc,
    turn: String,
    upright: bool,
    mirror: bool,
    /// The proportion to pad the result to, or 0.
    canvas: f64,
}

pub(crate) fn svg(original: &Doc, opts: &RenderOptions) -> R<String> {
    check_options(original, opts)?;
    let height = opts.height.unwrap_or(crate::DEFAULT_HEIGHT);
    let res = resolve(original, opts)?;
    let f = &res.flag;
    let mut r = Render::new(f, original.id_prefix.clone());
    if opts.tags {
        r.tagging = true;
        let (layers, border) = tag_scope(original, opts);
        r.scope_layers = layers;
        r.scope_border = border;
    }
    if !opts.id_prefix.is_empty() {
        r.id_prefix = opts.id_prefix.clone();
    } else if opts.ratio.is_some()
        || !opts.variant.is_empty()
        || !opts.side.is_empty()
        || !opts.fit.is_empty()
        || !opts.align.is_empty()
        || !opts.fold.is_empty()
        || opts.fold_step.is_some()
    {
        // A page can show several forms of one flag, which mustn't share definitions.
        let key = format!(
            "{}|{}|{}|{}|{}|{}|{}",
            value::number(opts.ratio.unwrap_or(0.0)),
            opts.variant,
            opts.side,
            opts.fit,
            opts.align,
            opts.fold,
            opts.fold_step.unwrap_or(0)
        );
        r.id_prefix.push_str(&format!(
            "{}-",
            sha256::hex(&sha256::digest(key.as_bytes()), 2)
        ));
    }
    if !opts.fold.is_empty() {
        let Some(fold) = f.folds.get(&opts.fold) else {
            return Err(format!("{} has no fold {}", f.meta.name, quote(&opts.fold)));
        };
        if res.turn != "none" {
            return Err("a fold can't be applied to a turned variant".into());
        }
        r.write_folded(f, fold, opts, height)?;
        return Ok(r.out);
    }
    let (mut x0, mut y0, mut width, mut tall) = (0.0, 0.0, f.fly, f.hoist);
    if let Some(b) = &f.border
        && f.border_outside
    {
        let shape = geometry::boundary(f).unwrap_or_default();
        let bx = shapes::bounds(&geometry::offset_polygon(&shape, b.width)?);
        x0 = bx[0];
        y0 = bx[1];
        width = bx[2];
        tall = bx[3];
    }
    let mut shown = res.turn.as_str();
    if opts.side == "reverse" {
        // Seen from behind, the turned flag is the mirror image of its front.
        shown = reverse_turn(&res.turn);
    }
    let (mut transform, mut undo) = view(shown, x0, y0, width, tall);
    if res.mirror {
        // The back is the mirror image of the front, then turned.
        transform = format!("{transform} matrix(-1 0 0 1 {} 0)", num(2.0 * x0 + width))
            .trim()
            .to_string();
        // A charge is put back the way it is on the back, which is the front's turn undone.
        undo = view(&res.turn, x0, y0, width, tall).1;
    }
    let (mut vx, mut vy, mut vw, mut vh) = (x0, y0, width, tall);
    let sideways = matches!(
        res.turn.as_str(),
        "rotate" | "counter-rotate" | "transpose" | "anti-transpose"
    );
    if sideways {
        vx = y0;
        vy = x0;
        vw = tall;
        vh = width;
    }
    if res.upright {
        r.upright = undo;
    }
    if res.canvas != 0.0 {
        // The canvas ratio is the design's, so a turned flag's is the other way up.
        let want = if sideways {
            1.0 / res.canvas
        } else {
            res.canvas
        };
        let share = match opts.align.as_str() {
            "start" => 0.0,
            "end" => 1.0,
            _ => 0.5,
        };
        if vw / vh < want {
            let extra = vh * want - vw;
            vx -= extra * share;
            vw += extra;
        } else {
            let extra = vw / want - vh;
            vy -= extra * share;
            vh += extra;
        }
    }
    r.line(&format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"{} {} {} {}\" width=\"{}\" height=\"{}\">",
        num(vx),
        num(vy),
        num(vw),
        num(vh),
        num(height * vw / vh),
        num(height)
    ));
    r.depth += 1;
    r.line(&format!("<title>{}</title>", xml::escape(&f.meta.name)));
    if !f.meta.description.is_empty() {
        r.line(&format!(
            "<desc>{}</desc>",
            xml::escape(&f.meta.description)
        ));
    }
    if !transform.is_empty() {
        r.line(&format!("<g transform=\"{transform}\">"));
        r.depth += 1;
    }
    r.flag_art(f)?;
    if !transform.is_empty() {
        r.depth -= 1;
        r.line("</g>");
    }
    r.depth -= 1;
    r.line("</svg>");
    Ok(r.out)
}

/// What starts the paths of a render's layers, and of its border.
fn tag_scope(f: &Doc, opts: &RenderOptions) -> (String, String) {
    let variant = if opts.variant.is_empty() {
        None
    } else {
        f.variants.get(&opts.variant)
    };
    let Some(v) = variant else {
        if opts.side == "reverse" && f.reverse.is_some() {
            return ("reverse/".into(), String::new());
        }
        return (String::new(), String::new());
    };
    let scope = format!("variant/{}/", locate::encode_name(&opts.variant));
    let mut layers = String::new();
    let mut border = String::new();
    if !v.layers.is_empty() {
        layers = scope.clone();
    } else if opts.side == "reverse" && f.reverse.is_some() {
        layers = "reverse/".into();
    }
    if v.border.is_some() {
        border = scope;
    }
    (layers, border)
}

/// How a variant turns a flag, as a transform and what undoes it for charges.
fn view(kind: &str, x0: f64, y0: f64, width: f64, tall: f64) -> (String, String) {
    let (a, b) = match kind {
        "transpose" => ("matrix(0 1 1 0 0 0)".to_string(), "matrix(0 1 1 0 0 0)"),
        "rotate" => (
            format!("matrix(0 1 -1 0 {} 0)", num(2.0 * y0 + tall)),
            "matrix(0 -1 1 0 0 0)",
        ),
        "anti-transpose" => (
            format!(
                "matrix(0 -1 -1 0 {} {})",
                num(2.0 * y0 + tall),
                num(2.0 * x0 + width)
            ),
            "matrix(0 -1 -1 0 0 0)",
        ),
        "counter-rotate" => (
            format!("matrix(0 -1 1 0 0 {})", num(2.0 * x0 + width)),
            "matrix(0 1 -1 0 0 0)",
        ),
        "mirror" => (
            format!("matrix(-1 0 0 1 {} 0)", num(2.0 * x0 + width)),
            "matrix(-1 0 0 1 0 0)",
        ),
        "half-turn" => (
            format!(
                "matrix(-1 0 0 -1 {} {})",
                num(2.0 * x0 + width),
                num(2.0 * y0 + tall)
            ),
            "matrix(-1 0 0 -1 0 0)",
        ),
        "invert" => (
            format!("matrix(1 0 0 -1 0 {})", num(2.0 * y0 + tall)),
            "matrix(1 0 0 -1 0 0)",
        ),
        _ => (String::new(), ""),
    };
    (a, b.to_string())
}

/// Applies a side, a variant and a proportion to the flag.
fn resolve(f: &Doc, opts: &RenderOptions) -> R<Resolved> {
    let mut res = Resolved {
        flag: f.clone(),
        turn: "none".into(),
        upright: false,
        mirror: false,
        canvas: 0.0,
    };
    let mut ratio = opts.ratio.unwrap_or(0.0);
    let mut variant = None;
    if !opts.variant.is_empty() {
        variant = f.variants.get(&opts.variant);
        if variant.is_none() {
            return Err(format!(
                "{} has no variant {}",
                f.meta.name,
                quote(&opts.variant)
            ));
        }
    }
    match opts.fit.as_str() {
        "" | "error" | "pad" => {}
        _ => return Err(format!("unknown fit {}", quote(&opts.fit))),
    }
    match opts.align.as_str() {
        "" | "start" | "center" | "end" => {}
        _ => return Err(format!("unknown align {}", quote(&opts.align))),
    }
    let out = &mut res.flag;
    match opts.side.as_str() {
        "" | "obverse" => {}
        "reverse" => {
            if let Some(r) = &f.reverse {
                out.layers = r.layers.clone();
                out.seen_from_behind = true;
            } else {
                res.mirror = true;
            }
        }
        _ => return Err(format!("unknown side {}", quote(&opts.side))),
    }
    if let Some(variant) = variant {
        res.turn = variant.from.clone();
        res.upright = variant.upright;
        // The flag's outline and border were drawn for its own shape.
        if variant.fly > 0.0 {
            out.fly = variant.fly;
            out.hoist = variant.hoist;
            out.outline = None;
            out.border = None;
            out.border_outside = false;
        }
        if !variant.layers.is_empty() {
            // Its own design has nothing to do with the flag's reverse, so it's mirrored.
            out.layers = variant.layers.clone();
            out.reverse = None;
            out.seen_from_behind = false;
            res.mirror = opts.side == "reverse";
        }
        if let Some(o) = &variant.outline {
            out.outline = Some(o.clone());
        }
        if let Some(b) = &variant.border {
            out.border = Some(b.clone());
            out.border_outside = variant.border_outside;
        }
        if ratio == 0.0 {
            ratio = variant.ratio;
        }
    }
    if ratio == 0.0 {
        return Ok(res);
    }
    if opts.fit == "pad" {
        let near = adapter::nearest_ratio(&res.flag, ratio);
        // The rules allow that proportion, but this design can't reach it.
        if let Ok(Some(adapted)) = adapter::with_ratio(&res.flag, near) {
            res.flag = adapted;
        }
        res.canvas = ratio;
        return Ok(res);
    }
    let adapted = adapter::with_ratio(&res.flag, ratio)?;
    let mut adapted = adapted.unwrap_or_else(|| res.flag.clone());
    if !opts.fold.is_empty()
        && let Some(reverse) = &res.flag.reverse
    {
        // A fold shows the back as well, which adapts as it's seen from behind.
        let mut back = res.flag.clone();
        back.layers = reverse.layers.clone();
        back.seen_from_behind = true;
        let adapted_back = adapter::with_ratio(&back, ratio)?.unwrap_or(back);
        adapted.reverse = Some(Reverse {
            layers: adapted_back.layers,
        });
    }
    res.flag = adapted;
    Ok(res)
}

struct Render<'a> {
    flag: &'a Doc,
    out: String,
    depth: usize,
    next_id: usize,
    gradients: HashMap<String, String>,
    /// The transform that undoes a turned variant's rotation.
    upright: String,
    id_prefix: String,
    /// Marks each drawn element with the path of the layer that drew it.
    tagging: bool,
    scope_layers: String,
    scope_border: String,
    /// The path of the layer being drawn, and how many use layers it's inside.
    tag: String,
    using: usize,
}

impl<'a> Render<'a> {
    fn new(flag: &'a Doc, id_prefix: String) -> Render<'a> {
        Render {
            flag,
            out: String::new(),
            depth: 0,
            next_id: 0,
            gradients: HashMap::new(),
            upright: String::new(),
            id_prefix,
            tagging: false,
            scope_layers: String::new(),
            scope_border: String::new(),
            tag: String::new(),
            using: 0,
        }
    }

    fn line(&mut self, text: &str) {
        for _ in 0..self.depth {
            self.out.push_str("  ");
        }
        self.out.push_str(text);
        self.out.push('\n');
    }

    fn color(&self, name: &str) -> String {
        self.flag
            .palette
            .get(name)
            .map(|v| v.to_ascii_lowercase())
            .unwrap_or_default()
    }

    /// The paint value for a palette name. A gradient spans the box given, or the bounding box of
    /// each shape it's used on if that's None.
    fn fill(&mut self, name: &str, bx: Option<[f64; 4]>) -> String {
        let Some(g) = self.flag.gradients.get(name) else {
            return self.color(name);
        };
        if bx.is_none()
            && let Some(id) = self.gradients.get(name)
        {
            return format!("url(#{id})");
        }
        let id = self.id("gradient");
        let (x1, mut y1, mut x2, mut y2) = (0, 0, 1, 0);
        match g.along.as_str() {
            "hoist" => {
                x2 = 0;
                y2 = 1;
            }
            "bend" => y2 = 1,
            "bend-sinister" => y1 = 1,
            _ => {}
        }
        let mut units = String::new();
        if let Some(b) = bx {
            units = format!(
                " gradientUnits=\"userSpaceOnUse\" gradientTransform=\"translate({} {}) scale({} {})\"",
                num(b[0]),
                num(b[1]),
                num(b[2]),
                num(b[3])
            );
        }
        self.line(&format!(
            "<linearGradient id=\"{id}\" x1=\"{x1}\" y1=\"{y1}\" x2=\"{x2}\" y2=\"{y2}\"{units}>"
        ));
        self.depth += 1;
        for i in 0..g.colors.len() {
            let stop = format!(
                "<stop offset=\"{}\" stop-color=\"{}\"/>",
                num(g.stops[i]),
                self.color(&g.colors[i])
            );
            self.line(&stop);
        }
        self.depth -= 1;
        self.line("</linearGradient>");
        if bx.is_none() {
            self.gradients.insert(name.to_string(), id.clone());
        }
        format!("url(#{id})")
    }

    fn id(&mut self, kind: &str) -> String {
        self.next_id += 1;
        format!("{}{kind}{}", self.id_prefix, self.next_id)
    }

    /// Paints a flag's outside border, then everything within its outline.
    fn flag_art(&mut self, f: &Doc) -> R<()> {
        if let Some(b) = &f.border
            && f.border_outside
        {
            let shape = geometry::boundary(f);
            let outer = geometry::offset_polygon(shape.as_deref().unwrap_or(&[]), b.width)?;
            self.tag = format!("{}border", self.scope_border);
            // A gradient spans the shape that the border edges.
            let bx = shape.as_deref().map(shapes::bounds);
            let fill = self.fill(&b.color, bx);
            self.geom(&Geom::poly(outer), &format!("fill=\"{fill}\""));
        }
        let root = Region::new(f.fly, f.hoist);
        let shape = match &f.outline {
            Some(o) => shapes::outline_geom(o, f.fly, f.hoist),
            None => Geom::poly(geometry::rect_poly(0.0, 0.0, f.fly, f.hoist)),
        };
        let flag_clip = self.id("flag");
        self.line(&format!("<clipPath id=\"{flag_clip}\">"));
        self.depth += 1;
        self.unmarked(&shape, "");
        self.depth -= 1;
        self.line("</clipPath>");
        self.line(&format!("<g clip-path=\"url(#{flag_clip})\">"));
        self.depth += 1;
        let scope = self.scope_layers.clone();
        self.layers(&f.layers, &root, &scope)?;
        if let Some(b) = &f.border
            && !f.border_outside
        {
            // Half of the stroke falls outside the outline, and the clip removes it.
            self.tag = format!("{}border", self.scope_border);
            let fill = self.fill(&b.color, None);
            self.geom(
                &shape,
                &format!(
                    "fill=\"none\" stroke=\"{fill}\" stroke-width=\"{}\" stroke-linejoin=\"miter\" stroke-miterlimit=\"10\"",
                    num(2.0 * b.width)
                ),
            );
        }
        self.depth -= 1;
        self.line("</g>");
        Ok(())
    }

    /// Paints layers, whose paths start with base: a scope, or a parent's path and a dot.
    fn layers(&mut self, layers: &[Layer], reg: &Region, base: &str) -> R<()> {
        for (i, l) in layers.iter().enumerate() {
            self.layer(l, reg, &format!("{base}{i}"))?;
        }
        Ok(())
    }

    fn layer(&mut self, l: &Layer, reg: &Region, path: &str) -> R<()> {
        if self.using == 0 {
            self.tag = path.to_string();
        }
        let mut attrs = Vec::new();
        let mut style = Vec::new();
        let moves = cut_moves(l, reg);
        self.effects(&l.fx, reg, moves, &mut attrs, &mut style);
        // A group, and any layer with an opacity, a blend, a clip or a cut, composites as a unit,
        // so a blend inside it mixes only with what else is inside. Saying so outright keeps every
        // renderer to that. A panel's own group already says it.
        if matches!(l.kind, LayerKind::Group(_))
            || l.fx.opacity != 1.0
            || l.fx.blend != "normal"
            || l.fx.clip.is_some()
            || !l.fx.cuts.is_empty()
        {
            style.push("isolation:isolate".to_string());
        }
        if !style.is_empty() {
            attrs.push(format!("style=\"{}\"", style.join(";")));
        }
        if !attrs.is_empty() {
            self.line(&format!("<g {}>", attrs.join(" ")));
            self.depth += 1;
        }
        self.content(l, reg, path)?;
        if !attrs.is_empty() {
            self.depth -= 1;
            self.line("</g>");
        }
        Ok(())
    }

    /// Writes any clip and mask a layer needs. A charge's cuts are drawn once for each of its moves.
    fn effects(
        &mut self,
        e: &Effects,
        reg: &Region,
        moves: Option<Vec<String>>,
        attrs: &mut Vec<String>,
        style: &mut Vec<String>,
    ) {
        if e.opacity != 1.0 {
            attrs.push(format!("opacity=\"{}\"", num(e.opacity)));
        }
        if e.blend != "normal" {
            style.push(format!("mix-blend-mode:{}", e.blend));
        }
        if let Some(clip) = &e.clip {
            let id = self.id("clip");
            self.line(&format!("<clipPath id=\"{id}\">"));
            self.depth += 1;
            let clip = shapes::for_region(clip, reg);
            let g = shapes::shape_geom(&clip, shapes::position(&clip, reg), 0.0);
            self.unmarked(&g, "");
            self.depth -= 1;
            self.line("</clipPath>");
            attrs.push(format!("clip-path=\"url(#{id})\""));
        }
        if !e.cuts.is_empty() {
            let id = self.id("mask");
            let b = reg.bounds();
            self.line(&format!(
                "<mask id=\"{id}\" maskUnits=\"userSpaceOnUse\" x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\">",
                num(b[0]),
                num(b[1]),
                num(b[2]),
                num(b[3])
            ));
            self.depth += 1;
            self.unmarked(
                &Geom::poly(geometry::rect_poly(b[0], b[1], b[0] + b[2], b[1] + b[3])),
                "fill=\"#fff\"",
            );
            let moves = moves.unwrap_or_else(|| vec![String::new()]);
            for mv in &moves {
                for s in &e.cuts {
                    let cut = shapes::for_region(s, reg);
                    let mut g = shapes::shape_geom(&cut, shapes::position(&cut, reg), 0.0);
                    if !mv.is_empty() {
                        g.transform = format!("{mv} {}", g.transform).trim().to_string();
                    }
                    self.unmarked(&g, "fill=\"#000\"");
                }
            }
            self.depth -= 1;
            self.line("</mask>");
            attrs.push(format!("mask=\"url(#{id})\""));
        }
    }

    fn is_gradient(&self, name: &str) -> bool {
        self.flag.gradients.contains(name)
    }

    fn content(&mut self, l: &Layer, reg: &Region, path: &str) -> R<()> {
        match &l.kind {
            LayerKind::Field(f) => {
                let g = [Geom::poly(geometry::rect_poly(0.0, 0.0, reg.w, reg.h))];
                self.paint(&f.color, None, None, None, Some(&g));
            }
            LayerKind::Bars(b) => {
                let has_gap = b.colors.iter().any(|c| c == NONE);
                let exact = |i: usize| self.is_gradient(&b.colors[i]) || has_gap;
                let polys = shapes::bar_polys(b, reg, &exact)?;
                for (i, poly) in polys.into_iter().enumerate() {
                    if !poly.is_empty() {
                        self.paint(&b.colors[i], None, None, None, Some(&[Geom::poly(poly)]));
                    }
                }
            }
            LayerKind::Chevrons(ch) => {
                let (nested, bands) = shapes::raw_chevrons(ch, reg);
                let mut polys = shapes::chevron_polys(ch, reg);
                if ch.colors.iter().any(|c| c == NONE) {
                    // A gap has to show what's beneath, so each band stands alone.
                    polys = bands;
                }
                let n = polys.len();
                if let Some(fim) = &ch.fimbriate {
                    // A gradient spans the outermost chevron's part inside the region.
                    let bx = box_of(&shapes::clip_convex(&nested[0], reg));
                    let stroke = [Geom::poly(nested[0].clone())];
                    self.paint(&ch.colors[n - 1], bx, Some(fim), Some(&stroke), None);
                }
                for (i, poly) in polys.into_iter().enumerate() {
                    if poly.is_empty() {
                        continue;
                    }
                    // A gradient spans the whole chevron's part inside the region, even where a gap
                    // leaves only its band to paint.
                    let bx = box_of(&shapes::clip_convex(&nested[i], reg));
                    self.paint(
                        &ch.colors[n - 1 - i],
                        bx,
                        None,
                        None,
                        Some(&[Geom::poly(poly)]),
                    );
                }
            }
            LayerKind::Band(b) => {
                // The fimbriation's stroke mustn't follow the region's edge, so it uses the band's
                // unclipped shape. A clipped polygon can be empty.
                let stroke = [Geom::poly(shapes::placed_band_poly(
                    reg, &b.fixed, &b.along, b.rotate, b.width, b.offset, true,
                ))];
                let poly = shapes::placed_band_poly(
                    reg, &b.fixed, &b.along, b.rotate, b.width, b.offset, false,
                );
                if !poly.is_empty() {
                    // A gradient spans the part inside the region, for the fimbriation too.
                    let bx = Some(shapes::bounds(&poly));
                    self.paint(
                        &b.color,
                        bx,
                        b.fimbriate.as_ref(),
                        Some(&stroke),
                        Some(&[Geom::poly(poly)]),
                    );
                } else {
                    self.paint(&b.color, None, b.fimbriate.as_ref(), Some(&stroke), None);
                }
            }
            LayerKind::Cross(c) => {
                // A gradient spans a cross as one shape, so it's given the whole region.
                let bx = Some([0.0, 0.0, reg.w, reg.h]);
                let stroke = c.fimbriate.as_ref().map(|f| {
                    // Keep the arms' ends, and their stroke, beyond the region's edge.
                    let [a, b] = shapes::cross_polys(c, reg, f.width * 2.0);
                    [Geom::poly(a), Geom::poly(b)]
                });
                let [a, b] = shapes::cross_polys(c, reg, 0.0);
                self.paint(
                    &c.color,
                    bx,
                    c.fimbriate.as_ref(),
                    stroke.as_ref().map(|s| &s[..]),
                    Some(&[Geom::poly(a), Geom::poly(b)]),
                );
            }
            LayerKind::Quarters(q) => self.quarters(q, reg),
            LayerKind::Checks(ch) => self.checks(ch, reg),
            LayerKind::Rays(ry) => {
                let polys = shapes::ray_polys(ry, reg);
                if !ry.colors.iter().any(|c| c == NONE) {
                    // Beneath the wedges, so that antialiasing can't leave seams between them.
                    let g = [Geom::poly(geometry::rect_poly(0.0, 0.0, reg.w, reg.h))];
                    self.paint(&ry.colors[0], None, None, None, Some(&g));
                }
                for (i, poly) in polys.into_iter().enumerate() {
                    if !poly.is_empty() {
                        self.paint(&ry.colors[i], None, None, None, Some(&[Geom::poly(poly)]));
                    }
                }
            }
            LayerKind::Saltire(s) => {
                if s.counterchange {
                    self.counterchange(s, reg);
                    return Ok(());
                }
                let bx = Some([0.0, 0.0, reg.w, reg.h]);
                let stroke = s.fimbriate.as_ref().map(|_| {
                    [
                        Geom::poly(shapes::band_poly(reg, "bend", 0.0, s.width, 0.0, true)),
                        Geom::poly(shapes::band_poly(
                            reg,
                            "bend-sinister",
                            0.0,
                            s.width,
                            0.0,
                            true,
                        )),
                    ]
                });
                let shapes_ = [
                    Geom::poly(shapes::band_poly(reg, "bend", 0.0, s.width, 0.0, false)),
                    Geom::poly(shapes::band_poly(
                        reg,
                        "bend-sinister",
                        0.0,
                        s.width,
                        0.0,
                        false,
                    )),
                ];
                self.paint(
                    &s.color,
                    bx,
                    s.fimbriate.as_ref(),
                    stroke.as_ref().map(|s| &s[..]),
                    Some(&shapes_),
                );
            }
            LayerKind::Charge(c) => self.charge(c, &l.fx, reg),
            LayerKind::Emblem(e) => self.emblem(e, reg, path)?,
            LayerKind::Group(g) => self.layers(&g.layers, reg, &format!("{path}."))?,
            LayerKind::Panel(p) => self.panel(p, reg, path)?,
            LayerKind::Use(u) => {
                // Everything a use draws is marked with its path, since it's the use in the document.
                self.using += 1;
                let result = self.use_design(u, reg);
                self.using -= 1;
                result?;
            }
        }
        Ok(())
    }

    fn use_design(&mut self, u: &Use, reg: &Region) -> R<()> {
        if u.design.fly == 0.0 {
            return self.layers(&u.design.layers, reg, "");
        }
        // A design with its own grid is scaled to fill the region it's used in.
        self.line(&format!(
            "<g transform=\"scale({} {})\">",
            factor(reg.w / u.design.fly),
            factor(reg.h / u.design.hoist)
        ));
        self.depth += 1;
        self.layers(
            &u.design.layers,
            &Region::new(u.design.fly, u.design.hoist),
            "",
        )?;
        self.depth -= 1;
        self.line("</g>");
        Ok(())
    }

    fn panel(&mut self, p: &Panel, reg: &Region, path: &str) -> R<()> {
        let [x, y, w, h] = shapes::panel_rect(p, reg);
        let shape = if p.line.is_some() {
            Geom::poly(shapes::panel_edge(p, w, h)?)
        } else {
            Geom::poly(geometry::rect_poly(0.0, 0.0, w, h))
        };
        let id = self.id("panel");
        self.line(&format!("<clipPath id=\"{id}\">"));
        self.depth += 1;
        self.unmarked(&shape, "");
        self.depth -= 1;
        self.line("</clipPath>");
        self.line(&format!(
            "<g transform=\"translate({} {})\" clip-path=\"url(#{id})\" style=\"isolation:isolate\">",
            num(x),
            num(y)
        ));
        self.depth += 1;
        self.layers(&p.layers, &Region::new(w, h), &format!("{path}."))?;
        self.depth -= 1;
        self.line("</g>");
        Ok(())
    }

    fn quarters(&mut self, q: &Quarters, reg: &Region) {
        let mut c = reg.center();
        let rect = |x0, y0, x1, y1| [Geom::poly(geometry::rect_poly(x0, y0, x1, y1))];
        if q.diagonal {
            let corners = reg.corners();
            for i in 0..4 {
                let g = [Geom::poly(vec![c, corners[i], corners[(i + 1) % 4]])];
                self.paint(&q.colors[i], None, None, None, Some(&g));
            }
            return;
        }
        if let Some(s) = &q.split {
            c = v(s.fly, s.hoist);
        }
        // Each runs on beneath the next, so antialiasing can't leave a seam, unless gaps have to
        // show or a gradient has to span its own quarter.
        let gaps = q.colors.iter().any(|c| c == NONE);
        let exact: Vec<bool> = q
            .colors
            .iter()
            .map(|col| gaps || self.is_gradient(col))
            .collect();
        let (mut right, mut bottom) = (reg.w, reg.h);
        if exact[0] {
            right = c.x;
            bottom = c.y;
        }
        self.paint(
            &q.colors[0],
            None,
            None,
            None,
            Some(&rect(0.0, 0.0, right, bottom)),
        );
        bottom = if exact[1] { c.y } else { reg.h };
        self.paint(
            &q.colors[1],
            None,
            None,
            None,
            Some(&rect(c.x, 0.0, reg.w, bottom)),
        );
        right = if exact[2] { c.x } else { reg.w };
        self.paint(
            &q.colors[2],
            None,
            None,
            None,
            Some(&rect(0.0, c.y, right, reg.h)),
        );
        self.paint(
            &q.colors[3],
            None,
            None,
            None,
            Some(&rect(c.x, c.y, reg.w, reg.h)),
        );
    }

    fn checks(&mut self, ch: &Checks, reg: &Region) {
        let n = ch.colors.len();
        let cell_w = reg.w / ch.columns as f64;
        let cell_h = reg.h / ch.rows as f64;
        let gaps = ch.colors.iter().any(|c| c == NONE);
        for row in 0..ch.rows {
            for col in 0..ch.columns {
                let i = if ch.flow == "bend" {
                    col + ch.rows * n - row
                } else {
                    row + col
                };
                let x = col as f64 * cell_w;
                let y = row as f64 * cell_h;
                // Each cell runs on beneath the next ones, unless gaps have to show or a gradient has
                // to span its own cell.
                let (mut right, mut bottom) = (reg.w, reg.h);
                let color = &ch.colors[i % n];
                if gaps || self.is_gradient(color) {
                    right = x + cell_w;
                    bottom = y + cell_h;
                }
                let g = [Geom::poly(geometry::rect_poly(x, y, right, bottom))];
                self.paint(color, None, None, None, Some(&g));
            }
        }
    }

    /// Paints a saltire twice its width, clipped to four triangles, so one side of each diagonal shows.
    fn counterchange(&mut self, l: &Saltire, reg: &Region) {
        let c = reg.center();
        let id = self.id("clip");
        self.line(&format!("<clipPath id=\"{id}\">"));
        self.depth += 1;
        self.unmarked(
            &Geom::poly(vec![
                c,
                v(reg.w, c.y),
                v(reg.w, reg.h),
                c,
                v(c.x, reg.h),
                v(0.0, reg.h),
                c,
                v(0.0, c.y),
                v(0.0, 0.0),
                c,
                v(c.x, 0.0),
                v(reg.w, 0.0),
            ]),
            "",
        );
        self.depth -= 1;
        self.line("</clipPath>");
        self.line(&format!("<g clip-path=\"url(#{id})\">"));
        self.depth += 1;
        let bx = Some([0.0, 0.0, reg.w, reg.h]);
        let g = [
            Geom::poly(shapes::band_poly(
                reg,
                "bend",
                0.0,
                2.0 * l.width,
                0.0,
                false,
            )),
            Geom::poly(shapes::band_poly(
                reg,
                "bend-sinister",
                0.0,
                2.0 * l.width,
                0.0,
                false,
            )),
        ];
        self.paint(&l.color, bx, None, None, Some(&g));
        self.depth -= 1;
        self.line("</g>");
    }

    fn emblem(&mut self, e: &Emblem, reg: &Region, path: &str) -> R<()> {
        let at = match &e.at {
            Some(a) => v(a.fly, a.hoist),
            None => reg.center(),
        };
        let mut angle = e.rotate;
        if !e.along.is_empty() {
            let (dir, _) = shapes::axis(reg, &e.along, 0.0);
            angle += dir.y.atan2(dir.x) * 180.0 / std::f64::consts::PI;
        }
        // Painting is still clipped to the region, so the frame only has to reach the region's
        // farthest corner.
        let mut reach: f64 = 0.0;
        for corner in reg.corners() {
            reach = reach.max((corner.x - at.x).hypot(corner.y - at.y));
        }
        let opened = self.upright_open(at);
        self.line(&format!(
            "<g transform=\"translate({} {}) rotate({})\">",
            num(at.x),
            num(at.y),
            num(angle)
        ));
        self.depth += 1;
        // Charges in an emblem turn with it, so they aren't each kept upright as well.
        let was = std::mem::take(&mut self.upright);
        let frame = Region {
            w: 0.0,
            h: 0.0,
            local: reach,
        };
        let mut result = Ok(());
        for (i, c) in e.charges.iter().enumerate() {
            result = self.layer(c, &frame, &format!("{path}.{i}"));
            if result.is_err() {
                break;
            }
        }
        self.upright = was;
        self.depth -= 1;
        self.line("</g>");
        self.upright_close(opened);
        result
    }

    fn charge(&mut self, c: &Charge, _fx: &Effects, reg: &Region) {
        let s = shapes::for_region(&c.shape, reg);
        let at = shapes::position(&s, reg);
        if s.kind == "svg" {
            let opened = self.upright_open(at);
            self.embedded(c, at);
            self.upright_close(opened);
            return;
        }
        let places = charge_places(c, &s, reg);
        let copies: Vec<Geom> = places
            .iter()
            .map(|(p, turn)| shapes::shape_geom(&s, *p, *turn))
            .collect();
        let centers: Vec<Vec2> = places.iter().map(|(p, _)| *p).collect();
        let mut bx = None;
        if c.shape.kind == "pile" || c.shape.kind == "pall" {
            // Its shape runs on past the region, and a gradient spans only what's inside.
            let points: Vec<Vec2> = s.vertices.iter().map(|p| v(p.fly, p.hoist)).collect();
            bx = box_of(&shapes::clip_convex(&points, reg));
        }
        let draw = |r: &mut Render, shapes: &[Geom], fimbriate: Option<&Edge>| {
            if s.hollow > 0.0 {
                r.outline_only(&c.color, bx, s.hollow, shapes);
            } else if s.lines > 0.0 {
                r.outline_only(&c.color, bx, s.lines, shapes);
            } else {
                r.paint(&c.color, bx, fimbriate, Some(shapes), Some(shapes));
            }
        };
        if self.upright.is_empty() || s.kind == "polygon" {
            draw(self, &copies, c.fimbriate.as_ref());
            return;
        }
        if let Some(fim) = &c.fimbriate {
            // Every copy's fimbriation lies beneath all of their fills, as it does unturned.
            for i in 0..copies.len() {
                let opened = self.upright_open(centers[i]);
                self.paint(NONE, None, Some(fim), Some(&copies[i..i + 1]), None);
                self.upright_close(opened);
            }
        }
        for i in 0..copies.len() {
            let opened = self.upright_open(centers[i]);
            draw(self, &copies[i..i + 1], None);
            self.upright_close(opened);
        }
    }

    /// Undoes a turned variant's rotation around a point, if there is one, until it's closed.
    fn upright_open(&mut self, at: Vec2) -> bool {
        if self.upright.is_empty() {
            return false;
        }
        let line = format!(
            "<g transform=\"translate({} {}) {} translate({} {})\">",
            num(at.x),
            num(at.y),
            self.upright,
            num(-at.x),
            num(-at.y)
        );
        self.line(&line);
        self.depth += 1;
        true
    }

    fn upright_close(&mut self, opened: bool) {
        if opened {
            self.depth -= 1;
            self.line("</g>");
        }
    }

    fn outline_only(&mut self, color: &str, bx: Option<[f64; 4]>, width: f64, shapes: &[Geom]) {
        if color == NONE {
            return;
        }
        let stroke = self.fill(color, bx);
        for g in shapes {
            self.geom(
                g,
                &format!(
                    "fill=\"none\" stroke=\"{stroke}\" stroke-width=\"{}\" stroke-linejoin=\"miter\" stroke-miterlimit=\"10\"",
                    num(width / g.stroke_scale())
                ),
            );
        }
    }

    fn embedded(&mut self, c: &Charge, at: Vec2) {
        let s = &c.shape;
        let Some(art) = &s.embedded else {
            return;
        };
        let mut attrs = Vec::new();
        if !c.color.is_empty() {
            attrs.push(format!("color=\"{}\"", self.color(&c.color)));
        }
        if s.rotate != 0.0 {
            attrs.push(format!(
                "transform=\"rotate({} {} {})\"",
                num(s.rotate),
                num(at.x),
                num(at.y)
            ));
        }
        if !attrs.is_empty() {
            self.line(&format!("<g {}>", attrs.join(" ")));
            self.depth += 1;
        }
        // Each time it's drawn gets its own prefix, since a definition can draw it many times.
        let prefix = format!("{}-", self.id("svg"));
        let line = format!(
            "<svg{} x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" viewBox=\"{}\" preserveAspectRatio=\"xMidYMid meet\"{}>{}</svg>",
            self.mark(),
            num(at.x - s.fly / 2.0),
            num(at.y - s.hoist / 2.0),
            num(s.fly),
            num(s.hoist),
            xml::escape(art.view_box()),
            art.attrs(&prefix),
            art.body(&prefix)
        );
        self.line(&line);
        if !attrs.is_empty() {
            self.depth -= 1;
            self.line("</g>");
        }
    }

    /// Fills shapes, after painting any fimbriation beneath all of them. Each shape's stroke lies
    /// beneath the others' fills, so arms read as a single shape. A gradient spans box, or each
    /// shape's own bounds if box is None.
    fn paint(
        &mut self,
        color: &str,
        bx: Option<[f64; 4]>,
        fimbriate: Option<&Edge>,
        stroke: Option<&[Geom]>,
        shapes: Option<&[Geom]>,
    ) {
        if let (Some(fim), Some(stroke)) = (fimbriate, stroke) {
            let edge = self.fill(&fim.color, bx);
            for g in stroke {
                self.geom(
                    g,
                    &format!(
                        "fill=\"{edge}\" stroke=\"{edge}\" stroke-width=\"{}\" stroke-linejoin=\"miter\" stroke-miterlimit=\"10\"",
                        num(2.0 * fim.width / g.stroke_scale())
                    ),
                );
            }
        }
        let Some(shapes) = shapes else {
            return;
        };
        if shapes.is_empty() || color == NONE {
            return;
        }
        let fill = self.fill(color, bx);
        for g in shapes {
            self.geom(g, &format!("fill=\"{fill}\""));
        }
    }

    /// The attribute that marks a drawn element, if this render has them.
    fn mark(&self) -> String {
        if !self.tagging {
            return String::new();
        }
        format!(" {TAG_ATTRIBUTE}=\"{}\"", xml::escape(&self.tag))
    }

    /// Writes what's only part of a definition, which no layer drew.
    fn unmarked(&mut self, g: &Geom, attrs: &str) {
        let was = self.tagging;
        self.tagging = false;
        self.geom(g, attrs);
        self.tagging = was;
    }

    fn geom(&mut self, g: &Geom, attrs: &str) {
        let mut a = self.mark();
        if !attrs.is_empty() {
            a.push(' ');
            a.push_str(attrs);
        }
        if !g.transform.is_empty() {
            a.push_str(&format!(" transform=\"{}\"", g.transform));
        }
        if g.evenodd {
            a.push_str(" fill-rule=\"evenodd\"");
        }
        if !g.path.is_empty() {
            self.line(&format!("<path d=\"{}\"{a}/>", g.path));
        } else if g.circle {
            let c = g.c.unwrap_or(v(0.0, 0.0));
            self.line(&format!(
                "<circle cx=\"{}\" cy=\"{}\" r=\"{}\"{a}/>",
                num(c.x),
                num(c.y),
                num(g.r)
            ));
        } else if g.ring {
            let c = g.c.unwrap_or(v(0.0, 0.0));
            self.line(&format!(
                "<path fill-rule=\"evenodd\" d=\"{} {}\"{a}/>",
                shapes::circle_path(c, g.r),
                shapes::circle_path(c, g.inner)
            ));
        } else {
            let points: Vec<String> = g
                .poly
                .iter()
                .map(|p| format!("{},{}", num(p.x), num(p.y)))
                .collect();
            self.line(&format!("<polygon points=\"{}\"{a}/>", points.join(" ")));
        }
    }

    /// Renders a flag in a folded position.
    fn write_folded(&mut self, f: &Doc, fold: &Fold, opts: &RenderOptions, height: f64) -> R<()> {
        let shape = geometry::fold_shape(f)?;
        let steps = opts.fold_step.unwrap_or(0).max(0) as usize;
        let stack = geometry::fold_facets(&shape, fold, steps)?;
        let all: Vec<Vec2> = stack.iter().flat_map(|f| f.poly.iter().copied()).collect();
        let [x, y, w, h] = shapes::bounds(&all);
        self.line(&format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"{} {} {} {}\" width=\"{}\" height=\"{}\">",
            num(x),
            num(y),
            num(w),
            num(h),
            num(height * w / h),
            num(height)
        ));
        self.depth += 1;
        self.line(&format!("<title>{}</title>", xml::escape(&f.meta.name)));
        self.line("<defs>");
        self.depth += 1;
        let front = self.id("front");
        self.line(&format!("<g id=\"{front}\">"));
        self.depth += 1;
        self.flag_art(f)?;
        self.depth -= 1;
        self.line("</g>");
        let mut back = String::new();
        if let Some(r) = &f.reverse {
            back = self.id("back");
            let mut reverse = f.clone();
            reverse.layers = r.layers.clone();
            self.line(&format!("<g id=\"{back}\">"));
            self.depth += 1;
            let scope = std::mem::replace(&mut self.scope_layers, "reverse/".into());
            let result = self.flag_art(&reverse);
            self.scope_layers = scope;
            result?;
            self.depth -= 1;
            self.line("</g>");
        }
        self.depth -= 1;
        self.line("</defs>");
        // A crease line reads at any scale, without hiding the design. SPEC section 13 fixes it.
        let crease = format!(
            "fill=\"none\" stroke=\"#000\" stroke-opacity=\"0.35\" stroke-linejoin=\"round\" stroke-width=\"{}\"",
            num(w.max(h) * 0.004)
        );
        for fc in &stack {
            let id = self.id("facet");
            self.line(&format!("<clipPath id=\"{id}\">"));
            self.depth += 1;
            self.unmarked(&Geom::poly(fc.poly.clone()), "");
            self.depth -= 1;
            self.line("</clipPath>");
            let mut art = &front;
            let mut place = fc.place;
            if fc.flipped && !back.is_empty() {
                // A separate back is written as seen from that side, so it mirrors back.
                art = &back;
                place = Matrix::new(-1.0, 0.0, 0.0, 1.0, f.fly, 0.0).then(&fc.place);
            }
            let line = format!(
                "<g clip-path=\"url(#{id})\"><use href=\"#{art}\" transform=\"matrix({} {} {} {} {} {})\"/></g>",
                num(place.a),
                num(place.b),
                num(place.c),
                num(place.d),
                num(place.e),
                num(place.f)
            );
            self.line(&line);
            self.unmarked(&Geom::poly(fc.poly.clone()), &crease);
        }
        self.depth -= 1;
        self.line("</svg>");
        Ok(())
    }
}

fn box_of(inside: &[Vec2]) -> Option<[f64; 4]> {
    if inside.is_empty() {
        None
    } else {
        Some(shapes::bounds(inside))
    }
}

/// Where each copy of a charge goes, and how far it turns with its repeat, in painting order.
pub(crate) fn charge_places(c: &Charge, s: &Shape, reg: &Region) -> Vec<(Vec2, f64)> {
    let mut places = Vec::new();
    let at = shapes::position(s, reg);
    match &c.repeat {
        _ if s.ats.len() > 1 => {
            for p in &s.ats {
                let pos = match p {
                    None => reg.center(),
                    Some(p) => v(p.fly, p.hoist),
                };
                places.push((pos, 0.0));
            }
        }
        None => places.push((at, 0.0)),
        Some(r) if r.kind == "ring" => {
            for i in 0..r.count {
                let a = i as f64 * 360.0 / r.count as f64;
                places.push((
                    at.add(v(0.0, -r.radius).rotate(a)),
                    if r.turn { a } else { 0.0 },
                ));
            }
        }
        Some(r) if r.kind == "arc" => {
            // Clockwise from one to the other, as a ring's own arc goes.
            let mut span = (r.to - r.from) % 360.0;
            if span < 0.0 {
                span += 360.0;
            }
            for i in 0..r.count {
                let a = r.from + span * i as f64 / (r.count - 1) as f64;
                places.push((
                    at.add(v(0.0, -r.radius).rotate(a)),
                    if r.turn { a } else { 0.0 },
                ));
            }
        }
        Some(r) if r.kind == "line" => {
            for i in 0..r.count {
                places.push((at.add(v(r.fly, r.hoist).mul(i as f64)), 0.0));
            }
        }
        Some(r) => {
            for row in 1..=r.rows {
                for col in 1..=r.columns {
                    if r.stagger && (row + col) % 2 == 1 {
                        continue;
                    }
                    places.push((
                        v(
                            reg.w * col as f64 / (r.columns + 1) as f64,
                            reg.h * row as f64 / (r.rows + 1) as f64,
                        ),
                        0.0,
                    ));
                }
            }
        }
    }
    places
}

/// A transform for each copy of a charge, which takes its cuts from where they're written, for
/// the first copy, to that copy. A layer that isn't a charge with several copies gets None.
fn cut_moves(l: &Layer, reg: &Region) -> Option<Vec<String>> {
    let LayerKind::Charge(c) = &l.kind else {
        return None;
    };
    if l.fx.cuts.is_empty() || c.shape.kind == "svg" {
        return None;
    }
    let places = charge_places(c, &shapes::for_region(&c.shape, reg), reg);
    if places.len() < 2 {
        return None;
    }
    let (first_at, first_turn) = places[0];
    let mut moves = vec![String::new()];
    for &(at, t) in &places[1..] {
        let turn = t - first_turn;
        if turn != 0.0 {
            moves.push(format!(
                "translate({} {}) rotate({}) translate({} {})",
                num(at.x),
                num(at.y),
                num(turn),
                num(-first_at.x),
                num(-first_at.y)
            ));
        } else {
            moves.push(format!(
                "translate({} {})",
                num(at.x - first_at.x),
                num(at.y - first_at.y)
            ));
        }
    }
    Some(moves)
}

/// Reads a render back as a tree of elements. Only a title or desc holds any text.
pub(crate) fn tree(svg: &str) -> Element {
    TreeReader { s: svg, i: 0 }.element()
}

/// Reads the renderer's own output, which is plain XML with double-quoted attributes.
struct TreeReader<'a> {
    s: &'a str,
    i: usize,
}

impl TreeReader<'_> {
    fn byte(&self) -> u8 {
        self.s.as_bytes()[self.i]
    }

    fn element(&mut self) -> Element {
        while self.i < self.s.len() && self.byte() != b'<' {
            self.i += 1;
        }
        self.i += 1;
        let start = self.i;
        while !self.byte().is_ascii_whitespace() && self.byte() != b'>' && self.byte() != b'/' {
            self.i += 1;
        }
        let name = self.s[start..self.i].to_string();
        let mut attrs = Vec::new();
        loop {
            while self.byte().is_ascii_whitespace() {
                self.i += 1;
            }
            if self.s[self.i..].starts_with("/>") {
                self.i += 2;
                return Element::new(name, attrs, String::new(), Vec::new());
            }
            if self.byte() == b'>' {
                self.i += 1;
                break;
            }
            let eq = self.s[self.i..]
                .find('=')
                .map(|e| e + self.i)
                .unwrap_or(self.s.len());
            let key = self.s[self.i..eq].trim().to_string();
            let open = self.s[eq..]
                .find('"')
                .map(|e| e + eq)
                .unwrap_or(self.s.len());
            let close = self.s[open + 1..]
                .find('"')
                .map(|e| e + open + 1)
                .unwrap_or(self.s.len());
            attrs.push((key, unescape(&self.s[open + 1..close])));
            self.i = close + 1;
        }
        let mut children = Vec::new();
        let mut text = String::new();
        loop {
            let lt = self.s[self.i..]
                .find('<')
                .map(|e| e + self.i)
                .unwrap_or(self.s.len());
            if name == "title" || name == "desc" {
                text.push_str(&unescape(&self.s[self.i..lt]));
            }
            self.i = lt;
            if self.i >= self.s.len() || self.s[self.i..].starts_with("</") {
                self.i = self.s[self.i..]
                    .find('>')
                    .map(|e| e + self.i + 1)
                    .unwrap_or(self.s.len());
                return Element::new(name, attrs, text, children);
            }
            children.push(self.element());
        }
    }
}

fn unescape(t: &str) -> String {
    if !t.contains('&') {
        return t.to_string();
    }
    let mut b = String::new();
    let mut rest = t;
    while let Some(amp) = rest.find('&') {
        b.push_str(&rest[..amp]);
        let after = &rest[amp + 1..];
        let Some(semi) = after.find(';') else {
            b.push_str(&rest[amp..]);
            return b;
        };
        let r = &after[..semi];
        match r {
            "amp" => b.push('&'),
            "lt" => b.push('<'),
            "gt" => b.push('>'),
            "quot" => b.push('"'),
            "apos" => b.push('\''),
            _ => {
                let code = if let Some(h) = r.strip_prefix("#x") {
                    u32::from_str_radix(h, 16).ok()
                } else {
                    r.strip_prefix('#').and_then(|d| d.parse().ok())
                };
                if let Some(c) = code.and_then(char::from_u32) {
                    b.push(c);
                }
            }
        }
        rest = &after[semi + 1..];
    }
    b.push_str(rest);
    b
}
