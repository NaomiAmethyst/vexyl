// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import name.amethyst.vexyl.Model.*;

/**
 * The canonical model, as section 4 of the SDK defines it and conformance/model.schema.json
 * writes it out. Names are the format's own terms. A value is left out only if it equals the
 * format's default, so a zero that means something stays.
 */
final class Canonical {
	private Canonical() {}

	private static Map<String, Object> object() {
		return new LinkedHashMap<>();
	}

	@SuppressWarnings("unchecked")
	static Map<String, Object> model(Doc f) {
		Map<String, Object> m = object();
		m.put("vexyl", f.version);
		m.put("meta", meta(f.meta));
		m.put("palette", palette(f));
		m.put("proportion", proportion(f.hoist, f.fly));
		if (f.outline != null) {
			m.put("outline", outline(f.outline));
		}
		if (f.border != null) {
			m.put("border", border(f.border, f.borderOutside));
		}
		if (!f.defines.isEmpty()) {
			Map<String, Object> defines = object();
			f.defines.forEach((name, d) -> defines.put(name, define(d)));
			m.put("define", defines);
		}
		if (!f.layers.isEmpty()) {
			m.put("layers", layers(f.layers));
		}
		if (f.reverse != null) {
			Map<String, Object> r = object();
			r.put("layers", layers(f.reverse.layers));
			m.put("reverse", r);
		}
		if (f.adapt != null) {
			m.put("adapt", adapt(f.adapt));
		}
		if (!f.variants.isEmpty()) {
			Map<String, Object> variants = object();
			f.variants.forEach((name, v) -> variants.put(name, variant(v)));
			m.put("variant", variants);
		}
		if (!f.folds.isEmpty()) {
			Map<String, Object> folds = object();
			f.folds.forEach((name, fold) -> folds.put(name, fold(fold)));
			m.put("fold", folds);
		}
		return (Map<String, Object>) freeze(m);
	}

	/** Makes the model's maps and lists unchangeable, all the way down. */
	private static Object freeze(Object value) {
		if (value instanceof Map) {
			Map<String, Object> out = new LinkedHashMap<>();
			((Map<?, ?>) value).forEach((k, v) -> out.put((String) k, freeze(v)));
			return Collections.unmodifiableMap(out);
		}
		if (value instanceof List) {
			List<Object> out = new ArrayList<>();
			for (Object v : (List<?>) value) {
				out.add(freeze(v));
			}
			return Collections.unmodifiableList(out);
		}
		return value;
	}

	private static Map<String, Object> proportion(double hoist, double fly) {
		Map<String, Object> m = object();
		m.put("hoist", hoist);
		m.put("fly", fly);
		return m;
	}

	private static void text(Map<String, Object> m, String key, String value) {
		if (value != null && !value.isEmpty()) {
			m.put(key, value);
		}
	}

	/** Leaves out a number that equals its default. */
	private static void number(Map<String, Object> m, String key, double value, double otherwise) {
		if (value != otherwise) {
			m.put(key, value);
		}
	}

	private static void list(Map<String, Object> m, String key, List<String> values) {
		if (!values.isEmpty()) {
			m.put(key, new ArrayList<Object>(values));
		}
	}

	private static void flag(Map<String, Object> m, String key, boolean value) {
		if (value) {
			m.put(key, true);
		}
	}

	private static void point(Map<String, Object> m, String key, Point p) {
		if (p != null) {
			m.put(key, point(p));
		}
	}

	private static Map<String, Object> point(Point p) {
		Map<String, Object> m = object();
		m.put("fly", p.fly);
		m.put("hoist", p.hoist);
		return m;
	}

	private static List<Object> numbers(double[] values) {
		List<Object> out = new ArrayList<>();
		for (double v : values) {
			out.add(v);
		}
		return out;
	}

