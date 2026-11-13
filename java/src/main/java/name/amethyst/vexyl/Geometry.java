// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Points, polygons and folds, which reading a document checks and rendering draws. */
final class Geometry {
	private Geometry() {}

	static final class Vec {
		final double x, y;

		Vec(double x, double y) {
			this.x = x;
			this.y = y;
		}

		Vec add(Vec b) {
			return new Vec(x + b.x, y + b.y);
		}

		Vec sub(Vec b) {
			return new Vec(x - b.x, y - b.y);
		}

		Vec mul(double k) {
			return new Vec(x * k, y * k);
		}

		double dot(Vec b) {
			return x * b.x + y * b.y;
		}

		/** Turns clockwise as seen by the viewer, since y points down. */
		Vec rotate(double degrees) {
			double r = Math.toRadians(degrees);
			double s = Math.sin(r), c = Math.cos(r);
			return new Vec(x * c - y * s, x * s + y * c);
		}
	}

	static List<Vec> rectPoly(double x0, double y0, double x1, double y1) {
		List<Vec> out = new ArrayList<>();
		out.add(new Vec(x0, y0));
		out.add(new Vec(x1, y0));
		out.add(new Vec(x1, y1));
		out.add(new Vec(x0, y1));
		return out;
	}

	/** An outline's corners on a flag w wide and h high, or null if it's curved. */
	static List<Vec> outlinePoints(Model.Outline o, double w, double h) {
		List<Vec> out = new ArrayList<>();
		switch (o.kind) {
		case "polygon":
			for (Model.Point p : o.vertices) {
				out.add(new Vec(p.fly, p.hoist));
			}
			return out;
		case "swallowtail":
			return List.of(new Vec(0, 0), new Vec(w, o.taper), new Vec(w - o.depth, h / 2), new Vec(w, h - o.taper), new Vec(0, h));
		case "tongued": {
			double a = (h - o.tongue) / 2;
			return List.of(new Vec(0, 0), new Vec(w, 0), new Vec(w - o.depth, a), new Vec(w, h / 2),
					new Vec(w - o.depth, h - a), new Vec(w, h), new Vec(0, h));
		}
		case "pennant": {
			double a = (h - o.tip) / 2;
			if (o.tip == 0) {
				return List.of(new Vec(0, 0), new Vec(w, h / 2), new Vec(0, h));
			}
			return List.of(new Vec(0, 0), new Vec(w, a), new Vec(w, h - a), new Vec(0, h));
		}
		default:
			return null;
		}
	}

	/** The flag's shape before any outside border, or null for a curved outline. */
	static List<Vec> boundary(Model.Doc f) {
		if (f.outline == null) {
			return rectPoly(0, 0, f.fly, f.hoist);
		}
		return outlinePoints(f.outline, f.fly, f.hoist);
	}

	/**
	 * Moves a polygon's edges outward by a distance, keeping its angles mitered. It fails on
	 * polygons with no area, repeated points or edges that fold back on themselves, where outward
	 * has no meaning.
	 */
	static List<Vec> offsetPolygon(List<Vec> poly, double distance) throws VexylException {
		double area = 0;
		int n = poly.size();
		for (int i = 0; i < n; i++) {
			Vec p = poly.get(i), q = poly.get((i + 1) % n);
			area += p.x * q.y - q.x * p.y;
		}
		if (area == 0) {
			throw new VexylException("shape has no area, so it can't have an outside border");
		}
		double side = area < 0 ? -1 : 1;
		List<Vec> out = new ArrayList<>();
		for (int i = 0; i < n; i++) {
			Vec p = poly.get(i);
			Vec n1 = normal(poly.get((i + n - 1) % n), p, side);
			Vec n2 = normal(p, poly.get((i + 1) % n), side);
			if (n1 == null || n2 == null) {
				throw new VexylException("shape repeats a point, so it can't have an outside border");
			}
			double turn = 1 + n1.dot(n2);
			if (turn < 1e-9) {
				throw new VexylException("shape folds back on itself, so it can't have an outside border");
			}
			out.add(p.add(n1.add(n2).mul(distance / turn)));
		}
		return out;
	}

	private static Vec normal(Vec a, Vec b, double side) {
		double l = Math.hypot(b.x - a.x, b.y - a.y);
		if (l == 0) {
			return null;
		}
		return new Vec(side * (b.y - a.y) / l, -side * (b.x - a.x) / l);
	}

	static double polyArea(List<Vec> poly) {
		double sum = 0;
		int n = poly.size();
		for (int i = 0; i < n; i++) {
			Vec p = poly.get(i), q = poly.get((i + 1) % n);
			sum += p.x * q.y - q.x * p.y;
		}
		return Math.abs(sum) / 2;
	}

	/** Maps (x, y) to (a*x + c*y + e, b*x + d*y + f), as SVG writes it. */
	static final class Matrix {
		final double a, b, c, d, e, f;

		Matrix(double a, double b, double c, double d, double e, double f) {
			this.a = a;
			this.b = b;
			this.c = c;
			this.d = d;
			this.e = e;
			this.f = f;
		}

		static final Matrix IDENTITY = new Matrix(1, 0, 0, 1, 0, 0);

