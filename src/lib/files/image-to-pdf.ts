import { PDFDocument } from 'pdf-lib';

const FALLBACK_PDF_NAME = 'image-attachment.pdf';

function toPdfName(baseName: string) {
  const clean = baseName
    .replace(/\.[^/.]+$/, '')
    .replace(/[^\w\u0E00-\u0E7F\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-');

  const name = clean.length > 0 ? clean : 'image-attachment';
  return `${name}.pdf`;
}

async function rasterizeToPngBytes(file: File): Promise<Uint8Array> {
  const imageBitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('ไม่สามารถประมวลผลรูปภาพได้');

  ctx.drawImage(imageBitmap, 0, 0);
  imageBitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
        return;
      }
      reject(new Error('ไม่สามารถแปลงรูปเป็น PNG ได้'));
    }, 'image/png');
  });

  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildPdfFromImages(
  images: File[],
  outputName?: string,
): Promise<File> {
  if (!images.length) {
    throw new Error('กรุณาเลือกรูปภาพอย่างน้อย 1 รูป');
  }

  const pdf = await PDFDocument.create();

  for (const image of images) {
    if (!image.type.startsWith('image/')) {
      throw new Error(`ไฟล์ ${image.name} ไม่ใช่รูปภาพ`);
    }

    const rawBytes = new Uint8Array(await image.arrayBuffer());
    let embedded;
    const mime = image.type.toLowerCase();

    if (mime === 'image/jpeg' || mime === 'image/jpg') {
      embedded = await pdf.embedJpg(rawBytes);
    } else if (mime === 'image/png') {
      embedded = await pdf.embedPng(rawBytes);
    } else {
      const pngBytes = await rasterizeToPngBytes(image);
      embedded = await pdf.embedPng(pngBytes);
    }

    const page = pdf.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: embedded.width,
      height: embedded.height,
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
