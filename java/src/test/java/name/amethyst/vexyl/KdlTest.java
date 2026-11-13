// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

/** The KDL v2 parser, on what the format's documents need and what other parsers got wrong. */
class KdlTest {
	private static List<Kdl.Node> parse(String text) throws Kdl.SyntaxError {
		return Kdl.parse(Parser.normalizeNewlines(text));
	}

	private static void refused(String text) {
		assertThrows(Kdl.SyntaxError.class, () -> parse(text), text);
	}

	@Test
	void readsNodesArgumentsPropertiesAndChildren() throws Exception {
		List<Kdl.Node> nodes = parse("a 1 \"two\" k=#true { b; c 3.5 }\nd");
		assertEquals(2, nodes.size());
		Kdl.Node a = nodes.get(0);
		assertEquals("a", a.name);
		assertEquals(1, a.args.get(0).number);
		assertEquals("two", a.args.get(1).string);
		assertTrue(a.prop("k").bool);
		assertEquals(2, a.children.size());
		assertEquals(3.5, a.children.get(1).args.get(0).number);
	}

	@Test
	void endsAHexadecimalNumberAtASemicolon() throws Exception {
		// One KDL parser counted `;` as a hexadecimal digit, which read `rotate 5` as part of `at`.
		List<Kdl.Node> nodes = parse("x { at hoist=0x0A; rotate 5; }");
		Kdl.Node x = nodes.get(0);
		assertEquals(2, x.children.size());
		assertEquals(10, x.children.get(0).prop("hoist").number);
		assertEquals("rotate", x.children.get(1).name);
	}

	@Test
	void readsEveryRadixAndUnderscores() throws Exception {
		Kdl.Node n = parse("n 0x1f 0o17 0b101 1_000 -2.5e2 +3").get(0);
		assertEquals(31, n.args.get(0).number);
		assertEquals(15, n.args.get(1).number);
		assertEquals(5, n.args.get(2).number);
		assertEquals(1000, n.args.get(3).number);
		assertEquals(-250, n.args.get(4).number);
		assertEquals(3, n.args.get(5).number);
	}

	@Test
	void readsMultiLineStringsWithAnyLineEndings() throws Exception {
		// Another KDL parser kept the CR of a CRLF inside a multi-line string.
		String lf = parse("s \"\"\"\n    one\n      two\n    \"\"\"").get(0).args.get(0).string;
		String crlf = parse("s \"\"\"\r\n    one\r\n      two\r\n    \"\"\"").get(0).args.get(0).string;
		String cr = parse("s \"\"\"\r    one\r      two\r    \"\"\"").get(0).args.get(0).string;
		assertEquals("one\n  two", lf);
		assertEquals(lf, crlf);
		assertEquals(lf, cr);
	}

	@Test
	void removesIndentationBeforeResolvingEscapes() throws Exception {
		String s = parse("s \"\"\"\n  a\\n  b\n  c \\\n    d\n  \"\"\"").get(0).args.get(0).string;
		assertEquals("a\n  b\nc d", s);
	}

	@Test
	void readsRawStrings() throws Exception {
		Kdl.Node n = parse("r #\"a\\n\"b\"# ##\"x\"#y\"##").get(0);
		assertEquals("a\\n\"b", n.args.get(0).string);
		assertEquals("x\"#y", n.args.get(1).string);
		String multi = parse("r #\"\"\"\n  <svg a=\"1\"/>\n  \"\"\"#").get(0).args.get(0).string;
		assertEquals("<svg a=\"1\"/>", multi);
	}

	@Test
	void resolvesEscapes() throws Exception {
		Kdl.Node n = parse("e \"\\t\\\\\\\"\\u{1F600}\\s\"").get(0);
		assertEquals("\t\\\"\uD83D\uDE00 ", n.args.get(0).string);
		refused("e \"\\u{D800}\"");
		refused("e \"\\q\"");
	}

	@Test
	void dropsWhatSlashdashComments() throws Exception {
		List<Kdl.Node> nodes = parse("/-a 1\nb /-2 3 /-k=4 /-{ c }\n/* x /* nested */ */ d // e");
		assertEquals(2, nodes.size());
		assertEquals("b", nodes.get(0).name);
		assertEquals(1, nodes.get(0).args.size());
		assertEquals(3, nodes.get(0).args.get(0).number);
		assertTrue(nodes.get(0).props.isEmpty());
		assertTrue(nodes.get(0).children.isEmpty());
		assertEquals("d", nodes.get(1).name);
	}

	@Test
	void continuesALineAfterABackslash() throws Exception {
		Kdl.Node n = parse("n 1 \\ // more\n  2").get(0);
		assertEquals(2, n.args.size());
	}

	@Test
	void marksAnnotationsAndBareStrings() throws Exception {
		Kdl.Node n = parse("(t)n (u)1 k=(v)x bare \"quoted\"").get(0);
		assertTrue(n.annotated);
		assertTrue(n.args.get(0).annotated);
		assertTrue(n.prop("k").annotated);
		assertTrue(n.args.get(1).bare);
		assertFalse(n.args.get(2).bare);
	}

	@Test
	void keepsRepeatedPropertiesToRefuse() throws Exception {
		Kdl.Node n = parse("p a=1 a=2").get(0);
		assertEquals(List.of("a"), n.repeatedProps);
		assertEquals(2, n.prop("a").number);
	}

	@Test
	void refusesWhatIsntKdl() {
		refused("n true");
		refused("n -inf");
		refused("n nan");
		refused("n 1abc");
		refused("n 1.");
		refused("n .5");
		refused("n \"unclosed");
		refused("n { a");
		refused("}");
		refused("n 1\"a\"");
		refused("n {} 1");
		refused("n \"a\nb\"");
		refused("n \u0007");
		refused("n \"\"\"x\n\"\"\"");
		refused("n \"\"\"\n  a\n b\n  \"\"\"");
	}

	@Test
	void readsKeywords() throws Exception {
		Kdl.Node n = parse("n #true #false #null #inf #-inf #nan").get(0);
		assertTrue(n.args.get(0).bool);
		assertEquals(Kdl.Kind.NULL, n.args.get(2).kind);
		assertEquals(Double.POSITIVE_INFINITY, n.args.get(3).number);
		assertEquals(Double.NEGATIVE_INFINITY, n.args.get(4).number);
		assertTrue(Double.isNaN(n.args.get(5).number));
	}

	@Test
	void recordsWhereNodesStartAndEnd() throws Exception {
		String src = "a 1 // c\nb {\n  c\n}\n";
		List<Kdl.Node> nodes = parse(src);
		assertEquals(0, nodes.get(0).start);
		assertEquals(3, nodes.get(0).end);
		assertEquals(src.indexOf('}') + 1, nodes.get(1).end);
	}
}
