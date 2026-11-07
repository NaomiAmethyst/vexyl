// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// What a tab's address says it has open. Every one of these came from somewhere untrusted, so each
// is read strictly, and only ever turned into a request to the host it says.

export type Ref =
	| { kind: "github"; owner: string; repo: string; branch: string; path: string }
	| { kind: "gist"; id: string; file?: string }
	| { kind: "url"; url: string };

const name = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;
const branchName = /^[A-Za-z0-9._/-]{1,200}$/;
const gistId = /^[0-9a-fA-F]{8,64}$/;

export const defaultRepo = { owner: "NaomiAmethyst", repo: "vexyl-flags", branch: "main" };

/** A path within a repository: no empty, `.` or `..` parts, so it can't climb out of what it says. */
export function goodPath(path: string): boolean {
	return path.length > 0 && path.length <= 1024 && path.split("/").every((p) => p !== "" && p !== "." && p !== ".." && !/[\\\0-\x1f]/.test(p));
}

export function parseRef(text: string): Ref | null {
	const colon = text.indexOf(":");
	if (colon < 0) {
		return null;
	}
	const kind = text.slice(0, colon);
	const rest = text.slice(colon + 1);
	if (kind === "github") {
		const parts = rest.split("/");
		if (parts.length < 3) {
			return null;
		}
		let repo = parts[1]!;
		let branch = defaultRepo.branch;
		const at = repo.indexOf("@");
		if (at >= 0) {
			branch = decodeURIComponent(repo.slice(at + 1));
			repo = repo.slice(0, at);
		}
		const path = parts.slice(2).join("/");
		if (!name.test(parts[0]!) || !name.test(repo) || !branchName.test(branch) || !goodPath(path)) {
			return null;
		}
		return { kind, owner: parts[0]!, repo, branch, path };
	}
	if (kind === "gist") {
		const slash = rest.indexOf("/");
		const id = slash < 0 ? rest : rest.slice(0, slash);
		const file = slash < 0 ? undefined : rest.slice(slash + 1);
		if (!gistId.test(id) || (file !== undefined && (file === "" || file.includes("/")))) {
			return null;
		}
		return file === undefined ? { kind, id } : { kind, id, file };
	}
	if (kind === "url") {
		const url = safeUrl(rest);
		return url === null ? null : { kind, url };
	}
	return null;
}

export function refText(r: Ref): string {
	switch (r.kind) {
		case "github":
			return `github:${r.owner}/${r.repo}${r.branch === defaultRepo.branch ? "" : "@" + encodeURIComponent(r.branch)}/${r.path}`;
		case "gist":
			return r.file === undefined ? `gist:${r.id}` : `gist:${r.id}/${r.file}`;
		case "url":
			return `url:${r.url}`;
	}
}

/** A link's address, with what it holds readable rather than escaped, as far as a URL lets it be. */
export function openHref(r: Ref, base = ""): string {
	return `${base}?open=${encodeURIComponent(refText(r)).replaceAll("%3A", ":").replaceAll("%2F", "/").replaceAll("%40", "@")}`;
}

/** Only https, with no credentials in it, can be fetched by this page. */
export function safeUrl(text: string): string | null {
	let u: URL;
	try {
		u = new URL(text);
	} catch {
		return null;
	}
	if (u.protocol !== "https:" || u.username !== "" || u.password !== "") {
		return null;
	}
	return u.href;
}

/** A link for a person to follow, shown only if it can't run anything. */
export function linkable(text: string): string | null {
	try {
		const u = new URL(text);
		return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
	} catch {
		return null;
	}
}

/** Turns a link someone pasted into what to open: GitHub's page links become files, and gists gists. */
export function refFromLink(text: string): Ref | { problem: string } {
	const trimmed = text.trim();
	let u: URL;
	try {
		u = new URL(trimmed);
	} catch {
		return { problem: "That isn't a link. It should start with https://." };
	}
	if (u.protocol !== "https:") {
		return { problem: "Only https links can be read from this page, because browsers block anything else on a secure page." };
	}
	const parts = u.pathname.split("/").filter((p) => p !== "").map(decodeURIComponent);
	if (u.hostname === "github.com" && parts.length >= 5 && (parts[2] === "blob" || parts[2] === "raw")) {
		const r = parseRef(`github:${parts[0]}/${parts[1]}@${encodeURIComponent(parts[3]!)}/${parts.slice(4).join("/")}`);
		if (r !== null) {
			return r;
		}
	}
	if (u.hostname === "raw.githubusercontent.com" && parts.length >= 4) {
		const branch = parts[2] === "refs" && parts[3] === "heads" ? parts[4]! : parts[2]!;
		const rest = parts[2] === "refs" && parts[3] === "heads" ? parts.slice(5) : parts.slice(3);
		const r = parseRef(`github:${parts[0]}/${parts[1]}@${encodeURIComponent(branch)}/${rest.join("/")}`);
		if (r !== null) {
			return r;
		}
	}
	if (u.hostname === "gist.github.com" && parts.length >= 1) {
		const g = gistRef(trimmed);
		if (g !== null) {
			return g;
		}
	}
	const url = safeUrl(trimmed);
	return url === null ? { problem: "That link can't be read: it has a name or password in it." } : { kind: "url", url };
}

/** Reads a gist's link or ID. */
export function gistRef(text: string): (Ref & { kind: "gist" }) | null {
	const t = text.trim();
	if (gistId.test(t)) {
		return { kind: "gist", id: t };
	}
	try {
		const u = new URL(t);
		if (u.protocol === "https:" && (u.hostname === "gist.github.com" || u.hostname === "gist.githubusercontent.com")) {
			const id = u.pathname.split("/").filter((p) => p !== "").find((p) => gistId.test(p));
			if (id !== undefined) {
				return { kind: "gist", id };
			}
		}
	} catch {
		return null;
	}
	return null;
}

export function rawUrl(r: Ref & { kind: "github" }): string {
	const part = (s: string): string => s.split("/").map(encodeURIComponent).join("/");
	return `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${part(r.branch)}/${part(r.path)}`;
}

export function refLabel(r: Ref): string {
	switch (r.kind) {
		case "github":
			return r.path.split("/").at(-1)!;
		case "gist":
			return r.file ?? `gist ${r.id.slice(0, 8)}`;
		case "url":
			return new URL(r.url).pathname.split("/").at(-1) || new URL(r.url).hostname;
	}
}

/** What this tab's address says. */
export interface Address {
	ref: Ref | null;
	badRef: string | null;
	link: string | null;
	view: "work" | "open" | "compare" | "share" | "new";
	with: Ref | null;
}

export function readAddress(search: string, hash: string): Address {
	const q = new URLSearchParams(search);
	const open = q.get("open");
	const ref = open === null ? null : parseRef(open);
	const view = q.get("view");
	const withText = q.get("with");
	return {
		ref,
		badRef: open !== null && ref === null ? open : null,
		link: hash.startsWith("#v") ? hash.slice(1) : null,
		view: view === "open" || view === "compare" || view === "share" || view === "new" ? view : "work",
		with: withText === null ? null : parseRef(withText),
	};
}
