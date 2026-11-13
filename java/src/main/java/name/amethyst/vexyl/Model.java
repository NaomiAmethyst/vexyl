// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * What a document says, as the parser reads it. These are the library's own, and change only
 * while a document is read: rendering copies what it changes, so a flag stays as it was.
 */
final class Model {
	private Model() {}

	/** Copies a value shallowly, as assigning a struct does in Go. */
	abstract static class Copyable<T> implements Cloneable {
		@SuppressWarnings("unchecked")
		T copy() {
			try {
				return (T) super.clone();
			} catch (CloneNotSupportedException e) {
				throw new AssertionError(e);
			}
		}
	}

	static final class Doc extends Copyable<Doc> {
		int version;
		Meta meta = new Meta();
		/** Color names to #rrggbb values, in lowercase. */
		Map<String, String> palette = new LinkedHashMap<>();
		/** Colors' values in other systems, for print and dye. */
		Map<String, List<ColorRef>> colorRefs = new LinkedHashMap<>();
		Map<String, Gradient> gradients = new LinkedHashMap<>();
		double hoist, fly;
		Outline outline;
		Edge border;
		boolean borderOutside;
		Map<String, Define> defines = new LinkedHashMap<>();
		List<Layer> layers = new ArrayList<>();
		Reverse reverse;
		Adapt adapt;
		Map<String, Variant> variants = new LinkedHashMap<>();
		Map<String, Fold> folds = new LinkedHashMap<>();
		/** Unique to the source, so that several flags can be inlined in one page. */
		String idPrefix = "";
		/** Says that the layers are a reverse's own, as seen from behind, while it's drawn. */
		boolean seenFromBehind;
	}

	static final class Gradient {
		List<String> colors = new ArrayList<>();
		double[] stops;
		String along = "fly";
	}

	static final class Meta {
		String name = "", description = "", version = "", date = "", until = "", series = "";
		List<String> notes = new ArrayList<>();
		List<Reference> laws = new ArrayList<>();
		List<Reference> restrictions = new ArrayList<>();
		List<String> designers = new ArrayList<>();
		String designRights = "";
		List<String> encoders = new ArrayList<>();
		String license = "", renderLicense = "";
		List<Adaptation> adaptedFrom = new ArrayList<>();
		List<String> sources = new ArrayList<>();
	}

	static final class Adaptation {
		String url = "";
		List<String> authors = new ArrayList<>();
		String license = "", part = "";
	}

	static final class Reference {
		String text = "";
		List<String> sources = new ArrayList<>();
	}

	static final class ColorRef {
		String system = "", value = "";
		/** The same value as numbers, for cmyk. */
		double[] numbers;
		/** A system named in a `reference`, rather than one of the format's own. */
		boolean other;
	}

	static final class Point {
		final double fly, hoist;

		Point(double fly, double hoist) {
			this.fly = fly;
			this.hoist = hoist;
		}
	}

	static final class Edge {
		final String color;
		final double width;

		Edge(String color, double width) {
			this.color = color;
			this.width = width;
		}
	}

	static final class Outline extends Copyable<Outline> {
		/** polygon, path, swallowtail, tongued or pennant. */
		String kind = "";
		List<Point> vertices = new ArrayList<>();
		String d = "";
		double[] box = new double[4];
		double depth, tip, tongue, taper;
	}

	static final class Define {
		Shape shape;
		List<Layer> layers = new ArrayList<>();
		/** A design's own grid, scaled to fill where it's used. */
		double fly, hoist;
		/** Worked out when it's read, as SPEC section 15 counts them. */
		int size, height;
	}

	static final class Reverse {
		List<Layer> layers = new ArrayList<>();
	}

	static final class Adapt {
		/** Limits on the proportion as fly divided by hoist. Zero is no limit. */
		double min, max;
		/** extend, center, scale, hoist-extend, hoist-center or hoist-scale, or "" for none. */
		String wider = "", narrower = "";
	}

	static final class Variant {
		String from = "none";
		boolean upright;
		double ratio;
		double fly, hoist;
		Outline outline;
		Edge border;
		boolean borderOutside;
		List<Layer> layers = new ArrayList<>();
	}

	static final class Fold {
		String description = "";
		List<String> sources = new ArrayList<>();
		List<FoldStep> steps = new ArrayList<>();
	}

	static final class FoldStep {
		/** over, under or tuck. */
		String kind = "";
		/** For a crease along an axis. */
		String along = "", move = "";
		double at;
		/** For a crease through two points, as written. */
		double[] through, moveTo;
		/** The crease's two points, and a point on the side that moves. */
		Point a, b, moving;
	}

	/** A wavy or zigzag edge between divisions. */
	static final class Line {
		String kind = "";
		double depth;
		double period;
		int count;

		/** How many waves it has across the flag's longer side. */
		int waves(double longer) {
			if (count > 0) {
				return count;
			}
			if (period <= 0) {
				return 0;
			}
			double waves = Math.ceil(longer / period);
			if (waves > Limits.MAX_COPIES) {
				return Limits.MAX_COPIES + 1;
			}
			return (int) waves;
		}
	}

