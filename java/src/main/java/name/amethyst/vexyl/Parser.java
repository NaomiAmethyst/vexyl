// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import java.util.regex.Pattern;

import name.amethyst.vexyl.Kdl.Node;
import name.amethyst.vexyl.Kdl.Value;
import name.amethyst.vexyl.Model.*;

/** Reads a document into a flag, reporting every problem it finds. */
final class Parser {
	static final int FORMAT_VERSION = 1;
	/** In a color list, leaves a gap, and can't be a palette name. */
	static final String NO_COLOR = "none";

	private static final Pattern COLOR_VALUE = Pattern.compile("#[0-9a-fA-F]{6}");
	private static final Pattern SERIES_VALUE = Pattern.compile("[a-z0-9]+(-[a-z0-9]+)*");
	private static final Pattern DATE_VALUE = Pattern.compile("([0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2}))?)?");

	static final List<String> ALONG = List.of("fly", "hoist", "bend", "bend-sinister");
	static final List<String> FROM = List.of("hoist", "fly", "top", "bottom");
	static final List<String> BLEND = List.of("normal", "multiply", "screen", "overlay", "darken", "lighten");
	static final List<String> ANCHOR = List.of("start", "center", "end", "scale");
	static final List<String> CORNER = List.of("upper-hoist", "upper-fly", "lower-hoist", "lower-fly");
	static final List<String> RAY_FROM = List.of("center", "hoist", "fly", "top", "bottom",
			"upper-hoist", "upper-fly", "lower-hoist", "lower-fly");
	static final List<String> SHAPE_KINDS = List.of("disc", "ring", "rect", "plus", "triangle", "star", "heart",
			"cardioid", "polygon", "crescent", "sun", "lozenge", "ellipse", "path");
	static final List<String> VIEW = List.of("none", "rotate", "counter-rotate", "half-turn", "transpose",
			"anti-transpose", "invert", "mirror");
	static final List<String> MODE = List.of("extend", "center", "scale", "hoist-extend", "hoist-center", "hoist-scale");
	/** These put no conditions on a work, so a file adapting one can license its renders as it likes. */
	private static final Set<String> FREE_LICENSES = Set.of("CC0-1.0", "LicenseRef-Public-Domain");
	private static final Set<String> HAS_RADIUS = Set.of("disc", "ring", "plus", "triangle", "star", "heart",
			"cardioid", "crescent", "sun");

	private final String src;
	private final List<Problem> problems = new ArrayList<>();
	private Map<String, Define> defines = new LinkedHashMap<>();
	private Map<String, String> palette = new LinkedHashMap<>();
	private Map<String, Gradient> gradients = new LinkedHashMap<>();
	/** Lets a gradient's colors recognize other gradients, since they're read one at a time. */
	private final List<String> gradientNames = new ArrayList<>();
	/** What the flag has painted so far, as section 15 counts it. */
	private int size;
	/** The longer side of the flag's own grid, for counting shaped edges. */
	private double longer;

	private Parser(String src) {
		this.src = src;
	}

	/** Reads a document, giving its flag, or throwing its problems. */
	static Doc parse(String text) throws ProblemsException {
		String src = normalizeNewlines(text);
		List<Node> nodes;
		try {
			nodes = Kdl.parse(src);
		} catch (Kdl.SyntaxError e) {
			int[] at = place(src, e.offset);
			throw new ProblemsException(List.of(new Problem(at[0], at[1], null, e.getMessage())));
		}
		Parser p = new Parser(src);
		p.prepare(nodes);
		Doc flag = p.document(nodes);
		flag.idPrefix = "vx-" + hex(sha256(src), 8) + "-";
		if (!p.problems.isEmpty()) {
			throw new ProblemsException(p.problems);
		}
		return flag;
	}

	/** Makes CRLF and a lone CR into LF, as section 4 of the format and XML both do. */
	static String normalizeNewlines(String s) {
		if (s.indexOf('\r') < 0) {
			return s;
		}
		return s.replace("\r\n", "\n").replace('\r', '\n');
	}

	private static byte[] sha256(String s) {
		try {
			return MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
		} catch (NoSuchAlgorithmException e) {
			throw new AssertionError(e);
		}
	}

	static String hex(byte[] bytes, int count) {
		StringBuilder b = new StringBuilder();
		for (int i = 0; i < count; i++) {
			b.append(String.format("%02x", bytes[i] & 0xff));
		}
		return b.toString();
	}

	/** Finds where a character is: lines end at LF, and a column counts code points. */
	static int[] place(String src, int offset) {
		offset = Math.min(offset, src.length());
		int line = 1, start = 0;
		for (int i = 0; i < offset; i++) {
			if (src.charAt(i) == '\n') {
				line++;
				start = i + 1;
			}
		}
		return new int[] {line, src.codePointCount(start, offset) + 1};
	}

	private void errf(Node n, String format, Object... args) {
		int[] at = place(src, n.start);
		problems.add(new Problem(at[0], at[1], n.name, args.length == 0 ? format : String.format(format, args)));
	}

	private void problem(String message) {
		problems.add(new Problem(0, 0, null, message));
	}

	/** Checks what's the same wherever it is in a document. */
	private void prepare(List<Node> nodes) {
		for (Node n : nodes) {
			if (n.annotated) {
				errf(n, "type annotations aren't used by this format");
			}
			for (Value v : n.args) {
				if (v.annotated) {
					errf(n, "type annotations aren't used by this format");
				}
			}
			for (Value v : n.props.values()) {
				if (v.annotated) {
					errf(n, "type annotations aren't used by this format");
				}
			}
			for (String key : n.repeatedProps) {
				errf(n, "property %s given more than once", quote(key));
			}
			prepare(n.children);
		}
	}

	static String quote(String s) {
		StringBuilder b = new StringBuilder("\"");
		for (int i = 0; i < s.length(); i++) {
			char c = s.charAt(i);
			if (c == '"' || c == '\\') {
				b.append('\\');
			}
			if (c < 0x20) {
				b.append(String.format("\\x%02x", (int) c));
			} else {
				b.append(c);
			}
		}
		return b.append('"').toString();
	}

	private static final int STAGE_VERSION = 0, STAGE_META = 1, STAGE_PALETTE = 2, STAGE_PROPORTION = 3,
			STAGE_OUTLINE = 4, STAGE_BORDER = 5, STAGE_DEFINE = 6, STAGE_LAYERS = 7, STAGE_REVERSE = 8,
			STAGE_ADAPT = 9, STAGE_VARIANT = 10, STAGE_FOLD = 11;
	private static final Map<String, Integer> STAGES = Map.ofEntries(
			Map.entry("vexyl", STAGE_VERSION), Map.entry("meta", STAGE_META), Map.entry("palette", STAGE_PALETTE),
			Map.entry("proportion", STAGE_PROPORTION), Map.entry("outline", STAGE_OUTLINE),
			Map.entry("border", STAGE_BORDER), Map.entry("define", STAGE_DEFINE), Map.entry("reverse", STAGE_REVERSE),
			Map.entry("adapt", STAGE_ADAPT), Map.entry("variant", STAGE_VARIANT), Map.entry("fold", STAGE_FOLD));

	/** Walks the top level, whose nodes have a fixed order. */
	private Doc document(List<Node> nodes) {
		Doc flag = new Doc();
		defines = flag.defines;
		int stage = -1;
		Set<Integer> seen = new HashSet<>();
		for (Node n : nodes) {
			int s = STAGES.getOrDefault(n.name, STAGE_LAYERS);
			if (s < stage || (s == stage && s != STAGE_LAYERS && s != STAGE_DEFINE && s != STAGE_VARIANT && s != STAGE_FOLD)) {
				errf(n, "out of order or repeated");
				continue;
			}
			if (s > STAGE_VERSION && stage < STAGE_VERSION) {
				int[] at = place(src, n.start);
				problems.add(new Problem(at[0], at[1], null, "document must start with `vexyl " + FORMAT_VERSION + "`"));
				return flag;
			}
			stage = s;
			seen.add(s);
			switch (n.name) {
			case "vexyl":
				if (number(n) != FORMAT_VERSION) {
					errf(n, "unsupported format version; this renderer reads %d", FORMAT_VERSION);
					return flag;
				}
				flag.version = FORMAT_VERSION;
				break;
			case "meta":
				meta(n, flag.meta);
				break;
			case "palette":
				paletteNode(n, flag);
				break;
			case "proportion":
				onlyArgs(n, 0, "hoist", "fly");
				flag.hoist = positive(n, prop(n, "hoist"));
				flag.fly = positive(n, prop(n, "fly"));
				longer = Math.max(flag.hoist, flag.fly);
				noChildren(n);
				break;
			case "outline":
				flag.outline = outline(n);
				break;
			case "border": {
				Object[] b = border(n);
				flag.border = (Edge) b[0];
				flag.borderOutside = (Boolean) b[1];
				checkOutside(n, flag.outline, flag.fly, flag.hoist, flag.border, flag.borderOutside);
				break;
			}
			case "define":
				define(n);
				break;
			case "reverse":
				reverse(n, flag);
				break;
			case "adapt":
				adapt(n, flag);
				break;
			case "variant":
				variant(n, flag);
				break;
			case "fold":
				fold(n, flag);
				break;
			default:
				if (flag.fly == 0 && flag.hoist == 0) {
					errf(n, "layers must follow `proportion`");
					return flag;
				}
				Layer l = layer(n, 1);
				if (l != null) {
					flag.layers.add(l);
					count(n, List.of(l));
				}
			}
		}
		if (!seen.contains(STAGE_VERSION)) {
			problem("document must start with `vexyl " + FORMAT_VERSION + "`");
		}
		if (!seen.contains(STAGE_META)) {
			problem("document needs `meta`");
		}
		if (!seen.contains(STAGE_PALETTE)) {
			problem("document needs `palette`");
		}
		if (!seen.contains(STAGE_PROPORTION)) {
			problem("document needs `proportion`");
		}
		for (Map.Entry<String, Variant> e : flag.variants.entrySet()) {
			if (e.getValue().ratio != 0 && flag.adapt == null) {
				problem(String.format("variant %s has a `ratio`, but the flag has no `adapt` rules", quote(e.getKey())));
			}
		}
		if (flag.fly > 0 && flag.hoist > 0 && problems.isEmpty()) {
			for (Map.Entry<String, Fold> e : flag.folds.entrySet()) {
				try {
					Geometry.foldFacets(Geometry.foldShape(flag), e.getValue(), 0);
				} catch (VexylException ex) {
					problem(String.format("fold %s: %s", quote(e.getKey()), ex.getMessage()));
				}
			}
		}
		return flag;
	}

