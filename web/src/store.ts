// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import type { Options, Problem, Span } from "vexyl";
import { decodePathName } from "vexyl/paths";
import { openHref, readAddress, refLabel, refText, type Ref } from "./address.js";
import { claimTab, dropDraft, durable, loadDraft, orphanOf, saveDraft, TabPresence, type Draft } from "./drafts.js";
import { engine } from "./engine.js";
import type { Analysis, ONode, Op, PickNode, RenderResult } from "./protocol.js";
import { evidenceTiers, fetchRef, type GistFile } from "./remote.js";
import { savedPicture, savePicture, type PicturePrefs } from "./png.js";
import { savedSheet, saveSheet, type SheetPrefs } from "./sheet.js";

export type View = "work" | "open" | "compare" | "share" | "new" | "construction";

/** Which editor a person works in. It's theirs, not the flag's. */
export type Level = "basic" | "advanced";

const levelKey = "vexyl.editor";

function savedLevel(): Level {
	try {
		return globalThis.localStorage.getItem(levelKey) === "advanced" ? "advanced" : "basic";
	} catch {
		return "basic";
	}
}

export interface Source {
	kind: "github" | "gist" | "url" | "file" | "paste" | "link" | "new";
	ref?: Ref;
	label: string;
}

export interface FormImage {
	url: string;
	refused?: string;
	padded?: boolean;
	pick?: PickNode;
	width: number;
	height: number;
}

export interface GalleryItem {
	id: string;
	group: "Forms" | "Proportions" | "Folds";
	label: string;
	sub: string;
}

export interface State {
	view: View;
	level: Level;
	/** Which of Basic's tabs is showing, when it isn't Source. */
	basicTab: "design" | "details";
	mode: "form" | "source";
	loading: string | null;
	loadError: string | null;
	gistFiles: { id: string; files: GistFile[] } | null;
	text: string;
	base: string;
	eol: string;
	mixedEol: boolean;
	source: Source | null;
	analysis: Analysis | null;
	/** The text the analysis is of, which lags behind while it's being changed. */
	analyzed: string;
	/** Whether something's being dragged, which draws no selection and can't be undone halfway. */
	gesturing: boolean;
	/** Whether Source's history has anything to undo, or to redo, which is the one history both editors share. */
	canUndo: boolean;
	canRedo: boolean;
	/** Whether the note about a flag with a law has been dismissed, for this flag. */
	lawNoteDismissed: boolean;
	/** The last time the document was readable, and valid, for when it isn't now. */
	lastReadable: Analysis | null;
	lastValid: Analysis | null;
	selected: string | null;
	hover: string | null;
	sourceJump: number;
	form: string;
	padded: Record<string, boolean>;
	foldStep: Record<string, number>;
	images: Map<string, FormImage>;
	busy: boolean;
	tier: string | null;
	orphan: Draft | null;
	sameInOtherTab: { tabs: number; dirty: boolean };
	saved: boolean;
	notice: string | null;
	storageNote: boolean;
	/** How construction sheets are drawn. */
	sheet: SheetPrefs;
	/** How pictures of the flag are downloaded. */
	picture: PicturePrefs;
}

function initial(): State {
	return {
		view: "work", level: savedLevel(), basicTab: "design", analyzed: "", gesturing: false, canUndo: false, canRedo: false, lawNoteDismissed: false, mode: "form", loading: null, loadError: null, gistFiles: null, text: "", base: "", eol: "\n", mixedEol: false, source: null,
		analysis: null, lastReadable: null, lastValid: null, selected: null, hover: null, sourceJump: 0, form: "flag", padded: {}, foldStep: {},
		images: new Map(), busy: false, tier: null, orphan: null, sameInOtherTab: { tabs: 0, dirty: false }, saved: true, notice: null, storageNote: false, sheet: savedSheet(), picture: savedPicture(),
	};
}

const ratios: readonly [string, string, number][] = [["ratio:1:1", "1:1", 1], ["ratio:2:3", "2:3", 1.5], ["ratio:1:2", "1:2", 2]];

