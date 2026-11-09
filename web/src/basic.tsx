// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// The Basic editor's panel: what's on the flag, what can be added, and the controls of what's selected.
// It changes the same file as Advanced, in the same way, and leaves alone whatever it has no control for.

import { useEffect, useRef, useState } from "preact/hooks";
import { BasicDetails } from "./basicdetails.js";
import { Seg, useApp } from "./common.js";
import { addOps, blockColorOp, colorOp, layerSiblings, moveOps, newColorOp, pointsOps, repeatOps, sizeOps, sizeShare, stripesOps, turnOps, whereText, placeOps, widthsOnGrid } from "./flagdrag.js";
import { blockRegion, colorsOf, findLayer, hasControls, kid, numOf, ownField, prop, readBars, readCharge, readFlag, regionOf, vNum, vStr, type AlsoItem, type BarsView, type ChargeView, type Item, type Region } from "./flagview.js";
import { write } from "./exact.js";
import { colorUses, replacementsFor, unusedColors } from "./colors.js";
import { addGroups, cornerNames, plainName, sideNames, usedByText } from "./plain.js";
import type { ONode, Op } from "./protocol.js";
import { exactly, onGrid, readAmount, readTurn, shareText, snapFraction, turnFraction, turnPeriod, turnsFor, turnText, type Snapped } from "./snap.js";
import { app, type Gesture } from "./store.js";
import { TermArt } from "./termart.js";

const edit = (...ops: Op[]): void => {
	void app.edit(ops);
};

/** A slider's edits, as one thing to undo, for as long as it's being held. */
function useLive(): { value: number | null; slide: (v: number, ops: Op[]) => void; release: () => void } {
	const [s] = useApp();
	const [value, setValue] = useState<number | null>(null);
	const gesture = useRef<Gesture | null>(null);
	useEffect(() => {
		if (value !== null && gesture.current === null && !s.gesturing && s.analyzed === s.text) {
			setValue(null);
		}
	}, [value, s.gesturing, s.analyzed, s.text]);
	useEffect(() => () => { void gesture.current?.finish(); }, []);
	return {
		value,
		slide: (v, ops) => {
			setValue(v);
			gesture.current ??= app.startGesture();
			gesture.current.push(ops);
		},
		release: () => {
			const g = gesture.current;
			gesture.current = null;
			void g?.finish();
		},
	};
}

/** What's being done to the palette, shared by each row of swatches in one set of controls. */
interface ColorEdit {
	on: boolean;
	/** The color whose value is being changed. */
	changing: string | null;
	/** A color in use that's being removed, which needs another in its place. */
	replacing: string | null;
	set(patch: Partial<Omit<ColorEdit, "set">>): void;
}

function useColorEdit(): ColorEdit {
	const [state, setState] = useState({ on: false, changing: null as string | null, replacing: null as string | null });
	return { ...state, set: (patch) => { setState((was) => ({ ...was, ...patch })); } };
}

/** Takes a color out at once if nothing uses it, and otherwise asks what's to take its place. */
function removeColor(edit: ColorEdit, nodes: readonly ONode[], name: string): void {
	if (colorUses(nodes, name).length === 0) {
		edit.set({ changing: null, replacing: null });
		void app.edit([{ op: "removeColor", name }]);
	} else {
		edit.set({ changing: null, replacing: name });
	}
}

/** The palette's colors, each to change or remove. */
function PaletteSwatches(props: { edit: ColorEdit; nodes: readonly ONode[]; small?: boolean }): preact.JSX.Element {
	const { edit, nodes } = props;
	const colors = colorsOf(nodes);
	const names = nodes.find((n) => n.name === "palette")?.kids.map((k) => k.name) ?? [];
	return (
		<>
			{names.map((name) => (
				<span key={name} class="swatch-edit">
					<button type="button" class={`swatch-pick${props.small === true ? " small" : ""}${edit.changing === name ? " on" : ""}`} data-color={name} aria-label={`Change ${name}`} aria-pressed={edit.changing === name ? "true" : "false"} title={`Change ${name}`} style={{ background: colors.get(name) ?? "transparent" }} onClick={() => { edit.set({ changing: edit.changing === name ? null : name, replacing: null }); }} />
					<button type="button" class="swatch-x" aria-label={`Remove ${name}`} title={`Remove ${name}`} onClick={() => { removeColor(edit, nodes, name); }}><span aria-hidden="true">×</span></button>
				</span>
			))}
		</>
	);
}