	/** Adds what a top-level node paints to the flag's size, refusing the node that takes it past the limit. */
	private void count(Node n, List<Layer> layers) {
		int was = size;
		size = Limits.add(size, Limits.layersSize(layers, longer));
		if (was <= Limits.MAX_SIZE && size > Limits.MAX_SIZE) {
			errf(n, "paints too much: a flag can only come to %d parts", Limits.MAX_SIZE);
		}
	}

	private Consumer<Node> str(Consumer<String> set) {
		return c -> set.accept(str(c));
	}

	private void meta(Node n, Meta m) {
		noValues(n);
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("name", str(v -> m.name = v));
		h.put("description", str(v -> m.description = v));
		h.put("version", str(v -> m.version = v));
		h.put("date", c -> {
			m.date = str(c);
			if (!m.date.isEmpty() && !validDate(m.date)) {
				errf(c, "must be YYYY, YYYY-MM or YYYY-MM-DD, got %s", quote(m.date));
			}
		});
		h.put("until", c -> {
			m.until = str(c);
			if (!m.until.isEmpty() && !validDate(m.until)) {
				errf(c, "must be YYYY, YYYY-MM or YYYY-MM-DD, got %s", quote(m.until));
			}
		});
		h.put("series", c -> {
			m.series = str(c);
			if (!m.series.isEmpty() && !SERIES_VALUE.matcher(m.series).matches()) {
				errf(c, "must be lowercase words joined by hyphens, got %s", quote(m.series));
			}
		});
		h.put("note", str(m.notes::add));
		h.put("law", c -> {
			Reference r = reference(c);
			if (r != null) {
				m.laws.add(r);
			}
		});
		h.put("restriction", c -> {
			Reference r = reference(c);
			if (r != null) {
				if (r.sources.isEmpty()) {
					errf(c, "needs a `source`, since an unsourced legal claim can mislead");
				}
				m.restrictions.add(r);
			}
		});
		h.put("designer", str(m.designers::add));
		h.put("design-rights", str(v -> m.designRights = v));
		h.put("encoder", str(m.encoders::add));
		h.put("license", str(v -> m.license = v));
		h.put("render-license", str(v -> m.renderLicense = v));
		h.put("adapted-from", c -> {
			Adaptation a = adaptation(c);
			if (a != null) {
				m.adaptedFrom.add(a);
			}
		});
		h.put("source", str(m.sources::add));
		children(n, List.of("designer", "encoder", "source", "note", "law", "restriction", "adapted-from"), h);
		if (!m.renderLicense.isEmpty()) {
			for (Adaptation a : m.adaptedFrom) {
				if (!a.license.equals(m.renderLicense) && !FREE_LICENSES.contains(a.license)) {
					errf(n, "`render-license` %s can't cover work adapted from %s under %s",
							quote(m.renderLicense), a.url, quote(a.license));
				}
			}
		}
		if (m.name.isEmpty()) {
			errf(n, "needs a `name`");
		}
		if (!m.date.isEmpty() && !m.until.isEmpty()) {
			// Each is only known to its own precision, so they compare only as far as both go.
			int shared = Math.min(m.date.length(), m.until.length());
			if (m.until.substring(0, shared).compareTo(m.date.substring(0, shared)) < 0) {
				errf(n, "`until` comes before `date`");
			}
		}
	}

	/** Accepts a year, a month or a day, which is as much as many flags' origins are known to. */
	static boolean validDate(String text) {
		var m = DATE_VALUE.matcher(text);
		if (!m.matches()) {
			return false;
		}
		try {
			int year = Integer.parseInt(m.group(1));
			if (m.group(2) == null) {
				return true;
			}
			int month = Integer.parseInt(m.group(2));
			if (m.group(3) == null) {
				YearMonth.of(year, month);
				return true;
			}
			LocalDate.of(year, month, Integer.parseInt(m.group(3)));
			return true;
		} catch (DateTimeException e) {
			return false;
		}
	}

	private Adaptation adaptation(Node n) {
		noProps(n);
		if (n.args.size() != 1 || !n.args.get(0).isString()) {
			errf(n, "needs the URL of the original work");
			return null;
		}
		Adaptation a = new Adaptation();
		a.url = n.args.get(0).string;
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("author", str(a.authors::add));
		h.put("license", str(v -> a.license = v));
		h.put("part", str(v -> a.part = v));
		children(n, List.of("author"), h);
		return a;
	}

	private void paletteNode(Node n, Doc flag) {
		noValues(n);
		palette = flag.palette;
		gradients = flag.gradients;
		// Gradients can name colors defined after them, so they're read second.
		List<Node> later = new ArrayList<>();
		Set<String> seen = new HashSet<>();
		for (Node c : n.children) {
			if (seen.contains(c.name)) {
				errf(c, "color defined twice");
				continue;
			}
			if (c.name.equals(NO_COLOR)) {
				errf(c, "%s is reserved for leaving a gap", quote(NO_COLOR));
				continue;
			}
			if (c.name.isEmpty()) {
				errf(c, "a color's name can't be empty");
				continue;
			}
			seen.add(c.name);
			if (!c.args.isEmpty() && c.args.get(0).isString() && c.args.get(0).string.equals("gradient")) {
				later.add(c);
				continue;
			}
			String value = color(c, flag);
			if (!COLOR_VALUE.matcher(value).matches()) {
				errf(c, "color must be #rrggbb, got %s", quote(value));
			}
			// Either case means the same, so the model has only one.
			flag.palette.put(c.name, value.toLowerCase(java.util.Locale.ROOT));
		}
		for (Node c : later) {
			gradientNames.add(c.name);
		}
		for (Node c : later) {
			flag.gradients.put(c.name, gradient(c));
		}
	}

	/** Reads `name gradient COLOR... along=AXIS { stops N... }`. */
	private Gradient gradient(Node n) {
		Gradient g = new Gradient();
		for (Value a : n.args.subList(1, n.args.size())) {
			if (!a.isString()) {
				errf(n, "a gradient's colors must be palette names");
				continue;
			}
			g.colors.add(solidColor(n, a.string));
		}
		if (g.colors.size() < 2) {
			errf(n, "a gradient needs at least 2 colors");
		}
		for (String key : n.props.keySet()) {
			if (!key.equals("along")) {
				errf(n, "unknown property %s", quote(key));
			}
		}
		Value v = n.prop("along");
		if (v != null) {
			if (!v.isString() || !ALONG.contains(v.string)) {
				errf(n, "along must be one of %s", ALONG);
			} else {
				g.along = v.string;
			}
		}
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("stops", c -> g.stops = stops(c, g.colors.size()));
		children(n, List.of(), h);
		if (g.stops == null) {
			g.stops = new double[g.colors.size()];
			for (int i = 0; i < g.stops.length; i++) {
				g.stops[i] = (double) i / Math.max(g.colors.size() - 1, 1);
			}
		}
		return g;
	}

	private double[] stops(Node n, int count) {
		double[] stops = numbers(n);
		if (stops.length != count) {
			errf(n, "has %d colors but %d stops", count, stops.length);
		}
		for (int i = 0; i < stops.length; i++) {
			if (stops[i] < 0 || stops[i] > 1) {
				errf(n, "stops must be between 0 and 1");
			}
			if (i > 0 && stops[i] < stops[i - 1]) {
				errf(n, "stops can't run backward");
			}
		}
		return stops;
	}

