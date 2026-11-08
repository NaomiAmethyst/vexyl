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

Trigonometric functions in the pseudocode take and give degrees, `atan2` included.

## 4. Documents

A document is KDL v2, in UTF-8. Before parsing, each CRLF and lone CR is normalized to LF, so that
a document means the same however its lines end, including inside multi-line strings and inline SVG.

Its top-level nodes MUST appear in this order:

```
vexyl 1              required; the format version
meta { ... }         required
palette { ... }      required
proportion ...       required
outline ...          optional, §9
border ...           optional, §9
define ...           optional and repeatable, §9
<layers>             painted first to last, §6
reverse ...          optional, §10
adapt { ... }        optional, §11
variant ...          optional and repeatable, §12
fold ...             optional and repeatable, §13
```

The nodes marked required MUST be there, even in a flag with nothing else. `vexyl` takes a whole
number, so `1.9` isn't version 1. Here and wherever a whole number is needed, that's any number
whose value is an integer, however it's written, so `vexyl 1.0` is version 1 and `count 3.0` is 3.

A renderer MUST reject an unknown format version, unknown nodes and unknown
properties, and any argument or property on a node that doesn't take one. Flags are exact
constructions, so a silently ignored instruction would produce a wrong flag. For the same reason:

- A property MUST NOT be given twice on one node. KDL would let the last one win, which would hide
  a mistake.
- A child MUST NOT be given twice either, unless this says it's repeatable: a layer's `cut`, a
  charge's `at`, a polygon's `point`, a fold's steps and `source`, and the lists in `meta` and the
  palette that are marked so.
- Type annotations MUST NOT be used, on a node, an argument or a property. Nothing in this format
  reads them.

A child that switches something on, such as `upright`, `diagonal`, `counterchange` or `evenodd`, is
written bare to mean `#true`, or with `#true` or `#false`. A property that does, such as a repeat's
`turn`, takes `#true` or `#false`.

A few values are numbers written inside a string, such as a `box` or a fold's `through`. Those
have one grammar, and there's no hexadecimal, underscore, `inf` or `nan`:

```
number    = sign? (digits "."? digits? | "." digits) (("e" | "E") sign? digits)?
sign      = "+" | "-"
digits    = one or more of 0-9
```

They're separated by ASCII whitespace (space, tab, LF, FF or CR), commas or both, with any ASCII
whitespace around the whole. Each is subject to the limits in §15.

### 4.1 meta

| Node | Required | Meaning |
|---|---|---|
| `name` | yes | The flag's name |
| `description` | no | Prose description |
| `version` | no | Names this version of the flag, such as `"50-star"` |
| `date` | no | When this version took effect: `YYYY`, `YYYY-MM` or `YYYY-MM-DD` |
| `until` | no | When this version stopped being current, in the same form, and not before `date` as far as both are known |
| `series` | no | A stable ID linking the versions of one flag, in lowercase words joined by hyphens: `[a-z0-9]+(-[a-z0-9]+)*` |
| `note` | no, repeatable | A remark for anyone reading or using the flag or this file |
| `law` | no, repeatable | An instrument that defines or governs the flag, with any number of `source` children |
| `restriction` | no, repeatable | A limit on using the flag, apart from copyright, with at least one `source` child |
| `designer` | no, repeatable | Who designed the flag |
| `design-rights` | no | Rights in the design, as free text or an SPDX ID |
| `encoder` | no, repeatable | Who wrote this file |
| `license` | no | License of this file, as an SPDX ID |
| `render-license` | no | An added permission for images rendered from this file, as an SPDX ID |
| `adapted-from` | no, repeatable | The URL of a work this file derives from |
| `source` | no, repeatable | URL of the specification or reference used |

A design and its encoding can have different owners, so they are separate.

`license` covers the file. `render-license` is an additional permission from the file's
rights holders for images rendered from it, so that a file can ask for credit while its
renders ask for nothing. Without one, renders fall under `license`. It covers only what
those holders can grant, and never a flag's design or rules about using it. Someone who
edits a file and keeps the field extends the permission to their changes.

`encoder` is who wrote this file, and `source` is evidence: a law or reference it relies on.
`adapted-from` is different: it's a work that the file takes material from, such as the drawing
of an emblem, with what its license needs:

```
adapted-from "https://commons.wikimedia.org/wiki/File:Example.svg" {
  author "Who made it"
  license "CC-BY-SA-4.0"
  part "the coat of arms"
}
```

`author` is repeatable. `part` says what was taken, and leaving it out means that the whole
file derives from the work. A file with a `render-license` MUST NOT adapt a work unless that
work's `license` is the same as the `render-license`, `CC0-1.0` or
`LicenseRef-Public-Domain`, since a render can't grant more than its material allows. They're
compared as written, case and all, and a work with no `license` can't be covered.

Each version of a flag gets its own file, because successive versions can differ
completely, while a `variant` is a form of one design. `series` links them, since a name
isn't reliable: a flag can change its name while being the same flag, or keep its name while
changing. A missing `until` means the version may still be current.

`note`, `law` and `restriction` are records. Nothing enforces them, and they aren't legal
advice. A `restriction` needs a source because an unsourced legal claim in a shared file
could mislead people. `design-rights` is for rights in a design, such as copyright, while
`restriction` is for rules about using a flag, such as an emblem law.

Comments are for remarks about how a file is written. Anything a reader of the flag
should see belongs in `note`, because parsers discard comments.

### 4.2 palette

Each child names a color: `gold "#fcd116"`. Values MUST be `#rrggbb`, in sRGB, and
that's what's drawn on screen. The hex digits can be in either case, and mean the same, so
`"#FCD116"` is that gold too.

A color can also give its value in other systems, for print, cloth and manufacturing.
All of them are optional:

```kdl
palette {
  blue "#005583" {
    ncs "4055-R95B"
    pantone "301 C"
    cmyk 100 60 0 40
    dye "Example Blue, 50 parts per 1000"
    reference "CIE xyY" "0.1556 0.1354 6.5"
  }
}
```

The named systems are `pantone`, `ncs`, `ral`, `munsell`, `dye` and `thread`, each with a
string; `cmyk`, with four numbers from 0 to 100; and `reference`, with the name of any
other system and a value. `dye` and `reference` can repeat.

