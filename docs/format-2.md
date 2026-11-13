# Plans for format 2

Format 1 is frozen: [`SPEC.md`](../SPEC.md) and [`SDK.md`](../SDK.md) won't change what a
document means. This collects what writing flags since the freeze has shown it can't say, for a
format 2. None of it is settled, and the syntax is a sketch.

A document would say `vexyl 2` to use any of it. Every format 1 document would stay valid and
mean the same, and libraries would read both, so the additions are all optional, with defaults
that keep today's drawings unchanged.

The second half lists things the text of format 1 leaves open. Those don't need a new format:
they can be settled in the version 1 text, as SDK §7.3's wording on where a part ends was, as
long as the libraries already agree.

## Additions

### `production`, for flag makers

A flag maker needs more than the design: the physical size, the material, the hem and heading,
grommets or a sleeve, whether it's printed on one side or both, and tolerances. As far as is
known there's no standard way to hand them this; they work from vector files and a spec sheet.
Ask a few manufacturers what they'd want before designing it.

```kdl
production {
  size hoist=36 fly=60 unit=in
  heading side=hoist width=2 { grommets 2; }
  hem 0.5
  sides double
}
```

An exporter would turn it into the files and sheet a maker asks for.

### `label` on sizes, for construction sheets

A law often names its measurements with letters, like the United States' A to L, and a
construction sheet should be able to use them instead of numbering its own.

```kdl
proportion hoist=10 fly=19 {
  label hoist A
  label fly B
}
canton {
  hoist 7 { label C; }
  fly 7.6 { label D; }
}
```

Where a label can attach is the hard part: anywhere a size is given, which is most nodes.

### A heart's tip and sides

A `heart` is two discs joined to a tip by straight sides that always meet at a right angle
(SPEC §8.1), so only its size (`radius`) and its width and notch (`spread`) can change. Several
pride flags' hearts don't fit:

- Pride-Flags' 2016 heart, used for the abro-, bi-, omni-, pan-, homo- and ceteroromantic
  flags, has sides that bow outward and a deeper notch. The closest `heart` is 1.3 to 1.8% off
  the designer's image, and 3.1% with ceteroromantic's outline.
- SavvyRed's 2013 ceterosexual heart is rounder all over, with a blunter tip. About 40% of its
  outline's area misses.

Two settings would cover them:

```kdl
charge heart red {
  radius 1
  tip 110      // the angle at the tip; 90 by default
  bulge 0.15   // how far the sides bow out, as arcs touching the discs; 0 by default
}
```

### Angles in constructions

Numbers are decimals, and the format has no trigonometry, so a construction given in degrees
has to be worked out to decimals. A drawing of Lingua Franca Nova's flag sets its rays' ends by
18-degree divisions, and writing it took ratios to nine places (0.649839392 and so on) where the
drawing says 18 and 36 degrees.

`rays` could take the angle between each ray's edges as well as how far along the edge they end:

```kdl
rays blue green yellow orange red {
  from lower-hoist
  angles 18 18 18 18 18   // in degrees, summing to the corner's 90
}
```

The same need may turn up elsewhere: a saltire or pile set by its angle rather than its width,
or a star's points by their angle. Only add it where a real flag needs it.

### Stroked lines

Letters and marks made of strokes, like the V, T and N of the relationship flags, the
apothisexual flag's X and the egalitarian flag's equals sign, have to be written as filled
polygons or rotated rectangles today. That spells out each stroke's corners, can't give rounded
joins and ends, and doesn't read as a stroke. The NonMonoPrideFlags designer's V and N have
rounded joins, which the drafts had to mitre instead.

A `line` shape would be a stroke along points, with a width, caps and joins:

```kdl
charge line cyan {
  points "-1 -1, 0 1, 1 -1"   // a V
  width 0.2
  cap round
  join round
  at center
}
```

### Artwork that refers to itself, and its colors

- **`<use>` inside inline SVG.** The sanitizer refuses `<use>`, so artwork that repeats a part
  by reference has to be written out in full. The MOGAI symbol from Commons had to have its
  `<use>` elements expanded into paths. A `<use>` whose `href` points inside the same artwork
  could be allowed, within the nesting and size limits.
