"""A 'prior' CT of the same region: different slice thickness and start.

Linking by slice index would line the wrong anatomy up; linking by patient
position must not.
"""

# Fixtures are written beside this script by default. Set CT_FIXTURES to put
# the generated DICOM somewhere else — a checkout does not carry them.
import os as _os
OUT_ROOT = _os.environ.get('CT_FIXTURES', _os.path.dirname(_os.path.abspath(__file__)))

import os, shutil, numpy as np
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

OUT = _os.path.join(OUT_ROOT, 'series-prior')
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)

ROWS = COLS = 96
THICK = 1.0            # 1 mm, against the current study's 2 mm
Z0 = 6.0               # starts 6 mm in
DEPTH = 36             # covers z = 6 .. 41
rng = np.random.default_rng(31)
cx, cy = (COLS - 1) / 2, (ROWS - 1) / 2
yy, xx = np.meshgrid(np.arange(ROWS), np.arange(COLS), indexing='ij')
study, series, fref = generate_uid(), generate_uid(), generate_uid()

for k in range(DEPTH):
    z = Z0 + k * THICK
    hu = np.full((ROWS, COLS), -1000.0)
    body = (((xx - cx) / 40.0) ** 2 + ((yy - cy) / 32.0) ** 2) <= 1.0
    hu[body] = 40.0
    # A marker whose radius is a function of patient Z, so a mis-aligned
    # link is visible as the wrong size.
    r = np.hypot(xx - cx, yy - cy)
    hu[r < 6 + 0.35 * z] = 300.0
    hu[(xx < 10) & body] = 900.0
    hu[body] += rng.normal(0, 6, body.sum())
    stored = np.clip(hu + 1024.0, 0, 4095).astype('<u2')

    ds = FileDataset('p.dcm', Dataset(), file_meta=Dataset(), preamble=b'\0' * 128)
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.2'
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.SOPClassUID = '1.2.840.10008.5.1.4.1.1.2'
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    ds.PatientName = 'CODEC^PHANTOM'; ds.PatientID = 'COD001'; ds.Modality = 'CT'
    ds.StudyInstanceUID, ds.SeriesInstanceUID = study, series
    ds.FrameOfReferenceUID = fref
    ds.StudyDate = '20250101'
    ds.SeriesDescription = 'PRIOR thin 1mm'
    ds.SeriesNumber, ds.InstanceNumber = 9, k + 1
    ds.Rows, ds.Columns = ROWS, COLS
    ds.PixelSpacing = [1.0, 1.0]
    ds.SliceThickness = THICK; ds.SpacingBetweenSlices = THICK
    ds.ImagePositionPatient = [0.0, 0.0, z]
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.SamplesPerPixel = 1; ds.PhotometricInterpretation = 'MONOCHROME2'
    ds.BitsAllocated, ds.BitsStored, ds.HighBit = 16, 12, 11
    ds.PixelRepresentation = 0
    ds.RescaleIntercept, ds.RescaleSlope, ds.RescaleType = -1024.0, 1.0, 'HU'
    ds.WindowWidth, ds.WindowCenter = 400, 40
    ds.PixelData = stored.tobytes()
    ds.save_as(os.path.join(OUT, 'p%03d.dcm' % k), enforce_file_format=True)

print('prior: %d slices, %.0f mm thick, z = %.0f .. %.0f' % (DEPTH, THICK, Z0, Z0 + (DEPTH - 1) * THICK))
print('current study for reference: 24 slices, 2 mm, z = 0 .. 46')
