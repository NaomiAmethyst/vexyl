#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""Runs Vexyl's conformance suite against an implementation.

    run.py [--only render,model,invalid,accepted,sanitize,distinct,options,tags,locate,share] [--filter TEXT] [--resvg PATH]
           [--jobs N] COMMAND...

Options go before COMMAND, and everything from its first word on is COMMAND's.

COMMAND is how to run the implementation, which has to offer these, as `vexyl` does:

    COMMAND render [-height PIXELS] [-ratio H:F] [-variant NAME] [-side SIDE] [-fit FIT] [-align WHERE]
                   [-fold NAME] [-fold-step N] [-id-prefix TEXT] -o OUT.svg FILE
    COMMAND model FILE
    COMMAND check -json FILE
    COMMAND tree FILE
    COMMAND render -tags ...
    COMMAND locate [-line N] FILE
    COMMAND share encode FILE
    COMMAND share decode FILE

Renders are compared as pixels using the pinned resvg, never as text, so implementations
are free to write their SVG differently.

Cases run --jobs at a time, by default $VEXYL_JOBS or one for each CPU, each with files of its
own. What's reported doesn't depend on that: it's the same, in the same order, as with --jobs 1,
which runs one case after another.
"""
import argparse
import base64
import concurrent.futures
import copy
import hashlib
import json
import multiprocessing
import os
import re
import subprocess
import sys
import tempfile
import zlib
import xml.etree.ElementTree as ET

import jsonschema
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


TAG = "data-vexyl-layer"
TAG_PATH = re.compile(r"(?:(?:reverse|variant/[^/]+)/)?(?:[0-9]+(?:\.[0-9]+)*|border)\Z")
# Only what's drawn is marked, and artwork draws as a whole.
UNDRAWN = {"defs", "clipPath", "mask", "linearGradient", "radialGradient", "stop", "title", "desc"}
SHAPES = {"path", "rect", "circle", "ellipse", "line", "polyline", "polygon"}


def clean_paint(value):
    return "(" not in COLOR_FUNCTION.sub("", LOCAL_URL.sub("", value))


def output_problems(text, tagged=False):
    """Everything banned that an SVG document has in it, whatever it would look like when drawn.
    A tagged render can also have the attribute that marks what drew each element."""
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
            if tagged and name == TAG:
                if not TAG_PATH.match(value):
                    problems.append(f"<{tag}> has {TAG} of {value!r}, which isn't a path")
            elif name.startswith("{"):
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


def drawn_elements(root):
    """Yields what draws something, with whether it's a direct child of the root: each shape, and
    each piece of artwork as a whole, leaving out what's only a definition. In a fold the art is
    in defs and placed with <use>, so that counts as drawn, but its clips don't."""
    def walk(el, parent):
        for child in el:
            tag = child.tag[len(SVG):] if child.tag.startswith(SVG) else child.tag
            if tag in UNDRAWN and tag != "defs":
                continue
            if tag == "svg" or tag in SHAPES:
                yield child, el is root
            elif tag != "use":
                yield from walk(child, el)
    yield from walk(root, None)


def untagged_drawn(root, folded):
    """What a tagged render drew without saying what drew it. A fold's crease lines are the one
    thing that no layer draws, and they lie directly under the root."""
    return [el for el, top in drawn_elements(root) if TAG not in el.attrib and not (folded and top)]


def only_tag(root, path):
    """A copy of a tagged render holding nothing drawn but what a path drew."""
    kept = copy.deepcopy(root)
    def prune(el):
        for child in list(el):
            tag = child.tag[len(SVG):] if child.tag.startswith(SVG) else child.tag
            if tag in UNDRAWN and tag != "defs":
                continue
            if tag == "svg" or tag in SHAPES:
                if child.attrib.get(TAG) != path:
                    el.remove(child)
            elif tag != "use":
                prune(child)
    prune(kept)
    return kept


TAG_BOX_HEIGHT = 128


def boxes_of_tags(resvg, text, tmp):
    """The box of pixels that each path drew, by drawing each one alone."""
    ET.register_namespace("", SVG[1:-1])
    root = ET.fromstring(text)
    boxes = {}
    out, png = os.path.join(tmp, "only.svg"), os.path.join(tmp, "only.png")
    for path in sorted({el.attrib[TAG] for el, _ in drawn_elements(root) if TAG in el.attrib}):
        with open(out, "wb") as f:
            f.write(ET.tostring(only_tag(root, path)))
        alpha = rasterize(resvg, out, TAG_BOX_HEIGHT, png)[:, :, 3] > 64
        rows, columns = np.flatnonzero(alpha.any(1)), np.flatnonzero(alpha.any(0))
        boxes[path] = [int(columns[0]), int(rows[0]), int(columns[-1]) + 1, int(rows[-1]) + 1] if len(rows) else None
    return boxes


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


