/* Cropping the 3D volume.

   Three pairs of handles cut the volume from either side along each of its
   axes. The thing worth proving is not that the sliders move but that the
   render loses voxels — and specifically that *which* half is kept matters.
   A crop implemented as a symmetric shrink (the easy mistake, because the
   ray/box test the renderer already had took half-extents rather than two
   corners) would give the same picture for "keep the left fifth" and "keep
   the right fifth". The phantom has a bone slab down one side only, so the
   two are unmistakable if the crop is genuinely one-sided.

   Pixels are counted off the real WebGL canvas, not inferred from state. */
const { chromium } = require('playwright');
const UI = require('./ui');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || path.join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };

/* How many pixels the 3D pane actually paints. */
async function litPixels(page) {
  return page.evaluate(async () => {
    window.__ctConsole.renderVR();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const gl = window.__ctConsole.vrCanvas();
    const c = document.createElement('canvas');
    c.width = gl.width; c.height = gl.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(gl, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 16) n++;
    return n;
  });
}

/* Move one handle through the slider the reader would drag. */
async function drag(page, axis, which, pct) {
  await page.evaluate(([a, w, v]) => {
    const el = document.querySelector(`input.crop-${w}[data-axis="${a}"]`);
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [axis, which, pct]);
  await page.waitForTimeout(150);
}

async function cropState(page) {
  return page.evaluate(() => ({
    lo: window.__ctConsole.state.vrCropLo.slice(),
    hi: window.__ctConsole.state.vrCropHi.slice(),
    text: document.getElementById('vrCropState').textContent,
    resetDisabled: document.getElementById('vrCropReset').disabled,
    readouts: [0, 1, 2].map(a => document.getElementById('vrCropValue' + a).textContent),
    names: [0, 1, 2].map(a => document.getElementById('vrCropName' + a).textContent),
  }));
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
  const files = fs.readdirSync(path.join(SP, 'phantom')).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, 'phantom', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await UI.pickLayout(page, 'vr');
  await page.waitForTimeout(1500);

  /* =================================================================== */
  console.log('\n1. The sliders are named by the cut they make');
  const labels = await page.evaluate(() => window.__ctConsole.cropAxisLabels());
  check('the phantom is a plain axial CT, so the three axes are named',
    labels.map(l => l.name).join('/') === 'Sagittal/Coronal/Axial',
    labels.map(l => l.name).join('/'));
  check('none of them is flagged as oblique',
    labels.every(l => !l.oblique));
  const s0 = await cropState(page);
  check('and the panel shows those names', s0.names.join('/') === 'Sagittal/Coronal/Axial',
    s0.names.join('/'));
  check('nothing is cropped to start with',
    s0.text === 'whole volume' && s0.resetDisabled &&
    s0.readouts.every(t => t === '0–100%'), s0.text + ' ' + s0.readouts.join(' '));

  /* =================================================================== */
  console.log('\n2. Cropping removes voxels from the render');
  const whole = await litPixels(page);
  check('the uncropped volume paints something', whole > 2000, 'lit=' + whole);

  await drag(page, 2, 'hi', 50);                    // keep the lower half, axially
  const halfAxial = await litPixels(page);
  check('keeping half the slices paints noticeably less',
    halfAxial < whole * 0.85 && halfAxial > 0,
    'whole=' + whole + ' half=' + halfAxial);

  await page.click('#vrCropReset');
  await page.waitForTimeout(200);
  const back = await litPixels(page);
  check('resetting the crop brings the whole volume back',
    Math.abs(back - whole) < Math.max(200, whole * 0.02),
    'whole=' + whole + ' back=' + back);

  /* =================================================================== */
  console.log('\n3. Which side is kept matters — the crop is not a symmetric shrink');
  // The phantom carries a 900 HU bone slab down its low-x edge only, and the
  // default preset is Bone VRT, so the two outer fifths look nothing alike.
  await page.evaluate(() => window.__ctConsole.resetCrop());
  await drag(page, 0, 'hi', 20);                    // keep the low fifth in x
  const lowSide = await litPixels(page);
  await page.evaluate(() => window.__ctConsole.resetCrop());
  await drag(page, 0, 'lo', 80);                    // keep the high fifth in x
  const highSide = await litPixels(page);
  check('the two opposite fifths paint different amounts',
    Math.abs(lowSide - highSide) > Math.max(300, 0.2 * Math.max(lowSide, highSide)),
    'low=' + lowSide + ' high=' + highSide);
  check('the side holding the bone slab is the brighter one',
    lowSide > highSide, 'low=' + lowSide + ' high=' + highSide);
  check('both are less than the whole volume',
    lowSide < whole && highSide < whole,
    'low=' + lowSide + ' high=' + highSide + ' whole=' + whole);

  // Under Bone VRT the far fifth is empty, which on its own would also be
  // what a crop that simply addressed the wrong end of the axis produced.
  // Soft tissue reaches both edges of the phantom, so both fifths must
  // paint — and still differ, because only one holds the bone slab.
  await page.selectOption('#vrPreset', 'soft');
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__ctConsole.resetCrop());
  await drag(page, 0, 'hi', 20);
  const softLow = await litPixels(page);
  await page.evaluate(() => window.__ctConsole.resetCrop());
  await drag(page, 0, 'lo', 80);
  const softHigh = await litPixels(page);
  await page.evaluate(() => window.__ctConsole.resetCrop());
  await drag(page, 0, 'lo', 40);
  await drag(page, 0, 'hi', 60);
  const softMid = await litPixels(page);
  check('with soft tissue shown, every fifth of the axis paints something',
    softLow > 0 && softHigh > 0 && softMid > 0,
    'low=' + softLow + ' mid=' + softMid + ' high=' + softHigh);
  check('and they are three different pictures, not one shrunk box',
    softLow !== softHigh && softMid !== softLow && softMid !== softHigh,
    'low=' + softLow + ' mid=' + softMid + ' high=' + softHigh);
  await page.selectOption('#vrPreset', 'bone');
  await page.waitForTimeout(250);

  /* =================================================================== */
  console.log('\n4. The handles cannot cross or collapse an axis');
  await page.evaluate(() => window.__ctConsole.resetCrop());
  await drag(page, 1, 'lo', 70);
  await drag(page, 1, 'hi', 30);                    // pull the top below the bottom
  const crossed = await cropState(page);
  check('the low handle gave way rather than inverting the box',
    crossed.lo[1] < crossed.hi[1], JSON.stringify([crossed.lo[1], crossed.hi[1]]));
  check('a sliver is left to render, not nothing',
    crossed.hi[1] - crossed.lo[1] >= 0.0099,
    (crossed.hi[1] - crossed.lo[1]).toFixed(3));
  const sliver = await litPixels(page);
  check('that sliver still paints something rather than a blank pane', sliver > 0,
    'lit=' + sliver);
  check('the readout follows the handles', crossed.readouts[1] === '29–30%' ||
    crossed.readouts[1] === '30–31%', crossed.readouts[1]);
  check('the panel says it is cropped, and offers the way back',
    crossed.text === 'cropped' && !crossed.resetDisabled,
    crossed.text + ' resetDisabled=' + crossed.resetDisabled);

  /* =================================================================== */
  console.log('\n5. The sliders answer a real cursor, not only a scripted event');
  await page.evaluate(() => window.__ctConsole.resetCrop());
  await page.waitForTimeout(150);
  const box = await page.locator('#vrCropHi2').boundingBox();
  check('the axial "to" handle is on screen and has room to drag', !!box && box.width > 40,
    box ? Math.round(box.width) + '×' + Math.round(box.height) : 'not laid out');
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height / 2);
  await page.waitForTimeout(250);
  const byMouse = await cropState(page);
  check('clicking a third of the way along it cropped that axis',
    byMouse.hi[2] < 0.6 && byMouse.hi[2] > 0.15 && byMouse.text === 'cropped',
    byMouse.readouts[2] + ' ' + byMouse.text);
  check('and only that axis moved',
    byMouse.lo.every(v => v === 0) && byMouse.hi[0] === 1 && byMouse.hi[1] === 1,
    JSON.stringify(byMouse.hi));
  const byMouseLit = await litPixels(page);
  check('the render followed the cursor', byMouseLit < whole && byMouseLit > 0,
    'whole=' + whole + ' now=' + byMouseLit);

  /* =================================================================== */
  console.log('\n6. Reset 3D crop, from the Reset menu');
  await UI.pickReset(page, 'crop');
  const afterMenu = await cropState(page);
  check('the menu item clears the crop',
    afterMenu.text === 'whole volume' && afterMenu.lo.every(v => v === 0) &&
    afterMenu.hi.every(v => v === 1), JSON.stringify(afterMenu.lo) + JSON.stringify(afterMenu.hi));
  const afterMenuLit = await litPixels(page);
  check('and the render is whole again',
    Math.abs(afterMenuLit - whole) < Math.max(200, whole * 0.02),
    'whole=' + whole + ' now=' + afterMenuLit);

  await drag(page, 2, 'lo', 40);
  await UI.pickReset(page, 'all');
  check('"Reset everything" takes the crop with it',
    (await page.evaluate(() => window.__ctConsole.cropIsActive())) === false);

  /* =================================================================== */
  console.log('\n7. Cropping hides voxels; it does not alter the image data');
  const sigBefore = await page.evaluate(() => {
    const p = window.__ctConsole.getPlaneData('axial', 40);
    let h = 0;
    for (let i = 0; i < p.data.length; i += 7) h = (h * 31 + p.data[i]) | 0;
    return { h: h, n: p.data.length };
  });
  await drag(page, 0, 'lo', 30);
  await drag(page, 2, 'hi', 60);
  await litPixels(page);
  const sigAfter = await page.evaluate(() => {
    const p = window.__ctConsole.getPlaneData('axial', 40);
    let h = 0;
    for (let i = 0; i < p.data.length; i += 7) h = (h * 31 + p.data[i]) | 0;
    return { h: h, n: p.data.length };
  });
  check('the axial plane is byte-for-byte what it was before the crop',
    sigBefore.h === sigAfter.h && sigBefore.n === sigAfter.n,
    sigBefore.h + ' vs ' + sigAfter.h);
  const vol = await page.evaluate(() => ({
    cols: window.__ctConsole.state.volume.cols,
    rows: window.__ctConsole.state.volume.rows,
    depth: window.__ctConsole.state.volume.depth,
  }));
  check('and the volume still has all its slices',
    vol.cols === 128 && vol.rows === 128 && vol.depth === 96, JSON.stringify(vol));

  /* =================================================================== */
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed.');
  process.exit(fails ? 1 : 0);
})();