These are records of what a flag's specification says. Renderers MUST NOT draw from them
or convert between systems, because such conversions are approximate and can be proprietary.
Libraries SHOULD make them available, so that tools can pass them on.

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
position from 0 to 1, one for each, never decreasing, and defaults to even spacing. Two
stops at the same place make a sharp change. A gradient needs at
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
- A quarter or a check is its own cell, and a wedge from `rays` is the part inside the region.
- A chevron is the part inside the region, from its edge to its apex, even when a gap in its list
  leaves only its outer band painted.
- A `band`, `pile` or `pall` is the part inside the region, though its shape runs on past it.
- A `cross` or `saltire` is the whole region, because its arms are one shape.
- Each copy from a `repeat`, or from several `at`s, is its own shape.
- A fimbriation is the shape that it edges, as that shape counts here, so a band's or chevron's is
  the part of it inside the region.
- A border is the flag's shape, its outline or its rectangle, whether the border is inside or
  outside it.

A gradient can't be the color of a `charge svg`, or a color in another gradient.

`none` is reserved. In the color list of `bars`, `chevrons`, `rays`, `quarters` or
`checks`, it leaves a gap that shows what's beneath, and the other colors in the list
keep their own exact shapes, rather than running on beneath each other.

Color names MUST NOT be empty or given twice.

### 4.3 Constraints

Each section says what its nodes take. A document MUST also meet these, and a renderer MUST reject
one that doesn't.

Every size is positive: each `width`, `radius`, `inner`, `depth`, `flat`, `junction`, `hollow` and
`lines`; a crescent's `offset`; a sun's `disc`, `gap` and `spread`; the `fly` and `hoist` of a shape,
panel, canton, `proportion` or `define`; the width in `fimbriate` and `border`; an edge's `depth` and
`period`; a repeat's `radius`; an outline's `depth`, `taper`, `tongue` and `tip`; and each `ratio`
value, a variant's included. One that defaults to 0, such as a sun's `gap`, is left out rather than
written as 0. Positions, angles, a band's `offset`, a pile's `base` and `tip` and a line's steps can
be any number. A count is a whole number from 1.

| Node | Constraints |
|---|---|
| `bars`, `chevrons`, `rays` | `ratio` has one value for each color, after any `count`. `grow` has one for each bar, and none is negative |
| `chevrons` | `angle` is more than 0 and less than 90. `apex` isn't negative, but can be past the far end of the edge, as any position can be outside its region |
| `band`, `saltire`, `pall` | `width` is required |
| `cross` | `fly` and `hoist` are required, each with three values: distances that aren't negative, and a positive width |
| `quarters` | Four colors. `split` and `diagonal` can't be combined |
| `checks` | At least two colors, `none` included, and both `rows` and `columns` |
| `pile`, `pall` | No `at` or `rotate`, since the edge places them. `base` and `tip` each have two values |
| Shapes with a `radius` | It's required: `disc`, `ring`, `plus`, `triangle`, `star`, `crescent`, `sun`, `heart` and `cardioid` |
| `ring` | `inner` is required, and less than `radius` |
| `star` | `inner` is less than `radius`. At least 3 `points`. `lines` and `hollow` can't be combined |
| `crescent` | `inner` and `offset` are required |
| `sun` | `disc` is required, and `disc + gap` is less than `radius`. At least 3 `points` |
| `plus` | `width` is required, and less than `2 * radius` |
| `rect`, `ellipse` | Both `fly` and `hoist` |
| `path` | `d` and `box` are required, and at least one of `fly` and `hoist` |
| `svg` | Not `hollow`, and only one `at` |
| `at` | `at center`, or both `fly=` and `hoist=` |
| `repeat` | `ring` needs `count` and `radius`; `grid` needs `rows` and `columns`; `line` needs `count`; and `arc` needs `count`, `radius`, `from` and `to` |
| `edge` | `depth`, and either `period` or `count` but not both, whichever its kind |
| `group`, `panel`, `emblem`, `reverse { }` | At least one layer, or for an emblem one charge |
| `panel` | `side` or `corner`, not both. A side panel needs a `width`, and takes no `fly`, `hoist` or `at`. Any other needs `fly` and `hoist`, takes no `width` or `edge`, and can't have both `corner` and `at` |
| `canton` | Both `fly` and `hoist` |
| `clip`, `cut` | Exactly one shape |
| `define` | A name that isn't empty and isn't another definition's, a shape's name from §8.1, `svg`, `pile` or `pall`. At least one child. A shape takes no `hoist` or `fly` |
| `use` | A design that's already defined, not a shape |
| `outline` | One named form, or one `polygon` or `path` inside it. A form takes only its own values: `depth` and `taper` for `swallowtail`, `depth` and `tongue` for `tongued`, and `tip` for `pennant`. `depth` is required, and `tongue` for `tongued` |
| `adapt` | `wider`, `narrower` or both. `range` has two values, the first positive and the second no smaller |
| `variant`, `fold` | A name that isn't empty or another's of the same kind. A variant's `ratio` needs the flag's `adapt` |
| `fold` | At least one step. Each needs `move`, and `along` is `fly` or `hoist` |

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
        if layer.cuts: target.push_mask_excluding(shapes(cut_shapes(layer, region), region))
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

A `blend` mixes a layer with what's beneath it. A `group`, `panel` or `canton` is composited as a
unit, so its children never blend with anything outside it. So is any layer with an `opacity` below
1, a `blend`, a `clip` or a `cut`, since those apply to the layer as a whole. Otherwise an `emblem`
or `use` isn't, and a blend inside one mixes with whatever is beneath it, as it would if its layers
were written in its place.

`clip` and `cut` take any shape, including `pile` and `pall`, or a shape from a
`define`. They use a shape's whole area, so it can't be `hollow` or have `lines`. The shapes use the coordinates of the region the layer sits in. A `clip` applies to the layer as a whole, after any `repeat`, and so does a `cut` on any layer but a charge. A charge's own cuts go with each of its copies, as §8.2 says.

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

So at rotation 0, the first bar is the top bar or the one nearest the hoist. The bend
axes follow the flag's corners at any proportion, which a fixed angle can't do.

### 7.3 bars

```
bars COLOR... { along AXIS; ratio N...; count N; rotate DEGREES }
```

`along` defaults to `fly`, which gives horizontal bars. `ratio` defaults to equal
widths, and its length MUST equal the number of bars. `count N` cycles through
the colors until there are N bars, and MUST NOT be fewer than the colors, so that none is dropped
without a word. Widths are measured across the bars, not along
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
parallel. Space beyond the outermost chevron is left unpainted. `fimbriate` edges the
outermost chevron.

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

