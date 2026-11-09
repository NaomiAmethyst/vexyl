// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { useEffect, useState } from "preact/hooks";
import { openHref, refLabel } from "./address.js";
import { copyText, download, fileStem, licenseName, Seg, useAck, useApp } from "./common.js";
import { engine } from "./engine.js";
import { downloadPicture, PictureFields } from "./picture.js";
import { app, optionsFor } from "./store.js";

/** Past this, a link is likely to break somewhere. Some programs give up at about this length. */
export const linkMost = 32 * 1024;
/** Past this, many chat programs and mail clients cut a link or won't make it clickable. */
export const linkWarn = 8 * 1024;

function pageUrl(): string {
	return location.origin + location.pathname;
}

export function SharePage(): preact.JSX.Element {
	const [s] = useApp();
	const remote = s.source?.ref;
	const edited = s.text !== s.base;
	const [chosen, setHow] = useState<"file" | "copy" | null>(null);
	const how = chosen ?? (remote !== undefined && !edited ? "file" : "copy");
	const [link, setLink] = useState<string | null>(null);
	const [refused, setRefused] = useState<string | null>(null);
	const [ack, setAck] = useAck();
	const name = app.displayName();
	const text = app.exportText();
	const paused = s.analysis !== null && !s.analysis.valid;
	useEffect(() => {
		let live = true;
		setRefused(null);
		void engine.ask({ kind: "shareEncode", text }).then((r) => {
			if (live) {
				setLink(r.link ?? null);
				setRefused(r.error ?? null);
			}
		});
		return () => { live = false; };
	}, [text]);
	const filePath = remote !== undefined ? pageUrl() + openHref(remote) : null;
	const copyPath = link !== null ? `${pageUrl()}#${link}` : null;
	const tooLarge = copyPath !== null && copyPath.length > linkMost;
	const shownLink = how === "file" ? filePath : tooLarge ? null : copyPath;
	const stem = fileStem(remote !== undefined ? refLabel(remote).replace(/\.kdl$/, "") : name);
	const svgText = async (): Promise<string | null> => {
		const result = await engine.ask({ kind: "render", slot: "main", options: optionsFor(s.form, s.padded[s.form] === true, s.foldStep[s.form]), exact: true });
		return result.svg ?? null;
	};
	const shown = s.images.get(s.form);
	const nodes = s.lastReadable?.nodes ?? [];
	const meta = nodes.find((n) => n.name === "meta");
	const license = meta?.kids.find((k) => k.name === "license")?.args[0]?.v;
	const render = meta?.kids.find((k) => k.name === "render-license")?.args[0]?.v;
	return (
		<main class="page-center">
			<section class="raised narrow" aria-labelledby="share-h">
				<div class="title-row spread">
					<h1 id="share-h" class="dialog-title">Share {name}</h1>
					<span class="grow" />
					<a class="nx-ghost" href={app.href("work")} onClick={(e) => { e.preventDefault(); app.go("work"); }}>Done</a>
				</div>
				{remote !== undefined ? (
					<div class="field">
						<span class="nx-label">What the link gives</span>
						<Seg label="What the link gives" value={how} options={[["file", "The file, where it is"], ["copy", "A copy of what's on screen"]]} onPick={(v) => { setHow(v as "file" | "copy"); }} />
					</div>
				) : null}
				<div class="field">
					<span class="nx-label">Link</span>
					{shownLink !== null ? (
						<div class="link-row">
							<input class="nx-input mono link-text" aria-label="Link to share" value={shownLink} readOnly onFocus={(e) => { (e.currentTarget as HTMLInputElement).select(); }} />
							<button type="button" class="nx-btn" onClick={() => { void copyText(shownLink).then((ok) => { setAck(ok ? "Copied the link." : "Your browser didn't allow copying. Select the link and copy it."); }); }}>Copy link</button>
						</div>
					) : null}
					{how === "file" && remote !== undefined ? (
						<p class="nx-note">
							{remote.kind === "github" ? "This points at the file on GitHub, so it stays short, and it follows any changes made there." : remote.kind === "gist" ? "This points at the file in its gist, so it stays short, and it follows any changes made there." : "This points at the file where it is, so it stays short, and it follows any changes made there."}
							{edited ? " It doesn't include your edits here." : ""}
						</p>
					) : null}
					{how === "copy" && copyPath !== null && !tooLarge ? (
						<p class="nx-note">The flag travels inside this link, as about {copyPath.length.toLocaleString()} characters. Nothing is uploaded, and whoever you send it to gets their own copy to edit.{copyPath.length > linkWarn ? " That's long enough that some chat programs and mail clients may cut it short, so check that it opens." : ""}</p>
					) : null}
					{how === "copy" && (tooLarge || refused !== null) ? (
						<p class="nx-callout warn"><span>This file is too large to fit in a link{tooLarge ? `: it would take ${copyPath!.length.toLocaleString()} characters` : ""}. Put it in a gist or a repository and share that link, or send the file itself.</span></p>
					) : null}
				</div>
				<div class="field ruled">
					<span class="nx-label">Or send the flag itself</span>
					<PictureFields choose={true} width={shown?.width} height={shown?.height} />
					<div class="chips">
						<button type="button" class="nx-ghost" onClick={() => { download(`${stem}.kdl`, text, "text/plain"); app.markSaved(); setAck("Downloaded the KDL."); }}>Download KDL</button>
						<button type="button" class="nx-ghost" disabled={paused} onClick={() => { void svgText().then(async (t) => { if (t !== null) { setAck(await downloadPicture(stem, t, s.picture)); } }); }}>{s.picture.format === "png" ? "Download PNG" : "Download SVG"}</button>
						<button type="button" class="nx-ghost" disabled={paused} onClick={() => { void svgText().then((t) => (t === null ? false : copyText(t))).then((ok) => { setAck(ok ? "Copied the SVG." : "That couldn't be copied."); }); }}>Copy SVG</button>
						<button type="button" class="nx-ghost" onClick={() => { void copyText(text).then((ok) => { setAck(ok ? "Copied the KDL." : "That couldn't be copied."); }); }}>Copy KDL</button>
					</div>
					{paused ? <span class="nx-note">The SVG is paused until the file is valid again.</span> : null}
					<span class="nx-note" role="status">{ack}</span>
				</div>
				<p class="ruled nx-muted">
					The file's credits and license travel with it.
					{typeof render === "string" ? ` Its renders are ${licenseName(render)}.` : ""}
					{typeof license === "string" ? ` The file itself is ${licenseName(license)}.` : " It doesn't give a license."}
				</p>
			</section>
		</main>
	);
}
