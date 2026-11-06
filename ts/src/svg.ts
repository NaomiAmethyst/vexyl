// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

import { resolve, view } from "./adapt.js";
import { foldFacets, foldShape, then, type Matrix } from "./fold.js";
import {
	add, axis, bandPoly, barPolys, boundary, chevronPolys, crossPolys, mul, offsetPolygon, position, rawChevrons, rectPoly,
	regionBounds, regionCenter, regionCorners, rotate, shapeGeom, type Geom, type Region, type Vec,
} from "./geometry.js";
import { idMark } from "./sanitize.js";
import { circlePath, forRegion, outlineGeom, panelEdge, panelRect, rayPolys } from "./shapes.js";
import { esc, hash, num } from "./text.js";
import { RenderError } from "./types.js";
import type {
	ChargeLayer, ChecksLayer, Effects, EmblemLayer, Fimbriation, Flag, Layer, Options, PanelLayer, QuartersLayer, SaltireLayer, SvgElement, SvgShape,
} from "./types.js";
import { XmlDecoder } from "./xml.js";

const defaultHeight = 600;
const noColor = "none";
const miter = 'stroke-linejoin="miter" stroke-miterlimit="10"';

type GradientBox = [number, number, number, number];

function checkOptions(opts: Options): void {
	const { height, ratio, foldStep } = opts;
	if (height !== undefined && !(height > 0 && Number.isFinite(height))) {
		throw new RenderError("height must be a positive number");
	}
	if (ratio !== undefined && !(ratio > 0 && Number.isFinite(ratio))) {
		throw new RenderError("ratio must be a positive number");
	}
	if (foldStep !== undefined && !(Number.isInteger(foldStep) && foldStep >= 0)) {
		throw new RenderError("foldStep must be a whole number");
	}
}

/** Renders the flag as a standalone SVG document. */
export function svg(flag: Flag, opts: Options = {}): string {
	checkOptions(opts);
	const height = opts.height ?? defaultHeight;
	const { flag: f, turn, upright, mirror, canvas } = resolve(flag, opts);
	const r = new Renderer(f, flag.idPrefix);
	const asked = [opts.ratio, opts.variant, opts.side, opts.fit, opts.align, opts.fold, opts.foldStep];
	if (asked.some((v) => v !== undefined)) {
		// A page can show several forms of one flag, which mustn't share definitions.
		r.idPrefix += hash(asked.join("|")).slice(0, 4) + "-";
	}
	if (opts.fold !== undefined && opts.fold !== "") {
		const fold = f.folds[opts.fold];
		if (fold === undefined) {
			throw new RenderError(`${f.meta.name} has no fold "${opts.fold}"`);
		}
		if (turn !== "none") {
			throw new RenderError("a fold can't be applied to a turned variant");
		}
		r.writeFolded(f, opts.foldStep ?? 0, height, fold);
		return r.text();
	}
	let x0 = 0;
	let y0 = 0;
	let width = f.fly;
	let tall = f.hoist;
	if (f.border?.side === "outside") {
		[x0, y0, width, tall] = bounds(outerBorder(f));
	}
	const turned = view(turn, y0, tall);
	let transform = turned.transform;
	if (mirror) {
		// The back is the mirror image, then turned as the front would be.
		transform = `${transform} matrix(-1 0 0 1 ${num(2 * x0 + width)} 0)`.trim();
	}
	let vx = x0;
	let vy = y0;
	let vw = width;
	let vh = tall;
	if (turn !== "none") {
		[vx, vy, vw, vh] = [y0, x0, tall, width];
	}
	if (upright) {
		r.upright = turned.upright;
	}
	if (canvas !== 0) {
		// The canvas ratio is the design's, so a turned flag's is the other way up.
		const want = turn !== "none" ? 1 / canvas : canvas;
		const share = opts.align === "start" ? 0 : opts.align === "end" ? 1 : 0.5;
		if (vw / vh < want) {
			const extra = vh * want - vw;
			vx -= extra * share;
			vw += extra;
		} else {
			const extra = vw / want - vh;
			vy -= extra * share;
			vh += extra;
		}
	}
	r.line(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(vx)} ${num(vy)} ${num(vw)} ${num(vh)}" width="${num((height * vw) / vh)}" height="${num(height)}">`);
	r.depth++;
	r.line(`<title>${esc(f.meta.name)}</title>`);
	if (f.meta.description) {
		r.line(`<desc>${esc(f.meta.description)}</desc>`);
	}
	if (transform !== "") {
		r.line(`<g transform="${transform}">`);
		r.depth++;
	}
	r.flagArt(f);
	if (transform !== "") {
		r.depth--;
		r.line("</g>");
	}
	r.depth--;
	r.line("</svg>");
	return r.text();
}

