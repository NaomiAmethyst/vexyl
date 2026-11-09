// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// The Construction view: the flag's construction sheet, as it downloads and prints, with how it's drawn.

import { useEffect, useState } from "preact/hooks";
import type { SheetFont } from "vexyl";
import { refLabel } from "./address.js";
import { download, downloadBlob, fileStem, Logo, Seg, Spinner, useAck, useApp } from "./common.js";
import { engine } from "./engine.js";
import { cappedNote, pngForPaper, svgToPng } from "./png.js";
import { pageRule, sheetFontFiles, sheetForms, sheetOptions, type SheetPrefs } from "./sheet.js";
import { app } from "./store.js";

interface Shown {
	url: string;
	svg: string;
	widthMm: number;
	heightMm: number;
}

const unitHelp: Record<SheetPrefs["units"], string> = {
	grid: "Grid units, as the file writes them.",
	hoist: "Parts of the hoist, H, the way many laws give them.",
	mm: "Millimetres, for making a flag of a given size.",
};

/** The one rule that sizes printed pages, kept in a sheet of its own, since the page allows no inline styles. */
let pageSheet: CSSStyleSheet | null = null;

function setPageSize(widthMm: number, heightMm: number): void {
	if (typeof CSSStyleSheet === "undefined" || !("adoptedStyleSheets" in document)) {
		return;
	}
	pageSheet ??= new CSSStyleSheet();
	pageSheet.replaceSync(pageRule(widthMm, heightMm));
	if (!document.adoptedStyleSheets.includes(pageSheet)) {
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageSheet];
	}
}

let fontsLoading: Promise<SheetFont[]> | null = null;

/** The sheet's fonts, from this site, read once. They're the files the page's own styles already loaded. */
function sheetFonts(): Promise<SheetFont[]> {
	fontsLoading ??= Promise.all(sheetFontFiles.map(async ({ family, weight, file }) => {
		const r = await fetch(new URL(file, document.baseURI).href, { credentials: "omit", referrerPolicy: "no-referrer" });
		if (!r.ok) {
			throw new Error("The sheet's fonts couldn't be read, so it can't be a PNG.");
		}
		return { family, weight, woff2: new Uint8Array(await r.arrayBuffer()) };
	}));
	fontsLoading.catch(() => { fontsLoading = null; });
	return fontsLoading;
}

function clearPageSize(): void {
	if (pageSheet !== null) {
		document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== pageSheet);
	}
}