	/** Reads a palette color, with its values in any other color systems. */
	private String color(Node n, Doc flag) {
		noProps(n);
		if (n.args.size() != 1 || !n.args.get(0).isString()) {
			errf(n, "needs one string");
			return "";
		}
		List<ColorRef> refs = new ArrayList<>();
		Consumer<Node> named = c -> {
			ColorRef r = new ColorRef();
			r.system = c.name;
			r.value = str(c);
			refs.add(r);
		};
		Map<String, Consumer<Node>> h = new HashMap<>();
		for (String system : List.of("pantone", "ncs", "ral", "munsell", "dye", "thread")) {
			h.put(system, named);
		}
		h.put("cmyk", c -> {
			double[] v = numbers(c);
			if (v.length != 4) {
				errf(c, "needs 4 values from 0 to 100");
				return;
			}
			List<String> parts = new ArrayList<>();
			for (double x : v) {
				if (x < 0 || x > 100) {
					errf(c, "needs 4 values from 0 to 100");
				}
				parts.add(Json.number(x));
			}
			ColorRef r = new ColorRef();
			r.system = "cmyk";
			r.value = String.join(" ", parts);
			r.numbers = v;
			refs.add(r);
		});
		h.put("reference", c -> {
			noProps(c);
			noChildren(c);
			if (c.args.size() != 2 || !c.args.get(0).isString() || !c.args.get(1).isString()) {
				errf(c, "needs a system's name and a value");
				return;
			}
			ColorRef r = new ColorRef();
			r.system = c.args.get(0).string;
			r.value = c.args.get(1).string;
			r.other = true;
			refs.add(r);
		});
		children(n, List.of("dye", "reference"), h);
		if (!refs.isEmpty()) {
			flag.colorRefs.put(n.name, refs);
		}
		return n.args.get(0).string;
	}

	private Layer layer(Node n, int depth) {
		if (depth > Limits.MAX_DEPTH) {
			errf(n, "nested more than %d levels deep", Limits.MAX_DEPTH);
			return null;
		}
		switch (n.name) {
		case "field": {
			Field l = new Field();
			l.color = colorArg(n);
			noProps(n);
			children(n, List.of("cut"), withEffects(l, null));
			return l;
		}
		case "bars":
			return bars(n);
		case "chevrons":
			return chevrons(n);
		case "band":
			return band(n);
		case "cross":
			return cross(n);
		case "saltire":
			return saltire(n);
		case "charge":
			return charge(n);
		case "quarters":
			return quarters(n);
		case "checks":
			return checks(n);
		case "rays":
			return rays(n);
		case "pile":
		case "pall":
			return ordinaryShape(n);
		case "panel":
			return panel(n, depth);
		case "use":
			return use(n, depth);
		case "emblem":
			return emblem(n);
		case "group": {
			Group l = new Group();
			noValues(n);
			container(n, depth, l, l.layers, null);
			if (l.layers.isEmpty()) {
				errf(n, "needs at least one layer");
			}
			return l;
		}
		case "canton": {
			Panel l = new Panel();
			l.corner = "upper-hoist";
			l.canton = true;
			noValues(n);
			Map<String, Consumer<Node>> h = new HashMap<>();
			h.put("fly", c -> l.fly = positive(c, number(c)));
			h.put("hoist", c -> l.hoist = positive(c, number(c)));
			container(n, depth, l, l.layers, h);
			if (l.fly == 0 || l.hoist == 0) {
				errf(n, "needs `fly` and `hoist`");
			}
			if (l.layers.isEmpty()) {
				errf(n, "needs at least one layer");
			}
			return l;
		}
		default:
			errf(n, "unknown layer");
			return null;
		}
	}

	/** Reads a group, panel or canton, whose children mix settings and layers. */
	private void container(Node n, int depth, Layer e, List<Layer> layers, Map<String, Consumer<Node>> settings) {
		Map<String, Consumer<Node>> handlers = withEffects(e, settings);
		Set<String> seen = new HashSet<>();
		for (Node c : n.children) {
			Consumer<Node> handler = handlers.get(c.name);
			if (handler == null) {
				Layer l = layer(c, depth + 1);
				if (l != null) {
					layers.add(l);
				}
				continue;
			}
			if (seen.contains(c.name) && !c.name.equals("cut")) {
				errf(c, "given more than once");
			}
			seen.add(c.name);
			handler.accept(c);
		}
	}

	private Map<String, Consumer<Node>> withEffects(Layer e, Map<String, Consumer<Node>> handlers) {
		Map<String, Consumer<Node>> merged = new HashMap<>();
		merged.put("opacity", c -> {
			e.opacity = number(c);
			if (e.opacity < 0 || e.opacity > 1) {
				errf(c, "must be between 0 and 1");
			}
		});
		merged.put("blend", c -> e.blend = oneOf(c, BLEND));
		merged.put("anchor", c -> e.anchor = oneOf(c, ANCHOR));
		merged.put("clip", c -> {
			Shape s = maskShape(c);
			if (s != null) {
				e.clip = s;
			}
		});
		merged.put("cut", c -> {
			Shape s = maskShape(c);
			if (s != null) {
				e.cuts.add(s);
			}
		});
		if (handlers != null) {
			merged.putAll(handlers);
		}
		return merged;
	}

	/** Reads the single shape inside a clip or cut. */
	private Shape maskShape(Node n) {
		noValues(n);
		if (n.children.size() != 1) {
			errf(n, "needs exactly one shape");
			return null;
		}
		Node c = n.children.get(0);
		noValues(c);
		if (c.name.equals("svg")) {
			errf(c, "inline SVG can't be used as a clip or cut");
			return null;
		}
		Shape s = namedShape(c.name);
		shapeBody(c, s, null);
		if (s.hollow > 0 || s.lines > 0) {
			errf(c, "a clip or cut uses a shape's whole area, so it can't be `hollow` or `lines`");
		}
		return s;
	}

	/** Starts a shape of a kind, or from a definition of that name. */
	private Shape namedShape(String name) {
		Define d = defines.get(name);
		if (d != null && d.shape != null) {
			Shape s = d.shape.copy();
			s.vertices = new ArrayList<>(s.vertices);
			return s;
		}
		Shape s = new Shape();
		s.kind = name;
		return s;
	}

	private Layer bars(Node n) {
		Bars l = new Bars();
		l.colors = gapColorArgs(n);
		noProps(n);
		int[] count = {0};
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("along", c -> l.along = oneOf(c, ALONG));
		h.put("ratio", c -> l.ratio = positives(c));
		h.put("rotate", c -> l.rotate = number(c));
		h.put("count", c -> count[0] = integer(c, number(c), Limits.MAX_COPIES));
		h.put("grow", c -> l.grow = numbers(c));
		h.put("edge", c -> l.line = line(c));
		children(n, List.of("cut"), withEffects(l, h));
		if (l.colors.isEmpty()) {
			return l;
		}
		l.colors = cycle(n, l.colors, count[0]);
		checkWaves(n, l.line);
		l.ratio = ratio(n, l.ratio, l.colors.size());
		if (l.grow != null && l.grow.length != l.colors.size()) {
			errf(n, "has %d colors but %d `grow` values", l.colors.size(), l.grow.length);
		}
		if (l.grow != null) {
			for (double g : l.grow) {
				if (g < 0) {
					errf(n, "`grow` can't be negative");
				}
			}
		}
		if (l.grow != null && l.rotate != 0) {
			errf(n, "a rotated bars keeps its widths at other proportions, so it takes no `grow`");
		}
		return l;
	}

	private Layer chevrons(Node n) {
		Chevrons l = new Chevrons();
		l.colors = gapColorArgs(n);
		noProps(n);
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("from", c -> l.from = oneOf(c, FROM));
		h.put("depth", c -> l.depth = positive(c, number(c)));
		h.put("angle", c -> {
			l.angle = number(c);
			if (l.angle <= 0 || l.angle >= 90) {
				errf(c, "must be between 0 and 90 degrees, exclusive");
			}
		});
		h.put("apex", c -> {
			double apex = number(c);
			if (apex < 0) {
				errf(c, "can't be negative");
			}
			l.apex = apex;
		});
		h.put("ratio", c -> l.ratio = positives(c));
		h.put("rotate", c -> l.rotate = number(c));
		h.put("fimbriate", c -> l.fimbriate = edge(c));
		children(n, List.of("cut"), withEffects(l, h));
		if (l.depth == 0) {
			errf(n, "needs a `depth`");
		}
		if (l.apex != null && l.angle == 0) {
			errf(n, "an off-center `apex` needs an `angle`, since its arms can't meet both corners at one slope");
		}
		l.ratio = ratio(n, l.ratio, l.colors.size());
		return l;
	}

	/** Repeats colors until there are count of them, if count is given. Fewer would drop some silently. */
	private List<String> cycle(Node n, List<String> colors, int count) {
		if (count == 0) {
			return colors;
		}
		if (count < colors.size()) {
			errf(n, "has %d colors but a `count` of %d, which would leave some out", colors.size(), count);
			return colors;
		}
		List<String> out = new ArrayList<>();
		for (int i = 0; i < count; i++) {
			out.add(colors.get(i % colors.size()));
		}
		return out;
	}

	private void checkWaves(Node n, Line l) {
		if (l != null && l.waves(longer) > Limits.MAX_COPIES) {
			errf(n, "a shaped edge can't have more than %d waves", Limits.MAX_COPIES);
		}
	}

	private double[] ratio(Node n, double[] ratio, int count) {
		if (ratio == null) {
			ratio = new double[count];
			Arrays.fill(ratio, 1);
		}
		if (ratio.length != count) {
			errf(n, "has %d colors but a ratio of %d values", count, ratio.length);
		}
		return ratio;
	}

