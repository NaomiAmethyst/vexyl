// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! Checks the library against the conformance suite's fixtures, from inside a checkout of the
//! repository. Pictures are left to conformance/run.py, which has a rasterizer.

use std::path::{Path, PathBuf};

use vexyl::{Map, RenderOptions, Value};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn suite(path: &str) -> PathBuf {
    root().join("conformance").join(path)
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// A small JSON reader, enough for the fixtures.
struct Json<'a> {
    s: &'a [u8],
    i: usize,
}

fn json(text: &str) -> Value {
    let mut j = Json {
        s: text.as_bytes(),
        i: 0,
    };
    let v = j.value();
    j.space();
    assert_eq!(j.i, j.s.len(), "JSON has more after its end");
    v
}

impl Json<'_> {
    fn space(&mut self) {
        while self.i < self.s.len() && self.s[self.i].is_ascii_whitespace() {
            self.i += 1;
        }
    }

    fn value(&mut self) -> Value {
        self.space();
        match self.s[self.i] {
            b'{' => {
                self.i += 1;
                let mut m = Map::new();
                loop {
                    self.space();
                    if self.s[self.i] == b'}' {
                        self.i += 1;
                        return Value::Map(m);
                    }
                    let Value::String(k) = self.value() else {
                        panic!("a key that isn't a string")
                    };
                    self.space();
                    assert_eq!(self.s[self.i], b':');
                    self.i += 1;
                    let v = self.value();
                    m.insert(k, v);
                    self.space();
                    if self.s[self.i] == b',' {
                        self.i += 1;
                    }
                }
            }
            b'[' => {
                self.i += 1;
                let mut l = Vec::new();
                loop {
                    self.space();
                    if self.s[self.i] == b']' {
                        self.i += 1;
                        return Value::List(l);
                    }
                    l.push(self.value());
                    self.space();
                    if self.s[self.i] == b',' {
                        self.i += 1;
                    }
                }
            }
            b'"' => {
                self.i += 1;
                let mut b = String::new();
                loop {
                    let c = self.s[self.i];
                    self.i += 1;
                    match c {
                        b'"' => return Value::String(b),
                        b'\\' => {
                            let e = self.s[self.i];
                            self.i += 1;
                            match e {
                                b'n' => b.push('\n'),
                                b'r' => b.push('\r'),
                                b't' => b.push('\t'),
                                b'b' => b.push('\u{8}'),
                                b'f' => b.push('\u{c}'),
                                b'u' => {
                                    let mut code = self.hex4();
                                    if (0xD800..0xDC00).contains(&code) {
                                        self.i += 2;
                                        let low = self.hex4();
                                        code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                                    }
                                    b.push(char::from_u32(code).unwrap());
                                }
                                other => b.push(other as char),
                            }
                        }
                        _ => {
                            let start = self.i - 1;
                            let mut end = self.i;
                            while end < self.s.len() && (self.s[end] & 0xC0) == 0x80 {
                                end += 1;
                            }
                            b.push_str(std::str::from_utf8(&self.s[start..end]).unwrap());
                            self.i = end;
                        }
                    }
                }
            }
            b't' => {
                self.i += 4;
                Value::Bool(true)
            }
            b'f' => {
                self.i += 5;
                Value::Bool(false)
            }
            b'n' => {
                self.i += 4;
                Value::Null
            }
            _ => {
                let start = self.i;
                while self.i < self.s.len() && b"+-0123456789.eE".contains(&self.s[self.i]) {
                    self.i += 1;
                }
                let text = std::str::from_utf8(&self.s[start..self.i]).unwrap();
                Value::Number(text.parse().unwrap())
            }
        }
    }

    fn hex4(&mut self) -> u32 {
        let text = std::str::from_utf8(&self.s[self.i..self.i + 4]).unwrap();
        self.i += 4;
        u32::from_str_radix(text, 16).unwrap()
    }
}

