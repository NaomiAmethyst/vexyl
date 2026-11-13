// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Checks inline SVG against the format's allowlist, as SPEC section 8.3 says, and writes what
 * passes in the canonical form of SDK section 4.2.
 */
final class Sanitizer {
	static final String SVG_NAMESPACE = "http://www.w3.org/2000/svg";
	static final String XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
	static final int MAX_DEPTH = 64;

	/**
	 * Stands in for an ID's prefix in sanitized markup until it's drawn. It can't appear in XML, so
	 * it can't be confused with anything in the artwork.
	 */
	private static final String ID_MARK = "\0";

	/** What counts as whitespace inside strings and inline SVG. */
	private static final String SPACE = " \t\n\f\r";

	/** The one way to write a number inside a string, as SPEC section 4 gives it. */
	static final String DECIMAL = "[-+]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][-+]?[0-9]+)?";
	/** Separates numbers in a string, as SVG's comma-wsp does. */
	static final String COMMA_SPACE = "(?:[ \\t\\n\\f\\r]*,[ \\t\\n\\f\\r]*|[ \\t\\n\\f\\r]+)";

	private static final Set<String> COLOR_PROPS = Set.of("fill", "stroke", "stop-color", "flood-color",
			"lighting-color", "color");
	private static final Set<String> ALLOWED_ELEMENTS = Set.of("defs", "g", "path", "rect", "circle", "ellipse",
			"line", "polyline", "polygon", "linearGradient", "radialGradient", "stop", "clipPath", "mask");
	/** These describe a file rather than draw it. */
	private static final Set<String> DROPPED_ELEMENTS = Set.of("title", "desc", "metadata");
	/** Allowed as attributes and in style attributes. */
	private static final Set<String> PRESENTATION = Set.of("fill", "fill-opacity", "fill-rule", "stroke",
			"stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
			"stroke-dasharray", "stroke-dashoffset", "opacity", "clip-path", "clip-rule", "mask", "stop-color",
			"stop-opacity", "color", "display", "visibility", "paint-order", "vector-effect", "shape-rendering",
			"mix-blend-mode", "isolation");
	private static final Set<String> ALLOWED_ATTRS = Set.of("id", "transform", "d", "x", "y", "width", "height",
			"cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "points", "offset", "fx", "fy", "fr",
			"gradientUnits", "gradientTransform", "spreadMethod", "clipPathUnits", "maskUnits", "maskContentUnits",
			"style", "href");
	/** Consumed in working out the root's viewBox, or replaced when it's placed on the flag. */
	private static final Set<String> ROOT_ONLY = Set.of("id", "x", "y", "width", "height", "viewBox",
			"preserveAspectRatio", "version", "baseProfile");

	private static final Pattern CSS_WORD = Pattern.compile("[A-Za-z0-9_-]+");
	private static final Pattern LOCAL_ID = Pattern.compile("[A-Za-z_][A-Za-z0-9_.:-]*");
	// These spell their cases out, since matching case-insensitively could take other letters.
	private static final Pattern COLOR_FUNC = Pattern.compile("(?<![A-Za-z0-9_])(?:[rR][gG][bB][aA]?|[hH][sS][lL][aA]?)\\(");
	private static final Pattern LOCAL_URL = Pattern.compile(
			"[uU][rR][lL]\\([ \\t\\n\\f\\r]*[\"']?#([A-Za-z_][A-Za-z0-9_.:-]*)[\"']?[ \\t\\n\\f\\r]*\\)");
	private static final Pattern VIEW_BOX = Pattern.compile("[ \\t\\n\\f\\r]*(" + DECIMAL + ")" + COMMA_SPACE + "("
			+ DECIMAL + ")" + COMMA_SPACE + "(" + DECIMAL + ")" + COMMA_SPACE + "(" + DECIMAL + ")[ \\t\\n\\f\\r]*");
	private static final Pattern LENGTH = Pattern.compile("[ \\t\\n\\f\\r]*(" + DECIMAL + ")(?:px)?[ \\t\\n\\f\\r]*");
	private static final Pattern DECIMAL_WHOLE = Pattern.compile(DECIMAL);
	/** SVG's default preserveAspectRatio, the only way artwork is ever fitted. */
	private static final Pattern DEFAULT_FIT = Pattern.compile("[ \\t\\n\\f\\r]*xMidYMid(?:[ \\t\\n\\f\\r]+meet)?[ \\t\\n\\f\\r]*");

