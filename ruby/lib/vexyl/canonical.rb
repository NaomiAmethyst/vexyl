# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # Gives a flag as plain data, in the canonical form of section 4 of the SDK: a value is left
  # out if, and only if, it equals the format's default, and what depends on other values is
  # worked out.
  module Canonical
    module_function

    def model(f)
      m = {}
      m["vexyl"] = f.version
      m["meta"] = meta(f.meta)
      m["palette"] = palette(f)
      m["proportion"] = proportion(f.hoist, f.fly)
      m["outline"] = outline(f.outline) if f.outline
      m["border"] = border(f.border, f.border_outside) if f.border
      m["define"] = f.defines.to_h { |name, d| [name, define(d)] } unless f.defines.empty?
      m["layers"] = layers(f.layers) unless f.layers.empty?
      m["reverse"] = { "layers" => layers(f.reverse.layers) } if f.reverse
      m["adapt"] = adapt(f.adapt) if f.adapt
      m["variant"] = f.variants.to_h { |name, v| [name, variant(v)] } unless f.variants.empty?
      m["fold"] = f.folds.to_h { |name, fold| [name, fold(fold)] } unless f.folds.empty?
      deep_freeze(m)
    end

    # Makes the model's hashes, arrays and strings unchangeable, all the way down.
    def deep_freeze(value)
      case value
      when Hash then value.each_value { |v| deep_freeze(v) }
      when Array then value.each { |v| deep_freeze(v) }
      end
      value.freeze
    end

    def proportion(hoist, fly)
      { "hoist" => hoist, "fly" => fly }
    end

    def text(m, key, value)
      m[key] = value if value && !value.empty?
    end

    # Leaves out a number that equals its default.
    def number(m, key, value, otherwise)
      m[key] = value if value != otherwise
    end

    def list(m, key, values)
      m[key] = values.dup unless values.empty?
    end

    def flag(m, key, value)
      m[key] = true if value
    end

    def point_in(m, key, p)
      m[key] = point(p) if p
    end

    def point(p)
      { "fly" => p.fly, "hoist" => p.hoist }
    end

    def numbers(values)
      values.dup
    end

    def meta(meta)
      m = { "name" => meta.name }
      text(m, "description", meta.description)
      text(m, "version", meta.version)
      text(m, "date", meta.date)
      text(m, "until", meta.until)
      text(m, "series", meta.series)
      list(m, "note", meta.notes)
      m["law"] = references("law", meta.laws) unless meta.laws.empty?
      m["restriction"] = references("restriction", meta.restrictions) unless meta.restrictions.empty?
      list(m, "designer", meta.designers)
      text(m, "design-rights", meta.design_rights)
      list(m, "encoder", meta.encoders)
      text(m, "license", meta.license)
      text(m, "render-license", meta.render_license)
      unless meta.adapted_from.empty?
        m["adapted-from"] = meta.adapted_from.map do |a|
          work = { "url" => a.url }
          list(work, "author", a.authors)
          text(work, "license", a.license)
          text(work, "part", a.part)
          work
        end
      end
      list(m, "source", meta.sources)
      m
    end

    def references(node, refs)
      refs.map do |r|
        ref = { node => r.text }
        list(ref, "source", r.sources)
        ref
      end
    end

    def palette(f)
      palette = {}
      f.palette.each do |name, value|
        color = { "color" => value }
        (f.color_refs[name] || []).each do |ref|
          if ref.other
            (color["reference"] ||= []) << { "system" => ref.system, "value" => ref.value }
          elsif ref.system == "cmyk"
            color["cmyk"] = numbers(ref.numbers)
          elsif ref.system == "dye"
            (color["dye"] ||= []) << ref.value
          else
            color[ref.system] = ref.value
          end
        end
        palette[name] = color
      end
      f.gradients.each do |name, g|
        gradient = { "gradient" => g.colors.dup, "stops" => numbers(g.stops) }
        gradient["along"] = g.along if g.along != "fly"
        palette[name] = gradient
      end
      palette
    end

    def border(e, outside)
      m = edge(e)
      m["side"] = "outside" if outside
      m
    end

    def edge(e)
      { "color" => e.color, "width" => e.width }
    end

    def outline(o)
      m = { "form" => o.kind }
      case o.kind
      when "polygon"
        m["point"] = points(o.vertices)
      when "path"
        m["d"] = o.d
        m["box"] = numbers(o.box)
      else
        number(m, "depth", o.depth, 0)
        number(m, "taper", o.taper, 0)
        number(m, "tongue", o.tongue, 0)
        number(m, "tip", o.tip, 0)
      end
      m
    end

    def points(points)
      points.map { |p| point(p) }
    end

    def define(d)
      return shape(d.shape) if d.shape
      m = { "layers" => layers(d.layers) }
      m["proportion"] = proportion(d.hoist, d.fly) if d.fly != 0
      m
    end

    def adapt(a)
      m = {}
      m["range"] = [a.min, a.max] if a.max != 0
      text(m, "wider", a.wider)
      text(m, "narrower", a.narrower)
      m
    end

    def variant(v)
      m = {}
      m["from"] = v.from if v.from != "none"
      flag(m, "upright", v.upright)
      number(m, "ratio", v.ratio, 0)
      m["proportion"] = proportion(v.hoist, v.fly) if v.fly != 0
      m["outline"] = outline(v.outline) if v.outline
      m["border"] = border(v.border, v.border_outside) if v.border
      m["layers"] = layers(v.layers) unless v.layers.empty?
      m
    end

    def fold(f)
      m = {}
      text(m, "description", f.description)
      list(m, "source", f.sources)
      m["steps"] = f.steps.map do |s|
        step = { "step" => s.kind }
        if s.through
          step["through"] = numbers(s.through)
          step["move"] = numbers(s.move_to)
        else
          step["along"] = s.along
          step["at"] = s.at
          step["move"] = s.move
        end
        step
      end
      m
    end

    def layers(layers)
      layers.map { |l| layer(l) }
    end

    def effects(m, e)
      text(m, "anchor", e.anchor)
      number(m, "opacity", e.opacity, 1)
      m["blend"] = e.blend if e.blend != "normal"
      m["clip"] = shape(e.clip) if e.clip
      m["cut"] = e.cuts.map { |s| shape(s) } unless e.cuts.empty?
    end

    def along(m, along)
      m["along"] = along if along != "fly"
    end

    def fimbriate(m, e)
      m["fimbriate"] = edge(e) if e
    end

    def line(m, l)
      return if l.nil?
      edge = { "form" => l.kind, "depth" => l.depth }
      number(edge, "period", l.period, 0)
      edge["count"] = l.count if l.count != 0
      m["edge"] = edge
    end

    def layer(l)
      m = {}
      effects(m, l)
      case l
      when Model::Field
        m["layer"] = "field"
        m["color"] = l.color
      when Model::Bars
        m["layer"] = "bars"
        m["colors"] = l.colors.dup
        m["ratio"] = numbers(l.ratio)
        along(m, l.along)
        number(m, "rotate", l.rotate, 0)
        m["grow"] = numbers(l.grow) if l.grow
        line(m, l.line)
      when Model::Chevrons
        m["layer"] = "chevrons"
        m["colors"] = l.colors.dup
        m["ratio"] = numbers(l.ratio)
        m["depth"] = l.depth
        m["from"] = l.from if l.from != "hoist"
        number(m, "angle", l.angle, 0)
        m["apex"] = l.apex unless l.apex.nil?
        number(m, "rotate", l.rotate, 0)
        fimbriate(m, l.fimbriate)
      when Model::Band
        m["layer"] = "band"
        m["color"] = l.color
        m["width"] = l.width
        along(m, l.along)
        number(m, "offset", l.offset, 0)
        number(m, "rotate", l.rotate, 0)
        fimbriate(m, l.fimbriate)
      when Model::Cross
        m["layer"] = "cross"
        m["color"] = l.color
        m["fly"] = numbers(l.fly_parts)
        m["hoist"] = numbers(l.hoist_parts)
        fimbriate(m, l.fimbriate)
      when Model::Saltire
        m["layer"] = "saltire"
        m["color"] = l.color
        m["width"] = l.width
        fimbriate(m, l.fimbriate)
        flag(m, "counterchange", l.counterchange)
      when Model::Quarters
        m["layer"] = "quarters"
        m["colors"] = l.colors.dup
        flag(m, "diagonal", l.diagonal)
        point_in(m, "split", l.split)
      when Model::Checks
        m["layer"] = "checks"
        m["colors"] = l.colors.dup
        m["rows"] = l.rows
        m["columns"] = l.columns
        m["flow"] = l.flow if l.flow != "bend-sinister"
      when Model::Rays
        m["layer"] = "rays"
        m["colors"] = l.colors.dup
        m["ratio"] = numbers(l.ratio)
        if l.at
          m["from"] = point(l.at)
        elsif l.from != "center"
          m["from"] = l.from
        end
        number(m, "rotate", l.rotate, 0)
        m["measure"] = "edge" if l.by_edge
      when Model::Charge
        charge(m, l)
      when Model::Emblem
        m["layer"] = "emblem"
        point_in(m, "at", l.at)
        m["along"] = l.along unless l.along.empty?
        number(m, "rotate", l.rotate, 0)
        m["layers"] = layers(l.charges)
      when Model::Group
        m["layer"] = "group"
        m["layers"] = layers(l.layers)
      when Model::Panel
        m["layer"] = "panel"
        m["layers"] = layers(l.layers)
        if l.canton
          m["layer"] = "canton"
          m["fly"] = l.fly
          m["hoist"] = l.hoist
        else
          text(m, "side", l.side)
          number(m, "width", l.width, 0)
          text(m, "corner", l.corner)
          point_in(m, "at", l.at)
          number(m, "fly", l.fly, 0)
          number(m, "hoist", l.hoist, 0)
          line(m, l.line)
        end
      when Model::Use
        m["layer"] = "use"
        m["name"] = l.name
      end
      m
    end

    def charge(m, c)
      m.merge!(shape(c.shape))
      m["layer"] = "charge"
      # A pile or pall is a layer of its own, so it has no shape to name.
      if c.shape.kind == "pile" || c.shape.kind == "pall"
        m["layer"] = c.shape.kind
        m.delete("shape")
      end
      text(m, "color", c.color)
      fimbriate(m, c.fimbriate)
      r = c.repeat
      return if r.nil?
      repeat = { "form" => r.kind }
      case r.kind
      when "ring", "arc"
        repeat["count"] = r.count
        repeat["radius"] = r.radius
        flag(repeat, "turn", r.turn)
        if r.kind == "arc"
          repeat["from"] = r.from
          repeat["to"] = r.to
        end
      when "grid"
        repeat["rows"] = r.rows
        repeat["columns"] = r.columns
        flag(repeat, "stagger", r.stagger)
      when "line"
        repeat["count"] = r.count
        number(repeat, "fly", r.fly, 0)
        number(repeat, "hoist", r.hoist, 0)
      end
      m["repeat"] = repeat
    end

    def shape(s)
      m = { "shape" => s.kind }
      if s.ats.length > 1 || (s.ats.length == 1 && s.ats[0])
        m["at"] = s.ats.map { |p| p.nil? ? "center" : point(p) }
      elsif s.ats.empty? && s.at
        m["at"] = [point(s.at)]
      end
      number(m, "rotate", s.rotate, 0)
      number(m, "hollow", s.hollow, 0)
      case s.kind
      when "disc", "triangle", "cardioid"
        m["radius"] = s.radius
      when "ellipse", "rect", "lozenge"
        number(m, "fly", s.fly, 0)
        number(m, "hoist", s.hoist, 0)
      when "ring"
        m["radius"] = s.radius
        m["inner"] = s.inner
        if s.has_arc
          m["from"] = s.from
          m["to"] = s.to
        end
      when "plus"
        m["radius"] = s.radius
        m["width"] = s.width
      when "star"
        m["radius"] = s.radius
        m["inner"] = s.inner
        m["points"] = s.points if s.points != 5
        number(m, "lines", s.lines, 0)
      when "crescent"
        m["radius"] = s.radius
        m["inner"] = s.inner
        m["offset"] = s.offset
      when "sun"
        m["radius"] = s.radius
        m["disc"] = s.disc
        number(m, "gap", s.gap, 0)
        m["points"] = s.points if s.points != 12
        number(m, "spread", s.spread, 1)
      when "heart"
        m["radius"] = s.radius
        m["spread"] = s.spread
      when "path"
        m["d"] = s.d
        m["box"] = numbers(s.box)
        number(m, "fly", s.fly, 0)
        number(m, "hoist", s.hoist, 0)
        flag(m, "evenodd", s.even_odd)
      when "polygon"
        m["point"] = points(s.vertices)
      when "pile"
        m["from"] = s.edge if s.edge != "hoist"
        m["base"] = numbers(s.base) if s.base
        m["tip"] = numbers(s.tip) if s.tip
        number(m, "depth", s.depth, 0)
        number(m, "flat", s.flat, 0)
      when "pall"
        m["from"] = s.edge if s.edge != "hoist"
        m["width"] = s.width
        number(m, "junction", s.junction, 0)
      when "svg"
        m["fly"] = s.fly
        m["hoist"] = s.hoist
        m["markup"] = s.markup
      end
      m
    end
  end
end
