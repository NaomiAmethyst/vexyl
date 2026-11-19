# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # Checks inline SVG against the format's allowlist, as SPEC section 8.3 says, and writes what
  # passes in the canonical form of SDK section 4.2.
  module Sanitizer
    SVG_NAMESPACE = "http://www.w3.org/2000/svg"
    XLINK_NAMESPACE = "http://www.w3.org/1999/xlink"
    MAX_DEPTH = 64

    # Stands in for an ID's prefix in sanitized markup until it's drawn. It can't appear in XML, so
    # it can't be confused with anything in the artwork.
    ID_MARK = "\0"

    # What counts as whitespace inside strings and inline SVG.
    SPACE = " \t\n\f\r"

    # The one way to write a number inside a string, as SPEC section 4 gives it. (Regexp source, so
    # that other patterns can be built from it.)
    DECIMAL = "[-+]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][-+]?[0-9]+)?"
    # Separates numbers in a string, as SVG's comma-wsp does. (Regexp source.)
    COMMA_SPACE = "(?:[ \\t\\n\\f\\r]*,[ \\t\\n\\f\\r]*|[ \\t\\n\\f\\r]+)"

    COLOR_PROPS = %w[fill stroke stop-color flood-color lighting-color color].freeze
    ALLOWED_ELEMENTS = %w[defs g path rect circle ellipse line polyline polygon linearGradient
                          radialGradient stop clipPath mask].freeze
    # These describe a file rather than draw it.
    DROPPED_ELEMENTS = %w[title desc metadata].freeze
    # Allowed as attributes and in style attributes.
    PRESENTATION = %w[fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap
                      stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity
                      clip-path clip-rule mask stop-color stop-opacity color display visibility
                      paint-order vector-effect shape-rendering mix-blend-mode isolation].freeze
    ALLOWED_ATTRS = %w[id transform d x y width height cx cy r rx ry x1 y1 x2 y2 points offset fx fy
                       fr gradientUnits gradientTransform spreadMethod clipPathUnits maskUnits
                       maskContentUnits style href].freeze
    # Consumed in working out the root's viewBox, or replaced when it's placed on the flag.
    ROOT_ONLY = %w[id x y width height viewBox preserveAspectRatio version baseProfile].freeze

    CSS_WORD = /[A-Za-z0-9_-]+/
    LOCAL_ID = /\A[A-Za-z_][A-Za-z0-9_.:-]*\z/
    # These spell their cases out, since matching case-insensitively could take other letters.
    COLOR_FUNC = /(?<![A-Za-z0-9_])(?:[rR][gG][bB][aA]?|[hH][sS][lL][aA]?)\(/
    LOCAL_URL = /[uU][rR][lL]\([ \t\n\f\r]*["']?#([A-Za-z_][A-Za-z0-9_.:-]*)["']?[ \t\n\f\r]*\)/
    VIEW_BOX = Regexp.new("\\A[ \\t\\n\\f\\r]*(#{DECIMAL})#{COMMA_SPACE}(#{DECIMAL})#{COMMA_SPACE}" \
                          "(#{DECIMAL})#{COMMA_SPACE}(#{DECIMAL})[ \\t\\n\\f\\r]*\\z")
    LENGTH = Regexp.new("\\A[ \\t\\n\\f\\r]*(#{DECIMAL})(?:px)?[ \\t\\n\\f\\r]*\\z")
    DECIMAL_WHOLE = Regexp.new("\\A(?:#{DECIMAL})\\z")
    # SVG's default preserveAspectRatio, the only way artwork is ever fitted.
    DEFAULT_FIT = /\A[ \t\n\f\r]*xMidYMid(?:[ \t\n\f\r]+meet)?[ \t\n\f\r]*\z/
    LEADING_SPACE = /\A[ \t\n\f\r]+/
    TRAILING_SPACE = /[ \t\n\f\r]+\z/
    private_constant :ID_MARK, :SPACE, :COLOR_PROPS, :ALLOWED_ELEMENTS, :DROPPED_ELEMENTS,
                     :PRESENTATION, :ALLOWED_ATTRS, :ROOT_ONLY, :CSS_WORD, :LOCAL_ID, :COLOR_FUNC,
                     :LOCAL_URL, :VIEW_BOX, :LENGTH, :DECIMAL_WHOLE, :DEFAULT_FIT, :LEADING_SPACE,
                     :TRAILING_SPACE

    # Inline SVG that has passed the sanitizer.
    class Artwork
      # Set by the sanitizer only.
      attr_writer :view_box, :current_color, :attrs, :body

      def initialize
        @view_box = ""
        @current_color = false
        # The root element's attributes, each with a leading space.
        @attrs = ""
        @body = ""
      end

      # The root's viewBox, its four numbers joined by single spaces as they were written.
      def view_box
        @view_box
      end

      # Whether the artwork paints in currentColor anywhere.
      def uses_current_color?
        @current_color
      end

      # The root's attributes, each with a leading space, with every ID given a prefix.
      def attrs(id_prefix)
        @attrs.gsub("\0") { id_prefix }
      end

      # What's inside the root, with every ID and reference given a prefix.
      def body(id_prefix)
        @body.gsub("\0") { id_prefix }
      end

      # The sanitized artwork as one document, with its IDs as they were written.
      def canonical
        ("<svg xmlns=\"#{SVG_NAMESPACE}\" viewBox=\"#{Xml.escape(@view_box)}\"#{@attrs}>#{@body}</svg>")
          .delete("\0")
      end
    end

    module_function

    # A number written as SPEC section 4 says, within the format's limits, or nil.
    def decimal_value(text)
      return nil unless DECIMAL_WHOLE.match?(text)

      # A number such as "1." is valid, and one out of a Float's range is Infinity or 0, but
      # Float() refuses the one and warns about the other, so the magnitude is worked out from
      # the digits first, and anything far outside the limits is refused without parsing it.
      mantissa, exponent = text.split(/[eE]/, 2)
      exp = exponent.nil? ? 0 : exponent.to_i
      digits = mantissa.sub(/\A[-+]/, "")
      int_part, frac_part = digits.split(".", 2)
      int_part ||= ""
      frac_part ||= ""
      int_nz = int_part.sub(/\A0+/, "")
      if !int_nz.empty?
        magnitude = exp + int_nz.length - 1
      elsif frac_part =~ /[1-9]/
        magnitude = exp - (frac_part.index(/[1-9]/) + 1)
      else
        magnitude = 0 # Zero as written.
      end
      return nil if magnitude > 12 || magnitude < -13

      sign = mantissa.start_with?("-") ? "-" : ""
      v = Float("#{sign}#{int_part.empty? ? "0" : int_part}.#{frac_part.empty? ? "0" : frac_part}e#{exp}")
      a = v.abs
      return nil if v.nan? || a > 1e12 || (a != 0 && a < 1 / 1e12)
      # One too small for a double comes out as 0, though it isn't zero as written.
      return nil if v.zero? && written_nonzero(text)

      v
    end

    # Whether a number, as written, has a digit other than 0 before any exponent.
    def written_nonzero(text)
      mantissa = text.downcase.split("e", 2)[0] || ""
      mantissa.match?(/[1-9]/)
    end

    def trim(s)
      s.sub(LEADING_SPACE, "").sub(TRAILING_SPACE, "")
    end

    def ascii_lower(s)
      s.downcase(:ascii)
    end

    # Splits at each +sep+, keeping empty parts, so that "" gives [""].
    def split(s, sep)
      s.split(sep, -1).tap { |a| a << "" if a.empty? }
    end

    # Whether an attribute, or a declaration in a style, paints in currentColor, as its value or as
    # a keyword in it such as a fallback after url(#id). An id or other text containing the word
    # doesn't count.
    def takes_current_color(name, value)
      if name == "style"
        split(value, ";").each do |decl|
          colon = decl.index(":")
          prop = colon.nil? ? decl : decl[0, colon]
          v = colon.nil? ? "" : decl[(colon + 1)..]
          return true if takes_current_color(ascii_lower(trim(prop)), v)
        end
        return false
      end
      return false unless COLOR_PROPS.include?(name)

      value.gsub(LOCAL_URL, "").scan(CSS_WORD).any? { |w| ascii_lower(w) == "currentcolor" }
    end

    # Checks inline SVG and gives a copy with marks in place of its IDs' prefixes, so that drawing
    # it can make them unique. Anything drawn must be on the allowlist or the markup is refused;
    # only descriptive and foreign-namespace content is removed quietly.
    def sanitize(markup)
      dec = begin
        Xml.new(markup)
      rescue Xml::XmlException => e
        raise Vexyl::Error, "invalid SVG: #{e.message}"
      end
      result = Artwork.new
      body = +""
      depth = 0
      skip = 0
      saw_root = false
      closed_root = false
      loop do
        t = begin
          dec.token
        rescue Xml::XmlException => e
          raise Vexyl::Error, "invalid SVG: #{e.message}"
        end
        break if t.nil?

        case t.kind
        when :directive
          raise Vexyl::Error, "SVG can't contain a DOCTYPE or other directive"
        when :text
          if skip.zero? && !trim(t.text).empty?
            raise Vexyl::Error, "SVG can't contain text outside elements; convert any lettering to paths"
          end
        when :start
          if skip.positive?
            skip += 1
            next
          end
          raise Vexyl::Error, "SVG must have a single root element" if closed_root

          name = t.name
          unless saw_root
            saw_root = true
            if name.space != SVG_NAMESPACE || name.local != "svg"
              raise Vexyl::Error, "root must be <svg xmlns=\"#{SVG_NAMESPACE}\">"
            end

            read_root(result, t.attrs)
            depth = 1
            next
          end
          if (name.space != SVG_NAMESPACE && !name.space.empty?) ||
             (name.space == SVG_NAMESPACE && DROPPED_ELEMENTS.include?(name.local))
            skip = 1
            next
          end
          if name.space.empty? || !ALLOWED_ELEMENTS.include?(name.local)
            raise Vexyl::Error, "SVG element <#{name.local}> isn't allowed"
          end

          depth += 1
          raise Vexyl::Error, "SVG is nested more than #{MAX_DEPTH} levels deep" if depth > MAX_DEPTH

          attrs = begin
            clean_attrs(t.attrs, [].freeze, result)
          rescue Vexyl::Error => e
            raise Vexyl::Error, "SVG element <#{name.local}>: #{e.message}"
          end
          body << "<" << name.local << attrs << ">"
        when :end
          if skip.positive?
            skip -= 1
            next
          end
          depth -= 1
          if depth.zero?
            closed_root = true
            next
          end
          body << "</" << t.name.local << ">"
        end
      end
      raise Vexyl::Error, "SVG has no root element" unless saw_root

      result.body = body
      result
    end

    # Works out the root's viewBox and keeps its other styling attributes.
    def read_root(e, attrs)
      view_box = ""
      width = ""
      height = ""
      attrs.each do |a|
        next unless a.name.space.empty?

        case a.name.local
        when "viewBox"
          view_box = a.value
        when "width"
          width = a.value
        when "height"
          height = a.value
        when "preserveAspectRatio"
          unless DEFAULT_FIT.match?(a.value)
            raise Vexyl::Error, "SVG's preserveAspectRatio \"#{a.value}\" isn't the default, " \
                                "which is how artwork is always fitted"
          end
        end
      end
      if !view_box.empty?
        m = VIEW_BOX.match(view_box)
        raise Vexyl::Error, "SVG has an invalid viewBox \"#{view_box}\"" if m.nil?

        values = (1..4).map { |i| decimal_value(m[i]) }
        raise Vexyl::Error, "SVG has an invalid viewBox \"#{view_box}\"" if values.any?(&:nil?)
        raise Vexyl::Error, "SVG viewBox \"#{view_box}\" has no area" if values[2] <= 0 || values[3] <= 0

        e.view_box = "#{m[1]} #{m[2]} #{m[3]} #{m[4]}"
      else
        wm = LENGTH.match(width)
        hm = LENGTH.match(height)
        raise Vexyl::Error, "SVG needs a viewBox, or a numeric width and height" if wm.nil? || hm.nil?

        w = decimal_value(wm[1])
        h = decimal_value(hm[1])
        raise Vexyl::Error, "SVG's width and height must be positive" if w.nil? || h.nil? || w <= 0 || h <= 0

        e.view_box = "0 0 #{wm[1]} #{hm[1]}"
      end
      begin
        e.attrs = clean_attrs(attrs, ROOT_ONLY, e)
      rescue Vexyl::Error => err
        raise Vexyl::Error, "SVG root: #{err.message}"
      end
    end

    # Checks attributes against the allowlist and writes them out, noting whether any of them
    # paints in currentColor.
    def clean_attrs(attrs, ignored, e)
      b = +""
      href = false
      attrs.each do |a|
        name = a.name.local
        space = a.name.space
        if space == XLINK_NAMESPACE && name == "href"
          # The same as the plain href it's equivalent to.
        elsif !space.empty?
          # Editor data doesn't affect rendering.
          next
        elsif ignored.include?(name)
          next
        elsif !ALLOWED_ATTRS.include?(name) && !PRESENTATION.include?(name)
          raise Vexyl::Error, "attribute \"#{name}\" isn't allowed"
        end
        if name == "href"
          raise Vexyl::Error, "attribute \"href\" is repeated, since xlink:href means the same" if href

          href = true
        end
        value = clean_value(name, a.value)
        e.current_color = true if takes_current_color(name, a.value)
        b << " " << name << "=\"" << value << "\""
      end
      b
    end

    # A value escaped for writing out.
    def clean_value(name, value)
      case name
      when "id"
        raise Vexyl::Error, "invalid id \"#{value}\"" unless LOCAL_ID.match?(value)

        return ID_MARK + Xml.escape(value)
      when "href"
        unless value.start_with?("#") && LOCAL_ID.match?(value[1..])
          raise Vexyl::Error, "href \"#{value}\" must refer to an id in this SVG"
        end

        return "#" + ID_MARK + Xml.escape(value[1..])
      when "style"
        return clean_style(value)
      end
      return clean_presentation(value) if PRESENTATION.include?(name)

      Xml.escape(value)
    end

    # Marks url(#id) references and refuses every CSS function other than those and plain color
    # functions, since functions can load things.
    def clean_presentation(value)
      remaining = value.gsub(LOCAL_URL, "").gsub(COLOR_FUNC, "")
      if remaining.include?("(")
        raise Vexyl::Error, "\"#{value}\" uses a function other than url(#id) or a color"
      end

      b = +""
      last = 0
      pos = 0
      while (m = LOCAL_URL.match(value, pos))
        b << Xml.escape(value[last...m.begin(0)]) << "url(#" << ID_MARK << Xml.escape(m[1]) << ")"
        last = m.end(0)
        # A match is never empty, so the search always moves on.
        pos = last
      end
      b << Xml.escape(value[last..])
      b
    end

    # Keeps a style's declarations in their order, since a later one can win.
    def clean_style(style)
      if style.include?("\\") || style.include?("@") || style.include?("/*")
        raise Vexyl::Error, "style can't contain escapes, at-rules or comments"
      end

      out = []
      split(style, ";").each do |decl|
        next if trim(decl).empty?

        colon = decl.index(":")
        prop = ascii_lower(trim(colon.nil? ? decl : decl[0, colon]))
        if colon.nil? || !PRESENTATION.include?(prop)
          raise Vexyl::Error, "style property \"#{prop}\" isn't allowed"
        end

        out << "#{prop}:#{clean_presentation(trim(decl[(colon + 1)..]))}"
      end
      out.join(";")
    end

    private_class_method :split, :read_root, :clean_attrs, :clean_value, :clean_presentation,
                         :clean_style
  end
end
