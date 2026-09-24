/* ==========================================================================
   CT Console — report templates.

   Two collections:

     · A small set of skeleton headings written for this viewer (CT head,
       chest, abdomen; MRI brain and spine).

     · The mdvthu/report-templates collection, imported verbatim. Those are
       third-party work under the Apache License 2.0 and carry their own
       copyright; see NOTICE.md in this directory for the required notices,
       reproduced per line under `source` on each template below.

   Every template here states normal findings by default. That is what makes
   them fast and what makes them dangerous: a template inserted and signed
   unread is a normal report on an abnormal study. Two things follow, and
   both are enforced by the application rather than left to the reader:

     · Inserting a template never finalises anything.

     · Placeholders — the bracketed spans the authors left to be filled in,
       such as `[]` or `[T2|STIR]` — are counted and shown, and a report
       still holding one cannot be marked final without an explicit
       override.
   ========================================================================== */
(function (global) {
  "use strict";

  /** Attribution blocks, so each template does not repeat the same strings. */
  var SOURCES = {
    thurston: {
      collection: "mdvthu/report-templates",
      revision: "f313efb39e8f02c72efc2ae0b3269b38422dd49b",
      copyright: "Copyright 2024 Mark Thurston",
      license: "Apache-2.0",
      url: "https://github.com/mdvthu/report-templates",
      note: "Rendered from the original YAML using the original report layout. " +
        "Clinical wording retained; the demonstration signature was replaced " +
        "with a neutral placeholder.",
    },
    rawet: {
      collection: "mdvthu/report-templates",
      revision: "f313efb39e8f02c72efc2ae0b3269b38422dd49b",
      copyright: "Copyright Thomas Rawet",
      license: "Apache-2.0",
      url: "https://github.com/mdvthu/report-templates",
      note: "Original example text, retained word for word including its own " +
        "repetition and punctuation. The original is one unstructured block; " +
        "it has been split across this viewer's sections without altering " +
        "any wording.",
    },
    local: {
      collection: "CT Console",
      copyright: "Part of this viewer",
      license: "MIT",
      note: "A skeleton of the headings a report of this kind usually covers. " +
        "Not clinical guidance, and not a substitute for reading the images.",
    },
  };

  var SIGNATURE = "[Reporting radiologist name and credentials]";

  /*
   * Each template fills the report's own sections. `comparison` exists
   * because the imported templates have one, and folding it into Findings
   * would bury the single line that says whether a prior was looked at.
   */
  var TEMPLATES = {
    /* ------------------------------------------------------------------
     * This viewer's own skeletons
     * ---------------------------------------------------------------- */
    blank: {
      label: "Blank", modality: "Any", source: SOURCES.local,
      technique: "", comparison: "", findings: "", impression: "",
    },
    ctHead: {
      label: "CT head", modality: "CT", source: SOURCES.local,
      technique: "Non-contrast axial CT of the brain.",
      comparison: "",
      findings: [
        "Brain parenchyma: no acute infarct, haemorrhage or mass effect.",
        "Ventricles and sulci: normal size and configuration.",
        "Extra-axial spaces: no collection.",
        "Posterior fossa: unremarkable.",
        "Skull and sinuses: unremarkable.",
      ].join("\n"),
      impression: "No acute intracranial abnormality.",
    },
    ctChest: {
      label: "CT chest", modality: "CT", source: SOURCES.local,
      technique: "Volumetric CT of the thorax.",
      comparison: "",
      findings: [
        "Lungs: no consolidation, mass or interstitial abnormality.",
        "Pleura: no effusion or pneumothorax.",
        "Mediastinum and hila: no lymphadenopathy.",
        "Heart and great vessels: unremarkable.",
        "Bones and chest wall: unremarkable.",
      ].join("\n"),
      impression: "No significant abnormality in the chest.",
    },
    ctAbdomen: {
      label: "CT abdomen / pelvis", modality: "CT", source: SOURCES.local,
      technique: "CT of the abdomen and pelvis.",
      comparison: "",
      findings: [
        "Liver, gallbladder and biliary tree:",
        "Pancreas, spleen and adrenals:",
        "Kidneys and ureters:",
        "Bowel and mesentery:",
        "Pelvic organs:",
        "Vessels, nodes and peritoneum:",
        "Bones:",
      ].join("\n"),
      impression: "",
    },
    mrBrain: {
      label: "MRI brain", modality: "MRI", source: SOURCES.local,
      technique: "Multiplanar multisequence MRI of the brain.",
      comparison: "",
      findings: [
        "Parenchyma and signal abnormality:",
        "Grey-white differentiation:",
        "Ventricles and CSF spaces:",
        "Posterior fossa and brainstem:",
        "Vascular flow voids:",
        "Orbits, sinuses and mastoids:",
      ].join("\n"),
      impression: "",
    },
    mrSpine: {
      label: "MRI spine (general)", modality: "MRI", source: SOURCES.local,
      technique: "Multiplanar MRI of the spine.",
      comparison: "",
      findings: [
        "Alignment and vertebral bodies:",
        "Discs, level by level:",
        "Spinal canal and exit foramina:",
        "Cord signal:",
        "Paraspinal soft tissues:",
      ].join("\n"),
      impression: "",
    },

    /* ------------------------------------------------------------------
     * mdvthu/report-templates — Apache-2.0. See NOTICE.md.
     * ---------------------------------------------------------------- */
    mtCtpa: {
      label: "CT pulmonary angiogram", modality: "CT", source: SOURCES.thurston,
      sourceFile: "yaml/ct_ctpa.yaml",
      technique: "Pulmonary arterial phase CT chest [including|excluding] the extreme " +
        "apices and bases. Diagnostic pulmonary trunk contrast opacification " +
        "([] Hounsfield units).",
      comparison: "[No previous relevant imaging is available for comparison].",
      findings: "Negative for pulmonary embolism. The lungs and pleural spaces are " +
        "clear. Unremarkable mediastinal appearances. Unremarkable appearances of the " +
        "partially visualised abdominal contents. No size significant lymph nodes. " +
        "No aggressive bone lesion.",
      impression: "[No PE].",
      signature: SIGNATURE,
    },
    mtAnkle: {
      label: "MRI ankle", modality: "MRI", source: SOURCES.thurston,
      sourceFile: "yaml/mri_ankle.yaml",
      technique: "Axial proton density and fat suppressed proton density. Coronal T1 " +
        "and STIR. Sagittal STIR.",
      comparison: "[No previous relevant imaging is available for comparison].",
      findings: [
        "BONES AND SOFT TISSUES:",
        "No fluid collection. No bone marrow oedema. No focal bone lesion.",
        "",
        "JOINTS:",
        "No significant joint effusion. No capsular thickening.",
        "",
        "LIGAMENTS:",
        "Normal ankle joint alignment. Normal medial and lateral ligamentous complexes. Normal plantar fascia origin.",
        "",
        "TENDONS:",
        "Normal appearances of the medial and peroneal flexor tendons. Normal extensor tendons. Normal Achilles tendon.",
      ].join("\n"),
      impression: "[].",
      signature: SIGNATURE,
    },
    mtCspine: {
      label: "MRI cervical spine", modality: "MRI", source: SOURCES.thurston,
      sourceFile: "yaml/mri_cspine.yaml",
      technique: "Sagittal T1 and [T2|STIR]. Axial T2 from [C2-T1].",
      comparison: "[No previous relevant imaging is available for comparison].",
      findings: [
        "The posterior cranial fossa and craniocervical junction return normal signal. Normal marrow signal. Normal spinal alignment.",
        "",
        "C2/3: []",
        "C3/4: []",
        "C4/5: []",
        "C5/6: []",
        "C6/7: []",
        "C7/T1: []",
      ].join("\n"),
      impression: "[].",
      signature: SIGNATURE,
    },
    mtElbow: {
      label: "MRI elbow", modality: "MRI", source: SOURCES.thurston,
      sourceFile: "yaml/mri_elbow.yaml",
      technique: "Axial proton density and fat suppressed. Sagittal and coronal T1 and STIR.",
      comparison: "[No previous relevant imaging is available for comparison].",
      findings: [
        "BONES:",
        "No bone oedema or deformity. Normal appearances of the distal humerus, radial head, and proximal ulna (including coronoid process).",
        "",
        "JOINT:",
        "No significant joint effusion, intra-articular fragments, or loose bodies. Joint space and articular cartilage are preserved. No synovial thickening.",
        "",
        "SOFT TISSUES AND TENDONS:",
        "The common flexor and common extensor origins appear intact with no evidence of tendinopathy. The distal biceps tendon appears intact with no associated oedema. The distal triceps tendon appears intact with no tear or tendinopathy. Normal olecranon soft tissues; no bursitis. The imaged ulnar, median, and radial nerves appear normal in contour and location.",
      ].join("\n"),
      impression: "[].",
      signature: SIGNATURE,
    },
    mtFoot: {
      label: "MRI foot", modality: "MRI", source: SOURCES.thurston,
      sourceFile: "yaml/mri_foot.yaml",
      technique: "Axial and coronal T1 and STIR. Sagittal fat suppressed proton density.",
      comparison: "[No previous relevant imaging is available for comparison].",
      findings: [
        "BONES AND SOFT TISSUES:",
        "No fluid collection. No bone marrow oedema. No focal bone lesion. No bony coalition.",
        "",
        "JOINTS:",
        "No significant joint effusion. No capsular thickening.",
        "",
        "LIGAMENTS:",
        "Normal ankle joint alignment. Normal medial and lateral ligamentous complexes. Normal plantar fascia origin. Normal Lisfranc ligament complex.",
        "",
        "TENDONS:",
        "Normal appearances of the medial and peroneal flexor tendons. Normal extensor tendons. Normal Achilles tendon.",
      ].join("\n"),
      impression: "[].",
      signature: SIGNATURE,
    },
    mtKnee: {
      label: "MRI knee", modality: "MRI", source: SOURCES.thurston,
      sourceFile: "yaml/mri_knee.yaml",
      technique: "Fat-saturated proton density axial, sagittal, and coronal. Proton " +
        "density sagittal.",
      comparison: "[No previous relevant imaging is available for comparison].",
      findings: [
        "FLUID:",
        "No significant joint effusion. No popliteal cyst.",
        "",
        "MENISCI:",
        "The medial and lateral menisci are intact.",
        "",
        "LIGAMENTS:",
        "The anterior and posterior cruciate ligaments are intact. The medial and lateral collateral ligaments are intact. The posterolateral corner structures are intact.",
        "",
        "EXTENSOR MECHANISM:",
        "The distal quadriceps and patellar tendons are intact. The patella is normally positioned within the femoral groove. No retinacular disruption.",
        "",
        "BONES AND JOINT:",
        "Normal patellofemoral articular cartilage. Normal medial compartment articular cartilage. Normal lateral compartmental articular cartilage. No fracture, stress reaction, or bone lesion.",
      ].join("\n"),
      impression: "[].",
      signature: SIGNATURE,
    },
    mtLspine: {
      label: "MRI lumbar spine", modality: "MRI", source: SOURCES.thurston,
      sourceFile: "yaml/mri_lspine.yaml",
      technique: "Sagittal T1 and [T2|STIR]. Axial T2 from [L3 to S1].",
      comparison: "[No previous relevant imaging is available for comparison].",
      findings: [
        "The conus terminates at [] and returns normal signal. Normal marrow signal. Normal spinal alignment.",
        "",
        "L3/4: []",
        "L4/5: []",
        "L5/S1: []",
      ].join("\n"),
      impression: "[].",
      signature: SIGNATURE,
    },
    mtPelvis: {
      label: "MRI pelvis (musculoskeletal)", modality: "MRI", source: SOURCES.thurston,
      sourceFile: "yaml/mri_pelvis.yaml",
      technique: "Axial and coronal T1 and STIR.",
      comparison: "[No previous relevant imaging is available for comparison].",
      findings: [
        "SOFT TISSUES:",
        "No organised fluid collection. No soft tissue lesion.",
        "",
        "JOINTS:",
        "Hip joint articular cartilage appears preserved. No effusion. No labral abnormality. Normal pubic symphysis. No capsular thickening. Preserved sacroiliac joint space with no oedema or fatty changes.",
        "",
        "BONES:",
        "No acute femoral or pelvic fracture. No focal bone lesion.",
        "",
        "MUSCLES:",
        "The muscles return normal symmetrical signal with no fatty or oedematous changes. No tendon injury identified. Normal common hamstring origins. Normal trochanteric bursa appearances.",
        "",
        "PELVIC CONTENTS:",
        "No free fluid. The hernial orifices appear clear.",
      ].join("\n"),
      impression: "[].",
      signature: SIGNATURE,
    },
    mtShoulder: {
      label: "MRI shoulder", modality: "MRI", source: SOURCES.thurston,
      sourceFile: "yaml/mri_shoulder.yaml",
      technique: "Axial fat suppressed proton density. Coronal proton density and fat " +
        "suppressed. Sagittal T2.",
      comparison: "[No previous relevant imaging is available for comparison].",
      findings: [
        "ROTATOR CUFF:",
        "The supraspinatus, infraspinatus, subscapularis and teres minor tendons have normal appearance with no evidence of tear or tendinopathy.",
        "",
        "MUSCLES:",
        "The muscles return normal signal with no fatty or oedematous changes.",
        "",
        "BICEPS:",
        "The biceps tendon is intact and normally located in the bicipital groove. No evidence of synovitis.",
        "",
        "ROTATOR INTERVAL:",
        "No thickening of the soft tissues. Normal coracoclavicular or coracohumeral ligaments. Normal intraarticular component of the long head of biceps.",
        "",
        "FLUID:",
        "No bursitis. No organised fluid collection.",
        "",
        "JOINTS:",
        "The acromioclavicular joint has a normal appearance with no inflammation or degenerative change. The glenoid labrum and glenoid and humeral head cartilage appear normal. The glenohumeral ligaments are unremarkable. The capsule has a normal appearance. No loose bodies are identified.",
        "",
        "BONES:",
        "No acute fracture. No focal bone lesion.",
        "",
        "SOFT TISSUES:",
        "No additional soft tissue or thoracic abnormality identified.",
      ].join("\n"),
      impression: "[].",
      signature: SIGNATURE,
    },
    mtTspine: {
      label: "MRI thoracic spine", modality: "MRI", source: SOURCES.thurston,
      sourceFile: "yaml/mri_tspine.yaml",
      technique: "Sagittal T2 counting scan. Sagittal T1, T2, and fat suppressed. " +
        "Axial T2 from [].",
      comparison: "[No previous relevant imaging is available for comparison].",
      findings: [
        "The conus terminates at [] and returns normal signal. Normal marrow signal. Normal spinal alignment.",
        "No disc herniation or significant bulge. Perserved spinal canal and exit foramina. No paraspinal soft tissue abnormality.",
      ].join("\n"),
      impression: "[].",
      signature: SIGNATURE,
    },
    mtWrist: {
      label: "MRI wrist", modality: "MRI", source: SOURCES.thurston,
      sourceFile: "yaml/mri_wrist.yaml",
      technique: "Axial T1 and fat suppressed.  Coronal proton density and fat " +
        "suppressed proton density. Sagittal STIR.",
      comparison: "[No previous relevant imaging is available for comparison].",
      findings: [
        "BONES:",
        "No fracture. No bone marrow oedema. No focal bone lesion. Normal carpal bone alignment.",
        "",
        "SOFT TISSUES:",
        "No fluid collection. Normal triangular fibrocartilage complex.",
        "",
        "JOINTS:",
        "No significant joint effusion. No synovial thickening.",
        "",
        "TENDONS:",
        "Normal appearances of the flexor and extensor tendons.",
      ].join("\n"),
      impression: "[].",
      signature: SIGNATURE,
    },
    trCtpa: {
      label: "CT pulmonary angiogram (alternate)", modality: "CT", source: SOURCES.rawet,
      sourceFile: "examples/template_CT_CTPA.txt",
      technique: "",
      comparison: "Comparison is made with previous studies, most recently [].",
      findings: [
        "Contrast opacification of the pulmonary trunk is of diagnostic quality [] HU.",
        "The study is negative for pulmonary embolism.",
        "",
        "The lungs and pleural spaces are clear. ",
        "Unremarkable mediastinal appearances. ",
        "Unremarkable appearances of the partially visualised abdominal contents. ",
        "No size significant lymph nodes. No aggressive bone lesion. ",
      ].join("\n"),
      impression: "Study is negative for pulmonary embolism.",
    },
    trStroke: {
      label: "CT stroke angiogram", modality: "CT", source: SOURCES.rawet,
      sourceFile: "examples/template_CT_StrokeAngiogram.txt",
      technique: "",
      comparison: "No previous study is available for comparison.",
      findings: [
        "No acute intracranial haemorrhage noted. No mass effect or herniation. No evidence of an evolving territorial infarct.",
        "",
        "Aortic arch: Normal.",
        "Subclavian arteries: Normal.",
        "Right common and internal carotid artery: Normal.",
        "Left common and internal carotid artery: Normal.",
        "Vertebral arteries: Normal. Normal.",
        "Intracranial vessels: No large vessel occlusion as a mechanical thrombectomy target. No evidence of significant stenosis, thrombus, aneurysm or dissection within the carotid, vertebral or intracranial circulation. There is also no evidence of any AVM or dural fistula.",
        "Normal opacification of the superficial and deep venous systems is also observed.",
        "",
        "Unremarkable appearances of the lung apices, head and neck soft tissues, and visualised bones.",
      ].join("\n"),
      impression: [
        "- No acute intracranial pathology identified.  ",
        "- Intracranial circulation is unremarkable with no vascular malformation, aneurysm or stenosis. No branch occlusion.",
      ].join("\n"),
    },
  };

  /** Display order: this viewer's own skeletons first, then the imports. */
  var ORDER = [
    "blank", "ctHead", "ctChest", "ctAbdomen", "mrBrain", "mrSpine",
    "mtCtpa", "trCtpa", "trStroke",
    "mtCspine", "mtTspine", "mtLspine",
    "mtShoulder", "mtElbow", "mtWrist",
    "mtPelvis", "mtKnee", "mtAnkle", "mtFoot",
  ];

  /**
   * Bracketed spans the template's author left to be filled in.
   *
   * Matches `[]`, `[No PE]` and `[T2|STIR]` alike. It deliberately does not
   * try to be clever about brackets that are part of the prose: a false
   * positive costs one glance, a missed placeholder can be signed.
   */
  var PLACEHOLDER = /\[[^\][]*\]/g;

  function placeholdersIn(text) {
    if (!text) return [];
    return String(text).match(PLACEHOLDER) || [];
  }

  /** Every unfilled placeholder in a draft, with the section it sits in. */
  function placeholders(data, sections) {
    var out = [];
    (sections || []).forEach(function (sec) {
      placeholdersIn(data[sec.key]).forEach(function (hit) {
        out.push({ section: sec.label, text: hit });
      });
    });
    return out;
  }

  /** One line of attribution, for the report footer and the UI. */
  function credit(tpl) {
    if (!tpl || !tpl.source) return "";
    var s = tpl.source;
    if (s.license === "MIT") return "";           // this viewer's own text
    return "Template: " + tpl.label + " — " + s.copyright + ", " + s.license +
      " (" + s.collection + (tpl.sourceFile ? " · " + tpl.sourceFile : "") + ")";
  }

  global.CTTemplates = {
    TEMPLATES: TEMPLATES,
    ORDER: ORDER,
    SOURCES: SOURCES,
    PLACEHOLDER: PLACEHOLDER,
    placeholdersIn: placeholdersIn,
    placeholders: placeholders,
    credit: credit,
    get: function (key) { return TEMPLATES[key] || null; },
  };
})(typeof window !== "undefined" ? window : globalThis);
