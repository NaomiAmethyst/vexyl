// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

// A small picture of each term, for choosing one by how it looks. They use the page's colors, so
// that they read as pictures of a kind of thing rather than of any one flag.

const ground = "var(--art-ground)";
const mark = "var(--art-mark)";

const flag = (...parts: preact.ComponentChild[]): preact.JSX.Element => (
	<svg viewBox="0 0 30 20" aria-hidden="true" class="term-art">
		<rect width="30" height="20" fill={ground} />
		{parts}
	</svg>
);

const star = "15,3 16.8,8 22,8.2 17.9,11.3 19.3,16.3 15,13.4 10.7,16.3 12.1,11.3 8,8.2 13.2,8";

const pictures: Readonly<Record<string, () => preact.JSX.Element>> = {
	field: () => <svg viewBox="0 0 30 20" aria-hidden="true" class="term-art"><rect width="30" height="20" fill={mark} /></svg>,
	bars: () => flag(<rect y="6.67" width="30" height="6.66" fill={mark} />),
	band: () => flag(<rect y="8" width="30" height="4" fill={mark} />),
	cross: () => flag(<rect x="9" width="4" height="20" fill={mark} />, <rect y="8" width="30" height="4" fill={mark} />),
	saltire: () => flag(<path d="M0 0L30 20M30 0L0 20" stroke={mark} stroke-width="3" />),
	quarters: () => flag(<rect width="15" height="10" fill={mark} />, <rect x="15" y="10" width="15" height="10" fill={mark} />),
	chevrons: () => flag(<polygon points="0,0 8,0 18,10 8,20 0,20 10,10" fill={mark} />),
	checks: () => flag(<rect width="10" height="10" fill={mark} />, <rect x="20" width="10" height="10" fill={mark} />, <rect x="10" y="10" width="10" height="10" fill={mark} />),
	rays: () => flag(<polygon points="15,10 30,0 30,6" fill={mark} />, <polygon points="15,10 30,14 30,20" fill={mark} />, <polygon points="15,10 0,20 0,14" fill={mark} />, <polygon points="15,10 0,6 0,0" fill={mark} />),
	pile: () => flag(<polygon points="0,0 16,10 0,20" fill={mark} />),
	pall: () => flag(<path d="M0 0L13 10L0 20M13 10H30" fill="none" stroke={mark} stroke-width="3.5" />),
	canton: () => flag(<rect width="13" height="10" fill={mark} />),
	panel: () => flag(<rect width="8" height="20" fill={mark} />),
	emblem: () => flag(<circle cx="15" cy="10" r="6.5" fill="none" stroke={mark} stroke-width="1.5" />, <circle cx="15" cy="10" r="2.5" fill={mark} />),
	group: () => flag(<rect x="5" y="4" width="13" height="9" fill={mark} opacity="0.55" />, <rect x="12" y="7" width="13" height="9" fill={mark} opacity="0.55" />),
	outline: () => <svg viewBox="0 0 30 20" aria-hidden="true" class="term-art"><polygon points="0,0 30,0 22,10 30,20 0,20" fill={mark} /></svg>,
	border: () => flag(<rect x="1.5" y="1.5" width="27" height="17" fill="none" stroke={mark} stroke-width="3" />),
	define: () => flag(<rect x="5" y="5" width="20" height="10" rx="2" fill="none" stroke={mark} stroke-width="1.5" stroke-dasharray="2.5 2" />),
	reverse: () => flag(<rect x="17" width="13" height="10" fill={mark} />),
	adapt: () => flag(<rect x="6" y="5" width="18" height="10" fill={mark} />, <path d="M1 10H5M25 10H29" stroke={mark} stroke-width="1.5" />),
	variant: () => <svg viewBox="0 0 30 20" aria-hidden="true" class="term-art"><rect x="10" width="10" height="20" fill={ground} /><rect x="10" width="10" height="7" fill={mark} /></svg>,
	fold: () => <svg viewBox="0 0 30 20" aria-hidden="true" class="term-art"><polygon points="4,2 26,2 15,18" fill={mark} /></svg>,
	color: () => <svg viewBox="0 0 30 20" aria-hidden="true" class="term-art"><circle cx="15" cy="10" r="8" fill={mark} /></svg>,
	gradient: () => (
		<svg viewBox="0 0 30 20" aria-hidden="true" class="term-art">
			{[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x={i * 5} width="5.2" height="20" fill={mark} opacity={String((i + 1) / 6)} />)}
		</svg>
	),
	"charge:disc": () => flag(<circle cx="15" cy="10" r="7" fill={mark} />),
	"charge:ellipse": () => flag(<ellipse cx="15" cy="10" rx="10" ry="6" fill={mark} />),
	"charge:ring": () => flag(<circle cx="15" cy="10" r="6" fill="none" stroke={mark} stroke-width="2.5" />),
	"charge:rect": () => flag(<rect x="6" y="5" width="18" height="10" fill={mark} />),
	"charge:plus": () => flag(<path d="M15 3V17M8 10H22" stroke={mark} stroke-width="3.5" />),
	"charge:triangle": () => flag(<polygon points="15,3 22,16 8,16" fill={mark} />),
	"charge:star": () => flag(<polygon points={star} fill={mark} />),
	"charge:crescent": () => flag(<path d="M18 3.5A7.5 7.5 0 1 0 18 16.5A6 6 0 1 1 18 3.5Z" fill={mark} />),
	"charge:sun": () => flag(<circle cx="15" cy="10" r="3.5" fill={mark} />, <path d="M15 2V5M15 15V18M7 10H10M20 10H23M9.3 4.3L11.5 6.5M18.5 13.5L20.7 15.7M20.7 4.3L18.5 6.5M11.5 13.5L9.3 15.7" stroke={mark} stroke-width="1.5" />),
	"charge:lozenge": () => flag(<polygon points="15,3 24,10 15,17 6,10" fill={mark} />),
	"charge:heart": () => flag(<path d="M15 17C9 12.5 7 10 7 7.5A3.8 3.8 0 0 1 15 6.5A3.8 3.8 0 0 1 23 7.5C23 10 21 12.5 15 17Z" fill={mark} />),
	"charge:cardioid": () => flag(<path d="M15 5C13 2.5 7.5 3.5 7.5 8.5C7.5 13 11 17 15 17C19 17 22.5 13 22.5 8.5C22.5 3.5 17 2.5 15 5Z" fill={mark} />),
	"charge:path": () => flag(<path d="M6 15C9 3 13 3 15 10S22 16 24 5" fill="none" stroke={mark} stroke-width="2" />),
	"charge:polygon": () => flag(<polygon points="7,5 20,3 25,12 15,17 6,13" fill={mark} />),
	"charge:svg": () => flag(<rect x="7" y="4" width="16" height="12" fill="none" stroke={mark} stroke-width="1.5" />, <path d="M9 14L13 9L16 12L18 10L21 14" fill="none" stroke={mark} stroke-width="1.5" />),
};

/** A term's picture, if it has one. */
export function TermArt(props: { term: string }): preact.JSX.Element | null {
	const picture = Object.hasOwn(pictures, props.term) ? pictures[props.term] : undefined;
	return picture === undefined ? null : picture();
}