def rasterize_together(resvg, height, *pairs):
    """Rasterizes each SVG of an (SVG, PNG) pair at once, as rasterize does one, so that the two of a
    comparison take as long as the slower. If any fails, it raises what rasterize would have for the
    first of them that failed."""
    running = [subprocess.Popen([resvg, "--height", str(height), svg, png], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
               for svg, png in pairs]
    try:
        outputs = [process.communicate(timeout=120) for process in running]
    finally:
        for process in running:
            if process.poll() is None:
                process.kill()
                process.wait()
    for process, (stdout, stderr) in zip(running, outputs):
        if process.returncode:
            raise subprocess.CalledProcessError(process.returncode, process.args, stdout, stderr)
    return [np.asarray(Image.open(png).convert("RGBA")).astype(int) for _, png in pairs]


def rasterize_pair(resvg, height, a, b, together):
    """Rasterizes two (SVG, PNG) pairs, at once if together, or else one after the other."""
    if together:
        return rasterize_together(resvg, height, a, b)
    return [rasterize(resvg, svg, height, png) for svg, png in (a, b)]


def drawn_difference(resvg, height, threshold, got, want, together=True):
    """The difference between how two (SVG, PNG) pairs draw at a height, as difference gives it."""
    return difference(*rasterize_pair(resvg, height, got, want, together), threshold)


def draws_the_same(resvg, height, a, b, together=True):
    """Whether two (SVG, PNG) pairs draw exactly the same pixels at a height."""
    return np.array_equal(*rasterize_pair(resvg, height, a, b, together))


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


def written(path):
    """What a library wrote to an output file, and what's wrong with the file if it can't be used:
    that it wasn't written, can't be read, or is empty."""
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except FileNotFoundError:
        return "", "the output file wasn't written"
    except (OSError, UnicodeDecodeError) as e:
        return "", f"the output file can't be read: {e}"
    return text, None if text.strip() else "the output file is empty"


def well_formed(text):
    """Whether output is XML at all, so that what's in it can be looked at."""
    try:
        ET.fromstring(text)
    except ET.ParseError:
        return False
    return True


def flags_for(options):
    args = []
    for key, flag in (("ratio", "-ratio"), ("variant", "-variant"), ("side", "-side"), ("fit", "-fit"),
                      ("align", "-align"), ("fold", "-fold"), ("fold_step", "-fold-step")):
        if key in options:
            args += [flag, str(options[key])]
    return args


# What runs the suite's cases at once, or None to run them one after another. Comparing pictures
# and checking models against the schema is mostly Python's own work, which threads can't share, so
# that's done in PROCESSES.
POOL = None
PROCESSES = None


def each(work, items):
    """Gives work's result for each item, in the items' order, however many ran at once, so that
    what the suite reports never depends on which finished first."""
    if POOL is None:
        return [work(item) for item in items]
    return list(POOL.map(work, items))


def compute(function, *args):
    """Gives what function gives, from one of PROCESSES if the suite has them."""
    if PROCESSES is None:
        return function(*args)
    return PROCESSES.submit(function, *args).result()


def tally(results, failures):
    """Adds up what each case counted, and adds its failures in the cases' order."""
    count = 0
    for counted, found in results:
        count += counted
        failures.extend(found)
    return count


def check_renders(command, manifest, resvg, tolerance, wanted, failures):
    jobs = [(case, render, f"{case['name']} {render['name']}") for case in manifest["cases"] for render in case["renders"]]
    jobs = [job for job in jobs if not wanted or wanted in job[2]]
    with tempfile.TemporaryDirectory() as tmp:
        # Each render is written first, and then drawn at each height, so that a slow drawing
        # doesn't hold up the others. Each has files of its own, named by its place in the list.
        def draw(index):
            case, render, label = jobs[index]
            out = os.path.join(tmp, f"{index}.svg")
            done = subprocess.run(command + ["render"] + flags_for(render["options"]) + ["-o", out, os.path.join(HERE, case["file"])],
                                  capture_output=True, text=True)
            if render.get("refused"):
                return [f"{label}: should be refused"] if done.returncode == 0 else [], False
            if done.returncode:
                return [f"{label}: failed: {done.stderr.strip()[:200]}"], False
            text, problem = written(out)
            if problem:
                return [f"{label}: {problem}"], False
            return [f"{label}: output: {problem}" for problem in output_problems(text)[:3]], True

        def compare(job):
            index, height = job
            render = jobs[index][1]
            got, want = (os.path.join(tmp, f"{index}-{height}-{n}.png") for n in ("got", "want"))
            try:
                return compute(drawn_difference, resvg, height, tolerance["threshold"], (os.path.join(tmp, f"{index}.svg"), got),
                               (os.path.join(HERE, render["svg"]), want), POOL is not None), None
            except subprocess.CalledProcessError as e:
                return None, e
            finally:
                for png in (got, want):
                    if os.path.exists(png):
                        os.remove(png)

        drawn = each(draw, range(len(jobs)))
        # The largest drawings are slowest, so they start first.
        pairs = [(index, height) for height in sorted(tolerance["heights"], reverse=True) for index, (_, ok) in enumerate(drawn) if ok]
        compared = dict(zip(pairs, each(compare, pairs)))
    count = 0
    for index, (found, ok) in enumerate(drawn):
        label = jobs[index][2]
        count += 1
        failures.extend(found)
        if not ok:
            continue
        for height in tolerance["heights"]:
            result, error = compared[index, height]
            if error is not None:
                failures.append(f"{label}: resvg failed: {error.stderr[:200]}")
                break
            if not within(result, tolerance, height):
                failures.append(f"{label} at {height}px: {'size differs' if result is None else 'solid %.3f%%, mean %.3f, worst tile %.1f' % result}")
                break
    return count


def check_models(command, manifest, wanted, failures):
    def work(case):
        done = subprocess.run(command + ["model", os.path.join(HERE, case["file"])], capture_output=True, text=True)
        if done.returncode:
            return 1, [f"{case['name']} model: failed: {done.stderr.strip()[:200]}"]
        found = []
        got = json.loads(done.stdout)
        problem = compute(schema_problem, got)
        if problem:
            found.append(f"{case['name']} model: {problem}")
        with open(os.path.join(HERE, case["model"])) as f:
            if not numbers_close(got, json.load(f)):
                found.append(f"{case['name']} model: differs")
        return 1, found
    return tally(each(work, [case for case in manifest["cases"] if not wanted or wanted in case["name"]]), failures)


def schema_problem(model):
    """Says what's wrong with a model by the schema, if anything is."""
    with open(os.path.join(HERE, "model.schema.json")) as f:
        schema = json.load(f)
    error = jsonschema.exceptions.best_match(jsonschema.Draft202012Validator(schema).iter_errors(model))
    return None if error is None else f"at {error.json_path}: {error.message[:200]}"


def check_distinct(command, wanted, failures):
    """Two documents that mean different things can't have the same model."""
    with open(os.path.join(HERE, "distinct.json")) as f:
        cases = json.load(f)
    header = 'vexyl 1\nmeta { name "T"; }\npalette { a "#112233"; b "#445566"; }\nproportion hoist=10 fly=20\n'
    def document(body):
        if body.startswith("G "):
            return ('vexyl 1\nmeta { name "T"; }\npalette { a "#112233"; b "#445566"; g gradient a b { stops ' + body[2:]
                    + '; }; }\nproportion hoist=10 fly=20\nfield g\n')
        return header + body + "\n"
    def work(case):
        found = []
        models = []
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "doc.kdl")
            for side in ("a", "b"):
                with open(path, "w") as f:
                    f.write(document(case[side]))
                done = subprocess.run(command + ["model", path], capture_output=True, text=True)
                if done.returncode:
                    found.append(f"{case['name']}: model failed: {done.stderr.strip()[:200]}")
                    break
                models.append(json.loads(done.stdout))
        if len(models) == 2 and numbers_close(models[0], models[1]):
            found.append(f"{case['name']}: both have the same model")
        return 1, found
    return tally(each(work, [case for case in cases if not wanted or wanted in case["name"]]), failures)