/** Colors as round swatches, with a way to make a new one. While colors are being edited, a row of its own has each to change or remove. */
function Swatches(props: { label: string; value: string; nodes: readonly ONode[]; small?: boolean; edit?: ColorEdit; onPick: (color: string, ...more: Op[]) => void }): preact.JSX.Element {
	const { nodes, value, edit } = props;
	const [adding, setAdding] = useState(false);
	const [hex, setHex] = useState("#3a7bd5");
	const colors = colorsOf(nodes);
	const names = nodes.find((n) => n.name === "palette")?.kids.map((k) => k.name) ?? [];
	const all = value !== "" && !names.includes(value) ? [value, ...names] : names;
	if (edit?.on === true && props.small !== true) {
		return (
			<div class="swatches" role="group" aria-label={`${props.label}: the colors to edit`}>
				<PaletteSwatches edit={edit} nodes={nodes} />
				<EditColorsButton edit={edit} />
			</div>
		);
	}
	return (
		<div class="swatches" role="group" aria-label={props.label}>
			{all.map((name) => (
				<button key={name} type="button" class={`swatch-pick${props.small === true ? " small" : ""}${name === value ? " on" : ""}${name === "none" ? " gap" : ""}`} data-color={name} aria-label={name === "none" ? "No color, a gap" : name} aria-pressed={name === value ? "true" : "false"} title={name} style={name === "none" ? undefined : { background: colors.get(name) ?? "transparent" }} onClick={() => { props.onPick(name); }} />
			))}
			{adding ? (
				<span class="new-swatch">
					<input type="color" class="color-well" aria-label={`New color for ${props.label.toLowerCase()}`} value={hex} onInput={(e) => { setHex((e.currentTarget as HTMLInputElement).value); }} />
					<button type="button" class="nx-btn small" onClick={() => {
						const made = newColorOp(hex, nodes);
						setAdding(false);
						if (made !== null) {
							props.onPick(made.name, made.op);
						}
					}}>Add this color</button>
					<button type="button" class="nx-ghost small" onClick={() => { setAdding(false); }}>Cancel</button>
				</span>
			) : props.small === true ? <button type="button" class="row-act new-small" aria-label={`New color for ${props.label.toLowerCase()}`} title="New color" onClick={() => { setAdding(true); }}>+</button>
				: <button type="button" class="nx-ghost small" onClick={() => { setAdding(true); }}>New color</button>}
			{edit !== undefined && props.small !== true && !adding ? <EditColorsButton edit={edit} /> : null}
		</div>
	);
}

function EditColorsButton(props: { edit: ColorEdit }): preact.JSX.Element {
	const { edit } = props;
	return <button type="button" class="nx-ghost small" aria-pressed={edit.on ? "true" : "false"} onClick={() => { edit.set({ on: !edit.on, changing: null, replacing: null }); }}>{edit.on ? "Done editing colors" : "Edit colors"}</button>;
}

/** A palette color's value, changed by seeing it, as one thing to undo however long it's dragged around. */
function ChangeColor(props: { entry: ONode }): preact.JSX.Element {
	const { entry } = props;
	const live = useLive();
	const [shown, setShown] = useState<string | null>(null);
	const hex = shown ?? String(entry.args[0]?.v ?? "");
	useEffect(() => {
		if (live.value === null) {
			setShown(null);
		}
	}, [live.value]);
	if (entry.args[0]?.v === "gradient") {
		return <p class="nx-note">{entry.name} is a gradient between other colors. Change it by changing them, or in Advanced.</p>;
	}
	return (
		<div class="change-color">
			<input type="color" class="color-well" id={`b-color-${entry.at.join("-")}`} aria-label={`Color of ${entry.name}`} value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : "#000000"} onInput={(e) => {
				const v = (e.currentTarget as HTMLInputElement).value;
				setShown(v);
				live.slide(1, [{ op: "entries", at: entry.at, args: [vStr(v)] }]);
			}} onChange={live.release} />
			<label class="share-value" for={`b-color-${entry.at.join("-")}`}>{entry.name} {hex}</label>
		</div>
	);
}

/** What's below the swatches while colors are being edited: changing one, replacing one, and tidying up. */
function ColorTools(props: { edit: ColorEdit; nodes: readonly ONode[]; palette?: boolean }): preact.JSX.Element | null {
	const { edit, nodes } = props;
	if (!edit.on) {
		return null;
	}
	const colors = colorsOf(nodes);
	const palette = nodes.find((n) => n.name === "palette")?.kids ?? [];
	const changing = palette.find((k) => k.name === edit.changing);
	const replacing = edit.replacing !== null && palette.some((k) => k.name === edit.replacing) ? edit.replacing : null;
	const unused = unusedColors(nodes);
	const others = replacing === null ? [] : replacementsFor(nodes, replacing);
	return (
		<div class="color-tools">
			{props.palette === true ? <div class="swatches" role="group" aria-label="The colors to edit"><PaletteSwatches edit={edit} nodes={nodes} small /></div> : null}
			{replacing !== null ? (
				<div class="replace-color" role="group" aria-label={`Replace ${replacing}`}>
					<p class="plain">Used by {usedByText(colorUses(nodes, replacing))}. {others.length > 0 ? "Replace it with:" : "There's no other color that can take its place, so add one first."}</p>
					<div class="swatches">
						{others.map((name) => (
							<button key={name} type="button" class="swatch-pick small" data-color={name} aria-label={`Replace it with ${name}`} title={name} style={{ background: colors.get(name) ?? "transparent" }} onClick={() => {
								edit.set({ replacing: null });
								void app.edit([{ op: "removeColor", name: replacing, to: name }]);
							}} />
						))}
						<button type="button" class="nx-ghost small" onClick={() => { edit.set({ replacing: null }); }}>Cancel</button>
					</div>
				</div>
			) : changing !== undefined ? <ChangeColor key={changing.name} entry={changing} /> : <p class="nx-note">Choose a color to change it, or × to remove it.</p>}
			<div class="panel-actions">
				<button type="button" class="nx-ghost small" disabled={unused.length === 0} onClick={() => {
					edit.set({ changing: null, replacing: null });
					void app.edit(unused.map((name) => ({ op: "removeColor", name })));
				}}>{unused.length === 0 ? "No unused colors" : `Remove unused colors (${unused.length})`}</button>
			</div>
		</div>
	);
}

