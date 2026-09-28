"""A minimal JPEG Lossless (ITU T.81 Annex H, SOF3) encoder.

Only used to manufacture test fixtures. It is validated by decoding its own
output with pylibjpeg-libjpeg — an independent C implementation — so a
fixture is only trusted once a third party agrees on its pixels.
"""
import numpy as np

class BitWriter:
    def __init__(self):
        self.out = bytearray(); self.acc = 0; self.n = 0
    def bit(self, b):
        self.acc = (self.acc << 1) | (b & 1); self.n += 1
        if self.n == 8:
            self.out.append(self.acc)
            if self.acc == 0xFF:
                self.out.append(0x00)          # byte stuffing
            self.acc = 0; self.n = 0
    def bits(self, value, nbits):
        for i in range(nbits - 1, -1, -1):
            self.bit((value >> i) & 1)
    def flush(self):
        while self.n:
            self.bit(1)                        # pad with 1s


def canonical(lengths):
    """JPEG canonical codes from a {symbol: bitlength} map."""
    codes, code, prev = {}, 0, 0
    for sym in sorted(lengths, key=lambda s: (lengths[s], s)):
        ln = lengths[sym]
        code <<= (ln - prev) if prev else 0
        if prev and ln == prev:
            pass
        codes[sym] = code
        code += 1
        prev = ln
    return codes


def build_table(lengths):
    """Return (BITS[16], HUFFVAL, {sym: (code, len)})."""
    bits = [0] * 17
    for sym, ln in lengths.items():
        bits[ln] += 1
    huffval = [s for s in sorted(lengths, key=lambda s: (lengths[s], s))]
    # Canonical code assignment, exactly as T.81 Annex C describes it.
    codes, code, k = {}, 0, 0
    for ln in range(1, 17):
        for _ in range(bits[ln]):
            codes[huffval[k]] = (code, ln); code += 1; k += 1
        code <<= 1
    return bits[1:], huffval, codes


def category(diff):
    if diff == 0:
        return 0
    a = abs(diff)
    return a.bit_length()


def encode(arr, precision, predictor=1):
    """arr: 2-D uint array of `precision`-bit samples. Returns JPEG bytes."""
    rows, cols = arr.shape
    a = arr.astype(np.int64)

    # Lengths chosen by hand: short codes for the small categories that
    # dominate a smooth image, long ones for the rare large jumps. Kraft sum
    # stays under 1 so the all-ones code is never emitted.
    lengths = {0: 2, 1: 2, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8,
               9: 9, 10: 10, 11: 11, 12: 12, 13: 13, 14: 14, 15: 15, 16: 16}
    bits, huffval, codes = build_table(lengths)

    w = BitWriter()
    for y in range(rows):
        for x in range(cols):
            if y == 0 and x == 0:
                px = 1 << (precision - 1)
            elif y == 0:
                px = a[0, x - 1]                      # Ra
            elif x == 0:
                px = a[y - 1, 0]                      # Rb
            else:
                px = a[y, x - 1] if predictor == 1 else a[y - 1, x]
            diff = int(a[y, x] - px)
            # T.81 H.1.2.1: the difference is taken modulo 2**16, whatever the
            # sample precision. Wrapping at 2**precision instead corrupts every
            # sample whose difference exceeds half the range.
            diff = ((diff + 32768) & 0xFFFF) - 32768
            s = category(diff)
            code, ln = codes[s]
            w.bits(code, ln)
            if s:
                v = diff if diff > 0 else diff + (1 << s) - 1
                w.bits(v, s)
    w.flush()

    out = bytearray()
    out += b"\xFF\xD8"                                        # SOI
    # DHT: class 0, table 0
    dht = bytes([0x00]) + bytes(bits) + bytes(huffval)
    out += b"\xFF\xC4" + (len(dht) + 2).to_bytes(2, "big") + dht
    # SOF3: lossless, non-hierarchical, Huffman
    sof = bytes([precision]) + rows.to_bytes(2, "big") + cols.to_bytes(2, "big") + \
        bytes([1, 1, 0x11, 0])
    out += b"\xFF\xC3" + (len(sof) + 2).to_bytes(2, "big") + sof
    # SOS: Ss = predictor selector, Se = 0, Ah/Al = 0 (no point transform)
    sos = bytes([1, 1, 0x00, predictor, 0, 0])
    out += b"\xFF\xDA" + (len(sos) + 2).to_bytes(2, "big") + sos
    out += w.out
    out += b"\xFF\xD9"                                        # EOI
    return bytes(out)
