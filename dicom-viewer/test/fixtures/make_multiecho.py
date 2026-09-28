"""A dual-echo MR series: two images at every slice position."""

# Fixtures are written beside this script by default. Set CT_FIXTURES to put
# the generated DICOM somewhere else — a checkout does not carry them.
import os as _os
OUT_ROOT = _os.environ.get('CT_FIXTURES', _os.path.dirname(_os.path.abspath(__file__)))

import os, shutil, numpy as np
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

OUT = _os.path.join(OUT_ROOT, 'series-echo')
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
ROWS = COLS, DEPTH = 64, 64
DEPTH = 12
study, series, fref = generate_uid(), generate_uid(), generate_uid()
yy, xx = np.meshgrid(np.arange(64), np.arange(64), indexing='ij')

for echo in (1, 2):
    for k in range(DEPTH):
        sig = np.zeros((64, 64), float)
        head = (((xx - 31.5) / 26.0) ** 2 + ((yy - 31.5) / 22.0) ** 2) <= 1.0
        # The two echoes differ strongly, so mixing them would be obvious.
        sig[head] = 900.0 if echo == 1 else 250.0
        stored = np.clip(sig, 0, 4095).astype('<u2')
        ds = FileDataset('e.dcm', Dataset(), file_meta=Dataset(), preamble=b'\0' * 128)
        ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
        ds.file_meta.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.4'
        ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
        ds.SOPClassUID = '1.2.840.10008.5.1.4.1.1.4'
        ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
        ds.PatientName = 'ECHO^PHANTOM'; ds.PatientID = 'ECH001'; ds.Modality = 'MR'
        ds.StudyInstanceUID, ds.SeriesInstanceUID = study, series
        ds.FrameOfReferenceUID = fref
        ds.SeriesDescription = 'DUAL ECHO'
        ds.SeriesNumber = 3; ds.InstanceNumber = (echo - 1) * DEPTH + k + 1
        ds.EchoNumbers = echo                       # (0018,0086)
        ds.EchoTime = 15.0 if echo == 1 else 90.0
        ds.Rows, ds.Columns = 64, 64
        ds.PixelSpacing = [1.5, 1.5]
        ds.SliceThickness = 5.0; ds.SpacingBetweenSlices = 5.0
        ds.ImagePositionPatient = [0.0, 0.0, k * 5.0]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.SamplesPerPixel = 1; ds.PhotometricInterpretation = 'MONOCHROME2'
        ds.BitsAllocated, ds.BitsStored, ds.HighBit = 16, 12, 11
        ds.PixelRepresentation = 0
        ds.WindowWidth, ds.WindowCenter = 1000, 500
        ds.PixelData = stored.tobytes()
        ds.save_as(os.path.join(OUT, 'e%d_%03d.dcm' % (echo, k)), enforce_file_format=True)
print('wrote 2 echoes x %d slices in ONE series UID' % DEPTH)
