// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { render } from "preact";
import { Logo, useApp } from "./common.js";
import { ComparePage } from "./compare.js";
import { ConstructionPage } from "./construction.js";
import { GistChoice, LoadProblem, OpenPage } from "./open.js";
import { SharePage } from "./share.js";
import { StartPage } from "./start.js";
import { redoInSource, undoInSource } from "./source.js";
import { app } from "./store.js";
import { Workspace } from "./workspace.js";

function Plain(props: { children: preact.ComponentChildren }): preact.JSX.Element {
	return (
		<>
			<header class="topbar"><Logo /></header>
			{props.children}
		</>
	);
}

/** Where Vexyl comes from, and on what terms, under every page. Links open beside the editor, so
 * that following one never leaves a flag behind. */
function SiteFooter(): preact.JSX.Element {
	const out = { target: "_blank", rel: "noopener" } as const;
	return (
		<footer class="site-foot">
			<span>© 2026 Naomi Persephone Amethyst</span>
			<span>The editor is <a href="LICENSE.txt" {...out}>Apache 2.0</a>, and the format’s <a href="https://github.com/NaomiAmethyst/vexyl/blob/main/SPEC.md" {...out}>specification</a> is <a href="https://creativecommons.org/licenses/by-sa/4.0/" {...out}>CC BY-SA 4.0</a></span>
			<a href="https://github.com/NaomiAmethyst/vexyl" {...out}>Source on GitHub</a>
		</footer>
	);
}

function Root(): preact.JSX.Element {
	const [s] = useApp();
	if (s.loadError !== null && s.source === null) {
		return <Plain><LoadProblem /></Plain>;
	}
	if (s.gistFiles !== null) {
		return <Plain><GistChoice /></Plain>;
	}
	if (s.view === "open") {
		return <Plain><OpenPage /></Plain>;
	}
	if (s.view === "new") {
		return <Plain><StartPage /></Plain>;
	}
	if (s.source === null) {
		return <Plain><main class="page-center" aria-busy="true"><section class="raised narrow"><span class="spinner-row" role="status"><span class="spinner" aria-hidden="true" />{s.loading !== null ? `Opening ${s.loading}` : "Starting"}</span><span class="bone bone-flag" aria-hidden="true" /></section></main></Plain>;
	}
	if (s.view === "share") {
		return <Plain><SharePage /></Plain>;
	}
	if (s.view === "compare") {
		return <ComparePage />;
	}
	if (s.view === "construction") {
		return <ConstructionPage />;
	}
	return <Workspace />;
}

// Ctrl+Z while not typing in a field undoes what was last done, whichever side did it.
addEventListener("keydown", (e: KeyboardEvent) => {
	if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") {
		return;
	}
	const target = e.target as HTMLElement;
	if (target.closest("input, textarea, .source-host") !== null) {
		return;
	}
	if (app.state.gesturing) {
		e.preventDefault();
		return;
	}
	e.preventDefault();
	if (e.shiftKey ? redoInSource() : undoInSource()) {
		// CodeMirror told the app as it changed.
	}
});

render(<><Root /><SiteFooter /></>, document.getElementById("app")!);
void app.boot();
