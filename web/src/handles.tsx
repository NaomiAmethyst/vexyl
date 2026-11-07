// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Basic's handles, over the flag, in the flag's own coordinates. What's drawn here moves at once, from
// edits applied locally to the nodes, and the same edits go on to the file as fast as it can take them.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useApp } from "./common.js";
import { chargeMover, handlesOf, movableCharges, type Handle, type Mover, type Point, type Step } from "./flagdrag.js";
import { flagRegion, withOps } from "./flagview.js";
import { largestGrid } from "./grid.js";
import type { ONode, Op } from "./protocol.js";
import { app, type FormImage } from "./store.js";

/** How far a pointer goes before it's a drag and not a click, in pixels. */
const dragFrom = 4;
/** A nudge is one unit of a 60-high grid, or five with Shift. */
const nudgeShare = 1 / 60;

function viewBoxOf(image: FormImage): { x: number; y: number; w: number; h: number } | null {
	const text = image.pick?.a.find(([k]) => k === "viewBox")?.[1];
	const [x, y, w, h] = (text ?? "").split(/\s+/).map(Number);
	return w !== undefined && h !== undefined && x !== undefined && y !== undefined && w > 0 && h > 0 ? { x, y, w, h } : null;
}

const arrows: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** What's over the flag while Basic's Design tab is showing. */
export function Handles(props: { image: FormImage; nodes: readonly ONode[]; stackAt: (x: number, y: number) => string[] }): preact.JSX.Element | null {
	const [s] = useApp();
	const root = useRef<HTMLDivElement>(null);
	const [live, setLive] = useState<{ ops: Op[]; across?: number; down?: number } | null>(null);
	const [readout, setReadout] = useState("");
	const dragging = useRef(false);
	const nudges = useRef(0);
	const readoutTimer = useRef<ReturnType<typeof setTimeout>>();
	const nodes = useMemo(() => (live === null ? props.nodes : withOps(props.nodes, live.ops)), [props.nodes, live]);
	// What's drawn stays as it was dropped until the file has caught up, so that it doesn't jump back.
	useEffect(() => {
		if (live !== null && !dragging.current && nudges.current === 0 && !s.gesturing && s.analyzed === s.text) {
			setLive(null);
		}
	}, [live, s.gesturing, s.analyzed, s.text]);
	useEffect(() => () => { clearTimeout(readoutTimer.current); }, []);
	const box = viewBoxOf(props.image);
	const flag = flagRegion(nodes);
	if (box === null || flag === null) {
		return null;
	}
	// A very large grid is drawn on a smaller one, but the file and these handles keep its own numbers.
	const side = Math.max(flag.w, flag.h);
	const k = side > largestGrid ? 1000 / side : 1;
	const left = (x: number): number => ((x * k - box.x) / box.w) * 100;
	const top = (y: number): number => ((y * k - box.y) / box.h) * 100;
	const across = (w: number): number => ((w * k) / box.w) * 100;
	const down = (h: number): number => ((h * k) / box.h) * 100;
	const pointOf = (e: PointerEvent): Point => {
		const r = root.current!.getBoundingClientRect();
		return { x: (box.x + ((e.clientX - r.left) / r.width) * box.w) / k, y: (box.y + ((e.clientY - r.top) / r.height) * box.h) / k };
	};
	/** Follows a pointer from here until it's let go, once it's gone far enough to be a drag. */
	const begin = (e: PointerEvent, path: string, mover: Mover): void => {
		if (e.button !== 0 || !e.isPrimary) {
			return;
		}
		const start = pointOf(e);
		const [startX, startY] = [e.clientX, e.clientY];
		const gesture = { current: null as ReturnType<typeof app.startGesture> | null };
		const stop = (): void => {
			removeEventListener("pointermove", move);
			removeEventListener("pointerup", up);
			removeEventListener("pointercancel", cancel);
			removeEventListener("keydown", escape, true);
			dragging.current = false;
			setReadout("");
		};
		const show = (step: Step): void => {
			setLive({ ops: step.ops, ...(step.across !== undefined ? { across: step.across } : {}), ...(step.down !== undefined ? { down: step.down } : {}) });
			setReadout(step.readout);
			gesture.current!.push(step.ops);
		};
		const move = (ev: PointerEvent): void => {
			if (ev.pointerId !== e.pointerId) {
				return;
			}
			if (gesture.current === null) {
				if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < dragFrom) {
					return;
				}
				dragging.current = true;
				gesture.current = app.startGesture();
				app.select(path, false);
			}
			ev.preventDefault();
			show(mover(start, pointOf(ev), ev.altKey));
		};
		const up = (ev: PointerEvent): void => {
			if (ev.pointerId !== e.pointerId) {
				return;
			}
			const g = gesture.current;
			stop();
			if (g !== null) {
				// The click this ends in isn't a click.
				const stage = root.current?.parentElement;
				const swallow = (c: Event): void => {
					if (stage?.contains(c.target as globalThis.Node) === true) {
						c.stopPropagation();
					}
				};
				addEventListener("click", swallow, { capture: true, once: true });
				setTimeout(() => { removeEventListener("click", swallow, { capture: true }); }, 120);
				setLive((l) => (l === null ? l : { ops: l.ops }));
				void g.finish();
			}
		};
		const cancel = (): void => {
			const g = gesture.current;
			stop();
			if (g !== null) {
				void g.cancel().then(() => { setLive(null); });
			}
		};
		const escape = (ev: KeyboardEvent): void => {
			if (ev.key === "Escape") {
				ev.stopPropagation();
				cancel();
			}
		};
		addEventListener("pointermove", move);
		addEventListener("pointerup", up);
		addEventListener("pointercancel", cancel);
		addEventListener("keydown", escape, true);
	};
	/** A pointer put down on a symbol picks it up, as found in the tagged render, so only the symbol itself does. */
	const grab = (e: PointerEvent): void => {
		const path = props.stackAt(e.clientX, e.clientY)[0];
		const mover = path === undefined ? null : chargeMover(path, nodes);
		if (path !== undefined && mover !== null) {
			begin(e, path, mover);
		}
	};
	const nudge = (e: KeyboardEvent, h: Handle, path: string): void => {
		const dir = arrows[e.key];
		if (dir === undefined) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		const by = flag.h * nudgeShare * (e.shiftKey ? 5 : 1);
		const step = h.mover({ x: h.x, y: h.y }, { x: h.x + dir[0] * by, y: h.y + dir[1] * by }, true);
		app.select(path, false);
		setLive((l) => ({ ops: [...(l?.ops ?? []), ...step.ops] }));
		setReadout(step.readout);
		clearTimeout(readoutTimer.current);
		readoutTimer.current = setTimeout(() => { setReadout(""); }, 1400);
		nudges.current++;
		void app.edit(step.ops).then(() => { nudges.current--; });
	};
	const selected = s.selected;
	const handles = selected === null ? [] : handlesOf(selected, nodes);
	const zones = movableCharges(nodes);
	return (
		<div class="handles" ref={root} onPointerDown={grab}>
			{zones.map((z) => <span key={z.path} class="grab-zone" aria-hidden="true" style={{ left: `${left(z.x - z.reach)}%`, top: `${top(z.y - z.reach)}%`, width: `${across(2 * z.reach)}%`, height: `${down(2 * z.reach)}%` }} />)}
			{live?.across !== undefined ? <span class="guide guide-down" aria-hidden="true" style={{ left: `${left(live.across)}%` }} /> : null}
			{live?.down !== undefined ? <span class="guide guide-across" aria-hidden="true" style={{ top: `${top(live.down)}%` }} /> : null}
			{handles.map((h) => {
				const key = (e: KeyboardEvent): void => { nudge(e, h, selected!); };
				const quiet = (e: MouseEvent): void => {
					// Pressing Enter on a handle clicks it, which isn't a click on the flag.
					if (h.look !== "move" || e.detail === 0) {
						e.stopPropagation();
					}
				};
				if (h.look === "move" && h.span !== undefined) {
					const origin = `${((h.x - h.span.x) / h.span.w) * 100}% ${((h.y - h.span.y) / h.span.h) * 100}%`;
					return <button key={h.id} type="button" class="handle-box" aria-label={h.label} title={h.label} onKeyDown={key} onClick={quiet} style={{ left: `${left(h.span.x)}%`, top: `${top(h.span.y)}%`, width: `${across(h.span.w)}%`, height: `${down(h.span.h)}%`, transform: h.turn ? `rotate(${h.turn}deg)` : undefined, transformOrigin: origin }} />;
				}
				const place = h.look === "dot" ? { left: `${left(h.x)}%`, top: `${top(h.y)}%` }
					: h.look === "across" ? { left: `${left(h.span!.x)}%`, width: `${across(h.span!.w)}%`, top: `${top(h.y)}%` }
						: { top: `${top(h.span!.y)}%`, height: `${down(h.span!.h)}%`, left: `${left(h.x)}%` };
				const start = (e: PointerEvent): void => {
					e.stopPropagation();
					begin(e, selected!, h.mover);
				};
				return <button key={h.id} type="button" class={`handle handle-${h.look}`} aria-label={h.label} title={h.label} onPointerDown={start} onKeyDown={key} onClick={quiet} style={{ ...place, cursor: h.cursor }}><span aria-hidden="true" /></button>;
			})}
			<span class={`readout${readout === "" ? " empty" : ""}`} role="status">{readout}</span>
		</div>
	);
}
