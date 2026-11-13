// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

/**
 * Where a layer or other part of a document is, as section 7.3 of the SDK describes it. Lines
 * and columns are counted as a {@link Problem}'s are, and a part ends at its last character, not
 * counting a {@code ;} or line ending.
 *
 * @param path a layer's path, such as {@code 3.1} or {@code variant/NAME/0}, or what else it is,
 *     such as {@code palette/NAME}
 * @param node the KDL node's name
 */
public record Span(String path, String node, int line, int column, int endLine, int endColumn) {}
