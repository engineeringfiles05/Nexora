/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reads a PDF's own text layer with positions and rebuilds the reading order:
 * - groups text items into lines by baseline, keeping raised and lowered small text as
 *   superscripts/subscripts instead of letting them break the line;
 * - detects two-column bands and reads the left column before the right one;
 * - finds running headers, footers and page numbers so they don't get glued onto choices;
 * - finds images and vector drawings (diagrams, tables) and their positions;
 * - measures how trustworthy each page's text layer is, so scanned or garbled pages go to OCR.
 *
 * Nothing here edits text. Characters come out exactly as the PDF encodes them.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { SourceRegion } from '../../src/types/index.ts';
import { matchChoiceStart, matchQuestionStart, type LineFlag, type SourceLine } from '../../src/utils/questionExtractor.ts';

const require = createRequire(import.meta.url);
const PDFJS_ROOT = path.dirname(require.resolve('pdfjs-dist/package.json'));
const asDirUrl = (dir: string) => `${path.join(PDFJS_ROOT, dir).replace(/\\/g, '/')}/`;

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({
    data: bytes.slice(), // pdf.js takes ownership of the buffer it is given
    cMapUrl: asDirUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: asDirUrl('standard_fonts'),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Glyph {
  str: string;
  x0: number;
  x1: number;
  baseline: number;
  size: number;
  space: boolean;
}

interface Line {
  glyphs: Glyph[];
  scripts: { glyph: Glyph; role: 'sup' | 'sub' | 'same' }[];
  baseline: number;
  size: number;
  x0: number;
  x1: number;
}

export interface FigureRegion {
  id: string;
  page: number;
  kind: 'image' | 'diagram' | 'table';
  /** Page coordinates in points, origin top left. */
  box: Box;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PageLayout {
  page: number;
  width: number;
  height: number;
  lines: SourceLine[];
  removedLines: string[];
  /** Characters in the text layer, whitespace excluded. */
  textChars: number;
  /** Characters that did not map to readable Unicode (�, private-use glyphs). */
  unreadableChars: number;
  /** Share of the page covered by raster images. */
  imageCoverage: number;
  vectorPathCount: number;
  figures: FigureRegion[];
  columns: number;
  rotatedItems: number;
}

// ---------------------------------------------------------------------------
// Page analysis
// ---------------------------------------------------------------------------

export async function analyzePage(doc: PDFDocumentProxy, pageNumber: number): Promise<PageLayout> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const width = viewport.width;
  const height = viewport.height;

  const content = await page.getTextContent({ disableNormalization: false });
  const glyphs: Glyph[] = [];
  const rotatedTexts: string[] = [];
  let rotatedItems = 0;
  for (const item of content.items as any[]) {
    if (typeof item.str !== 'string' || item.str.length === 0) continue;
    const t = pdfjs.Util.transform(viewport.transform, item.transform);
    // Horizontal text only; rotated text is usually a watermark or a margin note.
    if (Math.abs(t[1]) > 0.01 * Math.abs(t[0]) + 0.01 || Math.abs(t[2]) > 0.01 * Math.abs(t[3]) + 0.01) {
      rotatedItems++;
      if (item.str.trim()) rotatedTexts.push(item.str.trim());
      continue;
    }
    const size = Math.hypot(t[2], t[3]) || Math.abs(t[3]) || 10;
    const w = item.width * (viewport.scale ?? 1);
    glyphs.push({ str: item.str, x0: t[4], x1: t[4] + w, baseline: t[5], size, space: item.str.trim() === '' });
  }

  const { figures, imageCoverage, pathCount, rules } = await findFigures(page, viewport, pageNumber, width, height);
  const lines = buildLines(glyphs);
  const ordered = orderLines(lines, width);
  const columns = ordered.columns;

  const sourceLines: SourceLine[] = [];
  for (const line of ordered.lines) {
    const { text, flags } = lineText(line);
    if (!text.trim()) continue;
    const box = lineBox(line);
    const isLabel = box.x1 - box.x0 < width * 0.3 && !matchQuestionStart(text) && !matchChoiceStart(text);
    const figure = isLabel ? figures.find((f) => f.kind !== 'table' && contains(f.box, box)) : undefined;
    sourceLines.push({
      text,
      page: pageNumber,
      bbox: { page: pageNumber, x0: box.x0 / width, y0: box.y0 / height, x1: box.x1 / width, y1: box.y1 / height },
      ...(figure ? { figureId: figure.id } : {}),
      ...(flags.length ? { flags } : {}),
    });
  }
  markStackedMath(sourceLines, rules, width, height);

  let textChars = 0;
  let unreadableChars = 0;
  for (const g of glyphs) {
    for (const ch of g.str) {
      if (/\s/.test(ch)) continue;
      textChars++;
      if (/[�-]/.test(ch) || ch.charCodeAt(0) < 32) unreadableChars++;
    }
  }

  page.cleanup();
  return {
    page: pageNumber,
    width,
    height,
    lines: sourceLines,
    // Rotated text (watermarks, margin notes) is not read into questions; list it instead.
    removedLines: rotatedTexts.length ? [`Rotated text not used: ${rotatedTexts.join(' ').slice(0, 200)}`] : [],
    textChars,
    unreadableChars,
    imageCoverage,
    vectorPathCount: pathCount,
    figures,
    columns,
    rotatedItems,
  };
}

// ---------------------------------------------------------------------------
// Lines and scripts
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 10;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function buildLines(glyphs: Glyph[]): Line[] {
  const visible = glyphs.filter((g) => !g.space);
  const bodySize = median(visible.flatMap((g) => Array(Math.min(g.str.length, 50)).fill(g.size)));
  const isSmall = (g: Glyph) => g.size < bodySize * 0.8;

  // Pass 1: lines from normal-size text, clustered by baseline.
  const lines: Line[] = [];
  const normal = visible.filter((g) => !isSmall(g)).sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0);
  for (const g of normal) {
    const line = lines.find((l) => Math.abs(l.baseline - g.baseline) <= 0.35 * Math.min(l.size, g.size));
    if (line) addToLine(line, g);
    else lines.push(newLine(g));
  }

  // Pass 2: small text becomes a superscript/subscript of the line it touches, or its own line.
  const leftovers: Glyph[] = [];
  for (const g of visible.filter(isSmall)) {
    const target = findScriptLine(lines, g);
    if (target) {
      const offset = target.line.baseline - g.baseline; // positive = raised
      const role = offset > 0.15 * target.line.size ? 'sup' : offset < -0.1 * target.line.size ? 'sub' : 'same';
      target.line.scripts.push({ glyph: g, role });
    } else {
      leftovers.push(g);
    }
  }
  const smallLines: Line[] = [];
  for (const g of leftovers.sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0)) {
    const line = smallLines.find((l) => Math.abs(l.baseline - g.baseline) <= 0.35 * Math.min(l.size, g.size));
    if (line) addToLine(line, g);
    else smallLines.push(newLine(g));
  }
  const all = [...lines, ...smallLines];

  // Spaces the PDF encodes as their own items go to the line they sit on.
  for (const g of glyphs.filter((x) => x.space)) {
    const line = all.find((l) => g.baseline >= l.baseline - l.size * 0.9 && g.baseline <= l.baseline + l.size * 0.35 && g.x0 >= l.x0 - 1 && g.x0 <= l.x1 + 1);
    if (!line) continue;
    const script = line.scripts.find((s) => Math.abs(s.glyph.baseline - g.baseline) < 0.5 && Math.abs(s.glyph.x1 - g.x0) < 1);
    if (script) line.scripts.push({ glyph: g, role: script.role });
    else line.glyphs.push(g);
  }
  return all;
}

