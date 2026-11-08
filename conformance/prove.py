#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""Shows that the suite's checks of tags, locations, share links, a charge's cuts, an arc's direction,
a turned variant's reverse, a rotated layer at another proportion and a panel's shaped edge can fail.

    prove.py [--jobs N] COMMAND...

Each mutant is a working library with one thing wrong, and the suite has to fail for it, with
the check that should see it, on the cases that it names, if any. It also shows that the same
library with nothing wrong passes those checks. For the links that a library has to refuse, it
strips the refusal from a decoder and sees that noticed.

Several runs of the suite go at once, sharing --jobs between them, by default $VEXYL_JOBS or one for
each CPU, as run.py does. Each is reported in the same order as with --jobs 1.
"""
import argparse
import base64
import concurrent.futures
import json
import os
import subprocess
import sys
import tempfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run  # noqa: E402

MUTANTS = [
    ("tags-always-on", "tags"),
    ("tags-dropped", "tags"),
    ("tags-some-dropped", "tags"),
    ("tags-all-the-same", "tags"),
    ("tags-off-by-one", "tags"),
    ("tags-not-a-path", "tags"),
    ("tags-change-pixels", "tags"),
    ("tags-in-a-clip", "tags"),
    ("tags-swap-repeat", "tags"),
    ("locate-off-by-one", "locate"),
    ("locate-end-is-start", "locate"),
    ("locate-misses-nested", "locate"),
    ("locate-counts-all-children", "locate"),
    ("layer-at-outermost", "locate"),
    ("share-no-dictionary", "share"),
    ("share-padding", "share"),
    ("share-wrong-version", "share"),
    ("share-normalizes-lines", "share"),
    ("share-no-write-limit", "share"),
    ("share-accepts-anything", "share"),
    ("share-no-dictionary-read", "share"),
    ("cuts-once", "render", "repeated-cuts"),
    ("arc-counterclockwise", "render", "vocabulary"),
    ("reverse-turned-first", "render", "turned-reverse"),
    ("rotated-adapted-unrotated", "render", "rotated-adapt"),
    ("panel-edge-slants", "render", "shaped-edges"),
]


def suite(command, only, filter_text=None, jobs=1, env=None):
    args = [sys.executable, os.path.join(HERE, "run.py"), "--only", only, "--jobs", str(jobs)]
    if filter_text:
        args += ["--filter", filter_text]
    done = subprocess.run(args + command, capture_output=True, text=True, env=env)
    return done.returncode, done.stdout


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-j", "--jobs", type=int, default=run.default_jobs(),
                    help="how many cases to run at once in all, by default $VEXYL_JOBS or one for each CPU")
    ap.add_argument("command", nargs=argparse.REMAINDER)
    args = ap.parse_args()
    if not args.command:
        ap.error("COMMAND is needed")
    command = args.command
    joined = " ".join(command)
    runs = [(command, "tags,locate,share")]
    runs += [(command, only, filter_text) for only, filter_text in sorted({m[1:] for m in MUTANTS if len(m) > 2})]
    runs += [([sys.executable, os.path.join(HERE, "mutant.py"), name, joined], only, *filter_text) for name, only, *filter_text in MUTANTS]
    # A run of the suite has parts that can't go at once, so runs share the jobs two by two, which
    # keeps more of them busy than one run having them all, or each having one.
    at_once = max(1, min(len(runs), (args.jobs + 1) // 2))
    jobs = max(1, args.jobs // at_once)
    # The patched mutants are built in here, which goes when this does.
    with tempfile.TemporaryDirectory(prefix="vexyl-prove-") as built, concurrent.futures.ThreadPoolExecutor(at_once) as pool:
        env = {**os.environ, "VEXYL_MUTANT_DIR": built}
        results = pool.map(lambda r: suite(*r, jobs=jobs, env=env), runs)
        failed = 0
        code, output = next(results)
        print(f"unchanged library: {'passes' if code == 0 else 'FAILS'}: {output.strip().splitlines()[-1]}", flush=True)
        failed += code != 0
        for only, filter_text in sorted({m[1:] for m in MUTANTS if len(m) > 2}):
            code, output = next(results)
            print(f"unchanged library, {only} of {filter_text}: {'passes' if code == 0 else 'FAILS'}: {output.strip().splitlines()[-1]}", flush=True)
            failed += code != 0
        for name, only, *filter_text in MUTANTS:
            code, output = next(results)
            lines = [l for l in output.splitlines() if l.startswith("FAIL")]
            print(f"{name}: {'caught, ' + str(len(lines)) + ' failures, such as ' + lines[0][:130] if code and lines else 'NOT CAUGHT'}", flush=True)
            failed += not (code and lines)
    print(f"{len(MUTANTS)} mutants, {failed} problems")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
