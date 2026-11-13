// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import static name.amethyst.vexyl.Shapes.num;
import static name.amethyst.vexyl.Shapes.factor;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import name.amethyst.vexyl.Geometry.Facet;
import name.amethyst.vexyl.Geometry.Matrix;
import name.amethyst.vexyl.Geometry.Vec;
import name.amethyst.vexyl.Model.*;
import name.amethyst.vexyl.Shapes.Geom;
import name.amethyst.vexyl.Shapes.Region;

/** Renders a flag as SVG, as section 6 of the format paints it. */
final class Render {
	private static final Pattern LOCAL_ID = Pattern.compile("[A-Za-z_][A-Za-z0-9_.:-]*");
	private static final String NONE = Parser.NO_COLOR;

	/** How a flag's back turns in a variant, so that it's the mirror image of the turned front. */
	private static final Map<String, String> REVERSE_TURN = Map.of(
			"none", "none", "mirror", "mirror", "half-turn", "half-turn", "invert", "invert",
			"transpose", "anti-transpose", "anti-transpose", "transpose",
			"rotate", "counter-rotate", "counter-rotate", "rotate");

	private Doc flag;
	private final StringBuilder out = new StringBuilder();
	private int depth;
	private int nextID;
	private final Map<String, String> gradients = new HashMap<>();
	/** The transform that undoes a turned variant's rotation. */
	private String upright = "";
	private String idPrefix;
	/** Marks each drawn element with the path of the layer that drew it. */
	private boolean tagging;
	private String scopeLayers = "", scopeBorder = "";
	/** The path of the layer being drawn, and how many use layers it's inside. */
	private String tag = "";
	private int using;

	private Render(Doc flag, String idPrefix) {
		this.flag = flag;
		this.idPrefix = idPrefix;
	}

	/** Refuses what would otherwise be silently ignored, or can't be drawn. */
	private static void checkOptions(Doc f, RenderOptions opts) throws VexylException {
		if (opts.height != null && (opts.height <= 0 || !Limits.inLimits(opts.height))) {
			throw new VexylException("height must be a positive number of a reasonable size");
		}
		if (opts.ratio != null && (opts.ratio <= 0 || !Limits.inLimits(opts.ratio))) {
			throw new VexylException("ratio must be a positive number of a reasonable size");
		}
		if (!opts.idPrefix.isEmpty() && !LOCAL_ID.matcher(opts.idPrefix).matches()) {
			throw new VexylException("idPrefix " + Parser.quote(opts.idPrefix) + " isn't what an ID can start with");
		}
		boolean hasRatio = opts.ratio != null;
		if (!opts.variant.isEmpty()) {
			Variant v = f.variants.get(opts.variant);
			if (v != null && v.ratio != 0) {
				hasRatio = true;
			}
		}
		if (!opts.fit.isEmpty() && !hasRatio) {
			throw new VexylException("fit says what to do about a ratio, and there isn't one");
		}
		if (!opts.align.isEmpty() && !opts.fit.equals("pad")) {
			throw new VexylException("align places a padded flag, so it needs a fit of pad");
		}
		if (opts.fold.isEmpty()) {
			if (opts.foldStep != null) {
				throw new VexylException("foldStep needs a fold");
			}
			return;
		}
		if (opts.side.equals("reverse")) {
			throw new VexylException("a fold shows both sides, so it can't be asked for the reverse");
		}
		if (opts.fit.equals("pad")) {
			throw new VexylException("a fold is cropped to its pieces, so it can't be padded");
		}
		Fold fold = f.folds.get(opts.fold);
		if (fold != null && opts.foldStep != null && (opts.foldStep < 1 || opts.foldStep > fold.steps.size())) {
			throw new VexylException("foldStep must be from 1 to " + fold.steps.size());
		}
	}

	/** A flag with a side, a variant and a proportion applied, and how it's then shown. */
	private static final class Resolved {
		Doc flag;
		String turn = "none";
		boolean upright, mirror;
		/** The proportion to pad the result to, or 0. */
		double canvas;
	}

	static String svg(Doc original, RenderOptions opts) throws VexylException {
		try {
			return write(original, opts);
		} catch (Shapes.Refusal e) {
			throw new VexylException(e.getMessage());
		}
	}

