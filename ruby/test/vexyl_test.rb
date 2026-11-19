# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

require_relative "test_helper"

class VexylTest < Minitest::Test
  MINIMAL = <<~KDL
    vexyl 1
    meta { name "Test" }
    palette { red "#ff0000"; white "#ffffff" }
    proportion hoist=2 fly=3
    field red
  KDL

  def test_reads_a_flag
    flag = Vexyl.parse(Fixtures.text("valid/sweden.kdl"))
    assert_equal "Sweden", flag.name
    assert_equal 10.0, flag.hoist
    assert_equal 16.0, flag.fly
    assert flag.frozen?
  end

  def test_reports_every_problem_with_its_line
    src = MINIMAL.sub("field red", "field nope\nbars colors=\"red\" ratio=\"1 1\"\ncharge red { shape disc }")
    problems = Vexyl.validate(src)
    assert_operator problems.length, :>=, 3
    assert_equal [5, 6, 7], problems.map(&:line).uniq.sort.first(3)
    assert(problems.all? { |p| p.column.positive? && !p.message.empty? })
    error = assert_raises(Vexyl::ProblemsError) { Vexyl.parse(src) }
    assert_equal problems, error.problems
  end

  def test_counts_columns_in_code_points
    problems = Vexyl.validate(MINIMAL.sub("field red", "/* \u{1F1F8}\u{1F1EA} */ field nope"))
    assert_equal [[5, 10]], problems.map { |p| [p.line, p.column] }
  end

  def test_gives_no_line_for_what_has_no_place
    problems = Vexyl.validate(MINIMAL.sub("meta { name \"Test\" }\n", ""))
    assert(problems.any? { |p| !p.line? && p.line.zero? && p.column.zero? })
  end

  def test_refuses_a_document_that_isnt_utf8
    problems = Vexyl.validate(MINIMAL.b.sub("Test", "T\xFFst".b))
    assert_equal 1, problems.length
    assert_match(/UTF-8/, problems[0].message)
    assert_empty Vexyl.validate(MINIMAL.b)
  end

  def test_keeps_names_away_from_rubys_own
    src = MINIMAL.sub('red "#ff0000"', 'class "#ff0000"; __proto__ "#00ff00"; object_id "#0000ff"')
                 .sub("field red", "field class\nfield __proto__\nfield object_id")
    model = Vexyl.parse(src).model
    assert_equal %w[class __proto__ object_id white], model["palette"].keys
    assert_equal "#00ff00", model["palette"]["__proto__"]["color"]
  end

  def test_gives_a_model_that_cant_be_changed
    model = Vexyl.parse(Fixtures.text("valid/sweden.kdl")).model
    assert model.frozen?
    assert model["layers"].frozen?
    assert model["layers"][0].frozen?
    assert_raises(FrozenError) { model["layers"] << {} }
  end

  def test_gives_every_flags_model
    Fixtures.cases.each do |c|
      want = Fixtures.json(c["file"].sub(/\.kdl\z/, ".model.json"))
      got = JSON.parse(Vexyl.parse(Fixtures.text(c["file"])).model_json)
      assert close?(want, got), c["file"]
    end
  end

  def test_works_out_what_depends_on_other_values
    src = MINIMAL.sub("field red", "field red\ncharge star white { radius 0.5; }")
    star = Vexyl.parse(src).model["layers"][1]
    assert_equal "star", star["shape"]
    assert_in_delta 0.5 * 0.381966, star["inner"], 1e-5
  end

  def test_reads_the_format_version_it_says
    assert_equal 1, Vexyl::FORMAT_VERSION
    refute_empty Vexyl.validate(MINIMAL.sub("vexyl 1", "vexyl 2"))
  end

  def close?(a, b)
    case a
    when Hash then b.is_a?(Hash) && a.keys.sort == b.keys.sort && a.all? { |k, v| close?(v, b[k]) }
    when Array then b.is_a?(Array) && a.length == b.length && a.zip(b).all? { |x, y| close?(x, y) }
    when Numeric
      next_to = [a.abs, b.abs].max
      b.is_a?(Numeric) && (a - b).abs <= (next_to < 1 ? 1e-6 : next_to * 1e-6)
    else a == b
    end
  end
end