function newLine(g: Glyph): Line {
  return { glyphs: [g], scripts: [], baseline: g.baseline, size: g.size, x0: g.x0, x1: g.x1 };
}

function addToLine(line: Line, g: Glyph) {
  line.glyphs.push(g);
  line.x0 = Math.min(line.x0, g.x0);
  line.x1 = Math.max(line.x1, g.x1);
  line.size = Math.max(line.size, g.size);
}

function findScriptLine(lines: Line[], g: Glyph): { line: Line } | null {
  let best: { line: Line; score: number } | null = null;
  for (const line of lines) {
    const top = line.baseline - line.size * 0.95;
    const bottom = line.baseline + line.size * 0.45;
    if (g.baseline < top || g.baseline > bottom + g.size * 0.5) continue;
    const near = line.glyphs.some((x) => g.x0 <= x.x1 + line.size * 0.6 && g.x1 >= x.x0 - line.size * 0.6);
    if (!near) continue;
    if (g.str.trim().length > 12) continue; // long small text is a separate line, not a script
    const score = Math.abs(line.baseline - g.baseline);
    if (!best || score < best.score) best = { line, score };
  }
  return best;
}

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', ' ': ' ',
};
const SUBSCRIPT: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎', ' ': ' ',
};

/**
 * Digits and signs have exact Unicode superscript/subscript forms, so "10" + raised "-8"
 * becomes "10⁻⁸". Letter subscripts (Nr, Xd) stay as plain letters, which is how they read
 * in plain text. A raised run with no exact form becomes "^(...)" and is flagged for review,
 * because dropping the raise would change the mathematics.
 */
