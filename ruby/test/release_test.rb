# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

require_relative "test_helper"

class ReleaseTest < Minitest::Test
  # A release has one version for everything, which is the one in ts/package.json.
  def test_has_the_releases_version
    package = JSON.parse(File.read(File.expand_path("../../ts/package.json", __dir__)))
    assert_equal package["version"], Vexyl::VERSION
  end

  def test_gemspec_says_the_same
    spec = File.read(File.expand_path("../vexyl.gemspec", __dir__))
    assert_includes spec, "s.version = Vexyl::VERSION"
    assert_includes spec, 's.required_ruby_version = ">= 3.1"'
  end
end
