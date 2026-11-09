/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deterministic questionnaire parser shared by the server pipeline and the admin importer.
 *
 * It only segments text: it decides where each question, choice, answer key and printed
 * solution starts and ends. It never rewrites, corrects, reorders or invents content. The
 * only changes it makes are joining wrapped lines with a single space and trimming the
 * whitespace around each piece. Anything it cannot place with confidence becomes an issue
 * on the question so an administrator sees it before the question can be published.
 */

import type {
  ContentStatus,
  CrossCheckResult,
  ExtractionIssue,
  ExtractionMethod,
  ExtractionReport,
  ExtractionReportStatus,
  PageExtractionReport,
  Question,
  QuestionChoice,
  SourceRegion,
  SubjectId,
} from '../types/index.ts';

// ---------------------------------------------------------------------------
// Input and output shapes
// ---------------------------------------------------------------------------

export type LineFlag = 'script_notation' | 'unreadable' | 'stacked_math' | 'reading_uncertain';

/** One line of text in reading order, with the page it came from. */
export interface SourceLine {
  text: string;
  page: number;
  bbox?: SourceRegion;
  /** Set when the line is a label printed inside a detected diagram. */
  figureId?: string;
  flags?: LineFlag[];
}

export interface ParsedQuestion {
  number: number;
  /** Increments when numbering restarts at 1 (Part I, Part II, ...). */
  section: number;
  stem: string;
  options: QuestionChoice[];
  /** Answer printed next to the question ("Answer: B"). */
  inlineAnswerKey?: string;
  /** Choice drawn with a marker such as "*C." or "✓C.". */
  markedAnswerKey?: string;
  /** Answer taken from an answer-key section of the document. */
  sectionAnswerKey?: string;
  solutionText?: string;
  pages: number[];
  regions: SourceRegion[];
  rawText: string;
  figureIds: string[];
  figureLabels: string[];
  issues: ExtractionIssue[];
}

export interface AnswerKeyEntry {
  section: number;
  number: number;
  key: string;
}

export interface ParsedDocument {
  questions: ParsedQuestion[];
  answerKey: AnswerKeyEntry[];
  preamble: string;
  issues: ExtractionIssue[];
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Characters that mean the text layer or the page reading could not be trusted. */
const UNREADABLE = /[�-]|\(cid:\d+\)|⟦[^⟧]*⟧/;
export const UNCERTAIN_MARKER = /⟦([^⟧]*)⟧/g;

export function hasUnreadableText(text: string): boolean {
  return UNREADABLE.test(text);
}

/**
 * Normalisation used only to compare two readings of the same text. Never stored or shown:
 * it folds look-alike characters (Ω/Ω, µ/μ, − /-, superscript digits) so that a comparison
 * flags real differences rather than encoding differences.
 */
export function normalizeForCompare(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‐-―−]/g, '-')
    .replace(/[⋅∙•]/g, '·')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[\s^_{}]/g, '');
}

/** cyrb53: small, fast, stable string hash. Good enough for duplicate detection keys. */
export function hashString(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Same question text and choices give the same fingerprint, whatever the file or upload. */
export function fingerprintQuestion(stem: string, options: QuestionChoice[]): string {
  const body = [normalizeForCompare(stem), ...options.map((o) => `${o.key}:${normalizeForCompare(o.text)}`)].join('|');
  return `q_${hashString(body)}`;
}

/** Joins wrapped lines. List items and paragraphs keep their own line. */
function joinLines(lines: string[]): string {
  let out = '';
  let pendingBreak = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      pendingBreak = out.length > 0;
      continue;
    }
    if (!out) {
      out = line;
    } else if (pendingBreak || LIST_ITEM.test(line)) {
      out += `\n${line}`;
    } else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(line)) {
      out += line; // hyphenated word split across lines: keep the hyphen, drop the break
    } else {
      out += ` ${line}`;
    }
    pendingBreak = false;
  }
  return out;
}

const LIST_ITEM = /^(?:[IVX]{1,4}[.)]|\((?:[ivx]{1,4}|\d{1,2})\)|[ivx]{1,4}\)|\d{1,2}\)\s|[-•▪●◦]\s)\s*/;

// ---------------------------------------------------------------------------
// Line classifiers
// ---------------------------------------------------------------------------

interface QuestionStart {
  number: number;
  rest: string;
}

const QUESTION_START =
  /^(?:(?:Q(?:uestion)?|Item|Prob(?:lem)?\.?)\s*)?(?:\((\d{1,4})\)|(\d{1,4})([.)\]:]|\s+[-–]))(\s*)(.*)$/i;

