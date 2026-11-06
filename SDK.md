# Vexyl SDK specification

**Status:** draft 1. Nothing here is stable until the format is frozen.

Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>. This
specification is licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

This describes what every Vexyl library offers, whatever its language, so that a program can
move between them. [SPEC.md](SPEC.md) defines the format and how it's drawn. The key words
MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

Go is the reference implementation. Where this and it disagree, that's a bug in one of them,
and the [conformance suite](conformance) is what a library has to pass.

## 1. Operations

Names follow each language's conventions: `svgTree`, `SVGTree`, `svg_tree`.

| Operation | Takes | Gives |
|---|---|---|
| `validate` | A document as a string | Its problems, empty if it's valid |
| `parse` | A document as a string | A flag, or its problems |
| `model` | A flag | The flag as plain data, in the canonical form of section 4 |
| `svg` | A flag and options | An SVG document as a string, or an error |
| `svgTree` | A flag and options | The same document as a tree of elements, or an error |

A library MUST NOT read the network or the filesystem to do any of these, because a document
is self-contained. It MUST enforce the limits in section 15 of the format when reading a document. It MAY offer conveniences that read files, separately.

A flag is a native structure: a library SHOULD use its language's own types. It MUST NOT change
when rendered, so one flag can render with many options.

## 2. Problems

`validate` and `parse` report every problem they can find in a document, not just the first.

| Field | Meaning |
|---|---|
| `line`, `column` | Where it is, from 1, or absent if it has no one place |
| `node` | The KDL node it's about, or absent |
| `message` | What's wrong, for a person to read |

Wording and order are the library's own, so programs MUST NOT depend on them. A valid document
MUST have no problems. An invalid one MUST have at least one, and for a problem that isn't a
syntax error, one on the line that the suite records.

## 3. Options

Every option is optional, and rendering with none gives the flag as it is.

| Option | Values | Default | Meaning |
|---|---|---|---|
| `height` | A positive number | 600 | The image's height in pixels. Its width follows the proportion |
| `ratio` | A positive number | The flag's own | The proportion wanted, as fly divided by hoist |
| `fit` | `error`, `pad` | `error` | What to do if the flag can't reach `ratio` |
| `align` | `start`, `center`, `end` | `center` | Where a padded flag sits |
| `variant` | A variant's name | None | Which form of the flag |
| `side` | `obverse`, `reverse` | `obverse` | Which side of the flag |
| `fold` | A fold's name | None | Show the flag folded |
| `foldStep` | A whole number | All of them | Stop a fold after that many steps |

Section 11.1 of the format says what `ratio`, `fit` and `align` do. A flag that can't reach a
proportion MUST be refused unless `fit` is `pad`, so that nothing distorts or silently changes
shape.

These MUST be errors, so that no option is ever silently ignored:

- Asking for a variant or a fold that the flag doesn't have, or an unknown value.
- A `height` or `ratio` that isn't a positive number within the format's limits, including 0.
- `fit` with neither a `ratio` nor a variant that has one, and `align` unless `fit` is `pad`.
- `foldStep` without `fold`, or that isn't from 1 to the fold's number of steps.
- A `fold` on a turned variant, with `side` of `reverse`, or with `fit` of `pad`. A fold shows
  both sides and is cropped to its pieces, so neither has a meaning. A `fold` with a `ratio` folds
  the flag at that proportion.

## 4. The model

`model` gives a flag as plain maps, lists, strings, numbers and booleans. It's the same in every
language, so the suite can compare what a library understood, apart from how it draws. Its numbers
compare allowing a difference of one part in a million. [`conformance/model.schema.json`](conformance/model.schema.json)
is the same thing as a schema, and every library's models have to fit it.

Three rules say what's there:

- **A name is the format's own term.** A node's name is its key, so the top level has the nodes of
  section 4 of the format: `vexyl`, `meta`, `palette`, `proportion`, `outline`, `border`, `define`,
  `layers`, `reverse`, `adapt`, `variant` and `fold`. A repeatable node gives a list under its own
  name, such as `note`, `cut`, `at` or `point`, and a named one gives a map under its own name, such
  as `define`, `variant` and `fold`.
- **A value is left out only if it equals the format's default.** The fixed defaults are below. A
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
| A `palette` color | `color`, `pantone`, `ncs`, `ral`, `munsell`, `thread`; a list of `dye`; `cmyk` as four numbers; a list of `reference`, each with `system` and `value` |
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

Inline SVG is as it is after being sanitized, and the source's other content isn't kept anywhere.
It's written as `<svg xmlns="..." viewBox="X Y W H" ...>`, then its elements with nothing between
them and never self-closed, with attributes in source order, IDs and references as written, and
`& < > " ' tab LF CR` in values as `&amp; &lt; &gt; &#34; &#39; &#x9; &#xA; &#xD;`.

## 5. SVG output

A library MUST give an SVG that draws the same image as the reference, within the suite's
tolerance. It needn't give the same text, so the order of elements, IDs and number formatting
are its own. It SHOULD write coordinates to at least 6 decimal places, because the tolerance is
calibrated for rounding to 4.

`svgTree` gives elements with a name, attributes in order and children. Vexyl's SVG has no text
content, because SVG lettering isn't allowed. Writing the tree out MUST give a document that
draws the same as `svg`.

IDs in a document MUST NOT collide with those of a different document, so that several flags can
be inlined in one page.

Inline SVG MUST be sanitized as section 8.3 of the format says, in every library. It's the one
place where a document can carry another format's markup, and a gap here is a security problem.

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

Every render is also checked for what mustn't be in it, such as an element or attribute off the
allowlist or a reference leaving the document, since pixels can't show those.

Each library offers a small command for the suite to run, as the `vexyl` command does.
