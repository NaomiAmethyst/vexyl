// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

/** Reading and checking documents, and their models. */
class VexylTest {
	static final String HEAD = "vexyl 1\nmeta { name \"T\"; }\npalette { a \"#112233\"; b \"#445566\"; }\nproportion hoist=10 fly=20\n";

	@Test
	void readsAFlag() throws Exception {
		Flag flag = Vexyl.parse(HEAD + "field a\ncharge star b { radius 3; }\n");
		assertEquals("T", flag.name());
		assertEquals(10, flag.hoist());
		assertEquals(20, flag.fly());
		assertEquals(List.of(), Vexyl.validate(HEAD + "field a\n"));
	}

	@Test
	void reportsEveryProblemWithItsLine() {
		List<Problem> problems = Vexyl.validate(HEAD + "field nope\nband a { }\n");
		assertTrue(problems.size() >= 2, problems.toString());
		assertTrue(problems.stream().anyMatch(p -> p.line() == 5 && "field".equals(p.node())), problems.toString());
		assertTrue(problems.stream().anyMatch(p -> p.line() == 6 && "band".equals(p.node())), problems.toString());
		ProblemsException e = assertThrows(ProblemsException.class, () -> Vexyl.parse(HEAD + "field nope\n"));
		assertEquals(e.problems().size(), 1);
		assertTrue(e.getMessage().startsWith("5:1: field: "), e.getMessage());
	}

	@Test
	void countsColumnsInCodePoints() {
		List<Problem> problems = Vexyl.validate(HEAD.replace("\n", "\r\n") + "/* 𐐷é */ field nope\r\n");
		assertEquals(1, problems.size());
		assertEquals(5, problems.get(0).line());
		assertEquals(10, problems.get(0).column());
	}

	@Test
	void givesNoLineForWhatHasNoPlace() {
		List<Problem> problems = Vexyl.validate("vexyl 1\nmeta { name \"T\"; }\n");
		assertFalse(problems.isEmpty());
		assertTrue(problems.stream().noneMatch(Problem::hasLine), problems.toString());
	}

	@Test
	void refusesADocumentThatIsntUtf8() {
		byte[] bad = (HEAD + "field a\n").getBytes(StandardCharsets.UTF_8);
		bad[bad.length - 3] = (byte) 0xff;
		List<Problem> problems = Vexyl.validate(bad);
		assertEquals(1, problems.size());
		assertTrue(problems.get(0).message().contains("UTF-8"));
	}

	@Test
	void keepsNamesAwayFromJavasOwn() throws Exception {
		Flag flag = Vexyl.parse("vexyl 1\nmeta { name \"T\"; }\npalette { __proto__ \"#112233\"; toString \"#445566\"; }\n"
				+ "proportion hoist=10 fly=20\nbars __proto__ toString\n");
		@SuppressWarnings("unchecked")
		Map<String, Object> palette = (Map<String, Object>) flag.model().get("palette");
		assertEquals(List.of("__proto__", "toString"), List.copyOf(palette.keySet()));
	}

	@Test
	void givesAModelThatCantBeChanged() throws Exception {
		Map<String, Object> model = Vexyl.parse(HEAD + "field a\n").model();
		assertThrows(UnsupportedOperationException.class, () -> model.put("vexyl", 2));
		@SuppressWarnings("unchecked")
		List<Object> layers = (List<Object>) model.get("layers");
		assertThrows(UnsupportedOperationException.class, () -> layers.clear());
	}

	@Test
	void worksOutWhatDependsOnOtherValues() throws Exception {
		Map<String, Object> model = Vexyl.parse(HEAD + "bars a b { count 4; }\ncharge star a { radius 2; }\n").model();
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> layers = (List<Map<String, Object>>) model.get("layers");
		assertEquals(List.of("a", "b", "a", "b"), layers.get(0).get("colors"));
		assertEquals(List.of(1.0, 1.0, 1.0, 1.0), layers.get(0).get("ratio"));
		double inner = (Double) layers.get(1).get("inner");
		assertEquals(2 * Math.cos(Math.toRadians(72)) / Math.cos(Math.toRadians(36)), inner, 1e-12);
	}

	@TestFactory
	Stream<DynamicTest> readsEveryValidFlagToItsModel() {
		return Fixtures.cases().stream().map(c -> DynamicTest.dynamicTest((String) c.get("name"), () -> {
			Flag flag = Vexyl.parse(Fixtures.bytes((String) c.get("file")));
			Object expected = Fixtures.json((String) c.get("model"));
			Object got = TestJson.parse(flag.modelJson());
			String difference = difference("", expected, got);
			if (difference != null) {
				fail(difference);
			}
		}));
	}

	@TestFactory
	Stream<DynamicTest> refusesEveryInvalidDocumentOnItsLine() {
		List<Map<String, Object>> cases = Fixtures.json("invalid.json");
		return cases.stream().map(c -> DynamicTest.dynamicTest((String) c.get("name"), () -> {
			List<Problem> problems = Vexyl.validate(Fixtures.bytes((String) c.get("file")));
			assertFalse(problems.isEmpty(), "no problems");
			if (c.containsKey("line")) {
				int line = ((Double) c.get("line")).intValue();
				assertTrue(problems.stream().anyMatch(p -> p.line() == line), "no problem on line " + line + ": " + problems);
			}
		}));
	}

	@TestFactory
	Stream<DynamicTest> acceptsEveryDocumentAtALimit() {
		List<Map<String, Object>> cases = Fixtures.json("accepted.json");
		return cases.stream().map(c -> DynamicTest.dynamicTest((String) c.get("name"),
				() -> assertEquals(List.of(), Vexyl.validate(Fixtures.bytes((String) c.get("file"))))));
	}

	/** Where two models differ, with numbers compared as SDK section 4 says, or null if they don't. */
	static String difference(String at, Object a, Object b) {
		if (a instanceof Map && b instanceof Map) {
			Map<?, ?> x = (Map<?, ?>) a, y = (Map<?, ?>) b;
			if (!x.keySet().equals(y.keySet())) {
				return at + ": keys " + x.keySet() + " and " + y.keySet();
			}
			for (Object key : x.keySet()) {
				String d = difference(at + "." + key, x.get(key), y.get(key));
				if (d != null) {
					return d;
				}
			}
			return null;
		}
		if (a instanceof List && b instanceof List) {
			List<?> x = (List<?>) a, y = (List<?>) b;
			if (x.size() != y.size()) {
				return at + ": " + x.size() + " items and " + y.size();
			}
			for (int i = 0; i < x.size(); i++) {
				String d = difference(at + "[" + i + "]", x.get(i), y.get(i));
				if (d != null) {
					return d;
				}
			}
			return null;
		}
		if (a instanceof Double && b instanceof Double) {
			double x = (Double) a, y = (Double) b;
			double larger = Math.max(Math.abs(x), Math.abs(y));
			double allowed = larger < 1 ? 1e-6 : larger * 1e-6;
			return Math.abs(x - y) <= allowed ? null : at + ": " + x + " and " + y;
		}
		return a.equals(b) ? null : at + ": " + a + " and " + b;
	}
}