def check_invalid(command, wanted, failures):
    with open(os.path.join(HERE, "invalid.json")) as f:
        cases = json.load(f)
    def work(case):
        done = subprocess.run(command + ["check", "-json", os.path.join(HERE, case["file"])], capture_output=True, text=True)
        if done.returncode == 0:
            return 1, [f"{case['name']}: should be invalid"]
        found = []
        if "line" in case:
            try:
                lines = [p.get("line") for p in json.loads(done.stdout)]
            except ValueError:
                return 1, [f"{case['name']}: problems aren't JSON"]
            if case["line"] not in lines:
                found.append(f"{case['name']}: no problem on line {case['line']}: {lines}")
            if "column" in case and not any(p.get("line") == case["line"] and p.get("column") == case["column"] for p in json.loads(done.stdout)):
                found.append(f"{case['name']}: no problem at column {case['column']} of line {case['line']}")
        return 1, found
    return tally(each(work, [case for case in cases if not wanted or wanted in case["name"]]), failures)


def check_accepted(command, wanted, failures):
    with open(os.path.join(HERE, "accepted.json")) as f:
        cases = json.load(f)
    def work(case):
        done = subprocess.run(command + ["check", "-json", os.path.join(HERE, case["file"])], capture_output=True, text=True)
        if done.returncode:
            return 1, [f"{case['name']}: should be valid: {done.stdout.strip()[:200]}"]
        return 1, []
    return tally(each(work, [case for case in cases if not wanted or wanted in case["name"]]), failures)


