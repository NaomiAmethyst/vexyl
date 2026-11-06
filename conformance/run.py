#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""Runs Vexyl's conformance suite against an implementation.

    run.py [--only render,model,invalid,accepted,sanitize] [--filter TEXT] [--resvg PATH] COMMAND...

COMMAND is how to run the implementation, which has to offer these, as `vexyl` does:

    COMMAND render [-ratio H:F] [-variant NAME] [-side SIDE] [-fit FIT] [-align WHERE]
                   [-fold NAME] [-fold-step N] -o OUT.svg FILE
    COMMAND model FILE
    COMMAND check -json FILE

Renders are compared as pixels using the pinned resvg, never as text, so implementations
are free to write their SVG differently.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))


SVG = "{http://www.w3.org/2000/svg}"
# What section 8.3 of the format allows in inline SVG. The renderer's own output needs no more than
# this, along with a root, a description, and <use> to place the parts of a folded flag.
ARTWORK_ELEMENTS = {"defs", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "linearGradient",
                    "radialGradient", "stop", "clipPath", "mask"}
PRESENTATION = {"fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
                "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "clip-path",
                "clip-rule", "mask", "stop-color", "stop-opacity", "color", "display", "visibility", "paint-order",
                "vector-effect", "shape-rendering", "mix-blend-mode", "isolation"}
ARTWORK_ATTRS = PRESENTATION | {"id", "transform", "d", "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "x1", "y1",
                                "x2", "y2", "points", "offset", "fx", "fy", "fr", "gradientUnits", "gradientTransform",
                                "spreadMethod", "clipPathUnits", "maskUnits", "maskContentUnits", "href", "style"}
ROOT_ATTRS = {"viewBox", "preserveAspectRatio"}
LOCAL_ID = re.compile(r"[A-Za-z_][A-Za-z0-9_.:-]*\Z")
LOCAL_URL = re.compile(r"url\(#[A-Za-z_][A-Za-z0-9_.:-]*\)")
COLOR_FUNCTION = re.compile(r"\b(?:rgb|rgba|hsl|hsla)\(", re.I)


def clean_paint(value):
    return "(" not in COLOR_FUNCTION.sub("", LOCAL_URL.sub("", value))


def output_problems(text):
    """Everything banned that an SVG document has in it, whatever it would look like when drawn."""
    problems = []
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        return [f"isn't well-formed: {e}"]
    ids = {}

    def visit(el, parent, in_artwork):
        if not el.tag.startswith(SVG):
            problems.append(f"element {el.tag} isn't in the SVG namespace")
            return
        tag = el.tag[len(SVG):]
        nested = tag == "svg" and parent is not None
        if nested and in_artwork:
            problems.append("artwork holds a nested <svg>")
        allowed = tag in ARTWORK_ELEMENTS or (tag == "svg" and not in_artwork) or \
            (tag in ("title", "desc") and parent is root) or (tag == "use" and not in_artwork)
        if not allowed:
            problems.append(f"<{tag}> isn't allowed")
        for name, value in el.attrib.items():
            if name.startswith("{"):
                problems.append(f"<{tag}> has a namespaced attribute {name}")
            elif name not in ARTWORK_ATTRS and not (tag == "svg" and name in ROOT_ATTRS):
                problems.append(f"<{tag}> has an attribute {name}")
            elif name == "href" and (not value.startswith("#") or not LOCAL_ID.match(value[1:])):
                problems.append(f"href {value!r} leaves the document")
            elif name in PRESENTATION and not clean_paint(value):
                problems.append(f"{name} {value!r} uses a function")
            elif name == "style":
                if "\\" in value or "@" in value or "/*" in value:
                    problems.append(f"style {value!r} has an escape, at-rule or comment")
                for decl in filter(str.strip, value.split(";")):
                    prop, _, val = decl.partition(":")
                    if prop.strip().lower() not in PRESENTATION or not clean_paint(val.strip()):
                        problems.append(f"style {value!r} isn't allowed")
            elif name == "id":
                if not LOCAL_ID.match(value):
                    problems.append(f"id {value!r} isn't valid")
                if value in ids:
                    problems.append(f"id {value!r} is used twice")
                ids[value] = el
        if tag not in ("title", "desc") and (el.text or "").strip(" \t\n\r"):
            problems.append(f"<{tag}> holds text")
        for child in el:
            if (child.tail or "").strip(" \t\n\r"):
                problems.append(f"text follows <{child.tag}>")
            visit(child, el, in_artwork or nested)

    visit(root, None, False)
    if root.tag != SVG + "svg":
        problems.append("the root isn't <svg>")
    return problems