/** Renders the flag as a tree of SVG elements. A `title` or `desc` element's text isn't kept. */
export function svgTree(flag: Flag, opts: Options = {}): SvgElement {
	const dec = new XmlDecoder(svg(flag, opts));
	let root: SvgElement | undefined;
	const open: SvgElement[] = [];
	for (let t = dec.token(); t !== null; t = dec.token()) {
		if (t.type === "start") {
			const e: SvgElement = {
				name: t.raw,
				attrs: t.given.map((a) => ({ name: a.name, value: a.value })),
				children: [],
			};
			const parent = open.at(-1);
			if (parent === undefined) {
				root = e;
			} else {
				parent.children.push(e);
			}
			open.push(e);
		} else if (t.type === "end") {
			open.pop();
		}
	}
	return root!;
}

/** Writes a tree from `svgTree` out as an SVG document. */
export function treeToSvg(e: SvgElement): string {
	const attrs = e.attrs.map((a) => ` ${a.name}="${esc(a.value)}"`).join("");
	if (e.children.length === 0) {
		return `<${e.name}${attrs}/>`;
	}
	return `<${e.name}${attrs}>${e.children.map(treeToSvg).join("")}</${e.name}>`;
}

function outerBorder(f: Flag): Vec[] {
	try {
		return offsetPolygon(boundary(f) ?? [], f.border!.width);
	} catch (e) {
		throw new RenderError((e as Error).message);
	}
}

export function bounds(poly: Vec[]): [number, number, number, number] {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const p of poly) {
		x0 = Math.min(x0, p.x);
		y0 = Math.min(y0, p.y);
		x1 = Math.max(x1, p.x);
		y1 = Math.max(y1, p.y);
	}
	return [x0, y0, x1 - x0, y1 - y0];
}

const strokeScale = (g: Geom): number => (g.scale !== undefined && g.scale > 0 ? g.scale : 1);

class Renderer {
	idPrefix: string;
	depth = 0;
	/** The transform that undoes a turned variant's rotation. */
	upright = "";
	private readonly flag: Flag;
	private readonly out: string[] = [];
	private nextId = 0;
	private readonly gradients = new Map<string, string>();

	constructor(flag: Flag, idPrefix: string) {
		this.flag = flag;
		this.idPrefix = idPrefix;
	}

	text(): string {
		return this.out.join("");
	}

	line(text: string): void {
		this.out.push("  ".repeat(this.depth), text, "\n");
	}

	private color(name: string): string {
		return (this.flag.palette[name] ?? "").toLowerCase();
	}

	/** The paint value for a palette name. A gradient spans the box given, or each shape's own bounds. */
	private fill(name: string, box?: GradientBox): string {
		const g = this.flag.gradients[name];
		if (g === undefined) {
			return this.color(name);
		}
		if (box === undefined) {
			const known = this.gradients.get(name);
			if (known !== undefined) {
				return `url(#${known})`;
			}
		}
		const id = this.id("gradient");
		let x1 = 0;
		let y1 = 0;
		let x2 = 1;
		let y2 = 0;
		if (g.along === "hoist") {
			x2 = 0;
			y2 = 1;
		} else if (g.along === "bend") {
			y2 = 1;
		} else if (g.along === "bend-sinister") {
			y1 = 1;
		}
		const units = box === undefined ? "" : ` gradientUnits="userSpaceOnUse" gradientTransform="translate(${num(box[0])} ${num(box[1])}) scale(${num(box[2])} ${num(box[3])})"`;
		this.line(`<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${units}>`);
		this.depth++;
		g.colors.forEach((c, i) => {
			this.line(`<stop offset="${num(g.stops[i]!)}" stop-color="${this.color(c)}"/>`);
		});
		this.depth--;
		this.line("</linearGradient>");
		if (box === undefined) {
			this.gradients.set(name, id);
		}
		return `url(#${id})`;
	}

	private id(kind: string): string {
		this.nextId++;
		return `${this.idPrefix}${kind}${this.nextId}`;
	}