function convertScript(text: string, role: 'sup' | 'sub'): { text: string; exact: boolean } {
  const map = role === 'sup' ? SUPERSCRIPT : SUBSCRIPT;
  const chars = [...text];
  if (chars.every((c) => map[c] !== undefined)) return { text: chars.map((c) => map[c]).join(''), exact: true };
  if (role === 'sub' && /^[A-Za-z0-9]+$/.test(text.trim())) return { text, exact: true };
  if (role === 'sup' && /^[°'"*†‡]+$/.test(text.trim())) return { text, exact: true };
  return { text: role === 'sup' ? `^(${text.trim()})` : `_(${text.trim()})`, exact: false };
}

interface Piece {
  str: string;
  x0: number;
  x1: number;
  size: number;
  script?: 'sup' | 'sub';
}

function lineText(line: Line): { text: string; flags: LineFlag[] } {
  const flags: LineFlag[] = [];
  const all: (Piece & { space: boolean })[] = [
    ...line.glyphs.map((g) => ({ str: g.str, x0: g.x0, x1: g.x1, size: g.size, space: g.space })),
    ...line.scripts.map((s) => ({
      str: s.glyph.str,
      x0: s.glyph.x0,
      x1: s.glyph.x1,
      size: s.glyph.size,
      space: s.glyph.space,
      script: s.role === 'same' ? undefined : s.role,
    })),
  ].sort((a, b) => a.x0 - b.x0);
  // Whitespace items only tell us a space exists; the gap itself decides space or tab.
  const spaces = all.filter((p) => p.space);
  const pieces: Piece[] = all.filter((p) => !p.space);
  const spaceBetween = (a: Piece, b: Piece) => spaces.some((s) => s.x0 >= a.x1 - 1 && s.x1 <= b.x0 + 1);

  // Merge consecutive pieces of the same script run so "-" "8" convert together.
  const merged: Piece[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && p.script && last.script === p.script && p.x0 - last.x1 < p.size * 0.5) {
      last.str += p.str;
      last.x1 = p.x1;
    } else {
      merged.push({ ...p });
    }
  }

  let text = '';
  let prev: Piece | null = null;
  for (const p of merged) {
    let str = p.str;
    if (p.script) {
      const trailing = /\s+$/.exec(str)?.[0] ?? '';
      const converted = convertScript(str.replace(/\s+$/, ''), p.script);
      if (!converted.exact) flags.push('script_notation');
      str = converted.text + trailing;
    }
    if (prev) {
      const gap = p.x0 - prev.x1;
      const size = Math.min(p.size, prev.size);
      if (gap > Math.max(prev.size, p.size) * 1.6) {
        // A wide gap separates cells or inline choices: mark it as a tab.
        text = text.replace(/[ ]+$/, '') + '\t';
        str = str.replace(/^[ ]+/, '');
      } else if (!/\s$/.test(text) && !/^\s/.test(str)) {
        if (spaceBetween(prev, p)) text += ' ';
        else if (gap > size * 0.18 && !p.script && !prev.script) text += ' ';
        else if (gap > size * 0.3) text += ' ';
      }
    }
    text += str;
    prev = p;
  }
  // Collapse space runs pdf.js adds next to tabs, keep single spaces as written.
  text = text.replace(/ *\t[ \t]*/g, '\t').replace(/\s+$/, '').replace(/^\s+/, '');
  if (/[�-]/.test(text)) flags.push('unreadable');
  return { text, flags };
}

function lineBox(line: Line): Box {
  const all = [...line.glyphs, ...line.scripts.map((s) => s.glyph)].filter((g) => !g.space);
  const x0 = Math.min(...all.map((g) => g.x0));
  const x1 = Math.max(...all.map((g) => g.x1));
  const y0 = Math.min(...all.map((g) => g.baseline - g.size * 0.85));
  const y1 = Math.max(...all.map((g) => g.baseline + g.size * 0.25));
  return { x0, y0, x1, y1 };
}

// ---------------------------------------------------------------------------
// Reading order and columns
// ---------------------------------------------------------------------------

interface Row {
  lines: Line[]; // segments of one visual row, left to right
  baseline: number;
}

/**
 * Lines that share a baseline across a column gutter come out of pass 1 as one line.
 * Split them at wide gaps, then look for a vertical gutter that a run of rows shares.
 */
function orderLines(lines: Line[], pageWidth: number): { lines: Line[]; columns: number } {
  const rows: Row[] = lines
    .map((line) => ({ lines: splitAtGaps(line), baseline: line.baseline }))
    .sort((a, b) => a.baseline - b.baseline);
  const out: Line[] = [];
  let columns = 1;
  const walk = (segment: Row[]) => {
    if (segment.length === 0) return;
    const split = findGutter(segment, pageWidth);
    if (!split) {
      for (const row of segment) out.push(joinRow(row));
      return;
    }
    columns = 2;
    walk(segment.slice(0, split.start));
    const run = segment.slice(split.start, split.end);
    const left: Line[] = [];
    const right: Line[] = [];
    for (const row of run) {
      const l = row.lines.filter((s) => s.x1 <= split.x);
      const r = row.lines.filter((s) => s.x0 >= split.x);
      if (l.length) left.push(joinRow({ lines: l, baseline: row.baseline }));
      if (r.length) right.push(joinRow({ lines: r, baseline: row.baseline }));
    }
    out.push(...left, ...right);
    walk(segment.slice(split.end));
  };
  walk(rows);
  return { lines: out, columns };
}

function splitAtGaps(line: Line): Line[] {
  const items = [
    ...line.glyphs.map((g) => ({ g, script: null as null | 'sup' | 'sub' | 'same' })),
    ...line.scripts.map((s) => ({ g: s.glyph, script: s.role })),
  ].sort((a, b) => a.g.x0 - b.g.x0);
  const parts: Line[] = [];
  let current: Line | null = null;
  let lastX1 = -Infinity;
  for (const { g, script } of items) {
    if (!current || (g.x0 - lastX1 > line.size * 1.6 && !g.space)) {
      current = { glyphs: [], scripts: [], baseline: line.baseline, size: line.size, x0: g.x0, x1: g.x1 };
      parts.push(current);
    }
    if (script) current.scripts.push({ glyph: g, role: script });
    else current.glyphs.push(g);
    current.x0 = Math.min(current.x0, g.x0);
    current.x1 = Math.max(current.x1, g.x1);
    lastX1 = Math.max(lastX1, g.x1);
  }
  return parts.filter((p) => p.glyphs.some((g) => !g.space) || p.scripts.length > 0);
}

function joinRow(row: Row): Line {
  const glyphs = row.lines.flatMap((l) => l.glyphs);
  const scripts = row.lines.flatMap((l) => l.scripts);
  return {
    glyphs,
    scripts,
    baseline: row.baseline,
    size: Math.max(...row.lines.map((l) => l.size)),
    x0: Math.min(...row.lines.map((l) => l.x0)),
    x1: Math.max(...row.lines.map((l) => l.x1)),
  };
}

const segText = (l: Line) => lineText(l).text;

/**
 * Finds a run of consecutive rows that all leave the same vertical strip empty and have
 * real content on both sides. To count as columns, both sides must start questions (or be
 * long runs of prose), so a 2x2 grid of answer choices is never mistaken for two columns.
 */
function findGutter(rows: Row[], pageWidth: number): { start: number; end: number; x: number } | null {
  if (rows.length < 6) return null;
  const bins = 120;
  const lo = pageWidth * 0.25;
  const hi = pageWidth * 0.75;
  const binX = (b: number) => lo + ((hi - lo) * (b + 0.5)) / bins;
  let best: { start: number; end: number; x: number; score: number } | null = null;

  for (let b = 0; b < bins; b++) {
    const x = binX(b);
    let start = -1;
    for (let i = 0; i <= rows.length; i++) {
      const row = rows[i];
      const free = row && !row.lines.some((s) => s.x0 - 4 < x && s.x1 + 4 > x);
      if (free && start < 0) start = i;
      if ((!free || i === rows.length) && start >= 0) {
        const end = i;
        if (end - start >= 6) {
          const run = rows.slice(start, end);
          const leftRows = run.filter((r) => r.lines.some((s) => s.x1 <= x));
          const rightRows = run.filter((r) => r.lines.some((s) => s.x0 >= x));
          if (leftRows.length >= 3 && rightRows.length >= 3 && looksLikeColumns(run, x)) {
            const score = (end - start) * 1000 - Math.abs(x - pageWidth / 2);
            if (!best || score > best.score) best = { start, end, x, score };
          }
        }
        start = -1;
      }
    }
  }
  return best ? { start: best.start, end: best.end, x: best.x } : null;
}

function looksLikeColumns(run: Row[], x: number): boolean {
  const side = (pick: (s: Line) => boolean) => run.flatMap((r) => r.lines.filter(pick)).map(segText);
  const left = side((s) => s.x1 <= x);
  const right = side((s) => s.x0 >= x);
  const starts = (texts: string[]) => texts.some((t) => matchQuestionStart(t) !== null);
  if (starts(left) && starts(right)) return true;
  const choiceShare = (texts: string[]) => texts.filter((t) => matchChoiceStart(t)).length / Math.max(1, texts.length);
  return left.length >= 8 && right.length >= 8 && choiceShare(right) < 0.5 && choiceShare(left) < 0.5;
}

// ---------------------------------------------------------------------------
// Figures: images and vector drawings
// ---------------------------------------------------------------------------

type Matrix = number[];

async function findFigures(
  page: PDFPageProxy,
  viewport: { transform: number[] },
  pageNumber: number,
  width: number,
  height: number
): Promise<{ figures: FigureRegion[]; imageCoverage: number; pathCount: number; rules: Box[] }> {
  const ops = await page.getOperatorList();
  const OPS = pdfjs.OPS;
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const images: Box[] = [];
  const paths: Box[] = [];

  const toBox = (m: Matrix, x0: number, y0: number, x1: number, y1: number): Box => {
    const full = pdfjs.Util.transform(viewport.transform, m);
    const pts = [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ].map(([x, y]) => [full[0] * x + full[2] * y + full[4], full[1] * x + full[3] * y + full[5]]);
    return {
      x0: Math.min(...pts.map((p) => p[0])),
      y0: Math.min(...pts.map((p) => p[1])),
      x1: Math.max(...pts.map((p) => p[0])),
      y1: Math.max(...pts.map((p) => p[1])),
    };
  };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as any;
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = pdfjs.Util.transform(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args?.[0]) || ArrayBuffer.isView(args?.[0])) ctm = pdfjs.Util.transform(ctm, Array.from(args[0] as ArrayLike<number>));
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintImageXObjectRepeat) {
      images.push(toBox(ctm, 0, 0, 1, 1));
    } else if (fn === OPS.constructPath) {
      const paintOp = args?.[0];
      const mm = args?.[2];
      if (paintOp === OPS.endPath || !mm || !Number.isFinite(mm[0])) continue;
      paths.push(toBox(ctm, mm[0], mm[1], mm[2], mm[3]));
    }
  }

  const pageArea = width * height;
  const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
  const imageCoverage = Math.min(1, images.reduce((s, b) => s + area(clip(b, width, height)), 0) / pageArea);

  const figures: FigureRegion[] = [];
  let n = 0;
  for (const b of images) {
    const box = clip(b, width, height);
    const a = area(box) / pageArea;
    if (a >= 0.004 && a < 0.85) figures.push({ id: `p${pageNumber}-fig${++n}`, page: pageNumber, kind: 'image', box });
  }

  // Thin full-width rules and page frames are layout, not figures. Short thin rules are kept
  // separately: one between two short lines is the bar of a built-up fraction.
  const rules = paths.filter((b) => b.y1 - b.y0 < 2 && b.x1 - b.x0 < width * 0.3);
  const drawable = paths.filter((b) => {
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    if (area(b) > pageArea * 0.7) return false;
    if (h < 2 && w > width * 0.55) return false;
    return w > 0.5 || h > 0.5;
  });
  for (const cluster of clusterBoxes(drawable, 8)) {
    if (cluster.members.length < 3) continue;
    const box = cluster.box;
    if (area(box) < pageArea * 0.008) continue;
    const bw = box.x1 - box.x0;
    const bh = box.y1 - box.y0;
    const hRules = cluster.members.filter((m) => m.y1 - m.y0 < 2 && m.x1 - m.x0 > bw * 0.6).length;
    const vRules = cluster.members.filter((m) => m.x1 - m.x0 < 2 && m.y1 - m.y0 > bh * 0.4).length;
    figures.push({ id: `p${pageNumber}-fig${++n}`, page: pageNumber, kind: hRules >= 3 && vRules >= 2 ? 'table' : 'diagram', box: pad(box, 4, width, height) });
  }
  // Labels sit just outside the stroke bounds; grow diagrams to include text touching them.
  return { figures, imageCoverage, pathCount: paths.length, rules };
}