def artwork_differs(want, got):
    """Compares artwork as it's drawn with its expected form, allowing only for IDs' prefixes.
    Each ID has to have gained one, so that artwork can't reach anything outside itself."""
    if want.tag != got.tag or len(want) != len(got):
        return f"has <{got.tag}> with {len(got)} children where <{want.tag}> with {len(want)} belongs"
    extra = {k: v for k, v in got.attrib.items() if k not in ("x", "y", "width", "height", "preserveAspectRatio")} if want.tag == SVG + "svg" else got.attrib
    if set(want.keys()) != set(extra):
        return f"<{want.tag}> has attributes {sorted(extra)}, not {sorted(want.keys())}"
    for name, value in want.items():
        have = extra[name]
        if name == "id" or (name == "href" and value.startswith("#")):
            bare = value.lstrip("#")
            if have == value or not have.startswith(value[:len(value) - len(bare)]) or not have.endswith(bare):
                return f"{name} {value!r} is {have!r}, with no prefix"
        elif "url(#" in value:
            pattern = re.escape(value)
            for ref in LOCAL_URL.findall(value):
                pattern = pattern.replace(re.escape(ref), r"url\(#[A-Za-z0-9_.:-]+" + re.escape(ref[len("url(#"):]))
            if not re.fullmatch(pattern, have) or have == value:
                return f"{name} {value!r} is {have!r}, with no prefix"
        elif have != value:
            return f"{name} {value!r} is {have!r}"
    for a, b in zip(want, got):
        found = artwork_differs(a, b)
        if found:
            return found
    return None


def nested_svgs(root):
    return [el for parent in root.iter() for el in parent if el.tag == SVG + "svg"]


def find_markup(value):
    if isinstance(value, dict):
        if "markup" in value:
            return value["markup"]
        value = list(value.values())
    if isinstance(value, list):
        for item in value:
            found = find_markup(item)
            if found is not None:
                return found
    return None


def rasterize(resvg, svg, height, png):
    subprocess.run([resvg, "--height", str(height), svg, png], check=True, capture_output=True, timeout=120)
    return np.asarray(Image.open(png).convert("RGBA")).astype(int)


