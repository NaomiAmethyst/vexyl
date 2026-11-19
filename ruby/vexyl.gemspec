# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

require_relative "lib/vexyl/version"

Gem::Specification.new do |s|
  s.name = "vexyl"
  s.version = Vexyl::VERSION
  s.summary = "Reads Vexyl flag documents and renders them to SVG"
  s.description = "A library for Vexyl, a KDL format for flag designs: it validates and parses " \
                  "documents, renders them to SVG, and reads and writes share links. It has no " \
                  "dependencies beyond Ruby's standard library."
  s.authors = ["Naomi Persephone Amethyst"]
  s.email = "naomi@amethyst.name"
  s.homepage = "https://github.com/NaomiAmethyst/vexyl"
  s.license = "Apache-2.0"
  s.metadata = {
    "source_code_uri" => "https://github.com/NaomiAmethyst/vexyl/tree/main/ruby",
    "rubygems_mfa_required" => "true",
  }
  s.required_ruby_version = ">= 3.1"
  s.files = Dir["lib/**/*.rb", "exe/*", "README.md", "LICENSE"]
  s.bindir = "exe"
  s.executables = ["vexyl"]
  s.require_paths = ["lib"]
end
