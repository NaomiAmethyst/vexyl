// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! The canonical model, as section 4 of the SDK defines it and conformance/model.schema.json
//! writes it out. Names are the format's own terms. A value is left out only if it equals the
//! format's default, so a zero that means something stays.

use crate::model::*;
use crate::value::{Map, Value};

pub(crate) fn model(f: &Doc) -> Value {
    let mut m = Map::new();
    m.insert("vexyl", Value::Number(f.version as f64));
    m.insert("meta", meta(&f.meta));
    m.insert("palette", palette(f));
    m.insert("proportion", proportion(f.hoist, f.fly));
    if let Some(o) = &f.outline {
        m.insert("outline", outline(o));
    }
    if let Some(b) = &f.border {
        m.insert("border", border(b, f.border_outside));
    }
    if !f.defines.is_empty() {
        let mut defines = Map::new();
        for (name, d) in f.defines.iter() {
            defines.insert(name.clone(), define(d));
        }
        m.insert("define", defines.into());
    }
    if !f.layers.is_empty() {
        m.insert("layers", layers(&f.layers));
    }
    if let Some(r) = &f.reverse {
        let mut rm = Map::new();
        rm.insert("layers", layers(&r.layers));
        m.insert("reverse", rm.into());
    }
    if let Some(a) = &f.adapt {
        m.insert("adapt", adapt(a));
    }
    if !f.variants.is_empty() {
        let mut variants = Map::new();
        for (name, v) in f.variants.iter() {
            variants.insert(name.clone(), variant(v));
        }
        m.insert("variant", variants.into());
    }
    if !f.folds.is_empty() {
        let mut folds = Map::new();
        for (name, fd) in f.folds.iter() {
            folds.insert(name.clone(), fold(fd));
        }
        m.insert("fold", folds.into());
    }
    m.into()
}

fn proportion(hoist: f64, fly: f64) -> Value {
    let mut m = Map::new();
    m.insert("hoist", hoist.into());
    m.insert("fly", fly.into());
    m.into()
}

fn text(m: &mut Map, key: &str, value: &str) {
    if !value.is_empty() {
        m.insert(key, value.into());
    }
}

/// Leaves out a number that equals its default.
fn number(m: &mut Map, key: &str, value: f64, otherwise: f64) {
    if value != otherwise {
        m.insert(key, value.into());
    }
}

fn strings(values: &[String]) -> Value {
    Value::List(values.iter().map(|s| s.as_str().into()).collect())
}

fn list(m: &mut Map, key: &str, values: &[String]) {
    if !values.is_empty() {
        m.insert(key, strings(values));
    }
}

fn flag(m: &mut Map, key: &str, value: bool) {
    if value {
        m.insert(key, true.into());
    }
}

fn point(p: &Point) -> Value {
    let mut m = Map::new();
    m.insert("fly", p.fly.into());
    m.insert("hoist", p.hoist.into());
    m.into()
}

fn some_point(m: &mut Map, key: &str, p: &Option<Point>) {
    if let Some(p) = p {
        m.insert(key, point(p));
    }
}

fn numbers(values: &[f64]) -> Value {
    Value::List(values.iter().map(|&v| v.into()).collect())
}

fn meta(meta: &Meta) -> Value {
    let mut m = Map::new();
    m.insert("name", meta.name.as_str().into());
    text(&mut m, "description", &meta.description);
    text(&mut m, "version", &meta.version);
    text(&mut m, "date", &meta.date);
    text(&mut m, "until", &meta.until);
    text(&mut m, "series", &meta.series);
    list(&mut m, "note", &meta.notes);
    if !meta.laws.is_empty() {
        m.insert("law", references("law", &meta.laws));
    }
    if !meta.restrictions.is_empty() {
        m.insert("restriction", references("restriction", &meta.restrictions));
    }
    list(&mut m, "designer", &meta.designers);
    text(&mut m, "design-rights", &meta.design_rights);
    list(&mut m, "encoder", &meta.encoders);
    text(&mut m, "license", &meta.license);
    text(&mut m, "render-license", &meta.render_license);
    if !meta.adapted_from.is_empty() {
        let works = meta
            .adapted_from
            .iter()
            .map(|a| {
                let mut work = Map::new();
                work.insert("url", a.url.as_str().into());
                list(&mut work, "author", &a.authors);
                text(&mut work, "license", &a.license);
                text(&mut work, "part", &a.part);
                work.into()
            })
            .collect();
        m.insert("adapted-from", Value::List(works));
    }
    list(&mut m, "source", &meta.sources);
    m.into()
}

