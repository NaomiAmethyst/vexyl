#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""Checks that rescaling a flag leaves the picture alone, as the conformance suite compares renders.

    rescale_corpus.py DIRECTORY [RESVG]
"""

import glob
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../conformance"))
import run  # noqa: E402


def main():
    where = sys.argv[1]
    resvg = sys.argv[2] if len(sys.argv) > 2 else "resvg"
    with open(os.path.join(run.HERE, "manifest.json"), encoding="utf-8") as f:
        tolerance = json.load(f)["tolerance"]
    bad = 0
    total = 0
    with tempfile.TemporaryDirectory() as tmp:
        for path in sorted(glob.glob(os.path.join(where, "*.*.svg"))):
            name = os.path.basename(path)
            original = os.path.join(where, name.split(".")[0] + ".svg")
            height = 512
            result = run.difference(run.rasterize(resvg, path, height, os.path.join(tmp, "a.png")),
                                    run.rasterize(resvg, original, height, os.path.join(tmp, "b.png")), tolerance["threshold"])
            total += 1
            if not run.within(result, tolerance, height):
                bad += 1
                print(f"{name}: {'size differs' if result is None else result}")
    print(f"{total} rescaled renders, {bad} different")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
