# Questions SPEC.md and SDK.md left open, from writing the Java library

The Java library was written from the frozen SPEC.md and SDK.md. Where they didn't settle something,
the answer came from the Go reference (and the TypeScript library where it says so), and the Java
library does the same unless an entry says otherwise. Each entry gives the section, what was unclear,
and what Go does.

## Reading documents

### SPEC §4, a property given twice
- **Settled:** SDK §2 now says a property given twice is a problem on its node, or a syntax error,
  since a KDL parser can refuse it itself. Go and TypeScript stop there, Go with the second
  property's line and TypeScript with the node's; Java puts it on the node and goes on. All refuse
  the document, and the suite records no line for it.

### SPEC §15, a number too small to hold
- **Settled:** a number that's not zero as written, such as `1e-400`, is refused even though a
  float64 reads it as 0. All three libraries do this, and the conformance suite tests it, both as a
  value and inside a string.

### SPEC §15 / §8.1, small numbers in path data
- **Settled:** §8.1 and §15 now say a path's `d` has only the upper limit, so `M0 0L1e-20 1` is
  valid, as all three libraries have it. The conformance suite accepts one.

### SPEC §4.1, dates
- **Settled:** §4.1 now says a date is a Gregorian day, carried back before the calendar began, with
  four digits for the year from `0000` and two each for the month and day, and the day one its
  month has. The suite accepts `0000-02-29` and `2024-02-29`, and refuses `1900-02-29` and `2023-4`.

### SPEC §4.1, `until` before `date`
- **Settled:** §4.1 now says they're compared only as far as the shorter goes, as all three
  libraries do. The suite already has both directions.

### SDK §2, where a `render-license` problem goes
- **Settled:** SDK §2 now says it's on `meta`, as all three libraries and the fixtures have it.

### SDK §4, a defined shape whose worked-out values a charge changes
- **Settled:** SDK §4.1 now says what's worked out is worked out again from the charge's values,
  while a value the definition gives stays, as all three libraries do. `go/testdata/defined-shapes.kdl`
  pins the first half.

### SDK §4, several `at`s and `at center`
- **Settled:** SDK §4.1 now says that among others `at center` is `center` in its place in the list,
  and only a single one is left out, as all three libraries do and `every-field` pins.

### SPEC §13, when folds are checked
- **Settled:** §13 now says steps are checked once the document has no other problems, as all three
  libraries do. Such a document is invalid either way, so the suite can't see it.

### SPEC §4 and SDK §2, a type annotation's problem
- **Settled, apart from one point:** SDK §2 now says a type annotation is on the node holding it,
  and an annotated node's is on that node, as all three libraries do and the suite's "annotation on"
  cases check.
