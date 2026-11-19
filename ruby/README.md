# Vexyl for Ruby

This is a library for reading [Vexyl](../README.md) flags and rendering them to SVG. It was written
from [SPEC.md](../SPEC.md) and [SDK.md](../SDK.md), and passes the same
[conformance suite](../conformance/README.md) as the Go reference and the other libraries. It needs
Ruby 3.1 or later, and nothing else: its KDL parser, XML reader and SVG writer are its own, and share
links are compressed with Ruby's own `zlib`. It never reads the network or the filesystem.

It isn't published as a gem yet. Until it is, build and install it from a checkout:

```sh
cd ruby && gem build vexyl.gemspec && gem install ./vexyl-1.3.0.gem
```

```ruby
require "vexyl"

problems = Vexyl.validate(source)     # empty if the document is valid
flag = Vexyl.parse(source)            # raises a Vexyl::ProblemsError holding every problem

image = flag.svg(height: 1200)
back = flag.svg(side: "reverse")
tree = flag.svg_tree                  # the same document as a tree of Vexyl::Element
own = flag.svg(id_prefix: "mine-")    # for documents you don't trust
data = flag.model                     # plain data, in the suite's canonical form

spans = Vexyl.locate(source)          # where each layer and part is
here = Vexyl.layer_at(spans, 12)      # what's innermost at line 12, or nil
link = Vexyl.share_encode(source)     # the part of a share link after its #
again = Vexyl.share_decode(link)
```

Options are keywords, as above, or a `Vexyl::RenderOptions`, which takes the same ones:
`height`, `ratio` (fly divided by hoist), `variant`, `side`, `fit`, `align`, `fold`, `fold_step`,
`id_prefix` and `tags`. A `Vexyl::Problem` has a `line` and `column`, which are 0 when it has no one
place, a `node`, and a `message`. A flag never changes, rendering included, so one flag can render
with many options, from many threads. A flag that can't be drawn as asked, an option it can't use,
or a share link that's refused raises a `Vexyl::Error`, of which `Vexyl::ProblemsError` is one. The
model is hashes, arrays, strings, numbers and booleans, all frozen, and `Flag#model_json` writes it
as the suite compares it.

## Command

`exe/vexyl` is the `vexyl` command, with the same subcommands and options as the Go command, apart
from `info`:

```sh
ruby/exe/vexyl render -o sweden.svg flags/sweden.kdl
ruby/exe/vexyl render -ratio 1:1 -fit pad -align left flags/sweden.kdl
ruby/exe/vexyl check -json flags/sweden.kdl
ruby/exe/vexyl model flags/sweden.kdl
ruby/exe/vexyl locate -line 12 flags/sweden.kdl
ruby/exe/vexyl share encode flags/sweden.kdl
```

It needs no gems, so a script that runs it many times can save most of Ruby's start-up with
`ruby --disable-gems ruby/exe/vexyl …`, as the conformance suite's run does.

## Development

From the repository's root, `make check-ruby` runs its tests, with minitest, which comes with Ruby,
and `make conformance-ruby` runs the conformance suite against its command. Within `ruby/`,
`rake` runs the tests too. They read the suite's fixtures, so they run inside a checkout of the
repository.

KDL v2 is read by `kdl.rb`, written to the KDL 2.0.0 grammar, and inline SVG by a strict XML reader
in `xml.rb`, with no REXML, so that it behaves the same everywhere. It and `sanitizer.rb` are a
security boundary.

## License

Apache License 2.0, as the rest of this project's code is. See [`LICENSE`](../LICENSE).