function ColorRow(props: { label: string; value: string; nodes: readonly ONode[]; onPick: (color: string, ...more: Op[]) => void }): preact.JSX.Element {
	const edit = useColorEdit();
	return (
		<div class="field">
			<span class="nx-label">{props.label}</span>
			<Swatches label={props.label} value={props.value} nodes={props.nodes} edit={edit} onPick={props.onPick} />
			<ColorTools edit={edit} nodes={props.nodes} />
		</div>
	);
}

/** A size, as a slider and a box that takes fractions, shown as a share of what it's measured against. */
export function SizeField(props: { id: string; label: string; share: number; of: string; max: number; min?: number; extra?: string; opsFor: (s: Snapped) => Op[] }): preact.JSX.Element {
	const { id, label, share, of, max } = props;
	const min = props.min ?? 0.01;
	const live = useLive();
	const [draft, setDraft] = useState<string | null>(null);
	const [bad, setBad] = useState(false);
	const shown = live.value ?? share;
	const commit = (): void => {
		if (draft === null) {
			return;
		}
		const typed = readAmount(draft);
		setDraft(null);
		if (typed === null || typed.v <= 0) {
			setBad(draft.trim() !== "");
			return;
		}
		setBad(false);
		edit(...props.opsFor(typed.v > max || typed.v < min ? snapFraction(Math.min(max, Math.max(min, typed.v))) : typed));
	};
	return (
		<div class="field">
			<label class="nx-label" for={id}>{label}</label>
			<div class="slide-row">
				<input type="range" aria-label={label} aria-valuetext={`${shareText(shown)} of the ${of}`} min={min} max={max} step="0.001" value={Math.min(max, shown)} onInput={(e) => {
					const s = snapFraction(Number((e.currentTarget as HTMLInputElement).value), false, 0.006);
					setDraft(null);
					live.slide(s.v, props.opsFor(s));
				}} onChange={live.release} />
				<input id={id} class="nx-input share-box" placeholder="e.g. 1/4" spellcheck={false} value={draft ?? shareText(shown)} aria-invalid={bad ? "true" : undefined} onInput={(e) => { setDraft((e.currentTarget as HTMLInputElement).value); setBad(false); }} onBlur={commit} onKeyDown={(e) => {
					if (e.key === "Enter") {
						commit();
					} else if (e.key === "Escape") {
						setDraft(null);
					}
				}} />
			</div>
			{bad ? <span class="nx-error" role="alert">That needs to be a fraction, like 1/3.</span> : null}
			<span class="nx-note">{shareText(shown)} of the {of}{props.extra !== undefined ? `, ${props.extra}` : ""}. Type a fraction, like 1/3.</span>
		</div>
	);
}

const spots: readonly (readonly [string, number, number])[] = [
	["Top left", 1, 1], ["Top middle", 2, 1], ["Top right", 3, 1],
	["Middle left", 1, 2], ["Middle", 2, 2], ["Middle right", 3, 2],
	["Bottom left", 1, 3], ["Bottom middle", 2, 3], ["Bottom right", 3, 3],
];

/** Nine places a symbol can go, each a quarter, a half or three quarters of the way. */
function WhereItGoes(props: { c: ChargeView }): preact.JSX.Element {
	const { c } = props;
	const at = c.at!;
	const r = c.region;
	const on = (n: number, v: number, size: number): boolean => Math.abs(v / size - n / 4) < 0.001;
	return (
		<div class="where">
			<div class="field">
				<span class="nx-label">Where it goes</span>
				<div class="spots" role="group" aria-label="Snap to a spot on the flag">
					{spots.map(([label, x, y]) => (
						<button key={label} type="button" class={`spot${on(x, at.x, r.w) && on(y, at.y, r.h) ? " on" : ""}`} aria-label={label} aria-pressed={on(x, at.x, r.w) && on(y, at.y, r.h) ? "true" : "false"} onClick={() => { edit(...placeOps(c, exactly(x, 4), exactly(y, 4))); }}><span aria-hidden="true" /></button>
					))}
				</div>
			</div>
			<div class="where-note">
				<span class="share-value">{whereText(r, at.x / r.w, at.y / r.h)}</span>
				<span class="nx-note">Drag it on the flag. It snaps to simple fractions, and to the edges of stripes and blocks. Hold Alt to place it freely.</span>
			</div>
		</div>
	);
}

