// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// The only requests this site makes, and only when someone asks for a flag. They carry no
// credentials, referrer or anything about who's asking.

import { rawUrl, type Ref } from "./address.js";

/** The most a download can be. Anything larger is stopped partway. */
export const maxDownload = 16 * 1024 * 1024;

export class RemoteError extends Error {
	override name = "RemoteError";
	constructor(message: string, readonly reason: "missing" | "limit" | "cors" | "large" | "network" | "other" = "other", readonly resetAt?: number) {
		super(message);
	}
}

const quiet: RequestInit = { credentials: "omit", referrerPolicy: "no-referrer", mode: "cors", redirect: "follow" };

async function capped(response: Response): Promise<string> {
	const declared = Number(response.headers.get("content-length") ?? 0);
	if (declared > maxDownload) {
		throw new RemoteError(tooLarge(declared), "large");
	}
	const reader = response.body?.getReader();
	if (reader === undefined) {
		return "";
	}
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		total += value.length;
		if (total > maxDownload) {
			await reader.cancel();
			throw new RemoteError(tooLarge(total), "large");
		}
		chunks.push(value);
	}
	const all = new Uint8Array(total);
	let n = 0;
	for (const c of chunks) {
		all.set(c, n);
		n += c.length;
	}
	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(all);
	} catch {
		throw new RemoteError("That file isn't text in UTF-8, so it can't be a flag.");
	}
}

const tooLarge = (bytes: number): string => `That file is ${(bytes / (1024 * 1024)).toFixed(1)} MB, and this site reads up to ${maxDownload / (1024 * 1024)} MB.`;

function limitError(response: Response): RemoteError | null {
	if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
		const reset = Number(response.headers.get("x-ratelimit-reset") ?? 0) * 1000;
		const when = reset > 0 ? ` It resets at ${new Date(reset).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : "";
		return new RemoteError(`GitHub allows about 60 requests an hour from one address without signing in, and that's been used up.${when} Anything already loaded still works, and opening a file from a link doesn't count.`, "limit", reset);
	}
	return null;
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
	try {
		return await fetch(url, { ...quiet, ...init });
	} catch {
		throw new RemoteError("The request didn't get through. Either you're offline, or that site doesn't allow other sites to read its files.", "cors");
	}
}

function readStore(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStore(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// It's only a cache, so a full or blocked store just means asking again.
	}
}

/** Asks GitHub's API, keeping each answer with its ETag, since asking again costs nothing if it hasn't changed. */
async function api(url: string, missing: string): Promise<unknown> {
	const key = `vexyl.api.${url}`;
	const cached = readStore(key);
	let etag: string | null = null;
	let body: string | null = null;
	if (cached !== null) {
		try {
			({ etag, body } = JSON.parse(cached) as { etag: string; body: string });
		} catch {
			etag = null;
		}
	}
	const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
	if (etag !== null) {
		headers["If-None-Match"] = etag;
	}
	const response = await request(url, { headers });
	if (response.status === 304 && body !== null) {
		return JSON.parse(body);
	}
	const limited = limitError(response);
	if (limited !== null) {
		if (body !== null) {
			return JSON.parse(body);
		}
		throw limited;
	}
	if (response.status === 404) {
		throw new RemoteError(missing, "missing");
	}
	if (!response.ok) {
		throw new RemoteError(`GitHub answered with an error, ${response.status}.`);
	}
	const text = await capped(response);
	const fresh = response.headers.get("etag");
	if (fresh !== null && text.length < 2_000_000) {
		writeStore(key, JSON.stringify({ etag: fresh, body: text }));
	}
	return JSON.parse(text);
}

export interface TreeFile {
	path: string;
	size: number;
}

export interface Tree {
	files: TreeFile[];
	truncated: boolean;
}

/** Lists a repository's flags in a single request. */
export async function githubTree(owner: string, repo: string, branch: string): Promise<Tree> {
	const data = (await api(
		`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
		`GitHub doesn't have ${owner}/${repo} with a branch called ${branch}. It may not be published yet, or it may be private, and this site can only read public repositories.`,
	)) as { tree?: { path?: unknown; type?: unknown; size?: unknown }[]; truncated?: unknown };
	const files: TreeFile[] = [];
	for (const e of Array.isArray(data.tree) ? data.tree : []) {
		if (e.type === "blob" && typeof e.path === "string" && e.path.endsWith(".kdl")) {
			files.push({ path: e.path, size: typeof e.size === "number" ? e.size : 0 });
		}
	}
	return { files, truncated: data.truncated === true };
}

