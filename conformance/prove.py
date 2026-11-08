#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""Shows that the suite's checks of tags, locations, share links, a charge's cuts, an arc's direction,
a turned variant's reverse, a rotated layer at another proportion and a panel's shaped edge can fail.

    prove.py COMMAND...

Each mutant is a working library with one thing wrong, and the suite has to fail for it, with
the check that should see it, on the cases that it names, if any. It also shows that the same
library with nothing wrong passes those checks. For the links that a library has to refuse, it
strips the refusal from a decoder and sees that noticed.
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

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


def suite(command, only, filter_text=None):
    args = [sys.executable, os.path.join(HERE, "run.py"), "--only", only]
    if filter_text:
        args += ["--filter", filter_text]
    done = subprocess.run(args + command, capture_output=True, text=True)
    return done.returncode, done.stdout


def main():
    command = sys.argv[1:]
    joined = " ".join(command)
    failed = 0
    code, output = suite(command, "tags,locate,share")
    print(f"unchanged library: {'passes' if code == 0 else 'FAILS'}: {output.strip().splitlines()[-1]}")
    failed += code != 0
    for only, filter_text in sorted({m[1:] for m in MUTANTS if len(m) > 2}):
        code, output = suite(command, only, filter_text)
        print(f"unchanged library, {only} of {filter_text}: {'passes' if code == 0 else 'FAILS'}: {output.strip().splitlines()[-1]}")
        failed += code != 0
    for name, only, *filter_text in MUTANTS:
        mutant = [sys.executable, os.path.join(HERE, "mutant.py"), name, joined]
        code, output = suite(mutant, only, *filter_text)
        lines = [l for l in output.splitlines() if l.startswith("FAIL")]
        print(f"{name}: {'caught, ' + str(len(lines)) + ' failures, such as ' + lines[0][:130] if code and lines else 'NOT CAUGHT'}")
        failed += not (code and lines)
    print(f"{len(MUTANTS)} mutants, {failed} problems")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
