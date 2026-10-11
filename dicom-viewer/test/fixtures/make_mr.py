"""An MR series: no Hounsfield scale, arbitrary signal, header W/L."""

# Fixtures are written beside this script by default. Set CT_FIXTURES to put
# the generated DICOM somewhere else — a checkout does not carry them.
import os as _os
OUT_ROOT = _os.environ.get('CT_FIXTURES', _os.path.dirname(_os.path.abspath(__file__)))

import os, shutil, numpy as np
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

OUT = _os.path.join(OUT_ROOT, 'series-mr')
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)

DEPTH, ROWS, COLS = 20, 96, 96
PIX, THICK = 1.2, 4.0
rng = np.random.default_rng(17)
cx, cy = (COLS - 1) / 2, (ROWS - 1) / 2
yy, xx = np.meshgrid(np.arange(ROWS), np.arange(COLS), indexing='ij')
study, series, fref = generate_uid(), generate_uid(), generate_uid()

for k in range(DEPTH):
    # Arbitrary signal units: background ~0, "white matter" ~600, "CSF" ~1800.
    sig = np.zeros((ROWS, COLS), float)
    head = (((xx - cx) / 38.0) ** 2 + ((yy - cy) / 30.0) ** 2) <= 1.0
    sig[head] = 620.0
    inner = (((xx - cx) / 30.0) ** 2 + ((yy - cy) / 23.0) ** 2) <= 1.0
    sig[inner] = 900.0
    r = np.hypot(xx - cx, yy - cy)
    sig[r < 9 + (k % 4)] = 1800.0                     # bright CSF-like focus
    sig[head] += rng.normal(0, 25, head.sum())
    stored = np.clip(sig, 0, 4095).astype('<u2')

    ds = FileDataset('m.dcm', Dataset(), file_meta=Dataset(), preamble=b'\0' * 128)
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.4'   # MR Image Storage
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.SOPClassUID = '1.2.840.10008.5.1.4.1.1.4'
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    ds.PatientName = 'MR^PHANTOM'; ds.PatientID = 'MR001'
    ds.Modality = 'MR'
    ds.StudyInstanceUID, ds.SeriesInstanceUID = study, series
    ds.FrameOfReferenceUID = fref
    ds.SeriesDescription = 'AX T2 FLAIR'
    ds.SeriesNumber, ds.InstanceNumber = 2, k + 1
    ds.Rows, ds.Columns = ROWS, COLS
    ds.PixelSpacing = [PIX, PIX]
    ds.SliceThickness = THICK; ds.SpacingBetweenSlices = THICK
    ds.ImagePositionPatient = [0.0, 0.0, k * THICK]
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.SamplesPerPixel = 1; ds.PhotometricInterpretation = 'MONOCHROME2'
    ds.BitsAllocated, ds.BitsStored, ds.HighBit = 16, 12, 11
    ds.PixelRepresentation = 0
    # No RescaleSlope/Intercept and no RescaleType: MR has no absolute scale.
    ds.WindowWidth, ds.WindowCenter = 1400, 700
    # MR technique. None of these exist on a CT, which is the point: the
    # panel is told the parameters, not the modality, and shows whichever
    # the file actually carries.
    ds.MagneticFieldStrength = 1.5
    ds.ScanningSequence = 'SE'; ds.SequenceVariant = 'SK'
    ds.RepetitionTime = 9000.0
    ds.EchoTime = 120.0
    ds.InversionTime = 2500.0
    ds.FlipAngle = 150.0
    ds.EchoTrainLength = 17
    ds.ScanOptions = 'FLAIR'
    ds.MRAcquisitionType = '2D'
    ds.BodyPartExamined = 'BRAIN'
    ds.PatientPosition = 'HFS'
    ds.ProtocolName = 'AX T2 FLAIR'
    ds.InstitutionName = 'RIVERSIDE IMAGING'
    ds.Manufacturer = 'GE MEDICAL SYSTEMS'
    ds.ManufacturerModelName = 'SIGNA Architect'
    ds.PixelData = stored.tobytes()
    ds.save_as(os.path.join(OUT, 'm%03d.dcm' % k), enforce_file_format=True)

print('wrote', DEPTH, 'MR slices; signal range 0 ..', int(stored.max()))