	private static Map<String, Object> meta(Meta meta) {
		Map<String, Object> m = object();
		m.put("name", meta.name);
		text(m, "description", meta.description);
		text(m, "version", meta.version);
		text(m, "date", meta.date);
		text(m, "until", meta.until);
		text(m, "series", meta.series);
		list(m, "note", meta.notes);
		if (!meta.laws.isEmpty()) {
			m.put("law", references("law", meta.laws));
		}
		if (!meta.restrictions.isEmpty()) {
			m.put("restriction", references("restriction", meta.restrictions));
		}
		list(m, "designer", meta.designers);
		text(m, "design-rights", meta.designRights);
		list(m, "encoder", meta.encoders);
		text(m, "license", meta.license);
		text(m, "render-license", meta.renderLicense);
		if (!meta.adaptedFrom.isEmpty()) {
			List<Object> works = new ArrayList<>();
			for (Adaptation a : meta.adaptedFrom) {
				Map<String, Object> work = object();
				work.put("url", a.url);
				list(work, "author", a.authors);
				text(work, "license", a.license);
				text(work, "part", a.part);
				works.add(work);
			}
			m.put("adapted-from", works);
		}
		list(m, "source", meta.sources);
		return m;
	}

	private static List<Object> references(String node, List<Reference> refs) {
		List<Object> out = new ArrayList<>();
		for (Reference r : refs) {
			Map<String, Object> ref = object();
			ref.put(node, r.text);
			list(ref, "source", r.sources);
			out.add(ref);
		}
		return out;
	}

	@SuppressWarnings("unchecked")
	private static Map<String, Object> palette(Doc f) {
		Map<String, Object> palette = object();
		f.palette.forEach((name, value) -> {
			Map<String, Object> color = object();
			color.put("color", value);
			for (ColorRef ref : f.colorRefs.getOrDefault(name, List.of())) {
				if (ref.other) {
					List<Object> others = (List<Object>) color.computeIfAbsent("reference", k -> new ArrayList<Object>());
					Map<String, Object> r = object();
					r.put("system", ref.system);
					r.put("value", ref.value);
					others.add(r);
				} else if (ref.system.equals("cmyk")) {
					color.put("cmyk", numbers(ref.numbers));
				} else if (ref.system.equals("dye")) {
					((List<Object>) color.computeIfAbsent("dye", k -> new ArrayList<Object>())).add(ref.value);
				} else {
					color.put(ref.system, ref.value);
				}
			}
			palette.put(name, color);
		});
		f.gradients.forEach((name, g) -> {
			Map<String, Object> gradient = object();
			gradient.put("gradient", new ArrayList<Object>(g.colors));
			gradient.put("stops", numbers(g.stops));
			if (!g.along.equals("fly")) {
				gradient.put("along", g.along);
			}
			palette.put(name, gradient);
		});
		return palette;
	}

	private static Map<String, Object> border(Edge e, boolean outside) {
		Map<String, Object> m = edge(e);
		if (outside) {
			m.put("side", "outside");
		}
		return m;
	}

	private static Map<String, Object> edge(Edge e) {
		Map<String, Object> m = object();
		m.put("color", e.color);
		m.put("width", e.width);
		return m;
	}

	private static Map<String, Object> outline(Outline o) {
		Map<String, Object> m = object();
		m.put("form", o.kind);
		switch (o.kind) {
		case "polygon":
			m.put("point", points(o.vertices));
			break;
		case "path":
			m.put("d", o.d);
			m.put("box", numbers(o.box));
			break;
		default:
			number(m, "depth", o.depth, 0);
			number(m, "taper", o.taper, 0);
			number(m, "tongue", o.tongue, 0);
			number(m, "tip", o.tip, 0);
		}
		return m;
	}

	private static List<Object> points(List<Point> points) {
		List<Object> out = new ArrayList<>();
		for (Point p : points) {
			out.add(point(p));
		}
		return out;
	}

	private static Map<String, Object> define(Define d) {
		if (d.shape != null) {
			return shape(d.shape);
		}
		Map<String, Object> m = object();
		m.put("layers", layers(d.layers));
		if (d.fly != 0) {
			m.put("proportion", proportion(d.hoist, d.fly));
		}
		return m;
	}