/** Turning, in turns, as far as it makes any difference to how it looks. */
function Turn(props: { c: ChargeView; period: number; id: string }): preact.JSX.Element {
	const { c, period, id } = props;
	const live = useLive();
	const [draft, setDraft] = useState<string | null>(null);
	const [bad, setBad] = useState(false);
	const shown = live.value ?? c.rotate;
	const pointed = c.shape === "star" || c.shape === "sun" || c.shape === "triangle" ? (c.shape === "triangle" ? 3 : c.points) : null;
	const turns = turnsFor(period, pointed);
	const commit = (): void => {
		if (draft === null) {
			return;
		}
		const deg = readTurn(draft);
		setDraft(null);
		if (deg === null) {
			setBad(draft.trim() !== "");
			return;
		}
		setBad(false);
		edit(...turnOps(c, deg));
	};
	const whole = Math.round(360 / period);
	return (
		<div class="field">
			<label class="nx-label" for={id}>Turn</label>
			<div class="turn-buttons">
				{turns.map((t) => <button key={t.deg} type="button" class={`nx-chip turn${Math.abs(shown - t.deg) < 0.01 ? " on" : ""}`} aria-pressed={Math.abs(shown - t.deg) < 0.01 ? "true" : "false"} onClick={() => { setDraft(null); edit(...turnOps(c, t.deg)); }}>{t.label}</button>)}
			</div>
			<div class="slide-row">
				<input type="range" aria-label="Turn" aria-valuetext={turnText(shown)} min="0" max={period} step="0.5" value={Math.min(period, Math.max(0, shown))} onInput={(e) => {
					const raw = Number((e.currentTarget as HTMLInputElement).value);
					const near = turns.find((t) => Math.abs(t.deg - raw) < 1.5);
					const deg = near?.deg ?? raw;
					setDraft(null);
					live.slide(deg, turnOps(c, deg));
				}} onChange={live.release} />
				<input id={id} class="nx-input share-box" placeholder="e.g. 1/8" spellcheck={false} value={draft ?? (shown === 0 ? "0" : turnFraction(shown))} aria-invalid={bad ? "true" : undefined} onInput={(e) => { setDraft((e.currentTarget as HTMLInputElement).value); setBad(false); }} onBlur={commit} onKeyDown={(e) => {
					if (e.key === "Enter") {
						commit();
					} else if (e.key === "Escape") {
						setDraft(null);
					}
				}} />
			</div>
			{bad ? <span class="nx-error" role="alert">That needs to be a fraction of a turn, like 1/8, or degrees, like 45.</span> : null}
			<span class="nx-note"><span class="share-value">{turnText(shown)}</span>{whole > 1 ? `. Past 1/${whole} turn it looks the same, so that's as far as this goes.` : ""}</span>
		</div>
	);
}

/** A whole number, written once it's been typed. */
function CountBox(props: { id: string; label: string; value: number; min: number; max: number; onSet: (n: number) => void }): preact.JSX.Element {
	const [draft, setDraft] = useState<string | null>(null);
	const commit = (): void => {
		if (draft === null) {
			return;
		}
		const n = Math.round(Number(draft));
		setDraft(null);
		if (draft.trim() !== "" && Number.isFinite(n)) {
			props.onSet(Math.min(props.max, Math.max(props.min, n)));
		}
	};
	return (
		<div class="field">
			<label class="nx-label" for={props.id}>{props.label}</label>
			<input id={props.id} class="nx-input count-box" inputMode="numeric" value={draft ?? String(props.value)} onInput={(e) => { setDraft((e.currentTarget as HTMLInputElement).value); }} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { commit(); } }} />
		</div>
	);
}

function HowMany(props: { c: ChargeView; id: string }): preact.JSX.Element {
	const { c, id } = props;
	const repeat = kid(c.node, "repeat");
	const setProp = (name: string) => (n: number): void => { edit({ op: "child", at: c.node.at, name: "repeat", props: [[name, vNum(String(n))]] }); };
	if (c.form !== "one" && c.form !== "grid" && c.form !== "ring") {
		return <p class="nx-note">{`These are arranged along ${c.form === "line" ? "a line" : "an arc"}, which stays as it is.`}</p>;
	}
	if (c.written === "many") {
		return <p class="nx-note">This symbol is in several places at once. Each one stays where it is, and they can be moved in Advanced.</p>;
	}
	return (
		<div class="stack">
			<div class="field">
				<span class="nx-label">How many</span>
				<Seg class="self-start" label="How many copies" value={c.form} options={[["one", "Just one"], ["grid", "Grid"], ["ring", "Ring"]]} onPick={(v) => { edit(...repeatOps(c, v as "one" | "grid" | "ring")); }} />
			</div>
			{c.form === "grid" ? (
				<div class="inline-fields">
					<CountBox id={`${id}-rows`} label="Rows" value={numOf(prop(repeat, "rows"))} min={1} max={50} onSet={setProp("rows")} />
					<CountBox id={`${id}-columns`} label="Columns" value={numOf(prop(repeat, "columns"))} min={1} max={50} onSet={setProp("columns")} />
				</div>
			) : null}
			{c.form === "ring" ? (
				<>
					<CountBox id={`${id}-count`} label="How many in the ring" value={numOf(prop(repeat, "count"))} min={1} max={100} onSet={setProp("count")} />
					<SizeField id={`${id}-ring`} label="Size of the ring" share={c.ringRadius / c.region.h} of="height" max={0.5} opsFor={(s) => [{ op: "child", at: c.node.at, name: "repeat", props: [["radius", vNum(onGrid(s, c.region.hText))]] }]} />
				</>
			) : null}
		</div>
	);
}

