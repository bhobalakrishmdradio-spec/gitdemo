"""Follow-up imaging: one patient scanned three times, and a decoy patient.

Comparing an old scan with a new one is the feature this fixture exists for,
so it is built to make a wrong comparison obvious rather than plausible:

  · The same patient (FUP001) has three CT studies, 2024, 2025 and 2026,
    each with a lesion of a different, known diameter. Put the wrong study
    on screen and the lesion is the wrong size.

  · Every study has a short scout series as well as the diagnostic axial
    series. Picking the scout would "work" and show almost nothing, so the
    series chosen for a prior is a real decision the test can check.

  · The studies use different slice thicknesses and start at different
    patient Z, so lining them up by slice index lands on the wrong anatomy
    while lining them up by position does not.

  · A second patient (OTH999) is scanned on the same dates. Offering that
    study as this patient's prior is the worst thing the feature could do,
    so the data makes it possible and the test forbids it.
"""

# Fixtures are written beside this script by default. Set CT_FIXTURES to put
# the generated DICOM somewhere else — a checkout does not carry them.
import os as _os
OUT_ROOT = _os.environ.get('CT_FIXTURES', _os.path.dirname(_os.path.abspath(__file__)))

import os, shutil, numpy as np
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

OUT = _os.path.join(OUT_ROOT, 'series-followup')
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)

ROWS = COLS = 128
PIX = 1.0
# The lesion sits at this patient coordinate in every study of FUP001.
LESION_XY = (78.0, 54.0)
LESION_Z = 40.0

# (patient name, id, [(date, description, thickness, z0, depth, lesion diameter)])
PATIENTS = [
    ('ROY^ANITA', 'FUP001', [
        ('20240311', 'CT ABDOMEN follow-up', 5.0, 10.0, 16,  8.0),
        ('20250602', 'CT ABDOMEN follow-up', 3.0,  4.0, 26, 14.0),
        ('20260920', 'CT ABDOMEN follow-up', 2.0,  0.0, 40, 22.0),
    ]),
    # A different patient, scanned on the same days. Never this patient's prior.
    ('KHAN^OMAR', 'OTH999', [
        ('20240311', 'CT ABDOMEN', 5.0, 10.0, 16, 30.0),
        ('20260920', 'CT ABDOMEN', 2.0,  0.0, 40, 30.0),
    ]),
]

yy, xx = np.meshgrid(np.arange(ROWS), np.arange(COLS), indexing='ij')
cx = cy = (COLS - 1) / 2


def write(path, hu, *, name, pid, study, series, date, desc, series_desc,
          series_no, inst_no, thick, z):
    stored = np.clip(hu + 1024.0, 0, 4095).astype(np.uint16)
    fm = Dataset()
    fm.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.2'
    fm.MediaStorageSOPInstanceUID = generate_uid()
    fm.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = FileDataset(None, {}, file_meta=fm, preamble=b'\0' * 128)
    ds.SOPClassUID = fm.MediaStorageSOPClassUID
    ds.SOPInstanceUID = fm.MediaStorageSOPInstanceUID
    ds.Modality = 'CT'
    ds.PatientName = name
    ds.PatientID = pid
    ds.StudyDate = date
    ds.AccessionNumber = 'ACC' + pid + date[2:]
    ds.StudyInstanceUID = study
    ds.SeriesInstanceUID = series
    ds.FrameOfReferenceUID = study          # one frame of reference per study
    ds.StudyDescription = desc
    ds.SeriesDescription = series_desc
    ds.SeriesNumber = series_no
    ds.InstanceNumber = inst_no
    ds.Rows, ds.Columns = ROWS, COLS
    ds.PixelSpacing = [PIX, PIX]
    ds.SliceThickness = thick
    ds.SpacingBetweenSlices = thick
    ds.ImagePositionPatient = [0.0, 0.0, float(z)]
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
    ds.PixelData = stored.tobytes()
    ds.save_as(path, enforce_file_format=True)


for name, pid, studies in PATIENTS:
    for date, desc, thick, z0, depth, lesion_d in studies:
        study = generate_uid()
        axial, scout = generate_uid(), generate_uid()
        tag = f'{pid}_{date}'

        # The diagnostic axial series.
        for k in range(depth):
            z = z0 + k * thick
            hu = np.full((ROWS, COLS), -1000.0)
            body = (((xx - cx) / 48.0) ** 2 + ((yy - cy) / 40.0) ** 2) <= 1.0
            hu[body] = 45.0
            # A sphere of known diameter at a fixed patient coordinate.
            r = lesion_d / 2.0
            dz = abs(z - LESION_Z)
            if dz < r:
                rad = (r * r - dz * dz) ** 0.5
                hu[np.hypot(xx * PIX - LESION_XY[0], yy * PIX - LESION_XY[1]) <= rad] = 180.0
            write(os.path.join(OUT, f'{tag}_ax_{k:03d}.dcm'), hu,
                  name=name, pid=pid, study=study, series=axial, date=date, desc=desc,
                  series_desc='AX PORTAL VENOUS', series_no=2, inst_no=k + 1,
                  thick=thick, z=z)

        # A three-slice scout. Short, and named so it is obviously not the
        # series to compare against.
        for k in range(3):
            hu = np.full((ROWS, COLS), -1000.0)
            hu[abs(yy - cy) < 2] = 200.0
            write(os.path.join(OUT, f'{tag}_sc_{k:03d}.dcm'), hu,
                  name=name, pid=pid, study=study, series=scout, date=date, desc=desc,
                  series_desc='SCOUT', series_no=1, inst_no=k + 1,
                  thick=10.0, z=z0 + k * 10.0)

        print(f'{pid} {date}  {depth:3d} axial @ {thick}mm from z={z0}, '
              f'lesion {lesion_d} mm, + 3 scout')

print(f'\nwrote to {OUT}')
print(f'FUP001 lesion sits at patient ({LESION_XY[0]}, {LESION_XY[1]}, {LESION_Z}) in all three')
