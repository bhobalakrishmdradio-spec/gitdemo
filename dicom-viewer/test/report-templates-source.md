# CT and MRI Report Templates — Downloaded Source Collection

Source: [mdvthu/report-templates](https://github.com/mdvthu/report-templates). Retrieved 23 September 2026.  
Pinned source revision: `f313efb39e8f02c72efc2ae0b3269b38422dd49b`.  
License: Apache License 2.0; full text included below.

## Scope and authenticity

This collection contains **13 template entries: 3 CT entries (two CTPA variants and one stroke angiogram) and 10 MRI entries**. MRI coverage: ankle, cervical spine, elbow, foot, knee, lumbar spine, musculoskeletal pelvis, shoulder, thoracic spine, and wrist. This is all non-interventional CT/MRI template content found in this repository revision, not an exhaustive radiology library. MRI brain, abdominal MRI, routine CT chest, and routine CT abdomen/pelvis are not included. These are original public-source templates, **not MedSynapse templates**.

Clinical wording and placeholders were retained. YAML templates were rendered using the repository's report layout; the example signature was replaced with `[Reporting radiologist name and credentials]`. Attribution, headings, index, and packaging notes were added. No missing clinical findings or additional protocols were generated. The ZIP includes the original source files for comparison.

These templates contain normal-default statements. Every finding, technique, comparison, and impression must be checked and edited for the actual examination before use. This download is for template import/cross-checking, not evidence that a particular study is normal.

## Instructions for Claude

Import each numbered entry as a separate report template. Preserve wording, placeholders, attribution, and source identity. Do not merge the two CTPA variants. Treat MRI pelvis here as a musculoskeletal template. Keep templates separate from patient reports and do not auto-finalize normal findings. Flag unresolved placeholders and do not invent missing findings. The clinical text is inside each fenced block; surrounding metadata is not report text.

## Index

1. [CT pulmonary angiogram](#template-01)
2. [MRI ankle](#template-02)
3. [MRI cervical spine](#template-03)
4. [MRI elbow](#template-04)
5. [MRI foot](#template-05)
6. [MRI knee](#template-06)
7. [MRI lumbar spine](#template-07)
8. [MRI pelvis](#template-08)
9. [MRI shoulder](#template-09)
10. [MRI thoracic spine](#template-10)
11. [MRI wrist](#template-11)
12. [CT pulmonary angiogram — alternate original example](#template-12)
13. [CT stroke angiogram — original example](#template-13)

---

<a id="template-01"></a>
## 01. CT pulmonary angiogram

- Copyright: 2024 Mark Thurston.
- License: Apache-2.0.
- [Original source](https://github.com/mdvthu/report-templates/blob/f313efb39e8f02c72efc2ae0b3269b38422dd49b/yaml/ct_ctpa.yaml)
- Conversion: Rendered from the original YAML using the original report layout. The demonstration signature was replaced with a neutral placeholder; clinical wording was retained.

```text
Technique: Pulmonary arterial phase CT chest [including|excluding] the extreme apices and bases. Diagnostic pulmonary trunk contrast opacification ([] Hounsfield units).

Comparison: [No previous relevant imaging is available for comparison].

Findings:

Negative for pulmonary embolism. The lungs and pleural spaces are clear. Unremarkable mediastinal appearances. Unremarkable appearances of the partially visualised abdominal contents. No size significant lymph nodes. No aggressive bone lesion.


Impression: [No PE].


[Reporting radiologist name and credentials]
```

---

<a id="template-02"></a>
## 02. MRI ankle

- Copyright: 2024 Mark Thurston.
- License: Apache-2.0.
- [Original source](https://github.com/mdvthu/report-templates/blob/f313efb39e8f02c72efc2ae0b3269b38422dd49b/yaml/mri_ankle.yaml)
- Conversion: Rendered from the original YAML using the original report layout. The demonstration signature was replaced with a neutral placeholder; clinical wording was retained.

```text
Technique: Axial proton density and fat suppressed proton density. Coronal T1 and STIR. Sagittal STIR.

Comparison: [No previous relevant imaging is available for comparison].

Findings:

BONES AND SOFT TISSUES:
No fluid collection. No bone marrow oedema. No focal bone lesion.

JOINTS:
No significant joint effusion. No capsular thickening.

LIGAMENTS:
Normal ankle joint alignment. Normal medial and lateral ligamentous complexes. Normal plantar fascia origin.

TENDONS:
Normal appearances of the medial and peroneal flexor tendons. Normal extensor tendons. Normal Achilles tendon.


Impression: [].


[Reporting radiologist name and credentials]
```

---

<a id="template-03"></a>
## 03. MRI cervical spine

- Copyright: 2024 Mark Thurston.
- License: Apache-2.0.
- [Original source](https://github.com/mdvthu/report-templates/blob/f313efb39e8f02c72efc2ae0b3269b38422dd49b/yaml/mri_cspine.yaml)
- Conversion: Rendered from the original YAML using the original report layout. The demonstration signature was replaced with a neutral placeholder; clinical wording was retained.

```text
Technique: Sagittal T1 and [T2|STIR]. Axial T2 from [C2-T1].

Comparison: [No previous relevant imaging is available for comparison].

Findings:

The posterior cranial fossa and craniocervical junction return normal signal. Normal marrow signal. Normal spinal alignment.

C2/3: []
C3/4: []
C4/5: []
C5/6: []
C6/7: []
C7/T1: []


Impression: [].


[Reporting radiologist name and credentials]
```

---

<a id="template-04"></a>
## 04. MRI elbow

- Copyright: 2024 Mark Thurston.
- License: Apache-2.0.
- [Original source](https://github.com/mdvthu/report-templates/blob/f313efb39e8f02c72efc2ae0b3269b38422dd49b/yaml/mri_elbow.yaml)
- Conversion: Rendered from the original YAML using the original report layout. The demonstration signature was replaced with a neutral placeholder; clinical wording was retained.

```text
Technique: Axial proton density and fat suppressed. Sagittal and coronal T1 and STIR.

Comparison: [No previous relevant imaging is available for comparison].

Findings:

BONES:
No bone oedema or deformity. Normal appearances of the distal humerus, radial head, and proximal ulna (including coronoid process).

JOINT:
No significant joint effusion, intra-articular fragments, or loose bodies. Joint space and articular cartilage are preserved. No synovial thickening.

SOFT TISSUES AND TENDONS:
The common flexor and common extensor origins appear intact with no evidence of tendinopathy. The distal biceps tendon appears intact with no associated oedema. The distal triceps tendon appears intact with no tear or tendinopathy. Normal olecranon soft tissues; no bursitis. The imaged ulnar, median, and radial nerves appear normal in contour and location.


Impression: [].


[Reporting radiologist name and credentials]
```

---

<a id="template-05"></a>
## 05. MRI foot

- Copyright: 2024 Mark Thurston.
- License: Apache-2.0.
- [Original source](https://github.com/mdvthu/report-templates/blob/f313efb39e8f02c72efc2ae0b3269b38422dd49b/yaml/mri_foot.yaml)
- Conversion: Rendered from the original YAML using the original report layout. The demonstration signature was replaced with a neutral placeholder; clinical wording was retained.

```text
Technique: Axial and coronal T1 and STIR. Sagittal fat suppressed proton density.

Comparison: [No previous relevant imaging is available for comparison].

Findings:

BONES AND SOFT TISSUES:
No fluid collection. No bone marrow oedema. No focal bone lesion. No bony coalition.

JOINTS:
No significant joint effusion. No capsular thickening.

LIGAMENTS:
Normal ankle joint alignment. Normal medial and lateral ligamentous complexes. Normal plantar fascia origin. Normal Lisfranc ligament complex.

TENDONS:
Normal appearances of the medial and peroneal flexor tendons. Normal extensor tendons. Normal Achilles tendon.


Impression: [].


[Reporting radiologist name and credentials]
```

---

<a id="template-06"></a>
## 06. MRI knee

- Copyright: 2024 Mark Thurston.
- License: Apache-2.0.
- [Original source](https://github.com/mdvthu/report-templates/blob/f313efb39e8f02c72efc2ae0b3269b38422dd49b/yaml/mri_knee.yaml)
- Conversion: Rendered from the original YAML using the original report layout. The demonstration signature was replaced with a neutral placeholder; clinical wording was retained.

```text
Technique: Fat-saturated proton density axial, sagittal, and coronal. Proton density sagittal.

Comparison: [No previous relevant imaging is available for comparison].

Findings:

FLUID:
No significant joint effusion. No popliteal cyst.

MENISCI:
The medial and lateral menisci are intact.

LIGAMENTS:
The anterior and posterior cruciate ligaments are intact. The medial and lateral collateral ligaments are intact. The posterolateral corner structures are intact.

EXTENSOR MECHANISM:
The distal quadriceps and patellar tendons are intact. The patella is normally positioned within the femoral groove. No retinacular disruption.

BONES AND JOINT:
Normal patellofemoral articular cartilage. Normal medial compartment articular cartilage. Normal lateral compartmental articular cartilage. No fracture, stress reaction, or bone lesion.


Impression: [].


[Reporting radiologist name and credentials]
```

---

<a id="template-07"></a>
## 07. MRI lumbar spine

- Copyright: 2024 Mark Thurston.
- License: Apache-2.0.
- [Original source](https://github.com/mdvthu/report-templates/blob/f313efb39e8f02c72efc2ae0b3269b38422dd49b/yaml/mri_lspine.yaml)
- Conversion: Rendered from the original YAML using the original report layout. The demonstration signature was replaced with a neutral placeholder; clinical wording was retained.

```text
Technique: Sagittal T1 and [T2|STIR]. Axial T2 from [L3 to S1].

Comparison: [No previous relevant imaging is available for comparison].

Findings:

The conus terminates at [] and returns normal signal. Normal marrow signal. Normal spinal alignment.

L3/4: []
L4/5: []
L5/S1: []


Impression: [].


[Reporting radiologist name and credentials]
```

---

<a id="template-08"></a>
## 08. MRI pelvis

- Copyright: 2024 Mark Thurston.
- License: Apache-2.0.
- [Original source](https://github.com/mdvthu/report-templates/blob/f313efb39e8f02c72efc2ae0b3269b38422dd49b/yaml/mri_pelvis.yaml)
- Conversion: Rendered from the original YAML using the original report layout. The demonstration signature was replaced with a neutral placeholder; clinical wording was retained.

```text
Technique: Axial and coronal T1 and STIR.

Comparison: [No previous relevant imaging is available for comparison].

Findings:

SOFT TISSUES:
No organised fluid collection. No soft tissue lesion.

JOINTS:
Hip joint articular cartilage appears preserved. No effusion. No labral abnormality. Normal pubic symphysis. No capsular thickening. Preserved sacroiliac joint space with no oedema or fatty changes.

BONES:
No acute femoral or pelvic fracture. No focal bone lesion.

MUSCLES:
The muscles return normal symmetrical signal with no fatty or oedematous changes. No tendon injury identified. Normal common hamstring origins. Normal trochanteric bursa appearances.

PELVIC CONTENTS:
No free fluid. The hernial orifices appear clear.


Impression: [].


[Reporting radiologist name and credentials]
```

---

<a id="template-09"></a>
## 09. MRI shoulder

- Copyright: 2024 Mark Thurston.
- License: Apache-2.0.
- [Original source](https://github.com/mdvthu/report-templates/blob/f313efb39e8f02c72efc2ae0b3269b38422dd49b/yaml/mri_shoulder.yaml)
- Conversion: Rendered from the original YAML using the original report layout. The demonstration signature was replaced with a neutral placeholder; clinical wording was retained.

```text
Technique: Axial fat suppressed proton density. Coronal proton density and fat suppressed. Sagittal T2.

Comparison: [No previous relevant imaging is available for comparison].

Findings:

ROTATOR CUFF:
The supraspinatus, infraspinatus, subscapularis and teres minor tendons have normal appearance with no evidence of tear or tendinopathy.

MUSCLES:
The muscles return normal signal with no fatty or oedematous changes.

BICEPS:
The biceps tendon is intact and normally located in the bicipital groove. No evidence of synovitis.

ROTATOR INTERVAL:
No thickening of the soft tissues. Normal coracoclavicular or coracohumeral ligaments. Normal intraarticular component of the long head of biceps.

FLUID:
No bursitis. No organised fluid collection.

JOINTS:
The acromioclavicular joint has a normal appearance with no inflammation or degenerative change. The glenoid labrum and glenoid and humeral head cartilage appear normal. The glenohumeral ligaments are unremarkable. The capsule has a normal appearance. No loose bodies are identified.

BONES:
No acute fracture. No focal bone lesion.

SOFT TISSUES:
No additional soft tissue or thoracic abnormality identified.


Impression: [].


[Reporting radiologist name and credentials]
```

---

<a id="template-10"></a>
## 10. MRI thoracic spine

- Copyright: 2024 Mark Thurston.
- License: Apache-2.0.
- [Original source](https://github.com/mdvthu/report-templates/blob/f313efb39e8f02c72efc2ae0b3269b38422dd49b/yaml/mri_tspine.yaml)
- Conversion: Rendered from the original YAML using the original report layout. The demonstration signature was replaced with a neutral placeholder; clinical wording was retained.

```text
Technique: Sagittal T2 counting scan. Sagittal T1, T2, and fat suppressed. Axial T2 from [].

Comparison: [No previous relevant imaging is available for comparison].

Findings:

The conus terminates at [] and returns normal signal. Normal marrow signal. Normal spinal alignment.
No disc herniation or significant bulge. Perserved spinal canal and exit foramina. No paraspinal soft tissue abnormality.


Impression: [].


[Reporting radiologist name and credentials]
```

---

<a id="template-11"></a>
## 11. MRI wrist

- Copyright: 2024 Mark Thurston.
- License: Apache-2.0.
- [Original source](https://github.com/mdvthu/report-templates/blob/f313efb39e8f02c72efc2ae0b3269b38422dd49b/yaml/mri_wrist.yaml)
- Conversion: Rendered from the original YAML using the original report layout. The demonstration signature was replaced with a neutral placeholder; clinical wording was retained.

```text
Technique: Axial T1 and fat suppressed.  Coronal proton density and fat suppressed proton density. Sagittal STIR.

Comparison: [No previous relevant imaging is available for comparison].

Findings:

BONES:
No fracture. No bone marrow oedema. No focal bone lesion. Normal carpal bone alignment.

SOFT TISSUES:
No fluid collection. Normal triangular fibrocartilage complex.

JOINTS:
No significant joint effusion. No synovial thickening.

TENDONS:
Normal appearances of the flexor and extensor tendons.


Impression: [].


[Reporting radiologist name and credentials]
```

---

<a id="template-12"></a>
## 12. CT pulmonary angiogram — alternate original example

- Copyright: Thomas Rawet.
- License: Apache-2.0.
- [Original source](https://github.com/mdvthu/report-templates/blob/f313efb39e8f02c72efc2ae0b3269b38422dd49b/examples/template_CT_CTPA.txt)
- Conversion: Original example text retained, including source repetition and punctuation. Markdown packaging only.

```text
Comparison is made with previous studies, most recently [].

Contrast opacification of the pulmonary trunk is of diagnostic quality [] HU.
The study is negative for pulmonary embolism.

The lungs and pleural spaces are clear. 
Unremarkable mediastinal appearances. 
Unremarkable appearances of the partially visualised abdominal contents. 
No size significant lymph nodes. No aggressive bone lesion. 

Conclusion: Study is negative for pulmonary embolism.
```

---

<a id="template-13"></a>
## 13. CT stroke angiogram — original example

- Copyright: Thomas Rawet.
- License: Apache-2.0.
- [Original source](https://github.com/mdvthu/report-templates/blob/f313efb39e8f02c72efc2ae0b3269b38422dd49b/examples/template_CT_StrokeAngiogram.txt)
- Conversion: Original example text retained, including source repetition and punctuation. Markdown packaging only.

```text
No previous study is available for comparison.

No acute intracranial haemorrhage noted. No mass effect or herniation. No evidence of an evolving territorial infarct.

Aortic arch: Normal.
Subclavian arteries: Normal.
Right common and internal carotid artery: Normal.
Left common and internal carotid artery: Normal.
Vertebral arteries: Normal. Normal.
Intracranial vessels: No large vessel occlusion as a mechanical thrombectomy target. No evidence of significant stenosis, thrombus, aneurysm or dissection within the carotid, vertebral or intracranial circulation. There is also no evidence of any AVM or dural fistula.
Normal opacification of the superficial and deep venous systems is also observed.

Unremarkable appearances of the lung apices, head and neck soft tissues, and visualised bones.

Conclusion:
- No acute intracranial pathology identified.  
- Intracranial circulation is unremarkable with no vascular malformation, aneurysm or stenosis. No branch occlusion.
```

## Full source license

```text
Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction, and distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all other entities that control, are controlled by, or are under common control with that entity. For the purposes of this definition, "control" means (i) the power, direct or indirect, to cause the direction or management of such entity, whether by contract or otherwise, or (ii) ownership of fifty percent (50%) or more of the outstanding shares, or (iii) beneficial ownership of such entity.

"You" (or "Your") shall mean an individual or Legal Entity exercising permissions granted by this License.

"Source" form shall mean the preferred form for making modifications, including but not limited to software source code, documentation source, and configuration files.

"Object" form shall mean any form resulting from mechanical transformation or translation of a Source form, including but not limited to compiled object code, generated documentation, and conversions to other media types.

"Work" shall mean the work of authorship, whether in Source or Object form, made available under the License, as indicated by a copyright notice that is included in or attached to the work (an example is provided in the Appendix below).

"Derivative Works" shall mean any work, whether in Source or Object form, that is based on (or derived from) the Work and for which the editorial revisions, annotations, elaborations, or other modifications represent, as a whole, an original work of authorship. For the purposes of this License, Derivative Works shall not include works that remain separable from, or merely link (or bind by name) to the interfaces of, the Work and Derivative Works thereof.

"Contribution" shall mean any work of authorship, including the original version of the Work and any modifications or additions to that Work or Derivative Works thereof, that is intentionally submitted to Licensor for inclusion in the Work by the copyright owner or by an individual or Legal Entity authorized to submit on behalf of the copyright owner. For the purposes of this definition, "submitted" means any form of electronic, verbal, or written communication sent to the Licensor or its representatives, including but not limited to communication on electronic mailing lists, source code control systems, and issue tracking systems that are managed by, or on behalf of, the Licensor for the purpose of discussing and improving the Work, but excluding communication that is conspicuously marked or otherwise designated in writing by the copyright owner as "Not a Contribution."

"Contributor" shall mean Licensor and any individual or Legal Entity on behalf of whom a Contribution has been received by Licensor and subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare Derivative Works of, publicly display, publicly perform, sublicense, and distribute the Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable (except as stated in this section) patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Work, where such license applies only to those patent claims licensable by such Contributor that are necessarily infringed by their Contribution(s) alone or by combination of their Contribution(s) with the Work to which such Contribution(s) was submitted. If You institute patent litigation against any entity (including a cross-claim or counterclaim in a lawsuit) alleging that the Work or a Contribution incorporated within the Work constitutes direct or contributory patent infringement, then any patent licenses granted to You under this License for that Work shall terminate as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the Work or Derivative Works thereof in any medium, with or without modifications, and in Source or Object form, provided that You meet the following conditions:

     (a) You must give any other recipients of the Work or Derivative Works a copy of this License; and

     (b) You must cause any modified files to carry prominent notices stating that You changed the files; and

     (c) You must retain, in the Source form of any Derivative Works that You distribute, all copyright, patent, trademark, and attribution notices from the Source form of the Work, excluding those notices that do not pertain to any part of the Derivative Works; and

     (d) If the Work includes a "NOTICE" text file as part of its distribution, then any Derivative Works that You distribute must include a readable copy of the attribution notices contained within such NOTICE file, excluding those notices that do not pertain to any part of the Derivative Works, in at least one of the following places: within a NOTICE text file distributed as part of the Derivative Works; within the Source form or documentation, if provided along with the Derivative Works; or, within a display generated by the Derivative Works, if and wherever such third-party notices normally appear. The contents of the NOTICE file are for informational purposes only and do not modify the License. You may add Your own attribution notices within Derivative Works that You distribute, alongside or as an addendum to the NOTICE text from the Work, provided that such additional attribution notices cannot be construed as modifying the License.

     You may add Your own copyright statement to Your modifications and may provide additional or different license terms and conditions for use, reproduction, or distribution of Your modifications, or for any such Derivative Works as a whole, provided Your use, reproduction, and distribution of the Work otherwise complies with the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise, any Contribution intentionally submitted for inclusion in the Work by You to the Licensor shall be under the terms and conditions of this License, without any additional terms or conditions. Notwithstanding the above, nothing herein shall supersede or modify the terms of any separate license agreement you may have executed with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade names, trademarks, service marks, or product names of the Licensor, except as required for reasonable and customary use in describing the origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or agreed to in writing, Licensor provides the Work (and each Contributor provides its Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for determining the appropriateness of using or redistributing the Work and assume any risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory, whether in tort (including negligence), contract, or otherwise, unless required by applicable law (such as deliberate and grossly negligent acts) or agreed to in writing, shall any Contributor be liable to You for damages, including any direct, indirect, special, incidental, or consequential damages of any character arising as a result of this License or out of the use or inability to use the Work (including but not limited to damages for loss of goodwill, work stoppage, computer failure or malfunction, or any and all other commercial damages or losses), even if such Contributor has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing the Work or Derivative Works thereof, You may choose to offer, and charge a fee for, acceptance of support, warranty, indemnity, or other liability obligations and/or rights consistent with this License. However, in accepting such obligations, You may act only on Your own behalf and on Your sole responsibility, not on behalf of any other Contributor, and only if You agree to indemnify, defend, and hold each Contributor harmless for any liability incurred by, or claims asserted against, such Contributor by reason of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

To apply the Apache License to your work, attach the following boilerplate notice, with the fields enclosed by brackets "[]" replaced with your own identifying information. (Don't include the brackets!)  The text should be enclosed in the appropriate comment syntax for the file format. We also recommend that a file or class name and description of purpose be included on the same "printed page" as the copyright notice for easier identification within third-party archives.

Copyright [yyyy] [name of copyright owner]

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

```
