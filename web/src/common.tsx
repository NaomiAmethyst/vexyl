// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
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
	return <a class="brand" href="?" onClick={(e) => { e.preventDefault(); app.go(app.state.source === null ? "open" : "work"); }}><img src="favicon.svg" alt="" /><span class="brand-name">vexyl</span></a>;
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

const menuItems = '[role="menuitem"], [role="menuitemradio"]';

/**
 * A button that opens a short menu. Arrow keys move through it, and Home and End go to its ends. Escape, a
 * click anywhere else or a choice closes it, and the focus goes back to the button. Each item is given
 * `close`, and has the role of a menu item, with a tabIndex of -1.
 */
export function MenuButton(props: { label: string; menuLabel: string; buttonClass: string; class?: string; children: (close: () => void) => ComponentChildren }): preact.JSX.Element {
	const [open, setOpen] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	const button = useRef<HTMLButtonElement>(null);
	const from = useRef<"first" | "last">("first");
	const id = useId();
	const items = (): HTMLElement[] => [...(box.current?.querySelectorAll<HTMLElement>(menuItems) ?? [])];
	const focusItem = (): void => {
		const list = items();
		(from.current === "last" ? list.at(-1) : list[0])?.focus();
	};
	const close = (): void => {
		setOpen(false);
		button.current?.focus();
	};
	useLayoutEffect(() => {
		if (!open) {
			return undefined;
		}
		focusItem();
		const away = (e: Event): void => {
			if (!box.current?.contains(e.target as globalThis.Node)) {
				setOpen(false);
				// Whatever was clicked can take the focus, and if it doesn't, the button has it back.
				setTimeout(() => {
					if (document.activeElement === null || document.activeElement === document.body) {
						button.current?.focus({ preventScroll: true });
					}
				}, 0);
			}
		};
		document.addEventListener("pointerdown", away);
		return () => { document.removeEventListener("pointerdown", away); };
	}, [open]);
	const openAt = (end: "first" | "last"): void => {
		from.current = end;
		if (open) {
			focusItem();
		} else {
			setOpen(true);
		}
	};
	const keys = (e: KeyboardEvent): void => {
		const list = items();
		const i = list.indexOf(document.activeElement as HTMLElement);
		const n = list.length;
		const next = e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowUp" ? (i + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
		if (next >= 0 && n > 0) {
			e.preventDefault();
			list[next]!.focus();
		} else if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			close();
		} else if (e.key === "Tab") {
			// The focus goes on to what's next, and the menu closes behind it.
			setOpen(false);
		}
	};
	return (
		<div class={`menu-box${props.class !== undefined ? ` ${props.class}` : ""}`} ref={box}>
			<button ref={button} type="button" class={props.buttonClass} aria-haspopup="menu" aria-expanded={open ? "true" : "false"} aria-controls={open ? id : undefined}
				onClick={() => {
					if (open) {
						setOpen(false);
					} else {
						openAt("first");
					}
				}}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown" || e.key === "ArrowUp") {
						e.preventDefault();
						openAt(e.key === "ArrowUp" ? "last" : "first");
					} else if (e.key === "Escape" && open) {
						setOpen(false);
					}
				}}>{props.label}</button>
			{open ? <div id={id} class="menu-items" role="menu" aria-label={props.menuLabel} onKeyDown={keys}>{props.children(close)}</div> : null}
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
	downloadBlob(name, new Blob([text], { type }));
}

export function downloadBlob(name: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
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
