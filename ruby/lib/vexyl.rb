# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

require_relative "vexyl/version"
require_relative "vexyl/errors"
require_relative "vexyl/model"
require_relative "vexyl/kdl"
require_relative "vexyl/limits"
require_relative "vexyl/numbers"
require_relative "vexyl/xml"
require_relative "vexyl/sanitizer"
require_relative "vexyl/parser"
require_relative "vexyl/geometry"
require_relative "vexyl/shapes"
require_relative "vexyl/adapter"
require_relative "vexyl/element"
require_relative "vexyl/render_options"
require_relative "vexyl/render"
require_relative "vexyl/canonical"
require_relative "vexyl/json"
require_relative "vexyl/locate"
require_relative "vexyl/share_dictionary"
require_relative "vexyl/share"
require_relative "vexyl/flag"

# Reads, checks and renders Vexyl flag documents, and reads and writes share links: the
# operations of section 1 of the SDK. Nothing here reads the network or the filesystem, since a
# document is self-contained.
#
#   problems = Vexyl.validate(source)     # empty if the document is valid
#   flag = Vexyl.parse(source)            # raises Vexyl::ProblemsError holding every problem
#   image = flag.svg(height: 1200)
module Vexyl
  # The format version this library reads.
  FORMAT_VERSION = 1

  # The attribute a tagged render marks each drawn element with.
  TAG_ATTRIBUTE = "data-vexyl-layer"

  # Reads a document, given as a String of UTF-8, or of bytes that have to be UTF-8. Raises
  # Vexyl::ProblemsError with every problem found, if it isn't valid.
  def self.parse(document)
    Flag.new(Parser.parse(text(document)))
  end

  # Every problem in a document, as Vexyl::Problem, or none if it's valid.
  def self.validate(document)
    parse(document)
    []
  rescue ProblemsError => e
    e.problems
  end

  # Where each layer and other part of a document is, as Vexyl::Span, in document order. It
  # reads only the document's syntax, so it works on one with other problems, and gives nothing
  # if the document isn't KDL.
  def self.locate(document)
    Locate.locate(document.to_s).freeze
  end

  # The innermost of a document's parts holding a line, or nil if none does.
  def self.layer_at(spans, line)
    Locate.layer_at(spans, line)
  end

  # Writes a name as part of a path, where % is %25 and / is %2F.
  def self.encode_path_name(name)
    Locate.encode_name(name)
  end

  # Reads a name written in a path.
  def self.decode_path_name(part)
    Locate.decode_name(part)
  end

  # The path of the layer holding another, or "" for one at the top of its scope.
  def self.parent_path(path)
    Locate.parent_path(path)
  end

  # Writes a document as the part of a share link after its #. Raises Vexyl::Error if it's
  # larger than a link can hold.
  def self.share_encode(document)
    Share.encode(document)
  end

  # Reads the document a share link holds, given the part after its #. Raises Vexyl::Error if
  # the link is malformed, corrupt, too large, or of a version this library doesn't read.
  def self.share_decode(link)
    Share.decode(link)
  end

  def self.text(document)
    raise TypeError, "a document is a String, not #{document.class}" unless document.is_a?(String)
    return document if document.encoding == Encoding::UTF_8 && document.valid_encoding?
    s = document.dup.force_encoding(Encoding::UTF_8)
    raise ProblemsError, [Problem.new(0, 0, nil, "a document has to be UTF-8")] unless s.valid_encoding?
    s
  end
  private_class_method :text
end
