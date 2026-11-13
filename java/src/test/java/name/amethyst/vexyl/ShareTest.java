// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

/** Share links, as section 8 of the SDK has them. */
class ShareTest {
	@Test
	void roundTripsADocumentExactly() throws Exception {
		String doc = "﻿" + VexylTest.HEAD.replace("\n", "\r\n") + "field a\r\n";
		String link = Vexyl.shareEncode(doc);
		assertTrue(link.startsWith("v1."), link);
		assertTrue(link.matches("v1\\.[A-Za-z0-9_-]*"), link);
		assertEquals(doc, Vexyl.shareDecode(link));
	}

	@Test
	void usesTheDictionary() throws Exception {
		String doc = Fixtures.text("valid/united-states.kdl");
		String link = Vexyl.shareEncode(doc);
		// Without the dictionary, so small a flag compresses far less.
		java.util.zip.Deflater plain = new java.util.zip.Deflater(java.util.zip.Deflater.BEST_COMPRESSION, true);
		plain.setInput(doc.getBytes(StandardCharsets.UTF_8));
		plain.finish();
		byte[] out = new byte[doc.length() * 2];
		int without = plain.deflate(out);
		plain.end();
		int with = java.util.Base64.getUrlDecoder().decode(link.substring(3)).length;
		assertTrue(with < without * 0.85, with + " bytes with the dictionary, " + without + " without");
		byte[] sum = MessageDigest.getInstance("SHA-256").digest(Share.dictionary());
		assertEquals("92062df2fd010bea13d1aefb30c2cfbb2ad6aee5a60e8f8e2d2455516c1c6b97", Parser.hex(sum, 32));
	}

	@Test
	void refusesWhatIsntALink() {
		for (String bad : List.of("", "v1", "v2.AwA", "V1.AwA", "v1.AwA=", "v1.A wA", "v1.Aw+A", "v1.A")) {
			assertThrows(VexylException.class, () -> Vexyl.shareDecode(bad), bad);
		}
		assertThrows(VexylException.class, () -> Vexyl.shareEncode("x".repeat(Share.MAX_BYTES + 1)));
	}

	@TestFactory
	Stream<DynamicTest> readsTheSuitesLinks() {
		Map<String, Object> share = Fixtures.json("share.json");
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> accepted = (List<Map<String, Object>>) share.get("accepted");
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> refused = (List<Map<String, Object>>) share.get("refused");
		Stream<DynamicTest> good = accepted.stream().map(c -> DynamicTest.dynamicTest((String) c.get("name"), () -> {
			String doc = Vexyl.shareDecode(link((String) c.get("link")));
			byte[] bytes = doc.getBytes(StandardCharsets.UTF_8);
			assertEquals(((Double) c.get("bytes")).intValue(), bytes.length);
			assertEquals(c.get("sha256"), Parser.hex(MessageDigest.getInstance("SHA-256").digest(bytes), 32));
		}));
		Stream<DynamicTest> bad = refused.stream().map(c -> DynamicTest.dynamicTest((String) c.get("name"),
				() -> assertThrows(VexylException.class, () -> Vexyl.shareDecode(link((String) c.get("link"))))));
		return Stream.concat(good, bad);
	}

	private static String link(String file) {
		String text = new String(Fixtures.bytes(file), StandardCharsets.UTF_8);
		int end = text.length();
		while (end > 0 && text.charAt(end - 1) == '\n') {
			end--;
		}
		return text.substring(0, end);
	}
}