def check_sanitize(command, wanted, failures):
    """Checks what comes out of the sanitizer, in the model and in a render. Pixels couldn't show
    this: most of what a sanitizer removes draws nothing at all."""
    with open(os.path.join(HERE, "sanitize.json")) as f:
        cases = json.load(f)
    def work(case):
        label = f"sanitizer: {case['name']}"
        path = os.path.join(HERE, case["file"])
        done = subprocess.run(command + ["model", path], capture_output=True, text=True)
        if done.returncode:
            return 1, [f"{label}: model failed: {done.stderr.strip()[:200]}"]
        found = []
        markup = find_markup(json.loads(done.stdout))
        if markup != case["markup"]:
            found.append(f"{label}: model has {str(markup)[:300]}")
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "out.svg")
            done = subprocess.run(command + ["render", "-o", out, path], capture_output=True, text=True)
            if done.returncode:
                found.append(f"{label}: render failed: {done.stderr.strip()[:200]}")
                return 1, found
            text, problem = written(out)
        if problem:
            found.append(f"{label}: {problem}")
            return 1, found
        for problem in output_problems(text)[:3]:
            found.append(f"{label}: output: {problem}")
        drawn = nested_svgs(ET.fromstring(text)) if not output_problems(text)[:1] or "well-formed" not in output_problems(text)[0] else []
        if len(drawn) != 1:
            found.append(f"{label}: draws {len(drawn)} pieces of artwork")
            return 1, found
        differs = artwork_differs(ET.fromstring(case["markup"]), drawn[0])
        if differs:
            found.append(f"{label}: {differs}")
        return 1, found
    return tally(each(work, [case for case in cases if not wanted or wanted in case["name"]]), failures)


def write_tree(e):
    """Writes a tree of elements out, as a library has to be able to."""
    def esc(text):
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    attrs = "".join(f' {a["name"]}="{esc(a["value"])}"' for a in e["attrs"])
    return f'<{e["name"]}{attrs}>{esc(e.get("text", ""))}{"".join(write_tree(c) for c in e["children"])}</{e["name"]}>'


def ids_of(text):
    return [el.attrib["id"] for el in ET.fromstring(text).iter() if "id" in el.attrib]