/** Everything shown in the gallery, worked out from what the flag has. */
export function galleryOf(model: Record<string, unknown> | null): GalleryItem[] {
	if (model === null) {
		return [];
	}
	const items: GalleryItem[] = [{ id: "flag", group: "Forms", label: "Flag", sub: "Obverse" }, { id: "reverse", group: "Forms", label: "Reverse", sub: Object.hasOwn(model, "reverse") ? "Its own" : "Mirrored" }];
	const variants = (model["variant"] ?? {}) as Record<string, Record<string, unknown>>;
	for (const name of Object.keys(variants)) {
		const v = variants[name]!;
		const own = v["proportion"] as { hoist?: number; fly?: number } | undefined;
		items.push({ id: `variant:${name}`, group: "Forms", label: name.charAt(0).toUpperCase() + name.slice(1), sub: own !== undefined ? `${own.hoist}:${own.fly}` : "Variant" });
	}
	const p = model["proportion"] as { hoist: number; fly: number };
	const current = p.fly / p.hoist;
	for (const [id, label, ratio] of ratios) {
		if (Math.abs(ratio - current) > 1e-6) {
			items.push({ id, group: "Proportions", label, sub: "" });
		}
	}
	const folds = (model["fold"] ?? {}) as Record<string, { steps?: unknown[] }>;
	for (const name of Object.keys(folds)) {
		const n = folds[name]!.steps?.length ?? 0;
		items.push({ id: `fold:${name}`, group: "Folds", label: name.charAt(0).toUpperCase() + name.slice(1), sub: `${n} ${n === 1 ? "step" : "steps"}` });
	}
	return items;
}

/** What a form means as options. */
export function optionsFor(id: string, padded: boolean, step: number | undefined): Options {
	if (id === "reverse") {
		return { side: "reverse" };
	}
	if (id.startsWith("variant:")) {
		return padded ? { variant: id.slice(8), fit: "pad" } : { variant: id.slice(8) };
	}
	if (id.startsWith("fold:")) {
		return step === undefined ? { fold: id.slice(5) } : { fold: id.slice(5), foldStep: step };
	}
	if (id.startsWith("ratio:")) {
		const [, h, f] = id.split(":");
		const ratio = Number(f) / Number(h);
		return padded ? { ratio, fit: "pad" } : { ratio };
	}
	return {};
}

export function findPath(nodes: readonly ONode[], path: string): ONode | null {
	for (const n of nodes) {
		if (n.path === path) {
			return n;
		}
		const found = findPath(n.kids, path);
		if (found !== null) {
			return found;
		}
	}
	return null;
}

/** A place in a text, as a one-based line, for jumping to. */
function firstDifference(a: string, b: string): [number, number, number] {
	let start = 0;
	const max = Math.min(a.length, b.length);
	while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) {
		start++;
	}
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
		endA--;
		endB--;
	}
	return [start, endA, endB];
}

/** One drag's worth of edits, sent as fast as they can be taken, however many come along. */
export interface Gesture {
	push(ops: Op[]): void;
	/** Ends it, as one thing to undo. */
	finish(): Promise<void>;
	/** Ends it, as though it never was. */
	cancel(): Promise<void>;
}

/** The least time between one drag's edits. Each one still waits for the one before. */
const gestureGap = 60;

export interface EditorBridge {
	/** With `apart`, it's its own step to undo, whatever came just before it. */
	replace(from: number, to: number, insert: string, apart?: boolean): void;
	setDoc(text: string): void;
	scrollToLine(line: number): void;
}

export class App {
	state: State = initial();
	bridge: EditorBridge | null = null;
	private readonly listeners = new Set<() => void>();
	tab = "";
	private presence: TabPresence | null = null;
	private docKey = "";
	private analyzing = false;
	private analyzeAgain = false;
	private analyzeTimer: ReturnType<typeof setTimeout> | undefined;
	private draftTimer: ReturnType<typeof setTimeout> | undefined;
	private thumbTimer: ReturnType<typeof setTimeout> | undefined;
	private renderSeq = 0;
	private docSeq = 0;
	private editing: Promise<void> = Promise.resolve();
	private following: { from: string | null; to: { path: string } | { at: readonly number[] } } | null = null;
	/** The text from before a drag started, while one's going on. Source only hears about it at the end. */
	private gestureBase: string | null = null;

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	set(patch: Partial<State>): void {
		this.state = { ...this.state, ...patch };
		for (const fn of this.listeners) {
			fn();
		}
	}

