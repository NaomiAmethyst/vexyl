// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

export interface DiffRow {
	kind: "same" | "changed";
	leftNo: number | null;
	left: string | null;
	rightNo: number | null;
	right: string | null;
}

/** A side-by-side line diff. Past this many lines between what's common, it says the middle changed. */
const cellLimit = 16_000_000;

export function lineDiff(a: string, b: string): DiffRow[] {
	const left = a.split("\n");
	const right = b.split("\n");
	if (left.at(-1) === "") {
		left.pop();
	}
	if (right.at(-1) === "") {
		right.pop();
	}
	let start = 0;
	while (start < left.length && start < right.length && left[start] === right[start]) {
		start++;
	}
	let endL = left.length;
	let endR = right.length;
	while (endL > start && endR > start && left[endL - 1] === right[endR - 1]) {
		endL--;
		endR--;
	}
	const rows: DiffRow[] = [];
	for (let i = 0; i < start; i++) {
		rows.push({ kind: "same", leftNo: i + 1, left: left[i]!, rightNo: i + 1, right: right[i]! });
	}
	const n = endL - start;
	const m = endR - start;
	if (n * m > cellLimit) {
		changedBlock(rows, left, right, start, endL, start, endR);
	} else {
		// Longest common subsequence, then paired up so that a changed line sits beside what replaced it.
		const table = new Uint32Array((n + 1) * (m + 1));
		for (let i = n - 1; i >= 0; i--) {
			for (let j = m - 1; j >= 0; j--) {
				table[i * (m + 1) + j] = left[start + i] === right[start + j] ? table[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(table[(i + 1) * (m + 1) + j]!, table[i * (m + 1) + j + 1]!);
			}
		}
		let i = 0;
		let j = 0;
		let blockI = 0;
		let blockJ = 0;
		const flush = (): void => {
			changedBlock(rows, left, right, start + blockI, start + i, start + blockJ, start + j);
		};
		while (i < n || j < m) {
			if (i < n && j < m && left[start + i] === right[start + j]) {
				flush();
				rows.push({ kind: "same", leftNo: start + i + 1, left: left[start + i]!, rightNo: start + j + 1, right: right[start + j]! });
				i++;
				j++;
				blockI = i;
				blockJ = j;
			} else if (j >= m || (i < n && table[(i + 1) * (m + 1) + j]! >= table[i * (m + 1) + j + 1]!)) {
				i++;
			} else {
				j++;
			}
		}
		flush();
	}
	const offset = endR - endL;
	for (let i = endL; i < left.length; i++) {
		rows.push({ kind: "same", leftNo: i + 1, left: left[i]!, rightNo: i + offset + 1, right: right[i + offset]! });
	}
	return rows;
}

function changedBlock(rows: DiffRow[], left: string[], right: string[], l0: number, l1: number, r0: number, r1: number): void {
	const count = Math.max(l1 - l0, r1 - r0);
	for (let k = 0; k < count; k++) {
		const hasL = l0 + k < l1;
		const hasR = r0 + k < r1;
		rows.push({ kind: "changed", leftNo: hasL ? l0 + k + 1 : null, left: hasL ? left[l0 + k]! : null, rightNo: hasR ? r0 + k + 1 : null, right: hasR ? right[r0 + k]! : null });
	}
}
