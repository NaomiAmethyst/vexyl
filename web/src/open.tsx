// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { defaultRepo, gistRef, openHref, parseRef, refFromLink, type Ref } from "./address.js";
import { Spinner, Tabs, useApp } from "./common.js";
import { engine } from "./engine.js";
import { evidenceTiers, fetchRef, fetchText, githubTree, maxDownload, RemoteError, type GistFile, type Tree } from "./remote.js";
import { app, newFlag } from "./store.js";
import { plain } from "./workspace.js";

export interface PickResult {
	text: string;
	label: string;
	ref?: Ref;
}

export interface OpenProps {
	/** In place of opening a flag in this tab, hands it over, as Compare needs. */
	onPick?: (r: PickResult) => void;
	heading?: string;
	onCancel?: () => void;
}

function Message(props: { error: Error | string }): preact.JSX.Element {
	const text = typeof props.error === "string" ? props.error : props.error.message;
	const missing = props.error instanceof RemoteError && props.error.reason === "missing";
	return <p class={`nx-callout ${missing ? "" : "warn"}`} role="alert"><span>{text}</span></p>;
}

const previews = new Map<string, Promise<string>>();
let previewCount = 0;
const waiting: (() => void)[] = [];
let running = 0;

async function limited<T>(job: () => Promise<T>): Promise<T> {
	if (running >= 4) {
		await new Promise<void>((resolve) => { waiting.push(resolve); });
	}
	running++;
	try {
		return await job();
	} finally {
		running--;
		waiting.shift()?.();
	}
}

/** Draws a file for a thumbnail, and remembers it for as long as the page lasts. */
function thumbnail(url: string): Promise<string> {
	let p = previews.get(url);
	if (p === undefined) {
		p = limited(async () => {
			const text = await fetchText(url);
			const slot = `preview-${++previewCount}`;
			const a = await engine.ask({ kind: "analyze", slot, text });
			if (!a.valid) {
				return "";
			}
			const r = await engine.ask({ kind: "render", slot, options: { height: 120 } });
			return r.svg !== undefined ? URL.createObjectURL(new Blob([r.svg], { type: "image/svg+xml" })) : "";
		});
		previews.set(url, p);
	}
	return p;
}

function Thumb(props: { url: string; size: number }): preact.JSX.Element {
	const ref = useRef<HTMLSpanElement>(null);
	const [src, setSrc] = useState<string>("");
	useEffect(() => {
		if (props.size > 64 * 1024) {
			return undefined;
		}
		const seen = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) {
				seen.disconnect();
				void thumbnail(props.url).then(setSrc, () => undefined);
			}
		});
		if (ref.current !== null) {
			seen.observe(ref.current);
		}
		return () => { seen.disconnect(); };
	}, [props.url, props.size]);
	return <span class="check row-thumb" ref={ref}>{src !== "" ? <img src={src} alt="" /> : null}</span>;
}

