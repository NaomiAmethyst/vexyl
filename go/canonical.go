// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package vexyl

// The canonical model, as SDK section 4 defines it and conformance/model.schema.json
// writes it out. Names are the format's own terms. A value is left out only if it equals
// the format's default, so a zero that means something stays.

type object = map[string]any

// Model returns the flag as plain maps, lists and values, in the canonical form that the
// conformance suite compares.
func (f *Flag) Model() any {
	m := object{
		"vexyl":      f.Version,
		"meta":       modelMeta(&f.Meta),
		"palette":    f.modelPalette(),
		"proportion": object{"hoist": f.Hoist, "fly": f.Fly},
	}
	if f.Outline != nil {
		m["outline"] = modelOutline(f.Outline)
	}
	if f.Border != nil {
		m["border"] = modelBorder(f.Border, f.BorderOutside)
	}
	if len(f.Defines) > 0 {
		defines := object{}
		for name, d := range f.Defines {
			defines[name] = modelDefine(d)
		}
		m["define"] = defines
	}
	if len(f.Layers) > 0 {
		m["layers"] = modelLayers(f.Layers)
	}
	if f.Reverse != nil {
		m["reverse"] = object{"layers": modelLayers(f.Reverse.Layers)}
	}
	if f.Adapt != nil {
		m["adapt"] = modelAdapt(f.Adapt)
	}
	if len(f.Variants) > 0 {
		variants := object{}
		for name, v := range f.Variants {
			variants[name] = modelVariant(v)
		}
		m["variant"] = variants
	}
	if len(f.Folds) > 0 {
		folds := object{}
		for name, fold := range f.Folds {
			folds[name] = modelFold(fold)
		}
		m["fold"] = folds
	}
	return m
}

func setText(m object, key, value string) {
	if value != "" {
		m[key] = value
	}
}

// setNumber leaves out a number that equals its default.
func setNumber(m object, key string, value, otherwise float64) {
	if value != otherwise {
		m[key] = value
	}
}

func setList(m object, key string, values []string) {
	if len(values) > 0 {
		m[key] = texts(values)
	}
}

func setFlag(m object, key string, value bool) {
	if value {
		m[key] = true
	}
}

func setPoint(m object, key string, p *Point) {
	if p != nil {
		m[key] = modelPoint(*p)
	}
}

func modelPoint(p Point) object { return object{"fly": p.Fly, "hoist": p.Hoist} }

func texts(values []string) []any {
	out := make([]any, len(values))
	for i, v := range values {
		out[i] = v
	}
	return out
}

func numbers(values []float64) []any {
	out := make([]any, len(values))
	for i, v := range values {
		out[i] = v
	}
	return out
}

func modelMeta(meta *Meta) object {
	m := object{"name": meta.Name}
	setText(m, "description", meta.Description)
	setText(m, "version", meta.Version)
	setText(m, "date", meta.Date)
	setText(m, "until", meta.Until)
	setText(m, "series", meta.Series)
	setList(m, "note", meta.Notes)
	if refs := modelReferences("law", meta.Laws); refs != nil {
		m["law"] = refs
	}
	if refs := modelReferences("restriction", meta.Restrictions); refs != nil {
		m["restriction"] = refs
	}
	setList(m, "designer", meta.Designers)
	setText(m, "design-rights", meta.DesignRights)
	setList(m, "encoder", meta.Encoders)
	setText(m, "license", meta.License)
	setText(m, "render-license", meta.RenderLicense)
	if len(meta.AdaptedFrom) > 0 {
		works := make([]any, len(meta.AdaptedFrom))
		for i, a := range meta.AdaptedFrom {
			work := object{"url": a.URL}
			setList(work, "author", a.Authors)
			setText(work, "license", a.License)
			setText(work, "part", a.Part)
			works[i] = work
		}
		m["adapted-from"] = works
	}
	setList(m, "source", meta.Sources)
	return m
}

func modelReferences(node string, refs []Reference) []any {
	if len(refs) == 0 {
		return nil
	}
	out := make([]any, len(refs))
	for i, r := range refs {
		ref := object{node: r.Text}
		setList(ref, "source", r.Sources)
		out[i] = ref
	}
	return out
}