A `saltire` can take `counterchange` instead of `fimbriate`. Each arm then shows only
on one side of its diagonal, `width` wide, which is how the Union Flag's red saltire
works:

```
clip = triangles (c, (W, c.y), (W, H)), (c, (c.x, H), (0, H)),
                 (c, (0, c.y), (0, 0)), (c, (c.x, 0), (W, 0))
paint saltire of width 2 * width, within clip
```

### 7.8 quarters, checks

```
quarters COLOR COLOR COLOR COLOR { split fly=A hoist=B }
quarters COLOR COLOR COLOR COLOR { diagonal }
checks COLOR... { rows R; columns C; flow bend | bend-sinister }
```

`quarters` divides its region per cross, with colors running upper hoist, upper fly,
lower hoist, lower fly. `split` moves the crossing point from the center. With
`diagonal`, it divides per saltire instead, with colors running top, fly, bottom,
hoist. `checks` makes a checkerboard, cycling through its colors so that like colors
run along the `flow` diagonal, which defaults to `bend-sinister`:

```
index = (row + column) mod n          // bend-sinister
index = (column - row) mod n          // bend
```

### 7.9 rays

```
rays COLOR... { from POINT; count N; ratio N...; measure angle | edge; rotate DEGREES }
```

`rays` divides its region into wedges from a point, going clockwise. `from` is
`center` (default), a corner (`upper-hoist`, `upper-fly`, `lower-hoist`, `lower-fly`),
the middle of an edge (`hoist`, `fly`, `top`, `bottom`), or `fly=A hoist=B`. Each of
these is only a point, and every point works the same way. The wedges cover the directions
from it that can see the region's inside, starting at the first of them going clockwise, so
`lower-hoist` starts straight up and sweeps a quarter turn, `hoist` sweeps a half turn, and
`center` a full one starting from up. `count N` cycles through the colors until there are N
wedges, and MUST NOT be fewer than the colors.

`measure` says what `ratio` shares out: the angle (default), or the region's far edges
by length, walking clockwise from the first wedge. The far edges are the ones that the point
doesn't lie on, so a corner has two and the middle of an edge three. Seychelles' rays are evenly
spaced along its edges, for example, not by angle. `measure edge` follows the region's own edges,
so it can't also have a `rotate`.

```
function ray_frame(rays, region):
    p = the point that rays.from names
    edges = the region's top, fly, bottom and hoist edges, each running clockwise
    far = [e for e in edges if p is strictly on the region's side of e's line]
    if far holds all four edges:
        walk = the region's outline, clockwise from (p.x, 0) all the way round to it
        return p, 0, 360, walk
    walk = the far edges joined end to end, clockwise, starting with the one after those that aren't far
    start = bearing(first point of walk - p)
    sweep = (bearing(last point of walk - p) - start) mod 360
    return p, start, sweep, walk

bearing(v) = atan2(v.x, -v.y)          // clockwise from up

function ray_wedges(rays, region):
    p, start, sweep, walk = ray_frame(rays, region)
    s = [0] + running sums of rays.ratio[i] / sum(rays.ratio)
    for i, color in rays.colors:
        if rays.measure is edge:
            wedge = polygon(p, then the walk from length(walk) * s[i] to length(walk) * s[i + 1])
        else:
            a0 = start + rays.rotate + sweep * s[i]
            a1 = start + rays.rotate + sweep * s[i + 1]
            wedge = the directions from p clockwise from a0 to a1
        target.fill(color, wedge clipped to region)
```

A point outside the region works the same way. It sees the region across less than half a turn,
its far edges are the ones facing away from it, and its wedges are the parts of the region that
they cover. A point on the line of an edge, beyond the region, doesn't see that edge either.

### 7.10 pile, pall

```
pile COLOR { from EDGE; base A B; depth D; flat W; hollow W | fimbriate COLOR W }
pile COLOR { from EDGE; base A B; tip ALONG IN; hollow W | fimbriate COLOR W }
pall COLOR { from EDGE; width W; junction D; hollow W | fimbriate COLOR W }
```

`hollow` draws the outline as it does for a charge (§8.1), and can't go with `fimbriate`.

Both are placed by an `EDGE` of the region: `hoist` (default), `fly`, `top` or `bottom`.
Distances along it are from the top, or from the hoist for `top` and `bottom`.

A `pile` is a triangle or trapezoid from that edge. `base` is the part of the edge it
stands on, and defaults to all of it. It reaches in `depth` to a point midway along its
base, cut to a width of `flat` if given, or to the point given by `tip`. Those are its two forms,
so a `pile` MUST NOT have both `depth` and `tip`, and `flat` goes only with `depth`.

A `pall` is a Y: two arms of `width` run from the edge's corners to a point `junction`
in from the middle of the edge, then one stem of the same width runs on to the far
side. `junction` defaults to half the edge's length. Its corners are mitered.

### 7.11 edge

`bars` and side panels can take a shaped line between divisions:

```
edge wavy depth=D period=P
edge zigzag depth=D count=N
```

`depth` is the distance from one extreme to the other. The line is centered on where a
straight one would be, so a zigzag's points and notches are `depth / 2` either side.
`period` is the length of one wave, or `count` is how many fit the edge. Either kind takes either.

The line runs a distance `s` along the edge from its start, and is offset across it by:

```
function edge_offsets(edge, span):
    period = span / edge.count if edge.count is given, else edge.period
    if edge is zigzag:
        corners at s = 0, period/2, period, 3*period/2, ... up to the last not past span + period/4,
        with offsets -depth/2, +depth/2, -depth/2, ... in turn, joined by straight lines
    if edge is wavy:
        offset(s) = depth/2 * sin(360 * s / period), for s from 0 to span
```

So a zigzag starts at a corner on the negative side, and a wave at its middle heading to the
positive side. Where it starts, and which side is positive, depend on what the edge is on:

```
function bar_edge(bars, region, t):         // between two bars, at t as paint_bars has it
    dir, normal = axis(region, bars.along, bars.rotate)
    span = region.width for fly, region.height for hoist, or the region's diagonal for the bends
    point(s, offset) = center(region) - dir * span/2 + dir * s + normal * (t + offset)
    beyond its first and last points, the line runs on straight, at their offsets, past the region
```

For `bars`, the positive side is toward the later bar, and `span` is measured before any `rotate`,
along the axis's own length. So a zigzag between bars along the fly starts at the hoist with a point
up, and between bars along the hoist starts at the top with a point toward the hoist. `count`
divides `span`.

