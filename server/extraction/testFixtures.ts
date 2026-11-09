/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds realistic questionnaire PDFs for the extraction tests, together with the exact
 * text each question and choice must come back as. Uses only the standard PDF fonts, so
 * the files build the same way on any machine.
 *
 * Typesetting mirrors how exam papers are really produced: exponents are raised small text
 * (not Unicode superscripts), Greek letters come from the Symbol font, choices are laid out
 * vertically, inline, or as a 2x2 grid, and running headers and page numbers repeat.
 */

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';

export interface TruthQuestion {
  number: number;
  stem: string;
  options: { key: string; text: string }[];
  answer?: string;
  pages?: number[];
}

export interface Fixture {
  name: string;
  bytes: Uint8Array;
  questions: TruthQuestion[];
}

type FontKind = 'sans' | 'bold' | 'symbol';
interface Seg {
  t: string;
  font?: FontKind;
  /** Raised (superscript) or lowered (subscript) small text. */
  script?: 'sup' | 'sub';
}

interface Fonts {
  sans: PDFFont;
  bold: PDFFont;
  symbol: PDFFont;
}

const SIZE = 11;
const LETTER: [number, number] = [612, 792];

async function newDoc() {
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    sans: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    symbol: await doc.embedFont(StandardFonts.Symbol),
  };
  return { doc, fonts };
}

/** Draws a run of segments on one baseline and returns the x where it ends. */
function drawSegs(page: PDFPage, fonts: Fonts, x: number, y: number, segs: Seg[], size = SIZE): number {
  for (const seg of segs) {
    const font = fonts[seg.font ?? 'sans'];
    const s = seg.script ? size * 0.62 : size;
    const dy = seg.script === 'sup' ? size * 0.38 : seg.script === 'sub' ? -size * 0.18 : 0;
    page.drawText(seg.t, { x, y: y + dy, size: s, font, color: rgb(0, 0, 0) });
    x += font.widthOfTextAtSize(seg.t, s);
  }
  return x;
}

/** Plain text of a segment run, as the extractor should report it. */
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '⁺' };
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
export function segText(segs: Seg[]): string {
  return segs
    .map((s) => (s.script === 'sup' ? [...s.t].map((c) => SUP[c] ?? c).join('') : s.script === 'sub' ? [...s.t].map((c) => SUB[c] ?? c).join('') : s.t))
    .join('');
}

function header(page: PDFPage, fonts: Fonts, pageNo: number, total: number) {
  page.drawText('NEXORA ACADEMY - REE PRE-BOARD EXAMINATION', { x: 72, y: 750, size: 9, font: fonts.bold });
  page.drawText(`Page ${pageNo} of ${total}`, { x: 270, y: 36, size: 9, font: fonts.sans });
}

// ---------------------------------------------------------------------------
// 1. Text-based board exam: superscripts, Symbol-font Greek, all choice layouts,
//    a question split across a page break, inline answer, printed solution, answer key.
// ---------------------------------------------------------------------------