/// Where two models differ, if they do, allowing numbers one part in a million apart.
fn differs(a: &Value, b: &Value, at: &str) -> Option<String> {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let scale = x.abs().max(y.abs());
            let ok = if scale < 1.0 {
                (x - y).abs() <= 1e-6
            } else {
                (x - y).abs() <= 1e-6 * scale
            };
            (!ok).then(|| format!("{at}: {x} != {y}"))
        }
        (Value::Map(x), Value::Map(y)) => {
            let mut xk: Vec<&str> = x.keys().collect();
            let mut yk: Vec<&str> = y.keys().collect();
            xk.sort();
            yk.sort();
            if xk != yk {
                return Some(format!("{at}: keys {xk:?} != {yk:?}"));
            }
            xk.iter()
                .find_map(|k| differs(x.get(k).unwrap(), y.get(k).unwrap(), &format!("{at}.{k}")))
        }
        (Value::List(x), Value::List(y)) => {
            if x.len() != y.len() {
                return Some(format!("{at}: {} items != {}", x.len(), y.len()));
            }
            x.iter()
                .zip(y)
                .enumerate()
                .find_map(|(i, (p, q))| differs(p, q, &format!("{at}[{i}]")))
        }
        _ => (a != b).then(|| format!("{at}: {a:?} != {b:?}")),
    }
}

fn manifest() -> Value {
    json(&read(&suite("manifest.json")))
}

fn options(o: &Value) -> RenderOptions {
    let mut opts = RenderOptions::new();
    let get = |k: &str| o.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    if let Some(r) = o.get("ratio").and_then(Value::as_str) {
        let (h, f) = r.split_once(':').unwrap();
        opts.ratio = Some(f.parse::<f64>().unwrap() / h.parse::<f64>().unwrap());
    }
    opts.variant = get("variant");
    opts.side = get("side");
    opts.fit = get("fit");
    opts.align = match get("align").as_str() {
        "left" | "top" => "start".into(),
        "right" | "bottom" => "end".into(),
        other => other.into(),
    };
    opts.fold = get("fold");
    opts.fold_step = o.get("fold_step").and_then(Value::as_f64).map(|n| n as i64);
    opts
}

#[test]
fn gives_every_flag_its_model() {
    for case in manifest().get("cases").unwrap().as_list().unwrap() {
        let file = case.get("file").unwrap().as_str().unwrap();
        let flag =
            vexyl::parse(&read(&suite(file))).unwrap_or_else(|p| panic!("{file} isn't valid: {p}"));
        let want = json(&read(&suite(case.get("model").unwrap().as_str().unwrap())));
        // The model is written as JSON and read back, as the suite reads it.
        let got = json(&flag.model_json());
        if let Some(d) = differs(&got, &want, file) {
            panic!("{d}");
        }
    }
}

#[test]
fn renders_every_form_and_refuses_the_rest() {
    for case in manifest().get("cases").unwrap().as_list().unwrap() {
        let file = case.get("file").unwrap().as_str().unwrap();
        let flag = vexyl::parse(&read(&suite(file))).unwrap();
        let before = flag.model();
        for render in case.get("renders").unwrap().as_list().unwrap() {
            let name = render.get("name").unwrap().as_str().unwrap();
            let opts = options(render.get("options").unwrap());
            let refused = render.get("refused").and_then(Value::as_bool) == Some(true);
            match flag.svg(&opts) {
                Ok(svg) => {
                    assert!(!refused, "{file} {name} should be refused");
                    assert!(
                        !svg.contains(vexyl::TAG_ATTRIBUTE),
                        "{file} {name} is tagged"
                    );
                    assert_eq!(
                        flag.svg(&opts).unwrap(),
                        svg,
                        "{file} {name} renders differently twice"
                    );
                    let tagged = flag.svg(&opts.clone().tags(true)).unwrap();
                    assert!(
                        tagged.contains(vexyl::TAG_ATTRIBUTE),
                        "{file} {name} isn't tagged"
                    );
                }
                Err(e) => assert!(refused, "{file} {name} is refused: {e}"),
            }
        }
        // Rendering never changes a flag.
        assert_eq!(flag.model(), before, "{file} changed when it was rendered");
    }
}

#[test]
fn refuses_every_invalid_document_on_its_line() {
    for case in json(&read(&suite("invalid.json"))).as_list().unwrap() {
        let file = case.get("file").unwrap().as_str().unwrap();
        let problems = vexyl::validate_bytes(&std::fs::read(suite(file)).unwrap());
        assert!(!problems.is_empty(), "{file} is accepted");
        if let Some(line) = case.get("line").and_then(Value::as_f64) {
            let lines: Vec<Option<usize>> = problems.iter().map(|p| p.line).collect();
            assert!(
                lines.contains(&Some(line as usize)),
                "{file} has no problem on line {line}: {problems:?}"
            );
        }
    }
}

#[test]
fn accepts_every_document_at_a_limit() {
    for case in json(&read(&suite("accepted.json"))).as_list().unwrap() {
        let file = case.get("file").unwrap().as_str().unwrap();
        let problems = vexyl::validate(&read(&suite(file)));
        assert!(problems.is_empty(), "{file}: {problems:?}");
    }
}