	private Layer band(Node n) {
		Band l = new Band();
		l.color = colorArg(n);
		noProps(n);
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("along", c -> l.along = oneOf(c, ALONG));
		h.put("width", c -> l.width = positive(c, number(c)));
		h.put("offset", c -> l.offset = number(c));
		h.put("rotate", c -> l.rotate = number(c));
		h.put("fimbriate", c -> l.fimbriate = edge(c));
		children(n, List.of("cut"), withEffects(l, h));
		if (l.width == 0) {
			errf(n, "needs a `width`");
		}
		return l;
	}

	private Layer cross(Node n) {
		Cross l = new Cross();
		l.color = colorArg(n);
		noProps(n);
		boolean[] seen = {false, false};
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("fly", c -> {
			l.flyParts = triple(c);
			seen[0] = true;
		});
		h.put("hoist", c -> {
			l.hoistParts = triple(c);
			seen[1] = true;
		});
		h.put("fimbriate", c -> l.fimbriate = edge(c));
		children(n, List.of("cut"), withEffects(l, h));
		if (!seen[0] || !seen[1]) {
			errf(n, "needs `fly` and `hoist`");
		}
		return l;
	}

	/** Reads the distance before an arm, its width and the distance after. */
	private double[] triple(Node n) {
		double[] v = numbers(n);
		if (v.length != 3) {
			errf(n, "needs 3 values: before the arm, its width, and after it");
			return new double[] {0, 1, 0};
		}
		if (v[0] < 0 || v[1] <= 0 || v[2] < 0) {
			errf(n, "the arm's width must be positive and its distances not negative");
			return new double[] {0, 1, 0};
		}
		return v;
	}

	private Layer saltire(Node n) {
		Saltire l = new Saltire();
		l.color = colorArg(n);
		noProps(n);
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("width", c -> l.width = positive(c, number(c)));
		h.put("fimbriate", c -> l.fimbriate = edge(c));
		h.put("counterchange", c -> l.counterchange = flagValue(c));
		children(n, List.of("cut"), withEffects(l, h));
		if (l.width == 0) {
			errf(n, "needs a `width`");
		}
		if (l.counterchange && l.fimbriate != null) {
			errf(n, "a counterchanged saltire can't be fimbriated");
		}
		return l;
	}

	private Layer charge(Node n) {
		List<Value> args = n.args;
		noProps(n);
		if (args.isEmpty() || !args.get(0).isString()) {
			errf(n, "needs a shape");
			return null;
		}
		String name = args.get(0).string;
		if (name.equals("pile") || name.equals("pall")) {
			errf(n, "a %s is a layer of its own, not a charge's shape", name);
			return null;
		}
		Charge l = new Charge();
		l.shape = namedShape(name);
		if (l.shape.kind.equals("svg") && args.size() == 1) {
			// Inline SVG can bring its own colors.
		} else if (args.size() != 2) {
			errf(n, "needs a shape and a color");
			return null;
		} else if (!args.get(1).isString()) {
			errf(n, "color must be a palette name");
			return null;
		} else if (l.shape.kind.equals("svg")) {
			l.color = solidColor(n, args.get(1).string);
		} else {
			l.color = paletteColor(n, args.get(1).string);
		}
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("fimbriate", c -> l.fimbriate = edge(c));
		h.put("repeat", c -> l.repeat = repeat(c));
		shapeBody(n, l.shape, withEffects(l, h));
		Shape s = l.shape;
		if (s.embedded != null && l.color.isEmpty() && s.embedded.usesCurrentColor()) {
			errf(n, "inline SVG uses currentColor, so it needs a palette color");
		} else if (s.kind.equals("svg") && l.fimbriate != null) {
			errf(n, "inline SVG can't be fimbriated");
		} else if (l.fimbriate != null && (s.hollow > 0 || s.lines > 0)) {
			errf(n, "fimbriation edges a filled shape, so it can't go with `hollow` or `lines`");
		} else if (s.kind.equals("svg") && l.repeat != null) {
			errf(n, "inline SVG can't be repeated");
		} else if (s.kind.equals("polygon") && l.repeat != null) {
			errf(n, "a polygon can't be repeated");
		} else if (l.repeat != null && s.ats.size() > 1) {
			errf(n, "several positions and a repeat can't be combined");
		} else if (s.kind.equals("svg") && s.ats.size() > 1) {
			errf(n, "inline SVG can't be repeated");
		} else if (l.repeat != null && l.repeat.kind.equals("grid") && s.placed) {
			errf(n, "a grid repeat spreads across the region, so it can't have `at`");
		}
		return l;
	}

	private Layer emblem(Node n) {
		Emblem l = new Emblem();
		noValues(n);
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("at", c -> l.at = at(c));
		h.put("along", c -> l.along = oneOf(c, ALONG));
		h.put("rotate", c -> l.rotate = number(c));
		Map<String, Consumer<Node>> placed = withEffects(l, h);
		Set<String> seen = new HashSet<>();
		for (Node c : n.children) {
			if (c.name.equals("charge")) {
				Layer got = layer(c, 1);
				if (got instanceof Charge) {
					Charge charge = (Charge) got;
					if (charge.repeat != null && charge.repeat.kind.equals("grid")) {
						errf(c, "a grid repeat needs a region, which an emblem doesn't have");
					}
					frameShape(c, charge.shape);
					if (charge.clip != null) {
						frameShape(c, charge.clip);
					}
					for (Shape cut : charge.cuts) {
						frameShape(c, cut);
					}
					l.charges.add(charge);
				}
				continue;
			}
			Consumer<Node> handler = placed.get(c.name);
			if (handler == null) {
				errf(c, "an emblem can only hold charges");
				continue;
			}
			if (seen.contains(c.name) && !c.name.equals("cut")) {
				errf(c, "given more than once");
			}
			seen.add(c.name);
			handler.accept(c);
		}
		if (l.charges.isEmpty()) {
			errf(n, "needs at least one charge");
		}
		return l;
	}

	/** Refuses what needs a region's size, which an emblem's frame doesn't have. */
	private void frameShape(Node n, Shape s) {
		if (s.kind.equals("lozenge") && (s.fly == 0 || s.hoist == 0)) {
			errf(n, "a lozenge in an emblem needs `fly` and `hoist`, since a frame has no size to take");
		} else if (s.kind.equals("pile") || s.kind.equals("pall")) {
			errf(n, "a %s needs a region's edges, which an emblem doesn't have", s.kind);
		}
	}

	private Repeat repeat(Node n) {
		noChildren(n);
		if (n.args.size() != 1 || !n.args.get(0).isString()) {
			errf(n, "needs a kind: ring or grid");
			return null;
		}
		Repeat r = new Repeat();
		r.kind = n.args.get(0).string;
		switch (r.kind) {
		case "ring":
			onlyArgs(n, 1, "count", "radius", "turn");
			r.count = integer(n, prop(n, "count"), Limits.MAX_COPIES);
			r.radius = positive(n, prop(n, "radius"));
			r.turn = boolProp(n, "turn");
			break;
		case "grid":
			onlyArgs(n, 1, "rows", "columns", "stagger");
			r.rows = integer(n, prop(n, "rows"), Limits.MAX_COPIES);
			r.columns = integer(n, prop(n, "columns"), Limits.MAX_COPIES);
			r.stagger = boolProp(n, "stagger");
			if ((long) r.rows * r.columns > Limits.MAX_COPIES) {
				errf(n, "makes more than %d copies", Limits.MAX_COPIES);
			}
			break;
		case "line": {
			onlyArgs(n, 1, "count", "fly", "hoist");
			r.count = integer(n, prop(n, "count"), Limits.MAX_COPIES);
			Value v = n.prop("fly");
			if (v != null) {
				r.fly = numberValue(n, v);
			}
			v = n.prop("hoist");
			if (v != null) {
				r.hoist = numberValue(n, v);
			}
			if (r.fly == 0 && r.hoist == 0) {
				errf(n, "needs a step: fly= or hoist=");
			}
			break;
		}
		case "arc":
			onlyArgs(n, 1, "count", "radius", "turn", "from", "to");
			r.count = integer(n, prop(n, "count"), Limits.MAX_COPIES);
			r.radius = positive(n, prop(n, "radius"));
			r.turn = boolProp(n, "turn");
			r.from = prop(n, "from");
			r.to = prop(n, "to");
			if (r.count < 2 && r.count != 0) {
				errf(n, "an arc needs at least 2 copies");
			}
			if (n.prop("from") != null && n.prop("to") != null && (r.to - r.from) % 360 == 0) {
				errf(n, "`from` and `to` are the same place, so there's no arc to repeat along");
			}
			break;
		default:
			errf(n, "unknown repeat %s", quote(r.kind));
		}
		return r;
	}

