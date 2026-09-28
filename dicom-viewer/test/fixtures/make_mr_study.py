"""A multi-sequence MR study: four series in three different acquisition planes.

One patient, one study, four sequences, each acquired in the plane a real
protocol would use. The point is that a sagittal T2 is a stack of thick
sagittal slices — not a sampling of an isotropic volume — so the viewer has
to lay it out in the plane it was taken in rather than reformat it.

A marker whose position is a known function of patient coordinates is written
into every series, so a crosshair moved in one sequence can be checked against
where it lands in the others.
"""

# Fixtures are written beside this script by default. Set CT_FIXTURES to put
# the generated DICOM somewhere else — a checkout does not carry them.
import os as _os
OUT_ROOT = _os.environ.get('CT_FIXTURES', _os.path.dirname(_os.path.abspath(__file__)))

import os, shutil, numpy as np
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

OUT = _os.path.join(OUT_ROOT, 'series-mrstudy')
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)

study, fref = generate_uid(), generate_uid()
PATIENT = 'MR^MULTISEQ'
PID = 'MR002'

# The whole body lives in a 120 x 120 x 120 mm box of patient space.
BOX = 120.0
# One bright sphere at a known patient coordinate, in every sequence.
MARK = np.array([78.0, 46.0, 62.0])
MARK_R = 9.0

# (description, series number, orientation, slices, thickness, in-plane mm)
# ImageOrientationPatient = [row direction, column direction].
SEQ = [
    ('SAG T1',      1, [0, 1, 0, 0, 0, -1], 24, 5.0, 1.2),   # normal = +x
    ('SAG T2 FS',   2, [0, 1, 0, 0, 0, -1], 24, 5.0, 1.2),
    ('AX T2',       3, [1, 0, 0, 0, 1, 0],  30, 4.0, 1.0),   # normal = +z
    ('COR STIR',    4, [1, 0, 0, 0, 0, -1], 20, 6.0, 1.4),   # normal = +y
]


def unit(v):
    v = np.array(v, float)
    return v / np.linalg.norm(v)


for desc, num, iop, depth, thick, pix in SEQ:
    series = generate_uid()
    row_dir, col_dir = unit(iop[:3]), unit(iop[3:])
    normal = np.cross(row_dir, col_dir)
    rows = cols = int(BOX / pix)

    # Start the stack so it spans the box along its own normal.
    span = (depth - 1) * thick
    # Origin of slice 0: centre of the box, backed off along every axis.
    centre = np.array([BOX / 2, BOX / 2, BOX / 2])
    start = (centre
             - row_dir * ((cols - 1) * pix / 2)
             - col_dir * ((rows - 1) * pix / 2)
             - normal * (span / 2))

    for k in range(depth):
        origin = start + normal * (k * thick)
        # Patient coordinate of every pixel in this slice.
        jj, ii = np.meshgrid(np.arange(rows), np.arange(cols), indexing='ij')
        pts = (origin[None, None, :]
               + row_dir[None, None, :] * (ii * pix)[:, :, None]
               + col_dir[None, None, :] * (jj * pix)[:, :, None])

        # Body: an ellipsoid filling most of the box, with sequence-specific
        # baseline signal so the four series are visibly different.
        rel = (pts - centre) / np.array([52.0, 46.0, 55.0])
        inside = (rel ** 2).sum(axis=2) <= 1.0
        sig = np.zeros((rows, cols), float)
        base = {'SAG T1': 260.0, 'SAG T2 FS': 120.0, 'AX T2': 420.0, 'COR STIR': 90.0}[desc]
        sig[inside] = base

        # The marker, at the same patient coordinate in every sequence.
        d = np.linalg.norm(pts - MARK[None, None, :], axis=2)
        sig[d <= MARK_R] = 1000.0

        stored = np.clip(sig, 0, 4095).astype(np.uint16)

        fm = Dataset()
        fm.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.4'
        fm.MediaStorageSOPInstanceUID = generate_uid()
        fm.TransferSyntaxUID = ExplicitVRLittleEndian
        ds = FileDataset(None, {}, file_meta=fm, preamble=b'\0' * 128)
        ds.SOPClassUID = fm.MediaStorageSOPClassUID
        ds.SOPInstanceUID = fm.MediaStorageSOPInstanceUID
        ds.Modality = 'MR'
        ds.PatientName = PATIENT
        ds.PatientID = PID
        ds.StudyDate = '20260924'
        ds.AccessionNumber = 'ACCMR002'
        ds.StudyInstanceUID = study
        ds.SeriesInstanceUID = series
        ds.FrameOfReferenceUID = fref
        ds.StudyDescription = 'MRI multi-sequence'
        ds.SeriesDescription = desc
        ds.SeriesNumber = num
        ds.InstanceNumber = k + 1
        ds.Rows, ds.Columns = rows, cols
        ds.PixelSpacing = [pix, pix]
        ds.SliceThickness = thick
        ds.SpacingBetweenSlices = thick
        ds.ImagePositionPatient = [float(x) for x in origin]
        ds.ImageOrientationPatient = [float(x) for x in iop]
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = 'MONOCHROME2'
        ds.BitsAllocated = 16
        ds.BitsStored = 12
        ds.HighBit = 11
        ds.PixelRepresentation = 0
        ds.WindowWidth = 900
        ds.WindowCenter = 450
        # Deliberately NO Rescale Slope/Intercept: MR signal is not HU.
        ds.PixelData = stored.tobytes()
        ds.save_as(os.path.join(OUT, f'{num:02d}_{k:03d}.dcm'), enforce_file_format=True)

    print(f'{desc:10s} n={depth:3d}  {rows}x{cols}  {thick}mm  normal={normal}')

print('marker at patient', MARK, 'radius', MARK_R)
