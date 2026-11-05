#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import math
import unittest

import svg2vexyl as S

ARTWORK = S.ARTWORK_RUN
HEAD = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 30 20">'


def convert(body):
    return S.convert((HEAD + body + "</svg>").encode(), "Test")


class Tidying(unittest.TestCase):
    def flag(self, body):
        return S.tidy('vexyl 1\nproportion hoist=600 fly=900\n\n' + body)

    def test_proportion_reduces(self):
        self.assertIn("proportion hoist=2 fly=3", self.flag("field red\n"))

    def test_grid_keeps_stripes_whole(self):
        text = self.flag("panel {\n  side hoist\n  width 300\n  field blue\n}\n")
        self.assertIn("proportion hoist=2 fly=3", text)
        self.assertIn("width 1\n", text)

    def test_grid_grows_to_fit(self):
        text = self.flag("panel {\n  side hoist\n  width 100\n  field blue\n}\n")
        self.assertIn("proportion hoist=6 fly=9", text)
        self.assertIn("width 1\n", text)

    def test_sizes_snap_to_simple_values(self):
        text = self.flag("charge star white {\n  radius 112.51\n  at fly=150 hoist=300\n}\n")
        self.assertIn("radius 0.375", text)
        self.assertIn("at fly=0.5 hoist=1", text)

    def test_counts_and_angles_stay(self):
        text = self.flag("charge star white {\n  radius 30\n  points 7\n  rotate 300\n  repeat ring count=300 radius=150\n}\n")
        self.assertIn("points 7", text)
        self.assertIn("rotate 300", text)
        self.assertIn("count=300 radius=0.5", text)

    def test_fimbriation_scales(self):
        self.assertIn("fimbriate white 0.5", self.flag("band red {\n  width 150\n  fimbriate white 75\n}\n"))

    def test_markup_and_path_data_stay(self):
        body = 'charge svg {\n  at center\n  fly 300\n  hoist 300\n  markup #"""\n<rect width="300" fly="300"/>\n"""#\n}\n'
        text = self.flag(body)
        self.assertIn('<rect width="300" fly="300"/>', text)
        self.assertIn("fly 1\n", text)
        text = self.flag('charge path white {\n  d "M0 0L300 300"\n  box "0 0 300 300"\n  fly 300\n  hoist 300\n}\n')
        self.assertIn('d "M0 0L300 300"', text)
        self.assertIn('box "0 0 300 300"', text)

    def test_odd_proportion_uses_a_hoist_of_one(self):
        text = S.tidy("proportion hoist=1000 fly=1618.7\n\nfield red\n")
        self.assertIn("proportion hoist=1 fly=1.6187", text)

    def test_real_crimson_is_red(self):
        self.assertEqual(S.color_name("#bf0a30"), "red")
        self.assertEqual(S.color_name("#ff69b4"), "pink")


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
                    "bars red white blue", "ratio 1 2 1")

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
                    "charge star yellow", "at center")

    def test_two_arcs_are_a_crescent(self):
        self.native('<rect width="30" height="20" fill="#f00"/>'
                    '<path d="M12 6A5 5 0 1 0 12 14 4 4 0 1 1 12 6z" fill="#fff"/>',
                    "charge crescent white", "inner 4", "offset")

    def test_stroked_circle_is_a_ring(self):
        self.native('<rect width="30" height="20" fill="#fd0"/>'
                    '<circle cx="15" cy="10" r="5" fill="none" stroke="#70a" stroke-width="2"/>',
                    "charge ring purple", "radius 6", "inner 4")

    def test_even_charges_become_a_line_and_a_ring(self):
        stars = "".join(f'<circle cx="{x}" cy="5" r="1" fill="#fff"/>' for x in (5, 10, 15))
        self.native('<rect width="30" height="20" fill="#00f"/>' + stars, "repeat line count=3 fly=5")

    def test_panels_take_in_their_charges(self):
        self.native('<rect width="30" height="20" fill="#f00"/><rect width="10" height="10" fill="#00f"/>'
                    '<circle cx="5" cy="5" r="1" fill="#fff"/><circle cx="20" cy="15" r="1" fill="#fff"/>',
                    "canton {", "fly 10", "field blue", "  charge disc white {", "    at center")

    def test_side_panel(self):
        self.native('<rect width="30" height="20" fill="#ff0"/><rect width="10" height="10" y="10" fill="#f00"/>'
                    '<rect width="5" height="20" fill="#080"/>',
                    "panel {", "side hoist", "width 5")

    def test_staggered_stars_become_a_grid(self):
        stars = "".join(f'<circle cx="{5*(c+1)}" cy="{5*(r+1)}" r="1" fill="#fff"/>'
                        for r in range(3) for c in range(5) if (r+c) % 2 == 0)
        self.native('<rect width="30" height="20" fill="#f00"/><rect width="30" height="20" fill="#00f"/>' + stars,
                    "repeat grid rows=3 columns=5 stagger=#true")

    def test_irregular_charges_share_one_block(self):
        self.native('<rect width="30" height="20" fill="#00f"/><circle cx="5" cy="4" r="1" fill="#fff"/>'
                    '<circle cx="20" cy="15" r="1" fill="#fff"/>',
                    "at fly=5 hoist=4\n  at fly=20 hoist=15")

    def test_quarters(self):
        self.native('<rect width="30" height="20" fill="#fff"/><rect x="15" width="15" height="10" fill="#f00"/>'
                    '<rect y="10" width="15" height="10" fill="#00f"/>',
                    "quarters white red blue white")

    def test_quarters_per_saltire(self):
        self.native('<rect width="30" height="20" fill="#ff0"/><path d="M0 0 15 10 0 20z"/>'
                    '<path d="M0 20 15 10 30 20z" fill="#f00"/><path d="M30 20 15 10 30 0z" fill="#00f"/>',
                    "quarters yellow blue red black", "diagonal")

    def test_saltire_with_fimbriation(self):
        self.native('<rect width="30" height="20" fill="#00f"/>'
                    '<path d="M0 0 30 20M30 0 0 20" stroke="#fff" stroke-width="4"/>'
                    '<path d="M0 0 30 20M30 0 0 20" stroke="#f00" stroke-width="2"/>',
                    "saltire red", "width 2", "fimbriate white 1")

    def test_lozenge(self):
        self.native('<rect width="30" height="20" fill="#080"/><path d="M15 2 25 10 15 18 5 10z" fill="#ff0"/>',
                    "charge lozenge yellow", "fly 20", "hoist 16")

    def test_pile_from_an_edge(self):
        self.native('<rect width="30" height="20" fill="#00f"/><path d="M8 0H24V20z" fill="#ff0"/>',
                    "pile yellow", "from top", "base 8 24", "tip 24 20")

    def test_pile_cut_flat(self):
        self.native('<rect width="30" height="20" fill="#080"/><polygon points="0,0 6,6 6,14 0,20"/>',
                    "pile black", "depth 6", "flat 8")

    def test_sun(self):
        points = " ".join(f"{15+(4 if i%2==0 else 2)*math.sin(i*math.pi/4):.4f},{10-(4 if i%2==0 else 2)*math.cos(i*math.pi/4):.4f}" for i in range(8))
        self.native(f'<rect width="30" height="20" fill="#00f"/><polygon points="{points}" fill="#ff0"/>'
                    '<circle cx="15" cy="10" r="2" fill="#ff0"/>',
                    "charge sun yellow", "disc 2", "points 4")

    def test_curves_in_one_color_are_a_path(self):
        self.native('<rect width="30" height="20" fill="#f00"/><path d="M0 0C5 5 10 5 15 0z" fill="#fff"/>',
                    "charge path white", 'd "M0 0C5 5 10 5 15 0Z"', 'box "0 0 15 5"')

    def test_star_in_wedges_is_a_star(self):
        wedge = '<path id="a" d="M0-5V0h2.2" transform="rotate(18 0 -5)"/><use xlink:href="#a" transform="scale(-1 1)"/>'
        # This is the common drawing, whose pieces overlap rather than meeting in the middle.
        arms = "".join(f'<use xlink:href="#b" transform="rotate({72*i})"/>' for i in range(1, 5))
        text = self.native(f'<rect width="30" height="20" fill="#f00"/><g fill="#fff" transform="translate(15 10)"><g id="b">{wedge}</g>{arms}</g>',
                           "charge star white")
        self.assertNotIn("polygon", text)

    def test_wedges_that_are_not_a_star_stay_apart(self):
        self.native('<rect width="30" height="20" fill="#f00"/><path d="M15 10L20 10L20 15z" fill="#fff"/>'
                    '<path d="M15 10L10 10L10 5z" fill="#fff"/><path d="M15 10L15 1L18 2z" fill="#fff"/>',
                    "charge polygon white")

    def test_clip_on_a_shape_cuts_its_polygon(self):
        text = self.native('<clipPath id="c"><path d="M0 0H15V20H0z"/></clipPath><rect width="30" height="20" fill="#f00"/>'
                           '<path d="M5 5L25 5L25 15L5 15z" fill="#fff" clip-path="url(#c)"/>', "charge rect white")
        self.assertIn("fly 10", text)

    def test_clip_on_a_group_cuts_its_polygons(self):
        text = self.native('<clipPath id="c"><rect width="15" height="10"/></clipPath><rect width="30" height="20" fill="#f00"/>'
                           '<g clip-path="url(#c)"><path d="M0 0L30 20L0 20z" fill="#00f"/></g>', "charge polygon")
        self.assertNotIn("charge svg", text)

    def test_self_crossing_clip_splits_into_its_loops(self):
        # The common drawing of the Union Flag's clip crosses itself, and nonzero fills both loops.
        self.assertEqual(len(S.simple_parts([(0, 0), (0, 10), (20, 10), (20, 20)])), 2)
        clip = '<clipPath id="c"><path d="M0 0V10H20V20z"/></clipPath>'
        text = self.native(clip + '<rect width="30" height="20" fill="#f00"/><path d="M0 0H20V20H0z" fill="#fff" clip-path="url(#c)"/>', "charge polygon white")
        self.assertEqual(text.count("charge polygon"), 2)

    def test_clip_given_as_a_percentage_stays_inline(self):
        _, stats = convert('<clipPath id="c"><rect width="50%" height="10"/></clipPath><rect width="30" height="20" fill="#f00"/>'
                           '<rect width="15" height="20" fill="#fff" clip-path="url(#c)"/>')
        self.assertEqual(stats["inline"], 1)

    def test_same_charge_twice_in_one_place(self):
        star = '<path d="M15 5L16.2 8.4H19.8L16.9 10.6L18 14L15 12L12 14L13.1 10.6L10.2 8.4H13.8z" fill="#fff"/>'
        self.assertNotIn("repeat", self.native('<rect width="30" height="20" fill="#f00"/>' + star*3))

    def test_dashed_line_given_in_percentages(self):
        text = self.native('<rect width="30" height="20" fill="#f00"/><line x1="50%" x2="50%" y2="100%" style="stroke:#fff;stroke-dasharray:2,2;stroke-width:30"/>')
        self.assertNotIn("charge svg", text)

    def test_details_between_runs_of_artwork_stay_with_them(self):
        curve = '<path d="M{0} 1C{0} 2 {1} 2 {1} 1z" fill="#{2}"/>'
        run = "".join(curve.format(i, i+1, "00f" if i % 2 else "0f0") for i in range(ARTWORK))
        middle = '<circle cx="15" cy="10" r="1" fill="#fff"/>'
        text, stats = convert('<rect width="30" height="20" fill="#f00"/>' + run + middle + run)
        self.assertEqual(text.count("charge svg"), 1)
        self.assertNotIn("charge disc", text)

    def test_stripe_between_runs_of_artwork_stays_apart(self):
        curve = '<path d="M{0} 1C{0} 2 {1} 2 {1} 1z" fill="#{2}"/>'
        run = "".join(curve.format(i, i+1, "00f" if i % 2 else "0f0") for i in range(ARTWORK))
        text, _ = convert('<rect width="30" height="20" fill="#f00"/>' + run + '<rect y="10" width="30" height="5" fill="#fff"/>' + run)
        self.assertEqual(text.count("charge svg"), 2)

    def test_curved_clip_stays_inline(self):
        text, stats = convert('<clipPath id="c"><circle cx="15" cy="10" r="5"/></clipPath><rect width="30" height="20" fill="#f00"/>'
                              '<rect width="15" height="20" fill="#fff" clip-path="url(#c)"/>')
        self.assertEqual(stats["reasons"], ["clipped or masked shape"], text)

    def test_clipped_diagonals_are_a_counterchanged_saltire(self):
        text, _ = S.convert(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30"><clipPath id="t">'
                            b'<path d="M30 15H60V30zM30 15V30H0zM30 15H0V0zM30 15V0H60z"/></clipPath>'
                            b'<rect width="60" height="30" fill="#00f"/>'
                            b'<path d="M0 0L60 30M60 0L0 30" stroke="#fff" stroke-width="6"/>'
                            b'<path d="M0 0L60 30M60 0L0 30" stroke="#f00" stroke-width="4" clip-path="url(#t)"/></svg>', "Test")
        self.assertIn("counterchange", text)
        self.assertNotIn("charge svg", text)

    def test_union_flag_in_a_corner_is_a_canton(self):
        text, stats = S.convert(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><clipPath id="t">'
                                b'<path d="M0,0V15H70V30H60zM0,30V40H30V0H60z"/></clipPath>'
                                b'<rect width="120" height="60" fill="#012169"/><g stroke="#c8102e" stroke-width="6">'
                                b'<path d="M0,0L60,30M60,0L0,30" stroke="#fff"/>'
                                b'<path d="M0,0L60,30M60,0L0,30" clip-path="url(#t)" stroke-width="4"/>'
                                b'<path d="M30,0V30M0,15H60" stroke="#fff" stroke-width="10"/>'
                                b'<path d="M30,0V30M0,15H60"/></g></svg>', "Test")
        self.assertEqual(stats["inline"], 0, text)
        self.assertIn("canton {", text)
        self.assertIn("counterchange", text)
        self.assertIn("fimbriate white 2", text)
        self.assertNotIn("charge polygon", text)

    def test_dashed_line_is_stripes(self):
        text = self.native('<rect width="30" height="20" fill="#f00"/><path d="M0 10H30" stroke="#fff" stroke-width="20" stroke-dasharray="5"/>')
        self.assertNotIn("charge svg", text)
        self.assertNotIn("stroke", text)

    def test_dashes_restart_on_each_line(self):
        self.assertEqual(S.dashes_along((0, 0), (10, 0), [4, 2]), [((0, 0), (4, 0)), ((6, 0), (10, 0))])
        self.assertEqual(S.dash_pattern("1"), [1.0, 1.0])
        self.assertIsNone(S.dash_pattern("none"))

    def test_near_uniform_scale_still_strokes(self):
        self.native('<rect width="30" height="20" fill="#f00"/><path d="M0 0C5 5 10 5 15 0z" fill="#fff" stroke="#000" stroke-width="1" transform="scale(1 1.01)"/>',
                    "charge path black", "hollow")

    def test_round_join_on_a_thin_stroke_is_fine(self):
        self.native('<rect width="30" height="20" fill="#f00"/><path d="M0 0C5 5 10 5 15 0z" fill="#fff" stroke="#000" stroke-width="0.1" stroke-linejoin="round"/>',
                    "charge path black")

    def test_round_join_on_a_thick_stroke_stays_inline(self):
        _, stats = convert('<rect width="30" height="20" fill="#f00"/><path d="M0 0C5 5 10 5 15 0z" fill="#fff" stroke="#000" stroke-width="3" stroke-linejoin="round"/>')
        self.assertEqual(stats["inline"], 1)

    def test_rays_in_one_color_are_not_artwork(self):
        rays = "".join(f'<path d="M15 10L{15+9*math.cos(i/2):.3f} {10+9*math.sin(i/2):.3f}L{15+9*math.cos(i/2+.1):.3f} {10+9*math.sin(i/2+.1):.3f}z" fill="#fff"/>' for i in range(12))
        self.native('<rect width="30" height="20" fill="#f00"/>' + rays, "charge polygon white")

    def test_shapes_touching_at_a_point_are_still_polygons(self):
        self.native('<rect width="30" height="20" fill="#f00"/><path d="M15 10L18 2L20 3zM15 10L10 18L8 17z" fill="#fff" transform="rotate(45 15 10)"/>',
                    "charge polygon white")

    def test_wide_dashes_stay_within_the_flag(self):
        text = self.native('<rect width="30" height="20" fill="#f00"/><path d="M0 0L30 20" stroke="#ff0" stroke-width="60" stroke-dasharray="6"/>')
        self.assertNotIn("chevrons", text)

    def test_stripe_is_not_anchored(self):
        text = self.native('<rect width="30" height="20" fill="#f00"/><path d="M0 8H30V12H0z" fill="#fff"/><path d="M0 2H30V3H0z" fill="#fff"/>')
        self.assertNotIn("anchor", text)

    def test_nearly_centered_charge_is_anchored(self):
        self.native('<rect width="30" height="20" fill="#f00"/><path d="M12 8C13 12 16 12 17.8 8z" fill="#fff"/>',
                    "charge path white", "anchor center")

    def test_charge_centered_in_a_panel_is_not_anchored(self):
        text = self.native('<rect width="30" height="20" fill="#f00"/><rect width="30" height="10" fill="#fff"/><rect width="10" height="20" fill="#00f"/>'
                           '<path d="M4 9C4.5 11 5.5 11 6 9z" fill="#fff"/>', "panel", "charge path white")
        self.assertNotIn("anchor", text)

    def test_charge_away_from_the_center_is_not_anchored(self):
        text = self.native('<rect width="30" height="20" fill="#f00"/><path d="M1 1C2 3 3 3 4 1z" fill="#fff"/>', "charge path white")
        self.assertNotIn("anchor", text)

    def test_ellipse_is_named(self):
        self.native('<rect width="30" height="20" fill="#f00"/><ellipse cx="15" cy="10" rx="4" ry="2" fill="#fff"/>',
                    "charge ellipse white", "fly 8", "hoist 4")

    def test_turned_ellipse_keeps_its_rotation(self):
        self.native('<rect width="30" height="20" fill="#f00"/><ellipse rx="4" ry="2" transform="translate(15 10) rotate(30)" fill="#fff"/>',
                    "charge ellipse white", "rotate 30")

    def test_stretched_circle_is_an_ellipse(self):
        self.native('<rect width="30" height="20" fill="#f00"/><circle r="2" transform="translate(15 10) scale(2 1)" fill="#fff"/>',
                    "charge ellipse white", "fly 8", "hoist 4")

    def test_skewed_ellipse_is_still_an_ellipse(self):
        self.native('<rect width="30" height="20" fill="#f00"/><ellipse rx="4" ry="2" transform="translate(15 10) skewX(30)" fill="#fff"/>',
                    "charge ellipse white", "rotate")

    def test_tall_ellipse_is_not_turned(self):
        text = self.native('<rect width="30" height="20" fill="#f00"/><ellipse cx="15" cy="10" rx="2" ry="4" fill="#fff"/>',
                           "charge ellipse white", "fly 4", "hoist 8")
        self.assertNotIn("rotate", text)

    def test_ellipse_with_equal_sizes_is_a_disc(self):
        self.native('<rect width="30" height="20" fill="#f00"/><ellipse cx="15" cy="10" rx="3" ry="3" fill="#fff"/>',
                    "charge disc white", "radius 3")

    def test_fill_and_stroke_on_an_ellipse_are_two_charges(self):
        self.native('<rect width="30" height="20" fill="#f00"/><ellipse cx="15" cy="10" rx="4" ry="2" fill="#fff" stroke="#000" stroke-width="1"/>',
                    "charge ellipse white", "charge ellipse black", "hollow 1")

    def test_fill_and_stroke_are_two_charges(self):
        text = self.native('<rect width="30" height="20" fill="#f00"/><path d="M0 0C5 5 10 5 15 0z" fill="#fff" stroke="#000" stroke-width="2"/>',
                           "charge path white", "charge path black", "hollow 2")
        self.assertEqual(text.count('d "M0 0'), 2)

    def test_stroked_star_is_hollow_polygon(self):
        self.native('<rect width="30" height="20" fill="#f00"/><polygon points="5,5 25,5 15,18" fill="none" stroke="#000" stroke-width="2"/>',
                    "charge polygon black", "hollow 2")

    def test_transformed_path_lands_in_flag_coordinates(self):
        self.native('<rect width="30" height="20" fill="#f00"/><g transform="translate(10 5) scale(2)"><path d="M0 0C1 1 2 1 3 0z" fill="#fff"/></g>',
                    'd "M10 5C12 7 14 7 16 5Z"')

    def test_long_runs_of_detail_stay_together_as_artwork(self):
        art = "".join(f'<path d="M{i} 0C{i} 5 {i+1} 5 {i+1} 0z" fill="#{i%3}{i%5}f"/>' for i in range(ARTWORK))
        text, stats = convert('<rect width="30" height="20" fill="#f00"/>' + art)
        self.assertEqual(stats["inline"], 1)
        self.assertEqual(set(stats["reasons"]), {"artwork"})
        self.assertNotIn("charge path", text)

    def test_named_outlines(self):
        self.native('<path d="M0 0H30L24 10 30 20H0z" fill="#f00"/>', "outline swallowtail {", "depth 6")
        self.native('<path d="M0 0H30L20 8 30 10 20 12 30 20H0z" fill="#f00"/>', "outline tongued {", "depth 10", "tongue 4")

    def test_rhombus_touching_the_hoist_is_not_a_chevron(self):
        text = self.native('<rect width="30" height="20" fill="#f00"/><path d="M0 10 15 0 30 10 15 20z" fill="#fff"/>',
                           "charge lozenge white")
        self.assertNotIn("chevrons", text)

    def test_rectangle_past_the_edge_is_clamped(self):
        self.native('<rect width="30" height="20" fill="#00f"/><rect y="10" x="-50" width="100" height="100" fill="#080"/>',
                    "bars blue green")

    def test_stretched_viewbox_keeps_its_true_shape(self):
        text, _ = S.convert(b'<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="550" viewBox="0 0 75 18" preserveAspectRatio="none">'
                            b'<rect width="75" height="18" fill="#fff"/></svg>', "Test")
        self.assertIn("proportion hoist=29.4643 fly=75", text)

    def test_nested_svg_has_its_own_coordinates(self):
        self.native('<rect width="30" height="20" fill="#f00"/><svg x="10" y="5" width="10" height="10" viewBox="0 0 100 100">'
                    '<circle cx="50" cy="50" r="50" fill="#fff"/></svg>',
                    "charge disc white", "radius 5", "at center")

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
                    "outline swallowtail {", "depth 10", "field red")

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
                    "outline swallowtail {", "field red")

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
    def test_clipped_shapes_stay_inline(self):
        text, stats = convert('<clipPath id="c"><circle cx="5" cy="5" r="3"/></clipPath><rect width="30" height="20" fill="#f00"/>'
                              '<path clip-path="url(#c)" d="M0 0C5 5 10 5 15 0z" fill="#fff"/>')
        self.assertEqual(stats["inline"], 1)
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