	/** Reads a shape's children, along with any extra handlers. */
	private void shapeBody(Node n, Shape s, Map<String, Consumer<Node>> extra) {
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("at", c -> {
			Point at = at(c);
			if (!s.placed) {
				s.at = at;
			}
			s.placed = true;
			s.ats.add(at);
		});
		h.put("rotate", c -> s.rotate = number(c));
		h.put("hollow", c -> s.hollow = positive(c, number(c)));
		s.placed = false;
		s.ats = new ArrayList<>();
		// What was only worked out from a definition's other values is worked out again.
		if (s.autoInner) {
			s.inner = 0;
			s.autoInner = false;
		}
		if (s.autoSpread) {
			s.spread = 0;
			s.autoSpread = false;
		}
		Consumer<Node> radius = c -> s.radius = positive(c, number(c));
		Consumer<Node> inner = c -> s.inner = positive(c, number(c));
		Consumer<Node> sizeFly = c -> s.fly = positive(c, number(c));
		Consumer<Node> sizeHoist = c -> s.hoist = positive(c, number(c));
		switch (s.kind) {
		case "disc":
		case "triangle":
		case "cardioid":
			h.put("radius", radius);
			break;
		case "crescent":
			h.put("radius", radius);
			h.put("inner", inner);
			h.put("offset", c -> s.offset = positive(c, number(c)));
			break;
		case "sun":
			if (s.points == 0) {
				s.points = 12;
			}
			if (s.spread == 0) {
				s.spread = 1;
			}
			h.put("radius", radius);
			h.put("disc", c -> s.disc = positive(c, number(c)));
			h.put("gap", c -> s.gap = notNegative(c, number(c)));
			h.put("points", c -> s.points = integer(c, number(c), Limits.MAX_COPIES));
			h.put("spread", c -> s.spread = positive(c, number(c)));
			break;
		case "lozenge":
		case "ellipse":
		case "rect":
			h.put("fly", sizeFly);
			h.put("hoist", sizeHoist);
			break;
		case "path":
			h.put("fly", sizeFly);
			h.put("hoist", sizeHoist);
			h.put("d", c -> s.d = pathData(c));
			h.put("box", c -> s.box = boxValue(c, str(c)));
			h.put("evenodd", c -> s.evenOdd = flagValue(c));
			break;
		case "pile":
			h.remove("at");
			h.remove("rotate");
			if (s.edge.isEmpty()) {
				s.edge = "hoist";
			}
			h.put("from", c -> s.edge = oneOf(c, FROM));
			h.put("base", c -> {
				double[] v = numbers(c);
				if (v.length == 2) {
					s.base = v;
				} else {
					errf(c, "needs 2 values: where it starts and ends along the edge");
				}
			});
			h.put("tip", c -> {
				double[] v = numbers(c);
				if (v.length == 2) {
					s.tip = v;
				} else {
					errf(c, "needs 2 values: along the edge, then in from it");
				}
			});
			h.put("depth", c -> s.depth = positive(c, number(c)));
			h.put("flat", c -> {
				s.flat = notNegative(c, number(c));
				s.hasFlat = true;
			});
			break;
		case "pall":
			h.remove("at");
			h.remove("rotate");
			if (s.edge.isEmpty()) {
				s.edge = "hoist";
			}
			h.put("from", c -> s.edge = oneOf(c, FROM));
			h.put("width", c -> s.width = positive(c, number(c)));
			h.put("junction", c -> s.junction = positive(c, number(c)));
			break;
		case "heart":
			h.put("radius", radius);
			h.put("spread", c -> s.spread = positive(c, number(c)));
			break;
		case "ring":
			h.put("radius", radius);
			h.put("inner", inner);
			h.put("from", c -> {
				s.from = number(c);
				s.hasArc = true;
			});
			h.put("to", c -> {
				s.to = number(c);
				s.hasArc = true;
			});
			break;
		case "plus":
			h.put("radius", radius);
			h.put("width", c -> s.width = positive(c, number(c)));
			break;
		case "star":
			if (s.points == 0) {
				s.points = 5;
			}
			h.put("radius", radius);
			h.put("inner", inner);
			h.put("lines", c -> s.lines = positive(c, number(c)));
			h.put("points", c -> {
				s.points = integer(c, number(c), Limits.MAX_COPIES);
				if (s.points > 0 && s.points < 3) {
					errf(c, "needs at least 3 points");
				}
			});
			break;
		case "polygon":
			h.remove("at");
			h.remove("rotate");
			h.put("point", c -> {
				onlyArgs(c, 0, "fly", "hoist");
				noChildren(c);
				s.vertices.add(new Point(prop(c, "fly"), prop(c, "hoist")));
			});
			break;
		case "svg":
			h.put("fly", sizeFly);
			h.put("hoist", sizeHoist);
			h.put("markup", c -> s.markup = str(c));
			break;
		default:
			errf(n, "unknown shape %s", quote(s.kind));
			return;
		}
		if (extra != null) {
			h.putAll(extra);
		}
		List<String> repeatable = new ArrayList<>(List.of("cut", "point"));
		if (extra != null) {
			repeatable.add("at");
		}
		if (s.kind.equals("svg")) {
			h.remove("hollow");
		}
		children(n, repeatable, h);
		checkShape(n, s);
	}

	private void checkShape(Node n, Shape s) {
		if (HAS_RADIUS.contains(s.kind) && s.radius == 0) {
			errf(n, "needs a `radius`");
		}
		switch (s.kind) {
		case "ring":
			if (s.inner == 0 || s.inner >= s.radius) {
				errf(n, "needs an `inner` smaller than its `radius`");
			}
			if (s.hasArc && (s.to - s.from) % 360 == 0) {
				errf(n, "`from` and `to` are the same place, so there's no arc to draw");
			}
			break;
		case "star":
			if (s.lines > 0 && s.hollow > 0) {
				errf(n, "`lines` and `hollow` can't be combined");
			}
			if (s.lines > 0 && s.points < 5) {
				errf(n, "`lines` needs at least 5 points");
			}
			if (s.inner >= s.radius && s.radius > 0) {
				errf(n, "`inner` must be smaller than `radius`");
			}
			if (s.inner == 0 && s.points < 5) {
				errf(n, "needs an `inner` with fewer than 5 points");
			}
			if (s.inner == 0) {
				double k = s.points;
				s.inner = s.radius * Math.cos(2 * Math.PI / k) / Math.cos(Math.PI / k);
				s.autoInner = true;
			}
			break;
		case "rect":
		case "ellipse":
			if (s.fly == 0 || s.hoist == 0) {
				errf(n, "needs `fly` and `hoist`");
			}
			break;
		case "crescent":
			if (s.inner == 0 || s.offset == 0) {
				errf(n, "needs `inner` and `offset`");
			} else if (s.radius > 0 && (s.offset >= s.radius + s.inner || s.offset <= Math.abs(s.radius - s.inner))) {
				errf(n, "`offset` has to make its two circles cross");
			}
			break;
		case "sun":
			if (s.disc == 0) {
				errf(n, "needs a `disc`");
			}
			if (s.radius > 0 && s.disc + s.gap >= s.radius) {
				errf(n, "`disc` and `gap` must be smaller than `radius`");
			}
			if (s.points < 3 && s.points != 0) {
				errf(n, "needs at least 3 points");
			}
			if (s.spread > 1) {
				errf(n, "`spread` can't be more than 1");
			}
			break;
		case "path":
			if (s.d.isEmpty()) {
				errf(n, "needs `d`");
			}
			if (s.box[2] <= 0 || s.box[3] <= 0) {
				errf(n, "needs a `box` with an area");
			}
			if (s.fly == 0 && s.hoist == 0) {
				errf(n, "needs `fly` or `hoist`");
			}
			break;
		case "pile":
			if (s.tip == null && s.depth == 0) {
				errf(n, "needs a `depth` or a `tip`");
			} else if (s.tip != null && s.depth != 0) {
				errf(n, "takes a `depth` or a `tip`, not both");
			} else if (s.tip != null && s.hasFlat) {
				errf(n, "a `flat` goes with a `depth`, not a `tip`");
			}
			break;
		case "pall":
			if (s.width == 0) {
				errf(n, "needs a `width`");
			}
			break;
		case "heart":
			if (s.spread == 0) {
				s.spread = s.radius * Math.sqrt(2);
				s.autoSpread = true;
			}
			if (s.spread >= 2 * s.radius && s.radius > 0) {
				errf(n, "`spread` must be less than twice `radius`, so that the lobes meet");
			}
			break;
		case "plus":
			if (s.width == 0 || s.width >= 2 * s.radius) {
				errf(n, "needs a `width` less than twice its `radius`");
			}
			break;
		case "polygon":
			if (s.vertices.size() < 3) {
				errf(n, "needs at least 3 `point`s");
			}
			break;
		case "svg":
			if (s.fly == 0 || s.hoist == 0) {
				errf(n, "needs `fly` and `hoist`");
			}
			if (s.markup.isEmpty()) {
				errf(n, "needs `markup`");
				return;
			}
			try {
				s.embedded = Sanitizer.sanitize(s.markup);
			} catch (VexylException e) {
				errf(n, "%s", e.getMessage());
				return;
			}
			// Only what passed is kept, so that nothing can read what the sanitizer removed.
			s.markup = s.embedded.canonical();
			break;
		default:
		}
	}

	private Point at(Node n) {
		noChildren(n);
		if (!n.args.isEmpty()) {
			if (n.args.size() != 1 || !n.args.get(0).isString() || !n.args.get(0).string.equals("center") || !n.props.isEmpty()) {
				errf(n, "must be `center` or `fly=A hoist=B`");
			}
			return null;
		}
		onlyArgs(n, 0, "fly", "hoist");
		return new Point(prop(n, "fly"), prop(n, "hoist"));
	}

