// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Numbers written inside strings: a box, a fold's crease, and path data. */
final class Numbers {
	private Numbers() {}

	private static final String SPACE = " \t\n\f\r";
	private static final Pattern LIST = Pattern.compile(
			"[ \\t\\n\\f\\r]*" + Sanitizer.DECIMAL + "(?:" + Sanitizer.COMMA_SPACE + Sanitizer.DECIMAL + ")*[ \\t\\n\\f\\r]*");
	private static final Pattern SPLIT = Pattern.compile(Sanitizer.COMMA_SPACE);
	private static final Pattern PATH_NUMBER = Pattern.compile(Sanitizer.DECIMAL);
	private static final String COMMANDS = "MmLlHhVvCcSsQqTtAaZz";

	/** Reads a string of numbers, separated by whitespace, a comma or both, or gives null. */
	static double[] list(String text) {
		if (!LIST.matcher(text).matches()) {
			return null;
		}
		String[] parts = SPLIT.split(Sanitizer.trim(text), -1);
		double[] out = new double[parts.length];
		for (int i = 0; i < parts.length; i++) {
			Double v = Sanitizer.decimalValue(parts[i]);
			if (v == null) {
				return null;
			}
			out[i] = v;
		}
		return out;
	}

	private static int arguments(char c) {
		switch (c) {
		case 'M': case 'L': case 'T': return 2;
		case 'H': case 'V': return 1;
		case 'C': return 6;
		case 'S': case 'Q': return 4;
		case 'A': return 7;
		case 'Z': return 0;
		default: return -1;
		}
	}

	/**
	 * Checks path data against SVG's grammar, within the format's limits on numbers, so that a bad
	 * one can't silently draw part of a shape or nothing.
	 */
	static boolean validPath(String d) {
		return new PathCheck(d).valid();
	}

	private static final class PathCheck {
		private final String d;
		private int i;

		PathCheck(String d) {
			this.d = d;
		}

		private void space() {
			while (i < d.length() && SPACE.indexOf(d.charAt(i)) >= 0) {
				i++;
			}
		}

		/** Skips whitespace and at most one comma, and says if there was a comma. */
		private boolean separator() {
			space();
			if (i < d.length() && d.charAt(i) == ',') {
				i++;
				space();
				return true;
			}
			return false;
		}

		private boolean number() {
			Matcher m = PATH_NUMBER.matcher(d);
			m.region(i, d.length());
			if (!m.lookingAt() || m.end() == i) {
				return false;
			}
			double v = Double.parseDouble(m.group());
			if (Double.isNaN(v) || Math.abs(v) > Limits.NUMBER_LIMIT) {
				return false;
			}
			i = m.end();
			return true;
		}

		boolean valid() {
			space();
			if (i >= d.length() || (d.charAt(i) != 'M' && d.charAt(i) != 'm')) {
				return false;
			}
			while (i < d.length()) {
				char c = Character.toUpperCase(d.charAt(i));
				int count = d.charAt(i) < 128 ? arguments(c) : -1;
				if (count < 0) {
					return false;
				}
				i++;
				space();
				// A command can repeat its arguments with no letter, except for Z, which has none.
				for (boolean first = true; count > 0 && (first || (i < d.length() && COMMANDS.indexOf(d.charAt(i)) < 0)); first = false) {
					for (int arg = 0; arg < count; arg++) {
						if (c == 'A' && (arg == 3 || arg == 4)) {
							if (i >= d.length() || (d.charAt(i) != '0' && d.charAt(i) != '1')) {
								return false;
							}
							i++;
						} else if (!number()) {
							return false;
						}
						if (arg < count - 1) {
							separator();
						}
					}
					if (separator() && (i >= d.length() || COMMANDS.indexOf(d.charAt(i)) >= 0)) {
						return false;
					}
				}
				space();
			}
			return true;
		}
	}
}
