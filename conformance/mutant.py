#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""A library with one thing wrong, for showing that the suite notices.

    mutant.py NAME COMMAND...

It runs COMMAND with the arguments the suite gives it, and damages the result as NAME says. A few
mistakes are deep in a library's geometry, where no change to its input or output can stand in for
them, so those mutants are the reference library itself, patched, and run in place of COMMAND.
"""
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = re.compile(r' data-vexyl-layer="[^"]*"')
# A cut that a charge's copy has moved. A path's cut has a transform of its own, so this is only
# for fixtures that have none.
MOVED_CUT = re.compile(r'\s*<(?:circle|polygon|path) [^>]*fill="#000" transform="translate\([^"]*"/>')
ARC = re.compile(r'(repeat arc [^\n;]*?)from=(\S+) to=(\S+)')
SIDEWAYS = {"transpose", "anti-transpose", "rotate", "counter-rotate"}

# Each patch is a file in go/, and text in it replaced so that the reference gets one thing wrong.
PATCHES = {
    # Adapts a rotated bars or band as if it weren't rotated, so its widths change and it drifts.
    "rotated-adapted-unrotated": ("adapt.go", "if t.Rotate != 0 {", "if false {"),
    # Slants a panel's edge from its last point to the panel's corner, rather than running on flat.
    "panel-edge-slants": ("shapes.go", "span-along[last] > 1e-9*span", "false"),
}


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


def arc_counterclockwise(match):
    """Writes an arc so that it's drawn as one running straight from its start to its end would be,
    which goes counterclockwise when the end is the smaller angle."""
    start, end = float(match[2]), float(match[3])
    if end < start:
        return f"{match[1]}from={match[3]} to={match[2]}"
    return match[0]


def turned_back_first(text):
    """Turns a render half way round, which is the back turned as the front is, not the mirror
    image of the turned front."""
    box = [float(v) for v in re.search(r'viewBox="([^"]*)"', text)[1].split()]
    cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
    head, rest = text.split(">", 1)
    body, tail = rest.rsplit("</svg>", 1)
    # The title and description stay at the root, where they're allowed.
    named = re.match(r"(\s*<title>.*?</title>)?(\s*<desc>.*?</desc>)?", body, re.S)[0]
    body = body[len(named):]
    return f'{head}>{named}<g transform="rotate(180 {cx} {cy})">{body}</g></svg>{tail}'


def patched(name):
    """Builds the reference with a patch, once for each state of its source, and gives the command."""
    file, old, new = PATCHES[name]
    source = os.path.join(ROOT, "go")
    digest = hashlib.sha256()
    for directory, _, names in sorted(os.walk(source)):
        for each in sorted(names):
            if each.endswith((".go", ".mod", ".sum", ".dict")):
                with open(os.path.join(directory, each), "rb") as f:
                    digest.update(each.encode() + b"\0" + f.read())
    binary = os.path.join(tempfile.gettempdir(), f"vexyl-mutant-{name}-{digest.hexdigest()[:16]}")
    if not os.path.exists(binary):
        with tempfile.TemporaryDirectory() as scratch:
            tree = os.path.join(scratch, "go")
            shutil.copytree(source, tree, ignore=shutil.ignore_patterns("testdata"))
            path = os.path.join(tree, file)
            with open(path, encoding="utf-8") as f:
                text = f.read()
            if old not in text:
                sys.exit(f"mutant {name}: {file} no longer has {old!r}")
            with open(path, "w", encoding="utf-8") as f:
                f.write(text.replace(old, new))
            subprocess.run(["go", "build", "-buildvcs=false", "-trimpath", "-o", binary + ".tmp", "./cmd/vexyl"], cwd=tree, check=True)
            os.replace(binary + ".tmp", binary)
    return [binary]


def main():
    name, command, args = sys.argv[1], sys.argv[2].split(), sys.argv[3:]
    if name in PATCHES:
        command = patched(name)
    render = args[:1] == ["render"]
    tagged = "-tags" in args
    if name == "tags-always-on" and render and not tagged:
        args = args[:1] + ["-tags"] + args[1:]
    scratch = None
    if name == "arc-counterclockwise" and render:
        with open(args[-1], encoding="utf-8") as f:
            source = ARC.sub(arc_counterclockwise, f.read())
        scratch = tempfile.TemporaryDirectory()
        args = args[:-1] + [os.path.join(scratch.name, os.path.basename(args[-1]))]
        with open(args[-1], "w", encoding="utf-8") as f:
            f.write(source)
    done = run(command, args)
    side = args[args.index("-side") + 1] if "-side" in args else "obverse"
    if name == "reverse-turned-first" and render and not done.returncode and "-variant" in args and side == "reverse":
        model = json.loads(run(command, ["model", args[-1]]).stdout)
        if model["variant"][args[args.index("-variant") + 1]].get("from") in SIDEWAYS:
            rewrite_output(args, turned_back_first)
    if name == "share-no-write-limit" and args[:2] == ["share", "encode"] and os.path.getsize(args[2]) > 8 * 1024 * 1024:
        finish(subprocess.CompletedProcess(args, 0, b"v1.AAAA\n", b""))
    if done.returncode:
        finish(done)
    if render and name == "cuts-once":
        # Cuts a charge's first copy only, as if its cuts applied once, where they're written.
        rewrite_output(args, lambda t: MOVED_CUT.sub("", t))
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
