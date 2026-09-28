/* Does the imported collection say exactly what the source file says?

   Rebuilds each template's text from the module and compares it, word for
   word, against the fenced block in the uploaded document. "Wording
   preserved" is a claim worth checking rather than asserting: a dropped
   "no", or "Perserved" quietly corrected to "Preserved", would be invisible
   in review and wrong in a report. */
global.window = global;
require(require('path').join(__dirname, '..', 'js', 'templates.js'));
const fs = require('fs');
const T = window.CTTemplates;
/* The source collection, shipped beside this test so the comparison can be
   made from a checkout. It is the Apache-2.0 document the templates were
   imported from; see NOTICE.md for the attribution it carries. */
const SRC = process.env.CT_TEMPLATE_SOURCE ||
  require('path').join(__dirname, 'report-templates-source.md');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '\n          ' + x : '')); if (!ok) fails++; };

const doc = fs.readFileSync(SRC, 'utf8');
/* Each entry is "## NN. Title" followed by one ```text block. */
const blocks = {};
const re = /^##\s+(\d+)\.\s+(.+?)\s*$/gm;
let m, marks = [];
while ((m = re.exec(doc)) !== null) marks.push({ n: +m[1], title: m[2], at: m.index });
marks.forEach((mk, i) => {
  const end = i + 1 < marks.length ? marks[i + 1].at : doc.length;
  const chunk = doc.slice(mk.at, end);
  const fence = chunk.match(/```text\n([\s\S]*?)```/);
  if (fence) blocks[mk.n] = { title: mk.title, body: fence[1] };
});
check('all 13 source blocks were found in the upload',
  Object.keys(blocks).length === 13, Object.keys(blocks).join(','));

/* Map source entry number -> template key. */
const MAP = {
  1: 'mtCtpa', 2: 'mtAnkle', 3: 'mtCspine', 4: 'mtElbow', 5: 'mtFoot',
  6: 'mtKnee', 7: 'mtLspine', 8: 'mtPelvis', 9: 'mtShoulder', 10: 'mtTspine',
  11: 'mtWrist', 12: 'trCtpa', 13: 'trStroke',
};

/* Compare the *set of words* and the *set of bracketed placeholders*, which
   is what "wording retained" means, independent of how the original block
   laid its sections out versus how this viewer stores them. */
const words = (s) => (s || '').toLowerCase()
  .replace(/^(technique|comparison|findings|impression|conclusion)\s*:/gim, ' ')
  .replace(/[^a-z0-9[\]|/().,'-]+/g, ' ')
  .split(' ').filter(Boolean);

for (const [num, key] of Object.entries(MAP)) {
  const src = blocks[num];
  const tpl = T.TEMPLATES[key];
  if (!src || !tpl) { check(`entry ${num} -> ${key}`, false, 'missing'); continue; }

  // The signature line is metadata in the source, stored separately here.
  const srcBody = src.body.replace('[Reporting radiologist name and credentials]', '');
  const mine = [tpl.technique, tpl.comparison, tpl.findings, tpl.impression].join('\n');

  const a = words(srcBody), b = words(mine);
  const countOf = (arr) => arr.reduce((acc, w) => (acc[w] = (acc[w] || 0) + 1, acc), {});
  const ca = countOf(a), cb = countOf(b);
  const missing = Object.keys(ca).filter(w => (cb[w] || 0) < ca[w])
    .map(w => `${w} (${ca[w]} vs ${cb[w] || 0})`);
  const extra = Object.keys(cb).filter(w => (ca[w] || 0) < cb[w])
    .map(w => `${w} (${cb[w]} vs ${ca[w] || 0})`);
  check(`${num}. ${src.title} — every word carried across, none added`,
    missing.length === 0 && extra.length === 0,
    missing.length ? 'missing: ' + missing.join(', ') : extra.length ? 'added: ' + extra.join(', ') : '');

  // Placeholders must survive exactly: they are what the author left to fill.
  const pa = (srcBody.match(T.PLACEHOLDER) || []).sort();
  const pb = (mine.match(T.PLACEHOLDER) || []).sort();
  check(`${num}. ${src.title} — placeholders preserved (${pa.length})`,
    JSON.stringify(pa) === JSON.stringify(pb),
    JSON.stringify(pa) + '\n          vs ' + JSON.stringify(pb));
}

/* Attribution must be attached to every imported template. */
const imported = Object.keys(MAP).map(n => MAP[n]);
check('every imported template carries its copyright and licence',
  imported.every(k => {
    const s = T.TEMPLATES[k].source;
    return s && /Apache-2.0/.test(s.license) && /Copyright/.test(s.copyright) &&
      T.TEMPLATES[k].sourceFile;
  }));
check('credit() names the author, licence and file for an imported template',
  /Mark Thurston/.test(T.credit(T.TEMPLATES.mtKnee)) &&
  /Apache-2.0/.test(T.credit(T.TEMPLATES.mtKnee)) &&
  /mri_knee\.yaml/.test(T.credit(T.TEMPLATES.mtKnee)));
check("credit() stays silent for this viewer's own skeletons",
  T.credit(T.TEMPLATES.ctHead) === '');

/* The known typo in the source must NOT have been silently corrected. */
check('"Perserved" is left as the source wrote it',
  /Perserved/.test(T.TEMPLATES.mtTspine.findings));

console.log(fails ? `\n${fails} check(s) failed` : '\nAll template fidelity checks passed');
process.exit(fails ? 1 : 0);
