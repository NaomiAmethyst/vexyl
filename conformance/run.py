#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""Runs Vexyl's conformance suite against an implementation.

    run.py [--only render,model,invalid] [--filter TEXT] COMMAND...

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
import shlex
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))


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


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", default="render,model,invalid")
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
    for failure in failures:
        print("FAIL", failure)
    print(", ".join(f"{v} {k}" for k, v in totals.items()) + f": {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
