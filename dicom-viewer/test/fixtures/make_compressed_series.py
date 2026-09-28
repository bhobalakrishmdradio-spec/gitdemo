"""The same CT series written three ways: uncompressed, RLE and JPEG Lossless.

If the viewer is right, all three must yield byte-identical Hounsfield Units.
"""

# Fixtures are written beside this script by default. Set CT_FIXTURES to put
# the generated DICOM somewhere else — a checkout does not carry them.
import os as _os
OUT_ROOT = _os.environ.get('CT_FIXTURES', _os.path.dirname(_os.path.abspath(__file__)))

import sys, os, shutil, numpy as np
sys.path.insert(0, OUT_ROOT)
from jpegls_encode import encode as jpeg_encode
from libjpeg import decode as ref_decode
import pydicom
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import (ExplicitVRLittleEndian, RLELossless, JPEGLosslessSV1, generate_uid)
from pydicom.encaps import encapsulate

BASE = OUT_ROOT
DEPTH, ROWS, COLS = 24, 96, 96
PIX, THICK = 1.0, 2.0

# A phantom with sharp edges and flat regions: the cases that break a codec.
cx, cy = (COLS - 1) / 2, (ROWS - 1) / 2
yy, xx = np.meshgrid(np.arange(ROWS), np.arange(COLS), indexing='ij')
rng = np.random.default_rng(5)
frames = []
for k in range(DEPTH):
    hu = np.full((ROWS, COLS), -1000.0)
    body = (((xx - cx) / 40.0) ** 2 + ((yy - cy) / 32.0) ** 2) <= 1.0
    hu[body] = 40.0
    r = np.hypot(xx - cx, yy - cy)
    hu[r < 14 + (k % 5)] = 300.0                    # a lesion that changes size
    hu[(xx < 10) & body] = 900.0                    # bone slab
    hu[body] -= rng.normal(0, 8, body.sum())        # noise: worst case for RLE
    frames.append(np.clip(hu + 1024.0, 0, 4095).astype('<u2'))

def base_ds(k, uid_study, uid_series, uid_frame):
    ds = FileDataset('s.dcm', Dataset(), file_meta=Dataset(), preamble=b'\0' * 128)
    ds.file_meta.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.2'
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.SOPClassUID = '1.2.840.10008.5.1.4.1.1.2'
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    ds.PatientName = 'CODEC^PHANTOM'; ds.PatientID = 'COD001'; ds.Modality = 'CT'
    ds.StudyInstanceUID = uid_study; ds.SeriesInstanceUID = uid_series
    ds.FrameOfReferenceUID = uid_frame
    ds.SeriesNumber, ds.InstanceNumber = 1, k + 1
    ds.Rows, ds.Columns = ROWS, COLS
    ds.PixelSpacing = [PIX, PIX]; ds.SliceThickness = THICK; ds.SpacingBetweenSlices = THICK
    ds.ImagePositionPatient = [0.0, 0.0, k * THICK]
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.SamplesPerPixel = 1; ds.PhotometricInterpretation = 'MONOCHROME2'
    ds.BitsAllocated, ds.BitsStored, ds.HighBit = 16, 12, 11
    ds.PixelRepresentation = 0
    ds.RescaleIntercept, ds.RescaleSlope, ds.RescaleType = -1024.0, 1.0, 'HU'
    ds.WindowWidth, ds.WindowCenter = 400, 40
    return ds

for kind in ('raw', 'rle', 'jpegls'):
    out = os.path.join(BASE, 'series-' + kind)
    shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
    study, series, fref = generate_uid(), generate_uid(), generate_uid()
    for k, arr in enumerate(frames):
        ds = base_ds(k, study, series, fref)
        ds.SeriesDescription = 'Codec phantom (%s)' % kind
        if kind == 'raw':
            ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
            ds.PixelData = arr.tobytes()
        elif kind == 'rle':
            ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
            ds.PixelData = arr.tobytes()
            ds.compress(RLELossless, arr)
        else:
            blob = jpeg_encode(arr, 12)
            # Never write a fixture an independent decoder disagrees with.
            ref = np.asarray(ref_decode(bytes(blob))).reshape(arr.shape)
            assert np.array_equal(ref.astype(np.int64), arr.astype(np.int64)), k
            ds.file_meta.TransferSyntaxUID = JPEGLosslessSV1
            ds.PixelData = encapsulate([blob])
            ds['PixelData'].is_undefined_length = True
        ds.is_little_endian = True
        ds.is_implicit_VR = False
        ds.save_as(os.path.join(out, 's%03d.dcm' % k), enforce_file_format=True)
    print('wrote', kind, DEPTH, 'slices')

hu = frames[0].astype(np.int32) - 1024
print('HU range %d .. %d' % (hu.min(), hu.max()))
