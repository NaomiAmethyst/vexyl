// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;

/** What a release needs of this library. */
class ReleaseTest {
	@Test
	void hasTheReleasesVersion() throws Exception {
		// Releases are one train, and ts/package.json says which.
		@SuppressWarnings("unchecked")
		Map<String, Object> pkg = (Map<String, Object>) TestJson.read(Path.of("..", "ts", "package.json"));
		String pom = Files.readString(Path.of("pom.xml"));
		Matcher m = Pattern.compile("<artifactId>vexyl</artifactId>\\s*<version>([^<]+)</version>").matcher(pom);
		assertTrue(m.find(), "pom.xml has no version");
		assertEquals(pkg.get("version"), m.group(1));
	}

	@Test
	void readsTheFormatVersionItSays() {
		assertEquals(1, Vexyl.FORMAT_VERSION);
	}
}
