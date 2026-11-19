# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

require "digest"
require "zlib"

module Vexyl
  # Share links, which hold a whole document in the fragment of a URL, as SDK section 8 defines
  # them: "v1." and the base64url of the document's raw DEFLATE with a preset dictionary. The
  # compression is Ruby's own Zlib.
  module Share
    # The largest document a share link can hold, in bytes of UTF-8. SDK section 8 fixes it.
    MAX_BYTES = 8 * 1024 * 1024

    # The SHA-256 of version 1's dictionary, which SDK section 8 gives.
    DICTIONARY_SHA256 = "92062df2fd010bea13d1aefb30c2cfbb2ad6aee5a60e8f8e2d2455516c1c6b97"

    VERSION = /\Av([0-9]+)\./
    BASE64URL = /\A[A-Za-z0-9_-]*\z/

    module_function

    # The normative preset dictionary of version 1 links, a copy of share/v1.dict.
    def dictionary
      @dictionary ||= begin
        d = DICTIONARY_BASE64.unpack1("m0").freeze
        raise "the share dictionary isn't version 1's" unless Digest::SHA256.hexdigest(d) == DICTIONARY_SHA256
        d
      end
    end

    # Writes a document as the part of a share link after its #, such as "v1.K0utLQ". Its exact
    # bytes are kept, line endings and any byte order mark included. Raises Vexyl::Error if it's
    # over MAX_BYTES in UTF-8.
    def encode(document)
      source = document.b
      if source.bytesize > MAX_BYTES
        raise Error, "a share link can hold up to #{MAX_BYTES} bytes, and this is #{source.bytesize}"
      end
      z = Zlib::Deflate.new(Zlib::BEST_COMPRESSION, -Zlib::MAX_WBITS, Zlib::MAX_MEM_LEVEL)
      begin
        z.set_dictionary(dictionary)
        "v1.#{base64(z.deflate(source, Zlib::FINISH))}"
      ensure
        z.close
      end
    end

    # Reads the part of a share link after its #. Anything untrusted can be in one, so this stops
    # as soon as the output passes MAX_BYTES, and refuses whatever isn't exactly what an encoder
    # writes: another version, base64url that isn't canonical, a corrupt or truncated stream or
    # anything after its end, too much, or what isn't UTF-8. Raises Vexyl::Error for each.
    def decode(link)
      link = link.to_s
      m = VERSION.match(link.b)
      raise Error, "it doesn't start with a version" if m.nil?
      raise Error, "it's version #{m[1]}, and this reads version 1" if m[1] != "1"
      compressed = unbase64(link.b[m.end(0)..])
      out = inflate(compressed)
      out.force_encoding(Encoding::UTF_8)
      raise Error, "what it holds isn't UTF-8" unless out.valid_encoding?
      out
    end

    def inflate(compressed)
      z = Zlib::Inflate.new(-Zlib::MAX_WBITS)
      out = +"".b
      begin
        z.set_dictionary(dictionary)
        take = lambda do |chunk|
          out << chunk
          raise Error, "what it holds is over the limit of #{MAX_BYTES} bytes" if out.bytesize > MAX_BYTES
        end
        out << z.inflate(compressed, &take).to_s
        # Zlib can hold the last of its output until it's told the input has ended, which it
        # then gives in chunks as before, or refuses if the stream ends early.
        out << z.inflate(nil, &take).to_s unless z.finished?
        raise Error, "its compressed data is corrupt: it ends early" unless z.finished?
        if z.total_in != compressed.bytesize
          raise Error, "its compressed data is corrupt: there's more after its end"
        end
      rescue Zlib::NeedDict
        raise Error, "its compressed data is corrupt"
      rescue Zlib::BufError
        raise Error, "its compressed data is corrupt: it ends early"
      rescue Zlib::Error => e
        raise Error, "its compressed data is corrupt: #{e.message}"
      ensure
        # A stream that's refused is closed before its end, which Zlib would warn about.
        verbose = $VERBOSE
        $VERBOSE = nil
        z.close
        $VERBOSE = verbose
      end
      raise Error, "what it holds is over the limit of #{MAX_BYTES} bytes" if out.bytesize > MAX_BYTES
      out
    end

    def base64(data)
      [data].pack("m0").tr("+/", "-_").delete("=")
    end

    # Reads base64url with no padding, refusing anything an encoder wouldn't have written.
    def unbase64(body)
      raise Error, "it has a character that isn't in base64url" unless BASE64URL.match?(body)
      raise Error, "its base64url isn't in canonical form" if body.bytesize % 4 == 1
      padded = body.tr("-_", "+/") + ("=" * ((4 - (body.bytesize % 4)) % 4))
      begin
        data = padded.unpack1("m0")
      rescue ArgumentError
        raise Error, "its base64url isn't in canonical form"
      end
      # A decoder can ignore stray bits in the last character, so a canonical body is the one
      # that encodes back to itself.
      raise Error, "its base64url isn't in canonical form" unless base64(data) == body
      data
    end
  end
end
