/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How an examinee reads a question's answer and solution: the correct choice in full (and their
 * own when it differs), then the working as numbered steps, with notes set apart. Lines marked
 * "Review note:" are written for the administrator and are never shown here.
 */

import React from 'react';
import { CheckCircle2, Info, ListOrdered, Sigma, XCircle } from 'lucide-react';
import type { Question } from '../types/index.ts';
import { parseSolutionSections, readSolution, type ReadableSolution } from '../utils/solutionFormat.ts';
import { SolutionMath } from './SolutionMath.tsx';

interface Props {
  question: Pick<Question, 'options' | 'correctAnswer' | 'explanation' | 'stepByStepSolution' | 'givenValues' | 'formulasUsed' | 'finalAnswerWithUnit'>;
  /** The examinee's choice; when it is wrong it is shown beside the correct one. */
  userAnswer?: string;
  /** Leave out the answer box where the choices are already marked (the results review). */
  showAnswer?: boolean;
}

const choiceText = (q: Props['question'], key?: string) => q.options.find((o) => o.key === key)?.text ?? '';

const Steps: React.FC<{ solution: ReadableSolution }> = ({ solution }) => (
  <>
    {solution.paragraphs.map((p, i) => (
      <p key={`p${i}`} className="text-sm text-slate-200 leading-relaxed whitespace-pre-line">
        <SolutionMath>{p}</SolutionMath>
      </p>
    ))}
    {solution.steps.length > 0 && (
      <ol className="space-y-2">
        {solution.steps.map((step, i) => (
          <li key={`s${i}`} className="flex gap-3">
            <span className="mt-0.5 w-6 h-6 shrink-0 rounded-full bg-indigo-600/20 border border-indigo-500/40 text-indigo-200 text-[11px] font-bold flex items-center justify-center">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 text-sm text-slate-100 leading-relaxed whitespace-pre-line break-words tabular-nums"><SolutionMath>{step}</SolutionMath></span>
          </li>
        ))}
      </ol>
    )}
  </>
);

export const SolutionPanel: React.FC<Props> = ({ question: q, userAnswer, showAnswer = true }) => {
  const working = (q.stepByStepSolution || '').trim();
  const explanation = (q.explanation || '').trim();
  const main = working || explanation;
  // A separate conceptual explanation is worth showing only when it adds to the working.
  const extra = working && explanation && explanation !== working ? readSolution(explanation) : null;

  const sections = parseSolutionSections(main);
  // Older questions keep formulas separately; generated solutions also embed a Formula section.
  // Present the complete list once, inside the solution and before any substitutions.
  const formulaBodies = [...(q.formulasUsed ?? []), ...sections.filter((s) => s.heading === 'Formula').map((s) => s.body)];
  const formulas = [...new Map(formulaBodies.flatMap((body) => {
    const readable = readSolution(body);
    return [...readable.paragraphs, ...readable.steps];
  }).map((formula) => [formula.trim().replace(/\s+/g, ' '), formula.trim()])).values()];
  const structured = sections.some((s) => s.heading);
  const plain = structured ? null : readSolution(main);
  const notes = [...(plain?.notes ?? []), ...(extra?.notes ?? []), ...sections.flatMap((s) => (s.heading ? readSolution(s.body).notes : []))];
  const wrong = Boolean(userAnswer && q.correctAnswer && userAnswer !== q.correctAnswer);

  return (
    <div className="space-y-4">
      {showAnswer && q.correctAnswer && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="p-3 rounded-xl border border-emerald-700/60 bg-emerald-950/40">
            <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 flex items-center gap-1.5 mb-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Correct answer
            </div>
            <div className="flex items-start gap-2.5">
              <span className="w-7 h-7 shrink-0 rounded-lg bg-emerald-600 text-white font-bold text-sm flex items-center justify-center">{q.correctAnswer}</span>
              <span className="text-sm text-emerald-50 font-semibold leading-snug pt-1">{choiceText(q, q.correctAnswer)}</span>
            </div>
          </div>
          {wrong && (
            <div className="p-3 rounded-xl border border-rose-800/60 bg-rose-950/30">
              <div className="text-[10px] uppercase tracking-wider font-bold text-rose-400 flex items-center gap-1.5 mb-1.5">
                <XCircle className="w-3.5 h-3.5" /> Your answer
              </div>
              <div className="flex items-start gap-2.5">
                <span className="w-7 h-7 shrink-0 rounded-lg bg-rose-700 text-white font-bold text-sm flex items-center justify-center">{userAnswer}</span>
                <span className="text-sm text-rose-100 leading-snug pt-1 line-through decoration-rose-400/60">{choiceText(q, userAnswer)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {(q.givenValues?.length ?? 0) > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(q.givenValues?.length ?? 0) > 0 && (
            <div className="p-3 rounded-xl border border-slate-800 bg-slate-900/70">
              <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">Given</div>
              <ul className="space-y-1 text-sm text-slate-200">
                {q.givenValues!.map((g, i) => (
                  <li key={i}>
                    <SolutionMath>{`${g.label} = ${g.value}`}</SolutionMath>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {(main || formulas.length > 0) && (
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/70 space-y-3">
          <div className="text-[10px] uppercase tracking-wider font-bold text-indigo-300 flex items-center gap-1.5">
            <ListOrdered className="w-3.5 h-3.5" /> Solution
          </div>
          {formulas.length > 0 && (
            <section className="p-3 rounded-lg border border-indigo-900/60 bg-indigo-950/20 space-y-2">
              <div className="text-xs font-bold text-indigo-200 flex items-center gap-1.5">
                <Sigma className="w-3.5 h-3.5" /> Formulas used
              </div>
              <ul className="space-y-2 text-sm text-emerald-200">
                {formulas.map((formula, i) => <li key={i}><SolutionMath>{formula}</SolutionMath></li>)}
              </ul>
            </section>
          )}
          {structured
            ? sections.map((s, i) => {
                if (s.heading === 'Formula') return null;
                const body = readSolution(s.body);
                if (!body.paragraphs.length && !body.steps.length) return null;
                const isFinal = s.heading === 'Final Answer';
                return (
                  <div key={i} className={isFinal ? 'p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/50' : 'space-y-2'}>
                    {s.heading && (
                      <div className={`text-xs font-bold ${isFinal ? 'text-emerald-300 mb-1' : 'text-slate-300'}`}>{s.heading}</div>
                    )}
                    <Steps solution={body} />
                  </div>
                );
              })
            : plain && <Steps solution={plain} />}
          {q.finalAnswerWithUnit && !structured && (
            <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-sm text-emerald-100">
              <span className="font-bold text-emerald-300">Final answer: </span>
              <SolutionMath>{q.finalAnswerWithUnit}</SolutionMath>
            </div>
          )}
        </div>
      )}

      {extra && (extra.paragraphs.length > 0 || extra.steps.length > 0) && (
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/70 space-y-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Why</div>
          <Steps solution={extra} />
        </div>
      )}

      {notes.length > 0 && (
        <div className="p-3 rounded-xl border border-sky-900/60 bg-sky-950/30 text-sm text-sky-100 space-y-1">
          {notes.map((n, i) => (
            <p key={i} className="flex gap-2 leading-relaxed">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-sky-400" />
              <span className="min-w-0"><SolutionMath>{n}</SolutionMath></span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
};
