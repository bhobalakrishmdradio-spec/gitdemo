"""Fixtures for the JS codecs.

Every JPEG stream here is decoded by pylibjpeg-libjpeg (an independent C
implementation) before being written out, so the JS decoder is checked
against a bitstream a third party already agrees on.
"""

# Fixtures are written beside this script by default. Set CT_FIXTURES to put
# the generated DICOM somewhere else — a checkout does not carry them.
import os as _os
OUT_ROOT = _os.environ.get('CT_FIXTURES', _os.path.dirname(_os.path.abspath(__file__)))

import sys, json, numpy as np
sys.path.insert(0, OUT_ROOT)
from jpegls_encode import encode
from libjpeg import decode as ref_decode
import pydicom
from pydicom.uid import RLELossless
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

OUT = _os.path.join(OUT_ROOT, 'codec')
import os, shutil
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)

rng = np.random.default_rng(11)
cases = [
    ("random12",  rng.integers(0, 4096, (16, 16)).astype(np.uint16), 12, 12, 0),
    ("gradient",  (np.add.outer(np.arange(64), np.arange(64)) * 30 % 4096).astype(np.uint16), 12, 12, 0),
    ("flat",      np.full((8, 8), 1234, np.uint16), 12, 12, 0),
    ("full16",    rng.integers(0, 65536, (32, 32)).astype(np.uint16), 16, 16, 0),
    ("onerow",    rng.integers(0, 4096, (1, 40)).astype(np.uint16), 12, 12, 0),
    ("tall",      rng.integers(0, 4096, (100, 7)).astype(np.uint16), 12, 12, 0),
    ("ctlike",    ((np.hypot(*np.mgrid[-64:64, -64:64]) < 50) * 1224 + 800).astype(np.uint16), 12, 12, 0),
    ("eightbit",  rng.integers(0, 256, (24, 24)).astype(np.uint16), 8, 8, 0),
]

manifest = []
for name, arr, prec, bits_stored, signed in cases:
    blob = encode(arr, prec)
    ref = np.asarray(ref_decode(bytes(blob))).reshape(arr.shape)
    assert np.array_equal(ref.astype(np.int64), arr.astype(np.int64)), name
    open(f'{OUT}/{name}.jpg', 'wb').write(blob)
    bits_alloc = 16 if prec > 8 else 8
    # The raw comparison file must be written at the width the manifest claims.
    np.asarray(arr, dtype='u1' if bits_alloc == 8 else '<u2').tofile(f'{OUT}/{name}.raw')
    manifest.append({'name': name, 'codec': 'jpeg-lossless', 'file': f'{name}.jpg',
                     'raw': f'{name}.raw', 'rows': int(arr.shape[0]), 'cols': int(arr.shape[1]),
                     'bitsAllocated': bits_alloc, 'bitsStored': bits_stored,
                     'pixelRepresentation': signed})

# RLE frames, produced by pydicom's own encoder.
def rle_frame(arr, bits_allocated, signed):
    ds = FileDataset("t.dcm", Dataset(), file_meta=Dataset(), preamble=b"\0" * 128)
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.2"; ds.SOPInstanceUID = generate_uid()
    ds.Rows, ds.Columns = arr.shape
    ds.SamplesPerPixel = 1; ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = bits_allocated; ds.BitsStored = bits_allocated; ds.HighBit = bits_allocated - 1
    ds.PixelRepresentation = signed; ds.Modality = "CT"
    ds.PixelData = arr.tobytes()
    ds.compress(RLELossless, arr)
    from pydicom.encaps import generate_pixel_data_frame
    return next(generate_pixel_data_frame(ds.PixelData, 1))

rle_cases = [
    ("rle_random", rng.integers(0, 65536, (32, 32)).astype('<u2'), 16, 0),
    ("rle_runs",   np.repeat(rng.integers(0, 4096, (16, 4)), 8, axis=1).astype('<u2'), 16, 0),
    ("rle_flat",   np.full((20, 20), 777, '<u2'), 16, 0),
    ("rle_signed", rng.integers(-2000, 2000, (24, 24)).astype('<i2'), 16, 1),
    ("rle_8bit",   rng.integers(0, 256, (18, 18)).astype(np.uint8), 8, 0),
]
for name, arr, bits, signed in rle_cases:
    frame = rle_frame(arr, bits, signed)
    open(f'{OUT}/{name}.rle', 'wb').write(frame)
    arr.tofile(f'{OUT}/{name}.raw')
    manifest.append({'name': name, 'codec': 'rle', 'file': f'{name}.rle',
                     'raw': f'{name}.raw', 'rows': int(arr.shape[0]), 'cols': int(arr.shape[1]),
                     'bitsAllocated': bits, 'bitsStored': bits, 'pixelRepresentation': signed})

json.dump(manifest, open(f'{OUT}/manifest.json', 'w'), indent=1)
print('wrote', len(manifest), 'fixtures to', OUT)