	private static String write(Doc original, RenderOptions opts) throws VexylException {
		checkOptions(original, opts);
		double height = opts.height != null ? opts.height : RenderOptions.DEFAULT_HEIGHT;
		Resolved res = resolve(original, opts);
		Doc f = res.flag;
		Render r = new Render(f, original.idPrefix);
		if (opts.tags) {
			r.tagging = true;
			String[] scope = tagScope(original, opts);
			r.scopeLayers = scope[0];
			r.scopeBorder = scope[1];
		}
		if (!opts.idPrefix.isEmpty()) {
			r.idPrefix = opts.idPrefix;
		} else if (opts.ratio != null || !opts.variant.isEmpty() || !opts.side.isEmpty() || !opts.fit.isEmpty()
				|| !opts.align.isEmpty() || !opts.fold.isEmpty() || opts.foldStep != null) {
			// A page can show several forms of one flag, which mustn't share definitions.
			String key = Json.number(opts.ratio != null ? opts.ratio : 0) + "|" + opts.variant + "|" + opts.side + "|"
					+ opts.fit + "|" + opts.align + "|" + opts.fold + "|" + (opts.foldStep != null ? opts.foldStep : 0);
			r.idPrefix += Parser.hex(sha256(key), 2) + "-";
		}
		if (!opts.fold.isEmpty()) {
			Fold fold = f.folds.get(opts.fold);
			if (fold == null) {
				throw new VexylException(f.meta.name + " has no fold " + Parser.quote(opts.fold));
			}
			if (!res.turn.equals("none")) {
				throw new VexylException("a fold can't be applied to a turned variant");
			}
			r.writeFolded(f, fold, opts, height);
			return r.out.toString();
		}
		double x0 = 0, y0 = 0, width = f.fly, tall = f.hoist;
		if (f.border != null && f.borderOutside) {
			double[] b = Shapes.bounds(Geometry.offsetPolygon(Geometry.boundary(f), f.border.width));
			x0 = b[0];
			y0 = b[1];
			width = b[2];
			tall = b[3];
		}
		String shown = res.turn;
		if (opts.side.equals("reverse")) {
			// Seen from behind, the turned flag is the mirror image of its front.
			shown = REVERSE_TURN.get(res.turn);
		}
		String[] view = view(shown, x0, y0, width, tall);
		String transform = view[0], undo = view[1];
		if (res.mirror) {
			// The back is the mirror image of the front, then turned.
			transform = (transform + " matrix(-1 0 0 1 " + num(2 * x0 + width) + " 0)").trim();
			// A charge is put back the way it is on the back, which is the front's turn undone.
			undo = view(res.turn, x0, y0, width, tall)[1];
		}
		double vx = x0, vy = y0, vw = width, vh = tall;
		boolean sideways = res.turn.equals("rotate") || res.turn.equals("counter-rotate")
				|| res.turn.equals("transpose") || res.turn.equals("anti-transpose");
		if (sideways) {
			vx = y0;
			vy = x0;
			vw = tall;
			vh = width;
		}
		if (res.upright) {
			r.upright = undo;
		}
		if (res.canvas != 0) {
			// The canvas ratio is the design's, so a turned flag's is the other way up.
			double want = sideways ? 1 / res.canvas : res.canvas;
			double share = opts.align.equals("start") ? 0 : opts.align.equals("end") ? 1 : 0.5;
			if (vw / vh < want) {
				double extra = vh * want - vw;
				vx -= extra * share;
				vw += extra;
			} else {
				double extra = vw / want - vh;
				vy -= extra * share;
				vh += extra;
			}
		}
		r.line("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"" + num(vx) + " " + num(vy) + " " + num(vw) + " " + num(vh)
				+ "\" width=\"" + num(height * vw / vh) + "\" height=\"" + num(height) + "\">");
		r.depth++;
		r.line("<title>" + Xml.escape(f.meta.name) + "</title>");
		if (!f.meta.description.isEmpty()) {
			r.line("<desc>" + Xml.escape(f.meta.description) + "</desc>");
		}
		if (!transform.isEmpty()) {
			r.line("<g transform=\"" + transform + "\">");
			r.depth++;
		}
		r.flagArt(f);
		if (!transform.isEmpty()) {
			r.depth--;
			r.line("</g>");
		}
		r.depth--;
		r.line("</svg>");
		return r.out.toString();
	}

	private static byte[] sha256(String s) {
		try {
			return MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
		} catch (NoSuchAlgorithmException e) {
			throw new AssertionError(e);
		}
	}

	/** What starts the paths of a render's layers, and of its border. */
	private static String[] tagScope(Doc f, RenderOptions opts) {
		Variant v = f.variants.get(opts.variant);
		if (opts.variant.isEmpty() || v == null) {
			if (opts.side.equals("reverse") && f.reverse != null) {
				return new String[] {"reverse/", ""};
			}
			return new String[] {"", ""};
		}
		String scope = "variant/" + Locate.encodeName(opts.variant) + "/";
		String layers = "", border = "";
		if (!v.layers.isEmpty()) {
			layers = scope;
		} else if (opts.side.equals("reverse") && f.reverse != null) {
			layers = "reverse/";
		}
		if (v.border != null) {
			border = scope;
		}
		return new String[] {layers, border};
	}

	/** How a variant turns a flag, as a transform and what undoes it for charges. */
	static String[] view(String kind, double x0, double y0, double width, double tall) {
		switch (kind) {
		case "transpose":
			return new String[] {"matrix(0 1 1 0 0 0)", "matrix(0 1 1 0 0 0)"};
		case "rotate":
			return new String[] {"matrix(0 1 -1 0 " + num(2 * y0 + tall) + " 0)", "matrix(0 -1 1 0 0 0)"};
		case "anti-transpose":
			return new String[] {"matrix(0 -1 -1 0 " + num(2 * y0 + tall) + " " + num(2 * x0 + width) + ")", "matrix(0 -1 -1 0 0 0)"};
		case "counter-rotate":
			return new String[] {"matrix(0 -1 1 0 0 " + num(2 * x0 + width) + ")", "matrix(0 1 -1 0 0 0)"};
		case "mirror":
			return new String[] {"matrix(-1 0 0 1 " + num(2 * x0 + width) + " 0)", "matrix(-1 0 0 1 0 0)"};
		case "half-turn":
			return new String[] {"matrix(-1 0 0 -1 " + num(2 * x0 + width) + " " + num(2 * y0 + tall) + ")", "matrix(-1 0 0 -1 0 0)"};
		case "invert":
			return new String[] {"matrix(1 0 0 -1 0 " + num(2 * y0 + tall) + ")", "matrix(1 0 0 -1 0 0)"};
		default:
			return new String[] {"", ""};
		}
	}

