/* The focus point: one click, and every pane, plane and comparison series
   moves to the same place in the patient.

   The claim under test is anatomical, not arithmetic — so every expectation
   is derived from Image Position (Patient), which is what the fixtures
   actually carry, and checked against where the application ends up. */
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
  await page.waitForTimeout(2800);
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });

  await load(page, 'phantom');
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(600);

  /* =================================================================== */
  console.log('\n1. The volume knows where it sits in the patient');
  const frame = await page.evaluate(() => {
    const v = window.__ctConsole.state.volume;
    return v.frame ? { origin: v.frame.origin, rowDir: v.frame.rowDir,
                       colDir: v.frame.colDir, sliceDir: v.frame.sliceDir } : null;
  });
  check('a patient frame was built from Image Position / Orientation', !!frame,
    frame && JSON.stringify(frame.origin));
  check('the row axis runs +x', frame && near(frame.rowDir[0], 1, 1e-9));
  check('the column axis runs +y', frame && near(frame.colDir[1], 1, 1e-9));
  check('the slice axis runs +z (head-first fixture)',
    frame && near(frame.sliceDir[2], 1, 1e-9), frame && frame.sliceDir.join(','));

  /* Round-tripping is the property that matters: a point converted out to
     the patient and back must land where it started. */
  const round = await page.evaluate(() => {
    const V = window.CTVolume, v = window.__ctConsole.state.volume;
    const local = [12.5, 33.25, 8.75];
    const back = V.fromPatient(v, V.toPatient(v, local));
    return { local, back, patient: V.toPatient(v, local) };
  });
  check('local -> patient -> local round-trips exactly',
    round.back.every((b, i) => near(b, round.local[i], 1e-9)), JSON.stringify(round.back));

  /* =================================================================== */
  console.log('\n2. Focusing a point moves every plane to it');
  await UI.pickLayout(page, 'mpr');

  const picked = await page.evaluate(() => {
    const C = window.__ctConsole;
    const g = C.cellGeom(0);                       // the axial pane
    // A point deliberately off-centre in all three axes.
    const px = Math.round(g.slab.width * 0.32) + 0.5;
    const py = Math.round(g.slab.height * 0.7) + 0.5;
    const c = C.planeToCanvas(g.t, px, py);
    const r = C.cellEl(0).querySelector('canvas').getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { px, py, plane: g.plane, index: g.index,
             sx: r.left + c.x / dpr, sy: r.top + c.y / dpr };
  });
  check('pane 0 is the axial pane', picked.plane === 'axial', picked.plane);

  await page.click('#focusBtn');
  check('the focus button reports it is armed',
    await page.evaluate(() => document.getElementById('focusBtn').classList.contains('active')));
  await page.mouse.click(picked.sx, picked.sy);
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => {
    const C = window.__ctConsole, V = window.CTVolume;
    const f = C.state.focusPoint;
    const out = { patient: f && f.patient, panes: [] };
    for (let i = 0; i < C.cellCount(); i++) {
      const g = C.cellGeom(i);
      if (!g) continue;
      const pp = C.worldToPlane(g.plane, g.slab, f.local, g.index, g.vol);
      const c = C.planeToCanvas(g.t, pp.x, pp.y);
      out.panes.push({ plane: g.plane, index: g.index,
        offCentreX: c.x - g.cw / 2, offCentreY: c.y - g.ch / 2,
        // How far the focus point is from this pane's cut, along its normal.
        dpr: window.devicePixelRatio || 1 });
    }
    return out;
  });
  check('a focus point was recorded in patient millimetres',
    !!after.patient && after.patient.length === 3, JSON.stringify(after.patient));
  check('all three MPR panes are showing', after.panes.length === 3,
    after.panes.map(p => p.plane).join(','));
  after.panes.forEach(p => {
    check(`the ${p.plane} pane is centred on the point`,
      Math.abs(p.offCentreX) < 1.5 * p.dpr && Math.abs(p.offCentreY) < 1.5 * p.dpr,
      p.offCentreX.toFixed(2) + ', ' + p.offCentreY.toFixed(2) + ' device px');
  });

  /* The patient coordinates must be the ones the fixture actually encodes:
     1 mm pixels, origin (0,0), 2 mm slices starting at z = 0. */
  const expected = await page.evaluate((pick) => {
    const C = window.__ctConsole;
    const v = C.state.volume;
    return { wantX: (pick.px - 0.5) * v.spacingX, wantY: (pick.py - 0.5) * v.spacingY,
             sliceZ: window.CTVolume.sliceZ(v, pick.index) };
  }, picked);
  check('focus x matches the pixel clicked, in patient mm',
    near(after.patient[0], expected.wantX, 0.6),
    after.patient[0].toFixed(2) + ' vs ' + expected.wantX.toFixed(2));
  check('focus y matches the pixel clicked, in patient mm',
    near(after.patient[1], expected.wantY, 0.6),
    after.patient[1].toFixed(2) + ' vs ' + expected.wantY.toFixed(2));
  check('focus z is the axial slice that was clicked on',
    near(after.patient[2], expected.sliceZ, 1.1),
    after.patient[2].toFixed(2) + ' vs ' + expected.sliceZ);

  /* =================================================================== */
  console.log('\n3. Scrolling away, then Go, comes back to it');
  const home = await page.evaluate(() => {
    const C = window.__ctConsole;
    return { ax: C.indexRecord(C.state.currentSeriesUID).axial,
             co: C.indexRecord(C.state.currentSeriesUID).coronal,
             sa: C.indexRecord(C.state.currentSeriesUID).sagittal };
  });
  await page.evaluate(() => {
    const C = window.__ctConsole;
    C.setCellIndex(0, C.cellIndex(C.state.cells[0]) + 5);
  });
  await page.waitForTimeout(400);
  const strayed = await page.evaluate(() =>
    window.__ctConsole.indexRecord(window.__ctConsole.state.currentSeriesUID).axial);
  check('scrolling actually moved off the focused slice', strayed !== home.ax,
    home.ax + ' -> ' + strayed);

  const offCut = await page.evaluate(() => {
    const C = window.__ctConsole, g = C.cellGeom(0);
    const f = C.state.focusPoint;
    const centre = C.planeToWorld(g.plane, g.slab, g.slab.width / 2, g.slab.height / 2,
      g.index, g.vol);
    return Math.abs(f.local[2] - centre[2]);
  });
  check('the focus point is now off this cut, by a real distance', offCut > 1, offCut.toFixed(1) + ' mm');

  await page.evaluate(() => { document.getElementById('focusGoBtn').click(); });
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => {
    const C = window.__ctConsole;
    return { ax: C.indexRecord(C.state.currentSeriesUID).axial,
             co: C.indexRecord(C.state.currentSeriesUID).coronal,
             sa: C.indexRecord(C.state.currentSeriesUID).sagittal };
  });
  check('Go returns every plane to the focused cut',
    back.ax === home.ax && back.co === home.co && back.sa === home.sa,
    JSON.stringify(back) + ' vs ' + JSON.stringify(home));

  const recentred = await page.evaluate(() => {
    const C = window.__ctConsole, g = C.cellGeom(0), f = C.state.focusPoint;
    const pp = C.worldToPlane(g.plane, g.slab, f.local, g.index, g.vol);
    const c = C.planeToCanvas(g.t, pp.x, pp.y);
    return { dx: c.x - g.cw / 2, dy: c.y - g.ch / 2, dpr: window.devicePixelRatio || 1 };
  });
  check('Go also re-centres the pane on the point',
    Math.abs(recentred.dx) < 1.5 * recentred.dpr && Math.abs(recentred.dy) < 1.5 * recentred.dpr,
    recentred.dx.toFixed(2) + ', ' + recentred.dy.toFixed(2));

  /* =================================================================== */
  console.log('\n4. Zoom and rotation do not move the point off centre');
  await page.evaluate(() => {
    const C = window.__ctConsole;
    C.state.cells[0].view.zoom = 2.6;
    C.state.cells[0].view.rotation = 90;
    C.state.cells[0].view.flipH = true;
    C.renderAll();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__ctConsole.goToFocus(true));
  await page.waitForTimeout(300);
  const spun = await page.evaluate(() => {
    const C = window.__ctConsole, g = C.cellGeom(0), f = C.state.focusPoint;
    const pp = C.worldToPlane(g.plane, g.slab, f.local, g.index, g.vol);
    const c = C.planeToCanvas(g.t, pp.x, pp.y);
    return { dx: c.x - g.cw / 2, dy: c.y - g.ch / 2, dpr: window.devicePixelRatio || 1 };
  });
  check('still centred at 2.6x zoom, rotated 90 deg and flipped',
    Math.abs(spun.dx) < 1.5 * spun.dpr && Math.abs(spun.dy) < 1.5 * spun.dpr,
    spun.dx.toFixed(2) + ', ' + spun.dy.toFixed(2));
  await page.evaluate(() => {
    const C = window.__ctConsole;
    C.state.cells[0].view = { zoom: 1, panX: 0, panY: 0, rotation: 0, flipH: false, flipV: false };
    C.renderAll();
  });

  /* =================================================================== */
  console.log('\n5. A comparison series is pulled to the same anatomy');
  await load(page, 'series-prior');
  await page.waitForTimeout(1200);
  const uids = await page.evaluate(() => window.__ctConsole.state.seriesOrder.map(u => ({
    uid: u, desc: window.__ctConsole.state.seriesMap[u].description })));
  const prior = uids.find(u => /PRIOR/i.test(u.desc));
  check('the prior series loaded', !!prior, uids.map(u => u.desc).join(' | '));

  await UI.pickLayout(page, '1x2');
  await UI.pickFill(page, 'axial');
  // Make the phantom current again and bind pane 1 to the prior.
  const phantomUid = uids.find(u => !/PRIOR/i.test(u.desc)).uid;
  await page.evaluate((u) => window.__ctConsole.selectSeries(u), phantomUid);
  await page.waitForTimeout(2500);
  await page.evaluate((u) => window.__ctConsole.setCellSeries(1, u), prior.uid);
  await page.waitForTimeout(2500);

  const bound = await page.evaluate(() => {
    const C = window.__ctConsole;
    return { u0: C.cellSeriesUid(C.state.cells[0]), u1: C.cellSeriesUid(C.state.cells[1]),
             p0: C.state.cells[0].plane, p1: C.state.cells[1].plane };
  });
  check('pane 0 is the current study, pane 1 the prior, both axial',
    bound.u0 !== bound.u1 && bound.p0 === 'axial' && bound.p1 === 'axial',
    JSON.stringify(bound));

  // Focus a point in the current study's pane.
  const pick2 = await page.evaluate(() => {
    const C = window.__ctConsole, g = C.cellGeom(0);
    const px = Math.round(g.slab.width * 0.4) + 0.5;
    const py = Math.round(g.slab.height * 0.55) + 0.5;
    const c = C.planeToCanvas(g.t, px, py);
    const r = C.cellEl(0).querySelector('canvas').getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { sx: r.left + c.x / dpr, sy: r.top + c.y / dpr };
  });
  await page.evaluate(() => window.__ctConsole.setFocusPick(true));
  await page.mouse.click(pick2.sx, pick2.sy);
  await page.waitForTimeout(700);

  const cross = await page.evaluate(() => {
    const C = window.__ctConsole, V = window.CTVolume;
    const f = C.state.focusPoint;
    const g1 = C.cellGeom(1);
    const priorVol = g1.vol;
    // Where the prior pane ended up, and where it should be.
    const zShown = V.sliceZ(priorVol, g1.index);
    const best = V.sliceNearestZ(priorVol, f.patient[2]);
    // In-plane: convert the patient point into the prior's own frame.
    const local = V.fromPatient(priorVol, f.patient);
    const pp = C.worldToPlane(g1.plane, g1.slab, local, g1.index, g1.vol);
    const c = C.planeToCanvas(g1.t, pp.x, pp.y);
    return {
      sameFrame: V.sameFrame(C.volumeFor(f.uid), priorVol),
      zShown, wantZ: f.patient[2], bestIndex: best && best.index, shownIndex: g1.index,
      inPlaneX: pp.x, inPlaneY: pp.y,
      offCentreX: c.x - g1.cw / 2, offCentreY: c.y - g1.ch / 2,
      dpr: window.devicePixelRatio || 1,
      priorSpacingX: priorVol.spacingX,
      note: document.getElementById('focusNote').textContent,
    };
  });
  check('the two series are recognised as the same orientation', cross.sameFrame);
  check('the prior pane moved to the slice nearest the focused patient Z',
    cross.shownIndex === cross.bestIndex,
    'shown ' + cross.shownIndex + ' (z=' + cross.zShown + '), nearest ' + cross.bestIndex);
  check('the prior pane is centred on the same patient x, y',
    Math.abs(cross.offCentreX) < 1.5 * cross.dpr && Math.abs(cross.offCentreY) < 1.5 * cross.dpr,
    cross.offCentreX.toFixed(2) + ', ' + cross.offCentreY.toFixed(2));
  check('the in-plane position matches the patient coordinate, not the pixel index',
    near(cross.inPlaneX * cross.priorSpacingX - cross.priorSpacingX / 2,
         (await page.evaluate(() => window.__ctConsole.state.focusPoint.patient[0])), 0.6),
    cross.inPlaneX.toFixed(2));

  /* The prior covers z = 6..41 mm. Focusing outside that range still snaps
     to its nearest slice — which is exactly the case that must not be
     reported as a match. */
  const outside = Math.abs(cross.zShown - cross.wantZ) > 1.0;
  check('this focus level is outside the prior (the honest-reporting case)', outside,
    Math.abs(cross.zShown - cross.wantZ).toFixed(2) + ' mm away');
  check('the note says the nearest slice is outside the series, not "match"',
    /outside this series/.test(cross.note) && !/in-plane match/.test(cross.note), cross.note);
  const gap = await page.evaluate(() => {
    const C = window.__ctConsole;
    const u = C.cellSeriesUid(C.state.cells[1]);
    return C.focusGapFor(u, C.cellVolume(C.state.cells[1]));
  });
  check('the reported gap matches the real distance',
    near(gap, Math.abs(cross.zShown - cross.wantZ), 0.6), gap.toFixed(2) + ' mm');

  /* Now focus a level the prior really does cover, and it must say match. */
  const inside = await page.evaluate(() => {
    const C = window.__ctConsole, V = window.CTVolume;
    // z = 20 mm sits well inside the prior's 6..41 mm.
    const vol = C.state.volume;
    const hit = V.sliceNearestZ(vol, 20);
    C.setCellIndex(0, hit.index);
    return hit.index;
  });
  await page.waitForTimeout(500);
  const pick3 = await page.evaluate(() => {
    const C = window.__ctConsole, g = C.cellGeom(0);
    const c = C.planeToCanvas(g.t, g.slab.width * 0.45, g.slab.height * 0.5);
    const r = C.cellEl(0).querySelector('canvas').getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { sx: r.left + c.x / dpr, sy: r.top + c.y / dpr };
  });
  await page.evaluate(() => window.__ctConsole.setFocusPick(true));
  await page.mouse.click(pick3.sx, pick3.sy);
  await page.waitForTimeout(700);
  const covered = await page.evaluate(() => {
    const C = window.__ctConsole, V = window.CTVolume, g1 = C.cellGeom(1);
    const f = C.state.focusPoint;
    return { note: document.getElementById('focusNote').textContent,
             gap: C.focusGapFor(C.cellSeriesUid(C.state.cells[1]), g1.vol),
             zShown: V.sliceZ(g1.vol, g1.index), wantZ: f.patient[2] };
  });
  check('a level the prior does cover is reported as an in-plane match',
    /in-plane match/.test(covered.note) && !/outside this series/.test(covered.note),
    covered.note);
  check('and it landed within a slice of the focused level', covered.gap < 1.0,
    covered.gap.toFixed(3) + ' mm (z ' + covered.zShown + ' vs ' + covered.wantZ.toFixed(1) + ')');

  /* =================================================================== */
  console.log('\n6. Clearing');
  await page.evaluate(() => window.__ctConsole.clearFocus());
  await page.waitForTimeout(200);
  check('the focus point is gone',
    await page.evaluate(() => window.__ctConsole.state.focusPoint === null));
  check('the Go button is disabled again',
    await page.evaluate(() => document.getElementById('focusGoBtn').disabled));
  check('pick mode turned itself off',
    await page.evaluate(() => window.__ctConsole.state.focusPick === false));
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nAll focus checks passed');
  process.exit(fails ? 1 : 0);
})();
