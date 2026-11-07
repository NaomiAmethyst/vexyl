// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import { decodePathName, encodePathName } from "vexyl/paths";
import { FileLink, safeColor, Seg, useApp } from "./common.js";
import { engine } from "./engine.js";
import { flyPerHoist, matching, shapeText } from "./exact.js";
import type { ONode, Op, OVal, RescalePreview } from "./protocol.js";
import { app, findPath } from "./store.js";
import { addable, exampleFor, freshName, kdlName, nameProblem, onlyOnce, takenNames, type NameKind, fieldsFor, handledChildren, layers as layerTerms, parts, repeatForms, shapes, shortLabel, skeletonFor, stepKinds, type Field } from "./vocab.js";

const numberText = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/;
/** What a number can look like halfway through being typed, which isn't a mistake yet. */
const typingNumber = /^[+-]?\d*\.?\d*([eE][+-]?\d*)?$/;
/** A number the way a file has to write it, so that `.5` can be typed. */
const tidyNumber = (t: string): string => t.replace(/^([+-]?)\./, "$10.");
const vNum = (raw: string): OVal => ({ v: Number(raw), raw });
const vStr = (v: string): OVal => ({ v });
const shown = (o: OVal | undefined): string => (o === undefined || o.v === null ? "" : o.raw ?? String(o.v));
const child = (n: ONode, name: string, nth = 0): ONode | undefined => n.kids.filter((k) => k.name === name)[nth];
const children = (n: ONode, name: string): ONode[] => n.kids.filter((k) => k.name === name);
const prop = (n: ONode | undefined, name: string): OVal | undefined => n?.props.find(([k]) => k === name)?.[1];
const paletteOf = (nodes: readonly ONode[]): { names: string[]; colors: Map<string, string> } => {
	const p = nodes.find((n) => n.name === "palette");
	const colors = new Map<string, string>();
	const names: string[] = [];
	for (const k of p?.kids ?? []) {
		names.push(k.name);
		const c = safeColor(k.args[0]?.v);
		if (c !== undefined) {
			colors.set(k.name, c);
		}
	}
	return { names, colors };
};

const edit = (...ops: Op[]): void => {
	void app.edit(ops);
};

function fieldId(label: string, at: readonly number[], extra = ""): string {
	return `f-${at.join("-")}-${label.replace(/[^A-Za-z0-9]+/g, "-")}${extra}`;
}

/** A text box that keeps what's being typed even while the file catches up, and says when it can't use it. */
function Input(props: { id?: string; label: string; value: string; number?: boolean; mono?: boolean; onChange: (text: string) => void; wide?: boolean; hideLabel?: boolean; note?: string; readonly?: boolean; long?: boolean; placeholder?: string }): preact.JSX.Element {
	const [draft, setDraft] = useState<string | null>(null);
	const text = draft ?? props.value;
	const bad = props.number === true && text !== "" && !numberText.test(tidyNumber(text)) && !typingNumber.test(text);
	const id = props.id ?? fieldId(props.label, [Math.round(props.label.length)]);
	const Tag = props.long === true ? "textarea" : "input";
	return (
		<div class="field">
			{props.hideLabel === true ? null : <label class="nx-label" for={id}>{props.label}</label>}
			<Tag id={id} class={`nx-input ${props.wide === true ? "wide" : props.number === true ? "short" : "medium"} ${props.mono === true || props.number === true ? "mono" : ""}`} value={text} readOnly={props.readonly === true}
				aria-label={props.hideLabel === true ? props.label : undefined} placeholder={props.placeholder ?? exampleFor(props.label, props.number === true)} inputMode={props.number === true ? "decimal" : undefined} aria-invalid={bad ? "true" : undefined} spellcheck={false}
				onInput={(e) => {
					const v = (e.currentTarget as HTMLInputElement).value;
					setDraft(v);
					if (props.number !== true || v === "") {
						props.onChange(v);
					} else if (numberText.test(tidyNumber(v))) {
						props.onChange(tidyNumber(v));
					}
				}}
				onBlur={() => { setDraft(null); }}
				onKeyDown={(e) => {
					if (e.key === "Enter" && props.long !== true) {
						(e.currentTarget as HTMLInputElement).blur();
					}
				}} />
			{bad ? <span class="nx-error" role="alert">That needs to be a number.</span> : null}
			{props.note !== undefined ? <span class="nx-note">{props.note}</span> : null}
		</div>
	);
}

const newColorChoice = "\0new";

/** Names a brand new color and gives it a value, right where it's wanted. */
function NewColor(props: { names: readonly string[]; onAdd: (name: string, hex: string) => void; onCancel: () => void }): preact.JSX.Element {
	const [name, setName] = useState("");
	const [hex, setHex] = useState("#888888");
	const box = useRef<HTMLInputElement>(null);
	useEffect(() => { box.current?.focus(); }, []);
	const wanted = name.trim();
	const problem = wanted === "" ? null : nameProblem("color", wanted, props.names);
	const add = (): void => {
		if (wanted !== "" && problem === null) {
			props.onAdd(wanted, hex);
		}
	};
	return (
		<div class="new-color" role="group" aria-label="A new color">
			<input ref={box} class="nx-input" aria-label="New color's name" placeholder="e.g. sky-blue" spellcheck={false} value={name} aria-invalid={problem !== null ? "true" : undefined} onInput={(e) => { setName((e.currentTarget as HTMLInputElement).value); }} onKeyDown={(e) => {
				if (e.key === "Enter") {
					add();
				} else if (e.key === "Escape") {
					props.onCancel();
				}
			}} />
			<input type="color" class="color-well" aria-label="New color's value" value={hex} onInput={(e) => { setHex((e.currentTarget as HTMLInputElement).value); }} />
			<button type="button" class="nx-btn small" disabled={wanted === "" || problem !== null} onClick={add}>Add this color</button>
			<button type="button" class="nx-ghost small" onClick={props.onCancel}>Cancel</button>
			{problem !== null ? <span class="nx-error" role="alert">{problem}</span> : null}
		</div>
	);
}

function ColorSelect(props: { id: string; label: string; value: string; names: readonly string[]; colors: ReadonlyMap<string, string>; onPick: (v: string) => void; onNew?: (name: string, hex: string) => void; allowNone?: string; addOnly?: boolean; hideLabel?: boolean }): preact.JSX.Element {
	const [creating, setCreating] = useState(false);
	const all = props.value !== "" && !props.names.includes(props.value) && props.value !== "none" ? [props.value, ...props.names] : props.names;
	return (
		<>
		<span class="color-select">
			{props.addOnly === true ? null : <span class="swatch" aria-hidden="true" style={{ background: props.colors.get(props.value) ?? "transparent" }} />}
			<select id={props.id} class="nx-input select" aria-label={props.hideLabel === true ? props.label : undefined} value={props.addOnly === true ? "" : props.value}
				onChange={(e) => {
					const v = (e.currentTarget as HTMLSelectElement).value;
					if (v === newColorChoice) {
						(e.currentTarget as HTMLSelectElement).value = props.addOnly === true ? "" : props.value;
						setCreating(true);
						return;
					}
					props.onPick(v);
					if (props.addOnly === true) {
						(e.currentTarget as HTMLSelectElement).value = "";
					}
				}}>
				{props.addOnly === true ? <option value="" disabled>Add a color</option> : null}
				{props.allowNone !== undefined ? <option value="">{props.allowNone}</option> : null}
				{all.map((n) => <option key={n} value={n}>{n}</option>)}
				<option value="none">none, a gap</option>
				{props.onNew !== undefined ? <option value={newColorChoice}>A new color…</option> : null}
			</select>
		</span>
		{creating && props.onNew !== undefined ? <NewColor names={props.names} onCancel={() => { setCreating(false); }} onAdd={(name, hex) => {
			setCreating(false);
			props.onNew!(name, hex);
		}} /> : null}
		</>
	);
}

function Row(props: { label: string; id?: string; note?: string; children: preact.ComponentChildren }): preact.JSX.Element {
	return (
		<div class="field">
			{props.id !== undefined ? <label class="nx-label" for={props.id}>{props.label}</label> : <span class="nx-label">{props.label}</span>}
			{props.children}
			{props.note !== undefined ? <span class="nx-note">{props.note}</span> : null}
		</div>
	);
}

function Choice(props: { label: string; id: string; value: string; options: readonly (readonly [string, string])[]; onPick: (v: string) => void; note?: string }): preact.JSX.Element {
	const known = props.options.some(([v]) => v === props.value);
	if (props.options.length <= 5 && known) {
		return <Row label={props.label} note={props.note}><Seg label={props.label} value={props.value} options={props.options} onPick={props.onPick} /></Row>;
	}
	return (
		<Row label={props.label} id={props.id} note={props.note}>
			<select id={props.id} class="nx-input select medium" value={props.value} onChange={(e) => { props.onPick((e.currentTarget as HTMLSelectElement).value); }}>
				{known ? null : <option value={props.value}>{props.value}</option>}
				{props.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
			</select>
		</Row>
	);
}

function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void; note?: string }): preact.JSX.Element {
	return <Choice label={props.label} id="" value={props.value ? "yes" : "no"} options={[["yes", "Yes"], ["no", "No"]]} onPick={(v) => { props.onChange(v === "yes"); }} {...(props.note !== undefined ? { note: props.note } : {})} />;
}

