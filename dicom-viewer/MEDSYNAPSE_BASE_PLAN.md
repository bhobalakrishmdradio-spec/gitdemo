# MedSynapse DICOM Viewer — Base Plan for Claude

Prepared: 23 September 2026

## 1. Purpose and access limits

This document is a product and development blueprint for an independent DICOM viewer inspired by Medsynaptic's MedSynapse platform. “Base plan” means a functional specification and implementation roadmap, not a pricing plan.

The public Medsynaptic product pages were accessible. The authenticated viewer, private source code, internal architecture, and hospital installations were not accessed. This is not an official MedSynapse specification or a reverse-engineered codebase.

Section 2 summarizes vendor-documented capabilities. All subsequent design, architecture, priorities, and acceptance criteria are proposed requirements for a new implementation. They must not be presented as verified details of MedSynapse's internals.

## 2. Verified public product baseline

### MedSynapse RIS-PACS

The vendor describes an enterprise platform combining radiology workflow, image management, and reporting. Listed capabilities include:

- Browser-based, zero-footprint access and 2D/3D viewing.
- Configurable hanging protocols and personal worklists with roaming profiles.
- Multisite worklists and prior-examination tracking.
- Registration, scheduling, ordering, and inventory modules.
- DICOM modality worklist and performed-procedure-step support.
- Reporting with speech-to-text, digital signatures, and structured templates.
- Patient/clinician portals, peer review, collaboration, and analytics.
- Advanced visualization options including fusion, segmentation, and lesion tracking.

