# Vexyl format specification

**Status:** draft 1. Nothing here is stable yet.

Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>. This
specification is licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

Vexyl describes a flag the way a flag specification does: its proportion, its
divisions, the ordinaries and charges on them, and the construction sizes that
place them. Renderers turn that description into an image. SVG is the first
target, but the format isn't a vector format, and paths are not its vocabulary.

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119. The
algorithms are pseudocode. An implementation can be written differently as long
as it produces the same geometry.

## 1. Scope

Vexyl covers flags built from geometry.

Lettering and seals have no primitives, and none are planned. A design that
really needs one can embed it with the SVG escape hatch (§8.3).

A document is self-contained. Everything needed to render it is in the file, so
it can be shared alone, and a renderer never needs the filesystem or network to
draw it. Documents can come from anyone, so renderers MUST treat them as
untrusted.

## 2. Vocabulary

| Term | Meaning |
|---|---|
| hoist | The edge nearest the pole, and the flag's vertical dimension |
| fly | The flag's horizontal dimension, running away from the pole |
| field | A solid background |
| division | A pattern that fills its region: `bars`, `chevrons` |
| ordinary | A band across its region: `band`, `cross`, `saltire` |
| charge | A shape placed at a position: `charge` |
| canton | A rectangular panel in the upper hoist corner |
| emblem | Charges drawn together in their own frame, like a taegeuk |
| fimbriation | A narrow contrasting edge around an ordinary or charge |
| bend | The diagonal from the top of the hoist to the bottom of the fly |
| bend sinister | The diagonal from the bottom of the hoist to the top of the fly |

Everything describes the obverse, with the hoist on the viewer's left.

## 3. Coordinates

`proportion hoist=H fly=F` sets the flag's shape and its construction grid. One
grid unit is the same physical length in both directions. `hoist=10 fly=16` is a
5:8 flag on a grid 16 units wide, so its sizes can be copied from a construction
sheet.

A position is written `fly=A hoist=B`:

- `fly` is the distance from the hoist edge of the current region.
- `hoist` is the distance down from the top of the current region.

In a target's coordinates, that makes `x = fly` and `y = hoist`, with y pointing
down.

Angles are in degrees, and positive angles turn clockwise as seen by the viewer:

```
rotate(v, a) = (v.x * cos(a) - v.y * sin(a),
                v.x * sin(a) + v.y * cos(a))
```

## 4. Documents

A document is KDL v2. Its top-level nodes MUST appear in this order:

```
vexyl 1              required; the format version
meta { ... }         required
palette { ... }      required
proportion ...       required
outline { ... }      optional, §9
border ...           optional, §9
<layers>             painted first to last, §6
```

A renderer MUST reject an unknown format version, unknown nodes and unknown
properties. Flags are exact constructions, so a silently ignored instruction
would produce a wrong flag.

### 4.1 meta

| Node | Required | Meaning |
|---|---|---|
| `name` | yes | The flag's name |
| `description` | no | Prose description |
| `designer` | no, repeatable | Who designed the flag |
| `design-rights` | no | Rights in the design, as free text or an SPDX ID |
| `encoder` | no, repeatable | Who wrote this file |
| `license` | no | License of this file, as an SPDX ID |
| `source` | no, repeatable | URL of the specification or reference used |

A design and its encoding can have different owners, so they are separate.

### 4.2 palette

Each child names a color: `gold "#fcd116"`. Values MUST be `#rrggbb`.

Layers refer to colors only by name. A color used but not defined is an error.

A child can instead define a linear gradient between other palette colors, which
can then be used wherever a color is:

```kdl
palette {
  pink "#ffb0ca"
  butter "#f6f1ad"
  sky "#9bdaec"
  pastel gradient pink butter sky
  dawn gradient pink sky along=hoist {
    stops 0.25 1
  }
}
```

`along` is an axis from §7.2, and defaults to `fly`. `stops` gives each color's
position from 0 to 1, in order, and defaults to even spacing. A gradient needs at
least two colors, which MUST be solid colors from the palette, in any order. The
colors blend in sRGB, without gamma correction.

