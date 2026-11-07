// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { useEffect, useRef, useState } from "preact/hooks";
import { decodePathName } from "vexyl/paths";
import { FileLink, safeColor, Seg, useApp } from "./common.js";
import type { ONode, Op, OVal } from "./protocol.js";
import { app, findPath } from "./store.js";
import { addable, fieldsFor, handledChildren, layers as layerTerms, parts, repeatForms, shapes, shortLabel, skeletonFor, stepKinds, type Field } from "./vocab.js";

const numberText = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/;
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
	const bad = props.number === true && text !== "" && !numberText.test(text);
	const id = props.id ?? fieldId(props.label, [Math.round(props.label.length)]);
	const Tag = props.long === true ? "textarea" : "input";
	return (
		<div class="field">
			{props.hideLabel === true ? null : <label class="nx-label" for={id}>{props.label}</label>}
			<Tag id={id} class={`nx-input ${props.wide === true ? "wide" : props.number === true ? "short" : "medium"} ${props.mono === true || props.number === true ? "mono" : ""}`} value={text} readOnly={props.readonly === true}
				aria-label={props.hideLabel === true ? props.label : undefined} placeholder={props.placeholder} inputMode={props.number === true ? "decimal" : undefined} aria-invalid={bad ? "true" : undefined} spellcheck={false}
				onInput={(e) => {
					const v = (e.currentTarget as HTMLInputElement).value;
					setDraft(v);
					if (!(props.number === true && v !== "" && !numberText.test(v))) {
						props.onChange(v);
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

function ColorSelect(props: { id: string; label: string; value: string; names: readonly string[]; colors: ReadonlyMap<string, string>; onPick: (v: string) => void; allowNone?: string; addOnly?: boolean; hideLabel?: boolean }): preact.JSX.Element {
	const all = props.value !== "" && !props.names.includes(props.value) && props.value !== "none" ? [props.value, ...props.names] : props.names;
	return (
		<span class="color-select">
			{props.addOnly === true ? null : <span class="swatch" aria-hidden="true" style={{ background: props.colors.get(props.value) ?? "transparent" }} />}
			<select id={props.id} class="nx-input select" aria-label={props.hideLabel === true ? props.label : undefined} value={props.addOnly === true ? "" : props.value}
				onChange={(e) => {
					const v = (e.currentTarget as HTMLSelectElement).value;
					props.onPick(v);
					if (props.addOnly === true) {
						(e.currentTarget as HTMLSelectElement).value = "";
					}
				}}>
				{props.addOnly === true ? <option value="" disabled>Add a color</option> : null}
				{props.allowNone !== undefined ? <option value="">{props.allowNone}</option> : null}
				{all.map((n) => <option key={n} value={n}>{n}</option>)}
				<option value="none">none, a gap</option>
			</select>
		</span>
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
			<Input id={id} label={f.label} value={text} mono wide {...(f.note !== undefined ? { note: f.note } : {})} onChange={(t) => {
				const words = t.trim().split(/\s+/).filter((w) => w !== "");
				if (words.length === 0) {
					edit({ op: "dropChild", at: node.at, name: f.child });
				} else if (words.every((w) => numberText.test(w))) {
					edit({ op: "child", at: node.at, name: f.child, args: words.map(vNum) });
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

function At(props: { node: ONode; f: Field & { k: "at" } }): preact.JSX.Element {
	const { node, f } = props;
	const all = children(node, "at");
	const row = (a: ONode | undefined, nth: number): preact.JSX.Element => {
		const id = fieldId("at", node.at, `-${nth}`);
		const center = a?.args[0]?.v === "center";
		return (
			<div class="inline-fields" key={nth}>
				<Input id={`${id}-f`} label="Fly" value={center ? "" : shown(prop(a, "fly"))} number placeholder={center || a === undefined ? "Center" : ""} onChange={(t) => {
					edit(t === "" && shown(prop(a, "hoist")) === "" ? { op: "dropChild", at: node.at, name: "at", nth } : { op: "child", at: node.at, name: "at", nth, args: [], props: [["fly", t === "" ? vNum("0") : vNum(t)], ["hoist", prop(a, "hoist") ?? vNum("0")]] });
				}} />
				<Input id={`${id}-h`} label="Hoist" value={center ? "" : shown(prop(a, "hoist"))} number placeholder={center || a === undefined ? "Center" : ""} onChange={(t) => {
					edit(t === "" && shown(prop(a, "fly")) === "" ? { op: "dropChild", at: node.at, name: "at", nth } : { op: "child", at: node.at, name: "at", nth, args: [], props: [["fly", prop(a, "fly") ?? vNum("0")], ["hoist", t === "" ? vNum("0") : vNum(t)]] });
				}} />
				{a !== undefined && all.length > 1 ? <button type="button" class="nx-ghost small" aria-label={`Remove position ${nth + 1}`} onClick={() => { edit({ op: "dropChild", at: node.at, name: "at", nth }); }}>Remove</button> : null}
			</div>
		);
	};
	return (
		<Row label={f.label} note={f.note}>
			<div class="stack">
				{all.length === 0 ? row(undefined, 0) : all.map((a, i) => row(a, i))}
				{f.many === true && all.length > 0 ? <button type="button" class="nx-ghost small self-start" onClick={() => { edit({ op: "child", at: node.at, name: "at", nth: all.length, args: [], props: [["fly", vNum("0")], ["hoist", vNum("0")]] }); }}>Add a position</button> : null}
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

interface Ctx {
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
					}} />
				</Row>
			);
		}
		case "colorArgs": {
			const list = node.args.slice(f.from);
			return (
				<Row label={f.label} id={`${id}-add`} note={f.note}>
					<div class="chips">
						{list.map((c, i) => (
							<span class="nx-chip on color-chip" key={i}>
								<span class="dot" aria-hidden="true" style={{ background: ctx.colors.get(String(c.v)) ?? "transparent" }} />{String(c.v)}
								<button type="button" class="chip-x" aria-label={`Remove ${String(c.v)}, color ${i + 1}`} disabled={list.length === 1} onClick={() => {
									const args = [...node.args];
									args.splice(f.from + i, 1);
									edit({ op: "entries", at: node.at, args });
								}}>×</button>
							</span>
						))}
						<ColorSelect id={`${id}-add`} label="Add a color" hideLabel value="" addOnly names={ctx.names} colors={ctx.colors} onPick={(v) => {
							if (v !== "") {
								edit({ op: "entries", at: node.at, args: [...node.args, vStr(v)] });
							}
						}} />
					</div>
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
			return child(node, "repeat")?.args[0]?.v === "grid" ? <></> : <At node={node} f={f} />;
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
		if (layerKids && k.path !== undefined) {
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
}

function layerRows(list: readonly ONode[], colors: ReadonlyMap<string, string>, depth: number, out: RowDef[], parent?: ONode): void {
	for (const n of list) {
		if (n.path === undefined || (layerTerms[n.name] === undefined)) {
			continue;
		}
		if (parent !== undefined && fieldIsOwn(parent, n)) {
			continue;
		}
		out.push({ path: n.path, label: labelFor(n), note: noteFor(n), swatch: swatchFor(n, colors), depth });
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
				flag.push({ path: "proportion", label: "Proportion", note: `${shown(prop(n, "hoist"))}:${shown(prop(n, "fly"))}`, mono: true, depth: 0 });
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

/** Where a new term goes, by what it is. */
function addTerm(key: string, nodes: readonly ONode[], into: ONode | null): void {
	const { names } = paletteOf(nodes);
	const text = skeletonFor(key, names);
	if (key === "color" || key === "gradient") {
		const palette = nodes.find((n) => n.name === "palette");
		if (palette !== undefined) {
			edit({ op: "add", at: palette.at, text });
		}
		return;
	}
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
								{g.items.map(([key, label]) => (
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
							{g.rows.map((r) => {
								const bad = marked.has(r.path);
								return (
									<button key={r.path} type="button" class={`row depth-${Math.min(r.depth, 4)}${s.hover === r.path ? " hover" : ""}${bad ? " bad" : ""}`} data-path={r.path}
										onClick={() => { app.select(r.path); }} onMouseEnter={() => { app.hover(r.path); }} onMouseLeave={() => { app.hover(null); }} onFocus={() => { app.hover(r.path); }} onBlur={() => { app.hover(null); }}>
										{r.swatch !== undefined ? <span class="swatch" aria-hidden="true" style={{ background: r.swatch }} /> : null}
										<span class="row-label">{r.label}</span>
										<span class={`row-note${r.mono === true ? " mono" : ""}`}>{r.note}</span>
										{bad ? <span class="visually-hidden">has a problem</span> : null}
										<span class="row-go" aria-hidden="true">›</span>
									</button>
								);
							})}
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
	const ctx: Ctx = { names: pal.names, colors: pal.colors, defines, toSource };
	const hidden = onlyInSource(node, [...fields, ...extra], inPalette);
	const title = inPalette ? decodePathName(node.path!.slice(8)) : isPalette ? "Colors" : node.name === "variant" || node.name === "fold" || node.name === "define" ? capitalize(String(node.args[0]?.v ?? labelFor(node))) : labelFor(node);
	const desc = inPalette ? (node.args[0]?.v === "gradient" ? "A gradient between other colors, which can be used wherever a color is." : "Pantone, CMYK and other references travel with the color, and are never drawn from.") : isPalette ? "The flag's palette. Pantone, CMYK and other references travel with each color." : node.name === "charge" ? `${shapes[String(node.args[0]?.v)]?.label ?? "A shape"}, placed at a position.` : term?.desc ?? "";
	const noun = inPalette ? "color" : ["meta", "palette"].includes(node.name) ? "block" : node.name === "variant" ? "variant" : node.name === "fold" ? "fold" : "term";
	const text = app.state.text.slice(node.start, node.end);
	const capped = text.length > 4000 ? text.slice(0, 4000) + "\n…" : text;
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
			{isPalette ? <Palette node={node} ctx={ctx} /> : null}
			{node.name === "charge" ? <ChargeShape node={node} /> : null}
			{inPalette ? <ColorName node={node} /> : null}
			{ownField !== undefined ? (
				<FieldView f={{ k: "colorArg", label: "Field", i: 0 }} node={ownField} ctx={ctx} />
			) : null}
			{fields.map((f, i) => <FieldView key={`${node.at.join(".")}-${i}`} f={f} node={node} ctx={ctx} />)}
			{term?.layers === true ? (
				<div class="field">
					<span class="nx-label">{node.name === "emblem" ? "Charges" : "Layers"}</span>
					<div class="stack-tight">
						{childRows.map((r) => (
							<button key={r.path} type="button" class={`row depth-${Math.min(r.depth, 4)}`} onClick={() => { app.select(r.path); }} onMouseEnter={() => { app.hover(r.path); }} onMouseLeave={() => { app.hover(null); }}>
								{r.swatch !== undefined ? <span class="swatch" aria-hidden="true" style={{ background: r.swatch }} /> : null}
								<span class="row-label">{r.label}</span><span class="row-note">{r.note}</span><span class="row-go" aria-hidden="true">›</span>
							</button>
						))}
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
				<pre tabIndex={0} aria-label={`Source for this ${noun}`}>{capped}</pre>
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

function moveAmongLayers(node: ONode, siblings: readonly ONode[], delta: number): void {
	const i = siblings.indexOf(node);
	const other = siblings[i + delta];
	if (other !== undefined) {
		const moved = other.at.at(-1)! - node.at.at(-1)!;
		edit({ op: "move", at: node.at, delta: moved });
		app.select(null, false);
	}
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

function Palette(props: { node: ONode; ctx: Ctx }): preact.JSX.Element {
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
				<button type="button" class="nx-ghost small" onClick={() => { edit({ op: "add", at: node.at, text: skeletonFor("color", []) }); }}>Add a color</button>
				<button type="button" class="nx-ghost small" onClick={() => { edit({ op: "add", at: node.at, text: skeletonFor("gradient", ctx.names) }); }}>Add a gradient</button>
			</div>
		</div>
	);
}

function ColorName(props: { node: ONode }): preact.JSX.Element {
	const { node } = props;
	return (
		<Input id={fieldId("color-name", node.at)} label="Name" value={node.name} note="Renaming it changes it everywhere the flag uses it." onChange={(t) => {
			if (t !== "" && t !== node.name) {
				void app.edit([{ op: "renameColor", from: node.name, to: t }]).then(() => {
					app.select(`palette/${t.replaceAll("%", "%25").replaceAll("/", "%2F")}`, false);
				});
			}
		}} />
	);
}

export { parts };
