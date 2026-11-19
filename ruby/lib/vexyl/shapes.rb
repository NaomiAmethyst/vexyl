# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # Works out the polygons and paths that layers and shapes paint.
  module Shapes
    # Stops a render that turns out to be too much, deep inside geometry that otherwise can't fail.
    class Refusal < StandardError; end

    # A rectangle with its origin at the current coordinate origin. An emblem's frame has no size,
    # and its center is its origin; local is then how far its content could need to reach to cover
    # everything visible.
    class Region
      attr_reader :w, :h, :local

      def initialize(w, h, local = 0.0)
        @w = w.to_f
        @h = h.to_f
        @local = local.to_f
      end

      # The rectangle a mask has to cover.
      def bounds
        return [-@local, -@local, 2 * @local, 2 * @local] if @local > 0
        [0.0, 0.0, @w, @h]
      end

      def center
        Geometry::Vec.new(@w / 2, @h / 2)
      end

      def reach
        Math.hypot(@w, @h)
      end

      def corners
        [Geometry::Vec.new(0.0, 0.0), Geometry::Vec.new(@w, 0.0), Geometry::Vec.new(@w, @h),
         Geometry::Vec.new(0.0, @h)]
      end
    end

    # A shape resolved to coordinates.
    class Geom
      # path: SVG path data, for shapes that polygons can't draw exactly. transform: places a path,
      # whose scale strokes have to allow for.
      attr_accessor :circle, :ring, :c, :r, :inner, :poly, :path, :evenodd, :transform, :scale

      def initialize
        @circle = false
        @ring = false
        @c = nil
        @r = 0.0
        @inner = 0.0
        @poly = nil
        @path = ""
        @evenodd = false
        @transform = ""
        @scale = 0.0
      end

      def self.poly(poly)
        g = new
        g.poly = poly
        g
      end

      def self.path(d)
        g = new
        g.path = d
        g
      end

      def stroke_scale
        @scale > 0 ? @scale : 1.0
      end
    end

    # Which bars are drawn exactly is said by any object answering call(i), such as a lambda,
    # which bar_polys takes as its third argument, or nil.

    module_function

    # Formats a coordinate to a fixed precision, so output is stable and free of floating-point noise.
    # It's v * 1e6 rounded half up, as six decimal places, trailing zeros stripped, in plain
    # notation; beyond the range of a long, v rounded half-even to an integer.
    def num(v)
      v = v.to_f
      scaled = v * 1e6
      if scaled.abs < 9e18
        # floor(scaled + 1/2), computed exactly.
        l = scaled.floor
        l += 1 if scaled - l >= 0.5
        return "0" if l == 0
        neg = l < 0
        ip, fp = l.abs.divmod(1_000_000)
        s = neg ? "-#{ip}" : ip.to_s
        return s if fp == 0
        digits = 6
        while fp % 10 == 0
          fp /= 10
          digits -= 1
        end
        return "#{s}.#{fp.to_s.rjust(digits, "0")}"
      end
      v.to_r.round(half: :even).to_s
    end

    # Writes a scale, whose size says nothing about how many places it needs: a path drawn in a
    # box tens of thousands wide, on a grid of a few units, is scaled by a very small number.
    # It's the Float's exact value to 10 significant digits, half-even, trailing zeros
    # stripped, in plain notation.
    def factor(v)
      v = v.to_f
      return "0" if v == 0
      r = v.to_r.abs
      e = Math.log10(v.abs).floor
      e -= 1 while r < pow10(e)
      e += 1 while r >= pow10(e + 1)
      scale = 9 - e
      n = (r * pow10(scale)).round(half: :even)
      while n % 10 == 0
        n /= 10
        scale -= 1
      end
      digits = n.to_s
      s = if scale <= 0
            digits + ("0" * -scale)
          elsif digits.length > scale
            "#{digits[0...-scale]}.#{digits[-scale..]}"
          else
            "0.#{"0" * (scale - digits.length)}#{digits}"
          end
      v < 0 ? "-#{s}" : s
    end

    def pow10(k)
      k >= 0 ? 10**k : Rational(1, 10**-k)
    end
    private_class_method :pow10

    # The remainder of a by b with the sign of a, as C's fmod gives it.
    def fmod(a, b)
      m = a.abs % b.abs
      a < 0 || (a == 0 && 1.0 / a < 0) ? -m : m
    end
    private_class_method :fmod

    def bounds(poly)
      x0 = y0 = Float::INFINITY
      x1 = y1 = -Float::INFINITY
      poly.each do |p|
        x0 = p.x if p.x < x0
        y0 = p.y if p.y < y0
        x1 = p.x if p.x > x1
        y1 = p.y if p.y > y1
      end
      [x0, y0, x1 - x0, y1 - y0]
    end

    # The direction of an axis, and the normal bars are listed along.
    def axis(r, along, rotation)
      l = r.reach
      case along
      when "hoist"
        dir = Geometry::Vec.new(0.0, 1.0)
        normal = Geometry::Vec.new(1.0, 0.0)
      when "bend"
        dir = Geometry::Vec.new(r.w / l, r.h / l)
        normal = Geometry::Vec.new(r.h / l, -r.w / l)
      when "bend-sinister"
        dir = Geometry::Vec.new(r.w / l, -r.h / l)
        normal = Geometry::Vec.new(r.h / l, r.w / l)
      else
        dir = Geometry::Vec.new(1.0, 0.0)
        normal = Geometry::Vec.new(0.0, 1.0)
      end
      [dir.rotate(rotation), normal.rotate(rotation)]
    end

    # Clips a convex polygon to a region (Sutherland-Hodgman).
    def clip_convex(poly, r)
      # Each edge: [on x (true) or y, the line's value, inside is below (<=) or above (>=)].
      [[true, 0.0, false], [true, r.w, true], [false, 0.0, false], [false, r.h, true]].each do |on_x, at, below|
        out = []
        n = poly.size
        n.times do |i|
          cur = poly[i]
          prev = poly[(i + n - 1) % n]
          cv = on_x ? cur.x : cur.y
          pv = on_x ? prev.x : prev.y
          inside = below ? cv <= at : cv >= at
          was = below ? pv <= at : pv >= at
          if inside && was
            out << cur
          elsif inside
            out << clip_cross(on_x, at, prev, cur)
            out << cur
          elsif was
            out << clip_cross(on_x, at, prev, cur)
          end
        end
        poly = out
      end
      poly
    end

    def clip_cross(on_x, at, a, b)
      if on_x
        Geometry::Vec.new(at, a.y + (b.y - a.y) * (at - a.x) / (b.x - a.x))
      else
        Geometry::Vec.new(a.x + (b.x - a.x) * (at - a.y) / (b.y - a.y), at)
      end
    end
    private_class_method :clip_cross

    # The region a layer's axis is measured in and the center it's drawn about.
    def frame(f, r)
      f.nil? ? r : Region.new(f.w, f.h)
    end

    def frame_center(f, r)
      f.nil? ? r.center : Geometry::Vec.new(f.x, f.y)
    end

    # Far enough from a point to cross the whole region, wherever the point is.
    def reach_from(c, r)
      d = c.sub(r.center)
      r.reach + Math.hypot(d.x, d.y)
    end

    # The rectangle between two offsets along normal.
    def strip_poly(c, dir, normal, t0, t1, reach)
      [
        c.add(normal.mul(t0)).sub(dir.mul(reach)),
        c.add(normal.mul(t0)).add(dir.mul(reach)),
        c.add(normal.mul(t1)).add(dir.mul(reach)),
        c.add(normal.mul(t1)).sub(dir.mul(reach))
      ]
    end

    # One polygon per bar. Each runs from its bar's start to the far side of the region, so the
    # next bar paints over it and antialiasing can't leave a seam showing what's beneath. A gradient
    # spans the shape it fills, so a bar for which exact is true stays its true width.
    # exact: nil, or anything answering call(i) with true or false.
    def bar_polys(b, r, exact)
      frame = frame(b.fixed, r)
      c = frame_center(b.fixed, r)
      dir, normal = axis(frame, b.along, b.rotate)
      lo = Float::INFINITY
      hi = -Float::INFINITY
      r.corners.each do |corner|
        offset = corner.sub(c).dot(normal)
        lo = offset if offset < lo
        hi = offset if offset > hi
      end
      total = 0.0
      b.ratio.each { |part| total += part }
      reach = reach_from(c, r)
      polys = []
      t = lo
      count = b.ratio.length
      count.times do |i|
        nxt = t + (hi - lo) * b.ratio[i] / total
        stop = hi
        is_exact = !exact.nil? && exact.call(i) ? true : false
        stop = nxt if is_exact
        if b.line.nil?
          from = t
          to = stop
          if b.rotate != 0
            # The outermost lines pass through corners, where rounding in the angle could
            # leave a sliver either side, so the outer ends reach well past the region.
            from -= reach if i == 0
            to = hi + reach if stop == hi || i == count - 1
          end
          polys << clip_convex(strip_poly(c, dir, normal, from, to, reach), r)
          t = nxt
          next
        end
        # A shaped edge isn't convex, so clipping is left to the region's own clip.
        margin = b.line.depth + 1
        near = [c.add(normal.mul(lo - margin)).sub(dir.mul(reach)),
                c.add(normal.mul(lo - margin)).add(dir.mul(reach))]
        near = wave_edge(c, dir, normal, t, axis_span(frame, b.along), reach, b.line) if i > 0
        far = [c.add(normal.mul(hi + margin)).add(dir.mul(reach)),
               c.add(normal.mul(hi + margin)).sub(dir.mul(reach))]
        if is_exact && i < count - 1
          far = wave_edge(c, dir, normal, nxt, axis_span(frame, b.along), reach, b.line).reverse
        end
        polys << (near + far)
        t = nxt
      end
      polys
    end

    # One polygon per color, from the outermost inward, which is the order they paint in.
    def chevron_polys(ch, r)
      raw_chevrons(ch, r)[0].map { |poly| clip_convex(poly, r) }
    end

    # Each chevron's polygon reaching well past the region, and each chevron alone between its apex
    # and the next, for when gaps have to show. Returns [nested, bands].
    def raw_chevrons(ch, r)
      case ch.from
      when "fly"
        origin = Geometry::Vec.new(r.w, r.h / 2)
        u = Geometry::Vec.new(-1.0, 0.0)
        v = Geometry::Vec.new(0.0, 1.0)
        edge = r.h
      when "top"
        origin = Geometry::Vec.new(r.w / 2, 0.0)
        u = Geometry::Vec.new(0.0, 1.0)
        v = Geometry::Vec.new(1.0, 0.0)
        edge = r.w
      when "bottom"
        origin = Geometry::Vec.new(r.w / 2, r.h)
        u = Geometry::Vec.new(0.0, -1.0)
        v = Geometry::Vec.new(1.0, 0.0)
        edge = r.w
      else
        origin = Geometry::Vec.new(0.0, r.h / 2)
        u = Geometry::Vec.new(1.0, 0.0)
        v = Geometry::Vec.new(0.0, 1.0)
        edge = r.h
      end
      reach = r.reach
      unless ch.apex.nil?
        shift = ch.apex - edge / 2
        origin = origin.add(v.mul(shift))
        reach += shift.abs
      end
      run = ch.depth.to_f
      run = (edge / 2) / Math.tan(ch.angle * Math::PI / 180) if ch.angle != 0
      slope = run / (edge / 2)
      total = 0.0
      ch.ratio.each { |part| total += part }
      apexes = []
      sum = 0.0
      ch.ratio.each do |part|
        sum += part
        apexes << ch.depth * sum / total
      end
      center = r.center
      rotation = ch.rotate
      place = lambda do |pu, pv|
        point = origin.add(u.mul(pu)).add(v.mul(pv))
        center.add(point.sub(center).rotate(rotation))
      end
      nested = []
      bands = []
      (apexes.length - 1).downto(0) do |i|
        a = apexes[i]
        arm_end = a - slope * reach
        back = (arm_end < 0 ? arm_end : 0.0) - reach
        nested << [place.call(a, 0.0), place.call(arm_end, reach), place.call(back, reach),
                   place.call(back, -reach), place.call(arm_end, -reach)]
        if i == 0
          bands << nested[-1]
          next
        end
        inner = apexes[i - 1]
        inner_end = inner - slope * reach
        bands << [place.call(a, 0.0), place.call(arm_end, reach), place.call(inner_end, reach),
                  place.call(inner, 0.0), place.call(inner_end, -reach), place.call(arm_end, -reach)]
      end
      [nested, bands]
    end

    # A band's rectangle, clipped to the region unless it will be stroked.
    def band_poly(r, along, rotation, width, offset, stroked)
      placed_band_poly(r, nil, along, rotation, width, offset, stroked)
    end

    def placed_band_poly(r, fixed, along, rotation, width, offset, stroked)
      frame = frame(fixed, r)
      c = frame_center(fixed, r)
      ax = axis(frame, along, rotation)
      poly = strip_poly(c, ax[0], ax[1], offset - width / 2.0, offset + width / 2.0, reach_from(c, r))
      return poly if stroked
      clip_convex(poly, r)
    end

    # A cross's vertical and horizontal arms, with their ends extended by a distance.
    def cross_polys(c, r, extend)
      a, w, b = c.fly_parts
      x0 = r.w * a / (a + w + b)
      x1 = r.w * (a + w) / (a + w + b)
      d, h, e = c.hoist_parts
      y0 = r.h * d / (d + h + e)
      y1 = r.h * (d + h) / (d + h + e)
      [Geometry.rect_poly(x0, -extend, x1, r.h + extend), Geometry.rect_poly(-extend, y0, r.w + extend, y1)]
    end

    def position(s, r)
      return r.center if s.at.nil?
      Geometry::Vec.new(s.at.fly, s.at.hoist)
    end

    def place_all(points, place)
      points.map { |p| place.call(p) }
    end
    private_class_method :place_all

    # Resolves a shape at a center, with its rotation added to the extra.
    def shape_geom(s, center, extra)
      rotation = s.rotate + extra
      place = ->(p) { center.add(p.rotate(rotation)) }
      case s.kind
      when "disc"
        g = Geom.new
        g.circle = true
        g.c = center
        g.r = s.radius.to_f
        g
      when "ring"
        return Geom.path(ring_arc_path(s, center, rotation)) if s.has_arc
        g = Geom.new
        g.ring = true
        g.c = center
        g.r = s.radius.to_f
        g.inner = s.inner.to_f
        g
      when "rect"
        x = s.fly / 2.0
        y = s.hoist / 2.0
        Geom.poly(place_all(Geometry.rect_poly(-x, -y, x, y), place))
      when "plus"
        a = s.radius.to_f
        w = s.width / 2.0
        Geom.poly(place_all([
          Geometry::Vec.new(-w, -a), Geometry::Vec.new(w, -a), Geometry::Vec.new(w, -w), Geometry::Vec.new(a, -w), Geometry::Vec.new(a, w), Geometry::Vec.new(w, w),
          Geometry::Vec.new(w, a), Geometry::Vec.new(-w, a), Geometry::Vec.new(-w, w), Geometry::Vec.new(-a, w), Geometry::Vec.new(-a, -w), Geometry::Vec.new(-w, -w)
        ], place))
      when "triangle"
        Geom.poly(place_all(star_points(3, s.radius, 0.0), place))
      when "star"
        return Geom.path(star_chords(s.points, s.radius, place)) if s.lines > 0
        Geom.poly(place_all(star_points(s.points, s.radius, s.inner), place))
      when "heart"
        Geom.path(heart_path(s.radius, s.spread, place))
      when "crescent"
        Geom.path(crescent_path(s.radius, s.inner, s.offset, place))
      when "sun"
        Geom.path(sun_path(s, center, place))
      when "lozenge"
        x = s.fly / 2.0
        y = s.hoist / 2.0
        Geom.poly(place_all([Geometry::Vec.new(0.0, -y), Geometry::Vec.new(x, 0.0), Geometry::Vec.new(0.0, y), Geometry::Vec.new(-x, 0.0)], place))
      when "ellipse"
        Geom.path(ellipse_path(center, s.fly / 2.0, s.hoist / 2.0, rotation))
      when "path"
        path_geom(s, center, rotation)
      when "cardioid"
        Geom.poly(place_all(cardioid_points(s.radius), place))
      when "polygon"
        Geom.poly(s.vertices.map { |p| Geometry::Vec.new(p.fly, p.hoist) })
      else
        Geom.new
      end
    end

    # A heart with its lobes either side of the origin and its tip below, whose straight sides meet
    # at a right angle and touch the lobes. place: a lambda taking and returning a Vec.
    def heart_path(radius, spread, place)
      radius = radius.to_f
      half = spread / 2.0
      edge = radius / Math.sqrt(2)
      tip = place.call(Geometry::Vec.new(0.0, half + radius * Math.sqrt(2)))
      right = place.call(Geometry::Vec.new(half + edge, edge))
      left = place.call(Geometry::Vec.new(-half - edge, edge))
      notch = place.call(Geometry::Vec.new(0.0, -Math.sqrt(radius * radius - half * half)))
      # Each arc runs from 45 degrees below the lobe's side, around to the notch.
      large = 225 - Math.acos(half / radius) * 180 / Math::PI > 180 ? 1 : 0
      r = num(radius)
      "M#{num(tip.x)} #{num(tip.y)}L#{num(right.x)} #{num(right.y)}" \
        "A#{r} #{r} 0 #{large} 0 #{num(notch.x)} #{num(notch.y)}" \
        "A#{r} #{r} 0 #{large} 0 #{num(left.x)} #{num(left.y)}Z"
    end

    # Lays out n outer points clockwise from up. An inner radius of 0 gives a regular polygon.
    def star_points(n, radius, inner)
      points = []
      step = 360.0 / n
      up = Geometry::Vec.new(0.0, -radius)
      down = Geometry::Vec.new(0.0, -inner)
      n.times do |i|
        a = i * step
        points << up.rotate(a)
        points << down.rotate(a + step / 2) if inner > 0
      end
      points
    end

    # Samples a cardioid with its cusp at the origin and its lobe below. 180 segments keep the error
    # under the format's tolerance for any radius up to the flag's hoist.
    def cardioid_points(radius)
      segments = 180
      points = []
      segments.times do |i|
        t = 2 * Math::PI * i / segments
        rho = radius * (1 - Math.cos(t)) / 2
        points << Geometry::Vec.new(rho * Math.sin(t), -rho * Math.cos(t))
      end
      points
    end

    # A disc with another cut from it, offset toward the fly.
    def crescent_path(radius, inner, offset, place)
      radius = radius.to_f
      inner = inner.to_f
      offset = offset.to_f
      x = (radius * radius - inner * inner + offset * offset) / (2 * offset)
      y = Math.sqrt([radius * radius - x * x, 0.0].max)
      top = place.call(Geometry::Vec.new(x, -y))
      bottom = place.call(Geometry::Vec.new(x, y))
      outer_large = x > 0 ? 1 : 0
      inner_large = x > offset ? 1 : 0
      "M#{num(top.x)} #{num(top.y)}" \
        "A#{num(radius)} #{num(radius)} 0 #{outer_large} 0 #{num(bottom.x)} #{num(bottom.y)}" \
        "A#{num(inner)} #{num(inner)} 0 #{inner_large} 1 #{num(top.x)} #{num(top.y)}Z"
    end

    # A disc and triangular rays, all wound the same way so that where they overlap stays filled.
    def sun_path(s, center, place)
      b = +circle_path(center, s.disc)
      base = s.disc + s.gap
      step = 360.0 / s.points
      half = step / 2 * s.spread
      s.points.times do |i|
        a = i * step
        tip = place.call(Geometry::Vec.new(0.0, -s.radius).rotate(a))
        left = place.call(Geometry::Vec.new(0.0, -base).rotate(a - half))
        right = place.call(Geometry::Vec.new(0.0, -base).rotate(a + half))
        b << " M" << num(right.x) << " " << num(right.y) << "L" << num(tip.x) << " " << num(tip.y) <<
          "L" << num(left.x) << " " << num(left.y) << "Z"
      end
      b
    end

    # Part of a ring, clockwise from one angle to another.
    def ring_arc_path(s, center, rotation)
      from = s.from + rotation
      # Clockwise from one to the other, by less than a full turn.
      to = from + fmod(fmod(s.to - s.from, 360.0) + 360, 360.0)
      large = to - from > 180 ? 1 : 0
      a = center.add(Geometry::Vec.new(0.0, -s.radius).rotate(from))
      b = center.add(Geometry::Vec.new(0.0, -s.radius).rotate(to))
      c = center.add(Geometry::Vec.new(0.0, -s.inner).rotate(to))
      d = center.add(Geometry::Vec.new(0.0, -s.inner).rotate(from))
      "M#{num(a.x)} #{num(a.y)}A#{num(s.radius)} #{num(s.radius)} 0 #{large} 1 " \
        "#{num(b.x)} #{num(b.y)}L#{num(c.x)} #{num(c.y)}A#{num(s.inner)} #{num(s.inner)}" \
        " 0 #{large} 0 #{num(d.x)} #{num(d.y)}Z"
    end

    # Joins a star's points by skipping one each time, which is one closed line for an odd number
    # of points and two for six, as on a hexagram.
    def star_chords(n, radius, place)
      seen = Array.new(n, false)
      b = +""
      n.times do |start|
        next if seen[start]
        p = place.call(Geometry::Vec.new(0.0, -radius).rotate(start * 360.0 / n))
        b << "M" << num(p.x) << " " << num(p.y)
        i = (start + 2) % n
        while i != start
          seen[i] = true
          p = place.call(Geometry::Vec.new(0.0, -radius).rotate(i * 360.0 / n))
          b << "L" << num(p.x) << " " << num(p.y)
          i = (i + 2) % n
        end
        seen[start] = true
        b << "Z"
      end
      b
    end

    # Fits a path's box within a size, keeping its shape, centered on a point.
    def path_geom(s, center, rotation)
      scale = Float::INFINITY
      scale = s.fly / s.box[2] if s.fly > 0
      if s.hoist > 0
        h = s.hoist / s.box[3]
        scale = h if h < scale || h.nan?
      end
      transform = +"translate(#{num(center.x)} #{num(center.y)})"
      transform << " rotate(#{num(rotation)})" if rotation != 0
      transform << " scale(#{factor(scale)}) translate(#{num(-s.box[0] - s.box[2] / 2.0)} " \
                   "#{num(-s.box[1] - s.box[3] / 2.0)})"
      g = Geom.path(s.d)
      g.transform = transform
      g.scale = scale.to_f
      g.evenodd = s.even_odd
      g
    end

    def circle_path(c, radius)
      rs = num(radius)
      "M#{num(c.x - radius)} #{num(c.y)}A#{rs} #{rs} 0 1 0 #{num(c.x + radius)} #{num(c.y)}" \
        "A#{rs} #{rs} 0 1 0 #{num(c.x - radius)} #{num(c.y)}Z"
    end

    # An ellipse with the given half sizes, turned clockwise by a rotation.
    def ellipse_path(c, x, y, rotation)
      a = c.sub(Geometry::Vec.new(x, 0.0).rotate(rotation))
      b = c.add(Geometry::Vec.new(x, 0.0).rotate(rotation))
      arc = "A#{num(x)} #{num(y)} #{num(rotation)} 1 0"
      "M#{num(a.x)} #{num(a.y)}#{arc} #{num(b.x)} #{num(b.y)}#{arc} #{num(a.x)} #{num(a.y)}Z"
    end

    # Fills in what a shape takes from the region it's in.
    def for_region(s, r)
      case s.kind
      when "lozenge"
        return s if s.fly > 0 && s.hoist > 0
        out = s.copy
        out.fly = r.w if out.fly == 0
        out.hoist = r.h if out.hoist == 0
        out
      when "pile"
        out = s.copy
        out.kind = "polygon"
        out.vertices = pile_points(s, r)
        out
      when "pall"
        out = s.copy
        out.kind = "polygon"
        out.vertices = pall_points(s, r)
        out
      else
        s
      end
    end

    # A lambda (in, along) -> Model::Point for an edge.
    def edge_frame(edge, r)
      case edge
      when "fly" then ->(i, along) { Model::Point.new(r.w - i, along) }
      when "top" then ->(i, along) { Model::Point.new(along, i) }
      when "bottom" then ->(i, along) { Model::Point.new(along, r.h - i) }
      else ->(i, along) { Model::Point.new(i, along) }
      end
    end
    private_class_method :edge_frame

    def edge_length(edge, r)
      edge == "top" || edge == "bottom" ? r.w : r.h
    end
    private_class_method :edge_length

    # Continues a pile's sides back past its edge, so that fimbriation doesn't run along the flag's edge.
    def pile_points(s, r)
      place = edge_frame(s.edge, r)
      length = edge_length(s.edge, r)
      a = 0.0
      b = length
      unless s.base.nil?
        a = s.base[0].to_f
        b = s.base[1].to_f
      end
      depth = s.depth.to_f
      along = (a + b) / 2
      unless s.tip.nil?
        along = s.tip[0].to_f
        depth = s.tip[1].to_f
      end
      lo = along - s.flat / 2.0
      hi = along + s.flat / 2.0
      back = r.reach
      back_a = a - (lo - a) * back / depth
      back_b = b + (b - hi) * back / depth
      [place.call(-back, back_a), place.call(depth, lo), place.call(depth, hi), place.call(-back, back_b)]
    end

    # Outlines a Y whose arms run from the corners of its edge to a junction, then on as one stem.
    def pall_points(s, r)
      place = edge_frame(s.edge, r)
      length = edge_length(s.edge, r)
      far = s.edge == "top" || s.edge == "bottom" ? r.h : r.w
      junction = s.junction == 0 ? length / 2 : s.junction.to_f
      half = s.width / 2.0
      mid = length / 2
      reach = r.reach + s.width
      l = Math.hypot(junction, mid)
      dir_in = junction / l
      dir_along = mid / l
      # The upper arm runs along (dir_in, dir_along) from the corner at along=0 to the junction,
      # in coordinates of (in, along from the center line).
      normal_in = dir_along
      normal_along = -dir_in
      line = lambda do |offset, target_along|
        # Where the arm's edge at an offset reaches a distance from the center line.
        start_in = normal_in * offset
        start_along = -mid + normal_along * offset
        start_in + (target_along - start_along) * dir_in / dir_along
      end
      shoulder = line.call(half, -half)
      notch = line.call(-half, 0.0)
      far_outer_in = normal_in * half - dir_in * reach
      far_outer_along = -mid + normal_along * half - dir_along * reach
      far_inner_in = -normal_in * half - dir_in * reach
      far_inner_along = -mid - normal_along * half - dir_along * reach
      at = ->(i, from_center) { place.call(i, mid + from_center) }
      [
        at.call(far_outer_in, far_outer_along),
        at.call(shoulder, -half),
        at.call(far + reach, -half),
        at.call(far + reach, half),
        at.call(shoulder, half),
        at.call(far_outer_in, -far_outer_along),
        at.call(far_inner_in, -far_inner_along),
        at.call(notch, 0.0),
        at.call(far_inner_in, far_inner_along)
      ]
    end

    # Resolves an outline for painting and clipping.
    def outline_geom(o, w, h)
      return Geom.poly(Geometry.outline_points(o, w, h)) if o.kind != "path"
      # A flag's own curved outline is stretched to its box.
      sx = w.to_f / o.box[2]
      sy = h.to_f / o.box[3]
      g = Geom.path(o.d)
      g.scale = 1.0
      g.transform = "scale(#{factor(sx)} #{factor(sy)}) translate(#{num(-o.box[0])} #{num(-o.box[1])})"
      g
    end

    # Samples a wavy or zigzag line along a span, as distances along it and displacements from it.
    # Returns [along, offset], two Arrays of Floats.
    def line_points(l, span)
      span = span.to_f
      period = l.period.to_f
      period = span / l.count if l.count > 0
      if span / period > Limits::MAX_COPIES
        raise Refusal, "a shaped edge can't have more than #{Limits::MAX_COPIES} waves"
      end
      half = l.depth / 2.0
      along = []
      offset = []
      if l.kind == "zigzag"
        sign = -1.0
        s = 0.0
        while s <= span + period / 4
          along << s
          offset << sign * half
          sign = -sign
          s += period / 2
        end
      else
        per_wave = 24
        s = 0.0
        while s <= span + period / per_wave / 2
          along << s
          offset << half * Math.sin(2 * Math::PI * s / period)
          s += period / per_wave
        end
      end
      [along, offset]
    end

    # A shaped line across a region, at offset t along normal, continued flat past the region.
    def wave_edge(c, dir, normal, t, span, reach, l)
      along, offset = line_points(l, span)
      points = [c.add(normal.mul(t + offset[0])).sub(dir.mul(reach))]
      along.each_index do |i|
        points << c.add(normal.mul(t + offset[i])).add(dir.mul(along[i] - span / 2.0))
      end
      points << c.add(normal.mul(t + offset[-1])).add(dir.mul(reach))
      points
    end

    # How far an axis runs across a region.
    def axis_span(r, along)
      case along
      when "fly" then r.w
      when "hoist" then r.h
      else r.reach
      end
    end

    # One wedge per color, each with an angle under 180 degrees or split so that it clips cleanly.
    def ray_polys(l, r)
      apex, from, sweep, walk = ray_frame(l, r)
      return ray_polys_by_edge(l, r, apex, walk) if l.by_edge
      from += l.rotate
      total = 0.0
      l.ratio.each { |part| total += part }
      reach = r.reach + Math.hypot(apex.x - r.w / 2, apex.y - r.h / 2)
      polys = []
      a = from
      ray = Geometry::Vec.new(0.0, -reach * 2)
      l.ratio.each do |part|
        width = sweep * part / total
        steps = (width / 60).ceil
        poly = [apex]
        (0..steps).each do |i|
          poly << apex.add(ray.rotate(a + width * i / steps))
        end
        polys << clip_convex(poly, r)
        a += width
      end
      polys
    end

    # Shares the region's far edges out by length, going clockwise.
    def ray_polys_by_edge(l, r, apex, path)
      length = 0.0
      (1...path.size).each do |i|
        length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
      end
      total = 0.0
      l.ratio.each { |part| total += part }
      # From outside the region, a wedge would cover what's between the point and the region.
      outside = apex.x < 0 || apex.x > r.w || apex.y < 0 || apex.y > r.h
      polys = []
      leg = 0
      into = 0.0
      at = path[0]
      l.ratio.each do |part|
        remaining = length * part / total
        poly = [apex, at]
        while remaining > 1e-9 && leg < path.size - 1
          nxt = path[leg + 1]
          leg_length = Math.hypot(nxt.x - path[leg].x, nxt.y - path[leg].y)
          left = leg_length - into
          if remaining < left
            into += remaining
            at = path[leg].add(nxt.sub(path[leg]).mul(into / leg_length))
            remaining = 0.0
            break
          end
          remaining -= left
          at = nxt
          poly << at
          leg += 1
          into = 0.0
        end
        poly << at if remaining == 0
        poly = clip_convex(poly, r) if outside
        polys << poly
      end
      polys
    end

    # Where rays start: a named point, or one given by position.
    def ray_point(l, r)
      return Geometry::Vec.new(l.at.fly, l.at.hoist) unless l.at.nil?
      case l.from
      when "upper-hoist" then Geometry::Vec.new(0.0, 0.0)
      when "lower-hoist" then Geometry::Vec.new(0.0, r.h)
      when "upper-fly" then Geometry::Vec.new(r.w, 0.0)
      when "lower-fly" then Geometry::Vec.new(r.w, r.h)
      when "hoist" then Geometry::Vec.new(0.0, r.h / 2)
      when "fly" then Geometry::Vec.new(r.w, r.h / 2)
      when "top" then Geometry::Vec.new(r.w / 2, 0.0)
      when "bottom" then Geometry::Vec.new(r.w / 2, r.h)
      else r.center
      end
    end

    # Where rays start, the angle they cover going clockwise from up, and the region's far edges,
    # which are the ones the point is inside of, walked clockwise. Returns [apex, from, sweep, walk].
    def ray_frame(l, r)
      apex = ray_point(l, r)
      corners = r.corners
      # Edge i runs clockwise from corner i: the top, the fly, the bottom and the hoist.
      inward = [Geometry::Vec.new(0.0, 1.0), Geometry::Vec.new(-1.0, 0.0), Geometry::Vec.new(0.0, -1.0),
                Geometry::Vec.new(1.0, 0.0)]
      far = Array.new(4) { |i| apex.sub(corners[i]).dot(inward[i]) > 0 }
      first = -1
      4.times do |i|
        first = i if far[i] && !far[(i + 3) % 4]
      end
      if first < 0
        # Every edge is far, so the point is inside, and the rays go all the way round from up.
        top = Geometry::Vec.new(apex.x, 0.0)
        return [apex, 0.0, 360.0, [top, corners[1], corners[2], corners[3], corners[0], top]]
      end
      walk = [corners[first]]
      i = first
      while far[i % 4]
        walk << corners[(i + 1) % 4]
        i += 1
      end
      from = bearing(walk[0].sub(apex))
      sweep = (bearing(walk[-1].sub(apex)) - from + 360) % 360
      [apex, from, sweep, walk]
    end

    # A direction's angle clockwise from up, exactly for the four straight ones.
    def bearing(v)
      return 0.0 if v.x == 0 && v.y < 0
      return 90.0 if v.y == 0 && v.x > 0
      return 180.0 if v.x == 0 && v.y > 0
      return 270.0 if v.y == 0 && v.x < 0
      # Both operands are positive here, where Ruby's % is fmod.
      (Math.atan2(v.x, -v.y) * 180 / Math::PI + 360) % 360
    end

    # A panel's place in its parent, in the parent's coordinates. Returns [x, y, w, h].
    def panel_rect(p, r)
      extra = p.line.nil? ? 0.0 : p.line.depth / 2.0
      case p.side
      when "hoist" then return [0.0, 0.0, p.width + extra, r.h]
      when "fly" then return [r.w - p.width - extra, 0.0, p.width + extra, r.h]
      when "top" then return [0.0, 0.0, r.w, p.width + extra]
      when "bottom" then return [0.0, r.h - p.width - extra, r.w, p.width + extra]
      end
      case p.corner
      when "upper-hoist" then return [0.0, 0.0, p.fly.to_f, p.hoist.to_f]
      when "upper-fly" then return [r.w - p.fly, 0.0, p.fly.to_f, p.hoist.to_f]
      when "lower-hoist" then return [0.0, r.h - p.hoist, p.fly.to_f, p.hoist.to_f]
      when "lower-fly" then return [r.w - p.fly, r.h - p.hoist, p.fly.to_f, p.hoist.to_f]
      end
      at = p.at.nil? ? r.center : Geometry::Vec.new(p.at.fly, p.at.hoist)
      [at.x - p.fly / 2.0, at.y - p.hoist / 2.0, p.fly.to_f, p.hoist.to_f]
    end

    # A panel's outline when it has a shaped edge, in its own coordinates. A line whose last point
    # falls short of the side's end runs on flat to it, as one between bars does.
    def panel_edge(p, w, h)
      w = w.to_f
      h = h.to_f
      span = p.side == "hoist" || p.side == "fly" ? h : w
      along, offset = line_points(p.line, span)
      if span - along[-1] > 1e-9 * span
        along = along + [span]
        offset = offset + [offset[-1]]
      end
      half = p.line.depth / 2.0
      points = []
      case p.side
      when "hoist"
        points << Geometry::Vec.new(0.0, 0.0)
        along.each_index { |i| points << Geometry::Vec.new(w - half + offset[i], along[i]) }
        points << Geometry::Vec.new(0.0, h)
      when "fly"
        points << Geometry::Vec.new(w, 0.0)
        along.each_index { |i| points << Geometry::Vec.new(half - offset[i], along[i]) }
        points << Geometry::Vec.new(w, h)
      when "top"
        points << Geometry::Vec.new(0.0, 0.0)
        along.each_index { |i| points << Geometry::Vec.new(along[i], h - half + offset[i]) }
        points << Geometry::Vec.new(w, 0.0)
      else
        points << Geometry::Vec.new(0.0, h)
        along.each_index { |i| points << Geometry::Vec.new(along[i], half - offset[i]) }
        points << Geometry::Vec.new(w, h)
      end
      points
    end
  end
end
