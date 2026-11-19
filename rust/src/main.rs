// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! The vexyl command, which checks Vexyl flag documents and renders them to SVG.

use std::io::{Read, Write};
use std::process::ExitCode;

use vexyl::{Element, Map, RenderOptions, Span, Value};

const USAGE: &str = "usage:
  vexyl render [options] FILE   render a flag to SVG
  vexyl check [-json] FILE...   validate flags, with -json listing one file's problems
  vexyl model FILE              print a flag's parsed model as JSON
  vexyl tree [options] FILE     print a render as a tree of elements, as JSON
  vexyl locate [-line N] FILE   print where each layer and part of a document is, as JSON,
                                or just what's innermost at a line
  vexyl share encode FILE       print a document as a share link's part after its #
  vexyl share decode FILE       print the document in a file holding that part
  vexyl version                 print this command's version and the format version it reads

render options:
  -o FILE         write to a file instead of standard output
  -height PIXELS  the image's height
  -ratio H:F      another proportion, by the flag's adapt rules, written hoist
                  then fly, such as 1:2
  -variant NAME   one of the flag's variants, such as vertical or banner
  -side SIDE      obverse or reverse
  -fit FIT        error, the default, or pad with transparency if the flag
                  can't reach the ratio
  -align WHERE    place a padded flag: left, top or start; center; or right,
                  bottom or end
  -fold NAME      show one of the flag's folds
  -fold-step N    stop the fold after N steps
  -id-prefix TEXT start every ID in the output with this
  -tags           mark each drawn element with the layer that drew it

FILE can be - for standard input.
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut out = Vec::new();
    let result = run(&args, &mut out);
    let mut stdout = std::io::stdout().lock();
    let _ = stdout.write_all(&out);
    let _ = stdout.flush();
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

type R = Result<(), String>;

fn run(args: &[String], out: &mut Vec<u8>) -> R {
    let Some(command) = args.first() else {
        return Err(USAGE.into());
    };
    let rest = &args[1..];
    match command.as_str() {
        "render" => render(rest, false, out),
        "tree" => render(rest, true, out),
        "check" => {
            if rest.first().map(String::as_str) == Some("-json") {
                check_json(&rest[1..], out)
            } else {
                check(rest)
            }
        }
        "model" => {
            if rest.len() != 1 {
                return Err(format!("model needs one file\n{USAGE}"));
            }
            let flag = load(&rest[0])?;
            out.extend_from_slice(flag.model_json().as_bytes());
            out.push(b'\n');
            Ok(())
        }
        "locate" => locate(rest, out),
        "share" => share(rest, out),
        "version" | "-version" | "--version" => {
            let line = format!(
                "vexyl {}, format {}\n",
                env!("CARGO_PKG_VERSION"),
                vexyl::FORMAT_VERSION
            );
            out.extend_from_slice(line.as_bytes());
            Ok(())
        }
        "help" | "-h" | "--help" => {
            out.extend_from_slice(USAGE.as_bytes());
            Ok(())
        }
        _ => Err(format!("unknown command \"{command}\"\n{USAGE}")),
    }
}

fn read_all(path: &str) -> Result<Vec<u8>, String> {
    if path == "-" {
        let mut b = Vec::new();
        std::io::stdin()
            .read_to_end(&mut b)
            .map_err(|e| e.to_string())?;
        return Ok(b);
    }
    std::fs::read(path).map_err(|e| format!("{path}: {e}"))
}

fn load(path: &str) -> Result<vexyl::Flag, String> {
    vexyl::parse_bytes(&read_all(path)?).map_err(|p| p.to_string())
}

