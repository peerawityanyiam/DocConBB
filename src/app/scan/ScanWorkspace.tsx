'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SCAN_MAX_IMAGE_FILE_SIZE_BYTES,
  SCAN_MAX_IMAGE_FILE_SIZE_LABEL,
  SCAN_MAX_PAGE_COUNT,
} from '@/lib/files/upload-limits';
import {
  buildSingleScanPdfFile,
  createDefaultScanAdjustments,
  renderProcessedScanCanvas,
  renderProcessedScanFile,
  renderRotatedScanCanvas,
  type ScanAdjustments,
} from '@/lib/scans/processing';
import { uploadScanImageResumable, uploadScanPdfResumable } from '@/lib/scans/client-upload';

type ScanStatus = 'DRAFT' | 'PDF_READY' | 'ERROR';

interface ScanPageRow {
  id: string;
  scan_id: string;
  page_index: number;
  original_drive_file_id: string;
  original_drive_file_name: string;
  original_size_bytes: number | null;
  processed_drive_file_id: string | null;
  adjustments: Record<string, unknown>;
}

interface ScanDocument {
  id: string;
  title: string;
  status: ScanStatus;
  latest_pdf_file_id: string | null;
  latest_pdf_file_name: string | null;
  latest_pdf_view_url: string | null;
  latest_pdf_size_bytes: number | null;
  page_count: number;
  updated_at: string;
  pages?: ScanPageRow[];
}

interface ScanWorkspaceProps {
  userEmail: string;
}

const emptyPages: ScanPageRow[] = [];

function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function scanFileUrl(scanId: string, fileId: string) {
  return `/api/scans/${scanId}/files/${fileId}`;
}

function coerceAdjustments(raw: Record<string, unknown> | null | undefined): ScanAdjustments {
  const fallback = createDefaultScanAdjustments();
  if (!raw || typeof raw !== 'object') return fallback;
  const cornersRaw = Array.isArray(raw.corners) ? raw.corners : [];
  const corners = cornersRaw.length === 4
    ? cornersRaw.map((corner) => {
      const c = corner as { x?: unknown; y?: unknown };
      return {
        x: typeof c.x === 'number' ? c.x : 0,
        y: typeof c.y === 'number' ? c.y : 0,
      };
    }) as ScanAdjustments['corners']
    : fallback.corners;
  const rotation = [0, 90, 180, 270].includes(raw.rotation as number)
    ? raw.rotation as ScanAdjustments['rotation']
    : fallback.rotation;
  return {
    corners,
    rotation,
    brightness: typeof raw.brightness === 'number' ? raw.brightness : fallback.brightness,
    contrast: typeof raw.contrast === 'number' ? raw.contrast : fallback.contrast,
    shadowReduction: typeof raw.shadowReduction === 'boolean' ? raw.shadowReduction : fallback.shadowReduction,
    grayscale: typeof raw.grayscale === 'boolean' ? raw.grayscale : fallback.grayscale,
    blackWhite: typeof raw.blackWhite === 'boolean' ? raw.blackWhite : fallback.blackWhite,
  };
}

function serializeAdjustments(adjustments: ScanAdjustments): Record<string, unknown> {
  return {
    corners: adjustments.corners.map((corner) => ({
      x: Number(corner.x.toFixed(5)),
      y: Number(corner.y.toFixed(5)),
    })),
    rotation: adjustments.rotation,
    brightness: adjustments.brightness,
    contrast: Number(adjustments.contrast.toFixed(2)),
    shadowReduction: adjustments.shadowReduction,
    grayscale: adjustments.grayscale,
    blackWhite: adjustments.blackWhite,
  };
}

function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
}

