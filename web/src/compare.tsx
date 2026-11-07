// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { defaultRepo, readAddress, refLabel, type Ref } from "./address.js";
import { Logo, safeColor, Seg, Spinner, useApp } from "./common.js";
import { engine } from "./engine.js";
import { lineDiff } from "./linediff.js";
import { OpenPanel, type PickResult } from "./open.js";
import { fetchRef, githubTree, fetchText } from "./remote.js";
import { diffShapes, type ShapeDiff } from "./shapediff.js";
import { app } from "./store.js";
import { compareModels, unchangedSentence } from "./whatchanged.js";

interface Side {
	label: string;
	sub: string;
	file: string;
	text: string | null;
	model: Record<string, unknown> | null;
	url: string;
	width: number;
	height: number;
	problems: number;
}

const metaOf = (m: Record<string, unknown> | null): { name?: string; version?: string; date?: string; until?: string; series?: string } => (m?.["meta"] ?? {}) as Record<string, string>;

async function sideOf(slot: string, text: string, file: string): Promise<Side> {
	const a = await engine.ask({ kind: "analyze", slot, text });
	const meta = metaOf(a.model);
	let url = "";
	let width = 0;
	let height = 0;
	if (a.valid) {
		const r = await engine.ask({ kind: "render", slot, options: { height: 600 } });
		if (r.svg !== undefined) {
			url = URL.createObjectURL(new Blob([r.svg], { type: "image/svg+xml" }));
			width = r.width ?? 0;
			height = r.height ?? 0;
		}
	}
	const year = (d: string | undefined): string | undefined => d?.slice(0, 4);
	const span = meta.date !== undefined ? (meta.until !== undefined ? `${year(meta.date)} to ${year(meta.until)}` : `${year(meta.date)}, current`) : meta.until !== undefined ? `Until ${year(meta.until)}` : "";
	const label = meta.name !== undefined ? `${meta.name}${meta.version !== undefined ? ` ${meta.version}` : ""}` : file;
	return { label, sub: a.valid ? span : `${a.problems.length} ${a.problems.length === 1 ? "problem" : "problems"}, so it can't be drawn`, file, text, model: a.model, url, width, height, problems: a.problems.length };
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = (): void => { resolve(img); };
		img.onerror = (): void => { reject(new Error("That image can't be read.")); };
		img.src = url;
	});
}