	private Sanitizer() {
	}

	/** Inline SVG that has passed the sanitizer. */
	static final class Artwork {
		private String viewBox = "";
		private boolean currentColor;
		/** The root element's attributes, each with a leading space. */
		private String attrs = "";
		private String body = "";

		/** The root's viewBox, its four numbers joined by single spaces as they were written. */
		String viewBox() {
			return viewBox;
		}

		/** Whether the artwork paints in currentColor anywhere. */
		boolean usesCurrentColor() {
			return currentColor;
		}

		/** The root's attributes, each with a leading space, with every ID given a prefix. */
		String attrs(String idPrefix) {
			return attrs.replace(ID_MARK, idPrefix);
		}

		/** What's inside the root, with every ID and reference given a prefix. */
		String body(String idPrefix) {
			return body.replace(ID_MARK, idPrefix);
		}

		/** The sanitized artwork as one document, with its IDs as they were written. */
		String canonical() {
			return ("<svg xmlns=\"" + SVG_NAMESPACE + "\" viewBox=\"" + Xml.escape(viewBox) + "\"" + attrs + ">" + body
					+ "</svg>").replace(ID_MARK, "");
		}
	}

	/** A number written as SPEC section 4 says, within the format's limits, or null. */
	static Double decimalValue(String text) {
		if (!DECIMAL_WHOLE.matcher(text).matches()) {
			return null;
		}
		double v;
		try {
			v = Double.parseDouble(text);
		} catch (NumberFormatException e) {
			return null;
		}
		double a = Math.abs(v);
		if (Double.isNaN(v) || a > 1e12 || (a != 0 && a < 1 / 1e12)) {
			return null;
		}
		return v;
	}

	static String trim(String s) {
		int start = 0;
		int end = s.length();
		while (start < end && SPACE.indexOf(s.charAt(start)) >= 0) {
			start++;
		}
		while (end > start && SPACE.indexOf(s.charAt(end - 1)) >= 0) {
			end--;
		}
		return s.substring(start, end);
	}

	static String asciiLower(String s) {
		StringBuilder b = new StringBuilder(s.length());
		for (int i = 0; i < s.length(); i++) {
			char c = s.charAt(i);
			b.append(c >= 'A' && c <= 'Z' ? (char) (c + 'a' - 'A') : c);
		}
		return b.toString();
	}

	private static List<String> split(String s, char sep) {
		List<String> out = new ArrayList<>();
		int start = 0;
		for (int i = 0; i <= s.length(); i++) {
			if (i == s.length() || s.charAt(i) == sep) {
				out.add(s.substring(start, i));
				start = i + 1;
			}
		}
		return out;
	}