A gradient spans the bounding box of the shape it fills, with `t` running from 0 to
1 across that box. On the `bend` axes, `t` runs between opposite corners and its
lines of equal color run parallel to the other diagonal of the box, so they follow
the box's proportions just as the axes follow the flag's:

```
function t(point, box, along):
    u = (point.x - box.x) / box.width
    v = (point.y - box.y) / box.height
    case along:
        fly:           return u
        hoist:         return v
        bend:          return (u + v) / 2
        bend-sinister: return (u + 1 - v) / 2
```

What counts as the shape:

- A bar is its own width and the part inside the region.
- A chevron is the part inside the region, from its edge to its apex.
- A `cross` or `saltire` is the whole region, because its arms are one shape.
- Each copy from a `repeat` is its own shape.
- A border or fimbriation is the shape that it edges.

A gradient can't be the color of a `charge svg`, or a color in another gradient.

## 5. Regions

Every layer paints within a region: a rectangle with an origin, a `width` and a
`height`, measured in grid units. The root region is the whole flag:

```
root = Region(origin = (0, 0), width = F, height = H)
center(region) = (region.width / 2, region.height / 2)
```

Layer coordinates are relative to the region's origin. A renderer MUST clip all
painting to the current region.

## 6. Painting

```
function paint_flag(doc):
    shape = doc.outline or rectangle of the root region
    if doc.border is outside:
        outer = offset_polygon(shape, doc.border.width)
        target = new_surface(bounding_box(outer))
        target.fill(doc.border.color, outer)
    else:
        target = new_surface(rectangle of the root region)
    target.push_clip(shape)
    paint_layers(doc.layers, root, target)
    if doc.border is inside: stroke(shape, doc.border.color, 2 * doc.border.width)
    target.pop_clip()

function paint_layers(layers, region, target):
    for layer in layers:
        target.begin_layer(layer.opacity, layer.blend)
        target.push_clip(region)
        if layer.clip: target.push_clip(shape(layer.clip, region))
        if layer.cuts: target.push_mask_excluding(shapes(layer.cuts, region))
        paint_content(layer, region, target)
        target.pop_all_pushed_by_this_layer()
        target.end_layer()
```

### 6.1 Properties common to all layers

| Child | Meaning |
|---|---|
| `opacity N` | From 0 to 1; default 1 |
| `blend MODE` | `normal` (default), `multiply`, `screen`, `overlay`, `darken`, `lighten` |
| `clip { SHAPE }` | Keep only what's inside the shape |
| `cut { SHAPE }` | Remove what's inside the shape; repeatable |

A `cut` removes only that layer's own paint, so layers beneath it show through.
To cut through several layers, put them in a `group` and cut the group.

A `blend` mixes a layer with what's beneath it in the same `group` or `canton`,
or on the flag at the top level. A group or canton is composited as a unit, so
its children never blend with anything outside it.

The shapes in `clip` and `cut` use the coordinates of the region the layer sits
in. They apply to the layer as a whole, after any `repeat`.

## 7. Divisions and ordinaries

### 7.1 field

`field COLOR` fills the region.

### 7.2 Axes

`bars` and `band` take `along AXIS`. The normal gives the direction in which
bars are listed:

```
function axis(region, along, rotation):
    W, H = region.width, region.height
    L = sqrt(W*W + H*H)
    case along:
        fly:          dir = (1, 0);        normal = (0, 1)
        hoist:        dir = (0, 1);        normal = (1, 0)
        bend:         dir = (W/L, H/L);    normal = (H/L, -W/L)
        bend-sinister: dir = (W/L, -H/L);  normal = (H/L, W/L)
    return rotate(dir, rotation), rotate(normal, rotation)
```

So the first bar is always the top bar or the one nearest the hoist. The bend
axes follow the flag's corners at any proportion, which a fixed angle can't do.

### 7.3 bars

```
bars COLOR... { along AXIS; ratio N...; count N; rotate DEGREES }
```

`along` defaults to `fly`, which gives horizontal bars. `ratio` defaults to equal
widths, and its length MUST equal the number of bars. `count N` cycles through
the colors until there are N bars. Widths are measured across the bars, not along
the region's edge.