/** Finds other versions in the same series, in the repository the flag came from or else in vexyl-flags. */
async function otherVersions(source: Ref | undefined, series: string, file: string): Promise<(PickResult & { sub: string; ref: Ref })[]> {
	const repo = source?.kind === "github" ? source : { ...defaultRepo };
	const tree = await githubTree(repo.owner, repo.repo, repo.branch);
	const stem = series.split("-")[0]!;
	const candidates = tree.files.filter((f) => f.path.split("/").at(-1)!.startsWith(stem) && f.size < 256 * 1024 && f.path.split("/").at(-1) !== file).slice(0, 16);
	const out: (PickResult & { sub: string; ref: Ref })[] = [];
	for (const c of candidates) {
		const ref: Ref = { kind: "github", owner: repo.owner, repo: repo.repo, branch: repo.branch, path: c.path };
		const text = await fetchText(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${encodeURIComponent(repo.branch)}/${c.path.split("/").map(encodeURIComponent).join("/")}`);
		const a = await engine.ask({ kind: "analyze", slot: "cmp-probe", text });
		const meta = metaOf(a.model);
		if (meta.series === series) {
			out.push({ text, label: `${meta.name ?? refLabel(ref)}${meta.version !== undefined ? ` ${meta.version}` : ""}`, sub: meta.date ?? "", ref });
		}
	}
	return out;
}

function Chooser(props: { title: string; series: string | undefined; source: Ref | undefined; file: string; onPick: (r: PickResult) => void; onDrawing: (file: File) => void; onCancel: () => void }): preact.JSX.Element {
	const [mode, setMode] = useState(props.series !== undefined ? "series" : "file");
	const [versions, setVersions] = useState<(PickResult & { sub: string; ref: Ref })[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (props.series === undefined) {
			return;
		}
		otherVersions(props.source, props.series, props.file).then(setVersions, (e: Error) => { setError(e.message); });
	}, [props.series]);
	return (
		<div class="chooser">
			<div class="title-row spread">
				<h2 class="preview-name">{props.title}</h2>
				<span class="grow" />
				<Seg label="Choose from" value={mode} options={[...(props.series !== undefined ? [["series", "Other versions"] as const] : []), ["file", "Any file"], ["drawing", "A drawing"]]} onPick={setMode} />
				<button type="button" class="nx-ghost" onClick={props.onCancel}>Cancel</button>
			</div>
			{mode === "series" ? (
				<div class="stack-tight">
					{versions === null && error === null ? <Spinner label="Looking for other versions" /> : null}
					{error !== null ? <p class="nx-callout warn"><span>{error}</span></p> : null}
					{versions?.length === 0 ? <p class="nx-empty">No other versions in this series were found.</p> : null}
					{versions?.map((v) => (
						<button key={v.label} type="button" class="row compact" onClick={() => { props.onPick(v); }}><span class="row-label">{v.label}</span><span class="row-note">{v.sub}</span></button>
					))}
				</div>
			) : mode === "file" ? (
				<OpenPanel heading="Any file" onPick={props.onPick} />
			) : (
				<div class="drop">
					<p class="drop-title">A drawing to compare with</p>
					<label class="nx-btn">Choose an image<input class="visually-hidden" type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" onChange={(e) => {
						const f = (e.currentTarget as HTMLInputElement).files?.[0];
						if (f !== undefined) {
							props.onDrawing(f);
						}
					}} /></label>
					<span class="nx-note">An SVG, PNG, JPEG or WebP. It stays in your browser, and shows as an image, so nothing in it can run.</span>
				</div>
			)}
		</div>
	);
}

function Slider(props: { a: Side; b: Side }): preact.JSX.Element {
	const { a, b } = props;
	const [at, setAt] = useState(50);
	const dragging = useRef(false);
	const moveTo = (e: PointerEvent): void => {
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		setAt(Math.round((100 * Math.max(0, Math.min(box.width, e.clientX - box.left))) / box.width));
	};
	const ratio = Math.max(a.width / Math.max(a.height, 1), b.width / Math.max(b.height, 1));
	return (
		<div class="slider-wrap">
			<div class="slider-stage check" style={{ aspectRatio: String(ratio) }} data-at={at}
				onPointerDown={(e) => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); moveTo(e); }}
				onPointerMove={(e) => { if (dragging.current) { moveTo(e); } }}
				onPointerUp={() => { dragging.current = false; }}>
				<img src={b.url} alt={`${b.label}, B`} draggable={false} class="slider-img" />
				<img src={a.url} alt={`${a.label}, A, revealed up to the slider`} draggable={false} class="slider-img" style={{ clipPath: `inset(0 ${100 - at}% 0 0)` }} />
				<div class="slider-line" aria-hidden="true" style={{ left: `${at}%` }}><span class="slider-handle">‹›</span></div>
			</div>
			<label class="slider-bar">A<input type="range" min="0" max="100" value={at} aria-label="How much of A to show" onInput={(e) => { setAt(Number((e.currentTarget as HTMLInputElement).value)); }} />B</label>
		</div>
	);
}

function Differences(props: { a: Side; b: Side }): preact.JSX.Element {
	const { a, b } = props;
	const canvas = useRef<HTMLCanvasElement>(null);
	const [result, setResult] = useState<ShapeDiff | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let live = true;
		void (async (): Promise<void> => {
			try {
				const [ia, ib] = await Promise.all([loadImage(a.url), loadImage(b.url)]);
				// Larger than it's shown, because it's about to be zoomed in on.
				const height = 1200;
				const wa = Math.round((a.width / Math.max(a.height, 1)) * height) || ia.naturalWidth;
				const wb = Math.round((b.width / Math.max(b.height, 1)) * height) || ib.naturalWidth;
				const width = Math.max(wa, wb, 1);
				const off = (img: HTMLImageElement, w: number): ImageData => {
					const c = document.createElement("canvas");
					c.width = width;
					c.height = height;
					const g = c.getContext("2d", { willReadFrequently: true })!;
					g.drawImage(img, 0, 0, w, height);
					return g.getImageData(0, 0, width, height);
				};
				const da = off(ia, wa);
				const db = off(ib, wb);
				const diff = diffShapes(da.data, db.data, width, height);
				if (!live) {
					return;
				}
				setResult(diff);
				const view = canvas.current;
				if (view === null) {
					return;
				}
				// The flag faintly, so that it can be seen what's where, and the differences over it.
				const out = new ImageData(width, height);
				for (let p = 0; p < width * height; p++) {
					const i = p << 2;
					const m = diff.marks[p]!;
					if (m === 1) {
						out.data.set([255, 92, 120, 255], i);
					} else if (m === 2) {
						out.data.set([120, 230, 160, 255], i);
					} else {
						const keep = db.data[i + 3]! / 255;
						out.data[i] = 255 - (255 - db.data[i]!) * 0.28 * keep;
						out.data[i + 1] = 255 - (255 - db.data[i + 1]!) * 0.28 * keep;
						out.data[i + 2] = 255 - (255 - db.data[i + 2]!) * 0.28 * keep;
						out.data[i + 3] = 255;
					}
				}
				const scratch = document.createElement("canvas");
				scratch.width = width;
				scratch.height = height;
				scratch.getContext("2d")!.putImageData(out, 0, 0);
				const box = diff.box ?? { x: 0, y: 0, w: width, h: height };
				const shown = { w: Math.min(width, Math.max(box.w * 1.3, height * 0.25)), h: Math.min(height, Math.max(box.h * 1.3, height * 0.125)) };
				// Keeps the view 2:1, as the stage is, so that nothing's stretched.
				if (shown.w / shown.h < 2) {
					shown.w = Math.min(width, shown.h * 2);
				} else {
					shown.h = Math.min(height, shown.w / 2);
				}
				const x = Math.max(0, Math.min(width - shown.w, box.x + box.w / 2 - shown.w / 2));
				const y = Math.max(0, Math.min(height - shown.h, box.y + box.h / 2 - shown.h / 2));
				view.width = 1800;
				view.height = Math.round((1800 * shown.h) / shown.w);
				const g = view.getContext("2d")!;
				g.imageSmoothingQuality = "high";
				g.drawImage(scratch, x, y, shown.w, shown.h, 0, 0, view.width, view.height);
			} catch (e) {
				if (live) {
					setError((e as Error).message);
				}
			}
		})();
		return () => { live = false; };
	}, [a.url, b.url]);
	const percent = result?.percent;
	return (
		<div class="diff-wrap">
			<canvas ref={canvas} class="diff-canvas" role="img" aria-label={percent === undefined ? "Working out where the shapes differ" : percent === 0 ? "The shapes are the same" : `Where the shapes differ, zoomed in: ${percent.toFixed(2)}% of the flag`} />
			{error !== null ? <p class="nx-callout warn"><span>{error}</span></p> : null}
			<div class="diff-key">
				<span class="key"><span class="key-mark only-a" aria-hidden="true" />Only in A</span>
				<span class="key"><span class="key-mark only-b" aria-hidden="true" />Only in B</span>
				<span class="nx-muted" data-percent={percent?.toFixed(2) ?? ""}>{percent === undefined ? "Working it out." : percent === 0 ? "Their shapes are the same, and any colors are listed below." : `Shapes only, zoomed to where they differ. They differ in ${percent.toFixed(2)}% of the flag, and the colors are listed below.`}</span>
			</div>
		</div>
	);
}

function SourceDiff(props: { a: Side; b: Side; different: boolean }): preact.JSX.Element {
	const [scope, setScope] = useState("changed");
	const rows = useMemo(() => lineDiff(props.a.text ?? "", props.b.text ?? ""), [props.a.text, props.b.text]);
	const shown = (scope === "changed" ? rows.filter((r) => r.kind === "changed") : rows).slice(0, 8000);
	const longest = 2000;
	const cut = (s: string | null): string => (s === null ? "" : s.length > longest ? s.slice(0, longest) + "…" : s);
	return (
		<div class="stack gap">
			<div class="chips">
				<Seg label="Which lines" value={scope} options={[["changed", "Changed lines"], ["all", "Whole file"]]} onPick={setScope} />
				{props.different ? <span class="nx-note">These files use different grids, so most numbers differ. What changed, below, compares them on the same scale.</span> : null}
			</div>
			<div class="side-diff" tabIndex={0} role="region" aria-label="The two files, line by line">
				<div class="side-diff-row head"><span class="side-cell">A: {props.a.file}</span><span class="side-cell">B: {props.b.file}</span></div>
				{shown.map((r, i) => (
					<div class={`side-diff-row ${r.kind}`} key={i}>
						<div class={`side-cell${r.kind === "changed" && r.left !== null ? " removed" : ""}`}><span class="line-no" aria-hidden="true">{r.leftNo ?? ""}</span><span class="line-text">{cut(r.left)}</span></div>
						<div class={`side-cell${r.kind === "changed" && r.right !== null ? " added" : ""}`}><span class="line-no" aria-hidden="true">{r.rightNo ?? ""}</span><span class="line-text">{cut(r.right)}</span></div>
					</div>
				))}
				{shown.length === 0 ? <p class="nx-empty pad-row">Nothing's different.</p> : null}
			</div>
		</div>
	);
}

function grids(a: Side, b: Side): boolean {
	const p = (s: Side): number => Number((s.model?.["proportion"] as { hoist?: number } | undefined)?.hoist ?? 0);
	return p(a) !== p(b);
}

export function ComparePage(): preact.JSX.Element {
	const [s] = useApp();
	const [view, setView] = useState("side");
	const [a, setA] = useState<Side | null>(null);
	const [b, setB] = useState<Side | null>(null);
	const [choosing, setChoosing] = useState<"a" | "b" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const doc = s.source;
	const series = metaOf(s.lastValid?.model ?? null).series;
	const fileName = doc?.ref !== undefined ? refLabel(doc.ref) : (doc?.label ?? "this flag");
	useEffect(() => {
		if (doc === null) {
			return;
		}
		void sideOf("cmp-a", s.text, fileName).then(setA, (e: Error) => { setError(e.message); });
		const wanted = readAddress(location.search, location.hash).with;
		if (wanted !== null) {
			fetchRef(wanted).then(async (got) => {
				if (!("choose" in got)) {
					setB(await sideOf("cmp-b", got.text, refLabel(got.ref)));
				}
			}).catch((e: Error) => { setError(e.message); });
			return;
		}
		if (series !== undefined) {
			otherVersions(doc.ref, series, fileName).then(async (found) => {
				if (found[0] !== undefined) {
					setB(await sideOf("cmp-b", found[0].text, refLabel(found[0].ref)));
				} else {
					setChoosing("b");
				}
			}, () => { setChoosing("b"); });
		} else {
			setChoosing("b");
		}
	}, [doc]);
	const pick = (which: "a" | "b") => (r: PickResult): void => {
		setChoosing(null);
		if (which === "b" && r.ref !== undefined) {
			// So that the address says what's being compared, and can be sent to someone.
			history.replaceState(null, "", app.href("compare", { with: r.ref }));
		}
		void sideOf(which === "a" ? "cmp-a" : "cmp-b", r.text, r.ref !== undefined ? refLabel(r.ref) : r.label).then(which === "a" ? setA : setB, (e: Error) => { setError(e.message); });
	};
	const drawing = (which: "a" | "b") => (file: File): void => {
		setChoosing(null);
		const url = URL.createObjectURL(file);
		void loadImage(url).then((img) => {
			const side: Side = { label: file.name, sub: "A drawing", file: file.name, text: null, model: null, url, width: img.naturalWidth || 1200, height: img.naturalHeight || 600, problems: 0 };
			(which === "a" ? setA : setB)(side);
		}, (e: Error) => { setError(e.message); });
	};
	const both = a !== null && b !== null;
	const comparison = useMemo(() => (a?.model != null && b?.model != null ? compareModels(a.model, b.model) : null), [a, b]);
	const ma = metaOf(a?.model ?? null);
	const mb = metaOf(b?.model ?? null);
	const sameName = ma.name !== undefined && ma.name === mb.name;
	const yearOf = (m: { date?: string; version?: string }): string => m.version ?? m.date?.slice(0, 4) ?? "";
	const heads: [string, string] = [ma.name ?? a?.label ?? "", mb.name ?? b?.label ?? ""];
	return (
		<>
			<header class="topbar">
				<Logo />
				<span class="nx-muted">Compare</span>
				<span class="grow" />
				<a class="nx-ghost" href={app.href("work")} onClick={(e) => { e.preventDefault(); app.go("work"); }}>Back to editing</a>
			</header>
			<main class="compare">
				<div class="compare-head">
					<div class="compare-title">
						<h1 class="compare-h1">
							{both && sameName ? <>{ma.name}, <span class="nx-serif nx-accent accent-word">{yearOf(ma)} and {yearOf(mb)}</span></> : both ? <>{heads[0]} <span class="nx-serif nx-accent accent-word">and</span> {heads[1]}</> : "Compare"}
						</h1>
						<p class="nx-muted">{both && ma.series !== undefined && ma.series === mb.series ? "Two versions in the same series." : both ? "Two flags, side by side." : "Choose what to compare it with."}</p>
					</div>
					<div class="field">
						<span class="nx-label">View</span>
						<Seg label="View" value={view} options={[["side", "Side by side"], ["slide", "Slider"], ["diff", "Differences"], ["source", "Source"]]} onPick={setView} />
					</div>
				</div>
				{error !== null ? <p class="nx-callout warn"><span>{error}</span></p> : null}
				<section class="card" aria-label="The two flags">
					<div class="picks">
						{(["a", "b"] as const).map((which) => {
							const side = which === "a" ? a : b;
							return (
								<div class="pick-box" key={which}>
									<span class="nx-label">{which.toUpperCase()}</span>
									<span class="pick-label">{side?.label ?? "Nothing yet"}</span>
									<span class="pick-sub">{side?.sub}</span>
									<button type="button" class="nx-ghost small pick-change" aria-label={`Change ${which.toUpperCase()}`} onClick={() => { setChoosing(which); }}>Change</button>
								</div>
							);
						})}
					</div>
					{choosing !== null ? <Chooser title={`Choose ${choosing.toUpperCase()}`} series={series} source={doc?.ref} file={fileName} onPick={pick(choosing)} onDrawing={drawing(choosing)} onCancel={() => { setChoosing(null); }} /> : null}
					{!both && choosing === null ? <div class="bone bone-flag" aria-hidden="true" /> : null}
					{both && view === "side" ? (
						<div class="side-by-side">
							{[a, b].map((side, i) => (
								<figure key={i} class="side-fig check">
									{side.url !== "" ? <img src={side.url} alt={`${side.label}, ${i === 0 ? "A" : "B"}`} /> : <p class="nx-callout warn"><span>This one has problems, so it can't be drawn.</span></p>}
								</figure>
							))}
						</div>
					) : null}
					{both && view === "slide" ? (a.url !== "" && b.url !== "" ? <Slider a={a} b={b} /> : <p class="nx-callout warn"><span>One of these has problems, so it can't be drawn.</span></p>) : null}
					{both && view === "diff" ? (a.url !== "" && b.url !== "" ? <Differences a={a} b={b} /> : <p class="nx-callout warn"><span>One of these has problems, so it can't be drawn.</span></p>) : null}
					{both && view === "source" ? (a.text !== null && b.text !== null ? <SourceDiff a={a} b={b} different={grids(a, b)} /> : <p class="nx-note">A drawing has no source to compare.</p>) : null}
				</section>
				<section class="card" aria-labelledby="changes-h">
					<div class="title-row">
						<h2 id="changes-h" class="section-title">What changed</h2>
						{comparison !== null && grids(a!, b!) ? <span class="nx-muted">Sizes are shown as a share of the hoist, since these files use different grids.</span> : comparison !== null ? <span class="nx-muted">Sizes are shown as a share of the hoist.</span> : null}
					</div>
					{comparison !== null ? (
						<div class="table-scroll" tabIndex={0} role="group" aria-label="The table of what changed">
							<table class="changes">
								<thead><tr><th scope="col">Term</th><th scope="col">Value</th><th scope="col">A{yearOf(ma) !== "" ? `: ${yearOf(ma)}` : ""}</th><th scope="col">B{yearOf(mb) !== "" ? `: ${yearOf(mb)}` : ""}</th></tr></thead>
								<tbody>
									{comparison.changes.map((c, i) => (
										<tr key={i}>
											<td>{c.term}</td>
											<td class="nx-muted">{c.name}</td>
											<td class="mono value">{safeColor(c.a.color) !== undefined ? <span class="dot" aria-hidden="true" style={{ background: c.a.color! }} /> : null}{c.a.text}</td>
											<td class="mono value strong">{safeColor(c.b.color) !== undefined ? <span class="dot" aria-hidden="true" style={{ background: c.b.color! }} /> : null}{c.b.text}</td>
										</tr>
									))}
								</tbody>
							</table>
							{comparison.changes.length === 0 ? <p class="nx-empty">Nothing that matters has changed.</p> : null}
						</div>
					) : <p class="nx-note">{both ? "This needs two flags with no problems, because it compares what they mean." : "Once there are two flags, this says what's different."}</p>}
					{comparison !== null && comparison.unchanged.length > 0 ? <p class="nx-note">{unchangedSentence(comparison.unchanged)}</p> : null}
				</section>
			</main>
		</>
	);
}
