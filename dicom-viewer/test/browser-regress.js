/* Regression: the orthogonal workstation must behave exactly as before. */
const { chromium } = require('playwright');
const UI = require('./ui');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || require('path').join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
  const files = fs.readdirSync(path.join(SP, 'phantom')).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, 'phantom', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume, null, { timeout: 60000 });
  await page.waitForTimeout(1000);

  console.log('\n1. Orientation letters (rewritten to work off the frames)');
  const labels = await page.evaluate(() => ({
    axial: window.__ctConsole.orientationLabels('axial'),
    coronal: window.__ctConsole.orientationLabels('coronal'),
    sagittal: window.__ctConsole.orientationLabels('sagittal'),
  }));
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check('axial R/L/A/P', eq(labels.axial, { left: 'R', right: 'L', top: 'A', bottom: 'P' }),
    JSON.stringify(labels.axial));
  check('coronal R/L/H/F', eq(labels.coronal, { left: 'R', right: 'L', top: 'H', bottom: 'F' }),
    JSON.stringify(labels.coronal));
  check('sagittal A/P/H/F', eq(labels.sagittal, { left: 'A', right: 'P', top: 'H', bottom: 'F' }),
    JSON.stringify(labels.sagittal));

  console.log('\n2. Crosshair click still drives the companion planes');
  const before = await page.evaluate(() => Object.assign({}, window.__ctConsole.state.index));
  const box = await page.evaluate(() => { const r = window.__ctConsole.cellEl(0).querySelector('.vp-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.35);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => Object.assign({}, window.__ctConsole.state.index));
  check('axial index unchanged by an in-plane click', after.axial === before.axial,
    before.axial + ' -> ' + after.axial);
  check('coronal and sagittal both moved',
    after.coronal !== before.coronal && after.sagittal !== before.sagittal,
    JSON.stringify(before) + ' -> ' + JSON.stringify(after));
  check('the click landed up-and-left (lower coronal and sagittal index)',
    after.coronal < before.coronal && after.sagittal < before.sagittal);

  console.log('\n3. Navigation, layouts and window presets');
  const idx0 = await page.evaluate(() => window.__ctConsole.state.index.axial);
  await page.evaluate(() => window.__ctConsole.cellEl(0).dispatchEvent(
    new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })));
  await page.waitForTimeout(200);
  check('wheel advances the slice',
    (await page.evaluate(() => window.__ctConsole.state.index.axial)) === idx0 + 1);
  await page.keyboard.press('3');
  await page.waitForTimeout(200);
  check('key 3 switches to the MPR layout',
    (await page.evaluate(() => window.__ctConsole.state.layout)) === 'mpr');
  await page.keyboard.press('1');
  await UI.pickWindow(page, 'bone');
  const wl = await page.evaluate(() => [window.__ctConsole.state.windowWidth, window.__ctConsole.state.windowCenter]);
  check('bone preset applies W2000/L480', wl[0] === 2000 && wl[1] === 480, wl.join('/'));
  await page.keyboard.press('i');
  await page.waitForTimeout(150);
  check('I inverts', (await page.evaluate(() => window.__ctConsole.state.invert)) === true);
  await page.keyboard.press('i');

  console.log('\n4. Slab thickness and projection on the orthogonal path');
  await page.evaluate(() => {
    const C = window.__ctConsole;
    C.state.thicknessMm = 10; C.state.projectionMode = 'mip'; C.renderAll();
  });
  await page.waitForTimeout(400);
  const slab = await page.evaluate(() => {
    const s = window.__ctConsole.getPlaneData('axial');
    let max = -1e9; for (let i = 0; i < s.data.length; i++) if (s.data[i] > max) max = s.data[i];
    return { samples: s.samples, max, oblique: !!s.oblique };
  });
  check('10 mm slab over 1 mm slices = 10 samples, still axis-aligned',
    slab.samples === 10 && slab.oblique === false, slab.samples + ' samples');
  check('MIP reaches the 900 HU bone', slab.max > 850, 'max ' + slab.max.toFixed(0));
  await page.evaluate(() => { const C = window.__ctConsole; C.state.thicknessMm = 0;
    C.state.projectionMode = 'average'; C.renderAll(); });

  console.log('\n5. Tag browser and reset');
  await page.fill('#tagSearch', '0028,1053');
  await page.waitForTimeout(300);
  check('tag search finds Rescale Slope',
    (await page.textContent('#metaTable')).includes('1053'),
    (await page.textContent('#metaTable')).replace(/\s+/g, ' ').slice(0, 90));
  check('tag search also finds it by keyword',
    (await (async () => { await page.fill('#tagSearch', 'rescale'); await page.waitForTimeout(250);
      return page.textContent('#metaTable'); })()).toLowerCase().includes('rescale'));
  await page.fill('#tagSearch', '');
  // Keyboard shortcuts deliberately ignore keys typed into inputs, so blur first.
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.evaluate(() => { window.__ctConsole.state.cells[0].view.zoom = 3; window.__ctConsole.renderAll(); });
  await page.keyboard.press('r');
  await page.waitForTimeout(250);
  check('R resets zoom', (await page.evaluate(() => window.__ctConsole.state.cells[0].view.zoom)) === 1);

  console.log('\n6. 3D volume rendering still draws');
  await UI.pickLayout(page, 'quad');
  const drew = await page.evaluate(() => {
    const C = window.__ctConsole;
    const i = C.state.cells.findIndex(x => x.plane === 'vr');
    if (i < 0) return 'no 3D pane';
    const c = C.cellEl(i).querySelector('.vp-canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'no webgl2';
    const px = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] > 12) lit++;
    return lit;
  });
  check('the 3D canvas has lit pixels', typeof drew === 'number' && drew > 500, String(drew));

  console.log('\n7. No page errors');
  check('clean console', errors.length === 0, errors.slice(0, 3).join(' ;; ') || 'none');

  await browser.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'All regression checks passed') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