		Vec apply(Vec p) {
			return new Vec(a * p.x + c * p.y + e, b * p.x + d * p.y + f);
		}

		/** The transform that applies this, followed by n. */
		Matrix then(Matrix n) {
			return new Matrix(
					n.a * a + n.c * b, n.b * a + n.d * b,
					n.a * c + n.c * d, n.b * c + n.d * d,
					n.a * e + n.c * f + n.e, n.b * e + n.d * f + n.f);
		}

		/** Reflects across the line through p and q. */
		static Matrix reflection(Vec p, Vec q) {
			Vec d = q.sub(p);
			double l = d.dot(d);
			double cos = (d.x * d.x - d.y * d.y) / l, sin = 2 * d.x * d.y / l;
			return new Matrix(cos, sin, sin, -cos, p.x - cos * p.x - sin * p.y, p.y - sin * p.x + cos * p.y);
		}
	}

	/**
	 * A flat piece of the folded flag. Its polygon is where it now lies, and its transform takes
	 * the flag's coordinates there. Facets are kept from back to front, and flipped ones show the
	 * flag's other side.
	 */
	static final class Facet {
		final List<Vec> poly;
		final Matrix place;
		final boolean flipped;

		Facet(List<Vec> poly, Matrix place, boolean flipped) {
			this.poly = poly;
			this.place = place;
			this.flipped = flipped;
		}
	}

	/** Keeps the part of a polygon on one side of a line. */
	static List<Vec> halfPlane(List<Vec> poly, Vec a, Vec b, double side) {
		Vec d = b.sub(a);
		List<Vec> out = new ArrayList<>();
		int n = poly.size();
		for (int i = 0; i < n; i++) {
			Vec cur = poly.get(i), prev = poly.get((i + n - 1) % n);
			double vc = side * (d.x * (cur.y - a.y) - d.y * (cur.x - a.x));
			double vp = side * (d.x * (prev.y - a.y) - d.y * (prev.x - a.x));
			if ((vc >= 0) != (vp >= 0)) {
				out.add(prev.add(cur.sub(prev).mul(vp / (vp - vc))));
			}
			if (vc >= 0) {
				out.add(cur);
			}
		}
		return out;
	}

	/** Folds a flat shape through a number of steps, or all of them if steps is 0. */
	static List<Facet> foldFacets(List<Vec> shape, Model.Fold fold, int steps) throws VexylException {
		List<Facet> stack = new ArrayList<>();
		stack.add(new Facet(shape, Matrix.IDENTITY, false));
		double limit = polyArea(shape) * 1e-9;
		for (int i = 0; i < fold.steps.size(); i++) {
			if (steps > 0 && i == steps) {
				break;
			}
			Model.FoldStep step = fold.steps.get(i);
			Vec a = new Vec(step.a.fly, step.a.hoist), b = new Vec(step.b.fly, step.b.hoist);
			Vec moving = new Vec(step.moving.fly, step.moving.hoist);
			Vec d = b.sub(a);
			double side = d.x * (moving.y - a.y) - d.y * (moving.x - a.x);
			if (side == 0 || d.dot(d) == 0) {
				throw new VexylException(String.format("fold step %d: its point to move is on its crease", i + 1));
			}
			side = side < 0 ? -1 : 1;
			Matrix mirror = Matrix.reflection(a, b);
			List<Facet> kept = new ArrayList<>(), moved = new ArrayList<>();
			for (Facet f : stack) {
				List<Vec> part = halfPlane(f.poly, a, b, -side);
				if (polyArea(part) > limit) {
					kept.add(new Facet(part, f.place, f.flipped));
				}
				part = halfPlane(f.poly, a, b, side);
				if (polyArea(part) > limit) {
					List<Vec> reflected = new ArrayList<>();
					for (Vec p : part) {
						reflected.add(mirror.apply(p));
					}
					moved.add(new Facet(reflected, f.place.then(mirror), !f.flipped));
				}
			}
			if (moved.isEmpty()) {
				throw new VexylException(String.format("fold step %d: nothing is on the side it moves", i + 1));
			}
			if (kept.isEmpty()) {
				throw new VexylException(String.format("fold step %d: nothing is left on the other side of its crease", i + 1));
			}
			if (kept.size() + moved.size() > Limits.MAX_FACETS) {
				throw new VexylException(String.format("fold step %d: makes more than %d pieces", i + 1, Limits.MAX_FACETS));
			}
			// Whichever way it goes, the moving stack lands in reverse order.
			Collections.reverse(moved);
			switch (step.kind) {
			case "over":
				kept.addAll(moved);
				stack = kept;
				break;
			case "under":
				moved.addAll(kept);
				stack = moved;
				break;
			default:
				// A tuck goes inside the fold, out of sight.
				stack = kept;
			}
		}
		return stack;
	}

	/** The flat shape a flag folds as, including an outside border. */
	static List<Vec> foldShape(Model.Doc f) throws VexylException {
		List<Vec> shape = boundary(f);
		if (shape == null) {
			// A curved outline folds as its rectangle, with the flag's own clip inside.
			shape = rectPoly(0, 0, f.fly, f.hoist);
		}
		if (f.border != null && f.borderOutside) {
			return offsetPolygon(shape, f.border.width);
		}
		return shape;
	}
}