	/** Applies a side, a variant and a proportion to the flag. */
	private static Resolved resolve(Doc f, RenderOptions opts) throws VexylException {
		Resolved res = new Resolved();
		Doc out = f.copy();
		double ratio = opts.ratio != null ? opts.ratio : 0;
		Variant variant = null;
		if (!opts.variant.isEmpty()) {
			variant = f.variants.get(opts.variant);
			if (variant == null) {
				throw new VexylException(f.meta.name + " has no variant " + Parser.quote(opts.variant));
			}
		}
		switch (opts.fit) {
		case "": case "error": case "pad":
			break;
		default:
			throw new VexylException("unknown fit " + Parser.quote(opts.fit));
		}
		switch (opts.align) {
		case "": case "start": case "center": case "end":
			break;
		default:
			throw new VexylException("unknown align " + Parser.quote(opts.align));
		}
		switch (opts.side) {
		case "": case "obverse":
			break;
		case "reverse":
			if (f.reverse != null) {
				out.layers = f.reverse.layers;
				out.seenFromBehind = true;
			} else {
				res.mirror = true;
			}
			break;
		default:
			throw new VexylException("unknown side " + Parser.quote(opts.side));
		}
		if (variant != null) {
			res.turn = variant.from;
			res.upright = variant.upright;
			// The flag's outline and border were drawn for its own shape.
			if (variant.fly > 0) {
				out.fly = variant.fly;
				out.hoist = variant.hoist;
				out.outline = null;
				out.border = null;
				out.borderOutside = false;
			}
			if (!variant.layers.isEmpty()) {
				// Its own design has nothing to do with the flag's reverse, so it's mirrored.
				out.layers = variant.layers;
				out.reverse = null;
				out.seenFromBehind = false;
				res.mirror = opts.side.equals("reverse");
			}
			if (variant.outline != null) {
				out.outline = variant.outline;
			}
			if (variant.border != null) {
				out.border = variant.border;
				out.borderOutside = variant.borderOutside;
			}
			if (ratio == 0) {
				ratio = variant.ratio;
			}
		}
		res.flag = out;
		if (ratio == 0) {
			return res;
		}
		if (opts.fit.equals("pad")) {
			Doc adapted;
			try {
				adapted = Adapter.withRatio(out, Adapter.nearestRatio(out, ratio));
			} catch (VexylException e) {
				// The rules allow that proportion, but this design can't reach it.
				adapted = out;
			}
			res.flag = adapted;
			res.canvas = ratio;
			return res;
		}
		Doc adapted = Adapter.withRatio(out, ratio);
		if (!opts.fold.isEmpty() && out.reverse != null) {
			// A fold shows the back as well, which adapts as it's seen from behind.
			Doc back = out.copy();
			back.layers = out.reverse.layers;
			back.seenFromBehind = true;
			Doc adaptedBack = Adapter.withRatio(back, ratio);
			if (adapted == out) {
				adapted = out.copy();
			}
			Reverse reverse = new Reverse();
			reverse.layers = adaptedBack.layers;
			adapted.reverse = reverse;
		}
		res.flag = adapted;
		return res;
	}

	private void line(String text) {
		out.append("  ".repeat(depth)).append(text).append('\n');
	}

	private String color(String name) {
		String v = flag.palette.get(name);
		return v == null ? "" : v.toLowerCase(java.util.Locale.ROOT);
	}

	/**
	 * The paint value for a palette name. A gradient spans the box given, or the bounding box of
	 * each shape it's used on if that's null.
	 */
	private String fill(String name, double[] box) {
		Gradient g = flag.gradients.get(name);
		if (g == null) {
			return color(name);
		}
		if (box == null && gradients.containsKey(name)) {
			return "url(#" + gradients.get(name) + ")";
		}
		String id = id("gradient");
		int x1 = 0, y1 = 0, x2 = 1, y2 = 0;
		switch (g.along) {
		case "hoist":
			x2 = 0;
			y2 = 1;
			break;
		case "bend":
			y2 = 1;
			break;
		case "bend-sinister":
			y1 = 1;
			break;
		default:
		}
		String units = "";
		if (box != null) {
			units = " gradientUnits=\"userSpaceOnUse\" gradientTransform=\"translate(" + num(box[0]) + " " + num(box[1])
					+ ") scale(" + num(box[2]) + " " + num(box[3]) + ")\"";
		}
		line("<linearGradient id=\"" + id + "\" x1=\"" + x1 + "\" y1=\"" + y1 + "\" x2=\"" + x2 + "\" y2=\"" + y2 + "\"" + units + ">");
		depth++;
		for (int i = 0; i < g.colors.size(); i++) {
			line("<stop offset=\"" + num(g.stops[i]) + "\" stop-color=\"" + color(g.colors.get(i)) + "\"/>");
		}
		depth--;
		line("</linearGradient>");
		if (box == null) {
			gradients.put(name, id);
		}
		return "url(#" + id + ")";
	}

	private String id(String kind) {
		nextID++;
		return idPrefix + kind + nextID;
	}

	/** Paints a flag's outside border, then everything within its outline. */
	private void flagArt(Doc f) throws VexylException {
		if (f.border != null && f.borderOutside) {
			List<Vec> outer = Geometry.offsetPolygon(Geometry.boundary(f), f.border.width);
			tag = scopeBorder + "border";
			// A gradient spans the shape that the border edges.
			double[] box = null;
			List<Vec> shape = Geometry.boundary(f);
			if (shape != null) {
				box = Shapes.bounds(shape);
			}
			geom(Geom.poly(outer), "fill=\"" + fill(f.border.color, box) + "\"");
		}
		Region root = new Region(f.fly, f.hoist);
		Geom shape = Geom.poly(Geometry.rectPoly(0, 0, f.fly, f.hoist));
		if (f.outline != null) {
			shape = Shapes.outlineGeom(f.outline, f.fly, f.hoist);
		}
		String flagClip = id("flag");
		line("<clipPath id=\"" + flagClip + "\">");
		depth++;
		unmarked(shape, "");
		depth--;
		line("</clipPath>");
		line("<g clip-path=\"url(#" + flagClip + ")\">");
		depth++;
		layers(f.layers, root, scopeLayers);
		if (f.border != null && !f.borderOutside) {
			// Half of the stroke falls outside the outline, and the clip removes it.
			tag = scopeBorder + "border";
			geom(shape, "fill=\"none\" stroke=\"" + fill(f.border.color, null) + "\" stroke-width=\"" + num(2 * f.border.width)
					+ "\" stroke-linejoin=\"miter\" stroke-miterlimit=\"10\"");
		}
		depth--;
		line("</g>");
	}

	/** Paints layers, whose paths start with base: a scope, or a parent's path and a dot. */
	private void layers(List<? extends Layer> layers, Region reg, String base) {
		for (int i = 0; i < layers.size(); i++) {
			layer(layers.get(i), reg, base + i);
		}
	}

