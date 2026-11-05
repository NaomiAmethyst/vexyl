# What the spec is missing

This records what Vexyl needs before most flags can be written the way someone would
describe them. **None of it is implemented yet.** The syntax here is a sketch, and the
numbers in it show the shape of a file rather than checked constructions.

## The short answer

The format can already *draw* nearly every flag. The problem is that it often can't
*say* them. Bare polygons and inline SVG can produce a correct picture while telling a
reader nothing, so "intuitive" is the real gap:

| Measure | Result |
|---|---|
| Sovereign flags that read naturally today, by my judgment | 119 of 197 (60%) |
| Wider corpus: flags that import fully natively | 338 of 1,355 (25%) |
| Wider corpus: flags using only flag vocabulary, with no bare polygon or inline SVG | 189 of 1,288 converted (15%) |
| Inline SVG runs that are one color, so needn't be SVG at all | 3,227 of 6,131 (53%) |

Sixteen additions cover everything found, with three of them making most of the
difference to the wider corpus: `panel`, `path` and `define`.

## The additions, ranked

Counts are how many of the 197 sovereign flags need each one. "New" is how many become
natural when it's added, in this order. Things that matter more outside sovereign flags
are noted.

| # | Addition | Says | Needed by | New | Total natural |
|---|---|---|---|---|---|
| 1 | `panel` | A band or rectangle at a named place, holding its own layers | 19 | 14 | 133 |
| 2 | `crescent` | A named crescent, instead of a disc with a cut | 13 | 11 | 144 |
| 3 | `sun` | A disc with rays, touching or separated | 15 | 10 | 154 |
| 4 | Several `at`s, `repeat arc` | One charge at irregular positions, or along part of a circle | 13 | 10 | 164 |
| 5 | `fimbriate` on `chevrons` | Edged piles and chevrons | 6 | 6 | 170 |
| 6 | `saltire` `counterchange` | The Union Flag's offset red diagonals | 5 | 5 | 175 |
| 7 | `quarters` | A field divided per cross or per saltire | 4 | 4 | 179 |
| 8 | `hollow`, `lines` | A star or other charge drawn as an outline | 3 | 3 | 182 |
| 9 | `rays` | A field radiating from a point | 3 | 3 | 185 |
| 10 | `pile` | A triangle or trapezoid set by its edge and tip | 4 | 3 | 188 |
| 11 | `pall` | A Y-shaped division | 2 | 2 | 190 |
| 12 | `edge` | Wavy or zigzag lines between divisions | 3 | 3 | 193 |
| 13 | `lozenge` | A named rhombus | 2 | 2 | 195 |
| 14 | `reverse` | A different reverse side | 1 | 1 | 196 |
| 15 | Counterchange by `clip` | Colors swapping across a line (already possible; needs named clip shapes) | 1 | 1 | 197 |
| 16 | `path` and `define` | One-color curved shapes, and reuse of shapes and designs | see below | | |

The first five bring sovereign flags from 60% to 86%. Trapezoid and wedge from my
tagging are merged into `pile`, and wavy and serrated into `edge`.

Number 16 doesn't change that count, because I treated artwork as acceptable there. It
matters most for everything else:

- **`path`:** 53% of inline runs are one color. Japan's prefecture and clan flags are
  almost entirely this. It also gets palette colors, repeats, fimbriation and cuts for
  shapes like Canada's leaf, none of which inline SVG can have.
- **`define`:** Flags within flags are common outside sovereign states, such as the
  Union Flag in British territories' cantons, the Tricolore in French ones, and the
  tricolor in Indian ensigns. Ornamental strips (Mari El, Yamal, Belarus) are one motif
  repeated along a band.

Three smaller things matter outside sovereign flags, and appear in the sketches below:

- **Named outlines:** pennants, burgees and swallowtails, across signal flags, Indian
  military flags and Japanese clan flags. Curved ends like Aragon's banner need `path`.
- **`checks`:** signal flags November, Lima and Uniform, and the Wiphala.
- **`none`, and partial `ring`s:** South Kasai's open V, Colorado's "C" and
  Francophonie's segments.

## What each would look like

### `panel`