	get dirty(): boolean {
		return this.state.source !== null && this.state.text !== this.state.base && !this.state.saved;
	}

	/** Where this tab is, with the view it's showing, for a real link or for the address bar. */
	href(view: View = "work", extra?: { with?: Ref }): string {
		const ref = this.state.source?.ref;
		const base = ref !== undefined ? openHref(ref) : "?";
		const params: string[] = [];
		if (view !== "work") {
			params.push(`view=${view}`);
		}
		if (extra?.with !== undefined) {
			params.push(`with=${encodeURIComponent(refText(extra.with))}`);
		}
		const q = base === "?" ? (params.length > 0 ? "?" + params.join("&") : "?") : [base, ...params].join("&");
		return q + location.hash;
	}

	go(view: View, extra?: { with?: Ref }): void {
		history.pushState(null, "", this.href(view, extra));
		this.set({ view });
		scrollTo(0, 0);
	}

	async boot(): Promise<void> {
		engine.onRestart = (): void => {
			this.set({ notice: "That took too long to draw, so it was stopped. The file is still here, and you can edit it." });
			void this.analyzeNow();
		};
		addEventListener("beforeunload", (e) => {
			if (this.dirty) {
				e.preventDefault();
			}
		});
		addEventListener("pagehide", () => {
			this.flushDraft();
		});
		addEventListener("popstate", () => {
			const a = readAddress(location.search, location.hash);
			this.set({ view: this.state.source === null && a.view === "work" ? "open" : a.view });
		});
		const { tab, inherited } = await claimTab();
		this.tab = tab;
		this.presence = new TabPresence(tab, () => ({ doc: this.docKey, dirty: this.dirty }));
		this.presence.onChange = (): void => {
			this.set({ sameInOtherTab: this.presence!.alsoOpen(this.docKey) });
		};
		const address = readAddress(location.search, location.hash);
		this.set({ view: address.view });
		if (address.badRef !== null) {
			this.set({ loadError: "This link doesn't say where a flag is in a way that can be read.", view: "work" });
			return;
		}
		const own = inherited ?? (await loadDraft(tab));
		if (address.ref !== null) {
			await this.openRef(address.ref, own);
		} else if (address.link !== null) {
			await this.openLink(address.link, own);
		} else if (own !== null && own.doc.startsWith("local:")) {
			this.adopt(own.text, { kind: own.source as Source["kind"], label: own.label }, own.doc, { base: own.base, eol: own.eol });
		} else {
			await this.retire(own);
			if (address.view === "work") {
				this.set({ view: "open" });
			}
		}
	}

	/** Keeps a draft of something else this tab has moved on from, so that it can be offered back. */
	private async retire(own: Draft | null): Promise<void> {
		if (own !== null && own.text !== own.base) {
			await saveDraft({ ...own, tab: `left-${own.tab}-${Date.now()}` });
		}
		if (own !== null) {
			await dropDraft(own.tab);
		}
	}

	async openRef(ref: Ref, own: Draft | null): Promise<void> {
		this.set({ loading: refLabel(ref), loadError: null });
		const key = refText(ref);
		try {
			const got = await fetchRef(ref);
			if ("choose" in got) {
				this.set({ loading: null, gistFiles: { id: (ref as Ref & { kind: "gist" }).id, files: got.choose } });
				return;
			}
			const realKey = refText(got.ref);
			const mine = own !== null && (own.doc === key || own.doc === realKey) ? own : null;
			if (mine === null) {
				await this.retire(own);
			}
			const kind = got.ref.kind;
			const source: Source = { kind, ref: got.ref, label: refLabel(got.ref) };
			this.adopt(got.text, source, realKey, mine !== null ? { draft: mine } : {});
			if (mine === null) {
				void orphanOf(realKey, this.tab).then((orphan) => {
					if (orphan !== null) {
						this.set({ orphan });
					}
				});
			}
			void this.lookUpTier(got.ref);
		} catch (e) {
			if (own !== null && own.doc === key && own.text !== own.base) {
				// Offline or rate-limited, but there's a draft of it here.
				this.adopt(own.text, { kind: ref.kind, ref, label: refLabel(ref) }, key, { base: own.base, eol: own.eol });
				this.set({ notice: `${(e as Error).message} Your draft is shown.` });
				return;
			}
			this.set({ loading: null, loadError: (e as Error).message });
		}
	}