	private void layer(Layer l, Region reg, String path) {
		if (using == 0) {
			tag = path;
		}
		List<String> attrs = new ArrayList<>(), style = new ArrayList<>();
		effects(l, reg, cutMoves(l, reg), attrs, style);
		// A group, and any layer with an opacity, a blend, a clip or a cut, composites as a unit,
		// so a blend inside it mixes only with what else is inside. Saying so outright keeps every
		// renderer to that. A panel's own group already says it.
		if (l instanceof Group || l.opacity != 1 || !l.blend.equals("normal") || l.clip != null || !l.cuts.isEmpty()) {
			style.add("isolation:isolate");
		}
		if (!style.isEmpty()) {
			attrs.add("style=\"" + String.join(";", style) + "\"");
		}
		if (!attrs.isEmpty()) {
			line("<g " + String.join(" ", attrs) + ">");
			depth++;
		}
		content(l, reg, path);
		if (!attrs.isEmpty()) {
			depth--;
			line("</g>");
		}
	}

	/** Writes any clip and mask a layer needs. A charge's cuts are drawn once for each of its moves. */
	private void effects(Layer e, Region reg, List<String> moves, List<String> attrs, List<String> style) {
		if (e.opacity != 1) {
			attrs.add("opacity=\"" + num(e.opacity) + "\"");
		}
		if (!e.blend.equals("normal")) {
			style.add("mix-blend-mode:" + e.blend);
		}
		if (e.clip != null) {
			String id = id("clip");
			line("<clipPath id=\"" + id + "\">");
			depth++;
			Shape clip = Shapes.forRegion(e.clip, reg);
			unmarked(Shapes.shapeGeom(clip, Shapes.position(clip, reg), 0), "");
			depth--;
			line("</clipPath>");
			attrs.add("clip-path=\"url(#" + id + ")\"");
		}
		if (!e.cuts.isEmpty()) {
			String id = id("mask");
			double[] b = reg.bounds();
			line("<mask id=\"" + id + "\" maskUnits=\"userSpaceOnUse\" x=\"" + num(b[0]) + "\" y=\"" + num(b[1])
					+ "\" width=\"" + num(b[2]) + "\" height=\"" + num(b[3]) + "\">");
			depth++;
			unmarked(Geom.poly(Geometry.rectPoly(b[0], b[1], b[0] + b[2], b[1] + b[3])), "fill=\"#fff\"");
			if (moves == null) {
				moves = List.of("");
			}
			for (String move : moves) {
				for (Shape s : e.cuts) {
					Shape cut = Shapes.forRegion(s, reg);
					Geom g = Shapes.shapeGeom(cut, Shapes.position(cut, reg), 0);
					if (!move.isEmpty()) {
						g.transform = (move + " " + g.transform).trim();
					}
					unmarked(g, "fill=\"#000\"");
				}
			}
			depth--;
			line("</mask>");
			attrs.add("mask=\"url(#" + id + ")\"");
		}
	}

	private static double[] boxOf(List<Vec> inside) {
		return inside.isEmpty() ? null : Shapes.bounds(inside);
	}

	private boolean isGradient(String name) {
		return flag.gradients.containsKey(name);
	}

	private void content(Layer l, Region reg, String path) {
		if (l instanceof Field) {
			paint(((Field) l).color, null, null, null, List.of(Geom.poly(Geometry.rectPoly(0, 0, reg.w, reg.h))));
		} else if (l instanceof Bars) {
			Bars b = (Bars) l;
			boolean hasGap = b.colors.contains(NONE);
			List<List<Vec>> polys = Shapes.barPolys(b, reg, i -> isGradient(b.colors.get(i)) || hasGap);
			for (int i = 0; i < polys.size(); i++) {
				if (!polys.get(i).isEmpty()) {
					paint(b.colors.get(i), null, null, null, List.of(Geom.poly(polys.get(i))));
				}
			}
		} else if (l instanceof Chevrons) {
			Chevrons ch = (Chevrons) l;
			List<List<Vec>>[] raw = Shapes.rawChevrons(ch, reg);
			List<List<Vec>> nested = raw[0], bands = raw[1];
			List<List<Vec>> polys = Shapes.chevronPolys(ch, reg);
			if (ch.colors.contains(NONE)) {
				// A gap has to show what's beneath, so each band stands alone.
				polys = bands;
			}
			if (ch.fimbriate != null) {
				// A gradient spans the outermost chevron's part inside the region.
				double[] box = boxOf(Shapes.clipConvex(nested.get(0), reg));
				paint(ch.colors.get(polys.size() - 1), box, ch.fimbriate, List.of(Geom.poly(nested.get(0))), null);
			}
			for (int i = 0; i < polys.size(); i++) {
				if (polys.get(i).isEmpty()) {
					continue;
				}
				// A gradient spans the whole chevron's part inside the region, even where a gap
				// leaves only its band to paint.
				double[] box = boxOf(Shapes.clipConvex(nested.get(i), reg));
				paint(ch.colors.get(polys.size() - 1 - i), box, null, null, List.of(Geom.poly(polys.get(i))));
			}
		} else if (l instanceof Band) {
			Band b = (Band) l;
			// The fimbriation's stroke mustn't follow the region's edge, so it uses the band's
			// unclipped shape. A clipped polygon can be empty.
			List<Geom> stroke = List.of(Geom.poly(Shapes.placedBandPoly(reg, b.fixed, b.along, b.rotate, b.width, b.offset, true)));
			List<Vec> poly = Shapes.placedBandPoly(reg, b.fixed, b.along, b.rotate, b.width, b.offset, false);
			if (!poly.isEmpty()) {
				// A gradient spans the part inside the region, for the fimbriation too.
				paint(b.color, Shapes.bounds(poly), b.fimbriate, stroke, List.of(Geom.poly(poly)));
			} else {
				paint(b.color, null, b.fimbriate, stroke, null);
			}
		} else if (l instanceof Cross) {
			Cross c = (Cross) l;
			// A gradient spans a cross as one shape, so it's given the whole region.
			double[] box = {0, 0, reg.w, reg.h};
			List<Geom> stroke = null;
			if (c.fimbriate != null) {
				// Keep the arms' ends, and their stroke, beyond the region's edge.
				List<List<Vec>> polys = Shapes.crossPolys(c, reg, c.fimbriate.width * 2);
				stroke = List.of(Geom.poly(polys.get(0)), Geom.poly(polys.get(1)));
			}
			List<List<Vec>> polys = Shapes.crossPolys(c, reg, 0);
			paint(c.color, box, c.fimbriate, stroke, List.of(Geom.poly(polys.get(0)), Geom.poly(polys.get(1))));
		} else if (l instanceof Quarters) {
			quarters((Quarters) l, reg);
		} else if (l instanceof Checks) {
			checks((Checks) l, reg);
		} else if (l instanceof Rays) {
			Rays ry = (Rays) l;
			List<List<Vec>> polys = Shapes.rayPolys(ry, reg);
			if (!ry.colors.contains(NONE)) {
				// Beneath the wedges, so that antialiasing can't leave seams between them.
				paint(ry.colors.get(0), null, null, null, List.of(Geom.poly(Geometry.rectPoly(0, 0, reg.w, reg.h))));
			}
			for (int i = 0; i < polys.size(); i++) {
				if (!polys.get(i).isEmpty()) {
					paint(ry.colors.get(i), null, null, null, List.of(Geom.poly(polys.get(i))));
				}
			}
		} else if (l instanceof Saltire) {
			Saltire s = (Saltire) l;
			if (s.counterchange) {
				counterchange(s, reg);
				return;
			}
			double[] box = {0, 0, reg.w, reg.h};
			List<Geom> stroke = null;
			if (s.fimbriate != null) {
				stroke = List.of(Geom.poly(Shapes.bandPoly(reg, "bend", 0, s.width, 0, true)),
						Geom.poly(Shapes.bandPoly(reg, "bend-sinister", 0, s.width, 0, true)));
			}
			paint(s.color, box, s.fimbriate, stroke, List.of(
					Geom.poly(Shapes.bandPoly(reg, "bend", 0, s.width, 0, false)),
					Geom.poly(Shapes.bandPoly(reg, "bend-sinister", 0, s.width, 0, false))));
		} else if (l instanceof Charge) {
			charge((Charge) l, reg);
		} else if (l instanceof Emblem) {
			emblem((Emblem) l, reg, path);
		} else if (l instanceof Group) {
			layers(((Group) l).layers, reg, path + ".");
		} else if (l instanceof Panel) {
			panel((Panel) l, reg, path);
		} else if (l instanceof Use) {
			Use u = (Use) l;
			// Everything a use draws is marked with its path, since it's the use in the document.
			using++;
			try {
				if (u.design.fly == 0) {
					layers(u.design.layers, reg, "");
					return;
				}
				// A design with its own grid is scaled to fill the region it's used in.
				line("<g transform=\"scale(" + factor(reg.w / u.design.fly) + " " + factor(reg.h / u.design.hoist) + ")\">");
				depth++;
				layers(u.design.layers, new Region(u.design.fly, u.design.hoist), "");
				depth--;
				line("</g>");
			} finally {
				using--;
			}
		}
	}