function Nums(props: { node: ONode; f: Field & { k: "nums" } }): preact.JSX.Element {
	const { node, f } = props;
	const c = child(node, f.child);
	const id = fieldId(f.label, node.at);
	const count = f.count ?? Math.max(c?.args.length ?? 0, 0);
	if (f.count === undefined) {
		const text = (c?.args ?? []).map(shown).join(" ");
		return (
			<Input id={id} label={f.label} value={text} mono wide placeholder={exampleFor(f.label, true, true)!} {...(f.note !== undefined ? { note: f.note } : {})} onChange={(t) => {
				const words = t.trim().split(/\s+/).filter((w) => w !== "");
				if (words.length === 0) {
					edit({ op: "dropChild", at: node.at, name: f.child });
				} else if (words.every((w) => numberText.test(tidyNumber(w)))) {
					edit({ op: "child", at: node.at, name: f.child, args: words.map(tidyNumber).map(vNum) });
				}
			}} />
		);
	}
	return (
		<Row label={f.label} note={f.note}>
			<div class="inline-fields">
				{Array.from({ length: count }, (_, i) => (
					<Input key={i} id={`${id}-${i}`} label={f.hints?.[i] ?? `${f.label} ${i + 1}`} hideLabel={f.hints === undefined} value={shown(c?.args[i])} number onChange={(t) => {
						if (t === "" && (c?.args.length ?? 0) <= 1) {
							edit({ op: "dropChild", at: node.at, name: f.child });
							return;
						}
						const values = Array.from({ length: count }, (_, j) => (j === i ? (t === "" ? { v: 0, raw: "0" } : vNum(t)) : c?.args[j] ?? { v: 0, raw: "0" }));
						edit({ op: "child", at: node.at, name: f.child, args: values });
					}} />
				))}
			</div>
		</Row>
	);
}

/** The middle of the region a term sits in, where a position it doesn't give stays. */
function middleOf(node: ONode, nodes: readonly ONode[]): { fly: string; hoist: string } {
	const proportion = nodes.find((n) => n.name === "proportion");
	let fly = Number(prop(proportion, "fly")?.v ?? 0);
	let hoist = Number(prop(proportion, "hoist")?.v ?? 0);
	let list = nodes;
	for (const i of node.at.slice(0, -1)) {
		const holder: ONode | undefined = list[i];
		if (holder === undefined) {
			break;
		}
		const own = holder.name === "variant" ? child(holder, "proportion") : holder.name === "define" ? holder : undefined;
		if (own !== undefined && prop(own, "fly") !== undefined) {
			fly = Number(prop(own, "fly")?.v);
			hoist = Number(prop(own, "hoist")?.v);
		} else if (holder.name === "canton" || holder.name === "panel") {
			const width = child(holder, "width")?.args[0]?.v;
			const side = child(holder, "side")?.args[0]?.v;
			fly = Number(side === "hoist" || side === "fly" ? width : child(holder, "fly")?.args[0]?.v ?? fly);
			hoist = Number(side === "top" || side === "bottom" ? width : child(holder, "hoist")?.args[0]?.v ?? hoist);
		}
		list = holder.kids;
	}
	const half = (v: number): string => String(Number((v / 2).toFixed(6)));
	return { fly: half(fly), hoist: half(hoist) };
}

function At(props: { node: ONode; nodes: readonly ONode[]; f: Field & { k: "at" } }): preact.JSX.Element {
	const { node, nodes, f } = props;
	const all = children(node, "at");
	const middle = middleOf(node, nodes);
	const row = (a: ONode | undefined, nth: number): preact.JSX.Element => {
		const id = fieldId("at", node.at, `-${nth}`);
		const center = a?.args[0]?.v === "center";
		const set = (axis: "fly" | "hoist", t: string): void => {
			const value = (name: "fly" | "hoist"): OVal => (name === axis ? (t === "" ? vNum(middle[name]) : vNum(t)) : prop(a, name) ?? vNum(middle[name]));
			const other = axis === "fly" ? "hoist" : "fly";
			edit(t === "" && (a === undefined || center || shown(prop(a, other)) === middle[other]) ? { op: "dropChild", at: node.at, name: "at", nth } : { op: "child", at: node.at, name: "at", nth, args: [], props: [["fly", value("fly")], ["hoist", value("hoist")]] });
		};
		return (
			<div class="inline-fields" key={nth}>
				<Input id={`${id}-f`} label="From the hoist edge" value={center ? "" : shown(prop(a, "fly"))} number placeholder={center || a === undefined ? `Center, ${middle.fly}` : ""} onChange={(t) => { set("fly", t); }} />
				<Input id={`${id}-h`} label="From the top" value={center ? "" : shown(prop(a, "hoist"))} number placeholder={center || a === undefined ? `Center, ${middle.hoist}` : ""} onChange={(t) => { set("hoist", t); }} />
				{a !== undefined && all.length > 1 ? <button type="button" class="nx-ghost small" aria-label={`Remove position ${nth + 1}`} onClick={() => { edit({ op: "dropChild", at: node.at, name: "at", nth }); }}>Remove</button> : null}
			</div>
		);
	};
	return (
		<Row label={f.label} note={f.note}>
			<div class="stack">
				{(all.length === 0 ? [undefined] : all).map((a, i) => row(a, i))}
				{f.many === true && all.length > 0 ? <button type="button" class="nx-ghost small self-start" onClick={() => { edit({ op: "child", at: node.at, name: "at", nth: all.length, args: [], props: [["fly", vNum(middle.fly)], ["hoist", vNum(middle.hoist)]] }); }}>Add a position</button> : null}
			</div>
		</Row>
	);
}

function Repeat(props: { node: ONode }): preact.JSX.Element {
	const { node } = props;
	const r = child(node, "repeat");
	const form = r === undefined ? "once" : String(r.args[0]?.v);
	const defaults: Record<string, [string, OVal][]> = { grid: [["rows", vNum("3")], ["columns", vNum("3")]], ring: [["count", vNum("6")], ["radius", vNum("1")]], arc: [["count", vNum("3")], ["radius", vNum("1")], ["from", vNum("-45")], ["to", vNum("45")]], line: [["count", vNum("3")], ["fly", vNum("1")]] };
	return (
		<div class="stack">
			<Row label="Repeat">
				<Seg label="Repeat" value={form} options={[["once", "Once"], ["grid", "Grid"], ["ring", "Ring"], ["arc", "Arc"], ["line", "Line"]]} onPick={(v) => {
					if (v === "once") {
						edit({ op: "dropChild", at: node.at, name: "repeat" });
					} else {
						const old = r?.props.map(([k]) => k) ?? [];
						const now = defaults[v]!;
						edit({ op: "child", at: node.at, name: "repeat", args: [vStr(v)], props: [...old.filter((k) => !now.some(([n]) => n === k)).map((k) => [k, null] as [string, null]), ...now] });
					}
				}} />
			</Row>
			{r !== undefined && repeatForms[form] !== undefined ? (
				<div class="inline-fields wrap">
					{repeatForms[form]!.map(([key, label, type]) => {
						const value = prop(r, key);
						return type === "bool"
							? <Toggle key={key} label={label} value={value?.v === true} onChange={(on) => { edit({ op: "child", at: node.at, name: "repeat", props: [[key, on ? { v: true } : null]] }); }} />
							: <Input key={key} id={fieldId(`repeat-${key}`, node.at)} label={label} value={shown(value)} number onChange={(t) => { edit({ op: "child", at: node.at, name: "repeat", props: [[key, t === "" ? null : vNum(t)]] }); }} />;
					})}
				</div>
			) : null}
		</div>
	);
}

function EdgeField(props: { node: ONode }): preact.JSX.Element {
	const { node } = props;
	const e = child(node, "edge");
	const form = e === undefined ? "straight" : String(e.args[0]?.v);
	return (
		<div class="stack">
			<Row label="Edge between divisions">
				<Seg label="Edge between divisions" value={form} options={[["straight", "Straight"], ["wavy", "Wavy"], ["zigzag", "Zigzag"]]} onPick={(v) => {
					if (v === "straight") {
						edit({ op: "dropChild", at: node.at, name: "edge" });
					} else if (e === undefined) {
						edit({ op: "child", at: node.at, name: "edge", args: [vStr(v)], props: [["depth", vNum("1")], ["count", vNum("6")]] });
					} else {
						edit({ op: "child", at: node.at, name: "edge", args: [vStr(v)] });
					}
				}} />
			</Row>
			{e !== undefined ? (
				<div class="inline-fields wrap">
					<Input id={fieldId("edge-depth", node.at)} label="Depth" value={shown(prop(e, "depth"))} number onChange={(t) => { edit({ op: "child", at: node.at, name: "edge", props: [["depth", t === "" ? null : vNum(t)]] }); }} />
					<Input id={fieldId("edge-period", node.at)} label="Period" value={shown(prop(e, "period"))} number onChange={(t) => { edit({ op: "child", at: node.at, name: "edge", props: [["period", t === "" ? null : vNum(t)], ["count", null]] }); }} />
					<Input id={fieldId("edge-count", node.at)} label="Count" value={shown(prop(e, "count"))} number onChange={(t) => { edit({ op: "child", at: node.at, name: "edge", props: [["count", t === "" ? null : vNum(t)], ["period", null]] }); }} />
				</div>
			) : null}
		</div>
	);
}

