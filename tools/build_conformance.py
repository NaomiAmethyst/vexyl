#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""Builds the conformance suite's expected results using the reference implementation.

    build_conformance.py VEXYL RESVG

Run `go test . -update` in go/ first, which writes the invalid documents. A change to these
results is a change in what every implementation has to do, so review the diff.
"""
import glob
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
        for variant in sorted(model.get("variants", {})):
            wanted.append((f"variant-{variant}", {"variant": variant}))
            wanted.append((f"variant-{variant}-reverse", {"variant": variant, "side": "reverse"}))
        for fold in sorted(model.get("folds", {})):
            wanted.append((f"fold-{fold}", {"fold": fold}))
            wanted.append((f"fold-{fold}-step-1", {"fold": fold, "fold_step": 1}))
            for variant, form in sorted(model.get("variants", {}).items()):
                if form.get("from", "none") == "none":
                    wanted.append((f"variant-{variant}-fold-{fold}", {"variant": variant, "fold": fold}))
        # Other proportions: the same request is drawn or refused, depending on the flag's rules.
        wanted += [("ratio-1-1", {"ratio": "1:1"}), ("ratio-1-2", {"ratio": "1:2"}), ("pad-center", {"ratio": "1:1", "fit": "pad"})]
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
        json.dump({"resvg": version, "tolerance": TOLERANCE, "cases": cases}, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
