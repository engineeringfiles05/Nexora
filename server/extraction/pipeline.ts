/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The extraction pipeline:
 *
 *   1. Read each page's own text layer with positions (layout.ts).
 *   2. Decide per page whether that text can be trusted. Scanned pages, pages whose glyphs
 *      don't map to real characters, and pictures of text go to page-image reading.
 *   3. Read page images (scanned pages twice, at two resolutions; text pages once, as an
 *      independent check of the text layer).
 *   4. Split both readings into questions with the same deterministic parser and compare
 *      them question by question and choice by choice. Agreement is recorded; every
 *      disagreement is attached to the question with both readings.
 *   5. Crop figures and attach them to the question they belong to.
 *   6. Build the per-page and per-document report.
 *
 * No step rewrites question text. AI is only ever used to *read* a page image.
 */

import { createHash } from 'node:crypto';
import type { ExtractedFigure, ExtractionIssue, ExtractionReport, PageExtractionReport, Question, SourceRegion } from '../../src/types/index.ts';
import {
  buildExtractionReport,
  normalizeForCompare,
  parseQuestionLines,
  questionKey,
  refreshQuestionAssessment,
  stageParsedQuestions,
  textToSourceLines,
  type ParsedQuestion,
  type SourceLine,
} from '../../src/utils/questionExtractor.ts';
import { analyzePage, growFiguresToLabels, openPdf, removeRunningHeaders, type FigureRegion, type PageLayout } from './layout.ts';
import type { PageImageReader, ReadLine } from './imageReader.ts';
import { cropToDataUrl, renderPage } from './render.ts';

export interface ExtractionProgress {
  stage: string;
  percent: number;
  page?: number;
  totalPages?: number;
}

export interface PipelineOptions {
  filename: string;
  fileSize?: string;
  bytes?: Uint8Array;
  text?: string;
  reader?: PageImageReader | null;
  /** Read text pages' images too and compare them with the text layer. Default: on when a reader exists. */
  crossCheck?: boolean;
  /** Readings of each scanned page (1 or 2). Two independent readings can confirm each other. */
  scannedPasses?: 1 | 2;
  concurrency?: number;
  onProgress?: (p: ExtractionProgress) => void;
  /** Epoch ms after which the extraction stops with a clear error (serverless time limits). */
  deadline?: number;
  /** Aborted when the caller goes away (client disconnect); the run stops and reads are cancelled. */
  signal?: AbortSignal;
}

export interface PipelineResult {
  filename: string;
  totalPages: number;
  documentHash: string;
  sourcePdfId: string;
  questions: Question[];
  report: ExtractionReport;
  documentIssues: ExtractionIssue[];
  preamble: string;
  engine: string;
  /** Text of each page as used for extraction, for the raw-text view. */
  pageTexts: { page: number; text: string }[];
}

export class ExtractionError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

export async function runExtraction(options: PipelineOptions): Promise<PipelineResult> {
  if (options.bytes) return extractPdf(options);
  if (typeof options.text === 'string') return extractText(options);
  throw new ExtractionError('No document was provided.', 400);
}

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

const deadlineMessage = (done: number, total: number) =>
  `This document needs more processing time than this hosting allows (stopped after ${done} of ${total} page(s)). Split the PDF into smaller files and import them one at a time.`;

/**
 * Stops a run at its deadline or when the caller goes away. Every awaited step is raced
 * against it, so a slow page reading can't run past the hosting's time limit, and the abort
 * signal is passed on to the page reader so the request to the model is cancelled too.
 */
export class RunControl {
  private readonly controller = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  done = 0;
  total = 0;