func (f *Flag) modelPalette() object {
	palette := object{}
	for name, value := range f.Palette {
		color := object{"color": value}
		for _, ref := range f.ColorRefs[name] {
			switch {
			case ref.Other:
				others, _ := color["reference"].([]any)
				color["reference"] = append(others, object{"system": ref.System, "value": ref.Value})
			case ref.System == "cmyk":
				color["cmyk"] = numbers(ref.Numbers)
			case ref.System == "dye":
				dyes, _ := color["dye"].([]any)
				color["dye"] = append(dyes, ref.Value)
			default:
				color[ref.System] = ref.Value
			}
		}
		palette[name] = color
	}
	for name, g := range f.Gradients {
		gradient := object{"gradient": texts(g.Colors), "stops": numbers(g.Stops)}
		if g.Along != "fly" {
			gradient["along"] = g.Along
		}
		palette[name] = gradient
	}
	return palette
}

func modelBorder(e *Edge, outside bool) object {
	m := object{"color": e.Color, "width": e.Width}
	if outside {
		m["side"] = "outside"
	}
	return m
}

func modelEdge(e *Edge) object { return object{"color": e.Color, "width": e.Width} }

func modelOutline(o *Outline) object {
	m := object{"form": o.Kind}
	switch o.Kind {
	case "polygon":
		m["point"] = modelPoints(o.Vertices)
	case "path":
		m["d"] = o.D
		m["box"] = numbers(o.Box[:])
	default:
		setNumber(m, "depth", o.Depth, 0)
		setNumber(m, "taper", o.Taper, 0)
		setNumber(m, "tongue", o.Tongue, 0)
		setNumber(m, "tip", o.Tip, 0)
	}
	return m
}

func modelPoints(points []Point) []any {
	out := make([]any, len(points))
	for i, p := range points {
		out[i] = modelPoint(p)
	}
	return out
}

func modelDefine(d *Define) object {
	if d.Shape != nil {
		return modelShape(d.Shape)
	}
	m := object{"layers": modelLayers(d.Layers)}
	if d.Fly != 0 {
		m["proportion"] = object{"hoist": d.Hoist, "fly": d.Fly}
	}
	return m
}

func modelAdapt(a *Adapt) object {
	m := object{}
	if a.Max != 0 {
		m["range"] = []any{a.Min, a.Max}
	}
	setText(m, "wider", a.Wider)
	setText(m, "narrower", a.Narrower)
	return m
}

func modelVariant(v *Variant) object {
	m := object{}
	if v.From != "none" {
		m["from"] = v.From
	}
	setFlag(m, "upright", v.Upright)
	setNumber(m, "ratio", v.Ratio, 0)
	if v.Fly != 0 {
		m["proportion"] = object{"hoist": v.Hoist, "fly": v.Fly}
	}
	if v.Outline != nil {
		m["outline"] = modelOutline(v.Outline)
	}
	if v.Border != nil {
		m["border"] = modelBorder(v.Border, v.BorderOutside)
	}
	if len(v.Layers) > 0 {
		m["layers"] = modelLayers(v.Layers)
	}
	return m
}

func modelFold(f *Fold) object {
	m := object{}
	setText(m, "description", f.Description)
	setList(m, "source", f.Sources)
	steps := make([]any, len(f.Steps))
	for i, s := range f.Steps {
		step := object{"step": s.Kind}
		if s.Through != nil {
			step["through"] = numbers(s.Through)
			step["move"] = numbers(s.MoveTo)
		} else {
			step["along"], step["at"], step["move"] = s.Along, s.At, s.Move
		}
		steps[i] = step
	}
	m["steps"] = steps
	return m
}

func modelLayers(layers []Layer) []any {
	out := make([]any, len(layers))
	for i, l := range layers {
		out[i] = modelLayer(l)
	}
	return out
}

func modelEffects(m object, e *Effects) {
	setText(m, "anchor", e.Anchor)
	setNumber(m, "opacity", e.Opacity, 1)
	if e.Blend != "normal" {
		m["blend"] = e.Blend
	}
	if e.Clip != nil {
		m["clip"] = modelShape(e.Clip)
	}
	if len(e.Cuts) > 0 {
		cuts := make([]any, len(e.Cuts))
		for i := range e.Cuts {
			cuts[i] = modelShape(&e.Cuts[i])
		}
		m["cut"] = cuts
	}
}

