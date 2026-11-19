# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # Points, polygons and folds, which reading a document checks and rendering draws.
  module Geometry
    # Degrees to radians, as one constant, so that every conversion rounds the same way.
    DEGREES_TO_RADIANS = 0.017453292519943295

    # An immutable point or direction.
    class Vec
      attr_reader :x, :y

      def initialize(x, y)
        @x = x.to_f
        @y = y.to_f
      end

      def add(b)
        Vec.new(@x + b.x, @y + b.y)
      end

      def sub(b)
        Vec.new(@x - b.x, @y - b.y)
      end

      def mul(k)
        Vec.new(@x * k, @y * k)
      end

      def dot(b)
        @x * b.x + @y * b.y
      end

      # Turns clockwise as seen by the viewer, since y points down.
      def rotate(degrees)
        r = degrees * DEGREES_TO_RADIANS
        s = Math.sin(r)
        c = Math.cos(r)
        Vec.new(@x * c - @y * s, @x * s + @y * c)
      end

      def inspect
        "#<Vec #{@x}, #{@y}>"
      end
      alias to_s inspect
    end

    module_function

    def rect_poly(x0, y0, x1, y1)
      [Vec.new(x0, y0), Vec.new(x1, y0), Vec.new(x1, y1), Vec.new(x0, y1)]
    end

    # An outline's corners on a flag w wide and h high, or nil if it's curved.
    def outline_points(o, w, h)
      w = w.to_f
      h = h.to_f
      case o.kind
      when "polygon"
        o.vertices.map { |p| Vec.new(p.fly, p.hoist) }
      when "swallowtail"
        [Vec.new(0.0, 0.0), Vec.new(w, o.taper), Vec.new(w - o.depth, h / 2), Vec.new(w, h - o.taper),
         Vec.new(0.0, h)]
      when "tongued"
        a = (h - o.tongue) / 2
        [Vec.new(0.0, 0.0), Vec.new(w, 0.0), Vec.new(w - o.depth, a), Vec.new(w, h / 2),
         Vec.new(w - o.depth, h - a), Vec.new(w, h), Vec.new(0.0, h)]
      when "pennant"
        a = (h - o.tip) / 2
        if o.tip == 0
          return [Vec.new(0.0, 0.0), Vec.new(w, h / 2), Vec.new(0.0, h)]
        end
        [Vec.new(0.0, 0.0), Vec.new(w, a), Vec.new(w, h - a), Vec.new(0.0, h)]
      end
    end

    # The flag's shape before any outside border, or nil for a curved outline.
    def boundary(f)
      return rect_poly(0.0, 0.0, f.fly, f.hoist) if f.outline.nil?
      outline_points(f.outline, f.fly, f.hoist)
    end

    # Moves a polygon's edges outward by a distance, keeping its angles mitered. It fails on
    # polygons with no area, repeated points or edges that fold back on themselves, where outward
    # has no meaning.
    def offset_polygon(poly, distance)
      area = 0.0
      n = poly.size
      n.times do |i|
        p = poly[i]
        q = poly[(i + 1) % n]
        area += p.x * q.y - q.x * p.y
      end
      raise Vexyl::Error, "shape has no area, so it can't have an outside border" if area == 0
      side = area < 0 ? -1.0 : 1.0
      out = []
      n.times do |i|
        p = poly[i]
        n1 = normal(poly[(i + n - 1) % n], p, side)
        n2 = normal(p, poly[(i + 1) % n], side)
        if n1.nil? || n2.nil?
          raise Vexyl::Error, "shape repeats a point, so it can't have an outside border"
        end
        turn = 1 + n1.dot(n2)
        raise Vexyl::Error, "shape folds back on itself, so it can't have an outside border" if turn < 1e-9
        out << p.add(n1.add(n2).mul(distance / turn))
      end
      out
    end

    def normal(a, b, side)
      l = Math.hypot(b.x - a.x, b.y - a.y)
      return nil if l == 0
      Vec.new(side * (b.y - a.y) / l, -side * (b.x - a.x) / l)
    end
    private_class_method :normal

    def poly_area(poly)
      sum = 0.0
      n = poly.size
      n.times do |i|
        p = poly[i]
        q = poly[(i + 1) % n]
        sum += p.x * q.y - q.x * p.y
      end
      sum.abs / 2
    end

    # Maps (x, y) to (a*x + c*y + e, b*x + d*y + f), as SVG writes it.
    class Matrix
      attr_reader :a, :b, :c, :d, :e, :f

      def initialize(a, b, c, d, e, f)
        @a = a.to_f
        @b = b.to_f
        @c = c.to_f
        @d = d.to_f
        @e = e.to_f
        @f = f.to_f
      end

      IDENTITY = new(1, 0, 0, 1, 0, 0)

      def apply(p)
        Vec.new(@a * p.x + @c * p.y + @e, @b * p.x + @d * p.y + @f)
      end

      # The transform that applies this, followed by n.
      def followed_by(n)
        Matrix.new(
          n.a * @a + n.c * @b, n.b * @a + n.d * @b,
          n.a * @c + n.c * @d, n.b * @c + n.d * @d,
          n.a * @e + n.c * @f + n.e, n.b * @e + n.d * @f + n.f
        )
      end

      # Reflects across the line through p and q.
      def self.reflection(p, q)
        d = q.sub(p)
        l = d.dot(d)
        cos = (d.x * d.x - d.y * d.y) / l
        sin = 2 * d.x * d.y / l
        new(cos, sin, sin, -cos, p.x - cos * p.x - sin * p.y, p.y - sin * p.x + cos * p.y)
      end
    end

    # A flat piece of the folded flag. Its polygon is where it now lies, and its transform takes
    # the flag's coordinates there. Facets are kept from back to front, and flipped ones show the
    # flag's other side.
    class Facet
      attr_reader :poly, :place, :flipped

      def initialize(poly, place, flipped)
        @poly = poly
        @place = place
        @flipped = flipped
      end

      alias flipped? flipped
    end

    # Keeps the part of a polygon on one side of a line.
    def half_plane(poly, a, b, side)
      d = b.sub(a)
      out = []
      n = poly.size
      n.times do |i|
        cur = poly[i]
        prev = poly[(i + n - 1) % n]
        vc = side * (d.x * (cur.y - a.y) - d.y * (cur.x - a.x))
        vp = side * (d.x * (prev.y - a.y) - d.y * (prev.x - a.x))
        out << prev.add(cur.sub(prev).mul(vp / (vp - vc))) if (vc >= 0) != (vp >= 0)
        out << cur if vc >= 0
      end
      out
    end

    # Folds a flat shape through a number of steps, or all of them if steps is 0.
    def fold_facets(shape, fold, steps)
      stack = [Facet.new(shape, Matrix::IDENTITY, false)]
      limit = poly_area(shape) * 1e-9
      fold.steps.each_with_index do |step, i|
        break if steps > 0 && i == steps
        a = Vec.new(step.a.fly, step.a.hoist)
        b = Vec.new(step.b.fly, step.b.hoist)
        moving = Vec.new(step.moving.fly, step.moving.hoist)
        d = b.sub(a)
        side = d.x * (moving.y - a.y) - d.y * (moving.x - a.x)
        if side == 0 || d.dot(d) == 0
          raise Vexyl::Error, format("fold step %d: its point to move is on its crease", i + 1)
        end
        side = side < 0 ? -1.0 : 1.0
        mirror = Matrix.reflection(a, b)
        kept = []
        moved = []
        stack.each do |f|
          part = half_plane(f.poly, a, b, -side)
          kept << Facet.new(part, f.place, f.flipped) if poly_area(part) > limit
          part = half_plane(f.poly, a, b, side)
          if poly_area(part) > limit
            reflected = part.map { |p| mirror.apply(p) }
            moved << Facet.new(reflected, f.place.followed_by(mirror), !f.flipped)
          end
        end
        raise Vexyl::Error, format("fold step %d: nothing is on the side it moves", i + 1) if moved.empty?
        if kept.empty?
          raise Vexyl::Error, format("fold step %d: nothing is left on the other side of its crease", i + 1)
        end
        if kept.size + moved.size > Limits::MAX_FACETS
          raise Vexyl::Error, format("fold step %d: makes more than %d pieces", i + 1, Limits::MAX_FACETS)
        end
        # Whichever way it goes, the moving stack lands in reverse order.
        moved.reverse!
        stack = case step.kind
                when "over" then kept.concat(moved)
                when "under" then moved.concat(kept)
                else kept # A tuck goes inside the fold, out of sight.
                end
      end
      stack
    end

    # The flat shape a flag folds as, including an outside border.
    def fold_shape(f)
      shape = boundary(f)
      # A curved outline folds as its rectangle, with the flag's own clip inside.
      shape = rect_poly(0.0, 0.0, f.fly, f.hoist) if shape.nil?
      return offset_polygon(shape, f.border.width) if !f.border.nil? && f.border_outside
      shape
    end
  end
end