	/** Reads `border COLOR W`, with an optional side of inside or outside. */
	private Object[] border(Node n) {
		List<Value> args = n.args;
		boolean outside = false;
		if (args.size() == 3) {
			Value side = args.get(2);
			if (!side.isString() || (!side.string.equals("inside") && !side.string.equals("outside"))) {
				errf(n, "side must be inside or outside");
				return new Object[] {null, false};
			}
			outside = side.string.equals("outside");
			args = args.subList(0, 2);
		}
		return new Object[] {edgeArgs(n, args), outside};
	}

	/** Refuses an outside border that can't go around the shape it's given. */
	private void checkOutside(Node n, Outline o, double fly, double hoist, Edge border, boolean outside) {
		if (border == null || !outside || border.width <= 0 || fly <= 0 || hoist <= 0) {
			return;
		}
		List<Geometry.Vec> shape = o == null ? Geometry.rectPoly(0, 0, fly, hoist) : Geometry.outlinePoints(o, fly, hoist);
		if (shape == null) {
			errf(n, "an outside border can't go around a `path` outline");
			return;
		}
		try {
			Geometry.offsetPolygon(shape, border.width);
		} catch (VexylException e) {
			errf(n, "%s", e.getMessage());
		}
	}

	private Edge edge(Node n) {
		return edgeArgs(n, n.args);
	}

	private Edge edgeArgs(Node n, List<Value> args) {
		noProps(n);
		noChildren(n);
		if (args.size() != 2 || !args.get(0).isString()) {
			errf(n, "needs a color and a width");
			return null;
		}
		String color = paletteColor(n, args.get(0).string);
		return new Edge(color, positive(n, numberValue(n, args.get(1))));
	}

	/** Dispatches n's children to handlers, refusing unknown nodes and repeats of anything not repeatable. */
	private void children(Node n, List<String> repeatable, Map<String, Consumer<Node>> handlers) {
		Set<String> seen = new HashSet<>();
		for (Node c : n.children) {
			Consumer<Node> handler = handlers.get(c.name);
			if (handler == null) {
				errf(c, "unknown here");
				continue;
			}
			if (seen.contains(c.name) && !repeatable.contains(c.name)) {
				errf(c, "given more than once");
			}
			seen.add(c.name);
			handler.accept(c);
		}
	}

	private void noValues(Node n) {
		if (!n.args.isEmpty()) {
			errf(n, "takes no arguments");
		}
		noProps(n);
	}

	private void noProps(Node n) {
		if (!n.props.isEmpty()) {
			errf(n, "takes no properties");
		}
	}

	private void noChildren(Node n) {
		if (!n.children.isEmpty()) {
			errf(n, "takes no children");
		}
	}

	/** Checks n's argument count and refuses any property not listed. */
	private void onlyArgs(Node n, int args, String... props) {
		if (n.args.size() != args) {
			errf(n, "takes %d arguments, got %d", args, n.args.size());
		}
		List<String> allowed = List.of(props);
		for (String key : n.props.keySet()) {
			if (!allowed.contains(key)) {
				errf(n, "unknown property %s", quote(key));
			}
		}
	}

	private String str(Node n) {
		noProps(n);
		noChildren(n);
		if (n.args.size() != 1 || !n.args.get(0).isString()) {
			errf(n, "needs one string");
			return "";
		}
		return n.args.get(0).string;
	}

	private String oneOf(Node n, List<String> allowed) {
		String value = str(n);
		if (!value.isEmpty() && !allowed.contains(value)) {
			errf(n, "must be one of %s, got %s", allowed, quote(value));
		}
		return value;
	}

	/** Reads a child that's either bare or holds #true or #false. */
	private boolean flagValue(Node n) {
		noProps(n);
		noChildren(n);
		if (n.args.isEmpty()) {
			return true;
		}
		if (n.args.size() != 1 || n.args.get(0).kind != Kdl.Kind.BOOL) {
			errf(n, "must be #true or #false");
			return false;
		}
		return n.args.get(0).bool;
	}

	private String colorArg(Node n) {
		if (n.args.size() != 1 || !n.args.get(0).isString()) {
			errf(n, "needs one color");
			return "";
		}
		return paletteColor(n, n.args.get(0).string);
	}

	/** Reads a color list that can leave gaps with `none`. */
	private List<String> gapColorArgs(Node n) {
		if (n.args.isEmpty()) {
			errf(n, "needs at least one color");
		}
		List<String> colors = new ArrayList<>();
		for (Value a : n.args) {
			if (!a.isString()) {
				errf(n, "colors must be palette names");
			} else if (a.string.equals(NO_COLOR)) {
				colors.add(NO_COLOR);
			} else {
				colors.add(paletteColor(n, a.string));
			}
		}
		return colors;
	}

	private String paletteColor(Node n, String name) {
		if (gradients.containsKey(name)) {
			return name;
		}
		return solidColor(n, name);
	}

	/** For the places a gradient has no meaning. */
	private String solidColor(Node n, String name) {
		if (palette.containsKey(name)) {
			return name;
		}
		if (gradients.containsKey(name) || gradientNames.contains(name)) {
			errf(n, "%s is a gradient, and a solid color is needed here", quote(name));
			return name;
		}
		errf(n, "color %s isn't in the palette", quote(name));
		return name;
	}

	private double numberValue(Node n, Value v) {
		if (v.kind != Kdl.Kind.NUMBER) {
			errf(n, "needs a number");
			return 0;
		}
		if (!Limits.inLimits(v.number)) {
			errf(n, "needs a finite number of a reasonable size");
			return 0;
		}
		return v.number;
	}

	private double number(Node n) {
		noProps(n);
		noChildren(n);
		if (n.args.size() != 1) {
			errf(n, "needs one number");
			return 0;
		}
		return numberValue(n, n.args.get(0));
	}

	private double[] numbers(Node n) {
		noProps(n);
		noChildren(n);
		double[] values = new double[n.args.size()];
		for (int i = 0; i < values.length; i++) {
			values[i] = numberValue(n, n.args.get(i));
		}
		return values;
	}

	private double[] positives(Node n) {
		double[] values = numbers(n);
		for (double v : values) {
			positive(n, v);
		}
		return values;
	}

	private double positive(Node n, double v) {
		if (v <= 0) {
			errf(n, "needs a positive number");
		}
		return v;
	}

	/** Reads a size that defaults to 0, which can also be written as 0. */
	private double notNegative(Node n, double v) {
		if (v < 0) {
			errf(n, "can't be negative");
		}
		return v;
	}

	private int integer(Node n, double v, int limit) {
		if (v != Math.rint(v) || v < 1) {
			errf(n, "needs a positive whole number");
			return 0;
		}
		if (v > limit) {
			errf(n, "can't be more than %d", limit);
			return 0;
		}
		return (int) v;
	}

	private double prop(Node n, String key) {
		Value v = n.prop(key);
		if (v == null) {
			errf(n, "needs %s=", key);
			return 0;
		}
		return numberValue(n, v);
	}

	private boolean boolProp(Node n, String key) {
		Value v = n.prop(key);
		if (v == null) {
			return false;
		}
		if (v.kind != Kdl.Kind.BOOL) {
			errf(n, "%s must be #true or #false", key);
			return false;
		}
		return v.bool;
	}

	private String pathData(Node n) {
		String d = str(n);
		if (!Numbers.validPath(d)) {
			errf(n, "isn't SVG path data");
			return "";
		}
		return d;
	}

	private double[] boxValue(Node n, String text) {
		double[] values = Numbers.list(text);
		if (values == null || values.length != 4) {
			errf(n, "box must be \"x y width height\", with each a finite decimal number of a reasonable size");
			return new double[4];
		}
		return values;
	}

	/** Reads `edge wavy depth=N period=N` or `edge zigzag depth=N count=N`. */
	private Line line(Node n) {
		noChildren(n);
		if (n.args.size() != 1 || !n.args.get(0).isString()
				|| (!n.args.get(0).string.equals("wavy") && !n.args.get(0).string.equals("zigzag"))) {
			errf(n, "needs a kind: wavy or zigzag");
			return null;
		}
		onlyArgs(n, 1, "depth", "period", "count");
		Line l = new Line();
		l.kind = n.args.get(0).string;
		l.depth = positive(n, prop(n, "depth"));
		Value v = n.prop("period");
		if (v != null) {
			l.period = positive(n, numberValue(n, v));
		}
		v = n.prop("count");
		if (v != null) {
			l.count = integer(n, numberValue(n, v), Limits.MAX_COPIES);
		}
		if (l.period == 0 && l.count == 0) {
			errf(n, "needs `period` or `count`");
			return null;
		}
		if (l.period != 0 && l.count != 0) {
			errf(n, "needs `period` or `count`, not both");
		}
		return l;
	}

	private Layer quarters(Node n) {
		Quarters l = new Quarters();
		List<String> colors = gapColorArgs(n);
		noProps(n);
		if (colors.size() != 4) {
			errf(n, "needs 4 colors");
		} else {
			l.colors = colors.toArray(new String[0]);
		}
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("diagonal", c -> l.diagonal = flagValue(c));
		h.put("split", c -> l.split = at(c));
		children(n, List.of("cut"), withEffects(l, h));
		if (l.diagonal && l.split != null) {
			errf(n, "`split` only applies to upright quarters");
		}
		return l;
	}

