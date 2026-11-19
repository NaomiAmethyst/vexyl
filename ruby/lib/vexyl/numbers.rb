# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # Numbers written inside strings: a box, a fold's crease, and path data.
  module Numbers
    SPACE = [0x20, 0x09, 0x0a, 0x0c, 0x0d].freeze
    COMMANDS = "MmLlHhVvCcSsQqTtAaZz".codepoints.freeze
    ARGUMENTS = { "M" => 2, "L" => 2, "T" => 2, "H" => 1, "V" => 1, "C" => 6, "S" => 4, "Q" => 4, "A" => 7,
                  "Z" => 0 }.freeze

    module_function

    # Sanitizer's patterns, built when first needed, since Sanitizer may load after this file.
    def patterns
      @patterns ||= begin
        decimal = source(Sanitizer::DECIMAL)
        comma_space = source(Sanitizer::COMMA_SPACE)
        [Regexp.new("\\A[ \\t\\n\\f\\r]*#{decimal}(?:#{comma_space}#{decimal})*[ \\t\\n\\f\\r]*\\z"),
         Regexp.new(comma_space)]
      end
    end

    def source(pattern)
      pattern.is_a?(Regexp) ? pattern.source : pattern
    end

    # Reads a string of numbers, separated by whitespace, a comma or both, or gives nil.
    def list(text)
      whole, split = patterns
      return nil unless whole.match?(text)
      out = []
      Sanitizer.trim(text).split(split, -1).each do |part|
        v = Sanitizer.decimal_value(part)
        return nil if v.nil?
        out << v
      end
      out
    end

    # Checks path data against SVG's grammar, within the format's limits on numbers, so that a bad
    # one can't silently draw part of a shape or nothing.
    def valid_path(d)
      PathCheck.new(d).valid
    end

    # Parses what matched Sanitizer::DECIMAL to the nearest Float. Float() refuses a
    # trailing ".", and warns of a number too large or small for a Float, so this works around both.
    def parse_decimal(text)
      verbose = $VERBOSE
      $VERBOSE = nil
      Float(text.sub(/\.(?=[eE]|\z)/, ""))
    ensure
      $VERBOSE = verbose
    end

    class PathCheck
      def initialize(d)
        @d = d.codepoints
        @i = 0
      end

      def at
        @d[@i]
      end

      def space
        @i += 1 while @i < @d.size && SPACE.include?(@d[@i])
      end

      # Skips whitespace and at most one comma, and says if there was a comma.
      def separator
        space
        if @i < @d.size && @d[@i] == 0x2c
          @i += 1
          space
          return true
        end
        false
      end

      def digit?(j)
        c = @d[j]
        c && c >= 0x30 && c <= 0x39
      end

      def digits(j)
        j += 1 while digit?(j)
        j
      end

      # Matches Sanitizer::DECIMAL at the current place, as a regex's lookingAt would.
      def number
        j = @i
        j += 1 if @d[j] == 0x2b || @d[j] == 0x2d
        if digit?(j)
          j = digits(j)
          j += 1 if @d[j] == 0x2e
          j = digits(j)
        elsif @d[j] == 0x2e && digit?(j + 1)
          j = digits(j + 1)
        else
          return false
        end
        if @d[j] == 0x65 || @d[j] == 0x45
          k = j + 1
          k += 1 if @d[k] == 0x2b || @d[k] == 0x2d
          j = digits(k) if digit?(k)
        end
        v = Numbers.parse_decimal(@d[@i...j].pack("U*"))
        return false if v.nan? || v.abs > Limits::NUMBER_LIMIT
        @i = j
        true
      end

      def command?(j)
        j < @d.size && COMMANDS.include?(@d[j])
      end

      def valid
        space
        return false if @i >= @d.size || (at != 0x4d && at != 0x6d)
        while @i < @d.size
          ch = at
          c = ch < 128 ? ch.chr.upcase : ""
          count = ARGUMENTS.fetch(c, -1)
          return false if count < 0
          @i += 1
          space
          # A command can repeat its arguments with no letter, except for Z, which has none.
          first = true
          while count > 0 && (first || (@i < @d.size && !COMMANDS.include?(at)))
            first = false
            count.times do |arg|
              if c == "A" && (arg == 3 || arg == 4)
                return false if @i >= @d.size || (at != 0x30 && at != 0x31)
                @i += 1
              elsif !number
                return false
              end
              separator if arg < count - 1
            end
            return false if separator && (@i >= @d.size || command?(@i))
          end
          space
        end
        true
      end
    end
  end
end
