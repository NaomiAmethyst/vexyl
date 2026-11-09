// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Pictures of the flag to download: SVG as the library draws it, or PNG at a height in pixels.

import { useEffect, useId, useRef } from "preact/hooks";
import { download, downloadBlob, Seg, useApp } from "./common.js";
import { cappedNote, mostAsked, pngForHeight, svgSize, svgToPng, type PicturePrefs } from "./png.js";
import { app } from "./store.js";

/** Downloads a picture as the person likes them, and says what it did. */
export async function downloadPicture(stem: string, svg: string, prefs: PicturePrefs): Promise<string> {
	if (prefs.format === "svg") {
		download(`${stem}.svg`, svg, "image/svg+xml");
		return "Downloaded the SVG.";
	}
	const own = svgSize(svg);
	if (own === null) {
		return "That picture has no size, so it can't be a PNG.";
	}
	const size = pngForHeight(own.width, own.height, prefs.height);
	try {
		downloadBlob(`${stem}.png`, await svgToPng(svg, size));
	} catch (e) {
		return (e as Error).message;
	}
	return size.capped ? `Downloaded the PNG, at ${size.width} × ${size.height}, the most a browser can draw.` : "Downloaded the PNG.";
}

/** A picture's format, if it's to be chosen here, and a PNG's height, with the size it'll be. */
export function PictureFields(props: { choose: boolean; width: number | undefined; height: number | undefined }): preact.JSX.Element {
	const [s] = useApp();
	const p = s.picture;
	const format = props.choose ? p.format : "png";
	const size = props.width !== undefined && props.height !== undefined && props.width > 0 && props.height > 0 ? pngForHeight(props.width, props.height, p.height) : null;
	return (
		<>
			{props.choose ? (
				<div class="field">
					<span class="nx-label">Picture as</span>
					<Seg label="Picture as" value={p.format} options={[["svg", "SVG"], ["png", "PNG"]]} onPick={(v) => { app.setPicture({ format: v as PicturePrefs["format"] }); }} />
					<span class="nx-note">{p.format === "svg" ? "Sharp at any size, for printing and for editing in other programs." : "Pixels, for anywhere that won't take an SVG."}</span>
				</div>
			) : null}
			{format === "png" ? (
				<div class="field">
					<label class="nx-field">Height, in pixels
						<input class="nx-input png-height" type="number" min="1" max={mostAsked} step="1" value={p.height} onInput={(e) => {
							const v = Number((e.currentTarget as HTMLInputElement).value);
							if (Number.isInteger(v) && v >= 1 && v <= mostAsked) {
								app.setPicture({ height: v });
							}
						}} />
					</label>
					{size !== null ? <span class={`nx-note${size.capped ? " png-capped" : ""}`} aria-live="polite">{size.capped ? cappedNote(size) : `${size.width} × ${size.height} pixels.`}</span> : null}
				</div>
			) : null}
		</>
	);
}

/**
 * Asks how a picture is wanted before downloading it. Basic chooses its format here; Advanced has
 * an SVG of its own in the menu, so this is only ever its PNG.
 */
export function PictureDialog(props: { open: boolean; basic: boolean; width: number | undefined; height: number | undefined; onClose: () => void; onDownload: () => void }): preact.JSX.Element {
	const ref = useRef<HTMLDialogElement>(null);
	const id = useId();
	const [s] = useApp();
	useEffect(() => {
		const d = ref.current;
		if (d === null) {
			return;
		}
		if (props.open && !d.open) {
			d.showModal();
		} else if (!props.open && d.open) {
			d.close();
		}
	}, [props.open]);
	return (
		<dialog ref={ref} class="raised narrow picture-dialog" aria-labelledby={id} onClose={props.onClose}>
			{props.open ? (
				<>
					<h2 id={id} class="dialog-title">{props.basic ? "Download a picture" : "Download a PNG"}</h2>
					<PictureFields choose={props.basic} width={props.width} height={props.height} />
					<div class="sheet-actions">
						<button type="button" class="nx-btn" onClick={() => { props.onDownload(); }}>{!props.basic || s.picture.format === "png" ? "Download PNG" : "Download SVG"}</button>
						<button type="button" class="nx-ghost" onClick={() => { props.onClose(); }}>Cancel</button>
					</div>
				</>
			) : null}
		</dialog>
	);
}
