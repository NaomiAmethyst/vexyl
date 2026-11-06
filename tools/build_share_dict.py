#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""Curates a share link's preset dictionary from the format's grammar and real flags.

    build_share_dict.py [--size BYTES] [--out FILE] [--measure] FLAGS...

FLAGS are directories of documents. Half of them, by hash, train the dictionary and the rest
measure it, so the numbers don't flatter it. A released dictionary can never change, because links
already sent depend on every byte of it, so this exists as a record of how share/v1.dict was made
and to make a dictionary for a later version.
"""
import argparse
import hashlib
import os
import re
import zlib
from collections import Counter

# Every term of the format, so that a flag using a rare one still gains something.
GRAMMAR = """
vexyl 1
meta { name description version date until series note law restriction designer design-rights encoder license render-license adapted-from source author part }
palette { color gradient along stops pantone ncs ral munsell dye thread cmyk reference }
proportion hoist= fly=
outline swallowtail tongued pennant depth taper tongue tip polygon point path box
border inside outside width
define use field bars chevrons band cross saltire quarters checks rays pile pall charge emblem group panel canton
count ratio rotate grow edge wavy zigzag period apex angle offset fimbriate counterchange diagonal split rows columns
flow bend-sinister bend measure from center upper-hoist upper-fly lower-hoist lower-fly top bottom base flat hollow junction side corner
opacity blend multiply screen overlay darken lighten clip cut anchor start end scale
disc ellipse ring rect plus triangle star crescent sun lozenge heart cardioid svg radius inner points lines disc gap spread evenodd
repeat grid stagger=#true turn=#true arc line at center fimbriate markup
reverse mirror adapt range wider narrower extend hoist-extend hoist-center hoist-scale
variant from none transpose upright fold over under tuck through= move= along=fly along=hoist at=
"""


def documents(dirs):
    for top in dirs:
        for base, subdirs, files in os.walk(top):
            subdirs.sort()
            for name in sorted(files):
                if name.endswith(".kdl"):
                    path = os.path.join(base, name)
                    # What's too large for a link isn't what a dictionary is for.
                    if os.path.getsize(path) <= 64 * 1024:
                        with open(path, encoding="utf-8") as f:
                            yield path, f.read()


def in_training(path):
    return hashlib.sha256(os.path.basename(path).encode()).digest()[0] % 2 == 0


def candidates(text):
    """Pieces worth remembering: whole lines, their openings and their words, without the numbers
    that only one flag has."""
    seen = set()
    for line in text.split("\n"):
        body = line[:200]
        if len(line) > 200 or len(body.strip()) < 4:
            continue
        with_break = body + "\n"
        seen.add(with_break)
        seen.add("\n" + with_break)
        indent = len(body) - len(body.lstrip())
        words = re.finditer(r'[^\s"]+|"[^"]*"', body)
        spots = [m.start() for m in words]
        for i, start in enumerate(spots):
            for end in spots[i + 1:i + 5] + [len(body)]:
                piece = body[max(start - 1, 0) if start > indent else 0:end]
                if 4 <= len(piece) <= 80:
                    seen.add(piece)
    return seen


def score_table(docs):
    counts = Counter()
    for text in docs:
        counts.update(candidates(text))
    return counts


def choose(counts, size, floor=3):
    """Picks pieces greedily by what each saves over all the documents, counting what's already
    covered by a piece taken before as worth nothing."""
    ranked = sorted(((c * (len(p) - 3), p, c) for p, c in counts.items() if c >= floor and len(p) >= 4), key=lambda r: (-r[0], r[1]))
    taken = []
    used = 0
    joined = ""
    for _, piece, count in ranked:
        if used >= size:
            break
        if piece in joined:
            continue
        # A longer piece makes shorter ones it contains redundant, so only what's new costs anything.
        taken.append((count, piece))
        used += len(piece.encode())
        joined += piece
    return taken


def assemble(taken, size):
    """Rarest first, because the nearest matches cost the fewest bits, then merges each piece into
    the end of the last where they overlap."""
    taken = sorted(taken, key=lambda t: (t[0], t[1]))
    out = re.sub(r"\s+", " ", GRAMMAR).strip() + "\n"
    for _, piece in taken:
        if piece in out:
            continue
        for k in range(min(len(piece), len(out)), 2, -1):
            if out.endswith(piece[:k]):
                piece = piece[k:]
                break
        out += piece
    data = out.encode()
    # The newest part matters most, so if it's too long, what goes is from the front, after the grammar.
    if len(data) > size:
        grammar = min(size, len(re.sub(r"\s+", " ", GRAMMAR).strip().encode()) + 1)
        data = data[:grammar] + data[len(data) - (size - grammar):]
        # Don't start in the middle of a character.
        while grammar < len(data) and (data[grammar] & 0xC0) == 0x80:
            data = data[:grammar] + data[grammar + 1:]
    return data


def deflated(text, dictionary):
    c = zlib.compressobj(9, zlib.DEFLATED, -15, 9, zlib.Z_DEFAULT_STRATEGY, dictionary) if dictionary else zlib.compressobj(9, zlib.DEFLATED, -15, 9)
    return len(c.compress(text.encode()) + c.flush())


def measure(texts, dictionary):
    sizes = sorted(deflated(t, dictionary) for t in texts)
    return sum(sizes), sizes[len(sizes) // 2]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--size", type=int, default=8192)
    ap.add_argument("--out")
    ap.add_argument("--measure", action="store_true", help="also try other sizes")
    ap.add_argument("dirs", nargs="+")
    args = ap.parse_args()
    docs = list(documents(args.dirs))
    train = [t for p, t in docs if in_training(p)]
    test = [t for p, t in docs if not in_training(p)]
    print(f"{len(train)} documents to train on, {len(test)} to measure with")
    counts = score_table(train)
    none = measure(test, None)
    print(f"no dictionary: total {none[0]}, median {none[1]}")
    for size in [args.size] + ([1024, 2048, 4096, 8192, 16384, 32768] if args.measure else []):
        data = assemble(choose(counts, size * 2), size)
        total, median = measure(test, data)
        print(f"{len(data)} bytes: total {total} ({100 * total / none[0]:.1f}%), median {median}")
        if size == args.size and args.out:
            counts_all = score_table(t for _, t in docs)
            final = assemble(choose(counts_all, size * 2), size)
            with open(args.out, "wb") as f:
                f.write(final)
            print(f"wrote {args.out}: {len(final)} bytes, sha256 {hashlib.sha256(final).hexdigest()}")


if __name__ == "__main__":
    main()
