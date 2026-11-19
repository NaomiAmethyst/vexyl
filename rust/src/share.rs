// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! Share links, which hold a whole document in the fragment of a URL, as SDK section 8 defines
//! them: `v1.` and the base64url of the document's raw DEFLATE with a preset dictionary.
//! Compression is miniz_oxide's, which is pure Rust.

use miniz_oxide::deflate::core::{
    CompressorOxide, TDEFLFlush, TDEFLStatus, compress, create_comp_flags_from_zip_params,
};
use miniz_oxide::inflate::TINFLStatus;
use miniz_oxide::inflate::core::{DecompressorOxide, decompress, inflate_flags};

use crate::sha256;

/// The largest document a share link can hold, in bytes of UTF-8. SDK section 8 fixes it.
pub const MAX_BYTES: usize = 8 * 1024 * 1024;

/// The normative preset dictionary of version 1 links, a copy of share/v1.dict.
const DICTIONARY: &[u8] = include_bytes!("share-v1.dict");

/// The SHA-256 of version 1's dictionary, which SDK section 8 gives.
const DICTIONARY_SHA256: &str = "92062df2fd010bea13d1aefb30c2cfbb2ad6aee5a60e8f8e2d2455516c1c6b97";

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

fn dictionary() -> &'static [u8] {
    assert_eq!(
        sha256::hex(&sha256::digest(DICTIONARY), 32),
        DICTIONARY_SHA256,
        "the share dictionary isn't version 1's"
    );
    DICTIONARY
}

/// Compresses all of a piece of input, adding what comes out to out.
fn deflate(
    d: &mut CompressorOxide,
    input: &[u8],
    flush: TDEFLFlush,
    out: &mut Vec<u8>,
) -> TDEFLStatus {
    let mut buf = vec![0u8; 1 << 16];
    let mut input = input;
    loop {
        let (status, used, written) = compress(d, input, &mut buf, flush);
        out.extend_from_slice(&buf[..written]);
        input = &input[used..];
        match status {
            TDEFLStatus::Done => return status,
            TDEFLStatus::Okay if input.is_empty() && written < buf.len() => return status,
            TDEFLStatus::Okay => {}
            _ => return status,
        }
    }
}

/// Writes a document as the part of a share link after its `#`. Its exact bytes are kept, line
/// endings and any byte order mark included.
pub(crate) fn encode(document: &str) -> Result<String, String> {
    let source = document.as_bytes();
    if source.len() > MAX_BYTES {
        return Err(format!(
            "a share link can hold up to {MAX_BYTES} bytes, and this is {}",
            source.len()
        ));
    }
    // The dictionary is compressed first and flushed to a byte boundary, so what follows can
    // refer back into it, and only what follows is kept: a raw stream with a preset dictionary.
    let mut d = CompressorOxide::new(create_comp_flags_from_zip_params(10, -15, 0));
    let mut primed = Vec::new();
    deflate(&mut d, dictionary(), TDEFLFlush::Sync, &mut primed);
    let mut out = Vec::new();
    let status = deflate(&mut d, source, TDEFLFlush::Finish, &mut out);
    if status != TDEFLStatus::Done {
        return Err("the document couldn't be compressed".into());
    }
    Ok(format!("v1.{}", base64(&out)))
}

