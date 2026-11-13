// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.function.UnaryOperator;

import name.amethyst.vexyl.Geometry.Vec;
import name.amethyst.vexyl.Model.*;

/** Works out the polygons and paths that layers and shapes paint. */
final class Shapes {
	private Shapes() {}

	/** Stops a render that turns out to be too much, deep inside geometry that otherwise can't fail. */
	static final class Refusal extends RuntimeException {
		private static final long serialVersionUID = 1L;

		Refusal(String message) {
			super(message);
		}
	}

	/**
	 * A rectangle with its origin at the current coordinate origin. An emblem's frame has no size,
	 * and its center is its origin; local is then how far its content could need to reach to cover
	 * everything visible.
	 */
	static final class Region {
		final double w, h, local;

		Region(double w, double h) {
			this(w, h, 0);
		}

		Region(double w, double h, double local) {
			this.w = w;
			this.h = h;
			this.local = local;
		}

		/** The rectangle a mask has to cover. */
		double[] bounds() {
			if (local > 0) {
				return new double[] {-local, -local, 2 * local, 2 * local};
			}
			return new double[] {0, 0, w, h};
		}

		Vec center() {
			return new Vec(w / 2, h / 2);
		}

		double reach() {
			return Math.hypot(w, h);
		}

		Vec[] corners() {
			return new Vec[] {new Vec(0, 0), new Vec(w, 0), new Vec(w, h), new Vec(0, h)};
		}
	}

	/** A shape resolved to coordinates. */
	static final class Geom {
		boolean circle, ring;
		Vec c;
		double r, inner;
		List<Vec> poly;
		/** SVG path data, for shapes that polygons can't draw exactly. */
		String path = "";
		boolean evenodd;
		/** Places a path, whose scale strokes have to allow for. */
		String transform = "";
		double scale;

		static Geom poly(List<Vec> poly) {
			Geom g = new Geom();
			g.poly = poly;
			return g;
		}

		static Geom path(String d) {
			Geom g = new Geom();
			g.path = d;
			return g;
		}

		double strokeScale() {
			return scale > 0 ? scale : 1;
		}
	}

	/** Formats a coordinate to a fixed precision, so output is stable and free of floating-point noise. */
	static String num(double v) {
		double scaled = v * 1e6;
		if (Math.abs(scaled) < 9e18) {
			long l = Math.round(scaled);
			if (l == 0) {
				return "0";
			}
			return BigDecimal.valueOf(l, 6).stripTrailingZeros().toPlainString();
		}
		return new BigDecimal(v).setScale(0, RoundingMode.HALF_EVEN).toPlainString();
	}

	/**
	 * Writes a scale, whose size says nothing about how many places it needs: a path drawn in a
	 * box tens of thousands wide, on a grid of a few units, is scaled by a very small number.
	 */
	static String factor(double v) {
		if (v == 0) {
			return "0";
		}
		return new BigDecimal(v).round(new MathContext(10, RoundingMode.HALF_EVEN)).stripTrailingZeros().toPlainString();
	}

	static double[] bounds(List<Vec> poly) {
		double x0 = Double.POSITIVE_INFINITY, y0 = Double.POSITIVE_INFINITY;
		double x1 = Double.NEGATIVE_INFINITY, y1 = Double.NEGATIVE_INFINITY;
		for (Vec p : poly) {
			x0 = Math.min(x0, p.x);
			y0 = Math.min(y0, p.y);
			x1 = Math.max(x1, p.x);
			y1 = Math.max(y1, p.y);
		}
		return new double[] {x0, y0, x1 - x0, y1 - y0};
	}

	/** The direction of an axis, and the normal bars are listed along. */
	static Vec[] axis(Region r, String along, double rotation) {
		double l = r.reach();
		Vec dir, normal;
		switch (along) {
		case "hoist":
			dir = new Vec(0, 1);
			normal = new Vec(1, 0);
			break;
		case "bend":
			dir = new Vec(r.w / l, r.h / l);
			normal = new Vec(r.h / l, -r.w / l);
			break;
		case "bend-sinister":
			dir = new Vec(r.w / l, -r.h / l);
			normal = new Vec(r.h / l, r.w / l);
			break;
		default:
			dir = new Vec(1, 0);
			normal = new Vec(0, 1);
		}
		return new Vec[] {dir.rotate(rotation), normal.rotate(rotation)};
	}

	private interface Edge {
		boolean inside(Vec v);

		Vec cross(Vec a, Vec b);
	}

