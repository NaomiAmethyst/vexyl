#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""Downloads flag SVGs from Wikimedia, with their license data.

    fetch_flags.py DIR

Files are written as DIR/svg/family/name.svg, along with DIR/index.json. It's slow on purpose,
because Wikimedia rate-limits downloads. Rerunning it picks up where it stopped. Treat the
files as untrusted data.
"""
import json
import os
import random
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "vexyl-flag-importer/0.1 (https://github.com/NaomiAmethyst/vexyl)"
PAGES = {
    "country": ["List of national flags of sovereign states"],
    "pride": ["Pride flag", "LGBTQ symbols"],
    "territories": ["Gallery of flags of dependent territories"],
    "us": ["Flags of the U.S. states and territories"],
    "germany": ["List of German flags", "Flags of the states of Germany"],
    "europe": ["List of flags of Europe", "Flags of Europe"],
    "japan": ["List of Japanese flags", "Flags of the prefectures of Japan"],
    "brazil": ["Flags of the states of Brazil", "List of Brazilian flags", "Flags of Brazil"],
    "mexico": ["List of Mexican flags", "Flags of Mexico"],
    "india": ["List of Indian flags", "Flags of India"],
    "russia": ["Flags of the federal subjects of Russia"],
    "swiss": ["Flags and arms of cantons of Switzerland", "Flags of the cantons of Switzerland"],
    "spain": ["Flags of the autonomous communities of Spain", "List of Spanish flags"],
    "historical": ["List of historical national flags", "Flags of formerly independent states", "Flags of Asia",
                   "Flags of Africa", "Flags of North America", "Flags of South America", "Flags of Oceania"],
    "ethnic": ["List of flags of indigenous peoples", "Flags of indigenous peoples", "List of ethnic flags", "Ethnic flag"],
    "signal": ["International maritime signal flags", "Racing flags"],
    "orgs": ["Flags of international organizations", "List of international organization flags"],
}
CATEGORIES = {"pride": ["LGBT flags"]}
INFO = dict(prop="imageinfo", iiprop="url|size|mime|extmetadata", iiextmetadatafilter="LicenseShortName|Artist")


def get(url):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                return r.read()
        except Exception as e:
            if attempt == 4:
                raise
            wait = int(getattr(e, "headers", {}).get("Retry-After", 0) or 0) if hasattr(e, "headers") else 0
            time.sleep(max(wait, 20*(attempt+1)))


def query(host, **params):
    params.update(action="query", format="json")
    pages, cont = [], {}
    while True:
        data = json.loads(get(f"https://{host}/w/api.php?" + urllib.parse.urlencode({**params, **cont})))
        pages.extend(data.get("query", {}).get("pages", {}).values())
        if "continue" not in data:
            return pages
        cont = data["continue"]
        time.sleep(1)


def main():
    root = sys.argv[1]
    os.makedirs(root, exist_ok=True)
    index, seen = {}, set()
    for family, titles in PAGES.items():
        pages = []
        for title in titles:
            pages += query("en.wikipedia.org", titles=title, generator="images", gimlimit="max", **INFO)
        for category in CATEGORIES.get(family, []):
            pages += query("commons.wikimedia.org", generator="categorymembers", gcmtitle="Category:"+category,
                           gcmtype="file", gcmlimit="max", **INFO)
        for page in pages:
            info = (page.get("imageinfo") or [{}])[0]
            title = page["title"].lower()
            if info.get("mime") != "image/svg+xml" or info["size"] > 2_000_000 or title in seen:
                continue
            if not re.search(r"flag|ensign|banner|pennant|ics |pride", title) or re.search(r"\bicon\b|\bmap\b|\bcoat\b|\bseal\b", title):
                continue
            seen.add(title)
            name = re.sub(r"[^a-z0-9]+", "-", re.sub(r"^file:|\.svg$", "", title)).strip("-")[:60]
            index[f"{family}/{name}"] = dict(title=page["title"], url=info["url"], page=info.get("descriptionurl"),
                                             meta={k: v.get("value") for k, v in info.get("extmetadata", {}).items()})
        print(family, sum(1 for k in index if k.startswith(family + "/")), flush=True)
    json.dump(index, open(root + "/index.json", "w"), indent=1)
    items = list(index.items())
    random.shuffle(items)
    for key, entry in items:
        path = f"{root}/svg/{key}.svg"
        if os.path.exists(path):
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(get(entry["url"]))
        time.sleep(1.2)


if __name__ == "__main__":
    main()