def check_options(command, manifest, resvg, tolerance, wanted, failures):
    """Checks what a render's options do beyond what a flag's own forms show."""
    with open(os.path.join(HERE, "options.json")) as f:
        cases = json.load(f)
    path = os.path.join(HERE, cases["file"])

    def rendered(args, found, file=path):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "out.svg")
            done = subprocess.run(command + ["render"] + args + ["-o", out, file], capture_output=True, text=True)
            if done.returncode:
                found.append(f"options: {args}: failed: {done.stderr.strip()[:200]}")
                return ""
            text, problem = written(out)
            if problem is None and not well_formed(text):
                problem = "the output isn't well-formed"
            if problem:
                found.append(f"options: {args}: {problem}")
                return ""
            return text

    def refused(args, label):
        with tempfile.TemporaryDirectory() as tmp:
            if subprocess.run(command + ["render"] + args + ["-o", os.path.join(tmp, "out.svg"), path], capture_output=True, text=True).returncode == 0:
                return 1, [f"{label}: should be refused"]
        return 1, []

    def accepted(args, label):
        with tempfile.TemporaryDirectory() as tmp:
            done = subprocess.run(command + ["render"] + args + ["-o", os.path.join(tmp, "out.svg"), path], capture_output=True, text=True)
        if done.returncode:
            return 1, [f"{label}: failed: {done.stderr.strip()[:200]}"]
        return 1, []

    def height():
        found = []
        text = rendered(["-height", "100"], found)
        root = ET.fromstring(text) if text else None
        if root is not None and (float(root.attrib["height"]) != 100 or abs(float(root.attrib["width"]) - 200) > 1e-6):
            found.append(f"options: height: an image of {root.attrib['width']} by {root.attrib['height']}")
        return 1, found

    def id_prefix():
        found = []
        text = rendered(["-id-prefix", "mine-"], found)
        ids = ids_of(text) if text else []
        if not ids or not all(i.startswith("mine-") for i in ids):
            found.append(f"options: id prefix: gave {ids[:4]}")
        return 1, found

    def distinct_ids():
        found = []
        a, b = (rendered([], found, os.path.join(HERE, "valid", n + ".kdl")) for n in ("effects", "inline-svg"))
        shared = set(ids_of(a)) & set(ids_of(b)) if a and b else set()
        if shared:
            found.append(f"options: distinct ids: two documents share {sorted(shared)[:3]}")
        reverse = rendered(["-side", "reverse"], found, os.path.join(HERE, "valid", "effects.kdl"))
        forms = set(ids_of(reverse)) & set(ids_of(a)) if reverse and a else set()
        if forms:
            found.append(f"options: distinct ids: two forms of a document share {sorted(forms)[:3]}")
        return 1, found

    def tree_of(case, label):
        file = os.path.join(HERE, case["file"])
        done = subprocess.run(command + ["tree", file], capture_output=True, text=True)
        if done.returncode:
            return 1, [f"{label}: failed: {done.stderr.strip()[:200]}"]
        found = []
        tree = json.loads(done.stdout)
        titles = [c for c in tree["children"] if c["name"] == "title"]
        with open(os.path.join(HERE, case["model"])) as f:
            name = json.load(f)["meta"]["name"]
        if len(titles) != 1 or titles[0].get("text") != name:
            found.append(f"{label}: has no title of {name!r}")
        with tempfile.TemporaryDirectory() as tmp:
            out, got, want = (os.path.join(tmp, n) for n in ("out.svg", "got.png", "want.png"))
            with open(out, "w", encoding="utf-8") as f:
                f.write(write_tree(tree))
            for problem in output_problems(write_tree(tree))[:3]:
                found.append(f"{label}: output: {problem}")
            svg = next(r["svg"] for r in case["renders"] if r["name"] == "default")
            for height in tolerance["heights"]:
                try:
                    result = compute(drawn_difference, resvg, height, tolerance["threshold"], (out, got), (os.path.join(HERE, svg), want), POOL is not None)
                except subprocess.CalledProcessError as e:
                    found.append(f"{label}: resvg failed: {e.stderr[:200]}")
                    break
                if not within(result, tolerance, height):
                    found.append(f"{label} at {height}px: written out, it draws differently")
                    break
        return 1, found

    # Each check, in the order they're reported.
    checks = []
    for kind, check in (("refused", refused), ("accepted", accepted)):
        for args in cases[kind]:
            label = "options: " + " ".join(args)
            if not wanted or wanted in label:
                checks.append(lambda check=check, args=args, label=label: check(args, label))
    for label, check in (("options: height", height), ("options: id prefix", id_prefix), ("options: distinct ids", distinct_ids)):
        if not wanted or wanted in label:
            checks.append(check)
    for case in manifest["cases"][::7]:
        label = f"tree: {case['name']}"
        if not wanted or wanted in label:
            checks.append(lambda case=case, label=label: tree_of(case, label))
    return tally(each(lambda check: check(), checks), failures)


