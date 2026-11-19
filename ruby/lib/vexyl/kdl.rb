# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # A KDL v2 parser, written to the grammar in the KDL 2.0.0 specification. It keeps what Vexyl
  # needs: where each node and value is, whether a value had a type annotation, and how a string
  # was written. Every offset counts code points from the start of the document.
  module Kdl
    # A document that isn't KDL v2, at the offset where the parser gave up.
    class SyntaxError < StandardError
      attr_reader :offset

      def initialize(message, offset)
        super(message)
        @offset = offset
      end
    end

    # An argument or a property's value. +kind+ is :string, :number, :bool or :null; +number+ is
    # always a Float. +bare+ says a string was written without quotes.
    class Value
      attr_reader :kind, :string, :number, :bool, :bare, :annotated, :offset

      def initialize(kind, string, number, bool, bare, annotated, offset)
        @kind = kind
        @string = string
        @number = number
        @bool = bool
        @bare = bare
        @annotated = annotated
        @offset = offset
      end

      def string?
        @kind == :string
      end
    end

    # A node, with where it starts and just past its last character. +repeated_props+ are
    # properties given more than once, which KDL would let the last of win.
    class Node
      attr_accessor :name, :annotated, :start, :stop
      attr_reader :args, :props, :repeated_props, :children

      def initialize
        @name = nil
        @annotated = false
        @start = 0
        @stop = 0
        @args = []
        @props = {}
        @repeated_props = []
        @children = []
      end

      def prop(key)
        @props[key]
      end
    end

    def self.parse(src)
      Reader.new(src).document
    end

    # Whether a code point is one of KDL's newlines, counting CR LF as one at the CR.
    def self.newline?(c)
      c == 0x0A || c == 0x0D || c == 0x85 || c == 0x0B || c == 0x0C || c == 0x2028 || c == 0x2029
    end

    def self.space?(c)
      c == 0x09 || c == 0x20 || c == 0xA0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200A) ||
        c == 0x202F || c == 0x205F || c == 0x3000
    end

    # Code points that can't be anywhere in a document, not even in a comment.
    def self.disallowed?(c)
      c <= 0x08 || (c >= 0x0E && c <= 0x1F) || c == 0x7F || (c >= 0xD800 && c <= 0xDFFF) ||
        c == 0x200E || c == 0x200F || (c >= 0x202A && c <= 0x202E) || (c >= 0x2066 && c <= 0x2069) ||
        c == 0xFEFF
    end

    NOT_IDENTIFIER = '\\/(){};[]"#='.codepoints.freeze

    def self.identifier_char?(c)
      return false if space?(c) || newline?(c) || disallowed?(c)
      !NOT_IDENTIFIER.include?(c)
    end

    # Reads one document, keeping its code points and a position among them.
    class Reader
      SLASH = 0x2F
      STAR = 0x2A
      BACKSLASH = 0x5C
      QUOTE = 0x22
      HASH = 0x23

      def initialize(src)
        @c = src.codepoints
        @n = @c.length
        @pos = 0
      end

      def document
        @c.each_with_index do |c, i|
          next unless Kdl.disallowed?(c) && !(c == 0xFEFF && i.zero?)
          @pos = i
          raise error(format("U+%04X can't be in a KDL document", c))
        end
        @pos += 1 if peek == 0xFEFF
        nodes = nodes(false)
        raise error("unexpected `#{[peek].pack("U")}`") unless eof?
        nodes
      end

      private

      def error(message)
        SyntaxError.new(message, @pos)
      end

      def eof?
        @pos >= @n
      end

      def peek
        @pos < @n ? @c[@pos] : -1
      end

      def peek_at(at)
        at < @n ? @c[at] : -1
      end

      def at2?(a, b)
        @c[@pos] == a && @c[@pos + 1] == b
      end

      def at?(text)
        cps = text.codepoints
        cps.each_with_index { |c, i| return false unless @c[@pos + i] == c }
        true
      end

      def text(from, to)
        @c[from...to].pack("U*")
      end

      def advance
        @pos += 1
      end

      def nodes(in_children)
        nodes = []
        loop do
          line_space
          if eof?
            raise error("a `{` is never closed") if in_children
            return nodes
          end
          if peek == 0x7D
            return nodes if in_children
            raise error("a `}` closes nothing")
          end
          if at2?(SLASH, 0x2D)
            @pos += 2
            line_space
            node(in_children)
            next
          end
          nodes << node(in_children)
        end
      end

      # Skips whitespace, newlines and comments, as KDL's line-space does.
      def line_space
        until eof?
          next if node_space
          c = peek
          if Kdl.newline?(c)
            newline
          elsif at2?(SLASH, SLASH)
            line_comment
          else
            return
          end
        end
      end

      def newline
        if at2?(0x0D, 0x0A)
          @pos += 2
        else
          advance
        end
      end

      def line_comment
        advance while !eof? && !Kdl.newline?(peek)
      end

      def block_comment
        start = @pos
        @pos += 2
        depth = 1
        while depth.positive?
          if eof?
            @pos = start
            raise error("a `/*` comment is never closed")
          end
          if at2?(SLASH, STAR)
            depth += 1
            @pos += 2
          elsif at2?(STAR, SLASH)
            depth -= 1
            @pos += 2
          else
            advance
          end
        end
      end

      # Skips node-space, which is whitespace, block comments and escaped newlines.
      def node_space
        was = @pos
        until eof?
          c = peek
          if Kdl.space?(c)
            advance
          elsif at2?(SLASH, STAR)
            block_comment
          elsif c == BACKSLASH
            back = @pos
            @pos += 1
            while !eof? && (Kdl.space?(peek) || at2?(SLASH, STAR))
              if at2?(SLASH, STAR)
                block_comment
              else
                advance
              end
            end
            if at2?(SLASH, SLASH)
              line_comment
              newline unless eof?
            elsif !eof? && Kdl.newline?(peek)
              newline
            elsif !eof?
              @pos = back
              raise error("a `\\` outside a string has to end its line")
            end
          else
            break
          end
        end
        @pos > was
      end

      def node(in_children)
        n = Node.new
        n.start = @pos
        if peek == 0x28
          annotation
          n.annotated = true
          node_space
        end
        name = string
        raise error("expected a node's name") if name.nil?
        n.name = name.string
        n.stop = @pos
        children_done = false
        loop do
          spaced = node_space
          return n if eof?
          c = peek
          if Kdl.newline?(c) || c == 0x3B || at2?(SLASH, SLASH)
            @pos += 1 if c == 0x3B
            return n
          end
          if c == 0x7D
            raise error("a `}` closes nothing") unless in_children
            return n
          end
          if at2?(SLASH, 0x2D)
            @pos += 2
            line_space
            if peek == 0x7B
              children(Node.new)
            elsif children_done
              raise error("nothing but children can follow a node's children")
            else
              entry(Node.new)
            end
            next
          end
          if c == 0x7B
            raise error("a node has one block of children") if children_done
            children(n)
            n.stop = @pos
            children_done = true
            next
          end
          raise error("nothing but children can follow a node's children") if children_done
          raise error("expected a space") unless spaced
          entry(n)
          n.stop = @pos
        end
      end

      def children(n)
        @pos += 1
        n.children.concat(nodes(true))
        @pos += 1
      end

      def annotation
        @pos += 1
        node_space
        raise error("expected a type in the annotation") if string.nil?
        node_space
        raise error("expected `)`") unless peek == 0x29
        @pos += 1
      end

      # Reads an argument or a property into n.
      def entry(n)
        start = @pos
        annotated = false
        if peek == 0x28
          annotation
          annotated = true
          node_space
        end
        v = value(annotated, start)
        if v.kind == :string && !annotated
          back = @pos
          node_space
          if peek == 0x3D
            @pos += 1
            node_space
            value_start = @pos
            value_annotated = false
            if peek == 0x28
              annotation
              value_annotated = true
              node_space
            end
            value = value(value_annotated, value_start)
            if n.props.key?(v.string)
              n.repeated_props << v.string
              n.props.delete(v.string)
            end
            n.props[v.string] = value
            return
          end
          @pos = back
        elsif peek == 0x3D || look_ahead_equals?
          raise error("a property's name has to be a string, without a type")
        end
        n.args << v
      end

      def look_ahead_equals?
        back = @pos
        node_space
        equals = peek == 0x3D
        @pos = back
        equals
      end

      def value(annotated, start)
        c = peek
        at = @pos
        if c == HASH && peek_at(@pos + 1) != QUOTE && peek_at(@pos + 1) != HASH
          return keyword(annotated, start)
        end
        if digit?(c) || ((c == 0x2B || c == 0x2D) && digit?(peek_at(@pos + 1)))
          return number(annotated, start)
        end
        v = string
        if v.nil?
          @pos = at
          raise error("expected a value")
        end
        Value.new(:string, v.string, 0.0, false, v.bare, annotated, start)
      end

      def digit?(c)
        c >= 0x30 && c <= 0x39
      end

      def delimited
        return if eof? || !Kdl.identifier_char?(peek)
        raise error("unexpected `#{[peek].pack("U")}` after a value")
      end

      KEYWORDS = {
        "#true" => [:bool, 0.0, true],
        "#false" => [:bool, 0.0, false],
        "#null" => [:null, 0.0, false],
        "#inf" => [:number, Float::INFINITY, false],
        "#-inf" => [:number, -Float::INFINITY, false],
        "#nan" => [:number, Float::NAN, false],
      }.freeze

      def keyword(annotated, start)
        from = @pos
        @pos += 1
        advance while !eof? && Kdl.identifier_char?(peek)
        word = text(from, @pos)
        kind, number, bool = KEYWORDS[word]
        if kind.nil?
          @pos = from
          raise error("unknown keyword `#{word}`")
        end
        Value.new(kind, nil, number, bool, false, annotated, start)
      end

      def radix_digit?(c, radix)
        case radix
        when 16 then digit?(c) || (c >= 0x61 && c <= 0x66) || (c >= 0x41 && c <= 0x46)
        when 8 then c >= 0x30 && c <= 0x37
        else c == 0x30 || c == 0x31
        end
      end

      def number(annotated, start)
        from = @pos
        negative = false
        if peek == 0x2B || peek == 0x2D
          negative = peek == 0x2D
          @pos += 1
        end
        radix = 10
        if peek == 0x30
          case peek_at(@pos + 1)
          when 0x78 then radix = 16
          when 0x6F then radix = 8
          when 0x62 then radix = 2
          end
        end
        if radix != 10
          @pos += 2
          digits_from = @pos
          raise error("expected a digit") unless radix_digit?(peek, radix)
          @pos += 1 while !eof? && (radix_digit?(peek, radix) || peek == 0x5F)
          whole = text(digits_from, @pos).delete("_").to_i(radix)
          value = quietly { (negative ? -whole : whole).to_f }
        else
          digits
          if peek == 0x2E
            @pos += 1
            raise error("expected a digit after `.`") unless digit?(peek)
            digits
          end
          if peek == 0x65 || peek == 0x45
            @pos += 1
            @pos += 1 if peek == 0x2B || peek == 0x2D
            raise error("expected an exponent") unless digit?(peek)
            digits
          end
          written = text(from, @pos).delete("_")
          value = decimal(written)
          # A value too small to hold isn't zero, so it's kept as the smallest there is, which
          # is still beyond the format's limits.
          value = negative ? -5e-324 : 5e-324 if value.zero? && written.split(/[eE]/, 2)[0].match?(/[1-9]/)
        end
        delimited
        Value.new(:number, nil, value, false, false, annotated, start)
      end

      # Converts decimal digits to the nearest Float. Ruby's Float() handles any length of
      # digits and exponent, rounding correctly, apart from exponents so large they overflow.
      def decimal(written)
        quietly { Float(written) }
      end

      # Runs a conversion without its warning about a value out of a Float's range, which the
      # format's limits refuse anyway.
      def quietly
        verbose = $VERBOSE
        $VERBOSE = nil
        yield
      ensure
        $VERBOSE = verbose
      end

      def digits
        @pos += 1 while !eof? && (digit?(peek) || peek == 0x5F)
      end

      # Reads a string in any of its forms, or gives nil if none starts here.
      def string
        start = @pos
        c = peek
        return Value.new(:string, quoted, 0.0, false, false, false, start) if c == QUOTE
        if c == HASH && (peek_at(@pos + 1) == QUOTE || peek_at(@pos + 1) == HASH)
          return Value.new(:string, raw, 0.0, false, false, false, start)
        end
        return nil if c.negative? || !Kdl.identifier_char?(c)
        raise error("a bare string can't start with a digit") if digit?(c)
        if (c == 0x2B || c == 0x2D) &&
           (digit?(peek_at(@pos + 1)) || (peek_at(@pos + 1) == 0x2E && digit?(peek_at(@pos + 2))))
          raise error("a bare string can't look like a number")
        end
        raise error("a bare string can't look like a number") if c == 0x2E && digit?(peek_at(@pos + 1))
        advance while !eof? && Kdl.identifier_char?(peek)
        word = text(start, @pos)
        case word
        when "true", "false", "null", "inf", "-inf", "nan"
          @pos = start
          raise error("`#{word}` has to be quoted to be a string, or written `##{word}`")
        end
        Value.new(:string, word, 0.0, false, true, false, start)
      end

      def quoted
        if at?('"""')
          start = @pos
          @pos += 3
          if eof? || !Kdl.newline?(peek)
            raise error("a multi-line string starts a new line after its `\"\"\"`")
          end
          body_start = @pos
          loop do
            if eof?
              @pos = start
              raise error("a string is never closed")
            end
            if peek == BACKSLASH
              @pos += 1
              advance unless eof?
            elsif at?('"""')
              break
            else
              advance
            end
          end
          body = @c[body_start...@pos]
          @pos += 3
          return unescape(dedent(body, start), start)
        end
        start = @pos
        @pos += 1
        loop do
          if eof?
            @pos = start
            raise error("a string is never closed")
          end
          c = peek
          if c == BACKSLASH
            @pos += 1
            advance unless eof?
          elsif c == QUOTE
            break
          elsif Kdl.newline?(c)
            raise error("a string on one line can't hold a newline; use `\"\"\"`")
          else
            advance
          end
        end
        body = @c[(start + 1)...@pos]
        @pos += 1
        unescape(body, start + 1)
      end

      def raw
        start = @pos
        hashes = 0
        while peek == HASH
          hashes += 1
          @pos += 1
        end
        close = "\"#{"#" * hashes}"
        multi = at?('"""')
        if multi
          @pos += 3
          if eof? || !Kdl.newline?(peek)
            raise error("a multi-line string starts a new line after its `\"\"\"`")
          end
          close = "\"\"\"#{"#" * hashes}"
        else
          @pos += 1
        end
        body_start = @pos
        close_cps = close.codepoints
        finish = find(close_cps, @pos)
        if finish.nil?
          @pos = start
          raise error("a raw string is never closed")
        end
        body = @c[body_start...finish]
        @pos = finish + close_cps.length
        return dedent(body, start).pack("U*") if multi
        body.each_with_index do |c, i|
          next unless Kdl.newline?(c)
          @pos = body_start + i
          raise error("a raw string on one line can't hold a newline")
        end
        body.pack("U*")
      end

      def find(cps, from)
        first = cps[0]
        i = from
        last = @n - cps.length
        while i <= last
          if @c[i] == first
            j = 1
            j += 1 while j < cps.length && @c[i + j] == cps[j]
            return i if j == cps.length
          end
          i += 1
        end
        nil
      end

      # Removes a multi-line string's indentation, which is whatever is before its closing
      # quotes, from each of its lines. KDL does this before it resolves escapes. Takes and gives
      # code points.
      def dedent(body, start)
        lines = []
        from = 0
        i = 0
        while i < body.length
          c = body[i]
          if Kdl.newline?(c)
            lines << body[from...i]
            i += c == 0x0D && body[i + 1] == 0x0A ? 2 : 1
            from = i
          else
            i += 1
          end
        end
        lines << body[from..]
        prefix = lines[-1]
        unless blank?(prefix)
          @pos = start
          raise error("a multi-line string's closing `\"\"\"` has to be on a line of its own")
        end
        out = []
        (1...(lines.length - 1)).each do |k|
          line = lines[k]
          out << 0x0A if k > 1
          next if blank?(line)
          unless line[0, prefix.length] == prefix
            @pos = start
            raise error("each line of a multi-line string has to start with the indentation of its last")
          end
          out.concat(line[prefix.length..])
        end
        out
      end

      def blank?(cps)
        cps.all? { |c| Kdl.space?(c) }
      end

      ESCAPES = { 0x6E => 0x0A, 0x72 => 0x0D, 0x74 => 0x09, 0x5C => 0x5C, 0x22 => 0x22,
                  0x62 => 0x08, 0x66 => 0x0C, 0x73 => 0x20 }.freeze

      # Resolves escapes in code points, giving a String.
      def unescape(body, start)
        return body.pack("U*") unless body.include?(BACKSLASH)
        out = []
        i = 0
        while i < body.length
          c = body[i]
          if c != BACKSLASH
            out << c
            i += 1
            next
          end
          if i + 1 >= body.length
            @pos = start
            raise error("a string ends in the middle of an escape")
          end
          e = body[i + 1]
          if (r = ESCAPES[e])
            out << r
            i += 2
          elsif e == 0x75
            close = (i...body.length).find { |k| body[k] == 0x7D }
            if i + 2 >= body.length || body[i + 2] != 0x7B || close.nil? || close - (i + 3) < 1 || close - (i + 3) > 6
              @pos = start
              raise error("a `\\u` escape is written `\\u{` and 1 to 6 hexadecimal digits `}`")
            end
            hex = body[(i + 3)...close]
            unless hex.all? { |h| radix_digit?(h, 16) }
              @pos = start
              raise error("a `\\u` escape is written `\\u{` and 1 to 6 hexadecimal digits `}`")
            end
            code = hex.pack("U*").to_i(16)
            if code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)
              @pos = start
              raise error("a `\\u` escape has to be a Unicode scalar value")
            end
            out << code
            i = close + 1
          elsif Kdl.space?(e) || Kdl.newline?(e)
            i += 1
            i += 1 while i < body.length && (Kdl.space?(body[i]) || Kdl.newline?(body[i]))
          else
            @pos = start
            raise error("unknown escape `\\#{[e].pack("U")}`")
          end
        end
        out.pack("U*")
      end
    end
  end
end
