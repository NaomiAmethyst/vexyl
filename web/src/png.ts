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

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) {
		c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	}
	return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const b of bytes) {
		c = crcTable[(c ^ b) & 255]! ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

/**
 * Says in a PNG how big its pixels are, as a `pHYs` chunk of so many pixels per metre each way,
 * just after its header, in place of any it had. Anything that isn't a PNG is given back as it was.
 */
export function withResolution(png: Uint8Array, xPerMetre: number, yPerMetre: number): Uint8Array {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (png.length < 33 || signature.some((b, i) => png[i] !== b) || view.getUint32(12) !== 0x49484452) {
		return png;
	}
	const chunk = new Uint8Array(21);
	const out = new DataView(chunk.buffer);
	out.setUint32(0, 9);
	chunk.set([0x70, 0x48, 0x59, 0x73], 4);
	out.setUint32(8, Math.round(xPerMetre));
	out.setUint32(12, Math.round(yPerMetre));
	// The unit is the metre.
	chunk[16] = 1;
	out.setUint32(17, crc32(chunk.subarray(4, 17)));
	const parts: Uint8Array[] = [png.subarray(0, 33), chunk];
	for (let at = 33; at + 12 <= png.length;) {
		const length = view.getUint32(at);
		const end = Math.min(png.length, at + 12 + length);
		if (view.getUint32(at + 4) !== 0x70485973) {
			parts.push(png.subarray(at, end));
		}
		at = end;
	}
	const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		joined.set(p, at);
		at += p.length;
	}
	return joined;
}

/**
 * Draws an SVG as a PNG, `size` big, which `fitPng` has already brought within what a browser can
 * draw. A sheet's PNG gives its `paper`'s size, in millimetres, so that it prints at that size.
 */
export async function svgToPng(svg: string, size: PngSize, paper?: { widthMm: number; heightMm: number }): Promise<Blob> {
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
		const blob = await new Promise<Blob>((done, fail) => {
			canvas.toBlob((b) => {
				if (b === null) {
					fail(new Error("This browser couldn't make a picture that size."));
				} else {
					done(b);
				}
			}, "image/png");
		});
		if (paper === undefined) {
			return blob;
		}
		// From the pixels there are, which is fewer than asked for if they had to be.
		const bytes = withResolution(new Uint8Array(await blob.arrayBuffer()), (size.width * 1000) / paper.widthMm, (size.height * 1000) / paper.heightMm);
		return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" });
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