- **Open:** where an annotated node starts. Go takes its name, as kdl-go places a node; TypeScript
  and Java take its annotation. `(x)field a` differs only in its column, but with a line continuation
  between them, `(x) \` then `field a`, Go reports and locates the node a line later. Only a document
  that's invalid anyway is affected, but `locate` is meant for those too.

### SPEC §4, bare `-inf` and the KDL keywords
- **Settled:** nothing to add, since KDL v2 already refuses bare `true`, `false`, `null`, `inf`,
  `-inf` and `nan`. All three libraries refuse each on the same line, Go refusing `-inf` itself
  since kdl-go reads it as a string, and the suite has three cases of it.

### SDK §7.3, where a part ends
- **Settled:** SDK §7.3 now says a part ends just past its last character, not counting a `;`, a
  line ending or a comment after it, as all three libraries do.

### SDK §7.3, a name that isn't a string
- **Settled:** SDK §7.3 now says a definition, variant or fold whose name isn't a string has no
  path, so neither it nor anything in it is listed, as all three libraries do. The suite locates
  the parts of a document with one of each.

## Rendering

These were settled from go/svg.go, go/shapes.go, go/geometry.go, go/adapt.go and go/fold.go.

1. **SDK §5, SPEC §14 (IDs from a hash).** Which hash, of what, and how two *forms* of one document get different IDs.
   Go: `vx-` + hex of the first 8 bytes of SHA-256 of the source after line endings are normalized, then `-`. When any
   option other than `height` and `tags` is given (and no `idPrefix`), it appends hex of the first 2 bytes of SHA-256 of
   `ratio|variant|side|fit|align|fold|foldStep` (ratio formatted with Go's `%v`) and `-`. Each ID is then that prefix,
   a kind (`flag`, `clip`, `mask`, `gradient`, `panel`, `svg`, `front`, `back`, `facet`) and a counter. Java follows it,
   but formats the ratio with its own shortest decimal, so its IDs aren't byte-identical to Go's for fractional ratios
   (nothing requires them to be).
2. **SPEC §11 (asking for the flag's own proportion).** Whether a `ratio` equal to the flag's own needs `adapt`. Go treats
   a ratio within a relative 1e-9 of the flag's own as no change, so it renders even without `adapt`.
3. **SPEC §11 `range`.** Whether the limits are inclusive. Go: inclusive (refuses only below `min` or above `max`).
4. **SPEC §9 `define NAME hoist= fly=` ("scaled to fill wherever it's used").** Whether the scale keeps the design's
   aspect. Go stretches it non-uniformly: `scale(region.w / fly, region.h / hoist)`.
5. **SPEC §7.10 pile fimbriation.** The pile's shape is "the part inside the region", but a fimbriation stroked on that
   polygon would run along the region's edge. Go extends the pile's sides back past its edge by the region's diagonal
   (and the pall's arms and stem past the region by the diagonal plus its width) and lets the region's clip cut them, so
   no edging shows along the flag's edge. The gradient box stays the part inside the region.
6. **SPEC §7.11 wavy edge sampling, §8.1 curve tolerance.** How finely a wave or a cardioid is approximated. Go samples
   24 points per wavy period, and 180 segments for a cardioid; zigzags are exact.
7. **SPEC §7.11 / §15 waves at render time.** An edge's waves are counted on the flag's own grid when it's read, but a
   variant's or another proportion's region can make more. Go refuses the render with "a shaped edge can't have more
   than 10000 waves" when a single edge would exceed it at render time.
8. **SPEC §11 side panels running along the axis.** What size the panel's own layers see across the axis while adapting.
   Go uses the panel's `width` (not `width + depth/2` for a panel with an `edge`).
9. **SPEC §11, scale under `scale` of a side panel's or placed panel's layers.** Go adapts the layers inside against the
   panel's own size along the axis (`width`, `fly` or `hoist`), with that size scaled by the same factor.
10. **SPEC §9 emblem frame and §6 cuts.** A cut's mask needs a rectangle, but an emblem's frame has no size. Go gives the
    frame a "local" reach equal to the distance from the emblem's origin to the region's farthest corner, and masks
    `-reach..reach` in both directions.
11. **SPEC §8.1 ring arc under rotation.** Go adds a charge's `rotate` (and a repeat's turn) to `from` and to `to`, so the
    arc turns with the charge.
12. **SPEC §13 (tagged folds, SDK §7.2).** Which element carries the tag in a fold. Go marks the artwork inside `defs`
    (drawn through `use`) and leaves the `use` and the crease lines unmarked. The reverse's artwork in a fold is tagged
    under `reverse/`.
13. **SPEC §13 fold at another proportion with its own reverse.** Go adapts the reverse's layers too, as seen from behind,
    so the back of each facet is at the same proportion.
14. **SPEC §12 upright on a mirrored reverse.** With no own reverse, which turn the charges undo. Go undoes the front's
    turn (the back is the mirror image of the front, then turned), not the reverse turn.
15. **SDK §3 option checks order.** Go checks values (height, ratio, idPrefix), then fit/align, then fold rules, then
    the variant and fold names, then the unknown `fit`, `align` and `side` values. An unknown `fit` with no ratio is
    refused for having no ratio first. Only that something is refused is normative.
16. **SPEC §11.1 padding with a turned variant.** The canvas ratio is the design's, so for `rotate`, `counter-rotate`,
    `transpose` and `anti-transpose` Go pads to `1 / ratio` in the turned image.
17. **SPEC §7.3 bars "MAY extend under the ones after".** Go extends each bar to the far side of the region unless a
    gap (`none`) or a gradient needs its true width; rotated bars' outermost bars reach well past the region. Quarters
    and checks do the same, and rays paint the first color under the whole region when there's no gap.
18. **SVG numbers (SDK §5).** Go rounds coordinates to 6 decimal places and writes scales (`scale(...)` of paths, uses
    with their own grid, path outlines) to 10 significant digits. Java does the same with BigDecimal, since
    `Double.toString` on Java 17 isn't always the shortest representation.

## Inline SVG and share links

These were settled by reading go/xml.go, go/sanitize.go, go/share.go and go/cmd/vexyl. The Java
sanitizer agrees with Go's on 40,424 pieces of markup: every table in go/conformance_test.go, every
`markup` in conformance/, flags/ and go/testdata/, and mutations of them.

### SPEC §8.3, nesting depth
- **Settled:** §8.3 now says the root is level 1, and a removed element and what's in it aren't
  counted, as all three libraries have it. The suite refuses 64 `<g>`s inside the root, and keeps 63
  around a `title` holding another.

### SPEC §8.3, the XML declaration
- **Settled:** §8.3 now says a declaration is `version`, then optionally `encoding` (its name in any
  case) and `standalone` (`yes` or `no`), in that order; a target that's `xml` in any case is a
  declaration; and no target has a colon. The suite refuses `standalone="maybe"`, `standalone` before
  `encoding`, and `<?XML ...?>` first.

### SPEC §8.3, an empty `viewBox`
- **Settled:** §8.3 now says an empty `viewBox` is the same as none, so `width` and `height` are
  read. The suite keeps one.

### SPEC §8.3, `href`
- **Settled:** §8.3 now says an `href` is `#` and an `id` by its grammar, so `#1` is refused, as the
  suite now checks.

