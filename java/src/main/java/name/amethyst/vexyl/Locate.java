// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import name.amethyst.vexyl.Kdl.Node;

/** Finds where each layer and other part of a document is, from its syntax alone. */
final class Locate {
	private Locate() {}

	static final Set<String> LAYER_NAMES = Set.of("field", "bars", "chevrons", "band", "cross", "saltire",
			"quarters", "checks", "rays", "pile", "pall", "charge", "emblem", "group", "panel", "canton", "use");
	private static final Set<String> HOLDS_LAYERS = Set.of("emblem", "group", "panel", "canton");

	/** Writes a name in a path, where a slash separates the parts. */
	static String encodeName(String name) {
		return name.replace("%", "%25").replace("/", "%2F");
	}

	static String decodeName(String part) {
		return part.replace("%2F", "/").replace("%25", "%");
	}

	/** The path of what holds a layer, or "" if it's at the top of its scope. */
	static String parentPath(String path) {
		int dot = path.lastIndexOf('.');
		if (dot > path.lastIndexOf('/')) {
			return path.substring(0, dot);
		}
		return "";
	}

	static List<Span> locate(String text) {
		String src = Parser.normalizeNewlines(text);
		List<Node> doc;
		try {
			doc = Kdl.parse(src);
		} catch (Kdl.SyntaxError e) {
			return List.of();
		}
		List<Span> spans = new ArrayList<>();
		int index = 0;
		for (Node n : doc) {
			String name = n.name;
			if (LAYER_NAMES.contains(name)) {
				String path = Integer.toString(index++);
				add(spans, src, n, path);
				if (HOLDS_LAYERS.contains(name)) {
					layers(spans, src, n.children, path + ".");
				}
			} else if (name.equals("palette")) {
				add(spans, src, n, name);
				for (Node c : n.children) {
					add(spans, src, c, "palette/" + encodeName(c.name));
				}
			} else if (name.equals("define") || name.equals("fold")) {
				String path = named(n, name);
				if (path != null) {
					add(spans, src, n, path);
					if (name.equals("define")) {
						layers(spans, src, n.children, path + "/");
					}
				}
			} else if (name.equals("variant")) {
				String path = named(n, name);
				if (path != null) {
					add(spans, src, n, path);
					layers(spans, src, n.children, path + "/");
					for (Node c : n.children) {
						if (c.name.equals("outline") || c.name.equals("border")) {
							add(spans, src, c, path + "/" + c.name);
						}
					}
				}
			} else if (name.equals("reverse")) {
				add(spans, src, n, name);
				layers(spans, src, n.children, "reverse/");
			} else {
				add(spans, src, n, name);
			}
		}
		return spans;
	}

	private static String named(Node n, String kind) {
		if (n.args.isEmpty() || !n.args.get(0).isString()) {
			return null;
		}
		return kind + "/" + encodeName(n.args.get(0).string);
	}

	private static void layers(List<Span> spans, String src, List<Node> list, String base) {
		int i = 0;
		for (Node n : list) {
			if (LAYER_NAMES.contains(n.name)) {
				String path = base + i;
				add(spans, src, n, path);
				if (HOLDS_LAYERS.contains(n.name)) {
					layers(spans, src, n.children, path + ".");
				}
				i++;
			}
		}
	}

	private static void add(List<Span> spans, String src, Node n, String path) {
		int[] start = Parser.place(src, n.start);
		// The end is just past the last character, as the reference counts it.
		int[] end = Parser.place(src, n.end);
		spans.add(new Span(path, n.name, start[0], start[1], end[0], end[1]));
	}

	/** The innermost span holding a line: the one that starts latest, and in a tie, the last. */
	static Optional<Span> layerAt(List<Span> spans, int line) {
		Span best = null;
		for (Span s : spans) {
			if (line >= s.line() && line <= s.endLine()
					&& (best == null || s.line() > best.line() || (s.line() == best.line() && s.column() >= best.column()))) {
				best = s;
			}
		}
		return Optional.ofNullable(best);
	}
}
