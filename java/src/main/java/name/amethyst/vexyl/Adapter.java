// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import name.amethyst.vexyl.Geometry.Vec;
import name.amethyst.vexyl.Model.*;
import name.amethyst.vexyl.Shapes.Region;

/** Moves layers along one axis as their region changes size, as section 11 of the format says. */
final class Adapter {
	private final String axis;
	private final String anchor;
	/** An anchor that a container passed on to its layers, if one did. */
	private String passed = "";
	/** Says that the layers are a reverse's own, with the hoist on the right. */
	private final boolean fromBehind;
	/** The region's size across the axis, which stays the same. */
	private double other;
	private String err;

	private Adapter(String axis, String anchor, boolean fromBehind, double other) {
		this.axis = axis;
		this.anchor = anchor;
		this.fromBehind = fromBehind;
		this.other = other;
	}

	/** The flag at another proportion, as fly divided by hoist, following its adapt rules. */
	static Doc withRatio(Doc f, double ratio) throws VexylException {
		double current = f.fly / f.hoist;
		if (Math.abs(ratio - current) < 1e-9 * current) {
			return f;
		}
		if (f.adapt == null) {
			throw new VexylException(f.meta.name + " doesn't say how it adapts to other proportions");
		}
		if ((f.adapt.min > 0 && ratio < f.adapt.min) || (f.adapt.max > 0 && ratio > f.adapt.max)) {
			throw new VexylException(f.meta.name + " only adapts between ratios of " + Json.number(f.adapt.min)
					+ " and " + Json.number(f.adapt.max));
		}
		String mode = ratio > current ? f.adapt.wider : f.adapt.narrower;
		if (mode.isEmpty()) {
			throw new VexylException(f.meta.name + " has no rule for this direction of change");
		}
		Doc out = f.copy();
		boolean onHoist = mode.startsWith("hoist-");
		String base = onHoist ? mode.substring("hoist-".length()) : mode;
		String anchor = Map.of("extend", "start", "center", "center", "scale", "scale").get(base);
		Adapter a;
		if (onHoist) {
			a = new Adapter("hoist", anchor, f.seenFromBehind, f.fly);
			out.hoist = f.fly / ratio;
			out.layers = a.layers(f.layers, f.hoist, out.hoist);
		} else {
			a = new Adapter("fly", anchor, f.seenFromBehind, f.hoist);
			out.fly = f.hoist * ratio;
			out.layers = a.layers(f.layers, f.fly, out.fly);
		}
		if (f.outline != null && f.outline.kind.equals("polygon")) {
			// A silhouette has no sensible anchor, so a drawn one stretches with the flag.
			Outline o = f.outline.copy();
			o.vertices = new ArrayList<>();
			for (Point p : f.outline.vertices) {
				o.vertices.add(new Point(p.fly * out.fly / f.fly, p.hoist * out.hoist / f.hoist));
			}
			out.outline = o;
		}
		if (a.err != null) {
			throw new VexylException(a.err);
		}
		return out;
	}

	/** The proportion closest to a target that the flag's rules allow. */
	static double nearestRatio(Doc f, double target) {
		double current = f.fly / f.hoist;
		if (f.adapt == null) {
			return current;
		}
		if ((target > current && f.adapt.wider.isEmpty()) || (target < current && f.adapt.narrower.isEmpty())) {
			return current;
		}
		if (f.adapt.min > 0) {
			target = Math.max(target, f.adapt.min);
		}
		if (f.adapt.max > 0) {
			target = Math.min(target, f.adapt.max);
		}
		return target;
	}

	/** A layer's anchor: its own, or one passed on to it, or the rule's, and whether it was given one. */
	private String anchorOf(Layer e) {
		String anchor = e.anchor;
		if (anchor.isEmpty()) {
			anchor = passed;
		}
		if (anchor.isEmpty()) {
			anchor = this.anchor;
		}
		if (fromBehind && axis.equals("fly")) {
			// Seen from behind, the hoist is on the right, and start is still the hoist.
			if (anchor.equals("start")) {
				anchor = "end";
			} else if (anchor.equals("end")) {
				anchor = "start";
			}
		}
		return anchor;
	}

	private boolean given(Layer e) {
		return !e.anchor.isEmpty() || !passed.isEmpty();
	}

	/** Adapts a container's layers with its anchor, if it gives one. */
	private void passOn(Layer e, Runnable adapt) {
		String was = passed;
		if (!e.anchor.isEmpty()) {
			passed = e.anchor;
		}
		adapt.run();
		passed = was;
	}

	/** The region's center, for pinning what's there to an anchor. */
	private Point center(double old) {
		if (axis.equals("hoist")) {
			return new Point(other / 2, old / 2);
		}
		return new Point(old / 2, other / 2);
	}

