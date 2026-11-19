// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

//! Numbers written inside strings: a box, a fold's crease, and path data.

use crate::limits;

/// What counts as whitespace inside strings and inline SVG.
pub(crate) fn is_space(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | 0x0C | b'\r')
}

fn digits(s: &[u8], mut i: usize) -> usize {
    while i < s.len() && s[i].is_ascii_digit() {
        i += 1;
    }
    i
}

/// Matches the one way to write a number inside a string, as SPEC section 4 gives it,
/// `[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?`, at i, giving where it ends.
pub(crate) fn match_decimal(s: &[u8], start: usize) -> Option<usize> {
    let mut i = start;
    if i < s.len() && (s[i] == b'-' || s[i] == b'+') {
        i += 1;
    }
    let d = digits(s, i);
    if d > i {
        i = d;
        if i < s.len() && s[i] == b'.' {
            i = digits(s, i + 1);
        }
    } else if i < s.len() && s[i] == b'.' && digits(s, i + 1) > i + 1 {
        i = digits(s, i + 1);
    } else {
        return None;
    }
    if i < s.len() && (s[i] == b'e' || s[i] == b'E') {
        let mut j = i + 1;
        if j < s.len() && (s[j] == b'-' || s[j] == b'+') {
            j += 1;
        }
        let e = digits(s, j);
        if e > j {
            i = e;
        }
    }
    Some(i)
}

/// Whether all of a text is one decimal.
pub(crate) fn is_decimal(text: &str) -> bool {
    match_decimal(text.as_bytes(), 0) == Some(text.len())
}

/// Whether a number, as written, has a digit other than 0 before any exponent.
pub(crate) fn written_nonzero(text: &str) -> bool {
    let mantissa = text.split(['e', 'E']).next().unwrap_or("");
    mantissa.bytes().any(|c| (b'1'..=b'9').contains(&c))
}

/// A number written as SPEC section 4 says, within the format's limits, or None.
pub(crate) fn decimal_value(text: &str) -> Option<f64> {
    if !is_decimal(text) {
        return None;
    }
    let v: f64 = text.parse().ok()?;
    let a = v.abs();
    if v.is_nan() || a > 1e12 || (a != 0.0 && a < 1.0 / 1e12) {
        return None;
    }
    // One too small for a double comes out as 0, though it isn't zero as written.
    if v == 0.0 && written_nonzero(text) {
        return None;
    }
    Some(v)
}

fn skip_space(s: &[u8], mut i: usize) -> usize {
    while i < s.len() && is_space(s[i]) {
        i += 1;
    }
    i
}

/// Splits a string of numbers, separated by whitespace, a comma or both, into their texts, or
/// gives None if it isn't one.
pub(crate) fn decimal_texts(text: &str) -> Option<Vec<&str>> {
    let s = text.as_bytes();
    let mut i = skip_space(s, 0);
    let mut out = Vec::new();
    loop {
        let end = match_decimal(s, i)?;
        out.push(&text[i..end]);
        i = end;
        let after = skip_space(s, i);
        if after == s.len() {
            return Some(out);
        }
        if s[after] == b',' {
            i = skip_space(s, after + 1);
        } else if after > i {
            i = after;
        } else {
            return None;
        }
    }
}

/// Reads a string of numbers, separated by whitespace, a comma or both, or gives None.
pub(crate) fn list(text: &str) -> Option<Vec<f64>> {
    decimal_texts(text)?
        .into_iter()
        .map(decimal_value)
        .collect()
}

fn arguments(c: u8) -> Option<usize> {
    match c {
        b'M' | b'L' | b'T' => Some(2),
        b'H' | b'V' => Some(1),
        b'C' => Some(6),
        b'S' | b'Q' => Some(4),
        b'A' => Some(7),
        b'Z' => Some(0),
        _ => None,
    }
}

const COMMANDS: &[u8] = b"MmLlHhVvCcSsQqTtAaZz";

/// Checks path data against SVG's grammar, within the format's limits on numbers, so that a bad
/// one can't silently draw part of a shape or nothing.
pub(crate) fn valid_path(d: &str) -> bool {
    PathCheck {
        d: d.as_bytes(),
        i: 0,
    }
    .valid()
}

struct PathCheck<'a> {
    d: &'a [u8],
    i: usize,
}

impl PathCheck<'_> {
    fn space(&mut self) {
        self.i = skip_space(self.d, self.i);
    }

    /// Skips whitespace and at most one comma, and says if there was a comma.
    fn separator(&mut self) -> bool {
        self.space();
        if self.i < self.d.len() && self.d[self.i] == b',' {
            self.i += 1;
            self.space();
            return true;
        }
        false
    }

    fn number(&mut self) -> bool {
        let Some(end) = match_decimal(self.d, self.i) else {
            return false;
        };
        if end == self.i {
            return false;
        }
        let text = std::str::from_utf8(&self.d[self.i..end]).unwrap_or("");
        let v: f64 = text.parse().unwrap_or(f64::NAN);
        if v.is_nan() || v.abs() > limits::NUMBER_LIMIT {
            return false;
        }
        self.i = end;
        true
    }

    fn is_command(&self) -> bool {
        self.i < self.d.len() && COMMANDS.contains(&self.d[self.i])
    }

    fn valid(&mut self) -> bool {
        self.space();
        if self.i >= self.d.len() || (self.d[self.i] != b'M' && self.d[self.i] != b'm') {
            return false;
        }
        while self.i < self.d.len() {
            let c = self.d[self.i].to_ascii_uppercase();
            let Some(count) = (if self.d[self.i] < 128 {
                arguments(c)
            } else {
                None
            }) else {
                return false;
            };
            self.i += 1;
            self.space();
            // A command can repeat its arguments with no letter, except for Z, which has none.
            let mut first = true;
            while count > 0 && (first || (self.i < self.d.len() && !self.is_command())) {
                first = false;
                for arg in 0..count {
                    if c == b'A' && (arg == 3 || arg == 4) {
                        if self.i >= self.d.len()
                            || (self.d[self.i] != b'0' && self.d[self.i] != b'1')
                        {
                            return false;
                        }
                        self.i += 1;
                    } else if !self.number() {
                        return false;
                    }
                    if arg < count - 1 {
                        self.separator();
                    }
                }
                if self.separator() && (self.i >= self.d.len() || self.is_command()) {
                    return false;
                }
            }
            self.space();
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_lists() {
        assert_eq!(list("0 0, 10 5"), Some(vec![0.0, 0.0, 10.0, 5.0]));
        assert_eq!(list(" 1,2 "), Some(vec![1.0, 2.0]));
        assert_eq!(list("1,,2"), None);
        assert_eq!(list(",1"), None);
        assert_eq!(list("1,"), None);
        assert_eq!(list("1e400"), None);
        assert_eq!(list("1e-400"), None);
        assert_eq!(list("0e-400"), Some(vec![0.0]));
    }

    #[test]
    fn checks_path_data() {
        assert!(valid_path("M0 0L10 10Z"));
        assert!(valid_path("M0,0 10,10 20 20z"));
        assert!(valid_path("M0 0A5 5 0 1 0 10 0"));
        assert!(valid_path("M0 0A5 5 0 1010 0"));
        assert!(!valid_path("L0 0"));
        assert!(!valid_path("M0 0L"));
        assert!(!valid_path("M0 0,"));
        assert!(!valid_path("M0 0 X"));
        assert!(!valid_path("M1e13 0"));
        assert!(valid_path("M0 0L1e-20 1"));
    }
}
