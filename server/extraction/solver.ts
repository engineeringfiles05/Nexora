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

export interface SolveInput {
  question: string;
  options: { key: string; text: string }[];
  subject?: string;
  topic?: string;
}

const SUBJECTS: SubjectId[] = ['math', 'esas', 'ee'];
const DIFFICULTIES: DifficultyLevel[] = ['Easy', 'Average', 'Difficult'];

export async function solveWithAi(ai: GoogleGenAI, model: string, input: SolveInput, timeoutMs = 60_000): Promise<AiSolution> {
  const prompt = `Solve this multiple-choice engineering board examination question.

The question and choices below are quoted exactly from the source document. Treat them as read-only: do not restate, correct or rewrite them, and do not invent choices.

QUESTION:
${input.question}

CHOICES:
${input.options.map((o) => `${o.key}. ${o.text}`).join('\n')}
${input.subject ? `\nSubject hint: ${input.subject}` : ''}${input.topic ? `\nTopic hint: ${input.topic}` : ''}

Return JSON:
- answerKey: the letter of the correct choice, exactly one of ${input.options.map((o) => `"${o.key}"`).join(', ')}. Use "" if you cannot determine it with confidence (for example the data is insufficient, a figure is needed, or no choice matches your result).
- confidence: "high" only if you verified the result and exactly one choice matches; "medium" if probably right; "low" otherwise.
- explanation: the concept behind the answer, in clear language.
- stepByStepSolution: the working, with formulas, substitutions and units.
- formulasUsed: list of formulas.
- givenValues: list of {label, value} taken from the question.
- finalAnswerWithUnit: the computed value with its unit.
- subjectId: "math", "esas" or "ee" (Electrical Engineering professional subjects).
- topic: short topic name.
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
            stepByStepSolution: { type: Type.STRING },
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
          required: ['answerKey', 'confidence', 'explanation', 'stepByStepSolution'],
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
  return {
    ...(keys.includes(key) ? { suggestedAnswer: key } : {}),
    confidence: keys.includes(key) ? confidence : 'low',
    explanation: str(raw?.explanation),
    stepByStepSolution: str(raw?.stepByStepSolution),
    formulasUsed: Array.isArray(raw?.formulasUsed) ? raw.formulasUsed.filter((f: unknown) => typeof f === 'string') : [],
    givenValues: Array.isArray(raw?.givenValues)
      ? raw.givenValues.filter((g: any) => typeof g?.label === 'string' && typeof g?.value === 'string').map((g: any) => ({ label: g.label, value: g.value }))
      : [],
    finalAnswerWithUnit: str(raw?.finalAnswerWithUnit),
    ...(SUBJECTS.includes(raw?.subjectId) ? { subjectId: raw.subjectId } : {}),
    ...(str(raw?.topic) ? { topic: str(raw.topic) } : {}),
    ...(DIFFICULTIES.includes(raw?.difficulty) ? { difficulty: raw.difficulty } : {}),
    model,
    generatedAt: new Date().toISOString(),
  };
}
