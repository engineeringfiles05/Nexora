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
