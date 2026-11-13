// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** The vexyl command, which checks Vexyl flag documents and renders them to SVG. */
public final class Main {
	private Main() {}

	private static final String USAGE = String.join("\n",
			"usage:",
			"  vexyl render [options] FILE   render a flag to SVG",
			"  vexyl check [-json] FILE...   validate flags, with -json listing one file's problems",
			"  vexyl model FILE              print a flag's parsed model as JSON",
			"  vexyl tree [options] FILE     print a render as a tree of elements, as JSON",
			"  vexyl locate [-line N] FILE   print where each layer and part of a document is, as JSON,",
			"                                or just what's innermost at a line",
			"  vexyl share encode FILE       print a document as a share link's part after its #",
			"  vexyl share decode FILE       print the document in a file holding that part",
			"  vexyl version                 print this command's version and the format version it reads",
			"",
			"render options:",
			"  -o FILE         write to a file instead of standard output",
			"  -height PIXELS  the image's height",
			"  -ratio H:F      another proportion, by the flag's adapt rules, written hoist",
			"                  then fly, such as 1:2",
			"  -variant NAME   one of the flag's variants, such as vertical or banner",
			"  -side SIDE      obverse or reverse",
			"  -fit FIT        error, the default, or pad with transparency if the flag",
			"                  can't reach the ratio",
			"  -align WHERE    place a padded flag: left, top or start; center; or right,",
			"                  bottom or end",
			"  -fold NAME      show one of the flag's folds",
			"  -fold-step N    stop the fold after N steps",
			"  -id-prefix TEXT start every ID in the output with this",
			"  -tags           mark each drawn element with the layer that drew it",
			"",
			"FILE can be - for standard input.",
			"");

	/** A failure to report, with the command's usage or without. */
	private static final class Failure extends Exception {
		private static final long serialVersionUID = 1L;

		Failure(String message) {
			super(message);
		}
	}

	public static void main(String[] args) {
		PrintStream out = new PrintStream(System.out, false, StandardCharsets.UTF_8);
		int status;
		try {
			run(args, System.in, out);
			status = 0;
		} catch (Failure | VexylException | IOException e) {
			out.flush();
			System.err.println(e.getMessage());
			status = 1;
		}
		out.flush();
		System.exit(status);
	}

	static void run(String[] args, InputStream stdin, PrintStream stdout) throws Failure, VexylException, IOException {
		if (args.length == 0) {
			throw new Failure(USAGE);
		}
		List<String> rest = List.of(args).subList(1, args.length);
		switch (args[0]) {
		case "render":
			render(rest, false, stdin, stdout);
			return;
		case "tree":
			render(rest, true, stdin, stdout);
			return;
		case "check":
			if (!rest.isEmpty() && rest.get(0).equals("-json")) {
				checkJson(rest.subList(1, rest.size()), stdin, stdout);
			} else {
				check(rest, stdin);
			}
			return;
		case "model":
			if (rest.size() != 1) {
				throw new Failure("model needs one file\n" + USAGE);
			}
			stdout.print(load(rest.get(0), stdin).modelJson() + "\n");
			return;
		case "locate":
			locate(rest, stdin, stdout);
			return;
		case "share":
			share(rest, stdin, stdout);
			return;
		case "version":
		case "-version":
		case "--version":
			stdout.print("vexyl " + version() + ", format " + Vexyl.FORMAT_VERSION + "\n");
			return;
		case "help":
		case "-h":
		case "--help":
			stdout.print(USAGE);
			return;
		default:
			throw new Failure("unknown command \"" + args[0] + "\"\n" + USAGE);
		}
	}

	private static String version() {
		String v = Main.class.getPackage().getImplementationVersion();
		return v == null ? "devel" : v;
	}

	private static byte[] readAll(String path, InputStream stdin) throws IOException {
		if (path.equals("-")) {
			return stdin.readAllBytes();
		}
		return Files.readAllBytes(Path.of(path));
	}

	private static Flag load(String path, InputStream stdin) throws IOException, ProblemsException {
		return Vexyl.parse(readAll(path, stdin));
	}

