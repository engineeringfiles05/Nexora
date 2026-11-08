/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Award,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Layers,
  ArrowRight,
  RotateCcw,
  BookOpen,
  Filter,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Share2,
  Sparkles,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { ExamResult, Question } from '../types/index.ts';

interface Props {
  result: ExamResult;
  questions: Question[];
  onRetake: () => void;
  onBackToDashboard: () => void;
}

export const ExamResultView: React.FC<Props> = ({
  result,
  questions,
  onRetake,
  onBackToDashboard,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'incorrect' | 'flagged'>('all');
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  // The Incorrect filter opens every solution, so it tracks which ones were closed instead.
  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);

  // Trigger celebration confetti on pass!
  useEffect(() => {
    if (result.isPassed) {
      try {
        confetti({
          particleCount: 120,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#10B981', '#6366F1', '#38BDF8', '#F59E0B'],
        });
      } catch {
        // ignore
      }
    }
  }, [result.isPassed]);

  // Questions filtering
  const questionsMap = new Map(questions.map((q) => [q.id, q]));
  const displayedQuestions = questions.filter((q) => {
    const userAnswer = result.userAnswers[q.id];
    const isCorrect = userAnswer === q.correctAnswer;
    const isFlagged = result.flaggedQuestionIds.includes(q.id);

    if (filterMode === 'incorrect') return !isCorrect;
    if (filterMode === 'flagged') return isFlagged;
    return true;
  });

  const minutesConsumed = Math.floor(result.durationSeconds / 60);
  const secondsConsumed = result.durationSeconds % 60;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 select-none">
      {/* Top Banner / Verdict Card */}
      <div
        className={`rounded-3xl p-6 sm:p-10 border shadow-2xl relative overflow-hidden ${
          result.isPassed
            ? 'bg-gradient-to-br from-emerald-950 via-slate-900 to-indigo-950 border-emerald-500/40'
            : 'bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/40 border-amber-500/30'
        }`}
      >
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider font-mono bg-slate-800/80 border border-slate-700">
              <Award className="w-3.5 h-3.5 text-emerald-400" />
              Official Examination Rating
            </div>

            <div className="flex items-center gap-4">
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                {result.isPassed ? 'BOARD EXAMINATION PASSED' : 'CONDITIONAL / RETAKE'}
              </h1>
              <span
                className={`px-3 py-1 rounded-xl text-xs font-bold uppercase tracking-wider font-mono ${
                  result.isPassed
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-lg shadow-emerald-500/10'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                }`}
              >
                {result.isPassed ? '✓ Licensure Met' : 'Needs Reinforcement'}
              </span>
            </div>

            <p className="text-sm text-slate-300 max-w-xl leading-relaxed">
              {result.isPassed
                ? 'Congratulations, Engineer! You have achieved the qualifying threshold for the PRC Licensure Board Examination (≥70% overall and ≥50% per subject).'
                : 'Keep practicing. Professional board readiness requires achieving at least 70% overall and at least 50% in all individual subject categories.'}
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2 text-xs text-slate-400">
              <span>Exam: <strong className="text-white">{result.title}</strong></span>
              <span>•</span>
              <span>Candidate: <strong className="text-white">{result.userName}</strong></span>
              <span>•</span>
              <span>Completed: <strong className="text-white">{new Date(result.completedAt).toLocaleDateString()}</strong></span>
            </div>
          </div>

          {/* Big Score Dial */}
          <div className="flex flex-col items-center justify-center p-6 bg-slate-950/80 rounded-2xl border border-slate-800 shadow-inner min-w-[200px]">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              General Board Rating
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-5xl font-mono font-black text-white">
                {result.scorePercentage}
              </span>
              <span className="text-2xl font-mono font-bold text-emerald-400">%</span>
            </div>
            <div className="mt-2 text-xs font-mono text-slate-400">
              {result.correctCount} / {result.totalQuestions} Questions Correct
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase">Correct Answers</div>
          <div className="text-2xl font-mono font-bold text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            {result.correctCount}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            {Math.round((result.correctCount / result.totalQuestions) * 100)}% accuracy
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase">Incorrect Answers</div>
          <div className="text-2xl font-mono font-bold text-rose-400 flex items-center gap-2">
            <XCircle className="w-5 h-5 text-rose-400" />
            {result.incorrectCount}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            {Math.round((result.incorrectCount / result.totalQuestions) * 100)}% error rate
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase">Unanswered</div>
          <div className="text-2xl font-mono font-bold text-slate-300 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            {result.unansweredCount}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            {result.unansweredCount > 0 ? 'Omitted items' : 'Complete response'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase">Time Consumed</div>
          <div className="text-2xl font-mono font-bold text-indigo-400 flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-400" />
            {minutesConsumed}m {secondsConsumed}s
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Pacing: ~{result.totalQuestions > 0 ? Math.round(result.durationSeconds / result.totalQuestions) : 0}s per question
          </div>
        </div>
      </div>

      {/* Subject Performance Breakdown */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-400" />
              Subject Performance Breakdown
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Philippine Licensure Rule: Minimum 50% required in every single subject category.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.entries(result.subjectBreakdown).map(([subjKey, subjStats]) => (
            <div
              key={subjKey}
              className={`p-5 rounded-xl border space-y-3 ${
                subjStats.passed
                  ? 'border-slate-800 bg-slate-950/60'
                  : 'border-rose-900/40 bg-rose-950/10'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">{subjStats.subjectName}</span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                    subjStats.passed
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/40'
                      : 'bg-rose-950 text-rose-300 border border-rose-800/40'
                  }`}
                >
                  {subjStats.passed ? 'PASSED (≥50%)' : 'BELOW 50%'}
                </span>
              </div>

              <div className="flex items-baseline justify-between font-mono">
                <span className="text-2xl font-bold text-white">{subjStats.percentage}%</span>
                <span className="text-xs text-slate-400">
                  {subjStats.correct} / {subjStats.total} Questions
                </span>
              </div>

              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full ${
                    subjStats.percentage >= 70
                      ? 'bg-emerald-500'
                      : subjStats.percentage >= 50
                      ? 'bg-indigo-500'
                      : 'bg-rose-500'
                  }`}
                  style={{ width: `${subjStats.percentage}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Focus Areas Advice */}
        {result.weakTopics.length > 0 && (
          <div className="p-4 bg-amber-950/20 border border-amber-800/40 rounded-xl text-xs space-y-1.5 text-amber-300">
            <div className="font-bold flex items-center gap-1.5 text-amber-400">
              <AlertTriangle className="w-4 h-4" />
              Recommended Priority Review Topics:
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {result.weakTopics.map((topic, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 bg-amber-900/40 text-amber-200 rounded-lg text-xs font-medium border border-amber-800/50"
                >
                  {topic}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Comprehensive Question-by-Question Solution Review */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
        {/* Header & Filter Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-emerald-400" />
              Detailed Solutions & Answer Key Review
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Inspect step-by-step mathematical proofs, governing equations, and given parameters for every problem.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800 text-xs">
              <button
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1 rounded-lg font-medium transition ${
                  filterMode === 'all'
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All ({questions.length})
              </button>
              <button
                onClick={() => {
                  setFilterMode('incorrect');
                  setCollapsedIds([]);
                }}
                className={`px-3 py-1 rounded-lg font-medium transition ${
                  filterMode === 'incorrect'
                    ? 'bg-rose-950 text-rose-300 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Incorrect ({result.incorrectCount})
              </button>
              <button
                onClick={() => setFilterMode('flagged')}
                className={`px-3 py-1 rounded-lg font-medium transition ${
                  filterMode === 'flagged'
                    ? 'bg-amber-950 text-amber-300 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Flagged ({result.flaggedQuestionIds.length})
              </button>
            </div>
          </div>
        </div>

        {/* Question Cards */}
        <div className="space-y-4">
          {displayedQuestions.map((q, idx) => {
            const userAnswer = result.userAnswers[q.id];
            const isCorrect = userAnswer === q.correctAnswer;
            const isOmitted = userAnswer === undefined;
            const isExpanded =
              filterMode === 'incorrect' ? !collapsedIds.includes(q.id) : expandedQuestionId === q.id;

            return (
              <div
                key={q.id}
                className={`p-6 rounded-2xl border transition-all ${
                  isCorrect
                    ? 'border-slate-800 bg-slate-950/40'
                    : 'border-rose-900/40 bg-rose-950/10'
                }`}
              >
                {/* Question item header */}
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs font-bold text-slate-400">
                      Item #{idx + 1}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300">
                      {q.subjectName}
                    </span>
                    <span className="text-xs text-indigo-400 font-medium">{q.topic}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Status Badge */}
                    {isCorrect ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Correct
                      </span>
                    ) : isOmitted ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                        Omitted / Unanswered
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                        <XCircle className="w-3.5 h-3.5" />
                        Incorrect (You chose {userAnswer})
                      </span>
                    )}

                    <button
                      onClick={() => {
                        if (filterMode === 'incorrect') {
                          setCollapsedIds((prev) =>
                            isExpanded ? [...prev, q.id] : prev.filter((id) => id !== q.id)
                          );
                        } else {
                          setExpandedQuestionId(isExpanded ? null : q.id);
                        }
                      }}
                      aria-label={isExpanded ? 'Hide solution' : 'Show solution'}
                      className="text-xs text-slate-400 hover:text-white flex items-center gap-1 p-1"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Question Statement */}
                <p className="text-sm sm:text-base text-white font-medium mb-4 leading-relaxed">
                  {q.question}
                </p>

                {/* Choices breakdown */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                  {q.options.map((opt, optIdx) => {
                    const isBoardAnswer = opt.key === q.correctAnswer;
                    const isUserChoice = opt.key === userAnswer;

                    return (
                      <div
                        key={`${opt.key}-${optIdx}`}
                        className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                          isBoardAnswer
                            ? 'border-emerald-600/70 bg-emerald-950/40 text-emerald-200 font-bold'
                            : isUserChoice && !isCorrect
                            ? 'border-rose-600/70 bg-rose-950/40 text-rose-200 font-medium'
                            : 'border-slate-800 bg-slate-900/60 text-slate-400'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs ${
                              isBoardAnswer
                                ? 'bg-emerald-600 text-white'
                                : isUserChoice
                                ? 'bg-rose-600 text-white'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {opt.key}
                          </span>
                          <span>{opt.text}</span>
                        </div>

                        {isBoardAnswer && (
                          <span className="text-[10px] text-emerald-400 font-mono font-bold">
                            ✓ Official Answer
                          </span>
                        )}
                        {isUserChoice && !isCorrect && (
                          <span className="text-[10px] text-rose-400 font-mono">
                            Your Selection
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Expandable Step-by-Step Mathematical Proof */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-3">
                    {/* Given parameters & formulas */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {q.givenValues && q.givenValues.length > 0 && (
                        <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 text-xs">
                          <span className="font-semibold text-slate-400 block mb-1">
                            Given Values:
                          </span>
                          <div className="space-y-0.5">
                            {q.givenValues.map((g, gi) => (
                              <div key={gi} className="text-slate-300 font-mono text-[11px]">
                                • {g.label}: <strong className="text-white">{g.value}</strong>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {q.formulasUsed && q.formulasUsed.length > 0 && (
                        <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 text-xs">
                          <span className="font-semibold text-slate-400 block mb-1">
                            Governing Formulas:
                          </span>
                          <div className="space-y-1">
                            {q.formulasUsed.map((f, fi) => (
                              <div
                                key={fi}
                                className="font-mono text-emerald-400 text-[11px] bg-slate-950 p-1 rounded"
                              >
                                {f}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Step-by-Step Calculation */}
                    <div className="p-4 bg-slate-950 rounded-xl border border-emerald-900/40 text-xs space-y-1.5">
                      <div className="flex items-center justify-between text-emerald-400 font-bold text-xs">
                        <span className="flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5" />
                          Step-by-Step Solution:
                        </span>
                        {q.finalAnswerWithUnit && (
                          <span className="font-mono bg-emerald-950 px-2 py-0.5 rounded text-emerald-300 border border-emerald-800/40">
                            Final: {q.finalAnswerWithUnit}
                          </span>
                        )}
                      </div>
                      <p className="text-slate-300 font-mono text-xs whitespace-pre-line leading-relaxed">
                        {q.stepByStepSolution}
                      </p>
                    </div>

                    {/* Conceptual Reasoning */}
                    <div className="p-3.5 bg-slate-900/90 rounded-xl border border-slate-800 text-xs">
                      <div className="font-semibold text-indigo-400 text-xs mb-1">
                        Conceptual Explanation:
                      </div>
                      <p className="text-slate-300 leading-relaxed text-xs">
                        {q.explanation}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom Action Footer */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-4">
        <button
          onClick={onBackToDashboard}
          className="px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition"
        >
          Return to Dashboard
        </button>

        <div className="flex items-center gap-3">
          <button
            onClick={onRetake}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition"
          >
            <RotateCcw className="w-4 h-4" />
            Retake Examination
          </button>
        </div>
      </div>
    </div>
  );
};
