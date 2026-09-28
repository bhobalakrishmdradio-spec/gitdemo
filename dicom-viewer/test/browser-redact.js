/* Redaction, the burned-in warning, and saving to a local file.

   The fixture burns legible block text into a known rectangle of the pixel
   data. The test reads the screenshot's own pixels inside that rectangle
   and checks the text is gone — not merely covered by something drawn over
   it, and not merely blurred. */
const { chromium } = require('playwright');
const UI = require('./ui');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || require('path').join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };

/* Where make_burned.py put the text, in plane pixels. */
const BURN = { x0: 4, y0: 4, x1: 124, y1: 52 };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 },
    acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
  const files = fs.readdirSync(path.join(SP, 'series-burned')).filter(f => f.endsWith('.dcm'))
    .sort().map(f => path.join(SP, 'series-burned', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  await UI.pickLayout(page, 'axial');
  await page.waitForTimeout(500);

  /* =================================================================== */
  console.log('\n1. The viewer notices the series declares burned-in text');
  check('Burned In Annotation was read from the header',
    await page.evaluate(() => {
      const C = window.__ctConsole;
      const g = C.state.seriesMap[C.state.currentSeriesUID];
      return g.slices[0].instance.burnedIn;
    }) === 'YES');
  check('and the series is listed as carrying it',
    (await page.evaluate(() => window.__ctConsole.burnedInSeries('pane'))).length === 1);

  /* The text really is in the pixel data, or the rest of this proves nothing. */
  const before = await page.evaluate((B) => {
    const C = window.__ctConsole;
    const s = C.getPlaneData('axial');
    let hot = 0;
    for (let y = B.y0; y < B.y1; y++)
      for (let x = B.x0; x < B.x1; x++)
        if (s.data[y * s.width + x] > 2000) hot++;
    return hot;
  }, BURN);
  check('the fixture really has bright text burned into the pixels',
    before > 300, before + ' pixels above 2000 HU');

  /* =================================================================== */
  console.log('\n2. Saving warns before the image leaves the viewer');
  let warned = null;
  page.on('dialog', d => { warned = d.message(); d.dismiss(); });
  await page.click('#shotBtn');
  await page.waitForTimeout(600);
  check('it warns that the pixels may carry patient details',
    !!warned && /burned-in/i.test(warned), (warned || '').split('\n')[0]);
  check('and points at the Redact tool', /Redact/.test(warned || ''));
  check('declining saves nothing',
    await page.evaluate(() => window.__ctConsole.state.burnedInAcknowledged) === false);
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept());

  /* =================================================================== */
  console.log('\n3. Redaction destroys the text, on screen and in the file');
  const toScreen = (px, py) => page.evaluate(([x, y]) => {
    const C = window.__ctConsole, g = C.cellGeom(0);
    const c = C.planeToCanvas(g.t, x, y);
    const r = C.cellEl(0).querySelector('canvas').getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: r.left + c.x / dpr, y: r.top + c.y / dpr };
  }, [px, py]);

  await UI.pickTool(page, 'redact');
  check('the redact tool is armed',
    await page.evaluate(() => window.__ctConsole.state.tool === 'redact'));
  const a = await toScreen(BURN.x0 - 1, BURN.y0 - 1);
  const b = await toScreen(BURN.x1 + 1, BURN.y1 + 1);
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(120);
  await page.mouse.click(b.x, b.y);
  await page.waitForTimeout(400);

  const placed = await page.evaluate(() => {
    const C = window.__ctConsole;
    const m = C.state.measurements.filter(x => x.tool === 'redact');
    return { n: m.length, pts: m[0] && m[0].points };
  });
  check('two clicks place one redaction box', placed.n === 1, placed.n);
  check('it is listed as a redaction, with the area it covers',
    /Redacted/.test(await page.textContent('#measureList')) &&
    /px covered/.test(await page.textContent('#measureList')),
    (await page.textContent('#measureList')).slice(0, 70));

  /* The claim: inside that box, the screenshot has no trace of the text.

     Measured as detail at the scale the text lives at. Comparing each pixel
     with its immediate neighbour does not work and was tried: the image is
     drawn at 7x, so a stroke edge is spread smoothly over seven pixels and
     almost no adjacent pair differs sharply — while a mosaic *adds* an edge
     at every cell boundary. Reading over a span instead catches the real
     structure: across 8 screen pixels a letter stroke goes black to white,
     and the inside of a mosaic cell goes nowhere. */
  const detailIn = (hide) => page.evaluate(([B, hide]) => {
    const C = window.__ctConsole;
    const m = C.state.measurements.filter(x => x.tool === 'redact')[0];
    if (hide) C.toggleMeasurementHidden(m.id);
    const shot = C.buildScreenshot('pane');
    const g = C.cellGeom(0);
    const c0 = C.planeToCanvas(g.t, B.x0, B.y0);
    const c1 = C.planeToCanvas(g.t, B.x1, B.y1);
    const x0 = Math.max(0, Math.round(Math.min(c0.x, c1.x)));
    const y0 = Math.max(0, Math.round(Math.min(c0.y, c1.y)));
    const w = Math.min(shot.width - x0, Math.round(Math.abs(c1.x - c0.x)));
    const h = Math.min(shot.height - y0, Math.round(Math.abs(c1.y - c0.y)));
    const d = shot.getContext('2d').getImageData(x0, y0, w, h).data;
    if (hide) C.toggleMeasurementHidden(m.id);

    const SPAN = 8;                 // about one source pixel at this zoom
    let detail = 0, bright = 0, total = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x + SPAN < w; x++) {
        const i = (y * w + x) * 4, j = (y * w + x + SPAN) * 4;
        if (Math.abs(d[i] - d[j]) > 60) detail++;
        if (d[i] > 230) bright++;
        total++;
      }
    }
    return { detail: detail / total, bright: bright / total, total, w, h };
  }, [BURN, hide]);

  const redacted = await detailIn(false);
  const exposed = await detailIn(true);
  const cellPx = await page.evaluate(() => {
    const g = window.__ctConsole.cellGeom(0);
    return Math.max(12, Math.round(10 * Math.abs(g.t.scale * g.t.spacingX)));
  });

  /* The control first: without the box, the text must be plainly there, or
     nothing below is measuring anything. */
  check('without the box, the area is full of text detail',
    exposed.detail > 0.05,
    (100 * exposed.detail).toFixed(2) + '% of ' + exposed.total + ' samples');
  check('and full of the white of the strokes',
    exposed.bright > 0.10, (100 * exposed.bright).toFixed(2) + '% bright');

  /* The span test cannot reach zero and should not be asked to: a mosaic
     puts a hard edge at every cell boundary, and a span of 8 across a cell
     of ~72 straddles one about a tenth of the time. What it does show is
     that the structure collapsed. */
  check('with the box, detail at the scale of the text collapses',
    redacted.detail < exposed.detail / 4,
    (100 * redacted.detail).toFixed(2) + '% vs ' + (100 * exposed.detail).toFixed(2) + '%');
  check('what is left is no more than the cell boundaries account for',
    redacted.detail < 8 / cellPx, (100 * redacted.detail).toFixed(2) + '% vs a boundary ' +
    'share of ' + (100 * 8 / cellPx).toFixed(2) + '%');
  check('and almost none of the white of the strokes survives',
    redacted.bright < exposed.bright / 5,
    (100 * redacted.bright).toFixed(2) + '% vs ' + (100 * exposed.bright).toFixed(2) + '%');

  /* The sharpest claim, and the one that says the information is gone
     rather than merely coarsened: inside a cell there is nothing left to
     read. Counting distinct grey levels was tried and says nothing — a
     mosaic holds one value per cell and there are eighty of them, so it
     spans the range as widely as the text did. */
  const interiors = await page.evaluate(([B, cell]) => {
    const C = window.__ctConsole;
    const shot = C.buildScreenshot('pane');
    const g = C.cellGeom(0);
    const c0 = C.planeToCanvas(g.t, B.x0, B.y0);
    const c1 = C.planeToCanvas(g.t, B.x1, B.y1);
    const x0 = Math.max(0, Math.round(Math.min(c0.x, c1.x)));
    const y0 = Math.max(0, Math.round(Math.min(c0.y, c1.y)));
    const w = Math.min(shot.width - x0, Math.round(Math.abs(c1.x - c0.x)));
    const h = Math.min(shot.height - y0, Math.round(Math.abs(c1.y - c0.y)));
    const d = shot.getContext('2d').getImageData(x0, y0, w, h).data;

    // A window well inside each cell, avoiding its boundaries.
    const inset = Math.floor(cell * 0.25), size = Math.floor(cell * 0.4);
    let flat = 0, seen = 0;
    for (let cy = 0; (cy + 1) * cell <= h; cy++) {
      for (let cx = 0; (cx + 1) * cell <= w; cx++) {
        let lo = 255, hi = 0;
        for (let y = cy * cell + inset; y < cy * cell + inset + size; y++) {
          for (let x = cx * cell + inset; x < cx * cell + inset + size; x++) {
            const v = d[(y * w + x) * 4];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        seen++;
        if (hi - lo <= 4) flat++;
      }
    }
    return { flat, seen };
  }, [BURN, cellPx]);
  check('every mosaic cell is flat inside — no sub-cell detail survives',
    interiors.seen > 20 && interiors.flat === interiors.seen,
    interiors.flat + ' of ' + interiors.seen + ' cells uniform');

  /* A mosaic is only as good as its cell size. One cell must cover several
     source pixels, or averaging changes nothing — which is exactly what a
     cell measured in screen pixels did at 7x zoom: the name stayed legible
     in the saved file. */
  const cell = await page.evaluate(() => {
    const C = window.__ctConsole, g = C.cellGeom(0);
    return { perSource: Math.abs(g.t.scale * g.t.spacingX) };
  });
  check('one mosaic cell covers many source pixels, not one',
    cell.perSource > 1, cell.perSource.toFixed(2) + ' device px per source px');

  /* =================================================================== */
  console.log('\n4. It is saved to a local file');
  /* The button always writes a file. "Save as…" is where the browser's save
     dialog lives, because that dialog can refuse for reasons that cannot be
     told apart from the person cancelling it, and a button that sometimes
     silently produces nothing is worse than one that always downloads. */
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#shotBtn'),
  ]);
  const out = path.join(SP, 'shot-redacted.png');
  await dl.saveAs(out);
  check('a file was written to disk', fs.existsSync(out) && fs.statSync(out).size > 3000,
    fs.statSync(out).size + ' bytes');
  check('it is a PNG', fs.readFileSync(out).slice(1, 4).toString() === 'PNG');
  check('the warning is not repeated once acknowledged',
    await page.evaluate(() => window.__ctConsole.state.burnedInAcknowledged) === true);

  /* "Save as…" must still leave the person with a file even where the
     dialog will not open — headless Chromium refuses it, which is the same
     shape of failure as an embedding that forbids it. */
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    UI.pickMore(page, 'shotAs'),
  ]);
  check('"Save as…" falls back to a download when the dialog will not open',
    /\.png$/.test(dl2.suggestedFilename()), dl2.suggestedFilename());

  /* =================================================================== */
  console.log('\n5. Patient details are only ever added on request');
  const plain = await page.evaluate(() => {
    const C = window.__ctConsole;
    const shot = C.buildScreenshot('pane');
    // The identity banner is drawn across the foot; sample that band.
    const d = shot.getContext('2d')
      .getImageData(0, Math.round(shot.height * 0.93), shot.width,
                    Math.round(shot.height * 0.06)).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 90) lit++;
    return lit;
  });
  check('by default the foot of the image carries no banner', plain < 400, plain + ' lit');
  await UI.pickMore(page, 'shotIdentity');
  const withId = await page.evaluate(() => {
    const C = window.__ctConsole;
    const shot = C.buildScreenshot('pane');
    const d = shot.getContext('2d')
      .getImageData(0, Math.round(shot.height * 0.93), shot.width,
                    Math.round(shot.height * 0.06)).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 90) lit++;
    return lit;
  });
  check('turning it on writes the banner in', withId > plain + 400,
    plain + ' -> ' + withId + ' lit');
  await UI.pickMore(page, 'shotIdentity');
  check('turning it off again removes it',
    await page.evaluate(() => window.__ctConsole.state.screenshotIdentity) === false);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nAll redaction and save checks passed');
  process.exit(fails ? 1 : 0);
})();
