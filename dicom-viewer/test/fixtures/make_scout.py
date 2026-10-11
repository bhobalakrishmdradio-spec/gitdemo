"""A CT study with a real coronal localizer beside its axial series.

The point of a scout is navigation, so the fixture is built so that a wrong
answer is obvious rather than plausible:

  · The scout is CORONAL (row along +x, column along -z), so an axial cut
    must appear on it as a HORIZONTAL line. A viewer that ignored Image
    Orientation and assumed the scout was axial would draw a vertical one.

  · The scout spans z = -300 .. 0 mm over 300 rows at 1 mm, so the line for
    an axial slice at z has a row that can be worked out by hand:
    row = (0 - z) / 1.0.

  · The axial series sits at z = -250 .. -100 mm, i.e. inside the scout but
    not filling it, so clicking the top or bottom of the scout must be
    refused rather than clamped silently.

  · Three radio-opaque bands are burned into the scout at known levels, so a
    screenshot shows at a glance whether the line lands where it should.
"""

import os as _os
OUT_ROOT = _os.environ.get('CT_FIXTURES', _os.path.dirname(_os.path.abspath(__file__)))

import os, shutil, numpy as np
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

OUT = _os.path.join(OUT_ROOT, 'series-scout')
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)

PIX = 1.0
AX_ROWS = AX_COLS = 96
AX_THICK = 2.0
AX_Z0 = -250.0
AX_N = 76                       # -250 .. -100 mm

SC_ROWS, SC_COLS = 300, 120     # 300 mm of z, 120 mm of x
BANDS_Z = [-120.0, -180.0, -240.0]

study = generate_uid()
axial_uid, scout_uid = generate_uid(), generate_uid()


def write(path, stored, *, series, series_desc, series_no, inst_no,
          rows, cols, ipp, iop, thick, image_type):
    fm = Dataset()
    fm.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.2'
    fm.MediaStorageSOPInstanceUID = generate_uid()
    fm.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = FileDataset(None, {}, file_meta=fm, preamble=b'\0' * 128)
    ds.SOPClassUID = fm.MediaStorageSOPClassUID
    ds.SOPInstanceUID = fm.MediaStorageSOPInstanceUID
    ds.Modality = 'CT'
    ds.PatientName = 'SCOUT^PHANTOM'
    ds.PatientID = 'SCT001'
    ds.PatientSex = 'F'
    ds.PatientAge = '047Y'
    ds.StudyDate = '20260415'
    ds.StudyInstanceUID = study
    ds.SeriesInstanceUID = series
    ds.FrameOfReferenceUID = study
    ds.StudyDescription = 'CT ABDOMEN'
    ds.SeriesDescription = series_desc
    ds.SeriesNumber = series_no
    ds.InstanceNumber = inst_no
    ds.ImageType = image_type
    ds.BodyPartExamined = 'ABDOMEN'
    # Technique and provenance. A reader asked to compare this study with a
    # prior one needs the kernel, the kV and the contrast agent, so they are
    # part of the fixture rather than left to the viewer's defaults.
    ds.ConvolutionKernel = 'B30f'
    ds.KVP = '120'
    ds.XRayTubeCurrent = '210'
    ds.Exposure = '150'
    ds.GantryDetectorTilt = '0.0'
    ds.ReconstructionDiameter = '350.0'
    ds.ContrastBolusAgent = 'OMNIPAQUE 350'
    ds.StudyTime = '094512'
    ds.AccessionNumber = 'ACC-77301'
    ds.InstitutionName = 'RIVERSIDE IMAGING'
    ds.ReferringPhysicianName = 'RAO^SUNIL'
    ds.StationName = 'CT-SOM-01'
    ds.ProtocolName = 'ABDOMEN PORTAL VENOUS'
    ds.PatientPosition = 'HFS'
    ds.Manufacturer = 'SIEMENS'
    ds.ManufacturerModelName = 'SOMATOM Definition AS'
    ds.Rows, ds.Columns = rows, cols
    ds.PixelSpacing = [PIX, PIX]
    ds.SliceThickness = thick
    ds.ImagePositionPatient = [float(v) for v in ipp]
    ds.ImageOrientationPatient = [float(v) for v in iop]
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
    ds.PixelData = stored.astype(np.uint16).tobytes()
    ds.is_little_endian, ds.is_implicit_VR = True, False
    ds.save_as(path, enforce_file_format=True)


# ---- the coronal scout -------------------------------------------------
# Row direction +x, column direction -z: the image's top row is z = 0 and
# each row down is one millimetre further toward the feet.
sc = np.full((SC_ROWS, SC_COLS), -1000.0)
cxs = SC_COLS / 2
col_i = np.arange(SC_COLS)[None, :]
row_i = np.arange(SC_ROWS)[:, None]
body = np.abs(col_i - cxs) < 34
sc = np.where(body, 40.0, sc)
for bz in BANDS_Z:
    r = int(round((0.0 - bz) / PIX))
    sc[max(0, r - 1):r + 2, :] = np.where(body[0], 900.0, -1000.0)

write(os.path.join(OUT, 'scout_000.dcm'),
      np.clip(sc + 1024.0, 0, 4095),
      series=scout_uid, series_desc='SCOUT CORONAL', series_no=1, inst_no=1,
      rows=SC_ROWS, cols=SC_COLS,
      ipp=[-cxs * PIX, 0.0, 0.0], iop=[1, 0, 0, 0, 0, -1],
      thick=1.0, image_type=['ORIGINAL', 'PRIMARY', 'LOCALIZER'])

# ---- the axial diagnostic series ---------------------------------------
yy, xx = np.meshgrid(np.arange(AX_ROWS), np.arange(AX_COLS), indexing='ij')
acx, acy = (AX_COLS - 1) / 2, (AX_ROWS - 1) / 2
for k in range(AX_N):
    z = AX_Z0 + k * AX_THICK
    hu = np.full((AX_ROWS, AX_COLS), -1000.0)
    hu[(((xx - acx) / 34.0) ** 2 + ((yy - acy) / 28.0) ** 2) <= 1.0] = 45.0
    # Bright disc on the slices nearest each band, so the level is visible.
    if min(abs(z - b) for b in BANDS_Z) <= AX_THICK:
        hu[np.hypot(xx - acx, yy - acy) < 10] = 900.0
    write(os.path.join(OUT, 'ax_%03d.dcm' % k),
          np.clip(hu + 1024.0, 0, 4095),
          series=axial_uid, series_desc='AX PORTAL VENOUS', series_no=2,
          inst_no=k + 1, rows=AX_ROWS, cols=AX_COLS,
          ipp=[-acx * PIX, -acy * PIX, z], iop=[1, 0, 0, 0, 1, 0],
          thick=AX_THICK, image_type=['ORIGINAL', 'PRIMARY', 'AXIAL'])

print('wrote', OUT)
print('scout: coronal, %d x %d, z = 0 .. -%d mm, bands at %s'
      % (SC_ROWS, SC_COLS, SC_ROWS, BANDS_Z))
print('axial: %d slices, %.1f mm, z = %.0f .. %.0f'
      % (AX_N, AX_THICK, AX_Z0, AX_Z0 + (AX_N - 1) * AX_THICK))
print('scout row for an axial slice at z  =  (0 - z) / 1.0')
