// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/** Writes plain data as JSON: maps, lists, strings, numbers, booleans and null. */
final class Json {
	private Json() {}

	static String write(Object value, boolean indent) {
		StringBuilder b = new StringBuilder();
		write(b, value, indent ? 0 : -1);
		return b.toString();
	}

	/** A number as its shortest decimal, without an exponent if it's of a usual size. */
	static String number(double v) {
		if (v == Math.rint(v) && Math.abs(v) < 1e15) {
			return Long.toString((long) v);
		}
		String text = new BigDecimal(Double.toString(v)).stripTrailingZeros().toPlainString();
		return text;
	}

	private static void newline(StringBuilder b, int depth) {
		if (depth >= 0) {
			b.append('\n');
			b.append(" ".repeat(depth));
		}
	}

	private static void write(StringBuilder b, Object value, int depth) {
		int inner = depth >= 0 ? depth + 1 : -1;
		if (value == null) {
			b.append("null");
		} else if (value instanceof String) {
			string(b, (String) value);
		} else if (value instanceof Boolean) {
			b.append(value);
		} else if (value instanceof Double || value instanceof Float) {
			double v = ((Number) value).doubleValue();
			if (Double.isNaN(v) || Double.isInfinite(v)) {
				throw new IllegalArgumentException("JSON has no " + v);
			}
			b.append(number(v));
		} else if (value instanceof Number) {
			b.append(value);
		} else if (value instanceof Map) {
			Map<?, ?> map = (Map<?, ?>) value;
			if (map.isEmpty()) {
				b.append("{}");
				return;
			}
			b.append('{');
			boolean first = true;
			for (Map.Entry<?, ?> e : map.entrySet()) {
				if (!first) {
					b.append(',');
				}
				first = false;
				newline(b, inner);
				string(b, (String) e.getKey());
				b.append(depth >= 0 ? ": " : ":");
				write(b, e.getValue(), inner);
			}
			newline(b, depth);
			b.append('}');
		} else if (value instanceof List) {
			List<?> list = (List<?>) value;
			if (list.isEmpty()) {
				b.append("[]");
				return;
			}
			b.append('[');
			boolean first = true;
			for (Object item : list) {
				if (!first) {
					b.append(',');
				}
				first = false;
				newline(b, inner);
				write(b, item, inner);
			}
			newline(b, depth);
			b.append(']');
		} else {
			throw new IllegalArgumentException("can't write " + value.getClass() + " as JSON");
		}
	}

	static void string(StringBuilder b, String s) {
		b.append('"');
		for (int i = 0; i < s.length(); i++) {
			char c = s.charAt(i);
			switch (c) {
			case '"': b.append("\\\""); break;
			case '\\': b.append("\\\\"); break;
			case '\n': b.append("\\n"); break;
			case '\r': b.append("\\r"); break;
			case '\t': b.append("\\t"); break;
			default:
				if (c < 0x20 || c == 0x2028 || c == 0x2029) {
					b.append(String.format("\\u%04x", (int) c));
				} else {
					b.append(c);
				}
			}
		}
		b.append('"');
	}
}
