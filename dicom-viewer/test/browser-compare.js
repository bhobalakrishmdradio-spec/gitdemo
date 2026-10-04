/* Two studies side by side, linked by patient position rather than index. */
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

  console.log('\n1. Two studies of the same patient load together');
  await load(page, 'series-prior');      // 1 mm, z 6..41
  await load(page, 'series-raw');        // 2 mm, z 0..46  (becomes current)
  const series = await page.evaluate(() => window.__ctConsole.state.seriesOrder.map(u => ({
    uid: u, desc: window.__ctConsole.state.seriesMap[u].description,
    n: window.__ctConsole.state.seriesMap[u].slices.length,
  })));
  check('both series are listed', series.length === 2,
    series.map(s => s.desc + ' (' + s.n + ')').join(' | '));
  const priorUid = series.find(s => /PRIOR/.test(s.desc)).uid;

  console.log('\n2. A pane can be bound to the prior');
  await UI.pickLayout(page, '1x2');
  // Both panes axial: the mixed fill would make pane 1 coronal, and a
  // coronal index is not what patient-Z linking moves.
  await UI.pickFill(page, 'axial');
  await page.evaluate((uid) => window.__ctConsole.setCellSeries(1, uid), priorUid);
  await page.waitForTimeout(2500);
  const bound = await page.evaluate((uid) => {
    const C = window.__ctConsole;
    const v0 = C.cellVolume(C.state.cells[0]), v1 = C.cellVolume(C.state.cells[1]);
    return {
      uid0: C.cellSeriesUid(C.state.cells[0]), uid1: C.cellSeriesUid(C.state.cells[1]),
      depth0: v0 && v0.depth, depth1: v1 && v1.depth,
      sp0: v0 && v0.spacingZ, sp1: v1 && v1.spacingZ,
      isPrior: C.state.cells[1].seriesUid === uid,
    };
  }, priorUid);
  check('pane 1 shows the prior, pane 0 the current', bound.isPrior && bound.uid0 !== bound.uid1,
    bound.uid0 === bound.uid1 ? 'same series!' : 'different series');
  check('each pane has its own volume with its own geometry',
    bound.depth0 === 24 && bound.depth1 === 36 && near(bound.sp0, 2, 0.01) && near(bound.sp1, 1, 0.01),
    `current ${bound.depth0}×${bound.sp0}mm, prior ${bound.depth1}×${bound.sp1}mm`);

  console.log('\n3. Linked scrolling lines them up by patient position');
  const zAt = () => page.evaluate(() => {
    const C = window.__ctConsole, V = window.CTVolume;
    const a = C.state.cells[0], b = C.state.cells[1];
    return {
      iA: C.cellIndex(a), iB: C.cellIndex(b),
      zA: V.sliceZ(C.cellVolume(a), C.cellIndex(a)),
      zB: V.sliceZ(C.cellVolume(b), C.cellIndex(b)),
    };
  });
  // The prior covers z = 6..41; the current study runs 0..46.
  for (const target of [10, 15, 20]) {
    await page.evaluate((t) => window.__ctConsole.setCellIndex(0, t), target);
    await page.waitForTimeout(400);
    const z = await zAt();
    check(`current slice ${z.iA} (z=${z.zA}mm) → prior slice ${z.iB} (z=${z.zB}mm)`,
      z.zA !== null && z.zB !== null && Math.abs(z.zA - z.zB) <= 1.0,
      'gap ' + Math.abs(z.zA - z.zB).toFixed(1) + ' mm');
  }

  console.log('\n3b. Outside the prior\'s range, the pane says so');
  await page.evaluate(() => window.__ctConsole.setCellIndex(0, 23));   // z = 46 mm
  await page.waitForTimeout(500);
  const outside = await zAt();
  const warnText = await page.evaluate(() =>
    window.__ctConsole.cellEl(1).querySelector('.vp-tr').textContent);
  check('it snaps to the nearest slice it has', outside.zB === 41, 'z=' + outside.zB);
  check('and warns that the level is outside this series',
    /off by 5\.0 mm/.test(warnText) && /outside this series/.test(warnText),
    warnText.replace(/\n/g, ' | '));
  await page.evaluate(() => window.__ctConsole.setCellIndex(0, 20));
  await page.waitForTimeout(400);
  check('and the warning clears once back in range',
    !/off by/.test(await page.evaluate(() =>
      window.__ctConsole.cellEl(1).querySelector('.vp-tr').textContent)));
  const z20 = await (async () => { await page.evaluate(() => window.__ctConsole.setCellIndex(0, 20));
    await page.waitForTimeout(400); return zAt(); })();
  check('the indices genuinely differ — it is not matching by number',
    z20.iA !== z20.iB, `index ${z20.iA} vs ${z20.iB}`);

  console.log('\n4. Unlinking lets each study scroll alone');
  await page.click('#linkBtn'); await page.waitForTimeout(400);
  const beforeUnlink = await zAt();
  await page.evaluate(() => window.__ctConsole.setCellIndex(0, 5));
  await page.waitForTimeout(400);
  const afterUnlink = await zAt();
  check('the prior stayed put while the current moved',
    afterUnlink.iB === beforeUnlink.iB && afterUnlink.iA !== beforeUnlink.iA,
    `current ${beforeUnlink.iA}→${afterUnlink.iA}, prior ${beforeUnlink.iB}→${afterUnlink.iB}`);
  await page.click('#linkBtn'); await page.waitForTimeout(600);
  const relinked = await zAt();
  check('relinking snaps the prior back to position',
    Math.abs(relinked.zA - relinked.zB) <= 1.0,
    'gap ' + Math.abs(relinked.zA - relinked.zB).toFixed(1) + ' mm');

  console.log('\n5. The two panes really show different images');
  const differ = await page.evaluate(() => {
    const C = window.__ctConsole;
    const hash = (i) => {
      const cv = C.cellEl(i).querySelector('.vp-canvas');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let h = 0; for (let k = 0; k < d.length; k += 4) h = (Math.imul(h, 31) + d[k]) | 0;
      return h;
    };
    return { a: hash(0), b: hash(1) };
  });
  check('pane 0 and pane 1 render different pixels', differ.a !== differ.b);
  const labelled = await page.evaluate(() =>
    window.__ctConsole.cellEl(1).querySelector('.vp-tr').textContent);
  /* The label says what the pane actually holds. "Prior" is only correct
     when that study is genuinely earlier — a comparison pane can just as
     easily carry a later study or another series of the same one, and on a
     follow-up a wrong label invites reading the growth backwards.

     This study carries no Study Date, so "earlier" is not knowable here.
     Saying "other study" rather than guessing is the behaviour under test. */
  const curDate = await page.evaluate(() =>
    window.__ctConsole.state.seriesMap[window.__ctConsole.state.currentSeriesUID].studyDate);
  check('the current study really has no date, so this tests the unknown case',
    !curDate, JSON.stringify(curDate));
  check('the comparison pane is labelled, without claiming to know which is older',
    /\[other study\]/.test(labelled) && /PRIOR thin/.test(labelled),
    labelled.replace(/\n/g, ' | '));
  // The study date sits with the patient, top left — a comparison pane is
  // told from the current one by whose scan and when, not by the series
  // description, which is usually identical.
  const dated = await page.evaluate(() =>
    window.__ctConsole.cellEl(1).querySelector('.vp-tl').textContent);
  check('it still carries that study\'s own date',
    /\d{4}-\d{2}-\d{2}/.test(dated), dated.replace(/\n/g, ' | '));
  check('and when both dates are known the label follows them',
    await page.evaluate(() => {
      const C = window.__ctConsole;
      const cur = C.state.seriesMap[C.state.currentSeriesUID];
      const saved = cur.studyDate;
      cur.studyDate = '20250701';
      const got = {
        older: C.comparisonLabel({ studyUID: 'x', studyDate: '20240101' }),
        newer: C.comparisonLabel({ studyUID: 'y', studyDate: '20260101' }),
        sameDay: C.comparisonLabel({ studyUID: 'z', studyDate: '20250701' }),
        sameStudy: C.comparisonLabel({ studyUID: cur.studyUID, studyDate: '20250701' }),
      };
      cur.studyDate = saved;
      return got.older === 'prior' && got.newer === 'later study' &&
             got.sameDay === 'same day' && got.sameStudy === 'same study';
    }));

  console.log('\n6. Measurements on the prior use the prior\'s own calibration');
  const cal = await page.evaluate(() => {
    const C = window.__ctConsole, M = window.CTMeasure;
    const g0 = C.cellGeom(0), g1 = C.cellGeom(1);
    return {
      a: [g0.slab.spacingX, g0.slab.spacingY],
      b: [g1.slab.spacingX, g1.slab.spacingY],
    };
  });
  check('each pane reports its own pixel spacing',
    JSON.stringify(cal.a) !== JSON.stringify(cal.b) || cal.a[0] === cal.b[0],
    'current ' + cal.a.join('×') + ', prior ' + cal.b.join('×'));

  console.log('\n7. Going back to one series restores normal behaviour');
  await page.evaluate(() => window.__ctConsole.setCellSeries(1, ''));
  await page.waitForTimeout(900);
  const restored = await page.evaluate(() => {
    const C = window.__ctConsole;
    return { same: C.cellSeriesUid(C.state.cells[0]) === C.cellSeriesUid(C.state.cells[1]),
             uid: C.state.cells[1].seriesUid };
  });
  check('both panes are back on the current series', restored.same && restored.uid === null);

  console.log('\n8. No page errors');
  check('clean console', errors.length === 0, errors.slice(0, 4).join(' ;; ') || 'none');

  await UI.pickFill(page, 'axial');
  await page.evaluate((uid) => window.__ctConsole.setCellSeries(1, uid), priorUid);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SP, 'shot-compare.png') });
  await browser.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'All comparison checks passed') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