```
function paint_bars(bars, region, target):
    dir, normal = axis(region, bars.along, bars.rotate)
    c = center(region)
    offsets = [dot(corner - c, normal) for corner in corners(region)]
    lo, hi = min(offsets), max(offsets)
    reach = length of region diagonal
    t = lo
    for i, color in bars.colors:
        next = t + (hi - lo) * bars.ratio[i] / sum(bars.ratio)
        target.fill(color, polygon(
            c + normal*t    - dir*reach,
            c + normal*t    + dir*reach,
            c + normal*next + dir*reach,
            c + normal*next - dir*reach))
        t = next
```

Renderers MAY extend each bar under the ones after it, as long as the visible
result is the same. This stops antialiasing from showing a hairline of whatever
lies beneath the flag between adjacent bars.

### 7.4 chevrons

```
chevrons COLOR... { from EDGE; depth D; angle DEGREES; apex N; ratio N...; rotate DEGREES }
```

Chevrons nest outward from an edge. Colors are listed from that edge outward, so
the first is the innermost. `from` is `hoist` (default), `fly`, `top` or `bottom`.

`depth` is REQUIRED. It's the distance from the edge to the outermost apex,
measured along the center line, and `ratio` divides it. `angle` is the angle
between each arm and the center line. By default, the outermost arms meet the
corners of the edge.

`apex` moves the center line along the edge, so the apex needn't be in the flag's
middle. It's measured down from the top for `hoist` and `fly`, and from the hoist
for `top` and `bottom`, and defaults to the edge's middle. An `apex` REQUIRES an
`angle`, because one slope can't meet both corners from off-center.

Each chevron is the previous one moved along the center line, so arms stay
parallel. Space beyond the outermost chevron is left unpainted.

```
function paint_chevrons(ch, region, target):
    origin, axis_u, axis_v, edge_length = edge_frame(region, ch.from)
    if ch.angle: run = (edge_length / 2) / tan(ch.angle)
    else:        run = ch.depth
    reach = length of region diagonal
    if ch.apex is set:
        origin = origin + axis_v * (ch.apex - edge_length / 2)
        reach = reach + abs(ch.apex - edge_length / 2)
    slope = run / (edge_length / 2)
    apexes = running sums of ch.depth * ch.ratio[i] / sum(ch.ratio)
    for i from last color down to first:
        a = apexes[i]
        back = min(a - slope*reach, 0) - reach
        points = [(a, 0),
                  (a - slope*reach,  reach),
                  (back,             reach),
                  (back,            -reach),
                  (a - slope*reach, -reach)]
        target.fill(ch.colors[i],
                    polygon(to_region(p, origin, axis_u, axis_v, ch.rotate, region)
                            for p in points))

function edge_frame(region, from):
    W, H = region.width, region.height
    case from:
        hoist:  origin = (0, H/2); u = (1, 0);  v = (0, 1); edge = H
        fly:    origin = (W, H/2); u = (-1, 0); v = (0, 1); edge = H
        top:    origin = (W/2, 0); u = (0, 1);  v = (1, 0); edge = W
        bottom: origin = (W/2, H); u = (0, -1); v = (1, 0); edge = W
    return origin, u, v, edge

function to_region(p, origin, u, v, rotation, region):
    point = origin + u*p.u + v*p.v
    return center(region) + rotate(point - center(region), rotation)
```

### 7.5 band

```
band COLOR { along AXIS; width N; offset N; rotate DEGREES; fimbriate COLOR W }
```

A straight band of the given width, centered on the region's center. `offset`
moves it along the axis normal. `along` defaults to `fly`.

### 7.6 cross

```
cross COLOR { fly A W B; hoist C W D; fimbriate COLOR W }
```

Both children read as a construction sheet does: the distance before the arm, the
arm's width, and the distance after it. Sweden's `fly 5 2 9` and `hoist 4 2 4` are
its official 5:2:9 and 4:2:4. Each triple is a ratio, scaled to span the region.

