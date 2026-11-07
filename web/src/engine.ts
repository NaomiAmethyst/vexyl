// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import type { Reply, Request } from "./protocol.js";

interface Pending {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
	req: Request;
}

/** How long a worker gets before it's assumed to be stuck on a document, and replaced. */
const patience = 30000;

type WorkerPolicy = { createScriptURL(url: string): string };

function workerUrl(): string {
	const url = new URL("worker.js", document.baseURI).href;
	const tt = (globalThis as unknown as { trustedTypes?: { createPolicy(name: string, rules: { createScriptURL(u: string): string }): WorkerPolicy } }).trustedTypes;
	if (tt === undefined) {
		return url;
	}
	// The one script URL this page ever makes, and it's the worker beside the page.
	policy ??= tt.createPolicy("vexyl-worker", {
		createScriptURL: (u: string): string => {
			if (u !== url) {
				throw new Error("not the worker");
			}
			return u;
		},
	});
	return policy.createScriptURL(url);
}

let policy: WorkerPolicy | undefined;

/** Runs everything that reads a document in a worker, so that a 2 MB flag can't stall the page. */
export class Engine {
	private worker: Worker | null = null;
	private next = 1;
	private readonly pending = new Map<number, Pending>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	/** Told if a worker had to be replaced, so that what it held can be sent again. */
	onRestart: (() => void) | undefined;

	private start(): Worker {
		if (this.worker === null) {
			this.worker = new Worker(workerUrl() as unknown as string);
			this.worker.onmessage = (e: MessageEvent<{ id: number; result: unknown }>): void => {
				const p = this.pending.get(e.data.id);
				if (p !== undefined) {
					this.pending.delete(e.data.id);
					p.resolve(e.data.result);
				}
				this.watch();
			};
			this.worker.onerror = (e): void => {
				this.fail(e.message || "The worker stopped.");
			};
		}
		return this.worker;
	}

	private watch(): void {
		clearTimeout(this.timer);
		if (this.pending.size > 0) {
			this.timer = setTimeout(() => {
				this.fail("That took too long, so it was stopped.");
			}, patience);
		}
	}

	private fail(message: string): void {
		this.worker?.terminate();
		this.worker = null;
		const waiting = [...this.pending.values()];
		this.pending.clear();
		for (const p of waiting) {
			p.reject(new Error(message));
		}
		clearTimeout(this.timer);
		this.onRestart?.();
	}

	ask<R extends Request>(req: R): Promise<Reply<R["kind"]>> {
		const worker = this.start();
		const id = this.next++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, req });
			this.watch();
			worker.postMessage({ id, req });
		});
	}
}

export const engine = new Engine();
