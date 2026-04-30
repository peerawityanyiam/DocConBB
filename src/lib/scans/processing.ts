import { PDFDocument } from 'pdf-lib';
import { SCAN_MAX_IMAGE_FILE_SIZE_BYTES } from '@/lib/files/upload-limits';

export interface ScanCorner {
  x: number;
  y: number;
}

export interface ScanAdjustments {
  corners: [ScanCorner, ScanCorner, ScanCorner, ScanCorner];
  rotation: 0 | 90 | 180 | 270;
  brightness: number;
  contrast: number;
  shadowReduction: boolean;
  grayscale: boolean;
  blackWhite: boolean;
}

interface ImageSource {
  image: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
}

const DEFAULT_CORNERS: [ScanCorner, ScanCorner, ScanCorner, ScanCorner] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export function createDefaultScanAdjustments(): ScanAdjustments {
  return {
    corners: DEFAULT_CORNERS.map((corner) => ({ ...corner })) as ScanAdjustments['corners'],
    rotation: 0,
    brightness: 10,
    contrast: 1.16,
    shadowReduction: false,
    grayscale: false,
    blackWhite: false,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function distance(a: ScanCorner, b: ScanCorner) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

async function loadImageSource(sourceUrl: string): Promise<ImageSource> {
  const response = await fetch(sourceUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  return {
    image: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    close: () => bitmap.close(),
  };
}

function drawRotatedSource(source: ImageSource, rotation: ScanAdjustments['rotation']) {
  const canvas = document.createElement('canvas');
  const swap = rotation === 90 || rotation === 270;
  canvas.width = swap ? source.height : source.width;
  canvas.height = swap ? source.width : source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas_context_unavailable');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (rotation === 90) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    ctx.translate(canvas.width, canvas.height);
    ctx.rotate(Math.PI);
  } else if (rotation === 270) {
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(source.image, 0, 0);
  ctx.restore();
  return canvas;
}

function scaleCanvas(sourceCanvas: HTMLCanvasElement, maxEdge: number) {
  const edge = Math.max(sourceCanvas.width, sourceCanvas.height);
  if (edge <= maxEdge) return sourceCanvas;

  const scale = maxEdge / edge;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  canvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_context_unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col] || 1;
    for (let j = col; j <= n; j += 1) a[col][j] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}

function getHomography(source: ScanCorner[], width: number, height: number) {
  const dest = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const matrix: number[][] = [];
  const vector: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const x = dest[i].x;
    const y = dest[i].y;
    const u = source[i].x;
    const v = source[i].y;
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    vector.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    vector.push(v);
  }
  const h = solveLinearSystem(matrix, vector);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function reduceShadowPixel(r: number, g: number, b: number) {
  const lightness = Math.max(r, g, b);
  if (lightness >= 205) return [r, g, b];
  const lift = ((205 - lightness) / 205) * 42;
  const normalize = 1 + ((205 - lightness) / 205) * 0.38;
  return [
    clamp((r + lift) * normalize, 0, 255),
    clamp((g + lift) * normalize, 0, 255),
    clamp((b + lift) * normalize, 0, 255),
  ];
}

function enhancePixel(r: number, g: number, b: number, adjustments: ScanAdjustments) {
  let sr = r;
  let sg = g;
  let sb = b;
  if (adjustments.shadowReduction) {
    [sr, sg, sb] = reduceShadowPixel(sr, sg, sb);
  }
  const contrast = clamp(adjustments.contrast, 0.5, 2);
  const brightness = clamp(adjustments.brightness, -80, 80);
  let nr = clamp((sr - 128) * contrast + 128 + brightness, 0, 255);
  let ng = clamp((sg - 128) * contrast + 128 + brightness, 0, 255);
  let nb = clamp((sb - 128) * contrast + 128 + brightness, 0, 255);
  if (adjustments.grayscale || adjustments.blackWhite) {
    const gray = 0.299 * nr + 0.587 * ng + 0.114 * nb;
    const value = adjustments.blackWhite ? (gray > 168 ? 255 : 0) : gray;
    nr = value;
    ng = value;
    nb = value;
  }
  return [nr, ng, nb];
}

function renderWarpedCanvas(sourceCanvas: HTMLCanvasElement, adjustments: ScanAdjustments, maxEdge: number) {
  const sourceCorners = adjustments.corners.map((corner) => ({
    x: clamp(corner.x, 0, 1) * sourceCanvas.width,
    y: clamp(corner.y, 0, 1) * sourceCanvas.height,
  }));
  const topWidth = distance(sourceCorners[0], sourceCorners[1]);
  const bottomWidth = distance(sourceCorners[3], sourceCorners[2]);
  const leftHeight = distance(sourceCorners[0], sourceCorners[3]);
  const rightHeight = distance(sourceCorners[1], sourceCorners[2]);
  let outputWidth = Math.max(1, Math.round(Math.max(topWidth, bottomWidth)));
  let outputHeight = Math.max(1, Math.round(Math.max(leftHeight, rightHeight)));
  const scale = Math.min(1, maxEdge / Math.max(outputWidth, outputHeight));
  outputWidth = Math.max(1, Math.round(outputWidth * scale));
  outputHeight = Math.max(1, Math.round(outputHeight * scale));

  const h = getHomography(sourceCorners, outputWidth, outputHeight);
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) throw new Error('canvas_context_unavailable');
  const sourceData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;
  const outputCtx = outputCanvas.getContext('2d', { willReadFrequently: true });
  if (!outputCtx) throw new Error('canvas_context_unavailable');
  const output = outputCtx.createImageData(outputWidth, outputHeight);

  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const denom = h[6] * x + h[7] * y + 1;
      const sx = Math.round((h[0] * x + h[1] * y + h[2]) / denom);
      const sy = Math.round((h[3] * x + h[4] * y + h[5]) / denom);
      const targetIndex = (y * outputWidth + x) * 4;
      if (sx < 0 || sx >= sourceCanvas.width || sy < 0 || sy >= sourceCanvas.height) {
        output.data[targetIndex] = 255;
        output.data[targetIndex + 1] = 255;
        output.data[targetIndex + 2] = 255;
        output.data[targetIndex + 3] = 255;
        continue;
      }
      const sourceIndex = (sy * sourceCanvas.width + sx) * 4;
      const [r, g, b] = enhancePixel(
        sourceData.data[sourceIndex],
        sourceData.data[sourceIndex + 1],
        sourceData.data[sourceIndex + 2],
        adjustments,
      );
      output.data[targetIndex] = r;
      output.data[targetIndex + 1] = g;
      output.data[targetIndex + 2] = b;
      output.data[targetIndex + 3] = 255;
    }
  }

  outputCtx.putImageData(output, 0, 0);
  return outputCanvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('image_export_failed'));
    }, 'image/jpeg', quality);
  });
}