	async openLink(link: string, own: Draft | null): Promise<void> {
		this.set({ loading: "the link", loadError: null });
		const done = await engine.ask({ kind: "shareDecode", link });
		if (done.text === undefined) {
			this.set({ loading: null, loadError: `This share link can't be read: ${done.error ?? "it isn't one"}. It may have been cut short when it was sent.` });
			return;
		}
		const key = `link:${link.slice(0, 64)}:${link.length}`;
		const mine = own !== null && own.doc === key ? own : null;
		if (mine === null) {
			await this.retire(own);
		}
		this.adopt(done.text, { kind: "link", label: "From a link" }, key, mine !== null ? { draft: mine } : {});
	}

	/** Opens text that has no address. */
	async openLocal(text: string, kind: "file" | "paste" | "new", label: string): Promise<void> {
		await this.retire(await loadDraft(this.tab));
		history.pushState(null, "", "?");
		this.adopt(text, { kind, label }, `local:${crypto.randomUUID?.() ?? Date.now()}`, {});
		this.set({ view: "work" });
		scrollTo(0, 0);
	}

	private adopt(text: string, source: Source, key: string, how: { draft?: Draft; base?: string; eol?: string }): void {
		const breaks = text.match(/\r\n|\r|\n/g) ?? [];
		const crlf = breaks.filter((b) => b === "\r\n").length;
		const allCrlf = breaks.length > 0 && crlf === breaks.length;
		const plain = text.replace(/\r\n?/g, "\n");
		const eol = how.eol ?? how.draft?.eol ?? (allCrlf ? "\r\n" : "\n");
		const base = how.base ?? plain;
		const shown = how.draft !== undefined ? how.draft.text : plain;
		this.docKey = key;
		this.docSeq++;
		for (const image of this.state.images.values()) {
			URL.revokeObjectURL(image.url);
		}
		this.set({
			loading: null, loadError: null, gistFiles: null, text: shown, base: how.draft !== undefined ? how.draft.base : base, eol,
			mixedEol: breaks.length > 0 && crlf > 0 && !allCrlf,
			source, analysis: null, analyzed: "", lawNoteDismissed: false, lastReadable: null, lastValid: null, selected: null, hover: null, form: "flag", padded: {}, foldStep: {}, images: new Map(),
			saved: shown === (how.draft?.base ?? base), orphan: null,
		});
		this.bridge?.setDoc(shown);
		this.presence?.tell();
		this.set({ sameInOtherTab: this.presence?.alsoOpen(key) ?? { tabs: 0, dirty: false } });
		this.scheduleDraft();
		void this.analyzeNow();
	}

	private async lookUpTier(ref: Ref): Promise<void> {
		if (ref.kind !== "github" || ref.repo !== "vexyl-flags" || !ref.path.startsWith("flags/")) {
			return;
		}
		try {
			const tiers = await evidenceTiers(ref.owner, ref.repo, ref.branch);
			const name = ref.path.slice(ref.path.lastIndexOf("/") + 1).replace(/\.kdl$/, "");
			this.set({ tier: tiers.get(name) ?? null });
		} catch {
			// Without the list, the file just doesn't say.
		}
	}

	restoreOrphan(): void {
		const o = this.state.orphan;
		if (o === null) {
			return;
		}
		void dropDraft(o.tab);
		this.set({ orphan: null });
		this.setText(o.text);
		this.bridge?.setDoc(o.text);
	}

	discardOrphan(): void {
		const o = this.state.orphan;
		if (o !== null) {
			void dropDraft(o.tab);
			this.set({ orphan: null });
		}
	}

	/** Takes what's typed in Source. */
	setText(text: string): void {
		if (text === this.state.text) {
			return;
		}
		this.set({ text, saved: text === this.state.base });
		this.presence?.tell();
		this.scheduleDraft();
		clearTimeout(this.analyzeTimer);
		this.analyzeTimer = setTimeout(() => {
			void this.analyzeNow();
		}, text.length > 256 * 1024 ? 450 : 120);
	}

	private scheduleDraft(): void {
		clearTimeout(this.draftTimer);
		this.draftTimer = setTimeout(() => {
			this.flushDraft();
		}, 400);
	}

