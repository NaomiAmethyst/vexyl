# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

require "digest"
require_relative "test_helper"

class ShareTest < Minitest::Test
  def link(relative)
    Fixtures.bytes(relative).sub(/\n+\z/, "")
  end

  def test_has_the_dictionary_exactly
    assert_equal File.binread(File.expand_path("../../share/v1.dict", __dir__)), Vexyl::Share.dictionary
  end

  def test_round_trips_a_document_exactly
    ["", "vexyl 1\r\nmeta {}\r", "﻿vexyl 1\n\u{1F1F8}\u{1F1EA}\n", Fixtures.text("valid/united-states.kdl")].each do |doc|
      encoded = Vexyl.share_encode(doc)
      assert encoded.start_with?("v1.")
      assert_equal doc.b, Vexyl.share_decode(encoded).b
    end
  end

  def test_uses_the_dictionary
    doc = Fixtures.text("valid/united-states.kdl")
    without = Zlib::Deflate.new(9, -Zlib::MAX_WBITS).deflate(doc, Zlib::FINISH)
    assert_operator Vexyl.share_encode(doc).length, :<, without.bytesize * 4 / 3
  end

  def test_reads_the_suites_links
    cases = Fixtures.json("share.json")
    cases["accepted"].each do |c|
      doc = Vexyl.share_decode(link(c["link"]))
      assert_equal [c["bytes"], c["sha256"]], [doc.bytesize, Digest::SHA256.hexdigest(doc)], c["name"]
    end
    cases["refused"].each do |c|
      assert_raises(Vexyl::Error, c["name"]) { Vexyl.share_decode(link(c["link"])) }
    end
  end

  def test_refuses_what_isnt_a_link
    ["", "v1", "v2.AAAA", "v1.A", "v1.AA==", "v1.A+/A", "x"].each do |bad|
      assert_raises(Vexyl::Error, bad) { Vexyl.share_decode(bad) }
    end
    assert_raises(Vexyl::Error) { Vexyl.share_encode("x" * (Vexyl::Share::MAX_BYTES + 1)) }
  end
end