	/** One of the layers of section 6 of the format, with the properties they all have. */
	abstract static class Layer extends Copyable<Layer> {
		/** start, center, end or scale, or "" to follow the flag's rule. */
		String anchor = "";
		double opacity = 1;
		String blend = "normal";
		Shape clip;
		List<Shape> cuts = new ArrayList<>();

		/** The node's own name. */
		abstract String kind();
	}

	static final class Field extends Layer {
		String color = "";

		@Override
		String kind() {
			return "field";
		}
	}

	/** Where adapting put a rotated bars or band, if it did. */
	static final class FixedFrame {
		/** The region it was drawn in, and where its center moved to in the new one. */
		double w, h;
		double x, y;

		FixedFrame(double w, double h, double x, double y) {
			this.w = w;
			this.h = h;
			this.x = x;
			this.y = y;
		}
	}

	static final class Bars extends Layer {
		List<String> colors = new ArrayList<>();
		String along = "fly";
		double[] ratio;
		double rotate;
		double[] grow;
		Line line;
		FixedFrame fixed;

		@Override
		String kind() {
			return "bars";
		}
	}

	static final class Chevrons extends Layer {
		List<String> colors = new ArrayList<>();
		String from = "hoist";
		double depth;
		double angle;
		Double apex;
		double[] ratio;
		double rotate;
		Edge fimbriate;

		@Override
		String kind() {
			return "chevrons";
		}
	}

	static final class Band extends Layer {
		String color = "";
		String along = "fly";
		double width, offset, rotate;
		Edge fimbriate;
		FixedFrame fixed;

		@Override
		String kind() {
			return "band";
		}
	}

	static final class Cross extends Layer {
		String color = "";
		double[] flyParts = {0, 1, 0};
		double[] hoistParts = {0, 1, 0};
		Edge fimbriate;

		@Override
		String kind() {
			return "cross";
		}
	}

	static final class Saltire extends Layer {
		String color = "";
		double width;
		Edge fimbriate;
		boolean counterchange;

		@Override
		String kind() {
			return "saltire";
		}
	}

	static final class Quarters extends Layer {
		String[] colors = {"", "", "", ""};
		boolean diagonal;
		Point split;

		@Override
		String kind() {
			return "quarters";
		}
	}

	static final class Checks extends Layer {
		List<String> colors = new ArrayList<>();
		int rows, columns;
		String flow = "bend-sinister";

		@Override
		String kind() {
			return "checks";
		}
	}

	static final class Rays extends Layer {
		List<String> colors = new ArrayList<>();
		/** center, a corner or the middle of an edge. At overrides it. */
		String from = "center";
		Point at;
		double[] ratio;
		double rotate;
		boolean byEdge;

		@Override
		String kind() {
			return "rays";
		}
	}

	/** A charge, or a pile or pall, which are read as charges of their own shapes. */
	static final class Charge extends Layer {
		Shape shape = new Shape();
		/** Optional for inline SVG, where it's what currentColor means. */
		String color = "";
		Edge fimbriate;
		Repeat repeat;

		@Override
		String kind() {
			return shape.kind.equals("pile") || shape.kind.equals("pall") ? shape.kind : "charge";
		}
	}

	static final class Emblem extends Layer {
		Point at;
		String along = "";
		double rotate;
		List<Charge> charges = new ArrayList<>();

		@Override
		String kind() {
			return "emblem";
		}
	}

	static final class Group extends Layer {
		List<Layer> layers = new ArrayList<>();

		@Override
		String kind() {
			return "group";
		}
	}

	static final class Panel extends Layer {
		String side = "";
		double width;
		String corner = "";
		Point at;
		double fly, hoist;
		Line line;
		List<Layer> layers = new ArrayList<>();
		/** Written as a canton. */
		boolean canton;

		@Override
		String kind() {
			return canton ? "canton" : "panel";
		}
	}

	static final class Use extends Layer {
		String name = "";
		/** The definition it names, which isn't part of the use itself. */
		Define design;

		@Override
		String kind() {
			return "use";
		}
	}

	/** A shape used by a charge, clip or cut, or a definition. */
	static final class Shape extends Copyable<Shape> {
		String kind = "";
		/** The position, or null for the center of the region. */
		Point at;
		/** The positions of a charge given several, each null for the center. */
		List<Point> ats = new ArrayList<>();
		double rotate;
		double radius, inner;
		int points;
		double width, spread;
		double from, to;
		boolean hasArc;
		double offset, disc, gap, hollow, lines;
		String d = "";
		double[] box = new double[4];
		boolean evenOdd;
		/** The edge a pile or pall starts from. */
		String edge = "";
		double[] base, tip;
		double depth, flat, junction;
		double fly, hoist;
		List<Point> vertices = new ArrayList<>();
		/** Inline SVG after being sanitized, in its canonical form. */
		String markup = "";

		/** An explicit `at`, even `at center`. */
		boolean placed;
		/** Values worked out from the shape's others, which a charge using a definition works out again. */
		boolean autoInner, autoSpread;
		/** A pile's `flat`, even `flat 0`. */
		boolean hasFlat;
		Sanitizer.Artwork embedded;
	}

	static final class Repeat extends Copyable<Repeat> {
		/** ring, arc, grid or line. */
		String kind = "";
		int count;
		double radius;
		boolean turn;
		double from, to;
		int rows, columns;
		boolean stagger;
		double fly, hoist;
	}
}
