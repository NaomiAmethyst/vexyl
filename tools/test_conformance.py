#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import json
import os
import sys
import unittest

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "conformance"))
import run  # noqa: E402

TOLERANCE = {"solid_percent": 0.05, "mean_channel": 0.25, "worst_tile": 16, "worst_tile_height": 512}


def flat(color=(200, 0, 0, 255), size=512):
    return np.full((size, size, 4), color, dtype=int)


class Comparing(unittest.TestCase):
    def passes(self, a, b):
        return run.within(run.difference(a, b, 48), TOLERANCE, a.shape[0])

    def test_same_image_passes(self):
        self.assertTrue(self.passes(flat(), flat()))

    def test_different_sizes_fail(self):
        self.assertIsNone(run.difference(flat(size=64), flat(size=32), 48))

    def test_color_slightly_off_everywhere_fails(self):
        self.assertFalse(self.passes(flat(), flat((202, 0, 0, 255))))

    def test_solid_area_of_difference_fails(self):
        b = flat()
        b[100:200, 100:200] = (0, 0, 200, 255)
        self.assertFalse(self.passes(flat(), b))

    def test_small_shape_out_of_place_fails(self):
        b = flat()
        b[100:104, 100:104] = (255, 255, 255, 255)
        self.assertFalse(self.passes(flat(), b))

    def test_antialiased_edge_passes(self):
        b = flat()
        b[100, :] = (201, 1, 1, 255)
        self.assertTrue(self.passes(flat(), b))

    def test_small_shape_is_ignored_where_a_tile_is_too_coarse(self):
        a, b = flat(size=32), flat(size=32)
        b[4, 4] = (205, 2, 2, 255)
        self.assertTrue(self.passes(a, b))

    def test_transparency_counts(self):
        self.assertFalse(self.passes(flat(), flat((200, 0, 0, 0))))


class Models(unittest.TestCase):
    def test_numbers_can_round_differently(self):
        self.assertTrue(run.numbers_close({"a": [1.0, {"b": 0.1 + 0.2}]}, {"a": [1, {"b": 0.3}]}))

    def test_values_must_match(self):
        self.assertFalse(run.numbers_close({"a": 1}, {"a": 2}))
        self.assertFalse(run.numbers_close({"a": 1}, {"a": 1, "b": 2}))
        self.assertFalse(run.numbers_close(["a"], ["b"]))
        self.assertFalse(run.numbers_close(True, 1))


class TagChecks(unittest.TestCase):
    OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>T</title>'

    def root(self, body):
        return run.ET.fromstring(self.OPEN + body + "</svg>")

    def test_a_plain_render_can_not_have_a_tag(self):
        self.assertTrue(run.output_problems(self.OPEN + '<rect data-vexyl-layer="0"/></svg>'))

    def test_a_tagged_render_can(self):
        self.assertEqual(run.output_problems(self.OPEN + '<rect data-vexyl-layer="1.2"/></svg>', tagged=True), [])

    def test_a_tag_has_to_be_a_path(self):
        for bad in ("bars", "1.", ".1", "1..2", "variant//0", "x/0", "1;2"):
            self.assertTrue(run.output_problems(self.OPEN + f'<rect data-vexyl-layer="{bad}"/></svg>', tagged=True), bad)
        for good in ("0", "12.3.4", "border", "reverse/0.1", "variant/a%2Fb/2", "variant/__proto__/border"):
            self.assertEqual(run.output_problems(self.OPEN + f'<rect data-vexyl-layer="{good}"/></svg>', tagged=True), [], good)

    def test_what_is_only_a_definition_needs_no_tag(self):
        root = self.root('<clipPath id="a"><rect/></clipPath><mask id="b"><rect/></mask><g><rect data-vexyl-layer="0"/></g>')
        self.assertEqual(run.untagged_drawn(root, False), [])

    def test_a_shape_with_no_tag_is_found(self):
        self.assertEqual(len(run.untagged_drawn(self.root('<g><rect/></g><rect data-vexyl-layer="0"/>'), False)), 1)

    def test_artwork_is_tagged_as_a_whole(self):
        self.assertEqual(run.untagged_drawn(self.root('<svg data-vexyl-layer="0"><rect/><path/></svg>'), False), [])
        self.assertEqual(len(run.untagged_drawn(self.root('<svg><rect/></svg>'), False)), 1)

    def test_only_a_fold_has_lines_that_no_layer_drew(self):
        root = self.root('<defs><g><rect data-vexyl-layer="0"/></g></defs><g><use href="#x"/></g><polygon/>')
        self.assertEqual(run.untagged_drawn(root, True), [])
        self.assertEqual(len(run.untagged_drawn(root, False)), 1)

    def test_drawing_one_path_keeps_only_its_shapes(self):
        root = self.root('<g><rect data-vexyl-layer="0"/><rect data-vexyl-layer="1"/></g><rect data-vexyl-layer="1"/>')
        kept = run.only_tag(root, "1")
        self.assertEqual([e.attrib[run.TAG] for e in kept.iter() if run.TAG in e.attrib], ["1", "1"])


