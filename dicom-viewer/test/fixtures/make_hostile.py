"""A DICOM file whose header strings are markup and script.

Every string in a DICOM header is attacker-controlled: anyone can hand you a
file, and the viewer puts patient name, series description and every private
tag on screen. This fixture puts real injection payloads in those fields so
the question "are they escaped" can be answered by loading the file rather
than by reading the source.

The pixel data is an ordinary phantom, so the series loads and reconstructs
normally and the strings actually reach the interface.
"""

# Fixtures are written beside this script by default. Set CT_FIXTURES to put
# the generated DICOM somewhere else — a checkout does not carry them.
import os as _os
OUT_ROOT = _os.environ.get('CT_FIXTURES', _os.path.dirname(_os.path.abspath(__file__)))

import os, shutil, numpy as np
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

OUT = _os.path.join(OUT_ROOT, 'series-hostile')
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)

ROWS = COLS = 96
DEPTH = 12

# Payloads chosen to break out of each context the viewer uses: element text,
# a double-quoted attribute, and a URL.
IMG = '<img src=x onerror=window.__pwned(\'{}\')>'
PAYLOADS = {
    'name':       IMG.format('patient-name'),
    'id':         '"><script>window.__pwned("patient-id")</script>',
    'study_desc': IMG.format('study-desc'),
    'series_desc': '</span><svg onload=window.__pwned("series-desc")>',
    'accession':  "' onmouseover='window.__pwned(\"accession\")",
    'institution': 'javascript:window.__pwned("institution")',
    'manufacturer': '<iframe src=javascript:window.__pwned("manufacturer")></iframe>',
    'body_part':  '&lt;already-escaped&gt; & raw < > " \'',
}

study, series, fref = generate_uid(), generate_uid(), generate_uid()
yy, xx = np.meshgrid(np.arange(ROWS), np.arange(COLS), indexing='ij')
cx = cy = (COLS - 1) / 2

for k in range(DEPTH):
    hu = np.full((ROWS, COLS), -1000.0)
    hu[(((xx - cx) / 34.0) ** 2 + ((yy - cy) / 28.0) ** 2) <= 1.0] = 40.0
    hu[np.hypot(xx - cx, yy - cy) < 9] = 300.0
    stored = np.clip(hu + 1024.0, 0, 4095).astype(np.uint16)

    fm = Dataset()
    fm.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.2'
    fm.MediaStorageSOPInstanceUID = generate_uid()
    fm.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = FileDataset(None, {}, file_meta=fm, preamble=b'\0' * 128)
    ds.SOPClassUID = fm.MediaStorageSOPClassUID
    ds.SOPInstanceUID = fm.MediaStorageSOPInstanceUID
    ds.Modality = 'CT'
    ds.PatientName = PAYLOADS['name']
    ds.PatientID = PAYLOADS['id']
    ds.StudyDate = '20260929'
    ds.AccessionNumber = PAYLOADS['accession']
    ds.StudyInstanceUID = study
    ds.SeriesInstanceUID = series
    ds.FrameOfReferenceUID = fref
    ds.StudyDescription = PAYLOADS['study_desc']
    ds.SeriesDescription = PAYLOADS['series_desc']
    ds.InstitutionName = PAYLOADS['institution']
    ds.Manufacturer = PAYLOADS['manufacturer']
    ds.BodyPartExamined = PAYLOADS['body_part']
    ds.SeriesNumber = 1
    ds.InstanceNumber = k + 1
    ds.Rows, ds.Columns = ROWS, COLS
    ds.PixelSpacing = [1.0, 1.0]
    ds.SliceThickness = 2.0
    ds.SpacingBetweenSlices = 2.0
    ds.ImagePositionPatient = [0.0, 0.0, k * 2.0]
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.RescaleSlope = 1.0
    ds.RescaleIntercept = -1024.0
    ds.RescaleType = 'HU'
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = 'MONOCHROME2'
    ds.BitsAllocated = 16
    ds.BitsStored = 12
    ds.HighBit = 11
    ds.PixelRepresentation = 0
    ds.WindowWidth = 400
    ds.WindowCenter = 40
    ds.save_as(os.path.join(OUT, f'{k:03d}.dcm'), enforce_file_format=True)

print(f'wrote {DEPTH} slices with injection payloads in {len(PAYLOADS)} header fields')
for key, val in PAYLOADS.items():
    print(f'  {key:14s} {val[:56]}')

# ---------------------------------------------------------------------------
# A second series whose identifiers are JavaScript's inherited property names.
#
# The viewer keys its series, volume and cache dictionaries by values taken
# straight out of the header. A plain {} answers truthily for "__proto__",
# "constructor" and "toString" whether or not anything was ever stored under
# them, so a file naming itself one of those is read as an already-loaded
# series and then used as one. Writing to "__proto__" on a plain object does
# not even create a key: it replaces the object's prototype.
#
# These are legal DICOM files in every respect except that the UIDs are not
# valid UIDs, which is exactly the kind of file a viewer has to survive.
POISON = ['__proto__', 'constructor', 'toString']

for idx, name in enumerate(POISON):
    for k in range(2):
        hu = np.full((ROWS, COLS), -1000.0)
        hu[20:76, 20:76] = 60.0 + idx * 40
        stored = np.clip(hu + 1024.0, 0, 4095).astype(np.uint16)

        fm = Dataset()
        fm.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.2'
        fm.MediaStorageSOPInstanceUID = generate_uid()
        fm.TransferSyntaxUID = ExplicitVRLittleEndian
        ds = FileDataset(None, {}, file_meta=fm, preamble=b'\0' * 128)
        ds.SOPClassUID = fm.MediaStorageSOPClassUID
        ds.SOPInstanceUID = fm.MediaStorageSOPInstanceUID
        ds.Modality = 'CT'
        ds.PatientName = 'PROTO^POISON'
        ds.PatientID = name
        ds.StudyDate = '20260610'
        ds.StudyInstanceUID = name            # study dictionaries too
        ds.SeriesInstanceUID = name
        ds.FrameOfReferenceUID = name
        ds.StudyDescription = 'PROTOTYPE POISON'
        ds.SeriesDescription = name
        ds.SeriesNumber = 90 + idx
        ds.InstanceNumber = k + 1
        ds.Rows, ds.Columns = ROWS, COLS
        ds.PixelSpacing = [1.0, 1.0]
        ds.SliceThickness = 1.0
        ds.ImagePositionPatient = [0.0, 0.0, float(k)]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.RescaleSlope = 1.0
        ds.RescaleIntercept = -1024.0
        ds.RescaleType = 'HU'
        ds.WindowWidth = 400
        ds.WindowCenter = 40
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = 'MONOCHROME2'
        ds.BitsAllocated = 16
        ds.BitsStored = 12
        ds.HighBit = 11
        ds.PixelRepresentation = 0
        ds.PixelData = stored.tobytes()
        ds.is_little_endian, ds.is_implicit_VR = True, False
        ds.save_as(os.path.join(OUT, 'poison_%d_%03d.dcm' % (idx, k)),
                   enforce_file_format=True)

print('plus %d files whose UIDs are %s' % (len(POISON) * 2, ', '.join(POISON)))
