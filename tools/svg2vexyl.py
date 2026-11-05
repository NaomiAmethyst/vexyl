#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""Convert an SVG drawing of a flag into a Vexyl document.

The drawing is flattened into a list of painted shapes, with its transforms, <use>
references and CSS resolved. Each shape that's recognized becomes flag vocabulary:
a field, bars, panels, crosses, saltires, chevrons, piles, quarters, crescents, suns and
so on. Single shapes it can't name become paths, and long runs of detailed shapes, such as
seals, go into inline SVG, which is a faithful copy rather than a description.

This is a mechanical conversion. It says what a drawing looks like, not how the flag
is officially constructed.

    svg2vexyl.py [--name NAME] [--source URL] [--encoder TEXT] [--license SPDX] FILE
"""

import argparse
import math
import re
import sys
import xml.etree.ElementTree as ET

SVG = "{http://www.w3.org/2000/svg}"
XLINK = "{http://www.w3.org/1999/xlink}href"
EPS = 1e-6
# This many detailed shapes in a row are treated as artwork, like a seal, and stay together.
ARTWORK_RUN = 8

# Everything that can't be carried into a flag is raised as this, with a short reason
# that reports can count.
class Unsupported(Exception):
    pass


CSS_COLORS = {
    "black": "#000000", "white": "#ffffff", "red": "#ff0000", "lime": "#00ff00",
    "green": "#008000", "blue": "#0000ff", "yellow": "#ffff00", "cyan": "#00ffff",
    "aqua": "#00ffff", "magenta": "#ff00ff", "fuchsia": "#ff00ff", "silver": "#c0c0c0",
    "gray": "#808080", "grey": "#808080", "maroon": "#800000", "olive": "#808000",
    "purple": "#800080", "teal": "#008080", "navy": "#000080", "orange": "#ffa500",
    "gold": "#ffd700", "pink": "#ffc0cb", "brown": "#a52a2a", "crimson": "#dc143c",
    "forestgreen": "#228b22", "darkgreen": "#006400", "darkblue": "#00008b",
    "darkred": "#8b0000", "royalblue": "#4169e1", "skyblue": "#87ceeb",
    "whitesmoke": "#f5f5f5", "darkgoldenrod": "#b8860b", "goldenrod": "#daa520", "firebrick": "#b22222",
    "indigo": "#4b0082", "violet": "#ee82ee", "tan": "#d2b48c", "khaki": "#f0e68c", "steelblue": "#4682b4",
}

INHERITED = ("fill", "fill-rule", "fill-opacity", "stroke", "stroke-width",
             "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
             "stroke-dasharray", "stroke-dashoffset", "color", "visibility", "clip-rule")
NOT_INHERITED = ("opacity", "clip-path", "mask", "filter", "display", "mix-blend-mode")


UNITS = dict(px=1, pt=96/72, pc=16, mm=96/25.4, cm=96/2.54, **{"in": 96})


def local(tag):
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def number(value, default=0.0):
    if value is None:
        return default
    m = re.match(r"\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(px|pt|pc|mm|cm|in)?\s*$", value)
    if not m:
        raise Unsupported(f"length {value.strip()[:12]!r}")
    return float(m.group(1)) * UNITS[m.group(2) or "px"]


def identity():
    return (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def multiply(m, n):
    a, b, c, d, e, f = m
    g, h, i, j, k, l = n
    return (a*g + c*h, b*g + d*h, a*i + c*j, b*i + d*j, a*k + c*l + e, b*k + d*l + f)


def apply(m, p):
    return (m[0]*p[0] + m[2]*p[1] + m[4], m[1]*p[0] + m[3]*p[1] + m[5])


def parse_transform(text):
    m = identity()
    for name, args in re.findall(r"([a-zA-Z]+)\s*\(([^)]*)\)", text or ""):
        v = [float(x) for x in re.findall(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?", args)]
        if name == "matrix" and len(v) == 6:
            step = tuple(v)
        elif name == "translate":
            step = (1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0)
        elif name == "scale":
            step = (v[0], 0, 0, v[1] if len(v) > 1 else v[0], 0, 0)
        elif name == "rotate":
            s, c = math.sin(math.radians(v[0])), math.cos(math.radians(v[0]))
            step = (c, s, -s, c, 0, 0)
            if len(v) == 3:
                step = multiply(multiply((1, 0, 0, 1, v[1], v[2]), step), (1, 0, 0, 1, -v[1], -v[2]))
        elif name == "skewX":
            step = (1, 0, math.tan(math.radians(v[0])), 1, 0, 0)
        elif name == "skewY":
            step = (1, math.tan(math.radians(v[0])), 0, 1, 0, 0)
        else:
            raise Unsupported(f"transform {name}")
        m = multiply(m, step)
    return m


def uniform_scale(m):
    """Returns a transform's scale if it preserves circles, else None."""
    sx, sy = math.hypot(m[0], m[1]), math.hypot(m[2], m[3])
    dot = m[0]*m[2] + m[1]*m[3]
    if abs(sx - sy) > 1e-6 * max(sx, 1e-9) or abs(dot) > 1e-6 * max(sx*sy, 1e-9):
        return None
    return sx


def parse_color(value, inherited_color="#000000"):
    """Returns #rrggbb, 'none', or None for a paint that isn't a plain color."""
    if value is None:
        return None
    v = value.strip().lower()
    if v in ("none", "transparent"):
        return "none"
    if v == "currentcolor":
        return parse_color(inherited_color)
    m = re.match(r"#([0-9a-f]{3})$", v)
    if m:
        return "#" + "".join(c*2 for c in m.group(1))
    if re.match(r"#[0-9a-f]{6}$", v):
        return v
    m = re.match(r"rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)", v)
    if m:
        parts = []
        for i in (1, 3, 5):
            x = float(m.group(i))
            parts.append(round(x * 2.55 if m.group(i + 1) else x))
        return "#%02x%02x%02x" % tuple(parts)
    return CSS_COLORS.get(v)


def parse_css(text):
    """Reads simple stylesheets: tag, .class, #id and comma lists of those."""
    rules = {}
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    for selectors, body in re.findall(r"([^{}]+)\{([^{}]*)\}", text):
        decls = parse_style(body)
        for sel in selectors.split(","):
            sel = sel.strip()
            if re.fullmatch(r"[.#]?[\w-]+", sel):
                rules.setdefault(sel, {}).update(decls)
            elif sel:
                raise Unsupported("complex CSS selector")
    return rules


def parse_style(text):
    out = {}
    for decl in (text or "").split(";"):
        if ":" in decl:
            k, v = decl.split(":", 1)
            out[k.strip().lower()] = v.strip()
    return out


PATH_TOKEN = re.compile(r"([a-zA-Z])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)")


def path_commands(d):
    """Yields each path command as (letter, numbers), expanding implicit repeats."""
    tokens = PATH_TOKEN.findall(d or "")
    i, cmd = 0, None
    counts = dict(M=2, L=2, H=1, V=1, C=6, S=4, Q=4, T=2, A=7, Z=0)
    def nums(n):
        nonlocal i
        out = []
        for _ in range(n):
            if i >= len(tokens) or tokens[i][0]:
                raise Unsupported("malformed path")
            out.append(float(tokens[i][1]))
            i += 1
        return out
    while i < len(tokens):
        if tokens[i][0]:
            cmd = tokens[i][0]
            i += 1
        elif cmd is None:
            raise Unsupported("malformed path")
        c = cmd.upper()
        if c not in counts:
            raise Unsupported("malformed path")
        if c == "Z":
            yield cmd, []
            continue
        if c == "A":
            # Arc flags can be written with no separators, so read them singly.
            v = nums(3)
            for _ in range(2):
                if i >= len(tokens) or tokens[i][0]:
                    raise Unsupported("malformed path")
                tok = tokens[i][1]
                v.append(float(tok[0]))
                if len(tok) > 1 and tok[0] in "01":
                    tokens[i] = ("", tok[1:])
                else:
                    i += 1
            v.extend(nums(2))
        else:
            v = nums(counts[c])
        yield cmd, v
        if c == "M":
            cmd = "l" if cmd.islower() else "L"


def parse_path(d):
    """Returns (subpaths, curved). Each subpath is a (points, closed) tuple, and
    curved says it can't be written as straight lines."""
    x, y, sx, sy = 0.0, 0.0, 0.0, 0.0
    subs, cur, curved = [], [], False
    for cmd, v in path_commands(d):
        rel = cmd.islower()
        c = cmd.upper()
        if c == "Z":
            if cur:
                subs.append((cur, True))
            cur = []
            x, y = sx, sy
            continue
        if c in "CSQTA":
            curved = True
        if c == "H":
            x = x + v[0] if rel else v[0]
        elif c == "V":
            y = y + v[0] if rel else v[0]
        else:
            x = x + v[-2] if rel else v[-2]
            y = y + v[-1] if rel else v[-1]
        if c == "M":
            if cur:
                subs.append((cur, False))
            cur = [(x, y)]
            sx, sy = x, y
        else:
            if not cur:
                cur = [(sx, sy)]
            cur.append((x, y))
    if cur:
        subs.append((cur, False))
    return subs, curved