func setAlong(m object, along string) {
	if along != "fly" {
		m["along"] = along
	}
}

func setFimbriate(m object, e *Edge) {
	if e != nil {
		m["fimbriate"] = modelEdge(e)
	}
}

func setLine(m object, l *Line) {
	if l == nil {
		return
	}
	edge := object{"form": l.Kind, "depth": l.Depth}
	setNumber(edge, "period", l.Period, 0)
	if l.Count != 0 {
		edge["count"] = l.Count
	}
	m["edge"] = edge
}

func modelLayer(l Layer) object {
	m := object{}
	modelEffects(m, l.effects())
	switch t := l.(type) {
	case *Field:
		m["layer"], m["color"] = "field", t.Color
	case *Bars:
		m["layer"], m["colors"], m["ratio"] = "bars", texts(t.Colors), numbers(t.Ratio)
		setAlong(m, t.Along)
		setNumber(m, "rotate", t.Rotate, 0)
		if t.Grow != nil {
			m["grow"] = numbers(t.Grow)
		}
		setLine(m, t.Line)
	case *Chevrons:
		m["layer"], m["colors"], m["ratio"], m["depth"] = "chevrons", texts(t.Colors), numbers(t.Ratio), t.Depth
		if t.From != "hoist" {
			m["from"] = t.From
		}
		setNumber(m, "angle", t.Angle, 0)
		if t.Apex != nil {
			m["apex"] = *t.Apex
		}
		setNumber(m, "rotate", t.Rotate, 0)
		setFimbriate(m, t.Fimbriate)
	case *Band:
		m["layer"], m["color"], m["width"] = "band", t.Color, t.Width
		setAlong(m, t.Along)
		setNumber(m, "offset", t.Offset, 0)
		setNumber(m, "rotate", t.Rotate, 0)
		setFimbriate(m, t.Fimbriate)
	case *Cross:
		m["layer"], m["color"], m["fly"], m["hoist"] = "cross", t.Color, numbers(t.FlyParts[:]), numbers(t.HoistPart[:])
		setFimbriate(m, t.Fimbriate)
	case *Saltire:
		m["layer"], m["color"], m["width"] = "saltire", t.Color, t.Width
		setFimbriate(m, t.Fimbriate)
		setFlag(m, "counterchange", t.Counterchange)
	case *Quarters:
		m["layer"], m["colors"] = "quarters", texts(t.Colors[:])
		setFlag(m, "diagonal", t.Diagonal)
		setPoint(m, "split", t.Split)
	case *Checks:
		m["layer"], m["colors"], m["rows"], m["columns"] = "checks", texts(t.Colors), t.Rows, t.Columns
		if t.Flow != "bend-sinister" {
			m["flow"] = t.Flow
		}
	case *Rays:
		m["layer"], m["colors"], m["ratio"] = "rays", texts(t.Colors), numbers(t.Ratio)
		switch {
		case t.At != nil:
			m["from"] = modelPoint(*t.At)
		case t.From != "center":
			m["from"] = t.From
		}
		setNumber(m, "rotate", t.Rotate, 0)
		if t.ByEdge {
			m["measure"] = "edge"
		}
	case *Charge:
		modelCharge(m, t)
	case *Emblem:
		m["layer"] = "emblem"
		setPoint(m, "at", t.At)
		if t.Along != "" {
			m["along"] = t.Along
		}
		setNumber(m, "rotate", t.Rotate, 0)
		charges := make([]any, len(t.Charges))
		for i, c := range t.Charges {
			charges[i] = modelLayer(c)
		}
		m["layers"] = charges
	case *Group:
		m["layer"], m["layers"] = "group", modelLayers(t.Layers)
	case *Panel:
		m["layer"], m["layers"] = "panel", modelLayers(t.Layers)
		if t.Canton {
			m["layer"] = "canton"
			m["fly"], m["hoist"] = t.Fly, t.Hoist
			break
		}
		setText(m, "side", t.Side)
		setNumber(m, "width", t.Width, 0)
		setText(m, "corner", t.Corner)
		setPoint(m, "at", t.At)
		setNumber(m, "fly", t.Fly, 0)
		setNumber(m, "hoist", t.Hoist, 0)
		setLine(m, t.Line)
	case *Use:
		m["layer"], m["name"] = "use", t.Name
	}
	return m
}

