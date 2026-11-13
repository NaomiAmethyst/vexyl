// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.util.List;
import java.util.stream.Collectors;

/** A document that isn't valid, with every problem found in it. */
public final class ProblemsException extends VexylException {
	private static final long serialVersionUID = 1L;
	private final transient List<Problem> problems;

	/** Refuses a document for these problems, of which there's at least one. */
	public ProblemsException(List<Problem> problems) {
		super(problems.stream().map(Problem::toString).collect(Collectors.joining("\n")));
		this.problems = List.copyOf(problems);
	}

	/** The problems, in no order that programs should depend on. */
	public List<Problem> problems() {
		return problems;
	}
}