	private void fail(String message) {
		if (err == null) {
			err = message;
		}
	}

	private List<Layer> layers(List<? extends Layer> layers, double old, double now) {
		List<Layer> out = new ArrayList<>();
		for (Layer l : layers) {
			out.add(layer(l, old, now));
		}
		return out;
	}

	/** Maps a position along the axis, by a layer's anchor. */
	static double move(double x, double old, double now, String anchor) {
		switch (anchor) {
		case "center":
			return x + (now - old) / 2;
		case "end":
			return x + now - old;
		case "scale":
			return x * now / old;
		default:
			return x;
		}
	}

	private Point point(Point p, double old, double now, String anchor) {
		if (p == null) {
			return null;
		}
		if (axis.equals("fly")) {
			return new Point(move(p.fly, old, now, anchor), p.hoist);
		}
		return new Point(p.fly, move(p.hoist, old, now, anchor));
	}

	/**
	 * Moves a shape, which keeps its own form unless it's drawn from points. The center stays the
	 * center, so a charge there follows it unless anchored otherwise.
	 */
	private Shape shape(Shape in, double old, double now, String anchor, boolean explicit) {
		Shape s = in.copy();
		double k = now / old;
		if (s.at == null && explicit && !anchor.equals("scale") && !s.kind.equals("polygon")) {
			s.at = center(old);
		}
		s.at = point(s.at, old, now, anchor);
		List<Point> ats = new ArrayList<>();
		for (Point p : in.ats) {
			ats.add(point(p, old, now, anchor));
		}
		s.ats = ats;
		List<Point> vertices = new ArrayList<>();
		for (Point p : in.vertices) {
			vertices.add(point(p, old, now, anchor));
		}
		s.vertices = vertices;
		if (anchor.equals("scale")) {
			switch (s.kind) {
			case "rect":
			case "lozenge":
			case "ellipse":
				if (axis.equals("fly")) {
					s.fly *= k;
				} else {
					s.hoist *= k;
				}
				break;
			default:
			}
		}
		// Piles and palls are set from their edge, so depths only change when scaling, and
		// positions along the edge move like any other.
		if (s.kind.equals("pile") || s.kind.equals("pall")) {
			boolean runsAlongAxis = (s.edge.equals("hoist") || s.edge.equals("fly")) == axis.equals("fly");
			if (runsAlongAxis) {
				if (anchor.equals("scale")) {
					s.depth *= k;
					s.junction *= k;
					if (s.tip != null) {
						s.tip = new double[] {s.tip[0], s.tip[1] * k};
					}
				}
			} else {
				if (s.base != null) {
					s.base = new double[] {move(s.base[0], old, now, anchor), move(s.base[1], old, now, anchor)};
				}
				if (s.tip != null) {
					s.tip = new double[] {move(s.tip[0], old, now, anchor), s.tip[1]};
				}
			}
		}
		return s;
	}

	/** Copies a layer with its clip and cuts moved, and gives its anchor. */
	private String effects(Layer c, Layer e, double old, double now) {
		String anchor = anchorOf(e);
		if (e.clip != null) {
			c.clip = shape(e.clip, old, now, anchor, false);
		}
		List<Shape> cuts = new ArrayList<>();
		for (Shape s : e.cuts) {
			cuts.add(shape(s, old, now, anchor, false));
		}
		c.cuts = cuts;
		return anchor;
	}

	/** Shares a change in size across parts along the axis, by a layer's anchor. */
	private double[] parts(String what, double[] parts, double old, double now, String anchor) {
		double total = 0;
		for (double p : parts) {
			total += p;
		}
		double[] out = new double[parts.length];
		for (int i = 0; i < parts.length; i++) {
			out[i] = parts[i] * old / total;
		}
		double d = now - old;
		int last = out.length - 1;
		int[] changed;
		switch (anchor) {
		case "start":
			out[last] += d;
			changed = new int[] {last};
			break;
		case "end":
			out[0] += d;
			changed = new int[] {0};
			break;
		case "center":
			out[0] += d / 2;
			out[last] += d / 2;
			changed = new int[] {0, last};
			break;
		default:
			return parts;
		}
		for (int i : changed) {
			keep(what, out[i], old);
		}
		return out;
	}

	/** Refuses a part that a change of size has brought to nothing, allowing for rounding. */
	private void keep(String what, double part, double old) {
		if (part <= 1e-9 * old) {
			fail(what + " can't be cut to this proportion");
		}
	}

