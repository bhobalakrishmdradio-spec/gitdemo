/* MR has no Hounsfield scale; the viewer must not pretend otherwise. */
const { chromium } = require('playwright');
const UI = require('./ui');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || require('path').join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };
const near = (a, b, t) => Math.abs(a - b) <= t;

const load = async (page, dir) => {
  const files = fs.readdirSync(path.join(SP, dir)).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, dir, f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
  await load(page, 'series-mr');

  console.log('\n1. An MR study loads and reconstructs');
  const vol = await page.evaluate(() => {
    const v = window.__ctConsole.state.volume;
    const g = window.__ctConsole.state.seriesMap[window.__ctConsole.state.currentSeriesUID];
    return { dims: [v.cols, v.rows, v.depth], spacing: [v.spacingX, v.spacingY, v.spacingZ],
             range: [v.minHU, v.maxHU], modality: g.slices[0].instance.modality,
             desc: g.description };
  });
  check('volume built with the right geometry',
    JSON.stringify(vol.dims) === JSON.stringify([96, 96, 20]) &&
    near(vol.spacing[0], 1.2, 1e-6) && near(vol.spacing[2], 4, 1e-6),
    vol.dims.join('×') + ' at ' + vol.spacing.join('/') + ' mm');
  check('recognised as MR', vol.modality === 'MR', vol.modality + ' — ' + vol.desc);
  check('signal range preserved, not rescaled to HU',
    vol.range[0] === 0 && near(vol.range[1], 1873, 30), vol.range.join(' .. '));

  console.log('\n2. Intensities are NOT labelled HU');
  const box = await page.evaluate(() => {
    const C = window.__ctConsole; const g = C.cellGeom(0);
    const c = C.planeToCanvas(g.t, 48.5, 48.5);
    const cv = C.cellEl(0).querySelector('.vp-canvas'); const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: r.x + c.x / dpr, y: r.y + c.y / dpr };
  });
  await page.mouse.move(box.x, box.y); await page.waitForTimeout(300);
  const readout = await page.textContent('#huReadout');
  check('the readout shows a value without claiming HU',
    !/HU/.test(readout) && /\d/.test(readout), readout);
  check('and says it is a stored value', /stored value/.test(readout), readout);
  // Draw it with the real tool, so the list renders the way it does in use.
  const atPixel = (px, py) => page.evaluate(([px, py]) => {
    const C = window.__ctConsole; const g = C.cellGeom(0);
    const c = C.planeToCanvas(g.t, px, py);
    const cv = C.cellEl(0).querySelector('.vp-canvas'); const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: r.x + c.x / dpr, y: r.y + c.y / dpr };
  }, [px, py]);
  await UI.pickTool(page, 'ellipse');
  const e0 = await atPixel(44, 44), e1 = await atPixel(52, 52);
  await page.mouse.click(e0.x, e0.y); await page.waitForTimeout(150);
  await page.mouse.click(e1.x, e1.y); await page.waitForTimeout(400);
  await UI.pickTool(page, 'none');
  const roi = await page.evaluate(() => {
    const C = window.__ctConsole, M = window.CTMeasure;
    const s = C.getPlaneData('axial', C.state.index.axial);
    const m = C.state.measurements[C.state.measurements.length - 1];
    return { res: M.evaluate(m, s, M.calibrationOf(s, 'PixelSpacing')) };
  });
  const listText = (await page.textContent('#measureList')).replace(/\s+/g, ' ').trim();
  check('an ROI reports statistics without an HU label',
    /\d/.test(listText) && !/No measurements/.test(listText) && !/HU/.test(listText),
    listText.slice(0, 80));
  check('ROI mean lands on the bright focus', near(roi.res.raw.mean, 1800, 60),
    roi.res.primary);

  console.log('\n3. Window presets are the ones that make sense for MR');
  const presets = await page.evaluate(() => [...document.querySelectorAll('#windowPresets [data-window]')].map(b => b.dataset.window));
  check('no CT window presets offered',
    !presets.includes('lung') && !presets.includes('bone'), presets.join(','));
  check('header / auto / full offered instead',
    presets.includes('header') && presets.includes('auto') && presets.includes('full'),
    presets.join(','));
  await UI.pickWindow(page, 'header');
  const wl = await page.evaluate(() => [window.__ctConsole.state.windowWidth,
    window.__ctConsole.state.windowCenter]);
  check('"From header" uses the scanner\'s W/L (1400/700)',
    wl[0] === 1400 && wl[1] === 700, wl.join('/'));
  await UI.pickWindow(page, 'auto');
  const wlAuto = await page.evaluate(() => [window.__ctConsole.state.windowWidth,
    window.__ctConsole.state.windowCenter]);
  check('"Auto contrast" derives a sane window from the data',
    wlAuto[0] > 10 && wlAuto[0] < 2500, wlAuto.map(Math.round).join('/'));

  console.log('\n4. The HU threshold mask is refused on MR, with a reason');
  check('the toggle is disabled', await page.isDisabled('#boneCutToggle'));
  check('and says why', /Hounsfield/.test(await page.textContent('#boneCutStatus')),
    await page.textContent('#boneCutStatus'));

  console.log('\n5. 3D uses MR presets over the volume\'s own range');
  const vrOpts = await page.evaluate(() => Array.from(
    document.getElementById('vrPreset').options).map(o => o.value));
  check('MR transfer functions offered, not the HU ones',
    vrOpts.includes('mrIntensity') && !vrOpts.includes('bone'), vrOpts.join(','));
  await UI.pickLayout(page, 'quad');
  const lit = await page.evaluate(() => {
    const C = window.__ctConsole;
    const i = C.state.cells.findIndex(c => c.plane === 'vr');
    if (i < 0) return -1;
    const cv = C.cellEl(i).querySelector('.vp-canvas');
    const gl = cv.getContext('webgl2'); if (!gl) return -2;
    const px = new Uint8Array(cv.width * cv.height * 4);
    gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0; for (let k = 0; k < px.length; k += 4) if (px[k] > 12) n++;
    return n;
  });
  check('the MR volume actually renders in 3D', lit > 300, String(lit));

  console.log('\n6. MPR, layouts and oblique all work on MR');
  const mpr = await page.evaluate(() => {
    const C = window.__ctConsole;
    const out = {};
    ['axial', 'coronal', 'sagittal'].forEach(p => {
      const s = C.getPlaneData(p, Math.floor(C.state.index[p]));
      let sum = 0; for (let i = 0; i < s.data.length; i++) sum += s.data[i];
      out[p] = { w: s.width, h: s.height, mean: +(sum / s.data.length).toFixed(1) };
    });
    return out;
  });
  check('all three planes reslice', mpr.axial.w === 96 && mpr.coronal.h === 20 && mpr.sagittal.h === 20,
    JSON.stringify(mpr));
  await UI.pickFill(page, 'sagittal');
  check('a grid can be filled with sagittal MR',
    (await page.evaluate(() => window.__ctConsole.state.cells.map(c => c.plane)))
      .every(p => p === 'sagittal'));
  await page.evaluate(() => { window.__ctConsole.rotateOblique('sagittal', -0.4);
    window.__ctConsole.renderAll(); });
  await page.waitForTimeout(600);
  check('oblique reslicing works on MR',
    (await page.evaluate(() => window.__ctConsole.tiltOf('axial'))) > 20);

  console.log('\n7. Switching back to CT restores the CT controls');
  await page.evaluate(() => window.__ctConsole.resetOblique());
  await load(page, 'series-raw');
  await page.waitForTimeout(1200);
  const nowCT = await page.evaluate(() => {
    const C = window.__ctConsole;
    const g = C.state.seriesMap[C.state.currentSeriesUID];
    return g ? g.slices[0].instance.modality : null;
  });
  check('loading a second study switches to it', nowCT === 'CT', String(nowCT));
  const back = await page.evaluate(() => ({
    presets: [...document.querySelectorAll('#windowPresets [data-window]')].map(b => b.dataset.window),
    vr: Array.from(document.getElementById('vrPreset').options).map(o => o.value),
    boneDisabled: document.getElementById('boneCutToggle').disabled,
  }));
  check('CT window presets are back', back.presets.includes('lung') && back.presets.includes('bone'),
    back.presets.join(','));
  check('CT VRT presets are back', back.vr.includes('bone') && back.vr.includes('angio') &&
    back.vr.includes('muscle'), back.vr.join(','));
  check('the threshold mask is enabled again', back.boneDisabled === false);

  console.log('\n8. No page errors');
  check('clean console', errors.length === 0, errors.slice(0, 4).join(' ;; ') || 'none');

  await browser.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'All MR checks passed') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
