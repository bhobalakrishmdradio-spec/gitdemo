/* Decode fixtures the Python side already validated, and demand an exact match. */
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || require('path').join(__dirname, 'fixtures');
const FIX = path.join(SP, 'codec');
const g = {};
require('vm').runInNewContext(fs.readFileSync('/home/user/gitdemo/dicom-viewer/js/codecs.js', 'utf8'), g);
const C = g.CTCodecs;

let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };

const manifest = JSON.parse(fs.readFileSync(path.join(FIX, 'manifest.json'), 'utf8'));
const SYNTAX = { rle: '1.2.840.10008.1.2.5', 'jpeg-lossless': '1.2.840.10008.1.2.4.70' };

console.log('\n1. Lossless means lossless — every sample must match exactly');
for (const f of manifest) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(FIX, f.file)));
  const rawBuf = fs.readFileSync(path.join(FIX, f.raw));
  const expected = f.bitsAllocated <= 8
    ? new Uint8Array(rawBuf.buffer, rawBuf.byteOffset, rawBuf.length)
    : (f.pixelRepresentation === 1
        ? new Int16Array(rawBuf.buffer, rawBuf.byteOffset, rawBuf.length / 2)
        : new Uint16Array(rawBuf.buffer, rawBuf.byteOffset, rawBuf.length / 2));
  let out, err = null;
  try {
    out = C.decodeFrame(SYNTAX[f.codec], bytes, {
      rows: f.rows, columns: f.cols, samplesPerPixel: 1,
      bitsAllocated: f.bitsAllocated, bitsStored: f.bitsStored,
      pixelRepresentation: f.pixelRepresentation,
    });
  } catch (e) { err = e.message; }
  if (err) { check(`${f.codec} ${f.name}`, false, err); continue; }
  let bad = -1, count = 0;
  for (let i = 0; i < expected.length; i++) {
    if (out[i] !== expected[i]) { count++; if (bad < 0) bad = i; }
  }
  check(`${f.codec.padEnd(13)} ${f.name.padEnd(10)} ${f.rows}x${f.cols} ${f.bitsStored}-bit` +
    (f.pixelRepresentation ? ' signed' : ''),
    out.length === expected.length && count === 0,
    count ? `${count} of ${expected.length} wrong, first at ${bad}: got ${out[bad]} want ${expected[bad]}`
          : `${expected.length} samples exact`);
}

console.log('\n2. PackBits edge cases (PS3.5 G.3.2)');
{
  // literal run, replicate run, and the 128 no-op, hand-built.
  const seg = Uint8Array.from([2, 10, 20, 30,        // literal: 3 bytes
                               254, 99,              // replicate 99 three times
                               128,                  // no-op
                               0, 42]);              // literal: 1 byte
  const out = C.unpackBits(seg, 0, seg.length, 7);
  check('literal / replicate / no-op decode in order',
    Array.from(out).join(',') === '10,20,30,99,99,99,42', Array.from(out).join(','));
  const truncated = C.unpackBits(Uint8Array.from([5, 1, 2]), 0, 3, 6);
  check('a truncated run stops instead of running off the end',
    truncated.length === 6 && truncated[0] === 1 && truncated[1] === 2, Array.from(truncated).join(','));
}

console.log('\n3. Corrupt input is reported, not silently wrong');
const bad = [
  ['empty RLE header', () => C.decodeRLE(new Uint8Array(10), { rows: 4, columns: 4, bitsAllocated: 16 })],
  ['wrong RLE segment count', () => {
    const b = new Uint8Array(200); new DataView(b.buffer).setUint32(0, 7, true);
    return C.decodeRLE(b, { rows: 4, columns: 4, bitsAllocated: 16, samplesPerPixel: 1 });
  }],
  ['not a JPEG', () => C.decodeJPEGLossless(Uint8Array.from([1, 2, 3, 4]))],
  ['JPEG with no scan', () => C.decodeJPEGLossless(Uint8Array.from([0xFF, 0xD8, 0xFF, 0xD9]))],
];
for (const [name, fn] of bad) {
  let threw = null;
  try { fn(); } catch (e) { threw = e.message; }
  check(name + ' throws', !!threw, threw ? threw.slice(0, 70) : 'no error raised');
}

console.log('\n4. Transfer-syntax routing');
check('RLE syntax maps to the RLE codec', C.codecFor('1.2.840.10008.1.2.5') === 'rle');
check('both JPEG lossless syntaxes map to the JPEG codec',
  C.codecFor('1.2.840.10008.1.2.4.57') === 'jpeg-lossless' &&
  C.codecFor('1.2.840.10008.1.2.4.70') === 'jpeg-lossless');
check('uncompressed syntaxes are not claimed', C.codecFor('1.2.840.10008.1.2.1') === null);
check('JPEG 2000 is named but not claimed',
  C.codecFor('1.2.840.10008.1.2.4.90') === null &&
  /JPEG 2000/.test(C.describeSyntax('1.2.840.10008.1.2.4.90')),
  C.describeSyntax('1.2.840.10008.1.2.4.90'));
check('an unknown syntax describes as null', C.describeSyntax('1.2.3.4.5') === null);

console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'All codec checks passed') + '\n');
process.exit(fails ? 1 : 0);