export function matchQuestionStart(line: string): QuestionStart | null {
  const m = line.trim().match(QUESTION_START);
  if (!m) return null;
  const number = parseInt(m[1] ?? m[2], 10);
  const delimiter = m[3] ?? ')';
  const gap = m[4];
  const rest = m[5] ?? '';
  if (!Number.isFinite(number) || number < 1 || number > 2000) return null;
  // "1.72 × 10" or "2:1 ratio" are numbers at the start of a wrapped line, not question numbers.
  if (!gap && /^\d/.test(rest) && (delimiter === '.' || delimiter === ':')) return null;
  if (!gap && rest && !/^[A-Za-z(“"']/.test(rest)) return null;
  return { number, rest };
}

interface ChoiceStart {
  key: string;
  lower: boolean;
  marked: boolean;
  text: string;
}

const CHOICE_START = /^([*✓✔]\s*)?(?:\(([A-Ea-e])\)|\[([A-Ea-e])\]|([A-Ea-e])([.):]))(\s*)(.*)$/;

export function matchChoiceStart(line: string): ChoiceStart | null {
  const m = line.trim().match(CHOICE_START);
  if (!m) return null;
  const letter = m[2] ?? m[3] ?? m[4];
  const bare = Boolean(m[4]);
  const gap = m[6];
  const text = m[7] ?? '';
  // Bare markers need a space after them, so "A.C. motor" and "D.C." stay text.
  if (bare && !gap && text) return null;
  return { key: letter.toUpperCase(), lower: letter === letter.toLowerCase(), marked: Boolean(m[1]), text };
}

const ANSWER_KEY_HEADING =
  /^(?:answer\s*keys?|answers?(?:\s*(?:sheet|guide))?|key\s+to\s+corrections?|correct\s+answers?|answer\s+key\s+and\s+solutions?)\s*[:.]?$/i;
const INSTRUCTION_HEADING = /^(?:general\s+)?(?:instructions?|directions?)\b/i;
const SOLUTION_START =/^(?:solution|sol(?:'n|n)?\.?|explanation|rationale|answer\s+explanation)\s*[:.\-–]\s*(.*)$/i;
const INLINE_ANSWER_LINE = /^\[?\s*(?:correct\s+)?(?:answer|ans)\.?(?:\s*key)?\s*[:=\-–]?\s*\(?([A-Ea-e])\)?\s*\]?$/i;
const TRAILING_ANSWER = /^(.*?\S)(?:\s{2,}|\t|\s)\[?\s*(?:correct\s+)?(?:answer|ans)\.?(?:\s*key)?\s*[:=]\s*\(?([A-Ea-e])\)?\s*\]?$/i;
const ANSWER_PAIR = /(\d{1,4})\s*[.):\-–]?\s*\(?([A-Ea-e])\)?(?![A-Za-z0-9])/g;

const FIGURE_REFERENCE = /\b(?:figure|fig\.|diagram|shown\s+(?:below|above|in)|circuit\s+(?:below|above|shown)|graph\s+(?:below|above|shown)|table\s+(?:below|above|shown))\b/i;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface ChoiceBuilder {
  key: string;
  lines: string[];
  marked: boolean;
}

interface Builder {
  number: number;
  section: number;
  stem: SourceLine[];
  choices: ChoiceBuilder[];
  duplicateChoices: { key: string; text: string }[];
  solution: string[];
  raw: string[];
  lines: SourceLine[];
  state: 'stem' | 'choices' | 'solution';
  lowerKeys: boolean | null;
  inlineAnswerKey?: string;
  markedAnswerKey?: string;
  figureIds: Set<string>;
  figureLabels: string[];
  issues: ExtractionIssue[];
}

function newBuilder(number: number, section: number): Builder {
  return {
    number,
    section,
    stem: [],
    choices: [],
    duplicateChoices: [],
    solution: [],
    raw: [],
    lines: [],
    state: 'stem',
    lowerKeys: null,
    figureIds: new Set(),
    figureLabels: [],
    issues: [],
  };
}

const keyIndex = (key: string) => key.charCodeAt(0) - 65;
const keyAt = (index: number) => String.fromCharCode(65 + index);

/** Splits "A. 0.43 Ω    B. 0.86 Ω" into its choices. Later keys must follow in order. */
function splitInlineChoices(first: ChoiceStart): { key: string; text: string }[] {
  const parts: { key: string; text: string }[] = [];
  const marker = first.lower
    ? /(\t+|\s{2,}|\s)(?:\(([a-e])\)|([a-e])[.)])(?=\s|$)/g
    : /(\t+|\s{2,}|\s)(?:\(([A-E])\)|([A-E])[.)])(?=\s|$)/g;
  let currentKey = first.key;
  let start = 0;
  const text = first.text;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(text)) !== null) {
    const key = (m[2] ?? m[3]).toUpperCase();
    const wide = m[1] !== ' ';
    const next = keyIndex(key) === keyIndex(currentKey) + 1;
    if (!(next || (wide && keyIndex(key) > keyIndex(currentKey)))) continue;
    parts.push({ key: currentKey, text: text.slice(start, m.index) });
    currentKey = key;
    start = m.index + m[0].length;
  }
  parts.push({ key: currentKey, text: text.slice(start) });
  return parts;
}

/** Last resort for "What is X? (A) 1 (B) 2 (C) 3 (D) 4" written as one paragraph. */
function findChoicesInsideStem(stem: string): { stem: string; options: { key: string; text: string }[] } | null {
  for (const lower of [false, true]) {
    const a = lower ? 'a' : 'A';
    const marker = lower ? /(^|\s)(\(([a-e])\)|([a-e])[.)])(?=\s)/g : /(^|\s)(\(([A-E])\)|([A-E])[.)])(?=\s)/g;
    const found: { key: string; index: number; length: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = marker.exec(stem)) !== null) {
      const key = (m[3] ?? m[4]).toUpperCase();
      const expected = found.length === 0 ? 'A' : keyAt(keyIndex(found[found.length - 1].key) + 1);
      if (key !== expected) continue;
      if (found.length === 0 && (m[3] ?? m[4]) !== a) continue;
      found.push({ key, index: m.index + m[1].length, length: m[2].length });
    }
    if (found.length >= 3) {
      const options = found.map((f, i) => ({
        key: f.key,
        text: stem.slice(f.index + f.length, i + 1 < found.length ? found[i + 1].index : stem.length).trim(),
      }));
      return { stem: stem.slice(0, found[0].index).trim(), options };
    }
  }
  return null;
}