`canton` only reaches the upper hoist corner. A panel is any named part of its parent,
and it's a region, so bars and charges inside it just work. `canton` stays, meaning the
upper hoist corner.

```kdl
// Benin
bars yellow red
panel {
  side hoist
  width 6
  field green
}

// Zambia: bars inside a panel in the lower fly
field green
panel {
  corner lower-fly
  fly 4
  hoist 5
  bars red black orange {
    along hoist
  }
}
```

`side` is `hoist`, `fly`, `top` or `bottom`. `corner` is `upper-hoist`, `upper-fly`,
`lower-hoist` or `lower-fly`. Maldives's central panel takes `at` with a size.

### `crescent`, `sun`, `lozenge`, and hollow charges

```kdl
// Turkey
charge crescent white {
  radius 60
  inner 48
  offset 15
  at fly=120 hoist=120
}

// Philippines: eight rays around a disc
charge sun gold {
  radius 5
  disc 3
  points 8
  at fly=6 hoist=10
}

// Taiwan: rays set apart from the disc
charge sun white {
  radius 5
  disc 2.5
  gap 0.3
  points 12
  at center
}

// Brazil
charge lozenge yellow {
  fly 17
  hoist 11
}

// Morocco: a star drawn as lines
charge star green {
  radius 3
  lines 0.25
}
```

`hollow W` draws a charge's outline, and works on any shape. `lines W` draws a star's
chords where they cross, as on Morocco's and Ethiopia's. A partial ring takes `from`
and `to` angles, as Colorado's "C" does.

### Several positions, and arcs

```kdl
// Solomon Islands: repeat `at` for irregular positions
charge star white {
  radius 1
  at fly=2 hoist=2
  at fly=6 hoist=2
  at fly=4 hoist=4
  at fly=2 hoist=6
  at fly=6 hoist=6
}

// Venezuela: part of a ring
charge star white {
  radius 0.5
  at center
  repeat arc count=8 radius=5 from=-70 to=70
}
```

### Divisions: `quarters`, `checks`, `rays`, `pall` and `pile`

```kdl
// Panama, and signal flag Zulu per saltire
quarters white red blue white
quarters yellow blue red black {
  diagonal #true
}

// Signal flag November
checks blue white {
  rows 4
  columns 4
}

// Seychelles: from a corner
rays blue yellow red white green {
  from lower-hoist
}

// North Macedonia: from the center
rays yellow red {
  count 16
}

// South Africa
pall green {
  from hoist
  width 3
  fimbriate white 1
}

// Bosnia: a triangle set by its edge and tip
pile yellow {
  from top
  base 4 12
  tip 12 20
}

// Kuwait: a pile cut flat
pile black {
  from hoist
  depth 3
  flat 2
}
```

Each of these takes `fimbriate` where a real flag needs it, and so do `chevrons`.

### `edge`, and `counterchange`

```kdl
// Kiribati
bars blue white {
  count 6
  edge wavy depth=1 period=6
}

// Qatar: serrated, with nine white points
field maroon
panel {
  side hoist
  width 22
  edge zigzag depth=6 count=9
  field white
}

// The Union Flag, without a hand-built clip
field blue
saltire white {
  width 6
}
saltire red {
  width 2
  counterchange #true
}
cross red {
  fly 27 6 27
  hoist 12 6 12
  fimbriate white 2
}
```

Counterchange by `clip` already reads well, as on Greenland's disc or bars reversed
inside a triangle. It only needs clips to accept the named shapes above.

### `path`, `define`, and reuse

`path` keeps vector data inside a flag charge. It's the one part of the format that
isn't flag language, and it's for shapes that have no other name. It still gets a
palette color, a position and everything else a charge gets.

```kdl
// Canada
define leaf {
  path "M50 0L60 30 90 20 80 50 100 60 50 100 0 60 20 50 10 20 40 30Z" box="0 0 100 100"
}
bars red white red {
  along hoist
  ratio 1 2 1
}
charge leaf red {
  fly 8
  hoist 8
}

// A flag within a flag: Tuvalu, or any British territory
define union {
  field blue
  saltire white {
    width 6
  }
}
field sky
canton {
  fly 30
  hoist 15
  use union
}

// An ornamental strip: Mari El, Belarus
define motif {
  path "M0 0H10V10H0Z" box="0 0 10 10"
}
panel {
  side hoist
  width 2
  field white
  charge motif red {
    fly 2
    hoist 2
    at fly=1 hoist=1
    repeat line count=10 hoist=2
  }
}
```