These are vendor claims across the product offering; availability in a particular installation or license was not verified. [Official RIS-PACS page](https://www.medsynaptic.com/service/ris-pacs/)

### MedSynapse Teleradiology

The related cloud offering documents DICOM-router uploads, case assignment and prioritization, personal worklists, MIP/MPR/3D/fusion viewing, reporting templates, dictation, report delivery, dashboards, and integration with PACS/RIS/EMR. [Official Teleradiology page](https://www.medsynaptic.com/service/teleradiology/)

### Product identity

This brief concerns MedSynapse by Medsynaptic. Do not confuse it with Fujifilm Synapse, MedDream, or MeddPACS. Exact viewer version, installed modules, supported formats, API contracts, and licensing remain unverified. Broad descriptions such as “advanced tools” do not establish an exact tool-by-tool support matrix.

## 3. Proposed product objective

Build a browser-based DICOM viewer with a study worklist, reliable 2D image review, comparison, measurements, and basic reporting. Keep the imaging engine independent of hospital workflow services so the first prototype can run on de-identified local studies.

The target is a working application that displays real DICOM pixel data. A visual mockup alone does not satisfy the plan.

### Proposed user roles

| Role | Intended access |
|---|---|
| Radiologist | Assigned studies, prior comparisons, measurements, report drafting and authorized finalization |
| Technician | Study import, metadata review, transfer status, workflow preparation |
| Referring clinician | Authorized images and released reports |
| Administrator | User roles, site configuration, integrations, audit review |

The first local prototype can omit accounts. Any shared deployment must enforce permissions on the server, including image and report access.

## 4. First-version scope

| Component | Proposed requirement |
|---|---|
| Study import | Open local DICOM files/folders with progress, cancellation, and per-file errors |
| Worklist | Search/filter by patient context, accession, date, modality, and study description |
| Series browser | Thumbnails, series labels, modality, frame count, and loading state |
| Image navigation | Slice scrolling, frame selection, keyboard navigation, cine for supported sequences |
| Display | Window/level, editable presets, zoom, pan, rotate, flip, invert, reset |
| Measurements | Distance, angle, ellipse ROI area and supported pixel statistics |
| Layouts | One, two, and four viewports; clear active-panel selection |
| Comparison | Current/prior selection and optional spatial linking when geometry permits |
| Metadata | Searchable DICOM tags and configurable patient/image overlays |
| Reporting | Findings and impression fields, draft saving, study linkage |
| Export | Rendered image export with explicit annotation and overlay options |

Start with a declared subset of conventional CT/MR stacks and radiographs. List supported SOP Classes, transfer syntaxes, and color models. Unsupported objects must produce clear messages rather than misleading displays.

Full RIS scheduling, inventory, billing, portal delivery, speech recognition, advanced 3D, AI, and hospital integration are later phases.

## 5. Proposed screens and workflow

### Worklist

Provide study search, filters, sortable columns, import status, and an open-study action. For a shared deployment, add assignment, priority, and reporting status. Distinguish image availability from report completion.

### Viewer

```text
+-----------------------------------------------------------------------+
| Patient / study context | Prior studies | Layout | Tools | Report       |
+----------------+--------------------------------------+---------------+
| Series         |                                      | Report draft  |
| thumbnails     |          Image viewport(s)            | Findings      |
|                |                                      | Impression    |
| Current/prior  |          Optional comparison          | Key images    |
+----------------+--------------------------------------+---------------+
| Loading / error state | Slice / frame | Window values | Active tool     |
+-----------------------------------------------------------------------+
```

Use a dark image canvas, collapsible side panels, and persistent study identity. Make report editing optional so the imaging workspace can occupy the full screen.

### Proposed reading sequence

1. Find and open an authorized study.
2. Choose series and viewport layout.
3. Review images, adjust display, and measure.
4. Select a relevant prior and compare it explicitly.
5. Draft findings and impression; optionally reference key images.
6. Save the draft or finalize through an authorized workflow.

Changing patients must not silently leave an unrelated report or prior attached to the new study.

## 6. Proposed architecture

```text
Browser application
  ├─ Worklist and study selection
  ├─ DICOM image display and interaction tools
  ├─ Comparison and layout manager
  └─ Report editor
           │ authenticated requests in shared deployment
Application service
  ├─ Study access and authorization
  ├─ Metadata index and workflow state
  ├─ Report versions and audit events
  └─ Imaging adapter
           │
Archive / DICOM gateway / controlled file storage
```

For Phase 1, a local file adapter can feed the viewer directly. Later, introduce a server adapter without rewriting the tools. Evaluate standard DICOMweb services for browser-facing retrieval and a gateway for conventional DICOM networking. This is a proposed integration approach, not a claim that MedSynapse exposes these APIs.

Select libraries after checking their current official documentation, licenses, supported formats, browser requirements, and maintenance status. No framework or backend language used internally by MedSynapse has been established.

### Data model

- **Patient context:** local identifier plus issuer/site context; do not assume patient IDs are globally unique.
- **Study:** Study Instance UID, accession, date, description, series references.
- **Series:** Series Instance UID, modality, description, instance references.
- **Instance/frame:** SOP Instance UID, frame index, transfer syntax, dimensions, geometry, source location.
- **Viewport state:** selected frame, display transforms, layout position, linking state.
- **Measurement:** image/frame reference, image-space coordinates, units, calibration provenance.
- **Report:** study reference, draft/final status, author, version, timestamps, amendment history.
- **Workflow record:** assignment, priority, site, processing state.

Keep original DICOM data separate from viewer state and report text.

## 7. Correctness and performance requirements

Verify implementation details against the current DICOM standard and selected library documentation.

- Decode actual pixel data with the appropriate signedness, bit depth, photometric interpretation, and display transforms.
- Use applicable calibration metadata for physical measurements; label uncalibrated results honestly.
- Calculate ROI values from quantitative image data, not screen colors. Only label values HU or SUV when the metadata and calculations support those units.
- Assemble spatial stacks using valid geometry while separating time points, echoes, and other acquisition dimensions.
- Preserve orientation labels and measurement anchors during display transformations.
- Link viewports through compatible geometry; cross-study alignment must not be assumed to be registration.
- Treat enhanced multi-frame objects as a distinct capability requiring frame-level interpretation.
- Decode asynchronously, prioritize the visible frame, prefetch nearby frames, and enforce a bounded memory cache.
- Show transfer progress and partial-study state. Handle cancellation, malformed files, unsupported codecs, and missing frames.
- Define performance targets using representative datasets and specified hardware rather than copying vendor speed claims.

## 8. Development roadmap

| Phase | Deliverable | Acceptance gate |
|---|---|---|
| 1: Local viewer | Import, grouping, real decoding, navigation, display controls | Representative supported studies display correctly; invalid inputs fail clearly |
| 2: Review tools | Measurements, multiple panels, comparison, metadata, export | Reference measurements agree within documented tolerances; annotations stay anchored |
| 3: Workflow | Worklist persistence, basic report drafts, user roles for shared use | Correct study/report linkage; authorization enforced; draft recovery works |
| 4: PACS integration | Archive adapter, retrieval, transfer status, controlled server tests | Accurate instance tracking, recoverable failures, authorized access |
| 5: Reconstruction | Orthogonal MPR, then oblique planes and slab projections | Reference landmarks align; invalid geometry is detected |
| 6: Enterprise extensions | Hanging protocols, assignment, report finalization, audit, multisite support | Concurrent edits, status transitions, access boundaries, and recovery are tested |
| 7: Advanced modules | Volume rendering, fusion, segmentation, dictation, portals, AI | Each capability has separate requirements and validation |

Avoid treating a complete RIS-PACS platform as a single first-release task.

## 9. Validation and operational requirements

Use synthetic or appropriately de-identified test studies. Maintain a test matrix for supported formats, orientations, pixel spacings, compression, and failure cases. Compare rendering and quantitative results against trusted references.

For shared use, require authenticated study access, protected transport, audit events, access-controlled storage, and backup/restore verification. Report finalization should preserve the signed version and use amendments for later changes. Avoid patient data in routine diagnostic logs.

Hiding overlays is not de-identification: identifiers can remain in metadata, private attributes, and burned-in pixels. Keep patient data out of Claude uploads; this planning file contains no patient data.

This proposed prototype does not inherit any certification or diagnostic suitability from MedSynapse. Clinical deployment requires its own intended-use assessment and validation.

## 10. Unresolved decisions

Before implementation, establish:

1. Browser-only prototype, local application, or shared hospital deployment?
2. Viewer alone, or viewer plus reporting and worklist?
3. Priority modalities and representative de-identified test datasets?
4. Existing PACS and available interface documentation?
5. Research/education use or intended clinical deployment?

Default planning assumption: begin with a desktop-browser prototype using local de-identified files, then add shared services.

## 11. Ready-to-use Claude prompt

> Use this Markdown document to plan and implement an independent DICOM viewer inspired by MedSynapse's publicly documented workflows. Separate vendor-documented features from the proposed design. Do not claim access to MedSynapse's source code, APIs, or internal architecture.
>
> First establish whether I need only a viewer or a viewer with worklist/reporting, and whether it will run locally or connect to an existing PACS. Propose a suitable stack after checking current primary documentation and licenses. Define supported DICOM formats and explain significant limitations.
>
> Begin with Phase 1: real local DICOM import, correct study/series grouping, pixel decoding, scrolling, window/level, zoom, pan, and reset. Provide a working project, setup instructions, and verification steps. Do not substitute static screenshots for real image handling. Keep image rendering, data access, and workflow modules separate. Use original branding and interface assets.
>
> Add measurements and comparison only after validating the image pipeline. Keep the roadmap ready for reporting, PACS retrieval, MPR, and hanging protocols. Mark incomplete features clearly and never imply the prototype is clinically validated.

## Sources

Public sources reviewed on 23 September 2026:

- [Medsynaptic — MedSynapse RIS-PACS](https://www.medsynaptic.com/service/ris-pacs/)
- [Medsynaptic — MedSynapse Teleradiology](https://www.medsynaptic.com/service/teleradiology/)
- [MedSynapse cloud application entry point](https://cloud.medsynaptic.com/) — application entry only; authenticated functionality was not inspected.

This file contains no private source code, credentials, patient studies, or proprietary application assets.