def check_tags(command, manifest, resvg, wanted, failures):
    """A tagged render has to draw exactly what the plain one does, say which layer drew everything
    it draws, and name only layers that the document has."""
    def locate(case):
        done = subprocess.run(command + ["locate", os.path.join(HERE, case["file"])], capture_output=True, text=True)
        if done.returncode:
            return f"tags: {case['name']}: locate failed: {done.stderr.strip()[:200]}"
        return {s["path"] for s in json.loads(done.stdout)}

    def work(job):
        case, render, label, known = job
        file = os.path.join(HERE, case["file"])
        found = []
        with tempfile.TemporaryDirectory() as tmp:
            plain, tagged, a, b = (os.path.join(tmp, n) for n in ("plain.svg", "tagged.svg", "a.png", "b.png"))
            args = flags_for(render["options"])
            done = subprocess.run(command + ["render"] + args + ["-tags", "-o", tagged, file], capture_output=True, text=True)
            if done.returncode:
                return 1, [f"{label}: failed: {done.stderr.strip()[:200]}"]
            subprocess.run(command + ["render"] + args + ["-o", plain, file], capture_output=True, text=True)
            text, problem = written(tagged)
            if problem:
                return 1, [f"{label}: {problem}"]
            untagged, problem = written(plain)
            if problem:
                return 1, [f"{label}: the plain render: {problem}"]
            if TAG in untagged:
                found.append(f"{label}: a plain render has tags in it")
            for problem in output_problems(text, tagged=True)[:3]:
                found.append(f"{label}: output: {problem}")
            if not well_formed(text):
                return 1, found
            root = ET.fromstring(text)
            missing = untagged_drawn(root, "fold" in render["options"])
            if missing:
                found.append(f"{label}: {len(missing)} drawn elements have no tag, such as <{missing[0].tag[len(SVG):]}>")
            unknown = {el.attrib[TAG] for el in root.iter() if TAG in el.attrib} - known
            if unknown:
                found.append(f"{label}: tags that the document doesn't have: {sorted(unknown)[:3]}")
            # Exactly the same pixels, with no tolerance at all.
            try:
                same = compute(draws_the_same, resvg, 96, (tagged, a), (plain, b), POOL is not None)
            except subprocess.CalledProcessError as e:
                found.append(f"{label}: resvg failed: {e.stderr[:200]}")
                return 1, found
            if not same:
                found.append(f"{label}: it draws differently from the plain render")
        return 1, found

    def form_of(form):
        label = f"tags: {form['name']}"
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "form.svg")
            done = subprocess.run(command + ["render", "-tags"] + form["args"] + ["-o", out, os.path.join(HERE, form["file"])], capture_output=True, text=True)
            if done.returncode:
                return 1, [f"{label}: failed: {done.stderr.strip()[:200]}"]
            text, problem = written(out)
            if problem is None and not well_formed(text):
                problem = "the output isn't well-formed"
            if problem:
                return 1, [f"{label}: {problem}"]
            try:
                got = boxes_of_tags(resvg, text, tmp)
            except subprocess.CalledProcessError as e:
                return 1, [f"{label}: resvg failed: {e.stderr[:200]}"]
        if got.keys() != form["boxes"].keys():
            return 1, [f"{label}: has tags {sorted(got)}, not {sorted(form['boxes'])}"]
        found = []
        for path, box in form["boxes"].items():
            near = (box is None and got[path] is None) or (box and got[path] and all(abs(x - y) <= 2 for x, y in zip(box, got[path])))
            if not near:
                found.append(f"{label}: {path} draws in {got[path]}, not {box}")
        return 1, found

    # Each document is located first, since its renders can only be checked against what it has.
    located = each(locate, manifest["cases"])
    jobs = [(case, render, f"tags: {case['name']} {render['name']}", known) for case, known in zip(manifest["cases"], located)
            if not isinstance(known, str) for render in case["renders"]]
    results = iter(each(work, [job for job in jobs if not job[1].get("refused") and (not wanted or wanted in job[2])]))
    count = 0
    for case, known in zip(manifest["cases"], located):
        if isinstance(known, str):
            failures.append(known)
            continue
        for render in case["renders"]:
            if not render.get("refused") and (not wanted or wanted in f"tags: {case['name']} {render['name']}"):
                count += tally([next(results)], failures)
    with open(os.path.join(HERE, "tags.json")) as f:
        forms = json.load(f)
    return count + tally(each(form_of, [form for form in forms if not wanted or wanted in f"tags: {form['name']}"]), failures)