	private static Map<String, Object> adapt(Adapt a) {
		Map<String, Object> m = object();
		if (a.max != 0) {
			m.put("range", numbers(new double[] {a.min, a.max}));
		}
		text(m, "wider", a.wider);
		text(m, "narrower", a.narrower);
		return m;
	}

	private static Map<String, Object> variant(Variant v) {
		Map<String, Object> m = object();
		if (!v.from.equals("none")) {
			m.put("from", v.from);
		}
		flag(m, "upright", v.upright);
		number(m, "ratio", v.ratio, 0);
		if (v.fly != 0) {
			m.put("proportion", proportion(v.hoist, v.fly));
		}
		if (v.outline != null) {
			m.put("outline", outline(v.outline));
		}
		if (v.border != null) {
			m.put("border", border(v.border, v.borderOutside));
		}
		if (!v.layers.isEmpty()) {
			m.put("layers", layers(v.layers));
		}
		return m;
	}

	private static Map<String, Object> fold(Fold f) {
		Map<String, Object> m = object();
		text(m, "description", f.description);
		list(m, "source", f.sources);
		List<Object> steps = new ArrayList<>();
		for (FoldStep s : f.steps) {
			Map<String, Object> step = object();
			step.put("step", s.kind);
			if (s.through != null) {
				step.put("through", numbers(s.through));
				step.put("move", numbers(s.moveTo));
			} else {
				step.put("along", s.along);
				step.put("at", s.at);
				step.put("move", s.move);
			}
			steps.add(step);
		}
		m.put("steps", steps);
		return m;
	}

	static List<Object> layers(List<? extends Layer> layers) {
		List<Object> out = new ArrayList<>();
		for (Layer l : layers) {
			out.add(layer(l));
		}
		return out;
	}

	private static void effects(Map<String, Object> m, Layer e) {
		text(m, "anchor", e.anchor);
		number(m, "opacity", e.opacity, 1);
		if (!e.blend.equals("normal")) {
			m.put("blend", e.blend);
		}
		if (e.clip != null) {
			m.put("clip", shape(e.clip));
		}
		if (!e.cuts.isEmpty()) {
			List<Object> cuts = new ArrayList<>();
			for (Shape s : e.cuts) {
				cuts.add(shape(s));
			}
			m.put("cut", cuts);
		}
	}

	private static void along(Map<String, Object> m, String along) {
		if (!along.equals("fly")) {
			m.put("along", along);
		}
	}

	private static void fimbriate(Map<String, Object> m, Edge e) {
		if (e != null) {
			m.put("fimbriate", edge(e));
		}
	}

	private static void line(Map<String, Object> m, Line l) {
		if (l == null) {
			return;
		}
		Map<String, Object> edge = object();
		edge.put("form", l.kind);
		edge.put("depth", l.depth);
		number(edge, "period", l.period, 0);
		if (l.count != 0) {
			edge.put("count", l.count);
		}
		m.put("edge", edge);
	}

