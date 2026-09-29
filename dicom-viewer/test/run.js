#!/usr/bin/env node
/* Run the suite.
 *
 *   node test/run.js              every suite
 *   node test/run.js wl annot     only suites whose name contains these
 *
 * Expects a static server on http://localhost:8412 serving the viewer, and
 * the fixtures generated (see test/README.md). Both are checked first, so a
 * missing prerequisite says so rather than failing twenty times over. */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), http = require('http');

const HERE = __dirname;
const FIXTURES = process.env.CT_FIXTURES || path.join(HERE, 'fixtures');
const PORT = process.env.CT_PORT || 8412;

/* Node-only suites first: they are fast and catch arithmetic before any
   browser starts. */
const UNIT = ['oblique-test.js', 'codec-test.js', 'measure-unit.js', 'template-fidelity.js'];
const BROWSER = [
  'browser-regress.js', 'browser-oblique.js', 'browser-oblique-measure.js',
  'browser-layouts.js', 'browser-sync.js', 'browser-planefill.js', 'browser-wl.js',
  'browser-codecs.js', 'browser-hu.js', 'browser-mr.js', 'browser-report.js',
  'browser-compare.js', 'browser-sculpt-cine.js', 'browser-worklist.js',
  'browser-annot.js', 'browser-focus.js', 'browser-templates.js',
  'browser-mrstudy.js', 'browser-redact.js', 'browser-compare-prior.js',
  'browser-share.js', 'browser-crop.js', 'browser-undo.js', 'browser-security.js',
  'browser-sweep.js',
];
/* Not assertions about the viewer's behaviour, but about its chrome. */
const PROBES = ['probe-bar.js', 'probe-menus.js'];

const NEEDED_FIXTURES = ['phantom', 'series-prior', 'series-mr', 'series-mrstudy',
                         'series-burned', 'series-raw', 'series-rle', 'series-jpegls',
                         'series-echo', 'series-followup', 'series-hostile'];
/* The codec bitstreams are not DICOM, so they are checked separately. */
const NEEDED_FILES = [path.join('codec', 'manifest.json')];

const filter = process.argv.slice(2);
const wanted = (f) => !filter.length || filter.some(k => f.includes(k));

function preflight() {
  const missing = NEEDED_FIXTURES.filter(d => {
    const p = path.join(FIXTURES, d);
    return !fs.existsSync(p) || !fs.readdirSync(p).some(f => f.endsWith('.dcm'));
  });
  const missingFiles = NEEDED_FILES.filter(f => !fs.existsSync(path.join(FIXTURES, f)));
  if (missing.length || missingFiles.length) {
    if (missing.length) console.error('Missing fixtures: ' + missing.join(', '));
    if (missingFiles.length) console.error('Missing files: ' + missingFiles.join(', '));
    console.error('Generate them with:  python3 test/fixtures/make_*.py');
    console.error('See test/README.md.');
    process.exit(2);
  }
  return new Promise((resolve) => {
    http.get({ host: 'localhost', port: PORT, path: '/index.html' }, (r) => {
      r.resume();
      if (r.statusCode !== 200) {
        console.error(`Server on :${PORT} answered ${r.statusCode}.`);
        process.exit(2);
      }
      resolve();
    }).on('error', () => {
      console.error(`No server on http://localhost:${PORT}.`);
      console.error('Start one with:  (cd dicom-viewer && python3 -m http.server 8412)');
      process.exit(2);
    });
  });
}

(async () => {
  await preflight();
  const all = [...UNIT, ...BROWSER, ...PROBES].filter(wanted);
  if (!all.length) { console.error('No suite matches ' + filter.join(' ')); process.exit(2); }

  let failed = [];
  const started = Date.now();
  for (const f of all) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(HERE, f)],
      { encoding: 'utf8', env: { ...process.env, CT_FIXTURES: FIXTURES } });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.status === 0) {
      console.log(`  ok    ${f.padEnd(30)} ${secs}s`);
    } else {
      failed.push(f);
      console.log(`  FAIL  ${f.padEnd(30)} ${secs}s`);
      const lines = (r.stdout + r.stderr).split('\n')
        .filter(l => /\bFAIL\b|Error|not defined|Timeout/.test(l)).slice(0, 6);
      lines.forEach(l => console.log('        ' + l.trim()));
    }
  }
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\n${all.length - failed.length}/${all.length} suites passed in ${mins} min`);
  if (failed.length) console.log('Failed: ' + failed.join(', '));
  process.exit(failed.length ? 1 : 0);
})();