function normalizePdfTitle(value: string) {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
  return cleaned || `เอกสารสแกน ${new Date().toLocaleString('th-TH')}`;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof payload.error === 'string' ? payload.error : `HTTP_${res.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function CornerEditor({
  imageUrl,
  adjustments,
  onChange,
}: {
  imageUrl: string;
  adjustments: ScanAdjustments;
  onChange: (next: ScanAdjustments) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef<number | null>(null);
  const sourceRenderRef = useRef(0);
  const previewRenderRef = useRef(0);
  const [sourceLoading, setSourceLoading] = useState(true);
  const corners = adjustments.corners;

  const copyCanvas = useCallback((source: HTMLCanvasElement, target: HTMLCanvasElement | null) => {
    if (!target) return;
    target.width = source.width;
    target.height = source.height;
    const ctx = target.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(source, 0, 0);
  }, []);

  const updateCorner = useCallback((index: number, event: PointerEvent | React.PointerEvent) => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    const nextCorners = corners.map((corner, i) => i === index ? { x, y } : corner) as ScanAdjustments['corners'];
    onChange({ ...adjustments, corners: nextCorners });
  }, [adjustments, corners, onChange]);

  useEffect(() => {
    const renderId = sourceRenderRef.current + 1;
    sourceRenderRef.current = renderId;
    const timeoutId = window.setTimeout(() => {
      setSourceLoading(true);
      renderRotatedScanCanvas(imageUrl, adjustments.rotation)
        .then((canvas) => {
          if (sourceRenderRef.current !== renderId) return;
          copyCanvas(canvas, sourceCanvasRef.current);
        })
        .catch(() => undefined)
        .finally(() => {
          if (sourceRenderRef.current === renderId) setSourceLoading(false);
        });
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [adjustments.rotation, copyCanvas, imageUrl]);

  useEffect(() => {
    const renderId = previewRenderRef.current + 1;
    previewRenderRef.current = renderId;
    const timeoutId = window.setTimeout(() => {
      renderProcessedScanCanvas(imageUrl, adjustments, 820)
        .then((canvas) => {
          if (previewRenderRef.current !== renderId) return;
          copyCanvas(canvas, previewCanvasRef.current);
        })
        .catch(() => undefined);
    }, 90);
    return () => window.clearTimeout(timeoutId);
  }, [adjustments, copyCanvas, imageUrl]);

  useEffect(() => {
    function handleMove(event: PointerEvent) {
      const index = draggingRef.current;
      if (index === null) return;
      event.preventDefault();
      updateCorner(index, event);
    }
    function handleUp() {
      draggingRef.current = null;
    }
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [updateCorner]);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.72fr)]">
      <div>
        <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-600">
          <span>ลาก 4 มุมบนรูปต้นฉบับ</span>
          <span>{adjustments.rotation}°</span>
        </div>
        <div
          ref={boxRef}
          className="relative touch-none overflow-hidden rounded-lg border border-slate-300 bg-slate-950"
        >
          <canvas ref={sourceCanvasRef} className="block w-full select-none" />
          {sourceLoading && (
            <div className="absolute inset-0 grid place-items-center bg-slate-950/70 text-xs font-semibold text-white">
              กำลังโหลดรูป
            </div>
          )}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <polygon
              points={corners.map((c) => `${c.x * 100},${c.y * 100}`).join(' ')}
              vectorEffect="non-scaling-stroke"
              fill="rgba(14,165,233,0.24)"
              stroke="rgba(14,165,233,0.95)"
              strokeWidth="3"
            />
          </svg>
          {corners.map((corner, index) => (
            <button
              key={index}
              type="button"
              aria-label={`corner ${index + 1}`}
              onPointerDown={(event) => {
                draggingRef.current = index;
                event.currentTarget.setPointerCapture(event.pointerId);
                updateCorner(index, event);
              }}
              className="absolute h-9 w-9 touch-none -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-500 text-[10px] font-bold text-white shadow-lg"
              style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%` }}
            >
              {index + 1}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold text-slate-600">ตัวอย่างผลลัพธ์</div>
        <div className="relative overflow-hidden rounded-lg border border-slate-300 bg-white">
          <canvas ref={previewCanvasRef} className="block w-full select-none" />
        </div>
      </div>
    </div>
  );
}