Definitions live in the file, so files stay self-contained.

### Named outlines, `none`, and `reverse`

```kdl
// Swallowtails and pennants: Denmark's state flag, or signal flags
outline swallowtail {
  depth 9
}
outline pennant {
  tip 1
}

// South Kasai: `none` leaves a gap in a color list
chevrons none gold {
  from top
  depth 8
  ratio 9 1
}

// Paraguay: a different back
reverse {
  bars red white blue
  charge disc white {
    radius 2
  }
}
```

## What vexillology's own terms map to

| Term | Status |
|---|---|
| Field, fly, hoist, charge, emblem, fimbriation, canton | In the spec |
| Per pale, per fess, tricolors, stripes, per bend, per bend sinister | `bars` |
| Pale, fess, bend, bend sinister | `band` |
| Greek, symmetric and Nordic cross | `cross`, `plus` |
| Saltire, chevron, roundel (`disc`), annulet (`ring`), billet (`rect`) | In the spec |
| Border, bordure | `border`, `panel` |
| Side, chief, base | **`panel`** |
| Per cross, per saltire | **`quarters`** |
| Pile, pile throughout, arrowhead, gusset | **`pile`**, `chevrons` |
| Lozenge, lozenge throughout, fusil | **`lozenge`** |
| Pall, shakefork | **`pall`** |
| Mascle, voided charges | **`hollow`** |
| Gyron, gyronny | **`rays`** |
| Wavy, indented, dancetty | **`edge`** |

Left out, because no flag I saw needed them: flaunches, fret, gore, orle and tressure
as such (a `panel` or `border` does it), rustre, and engrailed or raguly lines. If
Burgundy's raguly cross needs drawing, `path` does it.

## Deliberately not missing

- **Lettering and seals:** these stay inline SVG, as decided. They're common on US state
  flags and on organization flags, but they don't belong in the vocabulary.
- **Interlacing:** the Olympic rings and the polyamory knot go over and under
  themselves, so they're artwork.
- **Fringes:** rare, and on Rhode Island's they're a decoration of the object.
- **Radial gradients, filters and images:** in the flags I looked at, these were inside
  emblems, or decoration like a shadow. Inline SVG carries radial gradients, and the
  others shouldn't be in a shareable flag file. I didn't inspect all 37 flags with
  gradients the importer couldn't map.
- **Text support in SVG:** 30 of the 1,355 files use real `<text>`, which can't render
  the same without their fonts. Converting them to paths is the right fix.

## How this was determined

1. **Against the terminology:** I mapped Wikipedia's glossary of vexillology, its list of
   national flags by design, and the heraldic ordinaries to the spec.
2. **By tagging:** I looked at all 197 sovereign flags and tagged what a natural
   description of each needs.
3. **By counting:** a classifier named every bare polygon and inline run the importer
   left, across 1,355 more flags from 15 families.
4. **By saturation:** I fixed the list, then looked at fresh random flags, stopping after
   three sheets in a row showed nothing new. The first three holdout sheets, 192 flags,
   added two small things (`none`, and curved outlines). The next three, 192 more, added
   nothing.

That's about 1,040 flags viewed, of 2,482 identified, with the rest counted by machine.
Signal, ethnic, organization, Japanese, Russian and Indian families were each viewed
before the holdout, because they were the likeliest to differ.

## Limits

- **"Reads naturally" is my judgment:** another reader would tag some flags differently.
  The ranking should hold up better than the exact counts.
- **The sketches are untested:** they're valid KDL, but nothing implements them, and
  writing real flags in them will surely change some details. `offset` on `crescent`,
  and `pile`'s parameters, are the least settled.
- **The corpus is Wikipedia's:** it leans toward states, regions and history, and has
  few city, corporate or subcultural flags. 820 flags it listed were never downloaded,
  because I stopped once the list had saturated.
- **Some classifier categories are noisy:** stars drawn as triangles and pieces of
  emblems show up as polygons, so I've only relied on its broad figures.
