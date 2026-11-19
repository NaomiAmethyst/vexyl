# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # The limits of section 15 of the format, so that a small document can't demand unbounded work.
  module Limits
    MAX_DEPTH = 32
    # How much a whole flag can paint.
    MAX_SIZE = 200_000
    MAX_COPIES = 10_000
    # How many pieces a fold can make, since each step can double them.
    MAX_FACETS = 10_000
    # How many bytes of path data or inline SVG count as one part.
    BYTES_PER_PART = 64
    # The largest size a number can have, and its inverse the smallest.
    NUMBER_LIMIT = 1e12

    module_function

    # Whether a number is finite and of a reasonable size.
    def in_limits(v)
      a = v.abs
      !v.nan? && a <= NUMBER_LIMIT && (a == 0 || a >= 1 / NUMBER_LIMIT)
    end

    # Adds sizes without passing the point where they stop mattering.
    def add(a, b)
      [a + b, MAX_SIZE + 1].min
    end

    def mul(a, b)
      return 0 if a == 0 || b == 0
      [a * b, MAX_SIZE + 1].min
    end

    def bytes(s)
      s.bytesize
    end

    # How many parts one copy of a shape counts as.
    def shape_parts(s)
      case s.kind
      when "star", "sun" then [s.points, 1].max
      when "polygon" then [s.vertices.size, 1].max
      when "path" then 1 + bytes(s.d) / BYTES_PER_PART
      when "svg" then 1 + bytes(s.markup) / BYTES_PER_PART
      else 1
      end
    end

    def charge_copies(c)
      return c.repeat.rows * c.repeat.columns if c.repeat && c.repeat.kind == "grid"
      return c.repeat.count if c.repeat
      return c.shape.ats.size if c.shape.ats.size > 1
      1
    end

    # What a layer paints. A definition's size was worked out when it was read.
    def layer_size(l, longer)
      size = l.clip ? shape_parts(l.clip) : 0
      cuts = 0
      l.cuts.each { |s| cuts = add(cuts, shape_parts(s)) }
      # A charge's cuts go with each of its copies.
      cuts = mul(charge_copies(l), cuts) if l.is_a?(Model::Charge)
      add(add(size, cuts), content_size(l, longer))
    end

    def content_size(l, longer)
      case l
      when Model::Bars
        return mul(l.colors.size, 1 + l.line.waves(longer)) if l.line
        l.colors.size
      when Model::Chevrons, Model::Rays
        l.colors.size
      when Model::Quarters
        4
      when Model::Checks
        mul(l.rows, l.columns)
      when Model::Charge
        mul(charge_copies(l), shape_parts(l.shape))
      when Model::Emblem
        size = 0
        l.charges.each { |c| size = add(size, layer_size(c, longer)) }
        size
      when Model::Group
        layers_size(l.layers, longer)
      when Model::Panel
        size = layers_size(l.layers, longer)
        size = add(size, l.line.waves(longer)) if l.line
        size
      when Model::Use
        l.design.size
      else
        1
      end
    end
    private_class_method :content_size

    def layers_size(layers, longer)
      size = 0
      layers.each { |l| size = add(size, layer_size(l, longer)) }
      size
    end

    # How many levels a layer nests, counting what it uses.
    def layer_height(l)
      case l
      when Model::Group, Model::Panel then 1 + layers_height(l.layers)
      when Model::Use then 1 + l.design.height
      else 1
      end
    end

    def layers_height(layers)
      height = 0
      layers.each { |l| height = [height, layer_height(l)].max }
      height
    end
  end
end
