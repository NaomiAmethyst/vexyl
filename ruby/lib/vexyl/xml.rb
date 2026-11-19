# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # Reads well-formed XML 1.0 with namespaces, one token at a time, as SPEC section 8.3 defines it,
  # and refuses everything else. A sanitizer's security rests on reading markup exactly one way, so
  # nothing here is lenient.
  #
  # Positions are code point indices into the markup, once its line endings are normalized.
  class Xml
    XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace"
    XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/"

    # A name with its namespace worked out.
    Name = Struct.new(:space, :local)

    Attr = Struct.new(:name, :value)

    # +kind+ is one of :start, :end, :text, :other and :directive.
    Token = Struct.new(:kind, :name, :attrs, :text) do
      def self.of(kind)
        new(kind, nil, [].freeze, "")
      end
    end

    # Malformed markup.
    class XmlException < StandardError; end

    # An open element, with what its namespace declarations replaced.
    class Frame
      attr_reader :raw, :undo
      attr_accessor :name

      def initialize(raw)
        @raw = raw
        @name = nil
        @undo = []
      end
    end
    private_constant :Frame

    LT = "<".ord
    AMP = "&".ord
    RSQB = "]".ord
    GT = ">".ord
    SLASH = "/".ord
    EQ = "=".ord
    QUOT = '"'.ord
    APOS = "'".ord
    TAB = 0x09
    LF = 0x0a
    CR = 0x0d
    SP = 0x20
    COLON = ":".ord
    private_constant :LT, :AMP, :RSQB, :GT, :SLASH, :EQ, :QUOT, :APOS, :TAB, :LF, :CR, :SP, :COLON

    def initialize(markup)
      markup = markup.encode(Encoding::UTF_8) unless markup.encoding == Encoding::UTF_8
      raise XmlException, "the markup isn't valid UTF-8" unless markup.valid_encoding?

      markup.each_codepoint do |r|
        raise XmlException, format("U+%04X isn't an XML character", r) unless Xml.xml_char(r)
      end
      @src = Xml.normalize_newlines(markup).codepoints
      @len = @src.length
      @pos = 0
      @stack = []
      @ns = { "xml" => XML_NAMESPACE }
      @pending = nil
      @done_root = false
    rescue EncodingError
      raise XmlException, "the markup isn't valid UTF-8"
    end

    def self.xml_char(r)
      r == 0x09 || r == 0x0a || r == 0x0d || (r >= 0x20 && r <= 0xd7ff) ||
        (r >= 0xe000 && r <= 0xfffd) || (r >= 0x10000 && r <= 0x10ffff)
    end

    # Takes a code point.
    def self.xml_space(c)
      c == SP || c == TAB || c == LF || c == CR
    end

    def self.name_start(r)
      r == COLON || r == 0x5f || (r >= 0x41 && r <= 0x5a) || (r >= 0x61 && r <= 0x7a) ||
        (r >= 0xc0 && r <= 0xd6) || (r >= 0xd8 && r <= 0xf6) || (r >= 0xf8 && r <= 0x2ff) ||
        (r >= 0x370 && r <= 0x37d) || (r >= 0x37f && r <= 0x1fff) || (r >= 0x200c && r <= 0x200d) ||
        (r >= 0x2070 && r <= 0x218f) || (r >= 0x2c00 && r <= 0x2fef) || (r >= 0x3001 && r <= 0xd7ff) ||
        (r >= 0xf900 && r <= 0xfdcf) || (r >= 0xfdf0 && r <= 0xfffd) || (r >= 0x10000 && r <= 0xeffff)
    end

    def self.name_char(r)
      name_start(r) || r == 0x2d || r == 0x2e || (r >= 0x30 && r <= 0x39) || r == 0xb7 ||
        (r >= 0x300 && r <= 0x36f) || (r >= 0x203f && r <= 0x2040)
    end

    # The next token, or nil once the document has ended properly.
    def token
      if @pending
        t = @pending
        @pending = nil
        return t
      end
      if @pos >= @len
        raise ended unless @stack.empty?

        return nil
      end
      return text if @src[@pos] != LT
      return end_tag if starts?("</")
      return instruction if starts?("<?")
      return comment if starts?("<!--")
      return cdata if starts?("<![CDATA[")
      if starts?("<!")
        # A directive is always refused, so there's no need to find where it ends.
        @pos = @len
        return Token.of(:directive)
      end
      start_tag
    end

    # Turns CRLF and lone CR into LF.
    def self.normalize_newlines(s)
      return s unless s.include?("\r")

      s.gsub("\r\n", "\n").tr("\r", "\n")
    end

    ESCAPES = {
      "&" => "&amp;", "<" => "&lt;", ">" => "&gt;", '"' => "&#34;", "'" => "&#39;",
      "\t" => "&#x9;", "\n" => "&#xA;", "\r" => "&#xD;"
    }.freeze
    ESCAPED = /[&<>"'\t\n\r]|[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/
    private_constant :ESCAPES, :ESCAPED

    # Escapes text for an attribute's value or an element's text, as Go's xml.EscapeText does and
    # SDK section 4.2 says, so that tabs and line endings in a value survive being read again.
    # What isn't an XML character, or isn't valid UTF-8, becomes U+FFFD.
    def self.escape(s)
      unless s.encoding == Encoding::UTF_8
        s = s.encode(Encoding::UTF_8, invalid: :replace, undef: :replace, replace: "�")
      end
      s = s.scrub("�") unless s.valid_encoding?
      return s unless ESCAPED.match?(s)

      s.gsub(ESCAPED) { |c| ESCAPES[c] || "�" }
    end

    private

    def ended
      XmlException.new("unexpected end of the markup")
    end

    # Whether the markup has +lit+ (ASCII) at +at+.
    def starts?(lit, at = @pos)
      return false if at + lit.length > @len

      i = 0
      lit.each_byte do |b|
        return false if @src[at + i] != b

        i += 1
      end
      true
    end

    # Where +lit+ (ASCII) next appears from +from+, or nil.
    def index_of(lit, from)
      first = lit.getbyte(0)
      i = from
      last = @len - lit.length
      while i <= last
        return i if @src[i] == first && starts?(lit, i)

        i += 1
      end
      nil
    end

    def substring(from, to)
      @src[from...to].pack("U*")
    end

    # Character data, which outside the root can only be whitespace.
    def text
      b = +""
      while @pos < @len && @src[@pos] != LT
        c = @src[@pos]
        if c == AMP
          raise XmlException, "a character reference can't appear outside the root" if @stack.empty?

          b << reference
        elsif c == RSQB && starts?("]]>")
          raise XmlException, "]]> can't appear in text"
        else
          b << c
          @pos += 1
        end
      end
      Token.new(:text, nil, [].freeze, b)
    end

    def cdata
      raise XmlException, "a CDATA section can't appear outside the root" if @stack.empty?

      start = @pos + "<![CDATA[".length
      stop = index_of("]]>", start)
      raise ended if stop.nil?

      @pos = stop + 3
      Token.new(:text, nil, [].freeze, substring(start, stop))
    end

    def comment
      start = @pos + "<!--".length
      stop = index_of("--", start)
      raise ended if stop.nil?
      raise XmlException, "\"--\" can't appear in a comment" unless starts?("-->", stop)

      @pos = stop + 3
      Token.of(:other)
    end

    def instruction
      begin_at = @pos
      @pos += 2
      target = begin
        name
      rescue XmlException
        raise XmlException, "expected a target after <?"
      end
      stop = index_of("?>", @pos)
      raise ended if stop.nil?

      data = substring(@pos, stop)
      if !data.empty? && !Xml.xml_space(data.ord)
        raise XmlException, "a processing instruction's target needs a space after it"
      end

      @pos = stop + 2
      if target.length == 3 && target.downcase(:ascii) == "xml"
        if begin_at != 0 || target != "xml"
          raise XmlException, "an XML declaration can only come first"
        end

        Xml.check_declaration(data)
      elsif target.include?(":")
        raise XmlException, "a processing instruction's target can't have a colon"
      end
      Token.of(:other)
    end

    class << self
      # Reads version="1.0" encoding="UTF-8" standalone="yes", of which only the version is
      # required, in that order.
      def check_declaration(data)
        pos = [0]
        version = field(data, pos, "version")
        raise bad if version.nil?
        raise XmlException, "unsupported XML version \"#{version}\"; only 1.0 is" if version != "1.0"

        encoding = field(data, pos, "encoding")
        if !encoding.nil? && encoding.downcase(:ascii) != "utf-8"
          raise XmlException, "unsupported encoding \"#{encoding}\"; only UTF-8 is"
        end

        standalone = field(data, pos, "standalone")
        raise bad if !standalone.nil? && standalone != "yes" && standalone != "no"

        data.each_char.drop(pos[0]).each do |c|
          raise bad unless xml_space(c.ord)
        end
      end

      private

      def bad
        XmlException.new("malformed XML declaration")
      end

      # One field of a declaration, or nil if the next isn't that one. +pos+ is a one-element
      # Array holding a char index into +data+.
      def field(data, pos, key)
        chars = data.chars
        n = chars.length
        i = pos[0]
        i += 1 while i < n && xml_space(chars[i].ord)
        return nil if i == pos[0] || chars[i, key.length].join != key

        i += key.length
        i += 1 while i < n && xml_space(chars[i].ord)
        raise bad if i >= n || chars[i] != "="

        i += 1
        i += 1 while i < n && xml_space(chars[i].ord)
        raise bad if i >= n || (chars[i] != '"' && chars[i] != "'")

        stop = data.index(chars[i], i + 1)
        raise bad if stop.nil?

        pos[0] = stop + 1
        chars[(i + 1)...stop].join
      end
    end

    # An XML 1.0 Name.
    def name
      start = @pos
      while @pos < @len
        r = @src[@pos]
        break if @pos == start ? !Xml.name_start(r) : !Xml.name_char(r)

        @pos += 1
      end
      raise XmlException, "expected a name" if @pos == start

      substring(start, @pos)
    end

    def space
      start = @pos
      @pos += 1 while @pos < @len && Xml.xml_space(@src[@pos])
      @pos > start
    end

    # Divides a name at its colon, of which it can have one, between two parts.
    def split_qname(raw)
      colon = raw.index(":")
      return ["", raw] if colon.nil?

      before = raw[0, colon]
      after = raw[(colon + 1)..]
      if before.empty? || after.empty? || after.include?(":") || !Xml.name_start(after.ord)
        raise XmlException, "\"#{raw}\" isn't a valid qualified name"
      end

      [before, after]
    end

    def end_tag
      @pos += 2
      raw = begin
        name
      rescue XmlException
        raise XmlException, "expected a name after </"
      end
      space
      raise ended if @pos >= @len
      raise XmlException, "unexpected characters in </#{raw}>" if @src[@pos] != GT

      @pos += 1
      raise XmlException, "</#{raw}> closes nothing" if @stack.empty?

      top = @stack.last
      raise XmlException, "<#{top.raw}> is closed by </#{raw}>" if top.raw != raw

      close_element
    end

    def close_element
      top = @stack.pop
      top.undo.reverse_each do |prefix, old|
        if old.nil?
          @ns.delete(prefix)
        else
          @ns[prefix] = old
        end
      end
      @done_root = true if @stack.empty?
      Token.new(:end, top.name, [].freeze, "")
    end

    def start_tag
      @pos += 1
      raw = begin
        name
      rescue XmlException
        raise XmlException, "expected a name after <"
      end
      raise XmlException, "markup can only have one root element" if @done_root

      attrs = []
      seen = {}
      self_closing = false
      loop do
        spaced = space
        raise ended if @pos >= @len

        c = @src[@pos]
        if c == GT
          @pos += 1
          break
        end
        if c == SLASH
          raise XmlException, "expected /> in an element" unless starts?("/>")

          @pos += 2
          self_closing = true
          break
        end
        raise XmlException, "<#{raw}> needs a space before each attribute" unless spaced

        aname = begin
          name
        rescue XmlException
          raise XmlException, "expected an attribute name in <#{raw}>"
        end
        raise XmlException, "attribute \"#{aname}\" is repeated" if seen.key?(aname)

        seen[aname] = true
        space
        raise XmlException, "attribute \"#{aname}\" has no value" if @pos >= @len || @src[@pos] != EQ

        @pos += 1
        space
        attrs << [aname, attr_value]
      end
      frame = Frame.new(raw)
      # Declarations apply to the element they're on, so they're read first.
      attrs.each { |a| declare(a[0], a[1], frame) }
      q = split_qname(raw)
      raise XmlException, "an element can't use the xmlns prefix" if q[0] == "xmlns"

      space_uri = @ns.fetch(q[0], "")
      raise XmlException, "prefix \"#{q[0]}\" isn't declared" if !q[0].empty? && space_uri.empty?

      frame.name = Name.new(space_uri, q[1])
      expanded = {}
      out = []
      attrs.each do |a|
        next if a[0] == "xmlns" || a[0].start_with?("xmlns:")

        aq = split_qname(a[0])
        aspace = ""
        unless aq[0].empty?
          aspace = @ns.fetch(aq[0], "")
          raise XmlException, "prefix \"#{aq[0]}\" isn't declared" if aspace.empty?
        end
        n = Name.new(aspace, aq[1])
        raise XmlException, "attribute \"#{a[0]}\" is repeated" if expanded.key?(n)

        expanded[n] = true
        out << Attr.new(n, a[1])
      end
      @stack.push(frame)
      tok = Token.new(:start, frame.name, out, "")
      @pending = close_element if self_closing
      tok
    end

    # Applies a namespace declaration, if an attribute is one.
    def declare(name, value, frame)
      prefix = ""
      if name == "xmlns"
        # The default namespace.
      elsif name.start_with?("xmlns:")
        prefix = name["xmlns:".length..]
        split_qname(name)
        raise XmlException, "the xmlns prefix can't be declared" if prefix == "xmlns"
        raise XmlException, "prefix \"#{prefix}\" can't be undeclared" if value.empty?
      else
        return
      end
      if (prefix == "xml") != (value == XML_NAMESPACE) || value == XMLNS_NAMESPACE
        raise XmlException, "namespace \"#{value}\" can't be bound to that prefix"
      end

      frame.undo << [prefix, @ns[prefix]]
      @ns[prefix] = value
    end

    # A quoted value, with literal whitespace turned into spaces as XML says.
    def attr_value
      if @pos >= @len || (@src[@pos] != QUOT && @src[@pos] != APOS)
        raise XmlException, "an attribute's value needs quotes"
      end

      quote = @src[@pos]
      @pos += 1
      b = +""
      loop do
        raise ended if @pos >= @len

        c = @src[@pos]
        if c == quote
          @pos += 1
          return b
        end
        case c
        when LT
          raise XmlException, "< can't appear in an attribute's value"
        when AMP
          b << reference
        when TAB, LF, CR
          b << " "
          @pos += 1
        else
          b << c
          @pos += 1
        end
      end
    end

    SEMI = ";".ord
    NAMED = { "lt" => "<", "gt" => ">", "amp" => "&", "apos" => "'", "quot" => '"' }.freeze
    private_constant :SEMI, :NAMED

    # One of XML's five named entities, or a reference to a character.
    def reference
      stop = nil
      i = @pos
      while i < @len
        if @src[i] == SEMI
          stop = i
          break
        end
        i += 1
      end
      raise XmlException, "& needs to begin a reference ending in ;" if stop.nil?

      body = substring(@pos + 1, stop)
      @pos = stop + 1
      named = NAMED[body]
      return named if named

      if body.start_with?("#x")
        digits = body[2..]
        base = 16
      elsif body.start_with?("#")
        digits = body[1..]
        base = 10
      else
        raise XmlException, "unknown entity &#{body};"
      end
      v = 0
      ok = !digits.empty?
      digits.each_char do |ch|
        break unless ok

        d = digit(ch, base)
        if d.nil?
          ok = false
        else
          v = v * base + d
          ok = v <= 0x10ffff
        end
      end
      raise XmlException, "invalid reference &#{body};" if !ok || !Xml.xml_char(v)

      [v].pack("U")
    end

    # An ASCII digit's value in +base+ (10 or 16), or nil.
    def digit(ch, base)
      o = ch.ord
      d = if o >= 0x30 && o <= 0x39
            o - 0x30
          elsif o >= 0x61 && o <= 0x66
            o - 0x61 + 10
          elsif o >= 0x41 && o <= 0x46
            o - 0x41 + 10
          end
      return nil if d.nil? || d >= base

      d
    end
  end
end