#[test]
fn sanitizes_artwork_to_its_canonical_form() {
    for case in json(&read(&suite("sanitize.json"))).as_list().unwrap() {
        let file = case.get("file").unwrap().as_str().unwrap();
        let flag = vexyl::parse(&read(&suite(file))).unwrap();
        let want = case.get("markup").unwrap().as_str().unwrap();
        assert!(
            flag.model_json()
                .contains(&Value::from(want).to_json(false)),
            "{file}"
        );
    }
}

#[test]
fn finds_each_part_on_its_lines() {
    for case in json(&read(&suite("locate.json"))).as_list().unwrap() {
        let file = case.get("file").unwrap().as_str().unwrap();
        let spans = vexyl::locate(&read(&suite(file)));
        for (path, lines) in case.get("spans").unwrap().as_map().unwrap().iter() {
            let lines = lines.as_list().unwrap();
            let span = spans
                .iter()
                .find(|s| s.path == path)
                .unwrap_or_else(|| panic!("{file}: no {path}"));
            assert_eq!(
                span.line,
                lines[0].as_f64().unwrap() as usize,
                "{file} {path}"
            );
            assert_eq!(
                span.end_line,
                lines[1].as_f64().unwrap() as usize,
                "{file} {path}"
            );
        }
    }
}

#[test]
fn reads_and_refuses_the_suites_links() {
    let share = json(&read(&suite("share.json")));
    for case in share.get("accepted").unwrap().as_list().unwrap() {
        let file = case.get("link").unwrap().as_str().unwrap();
        let link = read(&suite(file));
        let doc = vexyl::share_decode(link.trim_end_matches('\n'))
            .unwrap_or_else(|e| panic!("{file}: {e}"));
        assert_eq!(
            doc.len(),
            case.get("bytes").unwrap().as_f64().unwrap() as usize,
            "{file}"
        );
    }
    for case in share.get("refused").unwrap().as_list().unwrap() {
        let file = case.get("link").unwrap().as_str().unwrap();
        let bytes = std::fs::read(suite(file)).unwrap();
        let link = String::from_utf8_lossy(&bytes);
        assert!(
            vexyl::share_decode(link.trim_end_matches('\n')).is_err(),
            "{file} is read"
        );
    }
    for file in share.get("encode").unwrap().as_list().unwrap() {
        let doc = read(&suite(file.as_str().unwrap()));
        let link = vexyl::share_encode(&doc).unwrap();
        assert_eq!(vexyl::share_decode(&link).unwrap(), doc);
    }
}

#[test]
fn keeps_a_copy_of_the_dictionary_that_matches() {
    let copy =
        std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/share-v1.dict")).unwrap();
    let original = std::fs::read(root().join("share/v1.dict")).unwrap();
    assert_eq!(copy, original);
}

#[test]
fn has_the_releases_version() {
    // Releases are one train, and ts/package.json says which.
    let pkg = json(&read(&root().join("ts/package.json")));
    assert_eq!(
        pkg.get("version").and_then(Value::as_str),
        Some(env!("CARGO_PKG_VERSION"))
    );
    assert_eq!(vexyl::FORMAT_VERSION, 1);
}

const SWEDEN: &str = r##"vexyl 1
meta { name "Sweden"; description "A cross on blue" }
palette { blue "#006AA7"; yellow "#fecc02" }
proportion hoist=10 fly=16
field blue
cross yellow { fly 5 2 9; hoist 4 2 4 }
"##;

#[test]
fn reports_every_problem_with_its_place() {
    let problems = vexyl::validate(
        "vexyl 1\nmeta { name \"x\" }\npalette { a \"#000000\" }\nproportion hoist=1 fly=1\nfield b\nbars a { ratio 0 }\n",
    );
    let lines: Vec<Option<usize>> = problems.iter().map(|p| p.line).collect();
    assert!(
        lines.contains(&Some(5)) && lines.contains(&Some(6)),
        "{problems:?}"
    );
    // Columns count code points.
    let problems = vexyl::validate("vexyl 1\nmeta { name \"é\"; x 1 }\n");
    let x = problems
        .iter()
        .find(|p| p.node.as_deref() == Some("x"))
        .unwrap();
    assert_eq!((x.line, x.column), (Some(2), Some(18)));
    // What has no one place has no line.
    let problems = vexyl::validate("vexyl 1\n");
    assert!(problems.iter().any(|p| p.line.is_none()));
    assert!(!vexyl::validate_bytes(b"vexyl 1\n\xff").is_empty());
}

