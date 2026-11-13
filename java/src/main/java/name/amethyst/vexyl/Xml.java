// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Reads well-formed XML 1.0 with namespaces, one token at a time, as SPEC section 8.3 defines it,
 * and refuses everything else. A sanitizer's security rests on reading markup exactly one way, so
 * nothing here is lenient.
 */
final class Xml {
	static final String XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
	static final String XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

	/** A name with its namespace worked out. */
	record Name(String space, String local) {
	}

	record Attr(Name name, String value) {
	}

	enum Kind {
		START, END, TEXT, OTHER, DIRECTIVE
	}

	record Token(Kind kind, Name name, List<Attr> attrs, String text) {
		static Token of(Kind kind) {
			return new Token(kind, null, List.of(), "");
		}
	}

	/** Malformed markup. */
	static final class XmlException extends Exception {
		private static final long serialVersionUID = 1L;

		XmlException(String message) {
			super(message);
		}
	}

	/** An open element, with what its namespace declarations replaced. */
	private static final class Frame {
		final String raw;
		Name name;
		final List<String[]> undo = new ArrayList<>();

		Frame(String raw) {
			this.raw = raw;
		}
	}

	private final String src;
	private int pos;
	private final Deque<Frame> stack = new ArrayDeque<>();
	private final Map<String, String> ns = new HashMap<>();
	private Token pending;
	private boolean doneRoot;

	Xml(String markup) throws XmlException {
		for (int i = 0; i < markup.length();) {
			int r = markup.codePointAt(i);
			if (!xmlChar(r)) {
				throw new XmlException(String.format("U+%04X isn't an XML character", r));
			}
			i += Character.charCount(r);
		}
		src = normalizeNewlines(markup);
		ns.put("xml", XML_NAMESPACE);
	}

	static boolean xmlChar(int r) {
		return r == 0x09 || r == 0x0a || r == 0x0d || (r >= 0x20 && r <= 0xd7ff)
				|| (r >= 0xe000 && r <= 0xfffd) || (r >= 0x10000 && r <= 0x10ffff);
	}

	static boolean xmlSpace(char c) {
		return c == ' ' || c == '\t' || c == '\n' || c == '\r';
	}

	static boolean nameStart(int r) {
		return r == ':' || r == '_' || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z')
				|| (r >= 0xc0 && r <= 0xd6) || (r >= 0xd8 && r <= 0xf6) || (r >= 0xf8 && r <= 0x2ff)
				|| (r >= 0x370 && r <= 0x37d) || (r >= 0x37f && r <= 0x1fff) || (r >= 0x200c && r <= 0x200d)
				|| (r >= 0x2070 && r <= 0x218f) || (r >= 0x2c00 && r <= 0x2fef) || (r >= 0x3001 && r <= 0xd7ff)
				|| (r >= 0xf900 && r <= 0xfdcf) || (r >= 0xfdf0 && r <= 0xfffd) || (r >= 0x10000 && r <= 0xeffff);
	}

	static boolean nameChar(int r) {
		return nameStart(r) || r == '-' || r == '.' || (r >= '0' && r <= '9') || r == 0xb7
				|| (r >= 0x300 && r <= 0x36f) || (r >= 0x203f && r <= 0x2040);
	}

	private static XmlException ended() {
		return new XmlException("unexpected end of the markup");
	}

	/** The next token, or null once the document has ended properly. */
	Token token() throws XmlException {
		if (pending != null) {
			Token t = pending;
			pending = null;
			return t;
		}
		if (pos >= src.length()) {
			if (!stack.isEmpty()) {
				throw ended();
			}
			return null;
		}
		if (src.charAt(pos) != '<') {
			return text();
		}
		if (src.startsWith("</", pos)) {
			return endTag();
		}
		if (src.startsWith("<?", pos)) {
			return instruction();
		}
		if (src.startsWith("<!--", pos)) {
			return comment();
		}
		if (src.startsWith("<![CDATA[", pos)) {
			return cdata();
		}
		if (src.startsWith("<!", pos)) {
			// A directive is always refused, so there's no need to find where it ends.
			pos = src.length();
			return Token.of(Kind.DIRECTIVE);
		}
		return startTag();
	}

	/** Character data, which outside the root can only be whitespace. */
	private Token text() throws XmlException {
		StringBuilder b = new StringBuilder();
		while (pos < src.length() && src.charAt(pos) != '<') {
			char c = src.charAt(pos);
			if (c == '&') {
				if (stack.isEmpty()) {
					throw new XmlException("a character reference can't appear outside the root");
				}
				b.append(reference());
			} else if (c == ']' && src.startsWith("]]>", pos)) {
				throw new XmlException("]]> can't appear in text");
			} else {
				b.append(c);
				pos++;
			}
		}
		return new Token(Kind.TEXT, null, List.of(), b.toString());
	}

