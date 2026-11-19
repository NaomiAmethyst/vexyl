# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

require "digest"
require "strscan"

module Vexyl
  # Renders a flag as SVG, as section 6 of the format paints it.
  class Render
    LOCAL_ID = /\A[A-Za-z_][A-Za-z0-9_.:-]*\z/
    # Parser::NO_COLOR, written out so this file doesn't depend on load order.
    NONE = "none"

    # How a flag's back turns in a variant, so that it's the mirror image of the turned front.
    REVERSE_TURN = {
      "none" => "none", "mirror" => "mirror", "half-turn" => "half-turn", "invert" => "invert",
      "transpose" => "anti-transpose", "anti-transpose" => "transpose",
      "rotate" => "counter-rotate", "counter-rotate" => "rotate"
    }.freeze

    SIDEWAYS = %w[rotate counter-rotate transpose anti-transpose].freeze

    # A flag with a side, a variant and a proportion applied, and how it's then shown.
    # canvas: the proportion to pad the result to, or 0.
    class Resolved
      attr_accessor :flag, :turn, :upright, :mirror, :canvas

      def initialize
        @flag = nil
        @turn = "none"
        @upright = false
        @mirror = false
        @canvas = 0.0
      end
    end

    attr_accessor :tagging, :scope_layers, :scope_border, :upright, :id_prefix
    attr_reader :out

    def initialize(flag, id_prefix)
      @flag = flag
      @out = +""
      @depth = 0
      @next_id = 0
      @gradients = {}
      # The transform that undoes a turned variant's rotation.
      @upright = ""
      @id_prefix = id_prefix
      # Marks each drawn element with the path of the layer that drew it.
      @tagging = false
      @scope_layers = ""
      @scope_border = ""
      # The path of the layer being drawn, and how many use layers it's inside.
      @tag = ""
      @using = 0
    end

    class << self
      def svg(original, opts)
        write(original, opts)
      rescue Shapes::Refusal => e
        raise Error, e.message
      end

      # Reads a render back as a tree of elements. Only a title or desc holds any text.
      def tree(svg)
        TreeReader.new(svg).element
      end

      # How a variant turns a flag, as a transform and what undoes it for charges.
      def view(kind, x0, y0, width, tall)
        num = Shapes.method(:num)
        case kind
        when "transpose"
          ["matrix(0 1 1 0 0 0)", "matrix(0 1 1 0 0 0)"]
        when "rotate"
          ["matrix(0 1 -1 0 #{num.(2 * y0 + tall)} 0)", "matrix(0 -1 1 0 0 0)"]
        when "anti-transpose"
          ["matrix(0 -1 -1 0 #{num.(2 * y0 + tall)} #{num.(2 * x0 + width)})", "matrix(0 -1 -1 0 0 0)"]
        when "counter-rotate"
          ["matrix(0 -1 1 0 0 #{num.(2 * x0 + width)})", "matrix(0 1 -1 0 0 0)"]
        when "mirror"
          ["matrix(-1 0 0 1 #{num.(2 * x0 + width)} 0)", "matrix(-1 0 0 1 0 0)"]
        when "half-turn"
          ["matrix(-1 0 0 -1 #{num.(2 * x0 + width)} #{num.(2 * y0 + tall)})", "matrix(-1 0 0 -1 0 0)"]
        when "invert"
          ["matrix(1 0 0 -1 0 #{num.(2 * y0 + tall)})", "matrix(1 0 0 -1 0 0)"]
        else
          ["", ""]
        end
      end

      # Where each copy of a charge goes, and how far it turns with its repeat, in painting order.
      def charge_places(c, s, reg)
        places = []
        at = Shapes.position(s, reg)
        r = c.repeat
        if s.ats.size > 1
          s.ats.each do |p|
            places << [p.nil? ? reg.center : Geometry::Vec.new(p.fly, p.hoist), 0.0]
          end
        elsif r.nil?
          places << [at, 0.0]
        elsif r.kind == "ring"
          r.count.times do |i|
            a = i * 360.0 / r.count
            places << [at.add(Geometry::Vec.new(0.0, -r.radius).rotate(a)), r.turn ? a : 0.0]
          end
        elsif r.kind == "arc"
          # Clockwise from one to the other, as a ring's own arc goes.
          span = (r.to - r.from).remainder(360)
          span += 360 if span < 0
          r.count.times do |i|
            a = r.from + span * i / (r.count - 1)
            places << [at.add(Geometry::Vec.new(0.0, -r.radius).rotate(a)), r.turn ? a : 0.0]
          end
        elsif r.kind == "line"
          r.count.times do |i|
            places << [at.add(Geometry::Vec.new(r.fly, r.hoist).mul(i.to_f)), 0.0]
          end
        else
          (1..r.rows).each do |row|
            (1..r.columns).each do |col|
              next if r.stagger && (row + col).odd?
              places << [Geometry::Vec.new(reg.w * col / (r.columns + 1), reg.h * row / (r.rows + 1)), 0.0]
            end
          end
        end
        places
      end

      private

      # Refuses what would otherwise be silently ignored, or can't be drawn.
      def check_options(f, opts)
        if !opts.height.nil? && (opts.height <= 0 || !Limits.in_limits(opts.height))
          raise Error, "height must be a positive number of a reasonable size"
        end
        if !opts.ratio.nil? && (opts.ratio <= 0 || !Limits.in_limits(opts.ratio))
          raise Error, "ratio must be a positive number of a reasonable size"
        end
        if !opts.id_prefix.empty? && !LOCAL_ID.match?(opts.id_prefix)
          raise Error, "idPrefix #{Parser.quote(opts.id_prefix)} isn't what an ID can start with"
        end
        has_ratio = !opts.ratio.nil?
        unless opts.variant.empty?
          v = f.variants[opts.variant]
          has_ratio = true if v && v.ratio != 0
        end
        if !opts.fit.empty? && !has_ratio
          raise Error, "fit says what to do about a ratio, and there isn't one"
        end
        if !opts.align.empty? && opts.fit != "pad"
          raise Error, "align places a padded flag, so it needs a fit of pad"
        end
        if opts.fold.empty?
          raise Error, "foldStep needs a fold" unless opts.fold_step.nil?
          return
        end
        if opts.side == "reverse"
          raise Error, "a fold shows both sides, so it can't be asked for the reverse"
        end
        raise Error, "a fold is cropped to its pieces, so it can't be padded" if opts.fit == "pad"
        fold = f.folds[opts.fold]
        if fold && !opts.fold_step.nil? && (opts.fold_step < 1 || opts.fold_step > fold.steps.size)
          raise Error, "foldStep must be from 1 to #{fold.steps.size}"
        end
      end

      def write(original, opts)
        check_options(original, opts)
        height = opts.height.nil? ? RenderOptions::DEFAULT_HEIGHT : opts.height
        res = resolve(original, opts)
        f = res.flag
        r = new(f, original.id_prefix)
        if opts.tags
          r.tagging = true
          r.scope_layers, r.scope_border = tag_scope(original, opts)
        end
        if !opts.id_prefix.empty?
          r.id_prefix = opts.id_prefix
        elsif !opts.ratio.nil? || !opts.variant.empty? || !opts.side.empty? || !opts.fit.empty? ||
              !opts.align.empty? || !opts.fold.empty? || !opts.fold_step.nil?
          # A page can show several forms of one flag, which mustn't share definitions.
          key = "#{Json.number(opts.ratio.nil? ? 0.0 : opts.ratio)}|#{opts.variant}|#{opts.side}|" \
                "#{opts.fit}|#{opts.align}|#{opts.fold}|#{opts.fold_step.nil? ? 0 : opts.fold_step}"
          r.id_prefix = "#{r.id_prefix}#{Digest::SHA256.digest(key).byteslice(0, 2).unpack1('H*')}-"
        end
        unless opts.fold.empty?
          fold = f.folds[opts.fold]
          raise Error, "#{f.meta.name} has no fold #{Parser.quote(opts.fold)}" if fold.nil?
          raise Error, "a fold can't be applied to a turned variant" if res.turn != "none"
          r.write_folded(f, fold, opts, height)
          return r.out
        end
        x0 = 0.0
        y0 = 0.0
        width = f.fly
        tall = f.hoist
        if f.border && f.border_outside
          b = Shapes.bounds(Geometry.offset_polygon(Geometry.boundary(f), f.border.width))
          x0, y0, width, tall = b
        end
        shown = res.turn
        # Seen from behind, the turned flag is the mirror image of its front.
        shown = REVERSE_TURN[res.turn] if opts.side == "reverse"
        transform, undo = view(shown, x0, y0, width, tall)
        if res.mirror
          # The back is the mirror image of the front, then turned.
          transform = "#{transform} matrix(-1 0 0 1 #{Shapes.num(2 * x0 + width)} 0)".strip
          # A charge is put back the way it is on the back, which is the front's turn undone.
          undo = view(res.turn, x0, y0, width, tall)[1]
        end
        vx = x0
        vy = y0
        vw = width
        vh = tall
        sideways = SIDEWAYS.include?(res.turn)
        if sideways
          vx = y0
          vy = x0
          vw = tall
          vh = width
        end
        r.upright = undo if res.upright
        if res.canvas != 0
          # The canvas ratio is the design's, so a turned flag's is the other way up.
          want = sideways ? 1 / res.canvas : res.canvas
          share = opts.align == "start" ? 0.0 : opts.align == "end" ? 1.0 : 0.5
          if vw / vh < want
            extra = vh * want - vw
            vx -= extra * share
            vw += extra
          else
            extra = vw / want - vh
            vy -= extra * share
            vh += extra
          end
        end
        r.write_flag(f, vx, vy, vw, vh, height, transform)
        r.out
      end

      # What starts the paths of a render's layers, and of its border.
      def tag_scope(f, opts)
        v = f.variants[opts.variant]
        if opts.variant.empty? || v.nil?
          return ["reverse/", ""] if opts.side == "reverse" && f.reverse
          return ["", ""]
        end
        # Locate.encodeName
        scope = "variant/#{opts.variant.gsub('%', '%25').gsub('/', '%2F')}/"
        layers = ""
        border = ""
        if !v.layers.empty?
          layers = scope
        elsif opts.side == "reverse" && f.reverse
          layers = "reverse/"
        end
        border = scope if v.border
        [layers, border]
      end

      # Applies a side, a variant and a proportion to the flag.
      def resolve(f, opts)
        res = Resolved.new
        out = f.copy
        ratio = opts.ratio.nil? ? 0.0 : opts.ratio
        variant = nil
        unless opts.variant.empty?
          variant = f.variants[opts.variant]
          raise Error, "#{f.meta.name} has no variant #{Parser.quote(opts.variant)}" if variant.nil?
        end
        case opts.fit
        when "", "error", "pad"
        else raise Error, "unknown fit #{Parser.quote(opts.fit)}"
        end
        case opts.align
        when "", "start", "center", "end"
        else raise Error, "unknown align #{Parser.quote(opts.align)}"
        end
        case opts.side
        when "", "obverse"
        when "reverse"
          if f.reverse
            out.layers = f.reverse.layers
            out.seen_from_behind = true
          else
            res.mirror = true
          end
        else
          raise Error, "unknown side #{Parser.quote(opts.side)}"
        end
        if variant
          res.turn = variant.from
          res.upright = variant.upright
          # The flag's outline and border were drawn for its own shape.
          if variant.fly > 0
            out.fly = variant.fly
            out.hoist = variant.hoist
            out.outline = nil
            out.border = nil
            out.border_outside = false
          end
          unless variant.layers.empty?
            # Its own design has nothing to do with the flag's reverse, so it's mirrored.
            out.layers = variant.layers
            out.reverse = nil
            out.seen_from_behind = false
            res.mirror = opts.side == "reverse"
          end
          out.outline = variant.outline if variant.outline
          if variant.border
            out.border = variant.border
            out.border_outside = variant.border_outside
          end
          ratio = variant.ratio if ratio == 0
        end
        res.flag = out
        return res if ratio == 0
        if opts.fit == "pad"
          adapted =
            begin
              Adapter.with_ratio(out, Adapter.nearest_ratio(out, ratio))
            rescue Error
              # The rules allow that proportion, but this design can't reach it.
              out
            end
          res.flag = adapted
          res.canvas = ratio
          return res
        end
        adapted = Adapter.with_ratio(out, ratio)
        if !opts.fold.empty? && out.reverse
          # A fold shows the back as well, which adapts as it's seen from behind.
          back = out.copy
          back.layers = out.reverse.layers
          back.seen_from_behind = true
          adapted_back = Adapter.with_ratio(back, ratio)
          adapted = out.copy if adapted.equal?(out)
          reverse = Model::Reverse.new
          reverse.layers = adapted_back.layers
          adapted.reverse = reverse
        end
        res.flag = adapted
        res
      end
    end

    # Writes the svg element around the flag's art, for an unfolded render.
    def write_flag(f, vx, vy, vw, vh, height, transform)
      line("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"#{num(vx)} #{num(vy)} #{num(vw)} #{num(vh)}" \
           "\" width=\"#{num(height * vw / vh)}\" height=\"#{num(height)}\">")
      @depth += 1
      line("<title>#{Xml.escape(f.meta.name)}</title>")
      line("<desc>#{Xml.escape(f.meta.description)}</desc>") unless f.meta.description.empty?
      unless transform.empty?
        line("<g transform=\"#{transform}\">")
        @depth += 1
      end
      flag_art(f)
      unless transform.empty?
        @depth -= 1
        line("</g>")
      end
      @depth -= 1
      line("</svg>")
    end

    # Renders a flag in a folded position.
    def write_folded(f, fold, opts, height)
      shape = Geometry.fold_shape(f)
      steps = opts.fold_step.nil? ? 0 : opts.fold_step
      stack = Geometry.fold_facets(shape, fold, steps)
      all = []
      stack.each { |facet| all.concat(facet.poly) }
      x, y, w, h = Shapes.bounds(all)
      line("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"#{num(x)} #{num(y)} #{num(w)} #{num(h)}" \
           "\" width=\"#{num(height * w / h)}\" height=\"#{num(height)}\">")
      @depth += 1
      line("<title>#{Xml.escape(f.meta.name)}</title>")
      line("<defs>")
      @depth += 1
      front = id("front")
      line("<g id=\"#{front}\">")
      @depth += 1
      flag_art(f)
      @depth -= 1
      line("</g>")
      back = ""
      if f.reverse
        back = id("back")
        reverse = f.copy
        reverse.layers = f.reverse.layers
        line("<g id=\"#{back}\">")
        @depth += 1
        scope = @scope_layers
        @scope_layers = "reverse/"
        was = @flag
        @flag = reverse
        flag_art(reverse)
        @flag = was
        @scope_layers = scope
        @depth -= 1
        line("</g>")
      end
      @depth -= 1
      line("</defs>")
      # A crease line reads at any scale, without hiding the design. SPEC section 13 fixes it.
      crease = "fill=\"none\" stroke=\"#000\" stroke-opacity=\"0.35\" stroke-linejoin=\"round\" stroke-width=\"" \
               "#{num([w, h].max * 0.004)}\""
      stack.each do |fc|
        clip = id("facet")
        line("<clipPath id=\"#{clip}\">")
        @depth += 1
        unmarked(Shapes::Geom.poly(fc.poly), "")
        @depth -= 1
        line("</clipPath>")
        art = front
        place = fc.place
        if fc.flipped && !back.empty?
          # A separate back is written as seen from that side, so it mirrors back.
          art = back
          place = Geometry::Matrix.new(-1.0, 0.0, 0.0, 1.0, f.fly, 0.0).followed_by(fc.place)
        end
        line("<g clip-path=\"url(##{clip})\"><use href=\"##{art}\" transform=\"matrix(#{num(place.a)} #{num(place.b)} " \
             "#{num(place.c)} #{num(place.d)} #{num(place.e)} #{num(place.f)})\"/></g>")
        unmarked(Shapes::Geom.poly(fc.poly), crease)
      end
      @depth -= 1
      line("</svg>")
    end

    private

    def num(v)
      Shapes.num(v)
    end

    def line(text)
      @out << ("  " * @depth) << text << "\n"
    end

    def color(name)
      v = @flag.palette[name]
      v.nil? ? "" : v.downcase
    end

    # The paint value for a palette name. A gradient spans the box given, or the bounding box of
    # each shape it's used on if that's nil.
    def fill(name, box)
      g = @flag.gradients[name]
      return color(name) if g.nil?
      if box.nil? && @gradients.key?(name)
        return "url(##{@gradients[name]})"
      end
      gid = id("gradient")
      x1 = 0
      y1 = 0
      x2 = 1
      y2 = 0
      case g.along
      when "hoist"
        x2 = 0
        y2 = 1
      when "bend"
        y2 = 1
      when "bend-sinister"
        y1 = 1
      end
      units = ""
      if box
        units = " gradientUnits=\"userSpaceOnUse\" gradientTransform=\"translate(#{num(box[0])} #{num(box[1])}" \
                ") scale(#{num(box[2])} #{num(box[3])})\""
      end
      line("<linearGradient id=\"#{gid}\" x1=\"#{x1}\" y1=\"#{y1}\" x2=\"#{x2}\" y2=\"#{y2}\"#{units}>")
      @depth += 1
      g.colors.each_with_index do |c, i|
        line("<stop offset=\"#{num(g.stops[i])}\" stop-color=\"#{color(c)}\"/>")
      end
      @depth -= 1
      line("</linearGradient>")
      @gradients[name] = gid if box.nil?
      "url(##{gid})"
    end

    def id(kind)
      @next_id += 1
      "#{@id_prefix}#{kind}#{@next_id}"
    end

    # Paints a flag's outside border, then everything within its outline.
    def flag_art(f)
      if f.border && f.border_outside
        outer = Geometry.offset_polygon(Geometry.boundary(f), f.border.width)
        @tag = "#{@scope_border}border"
        # A gradient spans the shape that the border edges.
        box = nil
        shape = Geometry.boundary(f)
        box = Shapes.bounds(shape) if shape
        geom(Shapes::Geom.poly(outer), "fill=\"#{fill(f.border.color, box)}\"")
      end
      root = Shapes::Region.new(f.fly, f.hoist)
      shape = Shapes::Geom.poly(Geometry.rect_poly(0.0, 0.0, f.fly, f.hoist))
      shape = Shapes.outline_geom(f.outline, f.fly, f.hoist) if f.outline
      flag_clip = id("flag")
      line("<clipPath id=\"#{flag_clip}\">")
      @depth += 1
      unmarked(shape, "")
      @depth -= 1
      line("</clipPath>")
      line("<g clip-path=\"url(##{flag_clip})\">")
      @depth += 1
      layers(f.layers, root, @scope_layers)
      if f.border && !f.border_outside
        # Half of the stroke falls outside the outline, and the clip removes it.
        @tag = "#{@scope_border}border"
        geom(shape, "fill=\"none\" stroke=\"#{fill(f.border.color, nil)}\" stroke-width=\"#{num(2 * f.border.width)}" \
                    "\" stroke-linejoin=\"miter\" stroke-miterlimit=\"10\"")
      end
      @depth -= 1
      line("</g>")
    end

    # Paints layers, whose paths start with base: a scope, or a parent's path and a dot.
    def layers(list, reg, base)
      list.each_with_index do |l, i|
        layer(l, reg, "#{base}#{i}")
      end
    end

    def layer(l, reg, path)
      @tag = path if @using.zero?
      attrs = []
      style = []
      effects(l, reg, cut_moves(l, reg), attrs, style)
      # A group, and any layer with an opacity, a blend, a clip or a cut, composites as a unit,
      # so a blend inside it mixes only with what else is inside. Saying so outright keeps every
      # renderer to that. A panel's own group already says it.
      if l.is_a?(Model::Group) || l.opacity != 1 || l.blend != "normal" || l.clip || !l.cuts.empty?
        style << "isolation:isolate"
      end
      attrs << "style=\"#{style.join(';')}\"" unless style.empty?
      unless attrs.empty?
        line("<g #{attrs.join(' ')}>")
        @depth += 1
      end
      content(l, reg, path)
      return if attrs.empty?
      @depth -= 1
      line("</g>")
    end

    # Writes any clip and mask a layer needs. A charge's cuts are drawn once for each of its moves.
    def effects(e, reg, moves, attrs, style)
      attrs << "opacity=\"#{num(e.opacity)}\"" if e.opacity != 1
      style << "mix-blend-mode:#{e.blend}" if e.blend != "normal"
      if e.clip
        cid = id("clip")
        line("<clipPath id=\"#{cid}\">")
        @depth += 1
        clip = Shapes.for_region(e.clip, reg)
        unmarked(Shapes.shape_geom(clip, Shapes.position(clip, reg), 0.0), "")
        @depth -= 1
        line("</clipPath>")
        attrs << "clip-path=\"url(##{cid})\""
      end
      return if e.cuts.empty?
      mid = id("mask")
      b = reg.bounds
      line("<mask id=\"#{mid}\" maskUnits=\"userSpaceOnUse\" x=\"#{num(b[0])}\" y=\"#{num(b[1])}" \
           "\" width=\"#{num(b[2])}\" height=\"#{num(b[3])}\">")
      @depth += 1
      unmarked(Shapes::Geom.poly(Geometry.rect_poly(b[0], b[1], b[0] + b[2], b[1] + b[3])), "fill=\"#fff\"")
      moves = [""] if moves.nil?
      moves.each do |move|
        e.cuts.each do |s|
          cut = Shapes.for_region(s, reg)
          g = Shapes.shape_geom(cut, Shapes.position(cut, reg), 0.0)
          g.transform = "#{move} #{g.transform}".strip unless move.empty?
          unmarked(g, "fill=\"#000\"")
        end
      end
      @depth -= 1
      line("</mask>")
      attrs << "mask=\"url(##{mid})\""
    end

    def box_of(inside)
      inside.empty? ? nil : Shapes.bounds(inside)
    end

    def gradient?(name)
      @flag.gradients.key?(name)
    end

    def poly_geoms(*polys)
      polys.map { |p| Shapes::Geom.poly(p) }
    end

    def content(l, reg, path)
      case l
      when Model::Field
        paint(l.color, nil, nil, nil, poly_geoms(Geometry.rect_poly(0.0, 0.0, reg.w, reg.h)))
      when Model::Bars
        has_gap = l.colors.include?(NONE)
        colors = l.colors
        polys = Shapes.bar_polys(l, reg, ->(i) { gradient?(colors[i]) || has_gap })
        polys.each_with_index do |p, i|
          paint(colors[i], nil, nil, nil, poly_geoms(p)) unless p.empty?
        end
      when Model::Chevrons
        nested, bands = Shapes.raw_chevrons(l, reg)
        polys = Shapes.chevron_polys(l, reg)
        # A gap has to show what's beneath, so each band stands alone.
        polys = bands if l.colors.include?(NONE)
        if l.fimbriate
          # A gradient spans the outermost chevron's part inside the region.
          box = box_of(Shapes.clip_convex(nested[0], reg))
          paint(l.colors[polys.size - 1], box, l.fimbriate, poly_geoms(nested[0]), nil)
        end
        polys.each_with_index do |p, i|
          next if p.empty?
          # A gradient spans the whole chevron's part inside the region, even where a gap
          # leaves only its band to paint.
          box = box_of(Shapes.clip_convex(nested[i], reg))
          paint(l.colors[polys.size - 1 - i], box, nil, nil, poly_geoms(p))
        end
      when Model::Band
        # The fimbriation's stroke mustn't follow the region's edge, so it uses the band's
        # unclipped shape. A clipped polygon can be empty.
        stroke = poly_geoms(Shapes.placed_band_poly(reg, l.fixed, l.along, l.rotate, l.width, l.offset, true))
        poly = Shapes.placed_band_poly(reg, l.fixed, l.along, l.rotate, l.width, l.offset, false)
        if poly.empty?
          paint(l.color, nil, l.fimbriate, stroke, nil)
        else
          # A gradient spans the part inside the region, for the fimbriation too.
          paint(l.color, Shapes.bounds(poly), l.fimbriate, stroke, poly_geoms(poly))
        end
      when Model::Cross
        # A gradient spans a cross as one shape, so it's given the whole region.
        box = [0.0, 0.0, reg.w, reg.h]
        stroke = nil
        if l.fimbriate
          # Keep the arms' ends, and their stroke, beyond the region's edge.
          sp = Shapes.cross_polys(l, reg, l.fimbriate.width * 2)
          stroke = poly_geoms(sp[0], sp[1])
        end
        polys = Shapes.cross_polys(l, reg, 0.0)
        paint(l.color, box, l.fimbriate, stroke, poly_geoms(polys[0], polys[1]))
      when Model::Quarters
        quarters(l, reg)
      when Model::Checks
        checks(l, reg)
      when Model::Rays
        polys = Shapes.ray_polys(l, reg)
        unless l.colors.include?(NONE)
          # Beneath the wedges, so that antialiasing can't leave seams between them.
          paint(l.colors[0], nil, nil, nil, poly_geoms(Geometry.rect_poly(0.0, 0.0, reg.w, reg.h)))
        end
        polys.each_with_index do |p, i|
          paint(l.colors[i], nil, nil, nil, poly_geoms(p)) unless p.empty?
        end
      when Model::Saltire
        if l.counterchange
          counterchange(l, reg)
          return
        end
        box = [0.0, 0.0, reg.w, reg.h]
        stroke = nil
        if l.fimbriate
          stroke = poly_geoms(Shapes.band_poly(reg, "bend", 0.0, l.width, 0.0, true),
                              Shapes.band_poly(reg, "bend-sinister", 0.0, l.width, 0.0, true))
        end
        paint(l.color, box, l.fimbriate, stroke,
              poly_geoms(Shapes.band_poly(reg, "bend", 0.0, l.width, 0.0, false),
                         Shapes.band_poly(reg, "bend-sinister", 0.0, l.width, 0.0, false)))
      when Model::Charge
        charge(l, reg)
      when Model::Emblem
        emblem(l, reg, path)
      when Model::Group
        layers(l.layers, reg, "#{path}.")
      when Model::Panel
        panel(l, reg, path)
      when Model::Use
        # Everything a use draws is marked with its path, since it's the use in the document.
        @using += 1
        begin
          if l.design.fly == 0
            layers(l.design.layers, reg, "")
          else
            # A design with its own grid is scaled to fill the region it's used in.
            line("<g transform=\"scale(#{Shapes.factor(reg.w / l.design.fly)} #{Shapes.factor(reg.h / l.design.hoist)})\">")
            @depth += 1
            layers(l.design.layers, Shapes::Region.new(l.design.fly, l.design.hoist), "")
            @depth -= 1
            line("</g>")
          end
        ensure
          @using -= 1
        end
      end
    end

    def panel(p, reg, path)
      x, y, w, h = Shapes.panel_rect(p, reg)
      shape = Shapes::Geom.poly(Geometry.rect_poly(0.0, 0.0, w, h))
      shape = Shapes::Geom.poly(Shapes.panel_edge(p, w, h)) if p.line
      pid = id("panel")
      line("<clipPath id=\"#{pid}\">")
      @depth += 1
      unmarked(shape, "")
      @depth -= 1
      line("</clipPath>")
      line("<g transform=\"translate(#{num(x)} #{num(y)})\" clip-path=\"url(##{pid})\" style=\"isolation:isolate\">")
      @depth += 1
      layers(p.layers, Shapes::Region.new(w, h), "#{path}.")
      @depth -= 1
      line("</g>")
    end

    def quarters(q, reg)
      c = reg.center
      if q.diagonal
        corners = reg.corners
        4.times do |i|
          paint(q.colors[i], nil, nil, nil, poly_geoms([c, corners[i], corners[(i + 1) % 4]]))
        end
        return
      end
      c = Geometry::Vec.new(q.split.fly, q.split.hoist) if q.split
      # Each runs on beneath the next, so antialiasing can't leave a seam, unless gaps have to
      # show or a gradient has to span its own quarter.
      gaps = q.colors.include?(NONE)
      exact = q.colors.map { |name| gaps || gradient?(name) }
      right = reg.w
      bottom = reg.h
      if exact[0]
        right = c.x
        bottom = c.y
      end
      paint(q.colors[0], nil, nil, nil, poly_geoms(Geometry.rect_poly(0.0, 0.0, right, bottom)))
      bottom = exact[1] ? c.y : reg.h
      paint(q.colors[1], nil, nil, nil, poly_geoms(Geometry.rect_poly(c.x, 0.0, reg.w, bottom)))
      right = exact[2] ? c.x : reg.w
      paint(q.colors[2], nil, nil, nil, poly_geoms(Geometry.rect_poly(0.0, c.y, right, reg.h)))
      paint(q.colors[3], nil, nil, nil, poly_geoms(Geometry.rect_poly(c.x, c.y, reg.w, reg.h)))
    end

    def checks(ch, reg)
      n = ch.colors.size
      cell_w = reg.w / ch.columns
      cell_h = reg.h / ch.rows
      gaps = ch.colors.include?(NONE)
      bend = ch.flow == "bend"
      ch.rows.times do |row|
        ch.columns.times do |col|
          i = row + col
          i = col - row + ch.rows * n if bend
          x = col * cell_w
          y = row * cell_h
          # Each cell runs on beneath the next ones, unless gaps have to show or a gradient has
          # to span its own cell.
          right = reg.w
          bottom = reg.h
          color = ch.colors[i % n]
          if gaps || gradient?(color)
            right = x + cell_w
            bottom = y + cell_h
          end
          paint(color, nil, nil, nil, poly_geoms(Geometry.rect_poly(x, y, right, bottom)))
        end
      end
    end

    # Paints a saltire twice its width, clipped to four triangles, so one side of each diagonal shows.
    def counterchange(l, reg)
      c = reg.center
      vec = Geometry::Vec
      cid = id("clip")
      line("<clipPath id=\"#{cid}\">")
      @depth += 1
      unmarked(Shapes::Geom.poly([
        c, vec.new(reg.w, c.y), vec.new(reg.w, reg.h),
        c, vec.new(c.x, reg.h), vec.new(0.0, reg.h),
        c, vec.new(0.0, c.y), vec.new(0.0, 0.0),
        c, vec.new(c.x, 0.0), vec.new(reg.w, 0.0)
      ]), "")
      @depth -= 1
      line("</clipPath>")
      line("<g clip-path=\"url(##{cid})\">")
      @depth += 1
      box = [0.0, 0.0, reg.w, reg.h]
      paint(l.color, box, nil, nil,
            poly_geoms(Shapes.band_poly(reg, "bend", 0.0, 2 * l.width, 0.0, false),
                       Shapes.band_poly(reg, "bend-sinister", 0.0, 2 * l.width, 0.0, false)))
      @depth -= 1
      line("</g>")
    end

    def emblem(e, reg, path)
      at = e.at ? Geometry::Vec.new(e.at.fly, e.at.hoist) : reg.center
      angle = e.rotate
      unless e.along.empty?
        dir = Shapes.axis(reg, e.along, 0.0)[0]
        angle += Math.atan2(dir.y, dir.x) * 180 / Math::PI
      end
      # Painting is still clipped to the region, so the frame only has to reach the region's
      # farthest corner.
      reach = 0.0
      reg.corners.each do |corner|
        reach = [reach, Math.hypot(corner.x - at.x, corner.y - at.y)].max
      end
      keep_upright(at) do
        line("<g transform=\"translate(#{num(at.x)} #{num(at.y)}) rotate(#{num(angle)})\">")
        @depth += 1
        # Charges in an emblem turn with it, so they aren't each kept upright as well.
        was = @upright
        @upright = ""
        e.charges.each_with_index do |c, i|
          layer(c, Shapes::Region.new(0.0, 0.0, reach), "#{path}.#{i}")
        end
        @upright = was
        @depth -= 1
        line("</g>")
      end
    end

    def charge(c, reg)
      s = Shapes.for_region(c.shape, reg)
      at = Shapes.position(s, reg)
      if s.kind == "svg"
        keep_upright(at) { embedded(c, at) }
        return
      end
      copies = []
      centers = []
      self.class.charge_places(c, s, reg).each do |place, turn|
        copies << Shapes.shape_geom(s, place, turn)
        centers << place
      end
      box = nil
      if c.shape.kind == "pile" || c.shape.kind == "pall"
        # Its shape runs on past the region, and a gradient spans only what's inside.
        points = s.vertices.map { |p| Geometry::Vec.new(p.fly, p.hoist) }
        box = box_of(Shapes.clip_convex(points, reg))
      end
      draw = lambda do |shapes, fimbriate, color|
        if s.hollow > 0
          outline_only(color, box, s.hollow, shapes)
        elsif s.lines > 0
          outline_only(color, box, s.lines, shapes)
        else
          paint(color, box, fimbriate, shapes, shapes)
        end
      end
      if @upright.empty? || s.kind == "polygon"
        draw.call(copies, c.fimbriate, c.color)
        return
      end
      if c.fimbriate
        # Every copy's fimbriation lies beneath all of their fills, as it does unturned.
        copies.each_with_index do |g, i|
          keep_upright(centers[i]) { paint(NONE, nil, c.fimbriate, [g], nil) }
        end
      end
      copies.each_with_index do |g, i|
        keep_upright(centers[i]) { draw.call([g], nil, c.color) }
      end
    end

    # A transform for each copy of a charge, which takes its cuts from where they're written, for
    # the first copy, to that copy. A layer that isn't a charge with several copies gets nil.
    def cut_moves(l, reg)
      return nil unless l.is_a?(Model::Charge)
      return nil if l.cuts.empty? || l.shape.kind == "svg"
      places = self.class.charge_places(l, Shapes.for_region(l.shape, reg), reg)
      return nil if places.size < 2
      first_at, first_turn = places[0]
      moves = [""]
      places.drop(1).each do |at, t|
        turn = t - first_turn
        moves << if turn != 0
                   "translate(#{num(at.x)} #{num(at.y)}) rotate(#{num(turn)}) translate(" \
                     "#{num(-first_at.x)} #{num(-first_at.y)})"
                 else
                   "translate(#{num(at.x - first_at.x)} #{num(at.y - first_at.y)})"
                 end
      end
      moves
    end

    # Undoes a turned variant's rotation around a point, if there is one.
    def keep_upright(at)
      if @upright.empty?
        yield
        return
      end
      line("<g transform=\"translate(#{num(at.x)} #{num(at.y)}) #{@upright} translate(#{num(-at.x)} #{num(-at.y)})\">")
      @depth += 1
      yield
      @depth -= 1
      line("</g>")
    end

    def outline_only(color, box, width, shapes)
      return if color == NONE
      stroke = fill(color, box)
      shapes.each do |g|
        geom(g, "fill=\"none\" stroke=\"#{stroke}\" stroke-width=\"#{num(width / g.stroke_scale)}" \
                "\" stroke-linejoin=\"miter\" stroke-miterlimit=\"10\"")
      end
    end

    def embedded(c, at)
      s = c.shape
      attrs = []
      attrs << "color=\"#{color(c.color)}\"" unless c.color.empty?
      attrs << "transform=\"rotate(#{num(s.rotate)} #{num(at.x)} #{num(at.y)})\"" if s.rotate != 0
      unless attrs.empty?
        line("<g #{attrs.join(' ')}>")
        @depth += 1
      end
      # Each time it's drawn gets its own prefix, since a definition can draw it many times.
      prefix = "#{id('svg')}-"
      art = s.embedded
      line("<svg#{mark} x=\"#{num(at.x - s.fly / 2)}\" y=\"#{num(at.y - s.hoist / 2)}\" width=\"#{num(s.fly)}" \
           "\" height=\"#{num(s.hoist)}\" viewBox=\"#{Xml.escape(art.view_box)}" \
           "\" preserveAspectRatio=\"xMidYMid meet\"#{art.attrs(prefix)}>#{art.body(prefix)}</svg>")
      return if attrs.empty?
      @depth -= 1
      line("</g>")
    end

    # Fills shapes, after painting any fimbriation beneath all of them. Each shape's stroke lies
    # beneath the others' fills, so arms read as a single shape. A gradient spans box, or each
    # shape's own bounds if box is nil.
    def paint(color, box, fimbriate, stroke, shapes)
      if fimbriate && stroke
        edge = fill(fimbriate.color, box)
        stroke.each do |g|
          geom(g, "fill=\"#{edge}\" stroke=\"#{edge}\" stroke-width=\"#{num(2 * fimbriate.width / g.stroke_scale)}" \
                  "\" stroke-linejoin=\"miter\" stroke-miterlimit=\"10\"")
        end
      end
      return if shapes.nil? || shapes.empty? || color == NONE
      paint_fill = fill(color, box)
      shapes.each { |g| geom(g, "fill=\"#{paint_fill}\"") }
    end

    # The attribute that marks a drawn element, if this render has them.
    def mark
      return "" unless @tagging
      " #{Vexyl::TAG_ATTRIBUTE}=\"#{Xml.escape(@tag)}\""
    end

    # Writes what's only part of a definition, which no layer drew.
    def unmarked(g, attrs)
      was = @tagging
      @tagging = false
      geom(g, attrs)
      @tagging = was
    end

    def geom(g, attrs)
      a = +mark
      a << " " << attrs unless attrs.empty?
      a << " transform=\"" << g.transform << "\"" unless g.transform.empty?
      a << " fill-rule=\"evenodd\"" if g.evenodd
      if !g.path.empty?
        line("<path d=\"#{g.path}\"#{a}/>")
      elsif g.circle
        line("<circle cx=\"#{num(g.c.x)}\" cy=\"#{num(g.c.y)}\" r=\"#{num(g.r)}\"#{a}/>")
      elsif g.ring
        line("<path fill-rule=\"evenodd\" d=\"#{Shapes.circle_path(g.c, g.r)} #{Shapes.circle_path(g.c, g.inner)}\"#{a}/>")
      else
        points = +""
        (g.poly || []).each_with_index do |v, i|
          points << " " if i > 0
          points << num(v.x) << "," << num(v.y)
        end
        line("<polygon points=\"#{points}\"#{a}/>")
      end
    end

    # Reads the renderer's own output, which is plain XML with double-quoted attributes.
    class TreeReader
      REFS = { "amp" => "&", "lt" => "<", "gt" => ">", "quot" => "\"", "apos" => "'" }.freeze

      def initialize(s)
        @s = StringScanner.new(s)
      end

      def element
        s = @s
        s.skip(/[^<]*/)
        s.getch
        name = s.scan(/[^\s>\/]*/)
        attrs = []
        loop do
          s.skip(/\s*/)
          return Element.new(name, attrs, "", []) if s.skip(%r{/>})
          break if s.skip(/>/)
          key = s.scan(/[^=]*/).strip
          s.skip(/[^"]*"/)
          value = s.scan(/[^"]*/)
          s.getch
          attrs << Element::Attribute.new(key, unescape(value))
        end
        children = []
        text = +""
        keep_text = name == "title" || name == "desc"
        loop do
          chunk = s.scan(/[^<]*/)
          text << unescape(chunk) if keep_text
          if s.check(%r{</})
            s.skip(/[^>]*>/)
            return Element.new(name, attrs, text, children)
          end
          children << element
        end
      end

      private

      def unescape(t)
        return t unless t.include?("&")
        t.gsub(/&([^;]*);/) do
          ref = Regexp.last_match(1)
          REFS[ref] || [ref.start_with?("#x") ? ref[2..].to_i(16) : ref[1..].to_i].pack("U")
        end
      end
    end
  end
end