- **Palette colors in artwork.** Only `currentColor` links artwork to the palette, so artwork
  with a second color carries it as a fixed value. Polyaffectionate's pi needed a black outline,
  which had to be written into the drawing rather than taken from the palette. A charge could map
  the artwork's colors to palette names:

  ```kdl
  charge svg {
    markup "..."
    colors { "#ffffff" white; "#000000" black; }
  }
  ```

### Where a source survives

Most pride flags' defining posts survive only in the Wayback Machine, so a file cites the
snapshot it read, and the original address is lost unless a note gives it. Designers also rename
their accounts (noodle became noodlemoved, aethersys became anarchysys, spencerhastings became
wellick), which breaks the original address in a way the snapshot doesn't show.

```kdl
source "https://noodle.tumblr.com/post/168028780536" {
  archived "https://web.archive.org/web/20220622041323/https://noodlemoved.tumblr.com/post/168070202366"
}
```

### Dates that are known only as a bound

`date` is for when a version was introduced, and only if it's verified. Often what's known is a
bound instead: the genderflor flag was out "on or before 30 April 2018", the femme flag by 30
November 2017, and androgyne's year rests on a timestamp in the post's notes. Such flags have no
date now, or one given only in a note.

```kdl
date "2018-04-30" { by; }   // introduced no later than this
```

## Clarifications for the version 1 text

Writing the Java library from the frozen documents alone turned these up. In each, the libraries
already agree, and the text should say what they do. The full list, with what Go does for each, is
in [`format-1-open-questions.md`](format-1-open-questions.md).

### Reading

- **A property given twice** (SPEC §4): whether it's a syntax error or a problem on the node.
- **Small numbers in path data** (SPEC §8.1 and §15): §8.1 gives paths only the upper limit, while
  §15 says every number is zero or from 1e-12. All three libraries allow `1e-20` in a path.
- **Dates** (SPEC §4.1): whether `YYYY-MM-DD` has to be a real day, whether year `0000` is
  allowed, and how `until` compares with a `date` of a different precision.
- **Where some problems go** (SDK §2): a `render-license` problem, and a type annotation's.
- **A defined shape a charge changes** (SDK §4): whether a star's `inner` or a heart's `spread`
  is worked out again when a charge using the definition changes its size.
- **Several `at`s with `at center`** (SDK §4).
- **When folds are checked** (SPEC §13): only when the document has no other problems.
- **`locate` with a name that isn't a string** (SDK §7.3), such as `define 5 { ... }`.

### Rendering

- **IDs from a hash** (SDK §5, SPEC §14): which hash, of what, and how two forms of one document
  get different IDs.
- **A ratio equal to the flag's own** (SPEC §11): within 1e-9 counts as unchanged.
- **Whether `adapt`'s `range` is inclusive** (SPEC §11): it is.
- **A design with its own grid** (SPEC §9): whether "scaled to fill" may stretch it unevenly.
- **Fimbriation on piles and palls** (SPEC §7.10): the sides are extended past the region.
- **How finely curves are drawn** (SPEC §7.11, §8.1): the error allowed for waves and cardioids,
  and when an edge's waves are counted.
- **Adapting side panels and placed panels** (SPEC §11): what size their layers see.
- **An emblem's frame under a cut** (SPEC §9, §6): the rectangle a cut's mask uses.
- **A ring's arc on a rotated charge** (SPEC §8.1): the charge's turn is added to `from` and `to`.
- **Tags in a fold** (SPEC §13, SDK §7.2): which element carries the tag.
- **A fold at another proportion with its own reverse** (SPEC §13): the reverse adapts too.
- **Upright charges on a mirrored reverse** (SPEC §12).
- **The order options are checked in** (SDK §3).
- **Padding a turned variant** (SPEC §11.1): to the inverted ratio.
- **Bars, quarters and checks running on under the next part** (SPEC §7.3).
- **Number precision in SVG output** (SDK §5).

### Inline SVG and share links

- **The sanitizer** (SPEC §8.3): nesting depth, the XML declaration, an empty `viewBox`, the
  grammar of an `href` id, which functions count, prefixes inside removed content, `xmlns=""`,
  and empty or `currentColor` values in a `style`.
- **Share links** (SDK §8): stray bits after the stream's end, how a version prefix is read, the
  command dropping only trailing line feeds, and the compression level.

## Left undefined on purpose

Two edge cases were left out of format 1 because no real flag needs them, and they'd be costly
to define: upright variants of a design with asymmetric cuts, and adapting a grid that has cuts.
Revisit them only if a flag turns up that does.
