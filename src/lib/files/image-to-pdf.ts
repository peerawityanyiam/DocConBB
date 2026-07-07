import { PDFDocument } from 'pdf-lib';
import { DEFAULT_IMAGE_TO_PDF_PART_SIZE_BYTES } from './upload-limits';

const FALLBACK_PDF_BASENAME = 'image-attachment';
const DEFAULT_MAX_PDF_PART_BYTES = DEFAULT_IMAGE_TO_PDF_PART_SIZE_BYTES;
const MIN_PART_SIZE_BYTES = 512 * 1024;
const PDF_BASE_OVERHEAD_BYTES = 96 * 1024;
const PDF_IMAGE_ESTIMATE_MULTIPLIER = 1.08;
// 30 images x 3.4MB x 1.08 estimate stays under the 150MB part ceiling.
const PREPARED_IMAGE_SOFT_TARGET_BYTES = Math.floor(3.4 * 1024 * 1024);
// Camera JPEGs below this pass through byte-for-byte: re-encoding is what
// softens thin document lines, so it only happens when a file is oversized
// or its EXIF rotation must be baked in (PDF ignores EXIF).
const JPEG_PASS_THROUGH_MAX_BYTES = 8 * 1024 * 1024;
// Decode/encode runs off the main thread, so a small pool speeds up big
// batches without freezing the UI.
const PREPARE_CONCURRENCY = 3;

interface ConversionProfile {
  maxEdge: number;
  quality: number;
}

// Quality tuned for document photos: below ~0.8, JPEG block artifacts make
// thin table lines look segmented, so the high-resolution tiers stay above it.
const CONVERSION_PROFILES: ConversionProfile[] = [
  { maxEdge: 2800, quality: 0.88 },
  { maxEdge: 2400, quality: 0.84 },
  { maxEdge: 2000, quality: 0.8 },
  { maxEdge: 1600, quality: 0.75 },
  { maxEdge: 1280, quality: 0.68 },
  { maxEdge: 1024, quality: 0.6 },
  { maxEdge: 768, quality: 0.54 },
  { maxEdge: 512, quality: 0.5 },
];

// 'quality' keeps camera pixels when possible; 'compact' always re-encodes
// small for slow connections, trading line sharpness for ~3x faster uploads.
export type ImagePrepareMode = 'quality' | 'compact';

const COMPACT_PROFILES: ConversionProfile[] = [
  { maxEdge: 1600, quality: 0.75 },
  { maxEdge: 1280, quality: 0.68 },
  { maxEdge: 1024, quality: 0.6 },
];
const COMPACT_SOFT_TARGET_BYTES = 1 * 1024 * 1024;

interface PdfImageSource {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
}

export interface PreparedImageProgress {
  index: number;
  total: number;
  name: string;
  status: 'processing' | 'done';
  outputBytes?: number;
}

function toPdfBaseName(baseName: string): string {
  const clean = baseName
    .replace(/\.[^/.]+$/, '')
    .replace(/[^\w\u0E00-\u0E7F\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-');

  return clean.length > 0 ? clean : FALLBACK_PDF_BASENAME;
}

function getPartFileName(baseName: string, partIndex: number, totalParts: number): string {
  if (totalParts <= 1) return `${baseName}.pdf`;
  return `${baseName}-part-${String(partIndex + 1).padStart(2, '0')}.pdf`;
}

function normalizeMaxPartSize(maxPartSizeBytes: number): number {
  if (!Number.isFinite(maxPartSizeBytes)) return DEFAULT_MAX_PDF_PART_BYTES;
  return Math.max(Math.floor(maxPartSizeBytes), MIN_PART_SIZE_BYTES);
}

// Returns the EXIF orientation tag value; 1 means upright (or no EXIF).
function readJpegOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1];
    // Start-of-scan or end-of-image: no EXIF segment ahead.
    if (marker === 0xda || marker === 0xd9) return 1;
    const segmentLength = view.getUint16(offset + 2, false);
    if (segmentLength < 2) return 1;
    const isExifApp1 = marker === 0xe1
      && offset + 10 <= bytes.length
      && bytes[offset + 4] === 0x45 // 'Exif\0\0'
      && bytes[offset + 5] === 0x78
      && bytes[offset + 6] === 0x69
      && bytes[offset + 7] === 0x66
      && bytes[offset + 8] === 0x00
      && bytes[offset + 9] === 0x00;
    if (isExifApp1) {
      const tiff = offset + 10;
      if (tiff + 8 > bytes.length) return 1;
      const littleEndian = view.getUint16(tiff, false) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, littleEndian);
      if (ifd + 2 > bytes.length) return 1;
      const entryCount = view.getUint16(ifd, littleEndian);
      for (let i = 0; i < entryCount; i += 1) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > bytes.length) return 1;
        if (view.getUint16(entry, littleEndian) === 0x0112) {
          return view.getUint16(entry + 8, littleEndian);
        }
      }
      return 1;
    }
    offset += 2 + segmentLength;
  }
  return 1;
}

