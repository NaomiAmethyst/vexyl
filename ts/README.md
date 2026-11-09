# Vexyl for TypeScript

This is a library for reading [Vexyl](../README.md) flags and rendering them to SVG. It's a direct
port of the Go reference implementation, and it runs in browsers as well as Node, because it never
reads the network or the filesystem. Only its command uses Node's modules.

```ts
import { model, parse, svg, svgTree, validate } from "@naomiamethyst/vexyl";

const problems = validate(source);          // empty if the document is valid
const flag = parse(source);                 // throws a ParseError holding every problem

const image = svg(flag, { height: 1200 });  // an SVG document as a string
const back = svg(flag, { side: "reverse" });
const tree = svgTree(flag);                 // the same document as a tree of elements
const own = svg(flag, { idPrefix: "mine-" });  // for a page showing documents it doesn't trust
const data = model(flag);                   // plain data, in the suite's canonical form
```

`flag` is typed, and its layers say what they are in a `layer` field. Rendering never changes it, so
one flag can render with many options. A flag that can't be drawn as asked throws a `RenderError`.

Beyond the SDK, `constructionSvg` draws a flag's construction sheet, with its sizes worked out
exactly from the numbers the file writes, and lists whatever it doesn't measure:

```ts
import { constructionSvg } from "@naomiamethyst/vexyl";

const sheet = constructionSvg(flag, { units: "hoist", theme: "paper", paper: "a4" });
const forMaking = constructionSvg(flag, { units: "mm", hoistMm: 1500, path: "flags/country/chile.kdl" });
```

`form` draws another form of the flag, named as `svg` names them: `{ side: "reverse" }` for its back,
or `{ variant: "vertical" }` for a variant, turned as the variant turns it, with every mark turned too:

```ts
const hanging = constructionSvg(flag, { form: { variant: "vertical", side: "reverse" } });
```

A sheet's text is set in Geist and Geist Mono. A browser drawing an SVG as an image loads no fonts for it,
so for a PNG pass the faces in `sheetFaces` as WOFF2 files, and the sheet carries the ones it uses as
`data:` URLs. The library holds no fonts itself:

```ts
const forPng = constructionSvg(flag, { fonts: [{ family: "Geist", weight: 400, woff2: bytes }, /* … */] });
```

## Command

```sh
vexyl render -o sweden.svg flags/sweden.kdl
vexyl render -ratio 1:1 -fit pad -align left flags/sweden.kdl
vexyl check -json flags/sweden.kdl
vexyl model flags/sweden.kdl
vexyl tree flags/sweden.kdl
vexyl construct -o sweden-sheet.svg flags/sweden.kdl
```

It takes the same options as the Go command, apart from `info`, which it doesn't have, and it has
`construct`, which the Go command doesn't. That draws a flag's construction sheet, as `constructionSvg` does, to standard output or to
the file `-o` names. Its options are the library's: `-units` is `grid`, `hoist` or `mm`, with
`-hoist-mm` for the hoist's size in millimetres; `-theme` is `paper` or `dark`; `-paper` is `a4`,
`letter` or `fit`; `-variant` and `-side` choose the form; `-no-sizes`, `-no-positions`,
`-no-colors` and `-grid` say what to show; and `-path` and `-tier` go in the footer:

```sh
vexyl construct -units mm -hoist-mm 1500 -path flags/country/sweden.kdl -tier A flags/sweden.kdl
vexyl construct -theme dark -paper fit -variant vertical -side reverse flags/united-states.kdl
```

## Development

From the repository's root, `make check-ts` builds this and runs its tests, and `make conformance-ts`
runs the [conformance suite](../conformance/README.md) against it.

Inline SVG is read by a strict XML tokenizer in `src/xml.ts`, with no DOM, so that it behaves the same
everywhere. It and `src/sanitize.ts` are a security boundary, and their tests are in
`test/sanitize.test.ts`.

## License

Apache License 2.0, as the rest of this project's code is. See [`LICENSE`](../LICENSE).