For a side panel, the line runs along its inner side, `width` from its edge. `s` runs from the top
for a `hoist` or `fly` panel and from the hoist for a `top` or `bottom` one, `span` is the length of
that side, and the positive side is away from the panel. So a zigzag starts with a point toward the
panel. The panel's region is `width + depth / 2` deep, so that it reaches the line's farthest points.

### 7.12 Fimbriation

`fimbriate COLOR W` paints the ordinary or charge's shape, expanded outward by `W`
grid units with mitered corners, in `COLOR` beneath the shape. For a cross or
saltire, the expanded arms are one shape, so the edge never crosses the center. It edges a filled
shape, so a shape with `hollow` or `lines` can't have it.

The miters are limited as SVG's `stroke-miterlimit` of 10 limits them. A corner with an angle
`A` whose miter would reach more than `10 * W` from it, where `W / sin(A / 2) > 10 * W`, is beveled
instead, which is any corner sharper than about 11.5 degrees. A `hollow` outline and an inside
border (§9) are joined the same way, with miters limited at 10 times their stroke's width. Renderers
can stroke the shape at `2 * W` with `stroke-linejoin="miter"` and `stroke-miterlimit="10"`.

A charge with several copies paints the fimbriation of all of them first, and then all their
fills, so that no copy's edge lies over another copy. That holds under `upright` (§12) too.

## 8. Charges

```
charge SHAPE COLOR {
    at center | at fly=A hoist=B    // default center; repeat for several positions
    rotate DEGREES                  // about the position
    fimbriate COLOR W
    repeat ...
    <shape parameters>
}
```

A charge can repeat `at`, placing a copy at each position, as a constellation does. That can't be
combined with `repeat`.

### 8.1 Shapes

These are written as they would appear in a `charge`, `clip` or `cut`. Each shape
is centered on its position, except where noted. A `pile` or `pall` is a layer of its own (§7.10),
and can be a `clip` or `cut`, but not a charge's shape.

| Shape | Parameters | Geometry at rotation 0 |
|---|---|---|
| `disc` | `radius` | Circle |
| `ellipse` | `fly`, `hoist` | Ellipse with those overall sizes |
| `ring` | `radius`, `inner` | Circle with a concentric hole |
| `rect` | `fly`, `hoist` | Rectangle with those sizes |
| `plus` | `radius`, `width` | Equal-armed cross with arms of length `radius` from the center |
| `triangle` | `radius` | Equilateral triangle, one point up, its points `radius` from the center |
| `star` | `radius`, `points` (default 5), `inner` | Star with one point up |
| `crescent` | `radius`, `inner`, `offset` | A disc with another cut from it; opens toward the fly |
| `sun` | `radius`, `disc`, `gap`, `points`, `spread` | A disc with triangular rays, one straight up |
| `lozenge` | `fly`, `hoist` | A rhombus; each size defaults to its region's |
| `path` | `d`, `box`, `fly`, `hoist`, `evenodd` | Any shape, drawn in `box` and fit to the size given |
| `heart` | `radius`, `spread` | Tip down; the position is midway between the lobes' centers; see below |
| `cardioid` | `radius` | Cusp at the position, lobe below it; see below |
| `polygon` | `point fly=A hoist=B`, at least 3 | Points relative to the current region |

A `polygon` is already placed by its points, so it MUST NOT have `at`, `rotate`
or `repeat`.

A `ring` can take `from` and `to`, in degrees clockwise from up, to draw only that part
of it, going clockwise, with straight ends along radii. Either defaults to 0 if the other is given,
and they MUST NOT be the same place, since that leaves nothing to draw.

`hollow W` draws any shape's outline at a width of `W` centered on its edge, instead of
filling it. `lines W` draws a star as lines between its points, skipping one each time.
That's a single closed line for five points and two triangles for six.

A `crescent`'s cut has radius `inner`, with its center `offset` toward the fly. Its two
circles MUST cross. A `sun`'s `disc` is its radius, and `radius` reaches the tips of its
rays, which start at `disc + gap`. `points` defaults to 12, and `spread` is the share
from 0 to 1 of its slot that each ray fills at its base, which defaults to 1.

A `path` is for shapes that have no other name. `d` is path data by SVG's grammar, with its numbers
within the largest magnitude in §15, and anything else MUST be rejected rather than drawn as far as
it goes. `box` is
`"x y width height"`, the area of its coordinates that fits within `fly` by `hoist`,
keeping its shape and centered on the charge's position. Either size can be left out to
take its size from the other. It keeps a palette color and everything else a charge has,
which makes it the better choice over inline SVG for anything in one color.

In a `charge`, `clip` or `cut`, a path's values are children, as `d "M0 0H1V1Z"` and `box "0 0 1 1"`.
A `define` takes that form, which is checked as a charge's is, or the one-line
`path "M0 0H1V1Z" box="0 0 1 1"`, whose size comes from each charge using it. An `outline` takes
only the one-line form.

The default `inner` of a star is that of the regular star polygon {n/2}:

```
inner = radius * cos(360/n) / cos(180/n)     // n >= 5
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

**`repeat arc count=N radius=R from=A to=B turn=BOOL`** is a ring limited to the angles
from `A` to `B`, in degrees clockwise from up, with copies at both ends and evenly
between. It goes clockwise from `A` to `B`, as a `ring`'s own `from` and `to` do, so `from=300
to=60` runs over the top. It needs at least two copies, and `A` and `B` MUST NOT be the same place.

```
span = (B - A) mod 360          // at least 0 and under 360, and 0 is an error
for i in 0 .. N-1:
    a = A + span * i / (N - 1)
    p = at + (R * sin(a), -R * cos(a))
    paint charge at p, rotated by rotate + (turn ? a : 0)
```

**`repeat line count=N fly=A hoist=B`** places copies in a straight line, starting
at the charge's position and stepping by `fly` and `hoist` each time. At least one
step MUST be non-zero. A trigram's three bars are `repeat line count=3 fly=6`.

```
for i in 0 .. N-1:
    paint charge at at + (A * i, B * i)
