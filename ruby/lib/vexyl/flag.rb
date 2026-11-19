# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # A parsed and valid Vexyl document. It never changes, rendering included, so one flag can be
  # rendered with many options, from many threads at once.
  class Flag
    def initialize(doc)
      @doc = doc
      freeze
    end

    # The flag's name, from its +meta+.
    def name
      @doc.meta.name
    end

    # The flag's proportion, which is also its grid: its height.
    def hoist
      @doc.hoist
    end

    # The flag's proportion, which is also its grid: its width.
    def fly
      @doc.fly
    end

    # The names of the flag's variants, in document order.
    def variants
      @doc.variants.keys.freeze
    end

    # The names of the flag's folds, in document order.
    def folds
      @doc.folds.keys.freeze
    end

    # The flag as plain data, in the canonical form of section 4 of the SDK: hashes with string
    # keys, arrays, strings, numbers and booleans, all frozen.
    def model
      Canonical.model(@doc)
    end

    # The canonical model as JSON, as the conformance suite compares it.
    def model_json
      Json.write(model)
    end

    # Renders the flag as an SVG document. Takes a RenderOptions, a hash of options, or the
    # options as keywords, such as <tt>flag.svg(height: 300, variant: "vertical")</tt>. Raises
    # Vexyl::Error if an option can't be used, or the flag can't be drawn as asked.
    def svg(options = nil, **keywords)
      Render.svg(@doc, RenderOptions.from(options, **keywords))
    end

    # Renders the flag as a tree of Vexyl::Element, which writes out as a document that draws
    # the same as #svg. Only a +title+ or +desc+ holds any text.
    def svg_tree(options = nil, **keywords)
      Render.tree(svg(options, **keywords))
    end

    def inspect
      "#<Vexyl::Flag #{name.inspect}>"
    end
  end
end
