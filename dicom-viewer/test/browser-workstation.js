/* The workstation sprint: series cards, corner overlays, the contextual
   panel, the scout and the new layouts.

   The scout checks are the ones with real arithmetic behind them. The
   fixture's localizer is CORONAL — row along +x, column along −z — so an
   axial cut must appear on it as a HORIZONTAL line whose row is
   (0 − z) / 1 mm. A viewer that ignored Image Orientation (Patient) and
   assumed the localizer was axial would draw a vertical line and pass any
   test that only asked whether a line was drawn. */
const { chromium } = require('playwright');
const UI = require('./ui');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || path.join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };
const load = async (page, dir) => {
  const files = fs.readdirSync(path.join(SP, dir)).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, dir, f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1400);
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.dismiss());
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
  await load(page, 'series-scout');

  /* =================================================================== */
  console.log('\n1. One card per series, carrying what you pick a series by');
  const cards = await page.evaluate(() => [...document.querySelectorAll('.series-group')]
    .map(g => ({
      lines: [...g.querySelectorAll('.series-line')].map(l => l.textContent),
      thumb: !!g.querySelector('.series-thumb canvas'),
      active: g.classList.contains('active'),
      expand: g.querySelector('.series-expand').textContent,
      draggable: g.querySelector('.series-card').draggable,
    })));
  check('both series have a card', cards.length === 2, String(cards.length));
  check('each card has a decoded thumbnail', cards.every(c => c.thumb));
  const ax = cards.find(c => c.lines.join(' ').includes('PORTAL'));
  check('the card names modality and series number', ax && ax.lines[0] === 'CT · 2',
    ax && ax.lines[0]);
  check('and the description', ax && ax.lines[1] === 'AX PORTAL VENOUS', ax && ax.lines[1]);
  check('and thickness and image count', ax && ax.lines[2] === '2 mm · 76 img', ax && ax.lines[2]);
  check('and the acquisition facts the file states',
    ax && /B30f/.test(ax.lines[3] || ''), ax && ax.lines[3]);
  check('cards are draggable', cards.every(c => c.draggable));
  check('the slice strip is offered but not built',
    cards.every(c => /images$/.test(c.expand)) &&
    (await page.evaluate(() => document.querySelectorAll('.thumb').length)) === 0,
    await page.evaluate(() => document.querySelectorAll('.thumb').length) + ' tiles');

  console.log('\n1b. A localizer is not what the viewer opens on');
  const opened = await page.evaluate(() => {
    const C = window.__ctConsole;
    return C.state.seriesMap[C.state.currentSeriesUID].description;
  });
  check('series 1 is the localizer, but the axial series is what opened',
    opened === 'AX PORTAL VENOUS', opened);

  console.log('\n1c. The strip still works, when asked for');
  await page.click('.series-group.active .series-expand');
  await page.waitForTimeout(900);
  check('expanding builds the per-slice tiles',
    (await page.evaluate(() => document.querySelectorAll('.thumb').length)) > 20,
    await page.evaluate(() => document.querySelectorAll('.thumb').length) + ' tiles');
  await page.click('.series-group.active .series-expand');
  await page.waitForTimeout(200);

  /* =================================================================== */
  console.log('\n2. Four corners, each holding what belongs there');
  await UI.pickLayout(page, 'axial');
  await page.evaluate(() => window.__ctConsole.setCellIndex(0, 25));
  await page.waitForTimeout(500);
  const corners = await page.evaluate(() => {
    const el = window.__ctConsole.cellEl(0);
    const get = c => el.querySelector('.vp-' + c).textContent;
    return { tl: get('tl'), tr: get('tr'), bl: get('bl'), br: get('br') };
  });
  check('top left: who', /SCOUT/.test(corners.tl) && /SCT001/.test(corners.tl) &&
    /47Y/.test(corners.tl) && /F/.test(corners.tl) && /2026/.test(corners.tl),
    JSON.stringify(corners.tl));
  check('top right: which series, number, and where in it',
    /AX PORTAL VENOUS/.test(corners.tr) && /#2/.test(corners.tr) &&
    /26 \/ 76/.test(corners.tr) && /mm/.test(corners.tr), JSON.stringify(corners.tr));
  check('bottom left: how it is displayed, including the live tool',
    /WW \d+/.test(corners.bl) && /Zoom 100%/.test(corners.bl) &&
    /Window\/Level/.test(corners.bl), JSON.stringify(corners.bl));
  check('bottom right: how it was acquired',
    /CT/.test(corners.br) && /ABDOMEN/.test(corners.br) && /B30f/.test(corners.br) &&
    /120 kVp/.test(corners.br) && /210 mA/.test(corners.br), JSON.stringify(corners.br));

  await page.click('#panBtn'); await page.waitForTimeout(250);
  check('the active-tool line follows the armed tool',
    /Pan/.test(await page.evaluate(() =>
      window.__ctConsole.cellEl(0).querySelector('.vp-bl').textContent)),
    await page.evaluate(() => window.__ctConsole.cellEl(0).querySelector('.vp-bl').textContent));
  await page.evaluate(() => window.__ctConsole.setTool('none'));
  await page.waitForTimeout(200);

  /* =================================================================== */
  console.log('\n3. The scout marks the level, by patient geometry');
  const scout = await page.evaluate(() => ({
    shown: !document.getElementById('scoutSection').hidden,
    note: document.getElementById('scoutNote').textContent,
    // The canvas keeps its 300x150 default until something paints it.
    fromTheStart: document.getElementById('scoutCanvas').height !== 150,
  }));
  check('the scout section appeared for a study that has one', scout.shown);
  // It must be there from the load, not only once a tool is armed: a full
  // redraw refreshes it, which it did not used to.
  check('and it was there without arming anything first', scout.fromTheStart,
    String(scout.fromTheStart));
  check('and says what clicking it does', /Click to jump/.test(scout.note), scout.note);

  // The fixture's answer, worked out by hand: row = (0 - z) / 1 mm.
  const rows = await page.evaluate(() => {
    const C = window.__ctConsole;
    const sc = C.scoutForCurrent();
    const geom = C.scoutGeometry(sc.slices[0].instance);
    const out = [];
    for (const i of [0, 25, 50, 75]) {
      C.setCellIndex(0, i);
      const cut = C.currentCutPlane();
      const line = C.scoutCutLine(geom, cut.normal, cut.through);
      out.push({ i: i, z: cut.through[2], v0: line[0].v, v1: line[1].v,
                 u0: line[0].u, u1: line[1].u });
    }
    return out;
  });
  const wrong = rows.filter(r => Math.abs(r.v0 - (0 - r.z)) > 0.01 ||
                                 Math.abs(r.v1 - (0 - r.z)) > 0.01);
  check('the line sits at the row the geometry says, at every level',
    wrong.length === 0,
    rows.map(r => `z=${r.z} row=${r.v0.toFixed(1)} want=${(0 - r.z).toFixed(1)}`).join(' · '));
  check('and it is horizontal, because the localizer is coronal',
    rows.every(r => Math.abs(r.v0 - r.v1) < 0.01 && Math.abs(r.u0 - r.u1) > 50),
    `v ${rows[0].v0.toFixed(1)}→${rows[0].v1.toFixed(1)}  u ${rows[0].u0}→${rows[0].u1}`);
  check('different slices give different rows, so it actually tracks',
    new Set(rows.map(r => Math.round(r.v0))).size === rows.length,
    rows.map(r => Math.round(r.v0)).join(','));

  console.log('\n3b. Clicking the scout jumps to that level');
  const jump = await page.evaluate(async () => {
    const C = window.__ctConsole;
    C.setCellIndex(0, 0);
    C.renderScout();
    const canvas = document.getElementById('scoutCanvas');
    const r = canvas.getBoundingClientRect();
    const sc = C.scoutForCurrent();
    const geom = C.scoutGeometry(sc.slices[0].instance);
    const scale = r.width / geom.cols;
    // Aim at z = -150 mm, i.e. scout row 150.
    const ev = new MouseEvent('click', { bubbles: true,
      clientX: r.left + 10, clientY: r.top + 150 * scale });
    canvas.dispatchEvent(ev);
    await new Promise(res => setTimeout(res, 200));
    const cut = C.currentCutPlane();
    return { index: C.cellIndex(C.state.cells[0]), z: cut.through[2] };
  });
  check('clicking row 150 lands on the slice at z = -150 mm',
    Math.abs(jump.z + 150) <= 1.01, 'z=' + jump.z + ' index=' + jump.index);

  const outside = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const before = C.cellIndex(C.state.cells[0]);
    const canvas = document.getElementById('scoutCanvas');
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true,
      clientX: r.left + 10, clientY: r.top + 2 }));   // z near 0, above the series
    await new Promise(res => setTimeout(res, 200));
    return { before: before, after: C.cellIndex(C.state.cells[0]),
             toast: document.getElementById('toast').textContent };
  });
  check('a level outside the series is refused, not clamped silently',
    outside.before === outside.after && /outside this series/i.test(outside.toast),
    JSON.stringify(outside));

  /* =================================================================== */
  console.log('\n3b2. Every plane, including the one the scout cannot answer');
  const planes = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const out = [];
    for (const pl of ['axial', 'coronal', 'sagittal']) {
      C.setLayout('axial');
      await new Promise(r => setTimeout(r, 400));
      C.setCellPlane(0, pl);
      await new Promise(r => setTimeout(r, 800));
      C.renderScout();
      const cut = C.currentCutPlane();
      const sc = C.scoutForCurrent();
      const geom = C.scoutGeometry(sc.slices[0].instance);
      const line = cut ? C.scoutCutLine(geom, cut.normal, cut.through) : null;
      const canvas = document.getElementById('scoutCanvas');
      const rc = canvas.getBoundingClientRect();
      const before = C.cellIndex(C.state.cells[0]);
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true,
        clientX: rc.left + rc.width * 0.25, clientY: rc.top + rc.height * 0.25 }));
      await new Promise(r => setTimeout(r, 250));
      out.push({ plane: pl, line: line, before: before,
                 after: C.cellIndex(C.state.cells[0]),
                 note: document.getElementById('scoutNote').textContent,
                 toast: document.getElementById('toast').textContent });
    }
    return out;
  });
  const axCut = planes[0], corCut = planes[1], sagCut = planes[2];
  check('an axial cut crosses the coronal scout horizontally',
    axCut.line && Math.abs(axCut.line[0].v - axCut.line[1].v) < 0.01 &&
      Math.abs(axCut.line[0].u - axCut.line[1].u) > 50,
    JSON.stringify(axCut.line));
  check('a sagittal cut crosses it vertically',
    sagCut.line && Math.abs(sagCut.line[0].u - sagCut.line[1].u) < 0.01 &&
      Math.abs(sagCut.line[0].v - sagCut.line[1].v) > 50,
    JSON.stringify(sagCut.line));
  check('and a sagittal click moves the sagittal pane',
    sagCut.after !== sagCut.before, sagCut.before + ' -> ' + sagCut.after);
  /* The scout is coronal, so a coronal cut lies in its plane: every point
     on the scout has the same coronal coordinate, and the arithmetic would
     happily return one fixed slice wherever you pressed. */
  check('a coronal cut gets no line, and the panel says why',
    corCut.line === null && /parallel/i.test(corCut.note), corCut.note);
  check('and clicking it refuses instead of jumping somewhere meaningless',
    corCut.after === corCut.before && /same plane as the cut/i.test(corCut.toast),
    corCut.before + ' -> ' + corCut.after + '  ' + corCut.toast);

  /* =================================================================== */
  console.log('\n3c. The scout belongs to the pane, not to whatever is current');
  /* With two patients open, the pane being navigated can be showing the
     other study. Taking the localizer from the "current" series instead put
     one patient's scout beside another patient's slice position and offered
     a click to jump there — and patient coordinates mean nothing across two
     patients. */
  const files2 = fs.readdirSync(path.join(SP, 'phantom')).filter(f => f.endsWith('.dcm'))
    .sort().map(f => path.join(SP, 'phantom', f));
  await page.setInputFiles('#fileInput', files2);
  await page.waitForTimeout(3000);
  const crossed = await page.evaluate(async () => {
    const C = window.__ctConsole;
    C.setLayout('axial');
    await new Promise(r => setTimeout(r, 600));
    const scoutStudy = C.state.seriesOrder.find(u =>
      C.state.seriesMap[u].description === 'AX PORTAL VENOUS');
    const other = C.state.seriesOrder.find(u =>
      /cylinder/i.test(C.state.seriesMap[u].description));
    C.selectSeries(scoutStudy);
    await new Promise(r => setTimeout(r, 1500));
    const own = { shown: !document.getElementById('scoutSection').hidden,
                  from: (C.scoutForCurrent() || {}).description };
    // Point the pane at the other patient while this study stays "current".
    C.setCellSeries(0, other);
    await new Promise(r => setTimeout(r, 2500));
    C.renderScout();
    return { own: own,
             pane: C.state.seriesMap[C.cellSeriesUid(C.state.cells[0])].description,
             current: C.state.seriesMap[C.state.currentSeriesUID].description,
             shown: !document.getElementById('scoutSection').hidden,
             from: (C.scoutForCurrent() || {}).description || null };
  });
  check('its own study still gets its scout',
    crossed.own.shown && crossed.own.from === 'SCOUT CORONAL', JSON.stringify(crossed.own));
  check('the pane really is showing the other patient',
    /cylinder/i.test(crossed.pane) && crossed.current === 'AX PORTAL VENOUS',
    crossed.pane + ' | current: ' + crossed.current);
  check('and no scout is offered for a study that has none',
    crossed.shown === false && crossed.from === null, JSON.stringify(crossed));

  await page.reload({ waitUntil: 'networkidle' });

  /* =================================================================== */
  console.log('\n4. The scout hides itself when a study has none');
  await page.evaluate(() => window.__ctConsole.state.seriesOrder.length);
  await page.reload({ waitUntil: 'networkidle' });
  await load(page, 'phantom');
  check('no localizer, no scout section',
    await page.evaluate(() => document.getElementById('scoutSection').hidden));

  check('and "Show all" does not reveal an empty Scout section',
    await page.evaluate(async () => {
      document.getElementById('toolsAllBtn').click();
      await new Promise(r => setTimeout(r, 250));
      const hidden = document.getElementById('scoutSection').hidden;
      document.getElementById('toolsAllBtn').click();
      await new Promise(r => setTimeout(r, 250));
      return hidden;
    }));

  /* =================================================================== */
  console.log('\n5. The Tools panel follows the armed tool');
  const ctxOf = () => page.evaluate(() => ({
    ctx: window.__ctConsole.toolContext(),
    title: document.getElementById('toolsTitle').textContent,
    shown: [...document.querySelectorAll('#toolsScroll [data-ctx]')]
      .filter(s => !s.hidden).map(s => s.querySelector('h4').textContent),
  }));
  await UI.pickLayout(page, 'quad');
  await page.evaluate(() => window.__ctConsole.setTool('none'));
  await page.waitForTimeout(250);
  let c = await ctxOf();
  check('Navigate shows the window controls and little else',
    c.shown.includes('Window / Level') && c.shown.length <= 3, JSON.stringify(c.shown));
  await UI.pickTool(page, 'ellipse');
  c = await ctxOf();
  check('a measurement tool brings the measurement sections up',
    c.shown.includes('Measurements') && c.shown.includes('ROI Histogram'),
    JSON.stringify(c.shown));
  check('and not the 3D ones', !c.shown.includes('3D Rendering'), JSON.stringify(c.shown));
  await UI.pickTool(page, 'sculpt');
  c = await ctxOf();
  check('sculpting brings up bone cut and 3D',
    c.shown.includes('Bone Cut') && c.shown.includes('3D Rendering'), JSON.stringify(c.shown));

  console.log('\n5b. A section that is doing something is never hidden');
  await page.evaluate(() => {
    const C = window.__ctConsole;
    C.state.thicknessMm = 10;
    C.setTool('none');
  });
  await page.waitForTimeout(250);
  c = await ctxOf();
  check('a slab that is switched on keeps its control on screen',
    c.shown.includes('Slice Thickness'), JSON.stringify(c.shown));
  await page.evaluate(() => { window.__ctConsole.state.thicknessMm = 0;
                              window.__ctConsole.setTool('none'); });
  await page.waitForTimeout(250);
  c = await ctxOf();
  check('and goes away again once it is off',
    !c.shown.includes('Slice Thickness'), JSON.stringify(c.shown));

  console.log('\n5c. "Show all" is the way out, and the tag browser has a route');
  await page.click('#toolsAllBtn'); await page.waitForTimeout(250);
  c = await ctxOf();
  check('Show all pins every section', c.shown.length >= 11, String(c.shown.length));
  await page.click('#toolsAllBtn'); await page.waitForTimeout(250);
  await UI.pickMore(page, 'tags');
  await page.waitForTimeout(300);
  c = await ctxOf();
  check('More → DICOM tags opens the tag browser',
    c.shown.includes('DICOM Tags'), JSON.stringify(c.shown));
  await page.evaluate(() => window.__ctConsole.setTool('none'));
  await page.waitForTimeout(200);

  /* =================================================================== */
  console.log('\n6. The new layouts build the panes they claim');
  for (const [key, want] of [['2x1', 2], ['1x3', 3], ['3x1', 3], ['3x3', 9]]) {
    await UI.pickLayout(page, key);
    const n = await page.evaluate(() => window.__ctConsole.cellCount());
    check(`${key} builds ${want} panes`, n === want, String(n));
  }
  const geom3x3 = await page.evaluate(() => {
    const boxes = [];
    for (let i = 0; i < window.__ctConsole.cellCount(); i++) {
      const r = window.__ctConsole.cellEl(i).getBoundingClientRect();
      boxes.push(Math.round(r.top));
    }
    return new Set(boxes).size;
  });
  check('3×3 really is three rows', geom3x3 === 3, String(geom3x3));

  /* =================================================================== */
  console.log('\n7. Dragging a series onto a pane');
  await page.reload({ waitUntil: 'networkidle' });
  await load(page, 'series-mrstudy');
  await UI.pickLayout(page, '1x2');
  await page.waitForTimeout(500);
  const dropped = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const uid = C.state.seriesOrder.find(u =>
      C.state.seriesMap[u].description === 'COR STIR');
    const card = document.querySelector('.series-group[data-uid="' +
      (window.CSS && CSS.escape ? CSS.escape(uid) : uid) + '"] .series-card');
    const pane = C.cellEl(1);
    const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    pane.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    const highlighted = pane.classList.contains('drop-target');
    pane.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 1200));
    return { highlighted: highlighted, uid: uid,
             landed: C.cellSeriesUid(C.state.cells[1]),
             stillHighlighted: pane.classList.contains('drop-target'),
             pane0: C.cellSeriesUid(C.state.cells[0]) };
  });
  check('the pane highlights while the series is over it', dropped.highlighted);
  check('and the dropped series is what the pane now shows',
    dropped.landed === dropped.uid, dropped.landed + ' vs ' + dropped.uid);
  check('the highlight clears on drop', !dropped.stillHighlighted);
  check('the other pane is undisturbed', dropped.pane0 !== dropped.uid,
    String(dropped.pane0));

  const bogus = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const before = C.cellSeriesUid(C.state.cells[1]);
    const dt = new DataTransfer();
    dt.setData('text/x-ct-series', 'not-a-series-that-exists');
    C.cellEl(1).dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 300));
    return { before: before, after: C.cellSeriesUid(C.state.cells[1]),
             toast: document.getElementById('toast').textContent };
  });
  check('a drop naming a series that is not loaded is refused, not trusted',
    bogus.before === bogus.after && /no longer loaded/i.test(bogus.toast),
    JSON.stringify(bogus));

  /* =================================================================== */
  console.log('\n8. The new keys');
  await UI.pickLayout(page, 'quad');
  await page.waitForTimeout(400);
  const keyTool = async (k) => {
    await page.keyboard.press(k);
    await page.waitForTimeout(140);
    return page.evaluate(() => window.__ctConsole.state.tool);
  };
  check('M arms the ruler', (await keyTool('m')) === 'distance');
  check('A arms the angle', (await keyTool('a')) === 'angle');
  check('R arms the ellipse ROI', (await keyTool('r')) === 'ellipse');
  check('W returns to window/level', (await keyTool('w')) === 'none');

  const before8 = await page.evaluate(() => window.__ctConsole.cellCount());
  await page.keyboard.press('f');
  await page.waitForTimeout(500);
  const after8 = await page.evaluate(() => window.__ctConsole.cellCount());
  check('F expands the active pane', after8 === 1 && before8 > 1,
    before8 + ' -> ' + after8);
  await page.keyboard.press('f');
  await page.waitForTimeout(500);
  check('and F again puts the grid back',
    (await page.evaluate(() => window.__ctConsole.cellCount())) === before8);

  await page.keyboard.press(' ');
  await page.waitForTimeout(400);
  const playing = await page.evaluate(() => window.__ctConsole.state.cine.playing);
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  check('Space plays cine and plays it again to stop',
    playing === true &&
    (await page.evaluate(() => window.__ctConsole.state.cine.playing)) === false);

  check('Shift+F still arms the focus point', await page.evaluate(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'F', shiftKey: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    return window.__ctConsole.state.focusPick === true;
  }));

  /* =================================================================== */
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nAll workstation checks passed.');
  process.exit(fails ? 1 : 0);
})();