const sizeWords: Readonly<Record<string, string>> = { star: "from its center to a point", disc: "from its center to its edge", ring: "from its center to its edge", plus: "from its center to the end of an arm", triangle: "from its center to a point", sun: "from its center to a ray's tip", crescent: "from its center to its edge" };

function ChargeControls(props: { item: Item; nodes: readonly ONode[] }): preact.JSX.Element {
	const { item, nodes } = props;
	const c = readCharge(item.node, nodes)!;
	const id = `b-${item.node.at.join("-")}`;
	const arcShape = kid(c.node, "from") !== undefined || kid(c.node, "to") !== undefined;
	const period = turnPeriod(c.shape, c.points, arcShape);
	const live = useLive();
	const points = live.value ?? c.points ?? 5;
	// A star drawn in lines needs at least five points.
	const fewest = kid(c.node, "lines") !== undefined ? 5 : 3;
	return (
		<>
			<ColorRow label="Color" value={String(c.node.args[1]?.v ?? "")} nodes={nodes} onPick={(color, ...more) => { edit(colorOp(c.node, 1, color), ...more); }} />
			<SizeField id={`${id}-size`} label="Size" share={sizeShare(c)} of={c.region.holder === null ? "height" : "block's height"} max={c.boxed ? 1 : 0.5} {...(sizeWords[c.shape] !== undefined ? { extra: sizeWords[c.shape] } : {})} opsFor={(s) => sizeOps(c, s)} />
			{c.at !== null ? <WhereItGoes c={c} /> : null}
			{period !== null ? <Turn c={c} period={period} id={`${id}-turn`} /> : null}
			{c.shape === "star" ? (
				<div class="field">
					<label class="nx-label" for={`${id}-points`}>Points</label>
					<input id={`${id}-points`} type="range" min={fewest} max="16" step="1" value={points} aria-valuetext={`${points} points`} onInput={(e) => {
						const n = Number((e.currentTarget as HTMLInputElement).value);
						live.slide(n, pointsOps(c, n));
					}} onChange={live.release} />
					<span class="nx-note">{points} points</span>
				</div>
			) : null}
			<HowMany c={c} id={id} />
		</>
	);
}

/** How a list of stripes runs, in words that leave a slanted one as it is. */
function Direction(props: { node: ONode; along: string }): preact.JSX.Element {
	const { node, along } = props;
	const options: (readonly [string, string])[] = [["fly", "Horizontal"], ["hoist", "Vertical"]];
	if (along !== "fly" && along !== "hoist") {
		options.push([along, "Diagonal"]);
	}
	return (
		<div class="field">
			<span class="nx-label">Direction</span>
			<Seg class="self-start" label="Direction" value={along} options={options} onPick={(v) => {
				edit(v === "fly" ? { op: "dropChild", at: node.at, name: "along" } : { op: "child", at: node.at, name: "along", args: [vStr(v)] });
			}} />
		</div>
	);
}

function barShares(b: BarsView): number[] {
	const widths = b.widths.map(Number);
	const total = widths.reduce((s, x) => s + x, 0);
	return widths.map((w) => w / total);
}

function BarsControls(props: { b: BarsView; r: Region; nodes: readonly ONode[] }): preact.JSX.Element {
	const { b, r, nodes } = props;
	const shares = barShares(b);
	const hasRatio = kid(b.node, "ratio") !== undefined;
	const fixed = kid(b.node, "grow") !== undefined;
	const axis = b.along === "hoist" ? r.wText : r.hText;
	const setColor = (i: number, color: string, more: Op[]): void => {
		const colors = [...b.colors];
		colors[i] = vStr(color);
		edit(...(b.counted ? stripesOps(b, colors, null) : [colorOp(b.node, i, color)]), ...more);
	};
	const addStripe = (): void => {
		const last = String(b.colors.at(-1)?.v ?? "");
		const other = b.colors.find((o) => o.v !== last) ?? b.colors[0]!;
		const ratio = hasRatio ? [...widthsOnGrid(b, axis).map((f) => write(f).text), onGrid({ v: 1 / b.colors.length, kind: "free" }, axis)] : null;
		edit(...stripesOps(b, [...b.colors, other], ratio));
	};
	const removeStripe = (i: number): void => {
		const colors = b.colors.filter((_, j) => j !== i);
		edit(...stripesOps(b, colors, hasRatio ? b.widths.filter((_, j) => j !== i) : null));
	};
	const colorEdit = useColorEdit();
	return (
		<>
			<Direction node={b.node} along={b.along} />
			<div class="field">
				<span class="nx-label">Colors</span>
				<div class="stack">
					{b.colors.map((o, i) => (
						<div class="stripe-row" key={i}>
							<span class="stripe-name">Stripe {i + 1}, {shareText(shares[i]!)}</span>
							<Swatches label={`Stripe ${i + 1}`} value={String(o.v)} nodes={nodes} small edit={colorEdit} onPick={(color, ...more) => { setColor(i, color, more); }} />
							{!fixed && b.colors.length > 1 ? <button type="button" class="row-act" aria-label={`Remove stripe ${i + 1}`} title="Remove this stripe" onClick={() => { removeStripe(i); }}>×</button> : null}
						</div>
					))}
				</div>
				<div class="panel-actions">
					{!fixed ? <button type="button" class="nx-ghost small" onClick={addStripe}>Add a stripe</button> : null}
					<button type="button" class="nx-ghost small" disabled={!hasRatio} onClick={() => { edit({ op: "dropChild", at: b.node.at, name: "ratio" }); }}>Make them equal</button>
					<EditColorsButton edit={colorEdit} />
				</div>
				<ColorTools edit={colorEdit} nodes={nodes} palette />
			</div>
			{b.along === "fly" || b.along === "hoist" ? <p class="nx-note">Drag the lines between stripes on the flag. They snap to simple fractions, and Alt places them freely.</p> : null}
		</>
	);
}

