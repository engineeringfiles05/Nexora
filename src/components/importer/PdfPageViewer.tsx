/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, ImageOff, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import type { SourceRegion } from '../../types/index.ts';

export interface ViewerHighlight {
  id: string;
  region: SourceRegion;
  tone: 'selected' | 'issue' | 'ok';
  label?: string;
}

interface Props {
  file: File | null;
  totalPages: number;
  page: number;
  onPageChange: (page: number) => void;
  highlights: ViewerHighlight[];
  onHighlightClick?: (id: string) => void;
  /** Text of each page, shown when there is no PDF (text input) or as a raw view. */
  pageTexts: { page: number; text: string }[];
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/**
 * Renders the uploaded PDF with pdf.js in the browser. Unlike an <iframe>, this works on
 * phones and tablets and lets us draw the extracted questions' regions over the page.
 */
export const PdfPageViewer: React.FC<Props> = ({ file, totalPages, page, onPageChange, highlights, onHighlightClick, pageTexts }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<any>(null);
  const [zoomIndex, setZoomIndex] = useState(2);
  const [mode, setMode] = useState<'page' | 'text'>(file ? 'page' : 'text');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docVersion, setDocVersion] = useState(0);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setMode(file ? 'page' : 'text');
  }, [file]);

  // Load the document once per file.
  useEffect(() => {
    let cancelled = false;
    docRef.current = null;
    setError(null);
    if (!file) return;
    (async () => {
      try {
        setLoading(true);
        const pdfjs: any = await import('pdfjs-dist');
        const worker: any = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc;
        setDocVersion((v) => v + 1);
      } catch (e: any) {
        if (!cancelled) setError(`The PDF could not be displayed: ${e?.message || e}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      docRef.current?.destroy?.();
      docRef.current = null;
    };
  }, [file]);

  // Render the current page whenever page, zoom or container width changes.
  useEffect(() => {
    if (mode !== 'page') return;
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!doc || !canvas || !container) return;
    let cancelled = false;
    let task: any = null;
    (async () => {
      try {
        const p = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
        const base = p.getViewport({ scale: 1 });
        // Leave room for the panel padding and the highlight outlines at the page edges.
        const fit = Math.max(200, container.clientWidth - 28) / base.width;
        const viewport = p.getViewport({ scale: fit * ZOOMS[zoomIndex] });
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const ctx = canvas.getContext('2d')!;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        task = p.render({ canvasContext: ctx, viewport, canvas });
        await task.promise;
        if (!cancelled) setCanvasSize({ w: Math.floor(viewport.width), h: Math.floor(viewport.height) });
      } catch (e: any) {
        if (!cancelled && e?.name !== 'RenderingCancelledException') setError(`Page ${page} could not be drawn: ${e?.message || e}`);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, [page, zoomIndex, docVersion, mode]);

  // Re-fit when the panel is resized (rotating a tablet, opening the sidebar).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let last = container.clientWidth;
    const observer = new ResizeObserver(() => {
      if (Math.abs(container.clientWidth - last) > 24) {
        last = container.clientWidth;
        setDocVersion((v) => v + 1);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const pageHighlights = highlights.filter((h) => h.region.page === page);
  const text = pageTexts.find((p) => p.page === page)?.text ?? '';
  const pages = Math.max(1, totalPages);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-bold text-white flex items-center gap-1 mr-auto">
          <FileText className="w-4 h-4 text-indigo-400" />
          Original document
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <select
            value={page}
            onChange={(e) => onPageChange(parseInt(e.target.value, 10))}
            className="bg-slate-800 text-white font-mono text-xs px-1.5 py-1 rounded border border-slate-700"
            aria-label="Page"
          >
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                Page {n} / {pages}
              </option>
            ))}
          </select>
          <button
            onClick={() => onPageChange(Math.min(pages, page + 1))}
            disabled={page >= pages}
            className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white"
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        {mode === 'page' && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoomIndex((z) => Math.max(0, z - 1))}
              disabled={zoomIndex === 0}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white"
              aria-label="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="w-11 text-center font-mono text-slate-300">{Math.round(ZOOMS[zoomIndex] * 100)}%</span>
            <button
              onClick={() => setZoomIndex((z) => Math.min(ZOOMS.length - 1, z + 1))}
              disabled={zoomIndex === ZOOMS.length - 1}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white"
              aria-label="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {file && (
          <button
            onClick={() => setMode(mode === 'page' ? 'text' : 'page')}
            className="px-2 py-1 rounded border border-slate-700 bg-slate-800 text-slate-300 hover:text-white font-semibold"
            title="Switch between the page image and the text that was read from it"
          >
            {mode === 'page' ? 'Show read text' : 'Show page'}
          </button>
        )}
      </div>

      <div ref={containerRef} className="flex-1 min-h-0 overflow-auto bg-slate-950 p-2" style={{ scrollbarGutter: 'stable' }}>
        {mode === 'page' && file ? (
          <div className="relative mx-auto w-fit">
            {loading && (
              <div className="p-10 text-slate-400 text-xs flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" /> Loading PDF…
              </div>
            )}
            {error && (
              <div className="p-6 text-rose-300 text-xs flex items-center gap-2">
                <ImageOff className="w-4 h-4" /> {error}
              </div>
            )}
            <canvas ref={canvasRef} className="block bg-white shadow-lg" />
            {canvasSize &&
              pageHighlights.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => onHighlightClick?.(h.id)}
                  title={h.label}
                  aria-label={h.label}
                  className={`absolute rounded-sm transition ${
                    h.tone === 'selected'
                      ? 'border-2 border-indigo-500 bg-indigo-500/10 z-10'
                      : h.tone === 'issue'
                        ? 'border border-amber-500/80 bg-amber-400/10 hover:bg-amber-400/20'
                        : 'border border-emerald-500/40 hover:bg-emerald-400/10'
                  }`}
                  style={{
                    left: `${h.region.x0 * 100}%`,
                    top: `${h.region.y0 * 100}%`,
                    width: `${(h.region.x1 - h.region.x0) * 100}%`,
                    height: `${(h.region.y1 - h.region.y0) * 100}%`,
                    margin: '-3px',
                    padding: '3px',
                    boxSizing: 'content-box',
                  }}
                />
              ))}
          </div>
        ) : (
          <pre className="p-3 font-mono text-xs text-slate-300 whitespace-pre-wrap break-words leading-relaxed select-text">
            {text || 'No text was read from this page.'}
          </pre>
        )}
      </div>
    </div>
  );
};