	flushDraft(): void {
		clearTimeout(this.draftTimer);
		const s = this.state;
		if (s.source === null || this.tab === "") {
			return;
		}
		void saveDraft({ tab: this.tab, doc: this.docKey, text: s.text, base: s.base, updated: Date.now(), label: s.source.label, eol: s.eol, source: s.source.kind }).then(() => {
			if (s.storageNote !== !durable) {
				this.set({ storageNote: !durable });
			}
		});
	}

	/** Reads the document, and only ever one at a time, always ending on the latest. */
	async analyzeNow(): Promise<void> {
		if (this.analyzing) {
			this.analyzeAgain = true;
			return;
		}
		this.analyzing = true;
		this.set({ busy: true });
		const seq = this.docSeq;
		const text = this.state.text;
		try {
			const analysis = await engine.ask({ kind: "analyze", slot: "main", text });
			if (seq === this.docSeq && text === this.state.text) {
				this.set({
					analysis,
					analyzed: text,
					lastReadable: analysis.readable ? analysis : this.state.lastReadable,
					lastValid: analysis.valid ? analysis : this.state.lastValid,
				});
				document.title = `${this.displayName()} · vexyl`;
				if (analysis.readable) {
					this.follow(analysis.nodes);
				}
				if (analysis.valid) {
					void this.renderForms();
				}
			}
		} catch (e) {
			this.set({ notice: (e as Error).message });
		}
		this.analyzing = false;
		this.set({ busy: false });
		if (this.analyzeAgain || text !== this.state.text) {
			this.analyzeAgain = false;
			void this.analyzeNow();
		}
	}

	displayName(): string {
		const model = this.state.lastValid?.model;
		const meta = model?.["meta"] as { name?: string } | undefined;
		return meta?.name ?? this.state.source?.label ?? "vexyl";
	}

	/** Draws the form being looked at, then, when that's done, everything in the gallery. */
	async renderForms(): Promise<void> {
		const seq = ++this.renderSeq;
		const { form, padded, foldStep } = this.state;
		await this.renderOne(form, padded[form] === true, foldStep[form], seq, true);
		clearTimeout(this.thumbTimer);
		// Basic's strip waits until things are still, since a drag shouldn't wait for it.
		const wait = this.state.level === "basic" ? 700 : this.state.text.length > 256 * 1024 ? 900 : 60;
		this.thumbTimer = setTimeout(() => {
			void (async (): Promise<void> => {
				for (const item of galleryOf(this.state.lastValid?.model ?? null)) {
					if (seq !== this.renderSeq || this.state.gesturing) {
						return;
					}
					if (item.id !== form) {
						await this.renderOne(item.id, this.state.padded[item.id] === true, this.state.foldStep[item.id], seq, false);
					}
				}
			})();
		}, wait);
	}

	private async renderOne(id: string, padded: boolean, step: number | undefined, seq: number, pick: boolean): Promise<void> {
		const canPick = pick && !id.startsWith("fold:");
		let result: RenderResult;
		try {
			result = await engine.ask({ kind: "render", slot: "main", options: optionsFor(id, padded, step), pick: canPick });
		} catch (e) {
			this.set({ notice: (e as Error).message });
			return;
		}
		let refused: string | undefined;
		if (result.refused !== undefined) {
			refused = result.refused;
			if (id.startsWith("ratio:") || id.startsWith("variant:")) {
				// Shown faintly, as it would be if it were padded.
				result = await engine.ask({ kind: "render", slot: "main", options: optionsFor(id, true, undefined) });
			}
		}
		if (seq !== this.renderSeq && !pick) {
			return;
		}
		const images = new Map(this.state.images);
		const old = images.get(id);
		if (result.svg !== undefined) {
			const url = URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml" }));
			const image: FormImage = { url, width: result.width ?? 0, height: result.height ?? 0 };
			if (refused !== undefined) {
				image.refused = refused;
			}
			if (padded) {
				image.padded = true;
			}
			if (result.pick !== undefined) {
				image.pick = result.pick;
			} else if (old?.pick !== undefined && old.width === image.width && old.height === image.height && !pick) {
				image.pick = old.pick;
			}
			images.set(id, image);
			if (old !== undefined) {
				// Whatever's showing it has a moment to change over first.
				setTimeout(() => {
					URL.revokeObjectURL(old.url);
				}, 2000);
			}
		} else if (refused !== undefined) {
			images.set(id, { url: old?.url ?? "", refused, width: 0, height: 0 });
		}
		this.set({ images });
	}

