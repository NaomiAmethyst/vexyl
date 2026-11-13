// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A KDL v2 parser, written to the grammar in the KDL 2.0.0 specification. It keeps what Vexyl
 * needs: where each node and value is, whether a value had a type annotation, and how a string
 * was written.
 */
final class Kdl {
	private Kdl() {}

	/** A document that isn't KDL v2, at the offset where the parser gave up. */
	static final class SyntaxError extends Exception {
		private static final long serialVersionUID = 1L;
		final int offset;

		SyntaxError(String message, int offset) {
			super(message);
			this.offset = offset;
		}
	}

	enum Kind { STRING, NUMBER, BOOL, NULL }

	/** An argument or a property's value. */
	static final class Value {
		final Kind kind;
		final String string;
		final double number;
		final boolean bool;
		/** A string written without quotes. */
		final boolean bare;
		final boolean annotated;
		final int offset;

		Value(Kind kind, String string, double number, boolean bool, boolean bare, boolean annotated, int offset) {
			this.kind = kind;
			this.string = string;
			this.number = number;
			this.bool = bool;
			this.bare = bare;
			this.annotated = annotated;
			this.offset = offset;
		}

		boolean isString() {
			return kind == Kind.STRING;
		}
	}

	static final class Node {
		String name;
		boolean annotated;
		/** Where it starts, and just past its last character. */
		int start, end;
		final List<Value> args = new ArrayList<>();
		final Map<String, Value> props = new LinkedHashMap<>();
		/** Properties given more than once, which KDL would let the last of win. */
		final List<String> repeatedProps = new ArrayList<>();
		final List<Node> children = new ArrayList<>();

		Value prop(String key) {
			return props.get(key);
		}
	}

	static List<Node> parse(String src) throws SyntaxError {
		return new Reader(src).document();
	}

	/** Whether a code point is one of KDL's newlines, counting CR LF as one at the CR. */
	static boolean isNewline(int c) {
		return c == '\n' || c == '\r' || c == 0x85 || c == 0x0B || c == 0x0C || c == 0x2028 || c == 0x2029;
	}

