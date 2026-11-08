#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""Checks that rescaling a flag leaves the picture alone, as the conformance suite compares renders.

    rescale_corpus.py [--jobs N] DIRECTORY [RESVG]

It compares --jobs pictures at once, by default $VEXYL_JOBS or one for each CPU, and reports them in
the same order whatever that is.
"""

import argparse
import concurrent.futures
import functools
import glob
import json
import multiprocessing
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../conformance"))
import run  # noqa: E402

HEIGHT = 512


def compare(resvg, threshold, path, tmp, together):
    """How a rescaled render differs from its original, with PNGs of its own in tmp, drawing the two
    at once if together."""
    name = os.path.basename(path)
    original = os.path.join(os.path.dirname(path), name.split(".")[0] + ".svg")
    return run.drawn_difference(resvg, HEIGHT, threshold, (path, os.path.join(tmp, name + ".a.png")),
                                (original, os.path.join(tmp, name + ".b.png")), together)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-j", "--jobs", type=int, default=run.default_jobs())
    ap.add_argument("where")
    ap.add_argument("resvg", nargs="?", default="resvg")
    args = ap.parse_args()
    with open(os.path.join(run.HERE, "manifest.json"), encoding="utf-8") as f:
        tolerance = json.load(f)["tolerance"]
    bad = 0
    total = 0
    paths = sorted(glob.glob(os.path.join(args.where, "*.*.svg")))
    if not paths:
        sys.exit(f"no rescaled renders in {args.where}")
    with tempfile.TemporaryDirectory() as tmp:
        work = functools.partial(compare, args.resvg, tolerance["threshold"], tmp=tmp, together=args.jobs > 1)
        if args.jobs > 1:
            with concurrent.futures.ProcessPoolExecutor(args.jobs, mp_context=multiprocessing.get_context("spawn")) as pool:
                results = list(pool.map(work, paths))
        else:
            results = [work(path) for path in paths]
    for path, result in zip(paths, results):
        total += 1
        if not run.within(result, tolerance, HEIGHT):
            bad += 1
            print(f"{os.path.basename(path)}: {'size differs' if result is None else result}")
    print(f"{total} rescaled renders, {bad} different")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
