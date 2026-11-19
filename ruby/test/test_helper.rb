# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

require "json"
require "minitest/autorun"
require "vexyl"
require "vexyl/cli"

# The conformance suite's fixtures, which the tests read from the repository around ruby/.
module Fixtures
  SUITE = File.expand_path("../../conformance", __dir__)

  module_function

  def text(relative)
    File.read(File.join(SUITE, relative), encoding: "UTF-8")
  end

  def bytes(relative)
    File.binread(File.join(SUITE, relative))
  end

  def json(relative)
    JSON.parse(text(relative))
  end

  # Each flag in the manifest, with its renders.
  def cases
    @cases ||= json("manifest.json")["cases"]
  end

  # A render's options as the manifest writes them, with the ratio as hoist then fly.
  def options(render)
    opts = {}
    render["options"].each do |key, value|
      case key
      when "ratio"
        hoist, fly = value.split(":").map { |v| Float(v) }
        opts[:ratio] = fly / hoist
      when "fold_step" then opts[:fold_step] = Integer(value)
      when "variant", "side", "fit", "align", "fold" then opts[key.to_sym] = value
      else raise ArgumentError, "unknown option #{key}"
      end
    end
    Vexyl::RenderOptions.new(**opts)
  end
end
