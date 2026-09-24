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
    // Comparison is its own section because the imported templates have one,
    // and folding it into Findings buries the single line that says whether
    // a prior was looked at.
    { key: "comparison", label: "Comparison" },
    { key: "findings", label: "Findings" },
    { key: "impression", label: "Impression" },
  ];

  /**
   * Templates live in their own module: the imported collection carries
   * third-party copyright and its own licence, which does not belong mixed
   * into this file's storage code.
   */
  function templates() {
    return (global.CTTemplates && global.CTTemplates.TEMPLATES) || {};
  }

  function key(studyUid) { return PREFIX + studyUid; }

  function empty() {
    var out = {
      version: VERSION,
      status: "draft",
      keyImages: [],
      // Attribution for any template inserted, so a report built from
      // third-party wording carries its credit into the exported text.
      credits: [],
      updated: null,
    };
    SECTIONS.forEach(function (s) { out[s.key] = ""; });
    return out;
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
      out.credits = Array.isArray(parsed.credits) ? parsed.credits : [];
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
      credits: data.credits || [],
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

    // Unfilled placeholders are called out in the exported text as well as
    // on screen: a report is most dangerous once it has left the viewer.
    var open = (global.CTTemplates ? global.CTTemplates.placeholders(data, SECTIONS) : []);
    if (open.length) {
      lines.push("UNFILLED PLACEHOLDERS (" + open.length + ")");
      open.forEach(function (h) { lines.push("  " + h.section + ": " + h.text); });
      lines.push("");
    }

    lines.push(data.status === "final" ? "[Final]" : "[Draft — not finalised]");
    if (data.updated) lines.push("Last edited: " + new Date(data.updated).toLocaleString());

    if (data.credits && data.credits.length) {
      lines.push("");
      data.credits.forEach(function (c) { lines.push(c); });
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  global.CTReport = {
    SECTIONS: SECTIONS,
    templates: templates,
    empty: empty,
    load: load,
    save: save,
    remove: remove,
    list: list,
    isEmpty: isEmpty,
    format: format,
  };
})(typeof window !== "undefined" ? window : globalThis);
