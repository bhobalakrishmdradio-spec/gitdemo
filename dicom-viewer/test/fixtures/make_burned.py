"""A CT series with patient details burned into the pixel data.

Real scanners write the name, ID and date into a corner of the image, and
declare it in Burned In Annotation (0028,0301). A redaction feature that is
only ever tested against images without burned-in text is testing nothing,
so this fixture writes legible block text into a known rectangle and records
where it is, letting a test check that the pixels there really are destroyed
rather than merely covered by something drawn on top.
"""

# Fixtures are written beside this script by default. Set CT_FIXTURES to put
# the generated DICOM somewhere else — a checkout does not carry them.
import os as _os
OUT_ROOT = _os.environ.get('CT_FIXTURES', _os.path.dirname(_os.path.abspath(__file__)))

import os, shutil, numpy as np
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

OUT = _os.path.join(OUT_ROOT, 'series-burned')
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)

ROWS = COLS = 128
DEPTH = 20
THICK = 2.0
PIX = 1.0

# A 5x7 block font, enough for the characters this fixture needs.
FONT = {
 'A': ["01110","10001","10001","11111","10001","10001","10001"],
 'B': ["11110","10001","10001","11110","10001","10001","11110"],
 'C': ["01111","10000","10000","10000","10000","10000","01111"],
 'D': ["11110","10001","10001","10001","10001","10001","11110"],
 'E': ["11111","10000","10000","11110","10000","10000","11111"],
 'H': ["10001","10001","10001","11111","10001","10001","10001"],
 'I': ["11111","00100","00100","00100","00100","00100","11111"],
 'J': ["00111","00010","00010","00010","10010","10010","01100"],
 'M': ["10001","11011","10101","10001","10001","10001","10001"],
 'N': ["10001","11001","10101","10011","10001","10001","10001"],
 'O': ["01110","10001","10001","10001","10001","10001","01110"],
 'P': ["11110","10001","10001","11110","10000","10000","10000"],
 'R': ["11110","10001","10001","11110","10100","10010","10001"],
 'S': ["01111","10000","10000","01110","00001","00001","11110"],
 'T': ["11111","00100","00100","00100","00100","00100","00100"],
 'W': ["10001","10001","10001","10001","10101","11011","10001"],
 '0': ["01110","10011","10101","10101","10101","11001","01110"],
 '1': ["00100","01100","00100","00100","00100","00100","01110"],
 '2': ["01110","10001","00001","00110","01000","10000","11111"],
 '4': ["00010","00110","01010","10010","11111","00010","00010"],
 '7': ["11111","00001","00010","00100","01000","01000","01000"],
 '9': ["01110","10001","10001","01111","00001","10001","01110"],
 '^': ["00100","01010","10001","00000","00000","00000","00000"],
 '-': ["00000","00000","00000","11111","00000","00000","00000"],
 ' ': ["00000","00000","00000","00000","00000","00000","00000"],
}

TEXT = ["SMITH^JOHN", "ID 1974209", "2026-09-24"]
SCALE = 2
X0, Y0 = 4, 4                       # top-left of the burned-in block
LINE_H = (7 * SCALE) + 2
BURN_W = max(len(t) for t in TEXT) * (6 * SCALE)
BURN_H = len(TEXT) * LINE_H
BURN_VALUE = 3000.0                 # far brighter than any tissue here


def stamp(img, text, x, y):
    for ch in text:
        glyph = FONT.get(ch, FONT[' '])
        for r, row in enumerate(glyph):
            for c, bit in enumerate(row):
                if bit == '1':
                    img[y + r * SCALE:y + (r + 1) * SCALE,
                        x + c * SCALE:x + (c + 1) * SCALE] = BURN_VALUE
        x += 6 * SCALE


study, series, fref = generate_uid(), generate_uid(), generate_uid()
yy, xx = np.meshgrid(np.arange(ROWS), np.arange(COLS), indexing='ij')
cx = cy = (COLS - 1) / 2

for k in range(DEPTH):
    hu = np.full((ROWS, COLS), -1000.0)
    body = (((xx - cx) / 48.0) ** 2 + ((yy - cy) / 40.0) ** 2) <= 1.0
    hu[body] = 45.0
    hu[np.hypot(xx - cx, yy - cy) < 14] = 260.0
    for i, line in enumerate(TEXT):
        stamp(hu, line, X0, Y0 + i * LINE_H)

    stored = np.clip(hu + 1024.0, 0, 4095).astype(np.uint16)
    fm = Dataset()
    fm.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.2'
    fm.MediaStorageSOPInstanceUID = generate_uid()
    fm.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = FileDataset(None, {}, file_meta=fm, preamble=b'\0' * 128)
    ds.SOPClassUID = fm.MediaStorageSOPClassUID
    ds.SOPInstanceUID = fm.MediaStorageSOPInstanceUID
    ds.Modality = 'CT'
    ds.PatientName = 'SMITH^JOHN'
    ds.PatientID = '1974209'
    ds.StudyDate = '20260924'
    ds.AccessionNumber = 'ACCBURN1'
    ds.StudyInstanceUID = study
    ds.SeriesInstanceUID = series
    ds.FrameOfReferenceUID = fref
    ds.StudyDescription = 'CT with burned-in annotation'
    ds.SeriesDescription = 'AX BURNED'
    ds.SeriesNumber = 1
    ds.InstanceNumber = k + 1
    ds.Rows, ds.Columns = ROWS, COLS
    ds.PixelSpacing = [PIX, PIX]
    ds.SliceThickness = THICK
    ds.SpacingBetweenSlices = THICK
    ds.ImagePositionPatient = [0.0, 0.0, k * THICK]
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.RescaleSlope = 1.0
    ds.RescaleIntercept = -1024.0
    ds.RescaleType = 'HU'
    ds.BurnedInAnnotation = 'YES'
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = 'MONOCHROME2'
    ds.BitsAllocated = 16
    ds.BitsStored = 12
    ds.HighBit = 11
    ds.PixelRepresentation = 0
    ds.WindowWidth = 400
    ds.WindowCenter = 40
    ds.PixelData = stored.tobytes()
    ds.save_as(os.path.join(OUT, f'{k:03d}.dcm'), enforce_file_format=True)

print(f'wrote {DEPTH} slices, {ROWS}x{COLS}')
print(f'burned-in block: x {X0}..{X0 + BURN_W}, y {Y0}..{Y0 + BURN_H}, value {BURN_VALUE} HU')
print('BurnedInAnnotation = YES')