export function parseQuestionLines(input: SourceLine[]): ParsedDocument {
  const questions: ParsedQuestion[] = [];
  const answerKey: AnswerKeyEntry[] = [];
  const preamble: string[] = [];
  const docIssues: ExtractionIssue[] = [];
  let current: Builder | null = null;
  let builders: Builder[] = [];
  let section = 0;
  let mode: 'body' | 'answerKey' = 'body';
  let keySection = 0;
  let lastKeyNumber = 0;

  const addRaw = (b: Builder, line: SourceLine) => {
    b.raw.push(line.text);
    b.lines.push(line);
  };

  const finish = () => {
    if (current) builders.push(current);
    current = null;
  };

  for (const line of input) {
    const trimmed = line.text.trim();

    if (line.figureId) {
      if (current) {
        current.figureIds.add(line.figureId);
        if (trimmed) current.figureLabels.push(trimmed);
        addRaw(current, line);
      }
      continue;
    }

    if (!trimmed) {
      if (current) {
        addRaw(current, line);
        if (current.state === 'stem') current.stem.push(line);
        else if (current.state === 'choices') current.choices[current.choices.length - 1]?.lines.push('');
      }
      continue;
    }

    if (ANSWER_KEY_HEADING.test(trimmed)) {
      finish();
      mode = 'answerKey';
      keySection = 0;
      lastKeyNumber = 0;
      continue;
    }

    if (mode === 'answerKey') {
      const start = matchQuestionStart(trimmed);
      const looksLikeQuestion = start && start.rest.length > 25 && /[a-z]{3,}\s+[a-z]{2,}/.test(start.rest);
      if (!looksLikeQuestion) {
        let found = false;
        for (const m of trimmed.matchAll(ANSWER_PAIR)) {
          const number = parseInt(m[1], 10);
          if (number <= lastKeyNumber && number === 1) keySection++;
          lastKeyNumber = number;
          answerKey.push({ section: keySection, number, key: m[2].toUpperCase() });
          found = true;
        }
        if (!found) {
          docIssues.push({
            code: 'ANSWER_KEY_LINE_UNREAD',
            severity: 'warning',
            message: `A line in the answer key could not be read as answers: "${trimmed.slice(0, 80)}"`,
            page: line.page,
          });
        }
        continue;
      }
      mode = 'body';
    }

    // Split off a trailing "Ans: B" so it never ends up inside a choice.
    let text = trimmed;
    const trailing = text.match(TRAILING_ANSWER);
    let trailingKey: string | undefined;
    if (trailing && current) {
      text = trailing[1];
      trailingKey = trailing[2].toUpperCase();
    }

    const start = matchQuestionStart(text);
    if (start) {
      const decision = acceptQuestionStart(start, current, builders, preamble.some((l) => INSTRUCTION_HEADING.test(l.trim())));
      if (decision.accept) {
        if (decision.restartFromPreamble) {
          // Everything so far was numbered instructions with no choices.
          for (const b of [...builders, ...(current ? [current] : [])]) preamble.push(...b.raw);
          builders = [];
          current = null;
          docIssues.push({
            code: 'NUMBERED_PREAMBLE',
            severity: 'info',
            message: 'Numbered lines before question 1 had no answer choices and were kept as instructions.',
            page: line.page,
          });
        } else {
          finish();
        }
        if (decision.newSection) section++;
        current = newBuilder(start.number, section);
        if (decision.issue) current.issues.push({ ...decision.issue, page: line.page });
        addRaw(current, line);
        if (start.rest) current.stem.push({ ...line, text: start.rest });
        if (trailingKey) current.inlineAnswerKey = trailingKey;
        continue;
      }
      if (current && decision.note) current.issues.push({ ...decision.note, page: line.page });
    }

    if (!current) {
      preamble.push(line.text);
      continue;
    }

    const b: Builder = current;
    addRaw(b, line);
    if (trailingKey) setInlineKey(b, trailingKey, line.page);

    const answerLine = text.match(INLINE_ANSWER_LINE);
    if (answerLine) {
      setInlineKey(b, answerLine[1].toUpperCase(), line.page);
      continue;
    }

    const solution = text.match(SOLUTION_START);
    if (solution && b.state !== 'stem') {
      b.state = 'solution';
      if (solution[1]) b.solution.push(solution[1]);
      continue;
    }
    if (b.state === 'solution') {
      b.solution.push(text);
      continue;
    }

    const choice = matchChoiceStart(text);
    const choiceAllowed =
      choice &&
      (b.lowerKeys === null ? !choice.lower || choice.key === 'A' : b.lowerKeys === choice.lower) &&
      (b.choices.length > 0 || choice.key === 'A' || b.stem.length > 0);
    if (choice && choiceAllowed) {
      if (b.lowerKeys === null) b.lowerKeys = choice.lower;
      b.state = 'choices';
      if (choice.marked) {
        if (b.markedAnswerKey && b.markedAnswerKey !== choice.key) {
          b.issues.push({
            code: 'MULTIPLE_MARKED_CHOICES',
            severity: 'warning',
            message: `More than one choice is marked (${b.markedAnswerKey} and ${choice.key}).`,
            field: 'answer',
            page: line.page,
          });
        }
        b.markedAnswerKey = choice.key;
      }
      for (const part of splitInlineChoices(choice)) addChoice(b, part.key, part.text, line);
      continue;
    }

    if (b.state === 'choices') {
      b.choices[b.choices.length - 1].lines.push(text);
      continue;
    }
    b.stem.push({ ...line, text });
  }
  finish();

  for (const b of builders) questions.push(finalizeQuestion(b));
  applyAnswerKey(questions, answerKey, docIssues);
  applyDocumentChecks(questions, docIssues);

  return { questions, answerKey, preamble: joinLines(preamble), issues: docIssues };
}

function setInlineKey(b: Builder, key: string, page: number) {
  if (b.inlineAnswerKey && b.inlineAnswerKey !== key) {
    b.issues.push({
      code: 'CONFLICTING_ANSWER_KEYS',
      severity: 'warning',
      message: `The question shows two different answers (${b.inlineAnswerKey} and ${key}).`,
      field: 'answer',
      page,
    });
  }
  b.inlineAnswerKey = key;
}

function addChoice(b: Builder, key: string, text: string, line: SourceLine) {
  if (b.choices.some((c) => c.key === key)) {
    b.duplicateChoices.push({ key, text: text.trim() });
    // Keep the text somewhere visible: it stays in rawText and in the issue below.
    b.issues.push({
      code: 'DUPLICATE_CHOICE_KEY',
      severity: 'error',
      message: `Choice ${key} appears more than once. The second one ("${text.trim().slice(0, 60)}") was not used. A question number may be missing just above it.`,
      field: 'choice',
      choiceKey: key,
      page: line.page,
    });
    // Further continuation lines belong to the duplicate, not to the earlier choice.
    b.choices.push({ key: `${key}#dup`, lines: [text], marked: false });
    return;
  }
  b.choices.push({ key, lines: [text], marked: false });
}

