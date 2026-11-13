# Questions SPEC.md and SDK.md left open, from writing the Java library

The Java library was written from the frozen SPEC.md and SDK.md. Where they didn't settle something,
the answer came from the Go reference (and the TypeScript library where it says so), and the Java
library does the same unless an entry says otherwise. Each entry was then checked against Go,
TypeScript and Java. Where they agree, the text now says what they do, and the entry is **Settled**
with where. The three marked **Open** are left for a decision, as
[`format-2.md`](format-2.md) lists them.

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

These were first settled from go/svg.go, go/shapes.go, go/geometry.go, go/adapt.go and go/fold.go.
Each was then checked against all three libraries, and all three agree on every one.

1. **SDK §5, SPEC §14 (IDs from a hash).** **Settled:** SDK §5 now says IDs come from a hash of the
   document and of the options that make another form, and that which hash, and how, is the
   library's own. Go and Java use `vx-` and SHA-256 of the source (and of the form's options); TypeScript
   uses a hash of its own. None of it is normative, only that IDs don't collide.
2. **SPEC §11 (asking for the flag's own proportion).** **Settled:** §11 now says a proportion
   within a relative 1e-9 of the flag's own is the flag's own, so it needs no `adapt`.
3. **SPEC §11 `range`.** **Settled:** §11 now says both ends are included. `every-field` and `variants`
   have `range 1 3` and render at exactly 1.
4. **SPEC §9 `define NAME hoist= fly=`.** **Settled:** §9 now says the grid is scaled along each axis
   on its own, so a region of another shape stretches it.
5. **SPEC §7.10 pile fimbriation.** **Settled:** §7.10 now says the pile's sides and the pall's arms
   and stem carry on past the region, which cuts them off, so the region's side isn't edged. How far
   they carry on (the region's diagonal, plus the width for a pall) is the library's own.
6. **SPEC §7.11 wavy edge sampling, §8.1 curve tolerance.** **Open.** All three libraries draw a wave
   as 24 straight pieces a period, and a cardioid as 180, with zigzags exact. But 24 pieces miss a
   sine by about 0.0043 of its depth, which is past §8.1's "error under 0.1% of the flag's hoist"
   once a wave is deeper than about 23% of the hoist, and the 180 pieces of a cardioid are enough
   only up to a radius of about the hoist. It isn't said whether §8.1's allowance covers waves at
   all, or whether they have to be exact. Settling it means choosing between those, and probably
   finer pieces in all three libraries, which only changes renders within the suite's tolerance.
7. **SPEC §7.11 / §15 waves at render time.** **Settled:** §15 now says an edge's waves are counted
   again when it's drawn, along the line it actually runs, and a render that would draw more than
   10000 in one edge is refused. That's how a valid document such as `proportion hoist=1 fly=1` with
   `bars a b { along bend; edge wavy depth=0.0001 period=0.0001; }` is refused even in its own form,
   in all three, since the read-time count uses the longer side and the bend runs along the
   diagonal. Counting the line it runs when it's read would make such documents invalid, which is a
   question for a later format.
8. **SPEC §11 side panels running along the axis.** **Open.** All three libraries adapt a panel's
   layers as if the panel were `width` across the axis, even when its `edge` makes it
   `width + depth/2` (§7.11). So a charge anchored `start` in a `side hoist; width 1; edge zigzag
   depth=0.4` panel is at fly 0.6 in its own form and jumps to 0.5 at `-ratio 2:3.003`, which isn't
   "pinned to where the center was". Writing `width` into the text would make the jump normative;
   using the drawn size is a line in each library's adapter, but it changes renders.
9. **SPEC §11, scale under `scale` of a side panel's or placed panel's layers.** **Settled:** §11's
   table now says a panel's size along the axis scales with the flag's, and its layers adapt from
   its old size to its new one.
10. **SPEC §9 emblem frame and §6 cuts.** **Settled:** nothing to add. Painting is clipped to the
    region, so how large a mask is past it can't be seen, and SDK §5 compares renders as pixels. All
    three use the distance from the emblem's origin to the region's farthest corner.
11. **SPEC §8.1 ring arc under rotation.** **Settled:** §8.1 now says `from` and `to` are on the
    shape, so they turn with the charge's `rotate` and with a repeat's turn.
12. **SPEC §13 (tagged folds, SDK §7.2).** **Settled:** SDK §7.2 now says the artwork in `defs` is
    marked and the `use`s placing it aren't, as the suite already checks. The reverse's artwork in
    a fold is under `reverse/`, as §7.1 already gives.
13. **SPEC §13 fold at another proportion with its own reverse.** **Settled:** §13 now says that
    reverse's layers adapt too, as seen from behind, and the fold is refused if they can't.
14. **SPEC §12 upright on a mirrored reverse.** **Settled:** §12 now says that without a `reverse`
    of its own, an upright charge on the back is the charge with the obverse's turn undone, then
    mirrored with the flag.
15. **SDK §3 option checks order.** **Settled:** SDK §3 now says which of several wrong options is
    reported is the library's own. Every case in `options.json` is refused by all three.
16. **SPEC §11.1 padding with a turned variant.** **Settled:** §11.1 now says a variant that swaps
    width and height is padded after it turns, to `1 / ratio`, which follows from SDK §3's `ratio`
    being measured before the turn. The suite's `variant-*-pad-1-4` renders pin it.
17. **SPEC §7.3 bars "MAY extend under the ones after".** **Settled:** §7.3 now gives `quarters`,
    `checks` and `rays` the same leave, as long as the visible result is the same.
18. **SVG numbers (SDK §5).** **Settled:** nothing to add. SDK §5 already makes number formatting
    the library's own, with a SHOULD of 6 decimal places and significant digits for scales. Go
    writes 6 places and scales to 10 significant digits; Java does the same with BigDecimal.

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
