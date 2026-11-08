# Vexyl SDK specification

**Status:** version 1, frozen with the format. A change to what a library must do needs a new
version.

Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>. This
specification is licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

This describes what every Vexyl library offers, whatever its language, so that a program can
move between them. [SPEC.md](SPEC.md) defines the format and how it's drawn. The key words
MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

This and SPEC.md are normative. Go is the reference implementation, and the
[conformance suite](conformance) is what a library has to pass, but where either disagrees with
these documents, it's the one to be fixed.

## 1. Operations

Names follow each language's conventions: `svgTree`, `SVGTree`, `svg_tree`.

| Operation | Takes | Gives |
|---|---|---|
| `validate` | A document as a string | Its problems, empty if it's valid |
| `parse` | A document as a string | A flag, or its problems |
| `model` | A flag | The flag as plain data, in the canonical form of section 4 |
| `svg` | A flag and options | An SVG document as a string, or an error |
| `svgTree` | A flag and options | The same document as a tree of elements, or an error |
| `locate` | A document as a string | Where each of its layers and other parts is, as in section 7 |
| `layerAt` | What `locate` gives, and a line | The innermost of them holding that line |
| `shareEncode` | A document as a string | The document as a share link, as in section 8, or an error |
| `shareDecode` | A share link | The document it holds, or an error |

A library MUST NOT read the network or the filesystem to do any of these, because a document
is self-contained. It MUST enforce the limits in section 15 of the format when reading a document. It MAY offer conveniences that read files, separately.

A flag is a native structure: a library SHOULD use its language's own types. It MUST NOT change
when rendered, so one flag can render with many options.

## 2. Problems

`validate` and `parse` report every problem they can find in a document, not just the first. A
KDL parser may stop at its first syntax error, so a document with one MAY report only that.

| Field | Meaning |
|---|---|
| `line`, `column` | Where it is, from 1, or absent if it has no one place. A line ends at LF, once line endings are normalized, even though KDL also counts others as newlines. A column counts code points |
| `node` | The KDL node it's about, or absent |
| `message` | What's wrong, for a person to read |

Wording and order are the library's own, so programs MUST NOT depend on them. A valid document
MUST have no problems. An invalid one MUST have at least one, and for a problem that isn't a
syntax error, one on the line that the suite records. That's the line where the node it's about
starts:

- A value that's wrong in itself is on the node holding it: a child such as `angle 90`, or a node
  with a bad property or argument, such as a `repeat` or a color's value.
- Something missing, or values that don't go together, is on the node they belong to: a `charge`
  with no `radius` or an `inner` past it, a `bars` whose `ratio` doesn't match its colors, or a
  `pile` with both `depth` and `tip`. So is a sun's `points` below 3 or `spread` above 1, and a
  negative value in `grow`. A gradient's `stops` that don't match its colors are on `stops`.
- A shape's problems are on the node naming it, which for a charge is the `charge`, and inline SVG's
  are on its `charge` too.
- A child given twice is on the second, and an unknown one on itself. A top-level node out of order
  is on itself.
- An outside border that can't go around the shape is on the `border`, or on the `variant` whose
  outline or border brings them together.
- A flag that paints too much is on the top-level layer that takes it past the limit, or on the
  `reverse` or `variant` whose layers do. A layer nested too deep is on itself, or on the `use` whose
  definition takes it too deep. Too many waves are on the layer with the `edge`, too many cells on
  the `checks`, and too many copies from a grid on its `repeat`.
- Some have no one place, so no line: a document that doesn't start with `vexyl`, a missing `meta`,
  `palette` or `proportion`, a variant's `ratio` when there's no `adapt`, and a fold whose steps fail
  on the flag's shape.

A document can name its colors, definitions, variants and folds anything but the empty string,
including `__proto__`, `constructor` or `toString`, and those names are keys in the model. A library
MUST NOT let them reach its language's own properties, and code reading a model has to take the
same care: in JavaScript, not copying one of its maps with `Object.assign` to a plain object, say.

## 3. Options

Every option is optional, and rendering with none gives the flag as it is. A command line can write
`ratio` as hoist then fly, as flags' proportions are, but the option itself is fly divided by hoist.

