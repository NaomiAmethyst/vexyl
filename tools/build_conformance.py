#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""Builds the conformance suite's expected results using the reference implementation.

    build_conformance.py VEXYL RESVG

Run `go test . -update` in go/ first, which writes the invalid documents. A change to these
results is a change in what every implementation has to do, so review the diff.
"""
import base64
import glob
import hashlib
import tempfile
import zlib
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "conformance")
# These were calibrated by disturbing the fixtures: all of them still pass with numbers rounded
# to 4 decimals, and colors 2 off, charges moved by 0.5% of the hoist and stars 3% too large fail.
# Goes up when what a library has to do to pass changes, for a given version of the format.
SUITE_VERSION = 1
FORMAT_VERSION = 1
SHARE_LIMIT = 8 * 1024 * 1024
TOLERANCE = {"heights": [16, 32, 128, 512], "threshold": 48, "solid_percent": 0.05, "mean_channel": 0.25,
             "worst_tile": 16, "worst_tile_height": 512}


def main():
    vexyl, resvg = sys.argv[1:3]
    shutil.rmtree(os.path.join(OUT, "valid"), ignore_errors=True)
    os.makedirs(os.path.join(OUT, "valid"))
    sources = sorted(glob.glob(f"{ROOT}/flags/*.kdl") + glob.glob(f"{ROOT}/go/testdata/*.kdl"))
    cases = []
    for number, source in enumerate(sources):
        name = os.path.basename(source)[:-4]
        file = f"valid/{name}.kdl"
        shutil.copy(source, os.path.join(OUT, file))
        model = json.loads(subprocess.run([vexyl, "model", source], check=True, capture_output=True, text=True).stdout)
        with open(f"{OUT}/valid/{name}.model.json", "w") as f:
            json.dump(model, f, indent=1, sort_keys=True, ensure_ascii=False)
            f.write("\n")
        wanted = [("default", {}), ("reverse", {"side": "reverse"})]
        for variant in sorted(model.get("variant", {})):
            wanted.append((f"variant-{variant}", {"variant": variant}))
            wanted.append((f"variant-{variant}-reverse", {"variant": variant, "side": "reverse"}))
        for fold in sorted(model.get("fold", {})):
            wanted.append((f"fold-{fold}", {"fold": fold}))
            wanted.append((f"fold-{fold}-step-1", {"fold": fold, "fold_step": 1}))
            for variant, form in sorted(model.get("variant", {}).items()):
                if form.get("from", "none") == "none":
                    wanted.append((f"variant-{variant}-fold-{fold}", {"variant": variant, "fold": fold}))
        # Other proportions: the same request is drawn or refused, depending on the flag's rules.
        wanted += [("ratio-1-1", {"ratio": "1:1"}), ("ratio-1-2", {"ratio": "1:2"}), ("pad-center", {"ratio": "1:1", "fit": "pad"})]
        if "reverse" in model and "adapt" in model:
            # A reverse of its own adapts with its hoist on the right, as it's seen from behind.
            wanted += [("reverse-ratio-1-2", {"side": "reverse", "ratio": "1:2"}), ("reverse-ratio-1-1", {"side": "reverse", "ratio": "1:1"})]
        if number % 5 == 0:
            wanted += [("pad-start", {"ratio": "1:1", "fit": "pad", "align": "start"}), ("pad-end", {"ratio": "1:1", "fit": "pad", "align": "end"})]
        renders = []
        os.makedirs(f"{OUT}/valid/{name}", exist_ok=True)
        for label, options in wanted:
            svg = f"valid/{name}/{label}.svg"
            args = []
            for key, flag in (("ratio", "-ratio"), ("variant", "-variant"), ("side", "-side"), ("fit", "-fit"),
                              ("align", "-align"), ("fold", "-fold"), ("fold_step", "-fold-step")):
                if key in options:
                    args += [flag, str(options[key])]
            done = subprocess.run([vexyl, "render"] + args + ["-o", os.path.join(OUT, svg), source], capture_output=True, text=True)
            entry = {"name": label, "options": options}
            if done.returncode:
                entry["refused"] = True
            else:
                entry["svg"] = svg
            renders.append(entry)
        cases.append({"name": name, "file": file, "model": f"valid/{name}.model.json", "renders": renders})
    version = subprocess.run([resvg, "--version"], check=True, capture_output=True, text=True).stdout.strip()
    with open(f"{OUT}/manifest.json", "w") as f:
        json.dump({"version": SUITE_VERSION, "format": FORMAT_VERSION, "resvg": version, "tolerance": TOLERANCE, "cases": cases}, f, indent=1)
        f.write("\n")
    build_tags(vexyl, resvg)
    build_locate(vexyl)
    build_share(vexyl)


TAGGED_FORMS = [("default", []), ("reverse", ["-side", "reverse"]), ("vertical", ["-variant", "vertical"]),
                ("own-grid", ["-variant", "a/b%c"]), ("fold", ["-fold", "half"]), ("pad", ["-ratio", "1:1", "-fit", "pad"])]


def build_tags(vexyl, resvg):
    """Records what each layer of a tagged render draws, as the box it fills at the suite's height,
    so that a library marking the wrong element with a path is found out."""
    sys.path.insert(0, OUT)
    import run
    document = os.path.join(OUT, "tags/everything.kdl")
    forms = []
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "out.svg")
        for label, args in TAGGED_FORMS:
            subprocess.run([vexyl, "render", "-tags"] + args + ["-o", out, document], check=True)
            with open(out, encoding="utf-8") as f:
                text = f.read()
            forms.append({"name": label, "args": args, "file": "tags/everything.kdl", "boxes": run.boxes_of_tags(resvg, text, tmp)})
    with open(os.path.join(OUT, "tags.json"), "w") as f:
        json.dump(forms, f, indent=1)
        f.write("\n")


def build_locate(vexyl):
    """Records where each part of some documents is, including one with CRLF line endings and one
    that isn't otherwise valid, since an editor has to find its way around that as well."""
    files = ["tags/everything.kdl", "valid/line-endings.kdl", "valid/inline-svg.kdl", "valid/united-states.kdl", "valid/south-korea.kdl",
             "invalid/unknown-child.kdl", "invalid/out-of-order.kdl"]
    cases = []
    for file in files:
        spans = json.loads(subprocess.run([vexyl, "locate", os.path.join(OUT, file)], check=True, capture_output=True, text=True).stdout)
        cases.append({"file": file, "spans": {s["path"]: [s["line"], s["endLine"]] for s in spans}})
    with open(os.path.join(OUT, "locate.json"), "w") as f:
        json.dump(cases, f, indent=1)
        f.write("\n")


