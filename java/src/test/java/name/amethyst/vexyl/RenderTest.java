// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

/** Rendering, with its options, tags and IDs. */
class RenderTest {
	private static final Pattern ID = Pattern.compile(" id=\"([^\"]*)\"");
	private static final Pattern TAG = Pattern.compile(" data-vexyl-layer=\"([^\"]*)\"");

	private static Flag flag(String file) throws ProblemsException {
		return Vexyl.parse(Fixtures.bytes(file));
	}

	@TestFactory
	Stream<DynamicTest> rendersEveryFormOfEveryFlag() {
		List<DynamicTest> tests = new ArrayList<>();
		for (Map<String, Object> c : Fixtures.cases()) {
			for (Map<String, Object> r : Fixtures.renders(c)) {
				tests.add(DynamicTest.dynamicTest(c.get("name") + " " + r.get("name"), () -> {
					Flag flag = flag((String) c.get("file"));
					RenderOptions opts = Fixtures.options(r);
					if (Boolean.TRUE.equals(r.get("refused"))) {
						assertThrows(VexylException.class, () -> flag.svg(opts));
						return;
					}
					String svg = flag.svg(opts);
					assertTrue(svg.startsWith("<svg"), svg);
					assertFalse(TAG.matcher(svg).find(), "a plain render has tags");
					List<String> ids = all(ID, svg);
					assertEquals(ids.size(), new HashSet<>(ids).size(), "an id is used twice");
				}));
			}
		}
		return tests.stream();
	}

	@TestFactory
	Stream<DynamicTest> neverChangesAFlag() {
		return Fixtures.cases().stream().map(c -> DynamicTest.dynamicTest((String) c.get("name"), () -> {
			Flag flag = flag((String) c.get("file"));
			String model = flag.modelJson();
			String plain = flag.svg(RenderOptions.defaults());
			for (Map<String, Object> r : Fixtures.renders(c)) {
				try {
					flag.svg(Fixtures.options(r));
					flag.svg(Fixtures.options(r).toBuilder().tags(true).build());
				} catch (VexylException e) {
					// A refused form changes nothing either.
				}
			}
			assertEquals(model, flag.modelJson());
			assertEquals(plain, flag.svg(RenderOptions.defaults()));
		}));
	}

	@TestFactory
	Stream<DynamicTest> tagsWhatEachLayerDraws() {
		return Fixtures.cases().stream().map(c -> DynamicTest.dynamicTest((String) c.get("name"), () -> {
			String file = (String) c.get("file");
			Flag flag = flag(file);
			Set<String> paths = Vexyl.locate(Fixtures.text(file)).stream().map(Span::path).collect(Collectors.toSet());
			String tagged = flag.svg(RenderOptions.builder().tags(true).build());
			List<String> tags = all(TAG, tagged);
			assertFalse(tags.isEmpty(), "nothing is tagged");
			for (String tag : tags) {
				assertTrue(paths.contains(tag), "tag " + tag + " isn't a located path");
			}
			assertEquals(flag.svg(RenderOptions.defaults()), TAG.matcher(tagged).replaceAll(""));
		}));
	}

	@Test
	void startsEveryIdWithAPrefixWhenAsked() throws Exception {
		Flag flag = flag("valid/united-states.kdl");
		String svg = flag.svg(RenderOptions.builder().idPrefix("page-1-").build());
		List<String> ids = all(ID, svg);
		assertFalse(ids.isEmpty());
		for (String id : ids) {
			assertTrue(id.startsWith("page-1-"), id);
		}
	}

	@Test
	void givesTwoDocumentsDifferentIds() throws Exception {
		Set<String> a = new HashSet<>(all(ID, flag("valid/united-states.kdl").svg(RenderOptions.defaults())));
		Set<String> b = new HashSet<>(all(ID, flag("valid/inline-svg.kdl").svg(RenderOptions.defaults())));
		a.retainAll(b);
		assertEquals(Set.of(), a);
	}

	@Test
	void setsTheHeight() throws Exception {
		String svg = flag("valid/united-states.kdl").svg(RenderOptions.builder().height(100).build());
		assertTrue(svg.contains("height=\"100\""), svg.substring(0, 200));
	}

	@Test
	void refusesOptionsItCantUse() throws Exception {
		Flag flag = Vexyl.parse(Fixtures.bytes("options.kdl"));
		List<RenderOptions> refused = List.of(
				RenderOptions.builder().height(0).build(),
				RenderOptions.builder().height(-1).build(),
				RenderOptions.builder().ratio(0).build(),
				RenderOptions.builder().side("front").build(),
				RenderOptions.builder().ratio(1).fit("stretch").build(),
				RenderOptions.builder().ratio(1).fit("pad").align("middle").build(),
				RenderOptions.builder().variant("nope").build(),
				RenderOptions.builder().fold("nope").build(),
				RenderOptions.builder().fit("pad").build(),
				RenderOptions.builder().ratio(1).align("start").build(),
				RenderOptions.builder().foldStep(1).build(),
				RenderOptions.builder().fold("half").side("reverse").build(),
				RenderOptions.builder().fold("half").foldStep(0).build());
		for (RenderOptions opts : refused) {
			assertThrows(VexylException.class, () -> flag.svg(opts));
		}
		flag.svg(RenderOptions.builder().ratio(1).fit("pad").align("end").build());
		flag.svg(RenderOptions.builder().fold("half").foldStep(1).build());
	}

	@Test
	void givesATreeThatWritesOutTheSame() throws Exception {
		Flag flag = flag("valid/united-states.kdl");
		Element tree = flag.svgTree(RenderOptions.defaults());
		assertEquals("svg", tree.name());
		Element title = tree.children().stream().filter(e -> e.name().equals("title")).findFirst().orElseThrow();
		assertEquals(flag.name(), title.text());
		assertNotEquals(-1, tree.toString().indexOf("<title>"));
		assertEquals(tree, flag.svgTree(RenderOptions.defaults()));
	}

	@Test
	void rendersFromManyThreadsAtOnce() throws Exception {
		Flag flag = flag("valid/united-states.kdl");
		String expected = flag.svg(RenderOptions.defaults());
		ExecutorService pool = Executors.newFixedThreadPool(4);
		try {
			List<Future<String>> results = new ArrayList<>();
			for (int i = 0; i < 16; i++) {
				results.add(pool.submit(() -> flag.svg(RenderOptions.defaults())));
			}
			for (Future<String> f : results) {
				assertEquals(expected, f.get());
			}
		} finally {
			pool.shutdown();
		}
	}

	private static List<String> all(Pattern p, String text) {
		List<String> out = new ArrayList<>();
		Matcher m = p.matcher(text);
		while (m.find()) {
			out.add(m.group(1));
		}
		return out;
	}
}