	private void panel(Panel p, Region reg, String path) {
		double[] rect = Shapes.panelRect(p, reg);
		double x = rect[0], y = rect[1], w = rect[2], h = rect[3];
		Geom shape = Geom.poly(Geometry.rectPoly(0, 0, w, h));
		if (p.line != null) {
			shape = Geom.poly(Shapes.panelEdge(p, w, h));
		}
		String id = id("panel");
		line("<clipPath id=\"" + id + "\">");
		depth++;
		unmarked(shape, "");
		depth--;
		line("</clipPath>");
		line("<g transform=\"translate(" + num(x) + " " + num(y) + ")\" clip-path=\"url(#" + id + ")\" style=\"isolation:isolate\">");
		depth++;
		layers(p.layers, new Region(w, h), path + ".");
		depth--;
		line("</g>");
	}

	private void quarters(Quarters q, Region reg) {
		Vec c = reg.center();
		if (q.diagonal) {
			Vec[] corners = reg.corners();
			for (int i = 0; i < 4; i++) {
				paint(q.colors[i], null, null, null, List.of(Geom.poly(List.of(c, corners[i], corners[(i + 1) % 4]))));
			}
			return;
		}
		if (q.split != null) {
			c = new Vec(q.split.fly, q.split.hoist);
		}
		// Each runs on beneath the next, so antialiasing can't leave a seam, unless gaps have to
		// show or a gradient has to span its own quarter.
		boolean gaps = List.of(q.colors).contains(NONE);
		boolean[] exact = new boolean[4];
		for (int i = 0; i < 4; i++) {
			exact[i] = gaps || isGradient(q.colors[i]);
		}
		double right = reg.w, bottom = reg.h;
		if (exact[0]) {
			right = c.x;
			bottom = c.y;
		}
		paint(q.colors[0], null, null, null, List.of(Geom.poly(Geometry.rectPoly(0, 0, right, bottom))));
		bottom = exact[1] ? c.y : reg.h;
		paint(q.colors[1], null, null, null, List.of(Geom.poly(Geometry.rectPoly(c.x, 0, reg.w, bottom))));
		right = exact[2] ? c.x : reg.w;
		paint(q.colors[2], null, null, null, List.of(Geom.poly(Geometry.rectPoly(0, c.y, right, reg.h))));
		paint(q.colors[3], null, null, null, List.of(Geom.poly(Geometry.rectPoly(c.x, c.y, reg.w, reg.h))));
	}

	private void checks(Checks ch, Region reg) {
		int n = ch.colors.size();
		double cellW = reg.w / ch.columns, cellH = reg.h / ch.rows;
		boolean gaps = ch.colors.contains(NONE);
		for (int row = 0; row < ch.rows; row++) {
			for (int col = 0; col < ch.columns; col++) {
				int i = row + col;
				if (ch.flow.equals("bend")) {
					i = col - row + ch.rows * n;
				}
				double x = col * cellW, y = row * cellH;
				// Each cell runs on beneath the next ones, unless gaps have to show or a gradient has
				// to span its own cell.
				double right = reg.w, bottom = reg.h;
				String color = ch.colors.get(i % n);
				if (gaps || isGradient(color)) {
					right = x + cellW;
					bottom = y + cellH;
				}
				paint(color, null, null, null, List.of(Geom.poly(Geometry.rectPoly(x, y, right, bottom))));
			}
		}
	}