	showForm(id: string): void {
		this.set({ form: id });
		const image = this.state.images.get(id);
		if (image === undefined || image.pick === undefined) {
			const seq = ++this.renderSeq;
			void this.renderOne(id, this.state.padded[id] === true, this.state.foldStep[id], seq, true).then(() => {
				if (seq === this.renderSeq) {
					this.renderSeq = seq;
				}
			});
		}
	}

	padForm(id: string): void {
		this.set({ padded: { ...this.state.padded, [id]: true } });
		void this.renderOne(id, true, undefined, ++this.renderSeq, true);
	}

	setFoldStep(id: string, step: number): void {
		this.set({ foldStep: { ...this.state.foldStep, [id]: step } });
		void this.renderOne(id, false, step, ++this.renderSeq, true);
	}

	select(path: string | null, jump = true): void {
		this.set({ selected: path });
		if (jump && path !== null && this.state.mode === "source") {
			this.jumpTo(path);
		}
	}

	hover(path: string | null): void {
		if (path !== this.state.hover) {
			this.set({ hover: path });
		}
	}

	spansFor(path: string): { line: number; endLine: number } | null {
		const nodes = this.state.analysis?.nodes ?? this.state.lastReadable?.nodes ?? [];
		return findPath(nodes, path);
	}

	jumpTo(path: string): void {
		const at = this.spansFor(path);
		if (at !== null) {
			this.set({ sourceJump: at.line });
			this.bridge?.scrollToLine(at.line);
		}
	}

	setMode(mode: "form" | "source"): void {
		this.set({ mode });
		if (mode === "source") {
			requestAnimationFrame(() => {
				const first = this.state.analysis?.problems.find((p) => p.line !== undefined);
				if (this.state.selected !== null) {
					this.jumpTo(this.state.selected);
				} else if (first?.line !== undefined) {
					// With nothing chosen, the first problem is what you've come to see.
					this.bridge?.scrollToLine(first.line);
				}
			});
		}
	}

	/** Called from Source, to carry where the cursor is back to Form. */
	selectAtLine(line: number): void {
		const spans: readonly Span[] = this.state.analysis?.spans ?? this.state.lastReadable?.spans ?? [];
		let best: Span | undefined;
		for (const s of spans) {
			if (line >= s.line && line <= s.endLine && (best === undefined || s.line >= best.line)) {
				best = s;
			}
		}
		if (best !== undefined && best.path !== "vexyl") {
			this.set({ selected: best.path });
		}
	}

	/** Changes the document through its format-preserving model, one change at a time. */
	edit(ops: Op[]): Promise<void> {
		return this.change(ops).then((error) => {
			if (error !== undefined) {
				this.set({ notice: error });
			}
		});
	}

	/** Makes a change, and says why not if it can't be made. */
	change(ops: Op[]): Promise<string | undefined> {
		const run = this.editing.then(async () => {
			const before = this.state.text;
			const done = await engine.ask({ kind: "edit", text: before, ops });
			if (done.text === undefined) {
				return done.error ?? "That change couldn't be made.";
			}
			if (done.text === before) {
				return undefined;
			}
			const [start, endA, endB] = firstDifference(before, done.text);
			if (this.gestureBase === null) {
				this.bridge?.replace(start, endA, done.text.slice(start, endB));
				this.setText(done.text);
			} else {
				this.setText(done.text);
				clearTimeout(this.analyzeTimer);
				void this.analyzeNow();
			}
			return undefined;
		});
		this.editing = run.then(() => undefined);
		return run;
	}

	/** Waits for every change asked for so far, such as one a box makes as it loses the focus, to be made. */
	settled(): Promise<void> {
		return this.editing;
	}

