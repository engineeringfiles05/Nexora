/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  CheckCircle2,
  Edit3,
  FileSearch,
  Image as ImageIcon,
  Info,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import type { ExtractionIssue, Question } from '../../types/index.ts';
import type { DuplicateDecision, DuplicateMatch } from '../../utils/bank.ts';
import { isEditedFromSource, openIssues } from '../../utils/questionExtractor.ts';

/** Shows text exactly, with uncertain readings (⟦…⟧) and unreadable glyphs highlighted. */
export const ExactText: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const parts = text.split(/(⟦[^⟧]*⟧|[�-]+)/g);
  return (
    <span className={`whitespace-pre-wrap break-words ${className ?? ''}`}>
      {parts.map((part, i) =>
        /^⟦|^[�-]/.test(part) ? (
          <mark key={i} className="bg-rose-500/30 text-rose-100 rounded px-0.5 ring-1 ring-rose-400/60" title="Not read with certainty — compare with the PDF">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </span>
  );
};

/** Highlights where two readings of the same text differ. */
export function diffParts(a: string, b: string): { prefix: string; a: string; b: string; suffix: string } {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { prefix: a.slice(0, start), a: a.slice(start, endA), b: b.slice(start, endB), suffix: a.slice(endA) };
}

const Readings: React.FC<{ issue: ExtractionIssue; method?: Question['extractionMethod'] }> = ({ issue, method }) => {
  const a = issue.readings?.textLayer ?? '';
  const b = issue.readings?.pageImage ?? '';
  const d = diffParts(a, b);
  const context = (s: string, tail: boolean) => (s.length > 40 ? (tail ? `${s.slice(0, 40)}…` : `…${s.slice(-40)}`) : s);
  const [labelA, labelB] = method === 'ocr' ? ['1st reading', '2nd reading'] : ['Text layer', 'Page image'];
  return (
    <div className="mt-1 grid gap-1 font-mono text-[11px]">
      <div>
        <span className="text-slate-500 mr-1">{labelA}:</span>
        <span className="text-slate-300 whitespace-pre-wrap">{context(d.prefix, false)}</span>
        <mark className="bg-amber-500/30 text-amber-100 rounded px-0.5">{d.a || '∅'}</mark>
        <span className="text-slate-300 whitespace-pre-wrap">{context(d.suffix, true)}</span>
      </div>
      <div>
        <span className="text-slate-500 mr-1">{labelB}:</span>
        <span className="text-slate-300 whitespace-pre-wrap">{context(d.prefix, false)}</span>
        <mark className="bg-sky-500/30 text-sky-100 rounded px-0.5">{d.b || '∅'}</mark>
        <span className="text-slate-300 whitespace-pre-wrap">{context(b.slice(b.length - d.suffix.length), true)}</span>
      </div>
    </div>
  );
};

export const STATUS_STYLE = {
  verified: { label: 'Verified', cls: 'bg-emerald-950 text-emerald-300 border-emerald-800/60' },
  needs_review: { label: 'Needs review', cls: 'bg-amber-950 text-amber-300 border-amber-800/60' },
  incomplete: { label: 'Incomplete', cls: 'bg-rose-950 text-rose-300 border-rose-800/60' },
} as const;

interface Props {
  question: Question;
  index: number;
  total: number;
  selected: boolean;
  /** An exact or near copy already in the Question Bank. */
  duplicate?: DuplicateMatch;
  duplicateDecision?: DuplicateDecision;
  onDuplicateDecision?: (decision: DuplicateDecision) => void;
  /** Ticked for "Publish selected". */
  checked?: boolean;
  onToggleChecked?: () => void;
  aiBusy: boolean;
  aiAvailable: boolean;
  onSelect: () => void;
  onApprove: () => void;
  onUnapprove: () => void;
  onReject: () => void;
  onEdit: () => void;
  onMove: (direction: -1 | 1) => void;
  onRestore: () => void;
  onSetAnswer: (key: string) => void;
  onAskAi: () => void;
  /** Rewrites the working for the current answer, keeping the answer. */
  onRegenerateSolution?: () => void;
  onShowSolution: () => void;
}

export const QuestionReviewCard: React.FC<Props> = (props) => {
  const { question: q, selected, duplicate } = props;
  const status = q.contentStatus ?? 'needs_review';
  const issues = openIssues(q);
  const fieldIssue = (field: ExtractionIssue['field'], key?: string) =>
    issues.find((i) => i.severity !== 'info' && i.field === field && (key === undefined || i.choiceKey === key));
  const approved = q.reviewStatus === 'approved';
  const rejected = q.reviewStatus === 'rejected';
  const edited = isEditedFromSource(q);
  const pageLabel = (q.sourcePdfPages ?? [q.sourcePdfPage ?? 1]).join('–');

  return (
    <article
      onClick={props.onSelect}
      className={`p-3.5 sm:p-4 rounded-xl border transition cursor-pointer ${
        selected ? 'ring-2 ring-indigo-500 ' : ''
      }${
        rejected
          ? 'border-slate-800 bg-slate-950/40 opacity-60'
          : approved
            ? 'border-emerald-800/70 bg-emerald-950/10'
            : status === 'incomplete'
              ? 'border-rose-800/70 bg-rose-950/15'
              : status === 'needs_review'
                ? 'border-amber-800/60 bg-amber-950/10'
                : 'border-slate-800 bg-slate-900/80'
      }`}
    >
      <header className="flex flex-wrap items-center gap-1.5 mb-2 text-[10px] font-mono">
        {props.onToggleChecked && !rejected && (
          <input
            type="checkbox"
            checked={Boolean(props.checked)}
            onChange={props.onToggleChecked}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 accent-indigo-500"
            aria-label={`Select question ${q.originalQuestionNumber} for publishing`}
          />
        )}
        <span className="px-2 py-0.5 rounded bg-slate-800 text-white font-bold text-xs">#{q.originalQuestionNumber}</span>
        <span className="px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/50" title="Source page(s) in the PDF">
          p.{pageLabel}
        </span>
        <span className={`px-1.5 py-0.5 rounded border font-bold uppercase ${STATUS_STYLE[status].cls}`}>{STATUS_STYLE[status].label}</span>
        {approved && <span className="px-1.5 py-0.5 rounded border font-bold uppercase bg-emerald-600 text-white border-emerald-500">Approved</span>}
        {rejected && <span className="px-1.5 py-0.5 rounded border font-bold uppercase bg-slate-800 text-slate-300 border-slate-700">Rejected</span>}
        <span
          className={`px-1.5 py-0.5 rounded border ${
            q.extractionConfidence >= 90 ? 'border-emerald-800/60 text-emerald-300' : q.extractionConfidence >= 70 ? 'border-amber-800/60 text-amber-300' : 'border-rose-800/60 text-rose-300'
          }`}
          title="Heuristic confidence from the checks below; not a measured accuracy"
        >
          {q.extractionConfidence}%
        </span>
        <span className="px-1.5 py-0.5 rounded border border-slate-700 text-slate-400" title="How the text was obtained">
          {q.extractionMethod === 'native+ocr'
            ? q.crossCheck === 'agree'
              ? 'text layer = image ✓'
              : 'text layer ≠ image'
            : q.extractionMethod === 'ocr'
              ? q.crossCheck === 'agree'
                ? 'scan, 2 readings agree ✓'
                : 'scan reading'
              : q.extractionMethod === 'manual'
                ? 'entered by admin'
                : q.extractionMethod === 'text'
                  ? 'text file'
                  : 'text layer only'}
        </span>
        {edited && <span className="px-1.5 py-0.5 rounded border border-sky-800/60 text-sky-300">edited</span>}
        {duplicate && (
          <span
            className="px-1.5 py-0.5 rounded border border-fuchsia-800/60 text-fuchsia-300"
            title={`${duplicate.kind === 'exact' ? 'Same text and choices as' : `${Math.round(duplicate.similarity * 100)}% the same wording, same numbers as`} bank question ${duplicate.match.id}`}
          >
            {duplicate.kind === 'exact' ? 'already in bank' : 'similar to a bank question'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => props.onMove(-1)} disabled={props.index === 0} className="p-1 text-slate-400 hover:text-white disabled:opacity-30" aria-label="Move up">
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => props.onMove(1)} disabled={props.index === props.total - 1} className="p-1 text-slate-400 hover:text-white disabled:opacity-30" aria-label="Move down">
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button onClick={props.onEdit} className="p-1 text-slate-400 hover:text-indigo-300" aria-label="Edit question">
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          {edited && (
            <button onClick={props.onRestore} className="p-1 text-slate-400 hover:text-sky-300" aria-label="Restore extracted text" title="Restore the text exactly as extracted">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>

      {issues.length > 0 && (
        <ul className="mb-2.5 space-y-1">
          {issues.map((issue, i) => (
            <li
              key={`${issue.code}-${i}`}
              className={`p-2 rounded text-[11px] border flex gap-1.5 ${
                issue.severity === 'error'
                  ? 'bg-rose-950/40 border-rose-800/50 text-rose-200'
                  : issue.severity === 'warning'
                    ? 'bg-amber-950/40 border-amber-800/50 text-amber-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              {issue.severity === 'error' ? (
                <AlertOctagon className="w-3.5 h-3.5 shrink-0 mt-px" />
              ) : issue.severity === 'warning' ? (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              ) : (
                <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
              )}
              <div className="min-w-0">
                {issue.message}
                {issue.readings && <Readings issue={issue} method={q.extractionMethod} />}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className={`text-sm text-white font-medium mb-3 leading-relaxed select-text rounded ${fieldIssue('stem') ? 'ring-1 ring-amber-500/60 bg-amber-500/5 p-1' : ''}`}>
        <ExactText text={q.question || '(no question text)'} />
      </p>

      {(q.figures ?? []).length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {q.figures!.map((f) =>
            f.dataUrl ? (
              <img key={f.id} src={f.dataUrl} alt={`Figure from page ${f.page}`} className="max-h-48 max-w-full rounded border border-slate-700 bg-white" />
            ) : (
              <span key={f.id} className="text-[11px] text-slate-400 flex items-center gap-1">
                <ImageIcon className="w-3.5 h-3.5" /> Figure on page {f.page}
              </span>
            )
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-2.5">
        {q.options.map((opt) => {
          const isAnswer = opt.key === q.correctAnswer;
          const flagged = fieldIssue('choice', opt.key);
          return (
            <div
              key={opt.key}
              className={`p-2 rounded-lg border text-xs flex items-start gap-2 ${
                isAnswer ? 'border-emerald-600/70 bg-emerald-950/40 text-emerald-100' : flagged ? 'border-amber-600/70 bg-amber-950/20 text-slate-200' : 'border-slate-800 bg-slate-950/60 text-slate-300'
              }`}
            >
              <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center font-bold text-[10px] ${isAnswer ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                {opt.key}
              </span>
              <ExactText text={opt.text} className="select-text pt-0.5" />
            </div>
          );
        })}
      </div>

      <footer className="flex flex-wrap items-center gap-2 text-[11px] pt-2 border-t border-slate-800/80" onClick={(e) => e.stopPropagation()}>
        <label className="flex items-center gap-1 text-slate-400">
          Answer
          <select
            value={q.correctAnswer}
            onChange={(e) => props.onSetAnswer(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-white"
            aria-label={`Answer for question ${q.originalQuestionNumber}`}
          >
            <option value="">—</option>
            {q.options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.key}
              </option>
            ))}
          </select>
        </label>
        <span className="text-slate-500">
          {q.answerSource === 'pdf_key'
            ? 'from the PDF'
            : q.answerSource === 'ai'
              ? `AI (${q.aiSolution?.confidence ?? '?'})`
              : q.answerSource === 'admin'
                ? 'set by admin'
                : 'not set'}
          {q.verificationStatus === 'discrepancy_flagged' && <span className="text-rose-300"> · AI disagrees</span>}
        </span>
        {props.aiAvailable && (
          <button
            onClick={props.onAskAi}
            disabled={props.aiBusy || q.options.length < 2}
            className="flex items-center gap-1 text-indigo-300 hover:text-indigo-200 disabled:opacity-40 font-semibold"
          >
            <Sparkles className="w-3 h-3" /> {props.aiBusy ? 'Solving…' : q.aiSolution ? 'Regenerate answer' : 'AI answer & solution'}
          </button>
        )}
        {props.aiAvailable && props.onRegenerateSolution && q.correctAnswer && (
          <button
            onClick={props.onRegenerateSolution}
            disabled={props.aiBusy}
            title={`Keep answer ${q.correctAnswer} and write a new step-by-step solution`}
            className="flex items-center gap-1 text-indigo-300 hover:text-indigo-200 disabled:opacity-40 font-semibold"
          >
            <RotateCcw className="w-3 h-3" /> Regenerate solution
          </button>
        )}
        {(q.aiSolution || q.sourceSolutionText || q.explanation) && (
          <button onClick={props.onShowSolution} className="flex items-center gap-1 text-slate-300 hover:text-white">
            <FileSearch className="w-3 h-3" /> Solution
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {rejected ? (
            <button onClick={props.onUnapprove} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold">
              Undo reject
            </button>
          ) : approved ? (
            <button onClick={props.onUnapprove} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold">
              Undo approval
            </button>
          ) : (
            <>
              <button onClick={props.onReject} className="px-2 py-1 rounded bg-slate-800 hover:bg-rose-900 text-slate-300 hover:text-white font-semibold flex items-center gap-1">
                <Ban className="w-3 h-3" /> Reject
              </button>
              <button onClick={props.onApprove} className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Approve
              </button>
            </>
          )}
        </div>
      </footer>
      {duplicate && props.onDuplicateDecision && !rejected && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-fuchsia-900/60 bg-fuchsia-950/20 px-2.5 py-2 text-[11px] text-fuchsia-100" onClick={(e) => e.stopPropagation()}>
          <span className="flex-1 min-w-[12rem]">
            {duplicate.kind === 'exact' ? 'This question is already in the Question Bank.' : `A bank question has ${Math.round(duplicate.similarity * 100)}% of the same wording and the same numbers.`}{' '}
            <span className="text-fuchsia-300/80">“{duplicate.match.question.slice(0, 90)}{duplicate.match.question.length > 90 ? '…' : ''}”</span>
          </span>
          <label className="flex items-center gap-1.5">
            When publishing:
            <select
              value={props.duplicateDecision ?? 'skip'}
              onChange={(e) => props.onDuplicateDecision!(e.target.value as DuplicateDecision)}
              className="px-2 py-1 rounded bg-slate-950 border border-fuchsia-800/60 text-white"
            >
              <option value="skip">Skip it</option>
              <option value="replace">Replace the bank copy</option>
              <option value="keep">Keep both</option>
            </select>
          </label>
        </div>
      )}
    </article>
  );
};