/// Lists one file's problems for tools, and fails if it has any.
fn check_json(paths: &[String], out: &mut Vec<u8>) -> R {
    if paths.len() != 1 {
        return Err(format!("check -json needs one file\n{USAGE}"));
    }
    let problems = vexyl::validate_bytes(&read_all(&paths[0])?);
    let list: Vec<Value> = problems
        .iter()
        .map(|p| {
            let mut m = Map::new();
            m.insert("message", p.message.as_str().into());
            if let (Some(line), Some(column)) = (p.line, p.column) {
                m.insert("line", line.into());
                m.insert("column", column.into());
            }
            if let Some(node) = &p.node {
                m.insert("node", node.as_str().into());
            }
            m.into()
        })
        .collect();
    out.extend_from_slice(Value::List(list).to_json(true).as_bytes());
    out.push(b'\n');
    if !problems.is_empty() {
        return Err(format!("{} problems", problems.len()));
    }
    Ok(())
}

fn check(paths: &[String]) -> R {
    if paths.is_empty() {
        return Err(format!("check needs at least one file\n{USAGE}"));
    }
    let mut failed = 0;
    for path in paths {
        for p in vexyl::validate_bytes(&read_all(path)?) {
            eprintln!("{path}:{p}");
            failed += 1;
        }
    }
    if failed > 0 {
        return Err(format!("{failed} problems"));
    }
    Ok(())
}

fn parse_int(text: &str, option: &str) -> Result<i64, String> {
    text.parse()
        .map_err(|_| format!("{option} needs a whole number, got \"{text}\""))
}

fn parse_float(text: &str, option: &str) -> Result<f64, String> {
    let bad = || format!("{option} needs a number, got \"{text}\"");
    let v: f64 = text.trim().parse().map_err(|_| bad())?;
    if v.is_nan() {
        return Err(bad());
    }
    Ok(v)
}

fn locate(args: &[String], out: &mut Vec<u8>) -> R {
    let mut line = 0i64;
    let mut files = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if a == "-line" || a == "--line" {
            i += 1;
            let Some(n) = args.get(i) else {
                return Err("-line needs a number".into());
            };
            line = parse_int(n, "-line")?;
        } else if let Some(n) = a
            .strip_prefix("-line=")
            .or_else(|| a.strip_prefix("--line="))
        {
            line = parse_int(n, "-line")?;
        } else {
            files.push(a.clone());
        }
        i += 1;
    }
    if files.len() != 1 {
        return Err(format!("locate needs one file\n{USAGE}"));
    }
    let src = String::from_utf8_lossy(&read_all(&files[0])?).into_owned();
    let spans = vexyl::locate(&src);
    let result = if line > 0 {
        vexyl::layer_at(&spans, line as usize).map_or(Value::Null, plain)
    } else {
        Value::List(spans.iter().map(plain).collect())
    };
    out.extend_from_slice(result.to_json(false).as_bytes());
    out.push(b'\n');
    Ok(())
}

fn plain(s: &Span) -> Value {
    let mut m = Map::new();
    m.insert("path", s.path.as_str().into());
    m.insert("node", s.node.as_str().into());
    m.insert("line", s.line.into());
    m.insert("column", s.column.into());
    m.insert("endLine", s.end_line.into());
    m.insert("endColumn", s.end_column.into());
    m.into()
}

fn share(args: &[String], out: &mut Vec<u8>) -> R {
    if args.len() != 2 || (args[0] != "encode" && args[0] != "decode") {
        return Err(format!(
            "share needs encode or decode, and one file\n{USAGE}"
        ));
    }
    let src = read_all(&args[1])?;
    if args[0] == "encode" {
        let text = String::from_utf8_lossy(&src);
        let link = vexyl::share_encode(&text).map_err(|e| e.to_string())?;
        out.extend_from_slice(link.as_bytes());
        out.push(b'\n');
        return Ok(());
    }
    // Only the line ending a file is dropped, so that other whitespace is still refused.
    let mut end = src.len();
    while end > 0 && src[end - 1] == b'\n' {
        end -= 1;
    }
    let link =
        std::str::from_utf8(&src[..end]).map_err(|_| "a share link has to be text".to_string())?;
    let doc = vexyl::share_decode(link).map_err(|e| e.to_string())?;
    out.extend_from_slice(doc.as_bytes());
    Ok(())
}