	/** Lists one file's problems for tools, and fails if it has any. */
	private static void checkJson(List<String> paths, InputStream stdin, PrintStream stdout) throws Failure, IOException {
		if (paths.size() != 1) {
			throw new Failure("check -json needs one file\n" + USAGE);
		}
		List<Problem> problems = Vexyl.validate(readAll(paths.get(0), stdin));
		List<Object> list = new ArrayList<>();
		for (Problem p : problems) {
			Map<String, Object> item = new LinkedHashMap<>();
			item.put("message", p.message());
			if (p.hasLine()) {
				item.put("line", p.line());
				item.put("column", p.column());
			}
			if (p.node() != null && !p.node().isEmpty()) {
				item.put("node", p.node());
			}
			list.add(item);
		}
		stdout.print(Json.write(list, true) + "\n");
		if (!problems.isEmpty()) {
			throw new Failure(problems.size() + " problems");
		}
	}

	private static void check(List<String> paths, InputStream stdin) throws Failure, IOException {
		if (paths.isEmpty()) {
			throw new Failure("check needs at least one file\n" + USAGE);
		}
		int failed = 0;
		for (String path : paths) {
			for (Problem p : Vexyl.validate(readAll(path, stdin))) {
				System.err.println(path + ":" + p);
				failed++;
			}
		}
		if (failed > 0) {
			throw new Failure(failed + " problems");
		}
	}

	private static void locate(List<String> args, InputStream stdin, PrintStream stdout) throws Failure, IOException {
		int line = 0;
		List<String> files = new ArrayList<>();
		for (int i = 0; i < args.size(); i++) {
			String a = args.get(i);
			if (a.equals("-line") || a.equals("--line")) {
				if (i + 1 >= args.size()) {
					throw new Failure("-line needs a number");
				}
				line = parseInt(args.get(++i), "-line");
			} else if (a.startsWith("-line=") || a.startsWith("--line=")) {
				line = parseInt(a.substring(a.indexOf('=') + 1), "-line");
			} else {
				files.add(a);
			}
		}
		if (files.size() != 1) {
			throw new Failure("locate needs one file\n" + USAGE);
		}
		String src = new String(readAll(files.get(0), stdin), StandardCharsets.UTF_8);
		List<Span> spans = Vexyl.locate(src);
		Object result;
		if (line > 0) {
			Optional<Span> s = Vexyl.layerAt(spans, line);
			result = s.isPresent() ? plain(s.get()) : null;
		} else {
			List<Object> all = new ArrayList<>();
			for (Span s : spans) {
				all.add(plain(s));
			}
			result = all;
		}
		stdout.print(Json.write(result, false) + "\n");
	}

