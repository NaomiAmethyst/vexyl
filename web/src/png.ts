// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Pictures as PNG, drawn by the browser from the library's SVG, at any size a browser can hold.
// Whatever isn't painted stays transparent, as a shaped flag's corners are.

/** The most any side can be, and the most pixels in all, which iOS Safari's canvas allows. */
export const maxSide = 16384;
export const maxArea = 16777216;

export interface PngSize {
	width: number;
	height: number;
	/** Whether it had to be made smaller than was asked, to fit what a browser can draw. */
	capped: boolean;
}

/** A size in whole pixels, made smaller if it has to be, keeping its shape. */
export function fitPng(width: number, height: number): PngSize {
	let w = Math.max(1, Math.round(width));
	let h = Math.max(1, Math.round(height));
	const scale = Math.min(1, maxSide / w, maxSide / h, Math.sqrt(maxArea / (w * h)));
	if (scale >= 1) {
		return { width: w, height: h, capped: false };
	}
	w = Math.max(1, Math.floor(width * scale));
	h = Math.max(1, Math.floor(height * scale));
	return { width: w, height: h, capped: true };
}

/** A picture of a given height, for something `width` by `height` in any units. */
export const pngForHeight = (width: number, height: number, px: number): PngSize => fitPng((px * width) / height, px);

/** A sheet's size at some dots per inch, from its size on paper. */
export const pngForPaper = (widthMm: number, heightMm: number, dpi: number): PngSize => fitPng((widthMm / 25.4) * dpi, (heightMm / 25.4) * dpi);

/** What to tell someone about the size they'll get, which is nothing unless it's smaller than they asked. */
export const cappedNote = (size: PngSize): string => (size.capped ? `That's more than a browser can draw, so the PNG will be ${size.width} × ${size.height} pixels.` : "");

/** An SVG document's own width and height, in whatever units it gives them. */
export function svgSize(svg: string): { width: number; height: number } | null {
	const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
	const width = Number.parseFloat(/\swidth="([^"]*)"/.exec(root)?.[1] ?? "");
	const height = Number.parseFloat(/\sheight="([^"]*)"/.exec(root)?.[1] ?? "");
	return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Gives the SVG the size it's to be drawn at, since some browsers draw an SVG at its own size and
 * then stretch the pixels. The library's SVG always has a viewBox, so its drawing scales with it.
 */
export function sizedSvg(svg: string, width: number, height: number): string {
	return svg.replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\swidth="[^"]*"/, ` width="${width}"`).replace(/\sheight="[^"]*"/, ` height="${height}"`));
}

/** Draws an SVG as a PNG, `size` big, which `fitPng` has already brought within what a browser can draw. */
export async function svgToPng(svg: string, size: PngSize): Promise<Blob> {
	const url = URL.createObjectURL(new Blob([sizedSvg(svg, size.width, size.height)], { type: "image/svg+xml" }));
	try {
		const img = new Image();
		img.src = url;
		await img.decode();
		const canvas = document.createElement("canvas");
		canvas.width = size.width;
		canvas.height = size.height;
		const g = canvas.getContext("2d");
		if (g === null) {
			throw new Error("This browser couldn't make a picture that size.");
		}
		g.drawImage(img, 0, 0, size.width, size.height);
		return await new Promise<Blob>((done, fail) => {
			canvas.toBlob((b) => {
				if (b === null) {
					fail(new Error("This browser couldn't make a picture that size."));
				} else {
					done(b);
				}
			}, "image/png");
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** How a person likes their pictures, which is theirs and not the flag's, so it's remembered for every flag. */
export interface PicturePrefs {
	format: "svg" | "png";
	/** A PNG's height in pixels, as asked for, which can be more than a browser draws. */
	height: number;
}

/** The most that can be asked for. More than a browser draws, so that what it does draw can be said. */
export const mostAsked = 100000;

export const pictureKey = "vexyl.picture";

export const defaultPicture: PicturePrefs = { format: "svg", height: 1200 };

/** Reads what was kept, keeping only what makes sense. */
export function readPicturePrefs(text: string | null): PicturePrefs {
	let v: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(text ?? "{}");
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
			v = parsed as Record<string, unknown>;
		}
	} catch {
		// Nothing kept that can be read, so the defaults.
	}
	const h = v["height"];
	return {
		format: v["format"] === "png" ? "png" : "svg",
		height: typeof h === "number" && Number.isInteger(h) && h >= 1 && h <= mostAsked ? h : defaultPicture.height,
	};
}

export function savedPicture(): PicturePrefs {
	try {
		return readPicturePrefs(globalThis.localStorage.getItem(pictureKey));
	} catch {
		return defaultPicture;
	}
}

export function savePicture(prefs: PicturePrefs): void {
	try {
		globalThis.localStorage.setItem(pictureKey, JSON.stringify(prefs));
	} catch {
		// It just won't be remembered.
	}
}
