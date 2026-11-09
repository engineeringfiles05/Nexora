/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Question } from '../../types/index.ts';
import { ExactText } from './QuestionReviewCard.tsx';

const PER_PAGE = 10;

/** The questionnaire as reviewees will see it, before publishing. */
export const ExamPreview: React.FC<{ questions: Question[] }> = ({ questions }) => {
  const [onlyApproved, setOnlyApproved] = useState(true);
  const [page, setPage] = useState(0);
  const list = questions.filter((q) => q.reviewStatus !== 'rejected' && (!onlyApproved || q.reviewStatus === 'approved'));
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const current = Math.min(page, pages - 1);
  const shown = list.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-400">
          {list.length} question(s){onlyApproved ? ' approved for publishing' : ''}. Answers are hidden, as in the exam.
        </p>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={onlyApproved} onChange={(e) => { setOnlyApproved(e.target.checked); setPage(0); }} />
          Approved only
        </label>
      </div>
      {shown.length === 0 && <p className="p-8 text-center text-sm text-slate-400">Nothing to preview yet. Approve questions to see the exam that will be published.</p>}
      <ol className="space-y-4 max-w-3xl mx-auto">
        {shown.map((q, i) => (
          <li key={q.id} className="p-4 sm:p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span>
                Question {current * PER_PAGE + i + 1} of {list.length}
              </span>
              <span>{q.subjectName}</span>
            </div>
            <p className="text-sm font-semibold text-white leading-relaxed">
              <ExactText text={q.question} />
            </p>
            {(q.figures ?? []).map((f) => f.dataUrl && <img key={f.id} src={f.dataUrl} alt="" className="max-h-64 max-w-full rounded border border-slate-700 bg-white" />)}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {q.options.map((o) => (
                <div key={o.key} className="p-3 rounded-xl border border-slate-800 bg-slate-950 text-xs text-slate-200 flex gap-2.5">
                  <span className="w-6 h-6 shrink-0 rounded-lg bg-slate-800 flex items-center justify-center font-bold">{o.key}</span>
                  <ExactText text={o.text} className="pt-1" />
                </div>
              ))}
            </div>
          </li>
        ))}
      </ol>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-xs text-slate-300">
          <button onClick={() => setPage(current - 1)} disabled={current === 0} className="p-2 rounded bg-slate-800 disabled:opacity-40" aria-label="Previous">
            <ChevronLeft className="w-4 h-4" />
          </button>
          Page {current + 1} of {pages}
          <button onClick={() => setPage(current + 1)} disabled={current >= pages - 1} className="p-2 rounded bg-slate-800 disabled:opacity-40" aria-label="Next">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
