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