	/** Paints a flag's outside border, then everything within its outline. */
	flagArt(f: Flag): void {
		if (f.border?.side === "outside") {
			// A curved outline has no outside to offset. A plain render has refused by now, but a
			// fold gets here, and as in the reference it then draws no border.
			const shape = boundary(f);
			this.geom({ poly: shape === null ? [] : outerBorder(f) }, `fill="${this.fill(f.border.color)}"`);
		}
		const root: Region = { w: f.fly, h: f.hoist };
		const shape: Geom = f.outline !== undefined ? outlineGeom(f.outline, f.fly, f.hoist) : { poly: rectPoly(0, 0, f.fly, f.hoist) };
		const flagClip = this.id("flag");
		this.line(`<clipPath id="${flagClip}">`);
		this.depth++;
		this.geom(shape, "");
		this.depth--;
		this.line("</clipPath>");
		this.line(`<g clip-path="url(#${flagClip})">`);
		this.depth++;
		this.layers(f.layers, root);
		if (f.border !== undefined && f.border.side !== "outside") {
			// Half of the stroke falls outside the outline, and the clip removes it.
			this.geom(shape, `fill="none" stroke="${this.fill(f.border.color)}" stroke-width="${num(2 * f.border.width)}" ${miter}`);
		}
		this.depth--;
		this.line("</g>");
	}

	private layers(layers: Layer[], reg: Region): void {
		for (const l of layers) {
			this.layer(l, reg);
		}
	}

	private layer(l: Layer, reg: Region): void {
		const { attrs, style } = this.effects(l, reg);
		if (l.layer === "group") {
			// A group composites as a unit, so its children blend only with each other.
			style.push("isolation:isolate");
		}
		if (style.length > 0) {
			attrs.push(`style="${style.join(";")}"`);
		}
		if (attrs.length > 0) {
			this.line(`<g ${attrs.join(" ")}>`);
			this.depth++;
		}
		this.content(l, reg);
		if (attrs.length > 0) {
			this.depth--;
			this.line("</g>");
		}
	}

	/** Writes any clip and mask a layer needs, and gives its attributes. */
	private effects(e: Effects, reg: Region): { attrs: string[]; style: string[] } {
		const attrs: string[] = [];
		const style: string[] = [];
		if (e.opacity !== 1) {
			attrs.push(`opacity="${num(e.opacity)}"`);
		}
		if (e.blend !== "normal") {
			style.push("mix-blend-mode:" + e.blend);
		}
		if (e.clip !== undefined) {
			const id = this.id("clip");
			this.line(`<clipPath id="${id}">`);
			this.depth++;
			const clip = forRegion(e.clip, reg);
			this.geom(shapeGeom(clip, position(clip, reg), 0), "");
			this.depth--;
			this.line("</clipPath>");
			attrs.push(`clip-path="url(#${id})"`);
		}
		if (e.cuts.length > 0) {
			const id = this.id("mask");
			const [x, y, w, h] = regionBounds(reg);
			this.line(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}">`);
			this.depth++;
			this.geom({ poly: rectPoly(x, y, x + w, y + h) }, 'fill="#fff"');
			for (const c of e.cuts) {
				const cut = forRegion(c, reg);
				this.geom(shapeGeom(cut, position(cut, reg), 0), 'fill="#000"');
			}
			this.depth--;
			this.line("</mask>");
			attrs.push(`mask="url(#${id})"`);
		}
		return { attrs, style };
	}