export async function textBasedExam(): Promise<Fixture> {
  const { doc, fonts } = await newDoc();
  const p1 = doc.addPage(LETTER);
  const p2 = doc.addPage(LETTER);
  header(p1, fonts, 1, 2);
  header(p2, fonts, 2, 2);
  const L = 72;
  const ohm: Seg = { t: 'Ω', font: 'symbol' }; // Greek letters come from the Symbol font, as in Word-made papers

  let y = 712;
  p1.drawText('ELECTRICAL ENGINEERING - SET A', { x: L, y, size: 12, font: fonts.bold });
  y -= 18;
  p1.drawText('Choose the best answer for each question.', { x: L, y, size: SIZE, font: fonts.sans });
  y -= 26;

  // Q1: the example from the requirements, typeset with raised exponents.
  const q1a: Seg[] = [{ t: '1. What is the resistance of a conductor having a resistivity of 1.72 × 10' }, { t: '-8', script: 'sup' }, { t: ' ' }, ohm, { t: '·m,' }];
  const q1b: Seg[] = [{ t: 'a length of 100 meters, and a cross-sectional area of 2 mm' }, { t: '2', script: 'sup' }, { t: '?' }];
  drawSegs(p1, fonts, L, y, q1a);
  y -= 14;
  drawSegs(p1, fonts, L + 14, y, q1b);
  y -= 18;
  const q1opts = ['0.43 ', '0.86 ', '1.72 ', '2.15 '];
  ['A', 'B', 'C', 'D'].forEach((k, i) => {
    drawSegs(p1, fonts, L + 14, y, [{ t: `${k}. ${q1opts[i]}` }, ohm]);
    y -= 14;
  });
  y -= 10;

  // Q2: inline choices on one row, with a subscript in the stem.
  drawSegs(p1, fonts, L, y, [{ t: '2. A 3-phase, 4-pole, 60 Hz induction motor runs at slip s = 4%. Find the rotor speed N' }, { t: 'r', script: 'sub' }, { t: '.' }]);
  y -= 18;
  ['A. 1728 rpm', 'B. 1800 rpm', 'C. 1750 rpm', 'D. 1680 rpm'].forEach((t, i) => p1.drawText(t, { x: L + 14 + i * 115, y, size: SIZE, font: fonts.sans }));
  y -= 24;

  // Q3: 2x2 grid of choices; the stem begins with "A.C." which must not be read as choice A.
  drawSegs(p1, fonts, L, y, [{ t: '3. A series RLC circuit has R = 10 ' }, ohm, { t: ', L = 0.1 H and C = 100 ' }, { t: 'μ', font: 'symbol' }, { t: 'F. Its' }]);
  y -= 14;
  p1.drawText('A.C. resonant frequency is closest to:', { x: L + 14, y, size: SIZE, font: fonts.sans });
  y -= 18;
  p1.drawText('A. 50.33 Hz', { x: L + 14, y, size: SIZE, font: fonts.sans });
  p1.drawText('C. 79.58 Hz', { x: L + 240, y, size: SIZE, font: fonts.sans });
  y -= 14;
  p1.drawText('B. 159.2 Hz', { x: L + 14, y, size: SIZE, font: fonts.sans });
  p1.drawText('D. 100.0 Hz', { x: L + 240, y, size: SIZE, font: fonts.sans });
  y -= 24;

  // Q4: printed answer and a printed solution.
  p1.drawText('4. A 25 kVA transformer has a core loss of 200 W and a full-load copper loss of 350 W.', { x: L, y, size: SIZE, font: fonts.sans });
  y -= 14;
  p1.drawText('Find the full-load efficiency at 0.85 power factor lagging.', { x: L + 14, y, size: SIZE, font: fonts.sans });
  y -= 18;
  for (const t of ['A. 97.48%', 'B. 98.20%', 'C. 96.50%', 'D. 95.85%']) {
    p1.drawText(t, { x: L + 14, y, size: SIZE, font: fonts.sans });
    y -= 14;
  }
  p1.drawText('Answer: A', { x: L + 14, y, size: SIZE, font: fonts.bold });
  y -= 14;
  p1.drawText('Solution: Pout = 25 × 0.85 = 21.25 kW; efficiency = 21.25 / (21.25 + 0.55) = 97.48%.', { x: L + 14, y, size: SIZE, font: fonts.sans });
  y -= 26;

  // Q5: choices A and B at the bottom of page 1, C and D at the top of page 2.
  p1.drawText('5. According to the PEC, a conduit run between pull points shall not contain more', { x: L, y, size: SIZE, font: fonts.sans });
  y -= 14;
  p1.drawText('than the equivalent of how many quarter bends?', { x: L + 14, y, size: SIZE, font: fonts.sans });
  y -= 18;
  p1.drawText('A. 4 quarter bends (360 degrees)', { x: L + 14, y, size: SIZE, font: fonts.sans });
  y -= 14;
  p1.drawText('B. 3 quarter bends (270 degrees)', { x: L + 14, y, size: SIZE, font: fonts.sans });

  let y2 = 712;
  p2.drawText('C. 2 quarter bends (180 degrees)', { x: L + 14, y: y2, size: SIZE, font: fonts.sans });
  y2 -= 14;
  p2.drawText('D. 5 quarter bends (450 degrees)', { x: L + 14, y: y2, size: SIZE, font: fonts.sans });
  y2 -= 24;

  // Q6: choices whose text contains the unit "A" next to a following choice letter.
  drawSegs(p2, fonts, L, y2, [{ t: '6. Two resistors of 6 ' }, ohm, { t: ' and 3 ' }, ohm, { t: ' in parallel are fed from 12 V. Find the source current.' }]);
  y2 -= 18;
  ['A. 2 A', 'B. 4 A', 'C. 6 A', 'D. 8 A'].forEach((t, i) => p2.drawText(t, { x: L + 14 + i * 90, y: y2, size: SIZE, font: fonts.sans }));
  y2 -= 30;

  p2.drawText('ANSWER KEY', { x: L, y: y2, size: SIZE, font: fonts.bold });
  y2 -= 16;
  p2.drawText('1. B      2. A      3. A      4. A      5. A      6. C', { x: L, y: y2, size: SIZE, font: fonts.sans });

  return {
    name: 'text-based',
    bytes: await doc.save(),
    questions: [
      {
        number: 1,
        stem: 'What is the resistance of a conductor having a resistivity of 1.72 × 10⁻⁸ Ω·m, a length of 100 meters, and a cross-sectional area of 2 mm²?',
        options: [
          { key: 'A', text: '0.43 Ω' },
          { key: 'B', text: '0.86 Ω' },
          { key: 'C', text: '1.72 Ω' },
          { key: 'D', text: '2.15 Ω' },
        ],
        answer: 'B',
        pages: [1],
      },
      {
        number: 2,
        // A letter subscript has no Unicode form, so it stays as plain text.
        stem: 'A 3-phase, 4-pole, 60 Hz induction motor runs at slip s = 4%. Find the rotor speed Nr.',
        options: [
          { key: 'A', text: '1728 rpm' },
          { key: 'B', text: '1800 rpm' },
          { key: 'C', text: '1750 rpm' },
          { key: 'D', text: '1680 rpm' },
        ],
        answer: 'A',
      },
      {
        number: 3,
        stem: 'A series RLC circuit has R = 10 Ω, L = 0.1 H and C = 100 μF. Its A.C. resonant frequency is closest to:',
        options: [
          { key: 'A', text: '50.33 Hz' },
          { key: 'B', text: '159.2 Hz' },
          { key: 'C', text: '79.58 Hz' },
          { key: 'D', text: '100.0 Hz' },
        ],
        answer: 'A',
      },
      {
        number: 4,
        stem: 'A 25 kVA transformer has a core loss of 200 W and a full-load copper loss of 350 W. Find the full-load efficiency at 0.85 power factor lagging.',
        options: [
          { key: 'A', text: '97.48%' },
          { key: 'B', text: '98.20%' },
          { key: 'C', text: '96.50%' },
          { key: 'D', text: '95.85%' },
        ],
        answer: 'A',
      },
      {
        number: 5,
        stem: 'According to the PEC, a conduit run between pull points shall not contain more than the equivalent of how many quarter bends?',
        options: [
          { key: 'A', text: '4 quarter bends (360 degrees)' },
          { key: 'B', text: '3 quarter bends (270 degrees)' },
          { key: 'C', text: '2 quarter bends (180 degrees)' },
          { key: 'D', text: '5 quarter bends (450 degrees)' },
        ],
        answer: 'A',
        pages: [1, 2],
      },
      {
        number: 6,
        stem: 'Two resistors of 6 Ω and 3 Ω in parallel are fed from 12 V. Find the source current.',
        options: [
          { key: 'A', text: '2 A' },
          { key: 'B', text: '4 A' },
          { key: 'C', text: '6 A' },
          { key: 'D', text: '8 A' },
        ],
        answer: 'C',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 2. Two-column paper with a full-width title.
// ---------------------------------------------------------------------------

export async function twoColumnExam(): Promise<Fixture> {
  const { doc, fonts } = await newDoc();
  const page = doc.addPage(LETTER);
  page.drawText('MATHEMATICS - TWO COLUMN PAPER (choose the best answer in every item below)', { x: 54, y: 740, size: 11, font: fonts.bold });
  const truth: TruthQuestion[] = [];
  const colX = [54, 324];
  const width = 230;
  let n = 1;
  for (const x of colX) {
    let y = 710;
    for (let i = 0; i < 5; i++, n++) {
      const stem = `Evaluate the expression ${n} × ${n + 2} + ${n * 3} and give the result as an integer value.`;
      const lines = wrap(stem, fonts.sans, SIZE, width - 14);
      page.drawText(`${n}. ${lines[0]}`, { x, y, size: SIZE, font: fonts.sans });
      y -= 13;
      for (const l of lines.slice(1)) {
        page.drawText(l, { x: x + 14, y, size: SIZE, font: fonts.sans });
        y -= 13;
      }
      const value = n * (n + 2) + n * 3;
      const opts = [value, value + 1, value + 2, value - 1].map(String);
      ['A', 'B', 'C', 'D'].forEach((k, j) => {
        page.drawText(`${k}. ${opts[j]}`, { x: x + 14, y, size: SIZE, font: fonts.sans });
        y -= 13;
      });
      y -= 12;
      truth.push({ number: n, stem, options: opts.map((t, j) => ({ key: 'ABCD'[j], text: t })) });
    }
  }
  return { name: 'two-column', bytes: await doc.save(), questions: truth };
}

// ---------------------------------------------------------------------------
// 3. A question with a vector circuit diagram whose labels sit inside the drawing.
// ---------------------------------------------------------------------------

export async function circuitDiagramExam(): Promise<Fixture> {
  const { doc, fonts } = await newDoc();
  const page = doc.addPage(LETTER);
  const L = 72;
  let y = 720;
  page.drawText('1. Refer to the circuit shown below. Find the current I drawn from the 12 V source.', { x: L, y, size: SIZE, font: fonts.sans });
  // Diagram: battery, two resistors in series, closed loop.
  const top = 690;
  const bottom = 590;
  const left = 140;
  const right = 400;
  const line = (x1: number, y1: number, x2: number, y2: number) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 1.2 });
  line(left, bottom, left, top);
  line(left, top, 220, top);
  // resistor zig-zag R1
  let zx = 220;
  for (let i = 0; i < 6; i++) {
    line(zx, top + (i % 2 ? -6 : 6), zx + 8, top + (i % 2 ? 6 : -6));
    zx += 8;
  }
  line(zx, top, right, top);
  line(right, top, right, bottom);
  line(right, bottom, 300, bottom);
  page.drawRectangle({ x: 252, y: bottom - 6, width: 48, height: 12, borderWidth: 1.2, borderColor: rgb(0, 0, 0) });
  line(252, bottom, left, bottom);
  // battery plates
  line(left - 10, 640, left + 10, 640);
  line(left - 5, 634, left + 5, 634);
  page.drawText('12 V', { x: left - 40, y: 634, size: 9, font: fonts.sans });
  drawSegs(page, fonts, 225, top + 12, [{ t: 'R1 = 4 ' }, { t: 'Ω', font: 'symbol' }], 9);
  drawSegs(page, fonts, 252, bottom - 20, [{ t: 'R2 = 2 ' }, { t: 'Ω', font: 'symbol' }], 9);
  y = 555;
  for (const t of ['A. 2 A', 'B. 3 A', 'C. 4 A', 'D. 6 A']) {
    page.drawText(t, { x: L + 14, y, size: SIZE, font: fonts.sans });
    y -= 14;
  }
  return {
    name: 'circuit',
    bytes: await doc.save(),
    questions: [
      {
        number: 1,
        stem: 'Refer to the circuit shown below. Find the current I drawn from the 12 V source.',
        options: [
          { key: 'A', text: '2 A' },
          { key: 'B', text: '3 A' },
          { key: 'C', text: '4 A' },
          { key: 'D', text: '6 A' },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 4. Scanned paper: each page is only a picture of text, with no text layer.
// ---------------------------------------------------------------------------

export const SCANNED_TEXT = [
  '1. What is the SI unit of electric charge?',
  'A. coulomb',
  'B. ampere',
  'C. volt',
  'D. ohm',
  '',
  '2. Which instrument measures electric current?',
  'A. voltmeter',
  'B. ammeter',
  'C. ohmmeter',
  'D. wattmeter',
];

export async function scannedExam(): Promise<Fixture> {
  const { doc } = await newDoc();
  const canvas = createCanvas(1275, 1650); // 150 dpi letter
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(0, 0, 1275, 1650);
  ctx.fillStyle = '#111';
  ctx.font = '30px sans-serif';
  SCANNED_TEXT.forEach((line, i) => ctx.fillText(line, 150, 200 + i * 48));
  const png = await doc.embedPng(canvas.toBuffer('image/png'));
  const page = doc.addPage(LETTER);
  page.drawImage(png, { x: 0, y: 0, width: 612, height: 792 });
  return {
    name: 'scanned',
    bytes: await doc.save(),
    questions: [
      { number: 1, stem: 'What is the SI unit of electric charge?', options: ['coulomb', 'ampere', 'volt', 'ohm'].map((t, i) => ({ key: 'ABCD'[i], text: t })) },
      { number: 2, stem: 'Which instrument measures electric current?', options: ['voltmeter', 'ammeter', 'ohmmeter', 'wattmeter'].map((t, i) => ({ key: 'ABCD'[i], text: t })) },
    ],
  };
}

// ---------------------------------------------------------------------------
// 5. Hundreds of questions over many pages, flowing naturally across page breaks.
// ---------------------------------------------------------------------------

export async function largeExam(count = 300): Promise<Fixture> {
  const { doc, fonts } = await newDoc();
  const truth: TruthQuestion[] = [];
  const L = 72;
  const width = 468;
  const pages: PDFPage[] = [];
  let page = doc.addPage(LETTER);
  pages.push(page);
  let y = 712;
  const need = (h: number) => {
    if (y - h < 60) {
      page = doc.addPage(LETTER);
      pages.push(page);
      y = 712;
    }
  };
  for (let n = 1; n <= count; n++) {
    const kv = 10 + (n % 50);
    const variant = n % 4;
    const stem =
      variant === 0
        ? `A ${kv} kV feeder supplies a balanced load of ${n * 5} kW at ${(0.7 + (n % 3) / 10).toFixed(2)} power factor lagging. Determine the line current drawn by the load in amperes.`
        : variant === 1
          ? `Find the equivalent resistance of ${n % 7 + 2} identical ${n} Ω resistors connected in parallel.`
          : variant === 2
            ? `What is the synchronous speed of a ${(n % 5) * 2 + 2}-pole, 60 Hz alternator, in rpm?`
            : `A capacitor of ${n} μF is charged to ${kv * 10} V. How much energy, in joules, is stored in it? Give the answer to two decimal places and state any assumption you make about losses during charging.`;
    const options = ['A', 'B', 'C', 'D'].map((k, j) => ({ key: k, text: `${(n * 1.5 + j * 0.25).toFixed(2)} ${variant === 2 ? 'rpm' : variant === 3 ? 'J' : variant === 1 ? 'Ω' : 'A'}` }));
    const lines = wrap(stem, fonts.sans, SIZE, width - 20);
    need(13);
    const startPage = pages.length;
    drawUnicode(page, fonts, L, y, `${n}. ${lines[0]}`);
    y -= 13;
    for (const l of lines.slice(1)) {
      need(13);
      drawUnicode(page, fonts, L + 20, y, l);
      y -= 13;
    }
    for (const o of options) {
      need(13);
      drawUnicode(page, fonts, L + 20, y, `${o.key}. ${o.text}`);
      y -= 13;
    }
    y -= 10;
    const endPage = pages.length;
    truth.push({ number: n, stem, options, pages: startPage === endPage ? [startPage] : [startPage, endPage] });
  }
  pages.forEach((p, i) => header(p, fonts, i + 1, pages.length));
  return { name: 'large', bytes: await doc.save(), questions: truth };
}

// ---------------------------------------------------------------------------
// 6. A paper with real defects the report must surface.
// ---------------------------------------------------------------------------

export async function defectiveExam(): Promise<Fixture> {
  const { doc, fonts } = await newDoc();
  const page = doc.addPage(LETTER);
  const L = 72;
  let y = 720;
  const write = (t: string, indent = 0) => {
    page.drawText(t, { x: L + indent, y, size: SIZE, font: fonts.sans });
    y -= 14;
  };
  write('1. Which law relates voltage, current and resistance?');
  ['A. Ohm\'s law', 'B. Faraday\'s law', 'C. Lenz\'s law', 'D. Coulomb\'s law'].forEach((t) => write(t, 14));
  y -= 8;
  write('2. The unit of inductance is the:');
  ['A. henry', 'B. farad', 'C. tesla', 'D. weber'].forEach((t) => write(t, 14));
  y -= 8;
  // number 3 is absent from the document
  write('4. The unit of capacitance is the:');
  ['A. farad', 'B. henry', 'C. siemens'].forEach((t) => write(t, 14)); // D missing
  y -= 8;
  write('5. Magnetic flux is measured in:');
  ['A. weber', 'B. tesla', 'D. gauss'].forEach((t) => write(t, 14)); // C missing
  return {
    name: 'defective',
    bytes: await doc.save(),
    questions: [],
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next.replace(/[Ωμ]/g, 'W'), size) > width && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Draws text that may contain Ω or μ, switching to the Symbol font for those letters. */
function drawUnicode(page: PDFPage, fonts: Fonts, x: number, y: number, text: string) {
  const segs: Seg[] = [];
  for (const part of text.split(/([Ωμ])/)) {
    if (!part) continue;
    if (part === 'Ω') segs.push({ t: 'Ω', font: 'symbol' });
    else if (part === 'μ') segs.push({ t: 'μ', font: 'symbol' });
    else segs.push({ t: part });
  }
  drawSegs(page, fonts, x, y, segs);
}
