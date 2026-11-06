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
shape. Asking for a variant or a fold that the flag doesn't have, or an unknown value, MUST be an
error. So MUST a fold on a turned variant.

## 4. The model

`model` gives a flag as plain maps, lists, strings, numbers and booleans. It's the same in every
language, so the suite can compare what a library understood, apart from how it draws:

- Names are the format's own terms in kebab-case, like `border-outside`.
- A flag's `layers`, and any other layers, say what they are in a `layer` field, such as `bars`.
- Anything empty, zero or false is left out.
- Defaults have been applied, as they are for drawing: a star's `inner` has been worked out, and
  `count` has expanded a bar's colors.
- Inline SVG is as it is after being sanitized, and the source's other content isn't kept anywhere.
  It's written as `<svg xmlns="..." viewBox="X Y W H" ...>`, then its elements with nothing between
  them and never self-closed, with attributes in source order, IDs and references as written, and
  `& < > " ' tab LF CR` in values as `&amp; &lt; &gt; &#34; &#39; &#x9; &#xA; &#xD;`.
- A `use` gives the name of what it uses, and that's found under the flag's definitions.

The suite's `.model.json` files show every field. They compare with numbers allowed to differ by
one part in a million.

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
at the suite's version for the format's version. It has three parts:

| Part | Checks |
|---|---|
| Renders | Each flag, in each form, compared with the expected SVG as pixels |
| Models | Each flag's model, compared with the expected JSON |
| Invalid documents | Each is refused, with a problem on the expected line |
| Accepted documents | Each is valid, including those exactly at a limit |
| Sanitizer output | Each piece of artwork comes out as expected, in the model and in a render |

Every render is also checked for what mustn't be in it, such as an element or attribute off the
allowlist or a reference leaving the document, since pixels can't show those.

Each library offers a small command for the suite to run, as the `vexyl` command does.
