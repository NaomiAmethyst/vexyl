# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

require_relative "test_helper"

class KdlTest < Minitest::Test
  def parse(src)
    Vexyl::Kdl.parse(src)
  end

  def refused(src)
    assert_raises(Vexyl::Kdl::SyntaxError) { parse(src) }
  end

  def test_reads_nodes_arguments_properties_and_children
    nodes = parse("a 1 \"two\" key=#true {\n  b; c\n}\nd")
    assert_equal %w[a d], nodes.map(&:name)
    a = nodes[0]
    assert_equal [:number, :string], a.args.map(&:kind)
    assert_equal 1.0, a.args[0].number
    assert_equal "two", a.args[1].string
    assert_equal true, a.prop("key").bool
    assert_equal %w[b c], a.children.map(&:name)
  end

  def test_ends_a_hexadecimal_number_at_a_semicolon
    nodes = parse("a 0xff;b")
    assert_equal 255.0, nodes[0].args[0].number
    assert_equal "b", nodes[1].name
  end

  def test_reads_every_radix_and_underscores
    values = parse("a 0x1_F 0o17 0b101 1_000.5 -2e2 +3")[0].args.map(&:number)
    assert_equal [31.0, 15.0, 5.0, 1000.5, -200.0, 3.0], values
  end

  def test_reads_multi_line_strings_with_any_line_endings
    ["\n", "\r\n", "\r", "\u2028"].each do |nl|
      src = "a \"\"\"#{nl}  one#{nl}  two#{nl}  \"\"\""
      assert_equal "one\ntwo", parse(src)[0].args[0].string, nl.inspect
    end
  end

  def test_removes_indentation_before_resolving_escapes
    assert_equal "  x\n\ty", parse("a \"\"\"\n  \\s\\sx\n  \\ty\n  \"\"\"")[0].args[0].string
  end

  def test_reads_raw_strings
    nodes = parse("a #\"no \\n \"here\"\"# ##\"a\"#b\"##")
    assert_equal ["no \\n \"here\"", "a\"#b"], nodes[0].args.map(&:string)
  end

  def test_resolves_escapes
    s = parse('a "\\n\\r\\t\\\\\\"\\b\\f\\s\\u{1F1F8}\\   gone"')[0].args[0].string
    assert_equal "\n\r\t\\\"\b\f \u{1F1F8}gone", s
    refused('a "\\u{D800}"')
    refused('a "\\x"')
  end

  def test_drops_what_slashdash_comments
    nodes = parse("/-a 1\nb /-1 2 /-k=3 /-{ c }\n")
    assert_equal ["b"], nodes.map(&:name)
    assert_equal [2.0], nodes[0].args.map(&:number)
    assert_empty nodes[0].props
    assert_empty nodes[0].children
  end

  def test_continues_a_line_after_a_backslash
    nodes = parse("a 1 \\ // comment\n  2\nb")
    assert_equal [1.0, 2.0], nodes[0].args.map(&:number)
  end

  def test_marks_annotations_and_bare_strings
    n = parse("(t)a (u)1 bare")[0]
    assert n.annotated
    assert n.args[0].annotated
    assert n.args[1].bare
    refute n.args[0].bare
  end

  def test_keeps_repeated_properties_to_refuse
    n = parse("a k=1 k=2")[0]
    assert_equal ["k"], n.repeated_props
    assert_equal 2.0, n.prop("k").number
  end

  def test_refuses_what_isnt_kdl
    ["a \"open", "a {", "}", "a true", "a 1x", "a b=", "1a", "a \u0001", "a /* open",
     "a (t)k=1", "a #maybe", "a \"\"\"x\"\"\"", "a {} 1"].each do |src|
      refused(src)
    end
  end

  def test_reads_keywords
    values = parse("a #true #false #null #inf #-inf #nan")[0].args
    assert_equal [:bool, :bool, :null, :number, :number, :number], values.map(&:kind)
    assert_equal Float::INFINITY, values[3].number
    assert_equal(-Float::INFINITY, values[4].number)
    assert values[5].number.nan?
  end

  def test_records_where_nodes_start_and_end_in_code_points
    nodes = parse("\u{1F1F8}x 1; y {\n  z\n}")
    assert_equal [0, 4], [nodes[0].start, nodes[0].stop]
    assert_equal 6, nodes[1].start
    assert_equal "\u{1F1F8}x 1; y {\n  z\n}".length, nodes[1].stop
  end

  def test_keeps_a_value_too_small_to_hold_from_being_zero
    assert_operator parse("a 1e-400")[0].args[0].number, :>, 0
    assert_equal 0.0, parse("a 0e5")[0].args[0].number
  end
end