```
function paint_cross(cross, region, target):
    a, w, b = cross.fly
    x0 = region.width  * a / (a + w + b)
    x1 = region.width  * (a + w) / (a + w + b)
    c, h, d = cross.hoist
    y0 = region.height * c / (c + h + d)
    y1 = region.height * (c + h) / (c + h + d)
    paint vertical rectangle x0..x1, 0..region.height
    paint horizontal rectangle 0..region.width, y0..y1
```

### 7.7 saltire

```
saltire COLOR { width N; fimbriate COLOR W }
```

A `band` along `bend` and another along `bend-sinister`, painted as one shape.

### 7.8 Fimbriation

`fimbriate COLOR W` paints the ordinary or charge's shape, expanded outward by `W`
grid units with mitered corners, in `COLOR` beneath the shape. For a cross or
saltire, the expanded arms are one shape, so the edge never crosses the center.

## 8. Charges

```
charge SHAPE COLOR {
    at center | at fly=A hoist=B    // default center
    rotate DEGREES                  // about the position
    fimbriate COLOR W
    repeat ...
    <shape parameters>
}
```

### 8.1 Shapes

These are written as they would appear in a `charge`, `clip` or `cut`. Each shape
is centered on its position, except where noted.

| Shape | Parameters | Geometry at rotation 0 |
|---|---|---|
| `disc` | `radius` | Circle |
| `ring` | `radius`, `inner` | Circle with a concentric hole |
| `rect` | `fly`, `hoist` | Rectangle with those sizes |
| `plus` | `radius`, `width` | Equal-armed cross with arms of length `radius` from the center |
| `triangle` | `radius` | Equilateral triangle, one point up |
| `star` | `radius`, `points` (default 5), `inner` | Star with one point up |
| `heart` | `radius`, `spread` | Tip down; the position is midway between the lobes' centers; see below |
| `cardioid` | `radius` | Cusp at the position, lobe below it; see below |
| `polygon` | `point fly=A hoist=B`, at least 3 | Points relative to the current region |

A `polygon` is already placed by its points, so it MUST NOT have `at`, `rotate`
or `repeat`.

The default `inner` of a star is that of the regular star polygon {n/2}:

```
inner = radius * cos(2*pi/n) / cos(pi/n)     // n >= 5
```

For `n < 5`, `inner` is REQUIRED.

The outer points of a star lie at `angle = i * 360 / n` clockwise from up, with
the inner points halfway between them.

A heart is two discs of the given `radius`, with their centers `spread` apart, and
two straight sides that meet at a right angle at its tip and touch the discs. The
`spread` defaults to `radius * sqrt(2)`, the classic heart of a square with a
semicircle on each of two sides, and it MUST be less than `2 * radius`.

```
half = spread / 2
edge = radius / sqrt(2)
tip   = at + (0, half + radius * sqrt(2))
right = at + (half + edge, edge)        // where the side touches the disc
left  = at + (-half - edge, edge)
notch = at + (0, -sqrt(radius^2 - half^2))
outline: tip, line to right, arc to notch, arc to left, line to tip
```

A cardioid is the mathematical curve, and it's narrower at the cusp than most
hearts drawn on flags. A cardioid's farthest point lies `radius` from the cusp:

```
r(t) = radius * (1 - cos(t)) / 2       // t from 0 to 360
point(t) = at + (r(t) * sin(t), -r(t) * cos(t))
```

Renderers MAY approximate curves if the error stays under 0.1% of the flag's hoist.

### 8.2 repeat

`repeat` paints the charge several times.

**`repeat ring count=N radius=R turn=BOOL`** places copies around the charge's
position, starting at the top and going clockwise. Copies stay upright unless
`turn=#true` turns them with the ring, as the EU's stars must not.

```
for i in 0 .. N-1:
    a = i * 360 / N
    p = at + (R * sin(a), -R * cos(a))
    paint charge at p, rotated by rotate + (turn ? a : 0)
```

**`repeat grid rows=R columns=C stagger=BOOL`** spreads copies evenly across the
current region, with each margin equal to one step. A charge using it MUST NOT
have `at`, even `at center`. With `stagger=#true`, only alternate cells are filled, starting from
the top-left, as on the US flag.

