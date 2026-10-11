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
  const all = fs.readdirSync(path.join(SP, 'series-hostile')).filter(f => f.endsWith('.dcm'))
    .sort().map(f => path.join(SP, 'series-hostile', f));
  /* The prototype-poisoned files in the same directory are section 7's; here
     they would make "__proto__" a genuinely loaded series and so make the
     drop check below pass for the wrong reason. */
  const files = all.filter(f => !/poison_/.test(f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  check('the hostile series loaded (so the strings really are on screen)',
    await page.evaluate(() => !!window.__ctConsole.state.volume));

  /* Walk every place a header string is shown. */
  await page.click('#reportToggleBtn'); await page.waitForTimeout(400);
  // The tag browser lives in the Tools panel's "info" context, so it is
  // reached the way a reader reaches it.
  await UI.pickMore(page, 'tags'); await page.waitForTimeout(400);
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

  /* The series cards are the one place the panel builds HTML rather than
     setting textContent, and every line on them is a header string. */
  const cards = await page.evaluate(() => ({
    nodes: [...document.querySelectorAll('.series-line')].length,
    markup: [...document.querySelectorAll('.series-line')]
      .some(l => l.children.length > 0),
    text: [...document.querySelectorAll('.series-line')].map(l => l.textContent).join(' | '),
    titles: [...document.querySelectorAll('.series-card')].map(c => c.title).join(' | '),
  }));
  check('the series cards were built', cards.nodes > 0, cards.nodes + ' lines');
  check('no header string became an element inside a card', !cards.markup,
    cards.text.slice(0, 100));
  check('the hostile description is shown on the card as text',
    /script|onerror|svg/i.test(cards.text + cards.titles),
    cards.text.slice(0, 100));

  /* A drop payload is attacker-shaped data too: an inherited key must not
     read as a loaded series. */
  const proto = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const before = C.cellSeriesUid(C.state.cells[0]);
    const out = [];
    for (const bad of ['__proto__', 'constructor', 'toString']) {
      const dt = new DataTransfer();
      dt.setData('text/x-ct-series', bad);
      C.cellEl(0).dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
      await new Promise(r => setTimeout(r, 150));
      out.push(C.cellSeriesUid(C.state.cells[0]));
    }
    return { before: before, after: out };
  });
  check('a drop naming an inherited property is refused like any other',
    proto.after.every(v => v === proto.before), JSON.stringify(proto));

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

  /* =================================================================== */
  console.log('\n6. A measurement record written by something else');
  const meas = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const uid = C.state.currentSeriesUID;
    const long = 'x'.repeat(5000);
    localStorage.setItem('ctconsole.measure.' + uid, JSON.stringify({
      version: 1, items: [
        /* 0: the only record that should survive */
        { id: 1, tool: 'distance', plane: 'axial', sliceIndex: 0,
          points: [{ x: 10, y: 10 }, { x: 40, y: 10 }], text: long },
        /* 1: a tool this build does not have */
        { id: 2, tool: 'nuke', plane: 'axial', sliceIndex: 0,
          points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
        /* 2: a tool name that every object answers to */
        { id: 3, tool: 'toString', plane: 'axial', sliceIndex: 0,
          points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
        { id: 4, tool: 'constructor', plane: 'axial', sliceIndex: 0,
          points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
        /* 3: a plane the viewer cannot draw on */
        { id: 5, tool: 'distance', plane: 'coronal-ish', sliceIndex: 0,
          points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
        /* 4: plane is an object — .slice() on it would take the panel down */
        { id: 6, tool: 'distance', plane: { evil: 1 }, sliceIndex: 0,
          points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
        /* 5: slice index is an object, or an array */
        { id: 7, tool: 'distance', plane: 'axial', sliceIndex: { evil: 1 },
          points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
        { id: 10, tool: 'distance', plane: 'axial', sliceIndex: [1, 2],
          points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
        /* 5b: an oblique cut key. This is a *string*, and ordinary: a
           validator that insisted on a number would throw away every
           oblique measurement a reader had saved. */
        { id: 11, tool: 'distance', plane: 'axial',
          sliceIndex: 'obl:12:40,30,30:1.000000,0.000000,0.000000,0.000000,0.996195,-0.087156',
          points: [{ x: 12, y: 12 }, { x: 30, y: 30 }] },
        /* 6: no points, and points that are not numbers */
        { id: 8, tool: 'distance', plane: 'axial', sliceIndex: 0, points: [] },
        { id: 9, tool: 'distance', plane: 'axial', sliceIndex: 0,
          points: [{ x: 'NaN', y: null }, { x: 2, y: 2 }] },
        /* 7: not a record at all */
        null, 'distance', 42,
      ],
    }));
    C.state.measurements = [];
    C.state.measureLoaded = {};
    C.restoreMeasurements(uid);
    C.renderAll();
    await new Promise(r => setTimeout(r, 300));
    const kept = C.state.measurements.filter(m => m.seriesUid === uid);
    return {
      kept: kept.length,
      tools: kept.map(m => m.tool),
      textLen: kept.length ? kept[0].text.length : -1,
      keys: kept.map(m => m.sliceIndex),
      listRows: document.querySelectorAll('#measureList .measure-row').length,
      listHtml: document.getElementById('measureList').innerHTML.slice(0, 900),
    };
  });
  check('only the two well-formed records were restored', meas.kept === 2,
    meas.kept + ': ' + meas.tools.join(', '));
  check('an oblique cut key survived as the string it is',
    meas.keys.filter(k => typeof k === 'string' && /^obl:/.test(k)).length === 1,
    JSON.stringify(meas.keys));
  check('a slice index that is an object or an array did not',
    meas.keys.every(k => typeof k === 'number' || typeof k === 'string'),
    JSON.stringify(meas.keys));
  check('an inherited name is not a tool', meas.tools.indexOf('toString') < 0 &&
    meas.tools.indexOf('constructor') < 0, meas.tools.join(', '));
  check('a 5000-character note was cut to the stated cap',
    meas.textLen > 0 && meas.textLen <= 500, String(meas.textLen));
  check('both restored records are in the list', meas.listRows === 2,
    meas.listRows + ' rows');
  check('the oblique one is labelled as oblique, not as a slice number',
    /obl/.test(meas.listHtml), meas.listHtml.slice(0, 120));
  check('no markup from the record is in the list',
    !/<img|<svg|onerror/i.test(meas.listHtml), meas.listHtml.slice(0, 80));
  await page.evaluate(() => {
    localStorage.removeItem('ctconsole.measure.' + window.__ctConsole.state.currentSeriesUID);
  });

  /* =================================================================== */
  console.log('\n7. A file naming itself an inherited property');
  /* A plain {} answers truthily for "__proto__" whether or not anything was
     stored there, so a series whose UID is that string used to read as one
     already loaded — and then be used as one. Writing to it does not even
     make a key: it replaces the object's prototype. */
  const poison = all.filter(f => /poison_/.test(f));
  check('the poison fixtures are present', poison.length === 6, poison.length + ' files');
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.setInputFiles('#fileInput', poison);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  const pois = await page.evaluate(() => {
    const C = window.__ctConsole;
    return {
      count: C.state.seriesOrder.length,
      order: C.state.seriesOrder.slice(),
      cards: document.querySelectorAll('.series-card').length,
      volume: !!C.state.volume,
      status: document.getElementById('statusText').textContent,
      toast: (document.getElementById('toast') || {}).textContent || '',
      protoPolluted: ({}).evil !== undefined || ({}).slices !== undefined,
      arrayOk: typeof [].push === 'function',
      objProto: Object.getPrototypeOf({}) === Object.prototype,
    };
  });
  check('all three poison series loaded', pois.count === 3, JSON.stringify(pois.order));
  check('and each got a card', pois.cards === 3, pois.cards + ' cards');
  check('one of them built a volume', pois.volume, pois.status);
  check('the load was not reported as a failure', !/Couldn't read any/i.test(pois.toast),
    pois.toast);
  check('Object.prototype was not polluted', !pois.protoPolluted);
  check('Array.prototype still works', pois.arrayOk);
  check('a plain object still has Object.prototype', pois.objProto);
  /* Each must be independently openable: a shared or inherited entry would
     show one series' images under another's name. */
  const opened = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const out = [];
    for (const uid of C.state.seriesOrder) {
      C.selectSeries(uid);
      await new Promise(r => setTimeout(r, 500));
      out.push({ asked: uid, got: C.state.currentSeriesUID,
                 slices: C.state.volume ? C.state.volume.depth : 0 });
    }
    return out;
  });
  check('every poison series opens as itself',
    opened.every(o => o.got === o.asked && o.slices === 2), JSON.stringify(opened));

  /* =================================================================== */
  console.log('\n8. A file it cannot read says why');
  const junkDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ctjunk-'));
  const junk = [];
  const write = (name, buf) => { const p = path.join(junkDir, name); fs.writeFileSync(p, buf); junk.push(p); };
  /* Three different kinds of unreadable, which should not all read alike. */
  write('notes.txt', Buffer.from('this is not a DICOM file at all'));   // too short to be one
  write('report.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n'),
                                     Buffer.alloc(600, 0x41)]));        // long, but no DICM
  /* A real DICOM preamble + DICM, then nothing: truncated, not foreign. */
  const trunc = Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), Buffer.from([0x02, 0x00])]);
  write('cut-off.dcm', trunc);
  await page.reload({ waitUntil: 'networkidle' });
  await page.setInputFiles('#fileInput', junk);
  await page.waitForTimeout(2500);
  const why = await page.textContent('#toast');
  check('it says nothing could be read', /Couldn't read any/i.test(why), why);
  check('and names a reason in plain words',
    /not a DICOM file|truncated or corrupt|no image data/i.test(why), why);
  check('the reason is not a stack trace or raw exception text',
    !/\bat \w+\s*\(|Error:|undefined/i.test(why), why);
  /* A folder of holiday photos and a half-copied study are different
     problems; one message for both would send the reader looking in the
     wrong place. */
  check('a foreign file and a truncated one are told apart',
    /not a DICOM file/i.test(why) && /truncated or corrupt/i.test(why), why);
  check('the two foreign files were counted together, not listed twice',
    /not a DICOM file \(×2\)/i.test(why), why);
  fs.rmSync(junkDir, { recursive: true, force: true });

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nAll security checks passed');
  process.exit(fails ? 1 : 0);
})();
