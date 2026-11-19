# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # What a document says, as the parser reads it. These are the library's own, and change only
  # while a document is read: rendering copies what it changes, so a flag stays as it was.
  module Model
    # Copies a value shallowly, as assigning a struct does in Go.
    module Copyable
      def copy
        dup
      end
    end

    class Doc
      include Copyable
      attr_accessor :version, :meta, :palette, :color_refs, :gradients, :hoist, :fly, :outline,
                    :border, :border_outside, :defines, :layers, :reverse, :adapt, :variants, :folds,
                    :id_prefix, :seen_from_behind

      def initialize
        @version = 0
        @meta = Meta.new
        # Color names to #rrggbb values, in lowercase.
        @palette = {}
        # Colors' values in other systems, for print and dye.
        @color_refs = {}
        @gradients = {}
        @hoist = 0.0
        @fly = 0.0
        @outline = nil
        @border = nil
        @border_outside = false
        @defines = {}
        @layers = []
        @reverse = nil
        @adapt = nil
        @variants = {}
        @folds = {}
        # Unique to the source, so that several flags can be inlined in one page.
        @id_prefix = ""
        # Says that the layers are a reverse's own, as seen from behind, while it's drawn.
        @seen_from_behind = false
      end
    end

    class Gradient
      attr_accessor :colors, :stops, :along

      def initialize
        @colors = []
        @stops = nil
        @along = "fly"
      end
    end

    class Meta
      attr_accessor :name, :description, :version, :date, :until, :series, :notes, :laws,
                    :restrictions, :designers, :design_rights, :encoders, :license, :render_license,
                    :adapted_from, :sources

      def initialize
        @name = ""
        @description = ""
        @version = ""
        @date = ""
        @until = ""
        @series = ""
        @notes = []
        @laws = []
        @restrictions = []
        @designers = []
        @design_rights = ""
        @encoders = []
        @license = ""
        @render_license = ""
        @adapted_from = []
        @sources = []
      end
    end

    class Adaptation
      attr_accessor :url, :authors, :license, :part

      def initialize
        @url = ""
        @authors = []
        @license = ""
        @part = ""
      end
    end

    class Reference
      attr_accessor :text, :sources

      def initialize
        @text = ""
        @sources = []
      end
    end

    class ColorRef
      # numbers: the same value as numbers, for cmyk. other: a system named in a `reference`,
      # rather than one of the format's own.
      attr_accessor :system, :value, :numbers, :other

      def initialize
        @system = ""
        @value = ""
        @numbers = nil
        @other = false
      end
    end

    class Point
      attr_reader :fly, :hoist

      def initialize(fly, hoist)
        @fly = fly.to_f
        @hoist = hoist.to_f
      end
    end

    class Edge
      attr_reader :color, :width

      def initialize(color, width)
        @color = color
        @width = width.to_f
      end
    end

    class Outline
      include Copyable
      # kind: polygon, path, swallowtail, tongued or pennant.
      attr_accessor :kind, :vertices, :d, :box, :depth, :tip, :tongue, :taper

      def initialize
        @kind = ""
        @vertices = []
        @d = ""
        @box = [0.0, 0.0, 0.0, 0.0]
        @depth = 0.0
        @tip = 0.0
        @tongue = 0.0
        @taper = 0.0
      end
    end

    class Define
      # fly, hoist: a design's own grid, scaled to fill where it's used. size, height: worked out
      # when it's read, as SPEC section 15 counts them.
      attr_accessor :shape, :layers, :fly, :hoist, :size, :height

      def initialize
        @shape = nil
        @layers = []
        @fly = 0.0
        @hoist = 0.0
        @size = 0
        @height = 0
      end
    end

    class Reverse
      attr_accessor :layers

      def initialize
        @layers = []
      end
    end

    class Adapt
      # min, max: limits on the proportion as fly divided by hoist; zero is no limit. wider,
      # narrower: extend, center, scale, hoist-extend, hoist-center or hoist-scale, or "" for none.
      attr_accessor :min, :max, :wider, :narrower

      def initialize
        @min = 0.0
        @max = 0.0
        @wider = ""
        @narrower = ""
      end
    end

    class Variant
      attr_accessor :from, :upright, :ratio, :fly, :hoist, :outline, :border, :border_outside, :layers

      def initialize
        @from = "none"
        @upright = false
        @ratio = 0.0
        @fly = 0.0
        @hoist = 0.0
        @outline = nil
        @border = nil
        @border_outside = false
        @layers = []
      end
    end

    class Fold
      attr_accessor :description, :sources, :steps

      def initialize
        @description = ""
        @sources = []
        @steps = []
      end
    end

    class FoldStep
      # kind: over, under or tuck. along, move, at: for a crease along an axis. through, move_to:
      # for a crease through two points, as written. a, b, moving: the crease's two points, and a
      # point on the side that moves.
      attr_accessor :kind, :along, :move, :at, :through, :move_to, :a, :b, :moving

      def initialize
        @kind = ""
        @along = ""
        @move = ""
        @at = 0.0
        @through = nil
        @move_to = nil
        @a = nil
        @b = nil
        @moving = nil
      end
    end

    # A wavy or zigzag edge between divisions.
    class Line
      attr_accessor :kind, :depth, :period, :count

      def initialize
        @kind = ""
        @depth = 0.0
        @period = 0.0
        @count = 0
      end

      # How many waves it has across the flag's longer side.
      def waves(longer)
        return @count if @count > 0
        return 0 if @period <= 0
        waves = (longer / @period).ceil
        return Limits::MAX_COPIES + 1 if waves > Limits::MAX_COPIES
        waves.to_i
      end
    end

    # One of the layers of section 6 of the format, with the properties they all have.
    class Layer
      include Copyable
      # anchor: start, center, end or scale, or "" to follow the flag's rule.
      attr_accessor :anchor, :opacity, :blend, :clip, :cuts

      def initialize
        @anchor = ""
        @opacity = 1.0
        @blend = "normal"
        @clip = nil
        @cuts = []
      end
    end

    class Field < Layer
      attr_accessor :color

      def initialize
        super
        @color = ""
      end

      def kind = "field"
    end

    # Where adapting put a rotated bars or band, if it did: the region it was drawn in (w, h),
    # and where its center moved to in the new one (x, y).
    class FixedFrame
      attr_accessor :w, :h, :x, :y

      def initialize(w, h, x, y)
        @w = w
        @h = h
        @x = x
        @y = y
      end
    end

    class Bars < Layer
      attr_accessor :colors, :along, :ratio, :rotate, :grow, :line, :fixed

      def initialize
        super
        @colors = []
        @along = "fly"
        @ratio = nil
        @rotate = 0.0
        @grow = nil
        @line = nil
        @fixed = nil
      end

      def kind = "bars"
    end

    class Chevrons < Layer
      # apex is nil when it isn't given.
      attr_accessor :colors, :from, :depth, :angle, :apex, :ratio, :rotate, :fimbriate

      def initialize
        super
        @colors = []
        @from = "hoist"
        @depth = 0.0
        @angle = 0.0
        @apex = nil
        @ratio = nil
        @rotate = 0.0
        @fimbriate = nil
      end

      def kind = "chevrons"
    end

    class Band < Layer
      attr_accessor :color, :along, :width, :offset, :rotate, :fimbriate, :fixed

      def initialize
        super
        @color = ""
        @along = "fly"
        @width = 0.0
        @offset = 0.0
        @rotate = 0.0
        @fimbriate = nil
        @fixed = nil
      end

      def kind = "band"
    end

    class Cross < Layer
      attr_accessor :color, :fly_parts, :hoist_parts, :fimbriate

      def initialize
        super
        @color = ""
        @fly_parts = [0.0, 1.0, 0.0]
        @hoist_parts = [0.0, 1.0, 0.0]
        @fimbriate = nil
      end

      def kind = "cross"
    end

    class Saltire < Layer
      attr_accessor :color, :width, :fimbriate, :counterchange

      def initialize
        super
        @color = ""
        @width = 0.0
        @fimbriate = nil
        @counterchange = false
      end

      def kind = "saltire"
    end

    class Quarters < Layer
      attr_accessor :colors, :diagonal, :split

      def initialize
        super
        @colors = ["", "", "", ""]
        @diagonal = false
        @split = nil
      end

      def kind = "quarters"
    end

    class Checks < Layer
      attr_accessor :colors, :rows, :columns, :flow

      def initialize
        super
        @colors = []
        @rows = 0
        @columns = 0
        @flow = "bend-sinister"
      end

      def kind = "checks"
    end

    class Rays < Layer
      # from: center, a corner or the middle of an edge; at overrides it.
      attr_accessor :colors, :from, :at, :ratio, :rotate, :by_edge

      def initialize
        super
        @colors = []
        @from = "center"
        @at = nil
        @ratio = nil
        @rotate = 0.0
        @by_edge = false
      end

      def kind = "rays"
    end

    # A charge, or a pile or pall, which are read as charges of their own shapes.
    class Charge < Layer
      # color is optional for inline SVG, where it's what currentColor means.
      attr_accessor :shape, :color, :fimbriate, :repeat

      def initialize
        super
        @shape = Shape.new
        @color = ""
        @fimbriate = nil
        @repeat = nil
      end

      def kind
        k = @shape.kind
        k == "pile" || k == "pall" ? k : "charge"
      end
    end

    class Emblem < Layer
      attr_accessor :at, :along, :rotate, :charges

      def initialize
        super
        @at = nil
        @along = ""
        @rotate = 0.0
        @charges = []
      end

      def kind = "emblem"
    end

    class Group < Layer
      attr_accessor :layers

      def initialize
        super
        @layers = []
      end

      def kind = "group"
    end

    class Panel < Layer
      # canton: written as a canton.
      attr_accessor :side, :width, :corner, :at, :fly, :hoist, :line, :layers, :canton

      def initialize
        super
        @side = ""
        @width = 0.0
        @corner = ""
        @at = nil
        @fly = 0.0
        @hoist = 0.0
        @line = nil
        @layers = []
        @canton = false
      end

      def kind
        @canton ? "canton" : "panel"
      end
    end

    class Use < Layer
      # design: the definition it names, which isn't part of the use itself.
      attr_accessor :name, :design

      def initialize
        super
        @name = ""
        @design = nil
      end

      def kind = "use"
    end

    # A shape used by a charge, clip or cut, or a definition.
    class Shape
      include Copyable
      # at: the position, or nil for the center of the region. ats: the positions of a charge
      # given several, each nil for the center. edge: the edge a pile or pall starts from.
      # markup: inline SVG after being sanitized, in its canonical form. placed: an explicit `at`,
      # even `at center`. auto_inner, auto_spread: values worked out from the shape's others, which
      # a charge using a definition works out again. has_flat: a pile's `flat`, even `flat 0`.
      # embedded: the sanitized artwork.
      attr_accessor :kind, :at, :ats, :rotate, :radius, :inner, :points, :width, :spread, :from, :to,
                    :has_arc, :offset, :disc, :gap, :hollow, :lines, :d, :box, :even_odd, :edge, :base,
                    :tip, :depth, :flat, :junction, :fly, :hoist, :vertices, :markup, :placed,
                    :auto_inner, :auto_spread, :has_flat, :embedded

      def initialize
        @kind = ""
        @at = nil
        @ats = []
        @rotate = 0.0
        @radius = 0.0
        @inner = 0.0
        @points = 0
        @width = 0.0
        @spread = 0.0
        @from = 0.0
        @to = 0.0
        @has_arc = false
        @offset = 0.0
        @disc = 0.0
        @gap = 0.0
        @hollow = 0.0
        @lines = 0.0
        @d = ""
        @box = [0.0, 0.0, 0.0, 0.0]
        @even_odd = false
        @edge = ""
        @base = nil
        @tip = nil
        @depth = 0.0
        @flat = 0.0
        @junction = 0.0
        @fly = 0.0
        @hoist = 0.0
        @vertices = []
        @markup = ""
        @placed = false
        @auto_inner = false
        @auto_spread = false
        @has_flat = false
        @embedded = nil
      end
    end

    class Repeat
      include Copyable
      # kind: ring, arc, grid or line.
      attr_accessor :kind, :count, :radius, :turn, :from, :to, :rows, :columns, :stagger, :fly, :hoist

      def initialize
        @kind = ""
        @count = 0
        @radius = 0.0
        @turn = false
        @from = 0.0
        @to = 0.0
        @rows = 0
        @columns = 0
        @stagger = false
        @fly = 0.0
        @hoist = 0.0
      end
    end
  end
end