	/** Paints a saltire twice its width, clipped to four triangles, so one side of each diagonal shows. */
	private void counterchange(Saltire l, Region reg) {
		Vec c = reg.center();
		String id = id("clip");
		line("<clipPath id=\"" + id + "\">");
		depth++;
		unmarked(Geom.poly(List.of(
				c, new Vec(reg.w, c.y), new Vec(reg.w, reg.h),
				c, new Vec(c.x, reg.h), new Vec(0, reg.h),
				c, new Vec(0, c.y), new Vec(0, 0),
				c, new Vec(c.x, 0), new Vec(reg.w, 0))), "");
		depth--;
		line("</clipPath>");
		line("<g clip-path=\"url(#" + id + ")\">");
		depth++;
		double[] box = {0, 0, reg.w, reg.h};
		paint(l.color, box, null, null, List.of(
				Geom.poly(Shapes.bandPoly(reg, "bend", 0, 2 * l.width, 0, false)),
				Geom.poly(Shapes.bandPoly(reg, "bend-sinister", 0, 2 * l.width, 0, false))));
		depth--;
		line("</g>");
	}

	private void emblem(Emblem e, Region reg, String path) {
		Vec at = e.at != null ? new Vec(e.at.fly, e.at.hoist) : reg.center();
		double angle = e.rotate;
		if (!e.along.isEmpty()) {
			Vec dir = Shapes.axis(reg, e.along, 0)[0];
			angle += Math.atan2(dir.y, dir.x) * 180 / Math.PI;
		}
		// Painting is still clipped to the region, so the frame only has to reach the region's
		// farthest corner.
		double reach = 0;
		for (Vec corner : reg.corners()) {
			reach = Math.max(reach, Math.hypot(corner.x - at.x, corner.y - at.y));
		}
		double frameReach = reach, turn = angle;
		keepUpright(at, () -> {
			line("<g transform=\"translate(" + num(at.x) + " " + num(at.y) + ") rotate(" + num(turn) + ")\">");
			depth++;
			// Charges in an emblem turn with it, so they aren't each kept upright as well.
			String was = upright;
			upright = "";
			for (int i = 0; i < e.charges.size(); i++) {
				layer(e.charges.get(i), new Region(0, 0, frameReach), path + "." + i);
			}
			upright = was;
			depth--;
			line("</g>");
		});
	}

	private void charge(Charge c, Region reg) {
		Shape s = Shapes.forRegion(c.shape, reg);
		Vec at = Shapes.position(s, reg);
		if (s.kind.equals("svg")) {
			keepUpright(at, () -> embedded(c, at));
			return;
		}
		List<Geom> copies = new ArrayList<>();
		List<Vec> centers = new ArrayList<>();
		for (Object[] p : chargePlaces(c, s, reg)) {
			copies.add(Shapes.shapeGeom(s, (Vec) p[0], (Double) p[1]));
			centers.add((Vec) p[0]);
		}
		double[] box = null;
		if (c.shape.kind.equals("pile") || c.shape.kind.equals("pall")) {
			// Its shape runs on past the region, and a gradient spans only what's inside.
			List<Vec> points = new ArrayList<>();
			for (Point p : s.vertices) {
				points.add(new Vec(p.fly, p.hoist));
			}
			box = boxOf(Shapes.clipConvex(points, reg));
		}
		double[] gradientBox = box;
		interface Draw {
			void run(List<Geom> shapes, Model.Edge fimbriate, String color);
		}
		Draw draw = (shapes, fimbriate, color) -> {
			if (s.hollow > 0) {
				outlineOnly(color, gradientBox, s.hollow, shapes);
			} else if (s.lines > 0) {
				outlineOnly(color, gradientBox, s.lines, shapes);
			} else {
				paint(color, gradientBox, fimbriate, shapes, shapes);
			}
		};
		if (upright.isEmpty() || s.kind.equals("polygon")) {
			draw.run(copies, c.fimbriate, c.color);
			return;
		}
		if (c.fimbriate != null) {
			// Every copy's fimbriation lies beneath all of their fills, as it does unturned.
			for (int i = 0; i < copies.size(); i++) {
				List<Geom> one = copies.subList(i, i + 1);
				keepUpright(centers.get(i), () -> paint(NONE, null, c.fimbriate, one, null));
			}
		}
		for (int i = 0; i < copies.size(); i++) {
			List<Geom> one = copies.subList(i, i + 1);
			keepUpright(centers.get(i), () -> draw.run(one, null, c.color));
		}
	}

	/** Where each copy of a charge goes, and how far it turns with its repeat, in painting order. */
	static List<Object[]> chargePlaces(Charge c, Shape s, Region reg) {
		List<Object[]> places = new ArrayList<>();
		Vec at = Shapes.position(s, reg);
		Repeat r = c.repeat;
		if (s.ats.size() > 1) {
			for (Point p : s.ats) {
				places.add(new Object[] {p == null ? reg.center() : new Vec(p.fly, p.hoist), 0.0});
			}
		} else if (r == null) {
			places.add(new Object[] {at, 0.0});
		} else if (r.kind.equals("ring")) {
			for (int i = 0; i < r.count; i++) {
				double a = i * 360.0 / r.count;
				places.add(new Object[] {at.add(new Vec(0, -r.radius).rotate(a)), r.turn ? a : 0.0});
			}
		} else if (r.kind.equals("arc")) {
			// Clockwise from one to the other, as a ring's own arc goes.
			double span = (r.to - r.from) % 360;
			if (span < 0) {
				span += 360;
			}
			for (int i = 0; i < r.count; i++) {
				double a = r.from + span * i / (r.count - 1);
				places.add(new Object[] {at.add(new Vec(0, -r.radius).rotate(a)), r.turn ? a : 0.0});
			}
		} else if (r.kind.equals("line")) {
			for (int i = 0; i < r.count; i++) {
				places.add(new Object[] {at.add(new Vec(r.fly, r.hoist).mul(i)), 0.0});
			}
		} else {
			for (int row = 1; row <= r.rows; row++) {
				for (int col = 1; col <= r.columns; col++) {
					if (r.stagger && (row + col) % 2 == 1) {
						continue;
					}
					places.add(new Object[] {new Vec(reg.w * col / (r.columns + 1), reg.h * row / (r.rows + 1)), 0.0});
				}
			}
		}
		return places;
	}