function clusterBoxes(boxes: Box[], gap: number): { box: Box; members: Box[] }[] {
  const clusters: { box: Box; members: Box[] }[] = [];
  for (const b of boxes) {
    const touching = clusters.filter((c) => intersects(pad(c.box, gap), b));
    if (touching.length === 0) {
      clusters.push({ box: { ...b }, members: [b] });
      continue;
    }
    const merged = touching[0];
    merged.members.push(b);
    merged.box = union(merged.box, b);
    for (const other of touching.slice(1)) {
      merged.members.push(...other.members);
      merged.box = union(merged.box, other.box);
      clusters.splice(clusters.indexOf(other), 1);
    }
  }
  return clusters;
}

const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const intersects = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
const pad = (b: Box, p: number, w = Infinity, h = Infinity): Box => ({ x0: Math.max(0, b.x0 - p), y0: Math.max(0, b.y0 - p), x1: Math.min(w, b.x1 + p), y1: Math.min(h, b.y1 + p) });
const clip = (b: Box, w: number, h: number): Box => ({ x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(w, b.x1), y1: Math.min(h, b.y1) });

/** True when a short line sits on or right beside a drawing: a label such as "R1 = 4 Ω". */
function contains(fig: Box, line: Box): boolean {
  const cx = (line.x0 + line.x1) / 2;
  const cy = (line.y0 + line.y1) / 2;
  const grown = { x0: fig.x0 - 30, y0: fig.y0 - 14, x1: fig.x1 + 30, y1: fig.y1 + 14 };
  return cx >= grown.x0 && cx <= grown.x1 && cy >= grown.y0 && cy <= grown.y1;
}

