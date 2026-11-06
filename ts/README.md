# Vexyl for TypeScript

This is a library for reading [Vexyl](../README.md) flags and rendering them to SVG. It's a direct
port of the Go reference implementation, and it runs in browsers as well as Node, because it never
reads the network or the filesystem. Only its command uses Node's modules.

```ts
import { model, parse, svg, svgTree, validate } from "vexyl";

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

## Command

```sh
vexyl render -o sweden.svg flags/sweden.kdl
vexyl render -ratio 1:1 -fit pad -align left flags/sweden.kdl
vexyl check -json flags/sweden.kdl
vexyl model flags/sweden.kdl
vexyl tree flags/sweden.kdl
```

It takes the same options as the Go command, apart from `info`, which it doesn't have.

## Development

From the repository's root, `make check-ts` builds this and runs its tests, and `make conformance-ts`
runs the [conformance suite](../conformance/README.md) against it.

Inline SVG is read by a strict XML tokenizer in `src/xml.ts`, with no DOM, so that it behaves the same
everywhere. It and `src/sanitize.ts` are a security boundary, and their tests are in
`test/sanitize.test.ts`.

## License

Apache License 2.0, as the rest of this project's code is. See [`LICENSE`](../LICENSE).