	/**
	 * A transform for each copy of a charge, which takes its cuts from where they're written, for
	 * the first copy, to that copy. A layer that isn't a charge with several copies gets null.
	 */
	private static List<String> cutMoves(Layer l, Region reg) {
		if (!(l instanceof Charge)) {
			return null;
		}
		Charge c = (Charge) l;
		if (c.cuts.isEmpty() || c.shape.kind.equals("svg")) {
			return null;
		}
		List<Object[]> places = chargePlaces(c, Shapes.forRegion(c.shape, reg), reg);
		if (places.size() < 2) {
			return null;
		}
		Vec firstAt = (Vec) places.get(0)[0];
		double firstTurn = (Double) places.get(0)[1];
		List<String> moves = new ArrayList<>();
		moves.add("");
		for (Object[] p : places.subList(1, places.size())) {
			Vec at = (Vec) p[0];
			double turn = (Double) p[1] - firstTurn;
			if (turn != 0) {
				moves.add("translate(" + num(at.x) + " " + num(at.y) + ") rotate(" + num(turn) + ") translate("
						+ num(-firstAt.x) + " " + num(-firstAt.y) + ")");
			} else {
				moves.add("translate(" + num(at.x - firstAt.x) + " " + num(at.y - firstAt.y) + ")");
			}
		}
		return moves;
	}

	/** Undoes a turned variant's rotation around a point, if there is one. */
	private void keepUpright(Vec at, Runnable draw) {
		if (upright.isEmpty()) {
			draw.run();
			return;
		}
		line("<g transform=\"translate(" + num(at.x) + " " + num(at.y) + ") " + upright + " translate(" + num(-at.x) + " " + num(-at.y) + ")\">");
		depth++;
		draw.run();
		depth--;
		line("</g>");
	}

	private void outlineOnly(String color, double[] box, double width, List<Geom> shapes) {
		if (color.equals(NONE)) {
			return;
		}
		String stroke = fill(color, box);
		for (Geom g : shapes) {
			geom(g, "fill=\"none\" stroke=\"" + stroke + "\" stroke-width=\"" + num(width / g.strokeScale())
					+ "\" stroke-linejoin=\"miter\" stroke-miterlimit=\"10\"");
		}
	}

	private void embedded(Charge c, Vec at) {
		Shape s = c.shape;
		List<String> attrs = new ArrayList<>();
		if (!c.color.isEmpty()) {
			attrs.add("color=\"" + color(c.color) + "\"");
		}
		if (s.rotate != 0) {
			attrs.add("transform=\"rotate(" + num(s.rotate) + " " + num(at.x) + " " + num(at.y) + ")\"");
		}
		if (!attrs.isEmpty()) {
			line("<g " + String.join(" ", attrs) + ">");
			depth++;
		}
		// Each time it's drawn gets its own prefix, since a definition can draw it many times.
		String prefix = id("svg") + "-";
		line("<svg" + mark() + " x=\"" + num(at.x - s.fly / 2) + "\" y=\"" + num(at.y - s.hoist / 2) + "\" width=\"" + num(s.fly)
				+ "\" height=\"" + num(s.hoist) + "\" viewBox=\"" + Xml.escape(s.embedded.viewBox())
				+ "\" preserveAspectRatio=\"xMidYMid meet\"" + s.embedded.attrs(prefix) + ">" + s.embedded.body(prefix) + "</svg>");
		if (!attrs.isEmpty()) {
			depth--;
			line("</g>");
		}
	}

	/**
	 * Fills shapes, after painting any fimbriation beneath all of them. Each shape's stroke lies
	 * beneath the others' fills, so arms read as a single shape. A gradient spans box, or each
	 * shape's own bounds if box is null.
	 */
	private void paint(String color, double[] box, Model.Edge fimbriate, List<Geom> stroke, List<Geom> shapes) {
		if (fimbriate != null && stroke != null) {
			String edge = fill(fimbriate.color, box);
			for (Geom g : stroke) {
				geom(g, "fill=\"" + edge + "\" stroke=\"" + edge + "\" stroke-width=\"" + num(2 * fimbriate.width / g.strokeScale())
						+ "\" stroke-linejoin=\"miter\" stroke-miterlimit=\"10\"");
			}
		}
		if (shapes == null || shapes.isEmpty() || color.equals(NONE)) {
			return;
		}
		String fill = fill(color, box);
		for (Geom g : shapes) {
			geom(g, "fill=\"" + fill + "\"");
		}
	}

	/** The attribute that marks a drawn element, if this render has them. */
	private String mark() {
		if (!tagging) {
			return "";
		}
		return " " + Vexyl.TAG_ATTRIBUTE + "=\"" + Xml.escape(tag) + "\"";
	}

	/** Writes what's only part of a definition, which no layer drew. */
	private void unmarked(Geom g, String attrs) {
		boolean was = tagging;
		tagging = false;
		geom(g, attrs);
		tagging = was;
	}

	private void geom(Geom g, String attrs) {
		if (!attrs.isEmpty()) {
			attrs = " " + attrs;
		}
		attrs = mark() + attrs;
		if (!g.transform.isEmpty()) {
			attrs += " transform=\"" + g.transform + "\"";
		}
		if (g.evenodd) {
			attrs += " fill-rule=\"evenodd\"";
		}
		if (!g.path.isEmpty()) {
			line("<path d=\"" + g.path + "\"" + attrs + "/>");
		} else if (g.circle) {
			line("<circle cx=\"" + num(g.c.x) + "\" cy=\"" + num(g.c.y) + "\" r=\"" + num(g.r) + "\"" + attrs + "/>");
		} else if (g.ring) {
			line("<path fill-rule=\"evenodd\" d=\"" + Shapes.circlePath(g.c, g.r) + " " + Shapes.circlePath(g.c, g.inner) + "\"" + attrs + "/>");
		} else {
			StringBuilder points = new StringBuilder();
			List<Vec> poly = g.poly == null ? List.of() : g.poly;
			for (int i = 0; i < poly.size(); i++) {
				if (i > 0) {
					points.append(' ');
				}
				points.append(num(poly.get(i).x)).append(',').append(num(poly.get(i).y));
			}
			line("<polygon points=\"" + points + "\"" + attrs + "/>");
		}
	}