function Fimbriate(props: { node: ONode; names: readonly string[]; colors: ReadonlyMap<string, string> }): preact.JSX.Element {
	const { node } = props;
	const c = child(node, "fimbriate");
	const id = fieldId("fimbriate", node.at);
	return (
		<Row label="Fimbriation" id={id} note="A narrow contrasting edge.">
			<div class="inline-fields">
				<ColorSelect id={id} label="Fimbriation color" value={c === undefined ? "" : String(c.args[0]?.v)} names={props.names} colors={props.colors} allowNone="None" onPick={(v) => {
					edit(v === "" ? { op: "dropChild", at: node.at, name: "fimbriate" } : { op: "child", at: node.at, name: "fimbriate", args: [vStr(v), c?.args[1] ?? vNum("0.1")] });
				}} />
				{c !== undefined ? <Input id={`${id}-w`} label="Width" hideLabel value={shown(c.args[1])} number onChange={(t) => { if (t !== "") { edit({ op: "child", at: node.at, name: "fimbriate", args: [c.args[0]!, vNum(t)] }); } }} /> : null}
			</div>
		</Row>
	);
}

function Steps(props: { node: ONode }): preact.JSX.Element {
	const { node } = props;
	const stepNames = new Set(["over", "under", "tuck"]);
	const steps = node.kids.filter((k) => stepNames.has(k.name));
	return (
		<div class="field">
			<span class="nx-label">Steps</span>
			<ol class="steps">
				{steps.map((s, i) => {
					const through = prop(s, "through") !== undefined;
					const along = String(prop(s, "along")?.v ?? "fly");
					const where = fieldId("step", s.at);
					return (
						<li key={s.at.join(".")} class="step">
							<Seg label={`Step ${i + 1}`} value={s.name} options={stepKinds} onPick={(v) => { edit({ op: "add", at: node.at, text: rewriteStep(v, s), index: s.at.at(-1)! }, { op: "remove", at: [...node.at, s.at.at(-1)! + 1] }); }} />
							{through ? (
								<div class="inline-fields wrap">
									<Input id={`${where}-t`} label="Through" value={String(prop(s, "through")?.v ?? "")} mono note="A line through two points: A B C D." onChange={(t) => { edit({ op: "entries", at: s.at, props: [["through", vStr(t)]] }); }} />
									<Input id={`${where}-m`} label="Part that moves" value={String(prop(s, "move")?.v ?? "")} mono onChange={(t) => { edit({ op: "entries", at: s.at, props: [["move", vStr(t)]] }); }} />
								</div>
							) : (
								<div class="inline-fields wrap">
									<Seg label="Crease along" value={along} options={[["fly", "Along the fly"], ["hoist", "Along the hoist"]]} onPick={(v) => { edit({ op: "entries", at: s.at, props: [["along", vStr(v)], ["move", vStr(v === "fly" ? "bottom" : "fly")]] }); }} />
									<Input id={`${where}-a`} label="At" value={shown(prop(s, "at"))} number onChange={(t) => { if (t !== "") { edit({ op: "entries", at: s.at, props: [["at", vNum(t)]] }); } }} />
									<Seg label="Part that moves" value={String(prop(s, "move")?.v ?? "")} options={along === "fly" ? [["top", "Top"], ["bottom", "Bottom"]] : [["hoist", "Hoist"], ["fly", "Fly"]]} onPick={(v) => { edit({ op: "entries", at: s.at, props: [["move", vStr(v)]] }); }} />
								</div>
							)}
							<div class="inline-fields">
								<button type="button" class="nx-ghost small" disabled={i === 0} onClick={() => { edit({ op: "move", at: s.at, delta: -1 }); }}>Earlier</button>
								<button type="button" class="nx-ghost small" disabled={i === steps.length - 1} onClick={() => { edit({ op: "move", at: s.at, delta: 1 }); }}>Later</button>
								<button type="button" class="nx-ghost small" onClick={() => { edit({ op: "remove", at: s.at }); }}>Remove</button>
							</div>
						</li>
					);
				})}
			</ol>
			<button type="button" class="nx-ghost small self-start" onClick={() => { edit({ op: "add", at: node.at, text: "over along=fly at=1 move=bottom" }); }}>Add a step</button>
		</div>
	);
}

function rewriteStep(kind: string, s: ONode): string {
	const write = (o: OVal): string => (typeof o.v === "string" ? JSON.stringify(o.v) : shown(o));
	return `${kind} ${s.props.map(([k, v]) => `${k}=${write(v)}`).join(" ")}`;
}

function Texts(props: { node: ONode; f: Field & { k: "texts" } }): preact.JSX.Element {
	const { node, f } = props;
	const all = children(node, f.child);
	return (
		<div class="field">
			<span class="nx-label">{f.label}</span>
			{f.note !== undefined ? <span class="nx-note">{f.note}</span> : null}
			<div class="stack">
				{all.map((c, i) => (
					<div class="inline-fields" key={i}>
						<Input id={fieldId(f.child, c.at)} label={`${f.label}, ${i + 1}`} hideLabel value={String(c.args[0]?.v ?? "")} wide readonly={c.args[0]?.big !== undefined} onChange={(t) => { edit({ op: "entries", at: c.at, args: [vStr(t)] }); }} />
						{f.link === true && typeof c.args[0]?.v === "string" ? <FileLink href={c.args[0].v}>Open</FileLink> : null}
						<button type="button" class="nx-ghost small" aria-label={`Remove ${f.label.toLowerCase()} ${i + 1}`} onClick={() => { edit({ op: "remove", at: c.at }); }}>Remove</button>
					</div>
				))}
				<button type="button" class="nx-ghost small self-start" onClick={() => { edit({ op: "child", at: node.at, name: f.child, nth: all.length, args: [vStr("")] }); }}>{f.add}</button>
			</div>
		</div>
	);
}

function Records(props: { node: ONode; f: Field & { k: "records" }; ctx: Ctx }): preact.JSX.Element {
	const { node, f, ctx } = props;
	const all = children(node, f.child);
	return (
		<div class="field">
			<span class="nx-label">{f.label}</span>
			{f.note !== undefined ? <span class="nx-note">{f.note}</span> : null}
			<div class="stack">
				{all.map((c, i) => (
					<fieldset class="record" key={i}>
						<legend class="visually-hidden">{f.label}, {i + 1}</legend>
						<Input id={fieldId(f.child, c.at)} label={f.arg} value={String(c.args[0]?.v ?? "")} wide onChange={(t) => { edit({ op: "entries", at: c.at, args: [vStr(t)] }); }} />
						{f.fields.map((sub, j) => <FieldView key={j} f={sub} node={c} ctx={ctx} />)}
						<button type="button" class="nx-ghost small self-start" onClick={() => { edit({ op: "remove", at: c.at }); }}>Remove</button>
					</fieldset>
				))}
				<button type="button" class="nx-ghost small self-start" onClick={() => { edit({ op: "add", at: node.at, text: f.skeleton, index: lastOf(node, f.child) }); }}>{f.add}</button>
			</div>
		</div>
	);
}

/** Where another of a repeatable child goes: after the last, or at the end. */
function lastOf(node: ONode, name: string): number {
	const last = children(node, name).at(-1);
	return last === undefined ? node.kids.length : last.at.at(-1)! + 1;
}

function References(props: { node: ONode }): preact.JSX.Element {
	const { node } = props;
	const all = children(node, "reference");
	return (
		<div class="field">
			<span class="nx-label">Other references</span>
			<div class="stack">
				{all.map((c, i) => (
					<div class="inline-fields wrap" key={i}>
						<Input id={fieldId("ref-system", c.at)} label="System" value={String(c.args[0]?.v ?? "")} onChange={(t) => { edit({ op: "entries", at: c.at, args: [vStr(t), c.args[1] ?? vStr("")] }); }} />
						<Input id={fieldId("ref-value", c.at)} label="Value" value={String(c.args[1]?.v ?? "")} onChange={(t) => { edit({ op: "entries", at: c.at, args: [c.args[0] ?? vStr(""), vStr(t)] }); }} />
						<button type="button" class="nx-ghost small" aria-label={`Remove reference ${i + 1}`} onClick={() => { edit({ op: "remove", at: c.at }); }}>Remove</button>
					</div>
				))}
				<button type="button" class="nx-ghost small self-start" onClick={() => { edit({ op: "child", at: node.at, name: "reference", nth: all.length, args: [vStr("System"), vStr("Value")] }); }}>Add a reference</button>
			</div>
		</div>
	);
}

function Points(props: { node: ONode; f: Field & { k: "points" } }): preact.JSX.Element {
	const { node, f } = props;
	const all = children(node, f.child);
	return (
		<div class="field">
			<span class="nx-label">{f.label}</span>
			<div class="stack">
				{all.map((c, i) => (
					<div class="inline-fields" key={i}>
						<Input id={fieldId("pf", c.at)} label={`Point ${i + 1} fly`} value={shown(prop(c, "fly"))} number onChange={(t) => { if (t !== "") { edit({ op: "entries", at: c.at, props: [["fly", vNum(t)]] }); } }} />
						<Input id={fieldId("ph", c.at)} label={`Point ${i + 1} hoist`} value={shown(prop(c, "hoist"))} number onChange={(t) => { if (t !== "") { edit({ op: "entries", at: c.at, props: [["hoist", vNum(t)]] }); } }} />
						<button type="button" class="nx-ghost small" aria-label={`Remove point ${i + 1}`} onClick={() => { edit({ op: "remove", at: c.at }); }}>Remove</button>
					</div>
				))}
				<button type="button" class="nx-ghost small self-start" onClick={() => { edit({ op: "child", at: node.at, name: f.child, nth: all.length, props: [["fly", vNum("0")], ["hoist", vNum("0")]] }); }}>Add a point</button>
			</div>
		</div>
	);
}

