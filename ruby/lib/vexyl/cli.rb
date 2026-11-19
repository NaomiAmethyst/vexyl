# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # The vexyl command, which checks Vexyl flag documents and renders them to SVG, with the same
  # subcommands and options as the Go command, apart from `info`.
  module CLI
    USAGE = <<~TEXT
      usage:
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
    TEXT

    # A failure to report, with the command's usage or without.
    class Failure < StandardError; end

    DECIMAL = /\A[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\z/
    INTEGER = /\A[+-]?[0-9]+\z/

    module_function

    # Runs the command with its arguments, giving the exit status.
    def main(args, stdin: $stdin, stdout: $stdout, stderr: $stderr)
      stdout.binmode
      run(args, stdin, stdout, stderr)
      stdout.flush
      0
    rescue Failure, Error, SystemCallError => e
      stdout.flush
      stderr.puts(e.message)
      1
    end

    def run(args, stdin, stdout, stderr)
      raise Failure, USAGE if args.empty?
      rest = args[1..]
      case args[0]
      when "render" then render(rest, false, stdin, stdout)
      when "tree" then render(rest, true, stdin, stdout)
      when "check"
        if rest[0] == "-json"
          check_json(rest[1..], stdin, stdout)
        else
          check(rest, stdin, stderr)
        end
      when "model"
        raise Failure, "model needs one file\n#{USAGE}" if rest.length != 1
        stdout.write(Vexyl.parse(read_all(rest[0], stdin)).model_json, "\n")
      when "locate" then locate(rest, stdin, stdout)
      when "share" then share(rest, stdin, stdout)
      when "version", "-version", "--version"
        stdout.write("vexyl #{VERSION}, format #{FORMAT_VERSION}\n")
      when "help", "-h", "--help"
        stdout.write(USAGE)
      else
        raise Failure, "unknown command \"#{args[0]}\"\n#{USAGE}"
      end
    end

    def read_all(path, stdin)
      path == "-" ? stdin.binmode.read : File.binread(path)
    end

    # Lists one file's problems for tools, and fails if it has any.
    def check_json(paths, stdin, stdout)
      raise Failure, "check -json needs one file\n#{USAGE}" if paths.length != 1
      problems = Vexyl.validate(read_all(paths[0], stdin))
      list = problems.map do |p|
        item = { "message" => p.message }
        if p.line?
          item["line"] = p.line
          item["column"] = p.column
        end
        item["node"] = p.node if p.node && !p.node.empty?
        item
      end
      stdout.write(Json.write(list), "\n")
      raise Failure, "#{problems.length} problems" unless problems.empty?
    end

    def check(paths, stdin, stderr)
      raise Failure, "check needs at least one file\n#{USAGE}" if paths.empty?
      failed = 0
      paths.each do |path|
        Vexyl.validate(read_all(path, stdin)).each do |p|
          stderr.puts("#{path}:#{p}")
          failed += 1
        end
      end
      raise Failure, "#{failed} problems" if failed.positive?
    end

    def locate(args, stdin, stdout)
      line = 0
      files = []
      i = 0
      while i < args.length
        a = args[i]
        if a == "-line" || a == "--line"
          raise Failure, "-line needs a number" if i + 1 >= args.length
          i += 1
          line = parse_int(args[i], "-line")
        elsif a.start_with?("-line=", "--line=")
          line = parse_int(a[(a.index("=") + 1)..], "-line")
        else
          files << a
        end
        i += 1
      end
      raise Failure, "locate needs one file\n#{USAGE}" if files.length != 1
      src = read_all(files[0], stdin).force_encoding(Encoding::UTF_8).scrub
      spans = Vexyl.locate(src)
      result = if line.positive?
                 Vexyl.layer_at(spans, line)&.to_h
               else
                 spans.map(&:to_h)
               end
      stdout.write(Json.write(result, indent: false), "\n")
    end

    def share(args, stdin, stdout)
      if args.length != 2 || !%w[encode decode].include?(args[0])
        raise Failure, "share needs encode or decode, and one file\n#{USAGE}"
      end
      src = read_all(args[1], stdin).force_encoding(Encoding::UTF_8)
      if args[0] == "encode"
        stdout.write(Vexyl.share_encode(src.scrub), "\n")
        return
      end
      # Only the line ending a file is dropped, so that other whitespace is still refused.
      stdout.write(Vexyl.share_decode(src.b.sub(/\n+\z/, "")))
    end

    def parse_int(text, option)
      raise Failure, "#{option} needs a whole number, got \"#{text}\"" unless INTEGER.match?(text)
      Integer(text, 10)
    end

    def parse_double(text, option)
      raise Failure, "#{option} needs a number, got \"#{text}\"" unless DECIMAL.match?(text)
      Float(text)
    end

    def render(args, as_tree, stdin, stdout)
      opts = {}
      output = ""
      files = []
      i = 0
      while i < args.length
        a = args[i]
        i += 1
        if !a.start_with?("-") || a == "-"
          files << a
          next
        end
        name = a.sub(/\A--?/, "")
        value = nil
        if (eq = name.index("="))
          value = name[(eq + 1)..]
          name = name[0, eq]
        end
        if name == "tags"
          opts[:tags] = value.nil? || value.casecmp?("true")
          next
        end
        if value.nil?
          raise Failure, "flag needs an argument: -#{name}" if i >= args.length
          value = args[i]
          i += 1
        end
        case name
        when "o" then output = value
        when "height"
          height = parse_double(value, "-height")
          raise Failure, "-height must be positive" if height <= 0
          opts[:height] = height
        when "ratio" then opts[:ratio] = parse_ratio(value)
        when "variant" then opts[:variant] = value
        when "side" then opts[:side] = value
        when "fit" then opts[:fit] = value
        when "align" then opts[:align] = align(value)
        when "fold" then opts[:fold] = value
        when "fold-step" then opts[:fold_step] = parse_int(value, "-fold-step")
        when "id-prefix" then opts[:id_prefix] = value
        else raise Failure, "flag provided but not defined: -#{name}\n#{USAGE}"
        end
      end
      raise Failure, "render needs one file\n#{USAGE}" if files.length != 1
      flag = Vexyl.parse(read_all(files[0], stdin))
      options = RenderOptions.new(**opts)
      text = if as_tree
               "#{Json.write(flag.svg_tree(options).to_h, indent: false)}\n"
             else
               flag.svg(options)
             end
      if output.empty?
        stdout.write(text)
      else
        File.binwrite(output, text)
      end
    end

    def align(value)
      case value
      when "left", "top", "start" then "start"
      when "center" then "center"
      when "right", "bottom", "end" then "end"
      else raise Failure, "-align must be left, right, top, bottom or center, got \"#{value}\""
      end
    end

    # Reads hoist:fly, as flag proportions are written, into fly over hoist.
    def parse_ratio(text)
      bad = "-ratio must look like 1:2, hoist then fly, got \"#{text}\""
      colon = text.index(":")
      raise Failure, bad if colon.nil?
      hoist_text = text[0, colon]
      fly_text = text[(colon + 1)..]
      raise Failure, bad unless DECIMAL.match?(hoist_text) && DECIMAL.match?(fly_text)
      hoist = Float(hoist_text)
      fly = Float(fly_text)
      raise Failure, bad if hoist <= 0 || fly <= 0
      fly / hoist
    end
  end
end
