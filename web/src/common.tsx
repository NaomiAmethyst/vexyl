// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { linkable } from "./address.js";
import { app, type App, type State } from "./store.js";

/** Re-renders whenever the app's state changes. */
export function useApp(): [State, App] {
	const [, tick] = useState(0);
	const seen = app.state;
	useEffect(() => {
		// It could have changed between drawing and this running.
		if (seen !== app.state) {
			tick((n) => n + 1);
		}
		return app.subscribe(() => {
			tick((n) => n + 1);
		});
	}, []);
	return [app.state, app];
}

export function Logo(): preact.JSX.Element {
	return <a class="brand" href="?" onClick={(e) => { e.preventDefault(); app.go(app.state.source === null ? "open" : "work"); }}><img src="favicon.svg" alt="" />vexyl</a>;
}

/** A row of choices, moving by arrow keys as a radio group does. */
export function Seg(props: { label: string; value: string; options: readonly (readonly [string, string])[]; onPick: (v: string) => void; class?: string }): preact.JSX.Element {
	const ref = useRef<HTMLDivElement>(null);
	const keys = (e: KeyboardEvent, i: number): void => {
		const n = props.options.length;
		let next = -1;
		if (e.key === "ArrowRight" || e.key === "ArrowDown") {
			next = (i + 1) % n;
		} else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
			next = (i + n - 1) % n;
		} else if (e.key === "Home") {
			next = 0;
		} else if (e.key === "End") {
			next = n - 1;
		}
		if (next >= 0) {
			e.preventDefault();
			props.onPick(props.options[next]![0]);
			(ref.current?.children[next] as HTMLElement | undefined)?.focus();
		}
	};
	const known = props.options.some(([v]) => v === props.value);
	return (
		<div class={`nx-seg ${props.class ?? ""}`} role="radiogroup" aria-label={props.label} ref={ref}>
			{props.options.map(([value, label], i) => (
				<button key={value} type="button" role="radio" class={props.value === value ? "active" : ""} aria-checked={props.value === value ? "true" : "false"}
					tabIndex={props.value === value || (!known && i === 0) ? 0 : -1} onClick={() => { props.onPick(value); }} onKeyDown={(e) => { keys(e, i); }}>{label}</button>
			))}
		</div>
	);
}

/** Tabs, moving by arrow keys. */
export function Tabs(props: { label: string; value: string; options: readonly (readonly [string, string])[]; onPick: (v: string) => void; id: string }): preact.JSX.Element {
	const ref = useRef<HTMLDivElement>(null);
	const keys = (e: KeyboardEvent, i: number): void => {
		const n = props.options.length;
		const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
		if (next >= 0) {
			e.preventDefault();
			props.onPick(props.options[next]![0]);
			(ref.current?.children[next] as HTMLElement | undefined)?.focus();
		}
	};
	return (
		<div class="nx-seg" role="tablist" aria-label={props.label} ref={ref}>
			{props.options.map(([value, label], i) => (
				<button key={value} id={`${props.id}-tab-${value}`} type="button" role="tab" class={props.value === value ? "active" : ""} aria-selected={props.value === value ? "true" : "false"} aria-controls={`${props.id}-panel`}
					tabIndex={props.value === value ? 0 : -1} onClick={() => { props.onPick(value); }} onKeyDown={(e) => { keys(e, i); }}>{label}</button>
			))}
		</div>
	);
}

export function Spinner(props: { label: string }): preact.JSX.Element {
	return <span class="spinner-row" role="status"><span class="spinner" aria-hidden="true" />{props.label}</span>;
}

/** A link from a file: only ever to the web, and telling the other site nothing. */
export function FileLink(props: { href: string; children?: ComponentChildren }): preact.JSX.Element {
	const href = linkable(props.href);
	if (href === null) {
		return <span>{props.children ?? props.href}</span>;
	}
	return <a href={href} target="_blank" rel="noopener noreferrer nofollow">{props.children ?? props.href}</a>;
}

const licenseNames: Readonly<Record<string, string>> = { "CC-BY-SA-4.0": "CC BY-SA 4.0", "CC-BY-4.0": "CC BY 4.0", "CC0-1.0": "CC0", "LicenseRef-Public-Domain": "Public domain", "Apache-2.0": "Apache 2.0" };
export const licenseName = (id: string): string => licenseNames[id] ?? id;

export function safeColor(c: unknown): string | undefined {
	return typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c) ? c : undefined;
}

export function download(name: string, text: string, type: string): void {
	const url = URL.createObjectURL(new Blob([text], { type }));
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => {
		URL.revokeObjectURL(url);
	}, 10000);
}

/** A name that's safe to give a file, from a name that could be anything. */
export function fileStem(name: string): string {
	const stem = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
	return stem === "" ? "flag" : stem;
}

export function copyText(text: string): Promise<boolean> {
	return navigator.clipboard.writeText(text).then(() => true, () => false);
}

/** Something that says it worked, for a screen reader as well. */
export function useAck(): [string, (text: string) => void] {
	const [ack, setAck] = useState("");
	const timer = useRef<ReturnType<typeof setTimeout>>();
	return [ack, (text: string): void => {
		setAck(text);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			setAck("");
		}, 3000);
	}];
}