| Option | Values | Default | Meaning |
|---|---|---|---|
| `height` | A positive number | 600 | The image's height in pixels. Its width follows the proportion |
| `ratio` | A positive number | The flag's own | The proportion wanted, as fly divided by hoist, measured before a variant turns it, both for adapting and for padding |
| `fit` | `error`, `pad` | `error` | What to do if the flag can't reach `ratio` |
| `align` | `start`, `center`, `end` | `center` | Where a padded flag sits |
| `variant` | A variant's name | None | Which form of the flag |
| `side` | `obverse`, `reverse` | `obverse` | Which side of the flag |
| `fold` | A fold's name | None | Show the flag folded |
| `foldStep` | A whole number | All of them | Stop a fold after that many steps |
| `idPrefix` | What an `id` can start with | Worked out from the document | Start every ID in the output with this |
| `tags` | `true`, `false` | `false` | Mark each drawn element with the layer that drew it, as in section 7 |

Section 11.1 of the format says what `ratio`, `fit` and `align` do. A flag that can't reach a
proportion MUST be refused unless `fit` is `pad`, so that nothing distorts or silently changes
shape.

These MUST be errors, so that no option is ever silently ignored:

- Asking for a variant or a fold that the flag doesn't have, or an unknown value.
- A `height` or `ratio` that isn't a positive number within the format's limits, including 0.
- `fit` with neither a `ratio` nor a variant that has one, and `align` unless `fit` is `pad`.
- `foldStep` without `fold`, or that isn't from 1 to the fold's number of steps.
- A `fold` on a variant with a `from` other than `none`, with `side` of `reverse`, or with `fit` of
  `pad`. A fold shows
  both sides and is cropped to its pieces, so neither has a meaning. A `fold` with a `ratio` folds
  the flag at that proportion.

## 4. The model

`model` gives a flag as plain maps, lists, strings, numbers and booleans. It's the same in every
language, so the suite can compare what a library understood, apart from how it draws. Its numbers
compare allowing a difference of one part in a million of the larger, or of 0.000001 where both are
less than 1. [`conformance/model.schema.json`](conformance/model.schema.json)
is the same thing as a schema, and every library's models have to fit it.

Three rules say what's there:

- **A name is the format's own term.** A node's name is its key, so the top level has the nodes of
  section 4 of the format: `vexyl`, `meta`, `palette`, `proportion`, `outline`, `border`, `define`,
  `layers`, `reverse`, `adapt`, `variant` and `fold`. A repeatable node gives a list under its own
  name, such as `note`, `cut`, `at` or `point`, and a named one gives a map under its own name, such
  as `define`, `variant` and `fold`.
- **A value is left out if, and only if, it equals the format's default.** The fixed defaults are below. A
  zero that means something stays, so `at` at the origin isn't the same as no `at`, and two flags
  that draw differently never have the same model.
- **What depends on other values is worked out.** `inner` on a star, `spread` on a heart, `stops`
  on a gradient and `ratio` on `bars`, `chevrons` and `rays` are always there, and `count` has
  expanded a list's colors, so `colors` and `ratio` are the same length.

Anything that can't be worked out without a region stays left out: a `lozenge` without a size, a
pall without a `junction`, a pile without a `base`.

### 4.1 Fields

Each thing that comes in kinds says which it is in a field of its own: `layer`, `shape`, `form` or
`step`. Where nothing's said about the type below, a field is a number, or a string if it names
something.

| Value | Fields, with any default |
|---|---|
| Top level | `vexyl` 1; `meta`; `palette`; `proportion`; `outline`; `border`; `define`; `layers`; `reverse`; `adapt`; `variant`; `fold`. The first four are always there |
| `proportion` | `hoist`, `fly` |
| `meta` | `name`, `description`, `version`, `date`, `until`, `series`, `design-rights`, `license`, `render-license`; lists of `note`, `designer`, `encoder`, `source`, `law`, `restriction` and `adapted-from` |
| `law`, `restriction` | The text under its own name, as `law` or `restriction`, and a list of `source` |
| `adapted-from` | `url`, a list of `author`, `license`, `part` |
| A `palette` color | `color`, in lowercase; `pantone`, `ncs`, `ral`, `munsell`, `thread`; a list of `dye`; `cmyk` as four numbers; a list of `reference`, each with `system` and `value` |
| A `palette` gradient | `gradient`, a list of colors; `stops`; `along` (`fly`) |
| `border` | `color`, `width`, `side` (`inside`) |
| `fimbriate` | `color`, `width` |
| `outline` | `form`: `polygon` with `point`; `path` with `d`, `box`; `swallowtail` with `depth`, `taper` (0); `tongued` with `depth`, `tongue`; `pennant` with `tip` (0) |
| A `define` | A shape, or a design with `layers` and its own `proportion` |
| `reverse` | `layers`. `reverse mirror` is the default, so it isn't there |
| `adapt` | `range` as two numbers; `wider`; `narrower`. `cut` means the same as `extend`, so it reads `extend` |
| A `variant` | `from` (`none`), `upright` (false), `ratio`, `proportion`, `outline`, `border`, `layers` |
| A `fold` | `description`; a list of `source`; `steps` |
| A step | `step`: `over`, `under` or `tuck`, with `along`, `at` and `move` as they were written, or `through` as four numbers and `move` as two |
| `edge` | `form`: `wavy` or `zigzag`, with `depth`, then `period` or `count` |
| `repeat` | `form`: `ring` with `count`, `radius`, `turn` (false); `arc` with those and `from`, `to`; `grid` with `rows`, `columns`, `stagger` (false); `line` with `count`, `fly` (0), `hoist` (0) |

