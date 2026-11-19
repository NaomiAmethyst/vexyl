# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # A document, an option or a share link that Vexyl refuses.
  class Error < StandardError; end

  # One thing wrong with a document, as section 2 of the SDK describes it. +line+ and +column+
  # are where it is, from 1, or 0 if it has no one place; a line ends at LF, once line endings are
  # normalized, and a column counts code points. +node+ is the name of the KDL node it's about, or
  # nil. +message+ is for a person to read, and programs mustn't depend on its wording.
  Problem = Struct.new(:line, :column, :node, :message) do
    # Whether it has a place in the document.
    def line?
      line.positive?
    end

    def to_s
      s = +""
      s << "#{line}:#{column}: " if line.positive?
      s << "#{node}: " if node && !node.empty?
      s << message
    end

    def to_h
      h = {}
      if line.positive?
        h["line"] = line
        h["column"] = column
      end
      h["node"] = node if node && !node.empty?
      h["message"] = message
      h
    end
  end

  # A document that isn't valid, with every problem found in it, in no order that programs
  # should depend on.
  class ProblemsError < Error
    attr_reader :problems

    def initialize(problems)
      @problems = problems.dup.freeze
      super(@problems.map(&:to_s).join("\n"))
    end
  end
end
