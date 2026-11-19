# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

require_relative "test_helper"

class LocateTest < Minitest::Test
  SRC = <<~KDL
    vexyl 1
    meta { name "Test" }
    palette { red "#ff0000"; "a/b%" "#ffffff" }
    proportion hoist=2 fly=3
    field red
    panel side=hoist width=1 {
      field "a/b%"
      charge red { disc radius=0.5 }
    }
    variant "x/y" { outline pennant; field red }
  KDL

  def test_finds_layers_and_other_parts
    paths = Vexyl.locate(SRC).map(&:path)
    assert_equal ["vexyl", "meta", "palette", "palette/red", "palette/a%2Fb%25", "proportion", "0", "1",
                  "1.0", "1.1", "variant/x%2Fy", "variant/x%2Fy/0", "variant/x%2Fy/outline"], paths
    here = Vexyl.layer_at(Vexyl.locate(SRC), 8)
    assert_equal "1.1", here.path
    assert_equal "1", Vexyl.parent_path(here.path)
    assert_equal "", Vexyl.parent_path("variant/x%2Fy/0")
    assert_equal "a/b%", Vexyl.decode_path_name(Vexyl.encode_path_name("a/b%"))
    assert_nil Vexyl.layer_at(Vexyl.locate(SRC), 99)
  end

  def test_gives_nothing_for_what_isnt_kdl
    assert_empty Vexyl.locate("vexyl 1\nmeta {")
  end

  def test_ends_a_part_just_past_its_last_character
    first = Vexyl.locate(SRC).first
    assert_equal [1, 1, 1, 8], [first.line, first.column, first.end_line, first.end_column]
    panel = Vexyl.locate(SRC).find { |s| s.path == "1" }
    assert_equal [6, 1, 9, 2], [panel.line, panel.column, panel.end_line, panel.end_column]
  end

  def test_finds_the_suites_lines
    Fixtures.json("locate.json").each do |c|
      spans = Vexyl.locate(Fixtures.text(c["file"]))
      c["spans"].each do |path, lines|
        got = spans.find { |s| s.path == path }
        refute_nil got, "#{c["file"]} #{path}"
        assert_equal lines, [got.line, got.end_line], "#{c["file"]} #{path}"
      end
    end
  end
end
