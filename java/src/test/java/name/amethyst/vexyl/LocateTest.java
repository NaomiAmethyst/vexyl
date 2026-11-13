// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

/** Layers' paths and where they are, as section 7 of the SDK has them. */
class LocateTest {
	@Test
	void findsLayersAndOtherParts() {
		String doc = VexylTest.HEAD + "panel {\n  side hoist\n  width 2\n  field a\n  group { field b; }\n}\n"
				+ "variant \"a/b%c\" {\n  field a\n}\n";
		Map<String, Span> spans = Vexyl.locate(doc).stream().collect(Collectors.toMap(Span::path, s -> s));
		assertEquals(5, spans.get("0").line());
		assertEquals(10, spans.get("0").endLine());
		assertEquals(8, spans.get("0.0").line());
		assertEquals(9, spans.get("0.1.0").line());
		assertEquals(11, spans.get("variant/a%2Fb%25c").line());
		assertEquals(12, spans.get("variant/a%2Fb%25c/0").line());
		assertEquals(3, spans.get("palette/b").line());
		Optional<Span> at = Vexyl.layerAt(Vexyl.locate(doc), 9);
		assertEquals("0.1.0", at.get().path());
		assertEquals("0.1", Vexyl.parentPath("0.1.0"));
		assertEquals("", Vexyl.parentPath("variant/x.y/0"));
		assertEquals("a/b%c", Vexyl.decodePathName(Vexyl.encodePathName("a/b%c")));
	}

	@Test
	void givesNothingForWhatIsntKdl() {
		assertEquals(List.of(), Vexyl.locate("vexyl 1\nmeta {"));
		assertTrue(Vexyl.layerAt(List.of(), 1).isEmpty());
	}

	@Test
	void endsAPartJustPastItsLastCharacter() {
		Span vexyl = Vexyl.locate("vexyl 1 // a comment\n").get(0);
		assertEquals(1, vexyl.endLine());
		assertEquals(8, vexyl.endColumn());
	}

	@TestFactory
	Stream<DynamicTest> findsEachPartOnItsLines() {
		List<Map<String, Object>> cases = Fixtures.json("locate.json");
		return cases.stream().map(c -> DynamicTest.dynamicTest((String) c.get("file"), () -> {
			Map<String, Span> spans = Vexyl.locate(Fixtures.text((String) c.get("file"))).stream()
					.collect(Collectors.toMap(Span::path, s -> s));
			@SuppressWarnings("unchecked")
			Map<String, List<Double>> expected = (Map<String, List<Double>>) c.get("spans");
			assertTrue(spans.keySet().containsAll(expected.keySet()), spans.keySet().toString());
			expected.forEach((path, lines) -> {
				Span s = spans.get(path);
				assertEquals(lines.get(0).intValue(), s.line(), path);
				assertEquals(lines.get(1).intValue(), s.endLine(), path);
			});
		}));
	}
}
