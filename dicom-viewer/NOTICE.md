# Third-party notices

CT Console is MIT-licensed (see `../LICENSE`). It includes the following
third-party work, which carries its own copyright and licence. These notices
are reproduced as the licences require; nothing here grants rights over the
original works beyond what those licences give.

---

## dicom-parser

- Files: `js/vendor/dicomParser.min.js`
- Licence: MIT — full text in `js/vendor/LICENSE-dicom-parser.txt`
- Source: https://github.com/cornerstonejs/dicomParser

---

## mdvthu/report-templates

- Files: the templates keyed `mt*` and `tr*` in `js/templates.js`
- Licence: **Apache License, Version 2.0**
- Source: https://github.com/mdvthu/report-templates
- Revision imported: `f313efb39e8f02c72efc2ae0b3269b38422dd49b`
- Copyright holders, as stated by the source:
  - **Copyright 2024 Mark Thurston** — the eleven YAML templates
    (`ct_ctpa`, `mri_ankle`, `mri_cspine`, `mri_elbow`, `mri_foot`,
    `mri_knee`, `mri_lspine`, `mri_pelvis`, `mri_shoulder`, `mri_tspine`,
    `mri_wrist`)
  - **Copyright Thomas Rawet** — the two example files
    (`template_CT_CTPA.txt`, `template_CT_StrokeAngiogram.txt`)

You may obtain a copy of the Apache License at
<http://www.apache.org/licenses/LICENSE-2.0>.

### Changes made to these files

Apache-2.0 §4(b) requires that modified files carry prominent notice of the
change. The clinical wording was **not** altered — including its original
punctuation, spacing and the misspelling "Perserved" in the thoracic spine
template, which is left as the source wrote it. `template-fidelity.js` in the
test suite checks that word for word against the source document.

What did change:

1. **Format.** The eleven YAML templates were rendered to plain text using
   the source repository's own report layout. All thirteen were then
   transcribed into a JavaScript object literal so this viewer can load them.

2. **Section mapping.** This viewer stores a report as Clinical history,
   Technique, Comparison, Findings and Impression. The eleven YAML templates
   already use Technique / Comparison / Findings / Impression and map
   directly. The two example files are single unstructured blocks; their
   text was distributed across Comparison, Findings and Impression without
   any wording being added, removed or reordered. Where the original wrote
   "Conclusion:", that label is not reproduced, because the section is
   labelled "Impression" here.

3. **Signature line.** The demonstration signature in the source was already
   replaced with `[Reporting radiologist name and credentials]` in the
   document these were imported from. It is stored as template metadata
   rather than as report text, so it is not inserted into a draft.

4. **Nothing was generated.** No missing findings, protocols or sections were
   invented, and no template was merged with another. The two CT pulmonary
   angiogram variants are kept separate, as the source collection keeps them.

### A caution that belongs with these templates, not just their licence

Every one of them states normal findings by default. That is what makes them
quick and what makes them hazardous. The viewer therefore counts the author's
unfilled placeholders — `[]`, `[T2|STIR]`, `[No PE]` and so on — shows them
while you type, prints them in the exported text, and refuses to mark a
report final while any remain without an explicit override.

**This is not a medical device and is not validated for diagnosis.** A
template inserted and signed unread is a normal report on an abnormal study.
