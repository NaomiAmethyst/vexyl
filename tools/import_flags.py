#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""Imports downloaded flags and checks each result against its source.

    import_flags.py INDEX SVGS OUT VEXYL [EXPORT [REVIEWED]]

INDEX is a JSON index from fetch_flags.py, whose entries are keyed family/name, and SVGS
holds family/name.svg files. Each flag is converted by svg2vexyl.py and validated and rendered
by VEXYL, then its source and result are rasterized with resvg and compared. If EXPORT
is given, flags that match, have a known license and aren't excluded are written there, along
with a report. HAND is a vexyl-flags checkout, whose flags/ holds hand-written flags and whose
map.tsv says which import each replaces, so that those imports are left out. Treat the downloaded files as untrusted.
"""
import collections
import concurrent.futures
import html
import json
import os
import re
import subprocess
import sys
import threading
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import svg2vexyl as S

Image.MAX_IMAGE_PIXELS = None
WIDTH = 480
LICENSES = {"cc0": "CC0-1.0", "cc by-sa 4.0": "CC-BY-SA-4.0", "cc by-sa 3.0": "CC-BY-SA-3.0", "cc by-sa 2.5": "CC-BY-SA-2.5",
            "cc by-sa 2.0": "CC-BY-SA-2.0", "cc by 4.0": "CC-BY-4.0", "cc by 3.0": "CC-BY-3.0", "cc by 2.5": "CC-BY-2.5",
            "cc by 2.0": "CC-BY-2.0"}
# Flags left out of the published set, whatever their license says. The first group are symbols
# of organized hatred, some of them illegal to display in some countries: Nazi and neo-Nazi
# organizations, and Germany's state flags from 1933 to 1945, which carried the swastika. Names
# can't catch them all, so those found by looking are listed too. The rest aren't flags, or
# have their own terms.
EXCLUDE = re.compile(r"hitler|nazi|nsdap|swastika|schutzstaffel|sturmabteilung|ku-klux|wehrmacht|kriegsmarine|luftwaffe|"
                     r"deutsches-jungvolk|generation-identitaire|all-germanic|generalgouvernement|"
                     r"deutsche-christen|deutsche-heidnische|socialist-reich-party|national-socialists|black-front|"
                     r"national-democratic-party|new-templars|odal-rune|reichskolonialbund|nskk|ordnungspolizei|"
                     r"wassersportflagge|flagge-drv|die-rechte|the-right-germany|free-german-workers-party|iii-path|"
                     r"(?<!\d-)(193[3-9]|194[0-4])(-\d|$)|"
                     r"national-front-spain|nsjap|t-h-kai|confederate-states|"
                     r"state-of-georgia-(1956-2001|2001-2003)|mississippi-1996-2020|state-of-mississippi-1894-1906|"
                     r"/no-flag|/copyrighted-flag|nuvola-|quasar")
# Only these years in a German flag's name start the period in question, and these are safe.
PERIOD = re.compile(r"^(?!germany/|europe/[^/]*german|europe/[^/]*reich)")
KEEP = re.compile(r"resistance|soviet")


def excluded(key):
    if KEEP.search(key):
        return False
    match = EXCLUDE.search(key)
    if not match:
        return False
    # A bare year only counts for German flags.
    if re.fullmatch(r"(193[3-9]|194[0-4])(-\d)?", match.group(0)):
        return not PERIOD.match(key)
    return True


# Who runs the importer, and so makes the files. The drawings' authors are credited as such.
ENCODER = "Naomi Persephone Amethyst"


def license_id(short):
    text = (short or "").strip().lower()
    if text in LICENSES:
        return LICENSES[text]
    if text.startswith("public domain") or text.startswith("pd"):
        return "LicenseRef-Public-Domain"
    if text.startswith("copyrighted free use"):
        return "LicenseRef-Copyrighted-Free-Use"
    return None


def credit(artist):
    text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", artist or ""))).strip()[:120]
    # Commons' placeholders aren't anyone's name.
    return None if re.search(r"file history|unknown author", text, re.I) else (text or None)


def rasterize(path, png):
    done = subprocess.run(["resvg", "--width", str(WIDTH), path, png], capture_output=True, text=True, timeout=120)
    if done.returncode:
        return None
    image = Image.open(png).convert("RGBA")
    backdrop = Image.new("RGBA", image.size, (0, 255, 0, 255))
    backdrop.alpha_composite(image)
    return np.asarray(backdrop.convert("RGB")).astype(int)


def one(job):
    key, entry, svgs, out, vexyl = job
    meta = entry.get("meta") or {}
    title = re.sub(r"^File:|\.svg$", "", entry["title"])
    result = dict(key=key, status=None, reason=None, native=0, inline=0, reasons=[], license=license_id(meta.get("LicenseShortName")))
    source = f"{svgs}/{key}.svg"
    try:
        text, stats = S.convert(open(source, "rb").read(), title, entry.get("page"), ENCODER, result["license"], author=credit(meta.get("Artist")))
    except S.Unsupported as e:
        return dict(result, status="unsupported", reason=str(e))
    except ET.ParseError:
        return dict(result, status="unsupported", reason="malformed XML")
    except Exception as e:
        return dict(result, status="crash", reason=f"{type(e).__name__}: {e}"[:70])
    result.update(reasons=stats["reasons"], native=stats["native"], inline=stats["inline"], size=len(text))
    kdl, svg = f"{out}/kdl/{key}.kdl", f"{out}/svg/{key}.svg"
    os.makedirs(os.path.dirname(kdl), exist_ok=True)
    os.makedirs(os.path.dirname(svg), exist_ok=True)
    # Restated simply, a flag has to look the same, or it keeps its exact values.
    tidied = S.tidy(text)
    checked = compare(tidied, source, key, kdl, svg, out, vexyl)
    exact = compare(text, source, key, kdl, svg, out, vexyl) if tidied != text and worse(checked) else None
    if exact is None:
        return dict(result, tidied=tidied != text, **checked)
    return dict(result, tidied=False, **exact)


def worse(checked):
    return checked["status"] not in ("match", "close") or checked.get("thick", 0) >= 0.05


def compare(text, source, key, kdl, svg, out, vexyl):
    open(kdl, "w").write(text)
    done = subprocess.run([vexyl, "render", "-o", svg, kdl], capture_output=True, text=True)
    if done.returncode:
        message = re.sub(r"^\S+:\d+:\d+:\s*", "", done.stderr.strip().split("\n")[0])
        return dict(status="rejected", reason=message[:90])
    png = f"{out}/png-{os.getpid()}-{threading.get_ident()}-{key.replace('/', '-')}"
    try:
        a, b = rasterize(source, png + "-a.png"), rasterize(svg, png + "-b.png")
    finally:
        for suffix in ("-a.png", "-b.png"):
            if os.path.exists(png + suffix):
                os.remove(png + suffix)
    if a is None or b is None:
        return dict(status="unrenderable source" if a is None else "rejected", reason="resvg failed")
    h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    if max(abs(a.shape[0]-b.shape[0]), abs(a.shape[1]-b.shape[1])) > 2:
        return dict(status="mismatch", reason=f"sizes {a.shape[:2]} and {b.shape[:2]}", thick=100.0, diff=100.0)
    d = np.abs(a[:h, :w]-b[:h, :w]).sum(2) > 48
    e = d[1:-1, 1:-1] & d[:-2, 1:-1] & d[2:, 1:-1] & d[1:-1, :-2] & d[1:-1, 2:]
    thick = float(e.mean()*100)
    return dict(status="match" if thick < 0.05 else "close" if thick < 0.5 else "mismatch",
                thick=round(thick, 3), diff=round(float(d.mean()*100), 3))


def vocabulary(text):
    """Sorts a flag by what it needs: names alone, or also points, paths or artwork."""
    if "charge svg" in text:
        return "artwork"
    if "charge path" in text:
        return "path"
    if "charge polygon" in text or "polygon {" in text:
        return "polygon"
    return "named"


def overlay(hand, export, rows, vexyl):
    """Leaves out the imports that hand-written flags replace, checking that each of those is valid."""
    by_key = {row.split("\t")[0]: row for row in rows[1:]}
    for line in open(f"{hand}/map.tsv"):
        name, family, replaces = (line.rstrip("\n").split("\t") + [""])[:3]
        if name == "name":
            continue
        subprocess.run([vexyl, "check", f"{hand}/flags/{family}/{name}.kdl"], check=True, capture_output=True)
        for old in replaces.split(",") + [f"{family}/{name}"]:
            if old:
                by_key.pop(old, None)
                path = f"{export}/{old}.kdl"
                if os.path.exists(path):
                    os.remove(path)
    return rows[:1] + [by_key[k] for k in sorted(by_key)]


def main():
    index_path, svgs, out, vexyl = sys.argv[1:5]
    export = sys.argv[5] if len(sys.argv) > 5 else None
    index = json.load(open(index_path))
    jobs = [(k, e, svgs, out, vexyl) for k, e in sorted(index.items()) if os.path.exists(f"{svgs}/{k}.svg")]
    print(len(jobs), "flags to import", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=os.cpu_count()) as pool:
        results = list(pool.map(one, jobs))
    json.dump(results, open(out + "/results.json", "w"), indent=1)
    families = collections.defaultdict(collections.Counter)
    for r in results:
        family = r["key"].split("/")[0]
        families[family][r["status"]] += 1
        if r["status"] in ("match", "close"):
            r["vocabulary"] = vocabulary(open(f"{out}/kdl/{r['key']}.kdl").read())
            families[family]["voc:" + r["vocabulary"]] += 1
    for family, counts in sorted(families.items()):
        print(f"{family:14}", dict(sorted(counts.items())))
    total = collections.Counter(r.get("vocabulary") for r in results if r.get("vocabulary"))
    print("all:", dict(total), "of", len(results))
    print("failures:", collections.Counter(r["reason"] for r in results if r["status"] not in ("match", "close") and r["reason"]).most_common(14))
    print("mismatches:", [(r["key"], r.get("thick")) for r in sorted(results, key=lambda r: -(r.get("thick") or 0)) if r["status"] == "mismatch"][:40])
    print("inline reasons:", collections.Counter(x for r in results if r["status"] in ("match", "close") for x in set(r["reasons"])).most_common(12))
    if export:
        rows = ["flag\tvocabulary\tnative shapes\tinline artwork\tdifference %\tlicense"]
        left_out = collections.Counter()
        names = []
        for r in sorted(results, key=lambda r: r["key"]):
            why = None
            if excluded(r["key"]):
                why = "excluded"
            elif r["status"] not in ("match", "close"):
                why = "failed"
            elif r["license"] is None:
                why = "unknown license"
            path = f"{export}/{r['key']}.kdl"
            if why:
                left_out[why] += 1
                names.append((why, r["key"]))
                # An earlier run might have exported it.
                if os.path.exists(path):
                    os.remove(path)
                continue
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(f"{out}/kdl/{r['key']}.kdl") as f, open(path, "w") as g:
                g.write(f.read())
            rows.append(f"{r['key']}\t{r['vocabulary']}\t{r['native']}\t{r['inline']}\t{r['diff']}\t{r['license']}")
        hand = sys.argv[6] if len(sys.argv) > 6 else None
        if hand:
            rows = overlay(hand, export, rows, vexyl)
        with open(f"{export}/report.tsv", "w") as f:
            f.write("\n".join(rows) + "\n")
        with open(f"{export}/left-out.tsv", "w") as f:
            f.write("flag\twhy\n" + "".join(f"{key}\t{why}\n" for why, key in names))
        counts = collections.Counter(row.split("\t")[1] for row in rows[1:])
        print("exported", len(rows)-1, "left out", dict(left_out), "vocabulary", dict(counts))


if __name__ == "__main__":
    main()
