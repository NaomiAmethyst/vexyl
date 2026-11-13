// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.util.List;

/**
 * An element of a rendered SVG document, for code that wants to change or embed one.
 *
 * @param name its name, with any prefix, as it's written
 * @param attrs its attributes, in order
 * @param text what's inside a {@code title} or {@code desc}, the only elements that hold any, or
 *     the empty string
 * @param children its child elements, in order
 */
public record Element(String name, List<Attribute> attrs, String text, List<Element> children) {
	public Element {
		attrs = List.copyOf(attrs);
		children = List.copyOf(children);
		text = text == null ? "" : text;
	}

	/** An attribute of an element, as it's written in the document. */
	public record Attribute(String name, String value) {}

	/** The value of an attribute, or null if it has none of that name. */
	public String attr(String name) {
		for (Attribute a : attrs) {
			if (a.name().equals(name)) {
				return a.value();
			}
		}
		return null;
	}

	/** Writes the element out as XML, which draws the same as {@link Flag#svg}. */
	@Override
	public String toString() {
		StringBuilder b = new StringBuilder();
		write(b);
		return b.toString();
	}

	private void write(StringBuilder b) {
		b.append('<').append(name);
		for (Attribute a : attrs) {
			b.append(' ').append(a.name()).append("=\"").append(Xml.escape(a.value())).append('"');
		}
		if (text.isEmpty() && children.isEmpty()) {
			b.append("/>");
			return;
		}
		b.append('>').append(Xml.escape(text));
		for (Element c : children) {
			c.write(b);
		}
		b.append("</").append(name).append('>');
	}
}
