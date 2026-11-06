// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

/** The attribute a tagged render marks each drawn element with. */
export const tagAttribute = "data-vexyl-layer";

/** Writes a name in a path, where `/` separates the parts. */
export function encodePathName(name: string): string {
	return name.replaceAll("%", "%25").replaceAll("/", "%2F");
}

export function decodePathName(part: string): string {
	return part.replaceAll("%2F", "/").replaceAll("%25", "%");
}

/** The path of what holds a layer, or nothing if it's at the top of its scope. */
export function parentPath(path: string): string | undefined {
	const slash = path.lastIndexOf("/");
	const dot = path.lastIndexOf(".");
	return dot > slash ? path.slice(0, dot) : undefined;
}
