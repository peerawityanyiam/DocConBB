import { PDFDocument } from 'pdf-lib';

const FALLBACK_PDF_BASENAME = 'image-attachment';
const DEFAULT_MAX_PDF_PART_BYTES = 18 * 1024 * 1024; // smaller parts improve real-world upload success
const HIGH_QUALITY_MAX_EDGE = 3000;
const HIGH_QUALITY_JPEG_QUALITY = 0.9;

interface PdfImageSource {
  name: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

function toPdfBaseName(baseName: string) {
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

async function readImageSource(file: File): Promise<PdfImageSource> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`ไฟล์ ${file.name} ไม่ใช่รูปภาพ`);
  }

  const imageBitmap = await createImageBitmap(file);

  try {
    const longestEdge = Math.max(imageBitmap.width, imageBitmap.height);
    const scale = longestEdge > HIGH_QUALITY_MAX_EDGE ? (HIGH_QUALITY_MAX_EDGE / longestEdge) : 1;
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
        HIGH_QUALITY_JPEG_QUALITY,
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

async function appendImagePage(pdf: PDFDocument, source: PdfImageSource) {
  const embedded = await pdf.embedJpg(source.bytes);
  const page = pdf.addPage([source.width, source.height]);
  page.drawImage(embedded, {
    x: 0,
    y: 0,
    width: source.width,
    height: source.height,
  });
}

export async function buildPdfFilesFromImages(
  images: File[],
  outputName?: string,
  maxPartSizeBytes = DEFAULT_MAX_PDF_PART_BYTES,
): Promise<File[]> {
  if (!images.length) {
    throw new Error('กรุณาเลือกรูปอย่างน้อย 1 รูป');
  }

  const baseName = toPdfBaseName(outputName?.trim() || images[0]?.name || FALLBACK_PDF_BASENAME);
  const sources: PdfImageSource[] = [];
  for (const image of images) {
    sources.push(await readImageSource(image));
  }

  const rawParts: Uint8Array[] = [];
  let cursor = 0;

  while (cursor < sources.length) {
    const pdf = await PDFDocument.create();
    let addedCount = 0;
    let lastGoodBytes: Uint8Array | null = null;

    while ((cursor + addedCount) < sources.length) {
      await appendImagePage(pdf, sources[cursor + addedCount]);
      const candidateBytes = Uint8Array.from(await pdf.save());

      if (candidateBytes.byteLength > maxPartSizeBytes) {
        pdf.removePage(pdf.getPageCount() - 1);
        break;
      }

      lastGoodBytes = candidateBytes;
      addedCount += 1;
    }

    if (!lastGoodBytes || addedCount === 0) {
      throw new Error(`รูป ${sources[cursor].name} มีขนาดใหญ่เกิน 50MB ต่อไฟล์`);
    }

    rawParts.push(lastGoodBytes);
    cursor += addedCount;
  }

  const totalParts = rawParts.length;
  return rawParts.map((bytes, partIndex) => {
    const normalizedBytes = Uint8Array.from(bytes);
    return new File(
      [normalizedBytes],
      getPartFileName(baseName, partIndex, totalParts),
      {
        type: 'application/pdf',
        lastModified: Date.now(),
      },
    );
  });
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