interface StartDecision {
  accept: boolean;
  newSection?: boolean;
  restartFromPreamble?: boolean;
  issue?: ExtractionIssue;
  note?: ExtractionIssue;
}

function acceptQuestionStart(start: QuestionStart, current: Builder | null, done: Builder[], sawInstructionHeading: boolean): StartDecision {
  if (!current) {
    return { accept: true };
  }
  const n = start.number;
  const hasChoices = current.choices.length >= 2;
  const expected = current.number + 1;
  const looksLikeStem = start.rest.length >= 12;

  if (n === expected) return { accept: true };
  // "INSTRUCTIONS 1. ... 2. ..." followed by the real question 1. Only when everything so far
  // was a numbered run from 1 without choices; a question's own "1) ... 2) ..." list stays put.
  const blocks = [...done, current];
  const firstNumber = blocks[0].number;
  if (
    n === 1 &&
    !hasChoices &&
    firstNumber === 1 &&
    blocks.every((b) => b.choices.length === 0) &&
    (current.number >= 2 || sawInstructionHeading)
  ) {
    return { accept: true, restartFromPreamble: true };
  }
  if (n === 1 && hasChoices) {
    return {
      accept: true,
      newSection: true,
      issue: {
        code: 'NUMBERING_RESTART',
        severity: 'info',
        message: `Numbering restarts at 1 after question ${current.number}; treated as a new part of the document.`,
        field: 'number',
      },
    };
  }
  if (n > expected && n <= expected + 9 && (hasChoices || looksLikeStem)) return { accept: true };
  if (n === current.number && hasChoices && looksLikeStem) {
    return {
      accept: true,
      issue: {
        code: 'DUPLICATE_NUMBER',
        severity: 'error',
        message: `Question number ${n} appears twice in a row.`,
        field: 'number',
      },
    };
  }
  if (hasChoices && looksLikeStem) {
    return {
      accept: true,
      issue: {
        code: 'NUMBER_OUT_OF_SEQUENCE',
        severity: 'warning',
        message: `Question ${n} follows question ${current.number}; check the order against the PDF.`,
        field: 'number',
      },
    };
  }
  return {
    accept: false,
    note: {
      code: 'NUMBERED_LINE_KEPT',
      severity: hasChoices ? 'warning' : 'info',
      message: hasChoices
        ? `A line starting with "${n}." after the choices of question ${current.number} was kept as part of it. If it is a separate question, split it out.`
        : `A numbered line ("${n}.") inside question ${current.number} was kept as part of the question text.`,
      field: 'number',
    },
  };
}

function finalizeQuestion(b: Builder): ParsedQuestion {
  const issues = [...b.issues];
  let stem = joinLines(b.stem.map((l) => l.text));
  let options: QuestionChoice[] = b.choices
    .filter((c) => !c.key.endsWith('#dup'))
    .map((c) => ({ key: c.key, text: joinLines(c.lines) }));

  if (options.length === 0) {
    const inline = findChoicesInsideStem(stem);
    if (inline) {
      stem = inline.stem;
      options = inline.options;
      issues.push({
        code: 'CHOICES_INSIDE_STEM',
        severity: 'warning',
        message: 'The choices were written on the same line as the question and were split by their letters. Check each choice against the PDF.',
        field: 'choice',
      });
    }
  }

  options.sort((x, y) => x.key.localeCompare(y.key));
  const pages = [...new Set(b.lines.map((l) => l.page))];
  const regions = mergeRegions(b.lines.filter((l) => !l.figureId));
  const firstPage = pages[0];

  if (!stem) {
    issues.push({ code: 'EMPTY_STEM', severity: 'error', message: 'No question text was found.', field: 'stem', page: firstPage });
  } else if (stem.length < 8) {
    issues.push({ code: 'SHORT_STEM', severity: 'warning', message: 'The question text is unusually short; part of it may be missing.', field: 'stem', page: firstPage });
  }

  if (options.length < 2) {
    issues.push({
      code: 'NO_CHOICES',
      severity: 'error',
      message: options.length === 0 ? 'No answer choices were found.' : 'Only one answer choice was found.',
      field: 'choice',
      page: firstPage,
    });
  } else {
    const keys = options.map((o) => o.key);
    const last = keyIndex(keys[keys.length - 1]);
    for (let i = 0; i <= last; i++) {
      if (!keys.includes(keyAt(i))) {
        issues.push({
          code: 'CHOICE_MISSING',
          severity: 'error',
          message: `Choice ${keyAt(i)} is missing between ${keys[0]} and ${keys[keys.length - 1]}.`,
          field: 'choice',
          choiceKey: keyAt(i),
          page: firstPage,
        });
      }
    }
  }
  for (const option of options) {
    if (!option.text) {
      issues.push({ code: 'EMPTY_CHOICE', severity: 'error', message: `Choice ${option.key} has no text.`, field: 'choice', choiceKey: option.key, page: firstPage });
    }
  }

  // Unreadable glyphs or uncertain readings, field by field.
  if (hasUnreadableText(stem)) {
    issues.push({ code: 'UNREADABLE_TEXT', severity: 'error', message: 'Part of the question text could not be read reliably (marked ⟦ ⟧ or shown as �).', field: 'stem', page: firstPage });
  }
  for (const option of options) {
    if (hasUnreadableText(option.text)) {
      issues.push({ code: 'UNREADABLE_TEXT', severity: 'error', message: `Part of choice ${option.key} could not be read reliably.`, field: 'choice', choiceKey: option.key, page: firstPage });
    }
  }

  const flagged = (flag: LineFlag) => b.lines.some((l) => l.flags?.includes(flag));
  if (flagged('script_notation')) {
    issues.push({
      code: 'SCRIPT_NOTATION',
      severity: 'warning',
      message: 'A superscript or subscript had no plain-text equivalent and is written as ^(…) or _(…). Check it against the PDF.',
      field: 'stem',
      page: firstPage,
    });
  }
  if (flagged('stacked_math')) {
    issues.push({
      code: 'STACKED_MATH',
      severity: 'warning',
      message: 'This question appears to contain a built-up fraction or equation that plain text cannot show exactly. Compare it with the page image.',
      field: 'stem',
      page: firstPage,
    });
  }

  const allText = `${stem}\n${options.map((o) => o.text).join('\n')}`;
  if (FIGURE_REFERENCE.test(allText) && b.figureIds.size === 0) {
    issues.push({
      code: 'FIGURE_NOT_CAPTURED',
      severity: 'warning',
      message: 'The question refers to a figure, diagram or table, but none was captured next to it. Attach it from the PDF.',
      field: 'figure',
      page: firstPage,
    });
  }
  if (pages.length > 1) {
    issues.push({
      code: 'SPANS_PAGES',
      severity: 'info',
      message: `This question continues from page ${pages[0]} to page ${pages[pages.length - 1]}.`,
      page: firstPage,
    });
  }

  const solutionText = joinLines(b.solution) || undefined;
  return {
    number: b.number,
    section: b.section,
    stem,
    options,
    inlineAnswerKey: b.inlineAnswerKey,
    markedAnswerKey: b.markedAnswerKey,
    solutionText,
    pages,
    regions,
    rawText: b.raw.join('\n').trim(),
    figureIds: [...b.figureIds],
    figureLabels: b.figureLabels,
    issues,
  };
}