def check_locate(command, wanted, failures):
    """Every part of a document has to be found on the lines where it is, and each of those lines
    has to lead back to the innermost part holding it."""
    with open(os.path.join(HERE, "locate.json")) as f:
        cases = json.load(f)

    def spans(case):
        label = f"locate: {case['file']}"
        done = subprocess.run(command + ["locate", os.path.join(HERE, case["file"])], capture_output=True, text=True)
        if done.returncode:
            return f"{label}: failed: {done.stderr.strip()[:200]}"
        got = {s["path"]: [s["line"], s["endLine"]] for s in json.loads(done.stdout)}
        if got != case["spans"]:
            wrong = sorted(k for k in got.keys() | case["spans"].keys() if got.get(k) != case["spans"].get(k))
            return f"{label}: differs at {wrong[:4]}: {[got.get(k) for k in wrong[:4]]}, not {[case['spans'].get(k) for k in wrong[:4]]}"
        return None

    def lines_of(case):
        """Each line that has to lead back to what's innermost there, in the order they're checked."""
        for path, (start, end) in case["spans"].items():
            for line in {start, end}:
                yield line

    def work(job):
        case, line = job
        label = f"locate: {case['file']}"
        # Whichever holds this line with the latest start is innermost.
        holders = [p for p, (s, e) in case["spans"].items() if s <= line <= e]
        best = max(case["spans"][p][0] for p in holders)
        innermost = {p for p in holders if case["spans"][p][0] == best}
        done = subprocess.run(command + ["locate", "-line", str(line), os.path.join(HERE, case["file"])], capture_output=True, text=True)
        span = json.loads(done.stdout) if done.returncode == 0 and done.stdout.strip() else None
        # Two on one line are told apart by their columns, which the line alone can't do.
        if span is None or (span["path"] not in innermost):
            return 0, [f"{label}: line {line} leads to {span and span['path']}, not one of {sorted(innermost)[:3]}"]
        return 0, []

    cases = [case for case in cases if not wanted or wanted in f"locate: {case['file']}"]
    # Each document's spans are compared first, and only those that match have their lines followed.
    problems = each(spans, cases)
    results = iter(each(work, [(case, line) for case, problem in zip(cases, problems) if problem is None for line in lines_of(case)]))
    for case, problem in zip(cases, problems):
        if problem is not None:
            failures.append(problem)
            continue
        for _ in lines_of(case):
            tally([next(results)], failures)
    return len(cases)


def check_share(command, wanted, failures):
    """Share links have to mean the same to every library, for good, so these are made with zlib
    rather than by a library, and what a library writes is read back with zlib."""
    with open(os.path.join(HERE, "share.json")) as f:
        cases = json.load(f)
    with open(os.path.join(HERE, "..", cases["dictionary"]), "rb") as f:
        dictionary = f.read()
    if hashlib.sha256(dictionary).hexdigest() != cases["sha256"]:
        failures.append("share: the dictionary has changed, which breaks every link already sent")

    def reading(case, label):
        done = subprocess.run(command + ["share", "decode", os.path.join(HERE, case["link"])], capture_output=True)
        if done.returncode:
            return 1, [f"{label}: failed: {done.stderr.decode(errors='replace').strip()[:200]}"]
        if hashlib.sha256(done.stdout).hexdigest() != case["sha256"]:
            return 1, [f"{label}: gave {len(done.stdout)} bytes that differ from the {case['bytes']} expected"]
        return 1, []

    def refusing(case, label):
        done = subprocess.run(command + ["share", "decode", os.path.join(HERE, case["link"])], capture_output=True, timeout=120)
        if done.returncode == 0:
            return 1, [f"{label}: it should be refused"]
        return 1, []

    def writing(file, label):
        path = os.path.join(HERE, file)
        done = subprocess.run(command + ["share", "encode", path], capture_output=True, text=True)
        if done.returncode:
            return 1, [f"{label}: failed: {done.stderr.strip()[:200]}"]
        link = done.stdout.strip()
        if not re.fullmatch(r"v1\.[A-Za-z0-9_-]+", link):
            return 1, [f"{label}: isn't in the right form: {link[:40]}"]
        body = link[3:]
        raw = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
        with open(path, "rb") as f:
            want = f.read()
        try:
            inflater = zlib.decompressobj(-15, zdict=dictionary)
            back = inflater.decompress(raw) + inflater.flush()
        except zlib.error as e:
            return 1, [f"{label}: zlib can't read it: {e}"]
        found = []
        if back != want:
            found.append(f"{label}: it holds different bytes")
        # It can't be doing this well unless it's using the dictionary.
        reference = zlib.compressobj(9, zlib.DEFLATED, -15, 9, zlib.Z_DEFAULT_STRATEGY, dictionary)
        size = len(reference.compress(want) + reference.flush())
        if len(raw) > size * 1.15 + 16:
            found.append(f"{label}: {len(raw)} bytes where a dictionary gives {size}")
        with tempfile.TemporaryDirectory() as tmp:
            own = os.path.join(tmp, "own.link")
            with open(own, "w") as f:
                f.write(link)
            done = subprocess.run(command + ["share", "decode", own], capture_output=True)
        if done.returncode or done.stdout != want:
            found.append(f"{label}: it can't read its own link")
        return 1, found

    def too_big():
        with tempfile.TemporaryDirectory() as tmp:
            big = os.path.join(tmp, "big.kdl")
            with open(big, "wb") as f:
                f.write(b"a" * (cases["limit"] + 1))
            done = subprocess.run(command + ["share", "encode", big], capture_output=True)
        if done.returncode == 0:
            return 1, ["share: refusing to write a document over the limit: it wrote one"]
        return 1, []

    # Each check, in the order they're reported.
    checks = []
    for check, verb, items in ((reading, "reading", [(c, c["name"]) for c in cases["accepted"]]),
                               (refusing, "refusing", [(c, c["name"]) for c in cases["refused"]]),
                               (writing, "writing", [(file, file) for file in cases["encode"]])):
        for item, name in items:
            label = f"share: {verb} {name}"
            if not wanted or wanted in label:
                checks.append(lambda check=check, item=item, label=label: check(item, label))
    if not wanted or "share: refusing to write" in wanted:
        checks.append(too_big)
    return tally(each(lambda check: check(), checks), failures)