```
for r in 1 .. R:
    for c in 1 .. C:
        if stagger and (r + c) is odd: continue
        paint charge at (region.width * c / (C + 1), region.height * r / (R + 1))
```

**`repeat line count=N fly=A hoist=B`** places copies in a straight line, starting
at the charge's position and stepping by `fly` and `hoist` each time. At least one
step MUST be non-zero. A trigram's three bars are `repeat line count=3 fly=6`.

```
for i in 0 .. N-1:
    paint charge at at + (A * i, B * i)
```

### 8.3 SVG escape hatch

Artwork that isn't geometry is inlined in the document, usually as a KDL raw
string so that it needs no escaping:

```kdl
charge svg {
  at fly=15 hoist=10
  fly 8
  hoist 8
  rotate 0
  markup #"""
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="#f2c14e"/>
    </svg>
    """#
}
```

The artwork is scaled to fit `fly` by `hoist`, preserving its aspect ratio, and is
centered on its position. `fly`, `hoist` and `markup` are REQUIRED. It takes no
`fimbriate` or `repeat`, and it can't be used in a `clip` or `cut`.

A palette color is optional, as in `charge svg gold { ... }`. Artwork using
`currentColor` draws in that color, which keeps a design's colors in its palette
wherever the artwork allows. A document whose artwork uses `currentColor` MUST give
a palette color, so that it can't pick up a color from wherever it's displayed.
Using it for lettering or seals doesn't make them part of the format.

The root MUST be an `svg` element in the SVG namespace, with a `viewBox` or with
numeric `width` and `height` (optionally in `px`). Those give it a viewBox of
`0 0 width height`.

Because documents are untrusted, inline SVG is checked against an allowlist:

| Content | Allowed |
|---|---|
| Elements | `defs`, `g`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `linearGradient`, `radialGradient`, `stop`, `clipPath`, `mask` |
| Geometry attributes | `id`, `class`, `transform`, `d`, `x`, `y`, `width`, `height`, `cx`, `cy`, `r`, `rx`, `ry`, `x1`, `y1`, `x2`, `y2`, `points`, `offset`, `fx`, `fy`, `fr`, `gradientUnits`, `gradientTransform`, `spreadMethod`, `clipPathUnits`, `maskUnits`, `maskContentUnits`, `href` |
| Presentation attributes, also usable as `style` properties | `fill`, `fill-opacity`, `fill-rule`, `stroke`, `stroke-width`, `stroke-opacity`, `stroke-linecap`, `stroke-linejoin`, `stroke-miterlimit`, `stroke-dasharray`, `stroke-dashoffset`, `opacity`, `clip-path`, `clip-rule`, `mask`, `stop-color`, `stop-opacity`, `color`, `display`, `visibility`, `paint-order`, `vector-effect`, `shape-rendering`, `mix-blend-mode`, `isolation` |

A renderer MUST reject a document whose inline SVG contains:

- any other element or attribute in the SVG namespace, or with no namespace
- non-whitespace text outside elements, or a DOCTYPE or other directive
- an `href` (or `xlink:href`) that isn't `#id`
- a presentation value using any function other than `url(#id)`, `rgb()`,
  `rgba()`, `hsl()` or `hsla()`
- an `id` that doesn't match `[A-Za-z_][A-Za-z0-9_.:-]*`
- a `style` attribute with a backslash, `@`, or `/*`
- elements nested more than 64 levels deep
- more than one root element

These are excluded for specific reasons: `script`, event handlers, `a` and
animation can run or navigate; `image`, `use`, `style` and `foreignObject` can
load external content or hide it from these checks; `use`, `symbol` and `pattern`
can multiply work exponentially; and `text` depends on fonts that the document
can't carry, so lettering must be converted to paths.

A renderer MUST remove, without error, these elements with their contents:
`title`, `desc`, `metadata` and anything in another namespace. It MUST also remove
attributes in other namespaces, other than `xlink:href`, along with comments and
processing instructions. Editors commonly add these, and they don't affect how
the artwork draws.

