/* The same study, three encodings. Hounsfield Units must come out identical. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || require('path').join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };

const load = async (page, dir) => {
  const files = fs.readdirSync(path.join(SP, dir)).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, dir, f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
};
const volumeStats = (page) => page.evaluate(() => {
  const v = window.__ctConsole.state.volume;
  let sum = 0, min = Infinity, max = -Infinity, hash = 0;
  for (let i = 0; i < v.data.length; i++) {
    const x = v.data[i];
    sum += x; if (x < min) min = x; if (x > max) max = x;
    hash = (hash * 31 + x) | 0;
  }
  return { n: v.data.length, mean: +(sum / v.data.length).toFixed(6), min, max, hash,
           dims: [v.cols, v.rows, v.depth], syntax: window.__ctConsole.state.seriesMap[
             window.__ctConsole.state.currentSeriesUID].slices[0].instance.transferSyntax };
});

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const results = {};
  for (const [kind, dir] of [['uncompressed', 'series-raw'], ['RLE Lossless', 'series-rle'],
                             ['JPEG Lossless', 'series-jpegls']]) {
    await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
    await load(page, dir);
    results[kind] = await volumeStats(page);
    console.log(`  ${kind.padEnd(14)} ${results[kind].syntax.padEnd(24)} ` +
      `mean ${results[kind].mean}  range ${results[kind].min}..${results[kind].max}`);
  }

  console.log('\n1. Compressed studies load at all');
  check('RLE study built a volume', results['RLE Lossless'].n > 0);
  check('JPEG Lossless study built a volume', results['JPEG Lossless'].n > 0);
  check('the transfer syntaxes really are compressed',
    results['RLE Lossless'].syntax === '1.2.840.10008.1.2.5' &&
    results['JPEG Lossless'].syntax === '1.2.840.10008.1.2.4.70',
    results['RLE Lossless'].syntax + ' / ' + results['JPEG Lossless'].syntax);

  console.log('\n2. Lossless means the Hounsfield Units are identical');
  const base = results['uncompressed'];
  for (const kind of ['RLE Lossless', 'JPEG Lossless']) {
    const r = results[kind];
    check(`${kind}: same volume dimensions`,
      JSON.stringify(r.dims) === JSON.stringify(base.dims), r.dims.join('x'));
    check(`${kind}: every voxel identical to the uncompressed study`,
      r.hash === base.hash && r.mean === base.mean && r.min === base.min && r.max === base.max,
      `hash ${r.hash} vs ${base.hash}, mean ${r.mean} vs ${base.mean}`);
  }
  check('the phantom really spans a CT range (not all one value)',
    base.max - base.min > 1500, base.min + ' .. ' + base.max);

  console.log('\n3. An undecodable syntax is named, with a way forward');
  const msg = await page.evaluate(() => {
    const C = window.__ctConsole;
    return {
      j2k: window.CTCodecs.describeSyntax('1.2.840.10008.1.2.4.90'),
      jls: window.CTCodecs.describeSyntax('1.2.840.10008.1.2.4.80'),
      lossy: window.CTCodecs.describeSyntax('1.2.840.10008.1.2.4.50'),
    };
  });
  check('JPEG 2000 is named', /JPEG 2000/.test(msg.j2k), msg.j2k);
  check('JPEG-LS is named', /JPEG-LS/.test(msg.jls), msg.jls);
  check('lossy baseline is named', /lossy/.test(msg.lossy), msg.lossy);

  console.log('\n4. A decoded study measures the same as an uncompressed one');
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
  await load(page, 'series-jpegls');
  const roi = await page.evaluate(() => {
    const C = window.__ctConsole, M = window.CTMeasure;
    const s = C.getPlaneData('axial', 0);
    // The lesion sits at the centre at 300 HU.
    const cx = Math.floor(s.width / 2), cy = Math.floor(s.height / 2);
    const m = M.createMeasurement(M.TOOLS.ellipse, 'axial', 0,
      [{ x: cx - 5, y: cy - 5 }, { x: cx + 5, y: cy + 5 }]);
    const cal = M.calibrationOf(s, 'PixelSpacing');
    return M.evaluate(m, s, cal);
  });
  check('an ROI on the 300 HU lesion reads near 300', /29\d|30\d/.test(roi.primary),
    roi.primary + '  ' + (roi.detail || ''));

  console.log('\n5. No page errors');
  check('clean console', errors.length === 0, errors.slice(0, 4).join(' ;; ') || 'none');

  await page.screenshot({ path: path.join(SP, 'shot-jpegls.png') });
  await browser.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'All codec integration checks passed') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