/** Several colors, one to a row, for things that divide the flag. */
function ColorList(props: { node: ONode; labels?: readonly string[]; nodes: readonly ONode[] }): preact.JSX.Element {
	const { node, labels, nodes } = props;
	const colorEdit = useColorEdit();
	return (
		<div class="field">
			<span class="nx-label">Colors</span>
			<div class="stack">
				{node.args.map((o, i) => (
					<div class="stripe-row" key={i}>
						<span class="stripe-name">{labels?.[i] ?? `Color ${i + 1}`}</span>
						<Swatches label={labels?.[i] ?? `Color ${i + 1}`} value={String(o.v)} nodes={nodes} small edit={colorEdit} onPick={(color, ...more) => { edit(colorOp(node, i, color), ...more); }} />
					</div>
				))}
			</div>
			<div class="panel-actions"><EditColorsButton edit={colorEdit} /></div>
			<ColorTools edit={colorEdit} nodes={nodes} palette />
		</div>
	);
}

/** Which side something comes in from. */
function FromSide(props: { node: ONode }): preact.JSX.Element {
	const { node } = props;
	const value = String(kid(node, "from")?.args[0]?.v ?? "hoist");
	return (
		<div class="field">
			<span class="nx-label">Comes from</span>
			<Seg class="self-start" label="Comes from" value={value} options={sideNames} onPick={(v) => { edit(v === "hoist" ? { op: "dropChild", at: node.at, name: "from" } : { op: "child", at: node.at, name: "from", args: [vStr(v)] }); }} />
		</div>
	);
}

/** A size written as a single number on the grid. */
function ChildSize(props: { node: ONode; child: string; label: string; size: string; of: string; max: number; note?: string; region: number }): preact.JSX.Element {
	const { node, child: name, label, size, of, max, region } = props;
	return <SizeField id={`b-${node.at.join("-")}-${name}`} label={label} share={numOf(kid(node, name)?.args[0]) / region} of={of} max={max} opsFor={(s) => [{ op: "child", at: node.at, name, args: [vNum(onGrid(s, size))] }]} />;
}