fn references(node: &str, refs: &[Reference]) -> Value {
    Value::List(
        refs.iter()
            .map(|r| {
                let mut m = Map::new();
                m.insert(node, r.text.as_str().into());
                list(&mut m, "source", &r.sources);
                m.into()
            })
            .collect(),
    )
}

fn push(m: &mut Map, key: &str, v: Value) {
    let mut items = match m.remove(key) {
        Some(Value::List(l)) => l,
        _ => Vec::new(),
    };
    items.push(v);
    m.insert(key, Value::List(items));
}

fn palette(f: &Doc) -> Value {
    let mut palette = Map::new();
    for (name, value) in f.palette.iter() {
        let mut color = Map::new();
        color.insert("color", value.as_str().into());
        if let Some(refs) = f.color_refs.get(name) {
            for r in refs {
                if r.other {
                    let mut rm = Map::new();
                    rm.insert("system", r.system.as_str().into());
                    rm.insert("value", r.value.as_str().into());
                    push(&mut color, "reference", rm.into());
                } else if r.system == "cmyk" {
                    color.insert("cmyk", numbers(&r.numbers));
                } else if r.system == "dye" {
                    push(&mut color, "dye", r.value.as_str().into());
                } else {
                    color.insert(r.system.as_str(), r.value.as_str().into());
                }
            }
        }
        palette.insert(name.clone(), color.into());
    }
    for (name, g) in f.gradients.iter() {
        let mut gradient = Map::new();
        gradient.insert("gradient", strings(&g.colors));
        gradient.insert("stops", numbers(&g.stops));
        if g.along != "fly" {
            gradient.insert("along", g.along.as_str().into());
        }
        palette.insert(name.clone(), gradient.into());
    }
    palette.into()
}

fn border(e: &Edge, outside: bool) -> Value {
    let mut m = edge_map(e);
    if outside {
        m.insert("side", "outside".into());
    }
    m.into()
}

fn edge_map(e: &Edge) -> Map {
    let mut m = Map::new();
    m.insert("color", e.color.as_str().into());
    m.insert("width", e.width.into());
    m
}

fn outline(o: &Outline) -> Value {
    let mut m = Map::new();
    m.insert("form", o.kind.as_str().into());
    match o.kind.as_str() {
        "polygon" => m.insert("point", points(&o.vertices)),
        "path" => {
            m.insert("d", o.d.as_str().into());
            m.insert("box", numbers(&o.bx));
        }
        _ => {
            number(&mut m, "depth", o.depth, 0.0);
            number(&mut m, "taper", o.taper, 0.0);
            number(&mut m, "tongue", o.tongue, 0.0);
            number(&mut m, "tip", o.tip, 0.0);
        }
    }
    m.into()
}

fn points(points: &[Point]) -> Value {
    Value::List(points.iter().map(point).collect())
}

fn define(d: &Define) -> Value {
    if let Some(s) = &d.shape {
        return shape(s).into();
    }
    let mut m = Map::new();
    m.insert("layers", layers(&d.layers));
    if d.fly != 0.0 {
        m.insert("proportion", proportion(d.hoist, d.fly));
    }
    m.into()
}

fn adapt(a: &Adapt) -> Value {
    let mut m = Map::new();
    if a.max != 0.0 {
        m.insert("range", numbers(&[a.min, a.max]));
    }
    text(&mut m, "wider", &a.wider);
    text(&mut m, "narrower", &a.narrower);
    m.into()
}