// Byte-for-byte pass-through for upright camera JPEGs, so the PDF page keeps
// the exact photo pixels; returns null when the file needs re-encoding.
async function tryPassThroughJpeg(image: File): Promise<File | null> {
  if (image.type !== 'image/jpeg' || image.size > JPEG_PASS_THROUGH_MAX_BYTES) return null;
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  if (readJpegOrientation(bytes) !== 1) return null;
  return image;
}

async function decodeImageFile(file: File): Promise<ImageBitmap> {
  try {
    // Explicit orientation keeps phone photos upright on browsers whose
    // default is still 'none'.
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      // Older browsers reject the options bag itself.
      return await createImageBitmap(file);
    } catch {
      // Undecodable format (e.g. HEIC outside Safari) or corrupt file.
      throw new Error(`unsupported_image_file:${file.name}`);
    }
  }
}

function scaleStep(
  source: ImageBitmap | HTMLCanvasElement,
  sourceWidth: number,
  sourceHeight: number,
  stepWidth: number,
  stepHeight: number,
): HTMLCanvasElement {
  const stepCanvas = document.createElement('canvas');
  stepCanvas.width = stepWidth;
  stepCanvas.height = stepHeight;
  const stepCtx = stepCanvas.getContext('2d');
  if (!stepCtx) throw new Error('image_processing_failed');
  stepCtx.imageSmoothingEnabled = true;
  stepCtx.imageSmoothingQuality = 'high';
  stepCtx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, stepWidth, stepHeight);
  return stepCanvas;
}

async function readImageSource(file: File, profile: ConversionProfile): Promise<PdfImageSource> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`unsupported_image_file:${file.name}`);
  }

  const imageBitmap = await decodeImageFile(file);

  try {
    const longestEdge = Math.max(imageBitmap.width, imageBitmap.height);
    const scale = longestEdge > profile.maxEdge ? (profile.maxEdge / longestEdge) : 1;
    const targetWidth = Math.max(1, Math.round(imageBitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(imageBitmap.height * scale));

    // Downscale in 2x steps: a single large jump drops source pixels and
    // breaks thin document lines into dashes.
    let source: ImageBitmap | HTMLCanvasElement = imageBitmap;
    let sourceWidth = imageBitmap.width;
    let sourceHeight = imageBitmap.height;
    while (sourceWidth >= targetWidth * 2 && sourceHeight >= targetHeight * 2) {
      const stepWidth = Math.max(targetWidth, Math.round(sourceWidth / 2));
      const stepHeight = Math.max(targetHeight, Math.round(sourceHeight / 2));
      source = scaleStep(source, sourceWidth, sourceHeight, stepWidth, stepHeight);
      sourceWidth = stepWidth;
      sourceHeight = stepHeight;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('image_processing_failed');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) {
            resolve(result);
            return;
          }
          reject(new Error('image_conversion_failed'));
        },
        'image/jpeg',
        profile.quality,
      );
    });

    return {
      name: file.name,
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: targetWidth,
      height: targetHeight,
    };
  } finally {
    imageBitmap.close();
  }
}

async function appendImagePage(pdf: PDFDocument, source: PdfImageSource): Promise<void> {
  const embedded = await pdf.embedJpg(source.bytes);
  const page = pdf.addPage([source.width, source.height]);
  page.drawImage(embedded, {
    x: 0,
    y: 0,
    width: source.width,
    height: source.height,
  });
}

async function renderPdfBytes(sources: PdfImageSource[]): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create();
  for (const source of sources) {
    await appendImagePage(pdf, source);
  }
  // pdf-lib allocates from a plain ArrayBuffer; its typings just predate
  // the generic TypedArray, so this cast avoids copying the whole PDF.
  return (await pdf.save()) as Uint8Array<ArrayBuffer>;
}

async function readPreparedImageSource(file: File): Promise<PdfImageSource> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`unsupported_image_file:${file.name}`);
  }

  const imageBitmap = await decodeImageFile(file);
  try {
    return {
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      width: imageBitmap.width,
      height: imageBitmap.height,
    };
  } finally {
    imageBitmap.close();
  }
}

