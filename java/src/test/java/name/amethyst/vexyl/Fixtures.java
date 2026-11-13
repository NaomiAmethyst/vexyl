// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** The conformance suite's fixtures, which the tests read from the repository around java/. */
final class Fixtures {
	private Fixtures() {}

	static final Path SUITE = Path.of("..", "conformance");

	static String text(String relative) {
		try {
			return Files.readString(SUITE.resolve(relative), StandardCharsets.UTF_8);
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
	}

	static byte[] bytes(String relative) {
		try {
			return Files.readAllBytes(SUITE.resolve(relative));
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
	}

	@SuppressWarnings("unchecked")
	static <T> T json(String relative) {
		try {
			return (T) TestJson.read(SUITE.resolve(relative));
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
	}

	/** Each flag in the manifest, with its renders. */
	static List<Map<String, Object>> cases() {
		Map<String, Object> manifest = json("manifest.json");
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> cases = (List<Map<String, Object>>) manifest.get("cases");
		return cases;
	}

	@SuppressWarnings("unchecked")
	static List<Map<String, Object>> renders(Map<String, Object> c) {
		return (List<Map<String, Object>>) c.get("renders");
	}

	/** A render's options as the manifest writes them, with the ratio as hoist then fly. */
	@SuppressWarnings("unchecked")
	static RenderOptions options(Map<String, Object> render) {
		Map<String, Object> o = (Map<String, Object>) render.get("options");
		RenderOptions.Builder b = RenderOptions.builder();
		for (Map.Entry<String, Object> e : o.entrySet()) {
			String v = String.valueOf(e.getValue());
			switch (e.getKey()) {
			case "ratio": {
				String[] parts = v.split(":");
				b.ratio(Double.parseDouble(parts[1]) / Double.parseDouble(parts[0]));
				break;
			}
			case "variant": b.variant(v); break;
			case "side": b.side(v); break;
			case "fit": b.fit(v); break;
			case "align": b.align(v); break;
			case "fold": b.fold(v); break;
			case "fold_step": b.foldStep((int) Double.parseDouble(v)); break;
			default: throw new IllegalArgumentException("unknown option " + e.getKey());
			}
		}
		return b.build();
	}

	/** Every flag under valid/, by file name. */
	static List<String> validFiles() {
		List<String> out = new ArrayList<>();
		for (Map<String, Object> c : cases()) {
			out.add((String) c.get("file"));
		}
		return out;
	}
}