	private static Map<String, Object> layer(Layer l) {
		Map<String, Object> m = object();
		effects(m, l);
		if (l instanceof Field) {
			m.put("layer", "field");
			m.put("color", ((Field) l).color);
		} else if (l instanceof Bars) {
			Bars t = (Bars) l;
			m.put("layer", "bars");
			m.put("colors", new ArrayList<Object>(t.colors));
			m.put("ratio", numbers(t.ratio));
			along(m, t.along);
			number(m, "rotate", t.rotate, 0);
			if (t.grow != null) {
				m.put("grow", numbers(t.grow));
			}
			line(m, t.line);
		} else if (l instanceof Chevrons) {
			Chevrons t = (Chevrons) l;
			m.put("layer", "chevrons");
			m.put("colors", new ArrayList<Object>(t.colors));
			m.put("ratio", numbers(t.ratio));
			m.put("depth", t.depth);
			if (!t.from.equals("hoist")) {
				m.put("from", t.from);
			}
			number(m, "angle", t.angle, 0);
			if (t.apex != null) {
				m.put("apex", t.apex);
			}
			number(m, "rotate", t.rotate, 0);
			fimbriate(m, t.fimbriate);
		} else if (l instanceof Band) {
			Band t = (Band) l;
			m.put("layer", "band");
			m.put("color", t.color);
			m.put("width", t.width);
			along(m, t.along);
			number(m, "offset", t.offset, 0);
			number(m, "rotate", t.rotate, 0);
			fimbriate(m, t.fimbriate);
		} else if (l instanceof Cross) {
			Cross t = (Cross) l;
			m.put("layer", "cross");
			m.put("color", t.color);
			m.put("fly", numbers(t.flyParts));
			m.put("hoist", numbers(t.hoistParts));
			fimbriate(m, t.fimbriate);
		} else if (l instanceof Saltire) {
			Saltire t = (Saltire) l;
			m.put("layer", "saltire");
			m.put("color", t.color);
			m.put("width", t.width);
			fimbriate(m, t.fimbriate);
			flag(m, "counterchange", t.counterchange);
		} else if (l instanceof Quarters) {
			Quarters t = (Quarters) l;
			m.put("layer", "quarters");
			m.put("colors", new ArrayList<Object>(List.of(t.colors)));
			flag(m, "diagonal", t.diagonal);
			point(m, "split", t.split);
		} else if (l instanceof Checks) {
			Checks t = (Checks) l;
			m.put("layer", "checks");
			m.put("colors", new ArrayList<Object>(t.colors));
			m.put("rows", t.rows);
			m.put("columns", t.columns);
			if (!t.flow.equals("bend-sinister")) {
				m.put("flow", t.flow);
			}
		} else if (l instanceof Rays) {
			Rays t = (Rays) l;
			m.put("layer", "rays");
			m.put("colors", new ArrayList<Object>(t.colors));
			m.put("ratio", numbers(t.ratio));
			if (t.at != null) {
				m.put("from", point(t.at));
			} else if (!t.from.equals("center")) {
				m.put("from", t.from);
			}
			number(m, "rotate", t.rotate, 0);
			if (t.byEdge) {
				m.put("measure", "edge");
			}
		} else if (l instanceof Charge) {
			charge(m, (Charge) l);
		} else if (l instanceof Emblem) {
			Emblem t = (Emblem) l;
			m.put("layer", "emblem");
			point(m, "at", t.at);
			if (!t.along.isEmpty()) {
				m.put("along", t.along);
			}
			number(m, "rotate", t.rotate, 0);
			m.put("layers", layers(t.charges));
		} else if (l instanceof Group) {
			m.put("layer", "group");
			m.put("layers", layers(((Group) l).layers));
		} else if (l instanceof Panel) {
			Panel t = (Panel) l;
			m.put("layer", "panel");
			m.put("layers", layers(t.layers));
			if (t.canton) {
				m.put("layer", "canton");
				m.put("fly", t.fly);
				m.put("hoist", t.hoist);
			} else {
				text(m, "side", t.side);
				number(m, "width", t.width, 0);
				text(m, "corner", t.corner);
				point(m, "at", t.at);
				number(m, "fly", t.fly, 0);
				number(m, "hoist", t.hoist, 0);
				line(m, t.line);
			}
		} else if (l instanceof Use) {
			m.put("layer", "use");
			m.put("name", ((Use) l).name);
		}
		return m;
	}

