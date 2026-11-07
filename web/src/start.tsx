// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { useState } from "preact/hooks";
import { Seg, useApp } from "./common.js";
import { app } from "./store.js";
import { flagShapes, layouts, template } from "./templates.js";
import { plain } from "./workspace.js";

const [navy, white, gold, red, green] = ["#27306b", "#f6f3ea", "#e8b23a", "#c43d3d", "#2f7d5b"];

const art: Readonly<Record<string, preact.ComponentChild>> = {
	blank: <rect width="30" height="20" fill={white} />,
	"two-stripes": <><rect width="30" height="10" fill={navy} /><rect y="10" width="30" height="10" fill={gold} /></>,
	"three-stripes": <><rect width="30" height="20" fill={navy} /><rect y="6.67" width="30" height="6.67" fill={white} /></>,
	"three-upright": <><rect width="10" height="20" fill={green} /><rect x="10" width="10" height="20" fill={white} /><rect x="20" width="10" height="20" fill={red} /></>,
	"off-cross": <><rect width="30" height="20" fill={navy} /><rect x="9" width="4" height="20" fill={white} /><rect y="8" width="30" height="4" fill={white} /></>,
	diagonal: <><rect width="30" height="20" fill={navy} /><polygon points="0,20 30,0 30,20" fill={gold} /></>,
	"stripes-block": <><rect width="30" height="20" fill={white} /><rect y="4" width="30" height="4" fill={red} /><rect y="12" width="30" height="4" fill={red} /><rect width="12" height="10" fill={navy} /></>,
	symbol: <><rect width="30" height="20" fill={green} /><circle cx="15" cy="10" r="6" fill={gold} /></>,
	swallowtail: <polygon points="0,0 30,0 22,10 30,20 0,20" fill={red} />,
};

/** Where a new flag starts, in either editor. */
export function StartPage(): preact.JSX.Element {
	const [s] = useApp();
	const [shape, setShape] = useState(flagShapes[0]!.id);
	return (
		<main class="start">
			<div class="start-head">
				<h1 class="start-title">Start a flag</h1>
				<p class="nx-muted">Pick the closest layout.{s.level === "basic" ? " Everything in it can be changed by dragging it on the flag." : ""}</p>
			</div>
			<div class="field">
				<span class="nx-label">Shape</span>
				<Seg class="self-start" label="Shape of the flag" value={shape} options={flagShapes.map((f) => [f.id, f.id])} onPick={setShape} />
			</div>
			<div class="start-tiles">
				{layouts.map((l) => (
					<button key={l.id} type="button" class="start-tile" data-layout={l.id} onClick={() => { void app.openLocal(template(l.id, shape), "new", "new-flag.kdl"); }}>
						<svg viewBox="0 0 30 20" aria-hidden="true">{art[l.id]}</svg>
						<span>{l.label}</span>
					</button>
				))}
			</div>
			<p class="nx-muted start-more">
				Already have one? <a href="?view=open" onClick={(e) => { if (plain(e)) { e.preventDefault(); app.go("open"); } }}>Open a flag</a>.
				{" "}
				{s.level === "basic"
					? <>Working from a law or a construction sheet? <button type="button" class="nx-link" onClick={() => { app.setLevel("advanced"); }}>Use Advanced</button></>
					: <>Rather drag things around on the flag? <button type="button" class="nx-link" onClick={() => { app.setLevel("basic"); }}>Use Basic</button></>}
				{s.source !== null ? <>{" "}<button type="button" class="nx-link" onClick={() => { app.go("work"); }}>Back to your flag</button></> : null}
			</p>
		</main>
	);
}
