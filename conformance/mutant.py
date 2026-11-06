#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""A library with one thing wrong, for showing that the suite notices.

    mutant.py NAME COMMAND...

It runs COMMAND with the arguments the suite gives it, and damages the result as NAME says.
"""
import base64
import json
import os
import re
import subprocess
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = re.compile(r' data-vexyl-layer="[^"]*"')


def run(command, args):
    return subprocess.run(command + args, capture_output=True)


def finish(done):
    sys.stdout.buffer.write(done.stdout)
    sys.stderr.buffer.write(done.stderr)
    sys.exit(done.returncode)


def rewrite_output(args, change):
    """Applies a change to the SVG that a render wrote."""
    out = args[args.index("-o") + 1]
    with open(out, encoding="utf-8") as f:
        text = f.read()
    with open(out, "w", encoding="utf-8") as f:
        f.write(change(text))


def main():
    name, command, args = sys.argv[1], sys.argv[2].split(), sys.argv[3:]
    render = args[:1] == ["render"]
    tagged = "-tags" in args
    if name == "tags-always-on" and render and not tagged:
        args = args[:1] + ["-tags"] + args[1:]
    done = run(command, args)
    if name == "share-no-write-limit" and args[:2] == ["share", "encode"] and os.path.getsize(args[2]) > 8 * 1024 * 1024:
        finish(subprocess.CompletedProcess(args, 0, b"v1.AAAA\n", b""))
    if done.returncode:
        finish(done)
    if render and tagged:
        if name == "tags-dropped":
            rewrite_output(args, lambda t: TAG.sub("", t))
        elif name == "tags-some-dropped":
            rewrite_output(args, lambda t: TAG.sub("", t, count=1))
        elif name == "tags-all-the-same":
            rewrite_output(args, lambda t: TAG.sub(' data-vexyl-layer="0"', t))
        elif name == "tags-off-by-one":
            rewrite_output(args, lambda t: re.sub(r'data-vexyl-layer="(\d+)"', lambda m: f'data-vexyl-layer="{int(m[1]) + 1}"', t))
        elif name == "tags-not-a-path":
            rewrite_output(args, lambda t: TAG.sub(' data-vexyl-layer="the bars"', t))
        elif name == "tags-change-pixels":
            rewrite_output(args, lambda t: re.sub(r'#([0-9a-f]{4})[0-9a-f]{2}"', r'#\g<1>00"', t, count=1) if "#" in t else t)
        elif name == "tags-in-a-clip":
            rewrite_output(args, lambda t: t.replace('<clipPath ', '<clipPath data-vexyl-layer="0" ', 1).replace("<polygon ", '<polygon onclick="x" ', 1))
        elif name == "tags-swap-repeat":
            rewrite_output(args, lambda t: re.sub(r'data-vexyl-layer="1\.1"', 'data-vexyl-layer="1.0"', t))
    if args[:1] == ["locate"]:
        data = json.loads(done.stdout)
        if isinstance(data, list):
            if name == "locate-off-by-one":
                for s in data:
                    s["line"] += 1
            elif name == "locate-end-is-start":
                for s in data:
                    s["endLine"] = s["line"]
            elif name == "locate-misses-nested":
                data = [s for s in data if "." not in s["path"]]
            elif name == "locate-counts-all-children":
                for s in data:
                    if s["path"] == "1.1":
                        s["path"] = "1.5"
        elif data is not None and name == "layer-at-outermost":
            spans = json.loads(run(command, ["locate", args[-1]]).stdout)
            line = int(args[2])
            data = next(s for s in spans if s["line"] <= line <= s["endLine"])
        done = subprocess.CompletedProcess(args, 0, (json.dumps(data) + "\n").encode(), b"")
    if args[:2] == ["share", "encode"]:
        with open(args[2], "rb") as f:
            source = f.read()
        if name == "share-no-dictionary":
            c = zlib.compressobj(9, zlib.DEFLATED, -15)
            done.stdout = b"v1." + base64.urlsafe_b64encode(c.compress(source) + c.flush()).rstrip(b"=") + b"\n"
        elif name == "share-padding":
            body = done.stdout.strip() + b"=="
            done.stdout = body + b"\n"
        elif name == "share-wrong-version":
            done.stdout = b"v9" + done.stdout[2:]
        elif name == "share-normalizes-lines":
            c = zlib.compressobj(9, zlib.DEFLATED, -15, 9, zlib.Z_DEFAULT_STRATEGY, open(os.path.join(ROOT, "share/v1.dict"), "rb").read())
            done.stdout = b"v1." + base64.urlsafe_b64encode(c.compress(source.replace(b"\r\n", b"\n")) + c.flush()).rstrip(b"=") + b"\n"
    if args[:2] == ["share", "decode"] and name in ("share-no-dictionary-read", "share-accepts-anything"):
        done = subprocess.CompletedProcess(args, 0, b"", b"") if name == "share-accepts-anything" else subprocess.CompletedProcess(args, 1, b"", b"no")
    finish(done)


if __name__ == "__main__":
    main()
