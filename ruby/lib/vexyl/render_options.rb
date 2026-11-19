# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # How to render a flag, as section 3 of the SDK describes. Every option is optional, and
  # rendering with none gives the flag as it is. A value that can't be used is refused when the
  # flag is rendered, so that no option is ever silently ignored.
  #
  #   opts = Vexyl::RenderOptions.new(height: 300, variant: "vertical")
  #   flag.svg(height: 300, variant: "vertical")   # the same, as keywords
  class RenderOptions
    # The height an image has without the +height+ option.
    DEFAULT_HEIGHT = 600.0

    KEYS = %i[height ratio variant side fit align fold fold_step id_prefix tags].freeze

    # +height+ and +ratio+ are numbers, or nil for the default; +ratio+ is fly divided by hoist.
    # +fold_step+ is a whole number, or nil for all of a fold's steps. The others are strings,
    # where nil or "" is the default, apart from +tags+, which is true or false.
    attr_reader(*KEYS)

    def initialize(height: nil, ratio: nil, variant: nil, side: nil, fit: nil, align: nil, fold: nil,
                   fold_step: nil, id_prefix: nil, tags: false)
      @height = height.nil? ? nil : Float(height)
      @ratio = ratio.nil? ? nil : Float(ratio)
      @variant = variant.to_s.dup.freeze
      @side = side.to_s.dup.freeze
      @fit = fit.to_s.dup.freeze
      @align = align.to_s.dup.freeze
      @fold = fold.to_s.dup.freeze
      @fold_step = fold_step.nil? ? nil : Integer(fold_step)
      @id_prefix = id_prefix.to_s.dup.freeze
      @tags = tags ? true : false
      freeze
    end

    # No options: the flag as it is, at the default height.
    def self.defaults
      @defaults ||= new
    end

    # These options with some of them changed.
    def with(**changes)
      self.class.new(**to_h, **changes)
    end

    def to_h
      KEYS.to_h { |k| [k, public_send(k)] }
    end

    # Options from a RenderOptions, a hash of them, or nil for none.
    # Options from a RenderOptions, a hash of them or nil, with any keywords changing them.
    def self.from(value = nil, **keywords)
      base = case value
             when nil then defaults
             when RenderOptions then value
             when Hash then new(**value.transform_keys(&:to_sym))
             else raise ArgumentError, "options have to be a Vexyl::RenderOptions or a hash"
             end
      keywords.empty? ? base : base.with(**keywords)
    end
  end
end
