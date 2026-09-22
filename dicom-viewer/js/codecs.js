/* ==========================================================================
   CT Console — pixel data codecs.

   Scanners and PACS routinely export CT with the pixel data compressed, so a
   viewer that only reads native (uncompressed) DICOM refuses a large share of
   real studies. This module decodes the two lossless schemes that cover most
   CT exports, in plain JavaScript with no dependencies:

     RLE Lossless          (1.2.840.10008.1.2.5)      PS3.5 Annex G
     JPEG Lossless         (1.2.840.10008.1.2.4.57)   ITU T.81 Annex H
     JPEG Lossless SV1     (1.2.840.10008.1.2.4.70)   ditto, predictor 1

   Both are mathematically lossless: the samples that come out are the samples
   the scanner put in, so Hounsfield Units are exact and measurements made on
   a decoded image mean what they say.

   Lossy JPEG, JPEG-LS and JPEG 2000 are deliberately not attempted — see
   describeSyntax() for what the viewer tells the user instead.

   Pure computation over typed arrays, no DOM, so it can be exercised
   headlessly.
   ========================================================================== */
(function (global) {
  "use strict";

  var SYNTAXES = {
    "1.2.840.10008.1.2.5": { codec: "rle", label: "RLE Lossless" },
    "1.2.840.10008.1.2.4.57": { codec: "jpeg-lossless", label: "JPEG Lossless, non-hierarchical (process 14)" },
    "1.2.840.10008.1.2.4.70": { codec: "jpeg-lossless", label: "JPEG Lossless, non-hierarchical, first-order prediction (process 14 SV1)" },
  };

  // Recognised but not decodable here, with the reason spelled out so the
  // viewer can say something more useful than "unsupported".
  var KNOWN_UNSUPPORTED = {
    "1.2.840.10008.1.2.4.50": "JPEG Baseline (lossy, 8-bit)",
    "1.2.840.10008.1.2.4.51": "JPEG Extended (lossy, 12-bit)",
    "1.2.840.10008.1.2.4.80": "JPEG-LS Lossless",
    "1.2.840.10008.1.2.4.81": "JPEG-LS Near-Lossless",
    "1.2.840.10008.1.2.4.90": "JPEG 2000 Lossless",
    "1.2.840.10008.1.2.4.91": "JPEG 2000 (lossy)",
    "1.2.840.10008.1.2.4.92": "JPEG 2000 Part 2 Lossless",
    "1.2.840.10008.1.2.4.93": "JPEG 2000 Part 2",
    "1.2.840.10008.1.2.1.99": "Deflated Explicit VR Little Endian",
    "1.2.840.10008.1.2.4.100": "MPEG2",
    "1.2.840.10008.1.2.4.101": "MPEG2 High Profile",
    "1.2.840.10008.1.2.4.102": "MPEG-4 AVC/H.264",
  };

  function codecFor(transferSyntax) {
    var entry = SYNTAXES[transferSyntax];
    return entry ? entry.codec : null;
  }

  function describeSyntax(transferSyntax) {
    if (SYNTAXES[transferSyntax]) return SYNTAXES[transferSyntax].label;
    return KNOWN_UNSUPPORTED[transferSyntax] || null;
  }

  /* ---------------------------------------------------------------------
   * RLE Lossless — DICOM PS3.5 Annex G
   *
   * The frame opens with a 64-byte header of little-endian uint32s: the
   * segment count, then each segment's offset. A 16-bit grayscale frame is
   * carried as two segments, the high byte plane then the low byte plane, so
   * the bytes of one pixel are nowhere near each other — recombining them is
   * the whole job. Each segment is PackBits.
   * ------------------------------------------------------------------- */

  function decodeRLE(bytes, opts) {
    var rows = opts.rows, cols = opts.columns;
    var samples = opts.samplesPerPixel || 1;
    var bytesPerSample = (opts.bitsAllocated || 16) <= 8 ? 1 : 2;
    var pixels = rows * cols;

    if (bytes.length < 64) throw new Error("RLE frame is too short to hold its header.");
    var header = new DataView(bytes.buffer, bytes.byteOffset, 64);
    var segmentCount = header.getUint32(0, true);
    var expected = samples * bytesPerSample;
    if (segmentCount !== expected) {
      throw new Error(
        "RLE frame declares " + segmentCount + " segments but this image needs " +
        expected + " (" + samples + " sample(s) x " + bytesPerSample + " byte(s))."
      );
    }

    var planes = [];
    for (var s = 0; s < segmentCount; s++) {
      var start = header.getUint32(4 + s * 4, true);
      var end = s + 1 < segmentCount ? header.getUint32(4 + (s + 1) * 4, true) : bytes.length;
      if (!start || start > bytes.length) throw new Error("RLE segment " + s + " starts outside the frame.");
      planes.push(unpackBits(bytes, start, Math.min(end, bytes.length), pixels));
    }

    var out = allocate(opts, pixels * samples);
    for (var c = 0; c < samples; c++) {
      if (bytesPerSample === 1) {
        var p8 = planes[c];
        for (var i = 0; i < pixels; i++) out[i * samples + c] = p8[i];
      } else {
        // Segment order is most significant byte first (PS3.5 G.2).
        var hi = planes[c * 2], lo = planes[c * 2 + 1];
        for (var j = 0; j < pixels; j++) {
          var v = (hi[j] << 8) | lo[j];
          out[j * samples + c] = opts.pixelRepresentation === 1 && v > 0x7FFF ? v - 0x10000 : v;
        }
      }
    }
    return out;
  }

  /** PackBits (PS3.5 G.3.2), bounded by the number of bytes the plane needs. */
  function unpackBits(bytes, start, end, count) {
    var out = new Uint8Array(count);
    var o = 0, p = start;
    while (o < count && p < end) {
      var n = bytes[p++];
      if (n < 128) {
        // Literal run of n + 1 bytes.
        var runLen = n + 1;
        for (var i = 0; i < runLen && o < count && p < end; i++) out[o++] = bytes[p++];
      } else if (n > 128) {
        // Replicate the next byte 257 - n times.
        var repeat = 257 - n;
        if (p >= end) break;
        var value = bytes[p++];
        for (var j = 0; j < repeat && o < count; j++) out[o++] = value;
      }
      // n === 128 is a no-op by definition.
    }
    return out;
  }

  /* ---------------------------------------------------------------------
   * JPEG Lossless — ITU T.81 Annex H (SOF3)
   *
   * Nothing like baseline JPEG: no DCT, no quantisation, no blocks. Each
   * sample is predicted from its already-decoded neighbours and only the
   * prediction error is Huffman-coded, which is why it is exactly lossless.
   * ------------------------------------------------------------------- */

  function BitReader(bytes, pos) {
    this.bytes = bytes;
    this.pos = pos;
    this.buf = 0;
    this.count = 0;
    this.marker = 0;          // set when the entropy stream hits a marker
  }

  BitReader.prototype.bit = function () {
    if (this.count === 0) {
      if (this.marker || this.pos >= this.bytes.length) return 0;
      var b = this.bytes[this.pos++];
      if (b === 0xFF) {
        var next = this.bytes[this.pos];
        if (next === 0x00) {
          this.pos++;                       // stuffed byte, 0xFF is data
        } else {
          this.marker = next;               // a real marker ends the run
          return 0;
        }
      }
      this.buf = b;
      this.count = 8;
    }
    this.count--;
    return (this.buf >> this.count) & 1;
  };

  BitReader.prototype.receive = function (n) {
    var v = 0;
    for (var i = 0; i < n; i++) v = (v << 1) | this.bit();
    return v;
  };

  /** Drop any partial byte and step over a restart marker. */
  BitReader.prototype.restart = function () {
    this.count = 0;
    this.marker = 0;
    while (this.pos < this.bytes.length) {
      if (this.bytes[this.pos] === 0xFF) {
        var m = this.bytes[this.pos + 1];
        if (m >= 0xD0 && m <= 0xD7) { this.pos += 2; return true; }
        if (m === 0x00) { this.pos += 2; continue; }
        return false;
      }
      this.pos++;
    }
    return false;
  };

  /** Canonical Huffman decoding tables, T.81 Annex C / F.2.2.3. */
  function buildHuffman(counts, symbols) {
    var mincode = new Int32Array(17);
    var maxcode = new Int32Array(17);
    var valptr = new Int32Array(17);
    var code = 0, k = 0;
    for (var l = 1; l <= 16; l++) {
      var n = counts[l - 1];
      if (n) {
        valptr[l] = k;
        mincode[l] = code;
        code += n;
        k += n;
        maxcode[l] = code - 1;
      } else {
        maxcode[l] = -1;
      }
      code <<= 1;
    }
    return { mincode: mincode, maxcode: maxcode, valptr: valptr, symbols: symbols };
  }

  function decodeSymbol(br, table) {
    var code = 0;
    for (var l = 1; l <= 16; l++) {
      code = (code << 1) | br.bit();
      if (table.maxcode[l] >= 0 && code <= table.maxcode[l]) {
        return table.symbols[table.valptr[l] + (code - table.mincode[l])];
      }
    }
    throw new Error("Corrupt JPEG: no Huffman code matches after 16 bits.");
  }

  /** T.81 EXTEND: turn `n` raw bits into a signed difference. */
  function extend(v, n) {
    return v < (1 << (n - 1)) ? v - (1 << n) + 1 : v;
  }

  function decodeJPEGLossless(bytes) {
    var tables = {};
    var frame = null;
    var restartInterval = 0;
    var p = 0;

    if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) throw new Error("Not a JPEG stream (no SOI marker).");
    p = 2;

    while (p < bytes.length) {
      if (bytes[p] !== 0xFF) { p++; continue; }
      var marker = bytes[p + 1];
      p += 2;
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
      if (marker === 0xD9) break;                                  // EOI

      var length = (bytes[p] << 8) | bytes[p + 1];
      var segEnd = p + length;

      if (marker === 0xC4) {                                       // DHT
        var q = p + 2;
        while (q < segEnd) {
          var id = bytes[q++];
          var counts = bytes.subarray(q, q + 16);
          q += 16;
          var total = 0;
          for (var i = 0; i < 16; i++) total += counts[i];
          var symbols = bytes.subarray(q, q + total);
          q += total;
          tables[id & 0x0F] = buildHuffman(counts, symbols);
        }
      } else if (marker === 0xC3 || marker === 0xC7 || marker === 0xCB || marker === 0xCF) {
        // SOF3 lossless; the differential/arithmetic variants are rejected below.
        if (marker !== 0xC3) {
          throw new Error("This JPEG uses a lossless variant (SOF" + (marker - 0xC0) +
            ") the viewer does not implement.");
        }
        frame = {
          precision: bytes[p + 2],
          rows: (bytes[p + 3] << 8) | bytes[p + 4],
          cols: (bytes[p + 5] << 8) | bytes[p + 6],
          components: [],
        };
        var nf = bytes[p + 7];
        for (var c = 0; c < nf; c++) {
          var base = p + 8 + c * 3;
          frame.components.push({
            id: bytes[base],
            h: bytes[base + 1] >> 4,
            v: bytes[base + 1] & 0x0F,
          });
        }
      } else if (marker === 0xDD) {                                // DRI
        restartInterval = (bytes[p + 2] << 8) | bytes[p + 3];
      } else if (marker === 0xDA) {                                // SOS
        if (!frame) throw new Error("Corrupt JPEG: scan before frame header.");
        var ns = bytes[p + 2];
        var scan = [];
        for (var s = 0; s < ns; s++) {
          var cs = bytes[p + 3 + s * 2];
          var td = bytes[p + 4 + s * 2] >> 4;
          var comp = null;
          for (var ci = 0; ci < frame.components.length; ci++) {
            if (frame.components[ci].id === cs) comp = frame.components[ci];
          }
          scan.push({ comp: comp || frame.components[s], table: td });
        }
        var afterComps = p + 3 + ns * 2;
        var predictor = bytes[afterComps];
        var pointTransform = bytes[afterComps + 2] & 0x0F;
        return decodeScan(bytes, segEnd, frame, scan, tables, predictor, pointTransform, restartInterval);
      } else if (marker === 0xC8 || (marker >= 0xC9 && marker <= 0xCD)) {
        throw new Error("This JPEG is not lossless (SOF" + (marker - 0xC0) + ").");
      }
      p = segEnd;
    }
    throw new Error("Corrupt JPEG: no scan found.");
  }

  function decodeScan(bytes, start, frame, scan, tables, predictor, pointTransform, restartInterval) {
    var rows = frame.rows, cols = frame.cols;
    var n = scan.length;
    var precision = frame.precision;
    var out = new Int32Array(rows * cols * n);
    var br = new BitReader(bytes, start);
    var defaultPx = 1 << (precision - 1 - pointTransform);
    var sinceRestart = 0;
    var first = true;

    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        if (restartInterval && sinceRestart === restartInterval) {
          br.restart();
          sinceRestart = 0;
          first = true;                       // prediction resets after a restart
        }
        for (var c = 0; c < n; c++) {
          var table = tables[scan[c].table];
          if (!table) throw new Error("Corrupt JPEG: scan references a missing Huffman table.");
          var s = decodeSymbol(br, table);
          var diff;
          if (s === 0) diff = 0;
          else if (s === 16) diff = 32768;    // T.81 Table H.2: fixed, no extra bits
          else diff = extend(br.receive(s), s);

          var px;
          if (first) px = defaultPx;
          else if (y === 0) px = out[(x - 1) * n + c];
          else if (x === 0) px = out[((y - 1) * cols) * n + c];
          else px = predict(out, cols, n, x, y, c, predictor);

          // T.81 H.1.2.1: sums are taken modulo 2**16.
          out[(y * cols + x) * n + c] = (px + diff) & 0xFFFF;
        }
        first = false;
        sinceRestart++;
      }
    }

    if (pointTransform) {
      for (var i = 0; i < out.length; i++) out[i] <<= pointTransform;
    }
    return {
      data: out, width: cols, height: rows,
      precision: precision, components: n,
    };
  }

  function predict(out, cols, n, x, y, c, selector) {
    var ra = out[((y * cols) + x - 1) * n + c];
    var rb = out[(((y - 1) * cols) + x) * n + c];
    var rc = out[(((y - 1) * cols) + x - 1) * n + c];
    switch (selector) {
      case 1: return ra;
      case 2: return rb;
      case 3: return rc;
      case 4: return ra + rb - rc;
      case 5: return ra + ((rb - rc) >> 1);
      case 6: return rb + ((ra - rc) >> 1);
      case 7: return (ra + rb) >> 1;
      default: return ra;
    }
  }

  function allocate(opts, length) {
    if ((opts.bitsAllocated || 16) <= 8) return new Uint8Array(length);
    return opts.pixelRepresentation === 1 ? new Int16Array(length) : new Uint16Array(length);
  }

  /** Decode one compressed frame into the same shape a native frame has. */
  function decodeFrame(transferSyntax, bytes, opts) {
    var codec = codecFor(transferSyntax);
    if (codec === "rle") return decodeRLE(bytes, opts);
    if (codec === "jpeg-lossless") {
      var img = decodeJPEGLossless(bytes);
      if (img.width !== opts.columns || img.height !== opts.rows) {
        throw new Error(
          "JPEG frame is " + img.width + "x" + img.height + " but the dataset says " +
          opts.columns + "x" + opts.rows + "."
        );
      }
      var out = allocate(opts, img.data.length);
      var signed = opts.pixelRepresentation === 1;
      // The codec works modulo 2**16; the dataset decides how to read it.
      var mask = (1 << (opts.bitsStored || img.precision)) - 1;
      var signBit = 1 << ((opts.bitsStored || img.precision) - 1);
      for (var i = 0; i < img.data.length; i++) {
        var v = img.data[i] & mask;
        out[i] = signed && (v & signBit) ? v - (mask + 1) : v;
      }
      return out;
    }
    throw new Error("No decoder for transfer syntax " + transferSyntax + ".");
  }

  global.CTCodecs = {
    SYNTAXES: SYNTAXES,
    KNOWN_UNSUPPORTED: KNOWN_UNSUPPORTED,
    codecFor: codecFor,
    describeSyntax: describeSyntax,
    decodeFrame: decodeFrame,
    decodeRLE: decodeRLE,
    decodeJPEGLossless: decodeJPEGLossless,
    unpackBits: unpackBits,
  };
})(typeof window !== "undefined" ? window : globalThis);
