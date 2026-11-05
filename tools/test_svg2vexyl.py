#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import unittest

import svg2vexyl as S

HEAD = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 30 20">'


def convert(body):
    return S.convert((HEAD + body + "</svg>").encode(), "Test")


class Recognition(unittest.TestCase):
    def native(self, body, *wanted):
        text, stats = convert(body)
        self.assertEqual(stats["inline"], 0, text)
        for want in wanted:
            self.assertIn(want, text)
        return text

    def test_stacked_rectangles_become_bars(self):
        self.native('<rect width="30" height="20" fill="#00f"/><rect width="30" height="15" fill="#fff"/>'
                    '<rect width="30" height="5" fill="#f00"/>',
                    "bars red white blue", "ratio 5 10 5")

    def test_half_and_half_is_vertical_bars(self):
        self.native('<rect width="30" height="20" fill="#fff"/><rect width="15" height="20" fill="#080"/>',
                    "bars green white", "along hoist")

    def test_bowtie_is_not_a_rectangle(self):
        text = self.native('<rect width="30" height="20" fill="#080"/><path d="M0 0h30L0 20h30z" fill="#ff0"/>',
                           "charge polygon")
        self.assertNotIn("charge rect", text)

    def test_stroked_lines_with_default_fill_make_a_fimbriated_cross(self):
        self.native('<rect width="30" height="20" fill="#f00"/>'
                    '<path d="M0 10H30M10 0V20" stroke="#fff" stroke-width="4"/>'
                    '<path d="M0 10H30M10 0V20" stroke="#00f" stroke-width="2"/>',
                    "cross blue", "fly 9 2 19", "hoist 9 2 9", "fimbriate white 1")

    def test_pentagram_is_a_star(self):
        self.native('<rect width="30" height="20" fill="#f00"/>'
                    '<path d="M15 5 17.939 14.045 10.245 8.455H19.755L12.061 14.045z" fill="#ff0"/>',
                    "charge star yellow", "at fly=15 hoist=10")

    def test_two_arcs_are_a_crescent(self):
        self.native('<rect width="30" height="20" fill="#f00"/>'
                    '<path d="M12 6A5 5 0 1 0 12 14 4 4 0 1 1 12 6z" fill="#fff"/>',
                    "charge disc white", "cut {")

    def test_stroked_circle_is_a_ring(self):
        self.native('<rect width="30" height="20" fill="#fd0"/>'
                    '<circle cx="15" cy="10" r="5" fill="none" stroke="#70a" stroke-width="2"/>',
                    "charge ring purple", "radius 6", "inner 4")

    def test_even_charges_become_a_line_and_a_ring(self):
        stars = "".join(f'<circle cx="{x}" cy="5" r="1" fill="#fff"/>' for x in (5, 10, 15))
        self.native('<rect width="30" height="20" fill="#00f"/>' + stars, "repeat line count=3 fly=5")

    def test_chevron(self):
        self.native('<rect width="30" height="20" fill="#f00"/><path d="M0 0 15 10 0 20z" fill="#00f"/>',
                    "chevrons blue", "depth 15")

    def test_off_center_chevron(self):
        self.native('<rect width="30" height="20" fill="#f00"/><path d="M0 0H5L10 5 0 15z" fill="#00f"/>',
                    "chevrons blue", "depth 10", "angle 45", "apex 5")

    def test_diagonal_stroke_is_a_band(self):
        self.native('<rect width="30" height="20" fill="#080"/><path d="M0 20 30 0" stroke="#000" stroke-width="4"/>',
                    "band black", "along bend-sinister", "width 4")

    def test_swallowtail_is_an_outline(self):
        self.native('<path d="M0 0H30L20 10 30 20H0z" fill="#f00"/>'
                    '<rect x="5" y="5" width="5" height="5" fill="#fff"/>',
                    "outline {", "field red")

    def test_triangle_reaching_every_side_is_not_an_outline(self):
        text, _ = convert('<path d="M0 20V0H30z" fill="#080"/><path d="M30 0V20H0z" fill="#00f"/>')
        self.assertNotIn("outline {", text)

    def test_outline_must_contain_what_follows(self):
        text, _ = convert('<path d="M0 0H30L20 10 30 20H0z" fill="#f00"/>'
                          '<rect y="9" width="30" height="2" fill="#fff"/>')
        self.assertNotIn("outline {", text)

    def test_clip_to_a_polygon_is_an_outline(self):
        self.native('<clipPath id="c"><path d="M0 0H30L20 10 30 20H0z"/></clipPath>'
                    '<g clip-path="url(#c)"><rect width="30" height="20" fill="#f00"/></g>',
                    "outline {", "field red")

    def test_clip_of_the_whole_flag_is_ignored(self):
        self.native('<clipPath id="c"><path d="M0 0H30V20H0z"/></clipPath>'
                    '<g clip-path="url(#c)"><rect width="30" height="20" fill="#f00"/></g>', "field red")

    def test_use_css_and_transforms_resolve(self):
        self.native('<style>.a{fill:#f00}</style><defs><rect id="r" class="a" width="15" height="20"/></defs>'
                    '<rect width="30" height="20" fill="#fff"/><use xlink:href="#r"/>',
                    "bars red white", "along hoist")

    def test_gradient_becomes_native(self):
        self.native('<linearGradient id="g"><stop offset="0" stop-color="#ffb0ca"/><stop offset="1" stop-color="#9bdaec"/>'
                    '</linearGradient><rect width="30" height="10" fill="url(#g)"/>'
                    '<rect y="10" width="30" height="10" fill="#000"/>',
                    "blend gradient pink teal", "bars blend black")


class Fallbacks(unittest.TestCase):
    def test_curves_stay_inline(self):
        text, stats = convert('<rect width="30" height="20" fill="#f00"/><path d="M0 0C5 5 10 5 15 0z" fill="#fff"/>')
        self.assertEqual(stats["inline"], 1)
        self.assertEqual(stats["reasons"], ["curved path"])
        self.assertIn("charge svg", text)

    def test_arc_flags_without_separators(self):
        subs, curved = S.parse_path("M0 0a5 5 0 110 10")
        self.assertTrue(curved)
        self.assertEqual(subs[0][0][-1], (0.0, 10.0))

    def test_what_cant_be_carried_is_reported(self):
        for body, reason in (('<text>Hi</text>', "text"), ('<image href="x.png"/>', "image")):
            with self.assertRaises(S.Unsupported) as e:
                convert(body)
            self.assertEqual(str(e.exception), reason)

    def test_exponent_sizes(self):
        text, _ = S.convert(b'<svg xmlns="http://www.w3.org/2000/svg" width="1e3" height="640"><rect width="1e3" height="640" fill="#fff"/></svg>', "Test")
        self.assertIn("fly=1000", text)


if __name__ == "__main__":
    unittest.main()
