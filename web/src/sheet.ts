// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// How a person likes their construction sheets, which is theirs and not the flag's, so it's
// remembered for every flag, as the editor they work in is.

import type { ConstructionOptions } from "vexyl";

export interface SheetPrefs {
	units: "grid" | "hoist" | "mm";
	hoistMm: number;
	theme: "paper" | "dark";
	paper: "a4" | "letter" | "fit";
	sizes: boolean;
	positions: boolean;
	colors: boolean;
	grid: boolean;
}

export const sheetKey = "vexyl.construction";

/** On screen, a sheet is dark by default, as the editor is. */
export const defaultSheet: SheetPrefs = { units: "grid", hoistMm: 1000, theme: "dark", paper: "a4", sizes: true, positions: true, colors: true, grid: false };

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

/** The library's options for a sheet, with what the file can't say about itself. */
export function sheetOptions(prefs: SheetPrefs, path: string | undefined, tier: string | null): ConstructionOptions {
	const opts: ConstructionOptions = { units: prefs.units, theme: prefs.theme, paper: prefs.paper, sizes: prefs.sizes, positions: prefs.positions, colors: prefs.colors, grid: prefs.grid };
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