/** The colors a term uses: click one to change it, or drag it to move it. */
function ColorChips(props: { node: ONode; from: number; ctx: Ctx; id: string; label: string }): preact.JSX.Element {
	const { node, from, ctx, id } = props;
	const list = node.args.slice(from);
	const [open, setOpen] = useState<number | null>(null);
	const [dragged, setDragged] = useState<number | null>(null);
	const [over, setOver] = useState<number | null>(null);
	const openHere = open !== null && open < list.length ? open : null;
	const setList = (next: readonly OVal[], ...more: Op[]): void => {
		edit({ op: "entries", at: node.at, args: [...node.args.slice(0, from), ...next] }, ...more);
	};
	const move = (a: number, b: number): void => {
		if (a !== b && b >= 0 && b < list.length) {
			const next = [...list];
			next.splice(b, 0, ...next.splice(a, 1));
			setList(next);
			if (openHere !== null) {
				setOpen(openHere === a ? b : openHere > a && openHere <= b ? openHere - 1 : openHere < a && openHere >= b ? openHere + 1 : openHere);
			}
		}
	};
	const current = openHere !== null ? String(list[openHere]?.v) : "";
	return (
		<>
			<div class="chips">
				{list.map((c, i) => (
					<span key={i} class={`nx-chip on color-chip${openHere === i ? " chip-open" : ""}${over === i && dragged !== null && dragged !== i ? " chip-over" : ""}`} draggable data-chip={i}
						onDragStart={(e) => {
							e.dataTransfer?.setData("text/plain", String(c.v));
							if (e.dataTransfer !== null) {
								e.dataTransfer.effectAllowed = "move";
							}
							setDragged(i);
						}}
						onDragOver={(e) => {
							if (dragged !== null) {
								e.preventDefault();
								setOver(i);
							}
						}}
						onDragLeave={() => { setOver((o) => (o === i ? null : o)); }}
						onDrop={(e) => {
							e.preventDefault();
							if (dragged !== null) {
								move(dragged, i);
							}
							setDragged(null);
							setOver(null);
						}}
						onDragEnd={() => {
							setDragged(null);
							setOver(null);
						}}>
						<button type="button" class="chip-name" aria-expanded={openHere === i ? "true" : "false"} aria-label={`${String(c.v)}, color ${i + 1} of ${list.length}`} onClick={() => { setOpen(openHere === i ? null : i); }}>
							<span class="dot" aria-hidden="true" style={{ background: ctx.colors.get(String(c.v)) ?? "transparent" }} />{String(c.v)}
						</button>
						<button type="button" class="chip-x" aria-label={`Remove ${String(c.v)}, color ${i + 1}`} disabled={list.length === 1} onClick={() => {
							const next = [...list];
							next.splice(i, 1);
							setList(next);
							setOpen(null);
						}}>×</button>
					</span>
				))}
				<ColorSelect id={`${id}-add`} label="Add a color" hideLabel value="" addOnly names={ctx.names} colors={ctx.colors} onPick={(v) => {
					if (v !== "") {
						setList([...list, vStr(v)]);
					}
				}} {...newColorProps(ctx, node, (name, add) => { setList([...list, vStr(name)], add); })} />
			</div>
			{openHere !== null ? (
				<div class="chip-editor" role="group" aria-label={`Color ${openHere + 1}`}>
					<ColorSelect key={openHere} id={`${id}-chip`} label={`Color ${openHere + 1}`} hideLabel value={current} names={ctx.names} colors={ctx.colors} onPick={(v) => {
						const next = [...list];
						next[openHere] = vStr(v);
						setList(next);
					}} {...newColorProps(ctx, node, (name, add) => {
						const next = [...list];
						next[openHere] = vStr(name);
						setList(next, add);
					})} />
					<PaletteLink name={current} ctx={ctx} />
					<span class="panel-actions">
						<button type="button" class="nx-ghost small" disabled={openHere === 0} onClick={() => { move(openHere, openHere - 1); }}>Move earlier</button>
						<button type="button" class="nx-ghost small" disabled={openHere === list.length - 1} onClick={() => { move(openHere, openHere + 1); }}>Move later</button>
					</span>
				</div>
			) : null}
		</>
	);
}

/** Goes to a color's own entry, to change the color itself. */
function PaletteLink(props: { name: string; ctx: Ctx }): preact.JSX.Element | null {
	if (!props.ctx.names.includes(props.name)) {
		return null;
	}
	return <button type="button" class="nx-link self-start" onClick={() => { app.select(`palette/${encodePathName(props.name)}`); }}>Edit this color</button>;
}

/** Lets a color be made where it's wanted. Within the palette it goes ahead of what uses it. */
function newColorProps(ctx: Ctx, node: ONode, use: (name: string, add: Op) => void): { onNew?: (name: string, hex: string) => void } {
	const palette = ctx.paletteAt;
	if (palette === null) {
		return {};
	}
	const inPalette = node.at.length === 2 && node.at[0] === palette[0];
	return {
		onNew: (name, hex) => {
			use(name, { op: "add", at: palette, text: `${kdlName(name)} "${hex}"`, ...(inPalette ? { index: node.at[1]! } : {}) });
		},
	};
}

interface Ctx {
	nodes: readonly ONode[];
	paletteAt: number[] | null;
	names: readonly string[];
	colors: ReadonlyMap<string, string>;
	defines: readonly string[];
	toSource: () => void;
}

function FieldView(props: { f: Field; node: ONode; ctx: Ctx }): preact.JSX.Element {
	const { f, node, ctx } = props;
	const id = fieldId("label" in f ? f.label : f.k, node.at);
	switch (f.k) {
		case "colorArg": {
			const value = String(node.args[f.i]?.v ?? "");
			return (
				<Row label={f.label} id={id} note={f.note}>
					<ColorSelect id={id} label={f.label} value={value} names={ctx.names} colors={ctx.colors} onPick={(v) => {
						const args = [...node.args];
						args[f.i] = vStr(v);
						edit({ op: "entries", at: node.at, args });
					}} {...newColorProps(ctx, node, (name, add) => {
						const args = [...node.args];
						args[f.i] = vStr(name);
						edit({ op: "entries", at: node.at, args }, add);
					})} />
					<PaletteLink name={value} ctx={ctx} />
				</Row>
			);
		}
		case "colorArgs": {
			return (
				<Row label={f.label} id={`${id}-add`} note={f.note ?? "Click a color to change it. Drag one to move it."}>
					<ColorChips node={node} from={f.from} ctx={ctx} id={id} label={f.label} />
				</Row>
			);
		}
		case "num":
			return <Input id={id} label={f.label} value={shown(child(node, f.child)?.args[0])} number {...(f.note !== undefined ? { note: f.note } : {})} onChange={(t) => { edit(t === "" ? { op: "dropChild", at: node.at, name: f.child } : { op: "child", at: node.at, name: f.child, args: [vNum(t)] }); }} />;
		case "nums":
			return <Nums node={node} f={f} />;
		case "choice": {
			const c = child(node, f.child);
			const arg = c?.args[0]?.v;
			const custom = c !== undefined && typeof arg !== "string";
			if (custom) {
				return <Row label={f.label} note="Written as a position, which is edited in the source."><button type="button" class="nx-link self-start" onClick={ctx.toSource}>See it in the source</button></Row>;
			}
			return <Choice label={f.label} id={id} value={c === undefined ? (f.none ?? "") : String(arg)} options={f.options} {...(f.note !== undefined ? { note: f.note } : {})} onPick={(v) => { edit(v === (f.none ?? "") ? { op: "dropChild", at: node.at, name: f.child } : { op: "child", at: node.at, name: f.child, args: [vStr(v)] }); }} />;
		}
		case "flag":
			return <Toggle label={f.label} value={child(node, f.child) !== undefined && child(node, f.child)?.args[0]?.v !== false} {...(f.note !== undefined ? { note: f.note } : {})} onChange={(on) => { edit(on ? { op: "child", at: node.at, name: f.child } : { op: "dropChild", at: node.at, name: f.child }); }} />;
		case "text": {
			const c = child(node, f.child);
			const big = c?.args[0]?.big;
			return <Input id={id} label={f.label} value={String(c?.args[0]?.v ?? "")} wide={f.wide ?? false} mono={f.mono ?? false} long={f.long ?? false} readonly={big !== undefined} {...(big !== undefined ? { note: `This is ${big.toLocaleString()} characters long, so it's edited in the source.` } : f.note !== undefined ? { note: f.note } : {})} onChange={(t) => { edit(t === "" ? { op: "dropChild", at: node.at, name: f.child } : { op: "child", at: node.at, name: f.child, args: [vStr(t)] }); }} />;
		}
		case "texts":
			return <Texts node={node} f={f} />;
		case "records":
			return <Records node={node} f={f} ctx={ctx} />;
		case "at":
			// A grid spreads its copies across the region, so it has no position of its own.
			return child(node, "repeat")?.args[0]?.v === "grid" ? <></> : <At node={node} nodes={ctx.nodes} f={f} />;
		case "props": {
			const c = child(node, f.child);
			return (
				<Row label={f.label} note={f.note}>
					<div class="inline-fields">
						{f.props.map(([key, label]) => <Input key={key} id={`${id}-${key}`} label={label} value={shown(prop(c, key))} number onChange={(t) => {
							const others = f.props.filter(([k]) => k !== key).map(([k]) => prop(c, k));
							edit(t === "" && others.every((o) => o === undefined) ? { op: "dropChild", at: node.at, name: f.child } : { op: "child", at: node.at, name: f.child, props: [[key, t === "" ? null : vNum(t)]] });
						}} />)}
					</div>
				</Row>
			);
		}
		case "propNum":
			return <Input id={id} label={f.label} value={shown(prop(node, f.prop))} number {...(f.note !== undefined ? { note: f.note } : {})} onChange={(t) => { edit({ op: "entries", at: node.at, props: [[f.prop, t === "" ? null : vNum(t)]] }); }} />;
		case "argText":
			return (
				<Row label={f.label} id={id} note={f.note}>
					<div class="inline-fields">
						{safeColor(node.args[f.i]?.v) !== undefined ? <input type="color" class="color-well" aria-label={`${f.label}, as a color picker`} value={String(node.args[f.i]?.v).toLowerCase()} onInput={(e) => {
							const args = [...node.args];
							args[f.i] = vStr((e.currentTarget as HTMLInputElement).value);
							edit({ op: "entries", at: node.at, args });
						}} /> : null}
						<Input id={id} label={f.label} hideLabel value={String(node.args[f.i]?.v ?? "")} mono onChange={(t) => {
							const args = [...node.args];
							args[f.i] = vStr(t);
							edit({ op: "entries", at: node.at, args });
						}} />
					</div>
				</Row>
			);
		case "argNum":
			return <Input id={id} label={f.label} value={shown(node.args[f.i])} number onChange={(t) => {
				if (t !== "") {
					const args = [...node.args];
					args[f.i] = vNum(t);
					edit({ op: "entries", at: node.at, args });
				}
			}} />;
		case "argChoice": {
			const value = node.args[f.i]?.v;
			const has = node.args.length > f.i;
			return <Choice label={f.label} id={id} value={has ? String(value) : (f.none ?? "")} options={f.options} {...(f.note !== undefined ? { note: f.note } : {})} onPick={(v) => {
				const args = [...node.args];
				if (v === f.none && args.length === f.i + 1) {
					args.pop();
				} else {
					args[f.i] = vStr(v);
				}
				edit({ op: "entries", at: node.at, args });
			}} />;
		}
		case "edge":
			return <EdgeField node={node} />;
		case "fimbriate":
			return <Fimbriate node={node} names={ctx.names} colors={ctx.colors} />;
		case "repeat":
			return <Repeat node={node} />;
		case "steps":
			return <Steps node={node} />;
		case "reference":
			return <References node={node} />;
		case "points":
			return <Points node={node} f={f} />;
		case "artwork": {
			const m = child(node, "markup")?.args[0];
			const size = m?.big ?? String(m?.v ?? "").length;
			return (
				<Row label="Artwork">
					<p class="plain">Inline SVG, {size.toLocaleString()} characters. It's edited in the source, and selected as a whole.</p>
					<button type="button" class="nx-link self-start" onClick={ctx.toSource}>See it in the source</button>
				</Row>
			);
		}
		case "defineArg":
			return (
				<Row label="Definition" id={id}>
					<select id={id} class="nx-input select medium" value={String(node.args[0]?.v ?? "")} onChange={(e) => { edit({ op: "entries", at: node.at, args: [vStr((e.currentTarget as HTMLSelectElement).value)] }); }}>
						{ctx.defines.includes(String(node.args[0]?.v ?? "")) ? null : <option value={String(node.args[0]?.v ?? "")}>{String(node.args[0]?.v ?? "")}</option>}
						{ctx.defines.map((d) => <option key={d} value={d}>{d}</option>)}
					</select>
				</Row>
			);
	}
}