function estimateSourcePdfContribution(source: PdfImageSource): number {
  return Math.ceil(source.bytes.byteLength * PDF_IMAGE_ESTIMATE_MULTIPLIER);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function prepareSingleImage(image: File, mode: ImagePrepareMode): Promise<File> {
  if (mode === 'quality') {
    const passThrough = await tryPassThroughJpeg(image);
    if (passThrough) return passThrough;
  }

  const profiles = mode === 'compact' ? COMPACT_PROFILES : CONVERSION_PROFILES;
  const softTarget = mode === 'compact' ? COMPACT_SOFT_TARGET_BYTES : PREPARED_IMAGE_SOFT_TARGET_BYTES;

  let selectedSource: PdfImageSource | null = null;
  for (const profile of profiles) {
    const source = await readImageSource(image, profile);
    selectedSource = source;
    if (source.bytes.byteLength <= softTarget) {
      break;
    }
  }

  if (!selectedSource) {
    throw new Error(`prepare_image_failed:${image.name}`);
  }

  const preparedName = image.name.replace(/\.[^/.]+$/, '.jpg');
  return new File([selectedSource.bytes], preparedName, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

export async function prepareImagesForPdf(
  images: File[],
  onProgress?: (progress: PreparedImageProgress) => void,
  mode: ImagePrepareMode = 'quality',
): Promise<File[]> {
  if (!images.length) {
    throw new Error('no_images_selected');
  }

  return mapWithConcurrency(images, PREPARE_CONCURRENCY, async (image, index) => {
    if (!image.type.startsWith('image/')) {
      throw new Error(`unsupported_image_file:${image.name}`);
    }

    onProgress?.({
      index,
      total: images.length,
      name: image.name,
      status: 'processing',
    });

    const prepared = await prepareSingleImage(image, mode);

    onProgress?.({
      index,
      total: images.length,
      name: image.name,
      status: 'done',
      outputBytes: prepared.size,
    });

    return prepared;
  });
}

function buildInitialGroups(sources: PdfImageSource[], maxPartSizeBytes: number): PdfImageSource[][] {
  const groups: PdfImageSource[][] = [];
  let currentGroup: PdfImageSource[] = [];
  let currentEstimatedSize = PDF_BASE_OVERHEAD_BYTES;

  for (const source of sources) {
    const estimatedContribution = estimateSourcePdfContribution(source);
    const nextEstimatedSize = currentEstimatedSize + estimatedContribution;

    if (currentGroup.length > 0 && nextEstimatedSize > maxPartSizeBytes) {
      groups.push(currentGroup);
      currentGroup = [];
      currentEstimatedSize = PDF_BASE_OVERHEAD_BYTES;
    }

    currentGroup.push(source);
    currentEstimatedSize += estimatedContribution;
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

async function splitAndRenderGroup(sources: PdfImageSource[], maxPartSizeBytes: number): Promise<Uint8Array<ArrayBuffer>[]> {
  const bytes = await renderPdfBytes(sources);
  if (bytes.byteLength <= maxPartSizeBytes) {
    return [bytes];
  }

  if (sources.length <= 1) {
    throw new Error(`image_too_large_after_compress:${sources[0]?.name ?? ''}`);
  }

  const middleIndex = Math.ceil(sources.length / 2);
  const left = await splitAndRenderGroup(sources.slice(0, middleIndex), maxPartSizeBytes);
  const right = await splitAndRenderGroup(sources.slice(middleIndex), maxPartSizeBytes);
  return [...left, ...right];
}

async function buildPdfFilesFromSources(
  sources: PdfImageSource[],
  baseName: string,
  normalizedMaxPartSize: number,
): Promise<File[]> {
  const rawParts: Uint8Array<ArrayBuffer>[] = [];
  const fullPdfBytes = await renderPdfBytes(sources);
  if (fullPdfBytes.byteLength <= normalizedMaxPartSize) {
    rawParts.push(fullPdfBytes);
  } else {
    const groups = buildInitialGroups(sources, normalizedMaxPartSize);
    for (const group of groups) {
      const rendered = await splitAndRenderGroup(group, normalizedMaxPartSize);
      rawParts.push(...rendered);
    }
  }

  const totalParts = rawParts.length;
  return rawParts.map((bytes, partIndex) => (
    new File(
      [bytes],
      getPartFileName(baseName, partIndex, totalParts),
      {
        type: 'application/pdf',
        lastModified: Date.now(),
      },
    )
  ));
}

export async function buildPdfFilesFromPreparedImages(
  images: File[],
  outputName?: string,
  maxPartSizeBytes = DEFAULT_MAX_PDF_PART_BYTES,
): Promise<File[]> {
  if (!images.length) {
    throw new Error('no_images_selected');
  }

  const normalizedMaxPartSize = normalizeMaxPartSize(maxPartSizeBytes);
  const baseName = toPdfBaseName(outputName?.trim() || images[0]?.name || FALLBACK_PDF_BASENAME);
  const preparedSources: PdfImageSource[] = [];

  for (const image of images) {
    preparedSources.push(await readPreparedImageSource(image));
  }

  return buildPdfFilesFromSources(preparedSources, baseName, normalizedMaxPartSize);
}