	private Layer layer(Layer l, double old, double now) {
		double k = now / old;
		if (l instanceof Bars) {
			Bars t = (Bars) l;
			Bars c = (Bars) t.copy();
			String anchor = effects(c, t, old, now);
			if (t.rotate != 0) {
				return rotatedBars(c, old, now, anchor);
			}
			if (axis.equals("fly") != t.along.equals("hoist") || t.along.equals("bend") || t.along.equals("bend-sinister")) {
				return c;
			}
			if (t.grow != null) {
				double total = 0, weights = 0;
				for (int i = 0; i < t.ratio.length; i++) {
					total += t.ratio[i];
					weights += t.grow[i];
				}
				if (weights > 0) {
					c.ratio = new double[t.ratio.length];
					for (int i = 0; i < t.ratio.length; i++) {
						c.ratio[i] = t.ratio[i] * old / total + (now - old) * t.grow[i] / weights;
						if (t.grow[i] > 0) {
							keep("bars", c.ratio[i], old);
						}
					}
					return c;
				}
			}
			c.ratio = parts("bars", t.ratio, old, now, anchor);
			return c;
		}
		if (l instanceof Chevrons) {
			Chevrons t = (Chevrons) l;
			Chevrons c = (Chevrons) t.copy();
			String anchor = effects(c, t, old, now);
			boolean alongAxis = (t.from.equals("hoist") || t.from.equals("fly")) == axis.equals("fly");
			if (alongAxis && anchor.equals("scale")) {
				c.depth *= k;
			} else if (!alongAxis && t.apex != null) {
				c.apex = move(t.apex, old, now, anchor);
			}
			return c;
		}
		if (l instanceof Band) {
			Band t = (Band) l;
			Band c = (Band) t.copy();
			String anchor = effects(c, t, old, now);
			if (t.rotate != 0) {
				// It keeps its angle and width, and its center line moves like any position.
				Region before = regions(old, now)[0];
				Region frame = Shapes.frame(t.fixed, before);
				Vec center = Shapes.frameCenter(t.fixed, before);
				Vec normal = Shapes.axis(frame, t.along, t.rotate)[1];
				Vec moved = moveVec(center.add(normal.mul(t.offset)), old, now, anchor);
				c.fixed = new FixedFrame(frame.w, frame.h, moved.x, moved.y);
				c.offset = 0;
				return c;
			}
			boolean acrossAxis = (axis.equals("fly") && t.along.equals("hoist")) || (axis.equals("hoist") && t.along.equals("fly"));
			if (acrossAxis) {
				switch (anchor) {
				case "start":
					c.offset -= (now - old) / 2;
					break;
				case "end":
					c.offset += (now - old) / 2;
					break;
				case "scale":
					c.offset *= k;
					c.width *= k;
					break;
				default:
				}
			}
			return c;
		}
		if (l instanceof Cross) {
			Cross t = (Cross) l;
			Cross c = (Cross) t.copy();
			String anchor = effects(c, t, old, now);
			if (axis.equals("fly")) {
				c.flyParts = parts("a cross", t.flyParts, old, now, anchor).clone();
			} else {
				c.hoistParts = parts("a cross", t.hoistParts, old, now, anchor).clone();
			}
			return c;
		}
		if (l instanceof Quarters) {
			Quarters t = (Quarters) l;
			Quarters c = (Quarters) t.copy();
			String anchor = effects(c, t, old, now);
			c.split = point(t.split, old, now, anchor);
			return c;
		}
		if (l instanceof Rays) {
			Rays t = (Rays) l;
			Rays c = (Rays) t.copy();
			String anchor = effects(c, t, old, now);
			c.at = point(t.at, old, now, anchor);
			return c;
		}
		if (l instanceof Charge) {
			Charge t = (Charge) l;
			Charge c = (Charge) t.copy();
			String anchor = effects(c, t, old, now);
			c.shape = shape(t.shape, old, now, anchor, given(t));
			if (t.repeat != null && t.repeat.kind.equals("line") && anchor.equals("scale")) {
				Repeat r = t.repeat.copy();
				if (axis.equals("fly")) {
					r.fly *= k;
				} else {
					r.hoist *= k;
				}
				c.repeat = r;
			}
			return c;
		}
		if (l instanceof Emblem) {
			Emblem t = (Emblem) l;
			Emblem c = (Emblem) t.copy();
			String anchor = effects(c, t, old, now);
			if (c.at == null && given(t) && !anchor.equals("scale")) {
				// One at the center that's given an anchor is pinned to it, as a charge is.
				c.at = center(old);
			}
			c.at = point(c.at, old, now, anchor);
			return c;
		}
		if (l instanceof Group) {
			Group t = (Group) l;
			Group c = (Group) t.copy();
			effects(c, t, old, now);
			passOn(t, () -> c.layers = layers(t.layers, old, now));
			return c;
		}
		if (l instanceof Panel) {
			return panel((Panel) l, old, now);
		}
		if (l instanceof Use) {
			Use t = (Use) l;
			Use c = (Use) t.copy();
			effects(c, t, old, now);
			if (t.design.fly == 0) {
				Define d = new Define();
				d.shape = t.design.shape;
				d.fly = t.design.fly;
				d.hoist = t.design.hoist;
				d.size = t.design.size;
				d.height = t.design.height;
				passOn(t, () -> d.layers = layers(t.design.layers, old, now));
				c.design = d;
			}
			return c;
		}
		// A field, saltire or checks follows its region.
		Layer c = l.copy();
		effects(c, l, old, now);
		return c;
	}