	private Token cdata() throws XmlException {
		if (stack.isEmpty()) {
			throw new XmlException("a CDATA section can't appear outside the root");
		}
		int start = pos + "<![CDATA[".length();
		int end = src.indexOf("]]>", start);
		if (end < 0) {
			throw ended();
		}
		pos = end + 3;
		return new Token(Kind.TEXT, null, List.of(), src.substring(start, end));
	}

	private Token comment() throws XmlException {
		int start = pos + "<!--".length();
		int end = src.indexOf("--", start);
		if (end < 0) {
			throw ended();
		}
		if (!src.startsWith("-->", end)) {
			throw new XmlException("\"--\" can't appear in a comment");
		}
		pos = end + 3;
		return Token.of(Kind.OTHER);
	}

	private Token instruction() throws XmlException {
		int begin = pos;
		pos += 2;
		String target;
		try {
			target = name();
		} catch (XmlException e) {
			throw new XmlException("expected a target after <?");
		}
		int end = src.indexOf("?>", pos);
		if (end < 0) {
			throw ended();
		}
		String data = src.substring(pos, end);
		if (!data.isEmpty() && !xmlSpace(data.charAt(0))) {
			throw new XmlException("a processing instruction's target needs a space after it");
		}
		pos = end + 2;
		if (target.equalsIgnoreCase("xml")) {
			if (begin != 0 || !target.equals("xml")) {
				throw new XmlException("an XML declaration can only come first");
			}
			checkDeclaration(data);
		} else if (target.contains(":")) {
			throw new XmlException("a processing instruction's target can't have a colon");
		}
		return Token.of(Kind.OTHER);
	}

	/**
	 * Reads {@code version="1.0" encoding="UTF-8" standalone="yes"}, of which only the version is
	 * required, in that order.
	 */
	private static void checkDeclaration(String data) throws XmlException {
		int[] pos = {0};
		String version = field(data, pos, "version");
		if (version == null) {
			throw bad();
		}
		if (!version.equals("1.0")) {
			throw new XmlException("unsupported XML version \"" + version + "\"; only 1.0 is");
		}
		String encoding = field(data, pos, "encoding");
		if (encoding != null && !encoding.equalsIgnoreCase("utf-8")) {
			throw new XmlException("unsupported encoding \"" + encoding + "\"; only UTF-8 is");
		}
		String standalone = field(data, pos, "standalone");
		if (standalone != null && !standalone.equals("yes") && !standalone.equals("no")) {
			throw bad();
		}
		for (int i = pos[0]; i < data.length(); i++) {
			if (!xmlSpace(data.charAt(i))) {
				throw bad();
			}
		}
	}

	private static XmlException bad() {
		return new XmlException("malformed XML declaration");
	}

	/** One field of a declaration, or null if the next isn't that one. */
	private static String field(String data, int[] pos, String key) throws XmlException {
		int i = pos[0];
		while (i < data.length() && xmlSpace(data.charAt(i))) {
			i++;
		}
		if (i == pos[0] || !data.startsWith(key, i)) {
			return null;
		}
		i += key.length();
		while (i < data.length() && xmlSpace(data.charAt(i))) {
			i++;
		}
		if (i >= data.length() || data.charAt(i) != '=') {
			throw bad();
		}
		i++;
		while (i < data.length() && xmlSpace(data.charAt(i))) {
			i++;
		}
		if (i >= data.length() || (data.charAt(i) != '"' && data.charAt(i) != '\'')) {
			throw bad();
		}
		int end = data.indexOf(data.charAt(i), i + 1);
		if (end < 0) {
			throw bad();
		}
		pos[0] = end + 1;
		return data.substring(i + 1, end);
	}

	/** An XML 1.0 Name. */
	private String name() throws XmlException {
		int start = pos;
		while (pos < src.length()) {
			int r = src.codePointAt(pos);
			if (pos == start ? !nameStart(r) : !nameChar(r)) {
				break;
			}
			pos += Character.charCount(r);
		}
		if (pos == start) {
			throw new XmlException("expected a name");
		}
		return src.substring(start, pos);
	}

	private boolean space() {
		int start = pos;
		while (pos < src.length() && xmlSpace(src.charAt(pos))) {
			pos++;
		}
		return pos > start;
	}