def raw_deflate(data, dictionary=None, level=9, strategy=zlib.Z_DEFAULT_STRATEGY):
    c = zlib.compressobj(level, zlib.DEFLATED, -15, 9, strategy, dictionary) if dictionary else zlib.compressobj(level, zlib.DEFLATED, -15, 9, strategy)
    return c.compress(data) + c.flush()


def link_of(data):
    return "v1." + base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def build_share(vexyl):
    """Writes links that a library has to read and links it has to refuse. Each is made here, with
    zlib, rather than by a library under test."""
    with open(os.path.join(ROOT, "share/v1.dict"), "rb") as f:
        dictionary = f.read()
    folder = os.path.join(OUT, "share")
    shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(folder)

    def write(name, link):
        with open(os.path.join(folder, name + ".link"), "w") as f:
            f.write(link)
        return f"share/{name}.link"

    document = open(os.path.join(OUT, "valid/united-states.kdl"), "rb").read()
    packed = raw_deflate(document, dictionary)
    at_limit = b"a" * SHARE_LIMIT
    accepted = []

    def accept(name, data, stream, size_hint=None):
        accepted.append({"name": name, "link": write(name, link_of(stream)), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})

    accept("a flag", document, packed)
    accept("the dictionary itself, which needs every byte of it", dictionary, raw_deflate(dictionary, dictionary))
    accept("stored blocks", document, raw_deflate(document, dictionary, 0))
    accept("fixed codes", document, raw_deflate(document, dictionary, 9, zlib.Z_FIXED))
    accept("no use of the dictionary", b"vexyl", raw_deflate(b"vexyl"))
    accept("nothing at all", b"", raw_deflate(b""))
    accept("exactly at the limit", at_limit, raw_deflate(at_limit, dictionary))
    accept("line endings kept", b'vexyl 1\r\nmeta {\r\n}\r\n', raw_deflate(b'vexyl 1\r\nmeta {\r\n}\r\n', dictionary))
    accept("a byte order mark and other text kept", "\ufeffvexyl 1\n// \u00e9\U0001f3f3\n".encode(), raw_deflate("\ufeffvexyl 1\n// \u00e9\U0001f3f3\n".encode(), dictionary))

    good = link_of(packed)
    over = raw_deflate(b"a" * (SHARE_LIMIT + 1), dictionary)
    huge = raw_deflate(b"\0" * (SHARE_LIMIT * 16), dictionary)
    far = far_distance()
    refused = [
        ("no version", good[3:]),
        ("no dot", "v1" + good[3:]),
        ("a capital", "V1." + good[3:]),
        ("another version", "v2." + good[3:]),
        ("a leading zero in its version", "v01." + good[3:]),
        ("a hash in front", "#" + good),
        ("empty", "v1."),
        ("base64 padding", link_of(raw_deflate(b"vexyl")) + "="),
        ("the standard alphabet", "v1." + base64.b64encode(raw_deflate(bytes(range(256)) * 4)).rstrip(b"=").decode()),
        ("whitespace inside", good[:20] + "\n" + good[20:]),
        ("an impossible length", good[:3] + "A" * (4 * 3 + 1)),
        ("stray bits at its end", non_canonical(raw_deflate(b"vexyl 1\n", dictionary))),
        ("cut short", link_of(packed[:len(packed) // 2])),
        ("more after its end", link_of(packed + b"\0")),
        ("not UTF-8", link_of(raw_deflate(b"vexyl \xff\xfe", dictionary))),
        ("over the limit by a byte", link_of(over)),
        ("a compression bomb", link_of(huge)),
        ("a distance too far back", link_of(far)),
        ("a corrupt block type", link_of(b"\x07" + packed[1:])),
    ]
    cases = {"dictionary": "share/v1.dict", "sha256": hashlib.sha256(dictionary).hexdigest(), "limit": SHARE_LIMIT,
             "encode": ["valid/united-states.kdl", "valid/line-endings.kdl", "valid/inline-svg.kdl", "tags/everything.kdl"],
             "accepted": accepted,
             "refused": [{"name": name, "link": write(name, link)} for name, link in refused]}
    with open(os.path.join(OUT, "share.json"), "w") as f:
        json.dump(cases, f, indent=1)
        f.write("\n")


def far_distance():
    """A fixed-code block whose first thing is a match reaching 32,768 bytes back, past the
    dictionary and the start of the output."""
    bits = [1, 1, 0]  # final, fixed codes
    def code(value, length):  # Huffman codes go in from their top bit
        bits.extend((value >> i) & 1 for i in range(length - 1, -1, -1))
    def extra(value, length):  # and other numbers from their bottom bit
        bits.extend((value >> i) & 1 for i in range(length))
    code(1, 7)  # length code 257, which is a length of 3
    code(29, 5)  # the last distance code
    extra(8191, 13)
    code(0, 7)  # end of block
    bits.extend([0] * (-len(bits) % 8))
    return bytes(sum(bits[i + j] << j for j in range(8)) for i in range(0, len(bits), 8))


def non_canonical(stream):
    """A link whose last character has bits set beyond the last byte, which no encoder writes."""
    while len(stream) % 3 == 0:
        stream += b"\0"
    link = link_of(stream)
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    return link[:-1] + alphabet[alphabet.index(link[-1]) + 1]


if __name__ == "__main__":
    main()