fn variant(v: &Variant) -> Value {
    let mut m = Map::new();
    if v.from != "none" {
        m.insert("from", v.from.as_str().into());
    }
    flag(&mut m, "upright", v.upright);
    number(&mut m, "ratio", v.ratio, 0.0);
    if v.fly != 0.0 {
        m.insert("proportion", proportion(v.hoist, v.fly));
    }
    if let Some(o) = &v.outline {
        m.insert("outline", outline(o));
    }
    if let Some(b) = &v.border {
        m.insert("border", border(b, v.border_outside));
    }
    if !v.layers.is_empty() {
        m.insert("layers", layers(&v.layers));
    }
    m.into()
}

fn fold(f: &Fold) -> Value {
    let mut m = Map::new();
    text(&mut m, "description", &f.description);
    list(&mut m, "source", &f.sources);
    let steps = f
        .steps
        .iter()
        .map(|s| {
            let mut step = Map::new();
            step.insert("step", s.kind.as_str().into());
            if let (Some(through), Some(to)) = (&s.through, &s.move_to) {
                step.insert("through", numbers(through));
                step.insert("move", numbers(to));
            } else {
                step.insert("along", s.along.as_str().into());
                step.insert("at", s.at.into());
                step.insert("move", s.mv.as_str().into());
            }
            step.into()
        })
        .collect();
    m.insert("steps", Value::List(steps));
    m.into()
}

pub(crate) fn layers(layers: &[Layer]) -> Value {
    Value::List(layers.iter().map(layer).collect())
}

fn effects(m: &mut Map, e: &Effects) {
    text(m, "anchor", &e.anchor);
    number(m, "opacity", e.opacity, 1.0);
    if e.blend != "normal" {
        m.insert("blend", e.blend.as_str().into());
    }
    if let Some(c) = &e.clip {
        m.insert("clip", shape(c).into());
    }
    if !e.cuts.is_empty() {
        m.insert(
            "cut",
            Value::List(e.cuts.iter().map(|s| shape(s).into()).collect()),
        );
    }
}

fn along(m: &mut Map, along: &str) {
    if along != "fly" {
        m.insert("along", along.into());
    }
}

fn fimbriate(m: &mut Map, e: &Option<Edge>) {
    if let Some(e) = e {
        m.insert("fimbriate", edge_map(e).into());
    }
}

fn line(m: &mut Map, l: &Option<Line>) {
    let Some(l) = l else {
        return;
    };
    let mut edge = Map::new();
    edge.insert("form", l.kind.as_str().into());
    edge.insert("depth", l.depth.into());
    number(&mut edge, "period", l.period, 0.0);
    if l.count != 0 {
        edge.insert("count", l.count.into());
    }
    m.insert("edge", edge.into());
}

