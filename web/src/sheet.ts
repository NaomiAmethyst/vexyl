// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// How a person likes their construction sheets, which is theirs and not the flag's, so it's
// remembered for every flag, as the editor they work in is.

import type { ConstructionOptions, SheetForm } from "vexyl";

export interface SheetPrefs {
	units: "grid" | "hoist" | "mm";
	hoistMm: number;
	theme: "paper" | "dark";
	paper: "a4" | "letter" | "fit";
	sizes: boolean;
	positions: boolean;
	colors: boolean;
	grid: boolean;
	/** A PNG's dots per inch, on the sheet's paper. */
	dpi: 150 | 300 | 600;
	/**
	 * Which form of the flag: "flag", "reverse", or "variant:" and a variant's name, as the gallery names
	 * them. One the flag doesn't have draws the flag itself.
	 */
	form: string;
}

export const sheetKey = "vexyl.construction";

/** On screen, a sheet is dark by default, as the editor is. */
export const defaultSheet: SheetPrefs = { units: "grid", hoistMm: 1000, theme: "dark", paper: "a4", sizes: true, positions: true, colors: true, grid: false, dpi: 300, form: "flag" };

const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

/** Reads what was kept, keeping only what makes sense, so that an old or damaged value can't break the page. */
export function readSheetPrefs(text: string | null): SheetPrefs {
	let v: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(text ?? "{}");
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
			v = parsed as Record<string, unknown>;
		}
	} catch {
		// Nothing kept that can be read, so the defaults.
	}
	const d = defaultSheet;
	const mm = typeof v["hoistMm"] === "number" && Number.isFinite(v["hoistMm"]) && v["hoistMm"] > 0 && v["hoistMm"] <= 1e6 ? v["hoistMm"] : d.hoistMm;
	return {
		units: oneOf(v["units"], ["grid", "hoist", "mm"] as const, d.units),
		hoistMm: mm,
		theme: oneOf(v["theme"], ["paper", "dark"] as const, d.theme),
		paper: oneOf(v["paper"], ["a4", "letter", "fit"] as const, d.paper),
		sizes: flag(v["sizes"], d.sizes),
		positions: flag(v["positions"], d.positions),
		colors: flag(v["colors"], d.colors),
		grid: flag(v["grid"], d.grid),
		dpi: v["dpi"] === 150 || v["dpi"] === 600 ? v["dpi"] : 300,
		form: typeof v["form"] === "string" && v["form"].length <= 300 && /^(flag|reverse|variant:.+)$/s.test(v["form"]) ? v["form"] : d.form,
	};
}

export function savedSheet(): SheetPrefs {
	try {
		return readSheetPrefs(globalThis.localStorage.getItem(sheetKey));
	} catch {
		return defaultSheet;
	}
}

export function saveSheet(prefs: SheetPrefs): void {
	try {
		globalThis.localStorage.setItem(sheetKey, JSON.stringify(prefs));
	} catch {
		// It just won't be remembered.
	}
}

/** The forms a sheet can be drawn for, as the gallery lists them: the flag, its reverse, and each variant. */
export function sheetForms(variants: readonly string[]): [string, string][] {
	return [["flag", "Flag"], ["reverse", "Reverse"], ...variants.map((name): [string, string] => [`variant:${name}`, name.charAt(0).toUpperCase() + name.slice(1)])];
}

/** The form a person chose, if the flag has it, and otherwise the flag itself. */
export function sheetForm(id: string, variants: readonly string[]): SheetForm {
	if (id === "reverse") {
		return { side: "reverse" };
	}
	const name = id.startsWith("variant:") ? id.slice("variant:".length) : null;
	return name !== null && variants.includes(name) ? { variant: name } : {};
}

/** The library's options for a sheet, with what the file can't say about itself. */
export function sheetOptions(prefs: SheetPrefs, path: string | undefined, tier: string | null, variants: readonly string[] = []): ConstructionOptions {
	const opts: ConstructionOptions = { units: prefs.units, theme: prefs.theme, paper: prefs.paper, sizes: prefs.sizes, positions: prefs.positions, colors: prefs.colors, grid: prefs.grid };
	const form = sheetForm(prefs.form, variants);
	if (form.variant !== undefined || form.side !== undefined) {
		opts.form = form;
	}
	if (prefs.units === "mm") {
		opts.hoistMm = prefs.hoistMm;
	}
	if (path !== undefined && path !== "") {
		opts.path = path;
	}
	if (tier !== null) {
		opts.tier = tier;
	}
	return opts;
}

/** The rule that prints a sheet on paper of its own size, with nothing around it. */
export const pageRule = (widthMm: number, heightMm: number): string => `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`;

/**
 * The faces a sheet's text is set in, which the library's `sheetFaces` lists, as the files this site
 * serves them from. A PNG's sheet carries them, since a browser drawing an SVG loads no fonts for it.
 */
export const sheetFontFiles: readonly { family: string; weight: number; file: string }[] = [
	{ family: "Geist", weight: 400, file: "fonts/geist-sans-latin-400-normal.woff2" },
	{ family: "Geist", weight: 500, file: "fonts/geist-sans-latin-500-normal.woff2" },
	{ family: "Geist Mono", weight: 400, file: "fonts/geist-mono-latin-400-normal.woff2" },
	{ family: "Geist Mono", weight: 500, file: "fonts/geist-mono-latin-500-normal.woff2" },
];
