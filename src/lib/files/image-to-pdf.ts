import { PDFDocument } from 'pdf-lib';
import { DEFAULT_IMAGE_TO_PDF_PART_SIZE_BYTES } from './upload-limits';

const FALLBACK_PDF_BASENAME = 'image-attachment';
const DEFAULT_MAX_PDF_PART_BYTES = DEFAULT_IMAGE_TO_PDF_PART_SIZE_BYTES;
const MIN_PART_SIZE_BYTES = 512 * 1024;
const PDF_BASE_OVERHEAD_BYTES = 96 * 1024;
const PDF_IMAGE_ESTIMATE_MULTIPLIER = 1.08;

interface ConversionProfile {
  maxEdge: number;
  quality: number;
}

const CONVERSION_PROFILES: ConversionProfile[] = [
  { maxEdge: 2400, quality: 0.82 },
  { maxEdge: 2000, quality: 0.76 },
  { maxEdge: 1600, quality: 0.7 },
  { maxEdge: 1280, quality: 0.64 },
  { maxEdge: 1024, quality: 0.58 },
];

interface PdfImageSource {
  name: string;
  bytes: Uint8Array;
  width: number;
  height: number;
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

async function readImageSource(file: File, profile: ConversionProfile): Promise<PdfImageSource> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`ไฟล์ ${file.name} ไม่ใช่รูปภาพ`);
  }

  const imageBitmap = await createImageBitmap(file);

  try {
    const longestEdge = Math.max(imageBitmap.width, imageBitmap.height);
    const scale = longestEdge > profile.maxEdge ? (profile.maxEdge / longestEdge) : 1;
    const targetWidth = Math.max(1, Math.round(imageBitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(imageBitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('ไม่สามารถประมวลผลรูปภาพได้');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) {
            resolve(result);
            return;
          }
          reject(new Error('ไม่สามารถแปลงรูปภาพได้'));
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

async function renderPdfBytes(sources: PdfImageSource[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const source of sources) {
    await appendImagePage(pdf, source);
  }
  return Uint8Array.from(await pdf.save());
}

function estimateSourcePdfContribution(source: PdfImageSource): number {
  return Math.ceil(source.bytes.byteLength * PDF_IMAGE_ESTIMATE_MULTIPLIER);
}

async function buildAdaptiveImageSource(image: File, maxPartSizeBytes: number): Promise<PdfImageSource> {
  let lastRenderedSize = 0;
  for (const profile of CONVERSION_PROFILES) {
    const source = await readImageSource(image, profile);
    const singlePagePdf = await renderPdfBytes([source]);
    lastRenderedSize = singlePagePdf.byteLength;
    if (singlePagePdf.byteLength <= maxPartSizeBytes) {
      return source;
    }
  }

  throw new Error(
    `รูป ${image.name} ใหญ่เกินขีดจำกัดอัปโหลดต่อไฟล์ (${Math.ceil(lastRenderedSize / 1024 / 1024)}MB) กรุณาลดขนาดรูปก่อน`,
  );
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

async function splitAndRenderGroup(sources: PdfImageSource[], maxPartSizeBytes: number): Promise<Uint8Array[]> {
  const bytes = await renderPdfBytes(sources);
  if (bytes.byteLength <= maxPartSizeBytes) {
    return [bytes];
  }

  if (sources.length <= 1) {
    throw new Error(`รูป ${sources[0]?.name ?? ''} ใหญ่เกินขีดจำกัดอัปโหลดต่อไฟล์ กรุณาลดขนาดรูปก่อน`);
  }

  const middleIndex = Math.ceil(sources.length / 2);
  const left = await splitAndRenderGroup(sources.slice(0, middleIndex), maxPartSizeBytes);
  const right = await splitAndRenderGroup(sources.slice(middleIndex), maxPartSizeBytes);
  return [...left, ...right];
}

export async function buildPdfFilesFromImages(
  images: File[],
  outputName?: string,
  maxPartSizeBytes = DEFAULT_MAX_PDF_PART_BYTES,
): Promise<File[]> {
  if (!images.length) {
    throw new Error('กรุณาเลือกรูปอย่างน้อย 1 รูป');
  }

  const normalizedMaxPartSize = normalizeMaxPartSize(maxPartSizeBytes);
  const baseName = toPdfBaseName(outputName?.trim() || images[0]?.name || FALLBACK_PDF_BASENAME);
  const adaptedSources: PdfImageSource[] = [];

  for (const image of images) {
    adaptedSources.push(await buildAdaptiveImageSource(image, normalizedMaxPartSize));
  }

  const groups = buildInitialGroups(adaptedSources, normalizedMaxPartSize);
  const rawParts: Uint8Array[] = [];
  for (const group of groups) {
    const rendered = await splitAndRenderGroup(group, normalizedMaxPartSize);
    rawParts.push(...rendered);
  }

  const totalParts = rawParts.length;
  return rawParts.map((bytes, partIndex) => (
    new File(
      [Uint8Array.from(bytes)],
      getPartFileName(baseName, partIndex, totalParts),
      {
        type: 'application/pdf',
        lastModified: Date.now(),
      },
    )
  ));
}

export async function buildPdfFromImages(
  images: File[],
  outputName?: string,
): Promise<File> {
  const files = await buildPdfFilesFromImages(images, outputName);
  if (files.length !== 1) {
    throw new Error('จำนวนรูปเยอะเกินไปสำหรับ PDF ไฟล์เดียว กรุณาใช้โหมดแปลงเป็นหลายไฟล์');
  }
  return files[0];
}