function mergeRegions(lines: SourceLine[]): SourceRegion[] {
  const byPage = new Map<number, SourceRegion>();
  for (const line of lines) {
    if (!line.bbox || !line.text.trim()) continue;
    const r = byPage.get(line.page);
    byPage.set(
      line.page,
      r
        ? { page: line.page, x0: Math.min(r.x0, line.bbox.x0), y0: Math.min(r.y0, line.bbox.y0), x1: Math.max(r.x1, line.bbox.x1), y1: Math.max(r.y1, line.bbox.y1) }
        : { ...line.bbox, page: line.page }
    );
  }
  return [...byPage.values()];
}

function applyAnswerKey(questions: ParsedQuestion[], entries: AnswerKeyEntry[], docIssues: ExtractionIssue[]) {
  if (entries.length === 0) return;
  const sectionCount = new Set(questions.map((q) => q.section)).size;
  const keySections = new Set(entries.map((e) => e.section)).size;
  const matched = new Set<AnswerKeyEntry>();
  for (const q of questions) {
    const entry =
      entries.find((e) => e.number === q.number && (keySections === sectionCount ? e.section === q.section : true));
    if (!entry) continue;
    matched.add(entry);
    q.sectionAnswerKey = entry.key;
  }
  const unmatched = entries.filter((e) => !matched.has(e));
  if (unmatched.length > 0) {
    docIssues.push({
      code: 'ANSWER_KEY_UNMATCHED',
      severity: 'warning',
      message: `The answer key lists ${unmatched.length} item(s) with no matching question: ${unmatched
        .slice(0, 12)
        .map((e) => e.number)
        .join(', ')}${unmatched.length > 12 ? ', …' : ''}.`,
      field: 'number',
    });
  }
}

/** Checks that need the whole document: answer validity, choice counts, duplicates. */
function applyDocumentChecks(questions: ParsedQuestion[], docIssues: ExtractionIssue[]) {
  const counts = new Map<number, number>();
  for (const q of questions) if (q.options.length >= 2) counts.set(q.options.length, (counts.get(q.options.length) ?? 0) + 1);
  const typical = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const seen = new Map<string, ParsedQuestion>();
  for (const q of questions) {
    const keys = q.options.map((o) => o.key);
    for (const [code, key, label] of [
      ['INLINE', q.inlineAnswerKey, 'printed answer'],
      ['MARKED', q.markedAnswerKey, 'marked choice'],
      ['SECTION', q.sectionAnswerKey, 'answer key'],
    ] as const) {
      if (key && keys.length > 0 && !keys.includes(key)) {
        q.issues.push({
          code: `ANSWER_${code}_INVALID`,
          severity: 'error',
          message: `The ${label} is "${key}", but the question has no choice ${key}.`,
          field: 'answer',
        });
      }
    }
    const given = [q.inlineAnswerKey, q.markedAnswerKey, q.sectionAnswerKey].filter(Boolean);
    if (new Set(given).size > 1) {
      q.issues.push({
        code: 'CONFLICTING_ANSWER_KEYS',
        severity: 'warning',
        message: `The document gives different answers for this question (${given.join(', ')}).`,
        field: 'answer',
      });
    }

    if (typical && q.options.length >= 2 && q.options.length < typical) {
      q.issues.push({
        code: 'FEWER_CHOICES_THAN_USUAL',
        severity: 'error',
        message: `Only ${q.options.length} choices were found; most questions in this document have ${typical}. A choice may be on another page or column.`,
        field: 'choice',
      });
    }

    if (q.stem) {
      const fp = fingerprintQuestion(q.stem, q.options);
      const earlier = seen.get(fp);
      if (earlier) {
        q.issues.push({
          code: 'DUPLICATE_CONTENT',
          severity: 'warning',
          message: `Same text and choices as question ${earlier.number}${earlier.section !== q.section ? ` (part ${earlier.section + 1})` : ''}.`,
        });
      } else {
        seen.set(fp, q);
      }
    }
  }

  // Numbering gaps and repeats, per part of the document.
  const sections = [...new Set(questions.map((q) => q.section))];
  for (const s of sections) {
    const nums = questions.filter((q) => q.section === s).map((q) => q.number);
    const missing = findMissingNumbers(nums);
    if (missing.length > 0) {
      docIssues.push({
        code: 'MISSING_NUMBERS',
        severity: 'error',
        message: `Question number(s) ${missing.join(', ')}${sections.length > 1 ? ` in part ${s + 1}` : ''} were not found.`,
        field: 'number',
      });
    }
  }
}

export function findMissingNumbers(numbers: number[]): number[] {
  if (numbers.length === 0) return [];
  const set = new Set(numbers);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const missing: number[] = [];
  // Starts at the first number found: a file may legitimately hold items 51-100 only.
  for (let i = min; i <= max; i++) if (!set.has(i)) missing.push(i);
  return missing;
}