#[test]
fn keeps_names_as_keys() {
    let flag = vexyl::parse(
        "vexyl 1\nmeta { name \"x\" }\npalette { __proto__ \"#ABCDEF\" }\nproportion hoist=1 fly=1\nfield __proto__\n",
    )
    .unwrap();
    let model = flag.model();
    let color = model
        .get("palette")
        .and_then(|p| p.get("__proto__"))
        .unwrap();
    assert_eq!(color.get("color").and_then(Value::as_str), Some("#abcdef"));
}

#[test]
fn starts_every_id_with_a_prefix_and_keeps_forms_apart() {
    let flag = vexyl::parse(SWEDEN).unwrap();
    let mine = flag.svg(&RenderOptions::new().id_prefix("mine-")).unwrap();
    let ids: Vec<&str> = mine.split(" id=\"").skip(1).collect();
    assert!(!ids.is_empty());
    assert!(ids.iter().all(|i| i.starts_with("mine-")));
    let plain = flag.svg(&RenderOptions::new()).unwrap();
    let other = vexyl::parse(&SWEDEN.replace("Sweden", "Sverige")).unwrap();
    let first_id = |s: &str| {
        s.split(" id=\"")
            .nth(1)
            .unwrap()
            .split('"')
            .next()
            .unwrap()
            .to_string()
    };
    assert_ne!(
        first_id(&plain),
        first_id(&other.svg(&RenderOptions::new()).unwrap())
    );
    assert!(flag.svg(&RenderOptions::new().id_prefix("1x")).is_err());
}

#[test]
fn sets_the_height_and_refuses_what_it_cant_use() {
    let flag = vexyl::parse(SWEDEN).unwrap();
    let svg = flag.svg(&RenderOptions::new().height(100.0)).unwrap();
    assert!(svg.contains("width=\"160\" height=\"100\""));
    for opts in [
        RenderOptions::new().height(0.0),
        RenderOptions::new().ratio(-1.0),
        RenderOptions::new().variant("none"),
        RenderOptions::new().side("sideways"),
        RenderOptions::new().fit("pad"),
        RenderOptions::new().align("start"),
        RenderOptions::new().fold_step(1),
        RenderOptions::new().fold("none"),
        RenderOptions::new().ratio(1.0),
    ] {
        assert!(flag.svg(&opts).is_err(), "{opts:?}");
    }
}

#[test]
fn gives_a_tree_that_writes_out_the_same() {
    let flag = vexyl::parse(SWEDEN).unwrap();
    let tree = flag.svg_tree(&RenderOptions::new()).unwrap();
    assert_eq!(tree.name, "svg");
    let title = tree.children.iter().find(|c| c.name == "title").unwrap();
    assert_eq!(title.text, "Sweden");
    let desc = tree.children.iter().find(|c| c.name == "desc").unwrap();
    assert_eq!(desc.text, "A cross on blue");
    let again = vexyl::Element::to_string(&tree);
    assert!(again.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\""));
    assert_eq!(tree.attr("height"), Some("600"));
}

#[test]
fn renders_from_many_threads_at_once() {
    let flag = std::sync::Arc::new(vexyl::parse(SWEDEN).unwrap());
    let want = flag.svg(&RenderOptions::new()).unwrap();
    let handles: Vec<_> = (0..8)
        .map(|_| {
            let flag = flag.clone();
            std::thread::spawn(move || flag.svg(&RenderOptions::new()).unwrap())
        })
        .collect();
    for h in handles {
        assert_eq!(h.join().unwrap(), want);
    }
}

#[test]
fn finds_whats_innermost_at_a_line() {
    let spans = vexyl::locate(SWEDEN);
    assert_eq!(
        vexyl::layer_at(&spans, 6).map(|s| s.path.as_str()),
        Some("1")
    );
    assert_eq!(
        vexyl::layer_at(&spans, 3).map(|s| s.path.as_str()),
        // Both colors are on that line, and the later one starts later.
        Some("palette/yellow")
    );
    let vexyl_span = &spans[0];
    assert_eq!(
        (
            vexyl_span.line,
            vexyl_span.column,
            vexyl_span.end_line,
            vexyl_span.end_column
        ),
        (1, 1, 1, 8)
    );
    assert!(vexyl::locate("a \"").is_empty());
    assert_eq!(vexyl::parent_path("3.1"), "3");
}
