// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Each browser tab keeps its own draft, under an ID only it holds, so two tabs on one flag can't
// overwrite each other. A tab holds a lock on its ID while it's open, so a draft whose tab has gone can
// be told from one that's still being worked on, and offered back.

export interface Draft {
	tab: string;
	/** What it's a draft of: the address's reference, or a name for one with no address. */
	doc: string;
	text: string;
	base: string;
	updated: number;
	/** How to label and reopen something that has no address, such as a pasted file. */
	label: string;
	eol: string;
	/** Which view it was in, for a reload to come back to. */
	source: string;
}

const dbName = "vexyl-drafts";
const store = "drafts";

let dbPromise: Promise<IDBDatabase | null> | undefined;
const memory = new Map<string, Draft>();

function open(): Promise<IDBDatabase | null> {
	dbPromise ??= new Promise((resolve) => {
		try {
			const req = indexedDB.open(dbName, 1);
			req.onupgradeneeded = (): void => {
				req.result.createObjectStore(store, { keyPath: "tab" });
			};
			req.onsuccess = (): void => {
				resolve(req.result);
			};
			req.onerror = (): void => {
				resolve(null);
			};
			req.onblocked = (): void => {
				resolve(null);
			};
		} catch {
			resolve(null);
		}
	});
	return dbPromise;
}

function asPromise<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = (): void => {
			resolve(req.result);
		};
		req.onerror = (): void => {
			reject(req.error ?? new Error("storage failed"));
		};
	});
}

/** Whether drafts are being kept in the browser, or only in memory, as in some private windows. */
export let durable = true;

export async function saveDraft(d: Draft): Promise<void> {
	memory.set(d.tab, d);
	const db = await open();
	if (db === null) {
		durable = false;
		try {
			sessionStorage.setItem(`vexyl.draft.${d.tab}`, JSON.stringify(d));
			durable = true;
		} catch {
			durable = false;
		}
		return;
	}
	try {
		await asPromise(db.transaction(store, "readwrite").objectStore(store).put(d));
	} catch {
		durable = false;
	}
}

export async function loadDraft(tab: string): Promise<Draft | null> {
	const db = await open();
	if (db === null) {
		try {
			const text = sessionStorage.getItem(`vexyl.draft.${tab}`);
			return text === null ? (memory.get(tab) ?? null) : (JSON.parse(text) as Draft);
		} catch {
			return memory.get(tab) ?? null;
		}
	}
	try {
		return ((await asPromise(db.transaction(store).objectStore(store).get(tab))) as Draft | undefined) ?? null;
	} catch {
		return memory.get(tab) ?? null;
	}
}

export async function dropDraft(tab: string): Promise<void> {
	memory.delete(tab);
	const db = await open();
	if (db === null) {
		try {
			sessionStorage.removeItem(`vexyl.draft.${tab}`);
		} catch {
			// Nothing's kept if storage is blocked.
		}
		return;
	}
	try {
		await asPromise(db.transaction(store, "readwrite").objectStore(store).delete(tab));
	} catch {
		// It'd be offered back later, and can be discarded then.
	}
}

async function allDrafts(): Promise<Draft[]> {
	const db = await open();
	if (db === null) {
		return [];
	}
	try {
		return (await asPromise(db.transaction(store).objectStore(store).getAll())) as Draft[];
	} catch {
		return [];
	}
}

function newId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function lockName(tab: string): string {
	return `vexyl-tab-${tab}`;
}

async function tryHold(tab: string): Promise<boolean> {
	const locks = (navigator as Navigator & { locks?: LockManager }).locks;
	if (locks === undefined) {
		return true;
	}
	return new Promise((resolve) => {
		void locks.request(lockName(tab), { ifAvailable: true }, (lock) => {
			resolve(lock !== null);
			// Held for as long as this tab lives.
			return lock === null ? undefined : new Promise<void>(() => undefined);
		});
	});
}

/** Whether some open tab holds this ID. */
async function isHeld(tab: string): Promise<boolean> {
	const locks = (navigator as Navigator & { locks?: LockManager }).locks;
	if (locks === undefined) {
		return false;
	}
	const state = await locks.query();
	return (state.held ?? []).some((l) => l.name === lockName(tab));
}

/**
 * Gives this tab's ID, which survives a reload because it's in session storage. A duplicated tab
 * copies session storage, so it finds its ID held by the other, and takes a copy of the draft under a
 * new ID of its own.
 */
export async function claimTab(): Promise<{ tab: string; inherited: Draft | null }> {
	let tab: string | null = null;
	try {
		tab = sessionStorage.getItem("vexyl.tab");
	} catch {
		tab = null;
	}
	let inherited: Draft | null = null;
	if (tab !== null && !(await tryHold(tab))) {
		const theirs = await loadDraft(tab);
		tab = null;
		if (theirs !== null) {
			inherited = theirs;
		}
	} else if (tab !== null) {
		return { tab, inherited: null };
	}
	tab = newId();
	try {
		sessionStorage.setItem("vexyl.tab", tab);
	} catch {
		// Without session storage, a reload starts afresh.
	}
	await tryHold(tab);
	return { tab, inherited };
}

/** A draft of this document left behind by a tab that's since closed, if there's one. */
export async function orphanOf(doc: string, except: string): Promise<Draft | null> {
	const candidates = (await allDrafts()).filter((d) => d.doc === doc && d.tab !== except && d.text !== d.base);
	candidates.sort((a, b) => b.updated - a.updated);
	for (const d of candidates) {
		if (!(await isHeld(d.tab))) {
			return d;
		}
	}
	return null;
}

/** Tells other tabs what this one has open, and hears the same from them. */
export class TabPresence {
	private channel: BroadcastChannel | null = null;
	private readonly others = new Map<string, { doc: string; dirty: boolean; seen: number }>();
	onChange: (() => void) | undefined;

	constructor(private readonly tab: string, private state: () => { doc: string; dirty: boolean }) {
		try {
			this.channel = new BroadcastChannel("vexyl-tabs");
			this.channel.onmessage = (e: MessageEvent<{ tab: string; doc: string; dirty: boolean; asking?: boolean; gone?: boolean }>): void => {
				const m = e.data;
				if (m.tab === this.tab) {
					return;
				}
				if (m.gone === true) {
					this.others.delete(m.tab);
				} else {
					this.others.set(m.tab, { doc: m.doc, dirty: m.dirty, seen: Date.now() });
				}
				if (m.asking === true) {
					this.tell(false);
				}
				this.onChange?.();
			};
			this.tell(true);
			addEventListener("pagehide", () => {
				this.channel?.postMessage({ tab: this.tab, doc: "", dirty: false, gone: true });
			});
		} catch {
			this.channel = null;
		}
	}

	tell(asking = false): void {
		const s = this.state();
		this.channel?.postMessage({ tab: this.tab, doc: s.doc, dirty: s.dirty, asking });
	}

	/** How many other tabs have this document open, and whether any has changes. */
	alsoOpen(doc: string): { tabs: number; dirty: boolean } {
		let tabs = 0;
		let dirty = false;
		for (const o of this.others.values()) {
			if (o.doc === doc) {
				tabs++;
				dirty = dirty || o.dirty;
			}
		}
		return { tabs, dirty };
	}
}