const niceName = (file: string): string => file.replace(/\.kdl$/, "").split(/[-_]/).map((w) => (w === "" ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");

function GithubTab(props: OpenProps): preact.JSX.Element {
	const [owner, setRepoText] = useState(`${defaultRepo.owner}/${defaultRepo.repo}`);
	const [branch, setBranch] = useState(defaultRepo.branch);
	const [loaded, setLoaded] = useState<{ owner: string; repo: string; branch: string } | null>(null);
	const [tree, setTree] = useState<Tree | null>(null);
	const [tiers, setTiers] = useState<Map<string, string>>(new Map());
	const [error, setError] = useState<Error | string | null>(null);
	const [busy, setBusy] = useState(false);
	const [folder, setFolder] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [picked, setPicked] = useState<string | null>(null);
	const load = async (): Promise<void> => {
		const [o, r] = owner.trim().replace(/^https:\/\/github\.com\//, "").split("/");
		if (!o || !r) {
			setError("That should be written as owner/repository.");
			return;
		}
		setBusy(true);
		setError(null);
		setTree(null);
		setPicked(null);
		try {
			const t = await githubTree(o, r, branch.trim());
			setTree(t);
			setLoaded({ owner: o, repo: r, branch: branch.trim() });
			const folders = new Map<string, number>();
			for (const f of t.files) {
				const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
				folders.set(dir, (folders.get(dir) ?? 0) + 1);
			}
			const names = [...folders.keys()];
			setFolder(names.includes("flags/country") ? "flags/country" : names[0] ?? "");
			if (r === "vexyl-flags") {
				void evidenceTiers(o, r, branch.trim()).then(setTiers, () => undefined);
			}
		} catch (e) {
			setError(e as Error);
		}
		setBusy(false);
	};
	useEffect(() => {
		void load();
	}, []);
	const folders = useMemo(() => {
		const m = new Map<string, number>();
		for (const f of tree?.files ?? []) {
			const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
			m.set(dir, (m.get(dir) ?? 0) + 1);
		}
		return [...m.entries()].sort((a, b) => b[1] - a[1]);
	}, [tree]);
	const files = useMemo(() => {
		const q = query.trim().toLowerCase();
		return (tree?.files ?? []).filter((f) => (f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "") === folder && (q === "" || f.path.toLowerCase().includes(q)));
	}, [tree, folder, query]);
	const refOf = (path: string): Ref & { kind: "github" } => ({ kind: "github", owner: loaded!.owner, repo: loaded!.repo, branch: loaded!.branch, path });
	const rawOf = (path: string): string => `https://raw.githubusercontent.com/${loaded!.owner}/${loaded!.repo}/${encodeURIComponent(loaded!.branch)}/${path.split("/").map(encodeURIComponent).join("/")}`;
	const tierOf = (path: string): string | undefined => (path.startsWith("reviewed/") ? tiers.get(path.slice(9).replace(/\.kdl$/, "")) : undefined);
	return (
		<div class="stack gap">
			<form class="repo-form" onSubmit={(e) => { e.preventDefault(); void load(); }}>
				<div class="field grow"><label class="nx-label" for="repo">Repository</label><input id="repo" class="nx-input mono" value={owner} spellcheck={false} onInput={(e) => { setRepoText((e.currentTarget as HTMLInputElement).value); }} /></div>
				<div class="field"><label class="nx-label" for="branch">Branch</label><input id="branch" class="nx-input mono branch" value={branch} spellcheck={false} onInput={(e) => { setBranch((e.currentTarget as HTMLInputElement).value); }} /></div>
				<button type="submit" class="nx-ghost">Load</button>
			</form>
			{busy ? <Spinner label="Asking GitHub" /> : null}
			{error !== null ? <Message error={error} /> : null}
			{error !== null ? <p class="nx-note">Your own repositories work too, if they're public. You can also open a file from a gist, a link, this computer, or by pasting it.</p> : null}
			{tree?.truncated === true ? <p class="nx-callout warn"><span>This repository is too big for GitHub to list in one go, so some files aren't shown. They can still be opened by link.</span></p> : null}
			{tree !== null && loaded !== null ? (
				<div class="browser">
					<nav aria-label="Folders" class="browser-col folders">
						{folders.length === 0 ? <p class="nx-empty">No flags here.</p> : null}
						{folders.map(([name, count]) => (
							<button key={name} type="button" class={`row compact${folder === name ? " on" : ""}`} aria-pressed={folder === name ? "true" : "false"} onClick={() => { setFolder(name); setPicked(null); }}>
								<span class="row-label">{name === "" ? "Top level" : name.replace(/^flags\//, "")}</span><span class="row-note">{count}</span>
							</button>
						))}
					</nav>
					<div class="browser-col files">
						<input class="nx-input" aria-label="Search this folder" placeholder={`Search ${(folder ?? "").replace(/^flags\//, "") || "these"}`} value={query} onInput={(e) => { setQuery((e.currentTarget as HTMLInputElement).value); }} />
						<div class="file-list">
							{files.map((f) => {
								const r = refOf(f.path);
								const base = f.path.split("/").at(-1)!;
								const tier = tierOf(f.path);
								return (
									<a key={f.path} class={`row compact file-row${picked === f.path ? " on" : ""}`} href={openHref(r)} aria-current={picked === f.path ? "true" : undefined} data-file={f.path}
										onClick={(e) => {
											if (plain(e)) {
												e.preventDefault();
												setPicked(f.path);
											}
										}}>
										<Thumb url={rawOf(f.path)} size={f.size} />
										<span class="row-label">{niceName(base)}</span>
										<span class="row-note">{tier !== undefined ? `Tier ${tier}` : f.size > 256 * 1024 ? `${(f.size / (1024 * 1024)).toFixed(1)} MB` : ""}</span>
									</a>
								);
							})}
							{files.length === 0 && folders.length > 0 ? <p class="nx-empty">Nothing here matches that.</p> : null}
						</div>
					</div>
					<Preview path={picked} url={picked !== null ? rawOf(picked) : ""} refer={picked !== null ? refOf(picked) : null} tier={picked !== null ? tierOf(picked) : undefined} {...(props.onPick !== undefined ? { onPick: props.onPick } : {})} />
				</div>
			) : null}
		</div>
	);
}

function Preview(props: { path: string | null; url: string; refer: Ref | null; tier: string | undefined; onPick?: (r: PickResult) => void }): preact.JSX.Element {
	const [state, setState] = useState<{ src: string; name: string; about: string; problems: number; text: string } | null>(null);
	const [error, setError] = useState<Error | null>(null);
	useEffect(() => {
		setState(null);
		setError(null);
		if (props.path === null) {
			return undefined;
		}
		let live = true;
		void (async (): Promise<void> => {
			try {
				const text = await fetchText(props.url);
				const slot = `preview-pick-${++previewCount}`;
				const a = await engine.ask({ kind: "analyze", slot, text });
				const model = a.model as { meta?: { name?: string; law?: { law: string }[]; description?: string } } | null;
				let src = "";
				if (a.valid) {
					const r = await engine.ask({ kind: "render", slot, options: { height: 360 } });
					src = r.svg !== undefined ? URL.createObjectURL(new Blob([r.svg], { type: "image/svg+xml" })) : "";
				}
				const laws = model?.meta?.law?.map((l) => l.law) ?? [];
				if (live) {
					setState({ src, name: model?.meta?.name ?? niceName(props.path!.split("/").at(-1)!), about: laws.length > 0 ? `Written from ${laws.join(", ")}.` : model?.meta?.description ?? "", problems: a.problems.length, text });
				}
			} catch (e) {
				if (live) {
					setError(e as Error);
				}
			}
		})();
		return () => { live = false; };
	}, [props.path, props.url]);
	if (props.path === null) {
		return <div class="browser-col preview"><p class="nx-empty">Choose a flag to see it here.</p></div>;
	}
	const tierText: Record<string, string> = { A: "A law was read, and it covers the geometry.", B: "A law was read, and gaps were filled from labeled secondary sources.", C: "No law was read." };
	return (
		<div class="browser-col preview">
			<div class="check preview-box">{state?.src ? <img src={state.src} alt={`${state.name}, as rendered`} /> : error === null && state === null ? <span class="bone bone-flag" aria-hidden="true" /> : null}</div>
			<div class="stack-tight">
				<h2 class="preview-name">{state?.name ?? niceName(props.path.split("/").at(-1)!)}</h2>
				<span class="mono nx-note">{props.path}</span>
			</div>
			{error !== null ? <Message error={error} /> : null}
			<p class="plain grow">{state?.about}{props.tier !== undefined ? ` ${tierText[props.tier] ?? ""}` : ""}{state !== null && state.problems > 0 ? ` This file has ${state.problems} ${state.problems === 1 ? "problem" : "problems"}, which you can fix once it's open.` : ""}</p>
			<div class="chips">
				{props.refer !== null ? (
					<a class="nx-btn" href={openHref(props.refer)} onClick={(e) => {
						if (props.onPick !== undefined && state !== null) {
							e.preventDefault();
							props.onPick({ text: state.text, label: state.name, ...(props.refer !== null ? { ref: props.refer } : {}) });
						}
					}}>{props.onPick !== undefined ? "Use this flag" : "Open this flag"}</a>
				) : null}
				<span class="nx-note">Your own repositories work too, if they're public.</span>
			</div>
		</div>
	);
}

function GistTab(props: OpenProps): preact.JSX.Element {
	const [text, setText] = useState("");
	const [files, setFiles] = useState<{ id: string; files: GistFile[] } | null>(null);
	const [error, setError] = useState<Error | string | null>(null);
	const [busy, setBusy] = useState(false);
	const take = async (r: Ref): Promise<void> => {
		const got = await fetchRef(r);
		if ("choose" in got) {
			setFiles({ id: (r as Ref & { kind: "gist" }).id, files: got.choose });
		} else if (props.onPick !== undefined) {
			props.onPick({ text: got.text, label: (got.ref as Ref & { kind: "gist" }).file ?? "Gist", ref: got.ref });
		} else {
			location.href = openHref(got.ref);
		}
	};
	const load = async (): Promise<void> => {
		const r = gistRef(text);
		setFiles(null);
		if (r === null) {
			setError("That isn't a gist's link or ID. A gist's link looks like https://gist.github.com/you/ and then a long ID.");
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await take(r);
		} catch (e) {
			setError(e as Error);
		}
		setBusy(false);
	};
	return (
		<form class="stack gap measure" onSubmit={(e) => { e.preventDefault(); void load(); }}>
			<div class="field">
				<label class="nx-label" for="gist">Gist link or ID</label>
				<div class="link-row">
					<input id="gist" class="nx-input mono link-text" placeholder="https://gist.github.com/you/[GIST ID]" spellcheck={false} value={text} onInput={(e) => { setText((e.currentTarget as HTMLInputElement).value); }} />
					<button type="submit" class="nx-ghost">Load</button>
				</div>
			</div>
			{busy ? <Spinner label="Asking GitHub" /> : null}
			{error !== null ? <Message error={error} /> : null}
			{files !== null ? (
				<div class="gist-list">
					<span class="nx-label">This gist has more than one flag</span>
					{files.files.map((f) => {
						const r: Ref = { kind: "gist", id: files.id, file: f.name };
						return <a key={f.name} class="row compact mono" href={openHref(r)} onClick={(e) => { if (props.onPick !== undefined) { e.preventDefault(); void take(r); } }}>{f.name}</a>;
					})}
				</div>
			) : null}
			<span class="nx-note">Public and secret gists both work, since a secret gist only needs its link. A gist with one flag opens straight away.</span>
		</form>
	);
}

async function readFile(file: File): Promise<string> {
	if (file.size > maxDownload) {
		throw new Error(`That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB, and this site reads up to ${maxDownload / (1024 * 1024)} MB.`);
	}
	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
	} catch {
		throw new Error("That file isn't text in UTF-8, so it can't be a flag.");
	}
}

function ComputerTab(props: OpenProps): preact.JSX.Element {
	const input = useRef<HTMLInputElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [over, setOver] = useState(false);
	const take = (file: File | undefined): void => {
		if (file === undefined) {
			return;
		}
		readFile(file).then((text) => {
			if (props.onPick !== undefined) {
				props.onPick({ text, label: file.name });
			} else {
				void app.openLocal(text, "file", file.name);
			}
		}, (e: Error) => { setError(e.message); });
	};
	return (
		<div class={`drop${over ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => { setOver(false); }}
			onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer?.files[0]); }}>
			<p class="drop-title">Drop a .kdl file here</p>
			<button type="button" class="nx-btn" onClick={() => { input.current?.click(); }}>Choose a file</button>
			<input ref={input} class="visually-hidden" type="file" accept=".kdl,text/plain" aria-label="Choose a file" tabIndex={-1} onChange={(e) => { take((e.currentTarget as HTMLInputElement).files?.[0]); }} />
			<span class="nx-note">It stays in your browser. Nothing is uploaded.</span>
			{error !== null ? <Message error={error} /> : null}
		</div>
	);
}

const placeholder = 'vexyl 1\nmeta { name "My flag"; }\npalette { red "#c00000"; }\nproportion hoist=2 fly=3\nfield red';

function PasteTab(props: OpenProps): preact.JSX.Element {
	const [text, setText] = useState("");
	return (
		<form class="stack gap" onSubmit={(e) => {
			e.preventDefault();
			if (props.onPick !== undefined) {
				props.onPick({ text, label: "Pasted" });
			} else {
				void app.openLocal(text, "paste", "Pasted");
			}
		}}>
			<div class="field">
				<label class="nx-label" for="paste">KDL</label>
				<textarea id="paste" class="nx-input mono paste" rows={14} placeholder={placeholder} spellcheck={false} value={text} onInput={(e) => { setText((e.currentTarget as HTMLTextAreaElement).value); }} />
			</div>
			<div class="chips">
				<button type="submit" class="nx-btn" disabled={text === ""}>Open</button>
				<span class="nx-note">A file with problems still opens, with them marked, so you can fix them.</span>
			</div>
		</form>
	);
}

function LinkTab(props: OpenProps): preact.JSX.Element {
	const [text, setText] = useState("");
	const [error, setError] = useState<Error | string | null>(null);
	const [busy, setBusy] = useState(false);
	const open = async (): Promise<void> => {
		const r = refFromLink(text);
		if ("problem" in r) {
			setError(r.problem);
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const got = await fetchRef(r);
			if ("choose" in got) {
				location.href = openHref(r);
				return;
			}
			if (props.onPick !== undefined) {
				props.onPick({ text: got.text, label: "From a link", ref: got.ref });
			} else {
				location.href = openHref(got.ref);
			}
		} catch (e) {
			setError(e as Error);
		}
		setBusy(false);
	};
	return (
		<form class="stack gap measure" onSubmit={(e) => { e.preventDefault(); void open(); }}>
			<div class="field">
				<label class="nx-label" for="link">Link to a KDL file</label>
				<input id="link" class="nx-input mono" placeholder="https://github.com/NaomiAmethyst/vexyl-flags/blob/main/flags/country/japan.kdl" spellcheck={false} value={text} onInput={(e) => { setText((e.currentTarget as HTMLInputElement).value); }} />
			</div>
			{busy ? <Spinner label="Fetching it" /> : null}
			{error !== null ? <Message error={error} /> : null}
			<div class="chips">
				<button type="submit" class="nx-btn" disabled={text.trim() === ""}>Open</button>
				<span class="nx-note">GitHub page links work. Other sites have to allow it, and the page says so if one doesn't.</span>
			</div>
		</form>
	);
}

export function OpenPanel(props: OpenProps): preact.JSX.Element {
	const [tab, setTab] = useState("github");
	const tabs = [["github", "GitHub"], ["gist", "Gist"], ["computer", "This computer"], ["paste", "Paste"], ["link", "Link"]] as const;
	return (
		<>
			<div class="title-row spread">
				<h1 id="open-h" class="dialog-title">{props.heading ?? "Open a flag"}</h1>
				<span class="grow" />
				<Tabs id="open" label="Where it comes from" value={tab} options={tabs} onPick={setTab} />
				{props.onCancel !== undefined ? <button type="button" class="nx-ghost" onClick={props.onCancel}>Cancel</button> : null}
			</div>
			<div id="open-panel" role="tabpanel" aria-labelledby={`open-tab-${tab}`}>
				{tab === "github" ? <GithubTab {...props} /> : tab === "gist" ? <GistTab {...props} /> : tab === "computer" ? <ComputerTab {...props} /> : tab === "paste" ? <PasteTab {...props} /> : <LinkTab {...props} />}
			</div>
		</>
	);
}

export function OpenPage(): preact.JSX.Element {
	const [s] = useApp();
	const hasDoc = s.source !== null;
	return (
		<main class="page-center">
			<section class="raised wide" aria-labelledby="open-h">
				<OpenPanel {...(hasDoc ? { onCancel: (): void => { app.go("work"); } } : {})} />
				{!hasDoc ? (
					<div class="start-new">
						<span class="nx-muted">Or start from nothing.</span>
						<button type="button" class="nx-ghost" onClick={() => { void app.openLocal(newFlag, "new", "new-flag.kdl"); }}>Start a new flag</button>
					</div>
				) : null}
			</section>
		</main>
	);
}

export function LoadProblem(): preact.JSX.Element {
	const [s] = useApp();
	return (
		<main class="page-center">
			<section class="raised narrow">
				<h1 class="dialog-title">That flag didn't open</h1>
				{s.loadError !== null ? <Message error={s.loadError} /> : null}
				<div class="chips">
					<button type="button" class="nx-btn" onClick={() => { location.reload(); }}>Try again</button>
					<a class="nx-ghost" href="?view=open">Open another flag</a>
				</div>
			</section>
		</main>
	);
}

export function GistChoice(): preact.JSX.Element {
	const [s] = useApp();
	return (
		<main class="page-center">
			<section class="raised narrow">
				<h1 class="dialog-title">This gist has more than one flag</h1>
				<div class="gist-list">
					{s.gistFiles?.files.map((f) => <a key={f.name} class="row compact mono" href={openHref({ kind: "gist", id: s.gistFiles!.id, file: f.name })}>{f.name}</a>)}
				</div>
			</section>
		</main>
	);
}

export { parseRef };
