/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AI help with answers and solutions. It receives the extracted question as read-only input
 * and returns a separate AiSolution; nothing it produces is written into the question text
 * or the choices. When the model is not confident it returns no answer instead of a guess.
 */

import { Type, type GoogleGenAI } from '@google/genai';
import type { AiSolution, DifficultyLevel, SubjectId } from '../../src/types/index.ts';
import { withRetry } from './imageReader.ts';
import { formatStructuredSolution } from '../../src/utils/solutionFormat.ts';

export interface SolveInput {
  question: string;
  options: { key: string; text: string }[];
  subject?: string;
  topic?: string;
  /** "REE" or "RME": the board examination the question is from. */
  program?: string;
  /**
   * The answer the administrator has confirmed. The solution is written toward it; if the
   * working clearly reaches another choice, the AI says so instead of forcing it.
   */
  fixedAnswer?: string;
}

const SUBJECTS: SubjectId[] = ['math', 'esas', 'ee'];
const DIFFICULTIES: DifficultyLevel[] = ['Easy', 'Average', 'Difficult'];

export async function solveWithAi(ai: GoogleGenAI, model: string, input: SolveInput, timeoutMs = 60_000): Promise<AiSolution> {
  const fixed = input.fixedAnswer && input.options.some((o) => o.key === input.fixedAnswer) ? input.fixedAnswer : '';
  const prompt = `Solve this multiple-choice ${input.program === 'RME' ? 'Registered Master Electrician (RME)' : 'Registered Electrical Engineer (REE)'} board examination question.

The question and choices below are quoted exactly from the source document. Treat them as read-only: do not restate, correct or rewrite them, and do not invent choices.

QUESTION:
${input.question}

CHOICES:
${input.options.map((o) => `${o.key}. ${o.text}`).join('\n')}
${input.subject ? `\nSubject hint: ${input.subject}` : ''}${input.topic ? `\nTopic hint: ${input.topic}` : ''}
${fixed ? `\nThe administrator has confirmed that the correct answer is ${fixed}. Write the solution that reaches ${fixed}. If your own working clearly reaches a different choice, return that choice as answerKey and explain the difference instead of forcing ${fixed}.\n` : ''}
Work it out yourself, then check it: recompute the result independently (or by a second method), check that units are consistent, and only then match it to a choice. Use standard electrical engineering conventions (for example rms values for AC unless stated, per-phase and line quantities named explicitly for three-phase systems, power factor and lagging or leading stated). Never invent data that is not in the question: if a figure, table or value is missing, say so and leave answerKey empty.

Return JSON:
- answerKey: the letter of the correct choice, exactly one of ${input.options.map((o) => `"${o.key}"`).join(', ')}. Use "" if you cannot determine it with confidence (for example the data is insufficient, a figure is needed, or no choice matches your result).
- confidence: "high" only if you verified the result independently and exactly one choice matches; "medium" if probably right; "low" otherwise.
- givenValues: list of {label, value} taken from the question, values with their units, exactly as given.
- find: what the question asks for.
- formulasUsed: the formulas applied (empty for a purely conceptual question).
- solutionSteps: the working as ordered steps, each with substitutions and units.
- finalAnswerWithUnit: the result with its unit (or the correct statement for a conceptual question).
- explanation: the engineering principle behind the answer and why the chosen option is correct.
- verification: how you checked the result.
- subjectId: "math", "esas" or "ee" (Electrical Engineering professional subjects).
- topic: short topic name, and subtopic if clear.
- difficulty: "Easy", "Average" or "Difficult".`;

  const call = () =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            answerKey: { type: Type.STRING },
            confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
            explanation: { type: Type.STRING },
            find: { type: Type.STRING },
            solutionSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
            verification: { type: Type.STRING },
            formulasUsed: { type: Type.ARRAY, items: { type: Type.STRING } },
            givenValues: {
              type: Type.ARRAY,
              items: { type: Type.OBJECT, properties: { label: { type: Type.STRING }, value: { type: Type.STRING } } },
            },
            finalAnswerWithUnit: { type: Type.STRING },
            subjectId: { type: Type.STRING },
            topic: { type: Type.STRING },
            difficulty: { type: Type.STRING },
          },
          required: ['answerKey', 'confidence', 'explanation', 'find', 'solutionSteps', 'finalAnswerWithUnit'],
        },
      },
    });

  let timer: NodeJS.Timeout | undefined;
  const timed = () =>
    Promise.race([
      call(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('AI solving took too long')), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
  const response = await withRetry(timed, 1);
  const raw = JSON.parse(response.text || '{}');
  return normalizeSolution(raw, input, model);
}

/** Validates model output. An answer that is not one of the choices is discarded. */
export function normalizeSolution(raw: any, input: SolveInput, model: string): AiSolution {
  const keys = input.options.map((o) => o.key);
  const key = typeof raw?.answerKey === 'string' ? raw.answerKey.trim().toUpperCase() : '';
  const confidence: AiSolution['confidence'] = ['high', 'medium', 'low'].includes(raw?.confidence) ? raw.confidence : 'low';
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);
  const givenValues = Array.isArray(raw?.givenValues)
    ? raw.givenValues.filter((g: any) => typeof g?.label === 'string' && typeof g?.value === 'string').map((g: any) => ({ label: g.label, value: g.value }))
    : [];
  const formulasUsed = list(raw?.formulasUsed);
  const steps = list(raw?.solutionSteps);
  const verification = str(raw?.verification).trim();
  const explanation = str(raw?.explanation);
  const finalAnswerWithUnit = str(raw?.finalAnswerWithUnit);
  const find = str(raw?.find);
  // Older or partial replies may only have a free-text solution.
  const stepByStepSolution =
    steps.length || find || givenValues.length
      ? formatStructuredSolution({
          given: givenValues,
          find,
          formulas: formulasUsed,
          steps: verification ? [...steps, `Check: ${verification}`] : steps,
          finalAnswer: finalAnswerWithUnit,
          explanation,
        })
      : str(raw?.stepByStepSolution);
  return {
    ...(keys.includes(key) ? { suggestedAnswer: key } : {}),
    confidence: keys.includes(key) ? confidence : 'low',
    explanation,
    stepByStepSolution,
    ...(find ? { find } : {}),
    formulasUsed,
    givenValues,
    finalAnswerWithUnit,
    ...(SUBJECTS.includes(raw?.subjectId) ? { subjectId: raw.subjectId } : {}),
    ...(str(raw?.topic) ? { topic: str(raw.topic) } : {}),
    ...(DIFFICULTIES.includes(raw?.difficulty) ? { difficulty: raw.difficulty } : {}),
    model,
    generatedAt: new Date().toISOString(),
  };
}