	private Layer checks(Node n) {
		Checks l = new Checks();
		l.colors = gapColorArgs(n);
		noProps(n);
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("rows", c -> l.rows = integer(c, number(c), Limits.MAX_COPIES));
		h.put("columns", c -> l.columns = integer(c, number(c), Limits.MAX_COPIES));
		h.put("flow", c -> l.flow = oneOf(c, List.of("bend", "bend-sinister")));
		children(n, List.of("cut"), withEffects(l, h));
		if (l.colors.size() < 2) {
			errf(n, "needs at least 2 colors");
		}
		if (l.rows == 0 || l.columns == 0) {
			errf(n, "needs `rows` and `columns`");
		}
		if ((long) l.rows * l.columns > Limits.MAX_COPIES) {
			errf(n, "makes more than %d cells", Limits.MAX_COPIES);
		}
		return l;
	}

	private Layer rays(Node n) {
		Rays l = new Rays();
		l.colors = gapColorArgs(n);
		noProps(n);
		int[] count = {0};
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("from", c -> {
			if (!c.args.isEmpty()) {
				l.from = oneOf(c, RAY_FROM);
			} else {
				l.at = at(c);
			}
		});
		h.put("count", c -> count[0] = integer(c, number(c), Limits.MAX_COPIES));
		h.put("ratio", c -> l.ratio = positives(c));
		h.put("rotate", c -> l.rotate = number(c));
		h.put("measure", c -> l.byEdge = oneOf(c, List.of("angle", "edge")).equals("edge"));
		children(n, List.of("cut"), withEffects(l, h));
		if (l.byEdge && l.rotate != 0) {
			errf(n, "`measure edge` follows the region's edges, so it can't also have a `rotate`");
		}
		if (l.colors.isEmpty()) {
			return l;
		}
		l.colors = cycle(n, l.colors, count[0]);
		l.ratio = ratio(n, l.ratio, l.colors.size());
		return l;
	}

	/** Reads a pile or pall, which are shapes tied to their region's edges. */
	private Layer ordinaryShape(Node n) {
		Charge l = new Charge();
		l.shape = new Shape();
		l.shape.kind = n.name;
		l.color = colorArg(n);
		noProps(n);
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("fimbriate", c -> l.fimbriate = edge(c));
		shapeBody(n, l.shape, withEffects(l, h));
		if (l.fimbriate != null && l.shape.hollow > 0) {
			errf(n, "fimbriation edges a filled shape, so it can't go with `hollow` or `lines`");
		}
		return l;
	}

	private Layer panel(Node n, int depth) {
		Panel l = new Panel();
		// An `at center` gives no position, but it's still an `at`.
		boolean[] placed = {false};
		noValues(n);
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("side", c -> l.side = oneOf(c, FROM));
		h.put("corner", c -> l.corner = oneOf(c, CORNER));
		h.put("at", c -> {
			l.at = at(c);
			placed[0] = true;
		});
		h.put("width", c -> l.width = positive(c, number(c)));
		h.put("fly", c -> l.fly = positive(c, number(c)));
		h.put("hoist", c -> l.hoist = positive(c, number(c)));
		h.put("edge", c -> l.line = line(c));
		container(n, depth, l, l.layers, h);
		checkWaves(n, l.line);
		if (!l.side.isEmpty() && !l.corner.isEmpty()) {
			errf(n, "needs either `side` or `corner`, not both");
		} else if (!l.side.isEmpty()) {
			if (l.width == 0) {
				errf(n, "a side panel needs a `width`");
			}
			if (l.fly != 0 || l.hoist != 0 || placed[0]) {
				errf(n, "a side panel takes a `width`, and no `fly`, `hoist` or `at`");
			}
		} else {
			if (l.fly == 0 || l.hoist == 0) {
				errf(n, "needs a `side` and `width`, or a `fly` and `hoist`");
			}
			if (l.line != null) {
				errf(n, "only a side panel can have an `edge`");
			}
			if (!l.corner.isEmpty() && placed[0]) {
				errf(n, "needs either `corner` or `at`, not both");
			}
			if (l.width != 0) {
				errf(n, "only a side panel has a `width`");
			}
		}
		if (l.layers.isEmpty()) {
			errf(n, "needs at least one layer");
		}
		return l;
	}

	private Layer use(Node n, int depth) {
		Use l = new Use();
		noProps(n);
		if (n.args.size() != 1 || !n.args.get(0).isString()) {
			errf(n, "needs the name of a definition");
			return null;
		}
		l.name = n.args.get(0).string;
		Define d = defines.get(l.name);
		if (d == null || d.shape != null) {
			errf(n, "%s isn't a defined design", quote(l.name));
			return null;
		}
		if (depth + d.height > Limits.MAX_DEPTH) {
			errf(n, "%s nests more than %d levels deep where it's used", quote(l.name), Limits.MAX_DEPTH);
		}
		l.design = d;
		children(n, List.of("cut"), withEffects(l, null));
		return l;
	}

	/** Reads a reusable shape or design: `define NAME hoist=H fly=F { ... }`. */
	private void define(Node n) {
		if (n.args.size() != 1 || !n.args.get(0).isString()) {
			errf(n, "needs a name");
			return;
		}
		String name = n.args.get(0).string;
		if (name.isEmpty()) {
			errf(n, "needs a name");
			return;
		}
		if (defines.containsKey(name) || SHAPE_KINDS.contains(name) || name.equals("svg") || name.equals("pile") || name.equals("pall")) {
			errf(n, "%s is already taken", quote(name));
			return;
		}
		onlyArgs(n, 1, "hoist", "fly");
		Define d = new Define();
		if (n.prop("fly") != null || n.prop("hoist") != null) {
			d.fly = positive(n, prop(n, "fly"));
			d.hoist = positive(n, prop(n, "hoist"));
		}
		if (n.children.isEmpty()) {
			errf(n, "needs a shape or layers");
			return;
		}
		List<Node> nodes = n.children;
		if (nodes.size() == 1 && SHAPE_KINDS.contains(nodes.get(0).name)) {
			Node c = nodes.get(0);
			if (d.fly != 0) {
				errf(n, "only a design has its own grid, and a shape takes its size from what uses it");
			}
			Shape s = new Shape();
			s.kind = c.name;
			if (s.kind.equals("path") && !c.args.isEmpty()) {
				// The usual form, `path "M..." box="0 0 10 10"`, puts it all on one line. Its size
				// comes from each charge using it, so nothing more can be checked yet.
				Object[] line = linePath(c);
				s.d = (String) line[0];
				s.box = (double[]) line[1];
				d.shape = s;
				defines.put(name, d);
				return;
			}
			noValues(c);
			shapeBody(c, s, null);
			d.shape = s;
			defines.put(name, d);
			return;
		}
		for (Node c : nodes) {
			Layer l = layer(c, 2);
			if (l != null) {
				d.layers.add(l);
			}
		}
		d.size = Limits.layersSize(d.layers, longer);
		d.height = Limits.layersHeight(d.layers);
		defines.put(name, d);
	}

	/** Reads the one-line form of a path, `path "M..." box="x y width height"`, which takes nothing else. */
	private Object[] linePath(Node n) {
		onlyArgs(n, 1, "box");
		noChildren(n);
		String d = "";
		double[] box = new double[4];
		if (n.args.size() == 1 && n.args.get(0).isString() && Numbers.validPath(n.args.get(0).string)) {
			d = n.args.get(0).string;
		} else {
			errf(n, "isn't SVG path data");
		}
		Value b = n.prop("box");
		if (b != null && b.isString()) {
			box = boxValue(n, b.string);
		}
		if (box[2] <= 0 || box[3] <= 0) {
			errf(n, "needs a `box` with an area");
		}
		return new Object[] {d, box};
	}

	/** Reads a flag's silhouette: a polygon or path inside it, or a named form. */
	private Outline outline(Node n) {
		noProps(n);
		Outline o = new Outline();
		List<Value> args = n.args;
		if (args.size() > 1 || (args.size() == 1 && !args.get(0).isString())) {
			errf(n, "takes a named form, or a polygon or path inside it");
			return null;
		}
		if (args.size() == 1) {
			o.kind = args.get(0).string;
			switch (o.kind) {
			case "swallowtail":
			case "tongued":
			case "pennant":
				break;
			default:
				errf(n, "unknown form %s", quote(o.kind));
				return null;
			}
			Set<String> given = new HashSet<>();
			Map<String, Consumer<Node>> h = new HashMap<>();
			h.put("depth", c -> {
				o.depth = positive(c, number(c));
				given.add("depth");
			});
			h.put("tip", c -> {
				o.tip = notNegative(c, number(c));
				given.add("tip");
			});
			h.put("tongue", c -> {
				o.tongue = positive(c, number(c));
				given.add("tongue");
			});
			h.put("taper", c -> {
				o.taper = notNegative(c, number(c));
				given.add("taper");
			});
			children(n, List.of(), h);
			if (!o.kind.equals("pennant") && o.depth == 0) {
				errf(n, "needs a `depth`");
			}
			if (o.kind.equals("tongued") && o.tongue == 0) {
				errf(n, "needs a `tongue`");
			}
			if ((given.contains("tip") && !o.kind.equals("pennant")) || (given.contains("tongue") && !o.kind.equals("tongued"))
					|| (given.contains("taper") && !o.kind.equals("swallowtail")) || (given.contains("depth") && o.kind.equals("pennant"))) {
				errf(n, "has a value that a %s doesn't use", o.kind);
			}
			return o;
		}
		int[] shapes = {0};
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("polygon", c -> {
			if (++shapes[0] > 1) {
				errf(c, "an outline holds one shape");
			}
			Shape s = new Shape();
			s.kind = "polygon";
			noValues(c);
			shapeBody(c, s, null);
			if (s.hollow > 0) {
				errf(c, "an outline is a whole shape, so it can't be `hollow`");
			}
			o.kind = "polygon";
			o.vertices = s.vertices;
		});
		h.put("path", c -> {
			if (++shapes[0] > 1) {
				errf(c, "an outline holds one shape");
			}
			o.kind = "path";
			Object[] line = linePath(c);
			o.d = (String) line[0];
			o.box = (double[]) line[1];
		});
		children(n, List.of(), h);
		if (o.kind.isEmpty()) {
			errf(n, "needs a form, a `polygon` or a `path`");
			return null;
		}
		return o;
	}