	private static Map<String, Object> plain(Span s) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("path", s.path());
		m.put("node", s.node());
		m.put("line", s.line());
		m.put("column", s.column());
		m.put("endLine", s.endLine());
		m.put("endColumn", s.endColumn());
		return m;
	}

	private static void share(List<String> args, InputStream stdin, PrintStream stdout) throws Failure, VexylException, IOException {
		if (args.size() != 2 || (!args.get(0).equals("encode") && !args.get(0).equals("decode"))) {
			throw new Failure("share needs encode or decode, and one file\n" + USAGE);
		}
		byte[] src = readAll(args.get(1), stdin);
		if (args.get(0).equals("encode")) {
			stdout.print(Vexyl.shareEncode(new String(src, StandardCharsets.UTF_8)) + "\n");
			return;
		}
		String link = new String(src, StandardCharsets.UTF_8);
		// Only the line ending a file is dropped, so that other whitespace is still refused.
		int end = link.length();
		while (end > 0 && link.charAt(end - 1) == '\n') {
			end--;
		}
		stdout.print(Vexyl.shareDecode(link.substring(0, end)));
	}

	private static int parseInt(String text, String option) throws Failure {
		try {
			return Integer.parseInt(text);
		} catch (NumberFormatException e) {
			throw new Failure(option + " needs a whole number, got \"" + text + "\"");
		}
	}

	private static double parseDouble(String text, String option) throws Failure {
		try {
			double v = Double.parseDouble(text);
			if (Double.isNaN(v) || text.endsWith("d") || text.endsWith("D") || text.endsWith("f") || text.endsWith("F")) {
				throw new NumberFormatException();
			}
			return v;
		} catch (NumberFormatException e) {
			throw new Failure(option + " needs a number, got \"" + text + "\"");
		}
	}

	private static void render(List<String> args, boolean asTree, InputStream stdin, PrintStream stdout)
			throws Failure, VexylException, IOException {
		RenderOptions.Builder opts = RenderOptions.builder();
		String output = "";
		List<String> files = new ArrayList<>();
		for (int i = 0; i < args.size(); i++) {
			String a = args.get(i);
			if (!a.startsWith("-") || a.equals("-")) {
				files.add(a);
				continue;
			}
			String name = a.replaceFirst("^--?", "");
			String value = null;
			int eq = name.indexOf('=');
			if (eq >= 0) {
				value = name.substring(eq + 1);
				name = name.substring(0, eq);
			}
			if (name.equals("tags")) {
				opts.tags(value == null || Boolean.parseBoolean(value));
				continue;
			}
			if (value == null) {
				if (i + 1 >= args.size()) {
					throw new Failure("flag needs an argument: -" + name);
				}
				value = args.get(++i);
			}
			switch (name) {
			case "o":
				output = value;
				break;
			case "height":
				double height = parseDouble(value, "-height");
				if (height <= 0) {
					throw new Failure("-height must be positive");
				}
				opts.height(height);
				break;
			case "ratio":
				opts.ratio(parseRatio(value));
				break;
			case "variant":
				opts.variant(value);
				break;
			case "side":
				opts.side(value);
				break;
			case "fit":
				opts.fit(value);
				break;
			case "align":
				opts.align(align(value));
				break;
			case "fold":
				opts.fold(value);
				break;
			case "fold-step":
				opts.foldStep(parseInt(value, "-fold-step"));
				break;
			case "id-prefix":
				opts.idPrefix(value);
				break;
			default:
				throw new Failure("flag provided but not defined: -" + name + "\n" + USAGE);
			}
		}
		if (files.size() != 1) {
			throw new Failure("render needs one file\n" + USAGE);
		}
		Flag flag = load(files.get(0), stdin);
		String text;
		if (asTree) {
			text = Json.write(treeJson(flag.svgTree(opts.build())), false) + "\n";
		} else {
			text = flag.svg(opts.build());
		}
		if (!output.isEmpty()) {
			Files.write(Path.of(output), text.getBytes(StandardCharsets.UTF_8));
		} else {
			stdout.print(text);
		}
	}

	private static String align(String value) throws Failure {
		switch (value) {
		case "left": case "top": case "start":
			return "start";
		case "center":
			return "center";
		case "right": case "bottom": case "end":
			return "end";
		default:
			throw new Failure("-align must be left, right, top, bottom or center, got \"" + value + "\"");
		}
	}

	/** Reads hoist:fly, as flag proportions are written, into fly over hoist. */
	private static double parseRatio(String text) throws Failure {
		int colon = text.indexOf(':');
		Failure bad = new Failure("-ratio must look like 1:2, hoist then fly, got \"" + text + "\"");
		if (colon < 0) {
			throw bad;
		}
		double hoist, fly;
		try {
			hoist = parseDouble(text.substring(0, colon), "-ratio");
			fly = parseDouble(text.substring(colon + 1), "-ratio");
		} catch (Failure e) {
			throw bad;
		}
		if (hoist <= 0 || fly <= 0) {
			throw bad;
		}
		return fly / hoist;
	}

	private static Map<String, Object> treeJson(Element e) {
		List<Object> attrs = new ArrayList<>();
		for (Element.Attribute a : e.attrs()) {
			Map<String, Object> m = new LinkedHashMap<>();
			m.put("name", a.name());
			m.put("value", a.value());
			attrs.add(m);
		}
		List<Object> children = new ArrayList<>();
		for (Element c : e.children()) {
			children.add(treeJson(c));
		}
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("name", e.name());
		out.put("attrs", attrs);
		out.put("children", children);
		if (!e.text().isEmpty()) {
			out.put("text", e.text());
		}
		return out;
	}
}