	/** Starts a drag. However many edits it sends, it's one thing to undo, and the last one always arrives. */
	startGesture(): Gesture {
		this.set({ gesturing: true, hover: null });
		const opened = this.editing.then(() => {
			this.gestureBase = this.state.text;
		});
		this.editing = opened;
		let latest: Op[] | null = null;
		let running: Promise<void> | null = null;
		let last = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const pump = (): void => {
			clearTimeout(timer);
			if (running !== null || latest === null) {
				return;
			}
			const wait = gestureGap - (Date.now() - last);
			if (wait > 0) {
				timer = setTimeout(pump, wait);
				return;
			}
			const ops = latest;
			latest = null;
			running = this.change(ops).then((error) => {
				running = null;
				last = Date.now();
				if (error !== undefined) {
					this.set({ notice: error });
				}
				pump();
			});
		};
		const end = async (keep: boolean): Promise<void> => {
			clearTimeout(timer);
			last = 0;
			if (!keep) {
				latest = null;
			}
			while (running !== null || latest !== null) {
				pump();
				await running;
			}
			const closed = this.editing.then(() => {
				const base = this.gestureBase;
				this.gestureBase = null;
				if (base === null) {
					return;
				}
				if (!keep) {
					this.setText(base);
				} else if (base !== this.state.text) {
					const [start, endA, endB] = firstDifference(base, this.state.text);
					this.bridge?.replace(start, endA, this.state.text.slice(start, endB), true);
				}
			});
			this.editing = closed;
			await closed;
			this.set({ gesturing: false });
		};
		return { push: (ops) => { latest = ops; pump(); }, finish: () => end(true), cancel: () => end(false) };
	}

	/** Switches editors, which only changes what's on screen, and remembers it for next time. */
	setLevel(level: Level): void {
		try {
			globalThis.localStorage.setItem(levelKey, level);
		} catch {
			// It just won't be remembered.
		}
		this.set({ level, ...(level === "basic" ? { form: "flag" } : {}) });
		if (this.state.analysis?.valid === true) {
			void this.renderForms();
		}
	}

	/** Changes how construction sheets are drawn, and remembers it for next time. */
	setSheet(patch: Partial<SheetPrefs>): void {
		const sheet = { ...this.state.sheet, ...patch };
		saveSheet(sheet);
		this.set({ sheet });
	}

	/** Changes how pictures are downloaded, and remembers it for next time. */
	setPicture(patch: Partial<PicturePrefs>): void {
		const picture = { ...this.state.picture, ...patch };
		savePicture(picture);
		this.set({ picture });
	}

	/** Goes straight to a part in Advanced. */
	editInAdvanced(path: string | null): void {
		this.setLevel("advanced");
		this.set({ mode: "form", selected: path });
	}

	/** Makes a change, then moves the panel and the big view to what it made, once that's been read. */
	async changeAndFollow(ops: Op[], to: { path: string } | { at: readonly number[] }): Promise<string | undefined> {
		const from = this.state.selected;
		const before = this.state.text;
		const error = await this.change(ops);
		if (error === undefined && this.state.text !== before) {
			this.following = { from, to };
		}
		return error;
	}

	private follow(nodes: readonly ONode[]): void {
		const f = this.following;
		this.following = null;
		if (f === null || this.state.selected !== f.from) {
			return;
		}
		let path: string | undefined;
		if ("path" in f.to) {
			path = f.to.path;
		} else {
			let list = nodes;
			let node: ONode | undefined;
			for (const i of f.to.at) {
				node = list[i];
				list = node?.kids ?? [];
			}
			path = node?.path;
		}
		if (path === undefined) {
			return;
		}
		const formOf = (p: string | null): string | null => {
			const m = p === null ? null : /^(variant|fold)\/([^/]*)$/.exec(p);
			return m === null ? null : `${m[1]}:${decodePathName(m[2]!)}`;
		};
		const was = formOf(f.from);
		const now = formOf(path);
		// Something just added is what's wanted in the big view, as is something renamed that's there.
		const showIt = now !== null && ("path" in f.to || this.state.form === was);
		this.set({ selected: path, ...(showIt ? { form: now } : {}) });
	}

	/** The document as it should be written out, with its own line endings. */
	exportText(): string {
		return this.state.eol === "\n" ? this.state.text : this.state.text.replaceAll("\n", this.state.eol);
	}

	markSaved(): void {
		this.set({ saved: true });
		this.presence?.tell();
	}

	problemsFor(): Problem[] {
		return this.state.analysis?.problems ?? [];
	}
}

export const app = new App();