	private void reverse(Node n, Doc flag) {
		List<Value> args = n.args;
		if (args.size() == 1 && args.get(0).isString() && args.get(0).string.equals("mirror")) {
			// The default, for saying so outright.
			noProps(n);
			noChildren(n);
			return;
		}
		noValues(n);
		Reverse r = new Reverse();
		for (Node c : n.children) {
			// It holds the flag's layers for that side, so they're at the top level.
			Layer l = layer(c, 1);
			if (l != null) {
				r.layers.add(l);
			}
		}
		if (r.layers.isEmpty()) {
			errf(n, "needs layers, or `mirror`");
		}
		count(n, r.layers);
		flag.reverse = r;
	}

	private void adapt(Node n, Doc flag) {
		noValues(n);
		Adapt a = new Adapt();
		java.util.function.Function<Node, String> mode = c -> {
			if (c.args.size() == 1 && c.args.get(0).isString() && c.args.get(0).string.equals("cut")) {
				return "extend";
			}
			return oneOf(c, MODE);
		};
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("range", c -> {
			double[] v = numbers(c);
			if (v.length != 2 || v[0] <= 0 || v[1] < v[0]) {
				errf(c, "needs a lowest and highest fly-to-hoist ratio");
				return;
			}
			a.min = v[0];
			a.max = v[1];
		});
		h.put("wider", c -> a.wider = mode.apply(c));
		h.put("narrower", c -> a.narrower = mode.apply(c));
		children(n, List.of(), h);
		if (a.wider.isEmpty() && a.narrower.isEmpty()) {
			errf(n, "needs `wider`, `narrower` or both");
		}
		flag.adapt = a;
	}

	private void variant(Node n, Doc flag) {
		if (n.args.size() != 1 || !n.args.get(0).isString()) {
			errf(n, "needs a name");
			return;
		}
		noProps(n);
		String name = n.args.get(0).string;
		if (name.isEmpty()) {
			errf(n, "needs a name");
			return;
		}
		if (flag.variants.containsKey(name)) {
			errf(n, "%s is defined twice", quote(name));
			return;
		}
		Variant v = new Variant();
		Map<String, Consumer<Node>> settings = new HashMap<>();
		settings.put("from", c -> v.from = oneOf(c, VIEW));
		settings.put("upright", c -> v.upright = flagValue(c));
		settings.put("ratio", c -> v.ratio = positive(c, number(c)));
		settings.put("proportion", c -> {
			onlyArgs(c, 0, "hoist", "fly");
			v.hoist = positive(c, prop(c, "hoist"));
			v.fly = positive(c, prop(c, "fly"));
			noChildren(c);
		});
		settings.put("outline", c -> v.outline = outline(c));
		settings.put("border", c -> {
			Object[] b = border(c);
			v.border = (Edge) b[0];
			v.borderOutside = (Boolean) b[1];
		});
		Set<String> seen = new HashSet<>();
		for (Node c : n.children) {
			Consumer<Node> handler = settings.get(c.name);
			if (handler == null) {
				// Its layers replace the flag's, so they're at the top level.
				Layer l = layer(c, 1);
				if (l != null) {
					v.layers.add(l);
				}
				continue;
			}
			if (seen.contains(c.name)) {
				errf(c, "given more than once");
			}
			seen.add(c.name);
			handler.accept(c);
		}
		if (seen.contains("proportion")) {
			if (seen.contains("ratio")) {
				errf(n, "can't have both `proportion` and `ratio`");
			}
			if (v.layers.isEmpty()) {
				errf(n, "with a `proportion` needs its own layers");
			}
		}
		if (v.outline != null || v.border != null || v.fly > 0) {
			// What it draws within is its own or the flag's, as it would be when rendered.
			double fly = flag.fly, hoist = flag.hoist;
			Outline outline = flag.outline;
			Edge border = flag.border;
			boolean outside = flag.borderOutside;
			if (v.fly > 0) {
				fly = v.fly;
				hoist = v.hoist;
				outline = null;
				border = null;
				outside = false;
			}
			if (v.outline != null) {
				outline = v.outline;
			}
			if (v.border != null) {
				border = v.border;
				outside = v.borderOutside;
			}
			checkOutside(n, outline, fly, hoist, border, outside);
		}
		count(n, v.layers);
		flag.variants.put(name, v);
	}

	/** Reads a text with any sources for it as children. */
	private Reference reference(Node n) {
		noProps(n);
		if (n.args.size() != 1 || !n.args.get(0).isString()) {
			errf(n, "needs one string");
			return null;
		}
		Reference r = new Reference();
		r.text = n.args.get(0).string;
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("source", str(r.sources::add));
		children(n, List.of("source"), h);
		return r;
	}

	/** Reads a named sequence of folds. */
	private void fold(Node n, Doc flag) {
		if (n.args.size() != 1 || !n.args.get(0).isString()) {
			errf(n, "needs a name");
			return;
		}
		noProps(n);
		String name = n.args.get(0).string;
		if (name.isEmpty()) {
			errf(n, "needs a name");
			return;
		}
		if (flag.folds.containsKey(name)) {
			errf(n, "%s is defined twice", quote(name));
			return;
		}
		Fold f = new Fold();
		Consumer<Node> step = c -> {
			FoldStep s = foldStep(c);
			if (s != null) {
				f.steps.add(s);
			}
		};
		Map<String, Consumer<Node>> h = new HashMap<>();
		h.put("description", str(v -> f.description = v));
		h.put("source", str(f.sources::add));
		h.put("over", step);
		h.put("under", step);
		h.put("tuck", step);
		children(n, List.of("source", "over", "under", "tuck"), h);
		if (f.steps.isEmpty()) {
			errf(n, "needs at least one step");
		}
		flag.folds.put(name, f);
	}

	/** Reads `over along=fly at=5 move=bottom`, or for any line, `over through="a b c d" move="e f"`. */
	private FoldStep foldStep(Node n) {
		noChildren(n);
		onlyArgs(n, 0, "along", "at", "move", "through");
		FoldStep s = new FoldStep();
		s.kind = n.name;
		Value moveValue = n.prop("move");
		if (moveValue == null || !moveValue.isString()) {
			errf(n, "needs move=, the part that moves");
			return null;
		}
		String move = moveValue.string;
		Value through = n.prop("through");
		if (through != null) {
			if (n.prop("along") != null || n.prop("at") != null) {
				errf(n, "a crease is `through=` or `along=` and `at=`, not both");
				return null;
			}
			double[] line = pointList(n, through, 4);
			double[] point = pointList(n, moveValue, 2);
			if (line == null || point == null) {
				return null;
			}
			s.a = new Point(line[0], line[1]);
			s.b = new Point(line[2], line[3]);
			s.moving = new Point(point[0], point[1]);
			s.through = line;
			s.moveTo = point;
			return s;
		}
		Value along = n.prop("along");
		if (along == null || !along.isString() || n.prop("at") == null) {
			errf(n, "needs along= and at=, or through=");
			return null;
		}
		double at = prop(n, "at");
		s.along = along.string;
		s.at = at;
		s.move = move;
		switch (along.string) {
		case "fly":
			s.a = new Point(0, at);
			s.b = new Point(1, at);
			if (move.equals("top")) {
				s.moving = new Point(0, at - 1);
			} else if (move.equals("bottom")) {
				s.moving = new Point(0, at + 1);
			} else {
				errf(n, "a crease along the fly moves top or bottom");
				return null;
			}
			break;
		case "hoist":
			s.a = new Point(at, 0);
			s.b = new Point(at, 1);
			if (move.equals("hoist")) {
				s.moving = new Point(at - 1, 0);
			} else if (move.equals("fly")) {
				s.moving = new Point(at + 1, 0);
			} else {
				errf(n, "a crease along the hoist moves hoist or fly");
				return null;
			}
			break;
		default:
			errf(n, "along must be fly or hoist");
			return null;
		}
		return s;
	}

	private double[] pointList(Node n, Value v, int count) {
		if (!v.isString()) {
			errf(n, "needs %d numbers in a string", count);
			return null;
		}
		double[] values = Numbers.list(v.string);
		if (values == null || values.length != count) {
			errf(n, "needs %d finite decimal numbers of a reasonable size in a string", count);
			return null;
		}
		return values;
	}
}
