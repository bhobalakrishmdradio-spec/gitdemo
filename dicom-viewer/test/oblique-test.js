/* Ground-truth checks for oblique reslicing. */
const path = '/home/user/gitdemo/dicom-viewer/js/volume.js';
const g = {};
require('vm').runInNewContext(require('fs').readFileSync(path, 'utf8'), g);
const V = g.CTVolume;

let fails = 0;
function check(name, ok, extra) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (extra ? '   [' + extra + ']' : ''));
  if (!ok) fails++;
}

/* A volume whose value is a distinct linear function of position, so
   trilinear interpolation has an exact closed-form answer. */
function makeVolume(sx, sy, sz) {
  const cols = 32, rows = 24, depth = 20;
  const data = new Int16Array(cols * rows * depth);
  for (let z = 0; z < depth; z++)
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++)
        data[z * cols * rows + y * cols + x] = x + y * 40 + z * 1000;
  return { cols, rows, depth, data, spacingX: sx, spacingY: sy, spacingZ: sz, boneMask: null };
}

function maxDiff(a, b) {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

const vol = makeVolume(1, 1, 1);
const midX = (vol.cols - 1) / 2, midY = (vol.rows - 1) / 2, midZ = (vol.depth - 1) / 2;

console.log('\nA. Identity reduction — oblique must equal orthogonal');

// Axial: u=+X, v=+Y.
for (const k of [0, 7, vol.depth - 1]) {
  const ortho = V.extractPlane(vol, 'axial', k);
  const obl = V.extractOblique(vol, [midX, midY, k], [1, 0, 0], [0, 1, 0],
    { width: vol.cols, height: vol.rows, pixelMm: 1 });
  check('axial slice ' + k, maxDiff(ortho.data, obl.data) < 1e-9,
    'maxdiff=' + maxDiff(ortho.data, obl.data));
}

// Coronal: extractPlane gives width=cols (X), height=depth (Z), row index = z.
for (const k of [0, 11, vol.rows - 1]) {
  const ortho = V.extractPlane(vol, 'coronal', k);
  const obl = V.extractOblique(vol, [midX, k, midZ], [1, 0, 0], [0, 0, 1],
    { width: vol.cols, height: vol.depth, pixelMm: 1 });
  check('coronal slice ' + k, maxDiff(ortho.data, obl.data) < 1e-9,
    'maxdiff=' + maxDiff(ortho.data, obl.data));
}

// Sagittal: width=rows (Y), height=depth (Z).
for (const k of [0, 15, vol.cols - 1]) {
  const ortho = V.extractPlane(vol, 'sagittal', k);
  const obl = V.extractOblique(vol, [k, midY, midZ], [0, 1, 0], [0, 0, 1],
    { width: vol.rows, height: vol.depth, pixelMm: 1 });
  check('sagittal slice ' + k, maxDiff(ortho.data, obl.data) < 1e-9,
    'maxdiff=' + maxDiff(ortho.data, obl.data));
}

console.log('\nB. A 90 degree tilt of the axial frame must land on coronal');
{
  const u = [1, 0, 0];
  const v = V.rotateAbout([0, 1, 0], u, Math.PI / 2);   // +Y -> +Z
  const k = 9;
  const ortho = V.extractPlane(vol, 'coronal', k);
  const obl = V.extractOblique(vol, [midX, k, midZ], u, v,
    { width: vol.cols, height: vol.depth, pixelMm: 1 });
  check('axial frame rotated 90 deg about +X == coronal',
    maxDiff(ortho.data, obl.data) < 1e-9, 'maxdiff=' + maxDiff(ortho.data, obl.data));
}

console.log('\nC. Slab projection matches the orthogonal slab');
for (const mode of ['average', 'mip', 'minip']) {
  const k = 9;
  const ortho = V.extractPlane(vol, 'axial', k, { thicknessMm: 3, mode });
  const obl = V.extractOblique(vol, [midX, midY, k], [1, 0, 0], [0, 1, 0],
    { width: vol.cols, height: vol.rows, pixelMm: 1, thicknessMm: 3, mode });
  check(mode + ' slab (3 mm)', ortho.samples === 3 && obl.samples === 3 &&
    maxDiff(ortho.data, obl.data) < 1e-9,
    'samples ' + ortho.samples + '/' + obl.samples + ' maxdiff=' + maxDiff(ortho.data, obl.data));
}

console.log('\nD. Trilinear sampling is exact on linear data');
{
  // value(x,y,z) = x + 40y + 1000z, so a half-step in each axis is exact.
  const cases = [[5.5, 6, 7, 5.5 + 240 + 7000], [5, 6.5, 7, 5 + 260 + 7000],
                 [5, 6, 7.5, 5 + 240 + 7500], [5.25, 6.75, 7.5, 5.25 + 270 + 7500]];
  let ok = true, worst = 0;
  for (const [x, y, z, want] of cases) {
    const got = V.sampleTrilinear(vol, x, y, z, null);
    worst = Math.max(worst, Math.abs(got - want));
    if (Math.abs(got - want) > 1e-6) ok = false;
  }
  check('interpolated values match the closed form', ok, 'maxdiff=' + worst);
  check('outside the volume returns null',
    V.sampleTrilinear(vol, -0.5, 5, 5, null) === null &&
    V.sampleTrilinear(vol, 5, 5, vol.depth, null) === null);
}

console.log('\nE. Frames stay rigid under repeated rotation');
{
  let f = { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
  const axis = V.normalize([0.3, -0.7, 0.4]);
  for (let i = 0; i < 2000; i++) {
    f = V.orthonormalize({
      u: V.rotateAbout(f.u, axis, 0.017),
      v: V.rotateAbout(f.v, axis, 0.017),
      n: V.rotateAbout(f.n, axis, 0.017),
    });
  }
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const err = Math.max(Math.abs(len(f.u) - 1), Math.abs(len(f.v) - 1), Math.abs(len(f.n) - 1),
    Math.abs(dot(f.u, f.v)), Math.abs(dot(f.u, f.n)), Math.abs(dot(f.v, f.n)));
  check('orthonormal after 2000 rotations', err < 1e-12, 'max deviation=' + err.toExponential(2));
}

console.log('\nF. Rotating out and back is a round trip');
{
  const axis = [0, 0, 1];
  let u = [1, 0, 0], v = [0, 1, 0];
  const before = V.extractOblique(vol, [midX, midY, midZ], u, v, { width: 40, height: 40, pixelMm: 1 });
  u = V.rotateAbout(u, axis, 0.4); v = V.rotateAbout(v, axis, 0.4);
  u = V.rotateAbout(u, axis, -0.4); v = V.rotateAbout(v, axis, -0.4);
  const after = V.extractOblique(vol, [midX, midY, midZ], u, v, { width: 40, height: 40, pixelMm: 1 });
  check('+0.4 rad then -0.4 rad restores the plane', maxDiff(before.data, after.data) < 1e-9,
    'maxdiff=' + maxDiff(before.data, after.data));
}

console.log('\nG. A 45 degree cut hits the values geometry predicts');
{
  // Plane through the centre containing +X, tilted 45 deg between +Y and +Z.
  const u = [1, 0, 0];
  const v = V.normalize([0, 1, 1]);
  const s = V.extractOblique(vol, [midX, midY, midZ], u, v, { width: 9, height: 9, pixelMm: 1 });
  let ok = true, worst = 0;
  for (let j = 0; j < s.height; j++) {
    for (let i = 0; i < s.width; i++) {
      const di = i - s.width / 2 + 0.5, dj = j - s.height / 2 + 0.5;
      const x = midX + di, y = midY + dj * v[1], z = midZ + dj * v[2];
      const want = x + 40 * y + 1000 * z;     // the field is linear, so exact
      const got = s.data[j * s.width + i];
      // The accumulator is a Float32Array, so compare relative to magnitude:
      // float32 only resolves ~1e-3 absolute at these values.
      const rel = Math.abs(got - want) / Math.max(1, Math.abs(want));
      worst = Math.max(worst, rel);
      if (rel > 1e-6) ok = false;
    }
  }
  check('45 deg oblique samples match the analytic field', ok, 'max rel err=' + worst.toExponential(2));
}

console.log('\nH. Anisotropic voxels: oblique honours real spacing');
{
  const av = makeVolume(0.5, 0.5, 2);          // 2 mm slices, 0.5 mm in plane
  const k = 9;
  const ortho = V.extractPlane(av, 'axial', k);
  const obl = V.extractOblique(av, [((av.cols - 1) / 2) * 0.5, ((av.rows - 1) / 2) * 0.5, k * 2],
    [1, 0, 0], [0, 1, 0], { width: av.cols, height: av.rows, pixelMm: 0.5 });
  check('axial reduction with 0.5/0.5/2 mm voxels', maxDiff(ortho.data, obl.data) < 1e-9,
    'maxdiff=' + maxDiff(ortho.data, obl.data));
  check('output pitch is the finest voxel dimension',
    V.extractOblique(av, [0, 0, 0], [1, 0, 0], [0, 1, 0], { width: 8, height: 8 }).pixelMm === 0.5);
}

console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'All checks passed') + '\n');
process.exit(fails ? 1 : 0);