def bounds(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


class Op:
    """One painted element, with everything it inherits resolved."""
    def __init__(self, elem, tag, attrs, style, ctm):
        self.elem, self.tag, self.attrs, self.style, self.ctm = elem, tag, attrs, style, ctm
        self.polys = None    # straight-edged polygons in flag coordinates
        self.disc = None     # (cx, cy, r)
        self.ring = None     # (cx, cy, r, inner)
        self.crescents = []  # (cx, cy, r, cut cx, cut cy, cut r)
        self.fill = None
        self.opacity = 1.0
        self.reason = None   # why this can't be native
        self.path = None     # (d, box, evenodd), in flag coordinates
        self.stroke = None   # (color, width), for a stroke drawn over the shape


class Reader:
    def __init__(self, root):
        self.root = root
        self.ids = {}
        self.css = {}
        for e in root.iter():
            if e.get("id"):
                self.ids.setdefault(e.get("id"), e)
            if local(e.tag) == "style":
                self.css.update(parse_css(e.text or ""))
        self.ops = []
        self.clip_outline = None
        self.viewport()

    def viewport(self):
        r = self.root
        vb = r.get("viewBox")
        self.start = None
        if vb:
            v = [float(x) for x in re.split(r"[\s,]+", vb.strip())]
            self.x0, self.y0, self.w, self.h = v[:4]
            if self.w <= 0 or self.h <= 0:
                raise Unsupported("no usable size")
            self.start = (1, 0, 0, 1, -self.x0, -self.y0)
            width, height = plain_length(r.get("width")), plain_length(r.get("height"))
            if width and height and abs(width/height - self.w/self.h) > 1e-3*self.w/self.h:
                # The picture's true shape isn't its grid's. Keep the grid's width, and fit
                # the drawing into that shape as the viewer would.
                aspect = (r.get("preserveAspectRatio") or "xMidYMid meet").split()
                canvas_h = self.w * height / width
                sy = canvas_h / self.h
                if aspect[0] == "none":
                    sx = 1.0
                    tx, ty = 0.0, 0.0
                else:
                    sx = sy = (max if aspect[-1] == "slice" else min)(1.0, sy)
                    tx, ty = (self.w - self.w*sx)/2, (canvas_h - self.h*sy)/2
                self.start = (sx, 0, 0, sy, tx - self.x0*sx, ty - self.y0*sy)
                self.h = canvas_h
        else:
            self.x0, self.y0 = 0.0, 0.0
            self.w, self.h = number(r.get("width")), number(r.get("height"))
            self.start = (1, 0, 0, 1, 0, 0)
        if self.w <= 0 or self.h <= 0:
            raise Unsupported("no usable size")

    def styled(self, e, parent):
        """Works out an element's properties: inherited, attributes, CSS, then style."""
        s = {k: parent[k] for k in INHERITED if k in parent}
        for k in INHERITED + NOT_INHERITED:
            if e.get(k) is not None:
                s[k] = e.get(k)
        for sel in [local(e.tag)] + ["." + c for c in (e.get("class") or "").split()] + (["#" + e.get("id")] if e.get("id") else []):
            s.update({k: v for k, v in self.css.get(sel, {}).items() if k in INHERITED + NOT_INHERITED})
        s.update({k: v for k, v in parse_style(e.get("style")).items() if k in INHERITED + NOT_INHERITED})
        return s

    def walk(self, e, ctm, parent, opacity, stack=()):
        tag = local(e.tag)
        if not isinstance(e.tag, str) or not e.tag.startswith(SVG):
            return
        if tag in ("defs", "title", "desc", "metadata", "style", "symbol", "clipPath", "mask",
                   "linearGradient", "radialGradient", "pattern", "filter", "marker", "script"):
            return
        s = self.styled(e, parent)
        if s.get("display") == "none" or s.get("visibility") == "hidden":
            return
        ctm = multiply(ctm, parse_transform(e.get("transform")))
        for k in ("filter",):
            if k in s and s[k] != "none":
                raise Unsupported("filter")
        if tag in ("g", "a", "switch"):
            if "mask" not in s and (self.full_clip(s.get("clip-path"), ctm) or self.polygon_clip(s.get("clip-path"), ctm)):
                s = dict(s)
                s.pop("clip-path")
            for k in ("clip-path", "mask"):
                if k in s and s[k] != "none":
                    # A group's clip is passed to its children as an inline-only feature.
                    parent2 = dict(s)
                    return self.complex_group(e, ctm, s, opacity, stack)
            o = opacity * number(s.get("opacity"), 1.0)
            for c in e:
                self.walk(c, ctm, s, o, stack)
        elif tag == "svg":
            ctm = multiply(ctm, nested_viewport(e))
            for c in e:
                self.walk(c, ctm, s, opacity, stack)
        elif tag == "use":
            ref = (e.get("href") or e.get(XLINK) or "").lstrip("#")
            target = self.ids.get(ref)
            if target is None:
                return
            if ref in stack or len(stack) > 16:
                raise Unsupported("recursive use")
            ctm2 = multiply(ctm, (1, 0, 0, 1, number(e.get("x")), number(e.get("y"))))
            o = opacity * number(s.get("opacity"), 1.0)
            if local(target.tag) == "symbol":
                ctm2 = multiply(ctm2, nested_viewport(target, e))
                for c in target:
                    self.walk(c, ctm2, s, o, stack + (ref,))
            else:
                self.walk(target, ctm2, s, o, stack + (ref,))
        elif tag in ("rect", "circle", "ellipse", "line", "polyline", "polygon", "path"):
            self.ops.append(self.shape(e, tag, s, ctm, opacity))
        elif tag in ("text", "tspan", "textPath", "flowRoot"):
            raise Unsupported("text")
        elif tag == "image":
            raise Unsupported("image")
        elif tag in ("foreignObject", "script"):
            raise Unsupported(tag)
        elif tag in ("animate", "animateTransform", "set"):
            return
        else:
            raise Unsupported(f"element {tag}")

    def full_clip(self, value, ctm):
        """Does a clip keep everything visible, so that it can be ignored?"""
        m = REF.match(value or "")
        clip = self.ids.get(m.group(1)) if m else None
        if clip is None or len(clip) != 1 or local(clip.tag) != "clipPath":
            return False
        shape = clip[0]
        t = multiply(ctm, parse_transform(clip.get("transform")))
        if local(shape.tag) == "use":
            t = multiply(t, parse_transform(shape.get("transform")))
            shape = self.ids.get((shape.get("href") or shape.get(XLINK) or "").lstrip("#"))
        if shape is None:
            return False
        t = multiply(t, parse_transform(shape.get("transform")))
        if local(shape.tag) == "rect":
            x, y, w, h = (number(shape.get(k)) for k in ("x", "y", "width", "height"))
            pts = [(x, y), (x+w, y), (x+w, y+h), (x, y+h)]
        elif local(shape.tag) == "path":
            subs, curved = parse_path(shape.get("d"))
            if curved or len(subs) != 1 or len(subs[0][0]) not in (4, 5):
                return False
            pts = subs[0][0]
        else:
            return False
        pts = [apply(t, p) for p in pts]
        box = bounds(pts)
        tol = max(self.w, self.h) * 1e-3
        for a, b in zip(pts, pts[1:] + pts[:1]):
            if abs(a[0]-b[0]) > tol and abs(a[1]-b[1]) > tol:
                return False
        return box[0] <= tol and box[1] <= tol and box[2] >= self.w-tol and box[3] >= self.h-tol

    def gradient(self, value):
        """Reads a linear gradient that the format can say natively, if it is one."""
        m = REF.match((value or "").strip())
        g = self.ids.get(m.group(1)) if m else None
        if g is None or local(g.tag) != "linearGradient" or g.get("gradientTransform"):
            return None
        if (g.get("spreadMethod") or "pad") != "pad":
            return None
        def coord(key, default):
            v = g.get(key, default)
            return float(v[:-1])/100 if v.endswith("%") else float(v)
        try:
            x1, y1, x2, y2 = coord("x1", "0"), coord("y1", "0"), coord("x2", "1" if g.get("gradientUnits") != "userSpaceOnUse" else "100%"), coord("y2", "0")
        except ValueError:
            return None
        if g.get("gradientUnits") == "userSpaceOnUse":
            # Only a span of the whole flag has the same meaning across a full bar.
            if all(abs(a) < EPS for a in (y1, y2)) and abs(x1) < EPS and abs(x2-self.w) < self.w*1e-3:
                x2 = 1
            elif all(abs(a) < EPS for a in (x1, x2)) and abs(y1) < EPS and abs(y2-self.h) < self.h*1e-3:
                y2 = 1
            else:
                return None
        along = {(0, 0, 1, 0): "fly", (0, 0, 0, 1): "hoist", (0, 0, 1, 1): "bend", (0, 1, 1, 0): "bend-sinister"}.get((x1, y1, x2, y2))
        source = g
        for _ in range(8):
            if source.findall(SVG + "stop") or not (source.get("href") or source.get(XLINK)):
                break
            source = self.ids.get((source.get("href") or source.get(XLINK)).lstrip("#"))
            if source is None:
                return None
        if along is None or source is None:
            return None
        colors, stops = [], []
        for stop in source.findall(SVG + "stop"):
            st = parse_stop(self, stop)
            if number(st.get("stop-opacity"), 1.0) < 0.9995:
                return None
            color = parse_color(st.get("stop-color", "#000000"))
            if color in (None, "none"):
                return None
            off = st.get("offset", "0")
            stops.append(float(off[:-1])/100 if off.endswith("%") else float(off))
            colors.append(color)
        if len(colors) < 2 or stops != sorted(stops):
            return None
        return ("gradient", tuple(colors), tuple(stops), along)

    def polygon_clip(self, value, ctm):
        """A clip around the whole drawing that's a single polygon can be dropped,
        when the first thing painted is that same polygon: that's an outline."""
        m = REF.match(value or "")
        if not m or self.ops or uniform_scale(ctm) != 1.0:
            return False
        clip = self.ids.get(m.group(1))
        if clip is None or len(clip) != 1:
            return False
        shape = clip[0]
        if local(shape.tag) == "use":
            shape = self.ids.get((shape.get("href") or shape.get(XLINK) or "").lstrip("#"))
        if shape is None or local(shape.tag) != "path":
            return False
        subs, curved = parse_path(shape.get("d"))
        if curved or len(subs) != 1 or len(subs[0][0]) < 3:
            return False
        self.clip_outline = [apply(ctm, p) for p in subs[0][0]]
        return True

    def complex_group(self, e, ctm, s, opacity, stack):
        """Clipped and masked groups stay as they are, as inline artwork."""
        op = Op(e, "g", {}, s, ctm)
        op.opacity = opacity
        op.reason = "clipped or masked group"
        self.check_group(e, stack)
        self.ops.append(op)

    def check_group(self, e, stack):
        for c in e.iter():
            tag = local(c.tag)
            if tag in ("text", "tspan", "image", "foreignObject", "filter", "pattern"):
                raise Unsupported("element " + tag if tag not in ("text", "tspan", "image") else tag.replace("tspan", "text"))

    def shape(self, e, tag, s, ctm, opacity):
        op = Op(e, tag, {}, s, ctm)
        op.opacity = opacity * number(s.get("opacity"), 1.0)
        if self.full_clip(s.get("clip-path"), ctm):
            s = dict(s)
            s.pop("clip-path")
        for k in ("clip-path", "mask"):
            if k in s and s[k] != "none":
                op.reason = "clipped or masked shape"
                return op
        stroke = parse_color(s.get("stroke", "none"), s.get("color", "#000000"))
        fill_raw = s.get("fill", "#000000")
        fill = parse_color(fill_raw, s.get("color", "#000000"))
        fill_opacity = number(s.get("fill-opacity"), 1.0)
        has_stroke = stroke != "none" and number(s.get("stroke-width"), 1.0) > 0
        if has_stroke:
            # A fill has no area on a two-point line, whatever it's set to.
            if self.lines_only(e, tag) or (fill == "none" and tag == "circle"):
                if tag == "circle" and stroke is not None and s.get("stroke-dasharray", "none") == "none":
                    self.stroked_circle(op, e, s, ctm, stroke)
                elif tag in ("path", "line", "polyline") and stroke is not None \
                        and s.get("stroke-dasharray", "none") == "none" \
                        and s.get("stroke-linecap", "butt") == "butt":
                    self.stroked_lines(op, e, tag, s, ctm, stroke)
                op.reason = "stroked outline"
                return op
            scale = uniform_scale(ctm)
            plain = (s.get("stroke-dasharray", "none") == "none" and s.get("stroke-linecap", "butt") == "butt"
                     and s.get("stroke-linejoin", "miter") == "miter" and number(s.get("stroke-opacity"), 1.0) >= 0.9995
                     and fill_opacity >= 0.9995)
            if stroke is None or scale is None or not plain or (fill is None):
                op.reason = "filled and stroked" if fill != "none" else "stroked outline"
                return op
            op.fill = fill
            op.stroke = (stroke, number(s.get("stroke-width"), 1.0) * scale)
            self.solid(op, e, tag, s, ctm, stroked=True)
            if not (op.polys or op.disc or op.crescents or op.path):
                op.reason = "filled and stroked" if fill != "none" else "stroked outline"
                op.stroke = None
            return op
        if fill is None and "url(" in fill_raw and fill_opacity >= 0.9995:
            fill = self.gradient(fill_raw)
            if fill is None:
                op.reason = "gradient the format can't say natively"
                return op
        if fill is None or fill == "none":
            op.fill = fill
            op.reason = "unusual paint"
            return op
        op.fill = fill
        op.opacity *= fill_opacity
        self.solid(op, e, tag, s, ctm)
        if not op.polys and not op.disc and not op.path and not op.crescents:
            op.reason = {"ellipse": "ellipse", "circle": "skewed circle", "rect": "rounded rectangle"}.get(tag, "curved path" if tag == "path" else tag)
            if tag == "path" and not parse_path(e.get("d"))[1]:
                op.reason = "path with overlapping subpaths"
        return op

    def lines_only(self, e, tag):
        if tag == "line":
            return True
        if tag != "path":
            return False
        subs, curved = parse_path(e.get("d"))
        return not curved and all(len(pts) == 2 and not closed for pts, closed in subs)

    def stroked_circle(self, op, e, s, ctm, stroke):
        scale = uniform_scale(ctm)
        if scale is None:
            return
        r, half = number(e.get("r")) * scale, number(s.get("stroke-width"), 1.0) * scale / 2
        if half >= r:
            return
        c = apply(ctm, (number(e.get("cx")), number(e.get("cy"))))
        op.ring, op.fill = (c[0], c[1], r+half, r-half), stroke

    def stroked_lines(self, op, e, tag, s, ctm, stroke):
        """A stroke along straight lines is a set of rectangles."""
        scale = uniform_scale(ctm)
        if scale is None:
            return
        width = number(s.get("stroke-width"), 1.0) * scale / 2
        if tag == "line":
            subs = [([(number(e.get("x1")), number(e.get("y1"))), (number(e.get("x2")), number(e.get("y2")))], False)]
        elif tag == "polyline":
            pts = [float(x) for x in re.findall(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?", e.get("points") or "")]
            subs = [(list(zip(pts[::2], pts[1::2])), False)]
        else:
            subs, curved = parse_path(e.get("d"))
            if curved:
                return
        polys = []
        for points, closed in subs:
            if len(points) != 2 or closed:
                return
            a, b = apply(ctm, points[0]), apply(ctm, points[1])
            l = math.hypot(b[0]-a[0], b[1]-a[1])
            if l == 0:
                continue
            nx, ny = -(b[1]-a[1])/l*width, (b[0]-a[0])/l*width
            polys.append([(a[0]+nx, a[1]+ny), (b[0]+nx, b[1]+ny), (b[0]-nx, b[1]-ny), (a[0]-nx, a[1]-ny)])
        if polys:
            op.polys, op.fill = polys, stroke
            op.lines = True

    def solid(self, op, e, tag, s, ctm, stroked=False):
        evenodd = s.get("fill-rule", "nonzero") == "evenodd"
        if tag == "rect":
            x, y = number(e.get("x")), number(e.get("y"))
            w, h = number(e.get("width")), number(e.get("height"))
            rx, ry = number(e.get("rx")), number(e.get("ry"))
            if rx or ry:
                rx, ry = rx or ry, ry or rx
                d = (f"M{x+rx} {y}H{x+w-rx}A{rx} {ry} 0 0 1 {x+w} {y+ry}V{y+h-ry}A{rx} {ry} 0 0 1 {x+w-rx} {y+h}"
                     f"H{x+rx}A{rx} {ry} 0 0 1 {x} {y+h-ry}V{y+ry}A{rx} {ry} 0 0 1 {x+rx} {y}Z")
                op.path = flatten_path(d, ctm, evenodd)
                return
            op.polys = [[apply(ctm, p) for p in ((x, y), (x+w, y), (x+w, y+h), (x, y+h))]]
        elif tag == "circle":
            scale = uniform_scale(ctm)
            if scale is not None:
                c = apply(ctm, (number(e.get("cx")), number(e.get("cy"))))
                op.disc = (c[0], c[1], number(e.get("r")) * scale)
            else:
                r = number(e.get("r"))
                cx, cy = number(e.get("cx")), number(e.get("cy"))
                op.path = flatten_path(f"M{cx-r} {cy}A{r} {r} 0 1 0 {cx+r} {cy}A{r} {r} 0 1 0 {cx-r} {cy}Z", ctm, evenodd)
        elif tag == "ellipse":
            rx, ry = number(e.get("rx")), number(e.get("ry"))
            cx, cy = number(e.get("cx")), number(e.get("cy"))
            op.path = flatten_path(f"M{cx-rx} {cy}A{rx} {ry} 0 1 0 {cx+rx} {cy}A{rx} {ry} 0 1 0 {cx-rx} {cy}Z", ctm, evenodd)
        elif tag in ("polygon", "polyline"):
            v = [float(x) for x in re.findall(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?", e.get("points") or "")]
            if len(v) >= 6 and not (stroked and tag == "polyline"):
                op.polys = [[apply(ctm, p) for p in zip(v[::2], v[1::2])]]
        elif tag == "path":
            subs, curved = parse_path(e.get("d"))
            if not stroked or (not curved and all(closed for _, closed in subs)):
                self.solid_path(op, e.get("d"), ctm)
            if not (op.polys or op.disc or op.crescents):
                op.path = flatten_path(e.get("d"), ctm, evenodd)

    def solid_path(self, op, d, ctm):
        """Reads a filled path whose subpaths are all polygons, discs or crescents."""
        parts = split_subpaths(d)
        polys, discs, crescents = [], [], []
        scale = uniform_scale(ctm)
        for part in parts:
            if part["arcs"]:
                if scale is None:
                    return
                shape = two_arcs(part)
                if shape is None:
                    return
                if len(shape) == 3:
                    c = apply(ctm, shape[:2])
                    discs.append((c[0], c[1], shape[2]*scale))
                else:
                    c = apply(ctm, shape[:2])
                    cut = apply(ctm, shape[3:5])
                    crescents.append((c[0], c[1], shape[2]*scale, cut[0], cut[1], shape[5]*scale))
            elif part["curved"]:
                return
            elif len(part["points"]) >= 3:
                polys.append([apply(ctm, p) for p in part["points"]])
        # Overlapping subpaths could be holes, which separate shapes would fill.
        outlines = polys + [circle_points(c[0], c[1], c[2]) for c in discs + crescents]
        cuts = [circle_points(c[3], c[4], c[5]) for c in crescents]
        for i, a in enumerate(outlines):
            for k, b in enumerate(outlines):
                if i == k:
                    continue
                if i >= len(polys) + len(discs) and k < len(polys) + len(discs) and any(inside(p, a) for p in b):
                    # A polygon within a crescent's disc is fine if it's in the cut.
                    cut = cuts[i - len(polys) - len(discs)]
                    if all(inside(p, cut) or not inside(p, a) for p in b):
                        continue
                    return
                if any(inside(p, a) for p in b):
                    if k >= len(polys) + len(discs):
                        continue
                    return
        if len(discs) == 1 and not polys and not crescents:
            op.disc = discs[0]
        elif discs:
            return
        else:
            op.polys = polys or None
            op.crescents = crescents


def split_subpaths(d):
    """Splits a path into subpaths, in absolute coordinates, noting arcs and curves."""
    parts, cur = [], None
    x, y, sx, sy = 0.0, 0.0, 0.0, 0.0
    for cmd, v in path_commands(d):
        rel = cmd.islower()
        c = cmd.upper()
        if c == "Z":
            if cur:
                parts.append(cur)
            cur = None
            x, y = sx, sy
            continue
        if c == "M" or cur is None:
            if cur:
                parts.append(cur)
            if c == "M":
                x, y = (x + v[0], y + v[1]) if rel else (v[0], v[1])
                sx, sy = x, y
            cur = dict(points=[(x, y)], arcs=[], curved=False)
            if c == "M":
                continue
        if c == "H":
            nx, ny = (x + v[0] if rel else v[0]), y
        elif c == "V":
            nx, ny = x, (y + v[0] if rel else v[0])
        else:
            nx, ny = (x + v[-2], y + v[-1]) if rel else (v[-2], v[-1])
        if c == "A":
            cur["arcs"].append(((x, y), (nx, ny), v[0], v[1], int(v[3]), int(v[4]), v[2]))
        elif c in "CSQT":
            cur["curved"] = True
        cur["points"].append((nx, ny))
        x, y = nx, ny
    if cur:
        parts.append(cur)
    return parts


def arc_center(arc):
    """Finds a circular arc's center and the point halfway along it."""
    (x0, y0), (x1, y1), rx, ry, large, sweep, _ = arc
    if abs(rx-ry) > 1e-6*max(rx, ry):
        return None
    dx, dy = (x0-x1)/2, (y0-y1)/2
    chord = dx*dx + dy*dy
    if chord == 0:
        return None
    r = max(rx, math.sqrt(chord))
    sign = 1 if large != sweep else -1
    coef = sign * math.sqrt(max(0.0, (r*r-chord)/chord))
    cx, cy = coef*dy + (x0+x1)/2, -coef*dx + (y0+y1)/2
    t0 = math.atan2(y0-cy, x0-cx)
    t1 = math.atan2(y1-cy, x1-cx)
    delta = (t1-t0) % (2*math.pi) if sweep else -((t0-t1) % (2*math.pi))
    mid = t0 + delta/2
    return cx, cy, r, (cx + r*math.cos(mid), cy + r*math.sin(mid))


def two_arcs(part):
    """Recognizes a subpath of two arcs: a disc as (cx, cy, r), or a crescent as
    (cx, cy, r, cut cx, cut cy, cut r)."""
    arcs = part["arcs"]
    if len(arcs) != 2 or part["curved"] or len(part["points"]) != 3 or math.dist(part["points"][0], part["points"][2]) > 1e-3*arcs[0][2]:
        return None
    a, b = arc_center(arcs[0]), arc_center(arcs[1])
    if a is None or b is None:
        return None
    if math.dist(a[:2], b[:2]) < 1e-3*a[2] and abs(a[2]-b[2]) < 1e-3*a[2]:
        return (a[0], a[1], a[2])
    p, q = part["points"][0], part["points"][1]
    nx, ny = q[1]-p[1], p[0]-q[0]
    side = lambda m: (m[0]-p[0])*nx + (m[1]-p[1])*ny
    if side(a[3])*side(b[3]) <= 0:
        return None
    outer, inner = (a, b) if abs(side(a[3])) > abs(side(b[3])) else (b, a)
    return (outer[0], outer[1], outer[2], inner[0], inner[1], inner[2])


def circle_points(cx, cy, r, n=24):
    return [(cx + r*math.cos(2*math.pi*i/n), cy + r*math.sin(2*math.pi*i/n)) for i in range(n)]


def inside(p, poly):
    """Tests a point against a polygon, by the even-odd rule."""
    x, y = p
    hit = False
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        if (y0 > y) != (y1 > y) and x < (x1-x0)*(y-y0)/(y1-y0) + x0:
            hit = not hit
    return hit


def crosses_itself(poly):
    """Does a polygon's outline cross itself, like a bowtie?"""
    def turn(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i+1) % n]
        for j in range(i+2, n):
            if (j+1) % n == i:
                continue
            c, d = poly[j], poly[(j+1) % n]
            if turn(a, b, c)*turn(a, b, d) < 0 and turn(c, d, a)*turn(c, d, b) < 0:
                return True
    return False


def area(poly):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(poly, poly[1:] + poly[:1])))/2


def flatten_path(d, ctm, evenodd=False):
    """Rewrites a path in flag coordinates, returning (d, box, evenodd), or None if an
    arc can't survive the transform."""
    out, points = [], []
    x, y, sx, sy, px, py = 0.0, 0.0, 0.0, 0.0, None, None
    scale = uniform_scale(ctm)
    axis_aligned = abs(ctm[1]) < 1e-9 and abs(ctm[2]) < 1e-9
    flipped = ctm[0]*ctm[3] - ctm[1]*ctm[2] < 0
    def put(letter, *pairs):
        coords = []
        for pair in pairs:
            q = apply(ctm, pair)
            points.append(q)
            coords.append(f"{fmt(q[0])} {fmt(q[1])}")
        out.append(letter + " ".join(coords))
    for cmd, v in path_commands(d):
        rel = cmd.islower()
        c = cmd.upper()
        base = (x, y) if rel else (0.0, 0.0)
        if c == "Z":
            out.append("Z")
            x, y = sx, sy
            continue
        if c == "M":
            x, y = base[0]+v[0], base[1]+v[1]
            sx, sy = x, y
            put("M", (x, y))
        elif c == "L":
            x, y = base[0]+v[0], base[1]+v[1]
            put("L", (x, y))
        elif c == "H":
            x = base[0]+v[0]
            put("L", (x, y))
        elif c == "V":
            y = base[1]+v[0]
            put("L", (x, y))
        elif c in "CSQT":
            pairs = [(base[0]+v[i], base[1]+v[i+1]) for i in range(0, len(v), 2)]
            put(c, *pairs)
            x, y = pairs[-1]
        elif c == "A":
            rx, ry, rot, large, sweep = v[0], v[1], v[2], int(v[3]), int(v[4])
            end = (base[0]+v[5], base[1]+v[6])
            if scale is not None:
                angle = math.degrees(math.atan2(ctm[1], ctm[0]))
                rx, ry = rx*scale, ry*scale
                rot = -rot + angle if flipped else rot + angle
            elif axis_aligned and rot == 0:
                rx, ry = rx*abs(ctm[0]), ry*abs(ctm[3])
            else:
                return None
            if flipped:
                sweep = 1 - sweep
            q = apply(ctm, end)
            # An arc's reach beyond its ends is covered by its radius on either side.
            points.extend([(q[0]-rx, q[1]-ry), (q[0]+rx, q[1]+ry)])
            out.append(f"A{fmt(rx)} {fmt(ry)} {fmt(rot)} {large} {sweep} {fmt(q[0])} {fmt(q[1])}")
            x, y = end
    if not points:
        return None
    return "".join(out), bounds(points), evenodd


def nested_viewport(e, sized_by=None):
    """A nested svg or symbol's own coordinates, within where it's placed."""
    x, y = (0.0, 0.0) if sized_by is not None else (number(e.get("x")), number(e.get("y")))
    place = (1, 0, 0, 1, x, y)
    vb = e.get("viewBox")
    if not vb:
        return place
    v = [float(n) for n in re.split(r"[\s,]+", vb.strip())]
    source = sized_by if sized_by is not None else e
    width, height = plain_length(source.get("width")), plain_length(source.get("height"))
    if not width or not height or v[2] <= 0 or v[3] <= 0:
        return multiply(place, (1, 0, 0, 1, -v[0], -v[1]))
    aspect = (e.get("preserveAspectRatio") or "xMidYMid meet").split()
    sx, sy = width/v[2], height/v[3]
    tx, ty = 0.0, 0.0
    if aspect[0] != "none":
        sx = sy = min(sx, sy)
        tx, ty = (width - v[2]*sx)/2, (height - v[3]*sy)/2
    return multiply(place, (sx, 0, 0, sy, tx - v[0]*sx, ty - v[1]*sy))


def plain_length(value):
    """Reads a length that's an actual size, rather than a percentage."""
    if value is None or value.strip().endswith("%"):
        return None
    try:
        return number(value)
    except Unsupported:
        return None


def fmt(v):
    v = round(v, 4)
    if v == 0:
        v = 0.0
    return ("%.4f" % v).rstrip("0").rstrip(".")


class Writer:
    """Turns painted shapes into Vexyl layers."""
    def __init__(self, reader):
        self.r = reader
        self.w, self.h = reader.w, reader.h
        self.palette = {}
        self.layers = []
        self.pending_svg = []
        self.stats = dict(native=0, inline=0)
        self.reasons = []
        self.outline = None
        self.last_cross = None

    def color(self, hex_value):
        if hex_value in self.palette:
            return self.palette[hex_value]
        if isinstance(hex_value, tuple):
            for c in hex_value[1]:
                self.color(c)
            name = "blend"
        else:
            name = color_name(hex_value)
        taken = set(self.palette.values())
        candidate, n = name, 1
        while candidate in taken:
            n += 1
            candidate = f"{name}-{n}"
        self.palette[hex_value] = candidate
        return candidate

    def covers(self, box, axis):
        """Does this box span the flag in a direction?"""
        tol = max(self.w, self.h) * 1e-3
        if axis == "fly":
            return box[0] <= tol and box[2] >= self.w - tol
        return box[1] <= tol and box[3] >= self.h - tol

    def rect_of(self, poly):
        """Returns a polygon's box if it's an upright rectangle."""
        if len(poly) == 5 and math.dist(poly[0], poly[4]) < EPS:
            poly = poly[:4]
        if len(poly) != 4:
            return None
        box = bounds(poly)
        tol = max(self.w, self.h) * 1e-5
        for p in poly:
            if min(abs(p[0]-box[0]), abs(p[0]-box[2])) > tol or min(abs(p[1]-box[1]), abs(p[1]-box[3])) > tol:
                return None
        # Each edge has to run straight, or this is a bowtie with a rectangle's corners.
        for a, b in zip(poly, poly[1:] + poly[:1]):
            if abs(a[0]-b[0]) > tol and abs(a[1]-b[1]) > tol:
                return None
        return box

    def take_outline(self, ops):
        """A flag whose first shape reaches every side but isn't a rectangle has
        that shape as its outline, like a swallowtail."""
        if not ops:
            return ops
        op = ops[0]
        if not op.polys or len(op.polys) != 1 or op.fill in (None, "none") or op.opacity < 0.9995 or op.stroke:
            return ops
        poly = op.polys[0]
        if self.rect_of(poly) or len(poly) < 3:
            return ops
        box = bounds(poly)
        tol = max(self.w, self.h) * 1e-3
        if box[0] > tol or box[1] > tol or box[2] < self.w-tol or box[3] < self.h-tol:
            return ops
        if self.chevron(poly) or area(poly) < 0.6 * self.w * self.h:
            return ops
        # It's only the flag's silhouette if everything else stays within it.
        grown = [(p[0] + (p[0]-self.w/2)*1e-3, p[1] + (p[1]-self.h/2)*1e-3) for p in poly]
        for later in ops[1:]:
            points = [p for q in (later.polys or []) for p in q]
            if later.disc or later.ring or later.crescents:
                c = later.disc or later.ring or later.crescents[0]
                points += circle_points(c[0], c[1], c[2])
            if not points or not all(inside(p, grown) for p in points):
                return ops
        self.outline = poly
        self.add(f"field {self.color(op.fill)}")
        return ops[1:]

    def named_polygon(self, poly):
        """Is this polygon one the vocabulary has a name for?"""
        return bool(self.rect_of(poly) or regular_star(poly) or self.band(poly) or self.chevron(poly)
                    or self.lozenge(poly) or self.pile(poly))

    def is_art(self, op):
        """Detailed shapes, which belong together as artwork when there are many."""
        if op.path or op.stroke:
            return True
        if op.tag == "g" or op.fill in (None, "none"):
            return not (op.polys or op.disc or op.ring or op.crescents)
        if op.polys:
            return not all(self.named_polygon(p) for p in op.polys)
        return False

    def demote_artwork(self, ops):
        run = []
        for op in ops + [None]:
            if op is not None and self.is_art(op):
                run.append(op)
                continue
            if len(run) >= ARTWORK_RUN:
                for art in run:
                    art.artwork = True
            run = []

    def convert(self, ops):
        if self.r.clip_outline:
            self.outline = self.r.clip_outline
            first = ops[0]
            # A first shape that just repeats the outline is the flag's field.
            if first.polys and len(first.polys) == 1 and first.fill not in (None, "none") and first.opacity >= 0.9995:
                tol = max(self.w, self.h) * 1e-3
                same = len(first.polys[0]) == len(self.outline) and all(math.dist(a, b) < tol for a, b in zip(first.polys[0], self.outline))
                if same:
                    self.add(f"field {self.color(first.fill)}")
                    ops = ops[1:]
        else:
            ops = self.take_outline(ops)
        self.demote_artwork(ops)
        i, n = 0, len(ops)
        while i < n:
            op = ops[i]
            artwork = getattr(op, "artwork", False)
            nameable = op.polys or op.disc or op.ring or op.crescents or op.path
            if artwork or not nameable or (op.fill is None) or (op.fill == "none" and not op.stroke):
                if op.fill == "none" and op.tag != "g" and "stroke" not in op.style and not artwork:
                    i += 1
                    continue
                self.pending_svg.append(op)
                self.reasons.append("artwork" if artwork else op.reason or "unknown")
                i += 1
                continue
            consumed = self.quarters(ops, i) or self.strips(ops, i) or self.cross(ops, i) or self.single(op)
            i += consumed
        self.flush()

    def effect(self, op):
        if op.opacity >= 0.9995:
            return []
        return [f"opacity {fmt(op.opacity)}"]

    def charge(self, shape, fill, params, center, effect, box=None):
        """Queues a charge, so that runs of like charges can become repeats."""
        self.flush()
        self.stats["native"] += 1
        self.layers.append(dict(kind="charge", shape=shape, fill=fill, params=tuple(params), at=center,
                                effect=tuple(effect), box=box))

    def add(self, line, body=()):
        self.flush()
        self.stats["native"] += 1
        if body:
            self.layers.append(line + " {\n" + "".join(f"  {b}\n" for b in body) + "}")
        else:
            self.layers.append(line)

    def strip_box(self, op, axis):
        if op.stroke or not op.polys or len(op.polys) != 1 or op.opacity < 0.9995 or getattr(op, "artwork", False):
            return None
        box = self.rect_of(op.polys[0])
        if box is None or not self.covers(box, axis):
            return None
        return box

    def strips(self, ops, start):
        """Runs of full-width or full-height rectangles are bars, however the
        drawing stacked them. Each direction gets its chance."""
        best = None
        for axis, lo, hi, size in (("fly", 1, 3, self.h), ("hoist", 0, 2, self.w)):
            run = []
            i = start
            while i < len(ops):
                if ops[i].fill in (None, "none"):
                    break
                box = self.strip_box(ops[i], axis)
                if box is None:
                    break
                run.append((box[lo], box[hi], ops[i].fill))
                i += 1
            bands = visible_bands(run, size) if run else None
            if bands is None:
                continue
            # Bars must cover the flag from edge to edge.
            if bands[0][0] > size*1e-3 or bands[-1][1] < size*(1-1e-3) or any(abs(a[1]-b[0]) > size*1e-3 for a, b in zip(bands, bands[1:])):
                continue
            if best is None or i > best[0]:
                best = (i, axis, bands, size)
        if best is None:
            return 0
        i, axis, bands, size = best
        colors = [b[2] for b in bands]
        if len(bands) == 1:
            self.add(f"field {self.color(colors[0])}")
            return i - start
        body = []
        widths = [b[1]-b[0] for b in bands]
        if max(widths) - min(widths) > size*1e-3:
            body.append("ratio " + " ".join(fmt(x) for x in simple_ratio(widths)))
        if axis == "hoist":
            body.insert(0, "along hoist")
        names = [self.color(c) for c in colors]
        # Alternating colors read better with a count than listed out.
        if len(names) >= 5 and "ratio" not in "".join(body) and all(names[k] == names[k % 2] for k in range(len(names))):
            body.append(f"count {len(names)}")
            names = names[:2]
        self.add("bars " + " ".join(names), body)
        return i - start

    def quarters(self, ops, start):
        """A field with rectangles in its corners, sharing a center, is quartered. Or
        triangles from the center to the edges, per saltire."""
        base = ops[start]
        if base.stroke or not base.polys or len(base.polys) != 1 or base.opacity < 0.9995:
            return 0
        box = self.rect_of(base.polys[0])
        if box is None or not (self.covers(box, "fly") and self.covers(box, "hoist")):
            return 0
        tol = max(self.w, self.h) * 1e-3
        taken = {}
        center = None
        i = start + 1
        while i < len(ops) and i - start <= 4:
            op = ops[i]
            if op.stroke or not op.polys or op.fill in (None, "none") or op.opacity < 0.9995 or len(op.polys) > 2:
                break
            good = True
            for poly in op.polys:
                r = self.rect_of(poly)
                if r is None or self.covers(r, "fly") or self.covers(r, "hoist"):
                    good = False
                    break
                touch = ("upper" if r[1] <= tol else "lower" if r[3] >= self.h-tol else None,
                         "hoist" if r[0] <= tol else "fly" if r[2] >= self.w-tol else None)
                if None in touch or touch in taken:
                    good = False
                    break
                inner = (r[2] if touch[1] == "hoist" else r[0], r[3] if touch[0] == "upper" else r[1])
                if center is None:
                    center = inner
                elif math.dist(center, inner) > tol:
                    good = False
                    break
                taken[touch] = op.fill
            if not good:
                break
            i += 1
        if len(taken) >= 2 and center:
            colors = [taken.get((u, h), base.fill) for u in ("upper", "lower") for h in ("hoist", "fly")]
            body = []
            if math.dist(center, (self.w/2, self.h/2)) > tol:
                body.append(f"split fly={fmt(center[0])} hoist={fmt(center[1])}")
            self.add("quarters " + " ".join(self.color(c) for c in colors), body)
            return i - start
        # Per saltire: triangles from the center out to two corners.
        c = (self.w/2, self.h/2)
        corners = [(0, 0), (self.w, 0), (self.w, self.h), (0, self.h)]
        found = {}
        i = start + 1
        while i < len(ops) and i - start <= 4:
            op = ops[i]
            if op.stroke or not op.polys or len(op.polys) != 1 or len(op.polys[0]) != 3 or op.fill in (None, "none"):
                break
            poly = op.polys[0]
            side = None
            for k in range(4):
                want = [c, corners[k], corners[(k+1) % 4]]
                if all(any(math.dist(p, q) < tol for q in poly) for p in want):
                    side = k
            if side is None:
                break
            found[side] = op.fill
            i += 1
        if len(found) >= 2:
            colors = [found.get(k, base.fill) for k in range(4)]
            self.add("quarters " + " ".join(self.color(x) for x in colors), ["diagonal"])
            return i - start
        return 0

    def cross(self, ops, start):
        if start + 1 >= len(ops):
            first = ops[start]
            if first.polys and len(first.polys) == 2 and not first.stroke and self.cross_from(first.polys, first):
                return 1
            return 0
        first = ops[start]
        if first.stroke:
            return 0
        if first.polys and len(first.polys) == 2:
            pair = [first.polys[0], first.polys[1]]
            count = 1
        else:
            second = ops[start + 1]
            if second.stroke or first.fill != second.fill or not first.polys or not second.polys or len(first.polys) != 1 or len(second.polys) != 1:
                return 0
            pair = [first.polys[0], second.polys[0]]
            count = 2
        return count if self.cross_from(pair, first) else 0

    def cross_from(self, pair, op):
        a, b = self.rect_of(pair[0]), self.rect_of(pair[1])
        if a is None or b is None or op.opacity < 0.9995:
            return False
        vertical = [x for x in (a, b) if self.covers(x, "hoist") and not self.covers(x, "fly")]
        horizontal = [x for x in (a, b) if self.covers(x, "fly") and not self.covers(x, "hoist")]
        if len(vertical) != 1 or len(horizontal) != 1:
            return False
        v, h = vertical[0], horizontal[0]
        body = [f"fly {fmt(v[0])} {fmt(v[2]-v[0])} {fmt(self.w-v[2])}",
                f"hoist {fmt(h[1])} {fmt(h[3]-h[1])} {fmt(self.h-h[3])}"]
        # A wider cross of the same center straight beneath this is its fimbriation.
        fimbriate = None
        if self.last_cross and self.last_cross[0] == len(self.layers) - 1:
            _, under, pv, ph = self.last_cross
            d = v[0]-pv[0]
            tol = max(self.w, self.h) * 1e-3
            if d > tol and all(abs(x-d) < tol for x in (pv[2]-v[2], h[1]-ph[1], ph[3]-h[3])):
                fimbriate = f"fimbriate {under} {fmt(d)}"
        if fimbriate:
            self.layers.pop()
            self.stats["native"] -= 1
            body.append(fimbriate)
        self.add(f"cross {self.color(op.fill)}", body)
        self.last_cross = (len(self.layers) - 1, self.color(op.fill), v, h)
        return True

    def single(self, op):
        """Writes a shape: its fill, then its stroke on top if it has one."""
        effect = self.effect(op)
        filled = op.fill not in (None, "none")
        fill = self.color(op.fill) if filled else None
        edge = self.color(op.stroke[0]) if op.stroke else None
        width = op.stroke[1] if op.stroke else 0
        if op.disc:
            cx, cy, r = op.disc
            box = (cx-r, cy-r, cx+r, cy+r)
            if filled:
                self.charge("disc", fill, [f"radius {fmt(r)}"], (cx, cy), effect, box)
            if edge:
                self.charge("ring", edge, [f"radius {fmt(r+width/2)}", f"inner {fmt(max(r-width/2, 1e-4))}"], (cx, cy), effect, box)
            return 1
        if op.ring:
            cx, cy, r, inner = op.ring
            self.charge("ring", self.color(op.fill), [f"radius {fmt(r)}", f"inner {fmt(inner)}"], (cx, cy), effect, (cx-r, cy-r, cx+r, cy+r))
            return 1
        if op.path:
            d, box, evenodd = op.path
            size = [f"fly {fmt(max(box[2]-box[0], 1e-3))}", f"hoist {fmt(max(box[3]-box[1], 1e-3))}"]
            data = [f'd "{d}"', f'box "{fmt(box[0])} {fmt(box[1])} {fmt(max(box[2]-box[0], 1e-3))} {fmt(max(box[3]-box[1], 1e-3))}"'] + size
            if evenodd:
                data.append("evenodd")
            center = ((box[0]+box[2])/2, (box[1]+box[3])/2)
            if filled:
                self.charge("path", fill, data, center, effect, box)
            if edge:
                self.charge("path", edge, data + [f"hollow {fmt(width)}"], center, effect, box)
            return 1
        for cx, cy, r, cut_x, cut_y, cut_r in op.crescents:
            offset = math.dist((cx, cy), (cut_x, cut_y))
            angle = math.degrees(math.atan2(cut_y-cy, cut_x-cx))
            params = [f"radius {fmt(r)}", f"inner {fmt(cut_r)}", f"offset {fmt(offset)}"]
            if abs(angle) > 1e-3:
                params.append(f"rotate {fmt(angle)}")
            self.charge("crescent", fill, params, (cx, cy), effect, (cx-r, cy-r, cx+r, cy+r))
        polys = op.polys or []
        if len(polys) == 2 and not op.stroke and self.cross_from(polys, op):
            return 1
        for poly in polys:
            if filled:
                self.polygon(poly, fill, effect, op)
            if edge:
                self.charge("polygon", edge, [f"point fly={fmt(p[0])} hoist={fmt(p[1])}" for p in poly] + [f"hollow {fmt(width)}"],
                            None, effect, bounds(poly))
        return 1

    def polygon(self, poly, fill, effect, op):
        if len(poly) > 3 and math.dist(poly[0], poly[-1]) < 1e-9:
            poly = poly[:-1]
        box = self.rect_of(poly)
        if box:
            self.rectangle(box, fill, effect)
            return
        star = regular_star(poly)
        if star:
            cx, cy, radius, inner, points, rotation = star
            body = [f"radius {fmt(radius)}"]
            if points != 5 or abs(inner - radius * math.cos(2*math.pi/points)/math.cos(math.pi/points)) > radius*1e-3:
                body.append(f"inner {fmt(inner)}")
            if points != 5:
                body.append(f"points {points}")
            if abs(rotation) > 1e-3:
                body.append(f"rotate {fmt(rotation)}")
            self.charge("star", fill, body, (cx, cy), effect, (cx-radius, cy-radius, cx+radius, cy+radius))
            self.layers[-1]["star"] = (radius, inner, points, rotation)
            return
        band = self.band(poly)
        if band and not effect:
            along, width = band
            self.flush()
            self.stats["native"] += 1
            self.layers.append(dict(kind="band", fill=fill, along=along, width=width))
            return
        chevron = self.chevron(poly)
        if chevron and not effect:
            depth, angle, apex = chevron
            body = [f"depth {fmt(depth)}"]
            if angle is not None:
                body.append(f"angle {fmt(angle)}")
            if apex is not None:
                body.append(f"apex {fmt(apex)}")
            self.add(f"chevrons {fill}", body)
            return
        lozenge = self.lozenge(poly)
        if lozenge:
            cx, cy, fly, hoist = lozenge
            self.charge("lozenge", fill, [f"fly {fmt(fly)}", f"hoist {fmt(hoist)}"], (cx, cy), effect,
                        (cx-fly/2, cy-hoist/2, cx+fly/2, cy+hoist/2))
            return
        pile = self.pile(poly)
        if pile and not effect:
            self.add(f"pile {fill}", pile)
            return
        self.charge("polygon", fill, [f"point fly={fmt(p[0])} hoist={fmt(p[1])}" for p in poly], None, effect, bounds(poly))

    def rectangle(self, box, fill, effect):
        """A rectangle on an edge or in a corner is a panel, which can hold what's on it."""
        tol = max(self.w, self.h) * 1e-3
        # A rectangle can be drawn well past the flag, but only what's on it counts.
        x0, y0, x1, y1 = max(box[0], 0.0), max(box[1], 0.0), min(box[2], self.w), min(box[3], self.h)
        box = (x0, y0, x1, y1)
        if x1-x0 <= tol*1e-2 or y1-y0 <= tol*1e-2:
            return
        left, right, top, bottom = x0 <= tol, x1 >= self.w-tol, y0 <= tol, y1 >= self.h-tol
        place = None
        if not effect:
            if top and bottom and left and not right:
                place = dict(side="hoist", width=x1-x0)
            elif top and bottom and right and not left:
                place = dict(side="fly", width=x1-x0)
            elif left and right and top and not bottom:
                place = dict(side="top", width=y1-y0)
            elif left and right and bottom and not top:
                place = dict(side="bottom", width=y1-y0)
            elif (top or bottom) and (left or right):
                place = dict(corner=("upper" if top else "lower") + "-" + ("hoist" if left else "fly"))
        if place:
            self.flush()
            self.stats["native"] += 1
            self.layers.append(dict(kind="panel", fill=fill, box=box, **place))
            return
        self.charge("rect", fill, [f"fly {fmt(x1-x0)}", f"hoist {fmt(y1-y0)}"], ((x0+x1)/2, (y0+y1)/2), effect, box)

    def lozenge(self, poly):
        """Recognizes an upright rhombus: returns its center and sizes."""
        if len(poly) == 5 and math.dist(poly[0], poly[4]) < EPS:
            poly = poly[:4]
        if len(poly) != 4:
            return None
        cx = sum(p[0] for p in poly)/4
        cy = sum(p[1] for p in poly)/4
        tol = max(self.w, self.h) * 2e-3
        xs = sorted(poly, key=lambda p: p[0])
        ys = sorted(poly, key=lambda p: p[1])
        left, right, top, bottom = xs[0], xs[3], ys[0], ys[3]
        if len({left, right, top, bottom}) != 4:
            return None
        if abs(left[1]-cy) > tol or abs(right[1]-cy) > tol or abs(top[0]-cx) > tol or abs(bottom[0]-cx) > tol:
            return None
        if abs(cx-(left[0]+right[0])/2) > tol or abs(cy-(top[1]+bottom[1])/2) > tol:
            return None
        return cx, cy, right[0]-left[0], bottom[1]-top[1]

    def pile(self, poly):
        """Recognizes a triangle or trapezoid standing on one edge of the flag."""
        if len(poly) not in (3, 4) or crosses_itself(poly):
            return None
        tol = max(self.w, self.h) * 1e-3
        for edge, onedge, along, into, length in (
                ("hoist", lambda p: p[0] <= tol, lambda p: p[1], lambda p: p[0], self.h),
                ("fly", lambda p: p[0] >= self.w-tol, lambda p: p[1], lambda p: self.w-p[0], self.h),
                ("top", lambda p: p[1] <= tol, lambda p: p[0], lambda p: p[1], self.w),
                ("bottom", lambda p: p[1] >= self.h-tol, lambda p: p[0], lambda p: self.h-p[1], self.w)):
            base = [p for p in poly if onedge(p)]
            rest = [p for p in poly if not onedge(p)]
            if len(base) != 2 or not rest or len(rest) > 2:
                continue
            a, b = sorted(along(p) for p in base)
            whole = a <= tol and b >= length-tol
            body = [] if edge == "hoist" else [f"from {edge}"]
            if not whole:
                body.append(f"base {fmt(a)} {fmt(b)}")
            if len(rest) == 1:
                tip = rest[0]
                if abs(along(tip)-(a+b)/2) <= tol:
                    body.append(f"depth {fmt(into(tip))}")
                else:
                    body.append(f"tip {fmt(along(tip))} {fmt(into(tip))}")
                return body
            lo, hi = sorted(along(p) for p in rest)
            if abs(into(rest[0])-into(rest[1])) > tol or abs((lo+hi)/2-(a+b)/2) > tol:
                continue
            return body + [f"depth {fmt(into(rest[0]))}", f"flat {fmt(hi-lo)}"]
        return None

    def band(self, poly):
        """Recognizes a straight band centered on a corner-to-corner diagonal."""
        if len(poly) != 4:
            return None
        a, b, c, d = poly
        if math.dist(a, d) > math.dist(a, b):
            a, b, c, d = b, c, d, a
        # a to b and d to c are the long sides; a to d is its width.
        if math.dist(a, b) < self.h or abs(math.dist(a, b)-math.dist(d, c)) > 1e-3*self.w:
            return None
        width = math.dist(a, d)
        mid = ((a[0]+b[0]+c[0]+d[0])/4, (a[1]+b[1]+c[1]+d[1])/4)
        if math.dist(mid, (self.w/2, self.h/2)) > 1e-3*self.w:
            return None
        ux, uy = (b[0]-a[0])/math.dist(a, b), (b[1]-a[1])/math.dist(a, b)
        if abs((d[0]-a[0])*ux + (d[1]-a[1])*uy) > 1e-3*width:
            return None
        l = math.hypot(self.w, self.h)
        for along, dx, dy in (("bend", self.w/l, self.h/l), ("bend-sinister", self.w/l, -self.h/l)):
            if abs(abs(ux*dx + uy*dy) - 1) < 1e-5:
                # It has to reach both corners' far side, or it's a shorter stripe.
                ends = [p for p in (a, b, c, d)]
                if bounds(ends)[0] <= 1e-3*self.w and bounds(ends)[2] >= self.w*(1-1e-3):
                    return along, width
        return None

    def chevron(self, poly):
        """Recognizes a chevron pointing away from the hoist."""
        tol = max(self.w, self.h) * 1e-3
        points = [p for i, p in enumerate(poly) if i == 0 or math.dist(p, poly[i-1]) > tol]
        apex = max(points, key=lambda p: p[0])
        if apex[0] <= tol:
            return None
        start = points.index(apex)
        rest = points[start+1:] + points[:start]
        if len(rest) not in (2, 3, 4):
            return None
        # Going around from the apex, it must reach the top and bottom edges or the
        # hoist, and then only run along the flag's edges, with the hoist as its back.
        for p in rest:
            on_edge = p[0] <= tol or p[1] <= tol or p[1] >= self.h - tol
            if not on_edge:
                return None
        if sum(1 for p in rest if p[0] <= tol) < 2:
            return None
        first, last = rest[0], rest[-1]
        slopes = []
        for p in (first, last):
            dy = abs(p[1]-apex[1])
            if dy <= tol:
                return None
            slopes.append((apex[0]-p[0])/dy)
        if abs(slopes[0]-slopes[1]) > 1e-2 or slopes[0] <= 0:
            return None
        depth = apex[0]
        mid = abs(apex[1]-self.h/2) <= tol
        meets_corners = mid and abs(depth - slopes[0]*self.h/2) <= tol and first[0] <= tol and last[0] <= tol
        if meets_corners:
            return depth, None, None
        angle = math.degrees(math.atan2(1, slopes[0]))
        return depth, angle, (None if mid else apex[1])

    def flush(self):
        if not self.pending_svg:
            return
        ops, self.pending_svg = self.pending_svg, []
        self.stats["inline"] += 1
        self.layers.append(inline_charge(self.r, ops, self.w, self.h))


def visible_bands(run, size):
    """Paints intervals in order, returning what's visible from one edge to the other."""
    cuts = sorted({max(0.0, min(size, x)) for lo, hi, _ in run for x in (lo, hi)} | {0.0, size})
    bands = []
    for a, b in zip(cuts, cuts[1:]):
        if b - a <= size * 1e-4:
            continue
        mid = (a + b) / 2
        color = None
        for lo, hi, c in run:
            if lo <= mid <= hi:
                color = c
        if color is None:
            if bands:
                bands.append((a, b, None))
            continue
        if bands and bands[-1][2] == color:
            bands[-1] = (bands[-1][0], b, color)
        else:
            bands.append((a, b, color))
    if not bands or any(b[2] is None for b in bands):
        return None
    return bands


def regular_star(poly):
    """Recognizes a star with evenly spaced points at two radii, or a pentagram
    drawn as five points joined in star order."""
    if len(poly) == 5:
        return pentagram(poly)
    if len(poly) < 6 or len(poly) % 2:
        return None
    cx = sum(p[0] for p in poly) / len(poly)
    cy = sum(p[1] for p in poly) / len(poly)
    radii = [math.dist(p, (cx, cy)) for p in poly]
    outer, inner = radii[0::2], radii[1::2]
    if sum(outer) < sum(inner):
        outer, inner = inner, outer
        poly = poly[1:] + poly[:1]
        radii = radii[1:] + radii[:1]
    ro, ri = sum(outer)/len(outer), sum(inner)/len(inner)
    if ri >= ro * 0.98 or ri <= 0:
        return None
    tol = ro * 5e-3
    if any(abs(r-ro) > tol for r in outer) or any(abs(r-ri) > tol for r in inner):
        return None
    n = len(poly) // 2
    step = 2*math.pi / len(poly)
    angles = [math.atan2(p[0]-cx, -(p[1]-cy)) for p in poly]
    sign = 1 if ((angles[1]-angles[0]+math.pi) % (2*math.pi) - math.pi) > 0 else -1
    for i, a in enumerate(angles):
        d = (a - angles[0] - sign*i*step + math.pi) % (2*math.pi) - math.pi
        if abs(d) > 5e-3:
            return None
    rotation = math.degrees(angles[0])
    # A star repeats every 360/n degrees, so keep the smallest equivalent turn.
    each = 360 / n
    rotation = (rotation + each/2) % each - each/2
    return cx, cy, ro, ri, n, rotation


def pentagram(poly):
    cx = sum(p[0] for p in poly) / 5
    cy = sum(p[1] for p in poly) / 5
    radii = [math.dist(p, (cx, cy)) for p in poly]
    radius = sum(radii) / 5
    if radius <= 0 or any(abs(r-radius) > 5e-3*radius for r in radii):
        return None
    angles = [math.atan2(p[0]-cx, -(p[1]-cy)) for p in poly]
    for a, b in zip(angles, angles[1:] + angles[:1]):
        # Each point has to skip one, turning 144 degrees around the center.
        turn = abs((b-a+math.pi) % (2*math.pi) - math.pi)
        if abs(turn - 4*math.pi/5) > 5e-3:
            return None
    rotation = (math.degrees(angles[0]) + 36) % 72 - 36
    return cx, cy, radius, radius * math.cos(2*math.pi/5)/math.cos(math.pi/5), 5, rotation


def color_name(hex_value):
    r, g, b = (int(hex_value[i:i+2], 16)/255 for i in (1, 3, 5))
    hi, lo = max(r, g, b), min(r, g, b)
    light = (hi+lo)/2
    sat = 0 if hi == lo else (hi-lo)/(1-abs(2*light-1))
    if sat < 0.12:
        if light < 0.15:
            return "black"
        if light > 0.92:
            return "white"
        return "grey"
    if hi == r:
        hue = ((g-b)/(hi-lo)) % 6
    elif hi == g:
        hue = (b-r)/(hi-lo) + 2
    else:
        hue = (r-g)/(hi-lo) + 4
    hue *= 60
    for limit, name in ((15, "red"), (45, "orange"), (70, "yellow"), (165, "green"), (195, "teal"),
                        (250, "blue"), (290, "purple"), (350, "pink"), (361, "red")):
        if hue < limit:
            return "brown" if name == "orange" and light < 0.4 else name


ALLOWED_ATTRS = {"transform", "d", "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2",
                 "y2", "points", "offset", "fx", "fy", "fr", "gradientUnits", "gradientTransform",
                 "spreadMethod", "clipPathUnits", "maskUnits", "maskContentUnits"}
PRESENTATION = {"fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
                "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray",
                "stroke-dashoffset", "opacity", "clip-path", "clip-rule", "mask", "stop-color",
                "stop-opacity", "color", "display", "visibility", "paint-order", "vector-effect",
                "shape-rendering", "mix-blend-mode", "isolation"}
DEF_ELEMENTS = {"linearGradient", "radialGradient", "stop", "clipPath", "mask", "defs", "g", "path", "rect",
                "circle", "ellipse", "line", "polyline", "polygon"}
REF = re.compile(r"url\(\s*[\"']?#([^\"')\s]+)[\"']?\s*\)")


def inline_charge(reader, ops, w, h):
    defs, needed = {}, []
    body = []
    for op in ops:
        body.append(render_op(reader, op, needed))
    seen = set()
    while needed:
        ref = needed.pop()
        if ref in seen:
            continue
        seen.add(ref)
        target = reader.ids.get(ref)
        if target is None:
            continue
        defs[ref] = render_def(reader, target, needed)
    defs_text = "<defs>" + "".join(defs.values()) + "</defs>" if defs else ""
    markup = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(w)} {fmt(h)}">{defs_text}{"".join(body)}</svg>'
    if '"""#' in markup:
        raise Unsupported("raw string collision")
    return (f"charge svg {{\n  at center\n  fly {fmt(w)}\n  hoist {fmt(h)}\n"
            f'  markup #"""\n{markup}\n"""#\n}}')


def attr_text(attrs):
    out = []
    for k, v in attrs.items():
        v = str(v).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
        out.append(f' {k}="{v}"')
    return "".join(out)


def matrix(m):
    return "matrix(" + " ".join(("%.6f" % v).rstrip("0").rstrip(".") or "0" for v in m) + ")"


def needs(value, needed):
    for ref in REF.findall(value or ""):
        needed.append(ref)


def paint(reader, s, needed, op_opacity=None):
    attrs = {}
    for k in PRESENTATION:
        if k in s and k != "opacity" and k not in ("display", "visibility"):
            v = s[k]
            if k in ("fill", "stroke", "clip-path", "mask"):
                needs(v, needed)
                if k in ("fill", "stroke") and "url(" not in v:
                    c = parse_color(v, s.get("color", "#000000"))
                    if c is None:
                        raise Unsupported(f"paint {v[:16]}")
                    v = c
            attrs[k] = v
    if op_opacity is not None and op_opacity < 0.9995:
        attrs["opacity"] = fmt(op_opacity)
    return attrs


def render_op(reader, op, needed):
    if op.tag == "g":
        attrs = paint(reader, op.style, needed, op.opacity * number(op.style.get("opacity"), 1.0))
        attrs["transform"] = matrix(op.ctm)
        inner = "".join(render_def_child(reader, c, needed, op.style) for c in op.elem)
        return f"<g{attr_text(attrs)}>{inner}</g>"
    attrs = {k: op.elem.get(k) for k in ALLOWED_ATTRS if op.elem.get(k) is not None}
    attrs.update(paint(reader, op.style, needed, op.opacity))
    attrs["transform"] = matrix(op.ctm)
    return f"<{op.tag}{attr_text(attrs)}/>"


def render_def_child(reader, e, needed, parent, in_clip=False):
    if not isinstance(e.tag, str):
        return ""
    tag = local(e.tag)
    if tag == "use":
        ref = (e.get("href") or e.get(XLINK) or "").lstrip("#")
        target = reader.ids.get(ref)
        if target is None:
            return ""
        t = multiply(parse_transform(e.get("transform")), (1, 0, 0, 1, number(e.get("x")), number(e.get("y"))))
        s = reader.styled(e, parent)
        if in_clip:
            # A clipPath can only hold shapes directly, so the transform moves onto one.
            if local(target.tag) == "g" or local(target.tag) not in DEF_ELEMENTS:
                raise Unsupported("use of a group in a clip")
            attrs = {k: target.get(k) for k in ALLOWED_ATTRS if target.get(k) is not None}
            attrs["transform"] = matrix(multiply(t, parse_transform(target.get("transform"))))
            return f"<{local(target.tag)}{attr_text(attrs)}/>"
        return f'<g transform="{matrix(t)}">' + render_def_child(reader, target, needed, s) + "</g>"
    if tag in ("title", "desc", "metadata"):
        return ""
    if tag not in DEF_ELEMENTS:
        raise Unsupported(f"element {tag}")
    s = reader.styled(e, parent) if tag not in ("stop",) else parse_stop(reader, e)
    attrs = {k: e.get(k) for k in ALLOWED_ATTRS if e.get(k) is not None}
    attrs.update(paint(reader, s, needed, number(s.get("opacity"), 1.0)) if tag not in ("defs",) else {})
    inner = "".join(render_def_child(reader, c, needed, s) for c in e)
    return f"<{tag}{attr_text(attrs)}>{inner}</{tag}>"


def parse_stop(reader, e):
    s = {}
    for k in ("stop-color", "stop-opacity", "offset"):
        if e.get(k) is not None:
            s[k] = e.get(k)
    s.update({k: v for k, v in parse_style(e.get("style")).items() if k in ("stop-color", "stop-opacity")})
    return s


def render_def(reader, target, needed):
    tag = local(target.tag)
    if tag == "pattern":
        raise Unsupported("element pattern")
    if tag == "filter":
        raise Unsupported("filter")
    if tag not in DEF_ELEMENTS:
        raise Unsupported(f"element {tag}")
    ref = target.get("id")
    attrs = {"id": ref}
    attrs.update({k: target.get(k) for k in ALLOWED_ATTRS if target.get(k) is not None})
    href = (target.get("href") or target.get(XLINK) or "").lstrip("#")
    if href:
        attrs["href"] = "#" + href
        needed.append(href)
    parent = {}
    s = reader.styled(target, parent)
    if tag in ("clipPath", "mask"):
        attrs.update({k: v for k, v in paint(reader, s, needed).items()})
    inner = "".join(render_stop(c) if local(c.tag) == "stop" else render_def_child(reader, c, needed, s, tag == "clipPath") for c in target if isinstance(c.tag, str))
    return f"<{tag}{attr_text(attrs)}>{inner}</{tag}>"


def render_stop(e):
    s = parse_stop(None, e)
    attrs = {}
    if e.get("offset") is not None:
        attrs["offset"] = e.get("offset")
    for k in ("stop-color", "stop-opacity"):
        if k in s:
            attrs[k] = s[k]
    return f"<stop{attr_text(attrs)}/>"


def convert(source, name, url=None, encoder=None, license_id=None, note=None, series=None):
    root = ET.fromstring(source)
    if local(root.tag) != "svg":
        raise Unsupported("not svg")
    reader = Reader(root)
    start = reader.start
    style = {}
    if root.get("style"):
        style.update(parse_style(root.get("style")))
    for k in INHERITED:
        if root.get(k) is not None:
            style[k] = root.get(k)
    root_ctm = multiply(start, parse_transform(root.get("transform")))
    for child in root:
        reader.walk(child, root_ctm, style, 1.0)
    if not reader.ops:
        raise Unsupported("nothing drawn")
    writer = Writer(reader)
    writer.convert(reader.ops)
    lines = ["// Imported mechanically by tools/svg2vexyl.py. This describes a drawing, not the",
             "// flag's official construction, and it hasn't been checked against one."]
    if note:
        lines.append("// " + note)
    lines += ["vexyl 1", "meta {", f"  name {kdl_string(name)}"]
    if series:
        lines.append(f"  series {kdl_string(series)}")
    if encoder:
        lines.append(f"  encoder {kdl_string(encoder)}")
    if license_id:
        lines.append(f"  license {kdl_string(license_id)}")
    if url:
        lines.append(f"  source {kdl_string(url)}")
    lines.append("}")
    body = "\n\n".join(render_layers(writer.layers, reader.w, reader.h))
    lines.append("palette {")
    for value, color in writer.palette.items():
        if not isinstance(value, tuple):
            lines.append(f'  {color} "{value}"')
    for value, color in writer.palette.items():
        if isinstance(value, tuple):
            _, colors, stops, along = value
            head = f"  {color} gradient " + " ".join(writer.palette[c] for c in colors)
            if along != "fly":
                head += f" along={along}"
            even = all(abs(x - i/(len(stops)-1)) < 1e-3 for i, x in enumerate(stops))
            if even:
                lines.append(head)
            else:
                lines += [head + " {", "    stops " + " ".join(fmt(x) for x in stops), "  }"]
    lines.append("}")
    lines.append(f"proportion hoist={fmt(reader.h)} fly={fmt(reader.w)}")
    if writer.outline:
        lines += outline_lines(writer.outline, reader.w, reader.h)
    lines.append("")
    lines.append(body)
    writer.stats["reasons"] = writer.reasons
    return "\n".join(lines) + "\n", writer.stats


def simple_ratio(widths):
    """Scales widths so a whole-number ratio reads as one, if it nearly is."""
    smallest = min(widths)
    for divisor in (1, 2, 3, 4, 5, 6, 8, 10, 12):
        scaled = [w/smallest*divisor for w in widths]
        if all(abs(x-round(x)) < 0.01 for x in scaled):
            return [float(round(x)) for x in scaled]
    return widths


def render_layers(layers, w, h):
    """Writes layers out: panels take in the charges on them, saltires and fimbriation are
    gathered from their parts, and runs of like charges become repeats."""
    return write_layers(merge_ordinaries(layers), w, h)


def merge_ordinaries(layers):
    out = []
    for layer in layers:
        if isinstance(layer, dict) and layer["kind"] == "band" and out and isinstance(out[-1], dict):
            prev = out[-1]
            same_width = abs(prev.get("width", -1)-layer["width"]) < 1e-3*layer["width"]
            if prev["kind"] == "band" and prev["fill"] == layer["fill"] and same_width and prev["along"] != layer["along"]:
                out[-1] = dict(kind="saltire", fill=layer["fill"], width=layer["width"])
                continue
            if prev["kind"] == "band" and prev["along"] == layer["along"] and prev["width"] > layer["width"]:
                out[-1] = dict(layer, fimbriate=(prev["fill"], (prev["width"]-layer["width"])/2))
                continue
        if isinstance(layer, dict) and layer["kind"] == "saltire":
            out.append(layer)
            continue
        out.append(layer)
    # A wider saltire straight beneath another is its fimbriation.
    merged = []
    for layer in out:
        if merged and isinstance(layer, dict) and layer["kind"] == "saltire" and isinstance(merged[-1], dict) \
                and merged[-1]["kind"] == "saltire" and merged[-1]["width"] > layer["width"]:
            merged[-1] = dict(layer, fimbriate=(merged[-1]["fill"], (merged[-1]["width"]-layer["width"])/2))
            continue
        merged.append(layer)
    return merged


def write_layers(layers, w, h, origin=(0.0, 0.0)):
    out, i = [], 0
    while i < len(layers):
        layer = layers[i]
        if isinstance(layer, str):
            out.append(layer)
            i += 1
        elif layer["kind"] in ("band", "saltire"):
            body = []
            if layer["kind"] == "band":
                body.append(f"along {layer['along']}")
            body.append(f"width {fmt(layer['width'])}")
            if "fimbriate" in layer:
                body.append(f"fimbriate {layer['fimbriate'][0]} {fmt(layer['fimbriate'][1])}")
            out.append(f"{layer['kind']} {layer['fill']} {{\n" + "".join(f"  {b}\n" for b in body) + "}")
            i += 1
        elif layer["kind"] == "panel":
            x0, y0, x1, y1 = layer["box"]
            j = i + 1
            inside_it = []
            margin = max(x1-x0, y1-y0) * 1e-3
            while j < len(layers) and isinstance(layers[j], dict) and layers[j]["kind"] == "charge":
                b = layers[j].get("box")
                if not b or b[0] < x0-margin or b[1] < y0-margin or b[2] > x1+margin or b[3] > y1+margin:
                    break
                inside_it.append(layers[j])
                j += 1
            out.append(panel_text(layer, inside_it))
            i = j
        else:
            key = (layer["shape"], layer["fill"], layer["params"], layer["effect"])
            j = i
            while j < len(layers) and isinstance(layers[j], dict) and layers[j]["kind"] == "charge" and \
                    (layers[j]["shape"], layers[j]["fill"], layers[j]["params"], layers[j]["effect"]) == key:
                j += 1
            run = layers[i:j]
            i = j
            # A disc on top of a star at the same place is a sun.
            if len(run) == 1 and run[0]["shape"] == "star" and i < len(layers) and isinstance(layers[i], dict) \
                    and layers[i]["kind"] == "charge" and layers[i]["shape"] == "disc" and layers[i]["fill"] == run[0]["fill"]:
                sun = sun_text(run[0], layers[i])
                if sun:
                    out.append(sun)
                    i += 1
                    continue
            out.extend(charge_run(run[0], [c["at"] for c in run], w, h, origin))
    return out


def sun_text(star, disc):
    radius, inner, points, rotation = star["star"]
    r = float(disc["params"][0].split()[1])
    if math.dist(star["at"], disc["at"]) > radius*1e-3 or r > inner*(1+1e-3):
        return None
    body = [f"radius {fmt(radius)}", f"disc {fmt(r)}", f"points {points}"]
    if inner - r > radius*1e-3:
        body.append(f"gap {fmt(inner-r)}")
    if abs(rotation) > 1e-3:
        body.append(f"rotate {fmt(rotation)}")
    body.append(f"at fly={fmt(star['at'][0])} hoist={fmt(star['at'][1])}")
    return f"charge sun {star['fill']} {{\n" + "".join(f"  {b}\n" for b in body) + "}"


def panel_text(panel, charges):
    x0, y0, x1, y1 = panel["box"]
    w, h = x1-x0, y1-y0
    if "side" in panel:
        head, body = "panel", [f"side {panel['side']}", f"width {fmt(panel['width'])}"]
    elif panel["corner"] == "upper-hoist":
        head, body = "canton", [f"fly {fmt(w)}", f"hoist {fmt(h)}"]
    else:
        head, body = "panel", [f"corner {panel['corner']}", f"fly {fmt(w)}", f"hoist {fmt(h)}"]
    body.append(f"field {panel['fill']}")
    inner = []
    if charges:
        inner = write_layers(charges, w, h, (x0, y0))
    text = head + " {\n" + "".join(f"  {b}\n" for b in body)
    for block in inner:
        text += "".join(f"  {line}\n" for line in block.splitlines())
    return text + "}"


def charge_body(layer, origin):
    """A charge's parameters, with any points moved into the region it's in."""
    body = []
    for line in layer["params"]:
        m = re.fullmatch(r"point fly=(\S+) hoist=(\S+)", line)
        if m:
            body.append(f"point fly={fmt(float(m[1])-origin[0])} hoist={fmt(float(m[2])-origin[1])}")
        else:
            body.append(line)
    return body


def charge_text(layer, ats, origin, repeat=None):
    body = charge_body(layer, origin)
    for at in ats:
        body.append(f"at fly={fmt(at[0]-origin[0])} hoist={fmt(at[1]-origin[1])}")
    body += list(layer["effect"])
    if repeat:
        body.append(repeat)
    return f"charge {layer['shape']} {layer['fill']} {{\n" + "".join(f"  {b}\n" for b in body) + "}"


def charge_run(layer, points, w, h, origin):
    if layer["shape"] == "polygon":
        return [charge_text(layer, [], origin)]
    local = [(p[0]-origin[0], p[1]-origin[1]) for p in points]
    grid = grid_of(local, w, h)
    if grid:
        rows, columns, stagger = grid
        extra = " stagger=#true" if stagger else ""
        return [charge_text(layer, [], origin, f"repeat grid rows={rows} columns={columns}{extra}")]
    ring = ring_of(points)
    if ring:
        center, radius = ring
        return [charge_text(layer, [center], origin, f"repeat ring count={len(points)} radius={fmt(radius)}")]
    arc = arc_of(points)
    if arc:
        center, radius, start, end = arc
        return [charge_text(layer, [center], origin, f"repeat arc count={len(points)} radius={fmt(radius)} from={fmt(start)} to={fmt(end)}")]
    if len(points) >= 3:
        step = (points[1][0]-points[0][0], points[1][1]-points[0][1])
        size = max(math.hypot(*step), 1e-9)
        if all(math.dist((b[0]-a[0], b[1]-a[1]), step) < 1e-3*size for a, b in zip(points, points[1:])):
            parts = [f"count={len(points)}"]
            if abs(step[0]) > 1e-9:
                parts.append(f"fly={fmt(step[0])}")
            if abs(step[1]) > 1e-9:
                parts.append(f"hoist={fmt(step[1])}")
            return [charge_text(layer, [points[0]], origin, "repeat line " + " ".join(parts))]
    return [charge_text(layer, points, origin)]


def grid_of(points, w, h):
    """Finds points spread evenly across a region, full or staggered."""
    if len(points) < 4:
        return None
    tol = max(w, h) * 2e-3
    def levels(values):
        out = []
        for v in sorted(values):
            if not out or v-out[-1] > tol:
                out.append(v)
        return out
    xs, ys = levels(p[0] for p in points), levels(p[1] for p in points)
    columns, rows = len(xs), len(ys)
    if columns < 2 or rows < 2:
        return None
    if any(abs(x-w*(i+1)/(columns+1)) > tol for i, x in enumerate(xs)) or any(abs(y-h*(i+1)/(rows+1)) > tol for i, y in enumerate(ys)):
        return None
    cells = set()
    for p in points:
        c = min(range(columns), key=lambda i: abs(xs[i]-p[0]))
        r = min(range(rows), key=lambda i: abs(ys[i]-p[1]))
        cells.add((r, c))
    if len(cells) != len(points):
        return None
    if len(cells) == rows*columns:
        return rows, columns, False
    if cells == {(r, c) for r in range(rows) for c in range(columns) if (r+c) % 2 == 0}:
        return rows, columns, True
    return None


def ring_of(points):
    """Finds evenly spaced points around a center, with one straight up."""
    n = len(points)
    if n < 3:
        return None
    cx = sum(p[0] for p in points)/n
    cy = sum(p[1] for p in points)/n
    radii = [math.dist(p, (cx, cy)) for p in points]
    radius = sum(radii)/n
    if radius <= 0 or any(abs(r-radius) > 2e-3*radius for r in radii):
        return None
    step = 360/n
    for angle in sorted(math.degrees(math.atan2(p[0]-cx, -(p[1]-cy))) % 360 for p in points):
        off = (angle + step/2) % step - step/2
        if abs(off) > 0.3:
            return None
    return (cx, cy), radius


def arc_of(points):
    """Finds points evenly spaced along part of a circle."""
    n = len(points)
    if n < 4:
        return None
    ordered = sorted(points, key=lambda p: p[0])
    (x1, y1), (x2, y2), (x3, y3) = ordered[0], ordered[n//2], ordered[-1]
    det = x1*(y2-y3) - y1*(x2-x3) + x2*y3 - x3*y2
    if abs(det) < 1e-9:
        return None
    b = (x1*x1+y1*y1)*(y3-y2) + (x2*x2+y2*y2)*(y1-y3) + (x3*x3+y3*y3)*(y2-y1)
    c = (x1*x1+y1*y1)*(x2-x3) + (x2*x2+y2*y2)*(x3-x1) + (x3*x3+y3*y3)*(x1-x2)
    cx, cy = -b/(2*det), -c/(2*det)
    radius = math.dist(points[0], (cx, cy))
    if any(abs(math.dist(p, (cx, cy))-radius) > 3e-3*radius for p in points):
        return None
    angles = sorted(math.degrees(math.atan2(p[0]-cx, -(p[1]-cy))) for p in points)
    steps = [b2-a for a, b2 in zip(angles, angles[1:])]
    mean = sum(steps)/len(steps)
    if mean < 2 or any(abs(s-mean) > 0.5 for s in steps):
        return None
    return (cx, cy), radius, angles[0], angles[-1]


def outline_lines(poly, w, h):
    """Names a swallowtail, tongued or pennant outline, if that's what it is."""
    tol = max(w, h) * 2e-3
    near = lambda a, b: math.dist(a, b) <= tol
    points = list(poly)
    if len(points) > 1 and near(points[0], points[-1]):
        points = points[:-1]
    # Start from the top of the hoist, going clockwise.
    if any(near(p, (0, 0)) for p in points):
        k = next(i for i, p in enumerate(points) if near(p, (0, 0)))
        points = points[k:] + points[:k]
        if len(points) > 1 and points[1][0] <= tol:
            points = [points[0]] + points[1:][::-1]
        if len(points) == 5 and near(points[1], (w, 0)) and near(points[3], (w, h)) and near(points[4], (0, h)) \
                and abs(points[2][1]-h/2) <= tol:
            return ["outline swallowtail {", f"  depth {fmt(w-points[2][0])}", "}"]
        if len(points) == 7 and near(points[1], (w, 0)) and near(points[3], (w, h/2)) and near(points[5], (w, h)) and near(points[6], (0, h)) \
                and abs(points[2][0]-points[4][0]) <= tol and abs(points[2][1]+points[4][1]-h) <= tol:
            return ["outline tongued {", f"  depth {fmt(w-points[2][0])}", f"  tongue {fmt(points[4][1]-points[2][1])}", "}"]
        if len(points) == 3 and near(points[1], (w, h/2)) and near(points[2], (0, h)):
            return ["outline pennant"]
        if len(points) == 4 and abs(points[1][0]-w) <= tol and abs(points[2][0]-w) <= tol and near(points[3], (0, h)) \
                and abs(points[1][1]+points[2][1]-h) <= tol:
            return ["outline pennant {", f"  tip {fmt(points[2][1]-points[1][1])}", "}"]
    return ["outline {", "  polygon {"] + [f"    point fly={fmt(p[0])} hoist={fmt(p[1])}" for p in poly] + ["  }", "}"]


def kdl_string(text):
    out = text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ").replace("\r", " ").replace("\t", " ")
    return '"' + out + '"'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("file")
    ap.add_argument("--name", default="Imported Flag")
    ap.add_argument("--source")
    ap.add_argument("--encoder")
    ap.add_argument("--license")
    args = ap.parse_args()
    with open(args.file, "rb") as f:
        source = f.read()
    try:
        text, _ = convert(source, args.name, args.source, args.encoder, args.license)
    except Unsupported as e:
        print(f"unsupported: {e}", file=sys.stderr)
        return 1
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