/// Reads the part of a share link after its `#`. Anything untrusted can be in one, so this stops
/// as soon as the output passes [`MAX_BYTES`], and refuses whatever isn't exactly what an encoder
/// writes.
pub(crate) fn decode(link: &str) -> Result<String, String> {
    let Some(rest) = link.strip_prefix('v') else {
        return Err("it doesn't start with a version".into());
    };
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    if digits == 0 || rest.as_bytes().get(digits) != Some(&b'.') {
        return Err("it doesn't start with a version".into());
    }
    let version = &rest[..digits];
    if version != "1" {
        return Err(format!("it's version {version}, and this reads version 1"));
    }
    let compressed = unbase64(&rest[digits + 1..])?;
    let dict = dictionary();
    // The dictionary sits before the output, where the stream can refer back to it, and the
    // buffer ends one byte past the limit, so that the decoder stops there.
    let mut out = vec![0u8; dict.len() + MAX_BYTES + 1];
    out[..dict.len()].copy_from_slice(dict);
    let mut r = DecompressorOxide::new();
    let flags = inflate_flags::TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF;
    let (status, used, written) = decompress(&mut r, &compressed, &mut out, dict.len(), flags);
    match status {
        TINFLStatus::Done => {}
        TINFLStatus::HasMoreOutput => {
            return Err(format!(
                "what it holds is over the limit of {MAX_BYTES} bytes"
            ));
        }
        TINFLStatus::FailedCannotMakeProgress | TINFLStatus::NeedsMoreInput => {
            return Err("its compressed data is corrupt: it ends early".into());
        }
        _ => return Err("its compressed data is corrupt".into()),
    }
    if written > MAX_BYTES {
        return Err(format!(
            "what it holds is over the limit of {MAX_BYTES} bytes"
        ));
    }
    if used != compressed.len() {
        return Err("its compressed data is corrupt: there's more after its end".into());
    }
    out.truncate(dict.len() + written);
    out.drain(..dict.len());
    String::from_utf8(out).map_err(|_| "what it holds isn't UTF-8".to_string())
}

fn base64(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len() * 4 / 3 + 3);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        let chars = chunk.len() + 1;
        for i in 0..chars {
            out.push(ALPHABET[((n >> (18 - 6 * i)) & 63) as usize] as char);
        }
    }
    out
}

/// Reads base64url with no padding, refusing anything an encoder wouldn't have written.
fn unbase64(body: &str) -> Result<Vec<u8>, String> {
    let mut values = Vec::with_capacity(body.len());
    for c in body.bytes() {
        let Some(v) = ALPHABET.iter().position(|&a| a == c) else {
            return Err("it has a character that isn't in base64url".into());
        };
        values.push(v as u32);
    }
    if values.len() % 4 == 1 {
        return Err("its base64url isn't in canonical form".into());
    }
    let mut out = Vec::with_capacity(values.len() * 3 / 4);
    for chunk in values.chunks(4) {
        let mut n = 0u32;
        for (i, v) in chunk.iter().enumerate() {
            n |= v << (18 - 6 * i);
        }
        let bytes = chunk.len() - 1;
        // The bits past the last whole byte have to be zero, as an encoder writes them.
        let stray = n & ((1u32 << (24 - 8 * bytes)) - 1);
        if stray != 0 {
            return Err("its base64url isn't in canonical form".into());
        }
        for i in 0..bytes {
            out.push((n >> (16 - 8 * i)) as u8);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_it_writes() {
        for doc in ["", "vexyl 1\n", "vexyl 1\r\n\u{FEFF}meta { name \"é\" }\n"] {
            let link = encode(doc).unwrap();
            assert!(link.starts_with("v1."));
            assert_eq!(decode(&link).unwrap(), doc);
        }
    }

    #[test]
    fn refuses_what_isnt_canonical() {
        assert!(decode("v2.AA").is_err());
        assert!(decode("v01.AA").is_err());
        assert!(decode("v.AA").is_err());
        assert!(decode("v1.A=").is_err());
        assert!(decode("v1.A").is_err());
        assert!(decode("v1.A B").is_err());
        let link = encode("vexyl 1\n").unwrap();
        assert!(decode(&format!("{link}AA")).is_err());
    }

    #[test]
    fn writes_base64url() {
        assert_eq!(base64(b"\xfb\xff"), "-_8");
        assert_eq!(unbase64("-_8").unwrap(), b"\xfb\xff");
        assert!(unbase64("-_9").is_err());
    }
}
