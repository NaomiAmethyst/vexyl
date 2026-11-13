// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

package name.amethyst.vexyl;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.DataFormatException;
import java.util.zip.Deflater;
import java.util.zip.Inflater;

/**
 * Share links, which hold a whole document in the fragment of a URL, as SDK section 8 defines
 * them: {@code v1.} and the base64url of the document's raw DEFLATE with a preset dictionary.
 */
public final class Share {
	/** The largest document a share link can hold, in bytes of UTF-8. SDK section 8 fixes it. */
	public static final int MAX_BYTES = 8 * 1024 * 1024;

	/** The SHA-256 of version 1's dictionary, which SDK section 8 gives. */
	private static final String DICTIONARY_SHA256 = "92062df2fd010bea13d1aefb30c2cfbb2ad6aee5a60e8f8e2d2455516c1c6b97";

	private static final Pattern VERSION = Pattern.compile("^v([0-9]+)\\.");
	private static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

	private static byte[] dictionary;

	private Share() {
	}

	/** The normative preset dictionary of version 1 links, a copy of share/v1.dict. */
	static synchronized byte[] dictionary() {
		if (dictionary == null) {
			try (InputStream in = Share.class.getResourceAsStream("/name/amethyst/vexyl/share-v1.dict")) {
				if (in == null) {
					throw new IllegalStateException("the share dictionary is missing");
				}
				byte[] d = in.readAllBytes();
				StringBuilder hex = new StringBuilder();
				for (byte b : MessageDigest.getInstance("SHA-256").digest(d)) {
					hex.append(String.format("%02x", b));
				}
				if (!hex.toString().equals(DICTIONARY_SHA256)) {
					throw new IllegalStateException("the share dictionary isn't version 1's");
				}
				dictionary = d;
			} catch (IOException e) {
				throw new UncheckedIOException(e);
			} catch (NoSuchAlgorithmException e) {
				throw new IllegalStateException(e);
			}
		}
		return dictionary.clone();
	}

	/**
	 * Writes a document as the part of a share link after its {@code #}. Its exact bytes are kept,
	 * line endings and any byte order mark included.
	 *
	 * @param document the document's text
	 * @return the link's fragment, such as {@code v1.K0utLQ}
	 * @throws VexylException if the document is over {@link #MAX_BYTES} in UTF-8
	 */
	public static String encode(String document) throws VexylException {
		byte[] source = document.getBytes(StandardCharsets.UTF_8);
		if (source.length > MAX_BYTES) {
			throw new VexylException("a share link can hold up to " + MAX_BYTES + " bytes, and this is " + source.length);
		}
		Deflater d = new Deflater(Deflater.BEST_COMPRESSION, true);
		try {
			d.setDictionary(dictionary());
			d.setInput(source);
			d.finish();
			ByteArrayOutputStream out = new ByteArrayOutputStream();
			byte[] buf = new byte[65536];
			while (!d.finished()) {
				int n = d.deflate(buf);
				out.write(buf, 0, n);
			}
			return "v1." + base64(out.toByteArray());
		} finally {
			d.end();
		}
	}

	/**
	 * Reads the part of a share link after its {@code #}. Anything untrusted can be in one, so this
	 * stops as soon as the output passes {@link #MAX_BYTES}, and refuses whatever isn't exactly what
	 * an encoder writes.
	 *
	 * @param link the link's fragment, without the {@code #}
	 * @return the document it holds
	 * @throws VexylException if the link is of another version, isn't canonical base64url, holds a
	 *     corrupt or truncated stream or anything after its end, is over the limit, or isn't UTF-8
	 */
	public static String decode(String link) throws VexylException {
		Matcher m = VERSION.matcher(link);
		if (!m.find()) {
			throw new VexylException("it doesn't start with a version");
		}
		if (!m.group(1).equals("1")) {
			throw new VexylException("it's version " + m.group(1) + ", and this reads version 1");
		}
		byte[] compressed = unbase64(link.substring(m.end()));
		Inflater inf = new Inflater(true);
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		try {
			inf.setDictionary(dictionary());
			inf.setInput(compressed);
			byte[] buf = new byte[65536];
			while (!inf.finished()) {
				int n = inf.inflate(buf);
				if (n == 0 && !inf.finished()) {
					if (inf.needsDictionary()) {
						throw new VexylException("its compressed data is corrupt");
					}
					if (inf.needsInput()) {
						throw new VexylException("its compressed data is corrupt: it ends early");
					}
				}
				out.write(buf, 0, n);
				if (out.size() > MAX_BYTES) {
					throw new VexylException("what it holds is over the limit of " + MAX_BYTES + " bytes");
				}
			}
			if (inf.getRemaining() != 0) {
				throw new VexylException("its compressed data is corrupt: there's more after its end");
			}
		} catch (DataFormatException e) {
			throw new VexylException("its compressed data is corrupt: " + e.getMessage());
		} finally {
			inf.end();
		}
		try {
			return StandardCharsets.UTF_8.newDecoder()
					.onMalformedInput(CodingErrorAction.REPORT)
					.onUnmappableCharacter(CodingErrorAction.REPORT)
					.decode(ByteBuffer.wrap(out.toByteArray()))
					.toString();
		} catch (CharacterCodingException e) {
			throw new VexylException("what it holds isn't UTF-8");
		}
	}

	private static String base64(byte[] data) {
		return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(data);
	}

	/** Reads base64url with no padding, refusing anything an encoder wouldn't have written. */
	private static byte[] unbase64(String body) throws VexylException {
		for (int i = 0; i < body.length(); i++) {
			if (ALPHABET.indexOf(body.charAt(i)) < 0) {
				throw new VexylException("it has a character that isn't in base64url");
			}
		}
		if (body.length() % 4 == 1) {
			throw new VexylException("its base64url isn't in canonical form");
		}
		byte[] data;
		try {
			data = java.util.Base64.getUrlDecoder().decode(body);
		} catch (IllegalArgumentException e) {
			throw new VexylException("its base64url isn't in canonical form");
		}
		// The decoder ignores stray bits in the last character, so a canonical body is the one that
		// encodes back to itself.
		if (!base64(data).equals(body)) {
			throw new VexylException("its base64url isn't in canonical form");
		}
		return Arrays.copyOf(data, data.length);
	}
}