	/** Divides a name at its colon, of which it can have one, between two parts. */
	private static String[] splitQName(String raw) throws XmlException {
		int colon = raw.indexOf(':');
		if (colon < 0) {
			return new String[] {"", raw};
		}
		String before = raw.substring(0, colon);
		String after = raw.substring(colon + 1);
		if (before.isEmpty() || after.isEmpty() || after.indexOf(':') >= 0 || !nameStart(after.codePointAt(0))) {
			throw new XmlException("\"" + raw + "\" isn't a valid qualified name");
		}
		return new String[] {before, after};
	}

	private Token endTag() throws XmlException {
		pos += 2;
		String raw;
		try {
			raw = name();
		} catch (XmlException e) {
			throw new XmlException("expected a name after </");
		}
		space();
		if (pos >= src.length()) {
			throw ended();
		}
		if (src.charAt(pos) != '>') {
			throw new XmlException("unexpected characters in </" + raw + ">");
		}
		pos++;
		if (stack.isEmpty()) {
			throw new XmlException("</" + raw + "> closes nothing");
		}
		Frame top = stack.peek();
		if (!top.raw.equals(raw)) {
			throw new XmlException("<" + top.raw + "> is closed by </" + raw + ">");
		}
		return closeElement();
	}

	private Token closeElement() {
		Frame top = stack.pop();
		for (int i = top.undo.size() - 1; i >= 0; i--) {
			String[] u = top.undo.get(i);
			if (u[1] != null) {
				ns.put(u[0], u[1]);
			} else {
				ns.remove(u[0]);
			}
		}
		if (stack.isEmpty()) {
			doneRoot = true;
		}
		return new Token(Kind.END, top.name, List.of(), "");
	}

	private Token startTag() throws XmlException {
		pos++;
		String raw;
		try {
			raw = name();
		} catch (XmlException e) {
			throw new XmlException("expected a name after <");
		}
		if (doneRoot) {
			throw new XmlException("markup can only have one root element");
		}
		List<String[]> attrs = new ArrayList<>();
		Set<String> seen = new HashSet<>();
		boolean selfClosing = false;
		while (true) {
			boolean spaced = space();
			if (pos >= src.length()) {
				throw ended();
			}
			char c = src.charAt(pos);
			if (c == '>') {
				pos++;
				break;
			}
			if (c == '/') {
				if (!src.startsWith("/>", pos)) {
					throw new XmlException("expected /> in an element");
				}
				pos += 2;
				selfClosing = true;
				break;
			}
			if (!spaced) {
				throw new XmlException("<" + raw + "> needs a space before each attribute");
			}
			String name;
			try {
				name = name();
			} catch (XmlException e) {
				throw new XmlException("expected an attribute name in <" + raw + ">");
			}
			if (!seen.add(name)) {
				throw new XmlException("attribute \"" + name + "\" is repeated");
			}
			space();
			if (pos >= src.length() || src.charAt(pos) != '=') {
				throw new XmlException("attribute \"" + name + "\" has no value");
			}
			pos++;
			space();
			attrs.add(new String[] {name, attrValue()});
		}
		Frame frame = new Frame(raw);
		// Declarations apply to the element they're on, so they're read first.
		for (String[] a : attrs) {
			declare(a[0], a[1], frame);
		}
		String[] q = splitQName(raw);
		if (q[0].equals("xmlns")) {
			throw new XmlException("an element can't use the xmlns prefix");
		}
		String space = ns.getOrDefault(q[0], "");
		if (!q[0].isEmpty() && space.isEmpty()) {
			throw new XmlException("prefix \"" + q[0] + "\" isn't declared");
		}
		frame.name = new Name(space, q[1]);
		Set<Name> expanded = new HashSet<>();
		List<Attr> out = new ArrayList<>();
		for (String[] a : attrs) {
			if (a[0].equals("xmlns") || a[0].startsWith("xmlns:")) {
				continue;
			}
			String[] aq = splitQName(a[0]);
			String aspace = "";
			if (!aq[0].isEmpty()) {
				aspace = ns.getOrDefault(aq[0], "");
				if (aspace.isEmpty()) {
					throw new XmlException("prefix \"" + aq[0] + "\" isn't declared");
				}
			}
			Name name = new Name(aspace, aq[1]);
			if (!expanded.add(name)) {
				throw new XmlException("attribute \"" + a[0] + "\" is repeated");
			}
			out.add(new Attr(name, a[1]));
		}
		stack.push(frame);
		Token tok = new Token(Kind.START, frame.name, out, "");
		if (selfClosing) {
			pending = closeElement();
		}
		return tok;
	}

