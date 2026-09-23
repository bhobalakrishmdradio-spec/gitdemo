/* ==========================================================================
   CT Console — report drafting.

   Findings and impression against the study on screen, saved locally so a
   draft survives a reload.

   Two rules from the base plan shape this:

     · A report is bound to one Study Instance UID. Changing study must never
       leave the previous study's text attached to the new one, so the draft
       is keyed on the study and swapped whenever the study does.

     · Drafts are the radiologist's words, not image data. They are kept
       apart from the DICOM objects and can be deleted independently.

   Storage is the browser's localStorage, which means the draft stays on this
   device and is readable by anyone with access to this browser profile. That
   is appropriate for a personal tool and is stated plainly in the UI.
   ========================================================================== */
(function (global) {
  "use strict";

  var PREFIX = "ctconsole.report.";
  var VERSION = 1;

  /** Section order is the order a report is read in. */
  var SECTIONS = [
    { key: "history", label: "Clinical history" },
    { key: "technique", label: "Technique" },
    { key: "findings", label: "Findings" },
    { key: "impression", label: "Impression" },
  ];

  /* Starter text, not a substitute for reading the images. Each is a
     skeleton of headings a report of that kind usually covers. */
  var TEMPLATES = {
    ctHead: {
      label: "CT head",
      technique: "Non-contrast axial CT of the brain.",
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
      label: "CT chest",
      technique: "Volumetric CT of the thorax.",
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
      label: "CT abdomen / pelvis",
      technique: "CT of the abdomen and pelvis.",
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
      label: "MRI brain",
      technique: "Multiplanar multisequence MRI of the brain.",
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
      label: "MRI spine",
      technique: "Multiplanar MRI of the spine.",
      findings: [
        "Alignment and vertebral bodies:",
        "Discs, level by level:",
        "Spinal canal and exit foramina:",
        "Cord signal:",
        "Paraspinal soft tissues:",
      ].join("\n"),
      impression: "",
    },
    blank: { label: "Blank", technique: "", findings: "", impression: "" },
  };

  function key(studyUid) { return PREFIX + studyUid; }

  function empty() {
    return {
      version: VERSION,
      history: "", technique: "", findings: "", impression: "",
      status: "draft",
      keyImages: [],
      updated: null,
    };
  }

  /**
   * Read the draft for one study. Returns a blank draft rather than null, so
   * a caller can never accidentally show another study's text.
   */
  function load(studyUid) {
    if (!studyUid) return empty();
    try {
      var raw = global.localStorage.getItem(key(studyUid));
      if (!raw) return empty();
      var parsed = JSON.parse(raw);
      var out = empty();
      SECTIONS.forEach(function (s) {
        if (typeof parsed[s.key] === "string") out[s.key] = parsed[s.key];
      });
      out.status = parsed.status === "final" ? "final" : "draft";
      out.keyImages = Array.isArray(parsed.keyImages) ? parsed.keyImages : [];
      out.updated = parsed.updated || null;
      return out;
    } catch (err) {
      // A corrupt or blocked store must not take the viewer down with it.
      return empty();
    }
  }

  function save(studyUid, data) {
    if (!studyUid) return false;
    var record = {
      version: VERSION,
      status: data.status === "final" ? "final" : "draft",
      keyImages: data.keyImages || [],
      updated: new Date().toISOString(),
    };
    SECTIONS.forEach(function (s) { record[s.key] = data[s.key] || ""; });
    try {
      global.localStorage.setItem(key(studyUid), JSON.stringify(record));
      return record.updated;
    } catch (err) {
      return false;
    }
  }

  function remove(studyUid) {
    try { global.localStorage.removeItem(key(studyUid)); return true; }
    catch (err) { return false; }
  }

  /** Study UIDs that have a stored draft. */
  function list() {
    var out = [];
    try {
      for (var i = 0; i < global.localStorage.length; i++) {
        var k = global.localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) out.push(k.slice(PREFIX.length));
      }
    } catch (err) { /* storage unavailable */ }
    return out;
  }

  /** True when there is anything worth keeping. */
  function isEmpty(data) {
    return SECTIONS.every(function (s) { return !(data[s.key] || "").trim(); }) &&
      !(data.keyImages && data.keyImages.length);
  }

  /**
   * Render a report as plain text, ready to paste into a reporting system.
   * `header` carries the study identity; sections with no text are omitted
   * rather than printed as empty headings.
   */
  function format(header, data) {
    var lines = [];
    (header || []).forEach(function (row) {
      if (row[1]) lines.push(row[0] + ": " + row[1]);
    });
    if (lines.length) lines.push("");

    SECTIONS.forEach(function (s) {
      var text = (data[s.key] || "").trim();
      if (!text) return;
      lines.push(s.label.toUpperCase());
      lines.push(text);
      lines.push("");
    });

    if (data.keyImages && data.keyImages.length) {
      lines.push("KEY IMAGES");
      data.keyImages.forEach(function (img, i) {
        lines.push("  " + (i + 1) + ". " + img.caption);
      });
      lines.push("");
    }

    lines.push(data.status === "final" ? "[Final]" : "[Draft — not finalised]");
    if (data.updated) lines.push("Last edited: " + new Date(data.updated).toLocaleString());
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  global.CTReport = {
    SECTIONS: SECTIONS,
    TEMPLATES: TEMPLATES,
    empty: empty,
    load: load,
    save: save,
    remove: remove,
    list: list,
    isEmpty: isEmpty,
    format: format,
  };
})(typeof window !== "undefined" ? window : globalThis);
