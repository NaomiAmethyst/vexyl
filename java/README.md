# Vexyl for Java

This is a library for reading [Vexyl](../README.md) flags and rendering them to SVG. It was written
from [SPEC.md](../SPEC.md) and [SDK.md](../SDK.md), and passes the same
[conformance suite](../conformance/README.md) as the Go reference and the TypeScript library. It
needs Java 17 or later, and nothing else: its KDL parser, XML reader, SVG writer and share links'
compression are all its own or the JDK's. It never reads the network or the filesystem.

It's on Maven Central as `name.amethyst:vexyl`, from version 1.3.0:

```xml
<dependency>
  <groupId>name.amethyst</groupId>
  <artifactId>vexyl</artifactId>
  <version>1.3.0</version>
</dependency>
```

Or with Gradle, `implementation("name.amethyst:vexyl:1.3.0")`.

```java
import name.amethyst.vexyl.*;

List<Problem> problems = Vexyl.validate(source);   // empty if the document is valid
Flag flag = Vexyl.parse(source);                    // throws a ProblemsException holding every problem

String image = flag.svg(RenderOptions.builder().height(1200).build());
String back = flag.svg(RenderOptions.builder().side("reverse").build());
Element tree = flag.svgTree(RenderOptions.defaults());   // the same document as a tree of elements
String own = flag.svg(RenderOptions.builder().idPrefix("mine-").build());  // for documents you don't trust
Map<String, Object> data = flag.model();                // plain data, in the suite's canonical form

List<Span> spans = Vexyl.locate(source);           // where each layer and part is
Optional<Span> here = Vexyl.layerAt(spans, 12);    // what's innermost at line 12
String link = Vexyl.shareEncode(source);           // the part of a share link after its #
String again = Vexyl.shareDecode(link);
```

A `Problem` has a `line` and `column`, which are 0 when it has no one place, a `node`, and a
`message`. A flag never changes, rendering included, so one flag can render with many options, from
many threads. A flag that can't be drawn as asked, or an option it can't use, throws a
`VexylException`. The model is maps, lists, strings, doubles and booleans, none of which can be
changed, and `Flag.modelJson()` writes it as the suite compares it.

## Command

The jar is also the `vexyl` command, with the same subcommands and options as the Go command, apart
from `info`:

```sh
java -jar java/target/vexyl.jar render -o sweden.svg flags/sweden.kdl
java -jar java/target/vexyl.jar render -ratio 1:1 -fit pad -align left flags/sweden.kdl
java -jar java/target/vexyl.jar check -json flags/sweden.kdl
java -jar java/target/vexyl.jar model flags/sweden.kdl
java -jar java/target/vexyl.jar locate -line 12 flags/sweden.kdl
java -jar java/target/vexyl.jar share encode flags/sweden.kdl
```

The JVM writes its own warnings to standard output, ahead of the command's. A script that reads
the output, such as `check -json`'s, should send them to standard error with
`java -Xlog:disable -Xlog:all=warning:stderr -jar …`. Many JVMs starting at once can warn about a
locked file in `/tmp/hsperfdata_*`, as the conformance suite's do.

## Development

It's built with Maven, on any JDK from 17, with `--release 17`. From the repository's root,
`make check-java` builds it and runs its tests, and `make conformance-java` runs the conformance
suite against its command. The tests read the suite's fixtures, so they run from `java/`, inside a
checkout of the repository.

KDL v2 is read by `Kdl.java`, written to the KDL 2.0.0 grammar, and inline SVG by a strict XML
reader in `Xml.java`, with no DOM, so that it behaves the same on every JVM. It and `Sanitizer.java`
are a security boundary.

## License

Apache License 2.0, as the rest of this project's code is. See [`LICENSE`](../LICENSE).