```

**Cuts go with the copies.** A charge's `cut`s are part of each copy. They're written for the
first copy, just where they'd be on a charge with only that copy, and each other copy takes them
with it: moved as far as it's moved from the first, and turned as far as the repeat turns it
beyond the first. That holds for every `repeat`, and for several `at`s. The first copy is the
first one painted: the top of a ring, `from` on an arc, the charge's position on a line, the
top-left cell of a grid, or the first `at`. So a row of crescents with a hole in each needs only
one cut, and a ring that turns its copies turns their cuts too.

```
function cut_shapes(layer, region):
    if layer is not a charge: return layer.cuts
    copies = each (position, turn) the charge is painted at, in order, with turn 0 unless a ring or arc turns it
    first = copies[0]
    result = []
    for (p, turn) in copies:
        for cut in layer.cuts:
            add cut to result, turned by turn - first.turn about first.position,
                then moved by p - first.position
    return result
```

All the copies' cuts together are removed from the charge's paint, as any cut is, so a cut
reaching past its own copy cuts the next one too. A charge with one copy is drawn as it always
was. A `clip` on a charge still applies once, to all its copies together, as a `cut` on a `group`
does, which is the way to cut across several copies at once.

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

Markup MUST be a well-formed XML 1.0 document (fifth edition) that's also namespace-well-formed
under Namespaces in XML 1.0, and every library MUST read it that way, whatever its XML parser
allows. In particular:

- Its encoding is UTF-8. An XML declaration is optional, MUST come first if it's there, and can
  only say version `1.0` and encoding UTF-8.
- An attribute MUST NOT be repeated, by its written name or by its namespace and local name.
  `href` and `xlink:href` on one element count as a repeat, because they mean the same.
- Every prefix MUST be declared, and `xml` and `xmlns` keep their reserved meanings.
- Only the five predefined entities exist. A character reference MUST refer to an XML character,
  so `&#xD800;` and `&#0;` are errors, as is any such character written literally, even in a
  comment or inside something that would be removed.
- Line endings are normalized as XML says, and literal tabs and newlines in an attribute's value
  become spaces.

Whitespace anywhere in inline SVG means ASCII whitespace, and any other kind of space is text like
any other. Style properties and CSS function names are matched ignoring ASCII case only.

The root MUST be an `svg` element in the SVG namespace, with a `viewBox` or with
numeric `width` and `height` (optionally in `px`). Those give it a viewBox of
`0 0 width height`. All of those numbers use the grammar in §4, within the limits in §15.
Artwork is always fitted as SVG's default `preserveAspectRatio` fits it, so the root MAY say
`xMidYMid` or `xMidYMid meet`, with any ASCII whitespace around and between the words, and MUST
NOT say anything else.

Because documents are untrusted, inline SVG is checked against an allowlist:

| Content | Allowed |
|---|---|
| Elements | `defs`, `g`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `linearGradient`, `radialGradient`, `stop`, `clipPath`, `mask` |
| Geometry attributes | `id`, `transform`, `d`, `x`, `y`, `width`, `height`, `cx`, `cy`, `r`, `rx`, `ry`, `x1`, `y1`, `x2`, `y2`, `points`, `offset`, `fx`, `fy`, `fr`, `gradientUnits`, `gradientTransform`, `spreadMethod`, `clipPathUnits`, `maskUnits`, `maskContentUnits`, `href` |
| Presentation attributes, also usable as `style` properties | `fill`, `fill-opacity`, `fill-rule`, `stroke`, `stroke-width`, `stroke-opacity`, `stroke-linecap`, `stroke-linejoin`, `stroke-miterlimit`, `stroke-dasharray`, `stroke-dashoffset`, `opacity`, `clip-path`, `clip-rule`, `mask`, `stop-color`, `stop-opacity`, `color`, `display`, `visibility`, `paint-order`, `vector-effect`, `shape-rendering`, `mix-blend-mode`, `isolation` |
| Style | `style`, holding only the presentation properties above |
| Root only | `viewBox`, `width`, `height`, `x`, `y`, `id`, `version`, `baseProfile`, `preserveAspectRatio`. They're read as above and then removed, since the artwork is placed by `fly`, `hoist` and its position. The root's other attributes are checked and kept as any element's are |

A renderer MUST reject a document whose inline SVG contains:

- any other element or attribute in the SVG namespace, or with no namespace, including a root-only
  attribute anywhere but the root
- text other than whitespace, or a DOCTYPE or other directive
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

A renderer MUST rewrite every `id` and reference with a prefix unique to each time the artwork is
drawn, or otherwise isolate it, so that one piece of artwork can't refer to the flag's own
definitions or another's. A `style` keeps its declarations in their order, because a later one
can override an earlier one.

What passes is written in one canonical form, given in section 4.2 of the [SDK](SDK.md). A library's
model holds it, and §15 counts its bytes.

## 9. Emblems, groups, panels, definitions and outlines

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
child's `clip` and `cut` use the same frame. Anything that needs a region's size isn't allowed,
because a frame has none: a `repeat grid`, a `lozenge` without both its sizes, and a `pile` or
`pall` in a `clip` or `cut`.

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

**`panel { ...; <layers> }`** is a new region within its parent, with its own origin,
and everything inside it is clipped to it. It's placed in one of three ways:

| Placement | Region |
|---|---|
| `side EDGE; width W` | A band along an edge of its parent: `hoist`, `fly`, `top` or `bottom` |
| `corner CORNER; fly W; hoist H` | A rectangle in `upper-hoist`, `upper-fly`, `lower-hoist` or `lower-fly` |
| `fly W; hoist H`, with an optional `at` | A rectangle centered on a position, or on its parent's center |

A side panel can take an `edge` (§7.11) along its inner side, and its region then
reaches as far as the line does.

**`canton { fly W; hoist H; <layers> }`** is a panel with `corner upper-hoist`.

Groups and panels can be nested.

**`define NAME { ... }`** names something to reuse, so that it's still all in one file.
It has to come before whatever uses it, another `define` included, so a definition can't use
itself. It can hold one of two things:

- **A shape:** a single child that's one of the shapes in §8.1 other than `svg`, such as
  `path "M0 0H1V1Z" box="0 0 1 1"` or `polygon`. It's then used like any other shape, with
  `charge NAME COLOR`, or in a `clip` or `cut`. Anything else, a lone `pile`, `pall` or
  `charge svg` included, is a design.
- **A design:** any layers, used with `use NAME`, which paints them in the current
  region. `define NAME hoist=H fly=F` gives a design its own grid, which is scaled to
  fill wherever it's used, as a flag within a canton needs.

**`outline ...`** gives a flag a non-rectangular shape, and everything paints inside
it. The proportion still sets the grid, which SHOULD be the outline's bounding box.

