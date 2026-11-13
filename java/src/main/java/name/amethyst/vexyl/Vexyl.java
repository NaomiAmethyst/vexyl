// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;

/**
 * Reads, checks and locates Vexyl flag documents, and reads and writes share links: the
 * operations of section 1 of the SDK that don't need a flag. {@link Flag} has the rest.
 *
 * <p>Nothing here reads the network or the filesystem, since a document is self-contained.
 */
public final class Vexyl {
	private Vexyl() {}

	/** The format version this library reads. */
	public static final int FORMAT_VERSION = Parser.FORMAT_VERSION;

	/** The attribute a tagged render marks each drawn element with. */
	public static final String TAG_ATTRIBUTE = "data-vexyl-layer";

	/**
	 * Reads a document.
	 *
	 * @throws ProblemsException with every problem found, if it isn't valid
	 */
	public static Flag parse(String document) throws ProblemsException {
		return new Flag(Parser.parse(document));
	}

	/**
	 * Reads a document from its bytes, which have to be UTF-8.
	 *
	 * @throws ProblemsException with every problem found, if it isn't valid
	 */
	public static Flag parse(byte[] document) throws ProblemsException {
		return parse(text(document));
	}

	/** Every problem in a document, or none if it's valid. */
	public static List<Problem> validate(String document) {
		try {
			parse(document);
			return List.of();
		} catch (ProblemsException e) {
			return e.problems();
		}
	}

	/** Every problem in a document given as bytes, or none if it's valid UTF-8 and a valid document. */
	public static List<Problem> validate(byte[] document) {
		try {
			parse(document);
			return List.of();
		} catch (ProblemsException e) {
			return e.problems();
		}
	}

	private static String text(byte[] document) throws ProblemsException {
		try {
			return StandardCharsets.UTF_8.newDecoder()
					.onMalformedInput(CodingErrorAction.REPORT)
					.onUnmappableCharacter(CodingErrorAction.REPORT)
					.decode(ByteBuffer.wrap(document))
					.toString();
		} catch (CharacterCodingException e) {
			throw new ProblemsException(List.of(new Problem(0, 0, null, "a document has to be UTF-8")));
		}
	}

	/**
	 * Where each layer and other part of a document is, in document order. It reads only the
	 * document's syntax, so it works on one with other problems, and gives nothing if the
	 * document isn't KDL.
	 */
	public static List<Span> locate(String document) {
		return List.copyOf(Locate.locate(document));
	}

	/** The innermost of a document's parts holding a line, if any does. */
	public static Optional<Span> layerAt(List<Span> spans, int line) {
		return Locate.layerAt(spans, line);
	}

	/** Writes a name as part of a path, where {@code %} is {@code %25} and {@code /} is {@code %2F}. */
	public static String encodePathName(String name) {
		return Locate.encodeName(name);
	}

	/** Reads a name written in a path. */
	public static String decodePathName(String part) {
		return Locate.decodeName(part);
	}

	/** The path of the layer holding another, or the empty string for one at the top of its scope. */
	public static String parentPath(String path) {
		return Locate.parentPath(path);
	}

	/**
	 * Writes a document as the part of a share link after its {@code #}.
	 *
	 * @throws VexylException if it's larger than a link can hold
	 */
	public static String shareEncode(String document) throws VexylException {
		return Share.encode(document);
	}

	/**
	 * Reads the document a share link holds, given the part after its {@code #}.
	 *
	 * @throws VexylException if the link is malformed, corrupt, too large, or of a version this
	 *     library doesn't read
	 */
	public static String shareDecode(String link) throws VexylException {
		return Share.decode(link);
	}
}
