/* The 2D display tools: colour maps, 1:1 and fit, the shutter, the loupe.

   These four share one property worth testing harder than the features
   themselves: every one of them changes what the image *looks* like, and
   not one of them may change what the viewer *reports*. A colour map that
   shifted an ROI mean, or a shutter that moved an HU readout, would be a
   viewer that lies about the data depending on how it is configured — so
   each section measures a number through the viewer's own tools, changes
   the display, and measures it again.

   The second property is honesty on screen. A reader looking at a
   screenshot cannot see the menu that set a rainbow map or a shutter, so
   the pane has to say both are on. */
const { chromium } = require('playwright');
const UI = require('./ui');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || path.join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };
const dcm = (dir) => fs.readdirSync(path.join(SP, dir)).filter(f => f.endsWith('.dcm'))
  .sort().map(f => path.join(SP, dir, f));

/* Sampled every 97th pixel: enough to characterise a pane, cheap enough to
   run on every map. `coloured` counts pixels whose channels differ, which is
   exactly what greyscale may never produce. */
const COLOURNESS = (canvas) => {
  const ctx = canvas.getContext('2d');
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let coloured = 0, spread = 0, lit = 0;
  for (let i = 0; i < d.length; i += 4 * 97) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r || g || b) lit++;
    const s = Math.max(r, g, b) - Math.min(r, g, b);
    if (s > 8) coloured++;
    if (s > spread) spread = s;
  }
  return { coloured, spread, lit };
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
  await page.addScriptTag({ content: 'window.__colourness = ' + COLOURNESS.toString() + ';' });

  await page.setInputFiles('#fileInput', dcm('phantom'));
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await UI.pickLayout(page, 'axial'); await page.waitForTimeout(700);

  /* =================================================================== */
  console.log('\n1. A colour map changes the picture and nothing else');
  const maps = await page.evaluate(() => Object.keys(window.__ctConsole.COLOUR_MAPS));
  check('greyscale and three ramps are offered',
    maps[0] === 'grey' && maps.length >= 4, maps.join(', '));

  const colour = await page.evaluate(async (names) => {
    const C = window.__ctConsole;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const img = () => C.cellEl(0).querySelector('.vp-canvas');
    /* An ROI over the middle of the phantom, read through the viewer's own
       evaluator — the number a reader would write in a report. */
    const g = C.cellGeom(0);
    const m = window.CTMeasure.createMeasurement('rect', 'axial', C.state.index.axial,
      [{ x: g.slab.width * 0.3, y: g.slab.height * 0.3 },
       { x: g.slab.width * 0.7, y: g.slab.height * 0.7 }],
      { seriesUid: C.state.currentSeriesUID });
    C.state.measurements = [m];
    C.renderAll();
    const read = () => {
      const gg = C.cellGeom(0);
      return window.CTMeasure.evaluate(m, gg.slab, { calibrated: true,
        spacingX: gg.slab.spacingX, spacingY: gg.slab.spacingY, unit: 'mm' }).primary;
    };
    const out = { per: {} };
    for (const name of names) {
      C.setColourMap(name);
      await wait(350);
      out.per[name] = {
        paint: window.__colourness(img()),
        roi: read(),
        label: C.cellEl(0).querySelector('.vp-bl').textContent,
      };
    }
    C.setColourMap('grey'); await wait(350);
    out.backToGrey = window.__colourness(img());
    C.state.measurements = []; C.renderAll();
    return out;
  }, maps);

  check('greyscale paints no coloured pixel at all',
    colour.per.grey.paint.coloured === 0, JSON.stringify(colour.per.grey.paint));
  maps.filter(n => n !== 'grey').forEach(n => {
    check('"' + n + '" really does paint colour',
      colour.per[n].paint.coloured > 100 && colour.per[n].paint.spread > 40,
      JSON.stringify(colour.per[n].paint));
  });
  /* The point of the whole section. */
  const rois = maps.map(n => colour.per[n].roi);
  check('the ROI reads exactly the same under every map',
    rois.every(v => v === rois[0]), rois.join(' | '));
  check('greyscale is not announced in the pane — it is the default',
    !/greyscale/i.test(colour.per.grey.label), colour.per.grey.label.replace(/\n/g, ' / '));
  maps.filter(n => n !== 'grey').forEach(n => {
    check('"' + n + '" is named in the pane, so a screenshot cannot hide it',
      colour.per[n].label.split('\n').some(l => /iron|cool|rainbow/i.test(l)),
      colour.per[n].label.replace(/\n/g, ' / '));
  });
  check('switching back to greyscale leaves no colour behind',
    colour.backToGrey.coloured === 0, JSON.stringify(colour.backToGrey));
  check('an unknown map name is refused rather than blanking the pane',
    (await page.evaluate(() => window.__ctConsole.setColourMap('__proto__'))) === false);

  /* The live readout is the other number a reader trusts. */
  const readout = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    C.state.huProbe = true;
    const rect = C.cellEl(0).getBoundingClientRect();
    const at = { x: rect.x + rect.width * 0.52, y: rect.y + rect.height * 0.48 };
    const fire = () => C.cellEl(0).dispatchEvent(new MouseEvent('mousemove',
      { clientX: at.x, clientY: at.y, bubbles: true }));
    C.setColourMap('grey'); await wait(250); fire(); await wait(150);
    const grey = document.getElementById('huReadout').textContent;
    C.setColourMap('rainbow'); await wait(250); fire(); await wait(150);
    const rainbow = document.getElementById('huReadout').textContent;
    C.setColourMap('grey'); await wait(250);
    C.state.huProbe = false;
    return { grey, rainbow };
  });
  check('the readout under the cursor says something', /-?\d/.test(readout.grey),
    readout.grey);
  check('and says the same thing under a rainbow map',
    readout.grey === readout.rainbow, readout.grey + ' vs ' + readout.rainbow);

  /* =================================================================== */
  console.log('\n2. 1:1 means one image pixel per screen pixel');
  const one = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    C.state.cells[0].view.panX = 40;
    C.zoomOneToOne(0); await wait(350);
    const g = C.cellGeom(0);
    const r = {
      zoom: C.state.cells[0].view.zoom,
      perPixel: g.t.scale * g.t.spacingX,
      status: document.getElementById('statusText').textContent,
      pan: C.state.cells[0].view.panX,
    };
    C.zoomToFit(0); await wait(350);
    r.fitZoom = C.state.cells[0].view.zoom;
    r.fitPan = C.state.cells[0].view.panX;
    r.fitStatus = document.getElementById('statusText').textContent;
    return r;
  });
  /* The claim is arithmetic, so it is checked as arithmetic: the drawn size
     of one image pixel, in device pixels, must be 1. */
  check('one image pixel is drawn exactly one device pixel wide',
    Math.abs(one.perPixel - 1) < 1e-9, String(one.perPixel));
  check('the status line explains what 1:1 means', /one image pixel/i.test(one.status),
    one.status);
  check('1:1 does not re-centre the pane behind your back', one.pan === 40,
    String(one.pan));
  check('Fit goes back to the zoom that fits', one.fitZoom === 1, String(one.fitZoom));
  check('and Fit does re-centre, because that is what fitting means',
    one.fitPan === 0, String(one.fitPan));
  check('Fit says so', /fit to pane/i.test(one.fitStatus), one.fitStatus);

  /* =================================================================== */
  console.log('\n3. The shutter blacks out the surround, and only that');
  await UI.pickMore(page, 'shutter'); await page.waitForTimeout(300);
  check('the Shutter tool is armed and says so in the pane',
    /shutter/i.test(await page.evaluate(() =>
      window.__ctConsole.cellEl(0).querySelector('.vp-bl').textContent)),
    await page.evaluate(() => window.__ctConsole.cellEl(0).querySelector('.vp-bl').textContent));

  const box = await page.evaluate(() => {
    const r = window.__ctConsole.cellEl(0).getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  /* Drag it the way a reader would, with the mouse. */
  await page.mouse.move(box.x + box.w * 0.35, box.y + box.h * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5, { steps: 5 });
  await page.mouse.move(box.x + box.w * 0.65, box.y + box.h * 0.65, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const shut = await page.evaluate(() => {
    const C = window.__ctConsole;
    const cc = C.cellEl(0).querySelector('.vp-cross');
    const ctx = cc.getContext('2d');
    const at = (fx, fy) => {
      const d = ctx.getImageData(Math.round(cc.width * fx), Math.round(cc.height * fy), 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    };
    return {
      active: C.shutterIsActive(),
      rect: C.state.cells[0].shutter,
      // Off the crosshair arms, which cross the exact centre.
      inside: at(0.44, 0.43),
      outsideTL: at(0.05, 0.05),
      outsideBR: at(0.95, 0.9),
      label: C.cellEl(0).querySelector('.vp-bl').textContent,
    };
  });
  check('a drag placed a shutter', shut.active && !!shut.rect, JSON.stringify(shut.rect));
  check('outside it is opaque black, top left',
    shut.outsideTL[3] === 255 && shut.outsideTL[0] === 0, JSON.stringify(shut.outsideTL));
  check('outside it is opaque black, bottom right',
    shut.outsideBR[3] === 255 && shut.outsideBR[0] === 0, JSON.stringify(shut.outsideBR));
  check('inside it the image is untouched', shut.inside[3] === 0,
    JSON.stringify(shut.inside));
  check('the pane says a shutter is on', /shutter/.test(shut.label),
    shut.label.replace(/\n/g, ' / '));

  /* It is anchored to the anatomy, not to the pane: panning must carry it. */
  const panned = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const cc = C.cellEl(0).querySelector('.vp-cross');
    const ctx = cc.getContext('2d');
    const row = Math.round(cc.height * 0.5);
    const edge = () => {
      const d = ctx.getImageData(0, row, cc.width, 1).data;
      for (let x = 0; x < cc.width; x++) if (d[x * 4 + 3] < 255) return x;
      return -1;
    };
    const before = edge();
    const kept = JSON.stringify(C.state.cells[0].shutter);
    C.state.cells[0].view.panX += 120;
    C.renderAll(); await wait(400);
    const after = edge();
    C.state.cells[0].view.panX -= 120;
    C.renderAll(); await wait(400);
    return { before, after, kept, now: JSON.stringify(C.state.cells[0].shutter) };
  });
  check('panning moves the shuttered window with the anatomy',
    panned.after - panned.before > 90 && panned.after - panned.before < 150,
    panned.before + ' -> ' + panned.after);
  check('and the shutter itself is unchanged — it is in plane coordinates',
    panned.kept === panned.now, panned.kept + ' vs ' + panned.now);

  /* Display only: the numbers must not notice. */
  const shutterRoi = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const g = C.cellGeom(0);
    // An ROI entirely outside the shutter — blacked out on screen, and still
    // reporting the pixels underneath.
    const m = window.CTMeasure.createMeasurement('rect', 'axial', C.state.index.axial,
      [{ x: g.slab.width * 0.05, y: g.slab.height * 0.05 },
       { x: g.slab.width * 0.2, y: g.slab.height * 0.2 }],
      { seriesUid: C.state.currentSeriesUID });
    C.state.measurements = [m];
    const cal = { calibrated: true, spacingX: g.slab.spacingX,
                  spacingY: g.slab.spacingY, unit: 'mm' };
    const withShutter = window.CTMeasure.evaluate(m, g.slab, cal).primary;
    C.clearShutters(); C.renderAll(); await wait(400);
    const without = window.CTMeasure.evaluate(m, C.cellGeom(0).slab, cal).primary;
    C.state.measurements = []; C.renderAll(); await wait(200);
    return { withShutter, without };
  });
  check('an ROI under the shutter reports the pixels, not the black',
    shutterRoi.withShutter === shutterRoi.without,
    shutterRoi.withShutter + ' vs ' + shutterRoi.without);

  /* A rectangle in one plane's coordinates frames different anatomy in
     another, so pointing the pane somewhere else has to drop it rather than
     reframe the image around the wrong thing. */
  const moved = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const g = C.cellGeom(0);
    const put = () => {
      const gg = C.cellGeom(0);
      C.setShutter(0, { x: gg.slab.width * 0.4, y: gg.slab.height * 0.4 },
                      { x: gg.slab.width * 0.6, y: gg.slab.height * 0.6 });
      C.renderAll();
    };
    put(); await wait(300);
    const placed = C.shutterIsActive();
    C.setCellPlane(0, 'coronal'); await wait(600);
    const afterPlane = C.shutterIsActive();
    C.setCellPlane(0, 'axial'); await wait(600);
    put(); await wait(300);
    const again = C.shutterIsActive();
    // Scrolling is the one change that must *not* drop it: the next slice is
    // the same anatomy a millimetre on, which is exactly when a reader wants
    // the surround to stay where they put it.
    C.setCellIndex(0, C.cellIndex(C.state.cells[0]) + 3); await wait(500);
    const afterScroll = C.shutterIsActive();
    C.clearShutters(); C.renderAll(); await wait(200);
    return { placed, afterPlane, again, afterScroll };
  });
  check('a shutter survives scrolling, because that is the same anatomy',
    moved.again && moved.afterScroll, JSON.stringify(moved));
  check('and is dropped when the pane is pointed at another plane',
    moved.placed && !moved.afterPlane, JSON.stringify(moved));

  /* A screenshot has to carry it, or the image a reader sends out is not the
     image they were looking at. */
  const inShot = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const g = C.cellGeom(0);
    C.setShutter(0, { x: g.slab.width * 0.4, y: g.slab.height * 0.4 },
                    { x: g.slab.width * 0.6, y: g.slab.height * 0.6 });
    C.renderAll(); await wait(400);
    /* Sample a plane point that is inside the phantom but outside the
       shutter, located through the pane's own transform rather than by
       guessing at a fraction of the screenshot — most of this pane is air,
       which is black whether a shutter covers it or not. */
    const g2 = C.cellGeom(0);
    const at = C.planeToCanvas(g2.t, g2.slab.width * 0.3, g2.slab.height * 0.5);
    const sx = Math.round(at.x), sy = Math.round(at.y);
    const read = (canvas) => {
      const d = canvas.getContext('2d').getImageData(sx, sy, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const shuttered = read(C.buildScreenshot('pane'));
    C.clearShutters(); C.renderAll(); await wait(400);
    const open = read(C.buildScreenshot('pane'));
    return { shuttered, open, sx, sy };
  });
  check('the screenshot shows the surround blacked out',
    inShot.shuttered[0] === 0 && inShot.shuttered[1] === 0,
    JSON.stringify(inShot.shuttered) + ' at ' + inShot.sx + ',' + inShot.sy);
  check('and shows the image there once the shutter is cleared',
    inShot.open[0] > 0, JSON.stringify(inShot.open));

  /* A press with no drag is how you get rid of it. */
  await page.evaluate(async () => {
    const C = window.__ctConsole;
    const g = C.cellGeom(0);
    C.setShutter(0, { x: g.slab.width * 0.4, y: g.slab.height * 0.4 },
                    { x: g.slab.width * 0.6, y: g.slab.height * 0.6 });
    C.renderAll();
  });
  await page.waitForTimeout(300);
  await page.mouse.click(box.x + box.w * 0.5, box.y + box.h * 0.3);
  await page.waitForTimeout(400);
  check('a click without a drag clears the shutter',
    (await page.evaluate(() => window.__ctConsole.shutterIsActive())) === false);
  check('and says so', /shutter cleared/i.test(await page.textContent('#toast')),
    await page.textContent('#toast'));

  /* =================================================================== */
  console.log('\n4. The loupe magnifies without moving the image');
  await UI.pickTool(page, 'none'); await page.waitForTimeout(200);
  const loupe = await page.evaluate(async (factor) => {
    const C = window.__ctConsole;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const pane = C.cellEl(0).querySelector('.vp-canvas');
    const cross = C.cellEl(0).querySelector('.vp-cross');
    const pctx = pane.getContext('2d'), cctx = cross.getContext('2d');
    const lit = () => {
      const d = cctx.getImageData(0, 0, cross.width, cross.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 31) if (d[i] > 0) n++;
      return n;
    };
    /* The crosshair arms run through the middle of the pane and would be
       compared against the loupe's magnified image, so they come off. */
    const hadCrosshair = C.state.crosshair;
    C.state.crosshair = false;
    C.renderAll(); await wait(400);

    const g = C.cellGeom(0);
    const target = C.planeToCanvas(g.t, g.slab.width * 0.5, g.slab.height * 0.5);
    const rect = C.cellEl(0).getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cy = Math.round(target.y);
    /* Put the cursor just outside the phantom's own left edge, so the loupe
       covers the edge and both sides of it — structure to compare, rather
       than the uniform insert at the centre. */
    const row = pctx.getImageData(0, cy, pane.width, 1).data;
    let edge = -1;
    for (let x = 1; x < pane.width; x++) { if (row[x * 4] > 40) { edge = x; break; } }
    const cx = edge > 40 ? edge - 20 : Math.round(target.x);
    const client = { x: rect.x + cx / dpr, y: rect.y + cy / dpr };

    /* The decisive test of the loupe's geometry.
       A point d device pixels from the cursor, inside a loupe of
       magnification f, must show whatever the pane shows d/f from the
       cursor. Checked over a spread of offsets, that tests the centring and
       the magnification in one measurement — and running the same
       comparison with f = 1 is the control: if that scored as well, the
       check would be measuring nothing at all.
       Offsets near the centre are skipped because the loupe draws its own
       tick there, and offsets near the rim because it draws its own ring. */
    const samples = [];
    for (let dx = -70; dx <= 70; dx += 10) {
      for (let dy = -70; dy <= 70; dy += 10) {
        if (Math.hypot(dx, dy) > 76 || Math.hypot(dx, dy) < 12) continue;
        samples.push([dx, dy]);
      }
    }
    const scoreAt = (f) => {
      let hit = 0, total = 0;
      for (const s of samples) {
        const lx = cx + s[0], ly = cy + s[1];
        const px = Math.round(cx + s[0] / f), py = Math.round(cy + s[1] / f);
        if (px < 0 || py < 0 || px >= pane.width || py >= pane.height) continue;
        if (lx < 0 || ly < 0 || lx >= cross.width || ly >= cross.height) continue;
        const a = cctx.getImageData(lx, ly, 1, 1).data;
        if (a[3] !== 255) continue;                     // outside the loupe
        const b = pctx.getImageData(px, py, 1, 1).data;
        total++;
        if (Math.abs(a[0] - b[0]) <= 40) hit++;
      }
      return { hit: hit, total: total, ratio: total ? hit / total : 0 };
    };

    const before = lit();
    const zoomBefore = C.state.cells[0].view.zoom;
    const panBefore = C.state.cells[0].view.panX;

    C.moveLoupe(0, client.x, client.y);
    await wait(350);
    const during = lit();
    const right = scoreAt(factor);
    const control = scoreAt(1);

    C.closeLoupe();
    await wait(250);
    const after = lit();
    C.state.crosshair = hadCrosshair;
    C.renderAll(); await wait(300);
    return {
      before: before, during: during, after: after,
      zoomBefore: zoomBefore, zoomAfter: C.state.cells[0].view.zoom,
      panBefore: panBefore, panAfter: C.state.cells[0].view.panX,
      factor: factor, edge: edge, cx: cx,
      right: right, control: control, samples: samples.length,
    };
  }, await page.evaluate(() => window.__ctConsole.state.magnifier));

  check('holding the loupe draws a great deal more than was there',
    loupe.during > loupe.before + 200, loupe.before + ' -> ' + loupe.during);
  check('releasing it takes all of that away again',
    loupe.after <= loupe.before, loupe.during + ' -> ' + loupe.after);
  check('the loupe never touches the pane\'s zoom',
    loupe.zoomAfter === loupe.zoomBefore, loupe.zoomBefore + ' -> ' + loupe.zoomAfter);
  check('nor its pan', loupe.panAfter === loupe.panBefore,
    loupe.panBefore + ' -> ' + loupe.panAfter);
  check('the loupe covered a usable number of sample points',
    loupe.right.total > 40, loupe.right.total + ' of ' + loupe.samples);
  check('every point in it shows what the pane shows ' + loupe.factor +
      'x closer to the cursor',
    loupe.right.ratio > 0.9,
    loupe.right.hit + '/' + loupe.right.total + ' = ' +
      (loupe.right.ratio * 100).toFixed(0) + '%');
  check('and the same test assuming no magnification fails, so it has teeth',
    loupe.control.ratio < 0.75 && loupe.right.ratio - loupe.control.ratio > 0.2,
    'x1 scored ' + (loupe.control.ratio * 100).toFixed(0) + '% against x' +
      loupe.factor + ' at ' + (loupe.right.ratio * 100).toFixed(0) + '%');

  /* =================================================================== */
  console.log('\n5. Both are reachable and both can be put back');
  const reset = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const g = C.cellGeom(0);
    C.setShutter(0, { x: 10, y: 10 }, { x: g.slab.width - 10, y: g.slab.height - 10 });
    C.setColourMap('hot');
    await wait(300);
    const on = { shutter: C.shutterIsActive(), map: C.state.colourMap };
    return on;
  });
  check('a shutter and a map can both be on at once',
    reset.shutter && reset.map === 'hot', JSON.stringify(reset));
  await UI.pickReset(page, 'shutter'); await page.waitForTimeout(400);
  check('Reset → Clear the shutter clears it',
    (await page.evaluate(() => window.__ctConsole.shutterIsActive())) === false);
  check('and leaves the colour map alone, because they are separate choices',
    (await page.evaluate(() => window.__ctConsole.state.colourMap)) === 'hot');
  await UI.pickReset(page, 'colour'); await page.waitForTimeout(400);
  check('Reset → Back to greyscale drops the map',
    (await page.evaluate(() => window.__ctConsole.state.colourMap)) === 'grey');
  /* The study's own window/level is a fresh start, so it drops the map too. */
  await page.evaluate(() => window.__ctConsole.setColourMap('cool'));
  await page.waitForTimeout(300);
  await UI.pickWindow(page, 'reset'); await page.waitForTimeout(400);
  check('"back to the study\'s own W/L" is a fresh start, map included',
    (await page.evaluate(() => window.__ctConsole.state.colourMap)) === 'grey');

  /* =================================================================== */
  console.log('\n6. 1:1 on a plane whose pixels are not square');
  /* The MR fixture is 1.2 mm in plane and 4 mm between slices, so a coronal
     reformat of it has rectangular pixels. One image pixel per screen pixel
     then has two different answers, and the honest thing is to pick one and
     say which — not to pick one quietly. */
  await page.reload({ waitUntil: 'networkidle' });
  await page.setInputFiles('#fileInput', dcm('series-mr'));
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await UI.pickLayout(page, 'axial'); await page.waitForTimeout(700);
  const aniso = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const square = (() => {
      C.zoomOneToOne(0);
      const g = C.cellGeom(0);
      return { sx: g.t.spacingX, sy: g.t.spacingY,
               status: document.getElementById('statusText').textContent };
    })();
    C.state.cells[0].plane = 'coronal';
    C.renderAll(); await wait(600);
    C.zoomOneToOne(0); await wait(400);
    const g = C.cellGeom(0);
    return {
      square: square,
      sx: g.t.spacingX, sy: g.t.spacingY,
      perPixel: g.t.scale * g.t.spacingX,
      status: document.getElementById('statusText').textContent,
    };
  });
  check('the axial plane has square pixels',
    Math.abs(aniso.square.sx - aniso.square.sy) < 1e-9,
    aniso.square.sx + ' x ' + aniso.square.sy);
  check('and there 1:1 makes no caveat',
    !/vertical axis/i.test(aniso.square.status), aniso.square.status);
  check('the coronal reformat really is rectangular',
    Math.abs(aniso.sx - aniso.sy) > 0.5, aniso.sx + ' x ' + aniso.sy);
  check('1:1 is exact along the axis it names',
    Math.abs(aniso.perPixel - 1) < 1e-9, String(aniso.perPixel));
  check('and it says outright that the other axis is not 1:1',
    /vertical axis is not 1:1/i.test(aniso.status), aniso.status);

  /* =================================================================== */
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nAll 2D display checks passed.');
  process.exit(fails ? 1 : 0);
})();
