// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// What the page and its worker say to each other. Every document is read in the worker, so a large
// one can't stall the page, and what comes back is plain data.

import type { Options, Problem, Span } from "vexyl";

export interface OVal {
	v: string | number | boolean | null;
	/** How it's written in the file, for a number. */
	raw?: string;
	/** The whole length of a string too long to send, of which `v` is the start. */
	big?: number;
}

/** A node as the file has it, which is what the form reads. */
export interface ONode {
	name: string;
	args: OVal[];
	props: [string, OVal][];
	kids: ONode[];
	/** Its place in the document, as an index at each level. */
	at: number[];
	/** Its path, if it's a layer or another part with one, as SDK.md section 7 says. */
	path?: string;
	start: number;
	end: number;
	line: number;
	endLine: number;
	block: boolean;
}

export interface Analysis {
	problems: Problem[];
	/** Whether it's valid, and so can be drawn. */
	valid: boolean;
	/** Whether it's KDL, and so can be read at all. */
	readable: boolean;
	nodes: ONode[];
	spans: Span[];
	model: Record<string, unknown> | null;
}

export interface PickNode {
	n: string;
	a: [string, string][];
	c?: PickNode[];
}

export interface RenderResult {
	svg?: string;
	refused?: string;
	pick?: PickNode;
	width?: number;
	height?: number;
}

export type Op =
	| { op: "entries"; at: number[]; args?: OVal[]; props?: [string, OVal | null][] }
	| { op: "child"; at: number[]; name: string; args?: OVal[]; props?: [string, OVal | null][]; nth?: number }
	| { op: "dropChild"; at: number[]; name: string; nth?: number }
	| { op: "remove"; at: number[] }
	| { op: "add"; at: number[] | null; text: string; index?: number }
	| { op: "move"; at: number[]; delta: number }
	| { op: "renameColor"; from: string; to: string }
	| { op: "renameTerm"; kind: "variant" | "fold" | "define"; from: string; to: string }
	| { op: "replaceText"; start: number; end: number; was: string; to: string };

export type Request =
	| { kind: "analyze"; slot: string; text: string }
	| { kind: "render"; slot: string; options: Options; pick?: boolean; exact?: boolean }
	| { kind: "edit"; text: string; ops: Op[] }
	| { kind: "shareEncode"; text: string }
	| { kind: "shareDecode"; link: string };

export type Reply<K extends Request["kind"]> = K extends "analyze"
	? Analysis
	: K extends "render"
		? RenderResult
		: K extends "edit"
			? { text?: string; error?: string }
			: K extends "shareEncode"
				? { link?: string; error?: string }
				: K extends "shareDecode"
					? { text?: string; error?: string }
					: never;