export async function renderRotatedScanCanvas(
  sourceUrl: string,
  rotation: ScanAdjustments['rotation'],
  maxEdge = 1200,
): Promise<HTMLCanvasElement> {
  const source = await loadImageSource(sourceUrl);
  try {
    const canvas = drawRotatedSource(source, rotation);
    return scaleCanvas(canvas, maxEdge);
  } finally {
    source.close?.();
  }
}

export async function renderProcessedScanCanvas(
  sourceUrl: string,
  adjustments: ScanAdjustments,
  maxEdge = 900,
): Promise<HTMLCanvasElement> {
  const source = await loadImageSource(sourceUrl);
  try {
    const sourceCanvas = drawRotatedSource(source, adjustments.rotation);
    return renderWarpedCanvas(sourceCanvas, adjustments, maxEdge);
  } finally {
    source.close?.();
  }
}

export async function renderProcessedScanFile(
  sourceUrl: string,
  adjustments: ScanAdjustments,
  fileName: string,
): Promise<File> {
  const source = await loadImageSource(sourceUrl);
  try {
    const sourceCanvas = drawRotatedSource(source, adjustments.rotation);
    const attempts = [
      { maxEdge: 2200, quality: 0.88 },
      { maxEdge: 1900, quality: 0.82 },
      { maxEdge: 1600, quality: 0.76 },
      { maxEdge: 1300, quality: 0.7 },
    ];
    let lastBlob: Blob | null = null;
    for (const attempt of attempts) {
      const outputCanvas = renderWarpedCanvas(sourceCanvas, adjustments, attempt.maxEdge);
      const blob = await canvasToBlob(outputCanvas, attempt.quality);
      lastBlob = blob;
      if (blob.size <= SCAN_MAX_IMAGE_FILE_SIZE_BYTES) {
        return new File([blob], fileName.replace(/\.[^/.]+$/, '.jpg'), {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
      }
    }
    if (!lastBlob) throw new Error('image_export_failed');
    return new File([lastBlob], fileName.replace(/\.[^/.]+$/, '.jpg'), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } finally {
    source.close?.();
  }
}

export async function buildSingleScanPdfFile(files: File[], outputName: string): Promise<File> {
  if (files.length === 0) throw new Error('no_pages');
  const pdf = await PDFDocument.create();
  for (const file of files) {
    const bitmap = await createImageBitmap(file);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const embedded = await pdf.embedJpg(bytes);
      const page = pdf.addPage([bitmap.width, bitmap.height]);
      page.drawImage(embedded, {
        x: 0,
        y: 0,
        width: bitmap.width,
        height: bitmap.height,
      });
    } finally {
      bitmap.close();
    }
  }
  const pdfBytes = await pdf.save();
  return new File([Uint8Array.from(pdfBytes)], outputName.replace(/\.pdf$/i, '') + '.pdf', {
    type: 'application/pdf',
    lastModified: Date.now(),
  });
}
