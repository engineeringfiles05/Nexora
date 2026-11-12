/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  FileText,
  Sparkles,
  Play,
  Clock,
  Layers,
  Award,
  CheckCircle2,
  Sliders,
  BookOpen,
  AlertCircle,
} from 'lucide-react';
import { PdfSource, Question, DifficultyLevel } from '../types/index.ts';
import { ALL_QUESTIONS, EXAM_DURATION_OPTIONS, getSelectableSources, isQuestionEligibleForExam } from '../utils/bank.ts';

interface Props {
  pdfSources: PdfSource[];
  questions: Question[];
  /** Returns an error message when the exam can't start. */
  onStartPdfQuiz: (pdfId: string, questionCount: number, difficulty: string, durationMinutes: number) => string | null | void;
}

export const PdfQuizGeneratorView: React.FC<Props> = ({
  pdfSources,
  questions,
  onStartPdfQuiz,
}) => {
  const publicPdfs = getSelectableSources(pdfSources, 'pdf_quiz');
  const [selectedPdfId, setSelectedPdfId] = useState<string>(publicPdfs[0]?.id || '');
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [difficulty, setDifficulty] = useState<string>('mixed');
  const [durationMinutes, setDurationMinutes] = useState<number>(20);
  const [validationError, setValidationError] = useState<string | null>(null);

  const selectedPdf = pdfSources.find((p) => p.id === selectedPdfId);
  const questionsForThisPdf = questions.filter((q) => q.sourcePdfId === selectedPdfId);

  const handleLaunch = () => {
    if (!selectedPdfId) {
      setValidationError('Please select a PDF questionnaire collection from the list.');
      return;
    }
    setValidationError(onStartPdfQuiz(selectedPdfId, questionCount, difficulty, durationMinutes) || null);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 select-none">
      {/* Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 border border-emerald-900/50 rounded-3xl p-6 sm:p-10 text-white shadow-2xl relative overflow-hidden">
        <div className="space-y-3 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold uppercase tracking-wider font-mono">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            PDF-Derived Examination Generator
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Take Quizzes from Official PDF Questionnaires
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
            Practice using questions extracted and verified directly from real board examination questionnaires uploaded by the review faculty. Every item preserves original wording, formulas, and verified step-by-step solutions.
          </p>
        </div>
      </div>

      {/* Main Generator Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Form */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xl">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Sliders className="w-5 h-5 text-indigo-400" />
            Configure Your PDF Question Set Exam
          </h2>

          {/* 1. Select PDF Source */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wide">
              1. Select Uploaded PDF Questionnaire:
            </label>
            <div className="space-y-3">
              {publicPdfs.map((pdf) => {
                const isSelected = pdf.id === selectedPdfId;
                const count = questions.filter(
                  (q) => q.sourcePdfId === pdf.id && isQuestionEligibleForExam(q, 'pdf_quiz', pdfSources)
                ).length;

                return (
                  <div
                    key={pdf.id}
                    onClick={() => setSelectedPdfId(pdf.id)}
                    className={`p-4 rounded-2xl border cursor-pointer transition flex items-center justify-between gap-4 ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-950/30 text-white shadow-md'
                        : 'border-slate-800 bg-slate-950/50 text-slate-300 hover:border-slate-700 hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                          isSelected
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        <FileText className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-sm font-bold leading-tight">{pdf.filename}</div>
                        <div className="text-xs text-slate-400 mt-1">
                          {pdf.pageCount > 0 ? `${pdf.pageCount} Pages • ` : ''}{count} Questions Ready
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-mono font-bold ${
                          isSelected
                            ? 'bg-emerald-500 text-white'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {isSelected ? '✓ Selected' : 'Choose'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. Questions & Difficulty */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-800">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Question Count:</label>
              <select
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
                className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value={5}>5 Questions</option>
                <option value={10}>10 Questions</option>
                <option value={15}>15 Questions</option>
                <option value={20}>20 Questions</option>
                <option value={30}>30 Questions</option>
                <option value={ALL_QUESTIONS}>All Available</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Difficulty Level:</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="mixed">Mixed Difficulties</option>
                <option value="Easy">Easy Only</option>
                <option value="Average">Average Only</option>
                <option value="Difficult">Difficult Only</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Timer Duration:</label>
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                {EXAM_DURATION_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} Minutes` : `${m} Minutes (${m / 60} hr${m > 60 ? 's' : ''})`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Validation Error */}
          {validationError && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Launch Button */}
          <div className="pt-4 border-t border-slate-800 flex justify-end">
            <button
              onClick={handleLaunch}
              className="px-8 py-3.5 bg-gradient-to-r from-emerald-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white font-bold rounded-2xl text-sm shadow-xl shadow-emerald-600/30 flex items-center gap-2 transition"
            >
              <Play className="w-4 h-4 fill-white" />
              Begin PDF Examination
            </button>
          </div>
        </div>

        {/* Right 1 Col: Selected PDF Details */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 flex flex-col justify-between shadow-xl">
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-emerald-400" />
              Source Document Verification
            </h3>

            {selectedPdf ? (
              <div className="space-y-4 text-xs">
                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                  <div className="font-bold text-white leading-tight">{selectedPdf.filename}</div>
                  <div className="text-[11px] text-slate-400">
                    Uploaded: {new Date(selectedPdf.uploadDate).toLocaleDateString()}
                  </div>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    {selectedPdf.notes || 'Board examination review questionnaire.'}
                  </p>
                </div>

                <div className="space-y-2">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase">
                    Coverage Breakdown:
                  </span>
                  <div className="space-y-1.5">
                    {selectedPdf.subjectCoverage.map((sc, i) => (
                      <div
                        key={i}
                        className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex justify-between font-mono"
                      >
                        <span className="text-slate-300">{sc.subjectId.toUpperCase()}</span>
                        <strong className="text-emerald-400">{sc.count} Questions</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-slate-500 text-xs text-center py-6">
                No PDF selected.
              </div>
            )}
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-800/40 text-[11px] text-emerald-300">
            ✓ Connected to official PRC board questionnaire repository.
          </div>
        </div>
      </div>
    </div>
  );
};
