/* Acquisition-dimension separation, and the worklist filter. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || require('path').join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };
const load = async (page, dir) => {
  const files = fs.readdirSync(path.join(SP, dir)).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, dir, f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForTimeout(2600);
};
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });

  console.log('\n1. A dual-echo series becomes two stacks, not one mixed volume');
  await load(page, 'series-echo');
  const stacks = await page.evaluate(() => window.__ctConsole.state.seriesOrder.map(u => {
    const g = window.__ctConsole.state.seriesMap[u];
    return { desc: g.description, n: g.slices.length, echo: g.echoNumber };
  }));
  check('two stacks from one Series Instance UID', stacks.length === 2,
    stacks.map(s => s.desc + ' (' + s.n + ')').join(' | '));
  check('each holds 12 slices, not 24 interleaved',
    stacks.every(s => s.n === 12), stacks.map(s => s.n).join('/'));
  check('and each is labelled with its echo',
    stacks.every(s => /Echo [12]/.test(s.desc)), stacks.map(s => s.desc).join(' | '));

  const vol = await page.evaluate(() => {
    const v = window.__ctConsole.state.volume;
    return { depth: v.depth, spacingZ: v.spacingZ, min: v.minHU, max: v.maxHU };
  });
  check('the reconstructed volume has 12 slices at 5 mm',
    vol.depth === 12 && Math.abs(vol.spacingZ - 5) < 0.01,
    vol.depth + ' × ' + vol.spacingZ + 'mm');
  // Mixing the echoes would put both 900 and 250 in one volume.
  check('one echo only — signal is not a mix of both',
    vol.max < 950 && (vol.max > 850 || vol.max < 300),
    'range ' + vol.min + '..' + vol.max);

  console.log('\n2. The worklist filter narrows the list');
  await load(page, 'series-raw');
  await load(page, 'series-mr');
  const visible = () => page.evaluate(() =>
    document.querySelectorAll('#seriesList .series-item, #seriesList .series').length ||
    document.querySelectorAll('#seriesList > div:not(.study-header)').length);
  const all = await visible();
  check('all stacks listed with no filter', all >= 4, all + ' entries');

  const tryFilter = async (q) => {
    await page.fill('#seriesFilter', q);
    await page.waitForTimeout(500);
    return page.evaluate(() => Array.from(
      document.querySelectorAll('#seriesList > div:not(.study-header)'))
      .map(d => d.textContent.replace(/\s+/g, ' ').slice(0, 40)));
  };
  const byModality = await tryFilter('CT');
  check('filtering by modality shows only CT', byModality.length >= 1 &&
    byModality.every(t => /CT/.test(t)), byModality.join(' | ').slice(0, 90));
  const byPatient = await tryFilter('ECHO');
  check('filtering by patient name finds that study', byPatient.length === 2,
    byPatient.join(' | ').slice(0, 90));
  const byId = await tryFilter('MR001');
  check('filtering by patient ID works', byId.length === 1, byId.join(' | ').slice(0, 60));
  const twoWords = await tryFilter('mr flair');
  check('two words narrow rather than widen', twoWords.length === 1,
    twoWords.join(' | ').slice(0, 60));
  const none = await tryFilter('zzzznothing');
  check('no match shows nothing', none.length === 0, none.length + ' entries');
  await page.fill('#seriesFilter', ''); await page.waitForTimeout(500);
  check('clearing restores the full list', (await visible()) === all,
    (await visible()) + ' vs ' + all);

  console.log('\n3. No page errors');
  check('clean console', errors.length === 0, errors.slice(0, 4).join(' ;; ') || 'none');

  await browser.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'All worklist checks passed') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