	private static void charge(Map<String, Object> m, Charge c) {
		m.putAll(shape(c.shape));
		m.put("layer", "charge");
		// A pile or pall is a layer of its own, so it has no shape to name.
		if (c.shape.kind.equals("pile") || c.shape.kind.equals("pall")) {
			m.put("layer", c.shape.kind);
			m.remove("shape");
		}
		text(m, "color", c.color);
		fimbriate(m, c.fimbriate);
		Repeat r = c.repeat;
		if (r != null) {
			Map<String, Object> repeat = object();
			repeat.put("form", r.kind);
			switch (r.kind) {
			case "ring":
			case "arc":
				repeat.put("count", r.count);
				repeat.put("radius", r.radius);
				flag(repeat, "turn", r.turn);
				if (r.kind.equals("arc")) {
					repeat.put("from", r.from);
					repeat.put("to", r.to);
				}
				break;
			case "grid":
				repeat.put("rows", r.rows);
				repeat.put("columns", r.columns);
				flag(repeat, "stagger", r.stagger);
				break;
			case "line":
				repeat.put("count", r.count);
				number(repeat, "fly", r.fly, 0);
				number(repeat, "hoist", r.hoist, 0);
				break;
			default:
			}
			m.put("repeat", repeat);
		}
	}

	static Map<String, Object> shape(Shape s) {
		Map<String, Object> m = object();
		m.put("shape", s.kind);
		if (s.ats.size() > 1 || (s.ats.size() == 1 && s.ats.get(0) != null)) {
			List<Object> at = new ArrayList<>();
			for (Point p : s.ats) {
				at.add(p == null ? "center" : point(p));
			}
			m.put("at", at);
		} else if (s.ats.isEmpty() && s.at != null) {
			List<Object> at = new ArrayList<>();
			at.add(point(s.at));
			m.put("at", at);
		}
		number(m, "rotate", s.rotate, 0);
		number(m, "hollow", s.hollow, 0);
		switch (s.kind) {
		case "disc":
		case "triangle":
		case "cardioid":
			m.put("radius", s.radius);
			break;
		case "ellipse":
		case "rect":
		case "lozenge":
			number(m, "fly", s.fly, 0);
			number(m, "hoist", s.hoist, 0);
			break;
		case "ring":
			m.put("radius", s.radius);
			m.put("inner", s.inner);
			if (s.hasArc) {
				m.put("from", s.from);
				m.put("to", s.to);
			}
			break;
		case "plus":
			m.put("radius", s.radius);
			m.put("width", s.width);
			break;
		case "star":
			m.put("radius", s.radius);
			m.put("inner", s.inner);
			if (s.points != 5) {
				m.put("points", s.points);
			}
			number(m, "lines", s.lines, 0);
			break;
		case "crescent":
			m.put("radius", s.radius);
			m.put("inner", s.inner);
			m.put("offset", s.offset);
			break;
		case "sun":
			m.put("radius", s.radius);
			m.put("disc", s.disc);
			number(m, "gap", s.gap, 0);
			if (s.points != 12) {
				m.put("points", s.points);
			}
			number(m, "spread", s.spread, 1);
			break;
		case "heart":
			m.put("radius", s.radius);
			m.put("spread", s.spread);
			break;
		case "path":
			m.put("d", s.d);
			m.put("box", numbers(s.box));
			number(m, "fly", s.fly, 0);
			number(m, "hoist", s.hoist, 0);
			flag(m, "evenodd", s.evenOdd);
			break;
		case "polygon":
			m.put("point", points(s.vertices));
			break;
		case "pile":
			if (!s.edge.equals("hoist")) {
				m.put("from", s.edge);
			}
			if (s.base != null) {
				m.put("base", numbers(s.base));
			}
			if (s.tip != null) {
				m.put("tip", numbers(s.tip));
			}
			number(m, "depth", s.depth, 0);
			number(m, "flat", s.flat, 0);
			break;
		case "pall":
			if (!s.edge.equals("hoist")) {
				m.put("from", s.edge);
			}
			m.put("width", s.width);
			number(m, "junction", s.junction, 0);
			break;
		case "svg":
			m.put("fly", s.fly);
			m.put("hoist", s.hoist);
			m.put("markup", s.markup);
			break;
		default:
		}
		return m;
	}
}
