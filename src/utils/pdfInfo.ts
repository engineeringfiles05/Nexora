/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Reads a PDF's page count in the browser (before upload), or null if it can't be opened. */
export async function countPdfPages(file: Blob): Promise<number | null> {
  try {
    const pdfjs: any = await import('pdfjs-dist');
    const worker: any = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = doc.numPages as number;
    doc.destroy();
    return pages;
  } catch {
    return null;
  }
}