	/** Applies a namespace declaration, if an attribute is one. */
	private void declare(String name, String value, Frame frame) throws XmlException {
		String prefix = "";
		if (name.equals("xmlns")) {
			// The default namespace.
		} else if (name.startsWith("xmlns:")) {
			prefix = name.substring("xmlns:".length());
			splitQName(name);
			if (prefix.equals("xmlns")) {
				throw new XmlException("the xmlns prefix can't be declared");
			}
			if (value.isEmpty()) {
				throw new XmlException("prefix \"" + prefix + "\" can't be undeclared");
			}
		} else {
			return;
		}
		if (prefix.equals("xml") != value.equals(XML_NAMESPACE) || value.equals(XMLNS_NAMESPACE)) {
			throw new XmlException("namespace \"" + value + "\" can't be bound to that prefix");
		}
		frame.undo.add(new String[] {prefix, ns.get(prefix)});
		ns.put(prefix, value);
	}

	/** A quoted value, with literal whitespace turned into spaces as XML says. */
	private String attrValue() throws XmlException {
		if (pos >= src.length() || (src.charAt(pos) != '"' && src.charAt(pos) != '\'')) {
			throw new XmlException("an attribute's value needs quotes");
		}
		char quote = src.charAt(pos++);
		StringBuilder b = new StringBuilder();
		while (true) {
			if (pos >= src.length()) {
				throw ended();
			}
			char c = src.charAt(pos);
			if (c == quote) {
				pos++;
				return b.toString();
			}
			switch (c) {
				case '<':
					throw new XmlException("< can't appear in an attribute's value");
				case '&':
					b.append(reference());
					break;
				case '\t':
				case '\n':
				case '\r':
					b.append(' ');
					pos++;
					break;
				default:
					b.append(c);
					pos++;
			}
		}
	}

	/** One of XML's five named entities, or a reference to a character. */
	private String reference() throws XmlException {
		int end = src.indexOf(';', pos);
		if (end < 0) {
			throw new XmlException("& needs to begin a reference ending in ;");
		}
		String body = src.substring(pos + 1, end);
		pos = end + 1;
		switch (body) {
			case "lt":
				return "<";
			case "gt":
				return ">";
			case "amp":
				return "&";
			case "apos":
				return "'";
			case "quot":
				return "\"";
			default:
				break;
		}
		String digits;
		int base;
		if (body.startsWith("#x")) {
			digits = body.substring(2);
			base = 16;
		} else if (body.startsWith("#")) {
			digits = body.substring(1);
			base = 10;
		} else {
			throw new XmlException("unknown entity &" + body + ";");
		}
		long v = 0;
		boolean ok = !digits.isEmpty();
		for (int i = 0; ok && i < digits.length(); i++) {
			int d = Character.digit(digits.charAt(i), base);
			if (d < 0 || digits.charAt(i) > 0x7f) {
				ok = false;
			} else {
				v = v * base + d;
				ok = v <= 0x10ffff;
			}
		}
		if (!ok || !xmlChar((int) v)) {
			throw new XmlException("invalid reference &" + body + ";");
		}
		return new String(Character.toChars((int) v));
	}

	/** Turns CRLF and lone CR into LF. */
	static String normalizeNewlines(String s) {
		if (s.indexOf('\r') < 0) {
			return s;
		}
		return s.replace("\r\n", "\n").replace('\r', '\n');
	}

	/**
	 * Escapes text for an attribute's value or an element's text, as Go's xml.EscapeText does and
	 * SDK section 4.2 says, so that tabs and line endings in a value survive being read again.
	 */
	static String escape(String s) {
		StringBuilder b = null;
		for (int i = 0; i < s.length(); i++) {
			char c = s.charAt(i);
			String r;
			switch (c) {
				case '&':
					r = "&amp;";
					break;
				case '<':
					r = "&lt;";
					break;
				case '>':
					r = "&gt;";
					break;
				case '"':
					r = "&#34;";
					break;
				case '\'':
					r = "&#39;";
					break;
				case '\t':
					r = "&#x9;";
					break;
				case '\n':
					r = "&#xA;";
					break;
				case '\r':
					r = "&#xD;";
					break;
				default:
					r = null;
			}
			if (r == null && Character.isSurrogate(c)) {
				boolean pair = Character.isHighSurrogate(c) && i + 1 < s.length() && Character.isLowSurrogate(s.charAt(i + 1));
				if (pair) {
					if (b != null) {
						b.append(c).append(s.charAt(i + 1));
					}
					i++;
					continue;
				}
				r = "�";
			} else if (r == null && !xmlChar(c)) {
				r = "�";
			}
			if (r == null) {
				if (b != null) {
					b.append(c);
				}
				continue;
			}
			if (b == null) {
				b = new StringBuilder(s.length() + 16);
				b.append(s, 0, i);
			}
			b.append(r);
		}
		return b == null ? s : b.toString();
	}
}