/** Grows each diagram to cover the labels attached to it, so crops include them. */
export function growFiguresToLabels(layout: PageLayout): void {
  for (const fig of layout.figures) {
    for (const line of layout.lines) {
      if (line.figureId !== fig.id || !line.bbox) continue;
      fig.box = union(fig.box, {
        x0: line.bbox.x0 * layout.width - 2,
        y0: line.bbox.y0 * layout.height - 2,
        x1: line.bbox.x1 * layout.width + 2,
        y1: line.bbox.y1 * layout.height + 2,
      });
    }
  }
}

/** Flags short lines stacked above and below a short rule: a built-up fraction. */
function markStackedMath(lines: SourceLine[], rules: Box[], width: number, height: number) {
  if (rules.length === 0) return;
  for (const rule of rules) {
    const rx0 = rule.x0 / width;
    const rx1 = rule.x1 / width;
    const ry = (rule.y0 + rule.y1) / 2 / height;
    const near = lines.filter((l) => {
      if (!l.bbox) return false;
      const overlap = Math.min(l.bbox.x1, rx1) - Math.max(l.bbox.x0, rx0);
      const close = Math.abs(l.bbox.y1 - ry) < 0.02 || Math.abs(l.bbox.y0 - ry) < 0.02;
      return overlap > 0 && close;
    });
    const above = near.some((l) => l.bbox!.y1 <= ry + 0.004);
    const below = near.some((l) => l.bbox!.y0 >= ry - 0.004);
    if (above && below) {
      for (const l of near) l.flags = [...new Set([...(l.flags ?? []), 'stacked_math' as LineFlag])];
    }
  }
}