export function ConstructionPage(): preact.JSX.Element {
	const [s] = useApp();
	const prefs = s.sheet;
	const [shown, setShown] = useState<Shown | null>(null);
	const [refused, setRefused] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [ack, setAck] = useAck();
	const ref = s.source?.ref;
	const path = ref?.kind === "github" ? ref.path : ref !== undefined ? refLabel(ref) : undefined;
	const name = app.displayName();
	const valid = s.lastValid;
	const variants = Object.keys((valid?.model?.["variant"] ?? {}) as Record<string, unknown>);
	const forms = sheetForms(variants);
	// A form this flag doesn't have, kept from another flag, shows the flag itself.
	const form = forms.some(([id]) => id === prefs.form) ? prefs.form : "flag";
	const options = sheetOptions({ ...prefs, form }, path, s.tier, variants);
	const drawn = JSON.stringify(options);
	useEffect(() => {
		if (valid === null) {
			return undefined;
		}
		let live = true;
		setBusy(true);
		void engine.ask({ kind: "construction", slot: "main", options }).then((r) => {
			if (!live) {
				return;
			}
			setBusy(false);
			if (r.svg === undefined) {
				setRefused(r.refused ?? "This sheet can't be drawn.");
				return;
			}
			setRefused(null);
			const url = URL.createObjectURL(new Blob([r.svg], { type: "image/svg+xml" }));
			setShown((old) => {
				if (old !== null) {
					setTimeout(() => { URL.revokeObjectURL(old.url); }, 2000);
				}
				return { url, svg: r.svg!, widthMm: r.widthMm ?? 297, heightMm: r.heightMm ?? 210 };
			});
			setPageSize(r.widthMm ?? 297, r.heightMm ?? 210);
		}, (e: Error) => {
			if (live) {
				setBusy(false);
				setRefused(e.message);
			}
		});
		return () => { live = false; };
	}, [valid, drawn]);
	useEffect(() => clearPageSize, []);
	const stem = fileStem(ref !== undefined ? refLabel(ref).replace(/\.kdl$/, "") : name) + (form === "flag" ? "" : `-${fileStem(form.replace(/^variant:/, ""))}`);
	const png = shown !== null ? pngForPaper(shown.widthMm, shown.heightMm, prefs.dpi) : null;
	const downloadPng = async (): Promise<void> => {
		if (png === null) {
			return;
		}
		try {
			const r = await engine.ask({ kind: "construction", slot: "main", options: { ...options, fonts: await sheetFonts() } });
			if (r.svg === undefined) {
				setAck(r.refused ?? "This sheet can't be drawn.");
				return;
			}
			downloadBlob(`${stem}-construction.png`, await svgToPng(r.svg, png));
			setAck(png.capped ? `Downloaded the PNG, at ${png.width} × ${png.height}, the most a browser can draw.` : "Downloaded the PNG.");
		} catch (e) {
			setAck((e as Error).message);
		}
	};
	const ratio = shown !== null ? `${shown.widthMm} / ${shown.heightMm}` : "297 / 210";
	return (
		<>
			<header class="topbar">
				<Logo />
				<span class="nx-muted">Construction sheet</span>
				<span class="grow" />
				<span class="visually-hidden" role="status">{ack}</span>
				{ack !== "" ? <span class="nx-note topbar-ack" aria-hidden="true">{ack}</span> : null}
				<a class="nx-ghost" href={app.href("work")} onClick={(e) => { e.preventDefault(); app.go("work"); }}>Back to editing</a>
			</header>
			<main class="construction">
				<div class="compare-head">
					<div class="compare-title">
						<h1 class="compare-h1">{name}</h1>
						<p class="nx-muted">Every number on the sheet comes from the file, worked out exactly. Nothing is measured from the drawing.</p>
					</div>
				</div>
				<div class="sheet-layout">
					<aside class="sheet-options" aria-label="Sheet options">
						<section class="card" aria-labelledby="sheet-form">
							<h2 id="sheet-form" class="nx-label card-head">Form</h2>
							<Seg label="Form" class="wrap" value={form} options={forms} onPick={(v) => { app.setSheet({ form: v }); }} />
							<p class="nx-note">{form === "reverse" ? "The back, as someone behind the flag sees it." : form === "flag" ? "The flag as the file draws it." : "This variant, turned as it turns, and measured as the flag is."}</p>
						</section>
						<section class="card" aria-labelledby="sheet-units">
							<h2 id="sheet-units" class="nx-label card-head">Sizes in</h2>
							<Seg label="Sizes in" value={prefs.units} options={[["grid", "Grid"], ["hoist", "Hoist"], ["mm", "mm"]]} onPick={(v) => { app.setSheet({ units: v as SheetPrefs["units"] }); }} />
							<p class="nx-note">{unitHelp[prefs.units]}</p>
							{prefs.units === "mm" ? (
								<label class="nx-field">Hoist, in millimetres
									<input class="nx-input hoist-mm" type="number" min="1" step="1" value={prefs.hoistMm} onChange={(e) => {
										const v = Number((e.currentTarget as HTMLInputElement).value);
										if (Number.isFinite(v) && v > 0 && v <= 1e6) {
											app.setSheet({ hoistMm: v });
										}
									}} />
								</label>
							) : null}
						</section>
						<section class="card" aria-labelledby="sheet-look">
							<h2 id="sheet-look" class="nx-label card-head">Sheet</h2>
							<Seg label="Sheet" value={prefs.theme} options={[["paper", "Paper"], ["dark", "Dark"]]} onPick={(v) => { app.setSheet({ theme: v as SheetPrefs["theme"] }); }} />
							<p class="nx-note">{prefs.theme === "dark" ? "Purple lines on a dark ground, for the screen." : "Black lines on white, for printing."}</p>
						</section>
						<section class="card" aria-labelledby="sheet-show">
							<h2 id="sheet-show" class="nx-label card-head">Show</h2>
							{([["sizes", "Sizes of each part"], ["positions", "Where each charge is"], ["colors", "The colour key"], ["grid", "The grid"]] as const).map(([key, label]) => (
								<label class="nx-check" key={key}>
									<input type="checkbox" checked={prefs[key]} onChange={(e) => { app.setSheet({ [key]: (e.currentTarget as HTMLInputElement).checked }); }} />
									{label}
								</label>
							))}
						</section>
						<section class="card" aria-labelledby="sheet-paper">
							<h2 id="sheet-paper" class="nx-label card-head">Paper</h2>
							<Seg label="Paper" class="wrap" value={prefs.paper} options={[["a4", "A4"], ["letter", "Letter"], ["fit", "Fit the flag"]]} onPick={(v) => { app.setSheet({ paper: v as SheetPrefs["paper"] }); }} />
							<Seg label="PNG resolution" value={String(prefs.dpi)} options={[["150", "150 dpi"], ["300", "300 dpi"], ["600", "600 dpi"]]} onPick={(v) => { app.setSheet({ dpi: Number(v) as SheetPrefs["dpi"] }); }} />
							{png !== null ? <p class={`nx-note${png.capped ? " png-capped" : ""}`} aria-live="polite">{png.capped ? cappedNote(png) : `The PNG is ${png.width} × ${png.height} pixels.`}</p> : null}
							<div class="sheet-actions">
								<button type="button" class="nx-btn" disabled={shown === null} onClick={() => {
									if (shown !== null) {
										download(`${stem}-construction.svg`, shown.svg, "image/svg+xml");
										setAck("Downloaded the sheet.");
									}
								}}>Download SVG</button>
								<button type="button" class="nx-ghost" disabled={shown === null} onClick={() => { void downloadPng(); }}>Download PNG</button>
								<button type="button" class="nx-ghost" disabled={shown === null} onClick={() => {
									if (shown !== null) {
										setPageSize(shown.widthMm, shown.heightMm);
										print();
									}
								}}>Print</button>
							</div>
							<p class="nx-note">Print makes a PDF too, through the browser’s own printing, on paper the size of the sheet.</p>
						</section>
					</aside>
					<section class="sheet-view" aria-label="The construction sheet">
						<div class="sheet-frame" style={{ aspectRatio: ratio }}>
							{refused !== null ? <p class="nx-callout warn"><span>{refused}</span></p> : shown !== null ? (
								<img class="print-sheet" src={shown.url} alt={`The construction sheet of ${name}, with its sizes marked`} />
							) : <span class="bone sheet-bone" aria-hidden="true" />}
						</div>
						{busy ? <Spinner label="Drawing" /> : null}
						{valid !== null && s.analysis !== null && !s.analysis.valid ? <p class="nx-note">This is the last version of the file that was valid.</p> : null}
					</section>
				</div>
			</main>
		</>
	);
}
