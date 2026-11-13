// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Reads the suite's JSON fixtures, which is all the tests need of JSON. */
final class TestJson {
	private final String s;
	private int i;

	private TestJson(String s) {
		this.s = s;
	}

	static Object read(Path path) throws IOException {
		return parse(Files.readString(path));
	}

	static Object parse(String text) {
		TestJson j = new TestJson(text);
		Object v = j.value();
		j.space();
		if (j.i != text.length()) {
			throw new IllegalArgumentException("trailing text at " + j.i);
		}
		return v;
	}

	private void space() {
		while (i < s.length() && " \t\r\n".indexOf(s.charAt(i)) >= 0) {
			i++;
		}
	}

	private Object value() {
		space();
		char c = s.charAt(i);
		if (c == '{') {
			Map<String, Object> m = new LinkedHashMap<>();
			i++;
			space();
			if (s.charAt(i) == '}') {
				i++;
				return m;
			}
			while (true) {
				space();
				String key = string();
				space();
				i++;
				m.put(key, value());
				space();
				if (s.charAt(i++) == '}') {
					return m;
				}
			}
		}
		if (c == '[') {
			List<Object> list = new ArrayList<>();
			i++;
			space();
			if (s.charAt(i) == ']') {
				i++;
				return list;
			}
			while (true) {
				list.add(value());
				space();
				if (s.charAt(i++) == ']') {
					return list;
				}
			}
		}
		if (c == '"') {
			return string();
		}
		if (s.startsWith("true", i)) {
			i += 4;
			return true;
		}
		if (s.startsWith("false", i)) {
			i += 5;
			return false;
		}
		if (s.startsWith("null", i)) {
			i += 4;
			return null;
		}
		int start = i;
		while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) {
			i++;
		}
		return Double.parseDouble(s.substring(start, i));
	}

	private String string() {
		StringBuilder b = new StringBuilder();
		i++;
		while (true) {
			char c = s.charAt(i++);
			if (c == '"') {
				return b.toString();
			}
			if (c != '\\') {
				b.append(c);
				continue;
			}
			char e = s.charAt(i++);
			switch (e) {
			case 'n': b.append('\n'); break;
			case 'r': b.append('\r'); break;
			case 't': b.append('\t'); break;
			case 'b': b.append('\b'); break;
			case 'f': b.append('\f'); break;
			case 'u':
				b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
				i += 4;
				break;
			default: b.append(e);
			}
		}
	}
}