fn layer(l: &Layer) -> Value {
    let mut m = Map::new();
    effects(&mut m, &l.fx);
    match &l.kind {
        LayerKind::Field(t) => {
            m.insert("layer", "field".into());
            m.insert("color", t.color.as_str().into());
        }
        LayerKind::Bars(t) => {
            m.insert("layer", "bars".into());
            m.insert("colors", strings(&t.colors));
            m.insert("ratio", numbers(&t.ratio));
            along(&mut m, &t.along);
            number(&mut m, "rotate", t.rotate, 0.0);
            if let Some(g) = &t.grow {
                m.insert("grow", numbers(g));
            }
            line(&mut m, &t.line);
        }
        LayerKind::Chevrons(t) => {
            m.insert("layer", "chevrons".into());
            m.insert("colors", strings(&t.colors));
            m.insert("ratio", numbers(&t.ratio));
            m.insert("depth", t.depth.into());
            if t.from != "hoist" {
                m.insert("from", t.from.as_str().into());
            }
            number(&mut m, "angle", t.angle, 0.0);
            if let Some(a) = t.apex {
                m.insert("apex", a.into());
            }
            number(&mut m, "rotate", t.rotate, 0.0);
            fimbriate(&mut m, &t.fimbriate);
        }
        LayerKind::Band(t) => {
            m.insert("layer", "band".into());
            m.insert("color", t.color.as_str().into());
            m.insert("width", t.width.into());
            along(&mut m, &t.along);
            number(&mut m, "offset", t.offset, 0.0);
            number(&mut m, "rotate", t.rotate, 0.0);
            fimbriate(&mut m, &t.fimbriate);
        }
        LayerKind::Cross(t) => {
            m.insert("layer", "cross".into());
            m.insert("color", t.color.as_str().into());
            m.insert("fly", numbers(&t.fly_parts));
            m.insert("hoist", numbers(&t.hoist_parts));
            fimbriate(&mut m, &t.fimbriate);
        }
        LayerKind::Saltire(t) => {
            m.insert("layer", "saltire".into());
            m.insert("color", t.color.as_str().into());
            m.insert("width", t.width.into());
            fimbriate(&mut m, &t.fimbriate);
            flag(&mut m, "counterchange", t.counterchange);
        }
        LayerKind::Quarters(t) => {
            m.insert("layer", "quarters".into());
            m.insert("colors", strings(&t.colors));
            flag(&mut m, "diagonal", t.diagonal);
            some_point(&mut m, "split", &t.split);
        }
        LayerKind::Checks(t) => {
            m.insert("layer", "checks".into());
            m.insert("colors", strings(&t.colors));
            m.insert("rows", t.rows.into());
            m.insert("columns", t.columns.into());
            if t.flow != "bend-sinister" {
                m.insert("flow", t.flow.as_str().into());
            }
        }
        LayerKind::Rays(t) => {
            m.insert("layer", "rays".into());
            m.insert("colors", strings(&t.colors));
            m.insert("ratio", numbers(&t.ratio));
            if let Some(at) = &t.at {
                m.insert("from", point(at));
            } else if t.from != "center" {
                m.insert("from", t.from.as_str().into());
            }
            number(&mut m, "rotate", t.rotate, 0.0);
            if t.by_edge {
                m.insert("measure", "edge".into());
            }
        }
        LayerKind::Charge(c) => charge(&mut m, c),
        LayerKind::Emblem(t) => {
            m.insert("layer", "emblem".into());
            some_point(&mut m, "at", &t.at);
            if !t.along.is_empty() {
                m.insert("along", t.along.as_str().into());
            }
            number(&mut m, "rotate", t.rotate, 0.0);
            m.insert("layers", layers(&t.charges));
        }
        LayerKind::Group(g) => {
            m.insert("layer", "group".into());
            m.insert("layers", layers(&g.layers));
        }
        LayerKind::Panel(t) => {
            m.insert("layer", "panel".into());
            m.insert("layers", layers(&t.layers));
            if t.canton {
                m.insert("layer", "canton".into());
                m.insert("fly", t.fly.into());
                m.insert("hoist", t.hoist.into());
            } else {
                text(&mut m, "side", &t.side);
                number(&mut m, "width", t.width, 0.0);
                text(&mut m, "corner", &t.corner);
                some_point(&mut m, "at", &t.at);
                number(&mut m, "fly", t.fly, 0.0);
                number(&mut m, "hoist", t.hoist, 0.0);
                line(&mut m, &t.line);
            }
        }
        LayerKind::Use(u) => {
            m.insert("layer", "use".into());
            m.insert("name", u.name.as_str().into());
        }
    }
    m.into()
}

fn charge(m: &mut Map, c: &Charge) {
    for (k, v) in shape(&c.shape).iter() {
        m.insert(k, v.clone());
    }
    m.insert("layer", "charge".into());
    // A pile or pall is a layer of its own, so it has no shape to name.
    if c.shape.kind == "pile" || c.shape.kind == "pall" {
        m.insert("layer", c.shape.kind.as_str().into());
        m.remove("shape");
    }
    text(m, "color", &c.color);
    fimbriate(m, &c.fimbriate);
    if let Some(r) = &c.repeat {
        let mut repeat = Map::new();
        repeat.insert("form", r.kind.as_str().into());
        match r.kind.as_str() {
            "ring" | "arc" => {
                repeat.insert("count", r.count.into());
                repeat.insert("radius", r.radius.into());
                flag(&mut repeat, "turn", r.turn);
                if r.kind == "arc" {
                    repeat.insert("from", r.from.into());
                    repeat.insert("to", r.to.into());
                }
            }
            "grid" => {
                repeat.insert("rows", r.rows.into());
                repeat.insert("columns", r.columns.into());
                flag(&mut repeat, "stagger", r.stagger);
            }
            "line" => {
                repeat.insert("count", r.count.into());
                number(&mut repeat, "fly", r.fly, 0.0);
                number(&mut repeat, "hoist", r.hoist, 0.0);
            }
            _ => {}
        }
        m.insert("repeat", repeat.into());
    }
}