export interface GistFile {
	name: string;
	url: string;
	size: number;
	content?: string;
}

export async function gist(id: string): Promise<GistFile[]> {
	const data = (await api(`https://api.github.com/gists/${encodeURIComponent(id)}`, "GitHub has no gist with that ID.")) as { files?: Record<string, { filename?: unknown; raw_url?: unknown; size?: unknown; content?: unknown; truncated?: unknown }> };
	const files: GistFile[] = [];
	for (const f of Object.values(data.files ?? {})) {
		if (typeof f.filename === "string" && typeof f.raw_url === "string") {
			const out: GistFile = { name: f.filename, url: f.raw_url, size: typeof f.size === "number" ? f.size : 0 };
			if (typeof f.content === "string" && f.truncated !== true) {
				out.content = f.content;
			}
			files.push(out);
		}
	}
	return files;
}

export const looksLikeFlag = (name: string): boolean => name.endsWith(".kdl");

export async function fetchText(url: string): Promise<string> {
	const response = await request(url);
	const limited = limitError(response);
	if (limited !== null) {
		throw limited;
	}
	if (response.status === 404) {
		throw new RemoteError("Nothing is at that address.", "missing");
	}
	if (!response.ok) {
		throw new RemoteError(`That site answered with an error, ${response.status}.`);
	}
	return capped(response);
}

/** Fetches what a reference points at. A gist with several flags gives the list instead. */
export async function fetchRef(r: Ref): Promise<{ text: string; ref: Ref } | { choose: GistFile[] }> {
	switch (r.kind) {
		case "github":
			try {
				return { text: await fetchText(rawUrl(r)), ref: r };
			} catch (e) {
				if (e instanceof RemoteError && e.reason === "missing") {
					throw new RemoteError(`GitHub doesn't have ${r.path} in ${r.owner}/${r.repo} on ${r.branch}. It may not be published yet, or it may have moved.`, "missing");
				}
				throw e;
			}
		case "gist": {
			const files = (await gist(r.id)).filter((f) => looksLikeFlag(f.name));
			if (files.length === 0) {
				throw new RemoteError("That gist has no .kdl files in it.", "missing");
			}
			const wanted = r.file === undefined ? (files.length === 1 ? files[0] : undefined) : files.find((f) => f.name === r.file);
			if (wanted === undefined) {
				if (r.file !== undefined) {
					throw new RemoteError(`That gist has no file called ${r.file}.`, "missing");
				}
				return { choose: files };
			}
			return { text: wanted.content ?? (await fetchText(wanted.url)), ref: { kind: "gist", id: r.id, file: wanted.name } };
		}
		case "url":
			try {
				return { text: await fetchText(r.url), ref: r };
			} catch (e) {
				if (e instanceof RemoteError && e.reason === "cors") {
					throw new RemoteError("That site doesn't allow other sites to read its files, so this page can't open the link. Your browser blocks it, not the site's server. Download the file and use This computer, or put it in a gist.", "cors");
				}
				throw e;
			}
	}
}

/** The evidence tier of a flag in vexyl-flags, from its own list. */
export async function evidenceTiers(owner: string, repo: string, branch: string): Promise<Map<string, string>> {
	const text = await fetchText(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/reviewed/evidence.tsv`);
	return parseEvidence(text);
}

export function parseEvidence(text: string): Map<string, string> {
	const tiers = new Map<string, string>();
	for (const line of text.split("\n").slice(1)) {
		const [name, tier] = line.split("\t");
		if (name && tier && /^[A-Z]$/.test(tier.trim())) {
			tiers.set(name, tier.trim());
		}
	}
	return tiers;
}

export const tierMeaning: Readonly<Record<string, string>> = {
	A: "Law read, tier A",
	B: "Law read, tier B",
	C: "No law was read",
};