function BlockControls(props: { node: ONode; nodes: readonly ONode[] }): preact.JSX.Element {
	const { node, nodes } = props;
	const place = blockRegion(node, nodes);
	const own = ownField(node);
	const side = kid(node, "side")?.args[0]?.v;
	const corner = kid(node, "corner")?.args[0]?.v;
	const parent = place?.parent;
	return (
		<>
			<ColorRow label="Color" value={String(own?.args[0]?.v ?? "")} nodes={nodes} onPick={(color, ...more) => { edit(blockColorOp(node, color), ...more); }} />
			{typeof side === "string" ? (
				<div class="field">
					<span class="nx-label">Which edge</span>
					<Seg class="self-start" label="Which edge" value={side} options={sideNames} onPick={(v) => { edit({ op: "child", at: node.at, name: "side", args: [vStr(v)] }); }} />
				</div>
			) : null}
			{typeof corner === "string" ? (
				<div class="field">
					<span class="nx-label">Which corner</span>
					<Seg class="self-start" label="Which corner" value={corner} options={cornerNames} onPick={(v) => { edit({ op: "child", at: node.at, name: "corner", args: [vStr(v)] }); }} />
				</div>
			) : null}
			{parent !== undefined && typeof side === "string" ? (
				side === "hoist" || side === "fly"
					? <ChildSize node={node} child="width" label="Width" size={parent.wText} of="width" max={0.95} region={parent.w} />
					: <ChildSize node={node} child="width" label="Height" size={parent.hText} of="height" max={0.95} region={parent.h} />
			) : null}
			{parent !== undefined && typeof side !== "string" ? (
				<>
					<ChildSize node={node} child="fly" label="Width" size={parent.wText} of="width" max={1} region={parent.w} />
					<ChildSize node={node} child="hoist" label="Height" size={parent.hText} of="height" max={1} region={parent.h} />
					<p class="nx-note">Drag its corner on the flag. It snaps to fractions and to the stripes' edges.</p>
				</>
			) : null}
			{typeof side === "string" ? <p class="nx-note">Drag its edge on the flag. It snaps to fractions and to the stripes' edges.</p> : null}
		</>
	);
}

const quarterLabels = ["Top left", "Top right", "Bottom left", "Bottom right"];
const diagonalLabels = ["Top", "Right", "Bottom", "Left"];

/** The controls of what's selected, by what it is. */
function Controls(props: { item: Item; nodes: readonly ONode[] }): preact.JSX.Element | null {
	const { item, nodes } = props;
	const n = item.node;
	const r = regionOf(n, nodes);
	if (r === null) {
		return null;
	}
	const colorHere = <ColorRow label="Color" value={String(n.args[0]?.v ?? "")} nodes={nodes} onPick={(color, ...more) => { edit(colorOp(n, 0, color), ...more); }} />;
	const count = (name: string, label: string, min: number, max: number): preact.JSX.Element => <CountBox id={`b-${n.at.join("-")}-${name}`} label={label} value={numOf(kid(n, name)?.args[0])} min={min} max={max} onSet={(v) => { edit({ op: "child", at: n.at, name, args: [vNum(String(v))] }); }} />;
	switch (n.name) {
		case "field":
			return colorHere;
		case "charge":
			return <ChargeControls item={item} nodes={nodes} />;
		case "bars":
			return <BarsControls b={readBars(n)} r={r} nodes={nodes} />;
		case "band": {
			const along = String(kid(n, "along")?.args[0]?.v ?? "fly");
			const lies = along !== "hoist";
			return (
				<>
					{colorHere}
					<Direction node={n} along={along} />
					<ChildSize node={n} child="width" label="How thick" size={lies ? r.hText : r.wText} of={lies ? "height" : "width"} max={1} region={lies ? r.h : r.w} />
					{along === "fly" || along === "hoist" ? <p class="nx-note">Drag it on the flag to move it. It snaps to the middle, to fractions, and to the edges of other things.</p> : null}
				</>
			);
		}
		case "saltire":
			return <>{colorHere}<ChildSize node={n} child="width" label="How thick" size={r.hText} of="height" max={0.6} region={r.h} /></>;
		case "cross":
			return <>{colorHere}<p class="nx-note">Drag the middle of the cross on the flag to move it, and the dot on its arm to make it thicker or thinner.</p></>;
		case "quarters":
			return <><ColorList node={n} labels={kid(n, "diagonal") !== undefined ? diagonalLabels : quarterLabels} nodes={nodes} />{kid(n, "diagonal") === undefined ? <p class="nx-note">Drag where they meet on the flag to move it.</p> : null}</>;
		case "checks":
			return <><ColorList node={n} nodes={nodes} /><div class="inline-fields">{count("rows", "Rows", 1, 100)}{count("columns", "Columns", 1, 100)}</div></>;
		case "chevrons":
			return <><ColorList node={n} nodes={nodes} /><FromSide node={n} /><ChildSize node={n} child="depth" label="How far in" size={r.wText} of="width" max={1} region={r.w} /></>;
		case "rays":
			// A count can't be fewer than the colors, or some would be left out.
			return <><ColorList node={n} nodes={nodes} />{count("count", "How many rays", Math.max(2, n.args.length), 200)}</>;
		case "pile":
			return <>{colorHere}<FromSide node={n} />{kid(n, "tip") === undefined ? <ChildSize node={n} child="depth" label="How far in" size={r.wText} of="width" max={1} region={r.w} /> : null}</>;
		case "pall":
			return <>{colorHere}<FromSide node={n} /><ChildSize node={n} child="width" label="How thick" size={r.hText} of="height" max={0.6} region={r.h} /></>;
		case "canton": case "panel":
			return <BlockControls node={n} nodes={nodes} />;
		default:
			return null;
	}
}

/** The picture menu of what can be added. */
function AddMenu(props: { nodes: readonly ONode[]; selected: ONode | null; onDone: () => void }): preact.JSX.Element {
	const { nodes, selected } = props;
	const block = selected !== null && (selected.name === "canton" || selected.name === "panel") ? plainName(selected).toLowerCase() : null;
	return (
		<div class="pic-menu" role="group" aria-label="Add to the flag">
			{addGroups.map((g) => (
				<div class="field" key={g.label}>
					<span class="nx-label">{g.label}{g.wide === true && block !== null ? `, in the ${block}` : ""}</span>
					<div class={`pics${g.wide === true ? " wide" : ""}`}>
						{g.items.map(([key, label]) => (
							<button key={key} type="button" class="pic" data-add={key} onClick={() => {
								const made = addOps(key, nodes, selected);
								props.onDone();
								if (made !== null) {
									void app.changeAndFollow(made.ops, { at: made.at });
								}
							}}><TermArt term={key} /><span>{label}</span></button>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

function AlsoList(props: { also: readonly AlsoItem[] }): preact.JSX.Element | null {
	if (props.also.length === 0) {
		return null;
	}
	return (
		<div class="also" role="group" aria-labelledby="also-title">
			<span class="nx-label" id="also-title">Also on this flag: edit in Advanced</span>
			<ul>
				{props.also.map((a, i) => (
					<li key={i}>
						<span>{a.label}</span>
						<button type="button" class="nx-link" aria-label={`Edit in Advanced: ${a.label}`} onClick={() => { app.editInAdvanced(a.path); }}>Edit in Advanced</button>
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * Bring forward and Send back, among what's beside it, as Advanced's rows move. What moved stays
 * selected. Each is a step from where it is by the time it's made, so two quick ones move it two places.
 */
function LayerOrder(props: { item: Item; nodes: readonly ONode[] }): preact.JSX.Element {
	const { item, nodes } = props;
	const siblings = layerSiblings(item.node, nodes);
	const place = siblings.indexOf(item.node);
	const move = (by: number): void => {
		app.hover(null);
		void app.changeOne(item.node, (node, now) => {
			const beside = layerSiblings(node, now);
			const i = beside.indexOf(node);
			const other = i < 0 ? undefined : beside[i + by];
			return other === undefined ? null : { ops: moveOps(node, beside, i + by), to: { at: [...node.at.slice(0, -1), other.at.at(-1)!] } };
		}).then((error) => {
			if (error !== undefined) {
				app.set({ notice: error });
			}
		});
	};
	const last = place < 0 || place >= siblings.length - 1;
	const first = place <= 0;
	return (
		<>
			<button type="button" class="nx-ghost small" aria-disabled={last ? "true" : undefined} title={last ? "It's already over everything beside it" : undefined} onClick={() => { if (!last) { move(1); } }}>Bring forward</button>
			<button type="button" class="nx-ghost small" aria-disabled={first ? "true" : undefined} title={first ? "It's already under everything beside it" : undefined} onClick={() => { if (!first) { move(-1); } }}>Send back</button>
		</>
	);
}

/** Basic's panel, for whichever of its tabs isn't Source. */
export function BasicEditor(): preact.JSX.Element {
	const [s] = useApp();
	const analysis = s.analysis;
	const nodes = analysis?.readable === true ? analysis.nodes : s.lastReadable?.nodes ?? [];
	const [adding, setAdding] = useState(false);
	if (analysis === null && nodes.length === 0) {
		return <div class="skeletons" aria-hidden="true"><span class="bone" /><span class="bone" /><span class="bone" /></div>;
	}
	if (s.basicTab === "details") {
		return <BasicDetails nodes={nodes} />;
	}
	const { items, also } = readFlag(nodes);
	const selectedNode = s.selected === null ? null : findLayer(nodes, s.selected);
	const selected = items.find((i) => i.path === s.selected);
	const broken = analysis !== null && !analysis.valid;
	return (
		<div class="basic-page">
			{broken ? (
				<div class="nx-callout danger">
					<span>Something in this flag needs fixing before it can be changed here.</span>
					<button type="button" class="nx-ghost small" onClick={() => { app.setMode("source"); }}>See what's wrong</button>
				</div>
			) : null}
			<div class="row-group">
				<span class="nx-label row-group-label">On this flag</span>
				{items.length === 0 ? <p class="nx-empty pad-row">Nothing yet.</p> : null}
				{items.length > 1 ? <p class="nx-note pad-row">Each thing is drawn over the ones above it here.</p> : null}
				{items.map((i) => (
					<button key={i.path} type="button" class={`row layer-row depth-${Math.min(i.depth, 3)}${s.selected === i.path ? " on" : ""}${s.hover === i.path ? " hover" : ""}`} aria-pressed={s.selected === i.path ? "true" : "false"} data-path={i.path}
						onClick={() => { setAdding(false); app.select(i.path, false); }} onMouseEnter={() => { app.hover(i.path); }} onMouseLeave={() => { app.hover(null); }} onFocus={() => { app.hover(i.path); }} onBlur={() => { app.hover(null); }}>
						<span class="swatch layer-swatch" aria-hidden="true" style={i.color !== undefined ? { background: i.color } : undefined} />
						<span class="row-label">{i.label}</span>
						<span class="row-note">{i.note}</span>
					</button>
				))}
				{!broken ? <button type="button" class="nx-ghost self-start add-to-flag" aria-expanded={adding ? "true" : "false"} onClick={() => { setAdding(!adding); }}>Add to the flag</button> : null}
			</div>
			{adding && !broken ? <AddMenu nodes={nodes} selected={selectedNode !== null && hasControls(selectedNode) ? selectedNode : null} onDone={() => { setAdding(false); }} /> : null}
			{selected !== undefined && !adding && !broken ? (
				<section class="basic-controls" aria-label={selected.label}>
					<h2>{selected.label}</h2>
					<Controls key={selected.path} item={selected} nodes={nodes} />
					<div class="panel-actions">
						<LayerOrder item={selected} nodes={nodes} />
						<button type="button" class="nx-ghost small" onClick={() => {
							edit({ op: "remove", at: selected.node.at });
							app.select(null, false);
						}}>Remove</button>
					</div>
				</section>
			) : null}
			{selected === undefined && selectedNode !== null && !adding && selectedNode.path !== undefined && !["meta", "palette", "proportion"].includes(selectedNode.name) && !selectedNode.path.startsWith("palette/") ? (
				<p class="nx-callout">
					<span>{plainName(selectedNode)} has no controls here.</span>
					<button type="button" class="nx-ghost small" onClick={() => { app.editInAdvanced(selectedNode.path!); }}>Edit in Advanced</button>
				</p>
			) : null}
			<AlsoList also={also} />
		</div>
	);
}