	/** Renders a flag in a folded position. */
	private void writeFolded(Doc f, Fold fold, RenderOptions opts, double height) throws VexylException {
		List<Vec> shape = Geometry.foldShape(f);
		int steps = opts.foldStep != null ? opts.foldStep : 0;
		List<Facet> stack = Geometry.foldFacets(shape, fold, steps);
		List<Vec> all = new ArrayList<>();
		for (Facet facet : stack) {
			all.addAll(facet.poly);
		}
		double[] b = Shapes.bounds(all);
		double x = b[0], y = b[1], w = b[2], h = b[3];
		line("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"" + num(x) + " " + num(y) + " " + num(w) + " " + num(h)
				+ "\" width=\"" + num(height * w / h) + "\" height=\"" + num(height) + "\">");
		depth++;
		line("<title>" + Xml.escape(f.meta.name) + "</title>");
		line("<defs>");
		depth++;
		String front = id("front");
		line("<g id=\"" + front + "\">");
		depth++;
		flagArt(f);
		depth--;
		line("</g>");
		String back = "";
		if (f.reverse != null) {
			back = id("back");
			Doc reverse = f.copy();
			reverse.layers = f.reverse.layers;
			line("<g id=\"" + back + "\">");
			depth++;
			String scope = scopeLayers;
			scopeLayers = "reverse/";
			Doc was = flag;
			flag = reverse;
			flagArt(reverse);
			flag = was;
			scopeLayers = scope;
			depth--;
			line("</g>");
		}
		depth--;
		line("</defs>");
		// A crease line reads at any scale, without hiding the design. SPEC section 13 fixes it.
		String crease = "fill=\"none\" stroke=\"#000\" stroke-opacity=\"0.35\" stroke-linejoin=\"round\" stroke-width=\""
				+ num(Math.max(w, h) * 0.004) + "\"";
		for (Facet fc : stack) {
			String id = id("facet");
			line("<clipPath id=\"" + id + "\">");
			depth++;
			unmarked(Geom.poly(fc.poly), "");
			depth--;
			line("</clipPath>");
			String art = front;
			Matrix place = fc.place;
			if (fc.flipped && !back.isEmpty()) {
				// A separate back is written as seen from that side, so it mirrors back.
				art = back;
				place = new Matrix(-1, 0, 0, 1, f.fly, 0).then(fc.place);
			}
			line("<g clip-path=\"url(#" + id + ")\"><use href=\"#" + art + "\" transform=\"matrix(" + num(place.a) + " " + num(place.b)
					+ " " + num(place.c) + " " + num(place.d) + " " + num(place.e) + " " + num(place.f) + ")\"/></g>");
			unmarked(Geom.poly(fc.poly), crease);
		}
		depth--;
		line("</svg>");
	}

	/** Reads a render back as a tree of elements. Only a title or desc holds any text. */
	static Element tree(String svg) {
		return new TreeReader(svg).element();
	}

	/** Reads the renderer's own output, which is plain XML with double-quoted attributes. */
	private static final class TreeReader {
		private final String s;
		private int i;

		TreeReader(String s) {
			this.s = s;
		}

		private void skipText() {
			while (i < s.length() && s.charAt(i) != '<') {
				i++;
			}
		}

		Element element() {
			skipText();
			i++;
			int start = i;
			while (!Character.isWhitespace(s.charAt(i)) && s.charAt(i) != '>' && s.charAt(i) != '/') {
				i++;
			}
			String name = s.substring(start, i);
			List<Element.Attribute> attrs = new ArrayList<>();
			while (true) {
				while (Character.isWhitespace(s.charAt(i))) {
					i++;
				}
				if (s.startsWith("/>", i)) {
					i += 2;
					return new Element(name, attrs, "", List.of());
				}
				if (s.charAt(i) == '>') {
					i++;
					break;
				}
				int eq = s.indexOf('=', i);
				String key = s.substring(i, eq).trim();
				int open = s.indexOf('"', eq);
				int close = s.indexOf('"', open + 1);
				attrs.add(new Element.Attribute(key, unescape(s.substring(open + 1, close))));
				i = close + 1;
			}
			List<Element> children = new ArrayList<>();
			StringBuilder text = new StringBuilder();
			while (true) {
				int lt = s.indexOf('<', i);
				if (name.equals("title") || name.equals("desc")) {
					text.append(unescape(s.substring(i, lt)));
				}
				i = lt;
				if (s.startsWith("</", i)) {
					i = s.indexOf('>', i) + 1;
					return new Element(name, attrs, text.toString(), children);
				}
				children.add(element());
			}
		}

		private static String unescape(String t) {
			if (t.indexOf('&') < 0) {
				return t;
			}
			StringBuilder b = new StringBuilder();
			for (int k = 0; k < t.length(); k++) {
				char c = t.charAt(k);
				if (c != '&') {
					b.append(c);
					continue;
				}
				int semi = t.indexOf(';', k);
				String ref = t.substring(k + 1, semi);
				switch (ref) {
				case "amp": b.append('&'); break;
				case "lt": b.append('<'); break;
				case "gt": b.append('>'); break;
				case "quot": b.append('"'); break;
				case "apos": b.append('\''); break;
				default:
					int code = ref.startsWith("#x") ? Integer.parseInt(ref.substring(2), 16) : Integer.parseInt(ref.substring(1));
					b.appendCodePoint(code);
				}
				k = semi;
			}
			return b.toString();
		}
	}
}
