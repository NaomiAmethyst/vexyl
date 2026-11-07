// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { useState, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { parentPath } from "vexyl/paths";
import { refLabel, refText } from "./address.js";
import { download, FileLink, fileStem, licenseName, Logo, MenuButton, Seg, Spinner, useApp, useAck } from "./common.js";
import { engine } from "./engine.js";
import { BasicEditor } from "./basic.js";
import { Form } from "./form.js";
import { Handles } from "./handles.js";
import type { PickNode } from "./protocol.js";
import { redoInSource, refreshSource, SourceEditor, syncSource, undoInSource } from "./source.js";
import { plainFormLabel, plainFormText } from "./plain.js";
import { app, findPath, galleryOf, optionsFor, type FormImage, type GalleryItem, type Level, type View } from "./store.js";

const svgNs = "http://www.w3.org/2000/svg";
const tagAttr = "data-vexyl-layer";

/** Builds what's under a click from the worker's plain description. It's only numbers and paths, and it's never parsed as markup. */
function buildPick(node: PickNode): SVGElement {
	const el = document.createElementNS(svgNs, node.n);
	for (const [k, v] of node.a) {
		el.setAttribute(k, v);
	}
	for (const c of node.c ?? []) {
		el.append(buildPick(c));
	}
	return el;
}

/** Every drawn element for a path, or for anything inside it. */
function shapesOf(root: SVGElement, path: string): SVGGraphicsElement[] {
	const all = root.querySelectorAll<SVGGraphicsElement>(`[${tagAttr}]`);
	const prefix = path + ".";
	const out: SVGGraphicsElement[] = [];
	for (const el of all) {
		const tag = el.getAttribute(tagAttr)!;
		if (tag === path || tag.startsWith(prefix)) {
			out.push(el);
		}
	}
	return out;
}

const mostOutlined = 3000;