func modelCharge(m object, c *Charge) {
	for key, value := range modelShape(&c.Shape) {
		m[key] = value
	}
	m["layer"] = "charge"
	// A pile or pall is a layer of its own, so it has no shape to name.
	if c.Shape.Kind == "pile" || c.Shape.Kind == "pall" {
		m["layer"] = c.Shape.Kind
		delete(m, "shape")
	}
	setText(m, "color", c.Color)
	setFimbriate(m, c.Fimbriate)
	if r := c.Repeat; r != nil {
		repeat := object{"form": r.Kind}
		switch r.Kind {
		case "ring", "arc":
			repeat["count"], repeat["radius"] = r.Count, r.Radius
			setFlag(repeat, "turn", r.Turn)
			if r.Kind == "arc" {
				repeat["from"], repeat["to"] = r.From, r.To
			}
		case "grid":
			repeat["rows"], repeat["columns"] = r.Rows, r.Columns
			setFlag(repeat, "stagger", r.Stagger)
		case "line":
			repeat["count"] = r.Count
			setNumber(repeat, "fly", r.Fly, 0)
			setNumber(repeat, "hoist", r.Hoist, 0)
		}
		m["repeat"] = repeat
	}
}

func modelShape(s *Shape) object {
	m := object{"shape": s.Kind}
	switch {
	case len(s.Ats) > 1 || (len(s.Ats) == 1 && s.Ats[0] != nil):
		at := make([]any, len(s.Ats))
		for i, p := range s.Ats {
			if p == nil {
				at[i] = "center"
			} else {
				at[i] = modelPoint(*p)
			}
		}
		m["at"] = at
	case len(s.Ats) == 0 && s.At != nil:
		m["at"] = []any{modelPoint(*s.At)}
	}
	setNumber(m, "rotate", s.Rotate, 0)
	setNumber(m, "hollow", s.Hollow, 0)
	switch s.Kind {
	case "disc", "triangle", "cardioid":
		m["radius"] = s.Radius
	case "ellipse", "rect", "lozenge":
		setNumber(m, "fly", s.Fly, 0)
		setNumber(m, "hoist", s.Hoist, 0)
	case "ring":
		m["radius"], m["inner"] = s.Radius, s.Inner
		if s.HasArc {
			m["from"], m["to"] = s.From, s.To
		}
	case "plus":
		m["radius"], m["width"] = s.Radius, s.Width
	case "star":
		m["radius"], m["inner"] = s.Radius, s.Inner
		if s.Points != 5 {
			m["points"] = s.Points
		}
		setNumber(m, "lines", s.Lines, 0)
	case "crescent":
		m["radius"], m["inner"], m["offset"] = s.Radius, s.Inner, s.Offset
	case "sun":
		m["radius"], m["disc"] = s.Radius, s.Disc
		setNumber(m, "gap", s.Gap, 0)
		if s.Points != 12 {
			m["points"] = s.Points
		}
		setNumber(m, "spread", s.Spread, 1)
	case "heart":
		m["radius"], m["spread"] = s.Radius, s.Spread
	case "path":
		m["d"], m["box"] = s.D, numbers(s.Box[:])
		setNumber(m, "fly", s.Fly, 0)
		setNumber(m, "hoist", s.Hoist, 0)
		setFlag(m, "evenodd", s.EvenOdd)
	case "polygon":
		m["point"] = modelPoints(s.Vertices)
	case "pile":
		if s.Edge != "hoist" {
			m["from"] = s.Edge
		}
		if s.Base != nil {
			m["base"] = numbers(s.Base[:])
		}
		if s.Tip != nil {
			m["tip"] = numbers(s.Tip[:])
		}
		setNumber(m, "depth", s.Depth, 0)
		setNumber(m, "flat", s.Flat, 0)
	case "pall":
		if s.Edge != "hoist" {
			m["from"] = s.Edge
		}
		m["width"] = s.Width
		setNumber(m, "junction", s.Junction, 0)
	case "svg":
		m["fly"], m["hoist"], m["markup"] = s.Fly, s.Hoist, s.Markup
	}
	return m
}
