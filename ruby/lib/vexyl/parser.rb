# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

require "digest"

module Vexyl
  # Reads a document into a flag, reporting every problem it finds.
  class Parser
    FORMAT_VERSION = 1
    # In a color list, leaves a gap, and can't be a palette name.
    NO_COLOR = "none"

    COLOR_VALUE = /\A#[0-9a-fA-F]{6}\z/
    SERIES_VALUE = /\A[a-z0-9]+(-[a-z0-9]+)*\z/
    DATE_VALUE = /\A([0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2}))?)?\z/

    ALONG = %w[fly hoist bend bend-sinister].freeze
    FROM = %w[hoist fly top bottom].freeze
    BLEND = %w[normal multiply screen overlay darken lighten].freeze
    ANCHOR = %w[start center end scale].freeze
    CORNER = %w[upper-hoist upper-fly lower-hoist lower-fly].freeze
    RAY_FROM = %w[center hoist fly top bottom upper-hoist upper-fly lower-hoist lower-fly].freeze
    SHAPE_KINDS = %w[disc ring rect plus triangle star heart cardioid polygon crescent sun lozenge ellipse
                     path].freeze
    VIEW = %w[none rotate counter-rotate half-turn transpose anti-transpose invert mirror].freeze
    MODE = %w[extend center scale hoist-extend hoist-center hoist-scale].freeze
    # These put no conditions on a work, so a file adapting one can license its renders as it likes.
    FREE_LICENSES = %w[CC0-1.0 LicenseRef-Public-Domain].freeze
    HAS_RADIUS = %w[disc ring plus triangle star heart cardioid crescent sun].freeze
    COLOR_SYSTEMS = %w[pantone ncs ral munsell dye thread].freeze
    CHECKS_FLOW = %w[bend bend-sinister].freeze
    MEASURE = %w[angle edge].freeze
    DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].freeze

    STAGE_VERSION = 0
    STAGE_META = 1
    STAGE_PALETTE = 2
    STAGE_PROPORTION = 3
    STAGE_OUTLINE = 4
    STAGE_BORDER = 5
    STAGE_DEFINE = 6
    STAGE_LAYERS = 7
    STAGE_REVERSE = 8
    STAGE_ADAPT = 9
    STAGE_VARIANT = 10
    STAGE_FOLD = 11
    STAGES = {
      "vexyl" => STAGE_VERSION, "meta" => STAGE_META, "palette" => STAGE_PALETTE,
      "proportion" => STAGE_PROPORTION, "outline" => STAGE_OUTLINE, "border" => STAGE_BORDER,
      "define" => STAGE_DEFINE, "reverse" => STAGE_REVERSE, "adapt" => STAGE_ADAPT,
      "variant" => STAGE_VARIANT, "fold" => STAGE_FOLD
    }.freeze
    private_constant :STAGE_VERSION, :STAGE_META, :STAGE_PALETTE, :STAGE_PROPORTION, :STAGE_OUTLINE,
                     :STAGE_BORDER, :STAGE_DEFINE, :STAGE_LAYERS, :STAGE_REVERSE, :STAGE_ADAPT,
                     :STAGE_VARIANT, :STAGE_FOLD, :STAGES

    def initialize(src)
      @src = src
      @problems = []
      @defines = {}
      @palette = {}
      @gradients = {}
      # Lets a gradient's colors recognize other gradients, since they're read one at a time.
      @gradient_names = []
      # What the flag has painted so far, as section 15 counts it.
      @size = 0
      # The longer side of the flag's own grid, for counting shaped edges.
      @longer = 0.0
    end
    private_class_method :new

    # Reads a document, giving its flag, or raising its problems.
    def self.parse(text)
      src = normalize_newlines(text)
      begin
        nodes = Kdl.parse(src)
      rescue Kdl::SyntaxError => e
        line, column = place(src, e.offset)
        raise ProblemsError.new([Problem.new(line, column, nil, e.message)])
      end
      p = new(src)
      flag = p.read(nodes)
      flag.id_prefix = "vx-#{hex(Digest::SHA256.digest(src), 8)}-"
      raise ProblemsError.new(p.problems) unless p.problems.empty?
      flag
    end

    attr_reader :problems

    # Reads the document's nodes, collecting its problems.
    def read(nodes)
      prepare(nodes)
      document(nodes)
    end

    # Makes CRLF and a lone CR into LF, as section 4 of the format and XML both do.
    def self.normalize_newlines(s)
      return s unless s.include?("\r")
      s.gsub("\r\n", "\n").tr("\r", "\n")
    end

    # The first count bytes, in lowercase hex. bytes is a binary String or an Array of Integers.
    def self.hex(bytes, count)
      bytes = bytes.bytes if bytes.is_a?(String)
      bytes[0, count].map { |b| format("%02x", b & 0xff) }.join
    end

    # Finds where a character is: lines end at LF, and a column counts code points. The offset
    # counts code points too. Gives [line, column].
    def self.place(src, offset)
      offset = [offset, src.length].min
      prefix = src[0, offset]
      line = 1 + prefix.count("\n")
      last = prefix.rindex("\n")
      [line, last ? offset - last : offset + 1]
    end

    def self.quote(s)
      b = +"\""
      s.each_char do |c|
        b << "\\" if c == "\"" || c == "\\"
        if c.ord < 0x20
          b << format("\\x%02x", c.ord)
        else
          b << c
        end
      end
      b << "\""
    end

    # Accepts a year, a month or a day, which is as much as many flags' origins are known to.
    def self.valid_date(text)
      m = DATE_VALUE.match(text)
      return false unless m
      year = m[1].to_i
      return true if m[2].nil?
      month = m[2].to_i
      return false if month < 1 || month > 12
      return true if m[3].nil?
      day = m[3].to_i
      leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
      days = month == 2 && leap ? 29 : DAYS_IN_MONTH[month]
      day >= 1 && day <= days
    end

    # A list as messages write it.
    def self.list_text(list)
      "[#{list.join(", ")}]"
    end

    private

    def quote(s)
      Parser.quote(s)
    end

    def list_text(list)
      Parser.list_text(list)
    end

    def errf(n, message)
      line, column = Parser.place(@src, n.start)
      @problems << Problem.new(line, column, n.name, message)
    end

    def problem(message)
      @problems << Problem.new(0, 0, nil, message)
    end

    # Checks what's the same wherever it is in a document.
    def prepare(nodes)
      nodes.each do |n|
        errf(n, "type annotations aren't used by this format") if n.annotated
        n.args.each { |v| errf(n, "type annotations aren't used by this format") if v.annotated }
        n.props.each_value { |v| errf(n, "type annotations aren't used by this format") if v.annotated }
        n.repeated_props.each { |key| errf(n, "property #{quote(key)} given more than once") }
        prepare(n.children)
      end
    end

    # Walks the top level, whose nodes have a fixed order.
    def document(nodes)
      flag = Model::Doc.new
      @defines = flag.defines
      stage = -1
      seen = {}
      nodes.each do |n|
        s = STAGES.fetch(n.name, STAGE_LAYERS)
        if s < stage || (s == stage && s != STAGE_LAYERS && s != STAGE_DEFINE && s != STAGE_VARIANT &&
                         s != STAGE_FOLD)
          errf(n, "out of order or repeated")
          next
        end
        if s > STAGE_VERSION && stage < STAGE_VERSION
          line, column = Parser.place(@src, n.start)
          @problems << Problem.new(line, column, nil, "document must start with `vexyl #{FORMAT_VERSION}`")
          return flag
        end
        stage = s
        seen[s] = true
        case n.name
        when "vexyl"
          if number(n) != FORMAT_VERSION
            errf(n, "unsupported format version; this renderer reads #{FORMAT_VERSION}")
            return flag
          end
          flag.version = FORMAT_VERSION
        when "meta"
          meta(n, flag.meta)
        when "palette"
          palette_node(n, flag)
        when "proportion"
          only_args(n, 0, "hoist", "fly")
          flag.hoist = positive(n, prop(n, "hoist"))
          flag.fly = positive(n, prop(n, "fly"))
          @longer = [flag.hoist, flag.fly].max
          no_children(n)
        when "outline"
          flag.outline = outline(n)
        when "border"
          flag.border, flag.border_outside = border(n)
          check_outside(n, flag.outline, flag.fly, flag.hoist, flag.border, flag.border_outside)
        when "define"
          define(n)
        when "reverse"
          reverse(n, flag)
        when "adapt"
          adapt(n, flag)
        when "variant"
          variant(n, flag)
        when "fold"
          fold(n, flag)
        else
          if flag.fly == 0 && flag.hoist == 0
            errf(n, "layers must follow `proportion`")
            return flag
          end
          l = layer(n, 1)
          if l
            flag.layers << l
            count(n, [l])
          end
        end
      end
      problem("document must start with `vexyl #{FORMAT_VERSION}`") unless seen[STAGE_VERSION]
      problem("document needs `meta`") unless seen[STAGE_META]
      problem("document needs `palette`") unless seen[STAGE_PALETTE]
      problem("document needs `proportion`") unless seen[STAGE_PROPORTION]
      flag.variants.each do |name, v|
        if v.ratio != 0 && flag.adapt.nil?
          problem("variant #{quote(name)} has a `ratio`, but the flag has no `adapt` rules")
        end
      end
      if flag.fly > 0 && flag.hoist > 0 && @problems.empty?
        flag.folds.each do |name, f|
          Geometry.fold_facets(Geometry.fold_shape(flag), f, 0)
        rescue Vexyl::Error => e
          problem("fold #{quote(name)}: #{e.message}")
        end
      end
      flag
    end

    # Adds what a top-level node paints to the flag's size, refusing the node that takes it past the limit.
    def count(n, layers)
      was = @size
      @size = Limits.add(@size, Limits.layers_size(layers, @longer))
      if was <= Limits::MAX_SIZE && @size > Limits::MAX_SIZE
        errf(n, "paints too much: a flag can only come to #{Limits::MAX_SIZE} parts")
      end
    end

    # A handler that reads a child's one string and gives it to the block.
    def str_h(&set)
      ->(c) { set.call(str(c)) }
    end

    def meta(n, m)
      no_values(n)
      h = {
        "name" => str_h { |v| m.name = v },
        "description" => str_h { |v| m.description = v },
        "version" => str_h { |v| m.version = v },
        "date" => lambda do |c|
          m.date = str(c)
          if !m.date.empty? && !Parser.valid_date(m.date)
            errf(c, "must be YYYY, YYYY-MM or YYYY-MM-DD, got #{quote(m.date)}")
          end
        end,
        "until" => lambda do |c|
          m.until = str(c)
          if !m.until.empty? && !Parser.valid_date(m.until)
            errf(c, "must be YYYY, YYYY-MM or YYYY-MM-DD, got #{quote(m.until)}")
          end
        end,
        "series" => lambda do |c|
          m.series = str(c)
          if !m.series.empty? && !SERIES_VALUE.match?(m.series)
            errf(c, "must be lowercase words joined by hyphens, got #{quote(m.series)}")
          end
        end,
        "note" => str_h { |v| m.notes << v },
        "law" => lambda do |c|
          r = reference(c)
          m.laws << r if r
        end,
        "restriction" => lambda do |c|
          r = reference(c)
          if r
            errf(c, "needs a `source`, since an unsourced legal claim can mislead") if r.sources.empty?
            m.restrictions << r
          end
        end,
        "designer" => str_h { |v| m.designers << v },
        "design-rights" => str_h { |v| m.design_rights = v },
        "encoder" => str_h { |v| m.encoders << v },
        "license" => str_h { |v| m.license = v },
        "render-license" => str_h { |v| m.render_license = v },
        "adapted-from" => lambda do |c|
          a = adaptation(c)
          m.adapted_from << a if a
        end,
        "source" => str_h { |v| m.sources << v }
      }
      children(n, %w[designer encoder source note law restriction adapted-from], h)
      unless m.render_license.empty?
        m.adapted_from.each do |a|
          if a.license != m.render_license && !FREE_LICENSES.include?(a.license)
            errf(n, "`render-license` #{quote(m.render_license)} can't cover work adapted from #{a.url} " \
                    "under #{quote(a.license)}")
          end
        end
      end
      errf(n, "needs a `name`") if m.name.empty?
      if !m.date.empty? && !m.until.empty?
        # Each is only known to its own precision, so they compare only as far as both go.
        shared = [m.date.length, m.until.length].min
        errf(n, "`until` comes before `date`") if m.until[0, shared] < m.date[0, shared]
      end
    end

    def adaptation(n)
      no_props(n)
      if n.args.size != 1 || !n.args[0].string?
        errf(n, "needs the URL of the original work")
        return nil
      end
      a = Model::Adaptation.new
      a.url = n.args[0].string
      h = {
        "author" => str_h { |v| a.authors << v },
        "license" => str_h { |v| a.license = v },
        "part" => str_h { |v| a.part = v }
      }
      children(n, ["author"], h)
      a
    end

    def palette_node(n, flag)
      no_values(n)
      @palette = flag.palette
      @gradients = flag.gradients
      # Gradients can name colors defined after them, so they're read second.
      later = []
      seen = {}
      n.children.each do |c|
        if seen[c.name]
          errf(c, "color defined twice")
          next
        end
        if c.name == NO_COLOR
          errf(c, "#{quote(NO_COLOR)} is reserved for leaving a gap")
          next
        end
        if c.name.empty?
          errf(c, "a color's name can't be empty")
          next
        end
        seen[c.name] = true
        if !c.args.empty? && c.args[0].string? && c.args[0].string == "gradient"
          later << c
          next
        end
        value = color(c, flag)
        errf(c, "color must be #rrggbb, got #{quote(value)}") unless COLOR_VALUE.match?(value)
        # Either case means the same, so the model has only one.
        flag.palette[c.name] = value.downcase
      end
      later.each { |c| @gradient_names << c.name }
      later.each { |c| flag.gradients[c.name] = gradient(c) }
    end

    # Reads `name gradient COLOR... along=AXIS { stops N... }`.
    def gradient(n)
      g = Model::Gradient.new
      n.args[1..].each do |a|
        unless a.string?
          errf(n, "a gradient's colors must be palette names")
          next
        end
        g.colors << solid_color(n, a.string)
      end
      errf(n, "a gradient needs at least 2 colors") if g.colors.size < 2
      n.props.each_key { |key| errf(n, "unknown property #{quote(key)}") if key != "along" }
      v = n.prop("along")
      if v
        if !v.string? || !ALONG.include?(v.string)
          errf(n, "along must be one of #{list_text(ALONG)}")
        else
          g.along = v.string
        end
      end
      children(n, [], { "stops" => ->(c) { g.stops = stops(c, g.colors.size) } })
      if g.stops.nil?
        d = [g.colors.size - 1, 1].max
        g.stops = Array.new(g.colors.size) { |i| i.to_f / d }
      end
      g
    end

    def stops(n, count)
      stops = numbers(n)
      errf(n, "has #{count} colors but #{stops.size} stops") if stops.size != count
      stops.each_with_index do |s, i|
        errf(n, "stops must be between 0 and 1") if s < 0 || s > 1
        errf(n, "stops can't run backward") if i > 0 && s < stops[i - 1]
      end
      stops
    end

    # Reads a palette color, with its values in any other color systems.
    def color(n, flag)
      no_props(n)
      if n.args.size != 1 || !n.args[0].string?
        errf(n, "needs one string")
        return ""
      end
      refs = []
      named = lambda do |c|
        r = Model::ColorRef.new
        r.system = c.name
        r.value = str(c)
        refs << r
      end
      h = {}
      COLOR_SYSTEMS.each { |system| h[system] = named }
      h["cmyk"] = lambda do |c|
        v = numbers(c)
        if v.size != 4
          errf(c, "needs 4 values from 0 to 100")
          return
        end
        parts = v.map do |x|
          errf(c, "needs 4 values from 0 to 100") if x < 0 || x > 100
          Json.number(x)
        end
        r = Model::ColorRef.new
        r.system = "cmyk"
        r.value = parts.join(" ")
        r.numbers = v
        refs << r
      end
      h["reference"] = lambda do |c|
        no_props(c)
        no_children(c)
        if c.args.size != 2 || !c.args[0].string? || !c.args[1].string?
          errf(c, "needs a system's name and a value")
          return
        end
        r = Model::ColorRef.new
        r.system = c.args[0].string
        r.value = c.args[1].string
        r.other = true
        refs << r
      end
      children(n, %w[dye reference], h)
      flag.color_refs[n.name] = refs unless refs.empty?
      n.args[0].string
    end

    def layer(n, depth)
      if depth > Limits::MAX_DEPTH
        errf(n, "nested more than #{Limits::MAX_DEPTH} levels deep")
        return nil
      end
      case n.name
      when "field"
        l = Model::Field.new
        l.color = color_arg(n)
        no_props(n)
        children(n, ["cut"], with_effects(l, nil))
        l
      when "bars" then bars(n)
      when "chevrons" then chevrons(n)
      when "band" then band(n)
      when "cross" then cross(n)
      when "saltire" then saltire(n)
      when "charge" then charge(n)
      when "quarters" then quarters(n)
      when "checks" then checks(n)
      when "rays" then rays(n)
      when "pile", "pall" then ordinary_shape(n)
      when "panel" then panel(n, depth)
      when "use" then use(n, depth)
      when "emblem" then emblem(n)
      when "group"
        l = Model::Group.new
        no_values(n)
        container(n, depth, l, l.layers, nil)
        errf(n, "needs at least one layer") if l.layers.empty?
        l
      when "canton"
        l = Model::Panel.new
        l.corner = "upper-hoist"
        l.canton = true
        no_values(n)
        h = {
          "fly" => ->(c) { l.fly = positive(c, number(c)) },
          "hoist" => ->(c) { l.hoist = positive(c, number(c)) }
        }
        container(n, depth, l, l.layers, h)
        errf(n, "needs `fly` and `hoist`") if l.fly == 0 || l.hoist == 0
        errf(n, "needs at least one layer") if l.layers.empty?
        l
      else
        errf(n, "unknown layer")
        nil
      end
    end

    # Reads a group, panel or canton, whose children mix settings and layers.
    def container(n, depth, e, layers, settings)
      handlers = with_effects(e, settings)
      seen = {}
      n.children.each do |c|
        handler = handlers[c.name]
        if handler.nil?
          l = layer(c, depth + 1)
          layers << l if l
          next
        end
        errf(c, "given more than once") if seen[c.name] && c.name != "cut"
        seen[c.name] = true
        handler.call(c)
      end
    end

    def with_effects(e, handlers)
      merged = {
        "opacity" => lambda do |c|
          e.opacity = number(c)
          errf(c, "must be between 0 and 1") if e.opacity < 0 || e.opacity > 1
        end,
        "blend" => ->(c) { e.blend = one_of(c, BLEND) },
        "anchor" => ->(c) { e.anchor = one_of(c, ANCHOR) },
        "clip" => lambda do |c|
          s = mask_shape(c)
          e.clip = s if s
        end,
        "cut" => lambda do |c|
          s = mask_shape(c)
          e.cuts << s if s
        end
      }
      merged.merge!(handlers) if handlers
      merged
    end

    # Reads the single shape inside a clip or cut.
    def mask_shape(n)
      no_values(n)
      if n.children.size != 1
        errf(n, "needs exactly one shape")
        return nil
      end
      c = n.children[0]
      no_values(c)
      if c.name == "svg"
        errf(c, "inline SVG can't be used as a clip or cut")
        return nil
      end
      s = named_shape(c.name)
      shape_body(c, s, nil)
      if s.hollow > 0 || s.lines > 0
        errf(c, "a clip or cut uses a shape's whole area, so it can't be `hollow` or `lines`")
      end
      s
    end

    # Starts a shape of a kind, or from a definition of that name.
    def named_shape(name)
      d = @defines[name]
      if d && d.shape
        s = d.shape.copy
        s.vertices = s.vertices.dup
        return s
      end
      s = Model::Shape.new
      s.kind = name
      s
    end

    def bars(n)
      l = Model::Bars.new
      l.colors = gap_color_args(n)
      no_props(n)
      count = 0
      h = {
        "along" => ->(c) { l.along = one_of(c, ALONG) },
        "ratio" => ->(c) { l.ratio = positives(c) },
        "rotate" => ->(c) { l.rotate = number(c) },
        "count" => ->(c) { count = integer(c, number(c), Limits::MAX_COPIES) },
        "grow" => ->(c) { l.grow = numbers(c) },
        "edge" => ->(c) { l.line = line(c) }
      }
      children(n, ["cut"], with_effects(l, h))
      return l if l.colors.empty?
      l.colors = cycle(n, l.colors, count)
      check_waves(n, l.line)
      l.ratio = ratio(n, l.ratio, l.colors.size)
      if l.grow && l.grow.size != l.colors.size
        errf(n, "has #{l.colors.size} colors but #{l.grow.size} `grow` values")
      end
      l.grow&.each { |g| errf(n, "`grow` can't be negative") if g < 0 }
      if l.grow && l.rotate != 0
        errf(n, "a rotated bars keeps its widths at other proportions, so it takes no `grow`")
      end
      l
    end

    def chevrons(n)
      l = Model::Chevrons.new
      l.colors = gap_color_args(n)
      no_props(n)
      h = {
        "from" => ->(c) { l.from = one_of(c, FROM) },
        "depth" => ->(c) { l.depth = positive(c, number(c)) },
        "angle" => lambda do |c|
          l.angle = number(c)
          errf(c, "must be between 0 and 90 degrees, exclusive") if l.angle <= 0 || l.angle >= 90
        end,
        "apex" => lambda do |c|
          apex = number(c)
          errf(c, "can't be negative") if apex < 0
          l.apex = apex
        end,
        "ratio" => ->(c) { l.ratio = positives(c) },
        "rotate" => ->(c) { l.rotate = number(c) },
        "fimbriate" => ->(c) { l.fimbriate = edge(c) }
      }
      children(n, ["cut"], with_effects(l, h))
      errf(n, "needs a `depth`") if l.depth == 0
      if !l.apex.nil? && l.angle == 0
        errf(n, "an off-center `apex` needs an `angle`, since its arms can't meet both corners at one slope")
      end
      l.ratio = ratio(n, l.ratio, l.colors.size)
      l
    end

    # Repeats colors until there are count of them, if count is given. Fewer would drop some silently.
    def cycle(n, colors, count)
      return colors if count == 0
      if count < colors.size
        errf(n, "has #{colors.size} colors but a `count` of #{count}, which would leave some out")
        return colors
      end
      Array.new(count) { |i| colors[i % colors.size] }
    end

    def check_waves(n, l)
      if l && l.waves(@longer) > Limits::MAX_COPIES
        errf(n, "a shaped edge can't have more than #{Limits::MAX_COPIES} waves")
      end
    end

    def ratio(n, ratio, count)
      ratio = Array.new(count, 1.0) if ratio.nil?
      errf(n, "has #{count} colors but a ratio of #{ratio.size} values") if ratio.size != count
      ratio
    end

    def band(n)
      l = Model::Band.new
      l.color = color_arg(n)
      no_props(n)
      h = {
        "along" => ->(c) { l.along = one_of(c, ALONG) },
        "width" => ->(c) { l.width = positive(c, number(c)) },
        "offset" => ->(c) { l.offset = number(c) },
        "rotate" => ->(c) { l.rotate = number(c) },
        "fimbriate" => ->(c) { l.fimbriate = edge(c) }
      }
      children(n, ["cut"], with_effects(l, h))
      errf(n, "needs a `width`") if l.width == 0
      l
    end

    def cross(n)
      l = Model::Cross.new
      l.color = color_arg(n)
      no_props(n)
      seen_fly = false
      seen_hoist = false
      h = {
        "fly" => lambda do |c|
          l.fly_parts = triple(c)
          seen_fly = true
        end,
        "hoist" => lambda do |c|
          l.hoist_parts = triple(c)
          seen_hoist = true
        end,
        "fimbriate" => ->(c) { l.fimbriate = edge(c) }
      }
      children(n, ["cut"], with_effects(l, h))
      errf(n, "needs `fly` and `hoist`") if !seen_fly || !seen_hoist
      l
    end

    # Reads the distance before an arm, its width and the distance after.
    def triple(n)
      v = numbers(n)
      if v.size != 3
        errf(n, "needs 3 values: before the arm, its width, and after it")
        return [0.0, 1.0, 0.0]
      end
      if v[0] < 0 || v[1] <= 0 || v[2] < 0
        errf(n, "the arm's width must be positive and its distances not negative")
        return [0.0, 1.0, 0.0]
      end
      v
    end

    def saltire(n)
      l = Model::Saltire.new
      l.color = color_arg(n)
      no_props(n)
      h = {
        "width" => ->(c) { l.width = positive(c, number(c)) },
        "fimbriate" => ->(c) { l.fimbriate = edge(c) },
        "counterchange" => ->(c) { l.counterchange = flag_value(c) }
      }
      children(n, ["cut"], with_effects(l, h))
      errf(n, "needs a `width`") if l.width == 0
      errf(n, "a counterchanged saltire can't be fimbriated") if l.counterchange && l.fimbriate
      l
    end

    def charge(n)
      args = n.args
      no_props(n)
      if args.empty? || !args[0].string?
        errf(n, "needs a shape")
        return nil
      end
      name = args[0].string
      if name == "pile" || name == "pall"
        errf(n, "a #{name} is a layer of its own, not a charge's shape")
        return nil
      end
      l = Model::Charge.new
      l.shape = named_shape(name)
      if l.shape.kind == "svg" && args.size == 1
        # Inline SVG can bring its own colors.
      elsif args.size != 2
        errf(n, "needs a shape and a color")
        return nil
      elsif !args[1].string?
        errf(n, "color must be a palette name")
        return nil
      elsif l.shape.kind == "svg"
        l.color = solid_color(n, args[1].string)
      else
        l.color = palette_color(n, args[1].string)
      end
      h = {
        "fimbriate" => ->(c) { l.fimbriate = edge(c) },
        "repeat" => ->(c) { l.repeat = repeat(c) }
      }
      shape_body(n, l.shape, with_effects(l, h))
      s = l.shape
      if s.embedded && l.color.empty? && s.embedded.uses_current_color?
        errf(n, "inline SVG uses currentColor, so it needs a palette color")
      elsif s.kind == "svg" && l.fimbriate
        errf(n, "inline SVG can't be fimbriated")
      elsif l.fimbriate && (s.hollow > 0 || s.lines > 0)
        errf(n, "fimbriation edges a filled shape, so it can't go with `hollow` or `lines`")
      elsif s.kind == "svg" && l.repeat
        errf(n, "inline SVG can't be repeated")
      elsif s.kind == "polygon" && l.repeat
        errf(n, "a polygon can't be repeated")
      elsif l.repeat && s.ats.size > 1
        errf(n, "several positions and a repeat can't be combined")
      elsif s.kind == "svg" && s.ats.size > 1
        errf(n, "inline SVG can't be repeated")
      elsif l.repeat && l.repeat.kind == "grid" && s.placed
        errf(n, "a grid repeat spreads across the region, so it can't have `at`")
      end
      l
    end

    def emblem(n)
      l = Model::Emblem.new
      no_values(n)
      h = {
        "at" => ->(c) { l.at = at(c) },
        "along" => ->(c) { l.along = one_of(c, ALONG) },
        "rotate" => ->(c) { l.rotate = number(c) }
      }
      placed = with_effects(l, h)
      seen = {}
      n.children.each do |c|
        if c.name == "charge"
          got = layer(c, 1)
          if got.is_a?(Model::Charge)
            if got.repeat && got.repeat.kind == "grid"
              errf(c, "a grid repeat needs a region, which an emblem doesn't have")
            end
            frame_shape(c, got.shape)
            frame_shape(c, got.clip) if got.clip
            got.cuts.each { |cut| frame_shape(c, cut) }
            l.charges << got
          end
          next
        end
        handler = placed[c.name]
        if handler.nil?
          errf(c, "an emblem can only hold charges")
          next
        end
        errf(c, "given more than once") if seen[c.name] && c.name != "cut"
        seen[c.name] = true
        handler.call(c)
      end
      errf(n, "needs at least one charge") if l.charges.empty?
      l
    end

    # Refuses what needs a region's size, which an emblem's frame doesn't have.
    def frame_shape(n, s)
      if s.kind == "lozenge" && (s.fly == 0 || s.hoist == 0)
        errf(n, "a lozenge in an emblem needs `fly` and `hoist`, since a frame has no size to take")
      elsif s.kind == "pile" || s.kind == "pall"
        errf(n, "a #{s.kind} needs a region's edges, which an emblem doesn't have")
      end
    end

    def repeat(n)
      no_children(n)
      if n.args.size != 1 || !n.args[0].string?
        errf(n, "needs a kind: ring or grid")
        return nil
      end
      r = Model::Repeat.new
      r.kind = n.args[0].string
      case r.kind
      when "ring"
        only_args(n, 1, "count", "radius", "turn")
        r.count = integer(n, prop(n, "count"), Limits::MAX_COPIES)
        r.radius = positive(n, prop(n, "radius"))
        r.turn = bool_prop(n, "turn")
      when "grid"
        only_args(n, 1, "rows", "columns", "stagger")
        r.rows = integer(n, prop(n, "rows"), Limits::MAX_COPIES)
        r.columns = integer(n, prop(n, "columns"), Limits::MAX_COPIES)
        r.stagger = bool_prop(n, "stagger")
        errf(n, "makes more than #{Limits::MAX_COPIES} copies") if r.rows * r.columns > Limits::MAX_COPIES
      when "line"
        only_args(n, 1, "count", "fly", "hoist")
        r.count = integer(n, prop(n, "count"), Limits::MAX_COPIES)
        v = n.prop("fly")
        r.fly = number_value(n, v) if v
        v = n.prop("hoist")
        r.hoist = number_value(n, v) if v
        errf(n, "needs a step: fly= or hoist=") if r.fly == 0 && r.hoist == 0
      when "arc"
        only_args(n, 1, "count", "radius", "turn", "from", "to")
        r.count = integer(n, prop(n, "count"), Limits::MAX_COPIES)
        r.radius = positive(n, prop(n, "radius"))
        r.turn = bool_prop(n, "turn")
        r.from = prop(n, "from")
        r.to = prop(n, "to")
        errf(n, "an arc needs at least 2 copies") if r.count < 2 && r.count != 0
        if n.prop("from") && n.prop("to") && (r.to - r.from) % 360 == 0
          errf(n, "`from` and `to` are the same place, so there's no arc to repeat along")
        end
      else
        errf(n, "unknown repeat #{quote(r.kind)}")
      end
      r
    end

    # Reads a shape's children, along with any extra handlers.
    def shape_body(n, s, extra)
      h = {
        "at" => lambda do |c|
          at = at(c)
          s.at = at unless s.placed
          s.placed = true
          s.ats << at
        end,
        "rotate" => ->(c) { s.rotate = number(c) },
        "hollow" => ->(c) { s.hollow = positive(c, number(c)) }
      }
      s.placed = false
      s.ats = []
      # What was only worked out from a definition's other values is worked out again.
      if s.auto_inner
        s.inner = 0.0
        s.auto_inner = false
      end
      if s.auto_spread
        s.spread = 0.0
        s.auto_spread = false
      end
      radius = ->(c) { s.radius = positive(c, number(c)) }
      inner = ->(c) { s.inner = positive(c, number(c)) }
      size_fly = ->(c) { s.fly = positive(c, number(c)) }
      size_hoist = ->(c) { s.hoist = positive(c, number(c)) }
      case s.kind
      when "disc", "triangle", "cardioid"
        h["radius"] = radius
      when "crescent"
        h["radius"] = radius
        h["inner"] = inner
        h["offset"] = ->(c) { s.offset = positive(c, number(c)) }
      when "sun"
        s.points = 12 if s.points == 0
        s.spread = 1.0 if s.spread == 0
        h["radius"] = radius
        h["disc"] = ->(c) { s.disc = positive(c, number(c)) }
        h["gap"] = ->(c) { s.gap = not_negative(c, number(c)) }
        h["points"] = ->(c) { s.points = integer(c, number(c), Limits::MAX_COPIES) }
        h["spread"] = ->(c) { s.spread = positive(c, number(c)) }
      when "lozenge", "ellipse", "rect"
        h["fly"] = size_fly
        h["hoist"] = size_hoist
      when "path"
        h["fly"] = size_fly
        h["hoist"] = size_hoist
        h["d"] = ->(c) { s.d = path_data(c) }
        h["box"] = ->(c) { s.box = box_value(c, str(c)) }
        h["evenodd"] = ->(c) { s.even_odd = flag_value(c) }
      when "pile"
        h.delete("at")
        h.delete("rotate")
        s.edge = "hoist" if s.edge.empty?
        h["from"] = ->(c) { s.edge = one_of(c, FROM) }
        h["base"] = lambda do |c|
          v = numbers(c)
          if v.size == 2
            s.base = v
          else
            errf(c, "needs 2 values: where it starts and ends along the edge")
          end
        end
        h["tip"] = lambda do |c|
          v = numbers(c)
          if v.size == 2
            s.tip = v
          else
            errf(c, "needs 2 values: along the edge, then in from it")
          end
        end
        h["depth"] = ->(c) { s.depth = positive(c, number(c)) }
        h["flat"] = lambda do |c|
          s.flat = not_negative(c, number(c))
          s.has_flat = true
        end
      when "pall"
        h.delete("at")
        h.delete("rotate")
        s.edge = "hoist" if s.edge.empty?
        h["from"] = ->(c) { s.edge = one_of(c, FROM) }
        h["width"] = ->(c) { s.width = positive(c, number(c)) }
        h["junction"] = ->(c) { s.junction = positive(c, number(c)) }
      when "heart"
        h["radius"] = radius
        h["spread"] = ->(c) { s.spread = positive(c, number(c)) }
      when "ring"
        h["radius"] = radius
        h["inner"] = inner
        h["from"] = lambda do |c|
          s.from = number(c)
          s.has_arc = true
        end
        h["to"] = lambda do |c|
          s.to = number(c)
          s.has_arc = true
        end
      when "plus"
        h["radius"] = radius
        h["width"] = ->(c) { s.width = positive(c, number(c)) }
      when "star"
        s.points = 5 if s.points == 0
        h["radius"] = radius
        h["inner"] = inner
        h["lines"] = ->(c) { s.lines = positive(c, number(c)) }
        h["points"] = lambda do |c|
          s.points = integer(c, number(c), Limits::MAX_COPIES)
          errf(c, "needs at least 3 points") if s.points > 0 && s.points < 3
        end
      when "polygon"
        h.delete("at")
        h.delete("rotate")
        h["point"] = lambda do |c|
          only_args(c, 0, "fly", "hoist")
          no_children(c)
          s.vertices << Model::Point.new(prop(c, "fly"), prop(c, "hoist"))
        end
      when "svg"
        h["fly"] = size_fly
        h["hoist"] = size_hoist
        h["markup"] = ->(c) { s.markup = str(c) }
      else
        errf(n, "unknown shape #{quote(s.kind)}")
        return
      end
      h.merge!(extra) if extra
      repeatable = %w[cut point]
      repeatable << "at" if extra
      h.delete("hollow") if s.kind == "svg"
      children(n, repeatable, h)
      check_shape(n, s)
    end

    def check_shape(n, s)
      errf(n, "needs a `radius`") if HAS_RADIUS.include?(s.kind) && s.radius == 0
      case s.kind
      when "ring"
        errf(n, "needs an `inner` smaller than its `radius`") if s.inner == 0 || s.inner >= s.radius
        if s.has_arc && (s.to - s.from) % 360 == 0
          errf(n, "`from` and `to` are the same place, so there's no arc to draw")
        end
      when "star"
        errf(n, "`lines` and `hollow` can't be combined") if s.lines > 0 && s.hollow > 0
        errf(n, "`lines` needs at least 5 points") if s.lines > 0 && s.points < 5
        errf(n, "`inner` must be smaller than `radius`") if s.inner >= s.radius && s.radius > 0
        errf(n, "needs an `inner` with fewer than 5 points") if s.inner == 0 && s.points < 5
        if s.inner == 0
          k = s.points.to_f
          s.inner = s.radius * Math.cos(2 * Math::PI / k) / Math.cos(Math::PI / k)
          s.auto_inner = true
        end
      when "rect", "ellipse"
        errf(n, "needs `fly` and `hoist`") if s.fly == 0 || s.hoist == 0
      when "crescent"
        if s.inner == 0 || s.offset == 0
          errf(n, "needs `inner` and `offset`")
        elsif s.radius > 0 && (s.offset >= s.radius + s.inner || s.offset <= (s.radius - s.inner).abs)
          errf(n, "`offset` has to make its two circles cross")
        end
      when "sun"
        errf(n, "needs a `disc`") if s.disc == 0
        errf(n, "`disc` and `gap` must be smaller than `radius`") if s.radius > 0 && s.disc + s.gap >= s.radius
        errf(n, "needs at least 3 points") if s.points < 3 && s.points != 0
        errf(n, "`spread` can't be more than 1") if s.spread > 1
      when "path"
        errf(n, "needs `d`") if s.d.empty?
        errf(n, "needs a `box` with an area") if s.box[2] <= 0 || s.box[3] <= 0
        errf(n, "needs `fly` or `hoist`") if s.fly == 0 && s.hoist == 0
      when "pile"
        if s.tip.nil? && s.depth == 0
          errf(n, "needs a `depth` or a `tip`")
        elsif s.tip && s.depth != 0
          errf(n, "takes a `depth` or a `tip`, not both")
        elsif s.tip && s.has_flat
          errf(n, "a `flat` goes with a `depth`, not a `tip`")
        end
      when "pall"
        errf(n, "needs a `width`") if s.width == 0
      when "heart"
        if s.spread == 0
          s.spread = s.radius * Math.sqrt(2)
          s.auto_spread = true
        end
        if s.spread >= 2 * s.radius && s.radius > 0
          errf(n, "`spread` must be less than twice `radius`, so that the lobes meet")
        end
      when "plus"
        errf(n, "needs a `width` less than twice its `radius`") if s.width == 0 || s.width >= 2 * s.radius
      when "polygon"
        errf(n, "needs at least 3 `point`s") if s.vertices.size < 3
      when "svg"
        errf(n, "needs `fly` and `hoist`") if s.fly == 0 || s.hoist == 0
        if s.markup.empty?
          errf(n, "needs `markup`")
          return
        end
        begin
          s.embedded = Sanitizer.sanitize(s.markup)
        rescue Vexyl::Error => e
          errf(n, e.message)
          return
        end
        # Only what passed is kept, so that nothing can read what the sanitizer removed.
        s.markup = s.embedded.canonical
      end
    end

    def at(n)
      no_children(n)
      unless n.args.empty?
        if n.args.size != 1 || !n.args[0].string? || n.args[0].string != "center" || !n.props.empty?
          errf(n, "must be `center` or `fly=A hoist=B`")
        end
        return nil
      end
      only_args(n, 0, "fly", "hoist")
      Model::Point.new(prop(n, "fly"), prop(n, "hoist"))
    end

    # Reads `border COLOR W`, with an optional side of inside or outside. Gives [edge, outside].
    def border(n)
      args = n.args
      outside = false
      if args.size == 3
        side = args[2]
        if !side.string? || (side.string != "inside" && side.string != "outside")
          errf(n, "side must be inside or outside")
          return [nil, false]
        end
        outside = side.string == "outside"
        args = args[0, 2]
      end
      [edge_args(n, args), outside]
    end

    # Refuses an outside border that can't go around the shape it's given.
    def check_outside(n, o, fly, hoist, border, outside)
      return if border.nil? || !outside || border.width <= 0 || fly <= 0 || hoist <= 0
      shape = o.nil? ? Geometry.rect_poly(0.0, 0.0, fly, hoist) : Geometry.outline_points(o, fly, hoist)
      if shape.nil?
        errf(n, "an outside border can't go around a `path` outline")
        return
      end
      begin
        Geometry.offset_polygon(shape, border.width)
      rescue Vexyl::Error => e
        errf(n, e.message)
      end
    end

    def edge(n)
      edge_args(n, n.args)
    end

    def edge_args(n, args)
      no_props(n)
      no_children(n)
      if args.size != 2 || !args[0].string?
        errf(n, "needs a color and a width")
        return nil
      end
      color = palette_color(n, args[0].string)
      Model::Edge.new(color, positive(n, number_value(n, args[1])))
    end

    # Dispatches n's children to handlers, refusing unknown nodes and repeats of anything not repeatable.
    def children(n, repeatable, handlers)
      seen = {}
      n.children.each do |c|
        handler = handlers[c.name]
        if handler.nil?
          errf(c, "unknown here")
          next
        end
        errf(c, "given more than once") if seen[c.name] && !repeatable.include?(c.name)
        seen[c.name] = true
        handler.call(c)
      end
    end

    def no_values(n)
      errf(n, "takes no arguments") unless n.args.empty?
      no_props(n)
    end

    def no_props(n)
      errf(n, "takes no properties") unless n.props.empty?
    end

    def no_children(n)
      errf(n, "takes no children") unless n.children.empty?
    end

    # Checks n's argument count and refuses any property not listed.
    def only_args(n, args, *props)
      errf(n, "takes #{args} arguments, got #{n.args.size}") if n.args.size != args
      n.props.each_key { |key| errf(n, "unknown property #{quote(key)}") unless props.include?(key) }
    end

    def str(n)
      no_props(n)
      no_children(n)
      if n.args.size != 1 || !n.args[0].string?
        errf(n, "needs one string")
        return ""
      end
      n.args[0].string
    end

    def one_of(n, allowed)
      value = str(n)
      if !value.empty? && !allowed.include?(value)
        errf(n, "must be one of #{list_text(allowed)}, got #{quote(value)}")
      end
      value
    end

    # Reads a child that's either bare or holds #true or #false.
    def flag_value(n)
      no_props(n)
      no_children(n)
      return true if n.args.empty?
      if n.args.size != 1 || n.args[0].kind != :bool
        errf(n, "must be #true or #false")
        return false
      end
      n.args[0].bool
    end

    def color_arg(n)
      if n.args.size != 1 || !n.args[0].string?
        errf(n, "needs one color")
        return ""
      end
      palette_color(n, n.args[0].string)
    end

    # Reads a color list that can leave gaps with `none`.
    def gap_color_args(n)
      errf(n, "needs at least one color") if n.args.empty?
      colors = []
      n.args.each do |a|
        if !a.string?
          errf(n, "colors must be palette names")
        elsif a.string == NO_COLOR
          colors << NO_COLOR
        else
          colors << palette_color(n, a.string)
        end
      end
      colors
    end

    def palette_color(n, name)
      return name if @gradients.key?(name)
      solid_color(n, name)
    end

    # For the places a gradient has no meaning.
    def solid_color(n, name)
      return name if @palette.key?(name)
      if @gradients.key?(name) || @gradient_names.include?(name)
        errf(n, "#{quote(name)} is a gradient, and a solid color is needed here")
        return name
      end
      errf(n, "color #{quote(name)} isn't in the palette")
      name
    end

    def number_value(n, v)
      if v.kind != :number
        errf(n, "needs a number")
        return 0.0
      end
      unless Limits.in_limits(v.number)
        errf(n, "needs a finite number of a reasonable size")
        return 0.0
      end
      v.number.to_f
    end

    def number(n)
      no_props(n)
      no_children(n)
      if n.args.size != 1
        errf(n, "needs one number")
        return 0.0
      end
      number_value(n, n.args[0])
    end

    def numbers(n)
      no_props(n)
      no_children(n)
      n.args.map { |v| number_value(n, v) }
    end

    def positives(n)
      values = numbers(n)
      values.each { |v| positive(n, v) }
      values
    end

    def positive(n, v)
      errf(n, "needs a positive number") if v <= 0
      v
    end

    # Reads a size that defaults to 0, which can also be written as 0.
    def not_negative(n, v)
      errf(n, "can't be negative") if v < 0
      v
    end

    def integer(n, v, limit)
      if v != v.round(half: :even) || v < 1
        errf(n, "needs a positive whole number")
        return 0
      end
      if v > limit
        errf(n, "can't be more than #{limit}")
        return 0
      end
      v.to_i
    end

    def prop(n, key)
      v = n.prop(key)
      if v.nil?
        errf(n, "needs #{key}=")
        return 0.0
      end
      number_value(n, v)
    end

    def bool_prop(n, key)
      v = n.prop(key)
      return false if v.nil?
      if v.kind != :bool
        errf(n, "#{key} must be #true or #false")
        return false
      end
      v.bool
    end

    def path_data(n)
      d = str(n)
      unless Numbers.valid_path(d)
        errf(n, "isn't SVG path data")
        return ""
      end
      d
    end

    def box_value(n, text)
      values = Numbers.list(text)
      if values.nil? || values.size != 4
        errf(n, "box must be \"x y width height\", with each a finite decimal number of a reasonable size")
        return [0.0, 0.0, 0.0, 0.0]
      end
      values
    end

    # Reads `edge wavy depth=N period=N` or `edge zigzag depth=N count=N`.
    def line(n)
      no_children(n)
      if n.args.size != 1 || !n.args[0].string? || (n.args[0].string != "wavy" && n.args[0].string != "zigzag")
        errf(n, "needs a kind: wavy or zigzag")
        return nil
      end
      only_args(n, 1, "depth", "period", "count")
      l = Model::Line.new
      l.kind = n.args[0].string
      l.depth = positive(n, prop(n, "depth"))
      v = n.prop("period")
      l.period = positive(n, number_value(n, v)) if v
      v = n.prop("count")
      l.count = integer(n, number_value(n, v), Limits::MAX_COPIES) if v
      if l.period == 0 && l.count == 0
        errf(n, "needs `period` or `count`")
        return nil
      end
      errf(n, "needs `period` or `count`, not both") if l.period != 0 && l.count != 0
      l
    end

    def quarters(n)
      l = Model::Quarters.new
      colors = gap_color_args(n)
      no_props(n)
      if colors.size != 4
        errf(n, "needs 4 colors")
      else
        l.colors = colors
      end
      h = {
        "diagonal" => ->(c) { l.diagonal = flag_value(c) },
        "split" => ->(c) { l.split = at(c) }
      }
      children(n, ["cut"], with_effects(l, h))
      errf(n, "`split` only applies to upright quarters") if l.diagonal && l.split
      l
    end

    def checks(n)
      l = Model::Checks.new
      l.colors = gap_color_args(n)
      no_props(n)
      h = {
        "rows" => ->(c) { l.rows = integer(c, number(c), Limits::MAX_COPIES) },
        "columns" => ->(c) { l.columns = integer(c, number(c), Limits::MAX_COPIES) },
        "flow" => ->(c) { l.flow = one_of(c, CHECKS_FLOW) }
      }
      children(n, ["cut"], with_effects(l, h))
      errf(n, "needs at least 2 colors") if l.colors.size < 2
      errf(n, "needs `rows` and `columns`") if l.rows == 0 || l.columns == 0
      errf(n, "makes more than #{Limits::MAX_COPIES} cells") if l.rows * l.columns > Limits::MAX_COPIES
      l
    end

    def rays(n)
      l = Model::Rays.new
      l.colors = gap_color_args(n)
      no_props(n)
      count = 0
      h = {
        "from" => lambda do |c|
          if !c.args.empty?
            l.from = one_of(c, RAY_FROM)
          else
            l.at = at(c)
          end
        end,
        "count" => ->(c) { count = integer(c, number(c), Limits::MAX_COPIES) },
        "ratio" => ->(c) { l.ratio = positives(c) },
        "rotate" => ->(c) { l.rotate = number(c) },
        "measure" => ->(c) { l.by_edge = one_of(c, MEASURE) == "edge" }
      }
      children(n, ["cut"], with_effects(l, h))
      if l.by_edge && l.rotate != 0
        errf(n, "`measure edge` follows the region's edges, so it can't also have a `rotate`")
      end
      return l if l.colors.empty?
      l.colors = cycle(n, l.colors, count)
      l.ratio = ratio(n, l.ratio, l.colors.size)
      l
    end

    # Reads a pile or pall, which are shapes tied to their region's edges.
    def ordinary_shape(n)
      l = Model::Charge.new
      l.shape = Model::Shape.new
      l.shape.kind = n.name
      l.color = color_arg(n)
      no_props(n)
      h = { "fimbriate" => ->(c) { l.fimbriate = edge(c) } }
      shape_body(n, l.shape, with_effects(l, h))
      if l.fimbriate && l.shape.hollow > 0
        errf(n, "fimbriation edges a filled shape, so it can't go with `hollow` or `lines`")
      end
      l
    end

    def panel(n, depth)
      l = Model::Panel.new
      # An `at center` gives no position, but it's still an `at`.
      placed = false
      no_values(n)
      h = {
        "side" => ->(c) { l.side = one_of(c, FROM) },
        "corner" => ->(c) { l.corner = one_of(c, CORNER) },
        "at" => lambda do |c|
          l.at = at(c)
          placed = true
        end,
        "width" => ->(c) { l.width = positive(c, number(c)) },
        "fly" => ->(c) { l.fly = positive(c, number(c)) },
        "hoist" => ->(c) { l.hoist = positive(c, number(c)) },
        "edge" => ->(c) { l.line = line(c) }
      }
      container(n, depth, l, l.layers, h)
      check_waves(n, l.line)
      if !l.side.empty? && !l.corner.empty?
        errf(n, "needs either `side` or `corner`, not both")
      elsif !l.side.empty?
        errf(n, "a side panel needs a `width`") if l.width == 0
        if l.fly != 0 || l.hoist != 0 || placed
          errf(n, "a side panel takes a `width`, and no `fly`, `hoist` or `at`")
        end
      else
        errf(n, "needs a `side` and `width`, or a `fly` and `hoist`") if l.fly == 0 || l.hoist == 0
        errf(n, "only a side panel can have an `edge`") if l.line
        errf(n, "needs either `corner` or `at`, not both") if !l.corner.empty? && placed
        errf(n, "only a side panel has a `width`") if l.width != 0
      end
      errf(n, "needs at least one layer") if l.layers.empty?
      l
    end

    def use(n, depth)
      l = Model::Use.new
      no_props(n)
      if n.args.size != 1 || !n.args[0].string?
        errf(n, "needs the name of a definition")
        return nil
      end
      l.name = n.args[0].string
      d = @defines[l.name]
      if d.nil? || d.shape
        errf(n, "#{quote(l.name)} isn't a defined design")
        return nil
      end
      if depth + d.height > Limits::MAX_DEPTH
        errf(n, "#{quote(l.name)} nests more than #{Limits::MAX_DEPTH} levels deep where it's used")
      end
      l.design = d
      children(n, ["cut"], with_effects(l, nil))
      l
    end

    # Reads a reusable shape or design: `define NAME hoist=H fly=F { ... }`.
    def define(n)
      if n.args.size != 1 || !n.args[0].string?
        errf(n, "needs a name")
        return
      end
      name = n.args[0].string
      if name.empty?
        errf(n, "needs a name")
        return
      end
      if @defines.key?(name) || SHAPE_KINDS.include?(name) || name == "svg" || name == "pile" || name == "pall"
        errf(n, "#{quote(name)} is already taken")
        return
      end
      only_args(n, 1, "hoist", "fly")
      d = Model::Define.new
      if n.prop("fly") || n.prop("hoist")
        d.fly = positive(n, prop(n, "fly"))
        d.hoist = positive(n, prop(n, "hoist"))
      end
      if n.children.empty?
        errf(n, "needs a shape or layers")
        return
      end
      nodes = n.children
      if nodes.size == 1 && SHAPE_KINDS.include?(nodes[0].name)
        c = nodes[0]
        errf(n, "only a design has its own grid, and a shape takes its size from what uses it") if d.fly != 0
        s = Model::Shape.new
        s.kind = c.name
        if s.kind == "path" && !c.args.empty?
          # The usual form, `path "M..." box="0 0 10 10"`, puts it all on one line. Its size
          # comes from each charge using it, so nothing more can be checked yet.
          s.d, s.box = line_path(c)
          d.shape = s
          @defines[name] = d
          return
        end
        no_values(c)
        shape_body(c, s, nil)
        d.shape = s
        @defines[name] = d
        return
      end
      nodes.each do |c|
        l = layer(c, 2)
        d.layers << l if l
      end
      d.size = Limits.layers_size(d.layers, @longer)
      d.height = Limits.layers_height(d.layers)
      @defines[name] = d
    end

    # Reads the one-line form of a path, `path "M..." box="x y width height"`, which takes nothing
    # else. Gives [d, box].
    def line_path(n)
      only_args(n, 1, "box")
      no_children(n)
      d = ""
      box = [0.0, 0.0, 0.0, 0.0]
      if n.args.size == 1 && n.args[0].string? && Numbers.valid_path(n.args[0].string)
        d = n.args[0].string
      else
        errf(n, "isn't SVG path data")
      end
      b = n.prop("box")
      box = box_value(n, b.string) if b&.string?
      errf(n, "needs a `box` with an area") if box[2] <= 0 || box[3] <= 0
      [d, box]
    end

    # Reads a flag's silhouette: a polygon or path inside it, or a named form.
    def outline(n)
      no_props(n)
      o = Model::Outline.new
      args = n.args
      if args.size > 1 || (args.size == 1 && !args[0].string?)
        errf(n, "takes a named form, or a polygon or path inside it")
        return nil
      end
      if args.size == 1
        o.kind = args[0].string
        case o.kind
        when "swallowtail", "tongued", "pennant"
          nil
        else
          errf(n, "unknown form #{quote(o.kind)}")
          return nil
        end
        given = {}
        h = {
          "depth" => lambda do |c|
            o.depth = positive(c, number(c))
            given["depth"] = true
          end,
          "tip" => lambda do |c|
            o.tip = not_negative(c, number(c))
            given["tip"] = true
          end,
          "tongue" => lambda do |c|
            o.tongue = positive(c, number(c))
            given["tongue"] = true
          end,
          "taper" => lambda do |c|
            o.taper = not_negative(c, number(c))
            given["taper"] = true
          end
        }
        children(n, [], h)
        errf(n, "needs a `depth`") if o.kind != "pennant" && o.depth == 0
        errf(n, "needs a `tongue`") if o.kind == "tongued" && o.tongue == 0
        if (given["tip"] && o.kind != "pennant") || (given["tongue"] && o.kind != "tongued") ||
           (given["taper"] && o.kind != "swallowtail") || (given["depth"] && o.kind == "pennant")
          errf(n, "has a value that a #{o.kind} doesn't use")
        end
        return o
      end
      shapes = 0
      h = {
        "polygon" => lambda do |c|
          shapes += 1
          errf(c, "an outline holds one shape") if shapes > 1
          s = Model::Shape.new
          s.kind = "polygon"
          no_values(c)
          shape_body(c, s, nil)
          errf(c, "an outline is a whole shape, so it can't be `hollow`") if s.hollow > 0
          o.kind = "polygon"
          o.vertices = s.vertices
        end,
        "path" => lambda do |c|
          shapes += 1
          errf(c, "an outline holds one shape") if shapes > 1
          o.kind = "path"
          o.d, o.box = line_path(c)
        end
      }
      children(n, [], h)
      if o.kind.empty?
        errf(n, "needs a form, a `polygon` or a `path`")
        return nil
      end
      o
    end

    def reverse(n, flag)
      args = n.args
      if args.size == 1 && args[0].string? && args[0].string == "mirror"
        # The default, for saying so outright.
        no_props(n)
        no_children(n)
        return
      end
      no_values(n)
      r = Model::Reverse.new
      n.children.each do |c|
        # It holds the flag's layers for that side, so they're at the top level.
        l = layer(c, 1)
        r.layers << l if l
      end
      errf(n, "needs layers, or `mirror`") if r.layers.empty?
      count(n, r.layers)
      flag.reverse = r
    end

    def adapt(n, flag)
      no_values(n)
      a = Model::Adapt.new
      mode = lambda do |c|
        next "extend" if c.args.size == 1 && c.args[0].string? && c.args[0].string == "cut"
        one_of(c, MODE)
      end
      h = {
        "range" => lambda do |c|
          v = numbers(c)
          if v.size != 2 || v[0] <= 0 || v[1] < v[0]
            errf(c, "needs a lowest and highest fly-to-hoist ratio")
            return
          end
          a.min = v[0]
          a.max = v[1]
        end,
        "wider" => ->(c) { a.wider = mode.call(c) },
        "narrower" => ->(c) { a.narrower = mode.call(c) }
      }
      children(n, [], h)
      errf(n, "needs `wider`, `narrower` or both") if a.wider.empty? && a.narrower.empty?
      flag.adapt = a
    end

    def variant(n, flag)
      if n.args.size != 1 || !n.args[0].string?
        errf(n, "needs a name")
        return
      end
      no_props(n)
      name = n.args[0].string
      if name.empty?
        errf(n, "needs a name")
        return
      end
      if flag.variants.key?(name)
        errf(n, "#{quote(name)} is defined twice")
        return
      end
      v = Model::Variant.new
      settings = {
        "from" => ->(c) { v.from = one_of(c, VIEW) },
        "upright" => ->(c) { v.upright = flag_value(c) },
        "ratio" => ->(c) { v.ratio = positive(c, number(c)) },
        "proportion" => lambda do |c|
          only_args(c, 0, "hoist", "fly")
          v.hoist = positive(c, prop(c, "hoist"))
          v.fly = positive(c, prop(c, "fly"))
          no_children(c)
        end,
        "outline" => ->(c) { v.outline = outline(c) },
        "border" => ->(c) { v.border, v.border_outside = border(c) }
      }
      seen = {}
      n.children.each do |c|
        handler = settings[c.name]
        if handler.nil?
          # Its layers replace the flag's, so they're at the top level.
          l = layer(c, 1)
          v.layers << l if l
          next
        end
        errf(c, "given more than once") if seen[c.name]
        seen[c.name] = true
        handler.call(c)
      end
      if seen["proportion"]
        errf(n, "can't have both `proportion` and `ratio`") if seen["ratio"]
        errf(n, "with a `proportion` needs its own layers") if v.layers.empty?
      end
      if v.outline || v.border || v.fly > 0
        # What it draws within is its own or the flag's, as it would be when rendered.
        fly = flag.fly
        hoist = flag.hoist
        outline = flag.outline
        border = flag.border
        outside = flag.border_outside
        if v.fly > 0
          fly = v.fly
          hoist = v.hoist
          outline = nil
          border = nil
          outside = false
        end
        outline = v.outline if v.outline
        if v.border
          border = v.border
          outside = v.border_outside
        end
        check_outside(n, outline, fly, hoist, border, outside)
      end
      count(n, v.layers)
      flag.variants[name] = v
    end

    # Reads a text with any sources for it as children.
    def reference(n)
      no_props(n)
      if n.args.size != 1 || !n.args[0].string?
        errf(n, "needs one string")
        return nil
      end
      r = Model::Reference.new
      r.text = n.args[0].string
      children(n, ["source"], { "source" => str_h { |v| r.sources << v } })
      r
    end

    # Reads a named sequence of folds.
    def fold(n, flag)
      if n.args.size != 1 || !n.args[0].string?
        errf(n, "needs a name")
        return
      end
      no_props(n)
      name = n.args[0].string
      if name.empty?
        errf(n, "needs a name")
        return
      end
      if flag.folds.key?(name)
        errf(n, "#{quote(name)} is defined twice")
        return
      end
      f = Model::Fold.new
      step = lambda do |c|
        s = fold_step(c)
        f.steps << s if s
      end
      h = {
        "description" => str_h { |v| f.description = v },
        "source" => str_h { |v| f.sources << v },
        "over" => step,
        "under" => step,
        "tuck" => step
      }
      children(n, %w[source over under tuck], h)
      errf(n, "needs at least one step") if f.steps.empty?
      flag.folds[name] = f
    end

    # Reads `over along=fly at=5 move=bottom`, or for any line, `over through="a b c d" move="e f"`.
    def fold_step(n)
      no_children(n)
      only_args(n, 0, "along", "at", "move", "through")
      s = Model::FoldStep.new
      s.kind = n.name
      move_value = n.prop("move")
      if move_value.nil? || !move_value.string?
        errf(n, "needs move=, the part that moves")
        return nil
      end
      move = move_value.string
      through = n.prop("through")
      if through
        if n.prop("along") || n.prop("at")
          errf(n, "a crease is `through=` or `along=` and `at=`, not both")
          return nil
        end
        line = point_list(n, through, 4)
        point = point_list(n, move_value, 2)
        return nil if line.nil? || point.nil?
        s.a = Model::Point.new(line[0], line[1])
        s.b = Model::Point.new(line[2], line[3])
        s.moving = Model::Point.new(point[0], point[1])
        s.through = line
        s.move_to = point
        return s
      end
      along = n.prop("along")
      if along.nil? || !along.string? || n.prop("at").nil?
        errf(n, "needs along= and at=, or through=")
        return nil
      end
      at = prop(n, "at")
      s.along = along.string
      s.at = at
      s.move = move
      case along.string
      when "fly"
        s.a = Model::Point.new(0, at)
        s.b = Model::Point.new(1, at)
        if move == "top"
          s.moving = Model::Point.new(0, at - 1)
        elsif move == "bottom"
          s.moving = Model::Point.new(0, at + 1)
        else
          errf(n, "a crease along the fly moves top or bottom")
          return nil
        end
      when "hoist"
        s.a = Model::Point.new(at, 0)
        s.b = Model::Point.new(at, 1)
        if move == "hoist"
          s.moving = Model::Point.new(at - 1, 0)
        elsif move == "fly"
          s.moving = Model::Point.new(at + 1, 0)
        else
          errf(n, "a crease along the hoist moves hoist or fly")
          return nil
        end
      else
        errf(n, "along must be fly or hoist")
        return nil
      end
      s
    end

    def point_list(n, v, count)
      unless v.string?
        errf(n, "needs #{count} numbers in a string")
        return nil
      end
      values = Numbers.list(v.string)
      if values.nil? || values.size != count
        errf(n, "needs #{count} finite decimal numbers of a reasonable size in a string")
        return nil
      end
      values
    end
  end
end