	private content(l: Layer, reg: Region): void {
		switch (l.layer) {
			case "field":
				this.paint(l.color, undefined, undefined, [], [{ poly: rectPoly(0, 0, reg.w, reg.h) }]);
				break;
			case "bars": {
				const hasGap = l.colors.includes(noColor);
				const exact = (i: number): boolean => this.flag.gradients[l.colors[i]!] !== undefined || hasGap;
				barPolys(l, reg, exact).forEach((poly, i) => {
					if (poly.length > 0) {
						this.paint(l.colors[i]!, undefined, undefined, [], [{ poly }]);
					}
				});
				break;
			}
			case "chevrons": {
				const { nested, bands } = rawChevrons(l, reg);
				// A gap has to show what's beneath, so each band stands alone.
				const polys = l.colors.includes(noColor) ? bands : chevronPolys(l, reg);
				if (l.fimbriate !== undefined) {
					this.paint(l.colors[polys.length - 1]!, undefined, l.fimbriate, [{ poly: nested[0]! }], []);
				}
				polys.forEach((poly, i) => {
					if (poly.length > 0) {
						this.paint(l.colors[polys.length - 1 - i]!, undefined, undefined, [], [{ poly }]);
					}
				});
				break;
			}
			case "band": {
				// The fimbriation's stroke mustn't follow the region's edge, so it uses the band's
				// unclipped shape. A clipped polygon can be empty.
				const stroke = [{ poly: bandPoly(reg, l.along, l.rotate, l.width, l.offset, true) }];
				const poly = bandPoly(reg, l.along, l.rotate, l.width, l.offset, false);
				this.paint(l.color, undefined, l.fimbriate, stroke, poly.length > 0 ? [{ poly }] : []);
				break;
			}
			case "cross": {
				// A gradient spans a cross as one shape, so it's given the whole region.
				const box: GradientBox = [0, 0, reg.w, reg.h];
				let stroke: Geom[] = [];
				if (l.fimbriate !== undefined) {
					// Keep the arms' ends, and their stroke, beyond the region's edge.
					const arms = crossPolys(l, reg, l.fimbriate.width * 2);
					stroke = [{ poly: arms[0] }, { poly: arms[1] }];
				}
				const arms = crossPolys(l, reg, 0);
				this.paint(l.color, box, l.fimbriate, stroke, [{ poly: arms[0] }, { poly: arms[1] }]);
				break;
			}
			case "quarters":
				this.quarters(l, reg);
				break;
			case "checks":
				this.checks(l, reg);
				break;
			case "rays": {
				const polys = rayPolys(l, reg);
				if (!l.colors.includes(noColor)) {
					// Beneath the wedges, so that antialiasing can't leave seams between them.
					this.paint(l.colors[0]!, undefined, undefined, [], [{ poly: rectPoly(0, 0, reg.w, reg.h) }]);
				}
				polys.forEach((poly, i) => {
					if (poly.length > 0) {
						this.paint(l.colors[i]!, undefined, undefined, [], [{ poly }]);
					}
				});
				break;
			}
			case "saltire": {
				if (l.counterchange) {
					this.counterchange(l, reg);
					return;
				}
				const box: GradientBox = [0, 0, reg.w, reg.h];
				const stroke: Geom[] =
					l.fimbriate !== undefined
						? [{ poly: bandPoly(reg, "bend", 0, l.width, 0, true) }, { poly: bandPoly(reg, "bend-sinister", 0, l.width, 0, true) }]
						: [];
				this.paint(l.color, box, l.fimbriate, stroke, [
					{ poly: bandPoly(reg, "bend", 0, l.width, 0, false) },
					{ poly: bandPoly(reg, "bend-sinister", 0, l.width, 0, false) },
				]);
				break;
			}
			case "charge":
				this.charge(l, reg);
				break;
			case "emblem":
				this.emblem(l, reg);
				break;
			case "group":
				this.layers(l.layers, reg);
				break;
			case "panel":
				this.panel(l, reg);
				break;
			case "use": {
				const d = l.define;
				if (d.fly === undefined || d.hoist === undefined) {
					this.layers(d.layers, reg);
					return;
				}
				// A design with its own grid is scaled to fill the region it's used in.
				this.line(`<g transform="scale(${num(reg.w / d.fly)} ${num(reg.h / d.hoist)})">`);
				this.depth++;
				this.layers(d.layers, { w: d.fly, h: d.hoist });
				this.depth--;
				this.line("</g>");
				break;
			}
		}
	}

	private panel(p: PanelLayer, reg: Region): void {
		const [x, y, w, h] = panelRect(p, reg);
		const shape: Geom = { poly: p.edge !== undefined ? panelEdge(p, w, h) : rectPoly(0, 0, w, h) };
		const id = this.id("panel");
		this.line(`<clipPath id="${id}">`);
		this.depth++;
		this.geom(shape, "");
		this.depth--;
		this.line("</clipPath>");
		this.line(`<g transform="translate(${num(x)} ${num(y)})" clip-path="url(#${id})" style="isolation:isolate">`);
		this.depth++;
		this.layers(p.layers, { w, h });
		this.depth--;
		this.line("</g>");
	}

