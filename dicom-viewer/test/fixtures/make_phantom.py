"""A phantom with structures that are unambiguous under an oblique cut.

The key object is a cylinder tilted 30 degrees in the Y/Z plane: an axial cut
sees an ellipse, but a plane tilted to match should see a circle. That gives a
ground truth an oblique reslice either hits or misses.
"""

# Fixtures are written beside this script by default. Set CT_FIXTURES to put
# the generated DICOM somewhere else — a checkout does not carry them.
import os as _os
OUT_ROOT = _os.environ.get('CT_FIXTURES', _os.path.dirname(_os.path.abspath(__file__)))

import numpy as np, os, shutil, pydicom
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

OUT = _os.path.join(OUT_ROOT, 'phantom')
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)

COLS = ROWS = 128
DEPTH = 96
PIX = 1.0          # mm in-plane
THICK = 1.0        # mm slices  -> isotropic, so tilt angles are undistorted
TILT = np.radians(30.0)
R = 18.0           # cylinder radius, mm

study, series, frame = generate_uid(), generate_uid(), generate_uid()

cx, cy, cz = (COLS - 1) / 2, (ROWS - 1) / 2, (DEPTH - 1) / 2
yy, xx = np.meshgrid(np.arange(ROWS), np.arange(COLS), indexing="ij")

for k in range(DEPTH):
    hu = np.full((ROWS, COLS), -1000.0)          # air

    # Soft-tissue body: a big ellipse, 40 HU.
    body = (((xx - cx) / 55.0) ** 2 + ((yy - cy) / 42.0) ** 2) <= 1.0
    hu[body] = 40.0

    # Cylinder of axis (0, sin TILT, cos TILT) through the centre, 300 HU.
    # Distance from a point to that axis, in mm.
    dx = (xx - cx) * PIX
    dy = (yy - cy) * PIX
    dz = (k - cz) * THICK
    along = dy * np.sin(TILT) + dz * np.cos(TILT)
    perp2 = dx ** 2 + dy ** 2 + dz ** 2 - along ** 2
    hu[perp2 <= R ** 2] = 300.0

    # A bone slab on the left edge so bone cut has something to bite on.
    hu[(xx < 12) & body] = 900.0

    stored = np.clip(hu + 1024.0, 0, 4095).astype(np.uint16)

    ds = FileDataset(os.path.join(OUT, "s%03d.dcm" % k), Dataset(),
                     file_meta=Dataset(), preamble=b"\0" * 128)
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.is_little_endian, ds.is_implicit_VR = True, False

    ds.PatientName = "OBLIQUE^PHANTOM"
    ds.PatientID = "OBL001"
    ds.Modality = "CT"
    ds.StudyInstanceUID, ds.SeriesInstanceUID = study, series
    ds.FrameOfReferenceUID = frame
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    ds.SeriesDescription = "Tilted cylinder phantom"
    ds.SeriesNumber, ds.InstanceNumber = 1, k + 1

    ds.Rows, ds.Columns = ROWS, COLS
    ds.PixelSpacing = [PIX, PIX]
    ds.SliceThickness = THICK
    ds.SpacingBetweenSlices = THICK
    ds.ImagePositionPatient = [0.0, 0.0, k * THICK]
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.SamplesPerPixel, ds.PhotometricInterpretation = 1, "MONOCHROME2"
    ds.BitsAllocated, ds.BitsStored, ds.HighBit = 16, 12, 11
    ds.PixelRepresentation = 0
    ds.RescaleIntercept, ds.RescaleSlope, ds.RescaleType = -1024.0, 1.0, "HU"
    ds.WindowWidth, ds.WindowCenter = 400, 40
    ds.PixelData = stored.tobytes()
    ds.save_as(os.path.join(OUT, "s%03d.dcm" % k), enforce_file_format=True)

print("wrote", DEPTH, "slices to", OUT)
print("cylinder axis tilt = 30 deg in the Y/Z plane, radius %.0f mm" % R)