// ---------------------------------------------------------------------------
// Running headers and footers
// ---------------------------------------------------------------------------

const PAGE_NUMBER = /^\W*(?:page|pg\.?|p\.)?\s*\d{1,4}\s*(?:(?:of|\/)\s*\d{1,4})?\W*$/i;

/**
 * Removes lines that repeat at the top or bottom of most pages, and bare page numbers in the
 * margins. Lines that start a question or a choice are never removed. Every removed line is
 * reported on its page.
 */
export function removeRunningHeaders(pages: { page: number; lines: SourceLine[]; removedLines: string[] }[]): void {
  // Without coordinates (some page-image readings), the first and last two lines are the margins.
  const zones = new Map<SourceLine, boolean>();
  for (const p of pages) {
    p.lines.forEach((l, i) => {
      zones.set(l, l.bbox ? l.bbox.y1 < 0.1 || l.bbox.y0 > 0.9 : i < 2 || i >= p.lines.length - 2);
    });
  }
  const zone = (l: SourceLine) => zones.get(l) === true;
  const key = (t: string) => {
    const s = t.trim().toLowerCase().replace(/\s+/g, ' ');
    return /page|\d+\s*(?:of|\/)\s*\d+/.test(s) ? s.replace(/\d+/g, '#') : s;
  };
  const counts = new Map<string, Set<number>>();
  for (const p of pages) {
    for (const l of p.lines) {
      if (!zone(l)) continue;
      const k = key(l.text);
      if (!counts.has(k)) counts.set(k, new Set());
      counts.get(k)!.add(p.page);
    }
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  for (const p of pages) {
    p.lines = p.lines.filter((l) => {
      if (!zone(l)) return true;
      if (matchQuestionStart(l.text) || matchChoiceStart(l.text)) return true;
      const repeated = pages.length >= 2 && (counts.get(key(l.text))?.size ?? 0) >= threshold;
      if (repeated || PAGE_NUMBER.test(l.text)) {
        p.removedLines.push(l.text.trim());
        return false;
      }
      return true;
    });
  }
}
