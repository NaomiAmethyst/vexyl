// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

/**
 * How to render a flag, as section 3 of the SDK describes. Every option is optional, and
 * rendering with none gives the flag as it is. A value that can't be used is refused when
 * the flag is rendered, so that no option is ever silently ignored.
 *
 * <pre>{@code
 * RenderOptions opts = RenderOptions.builder().height(300).variant("vertical").build();
 * }</pre>
 */
public final class RenderOptions {
	/** The height an image has without the {@code height} option. */
	public static final double DEFAULT_HEIGHT = 600;

	private static final RenderOptions NONE = builder().build();

	final Double height;
	final Double ratio;
	final String variant;
	final String side;
	final String fit;
	final String align;
	final String fold;
	final Integer foldStep;
	final String idPrefix;
	final boolean tags;

	private RenderOptions(Builder b) {
		height = b.height;
		ratio = b.ratio;
		variant = b.variant;
		side = b.side;
		fit = b.fit;
		align = b.align;
		fold = b.fold;
		foldStep = b.foldStep;
		idPrefix = b.idPrefix;
		tags = b.tags;
	}

	/** No options: the flag as it is, at the default height. */
	public static RenderOptions defaults() {
		return NONE;
	}

	public static Builder builder() {
		return new Builder();
	}

	/** A builder holding these options, to change some of them. */
	public Builder toBuilder() {
		Builder b = new Builder();
		b.height = height;
		b.ratio = ratio;
		b.variant = variant;
		b.side = side;
		b.fit = fit;
		b.align = align;
		b.fold = fold;
		b.foldStep = foldStep;
		b.idPrefix = idPrefix;
		b.tags = tags;
		return b;
	}

	/** Gathers options. Each method gives the builder back, and leaving one out leaves its default. */
	public static final class Builder {
		private Double height;
		private Double ratio;
		private String variant = "";
		private String side = "";
		private String fit = "";
		private String align = "";
		private String fold = "";
		private Integer foldStep;
		private String idPrefix = "";
		private boolean tags;

		private Builder() {}

		/** The image's height in pixels, 600 by default. Its width follows the proportion. */
		public Builder height(double pixels) {
			height = pixels;
			return this;
		}

		/**
		 * The proportion wanted, as fly divided by hoist, measured before a variant turns it. A
		 * flag reaches it by its {@code adapt} rules.
		 */
		public Builder ratio(double flyOverHoist) {
			ratio = flyOverHoist;
			return this;
		}

		/** One of the flag's variants, by name. */
		public Builder variant(String name) {
			variant = name == null ? "" : name;
			return this;
		}

		/** {@code obverse}, the default, or {@code reverse}. */
		public Builder side(String side) {
			this.side = side == null ? "" : side;
			return this;
		}

		/**
		 * What to do when the flag can't reach the ratio: {@code error}, the default, or {@code pad},
		 * which draws it as near as it can and leaves the rest transparent.
		 */
		public Builder fit(String fit) {
			this.fit = fit == null ? "" : fit;
			return this;
		}

		/** Where a padded flag sits: {@code start}, {@code center}, the default, or {@code end}. */
		public Builder align(String align) {
			this.align = align == null ? "" : align;
			return this;
		}

		/** One of the flag's folds, by name, to show it folded. */
		public Builder fold(String name) {
			fold = name == null ? "" : name;
			return this;
		}

		/** Stops a fold after this many steps, from 1 to the fold's number of steps. */
		public Builder foldStep(int steps) {
			foldStep = steps;
			return this;
		}

		/**
		 * Starts every ID in the output with this, instead of a prefix worked out from the document.
		 * A page showing documents it doesn't trust should pass one it knows is unique.
		 */
		public Builder idPrefix(String prefix) {
			idPrefix = prefix == null ? "" : prefix;
			return this;
		}

		/** Marks each drawn element with the path of the layer that drew it, as section 7 of the SDK says. */
		public Builder tags(boolean tags) {
			this.tags = tags;
			return this;
		}

		public RenderOptions build() {
			return new RenderOptions(this);
		}
	}
}