	private static Edge atX(double x, boolean below) {
		return new Edge() {
			public boolean inside(Vec v) {
				return below ? v.x <= x : v.x >= x;
			}

			public Vec cross(Vec a, Vec b) {
				return new Vec(x, a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x));
			}
		};
	}

	private static Edge atY(double y, boolean below) {
		return new Edge() {
			public boolean inside(Vec v) {
				return below ? v.y <= y : v.y >= y;
			}

			public Vec cross(Vec a, Vec b) {
				return new Vec(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y), y);
			}
		};
	}

	/** Clips a convex polygon to a region (Sutherland-Hodgman). */
	static List<Vec> clipConvex(List<Vec> poly, Region r) {
		Edge[] edges = {atX(0, false), atX(r.w, true), atY(0, false), atY(r.h, true)};
		for (Edge e : edges) {
			List<Vec> out = new ArrayList<>();
			int n = poly.size();
			for (int i = 0; i < n; i++) {
				Vec cur = poly.get(i), prev = poly.get((i + n - 1) % n);
				boolean in = e.inside(cur), was = e.inside(prev);
				if (in && was) {
					out.add(cur);
				} else if (in) {
					out.add(e.cross(prev, cur));
					out.add(cur);
				} else if (was) {
					out.add(e.cross(prev, cur));
				}
			}
			poly = out;
		}
		return poly;
	}

	/** The region a layer's axis is measured in and the center it's drawn about. */
	static Region frame(FixedFrame f, Region r) {
		return f == null ? r : new Region(f.w, f.h);
	}

	static Vec frameCenter(FixedFrame f, Region r) {
		return f == null ? r.center() : new Vec(f.x, f.y);
	}

	/** Far enough from a point to cross the whole region, wherever the point is. */
	static double reachFrom(Vec c, Region r) {
		Vec d = c.sub(r.center());
		return r.reach() + Math.hypot(d.x, d.y);
	}

	/** The rectangle between two offsets along normal. */
	static List<Vec> stripPoly(Vec c, Vec dir, Vec normal, double t0, double t1, double reach) {
		List<Vec> out = new ArrayList<>();
		out.add(c.add(normal.mul(t0)).sub(dir.mul(reach)));
		out.add(c.add(normal.mul(t0)).add(dir.mul(reach)));
		out.add(c.add(normal.mul(t1)).add(dir.mul(reach)));
		out.add(c.add(normal.mul(t1)).sub(dir.mul(reach)));
		return out;
	}

	interface Exact {
		boolean test(int i);
	}

	/**
	 * One polygon per bar. Each runs from its bar's start to the far side of the region, so the
	 * next bar paints over it and antialiasing can't leave a seam showing what's beneath. A gradient
	 * spans the shape it fills, so a bar for which exact is true stays its true width.
	 */
	static List<List<Vec>> barPolys(Bars b, Region r, Exact exact) {
		Region frame = frame(b.fixed, r);
		Vec c = frameCenter(b.fixed, r);
		Vec[] ax = axis(frame, b.along, b.rotate);
		Vec dir = ax[0], normal = ax[1];
		double lo = Double.POSITIVE_INFINITY, hi = Double.NEGATIVE_INFINITY;
		for (Vec corner : r.corners()) {
			double offset = corner.sub(c).dot(normal);
			lo = Math.min(lo, offset);
			hi = Math.max(hi, offset);
		}
		double total = 0;
		for (double part : b.ratio) {
			total += part;
		}
		double reach = reachFrom(c, r);
		List<List<Vec>> polys = new ArrayList<>();
		double t = lo;
		for (int i = 0; i < b.ratio.length; i++) {
			double next = t + (hi - lo) * b.ratio[i] / total;
			double end = hi;
			boolean isExact = exact != null && exact.test(i);
			if (isExact) {
				end = next;
			}
			if (b.line == null) {
				double from = t, to = end;
				if (b.rotate != 0) {
					// The outermost lines pass through corners, where rounding in the angle could
					// leave a sliver either side, so the outer ends reach well past the region.
					if (i == 0) {
						from -= reach;
					}
					if (end == hi || i == b.ratio.length - 1) {
						to = hi + reach;
					}
				}
				polys.add(clipConvex(stripPoly(c, dir, normal, from, to, reach), r));
				t = next;
				continue;
			}
			// A shaped edge isn't convex, so clipping is left to the region's own clip.
			double margin = b.line.depth + 1;
			List<Vec> near = new ArrayList<>();
			near.add(c.add(normal.mul(lo - margin)).sub(dir.mul(reach)));
			near.add(c.add(normal.mul(lo - margin)).add(dir.mul(reach)));
			if (i > 0) {
				near = waveEdge(c, dir, normal, t, axisSpan(frame, b.along), reach, b.line);
			}
			List<Vec> far = new ArrayList<>();
			far.add(c.add(normal.mul(hi + margin)).add(dir.mul(reach)));
			far.add(c.add(normal.mul(hi + margin)).sub(dir.mul(reach)));
			if (isExact && i < b.ratio.length - 1) {
				far = waveEdge(c, dir, normal, next, axisSpan(frame, b.along), reach, b.line);
				Collections.reverse(far);
			}
			List<Vec> poly = new ArrayList<>(near);
			poly.addAll(far);
			polys.add(poly);
			t = next;
		}
		return polys;
	}

	/** One polygon per color, from the outermost inward, which is the order they paint in. */
	static List<List<Vec>> chevronPolys(Chevrons ch, Region r) {
		List<List<Vec>> raw = rawChevrons(ch, r)[0];
		List<List<Vec>> out = new ArrayList<>();
		for (List<Vec> poly : raw) {
			out.add(clipConvex(poly, r));
		}
		return out;
	}

	/**
	 * Each chevron's polygon reaching well past the region, and each chevron alone between its apex
	 * and the next, for when gaps have to show.
	 */
	@SuppressWarnings("unchecked")
	static List<List<Vec>>[] rawChevrons(Chevrons ch, Region r) {
		Vec origin, u, v;
		double edge;
		switch (ch.from) {
		case "fly":
			origin = new Vec(r.w, r.h / 2);
			u = new Vec(-1, 0);
			v = new Vec(0, 1);
			edge = r.h;
			break;
		case "top":
			origin = new Vec(r.w / 2, 0);
			u = new Vec(0, 1);
			v = new Vec(1, 0);
			edge = r.w;
			break;
		case "bottom":
			origin = new Vec(r.w / 2, r.h);
			u = new Vec(0, -1);
			v = new Vec(1, 0);
			edge = r.w;
			break;
		default:
			origin = new Vec(0, r.h / 2);
			u = new Vec(1, 0);
			v = new Vec(0, 1);
			edge = r.h;
		}
		double reach = r.reach();
		if (ch.apex != null) {
			double shift = ch.apex - edge / 2;
			origin = origin.add(v.mul(shift));
			reach += Math.abs(shift);
		}
		double run = ch.depth;
		if (ch.angle != 0) {
			run = (edge / 2) / Math.tan(ch.angle * Math.PI / 180);
		}
		double slope = run / (edge / 2);
		double total = 0;
		for (double part : ch.ratio) {
			total += part;
		}
		double[] apexes = new double[ch.ratio.length];
		double sum = 0;
		for (int i = 0; i < ch.ratio.length; i++) {
			sum += ch.ratio[i];
			apexes[i] = ch.depth * sum / total;
		}
		Vec o = origin, uu = u, vv = v;
		Vec center = r.center();
		java.util.function.BiFunction<Double, Double, Vec> place = (pu, pv) -> {
			Vec point = o.add(uu.mul(pu)).add(vv.mul(pv));
			return center.add(point.sub(center).rotate(ch.rotate));
		};
		List<List<Vec>> nested = new ArrayList<>(), bands = new ArrayList<>();
		for (int i = apexes.length - 1; i >= 0; i--) {
			double a = apexes[i];
			double armEnd = a - slope * reach;
			double back = Math.min(armEnd, 0) - reach;
			nested.add(List.of(place.apply(a, 0.0), place.apply(armEnd, reach), place.apply(back, reach),
					place.apply(back, -reach), place.apply(armEnd, -reach)));
			if (i == 0) {
				bands.add(nested.get(nested.size() - 1));
				continue;
			}
			double inner = apexes[i - 1];
			double innerEnd = inner - slope * reach;
			bands.add(List.of(place.apply(a, 0.0), place.apply(armEnd, reach), place.apply(innerEnd, reach),
					place.apply(inner, 0.0), place.apply(innerEnd, -reach), place.apply(armEnd, -reach)));
		}
		return new List[] {nested, bands};
	}

	/** A band's rectangle, clipped to the region unless it will be stroked. */
	static List<Vec> bandPoly(Region r, String along, double rotation, double width, double offset, boolean stroked) {
		return placedBandPoly(r, null, along, rotation, width, offset, stroked);
	}

	static List<Vec> placedBandPoly(Region r, FixedFrame fixed, String along, double rotation, double width, double offset, boolean stroked) {
		Region frame = frame(fixed, r);
		Vec c = frameCenter(fixed, r);
		Vec[] ax = axis(frame, along, rotation);
		List<Vec> poly = stripPoly(c, ax[0], ax[1], offset - width / 2, offset + width / 2, reachFrom(c, r));
		if (stroked) {
			return poly;
		}
		return clipConvex(poly, r);
	}

	/** A cross's vertical and horizontal arms, with their ends extended by a distance. */
	static List<List<Vec>> crossPolys(Cross c, Region r, double extend) {
		double a = c.flyParts[0], w = c.flyParts[1], b = c.flyParts[2];
		double x0 = r.w * a / (a + w + b);
		double x1 = r.w * (a + w) / (a + w + b);
		double d = c.hoistParts[0], h = c.hoistParts[1], e = c.hoistParts[2];
		double y0 = r.h * d / (d + h + e);
		double y1 = r.h * (d + h) / (d + h + e);
		return List.of(Geometry.rectPoly(x0, -extend, x1, r.h + extend), Geometry.rectPoly(-extend, y0, r.w + extend, y1));
	}

	static Vec position(Shape s, Region r) {
		if (s.at == null) {
			return r.center();
		}
		return new Vec(s.at.fly, s.at.hoist);
	}

	private static List<Vec> placeAll(List<Vec> points, UnaryOperator<Vec> place) {
		List<Vec> out = new ArrayList<>();
		for (Vec p : points) {
			out.add(place.apply(p));
		}
		return out;
	}

	/** Resolves a shape at a center, with its rotation added to the extra. */
	static Geom shapeGeom(Shape s, Vec center, double extra) {
		double rotation = s.rotate + extra;
		UnaryOperator<Vec> place = p -> center.add(p.rotate(rotation));
		switch (s.kind) {
		case "disc": {
			Geom g = new Geom();
			g.circle = true;
			g.c = center;
			g.r = s.radius;
			return g;
		}
		case "ring": {
			if (s.hasArc) {
				return Geom.path(ringArcPath(s, center, rotation));
			}
			Geom g = new Geom();
			g.ring = true;
			g.c = center;
			g.r = s.radius;
			g.inner = s.inner;
			return g;
		}
		case "rect": {
			double x = s.fly / 2, y = s.hoist / 2;
			return Geom.poly(placeAll(Geometry.rectPoly(-x, -y, x, y), place));
		}
		case "plus": {
			double a = s.radius, w = s.width / 2;
			return Geom.poly(placeAll(List.of(
					new Vec(-w, -a), new Vec(w, -a), new Vec(w, -w), new Vec(a, -w), new Vec(a, w), new Vec(w, w),
					new Vec(w, a), new Vec(-w, a), new Vec(-w, w), new Vec(-a, w), new Vec(-a, -w), new Vec(-w, -w)), place));
		}
		case "triangle":
			return Geom.poly(placeAll(starPoints(3, s.radius, 0), place));
		case "star":
			if (s.lines > 0) {
				return Geom.path(starChords(s.points, s.radius, place));
			}
			return Geom.poly(placeAll(starPoints(s.points, s.radius, s.inner), place));
		case "heart":
			return Geom.path(heartPath(s.radius, s.spread, place));
		case "crescent":
			return Geom.path(crescentPath(s.radius, s.inner, s.offset, place));
		case "sun":
			return Geom.path(sunPath(s, center, place));
		case "lozenge": {
			double x = s.fly / 2, y = s.hoist / 2;
			return Geom.poly(placeAll(List.of(new Vec(0, -y), new Vec(x, 0), new Vec(0, y), new Vec(-x, 0)), place));
		}
		case "ellipse":
			return Geom.path(ellipsePath(center, s.fly / 2, s.hoist / 2, rotation));
		case "path":
			return pathGeom(s, center, rotation);
		case "cardioid":
			return Geom.poly(placeAll(cardioidPoints(s.radius), place));
		case "polygon": {
			List<Vec> poly = new ArrayList<>();
			for (Point p : s.vertices) {
				poly.add(new Vec(p.fly, p.hoist));
			}
			return Geom.poly(poly);
		}
		default:
			return new Geom();
		}
	}

	/**
	 * A heart with its lobes either side of the origin and its tip below, whose straight sides meet
	 * at a right angle and touch the lobes.
	 */
	static String heartPath(double radius, double spread, UnaryOperator<Vec> place) {
		double half = spread / 2;
		double edge = radius / Math.sqrt(2);
		Vec tip = place.apply(new Vec(0, half + radius * Math.sqrt(2)));
		Vec right = place.apply(new Vec(half + edge, edge));
		Vec left = place.apply(new Vec(-half - edge, edge));
		Vec notch = place.apply(new Vec(0, -Math.sqrt(radius * radius - half * half)));
		// Each arc runs from 45 degrees below the lobe's side, around to the notch.
		int large = 225 - Math.acos(half / radius) * 180 / Math.PI > 180 ? 1 : 0;
		String r = num(radius);
		return "M" + num(tip.x) + " " + num(tip.y) + "L" + num(right.x) + " " + num(right.y)
				+ "A" + r + " " + r + " 0 " + large + " 0 " + num(notch.x) + " " + num(notch.y)
				+ "A" + r + " " + r + " 0 " + large + " 0 " + num(left.x) + " " + num(left.y) + "Z";
	}

	/** Lays out n outer points clockwise from up. An inner radius of 0 gives a regular polygon. */
	static List<Vec> starPoints(int n, double radius, double inner) {
		List<Vec> points = new ArrayList<>();
		double step = 360.0 / n;
		for (int i = 0; i < n; i++) {
			double a = i * step;
			points.add(new Vec(0, -radius).rotate(a));
			if (inner > 0) {
				points.add(new Vec(0, -inner).rotate(a + step / 2));
			}
		}
		return points;
	}

	/**
	 * Samples a cardioid with its cusp at the origin and its lobe below. 180 segments keep the error
	 * under the format's tolerance for any radius up to the flag's hoist.
	 */
	static List<Vec> cardioidPoints(double radius) {
		int segments = 180;
		List<Vec> points = new ArrayList<>();
		for (int i = 0; i < segments; i++) {
			double t = 2 * Math.PI * i / segments;
			double rho = radius * (1 - Math.cos(t)) / 2;
			points.add(new Vec(rho * Math.sin(t), -rho * Math.cos(t)));
		}
		return points;
	}

	/** A disc with another cut from it, offset toward the fly. */
	static String crescentPath(double radius, double inner, double offset, UnaryOperator<Vec> place) {
		double x = (radius * radius - inner * inner + offset * offset) / (2 * offset);
		double y = Math.sqrt(Math.max(radius * radius - x * x, 0));
		Vec top = place.apply(new Vec(x, -y)), bottom = place.apply(new Vec(x, y));
		int outerLarge = x > 0 ? 1 : 0;
		int innerLarge = x > offset ? 1 : 0;
		return "M" + num(top.x) + " " + num(top.y)
				+ "A" + num(radius) + " " + num(radius) + " 0 " + outerLarge + " 0 " + num(bottom.x) + " " + num(bottom.y)
				+ "A" + num(inner) + " " + num(inner) + " 0 " + innerLarge + " 1 " + num(top.x) + " " + num(top.y) + "Z";
	}

	/** A disc and triangular rays, all wound the same way so that where they overlap stays filled. */
	static String sunPath(Shape s, Vec center, UnaryOperator<Vec> place) {
		StringBuilder b = new StringBuilder(circlePath(center, s.disc));
		double base = s.disc + s.gap;
		double step = 360.0 / s.points;
		double half = step / 2 * s.spread;
		for (int i = 0; i < s.points; i++) {
			double a = i * step;
			Vec tip = place.apply(new Vec(0, -s.radius).rotate(a));
			Vec left = place.apply(new Vec(0, -base).rotate(a - half));
			Vec right = place.apply(new Vec(0, -base).rotate(a + half));
			b.append(" M").append(num(right.x)).append(' ').append(num(right.y))
					.append('L').append(num(tip.x)).append(' ').append(num(tip.y))
					.append('L').append(num(left.x)).append(' ').append(num(left.y)).append('Z');
		}
		return b.toString();
	}

	/** Part of a ring, clockwise from one angle to another. */
	static String ringArcPath(Shape s, Vec center, double rotation) {
		double from = s.from + rotation;
		// Clockwise from one to the other, by less than a full turn.
		double to = from + (((s.to - s.from) % 360) + 360) % 360;
		int large = to - from > 180 ? 1 : 0;
		Vec a = center.add(new Vec(0, -s.radius).rotate(from)), b = center.add(new Vec(0, -s.radius).rotate(to));
		Vec c = center.add(new Vec(0, -s.inner).rotate(to)), d = center.add(new Vec(0, -s.inner).rotate(from));
		return "M" + num(a.x) + " " + num(a.y) + "A" + num(s.radius) + " " + num(s.radius) + " 0 " + large + " 1 "
				+ num(b.x) + " " + num(b.y) + "L" + num(c.x) + " " + num(c.y) + "A" + num(s.inner) + " " + num(s.inner)
				+ " 0 " + large + " 0 " + num(d.x) + " " + num(d.y) + "Z";
	}

	/**
	 * Joins a star's points by skipping one each time, which is one closed line for an odd number
	 * of points and two for six, as on a hexagram.
	 */
	static String starChords(int n, double radius, UnaryOperator<Vec> place) {
		boolean[] seen = new boolean[n];
		StringBuilder b = new StringBuilder();
		for (int start = 0; start < n; start++) {
			if (seen[start]) {
				continue;
			}
			Vec p = place.apply(new Vec(0, -radius).rotate(start * 360.0 / n));
			b.append('M').append(num(p.x)).append(' ').append(num(p.y));
			for (int i = (start + 2) % n; i != start; i = (i + 2) % n) {
				seen[i] = true;
				p = place.apply(new Vec(0, -radius).rotate(i * 360.0 / n));
				b.append('L').append(num(p.x)).append(' ').append(num(p.y));
			}
			seen[start] = true;
			b.append('Z');
		}
		return b.toString();
	}

	/** Fits a path's box within a size, keeping its shape, centered on a point. */
	static Geom pathGeom(Shape s, Vec center, double rotation) {
		double scale = Double.POSITIVE_INFINITY;
		if (s.fly > 0) {
			scale = s.fly / s.box[2];
		}
		if (s.hoist > 0) {
			scale = Math.min(scale, s.hoist / s.box[3]);
		}
		String transform = "translate(" + num(center.x) + " " + num(center.y) + ")";
		if (rotation != 0) {
			transform += " rotate(" + num(rotation) + ")";
		}
		transform += " scale(" + factor(scale) + ") translate(" + num(-s.box[0] - s.box[2] / 2) + " " + num(-s.box[1] - s.box[3] / 2) + ")";
		Geom g = Geom.path(s.d);
		g.transform = transform;
		g.scale = scale;
		g.evenodd = s.evenOdd;
		return g;
	}

	static String circlePath(Vec c, double radius) {
		String rs = num(radius);
		return "M" + num(c.x - radius) + " " + num(c.y) + "A" + rs + " " + rs + " 0 1 0 " + num(c.x + radius) + " " + num(c.y)
				+ "A" + rs + " " + rs + " 0 1 0 " + num(c.x - radius) + " " + num(c.y) + "Z";
	}

	/** An ellipse with the given half sizes, turned clockwise by a rotation. */
	static String ellipsePath(Vec c, double x, double y, double rotation) {
		Vec a = c.sub(new Vec(x, 0).rotate(rotation)), b = c.add(new Vec(x, 0).rotate(rotation));
		String arc = "A" + num(x) + " " + num(y) + " " + num(rotation) + " 1 0";
		return "M" + num(a.x) + " " + num(a.y) + arc + " " + num(b.x) + " " + num(b.y) + arc + " " + num(a.x) + " " + num(a.y) + "Z";
	}

	/** Fills in what a shape takes from the region it's in. */
	static Shape forRegion(Shape s, Region r) {
		switch (s.kind) {
		case "lozenge": {
			if (s.fly > 0 && s.hoist > 0) {
				return s;
			}
			Shape out = s.copy();
			if (out.fly == 0) {
				out.fly = r.w;
			}
			if (out.hoist == 0) {
				out.hoist = r.h;
			}
			return out;
		}
		case "pile": {
			Shape out = s.copy();
			out.kind = "polygon";
			out.vertices = pilePoints(s, r);
			return out;
		}
		case "pall": {
			Shape out = s.copy();
			out.kind = "polygon";
			out.vertices = pallPoints(s, r);
			return out;
		}
		default:
			return s;
		}
	}

	private interface EdgePlace {
		Point at(double in, double along);
	}

	private static EdgePlace edgeFrame(String edge, Region r) {
		switch (edge) {
		case "fly":
			return (in, along) -> new Point(r.w - in, along);
		case "top":
			return (in, along) -> new Point(along, in);
		case "bottom":
			return (in, along) -> new Point(along, r.h - in);
		default:
			return (in, along) -> new Point(in, along);
		}
	}

	private static double edgeLength(String edge, Region r) {
		return edge.equals("top") || edge.equals("bottom") ? r.w : r.h;
	}

	/** Continues a pile's sides back past its edge, so that fimbriation doesn't run along the flag's edge. */
	static List<Point> pilePoints(Shape s, Region r) {
		EdgePlace place = edgeFrame(s.edge, r);
		double length = edgeLength(s.edge, r);
		double a = 0, b = length;
		if (s.base != null) {
			a = s.base[0];
			b = s.base[1];
		}
		double depth = s.depth, along = (a + b) / 2;
		if (s.tip != null) {
			along = s.tip[0];
			depth = s.tip[1];
		}
		double lo = along - s.flat / 2, hi = along + s.flat / 2;
		double back = r.reach();
		double backA = a - (lo - a) * back / depth;
		double backB = b + (b - hi) * back / depth;
		return List.of(place.at(-back, backA), place.at(depth, lo), place.at(depth, hi), place.at(-back, backB));
	}

	/** Outlines a Y whose arms run from the corners of its edge to a junction, then on as one stem. */
	static List<Point> pallPoints(Shape s, Region r) {
		EdgePlace place = edgeFrame(s.edge, r);
		double length = edgeLength(s.edge, r);
		double far = s.edge.equals("top") || s.edge.equals("bottom") ? r.h : r.w;
		double junction = s.junction == 0 ? length / 2 : s.junction;
		double half = s.width / 2, mid = length / 2;
		double reach = r.reach() + s.width;
		double l = Math.hypot(junction, mid);
		double dirIn = junction / l, dirAlong = mid / l;
		// The upper arm runs along (dirIn, dirAlong) from the corner at along=0 to the junction,
		// in coordinates of (in, along from the center line).
		double normalIn = dirAlong, normalAlong = -dirIn;
		java.util.function.DoubleBinaryOperator line = (offset, targetAlong) -> {
			// Where the arm's edge at an offset reaches a distance from the center line.
			double startIn = normalIn * offset, startAlong = -mid + normalAlong * offset;
			return startIn + (targetAlong - startAlong) * dirIn / dirAlong;
		};
		double shoulder = line.applyAsDouble(half, -half);
		double notch = line.applyAsDouble(-half, 0);
		double farOuterIn = normalIn * half - dirIn * reach, farOuterAlong = -mid + normalAlong * half - dirAlong * reach;
		double farInnerIn = -normalIn * half - dirIn * reach, farInnerAlong = -mid - normalAlong * half - dirAlong * reach;
		EdgePlace at = (in, fromCenter) -> place.at(in, mid + fromCenter);
		return List.of(
				at.at(farOuterIn, farOuterAlong),
				at.at(shoulder, -half),
				at.at(far + reach, -half),
				at.at(far + reach, half),
				at.at(shoulder, half),
				at.at(farOuterIn, -farOuterAlong),
				at.at(farInnerIn, -farInnerAlong),
				at.at(notch, 0),
				at.at(farInnerIn, farInnerAlong));
	}

	/** Resolves an outline for painting and clipping. */
	static Geom outlineGeom(Outline o, double w, double h) {
		if (!o.kind.equals("path")) {
			return Geom.poly(Geometry.outlinePoints(o, w, h));
		}
		// A flag's own curved outline is stretched to its box.
		double sx = w / o.box[2], sy = h / o.box[3];
		Geom g = Geom.path(o.d);
		g.scale = 1;
		g.transform = "scale(" + factor(sx) + " " + factor(sy) + ") translate(" + num(-o.box[0]) + " " + num(-o.box[1]) + ")";
		return g;
	}

	/** Samples a wavy or zigzag line along a span, as distances along it and displacements from it. */
	static double[][] linePoints(Line l, double span) {
		double period = l.period;
		if (l.count > 0) {
			period = span / l.count;
		}
		if (span / period > Limits.MAX_COPIES) {
			throw new Refusal("a shaped edge can't have more than " + Limits.MAX_COPIES + " waves");
		}
		double half = l.depth / 2;
		List<Double> along = new ArrayList<>(), offset = new ArrayList<>();
		if (l.kind.equals("zigzag")) {
			double sign = -1;
			for (double s = 0; s <= span + period / 4; s += period / 2) {
				along.add(s);
				offset.add(sign * half);
				sign = -sign;
			}
		} else {
			int perWave = 24;
			for (double s = 0; s <= span + period / perWave / 2; s += period / perWave) {
				along.add(s);
				offset.add(half * Math.sin(2 * Math.PI * s / period));
			}
		}
		double[][] out = new double[2][along.size()];
		for (int i = 0; i < along.size(); i++) {
			out[0][i] = along.get(i);
			out[1][i] = offset.get(i);
		}
		return out;
	}

	/** A shaped line across a region, at offset t along normal, continued flat past the region. */
	static List<Vec> waveEdge(Vec c, Vec dir, Vec normal, double t, double span, double reach, Line l) {
		double[][] pts = linePoints(l, span);
		double[] along = pts[0], offset = pts[1];
		List<Vec> points = new ArrayList<>();
		points.add(c.add(normal.mul(t + offset[0])).sub(dir.mul(reach)));
		for (int i = 0; i < along.length; i++) {
			points.add(c.add(normal.mul(t + offset[i])).add(dir.mul(along[i] - span / 2)));
		}
		points.add(c.add(normal.mul(t + offset[offset.length - 1])).add(dir.mul(reach)));
		return points;
	}

	/** How far an axis runs across a region. */
	static double axisSpan(Region r, String along) {
		switch (along) {
		case "fly":
			return r.w;
		case "hoist":
			return r.h;
		default:
			return r.reach();
		}
	}

	/** One wedge per color, each with an angle under 180 degrees or split so that it clips cleanly. */
	static List<List<Vec>> rayPolys(Rays l, Region r) {
		Object[] frame = rayFrame(l, r);
		Vec apex = (Vec) frame[0];
		double from = (Double) frame[1], sweep = (Double) frame[2];
		@SuppressWarnings("unchecked")
		List<Vec> walk = (List<Vec>) frame[3];
		if (l.byEdge) {
			return rayPolysByEdge(l, r, apex, walk);
		}
		from += l.rotate;
		double total = 0;
		for (double part : l.ratio) {
			total += part;
		}
		double reach = r.reach() + Math.hypot(apex.x - r.w / 2, apex.y - r.h / 2);
		List<List<Vec>> polys = new ArrayList<>();
		double a = from;
		for (double part : l.ratio) {
			double width = sweep * part / total;
			int steps = (int) Math.ceil(width / 60);
			List<Vec> poly = new ArrayList<>();
			poly.add(apex);
			for (int i = 0; i <= steps; i++) {
				poly.add(apex.add(new Vec(0, -reach * 2).rotate(a + width * i / steps)));
			}
			polys.add(clipConvex(poly, r));
			a += width;
		}
		return polys;
	}

	/** Shares the region's far edges out by length, going clockwise. */
	static List<List<Vec>> rayPolysByEdge(Rays l, Region r, Vec apex, List<Vec> path) {
		double length = 0;
		for (int i = 1; i < path.size(); i++) {
			length += Math.hypot(path.get(i).x - path.get(i - 1).x, path.get(i).y - path.get(i - 1).y);
		}
		double total = 0;
		for (double part : l.ratio) {
			total += part;
		}
		// From outside the region, a wedge would cover what's between the point and the region.
		boolean outside = apex.x < 0 || apex.x > r.w || apex.y < 0 || apex.y > r.h;
		List<List<Vec>> polys = new ArrayList<>();
		int leg = 0;
		double into = 0;
		Vec at = path.get(0);
		for (double part : l.ratio) {
			double remaining = length * part / total;
			List<Vec> poly = new ArrayList<>();
			poly.add(apex);
			poly.add(at);
			while (remaining > 1e-9 && leg < path.size() - 1) {
				Vec next = path.get(leg + 1);
				double legLength = Math.hypot(next.x - path.get(leg).x, next.y - path.get(leg).y);
				double left = legLength - into;
				if (remaining < left) {
					into += remaining;
					at = path.get(leg).add(next.sub(path.get(leg)).mul(into / legLength));
					remaining = 0;
					break;
				}
				remaining -= left;
				at = next;
				poly.add(at);
				leg++;
				into = 0;
			}
			if (remaining == 0) {
				poly.add(at);
			}
			if (outside) {
				poly = clipConvex(poly, r);
			}
			polys.add(poly);
		}
		return polys;
	}

	/** Where rays start: a named point, or one given by position. */
	static Vec rayPoint(Rays l, Region r) {
		if (l.at != null) {
			return new Vec(l.at.fly, l.at.hoist);
		}
		switch (l.from) {
		case "upper-hoist":
			return new Vec(0, 0);
		case "lower-hoist":
			return new Vec(0, r.h);
		case "upper-fly":
			return new Vec(r.w, 0);
		case "lower-fly":
			return new Vec(r.w, r.h);
		case "hoist":
			return new Vec(0, r.h / 2);
		case "fly":
			return new Vec(r.w, r.h / 2);
		case "top":
			return new Vec(r.w / 2, 0);
		case "bottom":
			return new Vec(r.w / 2, r.h);
		default:
			return r.center();
		}
	}

	/**
	 * Where rays start, the angle they cover going clockwise from up, and the region's far edges,
	 * which are the ones the point is inside of, walked clockwise.
	 */
	static Object[] rayFrame(Rays l, Region r) {
		Vec apex = rayPoint(l, r);
		Vec[] corners = r.corners();
		// Edge i runs clockwise from corner i: the top, the fly, the bottom and the hoist.
		Vec[] inward = {new Vec(0, 1), new Vec(-1, 0), new Vec(0, -1), new Vec(1, 0)};
		boolean[] far = new boolean[4];
		int first = -1;
		for (int i = 0; i < 4; i++) {
			far[i] = apex.sub(corners[i]).dot(inward[i]) > 0;
		}
		for (int i = 0; i < 4; i++) {
			if (far[i] && !far[(i + 3) % 4]) {
				first = i;
			}
		}
		if (first < 0) {
			// Every edge is far, so the point is inside, and the rays go all the way round from up.
			Vec top = new Vec(apex.x, 0);
			return new Object[] {apex, 0.0, 360.0, List.of(top, corners[1], corners[2], corners[3], corners[0], top)};
		}
		List<Vec> walk = new ArrayList<>();
		walk.add(corners[first]);
		for (int i = first; far[i % 4]; i++) {
			walk.add(corners[(i + 1) % 4]);
		}
		double from = bearing(walk.get(0).sub(apex));
		double sweep = (bearing(walk.get(walk.size() - 1).sub(apex)) - from + 360) % 360;
		return new Object[] {apex, from, sweep, walk};
	}

	/** A direction's angle clockwise from up, exactly for the four straight ones. */
	static double bearing(Vec v) {
		if (v.x == 0 && v.y < 0) {
			return 0;
		}
		if (v.y == 0 && v.x > 0) {
			return 90;
		}
		if (v.x == 0 && v.y > 0) {
			return 180;
		}
		if (v.y == 0 && v.x < 0) {
			return 270;
		}
		return (Math.atan2(v.x, -v.y) * 180 / Math.PI + 360) % 360;
	}

	/** A panel's place in its parent, in the parent's coordinates. */
	static double[] panelRect(Panel p, Region r) {
		double extra = p.line != null ? p.line.depth / 2 : 0;
		switch (p.side) {
		case "hoist":
			return new double[] {0, 0, p.width + extra, r.h};
		case "fly":
			return new double[] {r.w - p.width - extra, 0, p.width + extra, r.h};
		case "top":
			return new double[] {0, 0, r.w, p.width + extra};
		case "bottom":
			return new double[] {0, r.h - p.width - extra, r.w, p.width + extra};
		default:
		}
		switch (p.corner) {
		case "upper-hoist":
			return new double[] {0, 0, p.fly, p.hoist};
		case "upper-fly":
			return new double[] {r.w - p.fly, 0, p.fly, p.hoist};
		case "lower-hoist":
			return new double[] {0, r.h - p.hoist, p.fly, p.hoist};
		case "lower-fly":
			return new double[] {r.w - p.fly, r.h - p.hoist, p.fly, p.hoist};
		default:
		}
		Vec at = p.at != null ? new Vec(p.at.fly, p.at.hoist) : r.center();
		return new double[] {at.x - p.fly / 2, at.y - p.hoist / 2, p.fly, p.hoist};
	}

	/**
	 * A panel's outline when it has a shaped edge, in its own coordinates. A line whose last point
	 * falls short of the side's end runs on flat to it, as one between bars does.
	 */
	static List<Vec> panelEdge(Panel p, double w, double h) {
		double span = p.side.equals("hoist") || p.side.equals("fly") ? h : w;
		double[][] pts = linePoints(p.line, span);
		double[] along = pts[0], offset = pts[1];
		int last = along.length - 1;
		if (span - along[last] > 1e-9 * span) {
			along = java.util.Arrays.copyOf(along, along.length + 1);
			offset = java.util.Arrays.copyOf(offset, offset.length + 1);
			along[last + 1] = span;
			offset[last + 1] = offset[last];
		}
		double half = p.line.depth / 2;
		List<Vec> points = new ArrayList<>();
		switch (p.side) {
		case "hoist":
			points.add(new Vec(0, 0));
			for (int i = 0; i < along.length; i++) {
				points.add(new Vec(w - half + offset[i], along[i]));
			}
			points.add(new Vec(0, h));
			break;
		case "fly":
			points.add(new Vec(w, 0));
			for (int i = 0; i < along.length; i++) {
				points.add(new Vec(half - offset[i], along[i]));
			}
			points.add(new Vec(w, h));
			break;
		case "top":
			points.add(new Vec(0, 0));
			for (int i = 0; i < along.length; i++) {
				points.add(new Vec(along[i], h - half + offset[i]));
			}
			points.add(new Vec(w, 0));
			break;
		default:
			points.add(new Vec(0, h));
			for (int i = 0; i < along.length; i++) {
				points.add(new Vec(along[i], half - offset[i]));
			}
			points.add(new Vec(w, h));
		}
		return points;
	}
}