A renderer MUST rewrite every `id` and reference with a prefix unique to the
charge, or otherwise isolate the artwork, so that one piece of artwork can't refer
to the flag's own definitions or another's.

## 9. Emblems, groups, cantons and outlines

**`emblem { ... }`** draws charges together in their own frame, so that they can be
measured from each other as a construction sheet does. Only `charge` and the
properties below are allowed as children, and it takes the common properties in
§6.1.

| Child | Meaning |
|---|---|
| `at center` or `at fly=A hoist=B` | The frame's origin in the region; default center |
| `along AXIS` | Makes the frame's fly direction follow an axis of the region |
| `rotate DEGREES` | Turns the frame further |

Inside it, `fly` and `hoist` measure along the frame's own axes from its origin, so
they can be negative, and a charge's default position is the origin. Shapes in a
child's `clip` and `cut` use the same frame. A `repeat grid` isn't allowed, because
a frame has no size to spread across.

```
function emblem_transform(emblem, region):
    origin = emblem.at or center(region)
    angle = emblem.rotate
    if emblem.along:
        dir, normal = axis(region, emblem.along, 0)
        angle = angle + atan2(dir.y, dir.x)
    return translate(origin) then rotate(angle)
```

Painting is still clipped to the region. South Korea's taegeuk and trigrams are
placed this way, along the flag's diagonals at any proportion.


**`group { ... }`** holds layers and treats them as one for `opacity`, `blend`,
`clip` and `cut`. Its children use the parent's region.

**`canton { fly W; hoist H; <layers> }`** is a new region in the upper hoist
corner, with its own origin at the flag's corner:

```
Region(origin = parent.origin, width = W, height = H)
```

Groups and cantons can be nested.

**`outline { polygon { ... } }`** gives a flag a non-rectangular shape. Its points
are in the root region and everything paints inside it. The proportion still sets
the grid, which SHOULD be the outline's bounding box.

**`border COLOR W [SIDE]`** gives the flag a border of width `W` along its outline,
or along its rectangle if it has no outline. `SIDE` is `inside` (default) or
`outside`.

An `inside` border lies within the shape, above every layer. Renderers can stroke
the edge at `2 * W` and clip the stroke to the shape.

An `outside` border is added around the shape, as Nepal's constitution constructs
its flag. The proportion and grid still describe the shape inside the border, so
the finished flag is larger than its grid and its coordinates can start below
zero. The corners are mitered, so each outer angle equals the inner one:

```
function offset_polygon(points, W):
    side = sign of the sum of (p.x * q.y - q.x * p.y) over each edge p to q
    for each point p, with edges a to p and p to b:
        n1 = outward_normal(a, p, side)
        n2 = outward_normal(p, b, side)
        result[p] = p + (n1 + n2) * W / (1 + dot(n1, n2))

function outward_normal(a, b, side):
    return side * ((b.y - a.y), -(b.x - a.x)) / distance(a, b)
```

A renderer MUST reject an `outside` border on a shape with no area, a repeated
point, or an edge that folds straight back on the previous one.

## 10. Output

Renderers targeting SVG or a similar format SHOULD make any generated IDs unique
to the document, for example with a hash of its source. Several flags are often
inlined in one page, where IDs share a single namespace and a collision would
make one flag use another's clip paths.

## 11. Limits

So that a small document can't demand unbounded work, a renderer MUST accept and
MAY reject beyond these limits:

- layers nested up to 32 levels deep
- up to 10000 bars, star points, or copies from a single `repeat`

Numbers MUST be finite, and renderers MAY reject magnitudes above 1e12.

## 12. Open questions

- **Cuts on repeats:** a cut applies after `repeat`, so a repeated crescent needs
  several cuts. It might be better to have a `cut` inside a charge travel with it.
- **Cardioid anchor:** placing it by its cusp is exact but awkward for centering.
- **Reverse sides:** left out for now. A later version could add `reverse { ... }`.
- **Other divisions:** serrated edges (Qatar, Bahrain) and quartering (Panama)
  aren't covered yet.
- **Aspect-independent rendering:** one grid per flag for now.
