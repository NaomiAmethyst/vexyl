// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Basic's Details tab: a flag's name and description, with everything else folded away. The boxes
// are the same as Advanced's, under plainer labels.

import { FieldView, Input, paletteOf, type Ctx } from "./form.js";
import { kid } from "./flagview.js";
import type { ONode, Op } from "./protocol.js";
import { app } from "./store.js";
import { colorFields, parts, type Field } from "./vocab.js";

const edit = (op: Op): void => {
	void app.edit([op]);
};

/** A field of the file's details, by its child's name, under a plainer label if it needs one. */
function metaField(child: string, label?: string, note?: string): Field {
	const f = parts.meta!.fields.find((x) => "child" in x && x.child === child)!;
	return { ...f, ...(label !== undefined ? { label } : {}), ...(note !== undefined ? { note } : {}) } as Field;
}

const credit: readonly Field[] = [
	metaField("designer", "Who designed it"),
	metaField("encoder", "Who made this file"),
	metaField("license", "License for this file"),
	metaField("render-license", "License for pictures of it"),
	metaField("design-rights"),
	metaField("adapted-from", "Made from another work"),
];

const restsOn: readonly Field[] = [
	metaField("law", "Laws"),
	metaField("restriction", "Restrictions"),
	metaField("source", "Sources"),
	metaField("note", "Notes"),
	metaField("version"),
	metaField("date"),
	metaField("until"),
	metaField("series"),
];

function NameBox(props: { meta: ONode; child: string; label: string; placeholder?: string }): preact.JSX.Element {
	const { meta, child, label } = props;
	return <Input id={`d-${child}`} label={label} wide value={String(kid(meta, child)?.args[0]?.v ?? "")} {...(props.placeholder !== undefined ? { placeholder: props.placeholder } : {})} onChange={(t) => { edit(t === "" ? { op: "dropChild", at: meta.at, name: child } : { op: "child", at: meta.at, name: child, args: [{ v: t }] }); }} />;
}

function Elsewhere(props: { nodes: readonly ONode[]; names: readonly string[]; words: (n: ONode) => string }): preact.JSX.Element | null {
	const found = props.nodes.filter((n) => props.names.includes(n.name));
	if (found.length === 0) {
		return null;
	}
	return (
		<ul class="details-list">
			{found.map((n, i) => (
				<li key={i}>
					<span>{props.words(n)}</span>
					<button type="button" class="nx-link" onClick={() => { app.editInAdvanced(n.path ?? null); }}>Edit in Advanced</button>
				</li>
			))}
		</ul>
	);
}

const formWords = (n: ONode): string => {
	switch (n.name) {
		case "reverse": return "A different back";
		case "adapt": return "Other proportions";
		case "variant": return `Variant: ${String(n.args[0]?.v)}`;
		default: return `Fold: ${String(n.args[0]?.v)}`;
	}
};

export function BasicDetails(props: { nodes: readonly ONode[] }): preact.JSX.Element {
	const { nodes } = props;
	const meta = nodes.find((n) => n.name === "meta");
	const palette = nodes.find((n) => n.name === "palette");
	const pal = paletteOf(nodes);
	const ctx: Ctx = { nodes, paletteAt: palette?.at ?? null, names: pal.names, colors: pal.colors, defines: [], toSource: () => { app.setMode("source"); } };
	const printing = colorFields.filter((f) => f.k !== "argText" && f.k !== "heading");
	const section = (title: string, about: string, body: preact.ComponentChildren): preact.JSX.Element => (
		<details class="details-part">
			<summary>{title}</summary>
			<p class="nx-note">{about}</p>
			<div class="stack gap">{body}</div>
		</details>
	);
	return (
		<div class="basic-page details-page">
			{meta !== undefined ? (
				<>
					<NameBox meta={meta} child="name" label="Name" />
					<NameBox meta={meta} child="description" label="Description" placeholder="e.g. The flag of a neighborhood association" />
				</>
			) : null}
			<p class="plain muted-text">None of this changes how the flag looks. It's for when you publish it, and all of it is optional.</p>
			{meta !== undefined ? section("Credit and license", "Who designed it, who made this file, and how others may use it.", credit.map((f, i) => <FieldView key={i} f={f} node={meta} ctx={ctx} />)) : null}
			{meta !== undefined ? section("What it rests on", "Laws, sources and notes, for a flag with an official specification.", restsOn.map((f, i) => <FieldView key={i} f={f} node={meta} ctx={ctx} />)) : null}
			{section("Other forms of this flag", "Vertical or upside-down variants, a different back, other proportions, and folds. These are made in Advanced.", (
				<>
					<Elsewhere nodes={nodes} names={["reverse", "adapt", "variant", "fold"]} words={formWords} />
					<button type="button" class="nx-ghost small self-start" onClick={() => { app.editInAdvanced(null); }}>Go to Advanced</button>
				</>
			))}
			{section("For printing and manufacture", "Pantone, CMYK and other references for each color.", (palette?.kids ?? []).filter((k) => k.args[0]?.v !== "gradient").map((k) => (
				<details class="details-color" key={k.name}>
					<summary><span class="dot" aria-hidden="true" style={{ background: pal.colors.get(k.name) ?? "transparent" }} />{k.name}</summary>
					<div class="stack gap">{printing.map((f, i) => <FieldView key={i} f={f} node={k} ctx={ctx} />)}</div>
				</details>
			)))}
			{section("Reusable parts", "Shapes and designs with a name, for using several times in this flag. These are made in Advanced.", (
				<>
					<Elsewhere nodes={nodes} names={["define"]} words={(n) => String(n.args[0]?.v)} />
					<button type="button" class="nx-ghost small self-start" onClick={() => { app.editInAdvanced(null); }}>Go to Advanced</button>
				</>
			))}
		</div>
	);
}
