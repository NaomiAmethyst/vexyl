// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

/** A document, an option or a share link that Vexyl refuses. */
public class VexylException extends Exception {
	private static final long serialVersionUID = 1L;

	/** Refuses something, saying why for a person to read. */
	public VexylException(String message) {
		super(message);
	}

	/** Refuses something because of another failure. */
	public VexylException(String message, Throwable cause) {
		super(message, cause);
	}
}