function drawOutlines(layer: SVGGElement, root: SVGSVGElement, path: string | null, kind: "hover" | "selected"): void {
	layer.replaceChildren();
	if (path === null) {
		return;
	}
	const inverse = root.getScreenCTM()?.inverse();
	const shapes = shapesOf(root, path).slice(0, mostOutlined);
	if (inverse === undefined || shapes.length === 0) {
		return;
	}
	const mask = document.createElementNS(svgNs, "mask");
	mask.id = `vx-dim-${kind}`;
	const vb = root.viewBox.baseVal;
	const full = (el: SVGElement, fill: string): void => {
		el.setAttribute("x", String(vb.x));
		el.setAttribute("y", String(vb.y));
		el.setAttribute("width", String(vb.width));
		el.setAttribute("height", String(vb.height));
		el.setAttribute("fill", fill);
	};
	const white = document.createElementNS(svgNs, "rect");
	full(white, "#fff");
	mask.setAttribute("maskUnits", "userSpaceOnUse");
	mask.setAttribute("x", String(vb.x));
	mask.setAttribute("y", String(vb.y));
	mask.setAttribute("width", String(vb.width));
	mask.setAttribute("height", String(vb.height));
	mask.append(white);
	const outer = document.createElementNS(svgNs, "g");
	const inner = document.createElementNS(svgNs, "g");
	outer.setAttribute("class", `outline-${kind}-outer`);
	inner.setAttribute("class", `outline-${kind}-inner`);
	for (const el of shapes) {
		const ctm = el.getScreenCTM();
		if (ctm === null) {
			continue;
		}
		const m = inverse.multiply(ctm);
		const transform = `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;
		for (const target of [outer, inner]) {
			const copy = el.cloneNode(false) as SVGElement;
			copy.removeAttribute("id");
			copy.removeAttribute("clip-path");
			copy.removeAttribute(tagAttr);
			copy.setAttribute("transform", transform);
			copy.setAttribute("fill", "none");
			copy.removeAttribute("stroke");
			copy.removeAttribute("stroke-width");
			target.append(copy);
		}
		const hole = el.cloneNode(false) as SVGElement;
		hole.removeAttribute("id");
		hole.removeAttribute("clip-path");
		hole.removeAttribute(tagAttr);
		hole.setAttribute("transform", transform);
		hole.setAttribute("fill", "#000");
		mask.append(hole);
	}
	if (kind === "selected") {
		const dim = document.createElementNS(svgNs, "rect");
		full(dim, "#09080c");
		dim.setAttribute("class", "outline-dim");
		dim.setAttribute("mask", `url(#vx-dim-${kind})`);
		layer.append(mask, dim);
	}
	layer.append(outer, inner);
}

/** The flag, and over it, what can't be seen but knows what's under a click. */
function FlagStage(props: { image: FormImage; alt: string; dimmed: boolean; handles: boolean }): preact.JSX.Element {
	const { image, alt } = props;
	const [s] = useApp();
	const pickHost = useRef<HTMLDivElement>(null);
	const overlay = useRef<SVGSVGElement>(null);
	const hoverLayer = useRef<SVGGElement>(null);
	const selectLayer = useRef<SVGGElement>(null);
	const pickRoot = useRef<SVGSVGElement | null>(null);
	const pointerAt = useRef<{ x: number; y: number } | null>(null);
	useLayoutEffect(() => {
		const host = pickHost.current;
		if (host === null) {
			return;
		}
		host.replaceChildren();
		pickRoot.current = null;
		if (image.pick !== undefined) {
			const root = buildPick(image.pick) as SVGSVGElement;
			root.setAttribute("class", "pick-tree");
			root.setAttribute("aria-hidden", "true");
			root.removeAttribute("width");
			root.removeAttribute("height");
			host.append(root);
			pickRoot.current = root;
			const vb = root.getAttribute("viewBox");
			if (vb !== null) {
				overlay.current?.setAttribute("viewBox", vb);
			}
		}
	}, [image.pick]);
	// What's chosen only shows for a moment, which is all a tap gets. After that it takes hovering.
	const [flash, setFlash] = useState<string | null>(null);
	useEffect(() => {
		setFlash(s.selected);
		if (s.selected === null) {
			return undefined;
		}
		const timer = setTimeout(() => { setFlash(null); }, 1200);
		return () => { clearTimeout(timer); };
	}, [s.selected]);
	useEffect(() => {
		const root = pickRoot.current;
		if (root === null || hoverLayer.current === null || selectLayer.current === null) {
			return;
		}
		// While something's being dragged, these would be of where it was.
		drawOutlines(selectLayer.current, root, s.gesturing ? null : flash, "selected");
		drawOutlines(hoverLayer.current, root, s.gesturing || s.hover === flash ? null : s.hover, "hover");
	}, [image.pick, flash, s.hover, s.gesturing]);
	/** What's under a point, deepest first, each with the layers that hold it. */
	const stackAt = (x: number, y: number): string[] => {
		const out: string[] = [];
		for (const el of document.elementsFromPoint(x, y)) {
			if (pickRoot.current?.contains(el) !== true) {
				continue;
			}
			const tag = el.closest(`[${tagAttr}]`)?.getAttribute(tagAttr);
			if (tag !== undefined && tag !== null) {
				let path: string | undefined = tag;
				while (path !== undefined) {
					if (!out.includes(path)) {
						out.push(path);
					}
					path = parentPath(path);
				}
			}
		}
		return out;
	};
	/** A panel's own first field is one of its properties, so it selects the panel. */
	const normalize = (stack: string[]): string[] => {
		const nodes = app.state.analysis?.nodes ?? [];
		return stack.map((p) => {
			const parent = parentPath(p);
			if (parent === undefined) {
				return p;
			}
			const holder = findPath(nodes, parent);
			const first = holder?.kids.find((k) => k.path !== undefined);
			return (holder?.name === "canton" || holder?.name === "panel") && first?.path === p && first.name === "field" ? parent : p;
		}).filter((p, i, list) => list.indexOf(p) === i);
	};
	const click = (e: MouseEvent): void => {
		const stack = normalize(stackAt(e.clientX, e.clientY));
		if (stack.length === 0) {
			return;
		}
		if (app.state.level === "basic") {
			// In Basic, a click is always on the deepest thing, so clicking what's selected again keeps its handles.
			app.select(stack[0]!);
			return;
		}
		const current = app.state.selected;
		const i = current === null ? -1 : stack.indexOf(current);
		// The deepest first, and again steps out, to what's beneath once nothing holds it, and round again.
		app.select(i < 0 ? stack[0]! : stack[(i + 1) % stack.length]!);
	};
	const move = (e: MouseEvent): void => {
		pointerAt.current = { x: e.clientX, y: e.clientY };
		if (s.gesturing) {
			return;
		}
		const stack = normalize(stackAt(e.clientX, e.clientY));
		app.hover(stack[0] ?? null);
	};
	const leave = (): void => {
		pointerAt.current = null;
		app.hover(null);
	};
	const ratio = image.width > 0 && image.height > 0 ? image.width / image.height : 1.5;
	return (
		<div class={`stage${props.dimmed ? " dimmed" : ""}`} style={{ aspectRatio: String(ratio) }} onClick={image.pick !== undefined ? click : undefined} onMouseMove={image.pick !== undefined ? move : undefined} onMouseLeave={leave}>
			<img class="stage-image" src={image.url} alt={alt} draggable={false} />
			<div class="pick" ref={pickHost} />
			<svg class="outlines" ref={overlay} aria-hidden="true" xmlns={svgNs} preserveAspectRatio="xMidYMid meet">
				<g ref={selectLayer} />
				<g ref={hoverLayer} />
			</svg>
			{props.handles && image.pick !== undefined ? <Handles image={image} nodes={s.analysis?.nodes ?? []} stackAt={(x, y) => normalize(stackAt(x, y))} /> : null}
		</div>
	);
}

function labelOf(id: string, items: readonly GalleryItem[], padded: boolean): string {
	if (id === "flag") {
		return "Obverse";
	}
	if (id === "reverse") {
		return items.find((i) => i.id === id)?.sub === "Mirrored" ? "Reverse, mirrored as flags are" : "Reverse, drawn on its own";
	}
	if (id.startsWith("variant:")) {
		return `${items.find((i) => i.id === id)?.label ?? ""} variant`;
	}
	if (id.startsWith("fold:")) {
		return `Folded: ${id.slice(5)}`;
	}
	return (items.find((i) => i.id === id)?.label ?? "") + (padded ? ", padded" : "");
}

/** Basic's small row of the flag's other forms, from the same pictures as Advanced's gallery. */
function FormStrip(props: { items: readonly GalleryItem[] }): preact.JSX.Element | null {
	const [s] = useApp();
	if (props.items.length < 2) {
		return null;
	}
	return (
		<div class="form-strip" role="group" aria-labelledby="form-strip-title">
			<span class="nx-label" id="form-strip-title">Other forms</span>
			<div class="thumbs strip">
				{props.items.map((t) => {
					const image = s.images.get(t.id);
					const refused = image?.refused !== undefined && s.padded[t.id] !== true;
					return (
						<button key={t.id} type="button" class={`thumb${s.form === t.id ? " on" : ""}`} aria-pressed={s.form === t.id ? "true" : "false"} data-form={t.id} onClick={() => { app.showForm(t.id); }}>
							<span class="check thumb-box">{image?.url ? <img src={image.url} alt="" class={refused ? "faint" : ""} /> : <span class="bone bone-thumb" aria-hidden="true" />}</span>
							<span class="thumb-label">{plainFormLabel(t)}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

/** Where the columns stack, so that the big view can scroll out of sight. */
const stacked = "(max-width: 1099px)";

/**
 * A small copy of the flag in a corner, while the big one is scrolled out of sight on a narrow
 * screen, so a change can still be seen as it's made. Tapping it goes back to the big one.
 */
function FloatingFlag(): preact.JSX.Element | null {
	const [s] = useApp();
	const [away, setAway] = useState(false);
	// The big view can come and go, as a file loads or the view changes, so this follows whichever there is.
	const big = document.querySelector(".big-view");
	useEffect(() => {
		if (big === null || typeof IntersectionObserver === "undefined") {
			setAway(false);
			return undefined;
		}
		const narrow = matchMedia(stacked);
		let seen = true;
		const update = (): void => { setAway(!seen && narrow.matches); };
		const watch = new IntersectionObserver((entries) => {
			seen = entries.some((e) => e.isIntersecting);
			update();
		});
		watch.observe(big);
		narrow.addEventListener("change", update);
		return () => {
			watch.disconnect();
			narrow.removeEventListener("change", update);
		};
	}, [big]);
	const image = s.images.get(s.form);
	if (!away || image === undefined || image.url === "" || image.refused !== undefined) {
		return null;
	}
	return (
		<button type="button" class="floating-flag" aria-label="Back to the flag" onClick={() => {
			const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
			document.querySelector(".big-view")?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
		}}>
			<img src={image.url} alt="" draggable={false} />
		</button>
	);
}

function BigView(): preact.JSX.Element {
	const [s] = useApp();
	const model = s.lastValid?.model ?? null;
	const items = galleryOf(model);
	const name = app.displayName();
	const basic = s.level === "basic";
	const image = s.images.get(s.form);
	const invalid = s.analysis !== null && !s.analysis.valid;
	const isFold = s.form.startsWith("fold:");
	const refused = image?.refused !== undefined && s.padded[s.form] !== true && !isFold;
	const padded = s.padded[s.form] === true;
	const folds = (model?.["fold"] ?? {}) as Record<string, { steps?: unknown[] }>;
	const steps = isFold ? (folds[s.form.slice(5)]?.steps?.length ?? 1) : 0;
	const step = s.foldStep[s.form] ?? steps;
	const elsewhere = basic && s.form !== "flag";
	const hint = elsewhere ? "" : basic && !invalid ? "Click anything on the flag to change it. Drag it to move or resize it." : invalid ? "Last good render. It stays here until the file is valid again." : refused ? "" : isFold ? "Parts can be selected on the flat flag." : padded ? "Padding keeps the true shape, and the rest is transparent." : "Click any part of the flag to edit it. Click again to step out to what holds it.";
	const alt = `${name}, ${labelOf(s.form, items, padded).toLowerCase()}, as drawn from its file`;
	const refusalText = image?.refused !== undefined && model !== null && !Object.hasOwn(model, "adapt") ? `${name} doesn't say how it adapts to other proportions, so it won't be stretched to fit.` : `${image?.refused ?? ""} It won't be stretched to fit.`;
	return (
		<section class="card big-view" aria-label="Big view" style={image !== undefined && image.width > 0 && image.height > 0 ? { "--flag-ratio": String(image.width / image.height) } : undefined}>
			<div class="title-row">
				<h1 class="flag-name">{name}</h1>
				{basic ? null : <span class="nx-muted">{labelOf(s.form, items, padded)}</span>}
				{s.busy && !s.gesturing ? <Spinner label="Drawing" /> : null}
			</div>
			<div class="check stage-box">
				{image === undefined ? <span class="bone bone-flag" aria-hidden="true" /> : refused ? (
					<div class="refusal">
						<p class="nx-callout warn"><span>{refusalText}</span></p>
						{image?.url ? <button type="button" class="nx-ghost" onClick={() => { app.padForm(s.form); }}>Pad with transparency</button> : null}
					</div>
				) : <FlagStage image={image} alt={alt} dimmed={invalid} handles={basic && !invalid && s.form === "flag" && s.mode === "form" && s.basicTab === "design"} />}
			</div>
			<div class="under-stage">
				{isFold && steps > 1 ? (
					<label class="fold-step">
						<span class="nx-label">Fold step</span>
						<input type="range" min="1" max={steps} value={step} aria-label="Fold step" aria-valuetext={step === steps ? "Finished" : `Step ${step} of ${steps}`} onInput={(e) => { app.setFoldStep(s.form, Number((e.currentTarget as HTMLInputElement).value)); }} />
						<span class="fold-step-label">{step === steps ? "Finished" : `Step ${step} of ${steps}`}</span>
					</label>
				) : null}
				{hint !== "" ? <span class="nx-note">{hint}</span> : null}
				{elsewhere ? (
					<p class="nx-callout form-note">
						<span>This is {plainFormText(items.find((i) => i.id === s.form) ?? { id: s.form, label: "" })}. It changes along with the flag, but only the flag itself has handles to drag.</span>
						<button type="button" class="nx-ghost small" onClick={() => { app.showForm("flag"); }}>Show the flag itself</button>
					</p>
				) : null}
			</div>
			{basic ? <FormStrip items={items} /> : null}
		</section>
	);
}

function SmallSizes(): preact.JSX.Element {
	const [s] = useApp();
	const image = s.images.get(s.form);
	const url = image?.url;
	const name = app.displayName();
	return (
		<section class="card" aria-label="At small sizes">
			<span class="nx-label">At small sizes</span>
			<div class="smalls">
				{[64, 32, 24, 16].map((px) => (
					<figure key={px}>
						{url !== undefined && url !== "" ? <img src={url} alt={`${name} at ${px} pixels high`} class={`small-${px}`} /> : <span class={`bone small-${px} bone-small`} aria-hidden="true" />}
						<figcaption>{px} px</figcaption>
					</figure>
				))}
			</div>
		</section>
	);
}

function Gallery(): preact.JSX.Element {
	const [s] = useApp();
	const items = galleryOf(s.lastValid?.model ?? null);
	const groups = (["Forms", "Proportions", "Folds"] as const).map((g) => ({ g, list: items.filter((i) => i.group === g) })).filter((x) => x.list.length > 0);
	return (
		<section class="card" aria-label="Every form of this flag">
			{groups.map(({ g, list }) => (
				<div class="gallery-group" key={g}>
					<span class="nx-label">{g}</span>
					<div class="thumbs">
						{list.map((t) => {
							const image = s.images.get(t.id);
							const refused = image?.refused !== undefined && s.padded[t.id] !== true;
							const sub = t.group === "Proportions" ? (s.padded[t.id] === true ? "Padded" : refused ? "Needs padding" : image !== undefined ? "Adapts" : "") : t.sub;
							return (
								<button key={t.id} type="button" class={`thumb${s.form === t.id ? " on" : ""}`} aria-pressed={s.form === t.id ? "true" : "false"} data-form={t.id} onClick={() => { app.showForm(t.id); }}>
									<span class="check thumb-box">{image?.url ? <img src={image.url} alt="" class={refused ? "faint" : ""} /> : <span class="bone bone-thumb" aria-hidden="true" />}</span>
									<span class="thumb-label">{t.label}</span>
									<span class="thumb-sub">{sub}</span>
								</button>
							);
						})}
					</div>
				</div>
			))}
		</section>
	);
}

function About(): preact.JSX.Element {
	const [s] = useApp();
	const nodes = s.analysis?.readable === true ? s.analysis.nodes : s.lastReadable?.nodes ?? [];
	const meta = nodes.find((n) => n.name === "meta");
	const values = (name: string): string[] => (meta?.kids ?? []).filter((k) => k.name === name).map((k) => String(k.args[0]?.v ?? ""));
	const one = (name: string): string | undefined => values(name)[0];
	const license = one("license");
	const render = one("render-license");
	const laws = (meta?.kids ?? []).filter((k) => k.name === "law");
	const restrictions = (meta?.kids ?? []).filter((k) => k.name === "restriction");
	const adapted = (meta?.kids ?? []).filter((k) => k.name === "adapted-from");
	const description = one("description");
	const notes = values("note");
	const tier = s.tier;
	return (
		<section class="card" aria-label="About this file">
			<span class="nx-label">About this file</span>
			{description !== undefined ? <p class="plain">{description}</p> : null}
			{laws.length > 0 ? (
				<div class="about-list">
					<span class="about-head">{laws.length === 1 ? "Law" : "Laws"}</span>
					<ul>
						{laws.map((l, i) => {
							const src = l.kids.find((k) => k.name === "source")?.args[0]?.v;
							return <li key={i}>{typeof src === "string" ? <FileLink href={src}>{String(l.args[0]?.v)}</FileLink> : String(l.args[0]?.v)}</li>;
						})}
					</ul>
				</div>
			) : null}
			{restrictions.length > 0 ? (
				<div class="about-list">
					<span class="about-head">{restrictions.length === 1 ? "Restriction" : "Restrictions"}</span>
					<ul>
						{restrictions.map((l, i) => {
							const src = l.kids.find((k) => k.name === "source")?.args[0]?.v;
							return <li key={i}>{typeof src === "string" ? <FileLink href={src}>{String(l.args[0]?.v)}</FileLink> : String(l.args[0]?.v)}</li>;
						})}
					</ul>
				</div>
			) : null}
			{notes.length > 0 ? <p class="plain">{notes[0]}</p> : null}
			{adapted.length > 0 ? <p class="nx-note">Adapted from {adapted.map((a, i) => <span key={i}>{i > 0 ? ", " : ""}<FileLink href={String(a.args[0]?.v ?? "")}>{a.kids.find((k) => k.name === "author")?.args[0]?.v as string ?? "a work"}</FileLink></span>)}.</p> : null}
			<div class="chips">
				{tier !== null ? <span class="nx-chip" title="Its evidence tier, from evidence.tsv">{tier === "C" ? "No law read, tier C" : `Law read, tier ${tier}`}</span> : null}
				{license !== undefined ? <span class="nx-chip">File: {licenseName(license)}</span> : null}
				{render !== undefined ? <span class="nx-chip">Renders: {licenseName(render)}</span> : null}
				{license === undefined && render === undefined ? <span class="nx-chip">No license given</span> : null}
			</div>
			{s.source?.ref !== undefined ? <p class="nx-note mono about-from">{refText(s.source.ref)}</p> : null}
		</section>
	);
}

/** A menu's choice, as a row. */
function MenuItem(props: { onPick: () => void; disabled?: boolean; title?: string; children: preact.ComponentChildren }): preact.JSX.Element {
	return (
		<button type="button" role="menuitem" tabIndex={-1} class="row compact menu-item" aria-disabled={props.disabled === true ? "true" : undefined} title={props.title} onClick={() => {
			if (props.disabled !== true) {
				props.onPick();
			}
		}}>{props.children}</button>
	);
}

/** A menu's choice that goes to another view, as a real link. */
function MenuLink(props: { view: View; close: () => void; children: preact.ComponentChildren }): preact.JSX.Element {
	return <a role="menuitem" tabIndex={-1} class="row compact menu-item" href={app.href(props.view)} onClick={(e) => { if (plain(e)) { e.preventDefault(); props.close(); app.go(props.view); } }}>{props.children}</a>;
}

/** The one download button, which asks which of the two is wanted, in each editor's own words. */
function DownloadMenu(props: { basic: boolean; picture: () => Promise<void>; file: () => void; paused: boolean; pausedNote?: string }): preact.JSX.Element {
	const { basic } = props;
	return (
		<MenuButton label="Download" menuLabel="What to download" buttonClass="nx-btn">
			{(close) => (
				<>
					<MenuItem disabled={props.paused} {...(props.pausedNote !== undefined ? { title: props.pausedNote } : {})} onPick={() => { close(); void props.picture(); }}>{basic ? "A picture of the flag" : "SVG image"}</MenuItem>
					<MenuItem onPick={() => { close(); props.file(); }}>{basic ? "The flag's file, to keep working on" : "KDL file"}</MenuItem>
				</>
			)}
		</MenuButton>
	);
}

export function Header(): preact.JSX.Element {
	const [s] = useApp();
	const problems = s.analysis?.problems.length ?? 0;
	const paused = s.analysis !== null && !s.analysis.valid;
	const [ack, setAck] = useAck();
	const basic = s.level === "basic";
	const stem = fileStem(s.source?.ref !== undefined ? refLabel(s.source.ref).replace(/\.kdl$/, "") : app.displayName());
	const downloadSvg = async (): Promise<void> => {
		const result = await engine.ask({ kind: "render", slot: "main", options: optionsFor(s.form, s.padded[s.form] === true, s.foldStep[s.form]), exact: true });
		if (result.svg !== undefined) {
			download(`${stem}.svg`, result.svg, "image/svg+xml");
			setAck("Downloaded the SVG.");
		} else {
			setAck(result.refused ?? "That can't be drawn.");
		}
	};
	const downloadKdl = (): void => {
		download(`${stem}.kdl`, app.exportText(), "text/plain");
		app.markSaved();
		setAck(basic ? "Downloaded the flag's file." : "Downloaded the KDL.");
	};
	return (
		<header class={`topbar${basic ? " basic" : ""}`}>
			<Logo />
			<span class={`topbar-name ${basic ? "nx-muted flag-title" : "file-name"}`}><span class="topbar-name-text">{basic ? app.displayName() : s.source?.label ?? ""}</span>{app.dirty ? <span class="dirty"> · edited</span> : null}</span>
			<span class="grow" />
			<span class="visually-hidden" role="status">{ack}</span>
			{ack !== "" ? <span class="nx-note topbar-ack" aria-hidden="true">{ack}</span> : null}
			{s.analysis !== null && (!basic || problems > 0) ? (
				<span class={`status ${problems > 0 ? "bad" : "good"}`}>
					<span class="status-dot" aria-hidden="true" />{problems > 0 ? `${problems} ${problems === 1 ? "problem" : "problems"}` : "Valid"}
				</span>
			) : null}
			<div class="topbar-wide">
				<Seg label="Editor" value={s.level} options={[["basic", "Basic"], ["advanced", "Advanced"]]} onPick={(v) => { app.setLevel(v as Level); }} />
				<button type="button" class="nx-ghost" onClick={() => { app.go("new"); }}>New flag</button>
				<a class="nx-ghost" href={app.href("open")} onClick={(e) => { if (plain(e)) { e.preventDefault(); app.go("open"); } }}>Open a flag</a>
				{basic ? null : <a class="nx-ghost" href={app.href("compare")} onClick={(e) => { if (plain(e)) { e.preventDefault(); app.go("compare"); } }}>Compare</a>}
				<a class="nx-ghost" href={app.href("share")} onClick={(e) => { if (plain(e)) { e.preventDefault(); app.go("share"); } }}>Share</a>
			</div>
			<DownloadMenu basic={basic} picture={downloadSvg} file={downloadKdl} paused={paused || s.analysis === null} {...(paused ? { pausedNote: "Paused until the file is valid again" } : {})} />
			<MenuButton class="topbar-narrow" label="Menu" menuLabel="Menu" buttonClass="nx-ghost">
				{(close) => (
					<>
						<MenuItem onPick={() => { close(); app.go("new"); }}>New flag</MenuItem>
						<MenuLink view="open" close={close}>Open a flag</MenuLink>
						<MenuLink view="share" close={close}>Share</MenuLink>
						{basic ? null : <MenuLink view="compare" close={close}>Compare</MenuLink>}
						<div role="separator" class="menu-rule" />
						<div role="group" aria-label="Editor" class="menu-group">
							{([["basic", "Basic"], ["advanced", "Advanced"]] as const).map(([value, label]) => (
								<button key={value} type="button" role="menuitemradio" tabIndex={-1} class="row compact menu-item" aria-checked={s.level === value ? "true" : "false"} onClick={() => { close(); app.setLevel(value); }}>
									<span class="menu-check" aria-hidden="true">{s.level === value ? "✓" : ""}</span>{label}
								</button>
							))}
						</div>
					</>
				)}
			</MenuButton>
		</header>
	);
}

export const plain = (e: MouseEvent): boolean => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

function Notices(): preact.JSX.Element | null {
	const [s] = useApp();
	const also = s.sameInOtherTab;
	const list: preact.JSX.Element[] = [];
	if (s.orphan !== null) {
		list.push(
			<p class="nx-callout notice" key="orphan">
				<span>There's an unsaved draft of this flag from {new Date(s.orphan.updated).toLocaleString()}, left by a tab that's closed.</span>
				<button type="button" class="nx-ghost small" onClick={() => { app.restoreOrphan(); }}>Restore it</button>
				<button type="button" class="nx-link quiet" onClick={() => { app.discardOrphan(); }}>Discard</button>
			</p>,
		);
	}
	if (also.tabs > 0) {
		list.push(<p class="nx-callout notice" key="tabs"><span>This flag is also open in another tab{also.dirty ? ", with changes" : ""}. Each tab keeps its own draft, so neither overwrites the other.</span></p>);
	}
	if (s.level === "basic" && !s.lawNoteDismissed && (s.analysis?.nodes ?? []).find((n) => n.name === "meta")?.kids.some((k) => k.name === "law") === true) {
		list.push(
			<p class="nx-callout notice" key="law">
				<span>This flag is written from a law. Advanced has its exact numbers and its own words, if that's what you're after.</span>
				<button type="button" class="nx-ghost small" onClick={() => { app.setLevel("advanced"); }}>Switch to Advanced</button>
				<button type="button" class="nx-link quiet" onClick={() => { app.set({ lawNoteDismissed: true }); }}>Dismiss</button>
			</p>,
		);
	}
	if (s.mixedEol) {
		list.push(<p class="nx-callout notice warn" key="eol"><span>This file mixes line endings. They're shown as one kind here, and it's written back with LF.</span></p>);
	}
	if (s.storageNote) {
		list.push(<p class="nx-callout notice warn" key="storage"><span>This browser isn't letting the page keep anything, so your draft will only last as long as this tab. Download it to keep it.</span></p>);
	}
	if (s.notice !== null) {
		list.push(
			<p class="nx-callout notice warn" key="notice" role="alert">
				<span>{s.notice}</span>
				<button type="button" class="nx-link quiet" onClick={() => { app.set({ notice: null }); }}>Dismiss</button>
			</p>,
		);
	}
	return list.length > 0 ? <section class="notices" aria-label="Notices">{list}</section> : null;
}

/**
 * Undo and Redo, through the one history that Ctrl+Z goes through, whichever editor made the change.
 * They stay where the keyboard can reach them even when there's nothing to do, and say so.
 */
function UndoRedo(props: { where: "in-bar" | "floating" }): preact.JSX.Element {
	const [s] = useApp();
	const step = (redo: boolean): void => {
		// A box that was being typed in makes its change as it loses the focus, and that's what's undone.
		void app.settled().then(() => {
			if (!app.state.gesturing) {
				void (redo ? redoInSource() : undoInSource());
			}
		});
	};
	const noUndo = !s.canUndo || s.gesturing;
	const noRedo = !s.canRedo || s.gesturing;
	// The one at the bottom of a narrow screen is outside the page's main part, so it's a landmark of its own.
	const Box = props.where === "floating" ? "section" : "div";
	return (
		<Box class={`undo-redo ${props.where}`} role={props.where === "floating" ? undefined : "group"} aria-label="Undo and redo">
			<button type="button" class="nx-ghost small" aria-label="Undo" aria-disabled={noUndo ? "true" : undefined} aria-keyshortcuts="Control+Z" title={noUndo ? "Nothing to undo" : "Undo (Ctrl+Z)"} onClick={() => { step(false); }}><span aria-hidden="true">↶</span><span class="undo-word" aria-hidden="true">Undo</span></button>
			<button type="button" class="nx-ghost small" aria-label="Redo" aria-disabled={noRedo ? "true" : undefined} aria-keyshortcuts="Control+Shift+Z" title={noRedo ? "Nothing to redo" : "Redo (Ctrl+Shift+Z)"} onClick={() => { step(true); }}><span aria-hidden="true">↷</span><span class="undo-word" aria-hidden="true">Redo</span></button>
		</Box>
	);
}

export function Workspace(): preact.JSX.Element {
	const [s] = useApp();
	// Keep Source's marks in step with everything else.
	useEffect(() => {
		const nodes = s.analysis?.readable === true ? s.analysis.nodes : s.lastReadable?.nodes ?? [];
		const span = (path: string | null): { from: number; to: number } | null => {
			if (path === null) {
				return null;
			}
			const n = findPath(nodes, path);
			return n === null ? null : { from: n.start, to: n.end };
		};
		syncSource(s.analysis?.problems ?? [], span(s.selected), span(s.hover));
	}, [s.analysis, s.selected, s.hover, s.lastReadable]);
	useEffect(refreshSource, [s.mode, s.level]);
	const basic = s.level === "basic";
	// Both editors keep the one Source, in the same place, so that switching doesn't lose what can be undone.
	return (
		<>
			<Header />
			<Notices />
			<main class={`work${basic ? " basic" : ""}`}>
				<div class="column">
					<section class="card editor" aria-label="Editor">
						<div class="editor-bar">
							{basic ? (
								<Seg label="What to work on" value={s.mode === "source" ? "source" : s.basicTab} options={[["design", "Design"], ["details", "Details"], ["source", "Source"]]} onPick={(v) => {
									if (v === "source") {
										app.setMode("source");
									} else {
										app.set({ basicTab: v as "design" | "details" });
										app.setMode("form");
									}
								}} />
							) : <Seg label="Edit as" value={s.mode} options={[["form", "Form"], ["source", "Source"]]} onPick={(v) => { app.setMode(v as "form" | "source"); }} />}
							<span class="grow" />
							{basic ? <UndoRedo where="in-bar" /> : null}
							{s.mode === "source" || !basic ? <span class="nx-note editor-hint">{s.mode === "source" ? "Escape, then Tab, leaves the editor" : "Renders as you type"}</span> : null}
						</div>
						<div class="editor-body">
							{s.mode === "form" ? (basic ? <BasicEditor /> : <Form />) : null}
							<SourceEditor hidden={s.mode !== "source"} />
						</div>
					</section>
					{basic ? null : <About />}
				</div>
				<div class="column">
					<BigView />
					<SmallSizes />
					{basic ? null : <Gallery />}
				</div>
			</main>
			<FloatingFlag />
			<UndoRedo where="floating" />
		</>
	);
}