/** What the file has here that no field reads, which stays exactly as it is. */
function onlyInSource(node: ONode, fields: readonly Field[], inPalette: boolean): string[] {
	const handled = handledChildren(fields);
	const out: string[] = [];
	const layerKids = fieldsFor(node, inPalette).term?.layers === true;
	for (const k of node.kids) {
		if (handled.has(k.name)) {
			continue;
		}
		if (layerKids && k.path !== undefined && layerTerms[k.name] !== undefined) {
			continue;
		}
		out.push(k.name);
	}
	return [...new Set(out)];
}

function noteFor(n: ONode): string {
	const count = child(n, "count")?.args[0];
	switch (n.name) {
		case "bars":
			return count !== undefined ? shown(count) : String(n.args.length);
		case "chevrons": case "checks": case "rays": case "quarters":
			return String(n.args.length);
		case "canton":
			return "Upper hoist";
		case "panel": {
			const place = child(n, "side")?.args[0]?.v ?? child(n, "corner")?.args[0]?.v;
			return place === undefined ? "" : String(place);
		}
		case "charge": {
			const r = child(n, "repeat");
			if (r !== undefined) {
				const form = String(r.args[0]?.v);
				if (form === "grid") {
					const rows = Number(prop(r, "rows")?.v ?? 0);
					const columns = Number(prop(r, "columns")?.v ?? 0);
					const stagger = prop(r, "stagger")?.v === true;
					let total = rows * columns;
					if (stagger) {
						total = Math.ceil(total / 2);
					}
					return `${total} in a grid`;
				}
				return `${shown(prop(r, "count"))} in ${form === "line" ? "a line" : `a ${form}`}`;
			}
			const ats = children(n, "at").length;
			return ats > 1 ? `${ats} of them` : "";
		}
		case "use":
			return String(n.args[0]?.v ?? "");
		default:
			return "";
	}
}

function labelFor(n: ONode): string {
	if (n.name === "charge") {
		return shapes[String(n.args[0]?.v)]?.label ?? String(n.args[0]?.v ?? "Charge");
	}
	return shortLabel(n.name);
}

function swatchFor(n: ONode, colors: ReadonlyMap<string, string>): string | undefined {
	if (n.name === "charge") {
		return colors.get(String(n.args[1]?.v));
	}
	if (n.name === "canton" || n.name === "panel") {
		const f = child(n, "field");
		return f !== undefined ? colors.get(String(f.args[0]?.v)) : undefined;
	}
	return n.args[0] !== undefined ? colors.get(String(n.args[0].v)) : undefined;
}

/** A panel's first `field` is shown as a property of it, as a construction sheet would give it. */
const fieldIsOwn = (parent: ONode, k: ONode): boolean => (parent.name === "canton" || parent.name === "panel") && k.name === "field" && parent.kids.find((c) => c.path !== undefined) === k;

interface RowDef {
	path: string;
	label: string;
	note: string;
	mono?: boolean;
	swatch?: string | undefined;
	depth: number;
	/** The layer it is, which can be moved or taken out from the row. */
	layer?: ONode;
}

function layerRows(list: readonly ONode[], colors: ReadonlyMap<string, string>, depth: number, out: RowDef[], parent?: ONode): void {
	for (const n of list) {
		if (n.path === undefined || (layerTerms[n.name] === undefined)) {
			continue;
		}
		if (parent !== undefined && fieldIsOwn(parent, n)) {
			continue;
		}
		out.push({ path: n.path, label: labelFor(n), note: noteFor(n), swatch: swatchFor(n, colors), depth, layer: n });
		if (layerTerms[n.name]!.layers === true) {
			layerRows(n.kids, colors, depth + 1, out, n);
		}
	}
}

