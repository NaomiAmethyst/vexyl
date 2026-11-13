// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.util.List;
import java.util.Map;

/**
 * A parsed and valid Vexyl document. It never changes, rendering included, so one flag can be
 * rendered with many options, from many threads at once.
 */
public final class Flag {
	final Model.Doc doc;

	Flag(Model.Doc doc) {
		this.doc = doc;
	}

	/** The flag's name, from its {@code meta}. */
	public String name() {
		return doc.meta.name;
	}

	/** The flag's proportion, which is also its grid: its height. */
	public double hoist() {
		return doc.hoist;
	}

	/** The flag's proportion, which is also its grid: its width. */
	public double fly() {
		return doc.fly;
	}

	/** The names of the flag's variants, in document order. */
	public List<String> variants() {
		return List.copyOf(doc.variants.keySet());
	}

	/** The names of the flag's folds, in document order. */
	public List<String> folds() {
		return List.copyOf(doc.folds.keySet());
	}

	/**
	 * The flag as plain data, in the canonical form of section 4 of the SDK: maps with string keys,
	 * lists, strings, doubles and booleans, none of which can be changed.
	 */
	public Map<String, Object> model() {
		return Canonical.model(doc);
	}

	/**
	 * Renders the flag as an SVG document.
	 *
	 * @throws VexylException if an option can't be used, or the flag can't be drawn as asked
	 */
	public String svg(RenderOptions options) throws VexylException {
		throw new VexylException("rendering isn't written yet");
	}

	/**
	 * Renders the flag as a tree of SVG elements, which writes out as a document that draws the
	 * same as {@link #svg}. Only a {@code title} or {@code desc} holds any text.
	 *
	 * @throws VexylException if an option can't be used, or the flag can't be drawn as asked
	 */
	public Element svgTree(RenderOptions options) throws VexylException {
		throw new VexylException("rendering isn't written yet");
	}

	/** The canonical model as JSON, as the conformance suite compares it. */
	public String modelJson() {
		return Json.write(model(), true);
	}
}