// ---------------------------------------------------------------------------
// Plain text input (TXT files and presets)
// ---------------------------------------------------------------------------

/** Page breaks are form feeds or "--- PAGE n ---" lines. */
export function textToSourceLines(text: string): SourceLine[] {
  const out: SourceLine[] = [];
  let page = 1;
  const pages = text.replace(/\r\n?/g, '\n').split('\f');
  pages.forEach((chunk, i) => {
    if (i > 0) page++;
    for (const raw of chunk.split('\n')) {
      const marker = raw.trim().match(/^-{2,}\s*PAGE\s*(\d+)\s*-{2,}$/i);
      if (marker) {
        page = parseInt(marker[1], 10);
        continue;
      }
      out.push({ text: raw, page });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Classification suggestions (shown as suggestions; never part of the extracted text)
// ---------------------------------------------------------------------------

export const SUBJECT_NAMES: Record<SubjectId, string> = {
  math: 'Mathematics',
  esas: 'Engineering Sciences & Allied Subjects',
  ee: 'Electrical Engineering Professional Subjects',
};

export function suggestClassification(text: string): { subjectId: SubjectId; topic: string } {
  const t = text.toLowerCase();
  const has = (...words: string[]) => words.some((w) => t.includes(w));
  if (has('pec', 'philippine electrical code', 'conduit', 'ampacity')) return { subjectId: 'ee', topic: 'Philippine Electrical Code (PEC)' };
  if (has('induction motor', 'transformer', 'alternator', 'synchronous', 'generator', 'armature', 'dc motor', 'shunt motor')) {
    return { subjectId: 'ee', topic: 'Electrical Machines' };
  }
  if (has('transmission line', 'fault', 'per unit', 'p.u.', 'substation', 'feeder', 'power factor', 'kvar')) {
    return { subjectId: 'ee', topic: 'Power Systems' };
  }
  if (has('circuit', 'resistance', 'reactance', 'impedance', 'resonan', 'capacitor', 'inductor', 'ohm', 'Ω')) {
    return { subjectId: 'ee', topic: 'Electric Circuits' };
  }
  if (has('interest', 'depreciation', 'annuity', 'present worth', 'future worth')) return { subjectId: 'esas', topic: 'Engineering Economy' };
  if (has('thermodynamic', 'carnot', 'entropy', 'heat engine', 'enthalpy')) return { subjectId: 'esas', topic: 'Thermodynamics' };
  if (has('stress', 'strain', 'elongation', 'friction', 'velocity', 'acceleration', 'momentum', 'beam')) {
    return { subjectId: 'esas', topic: 'Engineering Mechanics' };
  }
  if (has('derivative', 'integral', 'differential equation', 'limit of')) return { subjectId: 'math', topic: 'Calculus' };
  if (has('matrix', 'determinant', 'vector')) return { subjectId: 'math', topic: 'Linear Algebra' };
  if (has('probability', 'mean', 'standard deviation', 'variance')) return { subjectId: 'math', topic: 'Probability & Statistics' };
  if (has('triangle', 'angle', 'sin', 'cos', 'tan', 'circle', 'ellipse', 'parabola')) return { subjectId: 'math', topic: 'Trigonometry & Geometry' };
  if (has('logarithm', 'equation', 'polynomial', 'roots')) return { subjectId: 'math', topic: 'Algebra' };
  return { subjectId: 'ee', topic: 'Unclassified' };
}

// ---------------------------------------------------------------------------
// Turning parsed questions into staged bank questions
// ---------------------------------------------------------------------------

export interface StageOptions {
  sourcePdfId: string;
  sourcePdfName: string;
  documentHash?: string;
  method: ExtractionMethod;
  /** Per question key ("section:number"), the result of comparing two independent readings. */
  crossChecks?: Record<string, { result: CrossCheckResult; issues: ExtractionIssue[] }>;
  figures?: Record<string, import('../types/index.ts').ExtractedFigure>;
  now?: string;
  idPrefix?: string;
}

export const questionKey = (q: { section: number; number: number }) => `${q.section}:${q.number}`;

export function stageParsedQuestions(parsed: ParsedQuestion[], options: StageOptions): Question[] {
  const now = options.now ?? new Date().toISOString();
  return parsed.map((p, index) => {
    const check = options.crossChecks?.[questionKey(p)];
    const issues = [...p.issues, ...(check?.issues ?? [])];
    const answer = p.sectionAnswerKey ?? p.inlineAnswerKey ?? p.markedAnswerKey;
    const answerValid = Boolean(answer && p.options.some((o) => o.key === answer));
    const suggestion = suggestClassification(`${p.stem} ${p.options.map((o) => o.text).join(' ')}`);
    const crossCheck: CrossCheckResult = check?.result ?? 'not_run';
    const figures = p.figureIds
      .map((id) => options.figures?.[id])
      .filter((f): f is NonNullable<typeof f> => Boolean(f))
      .map((f) => ({ ...f, labels: p.figureLabels.length ? p.figureLabels : f.labels }));

    if (!answer) {
      issues.push({
        code: 'NO_ANSWER_IN_PDF',
        severity: 'info',
        message: 'The PDF does not give an answer for this question. Set it yourself or ask AI for a suggested answer.',
        field: 'answer',
      });
    }

    const question: Question = {
      id: `${options.idPrefix ?? 'ext'}-${Date.now().toString(36)}-${index + 1}`,
      originalQuestionNumber: p.number,
      question: p.stem,
      options: p.options.map((o) => ({ ...o })),
      correctAnswer: answerValid ? answer! : '',
      ...(answer ? { extractedAnswerKey: answer } : {}),
      // A solution printed in the PDF is shown as-is; AI explanations are only ever added on request.
      explanation: p.solutionText ?? '',
      subjectId: suggestion.subjectId,
      subjectName: SUBJECT_NAMES[suggestion.subjectId],
      topic: suggestion.topic,
      difficulty: 'Average',
      hasDiagram: figures.length > 0 || FIGURE_REFERENCE.test(p.stem),
      hasMathEquation: /[=∫∑√πθλαβγωΩ²³⁰¹⁴⁵⁶⁷⁸⁹⁻±×÷∠^]|\b(?:sin|cos|tan|log|ln)\b/.test(`${p.stem} ${p.options.map((o) => o.text).join(' ')}`),
      sourcePdfId: options.sourcePdfId,
      sourcePdfName: options.sourcePdfName,
      sourcePdfPage: p.pages[0] ?? 1,
      sourcePdfPages: p.pages,
      sourceRegions: p.regions,
      ...(options.documentHash ? { sourceDocumentHash: options.documentHash } : {}),
      contentFingerprint: fingerprintQuestion(p.stem, p.options),
      sourceBlockText: p.rawText,
      ...(p.solutionText ? { sourceSolutionText: p.solutionText } : {}),
      extractionMethod: options.method,
      extractionIssues: issues,
      crossCheck,
      contentStatus: 'needs_review',
      reviewStatus: 'pending',
      answerSource: answerValid ? 'pdf_key' : 'none',
      figures,
      // Answers from the PDF are as the document states them; an admin still approves the question.
      verificationStatus: answerValid ? 'verified' : 'needs_verification',
      extractionConfidence: 0,
      isPublished: false,
      createdAt: now,
      updatedAt: now,
      originalQuestionText: p.stem,
      originalOptions: p.options.map((o) => ({ ...o })),
    };
    return refreshQuestionAssessment(question);
  });
}

// ---------------------------------------------------------------------------
// Assessment: content status and confidence
// ---------------------------------------------------------------------------

export function openIssues(q: Pick<Question, 'extractionIssues'>): ExtractionIssue[] {
  return (q.extractionIssues ?? []).filter((i) => !i.acknowledged);
}

export function assessContent(q: Pick<Question, 'extractionIssues' | 'crossCheck' | 'reviewStatus'>): ContentStatus {
  if (q.reviewStatus === 'approved') return 'verified';
  const open = openIssues(q);
  if (open.some((i) => i.severity === 'error')) return 'incomplete';
  if (open.some((i) => i.severity === 'warning') || q.crossCheck !== 'agree') return 'needs_review';
  return 'verified';
}

/** A heuristic score for sorting and highlighting. It is not a measured accuracy. */
export function estimateConfidence(q: Pick<Question, 'extractionIssues' | 'crossCheck' | 'extractionMethod'>): number {
  const base = q.extractionMethod === 'ocr' ? 70 : q.extractionMethod === 'manual' ? 100 : 88;
  let score = q.crossCheck === 'agree' ? Math.max(base, 96) : q.crossCheck === 'differ' ? Math.min(base, 60) : base;
  for (const issue of openIssues(q)) score -= issue.severity === 'error' ? 25 : issue.severity === 'warning' ? 8 : 0;
  return Math.max(5, Math.min(100, Math.round(score)));
}

/** Re-runs the checks that depend only on the question itself, e.g. after an admin edit. */
export function revalidateEditedQuestion(q: Question): Question {
  const kept = (q.extractionIssues ?? []).filter((i) => !EDIT_SENSITIVE.has(i.code));
  const fresh: ExtractionIssue[] = [];
  if (!q.question.trim()) fresh.push({ code: 'EMPTY_STEM', severity: 'error', message: 'No question text.', field: 'stem' });
  if (hasUnreadableText(q.question)) {
    fresh.push({ code: 'UNREADABLE_TEXT', severity: 'error', message: 'The question still contains unreadable or uncertain text (⟦ ⟧ or �).', field: 'stem' });
  }
  if (q.options.length < 2) fresh.push({ code: 'NO_CHOICES', severity: 'error', message: 'At least two choices are needed.', field: 'choice' });
  const keys = q.options.map((o) => o.key);
  if (new Set(keys).size !== keys.length) fresh.push({ code: 'DUPLICATE_CHOICE_KEY', severity: 'error', message: 'Two choices share a letter.', field: 'choice' });
  for (const o of q.options) {
    if (!o.text.trim()) fresh.push({ code: 'EMPTY_CHOICE', severity: 'error', message: `Choice ${o.key} has no text.`, field: 'choice', choiceKey: o.key });
    if (hasUnreadableText(o.text)) {
      fresh.push({ code: 'UNREADABLE_TEXT', severity: 'error', message: `Choice ${o.key} still contains unreadable or uncertain text.`, field: 'choice', choiceKey: o.key });
    }
  }
  if (q.correctAnswer && !keys.includes(q.correctAnswer)) {
    fresh.push({ code: 'ANSWER_INVALID', severity: 'error', message: `The answer is "${q.correctAnswer}", which is not one of the choices.`, field: 'answer' });
  }
  return refreshQuestionAssessment({
    ...q,
    extractionIssues: [...kept, ...fresh],
    contentFingerprint: q.question.trim() ? fingerprintQuestion(q.question, q.options) : q.contentFingerprint,
  });
}

const EDIT_SENSITIVE = new Set([
  'EMPTY_STEM',
  'SHORT_STEM',
  'NO_CHOICES',
  'CHOICE_MISSING',
  'EMPTY_CHOICE',
  'UNREADABLE_TEXT',
  'DUPLICATE_CHOICE_KEY',
  'ANSWER_INVALID',
  'ANSWER_INLINE_INVALID',
  'ANSWER_MARKED_INVALID',
  'ANSWER_SECTION_INVALID',
  'FEWER_CHOICES_THAN_USUAL',
]);

export function refreshQuestionAssessment(q: Question): Question {
  const contentStatus = assessContent(q);
  return { ...q, contentStatus, extractionConfidence: estimateConfidence(q) };
}

/** True when the question's text or choices differ from what was extracted. */
export function isEditedFromSource(q: Question): boolean {
  if (q.originalQuestionText === undefined) return false;
  if (q.question !== q.originalQuestionText) return true;
  const original = q.originalOptions ?? [];
  return (
    original.length !== q.options.length || original.some((o, i) => o.key !== q.options[i].key || o.text !== q.options[i].text)
  );
}

// ---------------------------------------------------------------------------
// Extraction report
// ---------------------------------------------------------------------------

export interface ReportInput {
  filename: string;
  fileSize?: string;
  totalPages: number;
  questions: Question[];
  pages?: PageExtractionReport[];
  documentIssues?: ExtractionIssue[];
  engineUsed: string;
  documentHash?: string;
  answerKeyFound?: boolean;
  imageReadingAvailable?: boolean;
  /** Question numbers an admin confirmed are absent from the original PDF too. */
  acknowledgedMissing?: number[];
  timestamp?: string;
}

/**
 * Builds the report from the staged questions, so it can be recomputed after every admin edit.
 * "Verified" requires every question to be confirmed by an independent reading or by an admin;
 * finishing the extraction is never enough on its own.
 */
export function buildExtractionReport(input: ReportInput): ExtractionReport {
  const qs = input.questions.filter((q) => q.reviewStatus !== 'rejected');
  const acknowledged = new Set(input.acknowledgedMissing ?? []);
  const numbers = qs.map((q) => q.originalQuestionNumber).filter((n): n is number => typeof n === 'number');
  const missing = qs.length ? findMissingNumbers(numbers).filter((n) => !acknowledged.has(n)) : [];
  const counts = new Map<number, number>();
  for (const n of numbers) counts.set(n, (counts.get(n) ?? 0) + 1);
  const duplicates = [...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n);
  // Repeated numbers are expected when the document has several parts.
  const parts = input.documentIssues?.some((i) => i.code === 'NUMBERING_RESTART') || qs.some((q) => q.extractionIssues?.some((i) => i.code === 'NUMBERING_RESTART'));

  const statuses = qs.map((q) => assessContent(q));
  const incompleteCount = statuses.filter((s) => s === 'incomplete').length;
  const reviewCount = statuses.filter((s) => s !== 'verified').length;
  const verifiedCount = statuses.filter((s) => s === 'verified').length;
  const approvedCount = qs.filter((q) => q.reviewStatus === 'approved').length;
  const crossCheckedCount = qs.filter((q) => q.crossCheck === 'agree').length;
  const discrepancies = qs.filter((q) => q.crossCheck === 'differ' || q.verificationStatus === 'discrepancy_flagged').length;
  const pagesWithIssues = (input.pages ?? []).filter((p) => p.status !== 'ok').map((p) => p.page);
  const pageErrors = (input.pages ?? []).filter((p) => p.status === 'error');
  const pagesWithOcrIssues = (input.pages ?? [])
    .filter((p) => p.issues.some((i) => /image|OCR|reading|scanned|unreadable/i.test(i)))
    .map((p) => p.page);
  for (const q of qs) {
    if (assessContent(q) === 'incomplete' && q.sourcePdfPage && !pagesWithIssues.includes(q.sourcePdfPage)) {
      pagesWithIssues.push(q.sourcePdfPage);
    }
  }
  pagesWithIssues.sort((a, b) => a - b);

  const warnings: string[] = [];
  const docErrors = (input.documentIssues ?? []).filter((i) => i.severity !== 'info' && i.code !== 'MISSING_NUMBERS');
  warnings.push(...docErrors.map((i) => i.message));
  if (missing.length) warnings.push(`Question number(s) not found: ${missing.join(', ')}.`);
  if (duplicates.length && !parts) warnings.push(`Question number(s) appearing more than once: ${duplicates.join(', ')}.`);
  for (const p of pageErrors) warnings.push(`Page ${p.page}: ${p.issues.join(' ')}`);
  if (input.imageReadingAvailable === false) {
    warnings.push('Page images were not read (GEMINI_API_KEY is not configured), so no question could be cross-checked against the page image. Every question needs an administrator check.');
  }

  let overallStatus: ExtractionReportStatus;
  const failed = qs.length === 0 || (input.pages && input.pages.length > 0 && pageErrors.length === input.pages.length);
  if (failed) overallStatus = 'failed';
  else if (incompleteCount > 0 || missing.length > 0 || pageErrors.length > 0 || (duplicates.length > 0 && !parts)) overallStatus = 'incomplete';
  else if (reviewCount > 0) overallStatus = 'needs_review';
  else overallStatus = 'verified';

  const notes: string[] = [];
  if (overallStatus === 'failed') {
    notes.push(qs.length === 0 ? 'No questions could be identified in this document.' : 'No page could be read reliably.');
  }
  if (overallStatus === 'verified') {
    notes.push(
      approvedCount === qs.length
        ? 'Every question was approved by an administrator after comparison with the PDF.'
        : `Every question was confirmed: ${crossCheckedCount} by matching two independent readings of the page, ${approvedCount} by an administrator.`
    );
  }
  if (reviewCount > 0) notes.push(`${reviewCount} question(s) still need an administrator to compare them with the PDF.`);
  if (input.answerKeyFound) notes.push('An answer key was found in the document and matched to the questions by number.');

  return {
    filename: input.filename,
    fileSize: input.fileSize,
    totalPages: input.totalPages,
    totalQuestionsDetected: qs.length,
    totalQuestionsExtracted: qs.length - incompleteCount,
    totalChoicesDetected: qs.reduce((sum, q) => sum + q.options.length, 0),
    questionsRequiringVerification: reviewCount,
    verifiedQuestionsCount: verifiedCount,
    flaggedDiscrepanciesCount: discrepancies,
    incompleteQuestionsCount: incompleteCount,
    pagesWithIssues,
    sequenceGaps: missing.map((n) => `Question ${n} was not found`),
    overallStatus,
    engineUsed: input.engineUsed,
    notes,
    extractionTimestamp: input.timestamp ?? new Date().toISOString(),
    documentHash: input.documentHash,
    pages: input.pages,
    missingQuestionNumbers: missing,
    duplicateQuestionNumbers: parts ? [] : duplicates,
    pagesWithOcrIssues,
    warnings,
    crossCheckedCount,
    approvedCount,
    answerKeyFound: input.answerKeyFound,
    imageReadingAvailable: input.imageReadingAvailable,
  };
}