	/** The regions before and after the change. */
	private Region[] regions(double old, double now) {
		if (axis.equals("hoist")) {
			return new Region[] {new Region(other, old), new Region(other, now)};
		}
		return new Region[] {new Region(old, other), new Region(now, other)};
	}

	/** Moves a point along the axis, by a layer's anchor. */
	private Vec moveVec(Vec v, double old, double now, String anchor) {
		if (axis.equals("hoist")) {
			return new Vec(v.x, move(v.y, old, now, anchor));
		}
		return new Vec(move(v.x, old, now, anchor), v.y);
	}

	/** How far a region reaches either side of a point, along a normal. */
	private static double[] spread(Region r, Vec c, Vec normal) {
		double lo = Double.POSITIVE_INFINITY, hi = Double.NEGATIVE_INFINITY;
		for (Vec corner : r.corners()) {
			double offset = corner.sub(c).dot(normal);
			lo = Math.min(lo, offset);
			hi = Math.max(hi, offset);
		}
		return new double[] {lo, hi};
	}

	/**
	 * Keeps a rotated bars' angle, and the lines between its bars where they were about its center,
	 * which moves like any position. The first and last bars reach the new region's corners.
	 */
	private Layer rotatedBars(Bars c, double old, double now, String anchor) {
		Region[] rs = regions(old, now);
		Region before = rs[0], after = rs[1];
		Region frame = Shapes.frame(c.fixed, before);
		Vec center = Shapes.frameCenter(c.fixed, before);
		Vec normal = Shapes.axis(frame, c.along, c.rotate)[1];
		Vec moved = moveVec(center, old, now, anchor);
		double[] was = spread(before, center, normal);
		double[] will = spread(after, moved, normal);
		double lo = was[0], hi = was[1];
		double total = 0;
		for (double part : c.ratio) {
			total += part;
		}
		double[] ratio = new double[c.ratio.length];
		double line = lo, start = will[0];
		for (int i = 0; i < c.ratio.length; i++) {
			line += (hi - lo) * c.ratio[i] / total;
			double end = i == ratio.length - 1 ? will[1] : line;
			ratio[i] = end - start;
			start = end;
		}
		keep("bars", ratio[0], old);
		keep("bars", ratio[ratio.length - 1], old);
		c.ratio = ratio;
		c.fixed = new FixedFrame(frame.w, frame.h, moved.x, moved.y);
		return c;
	}

	/**
	 * Keeps a panel at its edge or corner. One running along the axis grows with its parent, and
	 * only scaling changes the size of any other.
	 */
	private Layer panel(Panel t, double old, double now) {
		double k = now / old;
		Panel c = (Panel) t.copy();
		String anchor = effects(c, t, old, now);
		if (t.side.isEmpty() && t.corner.isEmpty() && c.at == null && given(t) && !anchor.equals("scale")) {
			// One at the center that's given an anchor is pinned to it, as a charge is.
			c.at = center(old);
		}
		c.at = point(c.at, old, now, anchor);
		boolean runsAlong = (axis.equals("fly") && (t.side.equals("top") || t.side.equals("bottom")))
				|| (axis.equals("hoist") && (t.side.equals("hoist") || t.side.equals("fly")));
		double outer = other;
		String was = passed;
		try {
			if (!t.anchor.isEmpty()) {
				passed = t.anchor;
			}
			if (runsAlong) {
				other = t.width;
				c.layers = layers(t.layers, old, now);
				return c;
			}
			if (!anchor.equals("scale")) {
				return c;
			}
			// Everything inside is measured against the panel's own size along the axis.
			double size = t.fly;
			if (!t.side.isEmpty()) {
				size = t.width;
				c.width *= k;
				other = outer;
			} else if (axis.equals("fly")) {
				other = t.hoist;
				c.fly *= k;
			} else {
				size = t.hoist;
				other = t.fly;
				c.hoist *= k;
			}
			c.layers = layers(t.layers, size, size * k);
			return c;
		} finally {
			other = outer;
			passed = was;
		}
	}
}
