/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The standard layout of a generated solution, shared by the server (which writes it) and the
 * app (which shows it). Sections with nothing in them are left out, so a conceptual question
 * gets only Find, Final Answer and Explanation.
 */

import type { GivenValue } from '../types/index.ts';

export interface SolutionParts {
  given: GivenValue[];
  find: string;
  formulas: string[];
  steps: string[];
  finalAnswer: string;
  explanation: string;
}

export const SOLUTION_HEADINGS = ['Given', 'Find', 'Formula', 'Solution', 'Final Answer', 'Explanation'] as const;
export type SolutionHeading = (typeof SOLUTION_HEADINGS)[number];

export function formatStructuredSolution(p: SolutionParts): string {
  const sections: [SolutionHeading, string][] = [
    ['Given', p.given.map((g) => `• ${g.label} = ${g.value}`).join('\n')],
    ['Find', p.find.trim()],
    ['Formula', p.formulas.map((f) => `• ${f}`).join('\n')],
    ['Solution', p.steps.map((step, i) => `${i + 1}. ${step.replace(/^\s*\d+[.)]\s*/, '')}`).join('\n')],
    ['Final Answer', p.finalAnswer.trim()],
    ['Explanation', p.explanation.trim()],
  ];
  return sections
    .filter(([, body]) => body.trim())
    .map(([heading, body]) => `${heading}:\n${body}`)
    .join('\n\n');
}

/** A solution's text split into what an examinee reads: an opening paragraph, steps and notes. */
export interface ReadableSolution {
  /** Plain lines that are not part of a step: the whole solution when it has no steps. */
  paragraphs: string[];
  /** Each step's text; a step's continuation lines are kept, separated by "\n". */
  steps: string[];
  /** "Note:" lines, for examinees. */
  notes: string[];
  /** "Review note:" lines: written for the administrator, never shown to examinees. */
  reviewNotes: string[];
}

const STEP_MARKER = /^(?:\d{1,2}[.)]|[•▪◦*-])\s+/;

/**
 * Reads a solution written as an opening line followed by "•" or "1." steps, with optional
 * "Note:" and "Review note:" lines. When there are steps, the opening line is the first step,
 * since it is usually the first line of working.
 */
export function readSolution(text: string): ReadableSolution {
  const out: ReadableSolution = { paragraphs: [], steps: [], notes: [], reviewNotes: [] };
  const lead: string[] = []; // plain lines before the first step
  let lastWasStep = false;
  // A display equation is one reading unit even when its LaTeX spans several lines.
  const lines = text.replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g, (math) => math.replace(/\r?\n/g, ' '));
  for (const raw of lines.split('\n')) {
    if (!raw.trim()) {
      lastWasStep = false;
      continue;
    }
    const marked = STEP_MARKER.test(raw.trim());
    const line = raw.trim().replace(STEP_MARKER, '');
    const review = /^review note\s*:\s*/i.exec(line);
    const note = /^note\s*:\s*/i.exec(line);
    if (review) {
      out.reviewNotes.push(line.slice(review[0].length));
      lastWasStep = false;
    } else if (note) {
      out.notes.push(line.slice(note[0].length));
      lastWasStep = false;
    } else if (marked) {
      out.steps.push(line);
      lastWasStep = true;
    } else if (lastWasStep && out.steps.length) {
      out.steps[out.steps.length - 1] += `\n${line}`;
    } else if (out.steps.length) {
      out.paragraphs.push(line);
    } else {
      lead.push(line);
    }
  }
  if (out.steps.length) out.steps.unshift(...lead);
  else out.paragraphs.unshift(...lead);
  return out;
}

/** Splits a formatted solution back into its sections; text without headings is one untitled section. */
export function parseSolutionSections(text: string): { heading: SolutionHeading | null; body: string }[] {
  const pattern = new RegExp(`^(${SOLUTION_HEADINGS.join('|')}):\\s*$`, 'm');
  if (!pattern.test(text)) return text.trim() ? [{ heading: null, body: text.trim() }] : [];
  const out: { heading: SolutionHeading | null; body: string }[] = [];
  let current: { heading: SolutionHeading | null; lines: string[] } = { heading: null, lines: [] };
  for (const line of text.split('\n')) {
    const m = new RegExp(`^(${SOLUTION_HEADINGS.join('|')}):\\s*$`).exec(line.trim());
    if (m) {
      if (current.heading || current.lines.join('').trim()) out.push({ heading: current.heading, body: current.lines.join('\n').trim() });
      current = { heading: m[1] as SolutionHeading, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  out.push({ heading: current.heading, body: current.lines.join('\n').trim() });
  return out.filter((s) => s.body);
}
