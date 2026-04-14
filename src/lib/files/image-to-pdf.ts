import { PDFDocument } from 'pdf-lib';

const FALLBACK_PDF_NAME = 'image-attachment.pdf';
const MAX_IMAGE_EDGE = 1800;
const JPEG_QUALITY = 0.82;

function toPdfName(baseName: string) {
  const clean = baseName
    .replace(/\.[^/.]+$/, '')
    .replace(/[^\w\u0E00-\u0E7F\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-');

  const name = clean.length > 0 ? clean : 'image-attachment';
  return `${name}.pdf`;
}

async function rasterizeToJpeg(file: File): Promise<{
  bytes: Uint8Array;
  width: number;
  height: number;
}> {
  const imageBitmap = await createImageBitmap(file);
  const longestEdge = Math.max(imageBitmap.width, imageBitmap.height);
  const scale = longestEdge > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / longestEdge : 1;
  const targetWidth = Math.max(1, Math.round(imageBitmap.width * scale));
  const targetHeight = Math.max(1, Math.round(imageBitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to process image');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight);
  imageBitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) {
          resolve(result);
          return;
        }
        reject(new Error('Unable to convert image to JPEG'));
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: targetWidth,
    height: targetHeight,
  };
}

export async function buildPdfFromImages(
  images: File[],
  outputName?: string,
): Promise<File> {
  if (!images.length) {
    throw new Error('Please select at least one image');
  }

  const pdf = await PDFDocument.create();

  for (const image of images) {
    if (!image.type.startsWith('image/')) {
      throw new Error(`File ${image.name} is not an image`);
    }

    const { bytes, width, height } = await rasterizeToJpeg(image);
    const embedded = await pdf.embedJpg(bytes);
    const page = pdf.addPage([width, height]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width,
      height,
    });
  }

  const pdfBytes = await pdf.save();
  const normalizedPdfBytes = Uint8Array.from(pdfBytes);
  const fileName = outputName?.trim()
    ? outputName.trim()
    : toPdfName(images[0]?.name ?? FALLBACK_PDF_NAME);

  return new File([normalizedPdfBytes], fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`, {
    type: 'application/pdf',
    lastModified: Date.now(),
  });
}
