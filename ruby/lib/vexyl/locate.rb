# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # Where a layer or other part of a document is, as section 7.3 of the SDK describes it. +path+
  # is a layer's path, such as "3.1" or "variant/NAME/0", or what else it is, such as
  # "palette/NAME", and +node+ the KDL node's name. Lines and columns are counted as a Problem's
  # are, and a part ends just past its last character, not counting a ; or line ending.
  Span = Struct.new(:path, :node, :line, :column, :end_line, :end_column) do
    def to_h
      { "path" => path, "node" => node, "line" => line, "column" => column,
        "endLine" => end_line, "endColumn" => end_column }
    end
  end

  # Finds each part of a document from its syntax alone.
  module Locate
    LAYER_NAMES = %w[field bars chevrons band cross saltire quarters checks rays pile pall charge
                     emblem group panel canton use].freeze
    HOLDS_LAYERS = %w[emblem group panel canton].freeze

    module_function

    # Writes a name in a path, where a slash separates the parts.
    def encode_name(name)
      name.gsub("%", "%25").gsub("/", "%2F")
    end

    def decode_name(part)
      part.gsub("%2F", "/").gsub("%25", "%")
    end

    # The path of what holds a layer, or "" if it's at the top of its scope.
    def parent_path(path)
      dot = path.rindex(".")
      slash = path.rindex("/") || -1
      dot && dot > slash ? path[0, dot] : ""
    end

    # Turns code point offsets into lines and columns, as Problems count them.
    class Places
      def initialize(src)
        @starts = [0]
        src.each_char.with_index { |c, i| @starts << (i + 1) if c == "\n" }
      end

      def [](offset)
        line = @starts.bsearch_index { |s| s > offset } || @starts.length
        [line, offset - @starts[line - 1] + 1]
      end
    end

    def locate(text)
      src = Parser.normalize_newlines(text)
      begin
        doc = Kdl.parse(src)
      rescue Kdl::SyntaxError
        return []
      end
      places = Places.new(src)
      spans = []
      index = 0
      doc.each do |n|
        name = n.name
        if LAYER_NAMES.include?(name)
          path = index.to_s
          index += 1
          add(spans, places, n, path)
          layers(spans, places, n.children, "#{path}.") if HOLDS_LAYERS.include?(name)
        elsif name == "palette"
          add(spans, places, n, name)
          n.children.each { |c| add(spans, places, c, "palette/#{encode_name(c.name)}") }
        elsif name == "define" || name == "fold"
          path = named(n, name)
          if path
            add(spans, places, n, path)
            layers(spans, places, n.children, "#{path}/") if name == "define"
          end
        elsif name == "variant"
          path = named(n, name)
          if path
            add(spans, places, n, path)
            layers(spans, places, n.children, "#{path}/")
            n.children.each do |c|
              add(spans, places, c, "#{path}/#{c.name}") if c.name == "outline" || c.name == "border"
            end
          end
        elsif name == "reverse"
          add(spans, places, n, name)
          layers(spans, places, n.children, "reverse/")
        else
          add(spans, places, n, name)
        end
      end
      spans
    end

    def named(n, kind)
      return nil if n.args.empty? || !n.args[0].string?
      "#{kind}/#{encode_name(n.args[0].string)}"
    end

    def layers(spans, places, list, base)
      i = 0
      list.each do |n|
        next unless LAYER_NAMES.include?(n.name)
        path = "#{base}#{i}"
        add(spans, places, n, path)
        layers(spans, places, n.children, "#{path}.") if HOLDS_LAYERS.include?(n.name)
        i += 1
      end
    end

    def add(spans, places, n, path)
      line, column = places[n.start]
      # The end is just past the last character, as the reference counts it.
      end_line, end_column = places[n.stop]
      spans << Span.new(path, n.name, line, column, end_line, end_column).freeze
    end

    # The innermost span holding a line: the one that starts latest, and in a tie, the last.
    def layer_at(spans, line)
      best = nil
      spans.each do |s|
        next unless line >= s.line && line <= s.end_line
        if best.nil? || s.line > best.line || (s.line == best.line && s.column >= best.column)
          best = s
        end
      end
      best
    end
  end
end