| Outline | Shape |
|---|---|
| `outline swallowtail { depth D; taper T }` | Cut into a point from the fly; `taper` narrows its tails' ends |
| `outline tongued { depth D; tongue W }` | A swallowtail with a tongue, as on Nordic state flags; `W` is the width between the notches |
| `outline pennant { tip W }` | Narrowing to a point, or to an end of width `W` |
| `outline { polygon { ... } }` | Any straight-edged shape |
| `outline { path "..." box="..." }` | Any shape, stretched from `box` to the flag |

The named forms are these polygons, on a flag `F` wide and `H` high, with `taper` and `tip`
defaulting to 0:

```
swallowtail: (0, 0), (F, taper), (F - depth, H/2), (F, H - taper), (0, H)
tongued:     a = (H - tongue) / 2
             (0, 0), (F, 0), (F - depth, a), (F, H/2), (F - depth, H - a), (F, H), (0, H)
pennant:     a = (H - tip) / 2
             (0, 0), (F, a), (F, H - a), (0, H), or (0, 0), (F, H/2), (0, H) when tip is 0
```

**`border COLOR W [SIDE]`** gives the flag a border of width `W` along its outline,
or along its rectangle if it has no outline. `SIDE` is `inside` (default) or
`outside`.

An `inside` border lies within the shape, above every layer. Renderers can stroke
the edge at `2 * W`, with the mitered joins of §7.12, and clip the stroke to the shape.

An `outside` border MUST NOT go around a `path` outline, including one that comes together only in
a variant, from the flag's border and the variant's outline or the other way around. It is added around the shape, as Nepal's constitution constructs
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

## 10. The reverse

By default, a flag's reverse is the mirror image of its obverse. `reverse mirror` says
so outright. `reverse { <layers> }` gives a different back. Those layers are painted as
written, as seen by someone looking at that side, with no mirroring.

A variant with its own layers has a different design, so a flag's `reverse` doesn't apply to it,
and its reverse is the mirror image of those layers. A variant without its own layers has the
flag's reverse. §12 says how a turned variant's reverse is turned, and §11 how a reverse adapts.

## 11. Other proportions

A flag's `proportion` is its true shape, but flags often have to fit another. Stretching
one would distort it, and what should happen instead depends on the design. A flag says
so with `adapt`:

```kdl
adapt {
  range 1.2 2.4
  wider extend
  narrower cut
}
```

`range` limits the proportion, as fly divided by hoist. `wider` and `narrower` each name
a rule for when that's more or less than the flag's own. Without one, the flag MUST NOT
be rendered in that direction, and without `adapt` it can't be rendered at another
proportion at all. A design whose shape is fixed by law should say nothing here.

| Rule | Effect |
|---|---|
| `extend` | Grows or shrinks the fly end, leaving what's measured from the hoist in place |
| `cut` | The same as `extend`, for saying that a narrower flag loses its fly end |
| `center` | Grows or shrinks both ends equally |
| `scale` | Spaces everything out along the fly, in proportion |
| `hoist-extend`, `hoist-center`, `hoist-scale` | The same, with the hoist changing instead, from the top |

The rest of this section describes changing the fly. Changing the hoist works the same
way along the other axis.

**Shapes never distort.** Discs stay round and stars stay regular under every rule. Only
their positions move, except that a `rect`'s, `lozenge`'s or `ellipse`'s size scales under `scale`, and
a `polygon` moves by each of its points.

**Each layer has an anchor,** which is where it stays. The rule sets it: `start` for
`extend` and `cut`, `center` for `center`, and `scale` for `scale`. A layer can override it
with `anchor start`, `anchor center`, `anchor end` or `anchor scale`, as a charge held near
the fly would need. A `group`, `panel` or `use` passes its own `anchor` on to the layers inside it
that don't give one, and they pass it on in turn, so that a group anchored `end` keeps everything in
it by the fly.

A reverse's own layers (§10) are seen from behind, with the hoist on the right. For them, `start`
is still the hoist side and `end` the fly side, as on the obverse, so the two sides of a flag adapt
alike. In their own coordinates, that swaps `start` and `end` when the fly changes. Changing the
hoist is the same on both sides.

```
function move(x, old, new, anchor):
    case anchor:
        start:  return x
        center: return x + (new - old) / 2
        end:    return x + new - old
        scale:  return x * new / old
```

| Layer | What happens |
|---|---|
| `field`, `saltire`, `checks`; axes `bend` and `bend-sinister` | They follow the region, so nothing's needed |
| `bars` across the axis, `cross` arms | The last part grows for `start`, the first for `end`, and the first and last equally for `center`. Under `scale`, the ratio holds. A part reaching zero is an error, as below |
| `bars` along the axis | Nothing's needed |
| `band` across the axis | Stays put by its anchor. Its width only changes under `scale` |
| `chevrons`, `pile`, `pall` | They stay on their edge. Depths only change under `scale`. Positions along an edge that's changing size move by the anchor |
| `quarters`, `rays`, `charge`, `emblem` | Positions move by the anchor |
| A charge's `repeat ring` or `repeat arc` | Its position moves by the anchor, and the copies keep their radius around it, so that the ring stays round under every rule, `scale` too |
| A charge's `repeat line` | Its position moves by the anchor. The step only changes under `scale`, in proportion |
| A charge's `repeat grid` | Its copies follow the region, since they're spread across it |
| A charge's several `at`s | Each moves by the anchor |
| `panel` | Stays on its edge or corner, keeping its size unless `scale`. One running along the axis grows, and its layers adapt with it |
| `group`, `use` | Their layers adapt. A design with its own grid doesn't, because it fills its region |
| `outline polygon` | Its points scale. Named outlines are recalculated for the new size |

**What's at the center stays at the center,** so a charge or emblem with no position, or a panel
placed by its size alone, follows the center under every rule. One with an anchor, its own or one
passed on to it, is pinned to where the center was instead, and moves by that anchor like any
position. So under `extend`, a charge anchored `start` keeps its place from the hoist.

A chevron is worked out afresh at the new size, so one without an `angle` still has its outermost
arms meet the corners of its edge, and one without an `apex` keeps it at the edge's middle.

`bars` can take `grow N...`, which shares out the change between them by these weights
instead, under every rule, `scale` included. Canada's pale would stay its own width with
`grow 1 0 1`. Weights that are all 0 leave the change to the anchor, as if there were none.

Floating-point arithmetic can leave a part that should be exactly zero a little either side of it,
so a part that changes MUST stay longer than `1e-9` of the region's size along the axis:

```
function share_change(parts, grow, old, new, anchor):
    total = sum(parts)
    out = [p * old / total for p in parts]
    d = new - old
    if grow is given and sum(grow) > 0:
        for i in parts: out[i] = out[i] + d * grow[i] / sum(grow)
        changed = [i for i in parts if grow[i] > 0]
    else:
        case anchor:
            start:  out[last] += d;                       changed = [last]
            end:    out[first] += d;                      changed = [first]
            center: out[first] += d / 2; out[last] += d / 2; changed = [first, last]
            scale:  return parts
    for i in changed:
        if out[i] <= 1e-9 * old: error, since the design can't reach this proportion
    return out
```

### 11.1 Asking for a proportion

Rendering takes a proportion, along with how to treat one the flag can't reach:

| Option | Values | Meaning |
|---|---|---|
| `ratio` | A number | The proportion wanted, as fly divided by hoist |
| `fit` | `error` (default), `pad` | What to do if the flag can't reach it |
| `align` | `start`, `center` (default), `end` | Where a padded flag sits: left or top, the middle, or right or bottom |

A flag that can't reach a proportion MUST be refused by default, so that nothing distorts
or silently changes shape. With `pad`, a renderer draws the flag at the nearest proportion
its rules allow, then widens the canvas to the one asked for, leaving the rest transparent:

```
function nearest(flag, target):
    current = flag.fly / flag.hoist
    rule = flag.adapt.wider if target > current else flag.adapt.narrower
    if rule is missing: return current
    return target limited to flag.adapt.range

function canvas(box, target, align):
    share = 0 for start, 0.5 for center, 1 for end
    if box.width / box.height < target:
        extra = box.height * target - box.width
        box.x = box.x - extra * share
        box.width = box.width + extra
    else:
        extra = box.width / target - box.height
        box.y = box.y - extra * share
        box.height = box.height + extra
```

If the rules allow the nearest proportion but the design can't reach it, as when a cut
would remove a cross's arm, the flag is padded from its own proportion instead.

## 12. Variants

A `variant` is a named form of the flag, such as a vertical or banner one. Its rules
can't be worked out from the design, because they're choices that differ between flags.

```kdl
variant vertical {
  from transpose
  upright
  outline swallowtail {
    depth 5
  }
}
```

| Child | Meaning |
|---|---|
| `from` and one of `none`, `rotate`, `counter-rotate`, `half-turn`, `transpose`, `anti-transpose`, `invert` or `mirror` | How the design turns; the default is `none` |
| `upright` | Keeps charges and emblems the right way up as the design turns |
| `ratio N` | Its proportion by the flag's `adapt` rules, as fly divided by hoist before turning |
| `proportion hoist=H fly=F` | Its own true shape and grid, for a form that's fixed rather than adapted |
| `outline ...`, `border ...` | Replace the flag's own |
| `<layers>` | Replace the flag's own, for a form with a different design |

`from transpose` reflects the flag across its diagonal, so its hoist runs along the top
and its upper hoist corner stays at the viewer's upper left. It's how a flag hanging
from a crossbar looks from the front. `from rotate` turns it a quarter turn clockwise,
which moves the upper hoist corner to the upper right. `from half-turn` turns it all the
way around, which moves the upper hoist corner to the lower fly. `from invert` turns it
upside down with its hoist still at the hoist, as a flag flown union down is, which moves
the upper hoist corner to the lower hoist. `from counter-rotate` is a quarter turn the other way, which moves the upper
hoist corner to the lower left. `from anti-transpose` reflects it across the other diagonal,
which moves the upper hoist corner to the lower right. `from mirror` swaps its hoist and fly,
as seeing the obverse from behind would, without giving the reverse's own design.

```
transpose:      (x, y) -> (y, x)
anti-transpose: (x, y) -> (H - y, F - x)
rotate:         (x, y) -> (H - y, x)
counter-rotate: (x, y) -> (y, F - x)
half-turn:      (x, y) -> (F - x, H - y)
invert:         (x, y) -> (x, H - y)
mirror:         (x, y) -> (F - x, y)
```

`transpose`, `anti-transpose`, `rotate` and `counter-rotate` swap the flag's width and height.
The others keep them.

**The reverse of a turned variant** is the mirror image of its turned obverse, as someone behind it
sees it. The turn comes first, and looking from behind then swaps left and right, so the hoist
stays on the edge that the turn put it on. A transposed flag, hanging from a crossbar, has its
hoist at the top on both sides. A reverse with its own design (§10) takes the place of the mirrored
obverse:

```
back = the reverse's own layers, as seen from behind, or else mirror(obverse)
reverse = mirror'(turn(mirror(back)))     // mirror' is across the turned flag's own width
```

That's the back turned by the turn's mirror image, which keeps the flag's outline and border with
it as the obverse's turn does:

| `from` | The back turns by |
|---|---|
| `none`, `mirror`, `half-turn`, `invert` | The same |
| `transpose` | `anti-transpose` |
| `anti-transpose` | `transpose` |
| `rotate` | `counter-rotate` |
| `counter-rotate` | `rotate` |

With `upright`, each charge on the reverse is drawn the way it is on the back, the right way up.

A variant with `upright` draws each charge exactly as it is on the obverse, around its own
position, leaving where it sits on the flag alone. It undoes the whole turn there, reflection and
all, so a crescent opening toward the fly on the obverse opens to the right under `mirror` or
`transpose` too. An emblem is put back as a whole, around its origin, so that its charges keep their
places in its frame. A polygon, pile or pall doesn't have a position to turn around, so it turns
with the flag. Each copy from a `repeat` or several `at`s is put back around its own
position. A charge's `clip` and `cut`s are shapes in the region, so they turn with the flag, for
one copy or many. `upright` applies to the whole variant. To keep only some charges upright, a
variant gives its own layers, turning those charges itself.

A `proportion` is for a form that a law or specification fixes in its own right, like an
official size beside the flag's usual one. Unlike `ratio`, it doesn't need `adapt`, and so
says nothing about the shapes in between. A variant with a `proportion` MUST have its own
layers, drawn on its own grid, and MUST NOT also have a `ratio`. The flag's own outline and
border don't carry over, since they were made for its shape, but the variant can give its own.

Rendering takes a variant's name, a side and a proportion as options. Asking for a
proportion overrides a variant's `ratio`. A proportion asked of a variant with its own is
reached by the flag's `adapt` rules, starting from the variant's shape.

## 13. Folding

A `fold` is a named way to fold the flag, for storage or ceremony. It isn't a `variant`,
because a variant is another form of the flag, while any form can be folded. Few flags
have an official way to fold, so `source` and `description` should say where one comes from.

