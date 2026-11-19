# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

module Vexyl
  # Moves layers along one axis as their region changes size, as section 11 of the format says.
  class Adapter
    ANCHORS = { "extend" => "start", "center" => "center", "scale" => "scale" }.freeze

    def initialize(axis, anchor, from_behind, other)
      @axis = axis
      @anchor = anchor
      # An anchor that a container passed on to its layers, if one did.
      @passed = ""
      # Says that the layers are a reverse's own, with the hoist on the right.
      @from_behind = from_behind
      # The region's size across the axis, which stays the same.
      @other = other
      @err = nil
    end

    # The flag at another proportion, as fly divided by hoist, following its adapt rules.
    def self.with_ratio(f, ratio)
      current = f.fly / f.hoist
      return f if (ratio - current).abs < 1e-9 * current
      raise Error, "#{f.meta.name} doesn't say how it adapts to other proportions" if f.adapt.nil?
      if (f.adapt.min > 0 && ratio < f.adapt.min) || (f.adapt.max > 0 && ratio > f.adapt.max)
        raise Error, "#{f.meta.name} only adapts between ratios of #{Json.number(f.adapt.min)} " \
                     "and #{Json.number(f.adapt.max)}"
      end
      mode = ratio > current ? f.adapt.wider : f.adapt.narrower
      raise Error, "#{f.meta.name} has no rule for this direction of change" if mode.empty?
      out = f.copy
      on_hoist = mode.start_with?("hoist-")
      base = on_hoist ? mode.delete_prefix("hoist-") : mode
      anchor = ANCHORS[base]
      if on_hoist
        a = new("hoist", anchor, f.seen_from_behind, f.fly)
        out.hoist = f.fly / ratio
        out.layers = a.adapt_layers(f.layers, f.hoist, out.hoist)
      else
        a = new("fly", anchor, f.seen_from_behind, f.hoist)
        out.fly = f.hoist * ratio
        out.layers = a.adapt_layers(f.layers, f.fly, out.fly)
      end
      if f.outline && f.outline.kind == "polygon"
        # A silhouette has no sensible anchor, so a drawn one stretches with the flag.
        o = f.outline.copy
        o.vertices = f.outline.vertices.map do |p|
          Model::Point.new(p.fly * out.fly / f.fly, p.hoist * out.hoist / f.hoist)
        end
        out.outline = o
      end
      raise Error, a.err if a.err
      out
    end

    # The proportion closest to a target that the flag's rules allow.
    def self.nearest_ratio(f, target)
      current = f.fly / f.hoist
      return current if f.adapt.nil?
      if (target > current && f.adapt.wider.empty?) || (target < current && f.adapt.narrower.empty?)
        return current
      end
      target = [target, f.adapt.min].max if f.adapt.min > 0
      target = [target, f.adapt.max].min if f.adapt.max > 0
      target
    end

    # Maps a position along the axis, by a layer's anchor.
    def self.move(x, old, now, anchor)
      case anchor
      when "center" then x + (now - old) / 2
      when "end" then x + now - old
      when "scale" then x * now / old
      else x
      end
    end

    # How far a region reaches either side of a point, along a normal.
    def self.spread(r, c, normal)
      lo = Float::INFINITY
      hi = -Float::INFINITY
      r.corners.each do |corner|
        offset = corner.sub(c).dot(normal)
        lo = [lo, offset].min
        hi = [hi, offset].max
      end
      [lo, hi]
    end

    # The first refusal found while adapting, if there was one.
    attr_reader :err

    # Adapts the flag's own layers.
    def adapt_layers(list, old, now)
      layers(list, old, now)
    end

    private

    # A layer's anchor: its own, or one passed on to it, or the rule's, and whether it was given one.
    def anchor_of(e)
      anchor = e.anchor
      anchor = @passed if anchor.empty?
      anchor = @anchor if anchor.empty?
      if @from_behind && @axis == "fly"
        # Seen from behind, the hoist is on the right, and start is still the hoist.
        if anchor == "start"
          anchor = "end"
        elsif anchor == "end"
          anchor = "start"
        end
      end
      anchor
    end

    def given(e)
      !e.anchor.empty? || !@passed.empty?
    end

    # Adapts a container's layers with its anchor, if it gives one.
    def pass_on(e)
      was = @passed
      @passed = e.anchor unless e.anchor.empty?
      yield
    ensure
      @passed = was
    end

    # The region's center, for pinning what's there to an anchor.
    def center(old)
      return Model::Point.new(@other / 2, old / 2) if @axis == "hoist"
      Model::Point.new(old / 2, @other / 2)
    end

    def fail_with(message)
      @err = message if @err.nil?
    end

    def layers(list, old, now)
      list.map { |l| layer(l, old, now) }
    end

    def move(x, old, now, anchor)
      Adapter.move(x, old, now, anchor)
    end

    def point(p, old, now, anchor)
      return nil if p.nil?
      return Model::Point.new(move(p.fly, old, now, anchor), p.hoist) if @axis == "fly"
      Model::Point.new(p.fly, move(p.hoist, old, now, anchor))
    end

    # Moves a shape, which keeps its own form unless it's drawn from points. The center stays the
    # center, so a charge there follows it unless anchored otherwise.
    def shape(input, old, now, anchor, explicit)
      s = input.copy
      k = now / old
      s.at = center(old) if s.at.nil? && explicit && anchor != "scale" && s.kind != "polygon"
      s.at = point(s.at, old, now, anchor)
      s.ats = input.ats.map { |p| point(p, old, now, anchor) }
      s.vertices = input.vertices.map { |p| point(p, old, now, anchor) }
      if anchor == "scale"
        case s.kind
        when "rect", "lozenge", "ellipse"
          if @axis == "fly"
            s.fly *= k
          else
            s.hoist *= k
          end
        end
      end
      # Piles and palls are set from their edge, so depths only change when scaling, and
      # positions along the edge move like any other.
      if s.kind == "pile" || s.kind == "pall"
        runs_along_axis = (s.edge == "hoist" || s.edge == "fly") == (@axis == "fly")
        if runs_along_axis
          if anchor == "scale"
            s.depth *= k
            s.junction *= k
            s.tip = [s.tip[0], s.tip[1] * k] if s.tip
          end
        else
          s.base = [move(s.base[0], old, now, anchor), move(s.base[1], old, now, anchor)] if s.base
          s.tip = [move(s.tip[0], old, now, anchor), s.tip[1]] if s.tip
        end
      end
      s
    end

    # Copies a layer with its clip and cuts moved, and gives its anchor.
    def effects(c, e, old, now)
      anchor = anchor_of(e)
      c.clip = shape(e.clip, old, now, anchor, false) if e.clip
      c.cuts = e.cuts.map { |s| shape(s, old, now, anchor, false) }
      anchor
    end

    # Shares a change in size across parts along the axis, by a layer's anchor.
    def parts(what, parts, old, now, anchor)
      total = 0.0
      parts.each { |p| total += p }
      out = parts.map { |p| p * old / total }
      d = now - old
      last = out.size - 1
      case anchor
      when "start"
        out[last] += d
        changed = [last]
      when "end"
        out[0] += d
        changed = [0]
      when "center"
        out[0] += d / 2
        out[last] += d / 2
        changed = [0, last]
      else
        return parts
      end
      changed.each { |i| keep(what, out[i], old) }
      out
    end

    # Refuses a part that a change of size has brought to nothing, allowing for rounding.
    def keep(what, part, old)
      fail_with("#{what} can't be cut to this proportion") if part <= 1e-9 * old
    end

    def layer(l, old, now)
      k = now / old
      case l
      when Model::Bars
        c = l.copy
        anchor = effects(c, l, old, now)
        return rotated_bars(c, old, now, anchor) if l.rotate != 0
        if (@axis == "fly") != (l.along == "hoist") || l.along == "bend" || l.along == "bend-sinister"
          return c
        end
        if l.grow
          total = 0.0
          weights = 0.0
          l.ratio.each_index do |i|
            total += l.ratio[i]
            weights += l.grow[i]
          end
          if weights > 0
            c.ratio = Array.new(l.ratio.size) do |i|
              v = l.ratio[i] * old / total + (now - old) * l.grow[i] / weights
              keep("bars", v, old) if l.grow[i] > 0
              v
            end
            return c
          end
        end
        c.ratio = parts("bars", l.ratio, old, now, anchor)
        c
      when Model::Chevrons
        c = l.copy
        anchor = effects(c, l, old, now)
        along_axis = (l.from == "hoist" || l.from == "fly") == (@axis == "fly")
        if along_axis && anchor == "scale"
          c.depth *= k
        elsif !along_axis && !l.apex.nil?
          c.apex = move(l.apex, old, now, anchor)
        end
        c
      when Model::Band
        c = l.copy
        anchor = effects(c, l, old, now)
        if l.rotate != 0
          # It keeps its angle and width, and its center line moves like any position.
          before = regions(old, now)[0]
          frame = Shapes.frame(l.fixed, before)
          center = Shapes.frame_center(l.fixed, before)
          normal = Shapes.axis(frame, l.along, l.rotate)[1]
          moved = move_vec(center.add(normal.mul(l.offset)), old, now, anchor)
          c.fixed = Model::FixedFrame.new(frame.w, frame.h, moved.x, moved.y)
          c.offset = 0.0
          return c
        end
        across_axis = (@axis == "fly" && l.along == "hoist") || (@axis == "hoist" && l.along == "fly")
        if across_axis
          case anchor
          when "start"
            c.offset -= (now - old) / 2
          when "end"
            c.offset += (now - old) / 2
          when "scale"
            c.offset *= k
            c.width *= k
          end
        end
        c
      when Model::Cross
        c = l.copy
        anchor = effects(c, l, old, now)
        if @axis == "fly"
          c.fly_parts = parts("a cross", l.fly_parts, old, now, anchor).dup
        else
          c.hoist_parts = parts("a cross", l.hoist_parts, old, now, anchor).dup
        end
        c
      when Model::Quarters
        c = l.copy
        anchor = effects(c, l, old, now)
        c.split = point(l.split, old, now, anchor)
        c
      when Model::Rays
        c = l.copy
        anchor = effects(c, l, old, now)
        c.at = point(l.at, old, now, anchor)
        c
      when Model::Charge
        c = l.copy
        anchor = effects(c, l, old, now)
        c.shape = shape(l.shape, old, now, anchor, given(l))
        if l.repeat && l.repeat.kind == "line" && anchor == "scale"
          r = l.repeat.copy
          if @axis == "fly"
            r.fly *= k
          else
            r.hoist *= k
          end
          c.repeat = r
        end
        c
      when Model::Emblem
        c = l.copy
        anchor = effects(c, l, old, now)
        # One at the center that's given an anchor is pinned to it, as a charge is.
        c.at = center(old) if c.at.nil? && given(l) && anchor != "scale"
        c.at = point(c.at, old, now, anchor)
        c
      when Model::Group
        c = l.copy
        effects(c, l, old, now)
        pass_on(l) { c.layers = layers(l.layers, old, now) }
        c
      when Model::Panel
        panel(l, old, now)
      when Model::Use
        c = l.copy
        effects(c, l, old, now)
        if l.design.fly == 0
          d = Model::Define.new
          d.shape = l.design.shape
          d.fly = l.design.fly
          d.hoist = l.design.hoist
          d.size = l.design.size
          d.height = l.design.height
          pass_on(l) { d.layers = layers(l.design.layers, old, now) }
          c.design = d
        end
        c
      else
        # A field, saltire or checks follows its region.
        c = l.copy
        effects(c, l, old, now)
        c
      end
    end

    # The regions before and after the change.
    def regions(old, now)
      if @axis == "hoist"
        return [Shapes::Region.new(@other, old), Shapes::Region.new(@other, now)]
      end
      [Shapes::Region.new(old, @other), Shapes::Region.new(now, @other)]
    end

    # Moves a point along the axis, by a layer's anchor.
    def move_vec(v, old, now, anchor)
      return Geometry::Vec.new(v.x, move(v.y, old, now, anchor)) if @axis == "hoist"
      Geometry::Vec.new(move(v.x, old, now, anchor), v.y)
    end

    # Keeps a rotated bars' angle, and the lines between its bars where they were about its center,
    # which moves like any position. The first and last bars reach the new region's corners.
    def rotated_bars(c, old, now, anchor)
      before, after = regions(old, now)
      frame = Shapes.frame(c.fixed, before)
      center = Shapes.frame_center(c.fixed, before)
      normal = Shapes.axis(frame, c.along, c.rotate)[1]
      moved = move_vec(center, old, now, anchor)
      lo, hi = Adapter.spread(before, center, normal)
      will = Adapter.spread(after, moved, normal)
      total = 0.0
      c.ratio.each { |part| total += part }
      n = c.ratio.size
      ratio = Array.new(n)
      line = lo
      start = will[0]
      n.times do |i|
        line += (hi - lo) * c.ratio[i] / total
        stop = i == n - 1 ? will[1] : line
        ratio[i] = stop - start
        start = stop
      end
      keep("bars", ratio[0], old)
      keep("bars", ratio[n - 1], old)
      c.ratio = ratio
      c.fixed = Model::FixedFrame.new(frame.w, frame.h, moved.x, moved.y)
      c
    end

    # Keeps a panel at its edge or corner. One running along the axis grows with its parent, and
    # only scaling changes the size of any other.
    def panel(t, old, now)
      k = now / old
      c = t.copy
      anchor = effects(c, t, old, now)
      if t.side.empty? && t.corner.empty? && c.at.nil? && given(t) && anchor != "scale"
        # One at the center that's given an anchor is pinned to it, as a charge is.
        c.at = center(old)
      end
      c.at = point(c.at, old, now, anchor)
      runs_along = (@axis == "fly" && (t.side == "top" || t.side == "bottom")) ||
                   (@axis == "hoist" && (t.side == "hoist" || t.side == "fly"))
      outer = @other
      was = @passed
      begin
        @passed = t.anchor unless t.anchor.empty?
        if runs_along
          @other = t.width
          c.layers = layers(t.layers, old, now)
          return c
        end
        return c if anchor != "scale"
        # Everything inside is measured against the panel's own size along the axis.
        size = t.fly
        if !t.side.empty?
          size = t.width
          c.width *= k
          @other = outer
        elsif @axis == "fly"
          @other = t.hoist
          c.fly *= k
        else
          size = t.hoist
          @other = t.fly
          c.hoist *= k
        end
        c.layers = layers(t.layers, size, size * k)
        c
      ensure
        @other = outer
        @passed = was
      end
    end
  end
end
