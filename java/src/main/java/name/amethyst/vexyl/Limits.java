// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.nio.charset.StandardCharsets;
import java.util.List;

/** The limits of section 15 of the format, so that a small document can't demand unbounded work. */
final class Limits {
	private Limits() {}

	static final int MAX_DEPTH = 32;
	/** How much a whole flag can paint. */
	static final int MAX_SIZE = 200000;
	static final int MAX_COPIES = 10000;
	/** How many pieces a fold can make, since each step can double them. */
	static final int MAX_FACETS = 10000;
	/** How many bytes of path data or inline SVG count as one part. */
	static final int BYTES_PER_PART = 64;
	/** The largest size a number can have, and its inverse the smallest. */
	static final double NUMBER_LIMIT = 1e12;

	/** Whether a number is finite and of a reasonable size. */
	static boolean inLimits(double v) {
		double a = Math.abs(v);
		return !Double.isNaN(v) && a <= NUMBER_LIMIT && (a == 0 || a >= 1 / NUMBER_LIMIT);
	}

	/** Adds sizes without passing the point where they stop mattering. */
	static int add(int a, int b) {
		return (int) Math.min((long) a + b, MAX_SIZE + 1);
	}

	static int mul(int a, int b) {
		if (a == 0 || b == 0) {
			return 0;
		}
		return (int) Math.min((long) a * b, MAX_SIZE + 1);
	}

	static int bytes(String s) {
		return s.getBytes(StandardCharsets.UTF_8).length;
	}

	/** How many parts one copy of a shape counts as. */
	static int shapeParts(Model.Shape s) {
		switch (s.kind) {
		case "star":
		case "sun":
			return Math.max(s.points, 1);
		case "polygon":
			return Math.max(s.vertices.size(), 1);
		case "path":
			return 1 + bytes(s.d) / BYTES_PER_PART;
		case "svg":
			return 1 + bytes(s.markup) / BYTES_PER_PART;
		default:
			return 1;
		}
	}

	static int chargeCopies(Model.Charge c) {
		if (c.repeat != null && c.repeat.kind.equals("grid")) {
			return c.repeat.rows * c.repeat.columns;
		}
		if (c.repeat != null) {
			return c.repeat.count;
		}
		if (c.shape.ats.size() > 1) {
			return c.shape.ats.size();
		}
		return 1;
	}

	/** What a layer paints. A definition's size was worked out when it was read. */
	static int layerSize(Model.Layer l, double longer) {
		int size = l.clip != null ? shapeParts(l.clip) : 0;
		int cuts = 0;
		for (Model.Shape s : l.cuts) {
			cuts = add(cuts, shapeParts(s));
		}
		// A charge's cuts go with each of its copies.
		if (l instanceof Model.Charge) {
			cuts = mul(chargeCopies((Model.Charge) l), cuts);
		}
		return add(add(size, cuts), contentSize(l, longer));
	}

	private static int contentSize(Model.Layer l, double longer) {
		if (l instanceof Model.Bars) {
			Model.Bars t = (Model.Bars) l;
			if (t.line != null) {
				return mul(t.colors.size(), 1 + t.line.waves(longer));
			}
			return t.colors.size();
		}
		if (l instanceof Model.Chevrons) {
			return ((Model.Chevrons) l).colors.size();
		}
		if (l instanceof Model.Rays) {
			return ((Model.Rays) l).colors.size();
		}
		if (l instanceof Model.Quarters) {
			return 4;
		}
		if (l instanceof Model.Checks) {
			Model.Checks t = (Model.Checks) l;
			return mul(t.rows, t.columns);
		}
		if (l instanceof Model.Charge) {
			Model.Charge t = (Model.Charge) l;
			return mul(chargeCopies(t), shapeParts(t.shape));
		}
		if (l instanceof Model.Emblem) {
			int size = 0;
			for (Model.Charge c : ((Model.Emblem) l).charges) {
				size = add(size, layerSize(c, longer));
			}
			return size;
		}
		if (l instanceof Model.Group) {
			return layersSize(((Model.Group) l).layers, longer);
		}
		if (l instanceof Model.Panel) {
			Model.Panel t = (Model.Panel) l;
			int size = layersSize(t.layers, longer);
			if (t.line != null) {
				size = add(size, t.line.waves(longer));
			}
			return size;
		}
		if (l instanceof Model.Use) {
			return ((Model.Use) l).design.size;
		}
		return 1;
	}

	static int layersSize(List<Model.Layer> layers, double longer) {
		int size = 0;
		for (Model.Layer l : layers) {
			size = add(size, layerSize(l, longer));
		}
		return size;
	}

	/** How many levels a layer nests, counting what it uses. */
	static int layerHeight(Model.Layer l) {
		if (l instanceof Model.Group) {
			return 1 + layersHeight(((Model.Group) l).layers);
		}
		if (l instanceof Model.Panel) {
			return 1 + layersHeight(((Model.Panel) l).layers);
		}
		if (l instanceof Model.Use) {
			return 1 + ((Model.Use) l).design.height;
		}
		return 1;
	}

	static int layersHeight(List<Model.Layer> layers) {
		int height = 0;
		for (Model.Layer l : layers) {
			height = Math.max(height, layerHeight(l));
		}
		return height;
	}
}