Every layer has `layer`, and may have `anchor` (none), `opacity` (1), `blend` (`normal`), `clip`, and
a list of `cut`. Layers don't otherwise repeat each other, and `layer` is the node's own name:

| `layer` | Other fields, with any default |
|---|---|
| `field` | `color` |
| `bars` | `colors`, `ratio`, `along` (`fly`), `rotate` (0), `grow`, `edge` |
| `chevrons` | `colors`, `ratio`, `depth`, `from` (`hoist`), `angle`, `apex`, `rotate` (0), `fimbriate` |
| `band` | `color`, `width`, `along` (`fly`), `offset` (0), `rotate` (0), `fimbriate` |
| `cross` | `color`, `fly` and `hoist` as three numbers each, `fimbriate` |
| `saltire` | `color`, `width`, `counterchange` (false), `fimbriate` |
| `quarters` | `colors`, `diagonal` (false), `split` |
| `checks` | `colors`, `rows`, `columns`, `flow` (`bend-sinister`) |
| `rays` | `colors`, `ratio`, `from` (`center`) as a name or a position, `rotate` (0), `measure` (`angle`) |
| `pile` | `color`, `from` (`hoist`), `base`, `tip`, `depth`, `flat`, `hollow`, `fimbriate` |
| `pall` | `color`, `width`, `from` (`hoist`), `junction`, `hollow`, `fimbriate` |
| `charge` | A shape's fields, then `color`, `fimbriate`, `repeat` |
| `emblem` | `at`, `along`, `rotate` (0), and `layers`, each a `charge` |
| `group` | `layers` |
| `panel` | `side`, `width`, `corner`, `at`, `fly`, `hoist`, `edge`, `layers` |
| `canton` | `fly`, `hoist`, `layers` |
| `use` | `name`, whose definition is under `define` |

A shape has `shape`, `at`, `rotate` (0) and `hollow`, then:

| `shape` | Other fields, with any default |
|---|---|
| `disc`, `triangle`, `cardioid` | `radius` |
| `ellipse`, `rect`, `lozenge` | `fly`, `hoist` |
| `ring` | `radius`, `inner`, and `from` and `to` together if it's an arc |
| `plus` | `radius`, `width` |
| `star` | `radius`, `inner`, `points` (5), `lines` |
| `crescent` | `radius`, `inner`, `offset` |
| `sun` | `radius`, `disc`, `gap` (0), `points` (12), `spread` (1) |
| `heart` | `radius`, `spread` |
| `path` | `d`, `box` as four numbers, `fly`, `hoist`, `evenodd` (false) |
| `polygon` | `point` |
| `svg` | `fly`, `hoist`, `markup` |
| `pile`, `pall` | As the layers of those names, only in a `clip` or `cut` |

A position is `fly` and `hoist`, both always there. A shape's `at` is a list of positions and the
word `center`. One `at center` is the default, so it isn't there.

A charge using a defined shape gives that shape's fields, with the charge's changes applied.

### 4.2 Inline SVG

Inline SVG is as it is after being sanitized, and the source's other content isn't kept anywhere.
Every library writes it in this one form, so that models compare exactly and the format's size
limit counts the same bytes:

```
markup    = "<svg" ' xmlns="http://www.w3.org/2000/svg"' ' viewBox="' viewbox '"' attribute* ">"
            element* "</svg>"
element   = "<" name attribute* ">" element* "</" name ">"
attribute = " " name '="' value '"'
```

- `viewbox` is the root's four `viewBox` numbers as written, joined by single spaces, or else
  `0 0 W H` with its `width` and `height` as written, without any `px`.
- The root's attributes are its others, without the root-only ones that section 8.3 of the format
  removes. Elements and attributes are in source order, with nothing between elements, and elements
  are never self-closed.
- A `name` is the local name, with no prefix. `xlink:href` is written `href`. Namespace declarations
  aren't attributes, so they aren't written.
- Removed are comments, processing instructions, the XML declaration, whitespace and CDATA between
  elements, `title`, `desc` and `metadata` and elements in another namespace with all they hold, and
  attributes in another namespace.