def difference(a, b, threshold, tile=8):
    """Compares two images. Returns None if their sizes differ, or else three measures: the
    percentage of pixels in solid areas of difference, which ignores edges' antialiasing; the
    mean difference per channel, which sees a color that's slightly off everywhere; and the
    worst mean in any small tile, which sees a small shape in the wrong place or size."""
    if a.shape != b.shape:
        return None
    diff = np.abs(a - b)
    d = diff.sum(2) > threshold
    if d.shape[0] < 3 or d.shape[1] < 3:
        solid = 0.0
    else:
        solid = float((d[1:-1, 1:-1] & d[:-2, 1:-1] & d[2:, 1:-1] & d[1:-1, :-2] & d[1:-1, 2:]).mean() * 100)
    per_pixel = diff.astype(float).mean(2)
    h, w = per_pixel.shape[0] - per_pixel.shape[0] % tile, per_pixel.shape[1] - per_pixel.shape[1] % tile
    worst = float(per_pixel[:h, :w].reshape(h // tile, tile, w // tile, tile).mean((1, 3)).max()) if h and w else 0.0
    return solid, float(diff.mean()), worst


def within(result, tolerance, height):
    if result is None or result[0] > tolerance["solid_percent"] or result[1] > tolerance["mean_channel"]:
        return False
    # At small sizes, one tile covers too much of a flag for this to mean anything.
    return height < tolerance["worst_tile_height"] or result[2] <= tolerance["worst_tile"]


def numbers_close(a, b, tolerance=1e-6):
    """Compares two models, allowing for how numbers round in different languages."""
    if isinstance(a, bool) != isinstance(b, bool):
        return False
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(numbers_close(a[k], b[k], tolerance) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(numbers_close(x, y, tolerance) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool):
        return abs(a - b) <= tolerance * max(1.0, abs(a), abs(b))
    return a == b


def flags_for(options):
    args = []
    for key, flag in (("ratio", "-ratio"), ("variant", "-variant"), ("side", "-side"), ("fit", "-fit"),
                      ("align", "-align"), ("fold", "-fold"), ("fold_step", "-fold-step")):
        if key in options:
            args += [flag, str(options[key])]
    return args


def check_renders(command, manifest, resvg, tolerance, wanted, failures):
    count = 0
    with tempfile.TemporaryDirectory() as tmp:
        out, got, want = (os.path.join(tmp, n) for n in ("out.svg", "got.png", "want.png"))
        for case in manifest["cases"]:
            for render in case["renders"]:
                label = f"{case['name']} {render['name']}"
                if wanted and wanted not in label:
                    continue
                count += 1
                done = subprocess.run(command + ["render"] + flags_for(render["options"]) + ["-o", out, os.path.join(HERE, case["file"])],
                                      capture_output=True, text=True)
                if render.get("refused"):
                    if done.returncode == 0:
                        failures.append(f"{label}: should be refused")
                    continue
                if done.returncode:
                    failures.append(f"{label}: failed: {done.stderr.strip()[:200]}")
                    continue
                with open(out, encoding="utf-8") as f:
                    for problem in output_problems(f.read())[:3]:
                        failures.append(f"{label}: output: {problem}")
                for height in tolerance["heights"]:
                    try:
                        result = difference(rasterize(resvg, out, height, got), rasterize(resvg, os.path.join(HERE, render["svg"]), height, want),
                                            tolerance["threshold"])
                    except subprocess.CalledProcessError as e:
                        failures.append(f"{label}: resvg failed: {e.stderr[:200]}")
                        break
                    if not within(result, tolerance, height):
                        failures.append(f"{label} at {height}px: {'size differs' if result is None else 'solid %.3f%%, mean %.3f, worst tile %.1f' % result}")
                        break
    return count


def check_models(command, manifest, wanted, failures):
    count = 0
    for case in manifest["cases"]:
        if wanted and wanted not in case["name"]:
            continue
        count += 1
        done = subprocess.run(command + ["model", os.path.join(HERE, case["file"])], capture_output=True, text=True)
        if done.returncode:
            failures.append(f"{case['name']} model: failed: {done.stderr.strip()[:200]}")
            continue
        with open(os.path.join(HERE, case["model"])) as f:
            if not numbers_close(json.loads(done.stdout), json.load(f)):
                failures.append(f"{case['name']} model: differs")
    return count


def check_invalid(command, wanted, failures):
    with open(os.path.join(HERE, "invalid.json")) as f:
        cases = json.load(f)
    count = 0
    for case in cases:
        if wanted and wanted not in case["name"]:
            continue
        count += 1
        done = subprocess.run(command + ["check", "-json", os.path.join(HERE, case["file"])], capture_output=True, text=True)
        if done.returncode == 0:
            failures.append(f"{case['name']}: should be invalid")
            continue
        if "line" in case:
            try:
                lines = [p.get("line") for p in json.loads(done.stdout)]
            except ValueError:
                failures.append(f"{case['name']}: problems aren't JSON")
                continue
            if case["line"] not in lines:
                failures.append(f"{case['name']}: no problem on line {case['line']}: {lines}")
    return count


def check_accepted(command, wanted, failures):
    with open(os.path.join(HERE, "accepted.json")) as f:
        cases = json.load(f)
    count = 0
    for case in cases:
        if wanted and wanted not in case["name"]:
            continue
        count += 1
        done = subprocess.run(command + ["check", "-json", os.path.join(HERE, case["file"])], capture_output=True, text=True)
        if done.returncode:
            failures.append(f"{case['name']}: should be valid: {done.stdout.strip()[:200]}")
    return count


def check_sanitize(command, wanted, failures):
    """Checks what comes out of the sanitizer, in the model and in a render. Pixels couldn't show
    this: most of what a sanitizer removes draws nothing at all."""
    with open(os.path.join(HERE, "sanitize.json")) as f:
        cases = json.load(f)
    count = 0
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "out.svg")
        for case in cases:
            if wanted and wanted not in case["name"]:
                continue
            count += 1
            label = f"sanitizer: {case['name']}"
            path = os.path.join(HERE, case["file"])
            done = subprocess.run(command + ["model", path], capture_output=True, text=True)
            if done.returncode:
                failures.append(f"{label}: model failed: {done.stderr.strip()[:200]}")
                continue
            markup = find_markup(json.loads(done.stdout))
            if markup != case["markup"]:
                failures.append(f"{label}: model has {str(markup)[:300]}")
            done = subprocess.run(command + ["render", "-o", out, path], capture_output=True, text=True)
            if done.returncode:
                failures.append(f"{label}: render failed: {done.stderr.strip()[:200]}")
                continue
            with open(out, encoding="utf-8") as f:
                text = f.read()
            for problem in output_problems(text)[:3]:
                failures.append(f"{label}: output: {problem}")
            drawn = nested_svgs(ET.fromstring(text)) if not output_problems(text)[:1] or "well-formed" not in output_problems(text)[0] else []
            if len(drawn) != 1:
                failures.append(f"{label}: draws {len(drawn)} pieces of artwork")
                continue
            found = artwork_differs(ET.fromstring(case["markup"]), drawn[0])
            if found:
                failures.append(f"{label}: {found}")
    return count


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", default="render,model,invalid,accepted,sanitize")
    ap.add_argument("--filter", help="only cases whose names contain this")
    ap.add_argument("--resvg", default="resvg")
    ap.add_argument("command", nargs="+")
    args = ap.parse_args()
    command = args.command[0].split() if len(args.command) == 1 else args.command
    with open(os.path.join(HERE, "manifest.json")) as f:
        manifest = json.load(f)
    version = subprocess.run([args.resvg, "--version"], capture_output=True, text=True).stdout.strip()
    if version != manifest["resvg"]:
        sys.exit(f"resvg {manifest['resvg']} is required, because rasterizers differ; found {version!r}")
    failures = []
    only = args.only.split(",")
    totals = {}
    if "render" in only:
        totals["renders"] = check_renders(command, manifest, args.resvg, manifest["tolerance"], args.filter, failures)
    if "model" in only:
        totals["models"] = check_models(command, manifest, args.filter, failures)
    if "invalid" in only:
        totals["invalid documents"] = check_invalid(command, args.filter, failures)
    if "accepted" in only:
        totals["accepted documents"] = check_accepted(command, args.filter, failures)
    if "sanitize" in only:
        totals["sanitizer outputs"] = check_sanitize(command, args.filter, failures)
    for failure in failures:
        print("FAIL", failure)
    print(", ".join(f"{v} {k}" for k, v in totals.items()) + f": {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
