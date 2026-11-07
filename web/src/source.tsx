// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory, redo, undo } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StringStream } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, lineNumbers, WidgetType, type DecorationSet } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Problem } from "vexyl";
import { useEffect, useRef } from "preact/hooks";
import { app } from "./store.js";

interface KdlState {
	inString: "plain" | "multi" | null;
	rawHashes: number;
	comment: number;
	atStart: boolean;
}

const bare = /^[^\s\\/(){}[\]<>;="#]+/;

/** KDL v2's tokens, for coloring. It needn't be a parser, since the library says what's valid. */
const kdl = StreamLanguage.define<KdlState>({
	name: "kdl",
	startState: () => ({ inString: null, rawHashes: 0, comment: 0, atStart: true }),
	token(stream: StringStream, s: KdlState): string | null {
		if (s.comment > 0) {
			while (!stream.eol()) {
				if (stream.match("/*")) {
					s.comment++;
				} else if (stream.match("*/")) {
					s.comment--;
					if (s.comment === 0) {
						break;
					}
				} else {
					stream.next();
				}
			}
			return "comment";
		}
		if (s.inString !== null) {
			const close = s.inString === "multi" ? '"""' + "#".repeat(s.rawHashes) : '"' + "#".repeat(s.rawHashes);
			while (!stream.eol()) {
				if (stream.match(close)) {
					s.inString = null;
					s.rawHashes = 0;
					return "string";
				}
				if (s.rawHashes === 0 && stream.peek() === "\\") {
					stream.next();
				}
				stream.next();
			}
			return "string";
		}
		if (stream.sol()) {
			s.atStart = true;
		}
		if (stream.eatSpace()) {
			return null;
		}
		if (stream.match("//")) {
			stream.skipToEnd();
			return "comment";
		}
		if (stream.match("/*")) {
			s.comment = 1;
			return "comment";
		}
		if (stream.match("/-")) {
			return "comment";
		}
		const raw = stream.match(/^(#+)"("")?/) as RegExpMatchArray | false | null;
		if (raw) {
			s.rawHashes = raw[1]!.length;
			s.inString = raw[2] !== undefined ? "multi" : "plain";
			s.atStart = false;
			return "string";
		}
		if (stream.match('"""')) {
			s.inString = "multi";
			s.rawHashes = 0;
			s.atStart = false;
			return "string";
		}
		if (stream.eat('"')) {
			s.inString = "plain";
			s.rawHashes = 0;
			s.atStart = false;
			return "string";
		}
		if (stream.match(/^#(true|false|null|inf|-inf|nan)\b/)) {
			s.atStart = false;
			return "atom";
		}
		if (stream.match(/^[+-]?\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?(?=[\s;={})]|$)/) || stream.match(/^[+-]?0[xob][\da-fA-F_]+/)) {
			s.atStart = false;
			return "number";
		}
		if (stream.eat(/[{};]/)) {
			s.atStart = true;
			return "brace";
		}
		if (stream.eat(/[()=\\]/)) {
			return "punctuation";
		}
		const word = stream.match(bare) as RegExpMatchArray | false | null;
		if (word) {
			const first = s.atStart;
			s.atStart = false;
			return first ? "keyword" : stream.peek() === "=" ? "propertyName" : "variableName";
		}
		stream.next();
		return null;
	},
});

const highlight = HighlightStyle.define([
	{ tag: t.keyword, color: "var(--accent)" },
	{ tag: t.string, color: "var(--code-string)" },
	{ tag: t.number, color: "var(--code-number)" },
	{ tag: t.atom, color: "var(--code-number)" },
	{ tag: t.comment, color: "var(--muted)", fontStyle: "italic" },
	{ tag: t.propertyName, color: "var(--muted)" },
	{ tag: t.variableName, color: "var(--ink2)" },
]);

const theme = EditorView.theme({
	"&": { height: "100%", background: "var(--well)", color: "var(--ink2)", fontSize: "0.78125rem" },
	".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.65", overflow: "auto" },
	".cm-gutters": { background: "transparent", border: "none", color: "var(--muted)" },
	".cm-activeLineGutter": { background: "transparent" },
	"&.cm-focused": { outline: "2px solid var(--accent)", outlineOffset: "-2px" },
	"&.cm-editor .cm-content": { caretColor: "var(--ink)" },
	"&.cm-editor .cm-cursor": { borderLeftColor: "var(--ink)" },
	".cm-selectionBackground": { background: "rgba(var(--acc-rgb), 0.3) !important" },
	".cm-panels": { background: "var(--raised)", color: "var(--ink)", borderColor: "var(--line2)" },
	".cm-textfield": { background: "var(--well)", color: "var(--ink)", border: "1px solid var(--line2)", borderRadius: "8px" },
	".cm-problem-line": { background: "rgba(var(--danger-rgb), 0.14)" },
	".cm-selected-line": { background: "rgba(var(--acc-rgb), 0.14)" },
	".cm-hover-line": { background: "rgba(var(--acc-rgb), 0.07)" },
	".cm-problem": { padding: "3px 16px 5px 44px", fontFamily: "var(--font-sans)", color: "var(--danger)", background: "rgba(var(--danger-rgb), 0.14)", whiteSpace: "pre-wrap" },
	".cm-button": { background: "transparent", backgroundImage: "none", color: "var(--ink2)", border: "1px solid var(--line2)", borderRadius: "100px" },
});

class ProblemWidget extends WidgetType {
	constructor(readonly text: string) {
		super();
	}
	override eq(other: ProblemWidget): boolean {
		return other.text === this.text;
	}
	toDOM(): HTMLElement {
		const d = document.createElement("div");
		d.className = "cm-problem";
		d.textContent = this.text;
		return d;
	}
}

const setProblems = StateEffect.define<readonly Problem[]>();
const setRange = StateEffect.define<{ from: number; to: number; hover: boolean } | null>();

const problemField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		let next = deco.map(tr.changes);
		for (const e of tr.effects) {
			if (e.is(setProblems)) {
				const ranges: Range<Decoration>[] = [];
				const byLine = new Map<number, string[]>();
				for (const p of e.value) {
					const line = Math.min(Math.max(p.line ?? 1, 1), tr.state.doc.lines);
					byLine.set(line, [...(byLine.get(line) ?? []), p.message]);
				}
				for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
					const l = tr.state.doc.line(line);
					ranges.push(Decoration.line({ class: "cm-problem-line" }).range(l.from));
					ranges.push(Decoration.widget({ widget: new ProblemWidget(byLine.get(line)!.join(" ")), block: true, side: 1 }).range(l.to));
				}
				next = Decoration.set(ranges, true);
			}
		}
		return next;
	},
	provide: (f) => EditorView.decorations.from(f),
});