export function groupsOf(nodes: readonly ONode[]): { label: string; rows: RowDef[] }[] {
	const { colors } = paletteOf(nodes);
	const flag: RowDef[] = [];
	const layersRows: RowDef[] = [];
	const others: RowDef[] = [];
	const defines: RowDef[] = [];
	const metaName = child(nodes.find((n) => n.name === "meta") ?? ({ kids: [] } as unknown as ONode), "name")?.args[0]?.v;
	for (const n of nodes) {
		switch (n.name) {
			case "meta":
				flag.push({ path: "meta", label: "Details", note: String(metaName ?? ""), depth: 0 });
				break;
			case "palette":
				flag.push({ path: "palette", label: "Colors", note: String(n.kids.length), depth: 0 });
				break;
			case "proportion":
				flag.push({ path: "proportion", label: "Proportion", note: shapeText(shown(prop(n, "hoist")), shown(prop(n, "fly"))) ?? `${shown(prop(n, "hoist"))}:${shown(prop(n, "fly"))}`, mono: true, depth: 0 });
				break;
			case "outline":
				flag.push({ path: "outline", label: "Outline", note: String(n.args[0]?.v ?? "Drawn"), depth: 0 });
				break;
			case "border":
				flag.push({ path: "border", label: "Border", note: String(n.args[0]?.v ?? ""), swatch: colors.get(String(n.args[0]?.v)), depth: 0 });
				break;
			case "reverse":
				others.push({ path: "reverse", label: "Reverse", note: n.kids.length > 0 ? "Its own" : "Mirror", depth: 0 });
				layerRows(n.kids, colors, 1, others);
				break;
			case "adapt":
				others.push({ path: "adapt", label: "Adapt", note: "Other proportions", depth: 0 });
				break;
			case "variant":
				if (n.path !== undefined) {
					others.push({ path: n.path, label: capitalize(String(n.args[0]?.v)), note: "Variant", depth: 0 });
					layerRows(n.kids, colors, 1, others);
				}
				break;
			case "fold":
				if (n.path !== undefined) {
					others.push({ path: n.path, label: capitalize(String(n.args[0]?.v)), note: "Fold", depth: 0 });
				}
				break;
			case "define":
				if (n.path !== undefined) {
					defines.push({ path: n.path, label: capitalize(String(n.args[0]?.v)), note: "Definition", depth: 0 });
					layerRows(n.kids, colors, 1, defines);
				}
				break;
			default:
				if (layerTerms[n.name] !== undefined) {
					layerRows([n], colors, 0, layersRows);
				}
				break;
		}
	}
	const groups = [{ label: "Flag", rows: flag }, { label: "Layers, bottom to top", rows: layersRows }];
	if (others.length > 0) {
		groups.push({ label: "Other forms", rows: others });
	}
	if (defines.length > 0) {
		groups.push({ label: "Definitions", rows: defines });
	}
	return groups;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The path of a term just added, whose name is there to be chosen. */
let namingNext: string | null = null;

/** Where a new term goes, by what it is. */
function addTerm(key: string, nodes: readonly ONode[], into: ONode | null): void {
	const { names } = paletteOf(nodes);
	if (key === "color" || key === "gradient") {
		const palette = nodes.find((n) => n.name === "palette");
		const name = freshName(key, names)!;
		if (palette !== undefined) {
			namingNext = `palette/${name}`;
			void app.changeAndFollow([{ op: "add", at: palette.at, text: skeletonFor(key, names, name) }], { path: namingNext });
		}
		return;
	}
	if (key === "variant" || key === "fold" || key === "define") {
		const name = freshName(key, takenNames(key, nodes))!;
		namingNext = `${key}/${name}`;
		void app.changeAndFollow([{ op: "add", at: null, text: skeletonFor(key, names, name) }], { path: namingNext });
		return;
	}
	const text = skeletonFor(key, names);
	if (into !== null && (layerTerms[key] !== undefined || key.startsWith("charge:"))) {
		edit({ op: "add", at: into.at, text });
		return;
	}
	edit({ op: "add", at: null, text });
}

function AddTerm(props: { nodes: readonly ONode[]; into: ONode | null; label?: string; onlyCharges?: boolean }): preact.JSX.Element {
	const [open, setOpen] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	const button = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (!open) {
			return undefined;
		}
		const away = (e: Event): void => {
			if (!box.current?.contains(e.target as globalThis.Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("pointerdown", away);
		box.current?.scrollIntoView({ block: "nearest" });
		return () => { document.removeEventListener("pointerdown", away); };
	}, [open]);
	const groups = props.onlyCharges === true ? addable.filter((g) => g.group === "Charges") : props.into !== null ? addable.filter((g) => g.group !== "Flag") : addable;
	return (
		<div class="add-term" ref={box} onKeyDown={(e) => {
			if (e.key === "Escape" && open) {
				setOpen(false);
				button.current?.focus();
			}
		}}>
			<button ref={button} type="button" class="nx-ghost" aria-expanded={open ? "true" : "false"} onClick={() => { setOpen(!open); }}>{props.label ?? "Add a term"}</button>
			{open ? (
				<div class="add-menu" role="group" aria-label={props.label ?? "Add a term"}>
					{groups.map((g) => (
						<div key={g.group}>
							<span class="nx-label">{g.group}</span>
							<div class="add-items">
								{g.items.filter(([key]) => !onlyOnce.has(key) || !props.nodes.some((n) => n.name === key)).map(([key, label]) => (
									<button key={key} type="button" class="nx-chip add-item" onClick={() => {
										addTerm(key, props.nodes, props.into);
										setOpen(false);
										button.current?.focus();
									}}>{label}</button>
								))}
							</div>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

function problemPaths(s: { problems: { line?: number; message: string }[]; spans: { path: string; line: number; endLine: number }[] }): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const p of s.problems) {
		if (p.line === undefined) {
			continue;
		}
		let best: { path: string; line: number } | undefined;
		for (const span of s.spans) {
			if (p.line >= span.line && p.line <= span.endLine && (best === undefined || span.line >= best.line)) {
				best = span;
			}
		}
		if (best !== undefined) {
			out.set(best.path, [...(out.get(best.path) ?? []), p.message]);
			const top = best.path.startsWith("palette/") ? "palette" : null;
			if (top !== null) {
				out.set(top, [...(out.get(top) ?? []), p.message]);
			}
		}
	}
	return out;
}

const panelFor = (path: string): string => path;

export function Form(): preact.JSX.Element {
	const [s] = useApp();
	const analysis = s.analysis;
	const nodes = analysis?.readable === true ? analysis.nodes : s.lastReadable?.nodes ?? [];
	const unreadable = analysis !== null && !analysis.readable;
	const selected = s.selected !== null ? findPath(nodes, panelFor(s.selected)) : null;
	const groups = groupsOf(nodes);
	const marked = analysis !== null ? problemPaths(analysis) : new Map<string, string[]>();
	const paused = (): preact.JSX.Element | null => (unreadable ? <p class="nx-callout danger"><span>Line {analysis?.problems[0]?.line ?? "?"} of the file can't be read as KDL, so the form is showing how it last was, and can't change anything until that's fixed in Source.</span></p> : null);
	if (analysis === null && nodes.length === 0) {
		return <div class="form-body skeletons" aria-hidden="true"><span class="bone" /><span class="bone" /><span class="bone" /></div>;
	}
	const open = selected !== null;
	return (
		<div class="form-slider">
			<div class={`form-track${open ? " open" : ""}`}>
				<div class="form-page" hidden={open}>
					{open ? null : paused()}
					{nodes.length === 0 ? <p class="nx-empty">Nothing can be read in this file yet.</p> : null}
					{groups.map((g) => (
						<div class="row-group" key={g.label}>
							<span class="nx-label row-group-label">{g.label}</span>
							{g.rows.length === 0 ? <p class="nx-empty pad-row">Nothing yet.</p> : null}
							{g.label === "Layers" && g.rows.length > 1 ? <p class="nx-note pad-row">Each layer paints over the ones above it in this list.</p> : null}
							{g.rows.map((r) => <RowView key={r.path} r={r} nodes={nodes} bad={marked.has(r.path)} hover={s.hover === r.path} />)}
						</div>
					))}
					{!unreadable ? <AddTerm nodes={nodes} into={null} /> : null}
				</div>
				<div class="form-page panel" hidden={!open}>
					{selected !== null ? <Panel node={selected} nodes={nodes} problems={marked.get(selected.path ?? "") ?? []} paused={paused()} /> : null}
				</div>
			</div>
		</div>
	);
}

function crumbsOf(node: ONode, nodes: readonly ONode[]): { label: string; path: string }[] {
	const chain: { label: string; path: string }[] = [];
	let list = nodes;
	for (const i of node.at.slice(0, -1)) {
		const n: ONode | undefined = list[i];
		if (n === undefined) {
			break;
		}
		if (n.path !== undefined) {
			chain.push({ label: n.name === "palette" ? "Colors" : labelFor(n), path: n.path });
		}
		list = n.kids;
	}
	return chain;
}

function Panel(props: { node: ONode; nodes: readonly ONode[]; problems: readonly string[]; paused: preact.JSX.Element | null }): preact.JSX.Element {
	const { node, nodes, problems } = props;
	const [showSource, setShowSource] = useState(false);
	const inPalette = node.path?.startsWith("palette/") === true;
	const isPalette = node.name === "palette" && node.path === "palette";
	const { term, fields, extra } = fieldsFor(node, inPalette);
	const pal = paletteOf(nodes);
	const defines = nodes.filter((n) => n.name === "define").map((n) => String(n.args[0]?.v));
	const toSource = (): void => {
		app.setMode("source");
	};
	const ctx: Ctx = { nodes, paletteAt: nodes.find((n) => n.name === "palette")?.at ?? null, names: pal.names, colors: pal.colors, defines, toSource };
	const hidden = onlyInSource(node, [...fields, ...extra], inPalette);
	const title = inPalette ? decodePathName(node.path!.slice(8)) : isPalette ? "Colors" : node.name === "variant" || node.name === "fold" || node.name === "define" ? capitalize(String(node.args[0]?.v ?? labelFor(node))) : labelFor(node);
	const desc = inPalette ? (node.args[0]?.v === "gradient" ? "A gradient between other colors, which can be used wherever a color is." : "Pantone, CMYK and other references travel with the color, and are never drawn from.") : isPalette ? "The flag's palette. Pantone, CMYK and other references travel with each color." : node.name === "charge" ? `${shapes[String(node.args[0]?.v)]?.label ?? "A shape"}, placed at a position.` : term?.desc ?? "";
	const noun = inPalette ? "color" : ["meta", "palette"].includes(node.name) ? "block" : node.name === "variant" ? "variant" : node.name === "fold" ? "fold" : "term";
	const text = app.state.text.slice(node.start, node.end);
	const holder = term?.layers === true && node.name !== "reverse" && node.name !== "variant" && node.name !== "define";
	const ownField = node.name === "canton" || node.name === "panel" ? node.kids.find((k) => k.path !== undefined && fieldIsOwn(node, k)) : undefined;
	const childRows: RowDef[] = [];
	if (term?.layers === true) {
		layerRows(node.kids, pal.colors, 0, childRows, node);
	}
	const canMove = node.path !== undefined && layerTerms[node.name] !== undefined;
	const siblings = canMove ? siblingsOf(node, nodes) : [];
	const place = siblings.indexOf(node);
	const removable = !["vexyl", "meta", "palette", "proportion"].includes(node.name);
	return (
		<>
			<nav aria-label="Where you are" class="crumbs">
				<button type="button" class="back" onClick={() => { app.select(null); }}>‹ Structure</button>
				{crumbsOf(node, nodes).map((c) => (
					<span key={c.path} class="crumb"><span aria-hidden="true" class="crumb-sep">/</span><button type="button" class="back" onClick={() => { app.select(c.path); }}>{c.label}</button></span>
				))}
			</nav>
			{props.paused}
			<div class="panel-head">
				<h2>{title}</h2>
				{desc !== "" ? <p class="panel-desc">{desc}</p> : null}
			</div>
			{problems.length > 0 ? <p class="nx-callout danger"><span>{problems.join(" ")}</span></p> : null}
			{isPalette ? <Palette node={node} nodes={nodes} ctx={ctx} /> : null}
			{node.name === "charge" ? <ChargeShape node={node} /> : null}
			{inPalette ? <NameField key={node.at.join(".")} node={node} kind="color" nodes={nodes} /> : null}
			{node.name === "variant" || node.name === "fold" || node.name === "define" ? <NameField key={node.at.join(".")} node={node} kind={node.name} nodes={nodes} /> : null}
			{ownField !== undefined ? (
				<FieldView f={{ k: "colorArg", label: "Field", i: 0 }} node={ownField} ctx={ctx} />
			) : null}
			{node.name === "proportion" && node.at.length === 1 ? <ProportionFields key={node.at.join(".")} node={node} fields={fields} ctx={ctx} /> : fields.map((f, i) => <FieldView key={`${node.at.join(".")}-${i}`} f={f} node={node} ctx={ctx} />)}
			{term?.layers === true ? (
				<div class="field">
					<span class="nx-label">{node.name === "emblem" ? "Charges" : "Layers"}</span>
					<div class="stack-tight">
						{childRows.map((r) => <RowView key={r.path} r={r} nodes={nodes} bad={false} hover={false} />)}
					</div>
					{holder || node.name === "reverse" || node.name === "variant" || node.name === "define" ? <AddTerm nodes={nodes} into={node} label={node.name === "emblem" ? "Add a charge" : "Add a layer"} onlyCharges={node.name === "emblem"} /> : null}
				</div>
			) : null}
			{extra.length > 0 ? (
				<details class="more">
					<summary>Opacity, blend and anchor</summary>
					<div class="stack gap">{extra.map((f, i) => <FieldView key={i} f={f} node={node} ctx={ctx} />)}</div>
				</details>
			) : null}
			{hidden.length > 0 ? (
				<div class="source-only">
					<span class="nx-note">The form can't edit {hidden.length === 1 ? "this" : "these"} yet, so {hidden.length === 1 ? "it stays" : "they stay"} just as written: <span class="mono">{hidden.join(", ")}</span>.</span>
					<button type="button" class="nx-link self-start" onClick={toSource}>Edit in the source</button>
				</div>
			) : null}
			{node.name === "outline" && (child(node, "polygon") !== undefined || child(node, "path") !== undefined) ? <p class="nx-note">This outline is drawn with a {child(node, "polygon") !== undefined ? "polygon" : "path"}, which is edited in the source.</p> : null}
			<div class="panel-actions">
				{canMove ? <button type="button" class="nx-ghost small" disabled={place <= 0} onClick={() => { moveAmongLayers(node, siblings, -1); }}>Move down a layer</button> : null}
				{canMove ? <button type="button" class="nx-ghost small" disabled={place < 0 || place >= siblings.length - 1} onClick={() => { moveAmongLayers(node, siblings, 1); }}>Move up a layer</button> : null}
				{removable ? <button type="button" class="nx-ghost small danger" onClick={() => {
					edit({ op: "remove", at: node.at });
					app.select(null, false);
				}}>Remove</button> : null}
			</div>
			<details class="term-source" open={showSource} onToggle={(e) => { setShowSource((e.currentTarget as HTMLDetailsElement).open); }}>
				<summary>Source for this {noun}</summary>
				<TermSource key={node.at.join(".")} node={node} text={text} noun={noun} />
				<button type="button" class="back link" onClick={toSource}>See it in the whole file</button>
			</details>
		</>
	);
}

function siblingsOf(node: ONode, nodes: readonly ONode[]): ONode[] {
	let list = nodes;
	for (const i of node.at.slice(0, -1)) {
		list = list[i]?.kids ?? [];
	}
	return list.filter((n) => n.path !== undefined && layerTerms[n.name] !== undefined);
}

/** The layers a row can move among, which leaves out a panel's own field, as it has no row. */
function rowSiblings(node: ONode, nodes: readonly ONode[]): ONode[] {
	let parent: ONode | undefined;
	let list = nodes;
	for (const i of node.at.slice(0, -1)) {
		parent = list[i];
		list = parent?.kids ?? [];
	}
	return list.filter((n) => n.path !== undefined && layerTerms[n.name] !== undefined && !(parent !== undefined && fieldIsOwn(parent, n)));
}

/** Moves a layer to another's place among its siblings, stepping past each one between. */
function moveLayer(node: ONode, siblings: readonly ONode[], to: number): void {
	const from = siblings.indexOf(node);
	if (from < 0 || to < 0 || to >= siblings.length || from === to) {
		return;
	}
	const ops: Op[] = [];
	const at = [...node.at];
	const step = to > from ? 1 : -1;
	for (let i = from + step; i !== to + step; i += step) {
		const other = siblings[i]!.at.at(-1)!;
		ops.push({ op: "move", at: [...at], delta: other - at.at(-1)! });
		at[at.length - 1] = other;
	}
	edit(...ops);
	app.hover(null);
}

let draggedRow: ONode | null = null;

const sameLevel = (a: ONode, b: ONode): boolean => a.at.slice(0, -1).join(".") === b.at.slice(0, -1).join(".");

/** A row in a list of what a flag has. A layer's can also be moved or taken out from where it is. */
function RowView(props: { r: RowDef; nodes: readonly ONode[]; bad: boolean; hover: boolean }): preact.JSX.Element {
	const { r, nodes, bad } = props;
	const [over, setOver] = useState(false);
	const button = (
		<button type="button" class={`row depth-${Math.min(r.depth, 4)}${props.hover ? " hover" : ""}${bad ? " bad" : ""}`} data-path={r.path}
			onClick={() => { app.select(r.path); }} onMouseEnter={() => { app.hover(r.path); }} onMouseLeave={() => { app.hover(null); }} onFocus={() => { app.hover(r.path); }} onBlur={() => { app.hover(null); }}>
			{r.swatch !== undefined ? <span class="swatch" aria-hidden="true" style={{ background: r.swatch }} /> : null}
			<span class="row-label">{r.label}</span>
			<span class={`row-note${r.mono === true ? " mono" : ""}`}>{r.note}</span>
			{bad ? <span class="visually-hidden">has a problem</span> : null}
			<span class="row-go" aria-hidden="true">›</span>
		</button>
	);
	const layer = r.layer;
	if (layer === undefined) {
		return button;
	}
	const siblings = rowSiblings(layer, nodes);
	const place = siblings.indexOf(layer);
	return (
		<div class={`row-wrap${over ? " row-over" : ""}`} draggable data-row={r.path}
			onDragStart={(e) => {
				e.stopPropagation();
				e.dataTransfer?.setData("text/plain", r.label);
				if (e.dataTransfer !== null) {
					e.dataTransfer.effectAllowed = "move";
				}
				draggedRow = layer;
			}}
			onDragOver={(e) => {
				if (draggedRow !== null && draggedRow !== layer && sameLevel(draggedRow, layer)) {
					e.preventDefault();
					e.stopPropagation();
					setOver(true);
				}
			}}
			onDragLeave={() => { setOver(false); }}
			onDrop={(e) => {
				e.preventDefault();
				e.stopPropagation();
				setOver(false);
				if (draggedRow !== null && sameLevel(draggedRow, layer)) {
					moveLayer(draggedRow, siblings, place);
				}
				draggedRow = null;
			}}
			onDragEnd={() => {
				draggedRow = null;
				setOver(false);
			}}>
			<span class="row-grip" aria-hidden="true">⠿</span>
			{button}
			<span class="row-actions">
				<button type="button" class="row-act" aria-label={`Move ${r.label} up the list`} title="Up the list" disabled={place <= 0} onClick={() => { moveLayer(layer, siblings, place - 1); }}>↑</button>
				<button type="button" class="row-act" aria-label={`Move ${r.label} down the list`} title="Down the list" disabled={place < 0 || place >= siblings.length - 1} onClick={() => { moveLayer(layer, siblings, place + 1); }}>↓</button>
				<button type="button" class="row-act" aria-label={`Remove ${r.label}`} title="Remove" onClick={() => { edit({ op: "remove", at: layer.at }); app.hover(null); }}>×</button>
			</span>
		</div>
	);
}

function moveAmongLayers(node: ONode, siblings: readonly ONode[], delta: number): void {
	const i = siblings.indexOf(node);
	const other = siblings[i + delta];
	if (other !== undefined) {
		const moved = other.at.at(-1)! - node.at.at(-1)!;
		edit({ op: "move", at: node.at, delta: moved });
		app.select(null, false);
	}
}

/** The flag's shape and grid, which can be restated without changing the picture, or changed. */
function ProportionFields(props: { node: ONode; fields: readonly Field[]; ctx: Ctx }): preact.JSX.Element {
	const { node, fields, ctx } = props;
	const hoist = shown(prop(node, "hoist"));
	const fly = shown(prop(node, "fly"));
	const [mode, setMode] = useState("rescale");
	const [draft, setDraft] = useState<{ hoist: string; fly: string } | null>(null);
	const [preview, setPreview] = useState<RescalePreview | null>(null);
	const text = app.state.text;
	const wanted = draft !== null && draft.hoist !== hoist ? draft.hoist : null;
	useEffect(() => {
		setPreview(null);
		if (wanted === null || wanted === "") {
			return undefined;
		}
		let live = true;
		const timer = setTimeout(() => {
			void engine.ask({ kind: "rescalePreview", text, hoist: wanted }).then((p) => {
				if (live) {
					setPreview(p);
				}
			});
		}, 200);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [wanted, text]);
	const shape = shapeText(hoist, fly);
	const times = flyPerHoist(hoist, fly);
	const rounded = preview?.rounded ?? [];
	const fill = (h: string): void => { setDraft({ hoist: h, fly: matching(h, hoist, fly) ?? "" }); };
	return (
		<>
			<div class="field">
				<span class="nx-label">Shape</span>
				<span class="proportion-shape">{shape ?? `${hoist}:${fly}`}</span>
				<span class="nx-note">{times !== null ? `It's ${times} times as long as it is tall. ` : ""}Its grid is {hoist} by {fly} units, and every size in this file is measured in those.</span>
			</div>
			<Row label="When these numbers change">
				<Seg label="When these numbers change" value={mode} options={[["rescale", "Rescale the grid"], ["shape", "Change the shape"]]} onPick={(v) => { setMode(v); setDraft(null); }} />
			</Row>
			{mode === "shape" ? (
				<>
					<p class="nx-note">Only these numbers change. Everything else stays where it is, so the design may need moving to fit.</p>
					{fields.map((f, i) => <FieldView key={`${node.at.join(".")}-${i}`} f={f} node={node} ctx={ctx} />)}
				</>
			) : (
				<>
					<p class="nx-note">Every length is multiplied by the same amount, so the flag looks just the same on its new grid.</p>
					<div class="chips">
						<Input id={fieldId("rescale-hoist", node.at)} label="Hoist" number value={draft?.hoist ?? hoist} onChange={(t) => { setDraft({ hoist: t, fly: matching(t, hoist, fly) ?? "" }); }} />
						<Input id={fieldId("rescale-fly", node.at)} label="Fly" number value={draft?.fly ?? fly} onChange={(t) => { setDraft({ hoist: matching(t, fly, hoist) ?? "", fly: t }); }} />
					</div>
					{preview?.error !== undefined ? <p class="nx-callout danger"><span>{preview.error}</span></p> : null}
					{preview !== null && preview.error === undefined ? (
						<div class="stack-tight" role="status">
							<p class="nx-note">{preview.changed} {preview.changed === 1 ? "length" : "lengths"} will be multiplied by {preview.factor}.{preview.comments === true ? " Comments stay as they're written, so any numbers in them won't match." : ""}</p>
							{rounded.length > 0 ? (
								<p class="nx-callout warn"><span>{rounded.length} {rounded.length === 1 ? "number" : "numbers"} can't be written exactly and will be rounded: {rounded.slice(0, 3).map(([a, b]) => `${a} becomes ${b}`).join(", ")}{rounded.length > 3 ? ", and more" : ""}.</span></p>
							) : null}
							{rounded.length > 0 && (preview.exact ?? []).length > 0 ? (
								<div class="chips">
									<span class="nx-note">These stay exact:</span>
									{preview.exact!.map(([h, f]) => <button key={h} type="button" class="nx-ghost small" onClick={() => { fill(h); }}>{h}:{f}</button>)}
								</div>
							) : null}
							<div class="panel-actions">
								<button type="button" class="nx-btn small" onClick={() => {
									void app.edit([{ op: "rescale", hoist: wanted! }]).then(() => { setDraft(null); });
								}}>Rescale</button>
								<button type="button" class="nx-ghost small" onClick={() => { setDraft(null); }}>Cancel</button>
							</div>
						</div>
					) : null}
				</>
			)}
		</>
	);
}

function ChargeShape(props: { node: ONode }): preact.JSX.Element {
	const { node } = props;
	const value = String(node.args[0]?.v ?? "");
	const id = fieldId("shape", node.at);
	const known = Object.hasOwn(shapes, value);
	return (
		<Row label="Shape" id={id} note="Changing the shape keeps sizes they share. Others stay in the file until you change them.">
			<select id={id} class="nx-input select medium" value={value} onChange={(e) => {
				const args = [...node.args];
				args[0] = vStr((e.currentTarget as HTMLSelectElement).value);
				edit({ op: "entries", at: node.at, args });
			}}>
				{known ? null : <option value={value}>{value}</option>}
				{Object.entries(shapes).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
			</select>
		</Row>
	);
}

function Palette(props: { node: ONode; nodes: readonly ONode[]; ctx: Ctx }): preact.JSX.Element {
	const { node, ctx } = props;
	return (
		<div class="field">
			<span class="nx-label">Palette</span>
			<div class="chips">
				{node.kids.map((k) => (
					<button type="button" key={k.at.join(".")} class="nx-chip on color-chip" data-path={k.path} onClick={() => { app.select(k.path ?? null); }}>
						<span class="dot" aria-hidden="true" style={{ background: ctx.colors.get(k.name) ?? "transparent" }} />
						{k.name}{"  "}<span class="mono">{k.args[0]?.v === "gradient" ? "gradient" : String(k.args[0]?.v ?? "")}</span>
					</button>
				))}
				<button type="button" class="nx-ghost small" onClick={() => { addTerm("color", props.nodes, null); }}>Add a color</button>
				<button type="button" class="nx-ghost small" onClick={() => { addTerm("gradient", props.nodes, null); }}>Add a gradient</button>
			</div>
		</div>
	);
}

/** A term's name, which is only changed to one it can have. */
function NameField(props: { node: ONode; kind: NameKind; nodes: readonly ONode[] }): preact.JSX.Element {
	const { node, kind, nodes } = props;
	const current = kind === "color" ? node.name : String(node.args[0]?.v);
	const [draft, setDraft] = useState<string | null>(null);
	const box = useRef<HTMLInputElement>(null);
	useLayoutEffect(() => {
		if (namingNext !== null && namingNext === node.path) {
			namingNext = null;
			box.current?.focus({ preventScroll: true });
			box.current?.select();
		}
	}, [node.path]);
	const wanted = (draft ?? current).trim();
	const problem = wanted === current ? null : nameProblem(kind, wanted, takenNames(kind, nodes));
	const id = fieldId(`${kind}-name`, node.at);
	const commit = (): void => {
		if (draft === null || problem !== null) {
			return;
		}
		setDraft(null);
		if (wanted !== current) {
			const op: Op = kind === "color" ? { op: "renameColor", from: current, to: wanted } : { op: "renameTerm", kind, from: current, to: wanted };
			void app.changeAndFollow([op], { at: node.at });
		}
	};
	return (
		<div class="field">
			<label class="nx-label" for={id}>Name</label>
			<input ref={box} id={id} class="nx-input medium" spellcheck={false} value={draft ?? current} aria-invalid={problem !== null ? "true" : undefined} onInput={(e) => { setDraft((e.currentTarget as HTMLInputElement).value); }} onBlur={commit} onKeyDown={(e) => {
				if (e.key === "Enter") {
					commit();
				} else if (e.key === "Escape") {
					setDraft(null);
				}
			}} />
			{problem !== null ? <span class="nx-error" role="alert">{problem}</span> : null}
			{kind === "color" || kind === "define" ? <span class="nx-note">Renaming it changes it everywhere the flag uses it.</span> : null}
		</div>
	);
}

/** A term's own text, to change right here. Past this, the whole file is the better place. */
const longestTermSource = 64 * 1024;

function TermSource(props: { node: ONode; text: string; noun: string }): preact.JSX.Element {
	const { node, text, noun } = props;
	const [draft, setDraft] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		setDraft(null);
		setError(null);
	}, [text]);
	if (text.length > longestTermSource) {
		return <pre tabIndex={0} aria-label={`Source for this ${noun}`}>{text.slice(0, 4000) + "\n…"}</pre>;
	}
	const shown = draft ?? text;
	return (
		<div class="stack-tight term-source-edit">
			<textarea class="nx-input wide mono" spellcheck={false} aria-label={`Source for this ${noun}`} rows={Math.min(shown.split("\n").length + 1, 18)} value={shown} aria-invalid={error !== null ? "true" : undefined} onInput={(e) => {
				setDraft((e.currentTarget as HTMLTextAreaElement).value);
				setError(null);
			}} />
			{error !== null ? <span class="nx-error" role="alert">{error}</span> : null}
			{draft !== null && draft !== text ? (
				<div class="panel-actions">
					<button type="button" class="nx-btn small" onClick={() => {
						void app.changeAndFollow([{ op: "replaceText", start: node.start, end: node.end, was: text, to: draft }], { at: node.at }).then((e) => { setError(e ?? null); });
					}}>Apply</button>
					<button type="button" class="nx-ghost small" onClick={() => { setDraft(null); setError(null); }}>Discard</button>
				</div>
			) : null}
		</div>
	);
}

export { parts };