	private quarters(q: QuartersLayer, reg: Region): void {
		let c = regionCenter(reg);
		if (q.diagonal) {
			const corners = regionCorners(reg);
			q.colors.forEach((color, i) => {
				this.paint(color, undefined, undefined, [], [{ poly: [c, corners[i]!, corners[(i + 1) % 4]!] }]);
			});
			return;
		}
		if (q.split !== undefined) {
			c = { x: q.split.fly, y: q.split.hoist };
		}
		const [a, b, d, e] = q.colors;
		if (q.colors.includes(noColor)) {
			this.paint(a, undefined, undefined, [], [{ poly: rectPoly(0, 0, c.x, c.y) }]);
			this.paint(b, undefined, undefined, [], [{ poly: rectPoly(c.x, 0, reg.w, c.y) }]);
			this.paint(d, undefined, undefined, [], [{ poly: rectPoly(0, c.y, c.x, reg.h) }]);
		} else {
			// Each runs on beneath the next, so antialiasing can't leave a seam.
			this.paint(a, undefined, undefined, [], [{ poly: rectPoly(0, 0, reg.w, reg.h) }]);
			this.paint(b, undefined, undefined, [], [{ poly: rectPoly(c.x, 0, reg.w, reg.h) }]);
			this.paint(d, undefined, undefined, [], [{ poly: rectPoly(0, c.y, reg.w, reg.h) }]);
		}
		this.paint(e, undefined, undefined, [], [{ poly: rectPoly(c.x, c.y, reg.w, reg.h) }]);
	}

	private checks(ch: ChecksLayer, reg: Region): void {
		const n = ch.colors.length;
		const cellW = reg.w / ch.columns;
		const cellH = reg.h / ch.rows;
		const gaps = ch.colors.includes(noColor);
		for (let row = 0; row < ch.rows; row++) {
			for (let col = 0; col < ch.columns; col++) {
				const i = ch.flow === "bend" ? col - row + ch.rows * n : row + col;
				const x = col * cellW;
				const y = row * cellH;
				// Each cell runs on beneath the next ones, unless gaps have to show.
				const right = gaps ? x + cellW : reg.w;
				const bottom = gaps ? y + cellH : reg.h;
				this.paint(ch.colors[i % n]!, undefined, undefined, [], [{ poly: rectPoly(x, y, right, bottom) }]);
			}
		}
	}

	/** Paints a saltire twice its width, clipped to four triangles so one side of each diagonal shows. */
	private counterchange(l: SaltireLayer, reg: Region): void {
		const c = regionCenter(reg);
		const id = this.id("clip");
		this.line(`<clipPath id="${id}">`);
		this.depth++;
		this.geom({
			poly: [
				c, { x: reg.w, y: c.y }, { x: reg.w, y: reg.h },
				c, { x: c.x, y: reg.h }, { x: 0, y: reg.h },
				c, { x: 0, y: c.y }, { x: 0, y: 0 },
				c, { x: c.x, y: 0 }, { x: reg.w, y: 0 },
			],
		}, "");
		this.depth--;
		this.line("</clipPath>");
		this.line(`<g clip-path="url(#${id})">`);
		this.depth++;
		this.paint(l.color, [0, 0, reg.w, reg.h], undefined, [], [
			{ poly: bandPoly(reg, "bend", 0, 2 * l.width, 0, false) },
			{ poly: bandPoly(reg, "bend-sinister", 0, 2 * l.width, 0, false) },
		]);
		this.depth--;
		this.line("</g>");
	}