def default_jobs():
    """How many cases run at once unless --jobs says otherwise: VEXYL_JOBS, or one for each CPU."""
    if os.environ.get("VEXYL_JOBS"):
        return int(os.environ["VEXYL_JOBS"])
    return len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else os.cpu_count() or 1


def main():
    global POOL, PROCESSES
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", default="render,model,invalid,accepted,sanitize,distinct,options,tags,locate,share")
    ap.add_argument("--filter", help="only cases whose names contain this")
    ap.add_argument("--resvg", default="resvg")
    ap.add_argument("-j", "--jobs", type=int, default=default_jobs(),
                    help="how many cases to run at once, by default $VEXYL_JOBS or one for each CPU; 1 runs them one after another")
    # Everything from COMMAND's first word on is COMMAND's, even what looks like an option.
    ap.add_argument("command", nargs=argparse.REMAINDER)
    args = ap.parse_args()
    if not args.command:
        ap.error("COMMAND is needed")
    command = args.command[0].split() if len(args.command) == 1 else args.command
    with open(os.path.join(HERE, "manifest.json")) as f:
        manifest = json.load(f)
    version = subprocess.run([args.resvg, "--version"], capture_output=True, text=True).stdout.strip()
    if version != manifest["resvg"]:
        sys.exit(f"resvg {manifest['resvg']} is required, because rasterizers differ; found {version!r}")
    tolerance = manifest["tolerance"]
    checks = [
        ("render", "renders", lambda failures: check_renders(command, manifest, args.resvg, tolerance, args.filter, failures)),
        ("model", "models", lambda failures: check_models(command, manifest, args.filter, failures)),
        ("invalid", "invalid documents", lambda failures: check_invalid(command, args.filter, failures)),
        ("accepted", "accepted documents", lambda failures: check_accepted(command, args.filter, failures)),
        ("sanitize", "sanitizer outputs", lambda failures: check_sanitize(command, args.filter, failures)),
        ("distinct", "distinct pairs", lambda failures: check_distinct(command, args.filter, failures)),
        ("options", "option checks", lambda failures: check_options(command, manifest, args.resvg, tolerance, args.filter, failures)),
        ("tags", "tagged renders", lambda failures: check_tags(command, manifest, args.resvg, args.filter, failures)),
        ("locate", "located documents", lambda failures: check_locate(command, args.filter, failures)),
        ("share", "share checks", lambda failures: check_share(command, args.filter, failures)),
    ]
    only = args.only.split(",")
    checks = [(name, check) for key, name, check in checks if key in only]

    def run(check):
        failures = []
        return check(failures), failures

    if args.jobs > 1:
        # Every kind of check shares the one pool of jobs, so that none waits for another to finish,
        # and each keeps its own failures, which are reported in the usual order.
        POOL = concurrent.futures.ThreadPoolExecutor(args.jobs)
        PROCESSES = concurrent.futures.ProcessPoolExecutor(args.jobs, mp_context=multiprocessing.get_context("spawn"))
        try:
            with concurrent.futures.ThreadPoolExecutor(len(checks) or 1) as kinds:
                try:
                    results = list(kinds.map(run, [check for _, check in checks]))
                except KeyboardInterrupt:
                    for pool in (POOL, PROCESSES):
                        pool.shutdown(wait=False, cancel_futures=True)
                    raise
        finally:
            for pool in (POOL, PROCESSES):
                pool.shutdown()
    else:
        results = [run(check) for _, check in checks]
    failures = []
    totals = {}
    for (name, _), (count, found) in zip(checks, results):
        totals[name] = count
        failures.extend(found)
    for failure in failures:
        print("FAIL", failure)
    print(", ".join(f"{v} {k}" for k, v in totals.items()) + f": {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