fn render(args: &[String], as_tree: bool, out: &mut Vec<u8>) -> R {
    let mut opts = RenderOptions::new();
    let mut output = String::new();
    let mut files = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        i += 1;
        if !a.starts_with('-') || a == "-" {
            files.push(a.clone());
            continue;
        }
        let mut name = a.strip_prefix("--").unwrap_or(&a[1..]).to_string();
        let mut value = None;
        if let Some(eq) = name.find('=') {
            value = Some(name[eq + 1..].to_string());
            name.truncate(eq);
        }
        if name == "tags" {
            opts.tags = value.is_none_or(|v| v.eq_ignore_ascii_case("true"));
            continue;
        }
        let value = match value {
            Some(v) => v,
            None => {
                let Some(v) = args.get(i) else {
                    return Err(format!("flag needs an argument: -{name}"));
                };
                i += 1;
                v.clone()
            }
        };
        match name.as_str() {
            "o" => output = value,
            "height" => {
                let h = parse_float(&value, "-height")?;
                if h <= 0.0 {
                    return Err("-height must be positive".into());
                }
                opts.height = Some(h);
            }
            "ratio" => opts.ratio = Some(parse_ratio(&value)?),
            "variant" => opts.variant = value,
            "side" => opts.side = value,
            "fit" => opts.fit = value,
            "align" => opts.align = align(&value)?.into(),
            "fold" => opts.fold = value,
            "fold-step" => opts.fold_step = Some(parse_int(&value, "-fold-step")?),
            "id-prefix" => opts.id_prefix = value,
            _ => return Err(format!("flag provided but not defined: -{name}\n{USAGE}")),
        }
    }
    if files.len() != 1 {
        return Err(format!("render needs one file\n{USAGE}"));
    }
    let flag = load(&files[0])?;
    let text = if as_tree {
        let tree = flag.svg_tree(&opts).map_err(|e| e.to_string())?;
        format!("{}\n", tree_json(&tree).to_json(false))
    } else {
        flag.svg(&opts).map_err(|e| e.to_string())?
    };
    if !output.is_empty() {
        std::fs::write(&output, text).map_err(|e| format!("{output}: {e}"))?;
    } else {
        out.extend_from_slice(text.as_bytes());
    }
    Ok(())
}

fn align(value: &str) -> Result<&'static str, String> {
    match value {
        "left" | "top" | "start" => Ok("start"),
        "center" => Ok("center"),
        "right" | "bottom" | "end" => Ok("end"),
        _ => Err(format!(
            "-align must be left, right, top, bottom or center, got \"{value}\""
        )),
    }
}

/// Reads hoist:fly, as flag proportions are written, into fly over hoist.
fn parse_ratio(text: &str) -> Result<f64, String> {
    let bad = || format!("-ratio must look like 1:2, hoist then fly, got \"{text}\"");
    let (h, f) = text.split_once(':').ok_or_else(bad)?;
    let hoist = parse_float(h, "-ratio").map_err(|_| bad())?;
    let fly = parse_float(f, "-ratio").map_err(|_| bad())?;
    if hoist <= 0.0 || fly <= 0.0 {
        return Err(bad());
    }
    Ok(fly / hoist)
}

fn tree_json(e: &Element) -> Value {
    let attrs = e
        .attrs
        .iter()
        .map(|(n, v)| {
            let mut m = Map::new();
            m.insert("name", n.as_str().into());
            m.insert("value", v.as_str().into());
            m.into()
        })
        .collect();
    let mut out = Map::new();
    out.insert("name", e.name.as_str().into());
    out.insert("attrs", Value::List(attrs));
    out.insert(
        "children",
        Value::List(e.children.iter().map(tree_json).collect()),
    );
    if !e.text.is_empty() {
        out.insert("text", e.text.as_str().into());
    }
    out.into()
}
