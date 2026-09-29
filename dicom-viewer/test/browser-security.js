/* Untrusted input, and what the viewer does with it.

   Two sources are not trust boundaries and are treated as data here:

     · DICOM files. Anyone can hand you one, and every string in a header
       is attacker-controlled — patient name, series description, every
       private tag. They are displayed all over the interface.

     · localStorage. Anything running on this origin can write it, and a
       corrupted or hand-edited store is ordinary. Reports and measurements
       are read back from it and put on screen.

   The fixture for this suite is a DICOM file whose headers are script. */
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
  page.on('dialog', async d => { await d.dismiss(); });

  /* Any script that runs sets this flag; nothing in the viewer should. */
  await page.addInitScript(() => { window.__XSS = []; });
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.__XSS = [];
    window.__pwned = (where) => window.__XSS.push(where);
  });

  /* =================================================================== */
  console.log('\n1. No network, no eval, no third-party code');
  const surface = await page.evaluate(() => ({
    scripts: [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')),
    links: [...document.querySelectorAll('link[href]')].map(s => s.getAttribute('href')),
  }));
  check('every script is local', surface.scripts.every(s => !/^https?:|^\/\//.test(s)),
    surface.scripts.join(', '));
  check('every stylesheet is local',
    surface.links.every(s => !/^https?:|^\/\//.test(s)),
    surface.links.filter(s => /^https?:|^\/\//.test(s)).join(', ') || 'all local');

  let requested = [];
  page.on('request', r => {
    const u = r.url();
    if (!/^http:\/\/localhost:8412\//.test(u) && !/^data:|^blob:/.test(u)) requested.push(u);
  });

  /* =================================================================== */
  console.log('\n2. A DICOM file whose headers are script');
  const files = fs.readdirSync(path.join(SP, 'series-hostile')).filter(f => f.endsWith('.dcm'))
    .sort().map(f => path.join(SP, 'series-hostile', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  check('the hostile series loaded (so the strings really are on screen)',
    await page.evaluate(() => !!window.__ctConsole.state.volume));

  /* Walk every place a header string is shown. */
  await page.click('#reportToggleBtn'); await page.waitForTimeout(400);
  await page.fill('#tagSearch', 'patient'); await page.waitForTimeout(500);
  await page.fill('#seriesFilter', 'a'); await page.waitForTimeout(500);
  await UI.pickLayout(page, 'quad'); await page.waitForTimeout(900);

  const injected = await page.evaluate(() => {
    // Did any element the viewer built actually parse as markup?
    const bad = [];
    document.querySelectorAll('img[onerror], [onload], [onclick], svg, iframe, object, embed')
      .forEach(el => {
        if (el.closest('#viewGrid, .panel, .toolbar, .menu')) bad.push(el.tagName + ' ' + el.outerHTML.slice(0, 60));
      });
    return bad;
  });
  check('no markup from a DICOM header was parsed into the page',
    injected.length === 0, injected.join(' | '));
  check('no injected script ran',
    (await page.evaluate(() => window.__XSS.length)) === 0,
    JSON.stringify(await page.evaluate(() => window.__XSS)));

  /* The strings must be *shown*, escaped — not stripped, which would hide
     what the file actually says. */
  const shown = await page.evaluate(() => {
    const t = document.getElementById('seriesList').textContent +
              document.getElementById('metaTable').textContent +
              document.getElementById('reportHeader').textContent;
    return t;
  });
  check('the hostile text is displayed literally, not silently dropped',
    /script|onerror|img /i.test(shown), shown.slice(0, 90).replace(/\s+/g, ' '));

  check('nothing was requested off-origin', requested.length === 0, requested.slice(0, 3).join(' | '));

  /* =================================================================== */
  console.log('\n3. A hostile localStorage record');
  const studyUid = await page.evaluate(() => window.__ctConsole.state.reportStudyUid);
  check('a study UID is bound to the report', !!studyUid);

  /* Plant it the way a previous session would have left it: with no study
     open, so the running page has no in-memory draft for that study to
     write over it on unload. Writing behind a live report's back is not a
     scenario, and testing it only tests beforeunload. */
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => { window.__XSS = []; window.__pwned = (w) => window.__XSS.push(w); });
  await page.evaluate((uid) => {
    localStorage.setItem('ctconsole.report.' + uid, JSON.stringify({
      version: 1, status: 'draft', findings: 'x', credits: [{ evil: 1 }, 'ok'],
      keyImages: [
        { thumb: 'x" onerror="window.__pwned(\'keyimage\')" data-x="', caption: 'a' },
        { thumb: 'javascript:window.__pwned("js-url")', caption: 'b' },
        { thumb: 'data:text/html;base64,PHNjcmlwdD4=', caption: 'c' },
        { thumb: 'data:image/png;base64,iVBORw0KGgo=', caption: '<img src=x onerror=window.__pwned("caption")>' },
      ],
    }));
  }, studyUid);
  check('the record is in storage before the study is opened',
    (await page.evaluate((u) => !!localStorage.getItem('ctconsole.report.' + u), studyUid)));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.click('#reportToggleBtn'); await page.waitForTimeout(600);

  const keys = await page.evaluate(() => window.__ctConsole.state.report.keyImages);
  check('only the real image survived the read', keys.length === 1,
    keys.length + ': ' + keys.map(k => k.thumb.slice(0, 24)).join(', '));
  check('and it is a data: image URL', keys.length === 1 && /^data:image\//.test(keys[0].thumb),
    keys[0] && keys[0].thumb.slice(0, 30));
  check('a caption that is markup is shown as text, not parsed',
    (await page.evaluate(() =>
      document.getElementById('reportKeyList').querySelectorAll('img').length)) === 1,
    await page.evaluate(() => document.getElementById('reportKeyList').innerHTML.slice(0, 120)));
  check('nothing in the stored record executed',
    (await page.evaluate(() => window.__XSS.length)) === 0,
    JSON.stringify(await page.evaluate(() => window.__XSS)));
  check('a non-string credit was dropped',
    (await page.evaluate(() => window.__ctConsole.state.report.credits)).every(
      c => typeof c === 'string'));

  /* =================================================================== */
  console.log('\n4. A report that cannot be saved says so');
  await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    window.__restoreStorage = () => { Storage.prototype.setItem = real; };
    Storage.prototype.setItem = function (k) {
      if (String(k).indexOf('ctconsole.report.') === 0) {
        const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e;
      }
      return real.apply(this, arguments);
    };
  });
  await page.fill('#reportFindings', 'A finding I do not want to lose.');
  await page.waitForTimeout(1200);
  check('the status line warns that nothing is being saved',
    /NOT SAVING/i.test(await page.textContent('#reportStatus')),
    await page.textContent('#reportStatus'));
  check('and it is marked as a failure, not a normal state',
    await page.evaluate(() =>
      document.getElementById('reportStatus').classList.contains('failing')));
  check('the warning tells them to copy the text out',
    /copy the text out/i.test(await page.textContent('#toast')),
    await page.textContent('#toast'));

  await page.evaluate(() => window.__restoreStorage());
  await page.fill('#reportFindings', 'A finding I do not want to lose. And more.');
  await page.waitForTimeout(1200);
  check('once storage works again, the warning clears',
    !/NOT SAVING/i.test(await page.textContent('#reportStatus')),
    await page.textContent('#reportStatus'));

  /* =================================================================== */
  console.log('\n5. Captures are capped rather than filling storage');
  const cap = await page.evaluate(() => window.CTReport.MAX_KEY_IMAGES);
  check('there is a stated cap', typeof cap === 'number' && cap > 0, String(cap));
  await page.evaluate((n) => {
    const C = window.__ctConsole;
    C.state.report.keyImages = [];
    for (let i = 0; i < n; i++) {
      C.state.report.keyImages.push({ thumb: 'data:image/png;base64,iVBORw0KGgo=', caption: 'x' + i });
    }
  }, cap);
  await page.click('#reportGrabBtn');
  await page.waitForTimeout(500);
  check('capturing past the cap refuses, with a reason',
    /at most/i.test(await page.textContent('#toast')), await page.textContent('#toast'));
  check('and does not add one anyway',
    (await page.evaluate(() => window.__ctConsole.state.report.keyImages.length)) === cap);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nAll security checks passed');
  process.exit(fails ? 1 : 0);
})();
