/* Getting a screenshot into Photos.

   A browser cannot write to the photo library; it hands the file to the
   operating system's share sheet, where "Save Image" puts it there. So what
   is testable is what gets handed over: a real PNG of the right pane, named
   correctly, and a fallback that still leaves the person with a file when
   sharing is unavailable or refused.

   Headless Chromium has no navigator.share, which makes it the honest
   default case; the share paths are driven with a stub that records exactly
   what the application passed. */
const { chromium } = require('playwright');
const UI = require('./ui');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || require('path').join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 },
    acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
  const files = fs.readdirSync(path.join(SP, 'phantom')).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, 'phantom', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await UI.pickLayout(page, 'axial');

  /* =================================================================== */
  console.log('\n1. Without file sharing, the button still writes a file');
  check('this browser reports that it cannot share files',
    (await page.evaluate(() => window.__ctConsole.canSharePng())) === false);
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#shotBtn'),
  ]);
  check('pressing the camera saved a PNG instead', /\.png$/.test(dl.suggestedFilename()),
    dl.suggestedFilename());
  check('the "send to Photos" items are disabled, not silently doing something else',
    await page.evaluate(async () => {
      document.getElementById('moreBtn').click();
      await new Promise(r => setTimeout(r, 120));
      const b = document.querySelector('#moreMenu [data-more="shotShare"]');
      const off = b.disabled && /cannot share/.test(b.textContent);
      document.getElementById('moreMenu').hidden = true;
      return off;
    }));

  /* =================================================================== */
  console.log('\n2. With file sharing, the real PNG is handed to the share sheet');
  await page.evaluate(() => {
    window.__shared = null;
    navigator.canShare = (d) => !!(d && d.files && d.files.length &&
      d.files[0].size < 20 * 1024 * 1024);
    navigator.share = (d) => {
      const f = d.files[0];
      return f.arrayBuffer().then(buf => {
        window.__shared = { name: f.name, type: f.type, size: f.size, title: d.title,
                            head: Array.from(new Uint8Array(buf.slice(0, 8))) };
      });
    };
  });
  check('the viewer now reports it can share files',
    (await page.evaluate(() => window.__ctConsole.canSharePng())) === true);

  await page.click('#shotBtn');
  await page.waitForTimeout(900);
  const shared = await page.evaluate(() => window.__shared);
  check('pressing the camera shared rather than downloaded', !!shared);
  check('what was shared is a PNG file',
    shared && shared.type === 'image/png' && /\.png$/.test(shared.name), shared && shared.name);
  check('its bytes really are a PNG, not an empty blob',
    shared && shared.head.slice(0, 4).join(',') === '137,80,78,71' && shared.size > 3000,
    shared && (shared.head.join(',') + ' · ' + shared.size + ' bytes'));
  check('it is named after the pane it came from',
    shared && /ct-console-axial-/.test(shared.name), shared && shared.name);
  check('the toast says how to get it into Photos',
    /Save Image/.test(await page.textContent('#toast')),
    await page.textContent('#toast'));

  /* The grid variant must share the grid, which is a bigger image. */
  await page.evaluate(() => { window.__shared = null; });
  await UI.pickMore(page, 'shotShareGrid');
  await page.waitForTimeout(900);
  const grid = await page.evaluate(() => window.__shared);
  check('"send all panes" shares the grid', grid && /-grid-/.test(grid.name), grid && grid.name);

  /* =================================================================== */
  console.log('\n3. Closing the share sheet is not a failure');
  await page.evaluate(() => {
    window.__downloads = 0;
    navigator.share = () => Promise.reject(
      Object.assign(new Error('cancelled'), { name: 'AbortError' }));
  });
  let downloaded = false;
  const onDl = () => { downloaded = true; };
  page.on('download', onDl);
  await page.click('#shotBtn');
  await page.waitForTimeout(1200);
  check('cancelling leaves no stray file in downloads', !downloaded);
  page.off('download', onDl);

  /* =================================================================== */
  console.log('\n4. A share that fails still leaves them with the image');
  await page.evaluate(() => {
    navigator.share = () => Promise.reject(
      Object.assign(new Error('nope'), { name: 'NotAllowedError' }));
  });
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#shotBtn'),
  ]);
  check('a failed share falls back to a download', /\.png$/.test(dl2.suggestedFilename()),
    dl2.suggestedFilename());
  check('and the toast says why, in the same message as the outcome',
    /Sharing failed/i.test(await page.textContent('#toast')) &&
    /Saved/.test(await page.textContent('#toast')), await page.textContent('#toast'));

  /* =================================================================== */
  console.log('\n5. An image the platform will not take is not silently lost');
  await page.evaluate(() => {
    navigator.share = () => Promise.resolve();
    // Refuse anything of a realistic size, as a platform limit would.
    navigator.canShare = (d) => !!(d && d.files && d.files.length && d.files[0].size < 10);
  });
  const [dl3] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#shotBtn'),
  ]);
  check('an over-size image falls back to a download', /\.png$/.test(dl3.suggestedFilename()),
    dl3.suggestedFilename());
  check('and the reason is given alongside it',
    /too large/i.test(await page.textContent('#toast')) &&
    /Saved/.test(await page.textContent('#toast')), await page.textContent('#toast'));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nAll share checks passed');
  process.exit(fails ? 1 : 0);
})();
