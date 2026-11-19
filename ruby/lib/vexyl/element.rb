# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # An element of a rendered SVG document, for code that wants to change or embed one.
  #
  # +name+ is its name, with any prefix, as it's written; +attrs+ its attributes, in order;
  # +text+ what's inside a +title+ or +desc+, the only elements that hold any, or the empty
  # string; +children+ its child elements, in order.
  class Element
    # An attribute of an element, as it's written in the document.
    Attribute = Struct.new(:name, :value) do
      def to_h
        { "name" => name, "value" => value }
      end
    end

    attr_reader :name, :attrs, :text, :children

    def initialize(name, attrs, text, children)
      @name = name.frozen? ? name : name.dup.freeze
      @attrs = attrs.map { |a| a.frozen? ? a : a.dup.freeze }.freeze
      @text = (text.nil? ? "" : text).dup.freeze
      @children = children.dup.freeze
      freeze
    end

    # The value of an attribute, or nil if it has none of that name.
    def attr(name)
      @attrs.each do |a|
        return a.value if a.name == name
      end
      nil
    end

    # Writes the element out as XML, which draws the same as the flag's SVG.
    def to_s
      b = +""
      write(b)
      b
    end

    # The element as the CLI's +tree+ command writes it: name, attrs, children, then text only
    # when there is some.
    def to_h
      h = {
        "name" => @name,
        "attrs" => @attrs.map(&:to_h),
        "children" => @children.map(&:to_h)
      }
      h["text"] = @text unless @text.empty?
      h
    end

    def ==(other)
      other.is_a?(Element) && other.name == @name && other.attrs == @attrs && other.text == @text &&
        other.children == @children
    end
    alias eql? ==

    def hash
      [@name, @attrs, @text, @children].hash
    end

    protected

    def write(b)
      b << "<" << @name
      @attrs.each do |a|
        b << " " << a.name << "=\"" << Xml.escape(a.value) << "\""
      end
      if @text.empty? && @children.empty?
        b << "/>"
        return
      end
      b << ">" << Xml.escape(@text)
      @children.each { |c| c.write(b) }
      b << "</" << @name << ">"
    end
  end
end
