# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # Writes plain data as JSON: hashes, arrays, strings, numbers, booleans and nil. It's its own
  # so that numbers are written the same way everywhere, and the command starts quickly.
  module Json
    module_function

    def write(value, indent: true)
      out = +""
      put(out, value, indent ? 0 : -1)
      out
    end

    # A number as its shortest decimal, without an exponent if it's of a usual size.
    def number(v)
      return v.to_s if v.is_a?(Integer)
      raise ArgumentError, "JSON has no #{v}" if v.nan? || v.infinite?
      return v.to_i.to_s if v == v.round && v.abs < 1e15
      text = v.to_s
      return text unless text.include?("e")
      mantissa, exponent = text.split("e")
      mantissa = mantissa.delete_suffix(".0")
      "#{mantissa}e#{exponent.to_i}"
    end

    def newline(out, depth)
      return if depth.negative?
      out << "\n" << (" " * depth)
    end

    def put(out, value, depth)
      inner = depth >= 0 ? depth + 1 : -1
      case value
      when nil then out << "null"
      when String then string(out, value)
      when true, false then out << value.to_s
      when Numeric then out << number(value)
      when Hash
        return out << "{}" if value.empty?
        out << "{"
        value.each_with_index do |(k, v), i|
          out << "," if i.positive?
          newline(out, inner)
          string(out, k.to_s)
          out << (depth >= 0 ? ": " : ":")
          put(out, v, inner)
        end
        newline(out, depth)
        out << "}"
      when Array
        return out << "[]" if value.empty?
        out << "["
        value.each_with_index do |v, i|
          out << "," if i.positive?
          newline(out, inner)
          put(out, v, inner)
        end
        newline(out, depth)
        out << "]"
      else
        raise ArgumentError, "can't write #{value.class} as JSON"
      end
    end

    ESCAPES = { '"' => '\\"', "\\" => "\\\\", "\n" => "\\n", "\r" => "\\r", "\t" => "\\t" }.freeze

    def string(out, s)
      out << '"'
      out << s.gsub(/["\\\x00-\x1f  ]/) { |c| ESCAPES[c] || format("\\u%04x", c.ord) }
      out << '"'
    end
  end
end
