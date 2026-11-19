# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

require "stringio"
require_relative "test_helper"

class RenderTest < Minitest::Test
  def options_flag
    Vexyl.parse(Fixtures.text("options.kdl"))
  end

  def ids(svg)
    svg.scan(/ id="([^"]*)"/).flatten
  end

  def test_starts_every_id_with_a_prefix_when_asked
    flag = Vexyl.parse(Fixtures.text("valid/united-states.kdl"))
    found = ids(flag.svg(id_prefix: "mine-"))
    refute_empty found
    assert(found.all? { |id| id.start_with?("mine-") })
    assert_equal found.uniq, found
  end

  def test_gives_two_documents_different_ids
    a = ids(Vexyl.parse(Fixtures.text("valid/united-states.kdl")).svg)
    b = ids(Vexyl.parse(Fixtures.text("valid/united-states.kdl").sub("United States", "Other")).svg)
    refute_empty a
    assert_empty a & b
  end

  def test_sets_the_height
    svg = Vexyl.parse(Fixtures.text("valid/sweden.kdl")).svg(height: 100)
    assert_match(/height="100"/, svg)
    assert_match(/width="160"/, svg)
  end

  def test_refuses_options_it_cant_use
    flag = options_flag
    Fixtures.json("options.json")["refused"].each do |args|
      out = StringIO.new
      status = Vexyl::CLI.main(["render", *args, File.join(Fixtures::SUITE, "options.kdl")],
                               stdout: out, stderr: StringIO.new)
      assert_equal 1, status, args.inspect
      assert_empty out.string, args.inspect
    end
    assert_raises(Vexyl::Error) { flag.svg(height: 0) }
    assert_raises(Vexyl::Error) { flag.svg(fold_step: 1) }
    assert_raises(Vexyl::Error) { flag.svg(variant: "nope") }
  end

  def test_renders_every_form_of_every_flag
    Fixtures.cases.each do |c|
      flag = Vexyl.parse(Fixtures.text(c["file"]))
      c["renders"].each do |r|
        opts = Fixtures.options(r)
        if r["refused"]
          assert_raises(Vexyl::Error, "#{c["file"]} #{r["options"]}") { flag.svg(opts) }
        else
          assert flag.svg(opts).start_with?("<svg"), "#{c["file"]} #{r["options"]}"
        end
      end
    end
  end

  def test_gives_a_tree_that_writes_out_the_same
    flag = Vexyl.parse(Fixtures.text("valid/united-states.kdl"))
    tree = flag.svg_tree
    assert_equal "svg", tree.name
    assert_equal "title", tree.children[0].name
    assert_equal "United States", tree.children[0].text
    assert_equal tree, Vexyl::Render.tree(tree.to_s)
    assert tree.frozen?
  end

  def test_marks_drawn_elements_only_when_asked
    flag = Vexyl.parse(Fixtures.text("valid/united-states.kdl"))
    refute_includes flag.svg, Vexyl::TAG_ATTRIBUTE
    assert_includes flag.svg(tags: true), "#{Vexyl::TAG_ATTRIBUTE}=\"0\""
  end

  def test_doesnt_change_a_flag_when_rendering_it
    Fixtures.cases.each_slice(7).map(&:first).each do |c|
      flag = Vexyl.parse(Fixtures.text(c["file"]))
      before = flag.model_json
      first = c["renders"].map { |r| render_or_nil(flag, Fixtures.options(r)) }
      assert_equal before, flag.model_json, c["file"]
      assert_equal first, c["renders"].map { |r| render_or_nil(flag, Fixtures.options(r)) }, c["file"]
    end
  end

  def test_renders_from_many_threads_at_once
    flag = Vexyl.parse(Fixtures.text("valid/united-states.kdl"))
    want = flag.svg
    results = Array.new(8) { Thread.new { Array.new(5) { flag.svg } } }.flat_map(&:value)
    assert(results.all? { |r| r == want })
  end

  def render_or_nil(flag, opts)
    flag.svg(opts)
  rescue Vexyl::Error
    nil
  end
end