pub(crate) fn shape(s: &Shape) -> Map {
    let mut m = Map::new();
    m.insert("shape", s.kind.as_str().into());
    if s.ats.len() > 1 || (s.ats.len() == 1 && s.ats[0].is_some()) {
        let at = s
            .ats
            .iter()
            .map(|p| match p {
                None => "center".into(),
                Some(p) => point(p),
            })
            .collect();
        m.insert("at", Value::List(at));
    } else if s.ats.is_empty()
        && let Some(at) = &s.at
    {
        m.insert("at", Value::List(vec![point(at)]));
    }
    number(&mut m, "rotate", s.rotate, 0.0);
    number(&mut m, "hollow", s.hollow, 0.0);
    match s.kind.as_str() {
        "disc" | "triangle" | "cardioid" => m.insert("radius", s.radius.into()),
        "ellipse" | "rect" | "lozenge" => {
            number(&mut m, "fly", s.fly, 0.0);
            number(&mut m, "hoist", s.hoist, 0.0);
        }
        "ring" => {
            m.insert("radius", s.radius.into());
            m.insert("inner", s.inner.into());
            if s.has_arc {
                m.insert("from", s.from.into());
                m.insert("to", s.to.into());
            }
        }
        "plus" => {
            m.insert("radius", s.radius.into());
            m.insert("width", s.width.into());
        }
        "star" => {
            m.insert("radius", s.radius.into());
            m.insert("inner", s.inner.into());
            if s.points != 5 {
                m.insert("points", s.points.into());
            }
            number(&mut m, "lines", s.lines, 0.0);
        }
        "crescent" => {
            m.insert("radius", s.radius.into());
            m.insert("inner", s.inner.into());
            m.insert("offset", s.offset.into());
        }
        "sun" => {
            m.insert("radius", s.radius.into());
            m.insert("disc", s.disc.into());
            number(&mut m, "gap", s.gap, 0.0);
            if s.points != 12 {
                m.insert("points", s.points.into());
            }
            number(&mut m, "spread", s.spread, 1.0);
        }
        "heart" => {
            m.insert("radius", s.radius.into());
            m.insert("spread", s.spread.into());
        }
        "path" => {
            m.insert("d", s.d.as_str().into());
            m.insert("box", numbers(&s.bx));
            number(&mut m, "fly", s.fly, 0.0);
            number(&mut m, "hoist", s.hoist, 0.0);
            flag(&mut m, "evenodd", s.even_odd);
        }
        "polygon" => m.insert("point", points(&s.vertices)),
        "pile" => {
            if s.edge != "hoist" {
                m.insert("from", s.edge.as_str().into());
            }
            if let Some(b) = &s.base {
                m.insert("base", numbers(b));
            }
            if let Some(t) = &s.tip {
                m.insert("tip", numbers(t));
            }
            number(&mut m, "depth", s.depth, 0.0);
            number(&mut m, "flat", s.flat, 0.0);
        }
        "pall" => {
            if s.edge != "hoist" {
                m.insert("from", s.edge.as_str().into());
            }
            m.insert("width", s.width.into());
            number(&mut m, "junction", s.junction, 0.0);
        }
        "svg" => {
            m.insert("fly", s.fly.into());
            m.insert("hoist", s.hoist.into());
            m.insert("markup", s.markup.as_str().into());
        }
        _ => {}
    }
    m
}
