// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

/**
 * One thing wrong with a document, as section 2 of the SDK describes it.
 *
 * @param line where it is, from 1, or 0 if it has no one place; a line ends at LF, once line
 *     endings are normalized
 * @param column the column on that line, counting code points from 1, or 0 with no line
 * @param node the name of the KDL node it's about, or null
 * @param message what's wrong, for a person to read; programs mustn't depend on its wording
 */
public record Problem(int line, int column, String node, String message) {
	/** Whether it has a place in the document. */
	public boolean hasLine() {
		return line > 0;
	}

	@Override
	public String toString() {
		StringBuilder b = new StringBuilder();
		if (line > 0) {
			b.append(line).append(':').append(column).append(": ");
		}
		if (node != null && !node.isEmpty()) {
			b.append(node).append(": ");
		}
		return b.append(message).toString();
	}
}