	/**
	 * Whether an attribute, or a declaration in a style, paints in currentColor, as its value or as
	 * a keyword in it such as a fallback after url(#id). An id or other text containing the word
	 * doesn't count.
	 */
	static boolean takesCurrentColor(String name, String value) {
		if (name.equals("style")) {
			for (String decl : split(value, ';')) {
				int colon = decl.indexOf(':');
				String prop = colon < 0 ? decl : decl.substring(0, colon);
				String v = colon < 0 ? "" : decl.substring(colon + 1);
				if (takesCurrentColor(asciiLower(trim(prop)), v)) {
					return true;
				}
			}
			return false;
		}
		if (!COLOR_PROPS.contains(name)) {
			return false;
		}
		Matcher m = CSS_WORD.matcher(LOCAL_URL.matcher(value).replaceAll(""));
		while (m.find()) {
			if (asciiLower(m.group()).equals("currentcolor")) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Checks inline SVG and gives a copy with marks in place of its IDs' prefixes, so that drawing it
	 * can make them unique. Anything drawn must be on the allowlist or the markup is refused; only
	 * descriptive and foreign-namespace content is removed quietly.
	 */
	static Artwork sanitize(String markup) throws VexylException {
		Xml dec;
		try {
			dec = new Xml(markup);
		} catch (Xml.XmlException e) {
			throw new VexylException("invalid SVG: " + e.getMessage());
		}
		Artwork result = new Artwork();
		StringBuilder body = new StringBuilder();
		int depth = 0;
		int skip = 0;
		boolean sawRoot = false;
		boolean closedRoot = false;
		while (true) {
			Xml.Token t;
			try {
				t = dec.token();
			} catch (Xml.XmlException e) {
				throw new VexylException("invalid SVG: " + e.getMessage());
			}
			if (t == null) {
				break;
			}
			switch (t.kind()) {
				case DIRECTIVE:
					throw new VexylException("SVG can't contain a DOCTYPE or other directive");
				case TEXT:
					if (skip == 0 && !trim(t.text()).isEmpty()) {
						throw new VexylException("SVG can't contain text outside elements; convert any lettering to paths");
					}
					break;
				case START: {
					if (skip > 0) {
						skip++;
						break;
					}
					if (closedRoot) {
						throw new VexylException("SVG must have a single root element");
					}
					Xml.Name name = t.name();
					if (!sawRoot) {
						sawRoot = true;
						if (!name.space().equals(SVG_NAMESPACE) || !name.local().equals("svg")) {
							throw new VexylException("root must be <svg xmlns=\"" + SVG_NAMESPACE + "\">");
						}
						readRoot(result, t.attrs());
						depth = 1;
						break;
					}
					if ((!name.space().equals(SVG_NAMESPACE) && !name.space().isEmpty())
							|| (name.space().equals(SVG_NAMESPACE) && DROPPED_ELEMENTS.contains(name.local()))) {
						skip = 1;
						break;
					}
					if (name.space().isEmpty() || !ALLOWED_ELEMENTS.contains(name.local())) {
						throw new VexylException("SVG element <" + name.local() + "> isn't allowed");
					}
					depth++;
					if (depth > MAX_DEPTH) {
						throw new VexylException("SVG is nested more than " + MAX_DEPTH + " levels deep");
					}
					String attrs;
					try {
						attrs = cleanAttrs(t.attrs(), Set.of(), result);
					} catch (VexylException e) {
						throw new VexylException("SVG element <" + name.local() + ">: " + e.getMessage());
					}
					body.append('<').append(name.local()).append(attrs).append('>');
					break;
				}
				case END:
					if (skip > 0) {
						skip--;
						break;
					}
					depth--;
					if (depth == 0) {
						closedRoot = true;
						break;
					}
					body.append("</").append(t.name().local()).append('>');
					break;
				default:
					break;
			}
		}
		if (!sawRoot) {
			throw new VexylException("SVG has no root element");
		}
		result.body = body.toString();
		return result;
	}

	/** Works out the root's viewBox and keeps its other styling attributes. */
	private static void readRoot(Artwork e, List<Xml.Attr> attrs) throws VexylException {
		String viewBox = "";
		String width = "";
		String height = "";
		for (Xml.Attr a : attrs) {
			if (!a.name().space().isEmpty()) {
				continue;
			}
			switch (a.name().local()) {
				case "viewBox":
					viewBox = a.value();
					break;
				case "width":
					width = a.value();
					break;
				case "height":
					height = a.value();
					break;
				case "preserveAspectRatio":
					if (!DEFAULT_FIT.matcher(a.value()).matches()) {
						throw new VexylException("SVG's preserveAspectRatio \"" + a.value()
								+ "\" isn't the default, which is how artwork is always fitted");
					}
					break;
				default:
					break;
			}
		}
		if (!viewBox.isEmpty()) {
			Matcher m = VIEW_BOX.matcher(viewBox);
			if (!m.matches()) {
				throw new VexylException("SVG has an invalid viewBox \"" + viewBox + "\"");
			}
			for (int i = 1; i <= 4; i++) {
				if (decimalValue(m.group(i)) == null) {
					throw new VexylException("SVG has an invalid viewBox \"" + viewBox + "\"");
				}
			}
			if (Double.parseDouble(m.group(3)) <= 0 || Double.parseDouble(m.group(4)) <= 0) {
				throw new VexylException("SVG viewBox \"" + viewBox + "\" has no area");
			}
			e.viewBox = m.group(1) + " " + m.group(2) + " " + m.group(3) + " " + m.group(4);
		} else {
			Matcher wm = LENGTH.matcher(width);
			Matcher hm = LENGTH.matcher(height);
			if (!wm.matches() || !hm.matches()) {
				throw new VexylException("SVG needs a viewBox, or a numeric width and height");
			}
			Double w = decimalValue(wm.group(1));
			Double h = decimalValue(hm.group(1));
			if (w == null || h == null || w <= 0 || h <= 0) {
				throw new VexylException("SVG's width and height must be positive");
			}
			e.viewBox = "0 0 " + wm.group(1) + " " + hm.group(1);
		}
		try {
			e.attrs = cleanAttrs(attrs, ROOT_ONLY, e);
		} catch (VexylException err) {
			throw new VexylException("SVG root: " + err.getMessage());
		}
	}

	/**
	 * Checks attributes against the allowlist and writes them out, noting whether any of them paints
	 * in currentColor.
	 */
	private static String cleanAttrs(List<Xml.Attr> attrs, Set<String> ignored, Artwork e) throws VexylException {
		StringBuilder b = new StringBuilder();
		boolean href = false;
		for (Xml.Attr a : attrs) {
			String name = a.name().local();
			String space = a.name().space();
			if (space.equals(XLINK_NAMESPACE) && name.equals("href")) {
				// The same as the plain href it's equivalent to.
			} else if (!space.isEmpty()) {
				// Editor data doesn't affect rendering.
				continue;
			} else if (ignored.contains(name)) {
				continue;
			} else if (!ALLOWED_ATTRS.contains(name) && !PRESENTATION.contains(name)) {
				throw new VexylException("attribute \"" + name + "\" isn't allowed");
			}
			if (name.equals("href")) {
				if (href) {
					throw new VexylException("attribute \"href\" is repeated, since xlink:href means the same");
				}
				href = true;
			}
			String value = cleanValue(name, a.value());
			if (takesCurrentColor(name, a.value())) {
				e.currentColor = true;
			}
			b.append(' ').append(name).append("=\"").append(value).append('"');
		}
		return b.toString();
	}

	/** A value escaped for writing out. */
	private static String cleanValue(String name, String value) throws VexylException {
		switch (name) {
			case "id":
				if (!LOCAL_ID.matcher(value).matches()) {
					throw new VexylException("invalid id \"" + value + "\"");
				}
				return ID_MARK + Xml.escape(value);
			case "href":
				if (!value.startsWith("#") || !LOCAL_ID.matcher(value.substring(1)).matches()) {
					throw new VexylException("href \"" + value + "\" must refer to an id in this SVG");
				}
				return "#" + ID_MARK + Xml.escape(value.substring(1));
			case "style":
				return cleanStyle(value);
			default:
				break;
		}
		if (PRESENTATION.contains(name)) {
			return cleanPresentation(value);
		}
		return Xml.escape(value);
	}

	/**
	 * Marks url(#id) references and refuses every CSS function other than those and plain color
	 * functions, since functions can load things.
	 */
	private static String cleanPresentation(String value) throws VexylException {
		String remaining = COLOR_FUNC.matcher(LOCAL_URL.matcher(value).replaceAll("")).replaceAll("");
		if (remaining.indexOf('(') >= 0) {
			throw new VexylException("\"" + value + "\" uses a function other than url(#id) or a color");
		}
		StringBuilder b = new StringBuilder();
		int last = 0;
		Matcher m = LOCAL_URL.matcher(value);
		while (m.find()) {
			b.append(Xml.escape(value.substring(last, m.start()))).append("url(#").append(ID_MARK)
					.append(Xml.escape(m.group(1))).append(')');
			last = m.end();
		}
		b.append(Xml.escape(value.substring(last)));
		return b.toString();
	}

	/** Keeps a style's declarations in their order, since a later one can win. */
	private static String cleanStyle(String style) throws VexylException {
		if (style.indexOf('\\') >= 0 || style.indexOf('@') >= 0 || style.contains("/*")) {
			throw new VexylException("style can't contain escapes, at-rules or comments");
		}
		List<String> out = new ArrayList<>();
		for (String decl : split(style, ';')) {
			if (trim(decl).isEmpty()) {
				continue;
			}
			int colon = decl.indexOf(':');
			String prop = asciiLower(trim(colon < 0 ? decl : decl.substring(0, colon)));
			if (colon < 0 || !PRESENTATION.contains(prop)) {
				throw new VexylException("style property \"" + prop + "\" isn't allowed");
			}
			out.add(prop + ":" + cleanPresentation(trim(decl.substring(colon + 1))));
		}
		return String.join(";", out);
	}
}