const rangeField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		let next = deco.map(tr.changes);
		for (const e of tr.effects) {
			if (e.is(setRange)) {
				if (e.value === null) {
					next = Decoration.none;
				} else {
					const ranges: Range<Decoration>[] = [];
					const cls = e.value.hover ? "cm-hover-line" : "cm-selected-line";
					const first = tr.state.doc.lineAt(Math.min(e.value.from, tr.state.doc.length)).number;
					const last = tr.state.doc.lineAt(Math.min(e.value.to, tr.state.doc.length)).number;
					for (let n = first; n <= last; n++) {
						ranges.push(Decoration.line({ class: cls }).range(tr.state.doc.line(n).from));
					}
					next = Decoration.set(ranges, true);
				}
			}
		}
		return next;
	},
	provide: (f) => EditorView.decorations.from(f),
});

let view: EditorView | null = null;
let quiet = false;

/** It can't measure itself while it's hidden. */
export function refreshSource(): void {
	view?.requestMeasure();
}

export function undoInSource(): boolean {
	return view !== null && undo(view);
}

export function redoInSource(): boolean {
	return view !== null && redo(view);
}

export function SourceEditor(props: { hidden: boolean }): preact.JSX.Element {
	const host = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const extensions = [
				EditorView.lineWrapping, lineNumbers(), history(), search({ top: true }), highlightSelectionMatches(),
				kdl, syntaxHighlighting(highlight), theme, problemField, rangeField,
				EditorView.contentAttributes.of({ tabindex: "0", "aria-label": "The flag's source, in KDL", spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
				// Tab indents, so that anyone can leave the editor with Escape then Tab, as CodeMirror asks.
				keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
				EditorView.updateListener.of((u) => {
					if (u.docChanged && !quiet) {
						app.setText(u.state.doc.toString());
					}
					if (u.selectionSet && u.view.hasFocus) {
						app.selectAtLine(u.state.doc.lineAt(u.state.selection.main.head).number);
					}
				}),
		];
		// In a shadow root, CodeMirror's styles are constructed style sheets, which the Content Security
		// Policy allows. Elsewhere it would add a <style> element, which it doesn't.
		const shadow = host.current!.shadowRoot ?? host.current!.attachShadow({ mode: "open" });
		view = new EditorView({ state: EditorState.create({ doc: app.state.text, extensions }), parent: shadow, root: shadow });
		app.bridge = {
			replace(from, to, insert, apart): void {
				if (view === null) {
					return;
				}
				quiet = true;
				view.dispatch({ changes: { from, to, insert }, ...(apart === true ? { annotations: isolateHistory.of("full") } : {}) });
				quiet = false;
			},
			setDoc(text): void {
				if (view !== null) {
					quiet = true;
					view.setState(EditorState.create({ doc: text, extensions }));
					quiet = false;
				}
			},
			scrollToLine(line): void {
				if (view === null) {
					return;
				}
				const n = Math.min(Math.max(line, 1), view.state.doc.lines);
				view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(n).from, { y: "start", yMargin: 60 }) });
			},
		};
		return () => {
			view?.destroy();
			view = null;
			app.bridge = null;
		};
	}, []);
	return <div class="source-host" hidden={props.hidden} ref={host} />;
}

/** Keeps Source showing what the rest of the page knows. */
export function syncSource(problems: readonly Problem[], selected: { from: number; to: number } | null, hovered: { from: number; to: number } | null): void {
	if (view === null) {
		return;
	}
	const effects: StateEffect<unknown>[] = [setProblems.of(problems)];
	const r = selected ?? hovered;
	effects.push(setRange.of(r === null ? null : { ...r, hover: selected === null }));
	view.dispatch({ effects });
}

export function setSourceText(text: string): void {
	if (view !== null && view.state.doc.toString() !== text) {
		quiet = true;
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
		quiet = false;
	}
}