```kdl
fold storage {
  description "In half lengthwise, then toward the hoist"
  source "https://example.test/how-to-fold"
  over along=fly at=5 move=bottom
  under along=hoist at=10 move=fly
}
```

Each step folds everything on one side of a crease, all layers at once:

| Step | Effect |
|---|---|
| `over` | The moving part comes toward the viewer and lands on top |
| `under` | The moving part goes behind |
| `tuck` | The moving part goes inside the fold, out of sight |

A crease is written `along=fly at=H move=top|bottom`, `along=hoist at=F move=hoist|fly`, or
for any line, `through="A B C D" move="E F"`, where the line runs through two points and the
part holding a third moves. Positions are where the flag lies at that step, not where those
points were on the flat flag. A step is written one way or the other, so one with `through`
MUST NOT also have `along` or `at`.

Only flat folds are modeled. A step MUST have something on both sides of its crease, and the
point saying which part moves MUST NOT be on it. The shape that folds is the flag's outline, or its
rectangle if it has none, and a `path` outline folds as its rectangle too, with the curve still
clipping the art on each piece. An `outside` border is part of the shape, so it folds with the flag.

Steps are checked when the document is read, on the flag's own shape. One that fails only at
another proportion, or with a variant's own outline, border or proportion, is an error when that's
rendered.

```
function fold(shape, steps):
    stack = [facet(polygon = shape, place = identity, flipped = false)]   // back to front
    for step in steps:
        mirror = reflection across step's crease
        kept, moved = [], []
        for f in stack:
            keep the part of f on the far side of the crease in kept
            add the part on the moving side to moved, with
                polygon = mirror(polygon), place = place then mirror, flipped = not flipped
        reverse moved
        case step.kind:
            over:  stack = kept + moved
            under: stack = moved + kept
            tuck:  stack = kept
    return stack
```

To draw a folded flag, paint each facet from back to front: the flag's artwork through
`place`, clipped to the facet's polygon. Because `place` mirrors a flipped facet, the flag's
default reverse needs nothing more. A flag with its own `reverse` paints that on flipped
facets instead, first mirrored across the flag so that it's in the same coordinates:

```
(x, y) -> (fly - x, y)
```

So that the folds can be seen, a renderer MUST mark each facet's edge with a black line of 35%
opacity with round joins, as wide as 0.4% of the longer side of the facets' bounds. It's drawn
above that facet and beneath the next. The image is cropped to the facets' bounds. Rendering takes a fold's name and optionally a number
of steps to stop after, which makes step-by-step instructions. A fold can't be applied
to a variant with a `from` other than `none`, `mirror` and `invert` included.

## 14. Output

Renderers targeting SVG or a similar format MUST make any generated IDs unique within what they
draw, and SHOULD make them unique to the document, for example with a hash of its source. Several
flags are often inlined in one page, where IDs share a single namespace and a collision would
make one flag use another's clip paths. A hash can't rule that out against a document trying to
collide, so a renderer SHOULD let whatever embeds it give the IDs a prefix of its own.

## 15. Limits

So that a small document can't demand unbounded work, a renderer MUST enforce these, and reject a
document when it's parsed, so that validating it says so too:

- Layers nest up to 32 levels deep. A top-level layer is at level 1, and so is a layer directly
  inside `reverse { }` or a `variant`, since those hold a flag's layers rather than adding a level.
  The count goes on through `use`: a `use` is one level, and what it names is nested within it.
- A flag paints up to 200000 parts, as counted below.
- Up to 10000 bars or wedges from a `count`, points of a star or sun, cells of `checks`, or copies
  from a single `repeat`.
- Up to 10000 waves in a shaped edge, and up to 10000 pieces from a fold. A fold's pieces are
  counted on the flag's own shape, step by step, when the document is read.

A number MUST be finite, with a magnitude that's zero or from 1e-12 to 1e12, so that nothing worked
out from it can overflow. A renderer MUST reject any other.

A flag's grid SHOULD stay under 10000000 units in each direction. Anything larger is valid, but some
SVG renderers lose precision past about 33000000, and draw clips and shapes wrongly or not at all.
Multiplying every length by the same factor gives the same flag on a smaller grid. A tool MAY warn
about a larger grid, and MAY draw on a smaller one, but MUST NOT change the document to do so unasked.

The size of a flag is the total over its layers, the layers of its `reverse` and the layers of each
`variant`. It's worked out without expanding anything, since each definition's size can be worked
out once, when it's read:

```
function size(layer):
    cuts = sum of parts(s) for s in the layer's cuts
    n = parts(the layer's clip, if it has one) + (copies * cuts for a charge, or cuts)
    case layer:
        bars:               n + colors * (1 + waves(edge)), or n + colors with no edge
        chevrons, rays:     n + colors
        quarters:           n + 4
        checks:             n + rows * columns
        charge, pile, pall: n + copies * parts(shape)
        emblem, group:      n + sum of size(child)
        panel, canton:      n + sum of size(child) + waves(edge)
        use:                n + sum of size(child) for each layer of the design it names
        anything else:      n + 1

function parts(shape):
    case shape:
        star, sun:      points
        polygon:        its points
        path:           1 + floor(bytes of d / 64)
        svg:            1 + floor(bytes of the sanitized markup / 64)
        anything else:  1

copies = the repeat's count, or rows * columns for a grid, or the number of `at`s, or 1
waves(edge) = 0 with no edge, or its count, or ceil(the longer side of the flag's proportion / period)
```

`colors` is after any `count`. The sanitized markup is in the canonical form of section 4.2 of the
[SDK](SDK.md), and its bytes are UTF-8.

The largest flag in the collection this was measured on, of 2,281, comes to 36,434 parts, 99% of
them are under 14,000, and half are under 70, so the limit leaves room for more than five times the
largest. The deepest nests 3 levels.

## 16. Decisions

[`docs/missing-from-spec.md`](docs/missing-from-spec.md) records the survey behind much of this
format's vocabulary. These were decided:

- **Cuts on repeats:** a charge's cuts go with each of its copies, turning with them, so a
  repeated crescent needs only one cut (§8.2).
- **Cardioid anchor:** a cardioid keeps its cusp as its position, which is exact. Centering one
  by hand is awkward, so an editor helps with that instead.
- **Upright charges:** `upright` applies to a whole variant. A variant that keeps only some
  charges upright gives its own layers (§12).