  constructor(deadline?: number, cancel?: AbortSignal) {
    if (cancel) {
      const onCancel = () => this.controller.abort(new ExtractionError('The extraction was cancelled because the connection closed.', 499));
      if (cancel.aborted) onCancel();
      else cancel.addEventListener('abort', onCancel, { once: true });
    }
    if (deadline !== undefined && !this.signal.aborted) {
      this.timer = setTimeout(() => this.controller.abort(new ExtractionError(deadlineMessage(this.done, this.total), 504)), Math.max(0, deadline - Date.now()));
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  check() {
    if (this.signal.aborted) throw this.signal.reason;
  }

  /** Resolves with the work, or rejects as soon as the run is stopped. */
  guard<T>(work: Promise<T>): Promise<T> {
    if (this.signal.aborted) {
      work.catch(() => {});
      return Promise.reject(this.signal.reason);
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(this.signal.reason);
      this.signal.addEventListener('abort', onAbort, { once: true });
      work.then(
        (value) => {
          this.signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error) => {
          this.signal.removeEventListener('abort', onAbort);
          reject(this.signal.aborted ? this.signal.reason : error);
        }
      );
    });
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
  }
}

/** Stops before the hosting's time limit cuts the request off without an answer. */
export function checkDeadline(deadline: number | undefined, done: number, total: number, now = Date.now()) {
  if (deadline !== undefined && now > deadline) {
    throw new ExtractionError(deadlineMessage(done, total), 504);
  }
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

function extractText(options: PipelineOptions): PipelineResult {
  const text = options.text ?? '';
  const documentHash = sha256(text);
  const sourcePdfId = `pdf-${documentHash.slice(0, 16)}`;
  const lines = textToSourceLines(text);
  const pageNumbers = [...new Set(lines.map((l) => l.page))].sort((a, b) => a - b);
  const pages = pageNumbers.map((page) => ({ page, lines: lines.filter((l) => l.page === page), removedLines: [] as string[] }));
  if (pages.length > 1) removeRunningHeaders(pages);
  const kept = pages.flatMap((p) => p.lines);
  const parsed = parseQuestionLines(kept);
  const questions = stageParsedQuestions(parsed.questions, {
    sourcePdfId,
    sourcePdfName: options.filename,
    documentHash,
    method: 'text',
  });
  const pageReports: PageExtractionReport[] = pages.map((p) => ({
    page: p.page,
    method: 'text',
    textLayerChars: p.lines.reduce((s, l) => s + l.text.replace(/\s/g, '').length, 0),
    questionNumbers: parsed.questions.filter((q) => q.pages.includes(p.page)).map((q) => q.number),
    status: 'ok',
    issues: [],
    removedLines: p.removedLines,
  }));
  const engine = 'Plain-text questionnaire parser';
  return {
    filename: options.filename,
    totalPages: Math.max(1, pageNumbers.length),
    documentHash,
    sourcePdfId,
    questions,
    report: buildExtractionReport({
      filename: options.filename,
      fileSize: options.fileSize,
      totalPages: Math.max(1, pageNumbers.length),
      questions,
      pages: pageReports,
      documentIssues: parsed.issues,
      engineUsed: engine,
      documentHash,
      answerKeyFound: parsed.answerKey.length > 0,
      imageReadingAvailable: false,
    }),
    documentIssues: parsed.issues,
    preamble: parsed.preamble,
    engine,
    pageTexts: pages.map((p) => ({ page: p.page, text: p.lines.map((l) => l.text).join('\n') })),
  };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

interface PageState {
  layout: PageLayout;
  /** The text layer cannot be trusted; this page is read from its image. */
  imageMode: boolean;
  reasons: string[];
  first?: ReadLine[];
  second?: ReadLine[];
  readError?: string;
  imageFigures: FigureRegion[];
}

function pageNeedsImage(l: PageLayout): string[] {
  const reasons: string[] = [];
  if (l.textChars < 25) reasons.push(l.imageCoverage > 0.3 ? 'The page is a scanned image with no text layer.' : 'The page has almost no text layer.');
  else if (l.unreadableChars / Math.max(1, l.textChars) > 0.02) reasons.push(`${l.unreadableChars} character(s) in the text layer do not map to readable letters (embedded font without a character map).`);
  else if (l.imageCoverage > 0.85) reasons.push('The page is a full-page scan; its hidden text layer may come from earlier OCR and is not trusted.');
  else if (l.textChars < 80 && (l.imageCoverage > 0.3 || l.vectorPathCount > 400)) reasons.push('Most of the page is drawn as pictures or outlines rather than text.');
  return reasons;
}

async function extractPdf(options: PipelineOptions): Promise<PipelineResult> {
  const bytes = options.bytes!;
  const control = new RunControl(options.deadline, options.signal);
  // No progress after the run stopped (the client may be gone).
  const progress = (p: ExtractionProgress) => {
    if (!control.signal.aborted) options.onProgress?.(p);
  };
  try {
    return await extractPdfWith(options, bytes, control, progress);
  } finally {
    control.dispose();
  }
}

async function extractPdfWith(
  options: PipelineOptions,
  bytes: Uint8Array,
  control: RunControl,
  progress: (p: ExtractionProgress) => void
): Promise<PipelineResult> {
  const documentHash = sha256(bytes);
  const sourcePdfId = `pdf-${documentHash.slice(0, 16)}`;
  const reader = options.reader ?? null;
  const crossCheck = options.crossCheck ?? Boolean(reader);
  const scannedPasses = options.scannedPasses ?? 2;

  let doc;
  try {
    doc = await openPdf(bytes);
  } catch (error: any) {
    const encrypted = /password/i.test(String(error?.message));
    throw new ExtractionError(encrypted ? 'This PDF is password-protected. Remove the password and upload it again.' : 'This file could not be opened as a PDF.');
  }

  try {
    const totalPages = doc.numPages;
    control.total = totalPages;
    const states: PageState[] = [];
    for (let p = 1; p <= totalPages; p++) {
      control.done = p - 1;
      control.check();
      progress({ stage: `Reading the text layer of page ${p} of ${totalPages}`, percent: Math.round((p / totalPages) * 30), page: p, totalPages });
      const layout = await control.guard(analyzePage(doc, p));
      const reasons = pageNeedsImage(layout);
      states.push({ layout, imageMode: reasons.length > 0, reasons, imageFigures: [] });
    }
    removeRunningHeaders(states.filter((s) => !s.imageMode).map((s) => s.layout));
    states.forEach((s) => growFiguresToLabels(s.layout));

    // Page images: read where needed, crop figures everywhere.
    const crops = new Map<string, ExtractedFigure>();
    let done = 0;
    control.done = 0;
    await pool(states, options.concurrency ?? 2, async (state) => {
      control.check();
      const p = state.layout.page;
      const wantFirst = reader && (state.imageMode || crossCheck);
      const wantSecond = reader && state.imageMode && scannedPasses === 2;
      const hasFigures = state.layout.figures.length > 0;
      try {
        if (wantFirst || hasFigures) {
          const high = await control.guard(renderPage(doc, p, state.imageMode ? 2.5 : 2));
          if (wantFirst) state.first = await control.guard(reader!.read(high.png(), p, 1, control.signal));
          if (state.first) state.imageFigures = figuresFromReading(state.first, state.layout);
          for (const fig of [...state.layout.figures, ...(state.imageMode ? state.imageFigures : [])]) {
            crops.set(fig.id, toExtractedFigure(fig, state.layout, cropToDataUrl(high, fig.box)));
          }
        }
        if (wantSecond) {
          const other = await control.guard(renderPage(doc, p, 2));
          state.second = await control.guard(reader!.read(other.png(), p, 2, control.signal));
        }
      } catch (error: any) {
        // A stopped run ends the extraction; any other failure is reported on its page.
        if (control.signal.aborted) throw control.signal.reason;
        state.readError = String(error?.message || error);
      }
      done++;
      control.done = done;
      progress({
        stage: reader ? `Reading page images (${done} of ${totalPages})` : `Capturing figures (${done} of ${totalPages})`,
        percent: 30 + Math.round((done / totalPages) * 55),
        page: p,
        totalPages,
      });
    });

    progress({ stage: 'Separating questions, choices and answers', percent: 88, totalPages });

    // Primary reading: the text layer, or the first image reading for image pages.
    const primaryPages = states.map((s) => ({
      page: s.layout.page,
      lines: s.imageMode ? toSourceLines(s.first ?? [], s.layout.page, s.imageFigures) : s.layout.lines,
      removedLines: s.imageMode ? [] : s.layout.removedLines,
    }));
    removeRunningHeaders(primaryPages.filter((_, i) => states[i].imageMode));
    states.forEach((s, i) => {
      if (s.imageMode) s.layout.removedLines.push(...primaryPages[i].removedLines);
    });

    // Second, independent reading of the same pages.
    const secondaryPages = states
      .map((s) => {
        const reading = s.imageMode ? s.second : s.first;
        return reading ? { page: s.layout.page, lines: toSourceLines(reading, s.layout.page, []), removedLines: [] as string[] } : null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
    removeRunningHeaders(secondaryPages);
    const checkedPages = new Set(secondaryPages.map((p) => p.page));

    const primary = parseQuestionLines(primaryPages.flatMap((p) => p.lines));
    const secondary = secondaryPages.length ? parseQuestionLines(secondaryPages.flatMap((p) => p.lines)) : null;
    const imagePages = new Set(states.filter((s) => s.imageMode).map((s) => s.layout.page));

    progress({ stage: 'Comparing the two readings of every question', percent: 93, totalPages });

    const crossChecks: Record<string, { result: 'agree' | 'differ'; issues: ExtractionIssue[] }> = {};
    const questions = [...primary.questions];
    if (secondary) {
      for (const q of primary.questions) {
        if (!q.pages.every((p) => checkedPages.has(p))) continue;
        const other = secondary.questions.find((o) => o.section === q.section && o.number === q.number);
        const bothImage = q.pages.every((p) => imagePages.has(p));
        crossChecks[questionKey(q)] = compareReadings(q, other, bothImage);
      }
      // Questions visible in the page image but missing from the text layer.
      for (const o of secondary.questions) {
        if (questions.some((q) => q.section === o.section && q.number === o.number)) continue;
        if (o.pages.some((p) => imagePages.has(p))) continue;
        o.issues.push({
          code: 'ONLY_IN_PAGE_IMAGE',
          severity: 'warning',
          message: 'This question was read from the page image but is not in the PDF text layer (it may be a picture of text). Check it carefully.',
          page: o.pages[0],
        });
        const at = questions.findIndex((q) => q.section > o.section || (q.section === o.section && q.number > o.number));
        questions.splice(at < 0 ? questions.length : at, 0, o);
        crossChecks[questionKey(o)] = { result: 'differ', issues: [] };
      }
    }

    assignFigures(questions, crops);

    const staged = stageParsedQuestions(questions, {
      sourcePdfId,
      sourcePdfName: options.filename,
      documentHash,
      method: 'native',
      crossChecks,
      figures: Object.fromEntries(crops),
    }).map((q, i) => {
      const pages = questions[i].pages;
      const method = pages.every((p) => imagePages.has(p)) ? 'ocr' : pages.some((p) => checkedPages.has(p)) ? 'native+ocr' : 'native';
      const issues = [...(q.extractionIssues ?? [])];
      if (method === 'ocr' && !crossChecks[questionKey(questions[i])]) {
        issues.push({ code: 'SINGLE_IMAGE_READING', severity: 'warning', message: 'This question comes from a single reading of a scanned page and could not be confirmed by a second reading.' });
      }
      return { ...q, extractionMethod: method, extractionIssues: issues } as Question;
    });

    const pageReports = states.map((s) => pageReport(s, primary.questions, crossChecks, checkedPages));
    const engine = reader
      ? `PDF text layer + ${reader.name}${crossCheck ? ' (independent cross-check)' : ''}`
      : 'PDF text layer (page-image reading not configured)';
    const finalQuestions = staged.map(refreshQuestionAssessment);

    const report = buildExtractionReport({
      filename: options.filename,
      fileSize: options.fileSize,
      totalPages,
      questions: finalQuestions,
      pages: pageReports,
      documentIssues: primary.issues,
      engineUsed: engine,
      documentHash,
      answerKeyFound: primary.answerKey.length > 0,
      imageReadingAvailable: Boolean(reader),
    });
    progress({ stage: 'Extraction finished', percent: 100, totalPages });

    return {
      filename: options.filename,
      totalPages,
      documentHash,
      sourcePdfId,
      questions: finalQuestions,
      report,
      documentIssues: primary.issues,
      preamble: primary.preamble,
      engine,
      pageTexts: primaryPages.map((p) => ({ page: p.page, text: p.lines.map((l) => l.text).join('\n') })),
    };
  } finally {
    await doc.destroy();
  }
}

// ---------------------------------------------------------------------------
// Comparing two readings
// ---------------------------------------------------------------------------

export function compareReadings(
  q: ParsedQuestion,
  other: ParsedQuestion | undefined,
  bothFromImage: boolean
): { result: 'agree' | 'differ'; issues: ExtractionIssue[] } {
  const label = bothFromImage ? 'Two independent readings of the scanned page' : 'The PDF text layer and the page image';
  if (!other) {
    return {
      result: 'differ',
      issues: [
        {
          code: 'NOT_IN_SECOND_READING',
          severity: 'warning',
          message: `${label} disagree: question ${q.number} was not found in the ${bothFromImage ? 'second reading' : 'page image'}.`,
          page: q.pages[0],
        },
      ],
    };
  }
  const issues: ExtractionIssue[] = [];
  if (normalizeForCompare(q.stem) !== normalizeForCompare(other.stem)) {
    issues.push({
      code: 'READINGS_DIFFER',
      severity: 'warning',
      message: `${label} read the question text differently.`,
      field: 'stem',
      page: q.pages[0],
      readings: { textLayer: q.stem, pageImage: other.stem },
    });
  }
  const keys = new Set([...q.options.map((o) => o.key), ...other.options.map((o) => o.key)]);
  for (const key of [...keys].sort()) {
    const a = q.options.find((o) => o.key === key)?.text;
    const b = other.options.find((o) => o.key === key)?.text;
    if (a === undefined || b === undefined || normalizeForCompare(a) !== normalizeForCompare(b)) {
      issues.push({
        code: 'READINGS_DIFFER',
        severity: 'warning',
        message: `${label} read choice ${key} differently.`,
        field: 'choice',
        choiceKey: key,
        page: q.pages[0],
        readings: { textLayer: a ?? '(missing)', pageImage: b ?? '(missing)' },
      });
    }
  }
  return { result: issues.length ? 'differ' : 'agree', issues };
}

// ---------------------------------------------------------------------------
// Page-image readings → source lines and figures
// ---------------------------------------------------------------------------

function figuresFromReading(lines: ReadLine[], layout: PageLayout): FigureRegion[] {
  const out: FigureRegion[] = [];
  lines.forEach((l, i) => {
    if (l.kind !== 'figure' || !l.box) return;
    out.push({
      id: `p${layout.page}-img${i}`,
      page: layout.page,
      kind: 'image',
      box: { x0: l.box.x0 * layout.width, y0: l.box.y0 * layout.height, x1: l.box.x1 * layout.width, y1: l.box.y1 * layout.height },
    });
  });
  return out;
}

function toSourceLines(lines: ReadLine[], page: number, figures: FigureRegion[]): SourceLine[] {
  const out: SourceLine[] = [];
  let figureId: string | undefined;
  lines.forEach((l, i) => {
    if (l.kind === 'figure') {
      figureId = figures.find((f) => f.id === `p${page}-img${i}`)?.id ?? `p${page}-img${i}`;
      return;
    }
    const bbox: SourceRegion | undefined = l.box ? { page, ...l.box } : undefined;
    out.push({
      text: l.text,
      page,
      ...(bbox ? { bbox } : {}),
      ...(l.kind === 'label' && figureId ? { figureId } : {}),
      ...(/⟦/.test(l.text) ? { flags: ['reading_uncertain' as const] } : {}),
    });
    if (l.kind !== 'label') figureId = undefined;
  });
  return out;
}

function toExtractedFigure(fig: FigureRegion, layout: PageLayout, dataUrl: string): ExtractedFigure {
  return {
    id: fig.id,
    page: fig.page,
    kind: fig.kind,
    region: { page: fig.page, x0: fig.box.x0 / layout.width, y0: fig.box.y0 / layout.height, x1: fig.box.x1 / layout.width, y1: fig.box.y1 / layout.height },
    ...(dataUrl ? { dataUrl } : {}),
    attachedBy: 'auto',
  };
}

/** Figures without labels go to the question they sit inside, else the one just above. */
function assignFigures(questions: ParsedQuestion[], crops: Map<string, ExtractedFigure>) {
  const used = new Set(questions.flatMap((q) => q.figureIds));
  for (const fig of crops.values()) {
    if (used.has(fig.id)) continue;
    const r = fig.region;
    const onPage = questions.filter((q) => q.regions.some((g) => g.page === fig.page));
    const regionOf = (q: ParsedQuestion) => q.regions.find((g) => g.page === fig.page)!;
    const cy = (r.y0 + r.y1) / 2;
    const inside = onPage.find((q) => {
      const g = regionOf(q);
      return cy >= g.y0 && cy <= g.y1 && Math.min(g.x1, r.x1) > Math.max(g.x0, r.x0);
    });
    const above = onPage.filter((q) => regionOf(q).y0 <= r.y0).sort((a, b) => regionOf(b).y0 - regionOf(a).y0)[0];
    const earlier = questions.filter((q) => q.pages[0] < fig.page).slice(-1)[0];
    const target = inside ?? above ?? earlier ?? onPage[0];
    if (!target) continue;
    target.figureIds.push(fig.id);
    used.add(fig.id);
  }
  for (const q of questions) {
    if (q.figureIds.length) q.issues = q.issues.filter((i) => i.code !== 'FIGURE_NOT_CAPTURED');
  }
}

// ---------------------------------------------------------------------------
// Per-page report
// ---------------------------------------------------------------------------

function pageReport(
  s: PageState,
  questions: ParsedQuestion[],
  checks: Record<string, { result: string }>,
  checkedPages: Set<number>
): PageExtractionReport {
  const p = s.layout.page;
  const issues: string[] = [...s.reasons];
  let status: PageExtractionReport['status'] = 'ok';
  const onPage = questions.filter((q) => q.pages.includes(p));
  const imageChars = s.first ? s.first.reduce((n, l) => n + l.text.replace(/\s/g, '').length, 0) : undefined;

  if (s.imageMode && !s.first) {
    status = 'error';
    issues.push(
      s.readError
        ? `The page image could not be read: ${s.readError}`
        : 'This page needs page-image reading (OCR), which is not configured on the server (GEMINI_API_KEY). Nothing was extracted from it.'
    );
  } else if (s.readError) {
    status = 'warning';
    issues.push(`The page image could not be read for cross-checking: ${s.readError}`);
  }
  if (s.imageMode && s.first && s.first.some((l) => /⟦/.test(l.text))) {
    status = status === 'error' ? status : 'warning';
    issues.push('Some characters on this page could not be read with certainty (marked ⟦ ⟧).');
  }
  if (!s.imageMode && s.layout.unreadableChars > 0) {
    status = status === 'error' ? status : 'warning';
    issues.push(`${s.layout.unreadableChars} unreadable character(s) in the text layer.`);
  }
  const differing = onPage.filter((q) => checks[questionKey(q)]?.result === 'differ').map((q) => q.number);
  if (differing.length) {
    status = status === 'error' ? status : 'warning';
    issues.push(`Readings disagree on question(s) ${differing.join(', ')}.`);
  }
  if (onPage.length === 0 && status !== 'error' && (s.layout.textChars > 0 || s.first?.length)) {
    issues.push('No questions on this page (cover, instructions, answer key or formula sheet).');
  }
  if (s.layout.figures.length) issues.push(`${s.layout.figures.length} figure(s)/table(s) captured.`);

  return {
    page: p,
    method: s.imageMode ? (s.first ? 'ocr' : 'none') : checkedPages.has(p) ? 'native+ocr' : 'native',
    textLayerChars: s.layout.textChars,
    ...(imageChars !== undefined ? { imageReadingChars: imageChars } : {}),
    questionNumbers: onPage.map((q) => q.number),
    status,
    issues,
    removedLines: s.layout.removedLines,
  };
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}