### SPEC §8.3, which functions count
- **Settled:** §8.3 now says that once each `url(#id)` is taken out, any `(` that doesn't end `rgb`,
  `rgba`, `hsl` or `hsla`, with no letter, digit or `_` before it, is a function that's refused. The
  suite refuses `_rgb(1)`, an unclosed `url(#a` and a lone `(`, and keeps `-rgb(1,2,3)`.

### SPEC §8.3, prefixes inside removed content
- **Settled:** §8.3 now says all of the markup has to be well-formed, removed content included, and
  that what's removed isn't checked against the allowlist. The suite refuses a repeated attribute in
  a `title`.

### SPEC §8.3, `xmlns=""`
- **Settled:** §8.3 now says `xmlns=""` is allowed and leaves what it covers in no namespace. The
  suite keeps a prefixed SVG root that has one.

### SDK §4.2, a `style` declaration with an empty value
- **Settled:** SDK §4.2 now says only declarations of whitespace are dropped, and `fill: ;` is
  written `fill:`, which the suite checks.

### SDK §4.2, currentColor in a `style`
- **Settled:** §8.3 now says a `style` is split at each `;` and each declaration at its first `:`,
  and the keyword counts only as a whole word of ASCII letters, digits, `_` and `-` once each
  `url(#id)` is taken out. The suite accepts `currentColor-x`, `xcurrentColor` and `currentColor1`
  with no palette color.

### SDK §8, stray bits after the stream's end
- **Settled:** SDK §8 now says the bits that fill the last byte are ignored, whatever they are. The
  suite reads a link with them set.

### SDK §8, versions
- **Settled:** SDK §8 now says a link starts with `v`, its version's digits and a `.`, so `v01.` is
  another version and `v.` has none. The suite already refuses both.

### SDK §8 / conformance README, the command reading a link from a file
- **Settled:** the conformance README now says `share decode FILE` drops only line feeds at the
  file's end. The suite reads a link followed by an LF and refuses one followed by a CRLF.

### SDK §8, which compression level
- **Settled:** SDK §8 now says how hard an encoder compresses is its own, as long as its links are
  within 15% of zlib's with the dictionary, which the suite already checks.
