/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Clock,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Send,
  Calculator as CalcIcon,
  BookOpen,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Sparkles,
} from 'lucide-react';
import { Question, ExamConfig, ExamType } from '../types/index.ts';
import { formatTimeRemaining } from '../utils/examEngine.ts';
import { createExamCountdown, type ExamCountdown } from '../utils/examTimer.ts';
import { ScientificCalculatorModal } from './ScientificCalculatorModal.tsx';
import { FormulaReferenceDrawer } from './FormulaReferenceDrawer.tsx';

interface Props {
  config: ExamConfig;
  questions: Question[];
  onFinishExam: (userAnswers: Record<string, string>, flaggedIds: string[], timeConsumedSeconds: number) => void;
  onExitExam: () => void;
}

export const ActiveExamView: React.FC<Props> = ({
  config,
  questions,
  onFinishExam,
  onExitExam,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [flaggedIds, setFlaggedIds] = useState<string[]>([]);
  const [timeRemaining, setTimeRemaining] = useState<number>(config.durationMinutes * 60);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [isFormulaSheetOpen, setIsFormulaSheetOpen] = useState(false);
  const [showInstantExplanation, setShowInstantExplanation] = useState(false);

  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;

  // The newest values for the one submission, whichever path triggers it.
  const latest = useRef({ userAnswers, flaggedIds, onFinishExam });
  latest.current = { userAnswers, flaggedIds, onFinishExam };

  const countdownRef = useRef<ExamCountdown | null>(null);
  if (!countdownRef.current) {
    countdownRef.current = createExamCountdown({
      durationSeconds: config.durationMinutes * 60,
      onTick: setTimeRemaining,
      onExpire: () => submitRef.current(),
    });
  }

  const submitOnce = () => {
    const countdown = countdownRef.current;
    if (!countdown?.claimFinish()) return;
    const { userAnswers: answers, flaggedIds: flags, onFinishExam: finish } = latest.current;
    finish(answers, flags, countdown.getElapsedSeconds());
  };
  const submitRef = useRef(submitOnce);
  submitRef.current = submitOnce;

  // Runs once: answering must not restart the clock. Hidden tabs catch up when shown again.
  useEffect(() => {
    const countdown = countdownRef.current;
    if (!countdown) return;
    countdown.start();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') countdown.sync();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      countdown.stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Keyboard shortcut for A, B, C, D
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if in input or textarea
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      const key = e.key.toUpperCase();
      if (['A', 'B', 'C', 'D'].includes(key) && currentQuestion) {
        const optionExists = currentQuestion.options.some((o) => o.key === key);
        if (optionExists) {
          handleSelectOption(key);
        }
      } else if (e.key === 'ArrowRight' && currentIndex < totalQuestions - 1) {
        setCurrentIndex((prev) => prev + 1);
        setShowInstantExplanation(false);
      } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setCurrentIndex((prev) => prev - 1);
        setShowInstantExplanation(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, currentQuestion, totalQuestions]);

  const handleSelectOption = (key: string) => {
    if (!currentQuestion) return;
    setUserAnswers((prev) => ({
      ...prev,
      [currentQuestion.id]: key,
    }));
    if (config.instantFeedback) {
      setShowInstantExplanation(true);
    }
  };

  const handleToggleFlag = () => {
    if (!currentQuestion) return;
    setFlaggedIds((prev) =>
      prev.includes(currentQuestion.id)
        ? prev.filter((id) => id !== currentQuestion.id)
        : [...prev, currentQuestion.id]
    );
  };

  const answeredCount = Object.keys(userAnswers).filter((k) => userAnswers[k] !== undefined).length;
  const unansweredCount = totalQuestions - answeredCount;
  const isCurrentFlagged = currentQuestion ? flaggedIds.includes(currentQuestion.id) : false;
  const currentSelected = currentQuestion ? userAnswers[currentQuestion.id] : undefined;

  const handleConfirmSubmit = () => submitOnce();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col select-none">
      {/* Top Examination Control Ribbon */}
      <header className="sticky top-0 z-30 bg-slate-900 border-b border-slate-800 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 rounded bg-indigo-500/20 text-indigo-300 font-mono text-xs font-bold border border-indigo-500/30">
              {config.type.replace('_', ' ').toUpperCase()}
            </span>
            <h1 className="text-sm sm:text-base font-bold text-white truncate max-w-xs sm:max-w-md">
              {config.title}
            </h1>
          </div>

          {/* Center Timer */}
          <div className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl border font-mono font-bold text-sm tracking-wider shadow-inner ${
                timeRemaining < 300
                  ? 'bg-rose-950/60 border-rose-700 text-rose-300 animate-pulse'
                  : 'bg-slate-950 border-slate-800 text-emerald-400'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>{formatTimeRemaining(timeRemaining)}</span>
            </div>
          </div>

          {/* Action Tools */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCalculatorOpen(true)}
              className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition flex items-center gap-1.5 text-xs font-medium"
              title="Open Scientific Calculator"
            >
              <CalcIcon className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">Calculator</span>
            </button>

            <button
              onClick={() => setIsFormulaSheetOpen(true)}
              className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition flex items-center gap-1.5 text-xs font-medium"
              title="Open Formula Reference"
            >
              <BookOpen className="w-4 h-4 text-indigo-400" />
              <span className="hidden sm:inline">Formulas</span>
            </button>

            <button
              onClick={() => setIsSubmitModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 flex items-center gap-1.5 transition ml-2"
            >
              <Send className="w-3.5 h-3.5" />
              Submit Exam
            </button>
          </div>
        </div>
      </header>

      {/* Main Examination Workspace */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 flex flex-col lg:flex-row gap-6 w-full">
        {/* Left Column: Current Question Body */}
        <main className="flex-1 flex flex-col justify-between bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl">
          {currentQuestion ? (
            <div className="space-y-6">
              {/* Question Meta Header */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-indigo-600 text-white font-bold flex items-center justify-center text-sm">
                    {currentIndex + 1}
                  </span>
                  <div>
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Question {currentIndex + 1} of {totalQuestions}
                    </span>
                    <div className="text-xs text-indigo-400 font-medium">
                      {currentQuestion.subjectName} • {currentQuestion.topic}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleToggleFlag}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                      isCurrentFlagged
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                        : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                    }`}
                  >
                    <Bookmark className={`w-3.5 h-3.5 ${isCurrentFlagged ? 'fill-amber-400 text-amber-400' : ''}`} />
                    {isCurrentFlagged ? 'Flagged for Review' : 'Flag Question'}
                  </button>
                </div>
              </div>

              {/* Question Statement */}
              <div className="space-y-4">
                <p className="text-base sm:text-lg text-white font-medium leading-relaxed font-sans">
                  {currentQuestion.question}
                </p>

                {/* Given Parameters Card if present */}
                {currentQuestion.givenValues && currentQuestion.givenValues.length > 0 && (
                  <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 text-xs">
                    <span className="font-semibold text-slate-400 block mb-1.5">Given Values:</span>
                    <div className="flex flex-wrap gap-2">
                      {currentQuestion.givenValues.map((g, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded bg-slate-800/80 text-slate-300 font-mono text-[11px] border border-slate-700"
                        >
                          {g.label}: <strong className="text-emerald-400">{g.value}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Choices Options (A, B, C, D) */}
              <div className="space-y-3 pt-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                  Select Answer Choice (Press A, B, C, or D):
                </span>
                {currentQuestion.options.map((option, optIdx) => {
                  const isSelected = currentSelected === option.key;
                  return (
                    <div
                      key={`${option.key}-${optIdx}`}
                      onClick={() => handleSelectOption(option.key)}
                      className={`p-4 rounded-xl border text-sm sm:text-base cursor-pointer transition flex items-center gap-4 ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-950/40 text-white font-medium shadow-md shadow-indigo-950/50 ring-1 ring-indigo-500'
                          : 'border-slate-800 bg-slate-950/50 text-slate-300 hover:border-slate-700 hover:bg-slate-800/60'
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm transition ${
                          isSelected
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-800 text-slate-400 group-hover:text-white'
                        }`}
                      >
                        {option.key}
                      </div>
                      <span className="flex-1 leading-normal">{option.text}</span>
                    </div>
                  );
                })}
              </div>

              {/* Instant feedback explanation (If quiz mode with instant feedback enabled) */}
              {config.instantFeedback && showInstantExplanation && currentSelected && (
                <div
                  className={`p-4 rounded-xl border text-xs space-y-2 animate-in fade-in duration-200 ${
                    currentSelected === currentQuestion.correctAnswer
                      ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-200'
                      : 'bg-rose-950/30 border-rose-800/60 text-rose-200'
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-sm">
                    {currentSelected === currentQuestion.correctAnswer ? (
                      <>
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        <span>Correct! The official board answer is {currentQuestion.correctAnswer}.</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-5 h-5 text-rose-400" />
                        <span>Incorrect. The correct board answer is {currentQuestion.correctAnswer}.</span>
                      </>
                    )}
                  </div>
                  <p className="text-slate-300 leading-relaxed font-mono whitespace-pre-line text-[11px]">
                    {currentQuestion.stepByStepSolution || currentQuestion.explanation}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-slate-400">Loading examination item...</div>
          )}

          {/* Navigation Buttons Row */}
          <div className="flex items-center justify-between border-t border-slate-800 pt-5 mt-8">
            <button
              onClick={() => {
                if (currentIndex > 0) {
                  setCurrentIndex((prev) => prev - 1);
                  setShowInstantExplanation(false);
                }
              }}
              disabled={currentIndex === 0}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 font-semibold text-xs flex items-center gap-1.5 transition"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>

            <span className="text-xs text-slate-500 font-mono">
              Use Left / Right arrow keys to navigate
            </span>

            {currentIndex < totalQuestions - 1 ? (
              <button
                onClick={() => {
                  setCurrentIndex((prev) => prev + 1);
                  setShowInstantExplanation(false);
                }}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-md shadow-indigo-600/30 transition"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => setIsSubmitModalOpen(true)}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-600/30 transition"
              >
                <Send className="w-4 h-4" />
                Finish & Submit
              </button>
            )}
          </div>
        </main>

        {/* Right Column: Question Navigator Palette */}
        <aside className="w-full lg:w-80 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-xl space-y-6">
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-3">
              Question Navigator
            </h2>

            {/* Status Legend */}
            <div className="grid grid-cols-2 gap-2 text-[11px] mb-5 p-3 bg-slate-950 rounded-xl border border-slate-800">
              <div className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-3 h-3 rounded bg-emerald-600" />
                Answered ({answeredCount})
              </div>
              <div className="flex items-center gap-1.5 text-slate-400">
                <span className="w-3 h-3 rounded bg-slate-800 border border-slate-700" />
                Unanswered ({unansweredCount})
              </div>
              <div className="flex items-center gap-1.5 text-amber-400">
                <span className="w-3 h-3 rounded bg-amber-600" />
                Flagged ({flaggedIds.length})
              </div>
              <div className="flex items-center gap-1.5 text-indigo-400">
                <span className="w-3 h-3 rounded border-2 border-indigo-400 bg-transparent" />
                Current Item
              </div>
            </div>

            {/* Number grid */}
            <div className="grid grid-cols-5 sm:grid-cols-6 lg:grid-cols-5 gap-2 max-h-96 overflow-y-auto p-1">
              {questions.map((q, idx) => {
                const isAns = userAnswers[q.id] !== undefined;
                const isFlag = flaggedIds.includes(q.id);
                const isCurr = idx === currentIndex;

                return (
                  <button
                    key={q.id}
                    onClick={() => {
                      setCurrentIndex(idx);
                      setShowInstantExplanation(false);
                    }}
                    className={`h-10 rounded-xl font-mono text-xs font-bold transition flex items-center justify-center relative ${
                      isCurr
                        ? 'ring-2 ring-indigo-400 text-white bg-indigo-900/60'
                        : isFlag
                        ? 'bg-amber-600 text-white hover:bg-amber-500'
                        : isAns
                        ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                        : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                    }`}
                  >
                    {idx + 1}
                    {isFlag && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 border border-slate-900" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick stats & Exit */}
          <div className="space-y-3 pt-4 border-t border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Completion:</span>
              <span className="font-mono text-emerald-400 font-bold">
                {Math.round((answeredCount / totalQuestions) * 100)}%
              </span>
            </div>

            <button
              onClick={() => setIsExitModalOpen(true)}
              className="w-full py-2 bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded-xl text-xs font-semibold transition"
            >
              Exit Examination
            </button>
          </div>
        </aside>
      </div>

      {/* Confirmation Submit Modal */}
      {isSubmitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <Send className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Submit Examination?</h3>
                <p className="text-xs text-slate-400">Once submitted, your answers will be automatically checked.</p>
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between text-slate-300">
                <span>Total Questions:</span>
                <strong className="text-white font-mono">{totalQuestions}</strong>
              </div>
              <div className="flex justify-between text-emerald-400">
                <span>Answered Questions:</span>
                <strong className="font-mono">{answeredCount}</strong>
              </div>
              <div className="flex justify-between text-amber-400">
                <span>Unanswered Questions:</span>
                <strong className="font-mono">{unansweredCount}</strong>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Flagged for Review:</span>
                <strong className="font-mono text-amber-300">{flaggedIds.length}</strong>
              </div>
            </div>

            {unansweredCount > 0 && (
              <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>You still have {unansweredCount} unanswered questions!</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setIsSubmitModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
              >
                Continue Answering
              </button>
              <button
                onClick={handleConfirmSubmit}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/30"
              >
                Confirm & Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Exit Modal */}
      {isExitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Exit Examination?</h3>
                <p className="text-xs text-slate-400">Your examination session will be ended and unsaved progress will be discarded.</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
              <button
                onClick={() => setIsExitModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
              >
                Continue Exam
              </button>
              <button
                onClick={() => {
                  setIsExitModalOpen(false);
                  onExitExam();
                }}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-rose-600/30 transition"
              >
                Exit to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Built-in Scientific Calculator */}
      <ScientificCalculatorModal
        isOpen={isCalculatorOpen}
        onClose={() => setIsCalculatorOpen(false)}
      />

      {/* High-Yield Formula Reference Sheet */}
      <FormulaReferenceDrawer
        isOpen={isFormulaSheetOpen}
        onClose={() => setIsFormulaSheetOpen(false)}
      />
    </div>
  );
};
