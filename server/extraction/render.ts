/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCanvas, type Canvas } from '@napi-rs/canvas';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface RenderedPage {
  canvas: Canvas;
  scale: number;
  png: () => Buffer;
}

/** Renders a page to a white-backed bitmap. Scale 2 ≈ 144 dpi, 3 ≈ 216 dpi. */
export async function renderPage(doc: PDFDocumentProxy, pageNumber: number, scale: number): Promise<RenderedPage> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context as any, canvas: canvas as any, viewport }).promise;
  page.cleanup();
  return { canvas, scale, png: () => canvas.toBuffer('image/png') };
}

/**
 * Crops a region given in page points from a rendered page, as a PNG data URL. Large crops
 * are scaled down so a question document stays well inside Firestore's 1 MiB limit.
 */
export function cropToDataUrl(rendered: RenderedPage, box: { x0: number; y0: number; x1: number; y1: number }, maxBytes = 350_000): string {
  const s = rendered.scale;
  const sx = Math.max(0, Math.floor(box.x0 * s));
  const sy = Math.max(0, Math.floor(box.y0 * s));
  const sw = Math.min(rendered.canvas.width - sx, Math.ceil((box.x1 - box.x0) * s));
  const sh = Math.min(rendered.canvas.height - sy, Math.ceil((box.y1 - box.y0) * s));
  let factor = 1;
  for (let attempt = 0; attempt < 5; attempt++) {
    const out = createCanvas(Math.max(1, Math.round(sw * factor)), Math.max(1, Math.round(sh * factor)));
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(rendered.canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
    const png = out.toBuffer('image/png');
    if (png.length <= maxBytes || attempt === 4) return `data:image/png;base64,${png.toString('base64')}`;
    factor *= 0.7;
  }
  return '';
}