	private emblem(e: EmblemLayer, reg: Region): void {
		const at = e.at !== undefined ? { x: e.at.fly, y: e.at.hoist } : regionCenter(reg);
		let angle = e.rotate;
		if (e.along !== undefined) {
			const { dir } = axis(reg, e.along, 0);
			angle += (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
		}
		// Painting is still clipped to the region, so the frame only has to reach its farthest corner.
		let reach = 0;
		for (const corner of regionCorners(reg)) {
			reach = Math.max(reach, Math.hypot(corner.x - at.x, corner.y - at.y));
		}
		this.keepUpright(at, () => {
			this.line(`<g transform="translate(${num(at.x)} ${num(at.y)}) rotate(${num(angle)})">`);
			this.depth++;
			// Charges in an emblem turn with it, so they aren't each kept upright as well.
			const upright = this.upright;
			this.upright = "";
			for (const c of e.charges) {
				this.layer(c, { w: 0, h: 0, local: reach });
			}
			this.upright = upright;
			this.depth--;
			this.line("</g>");
		});
	}

	private charge(c: ChargeLayer, reg: Region): void {
		const s = forRegion(c.shape, reg);
		const at = position(s, reg);
		if (s.kind === "svg") {
			this.keepUpright(at, () => this.embedded(c, s, at));
			return;
		}
		const copies: Geom[] = [];
		const centers: Vec[] = [];
		const addCopy = (center: Vec, turn: number): void => {
			copies.push(shapeGeom(s, center, turn));
			centers.push(center);
		};
		const repeat = c.repeat;
		if ((s.ats?.length ?? 0) > 1) {
			for (const p of s.ats!) {
				addCopy(p === null ? regionCenter(reg) : { x: p.fly, y: p.hoist }, 0);
			}
		} else if (repeat === undefined) {
			addCopy(at, 0);
		} else if (repeat.kind === "ring") {
			for (let i = 0; i < repeat.count; i++) {
				const a = (i * 360) / repeat.count;
				addCopy(add(at, rotate({ x: 0, y: -repeat.radius }, a)), repeat.turn ? a : 0);
			}
		} else if (repeat.kind === "arc") {
			for (let i = 0; i < repeat.count; i++) {
				const a = repeat.from + ((repeat.to - repeat.from) * i) / (repeat.count - 1);
				addCopy(add(at, rotate({ x: 0, y: -repeat.radius }, a)), repeat.turn ? a : 0);
			}
		} else if (repeat.kind === "line") {
			for (let i = 0; i < repeat.count; i++) {
				addCopy(add(at, mul({ x: repeat.fly, y: repeat.hoist }, i)), 0);
			}
		} else {
			for (let row = 1; row <= repeat.rows; row++) {
				for (let col = 1; col <= repeat.columns; col++) {
					if (repeat.stagger && (row + col) % 2 === 1) {
						continue;
					}
					addCopy({ x: (reg.w * col) / (repeat.columns + 1), y: (reg.h * row) / (repeat.rows + 1) }, 0);
				}
			}
		}
		const hollow = s.hollow ?? 0;
		const lines = s.kind === "star" ? (s.lines ?? 0) : 0;
		const draw = (shapes: Geom[]): void => {
			if (hollow > 0) {
				this.outlineOnly(c.color ?? "", hollow, shapes);
			} else if (lines > 0) {
				this.outlineOnly(c.color ?? "", lines, shapes);
			} else {
				this.paint(c.color ?? "", undefined, c.fimbriate, shapes, shapes);
			}
		};
		if (this.upright === "" || s.kind === "polygon") {
			draw(copies);
			return;
		}
		copies.forEach((copy, i) => {
			this.keepUpright(centers[i]!, () => draw([copy]));
		});
	}

	/** Undoes a turned variant's rotation around a point, if there is one. */
	private keepUpright(at: Vec, draw: () => void): void {
		if (this.upright === "") {
			draw();
			return;
		}
		this.line(`<g transform="translate(${num(at.x)} ${num(at.y)}) ${this.upright} translate(${num(-at.x)} ${num(-at.y)})">`);
		this.depth++;
		draw();
		this.depth--;
		this.line("</g>");
	}

	private outlineOnly(color: string, width: number, shapes: Geom[]): void {
		if (color === noColor) {
			return;
		}
		const stroke = this.fill(color);
		for (const g of shapes) {
			this.geom(g, `fill="none" stroke="${stroke}" stroke-width="${num(width / strokeScale(g))}" ${miter}`);
		}
	}

	private embedded(c: ChargeLayer, s: SvgShape, at: Vec): void {
		const attrs: string[] = [];
		if (c.color !== undefined && c.color !== "") {
			attrs.push(`color="${this.color(c.color)}"`);
		}
		if (s.rotate !== 0) {
			attrs.push(`transform="rotate(${num(s.rotate)} ${num(at.x)} ${num(at.y)})"`);
		}
		if (attrs.length > 0) {
			this.line(`<g ${attrs.join(" ")}>`);
			this.depth++;
		}
		// Each time it's drawn gets its own prefix, since a definition can draw it many times.
		const prefix = this.id("svg") + "-";
		this.line(
			`<svg x="${num(at.x - s.fly / 2)}" y="${num(at.y - s.hoist / 2)}" width="${num(s.fly)}" height="${num(s.hoist)}" viewBox="${esc(s.embedded.viewBox)}" preserveAspectRatio="xMidYMid meet"${s.embedded.attrs.replaceAll(idMark, prefix)}>${s.embedded.body.replaceAll(idMark, prefix)}</svg>`,
		);
		if (attrs.length > 0) {
			this.depth--;
			this.line("</g>");
		}
	}

	/**
	 * Fills shapes, after painting any fimbriation beneath all of them. Each shape's stroke lies
	 * beneath the others' fills, so arms read as a single shape. A gradient spans the box, or each
	 * shape's own bounds if there's none.
	 */
	private paint(color: string, box: GradientBox | undefined, fimbriate: Fimbriation | undefined, stroke: Geom[], shapes: Geom[]): void {
		if (fimbriate !== undefined) {
			const edge = this.fill(fimbriate.color, box);
			for (const g of stroke) {
				this.geom(g, `fill="${edge}" stroke="${edge}" stroke-width="${num((2 * fimbriate.width) / strokeScale(g))}" ${miter}`);
			}
		}
		if (shapes.length === 0 || color === noColor) {
			return;
		}
		const fill = this.fill(color, box);
		for (const g of shapes) {
			this.geom(g, `fill="${fill}"`);
		}
	}

	private geom(g: Geom, attrsIn: string): void {
		let attrs = attrsIn !== "" ? " " + attrsIn : "";
		if (g.transform !== undefined && g.transform !== "") {
			attrs += ` transform="${g.transform}"`;
		}
		if (g.evenodd) {
			attrs += ' fill-rule="evenodd"';
		}
		if (g.path !== undefined && g.path !== "") {
			this.line(`<path d="${g.path}"${attrs}/>`);
		} else if (g.circle) {
			this.line(`<circle cx="${num(g.c!.x)}" cy="${num(g.c!.y)}" r="${num(g.r!)}"${attrs}/>`);
		} else if (g.ring) {
			this.line(`<path fill-rule="evenodd" d="${circlePath(g.c!, g.r!)} ${circlePath(g.c!, g.inner!)}"${attrs}/>`);
		} else {
			const poly = g.poly ?? [];
			let points = "";
			for (let i = 0; i < poly.length; i++) {
				points += (i > 0 ? " " : "") + num(poly[i]!.x) + "," + num(poly[i]!.y);
			}
			this.line(`<polygon points="${points}"${attrs}/>`);
		}
	}

	/** Renders a flag in a folded position. */
	writeFolded(f: Flag, steps: number, height: number, fold: Flag["folds"][string]): void {
		let stack;
		try {
			stack = foldFacets(foldShape(f), fold, steps);
		} catch (e) {
			throw new RenderError((e as Error).message);
		}
		const [x, y, w, h] = bounds(stack.flatMap((facet) => facet.poly));
		this.line(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x)} ${num(y)} ${num(w)} ${num(h)}" width="${num((height * w) / h)}" height="${num(height)}">`);
		this.depth++;
		this.line(`<title>${esc(f.meta.name)}</title>`);
		this.line("<defs>");
		this.depth++;
		const front = this.id("front");
		this.line(`<g id="${front}">`);
		this.depth++;
		this.flagArt(f);
		this.depth--;
		this.line("</g>");
		let back = "";
		if (f.reverse !== undefined) {
			back = this.id("back");
			this.line(`<g id="${back}">`);
			this.depth++;
			this.flagArt({ ...f, layers: f.reverse.layers });
			this.depth--;
			this.line("</g>");
		}
		this.depth--;
		this.line("</defs>");
		// A crease line reads at any scale, without hiding the design.
		const crease = `fill="none" stroke="#000" stroke-opacity="0.35" stroke-linejoin="round" stroke-width="${num(Math.max(w, h) * 0.004)}"`;
		for (const fc of stack) {
			const id = this.id("facet");
			this.line(`<clipPath id="${id}">`);
			this.depth++;
			this.geom({ poly: fc.poly }, "");
			this.depth--;
			this.line("</clipPath>");
			let art = front;
			let place: Matrix = fc.place;
			if (fc.flipped && back !== "") {
				// A separate back is written as seen from that side, so it mirrors back.
				art = back;
				place = then({ a: -1, b: 0, c: 0, d: 1, e: f.fly, f: 0 }, fc.place);
			}
			this.line(`<g clip-path="url(#${id})"><use href="#${art}" transform="matrix(${num(place.a)} ${num(place.b)} ${num(place.c)} ${num(place.d)} ${num(place.e)} ${num(place.f)})"/></g>`);
			this.geom({ poly: fc.poly }, crease);
		}
		this.depth--;
		this.line("</svg>");
	}
}