class OutputChecks(unittest.TestCase):
    OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>T</title>'

    def problems(self, body):
        return run.output_problems(self.OPEN + body + "</svg>")

    def test_clean_output_passes(self):
        self.assertEqual(self.problems(
            '<clipPath id="a"><rect width="1" height="1"/></clipPath><g clip-path="url(#a)" style="isolation:isolate">'
            '<svg viewBox="0 0 1 1" x="0" y="0" width="1" height="1" preserveAspectRatio="xMidYMid meet" fill="rgb(1,2,3)"><rect id="b"/></svg></g>'), [])

    def test_each_banned_thing_is_seen(self):
        for body in ['<script/>', '<image href="x.png"/>', '<rect onclick="x"/>', '<rect class="a"/>', '<a/>', '<style/>',
                     '<text>x</text>', '<foreignObject/>', '<rect fill="url(https://example.test/)"/>',
                     '<rect fill="expression(x)"/>', '<rect style="fill:url(x)"/>', '<rect style="background:red"/>',
                     '<rect style="fill:\\75rl(x)"/>', '<linearGradient href="https://example.test/"/>', '<g>text</g>',
                     '<rect/>text', '<rect id="a"/><rect id="a"/>', '<rect id="a b"/>',
                     '<rect xmlns:x="urn:x" x:y="1"/>', '<x xmlns="urn:x"/>', '<svg viewBox="0 0 1 1"><use href="#a"/></svg>',
                     '<svg viewBox="0 0 1 1"><svg viewBox="0 0 1 1"/></svg>', '<g><title>x</title></g>']:
            self.assertTrue(self.problems(body), body)
        self.assertTrue(run.output_problems("<svg"))

    def test_artwork_has_to_match_but_for_prefixes(self):
        want = run.ET.fromstring('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect id="r" fill="url(#g)"/></svg>')
        def got(body, attrs=""):
            return run.ET.fromstring(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" x="1" y="1" width="1" height="1"{attrs}>{body}</svg>')
        self.assertIsNone(run.artwork_differs(want, got('<rect id="p-r" fill="url(#p-g)"/>')))
        self.assertTrue(run.artwork_differs(want, got('<rect id="r" fill="url(#p-g)"/>')))
        self.assertTrue(run.artwork_differs(want, got('<rect id="p-r" fill="url(#g)"/>')))
        self.assertTrue(run.artwork_differs(want, got('<rect id="p-r" fill="url(#p-g)" stroke="red"/>')))
        self.assertTrue(run.artwork_differs(want, got('<rect id="p-r" fill="url(#p-g)"/><rect/>')))
        self.assertTrue(run.artwork_differs(want, got('<rect id="p-r" fill="url(#p-g)"/>', ' onload="x"')))


class Schema(unittest.TestCase):
    def schema(self):
        with open(os.path.join(ROOT, "conformance", "model.schema.json")) as f:
            return json.load(f)

    def models(self):
        for name in sorted(os.listdir(os.path.join(ROOT, "conformance", "valid"))):
            if name.endswith(".model.json"):
                with open(os.path.join(ROOT, "conformance", "valid", name)) as f:
                    yield name, json.load(f)

    def test_every_fixture_fits_the_schema(self):
        count = 0
        for name, model in self.models():
            count += 1
            self.assertIsNone(run.schema_problem(model), name)
        self.assertGreater(count, 0)

    def test_the_schema_refuses_what_it_should(self):
        for name, model in self.models():
            if name == "sweden.model.json":
                self.assertTrue(run.schema_problem({**model, "colour": 1}))
                self.assertTrue(run.schema_problem({k: v for k, v in model.items() if k != "meta"}))
                self.assertTrue(run.schema_problem({**model, "layers": [{"layer": "sparkle"}]}))

    def test_every_field_in_the_schema_is_used_by_a_fixture(self):
        # A library can't guess a name that no fixture shows, as `even-odd` once showed.
        used = set()

        def visit(value, path):
            if isinstance(value, dict):
                for key, item in value.items():
                    used.add((path, key))
                    visit(item, key)
            elif isinstance(value, list):
                for item in value:
                    visit(item, path)
        names = set()

        def fields(value):
            if isinstance(value, dict):
                names.update(value.get("properties", {}))
                for item in value.values():
                    fields(item)
            elif isinstance(value, list):
                for item in value:
                    fields(item)
        fields(self.schema())
        for _, model in self.models():
            visit(model, "")
        seen = {key for _, key in used}
        self.assertEqual(names - seen, set())

    def test_every_shape_form_and_layer_is_used(self):
        seen = set()

        def visit(value):
            if isinstance(value, dict):
                for key in ("layer", "shape", "form", "step"):
                    if isinstance(value.get(key), str):
                        seen.add((key, value[key]))
                for item in value.values():
                    visit(item)
            elif isinstance(value, list):
                for item in value:
                    visit(item)
        for _, model in self.models():
            visit(model)
        wanted = set()

        def constants(value, key=None):
            if isinstance(value, dict):
                props = value.get("properties", {})
                for name in ("layer", "shape", "form", "step"):
                    field = props.get(name, {})
                    for const in ([field["const"]] if "const" in field else field.get("enum", [])):
                        wanted.add((name, const))
                for item in value.values():
                    constants(item)
            elif isinstance(value, list):
                for item in value:
                    constants(item)
        constants(self.schema())
        self.assertEqual(wanted - seen, set())

    def test_the_manifest_has_a_version(self):
        with open(os.path.join(ROOT, "conformance", "manifest.json")) as f:
            manifest = json.load(f)
        self.assertEqual(manifest["version"], 1)
        self.assertEqual(manifest["format"], 1)


class Flags(unittest.TestCase):
    def test_options_become_flags(self):
        self.assertEqual(run.flags_for({"ratio": "1:2", "fit": "pad", "fold_step": 1}),
                         ["-ratio", "1:2", "-fit", "pad", "-fold-step", "1"])


class Manifest(unittest.TestCase):
    @unittest.skipUnless(os.path.exists(os.path.join(ROOT, "conformance", "manifest.json")), "no fixtures")
    def test_every_file_it_names_exists(self):
        with open(os.path.join(ROOT, "conformance", "manifest.json")) as f:
            manifest = json.load(f)
        for case in manifest["cases"]:
            self.assertTrue(os.path.exists(os.path.join(ROOT, "conformance", case["file"])), case["file"])
            self.assertTrue(os.path.exists(os.path.join(ROOT, "conformance", case["model"])), case["model"])
            for render in case["renders"]:
                if not render.get("refused"):
                    self.assertTrue(os.path.exists(os.path.join(ROOT, "conformance", render["svg"])), render["svg"])


if __name__ == "__main__":
    unittest.main()