	static boolean isSpace(int c) {
		return c == '\t' || c == ' ' || c == 0xA0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200A)
				|| c == 0x202F || c == 0x205F || c == 0x3000;
	}

	/** Code points that can't be anywhere in a document, not even in a comment. */
	static boolean disallowed(int c) {
		return (c <= 0x08) || (c >= 0x0E && c <= 0x1F) || c == 0x7F || (c >= 0xD800 && c <= 0xDFFF)
				|| c == 0x200E || c == 0x200F || (c >= 0x202A && c <= 0x202E) || (c >= 0x2066 && c <= 0x2069)
				|| c == 0xFEFF;
	}

	static boolean identifierChar(int c) {
		if (isSpace(c) || isNewline(c) || disallowed(c)) {
			return false;
		}
		return "\\/(){};[]\"#=".indexOf(c) < 0;
	}

	private static final class Reader {
		private final String s;
		private int pos;

		Reader(String s) {
			this.s = s;
		}

		private SyntaxError error(String message) {
			return new SyntaxError(message, pos);
		}

		private boolean eof() {
			return pos >= s.length();
		}

		private int peek() {
			return pos < s.length() ? s.codePointAt(pos) : -1;
		}

		private int peekAt(int at) {
			return at < s.length() ? s.codePointAt(at) : -1;
		}

		private boolean at(String text) {
			return s.startsWith(text, pos);
		}

		private void advance() {
			pos += Character.charCount(s.codePointAt(pos));
		}

		List<Node> document() throws SyntaxError {
			for (int i = 0; i < s.length(); ) {
				int c = s.codePointAt(i);
				if (disallowed(c) && !(c == 0xFEFF && i == 0)) {
					pos = i;
					throw error(String.format("U+%04X can't be in a KDL document", c));
				}
				i += Character.charCount(c);
			}
			if (at("﻿")) {
				pos++;
			}
			List<Node> nodes = nodes(false);
			if (!eof()) {
				throw error("unexpected `" + new String(Character.toChars(peek())) + "`");
			}
			return nodes;
		}

		private List<Node> nodes(boolean inChildren) throws SyntaxError {
			List<Node> nodes = new ArrayList<>();
			while (true) {
				lineSpace();
				if (eof()) {
					if (inChildren) {
						throw error("a `{` is never closed");
					}
					return nodes;
				}
				if (peek() == '}') {
					if (inChildren) {
						return nodes;
					}
					throw error("a `}` closes nothing");
				}
				if (at("/-")) {
					pos += 2;
					lineSpace();
					node(inChildren);
					continue;
				}
				nodes.add(node(inChildren));
			}
		}

		/** Skips whitespace, newlines and comments, as KDL's line-space does. */
		private void lineSpace() throws SyntaxError {
			while (!eof()) {
				if (nodeSpace()) {
					continue;
				}
				int c = peek();
				if (isNewline(c)) {
					newline();
				} else if (at("//")) {
					lineComment();
				} else {
					return;
				}
			}
		}

		private void newline() {
			if (at("\r\n")) {
				pos += 2;
			} else {
				advance();
			}
		}

		private void lineComment() {
			while (!eof() && !isNewline(peek())) {
				advance();
			}
		}

		private void blockComment() throws SyntaxError {
			int start = pos;
			pos += 2;
			int depth = 1;
			while (depth > 0) {
				if (eof()) {
					pos = start;
					throw error("a `/*` comment is never closed");
				}
				if (at("/*")) {
					depth++;
					pos += 2;
				} else if (at("*/")) {
					depth--;
					pos += 2;
				} else {
					advance();
				}
			}
		}

		/** Skips node-space, which is whitespace, block comments and escaped newlines. */
		private boolean nodeSpace() throws SyntaxError {
			int was = pos;
			while (!eof()) {
				int c = peek();
				if (isSpace(c)) {
					advance();
				} else if (at("/*")) {
					blockComment();
				} else if (c == '\\') {
					int back = pos;
					pos++;
					while (!eof() && (isSpace(peek()) || at("/*"))) {
						if (at("/*")) {
							blockComment();
						} else {
							advance();
						}
					}
					if (at("//")) {
						lineComment();
						if (!eof()) {
							newline();
						}
					} else if (!eof() && isNewline(peek())) {
						newline();
					} else if (!eof()) {
						pos = back;
						throw error("a `\\` outside a string has to end its line");
					}
				} else {
					break;
				}
			}
			return pos > was;
		}

		private Node node(boolean inChildren) throws SyntaxError {
			Node n = new Node();
			n.start = pos;
			if (peek() == '(') {
				annotation();
				n.annotated = true;
				nodeSpace();
			}
			Value name = string();
			if (name == null) {
				throw error("expected a node's name");
			}
			n.name = name.string;
			n.end = pos;
			boolean childrenDone = false;
			while (true) {
				boolean spaced = nodeSpace();
				if (eof()) {
					return n;
				}
				int c = peek();
				if (isNewline(c) || c == ';' || at("//")) {
					if (c == ';') {
						pos++;
					}
					return n;
				}
				if (c == '}') {
					if (!inChildren) {
						throw error("a `}` closes nothing");
					}
					return n;
				}
				if (at("/-")) {
					pos += 2;
					lineSpace();
					if (peek() == '{') {
						children(new Node(), inChildren);
					} else if (childrenDone) {
						throw error("nothing but children can follow a node's children");
					} else {
						entry(new Node());
					}
					continue;
				}
				if (c == '{') {
					if (childrenDone) {
						throw error("a node has one block of children");
					}
					children(n, inChildren);
					n.end = pos;
					childrenDone = true;
					continue;
				}
				if (childrenDone) {
					throw error("nothing but children can follow a node's children");
				}
				if (!spaced) {
					throw error("expected a space");
				}
				entry(n);
				n.end = pos;
			}
		}

		private void children(Node n, boolean inChildren) throws SyntaxError {
			pos++;
			n.children.addAll(nodes(true));
			pos++;
		}

		private void annotation() throws SyntaxError {
			pos++;
			nodeSpace();
			if (string() == null) {
				throw error("expected a type in the annotation");
			}
			nodeSpace();
			if (peek() != ')') {
				throw error("expected `)`");
			}
			pos++;
		}

		/** Reads an argument or a property into n. */
		private void entry(Node n) throws SyntaxError {
			int start = pos;
			boolean annotated = false;
			if (peek() == '(') {
				annotation();
				annotated = true;
				nodeSpace();
			}
			Value v = value(annotated, start);
			if (v.kind == Kind.STRING && !annotated) {
				int back = pos;
				nodeSpace();
				if (peek() == '=') {
					pos++;
					nodeSpace();
					int valueStart = pos;
					boolean valueAnnotated = false;
					if (peek() == '(') {
						annotation();
						valueAnnotated = true;
						nodeSpace();
					}
					Value value = value(valueAnnotated, valueStart);
					if (n.props.containsKey(v.string)) {
						n.repeatedProps.add(v.string);
						n.props.remove(v.string);
					}
					n.props.put(v.string, value);
					return;
				}
				pos = back;
			} else if (peek() == '=' || lookAheadEquals()) {
				throw error("a property's name has to be a string, without a type");
			}
			n.args.add(v);
		}

		private boolean lookAheadEquals() throws SyntaxError {
			int back = pos;
			nodeSpace();
			boolean equals = peek() == '=';
			pos = back;
			return equals;
		}

		private Value value(boolean annotated, int start) throws SyntaxError {
			int c = peek();
			int at = pos;
			if (c == '#' && peekAt(pos + 1) != '"' && peekAt(pos + 1) != '#') {
				return keyword(annotated, start);
			}
			if (c >= '0' && c <= '9' || ((c == '+' || c == '-') && isDigit(peekAt(pos + 1)))) {
				return number(annotated, start);
			}
			Value v = string();
			if (v == null) {
				pos = at;
				throw error("expected a value");
			}
			return new Value(Kind.STRING, v.string, 0, false, v.bare, annotated, start);
		}

		private static boolean isDigit(int c) {
			return c >= '0' && c <= '9';
		}

		private void delimited() throws SyntaxError {
			if (!eof() && identifierChar(peek())) {
				throw error("unexpected `" + new String(Character.toChars(peek())) + "` after a value");
			}
		}

		private Value keyword(boolean annotated, int start) throws SyntaxError {
			int from = pos;
			pos++;
			while (!eof() && identifierChar(peek())) {
				advance();
			}
			String word = s.substring(from, pos);
			switch (word) {
			case "#true":
				return new Value(Kind.BOOL, null, 0, true, false, annotated, start);
			case "#false":
				return new Value(Kind.BOOL, null, 0, false, false, annotated, start);
			case "#null":
				return new Value(Kind.NULL, null, 0, false, false, annotated, start);
			case "#inf":
				return new Value(Kind.NUMBER, null, Double.POSITIVE_INFINITY, false, false, annotated, start);
			case "#-inf":
				return new Value(Kind.NUMBER, null, Double.NEGATIVE_INFINITY, false, false, annotated, start);
			case "#nan":
				return new Value(Kind.NUMBER, null, Double.NaN, false, false, annotated, start);
			default:
				pos = from;
				throw error("unknown keyword `" + word + "`");
			}
		}

		private Value number(boolean annotated, int start) throws SyntaxError {
			int from = pos;
			boolean negative = false;
			if (peek() == '+' || peek() == '-') {
				negative = peek() == '-';
				pos++;
			}
			int radix = 10;
			if (at("0x")) {
				radix = 16;
			} else if (at("0o")) {
				radix = 8;
			} else if (at("0b")) {
				radix = 2;
			}
			double value;
			if (radix != 10) {
				pos += 2;
				int digitsFrom = pos;
				if (Character.digit(peek(), radix) < 0) {
					throw error("expected a digit");
				}
				while (!eof() && (Character.digit(peek(), radix) >= 0 || peek() == '_')) {
					pos++;
				}
				BigInteger whole = new BigInteger(s.substring(digitsFrom, pos).replace("_", ""), radix);
				value = (negative ? whole.negate() : whole).doubleValue();
			} else {
				digits();
				if (peek() == '.') {
					pos++;
					if (!isDigit(peek())) {
						throw error("expected a digit after `.`");
					}
					digits();
				}
				if (peek() == 'e' || peek() == 'E') {
					pos++;
					if (peek() == '+' || peek() == '-') {
						pos++;
					}
					if (!isDigit(peek())) {
						throw error("expected an exponent");
					}
					digits();
				}
				String text = s.substring(from, pos).replace("_", "");
				value = Double.parseDouble(text);
				// A value too small to hold isn't zero, so it's kept as the smallest there is, which
				// is still beyond the format's limits.
				if (value == 0 && new BigDecimal(text).signum() != 0) {
					value = negative ? -Double.MIN_VALUE : Double.MIN_VALUE;
				}
			}
			delimited();
			return new Value(Kind.NUMBER, null, value, false, false, annotated, start);
		}

		private void digits() {
			while (!eof() && (isDigit(peek()) || peek() == '_')) {
				pos++;
			}
		}

		/** Reads a string in any of its forms, or gives null if none starts here. */
		private Value string() throws SyntaxError {
			int start = pos;
			int c = peek();
			if (c == '"') {
				return new Value(Kind.STRING, quoted(), 0, false, false, false, start);
			}
			if (c == '#' && (peekAt(pos + 1) == '"' || peekAt(pos + 1) == '#')) {
				return new Value(Kind.STRING, raw(), 0, false, false, false, start);
			}
			if (c < 0 || !identifierChar(c)) {
				return null;
			}
			if (isDigit(c)) {
				throw error("a bare string can't start with a digit");
			}
			if ((c == '+' || c == '-') && (isDigit(peekAt(pos + 1))
					|| (peekAt(pos + 1) == '.' && isDigit(peekAt(pos + 2))))) {
				throw error("a bare string can't look like a number");
			}
			if (c == '.' && isDigit(peekAt(pos + 1))) {
				throw error("a bare string can't look like a number");
			}
			while (!eof() && identifierChar(peek())) {
				advance();
			}
			String word = s.substring(start, pos);
			switch (word) {
			case "true": case "false": case "null": case "inf": case "-inf": case "nan":
				pos = start;
				throw error("`" + word + "` has to be quoted to be a string, or written `#" + word + "`");
			default:
				return new Value(Kind.STRING, word, 0, false, true, false, start);
			}
		}

		private String quoted() throws SyntaxError {
			if (at("\"\"\"")) {
				int start = pos;
				pos += 3;
				if (eof() || !isNewline(peek())) {
					throw error("a multi-line string starts a new line after its `\"\"\"`");
				}
				int bodyStart = pos;
				while (true) {
					if (eof()) {
						pos = start;
						throw error("a string is never closed");
					}
					if (peek() == '\\') {
						pos++;
						if (!eof()) {
							advance();
						}
					} else if (at("\"\"\"")) {
						break;
					} else {
						advance();
					}
				}
				String body = s.substring(bodyStart, pos);
				pos += 3;
				return unescape(dedent(body, start), start);
			}
			int start = pos;
			pos++;
			while (true) {
				if (eof()) {
					pos = start;
					throw error("a string is never closed");
				}
				int c = peek();
				if (c == '\\') {
					pos++;
					if (!eof()) {
						advance();
					}
				} else if (c == '"') {
					break;
				} else if (isNewline(c)) {
					throw error("a string on one line can't hold a newline; use `\"\"\"`");
				} else {
					advance();
				}
			}
			String body = s.substring(start + 1, pos);
			pos++;
			return unescape(body, start + 1);
		}

		private String raw() throws SyntaxError {
			int start = pos;
			int hashes = 0;
			while (peek() == '#') {
				hashes++;
				pos++;
			}
			String close = "\"" + "#".repeat(hashes);
			boolean multi = at("\"\"\"");
			if (multi) {
				pos += 3;
				if (eof() || !isNewline(peek())) {
					throw error("a multi-line string starts a new line after its `\"\"\"`");
				}
				close = "\"\"\"" + "#".repeat(hashes);
			} else {
				pos++;
			}
			int bodyStart = pos;
			int end = s.indexOf(close, pos);
			if (end < 0) {
				pos = start;
				throw error("a raw string is never closed");
			}
			String body = s.substring(bodyStart, end);
			pos = end + close.length();
			if (multi) {
				return dedent(body, start);
			}
			for (int i = 0; i < body.length(); i++) {
				if (isNewline(body.charAt(i))) {
					pos = bodyStart + i;
					throw error("a raw string on one line can't hold a newline");
				}
			}
			return body;
		}

		/**
		 * Removes a multi-line string's indentation, which is whatever is before its closing quotes,
		 * from each of its lines. KDL does this before it resolves escapes.
		 */
		private String dedent(String body, int start) throws SyntaxError {
			List<String> lines = new ArrayList<>();
			int from = 0;
			for (int i = 0; i < body.length(); ) {
				int c = body.codePointAt(i);
				if (isNewline(c)) {
					lines.add(body.substring(from, i));
					i += body.startsWith("\r\n", i) ? 2 : Character.charCount(c);
					from = i;
				} else {
					i += Character.charCount(c);
				}
			}
			lines.add(body.substring(from));
			String prefix = lines.get(lines.size() - 1);
			if (!blank(prefix)) {
				pos = start;
				throw error("a multi-line string's closing `\"\"\"` has to be on a line of its own");
			}
			StringBuilder out = new StringBuilder();
			for (int i = 1; i < lines.size() - 1; i++) {
				String line = lines.get(i);
				if (i > 1) {
					out.append('\n');
				}
				if (blank(line)) {
					continue;
				}
				if (!line.startsWith(prefix)) {
					pos = start;
					throw error("each line of a multi-line string has to start with the indentation of its last");
				}
				out.append(line, prefix.length(), line.length());
			}
			return out.toString();
		}

		private static boolean blank(String text) {
			return text.codePoints().allMatch(Kdl::isSpace);
		}

		private String unescape(String body, int start) throws SyntaxError {
			if (body.indexOf('\\') < 0) {
				return body;
			}
			StringBuilder out = new StringBuilder();
			for (int i = 0; i < body.length(); ) {
				char c = body.charAt(i);
				if (c != '\\') {
					out.append(c);
					i++;
					continue;
				}
				if (i + 1 >= body.length()) {
					pos = start;
					throw error("a string ends in the middle of an escape");
				}
				int e = body.codePointAt(i + 1);
				switch (e) {
				case 'n': out.append('\n'); i += 2; continue;
				case 'r': out.append('\r'); i += 2; continue;
				case 't': out.append('\t'); i += 2; continue;
				case '\\': out.append('\\'); i += 2; continue;
				case '"': out.append('"'); i += 2; continue;
				case 'b': out.append('\b'); i += 2; continue;
				case 'f': out.append('\f'); i += 2; continue;
				case 's': out.append(' '); i += 2; continue;
				case 'u': {
					int close = body.indexOf('}', i);
					if (i + 2 >= body.length() || body.charAt(i + 2) != '{' || close < 0 || close - (i + 3) < 1 || close - (i + 3) > 6) {
						pos = start;
						throw error("a `\\u` escape is written `\\u{` and 1 to 6 hexadecimal digits `}`");
					}
					String hex = body.substring(i + 3, close);
					int code;
					try {
						code = Integer.parseInt(hex, 16);
					} catch (NumberFormatException ex) {
						pos = start;
						throw error("a `\\u` escape is written `\\u{` and 1 to 6 hexadecimal digits `}`");
					}
					if (!hex.chars().allMatch(h -> Character.digit(h, 16) >= 0) || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) {
						pos = start;
						throw error("a `\\u` escape has to be a Unicode scalar value");
					}
					out.appendCodePoint(code);
					i = close + 1;
					continue;
				}
				default:
					if (isSpace(e) || isNewline(e)) {
						i++;
						while (i < body.length() && (isSpace(body.codePointAt(i)) || isNewline(body.codePointAt(i)))) {
							i += Character.charCount(body.codePointAt(i));
						}
						continue;
					}
					pos = start;
					throw error("unknown escape `\\" + new String(Character.toChars(e)) + "`");
				}
			}
			return out.toString();
		}
	}
}
