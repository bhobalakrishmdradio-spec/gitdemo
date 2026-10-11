/* What the viewer can tell you about the study in front of you.

   Two separate things are checked here, because they answer different
   questions:

     · The Study panel — a fixed summary of who and what, always in the
       same place, so a reader can confirm at a glance that the images on
       screen belong to the patient they are reporting.

     · The tag browser — every element the file actually carries, for when
       the summary is not enough. Its Technique section is listed once for
       both CT and MR; the file decides which rows appear, and the viewer
       is never told the modality.

   Nothing here may be invented. Every row has to come from a header the
   fixture really contains, and a tag that is absent must be absent from
   the panel, not defaulted. */
const { chromium } = require('playwright');
const UI = require('./ui');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || path.join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };
const dcm = (dir) => fs.readdirSync(path.join(SP, dir)).filter(f => f.endsWith('.dcm'))
  .sort().map(f => path.join(SP, dir, f));

/* The panel is rows of key/value, so read it as a map rather than scraping
   text: a missing row then reads as missing, not as an empty string. */
const ROWS = (sel) => {
  const out = {};
  document.querySelectorAll(sel + ' .meta-row').forEach(r => {
    const k = r.querySelector('.meta-key'), v = r.querySelector('.meta-val');
    if (k && v) out[k.textContent.trim()] = v.textContent.trim();
  });
  return out;
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
  await page.addScriptTag({ content: 'window.__rows = ' + ROWS.toString() + ';' });

  /* =================================================================== */
  console.log('\n1. With nothing open it says so, rather than nothing');
  check('the Study panel exists', await page.locator('#studyInfo').count() === 1);
  check('and says no study is loaded',
    /no study loaded/i.test(await page.textContent('#studyInfo')),
    (await page.textContent('#studyInfo')).trim());

  /* =================================================================== */
  console.log('\n2. A CT study: who, what and how many');
  await page.setInputFiles('#fileInput', dcm('series-scout'));
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  /* The route a reader takes to it, not a direct poke at the element. */
  await UI.pickMore(page, 'study'); await page.waitForTimeout(400);
  check('"Patient and study" brings the panel on screen',
    await page.locator('#studyInfo').isVisible());

  const info = await page.evaluate(() => window.__rows('#studyInfo'));
  const truth = await page.evaluate(() => {
    const C = window.__ctConsole;
    const g = C.state.seriesMap[C.state.currentSeriesUID];
    const mine = C.state.seriesOrder.map(u => C.state.seriesMap[u])
      .filter(s => s && s.studyUID === g.studyUID);
    return { series: mine.length,
             images: mine.reduce((a, s) => a + s.slices.length, 0) };
  });
  check('the patient is named', info['Name'] === 'SCOUT, PHANTOM' ||
    /SCOUT/.test(info['Name'] || ''), JSON.stringify(info['Name']));
  check('the ID is shown', info['ID'] === 'SCT001', info['ID']);
  check('age and sex are shown as the file states them',
    /47Y/.test(info['Age / sex'] || '') && /F/.test(info['Age / sex'] || ''),
    info['Age / sex']);
  check('the study description is shown', info['Description'] === 'CT ABDOMEN',
    info['Description']);
  check('the study date is formatted, not raw DICOM',
    /2026/.test(info['Date'] || '') && !/^20260415$/.test(info['Date'] || ''),
    info['Date']);
  check('the accession number is shown', info['Accession'] === 'ACC-77301', info['Accession']);
  check('the institution is shown', info['Institution'] === 'RIVERSIDE IMAGING',
    info['Institution']);
  check('the referrer is shown, name-formatted',
    /RAO/.test(info['Referrer'] || '') && !/\^/.test(info['Referrer'] || ''),
    info['Referrer']);
  /* The count is the one row that is not a header value, so it is checked
     against what is actually loaded rather than against a literal. */
  check('the contents line matches what is loaded',
    info['Contents'] === truth.series + ' series · ' + truth.images + ' images loaded',
    info['Contents'] + ' vs ' + JSON.stringify(truth));
  check('both series of this study were counted', truth.series === 2,
    String(truth.series));
  check('the scanner is named', /SIEMENS/.test(info['Manufacturer'] || '') &&
    /SOMATOM/.test(info['Manufacturer'] || ''), info['Manufacturer']);
  check('the station is shown', info['Station'] === 'CT-SOM-01', info['Station']);
  check('the protocol is shown', info['Protocol'] === 'ABDOMEN PORTAL VENOUS',
    info['Protocol']);
  check('the patient position is shown', info['Patient position'] === 'HFS',
    info['Patient position']);
  /* Nothing may be guessed: the fixture has no birth date, and the panel
     must not fill that row from the age. */
  check('no row was invented for a tag the file does not carry',
    !('Birth date' in info) && !('Phase' in info), Object.keys(info).join(', '));

  /* =================================================================== */
  console.log('\n3. CT technique, from the file');
  await UI.pickMore(page, 'tags'); await page.waitForTimeout(400);
  const ct = await page.evaluate(() => window.__rows('#metaTable'));
  const sections = () => page.evaluate(() =>
    [...document.querySelectorAll('#metaTable .meta-section')].map(s => s.textContent));
  const ctSections = await sections();
  check('the tag browser has a Technique section', ctSections.indexOf('Technique') >= 0,
    ctSections.join(', '));
  check('the reconstruction kernel is shown', ct['Convolution Kernel'] === 'B30f',
    ct['Convolution Kernel']);
  check('kVp is shown', ct['kVp'] === '120', ct['kVp']);
  check('tube current is shown', ct['Tube Current (mA)'] === '210',
    ct['Tube Current (mA)']);
  check('exposure is shown', ct['Exposure (mAs)'] === '150', ct['Exposure (mAs)']);
  check('gantry tilt is shown', /0/.test(ct['Gantry Tilt'] || ''), ct['Gantry Tilt']);
  check('the contrast agent is shown', /OMNIPAQUE/.test(ct['Contrast / Bolus Agent'] || ''),
    ct['Contrast / Bolus Agent']);
  check('the body part is shown', ct['Body Part Examined'] === 'ABDOMEN',
    ct['Body Part Examined']);
  /* A CT has no TR or TE. Listing the row empty would read as "TR: none". */
  check('no MR parameter is shown for a CT',
    !('Repetition Time (TR)' in ct) && !('Echo Time (TE)' in ct) &&
    !('Magnetic Field Strength' in ct),
    Object.keys(ct).filter(k => /TR|TE|Field/.test(k)).join(', ') || 'none');
  check('HU is claimed, because this file says RescaleType HU',
    /HU/.test(ct['Intensity units'] || ''), ct['Intensity units']);

  /* =================================================================== */
  console.log('\n4. The same panel on an MR, with the other half of the table');
  await page.reload({ waitUntil: 'networkidle' });
  await page.addScriptTag({ content: 'window.__rows = ' + ROWS.toString() + ';' });
  await page.setInputFiles('#fileInput', dcm('series-mr'));
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await UI.pickMore(page, 'tags'); await page.waitForTimeout(400);
  const mr = await page.evaluate(() => window.__rows('#metaTable'));
  const mrInfo = await page.evaluate(() => window.__rows('#studyInfo'));
  check('TR is shown', /9000/.test(mr['Repetition Time (TR)'] || ''),
    mr['Repetition Time (TR)']);
  check('TE is shown', /120/.test(mr['Echo Time (TE)'] || ''), mr['Echo Time (TE)']);
  check('TI is shown', /2500/.test(mr['Inversion Time (TI)'] || ''),
    mr['Inversion Time (TI)']);
  check('the flip angle is shown', /150/.test(mr['Flip Angle'] || ''), mr['Flip Angle']);
  check('field strength is shown', /1\.5/.test(mr['Magnetic Field Strength'] || ''),
    mr['Magnetic Field Strength']);
  check('the echo train length is shown', /17/.test(mr['Echo Train Length'] || ''),
    mr['Echo Train Length']);
  check('the sequence is shown', mr['Scanning Sequence'] === 'SE', mr['Scanning Sequence']);
  check('the acquisition type is shown', mr['MR Acquisition Type'] === '2D',
    mr['MR Acquisition Type']);
  check('no CT parameter is shown for an MR',
    !('kVp' in mr) && !('Tube Current (mA)' in mr) && !('Convolution Kernel' in mr),
    Object.keys(mr).filter(k => /kVp|Tube|Kernel/.test(k)).join(', ') || 'none');
  /* The honesty rule this whole project rests on: no Rescale Type, no HU. */
  check('HU is not claimed for the MR — it is denied in words',
    /not HU/i.test(mr['Intensity units'] || ''), mr['Intensity units']);
  check('the Study panel works for an MR too', /MR/.test(mrInfo['Name'] || '') ||
    mrInfo['ID'] === 'MR001', JSON.stringify(mrInfo['ID']));
  check('the MR scanner is named', /GE MEDICAL/.test(mrInfo['Manufacturer'] || ''),
    mrInfo['Manufacturer']);

  /* =================================================================== */
  console.log('\n5. The panel follows the series you are looking at');
  const moved = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const before = window.__rows('#studyInfo');
    C.state.seriesMap[C.state.currentSeriesUID] &&
      (C.state.seriesMap[C.state.currentSeriesUID].studyDescription = 'EDITED IN PLACE');
    C.renderStudyInfo();
    const after = window.__rows('#studyInfo');
    return { before: before['Description'] || '', after: after['Description'] || '' };
  });
  check('a re-render reads the series again rather than caching',
    moved.after === 'EDITED IN PLACE', JSON.stringify(moved));

  /* =================================================================== */
  console.log('\n6. A header that is markup stays text in the Study panel');
  await page.reload({ waitUntil: 'networkidle' });
  await page.addScriptTag({ content: 'window.__rows = ' + ROWS.toString() + ';' });
  await page.evaluate(() => { window.__XSS = []; window.__pwned = (w) => window.__XSS.push(w); });
  const hostile = dcm('series-hostile').filter(f => !/poison_/.test(f));
  await page.setInputFiles('#fileInput', hostile);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  const hos = await page.evaluate(() => ({
    rows: window.__rows('#studyInfo'),
    elements: document.querySelectorAll('#studyInfo img, #studyInfo svg, #studyInfo iframe').length,
    xss: window.__XSS.length,
  }));
  check('the hostile name is shown literally', /img src|onerror/i.test(hos.rows['Name'] || ''),
    (hos.rows['Name'] || '').slice(0, 50));
  check('no element was built from a header', hos.elements === 0, String(hos.elements));
  check('nothing ran', hos.xss === 0, String(hos.xss));

  /* =================================================================== */
  console.log('\n7. A scale bar, and what it refuses to claim');
  /* How big something looks is the one judgement zoom destroys, so the bar
     is information in the strictest sense. It is also the easiest overlay to
     get silently wrong, so it is checked against the viewer's own measuring
     tool rather than against the formula that drew it. */
  await page.reload({ waitUntil: 'networkidle' });
  await page.addScriptTag({ content: 'window.__rows = ' + ROWS.toString() + ';' });
  await page.setInputFiles('#fileInput', dcm('series-scout'));
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await UI.pickLayout(page, 'axial'); await page.waitForTimeout(700);

  const bar = await page.evaluate(() => {
    const C = window.__ctConsole;
    const g = C.cellGeom(0);
    const b = C.scaleBarFor(g);
    return b && { mm: b.mm, px: b.px, label: b.label, cw: g.cw,
                  dpr: window.devicePixelRatio || 1 };
  });
  check('there is a bar on a series with Pixel Spacing', !!bar, JSON.stringify(bar));
  check('its length is a round number of millimetres',
    [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].indexOf(bar.mm) >= 0, String(bar.mm));
  check('it fits in a third of the pane', bar.px <= bar.cw / 3 + 0.001,
    bar.px.toFixed(1) + ' of ' + bar.cw);
  check('and is labelled in millimetres', /^[\d.]+ mm$/.test(bar.label), bar.label);

  /* Drawn, not merely computed: scan the overlay canvas for the bar. */
  const drawn = await page.evaluate((y46) => {
    const cross = window.__ctConsole.cellEl(0).querySelector('.vp-cross');
    const ctx = cross.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const row = Math.round(cross.height - y46 * dpr);
    const d = ctx.getImageData(0, row, cross.width, 1).data;
    let lo = -1, hi = -1;
    for (let x = 0; x < cross.width; x++) {
      if (d[x * 4 + 3] > 60) { if (lo < 0) lo = x; hi = x; }
    }
    return { lo: lo, hi: hi, span: hi - lo, width: cross.width };
  }, 46);
  check('the bar is actually on the overlay canvas', drawn.span > 0,
    JSON.stringify(drawn));
  check('what is drawn is as long as what was computed',
    Math.abs(drawn.span - bar.px) <= 6,
    'drawn ' + drawn.span + ' vs ' + bar.px.toFixed(1));
  check('and it is centred in the pane',
    Math.abs((drawn.lo + drawn.hi) / 2 - drawn.width / 2) <= 4,
    JSON.stringify(drawn));

  /* The independent check: measure the bar with the distance tool. If the
     bar says 50 mm, dragging between its ends must read 50 mm. */
  const box = await page.evaluate(() => {
    const r = window.__ctConsole.cellEl(0).getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await UI.pickTool(page, 'distance');
  const cssPx = bar.px / bar.dpr;
  const my = box.y + box.h - 46 - 20;          // clear of the bar itself
  await page.mouse.click(box.x + box.w / 2 - cssPx / 2, my);
  await page.waitForTimeout(200);
  await page.mouse.click(box.x + box.w / 2 + cssPx / 2, my);
  await page.waitForTimeout(500);
  const measured = await page.evaluate(() => {
    const C = window.__ctConsole;
    const m = C.state.measurements[C.state.measurements.length - 1];
    if (!m) return null;
    return { tool: m.tool, text: document.getElementById('measureList').textContent };
  });
  check('the distance tool agrees with the bar',
    measured && new RegExp('\\b' + bar.mm.toFixed(1).replace('.', '\\.') + '|\\b' +
      String(bar.mm)).test(measured.text), JSON.stringify(measured && measured.text.slice(0, 80)));
  await page.evaluate(() => {
    const C = window.__ctConsole;
    C.state.measurements = [];
    C.renderAll();
  });
  await UI.pickTool(page, 'none');

  /* Zoom in: the bar must shorten in millimetres, never claim more. */
  const zoomed = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const before = C.scaleBarFor(C.cellGeom(0));
    C.state.cells[0].view.zoom = 4;
    C.renderAll();
    await new Promise(r => setTimeout(r, 300));
    const after = C.scaleBarFor(C.cellGeom(0));
    const rotated = (() => {
      C.state.cells[0].view.rotation = 90;
      C.renderAll();
      return C.scaleBarFor(C.cellGeom(0));
    })();
    const cw = C.cellGeom(0).cw;
    C.state.cells[0].view.rotation = 0;
    C.state.cells[0].view.zoom = 1;
    C.renderAll();
    return { before: before, after: after, rotated: rotated, cw: cw };
  });
  check('zooming in shortens the bar in millimetres',
    zoomed.after.mm < zoomed.before.mm,
    zoomed.before.mm + ' -> ' + zoomed.after.mm);
  check('the bar still fits after zooming',
    zoomed.after.px <= zoomed.cw / 3 + 0.001,
    zoomed.after.px.toFixed(1) + ' of ' + zoomed.cw);
  /* Rotation turns the image, not the ruler: millimetres per screen pixel is
     the same either way, so the bar must not change. */
  check('rotating the pane does not change the scale',
    Math.abs(zoomed.rotated.px - zoomed.after.px) < 0.001,
    zoomed.after.px + ' vs ' + zoomed.rotated.px);

  /* Without Pixel Spacing there is no millimetre to draw. */
  const uncal = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const g = C.cellGeom(0);
    const inst = C.state.seriesMap[g.uid].slices[0].instance;
    const had = inst.hasPixelSpacing;
    inst.hasPixelSpacing = false;
    C.renderAll();
    await new Promise(r => setTimeout(r, 200));
    const bar = C.scaleBarFor(C.cellGeom(0));
    const cal = C.paneCalibration(C.cellGeom(0));
    inst.hasPixelSpacing = had;
    C.renderAll();
    return { bar: bar, unit: cal.unit, back: !!C.scaleBarFor(C.cellGeom(0)) };
  });
  check('no bar when Pixel Spacing is absent', uncal.bar === null,
    JSON.stringify(uncal.bar));
  check('and the calibration says px, not mm', uncal.unit === 'px', uncal.unit);
  check('the bar returns once the spacing is known again', uncal.back);

  /* =================================================================== */
  console.log('\n8. Clearing the viewer really clears it');
  /* Clearing used to clear the series list and leave the volumes behind it
     in the cache. A pane bound to one of those series found its volume and
     went on drawing a patient who was no longer loaded — the worst possible
     thing for a panel whose whole job is saying whose images these are. */
  await page.reload({ waitUntil: 'networkidle' });
  await page.addScriptTag({ content: 'window.__rows = ' + ROWS.toString() + ';' });
  page.on('dialog', async d => { await d.accept(); });
  await page.setInputFiles('#fileInput', dcm('series-scout'));
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await UI.pickLayout(page, '1x2'); await page.waitForTimeout(700);
  const bound = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const other = C.state.seriesOrder.find(u => u !== C.state.currentSeriesUID);
    C.setCellSeries(1, other);
    await new Promise(r => setTimeout(r, 900));
    return { other: other, vol: !!C.cellVolume(C.state.cells[1]),
             cached: Object.keys(C.state.volumes).length };
  });
  check('a second pane is bound to the other series', bound.vol,
    JSON.stringify(bound));
  await UI.pickOpen(page, 'clear');
  await page.waitForTimeout(900);
  const cleared = await page.evaluate(() => {
    const C = window.__ctConsole;
    return {
      series: C.state.seriesOrder.length,
      volumes: Object.keys(C.state.volumes).length,
      bindings: C.state.cells.map(c => c.seriesUid),
      paneVolume: !!C.cellVolume(C.state.cells[1]),
      info: document.getElementById('studyInfo').textContent.trim(),
    };
  });
  check('no series is left', cleared.series === 0, String(cleared.series));
  check('no volume is left in the cache', cleared.volumes === 0,
    String(cleared.volumes));
  check('no pane is still bound to a series',
    cleared.bindings.every(u => u === null), JSON.stringify(cleared.bindings));
  check('and the second pane has nothing to draw', !cleared.paneVolume);
  check('the Study panel says so too', /no study loaded/i.test(cleared.info),
    cleared.info.slice(0, 60));

  /* =================================================================== */
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nAll study-information checks passed.');
  process.exit(fails ? 1 : 0);
})();