export default function ScanWorkspace({ userEmail }: ScanWorkspaceProps) {
  const [scans, setScans] = useState<ScanDocument[]>([]);
  const [activeScan, setActiveScan] = useState<ScanDocument | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<ScanAdjustments>(createDefaultScanAdjustments);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [pdfTitle, setPdfTitle] = useState('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isApplyingServerAdjustmentsRef = useRef(false);
  const selectedAdjustmentKeyRef = useRef<string | null>(null);
  const dirtyAdjustmentRef = useRef<{
    scanId: string;
    pageId: string;
    adjustments: ScanAdjustments;
  } | null>(null);
  const saveAdjustmentTimerRef = useRef<number | null>(null);

  const pages = activeScan?.pages ?? emptyPages;
  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? null,
    [pages, selectedPageId],
  );

  const selectedImageUrl = activeScan && selectedPage
    ? scanFileUrl(activeScan.id, selectedPage.original_drive_file_id)
    : '';
  const activeScanId = activeScan?.id ?? null;
  const selectedPagePersistId = selectedPage?.id ?? null;

  const loadScans = useCallback(async () => {
    const data = await jsonFetch<{ scans: ScanDocument[] }>('/api/scans');
    setScans(data.scans);
    return data.scans;
  }, []);

  const loadScan = useCallback(async (scanId: string) => {
    const data = await jsonFetch<{ scan: ScanDocument }>(`/api/scans/${scanId}`);
    setActiveScan(data.scan);
    setPdfTitle(data.scan.title);
    setSelectedPageId((current) => {
      if (current && data.scan.pages?.some((page) => page.id === current)) return current;
      return null;
    });
    return data.scan;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await loadScans();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadScans]);

  useEffect(() => {
    const pageKey = activeScan && selectedPage ? `${activeScan.id}:${selectedPage.id}` : null;
    if (selectedAdjustmentKeyRef.current === pageKey) return;
    selectedAdjustmentKeyRef.current = pageKey;
    if (!selectedPage) {
      isApplyingServerAdjustmentsRef.current = true;
      setAdjustments(createDefaultScanAdjustments());
      return;
    }
    isApplyingServerAdjustmentsRef.current = true;
    setAdjustments(coerceAdjustments(selectedPage.adjustments));
  }, [activeScan, selectedPage]);

  useEffect(() => {
    if (!isApplyingServerAdjustmentsRef.current) return;
    isApplyingServerAdjustmentsRef.current = false;
  }, [adjustments]);

  const persistAdjustments = useCallback(async (
    scanId: string,
    pageId: string,
    value: ScanAdjustments,
  ) => {
    await jsonFetch(`/api/scans/${scanId}/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adjustments: serializeAdjustments(value) }),
    });
    setActiveScan((current) => {
      if (!current || current.id !== scanId) return current;
      return {
        ...current,
        pages: current.pages?.map((page) => (
          page.id === pageId ? { ...page, adjustments: serializeAdjustments(value) } : page
        )),
      };
    });
  }, []);

  const flushAdjustmentSave = useCallback(async () => {
    if (saveAdjustmentTimerRef.current !== null) {
      window.clearTimeout(saveAdjustmentTimerRef.current);
      saveAdjustmentTimerRef.current = null;
    }
    const dirty = dirtyAdjustmentRef.current;
    if (!dirty) return;
    dirtyAdjustmentRef.current = null;
    await persistAdjustments(dirty.scanId, dirty.pageId, dirty.adjustments);
  }, [persistAdjustments]);

  useEffect(() => {
    if (!activeScanId || !selectedPagePersistId || isApplyingServerAdjustmentsRef.current || busy) return;
    dirtyAdjustmentRef.current = {
      scanId: activeScanId,
      pageId: selectedPagePersistId,
      adjustments,
    };
    if (saveAdjustmentTimerRef.current !== null) {
      window.clearTimeout(saveAdjustmentTimerRef.current);
    }
    saveAdjustmentTimerRef.current = window.setTimeout(() => {
      saveAdjustmentTimerRef.current = null;
      const dirty = dirtyAdjustmentRef.current;
      if (!dirty) return;
      dirtyAdjustmentRef.current = null;
      void persistAdjustments(dirty.scanId, dirty.pageId, dirty.adjustments).catch((err) => {
        setError(err instanceof Error ? err.message : 'บันทึกค่าปรับภาพไม่สำเร็จ');
      });
    }, 700);
  }, [activeScanId, adjustments, busy, persistAdjustments, selectedPagePersistId]);

  useEffect(() => () => {
    if (saveAdjustmentTimerRef.current !== null) {
      window.clearTimeout(saveAdjustmentTimerRef.current);
    }
  }, []);

  function createScan() {
    void flushAdjustmentSave().catch((err) => {
      setError(err instanceof Error ? err.message : 'บันทึกค่าปรับภาพไม่สำเร็จ');
    });
    setActiveScan(null);
    setSelectedPageId(null);
    setAdjustments(createDefaultScanAdjustments());
    setPdfTitle('');
    setError('');
    setProgress('');
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function saveAdjustments(pageId = selectedPage?.id, value = adjustments, reload = true) {
    if (!activeScan || !pageId) return;
    await persistAdjustments(activeScan.id, pageId, value);
    if (reload) await loadScan(activeScan.id);
  }

  async function savePdfTitle() {
    if (!activeScan) return activeScan;
    const title = normalizePdfTitle(pdfTitle || activeScan.title);
    setPdfTitle(title);
    if (title === activeScan.title) return activeScan;

    const data = await jsonFetch<{ scan: ScanDocument }>(`/api/scans/${activeScan.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    setActiveScan((current) => current ? { ...current, title: data.scan.title } : data.scan);
    setScans((current) => current.map((scan) => (
      scan.id === data.scan.id ? { ...scan, title: data.scan.title, updated_at: data.scan.updated_at } : scan
    )));
    setPdfTitle(data.scan.title);
    return data.scan;
  }

  async function handleFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    setError('');
    setBusy(true);
    setIsUploadingImages(true);
    try {
      let scan = activeScan;
      if (!scan) {
        const created = await jsonFetch<{ scan: ScanDocument }>('/api/scans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: `เอกสารสแกน ${new Date().toLocaleString('th-TH')}` }),
        });
        scan = created.scan;
        await loadScans();
      }
      const currentCount = scan.pages?.length ?? scan.page_count ?? 0;
      if (currentCount + fileArray.length > SCAN_MAX_PAGE_COUNT) {
        throw new Error(`สแกนได้สูงสุด ${SCAN_MAX_PAGE_COUNT} หน้า`);
      }
      for (const file of fileArray) {
        if (!isImageFile(file)) throw new Error(`ไม่รองรับไฟล์ ${file.name}`);
        if (file.size > SCAN_MAX_IMAGE_FILE_SIZE_BYTES) {
          throw new Error(`${file.name} เกิน ${SCAN_MAX_IMAGE_FILE_SIZE_LABEL}`);
        }
      }
      for (let i = 0; i < fileArray.length; i += 1) {
        const file = fileArray[i];
        setProgress(`อัปโหลดรูป ${i + 1}/${fileArray.length}`);
        await uploadScanImageResumable({
          scanId: scan.id,
          file,
          kind: 'original',
          onProgress: (percent) => setProgress(`อัปโหลดรูป ${i + 1}/${fileArray.length} ${percent}%`),
        });
      }
      await loadScans();
      await loadScan(scan.id);
      setSelectedPageId(null);
      setProgress('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'อัปโหลดรูปไม่สำเร็จ');
    } finally {
      setIsUploadingImages(false);
      setBusy(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function deletePage(pageId: string) {
    if (!activeScan || !confirm('ลบหน้านี้?')) return;
    setBusy(true);
    setError('');
    try {
      await flushAdjustmentSave();
      await jsonFetch(`/api/scans/${activeScan.id}/pages/${pageId}`, { method: 'DELETE' });
      await loadScans();
      await loadScan(activeScan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ลบหน้าไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function movePage(pageId: string, direction: -1 | 1) {
    if (!activeScan) return;
    const ids = pages.map((page) => page.id);
    const index = ids.indexOf(pageId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    setBusy(true);
    setError('');
    try {
      await flushAdjustmentSave();
      await jsonFetch(`/api/scans/${activeScan.id}/pages`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedPageIds: ids }),
      });
      await loadScan(activeScan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'จัดลำดับหน้าไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function generatePdf() {
    if (!activeScan || pages.length === 0) return;
    const editingPage = selectedPage;
    const editingAdjustments = adjustments;
    setBusy(true);
    setIsGeneratingPdf(true);
    setSelectedPageId(null);
    setError('');
    setProgress('กำลังสร้าง PDF...');
    try {
      await flushAdjustmentSave();
      const titleScan = await savePdfTitle();
      if (editingPage) await saveAdjustments(editingPage.id, editingAdjustments, false);
      const latestScan = await loadScan(activeScan.id);
      const latestPages = latestScan.pages ?? [];
      const processedFiles: File[] = [];
      for (let i = 0; i < latestPages.length; i += 1) {
        const page = latestPages[i];
        const pageAdjustments = page.id === editingPage?.id
          ? editingAdjustments
          : coerceAdjustments(page.adjustments);
        setProgress(`ปรับภาพหน้า ${i + 1}/${latestPages.length}`);
        const file = await renderProcessedScanFile(
          scanFileUrl(latestScan.id, page.original_drive_file_id),
          pageAdjustments,
          `scan-${i + 1}.jpg`,
        );
        processedFiles.push(file);
        await uploadScanImageResumable({
          scanId: latestScan.id,
          file,
          kind: 'processed',
          pageId: page.id,
          adjustments: serializeAdjustments(pageAdjustments),
          onProgress: (percent) => setProgress(`อัปโหลดภาพหน้า ${i + 1}/${latestPages.length} ${percent}%`),
        });
      }
      setProgress('สร้าง PDF');
      const pdfBaseName = normalizePdfTitle(titleScan?.title || pdfTitle || latestScan.title || 'scan');
      const pdfFile = await buildSingleScanPdfFile(processedFiles, `${pdfBaseName}.pdf`);
      setProgress(`อัปโหลด PDF ${formatBytes(pdfFile.size)}`);
      await uploadScanPdfResumable({
        scanId: latestScan.id,
        file: pdfFile,
        onProgress: (percent) => setProgress(`อัปโหลด PDF ${percent}%`),
      });
      await loadScans();
      await loadScan(latestScan.id);
      setProgress('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'สร้าง PDF ไม่สำเร็จ');
    } finally {
      setIsGeneratingPdf(false);
      setBusy(false);
    }
  }

  const handleAdjustmentChange = (patch: Partial<ScanAdjustments>) => {
    setAdjustments((current) => ({ ...current, ...patch }));
  };

  return (
    <main className="min-h-screen bg-[#f6f8fb] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <Link href="/" className="text-xs font-semibold text-[#003366] hover:underline">← หน้าแรก</Link>
            <h1 className="truncate text-lg font-bold text-[#003366]">สแกนเอกสารเป็น PDF</h1>
            <p className="truncate text-[0.72rem] text-slate-500">{userEmail}</p>
          </div>
          <button
            type="button"
            onClick={createScan}
            disabled={busy}
            className="rounded-lg bg-[#003366] px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
          >
            + ชุดใหม่
          </button>
        </div>
      </header>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => event.target.files && void handleFiles(event.target.files)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => event.target.files && void handleFiles(event.target.files)}
      />

      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800">รายการสแกน</h2>
            {loading && <span className="text-xs text-slate-400">โหลด...</span>}
          </div>
          {scans.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">ยังไม่มีรายการ กด “ชุดใหม่” เพื่อเริ่ม</p>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-slate-600">
                เลือกชุดสแกน
                <select
                  value={activeScan?.id ?? ''}
                  onChange={(event) => {
                    if (!event.target.value) {
                      createScan();
                      return;
                    }
                    setSelectedPageId(null);
                    void loadScan(event.target.value);
                  }}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                >
                  <option value="">ชุดใหม่</option>
                  {scans.map((scan) => (
                    <option key={scan.id} value={scan.id}>
                      {scan.title} · {scan.page_count} หน้า
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </aside>

        <section className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}
          {progress && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-800">{progress}</div>
          )}

          {!activeScan ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
              {isUploadingImages ? (
                <div>
                  <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-[#003366]" />
                  <h2 className="mt-4 text-lg font-bold text-slate-800">กำลังสร้างชุดสแกน</h2>
                  <p className="mt-2 text-sm text-slate-500">ระบบจะเริ่มบันทึกเมื่ออัปโหลดรูปแรกสำเร็จ</p>
                </div>
              ) : (
                <>
                  <h2 className="text-lg font-bold text-slate-800">เริ่มสแกนเอกสาร</h2>
                  <p className="mt-2 text-sm text-slate-500">ถ่ายรูปหรือเลือกรูปเพื่อสร้างชุดสแกนใหม่</p>
                  <div className="mt-5 grid gap-2 sm:mx-auto sm:max-w-sm sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      disabled={busy}
                      className="rounded-lg bg-[#00a896] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      ถ่ายรูป
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy}
                      className="rounded-lg border border-[#003366]/30 bg-white px-5 py-2.5 text-sm font-semibold text-[#003366] disabled:opacity-50"
                    >
                      เลือกรูป
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-bold text-slate-900">{activeScan.title}</h2>
                    <p className="mt-1 text-xs text-slate-500">UUID: {activeScan.id}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      disabled={busy || pages.length >= SCAN_MAX_PAGE_COUNT}
                      className="rounded-lg bg-[#00a896] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      ถ่ายรูป
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy || pages.length >= SCAN_MAX_PAGE_COUNT}
                      className="rounded-lg border border-[#003366]/30 bg-white px-4 py-2 text-sm font-semibold text-[#003366] disabled:opacity-50"
                    >
                      เลือกรูป
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  จำกัด {SCAN_MAX_IMAGE_FILE_SIZE_LABEL} ต่อรูป, สูงสุด {SCAN_MAX_PAGE_COUNT} รูปต่อชุด
                </p>
              </div>

              <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <h3 className="mb-3 text-sm font-bold text-slate-700">หน้าเอกสาร</h3>
                  <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
                    {pages.map((page, index) => (
                      <button
                        key={page.id}
                        type="button"
                        onClick={() => {
                          void flushAdjustmentSave()
                            .then(() => setSelectedPageId(page.id))
                            .catch((err) => {
                              setError(err instanceof Error ? err.message : 'บันทึกค่าปรับภาพไม่สำเร็จ');
                            });
                        }}
                        className={`rounded-lg border p-2 text-left ${
                          selectedPage?.id === page.id
                            ? 'border-sky-500 bg-sky-50'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="aspect-[3/4] overflow-hidden rounded bg-slate-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={scanFileUrl(activeScan.id, page.processed_drive_file_id || page.original_drive_file_id)}
                            alt={`page ${index + 1}`}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-1 text-xs">
                          <span className="font-semibold text-slate-700">หน้า {index + 1}</span>
                          <span className="text-slate-400">{page.processed_drive_file_id ? 'ปรับแล้ว' : formatBytes(page.original_size_bytes)}</span>
                        </div>
                        <div className="mt-2 flex gap-1">
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(event) => { event.stopPropagation(); void movePage(page.id, -1); }}
                            onKeyDown={(event) => { if (event.key === 'Enter') void movePage(page.id, -1); }}
                            className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600"
                          >
                            ↑
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(event) => { event.stopPropagation(); void movePage(page.id, 1); }}
                            onKeyDown={(event) => { if (event.key === 'Enter') void movePage(page.id, 1); }}
                            className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600"
                          >
                            ↓
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(event) => { event.stopPropagation(); void deletePage(page.id); }}
                            onKeyDown={(event) => { if (event.key === 'Enter') void deletePage(page.id); }}
                            className="ml-auto rounded bg-red-50 px-2 py-1 text-xs text-red-600"
                          >
                            ลบ
                          </span>
                        </div>
                      </button>
                    ))}
                    {isUploadingImages && (
                      <div className="rounded-lg border border-dashed border-sky-300 bg-sky-50 p-2">
                        <div className="grid aspect-[3/4] place-items-center rounded bg-white">
                          <div className="h-8 w-8 animate-spin rounded-full border-4 border-sky-200 border-t-sky-600" />
                        </div>
                        <div className="mt-2 text-center text-xs font-semibold text-sky-700">
                          กำลังเพิ่มรูป
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
                  {!selectedPage ? (
                    <div className="grid min-h-[260px] place-items-center rounded-lg bg-slate-50 px-4 py-12 text-center">
                      {isUploadingImages ? (
                        <div>
                          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-[#003366]" />
                          <div className="mt-4 text-sm font-semibold text-slate-700">กำลังโหลดรูปเข้ารายการ</div>
                        </div>
                      ) : (
                        <div>
                          <div className="text-sm font-semibold text-slate-700">กดที่รูปเพื่อแก้ไข</div>
                          <div className="mt-1 text-xs text-slate-500">ระบบจะโหลดเครื่องมือปรับภาพเฉพาะหน้าที่เลือก</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <CornerEditor
                        imageUrl={selectedImageUrl}
                        adjustments={adjustments}
                        onChange={setAdjustments}
                      />
                      <div className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
                        <label className="text-xs font-semibold text-slate-600">
                          ความสว่าง
                          <input
                            type="range"
                            min={-50}
                            max={60}
                            value={adjustments.brightness}
                            onChange={(event) => handleAdjustmentChange({ brightness: Number(event.target.value) })}
                            className="mt-2 w-full"
                          />
                        </label>
                        <label className="text-xs font-semibold text-slate-600">
                          Contrast
                          <input
                            type="range"
                            min={0.7}
                            max={1.7}
                            step={0.05}
                            value={adjustments.contrast}
                            onChange={(event) => handleAdjustmentChange({ contrast: Number(event.target.value) })}
                            className="mt-2 w-full"
                          />
                        </label>
                        <div className="flex flex-wrap gap-2 sm:col-span-2">
                          <button
                            type="button"
                            onClick={() => handleAdjustmentChange({ rotation: ((adjustments.rotation + 90) % 360) as ScanAdjustments['rotation'] })}
                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"
                          >
                            หมุน 90°
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAdjustmentChange({ shadowReduction: !adjustments.shadowReduction })}
                            className={`rounded-md border px-3 py-2 text-xs font-semibold ${adjustments.shadowReduction ? 'border-sky-400 bg-sky-50 text-sky-700' : 'border-slate-300 bg-white'}`}
                          >
                            ลดเงา
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAdjustmentChange({ grayscale: !adjustments.grayscale, blackWhite: false })}
                            className={`rounded-md border px-3 py-2 text-xs font-semibold ${adjustments.grayscale ? 'border-sky-400 bg-sky-50 text-sky-700' : 'border-slate-300 bg-white'}`}
                          >
                            Grayscale
                          </button>
                          <button
                            type="button"
                            onClick={() => setAdjustments(createDefaultScanAdjustments())}
                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <label className="block text-xs font-semibold text-slate-600">
                  ชื่อ PDF
                  <input
                    type="text"
                    value={pdfTitle}
                    onChange={(event) => setPdfTitle(event.target.value)}
                    onBlur={() => {
                      void savePdfTitle().catch((err) => {
                        setError(err instanceof Error ? err.message : 'เปลี่ยนชื่อ PDF ไม่สำเร็จ');
                      });
                    }}
                    disabled={busy}
                    maxLength={120}
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-60"
                    placeholder="ตั้งชื่อ PDF"
                  />
                </label>
                <div className="mt-4 border-t border-slate-100 pt-4">
                  {isGeneratingPdf ? (
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 shrink-0 animate-spin rounded-full border-4 border-slate-200 border-t-[#003366]" />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-800">กำลังสร้าง PDF</div>
                        <div className="mt-1 truncate text-xs text-slate-500">
                          {progress || 'ระบบกำลังปรับภาพและรวมไฟล์'}
                        </div>
                      </div>
                    </div>
                  ) : activeScan.latest_pdf_view_url ? (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-800">PDF ล่าสุด</div>
                        <div className="mt-1 truncate text-xs text-slate-500">
                          {activeScan.latest_pdf_file_name || 'scan.pdf'} · {formatBytes(activeScan.latest_pdf_size_bytes)}
                        </div>
                      </div>
                      <a
                        href={activeScan.latest_pdf_view_url ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex justify-center rounded-lg border border-green-300 bg-green-50 px-4 py-2 text-sm font-semibold text-green-700"
                      >
                        เปิด PDF
                      </a>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">ยังไม่มี PDF ที่สร้างแล้ว</div>
                  )}
                </div>
              </div>

              <div className="sticky bottom-0 z-20 rounded-t-lg border border-slate-200 bg-white p-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)]">
                <button
                  type="button"
                  onClick={() => void generatePdf()}
                  disabled={busy || pages.length === 0}
                  className="w-full rounded-lg bg-[#c5a059] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  {isGeneratingPdf
                    ? progress || 'กำลังสร้าง PDF...'
                    : activeScan.latest_pdf_file_id ? 'สร้าง PDF ใหม่' : 'สร้าง PDF'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