- A value is as XML reads it, with references resolved and literal tabs and newlines as spaces. IDs
  and `href`s are as written. In a presentation attribute, each `url(#id)` is written just so, however
  its case, spaces and quotes were written, and the rest is as it was.
- A `style` is its declarations in order, each `property:value` with the property in lowercase,
  neither with whitespace around it, and with any `url(#id)` written as above. Empty ones are
  dropped, and the rest are joined by `;`.
- In values, `& < > " ' tab LF CR` are written `&amp; &lt; &gt; &#34; &#39; &#x9; &#xA; &#xD;`.

So `<s:svg xmlns:s="http://www.w3.org/2000/svg" version="1.1" width="20px" height="10"><s:rect
style="FILL : URL( '#g' ) ; ;"/></s:svg>` is written
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect style="fill:url(#g)"></rect></svg>`.

## 5. SVG output

A library MUST give an SVG that draws the same image as the reference, within the suite's
tolerance. It needn't give the same text, so the order of elements, IDs and number formatting
are its own. It SHOULD write coordinates to at least 6 decimal places, because the tolerance is
calibrated for rounding to 4. Scales need significant digits rather than places: a path in a box
tens of thousands wide, on a grid of a few units, is scaled by a very small number.

`svgTree` gives elements with a name, attributes in order, text and children. Only a `title` or
`desc` holds any text, because SVG lettering isn't allowed. Writing the tree out MUST give a
document that draws the same as `svg`, with the same title and description.

IDs in a document SHOULD NOT collide with those of a different document, or a different form of
the same one, so that several flags can be inlined in one page. A library works them out from a
hash of the document, which is enough for documents that aren't trying to collide. A hostile one
can search for a hash that lets its definitions capture another flag's references, so a page showing
documents it doesn't trust MUST pass an `idPrefix` that it knows is unique. Each is then an `id`'s
first characters, and within one render, IDs MUST be unique.

Inline SVG MUST be sanitized as section 8.3 of the format says, in every library. It's the one
place where a document can carry another format's markup, and a gap here is a security problem.

A render MUST NOT hold anything that inline SVG couldn't, apart from these:

- its root `svg`, with `viewBox` and `preserveAspectRatio`, and other `svg` elements with those,
  outside artwork;
- a `title` and a `desc` directly in the root, which are the only elements holding text;
- `use`, outside artwork, as a fold places its pieces;
- `data-vexyl-layer` in a tagged render (section 7.2).

Every `href` is `#id` and every function in a value is `url(#id)` or a color, as in artwork, and no
two elements have the same `id`.

Each layer that section 6.1 of the format says is composited as a unit, a `group`, `panel` or
`canton`, or any layer with an `opacity` below 1, a `blend`, a `clip` or a `cut`, MUST be drawn in a
group that has `isolation: isolate`, in its `style` or as an attribute. Without it, a blend inside a
layer that has only a clip or a mask could mix with what's outside it in one renderer and not in
another, since SVG doesn't say that those isolate a group.

## 6. Conformance

A library passes when the suite in [`conformance/`](conformance/README.md) reports no failures,
at the suite's version for the format's version, which `manifest.json` gives as `version` and
`format`. It has these parts:

| Part | Checks |
|---|---|
| Renders | Each flag, in each form, compared with the expected SVG as pixels |
| Models | Each flag's model, compared with the expected JSON |
| Models fit | Each flag's model fits `model.schema.json` |
| Distinct models | Documents that mean different things have different models |
| Invalid documents | Each is refused, with a problem on the expected line |
| Accepted documents | Each is valid, including those exactly at a limit |
| Sanitizer output | Each piece of artwork comes out as expected, in the model and in a render |
| Tagged renders | Each render draws exactly what the plain one does, and says which layer drew what |
| Locations | Each part of a document is found on its lines, and those lines lead back to it |
| Share links | Each library reads the suite's links, refuses its bad ones, and writes links that zlib can read |

Every render is also checked for what mustn't be in it, as section 5 says, since pixels can't show
those.

Each library offers a small command for the suite to run, as the `vexyl` command does.

## 7. Layers and where they are

A program that shows a flag beside its source has to go from something on the image to the term that
drew it, and to its lines, and back. Layers have paths for this.

### 7.1 Paths

A layer's path is its position among the layers of whatever holds it, from 0, with a dot for each
level: `3` is the fourth layer at the top of the flag, and `3.1` the second layer inside it. Only
layers count, so a panel's `fly` doesn't use up a number, and neither does a `clip`. A path starts
with a scope if its layers aren't the flag's own:

| Path | Is |
|---|---|
| `3`, `3.1` | The flag's own layers |
| `reverse/0` | A layer of the flag's `reverse` |
| `variant/NAME/0` | A layer of a variant with its own layers |
| `border`, `variant/NAME/border` | The flag's or a variant's border |

In a name, `%` is written `%25` and `/` is written `%2F`, and nothing else changes, so any name can
be in a path, including `__proto__`. As in section 2, these are keys to keep away from a language's own
properties. Paths are only as stable as the document: adding a layer renumbers those after it.

### 7.2 Tagged renders

With the option `tags`, every element that draws something MUST have an attribute
`data-vexyl-layer` holding the path of the layer that drew it. That's any shape, and each piece
of inline SVG, which is marked on its own root as one thing. Whatever's only a definition isn't marked, such
as what's in a `clipPath`, a `mask` or a gradient. A fold's artwork is in `defs`, but it's drawn with
`use`, so it's marked. Nothing else in a render changes, so it MUST draw the same pixels
as without the option.

These keep a path through whatever changes the drawing but not the layer:

- A charge's copies from a `repeat` or several `at`s all have the charge's path.
- A variant without its own layers, a mirrored reverse, another proportion, padding, and a fold, all
  have the paths of the layers they show.
- Everything drawn through a `use` has the path of the `use`, however deep it is in the definition,
  since the `use` is what's in the document at that place.
- A layer that holds others, such as a `panel`, draws nothing of its own, so only its children's paths
  appear. Its own path is the part of theirs before the last dot.

A fold's crease lines are the one thing no layer draws, so they aren't marked. The attribute is off the
sanitizer's allowlist on purpose: it can't be in artwork, so only a renderer can have written one.

### 7.3 Locations

`locate` gives a list in document order, with each part's `path`, its `node`, and where it starts and ends, as `line`,
`column`, `endLine` and `endColumn`, counted as a problem's are in section 2. A part ends at its last
character, not counting a `;` or line ending. As well as each layer by its path, these are there:

| Path | Is |
|---|---|
| `vexyl`, `meta`, `palette`, `proportion`, `outline`, `border`, `reverse`, `adapt` | That top-level node |
| `palette/NAME` | One color |
| `define/NAME`, `define/NAME/0` | A definition, and its layers |
| `variant/NAME`, `variant/NAME/outline`, `variant/NAME/border` | A variant, and what it replaces |
| `fold/NAME` | A fold |

It reads only the document's syntax, so that a program can still find its way around a document with
other problems, and it gives nothing for one that isn't KDL. It doesn't check that a layer's name or a part's
place is valid, since `validate` does that. `layerAt` gives what holds a line: of those that do, the one that
starts latest, and in a tie, whichever comes last.

## 8. Share links

A share link holds a whole document in the fragment of a URL, so that it can be passed around and
opened without any server storing it or even seeing it:

```
#v1.<base64url of raw DEFLATE with a preset dictionary>
```

`shareEncode` gives the part after the `#`, and `shareDecode` takes it. A library MUST follow these,
so that each reads the others' links:

- The compression is raw DEFLATE (RFC 1951), with no zlib or gzip wrapper, of the document's exact bytes
  in UTF-8. Line endings and a byte order mark are kept.
- The base64url (RFC 4648 section 5) has no padding. Anything else MUST be refused: `=`, a character
  outside the alphabet, whitespace, an impossible length, or stray bits in the last character.
- The preset dictionary of version 1 is the file [`share/v1.dict`](share/v1.dict), of 8,192 bytes, with a SHA-256
  of `92062df2fd010bea13d1aefb30c2cfbb2ad6aee5a60e8f8e2d2455516c1c6b97`. This file is normative. A
  dictionary can never change once it's released, because every link ever sent depends on every byte of it, so
  a better one would be a new version, with a new prefix, read beside this one.
- A decoder MUST refuse a stream that's corrupt, ends early, or has anything after its end, apart from
  the bits that fill its last byte, and one holding anything but UTF-8. It MUST refuse a version it doesn't know.
- A link can hold up to 8 MiB (8,388,608 bytes). A decoder MUST stop as soon as its output passes
  that, rather than finding out afterward, since a few kilobytes of link can inflate to gigabytes.
  An encoder MUST refuse a larger document.

What's in a link is untrusted, like any other document. It's held only in the fragment so that opening it sends
nothing to a server, but a page has to keep it that way. How long a link can be before a browser or a
chat program breaks it isn't part of this, and is the program's to say.

`tools/build_share_dict.py` records how the dictionary was curated, from the grammar and from real flags.
