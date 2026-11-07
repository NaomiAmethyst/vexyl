// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// Compares where two flags' shapes lie, ignoring what color they are. Each image is reduced to
// regions of one color, then each region in A is matched to what mostly lies under it in B, so
// that a blue that became a lighter blue is the same shape. What's left is where shapes really differ.

export interface ShapeDiff {
	/** For each pixel: 0 the same, 1 only in A, 2 only in B. */
	marks: Uint8Array;
	width: number;
	height: number;
	/** What share of the flag differs, as a percentage. */
	percent: number;
	/** Where they differ, or null if they don't. */
	box: { x: number; y: number; w: number; h: number } | null;
}

const key = (d: Uint8ClampedArray, i: number): number => (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;

/** Labels each pixel with the main color nearest to it, and -1 if it's transparent. */
function regions(data: Uint8ClampedArray): { labels: Int16Array; counts: number[] } {
	const histogram = new Map<number, number>();
	const pixels = data.length >> 2;
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3]! > 127) {
			const k = key(data, i);
			histogram.set(k, (histogram.get(k) ?? 0) + 1);
		}
	}
	// A color that's only on edges is antialiasing, so it isn't a region of its own.
	const main = [...histogram.entries()].filter(([, n]) => n >= Math.max(8, pixels / 5000)).sort((a, b) => b[1] - a[1]).slice(0, 64).map(([k]) => k);
	const labels = new Int16Array(pixels);
	const counts = new Array<number>(main.length).fill(0);
	const known = new Map<number, number>();
	for (let p = 0; p < pixels; p++) {
		const i = p << 2;
		if (data[i + 3]! <= 127) {
			labels[p] = -1;
			continue;
		}
		const k = key(data, i);
		let best = known.get(k);
		if (best === undefined) {
			let bestD = Infinity;
			best = 0;
			main.forEach((m, n) => {
				const dr = ((m >> 16) & 255) - data[i]!;
				const dg = ((m >> 8) & 255) - data[i + 1]!;
				const db = (m & 255) - data[i + 2]!;
				const d = dr * dr + dg * dg + db * db;
				if (d < bestD) {
					bestD = d;
					best = n;
				}
			});
			known.set(k, best);
		}
		labels[p] = best;
		counts[best]!++;
	}
	return { labels, counts };
}

export function diffShapes(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number, height: number): ShapeDiff {
	const A = regions(a);
	const B = regions(b);
	const pixels = width * height;
	const na = A.counts.length;
	const nb = B.counts.length;
	const table = new Uint32Array((na + 1) * (nb + 1));
	for (let p = 0; p < pixels; p++) {
		table[(A.labels[p]! + 1) * (nb + 1) + B.labels[p]! + 1]!++;
	}
	// Each region goes with the one it most overlaps, largest overlaps first and one to one, so that a
	// shape that moved a long way still matches itself rather than what's now beneath it.
	const overlaps: [number, number, number][] = [];
	for (let i = 0; i <= na; i++) {
		for (let j = 0; j <= nb; j++) {
			const n = table[i * (nb + 1) + j]!;
			if (n > 0) {
				overlaps.push([n, i, j]);
			}
		}
	}
	overlaps.sort((x, y) => y[0] - x[0]);
	const aToB = new Int16Array(na + 1).fill(-1);
	const bToA = new Int16Array(nb + 1).fill(-1);
	for (const [, i, j] of overlaps) {
		if (aToB[i] === -1 && bToA[j] === -1) {
			aToB[i] = j;
			bToA[j] = i;
		}
	}
	// A region left over was split from or merged into another, so it goes with what it overlaps most.
	for (const [, i, j] of overlaps) {
		if (aToB[i] === -1) {
			aToB[i] = j;
		}
		if (bToA[j] === -1) {
			bToA[j] = i;
		}
	}
	const size = (counts: number[], label: number): number => (label < 0 ? Infinity : counts[label]!);
	const raw = new Uint8Array(pixels);
	for (let p = 0; p < pixels; p++) {
		const la = A.labels[p]!;
		const lb = B.labels[p]!;
		if (aToB[la + 1]! === lb + 1 || bToA[lb + 1]! === la + 1) {
			continue;
		}
		// Whichever region is smaller is the shape, and the other is what it lies on.
		raw[p] = size(A.counts, la) <= size(B.counts, lb) ? 1 : 2;
	}
	// A difference at least 3 pixels across, so that edges drawn a little differently don't count.
	const marks = new Uint8Array(pixels);
	let count = 0;
	let x0 = width;
	let y0 = height;
	let x1 = -1;
	let y1 = -1;
	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			const p = y * width + x;
			const m = raw[p]!;
			if (m !== 0 && raw[p - 1] !== 0 && raw[p + 1] !== 0 && raw[p - width] !== 0 && raw[p + width] !== 0) {
				for (const q of [p, p - 1, p + 1, p - width, p + width]) {
					marks[q] = raw[q]!;
				}
				x0 = Math.min(x0, x - 1);
				y0 = Math.min(y0, y - 1);
				x1 = Math.max(x1, x + 1);
				y1 = Math.max(y1, y + 1);
			}
		}
	}
	for (let p = 0; p < pixels; p++) {
		if (marks[p] !== 0) {
			count++;
		}
	}
	return { marks, width, height, percent: (100 * count) / pixels, box: x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}
