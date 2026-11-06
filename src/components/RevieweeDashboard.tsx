/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Award,
  Layers,
  Clock,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  BookOpen,
  Calendar,
  Flame,
  FileText,
  RotateCcw,
} from 'lucide-react';
import { UserProfile, ExamResult, Subject, ExamType, PdfSource } from '../types/index.ts';
import { getSelectableSources } from '../utils/bank.ts';

interface Props {
  user: UserProfile;
  subjects: Subject[];
  examResults: ExamResult[];
  pdfSources: PdfSource[];
  onStartExam: (type: ExamType, subjectId?: string, pdfSourceId?: string, topic?: string) => void;
  onNavigate?: (view: string) => void;
  onViewResult: (result: ExamResult) => void;
}

export const RevieweeDashboard: React.FC<Props> = ({
  user,
  subjects,
  examResults,
  pdfSources,
  onStartExam,
  onNavigate,
  onViewResult,
}) => {
  const getSubjectForTopic = (t: string) => {
    for (const s of subjects) {
      if (s.topics.some((item) => item.toLowerCase() === t.toLowerCase())) {
        return s.id;
      }
    }
    return undefined;
  };
  const totalCompleted = examResults.length;
  const averageScore =
    totalCompleted > 0
      ? Math.round(
          examResults.reduce((acc, curr) => acc + curr.scorePercentage, 0) /
            totalCompleted
        )
      : 0;

  const passedCount = examResults.filter((r) => r.isPassed).length;
  const recentExams = [...examResults].reverse().slice(0, 5);

  // Derive weak and strong topics across all exams
  const allWeak = examResults.flatMap((r) => r.weakTopics || []);
  const allStrong = examResults.flatMap((r) => r.strongTopics || []);

  const topWeak = Array.from(new Set(allWeak)).slice(0, 3);
  const topStrong = Array.from(new Set(allStrong)).slice(0, 3);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 select-none">
      {/* Welcome Hero Card */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold uppercase tracking-wider font-mono">
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              Active Reviewee Portal • Board Candidate
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight">
              Welcome back, {user.name}
            </h1>
            <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
              Target Track: <strong className="text-white">{user.targetExam || 'Registered Electrical Engineer (REE) Licensure'}</strong>
            </p>
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 pt-1">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-indigo-400" />
                Target Exam Date: <strong className="text-white">{user.examDate || 'September 2026'}</strong>
              </span>
              <span>•</span>
              <span className="flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Pass Rate Track: <strong className="text-emerald-400">{passedCount}/{totalCompleted} Completed</strong>
              </span>
            </div>
          </div>

          {/* Readiness Meter Gauge */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center min-w-[220px] shadow-inner">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              Board Readiness Index
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-5xl font-mono font-black text-white">
                {averageScore > 0 ? averageScore : '--'}
              </span>
              <span className="text-xl font-mono font-bold text-emerald-400">%</span>
            </div>
            <span className="text-[11px] text-slate-400 mt-2 text-center">
              {averageScore >= 70 ? '✓ On Track to Pass Board' : 'Requires additional problem practice'}
            </span>
          </div>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase">Examinations Taken</div>
          <div className="text-2xl font-mono font-bold text-white flex items-center gap-2">
            <Award className="w-5 h-5 text-indigo-400" />
            {totalCompleted}
          </div>
          <div className="text-[11px] text-slate-500">Across all exam modalities</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase">Average Board Score</div>
          <div className="text-2xl font-mono font-bold text-emerald-400 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            {averageScore}%
          </div>
          <div className="text-[11px] text-slate-500">Board passing mark: 70%</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase">PDF Question Sets</div>
          <div className="text-2xl font-mono font-bold text-amber-400 flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-400" />
            {getSelectableSources(pdfSources, 'pdf_quiz').length} Available
          </div>
          <div className="text-[11px] text-slate-500">Extracted from Board PDFs</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase">Diagnostic Status</div>
          <div className="text-2xl font-mono font-bold text-indigo-300 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-400" />
            {examResults.some((r) => r.type === 'pre_test') ? 'Completed' : 'Pending'}
          </div>
          <div className="text-[11px] text-slate-500">Baseline diagnostic</div>
        </div>
      </div>

      {/* Subject Performance & Weak/Strong Topics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Subject Progress */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                Subject Performance Benchmarks
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                PRC Licensure Requirement: Minimum 50% in each subject + 70% general average.
              </p>
            </div>
          </div>

          <div className="space-y-5">
            {subjects.map((subj) => {
              // Calculate avg score for this subject
              let totalQ = 0;
              let correctQ = 0;
              for (const r of examResults) {
                if (r.subjectBreakdown[subj.id]) {
                  totalQ += r.subjectBreakdown[subj.id].total;
                  correctQ += r.subjectBreakdown[subj.id].correct;
                }
              }
              const subjScore = totalQ > 0 ? Math.round((correctQ / totalQ) * 100) : 75;

              return (
                <div key={subj.id} className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div>
                      <span className="font-bold text-white">{subj.name}</span>
                      <span className="text-slate-400 ml-2 font-mono">({subj.code})</span>
                    </div>
                    <div className="flex items-center gap-3 font-mono">
                      <span className="text-slate-400">Weight: {subj.weightPercent}%</span>
                      <strong className={`text-sm ${subjScore >= 70 ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {subjScore}%
                      </strong>
                    </div>
                  </div>

                  <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`h-2.5 rounded-full ${
                        subjScore >= 70
                          ? 'bg-emerald-500'
                          : subjScore >= 50
                          ? 'bg-indigo-500'
                          : 'bg-rose-500'
                      }`}
                      style={{ width: `${subjScore}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Priority Focus: Weak vs Strong */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              Personalized Focus Report
            </h2>

            {/* Weak Areas */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-rose-400 flex items-center gap-1.5 uppercase tracking-wide">
                <AlertTriangle className="w-3.5 h-3.5" />
                Areas Needing Attention:
              </span>
              {topWeak.length > 0 ? (
                <div className="space-y-1.5">
                  {topWeak.map((topic, i) => (
                    <div
                      key={i}
                      className="p-2.5 rounded-xl bg-rose-950/20 border border-rose-900/40 text-rose-200 text-xs font-medium flex items-center justify-between"
                    >
                      <span>{topic}</span>
                      <button
                        onClick={() => onStartExam('quiz', getSubjectForTopic(topic), undefined, topic)}
                        className="text-[10px] text-rose-400 hover:text-white underline font-semibold transition"
                      >
                        Quiz this
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 bg-slate-950 rounded-xl text-slate-500 text-xs">
                  Take more quizzes to identify focus areas.
                </div>
              )}
            </div>

            {/* Strong Areas */}
            <div className="space-y-2 pt-2">
              <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5 uppercase tracking-wide">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Strongest Disciplines:
              </span>
              {topStrong.length > 0 ? (
                <div className="space-y-1.5">
                  {topStrong.map((topic, i) => (
                    <div
                      key={i}
                      className="p-2.5 rounded-xl bg-emerald-950/20 border border-emerald-900/40 text-emerald-200 text-xs font-medium"
                    >
                      ✓ {topic}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 bg-slate-950 rounded-xl text-slate-500 text-xs">
                  Solid performance recorded in fundamentals.
                </div>
              )}
            </div>
          </div>

          <div className="pt-2 text-[11px] text-slate-400 text-center">
            Updated automatically after every examination submission.
          </div>
        </div>
      </div>

      {/* Examination Modules Launch Hub */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Award className="w-5 h-5 text-indigo-400" />
            Official Examination Modules
          </h2>
          <p className="text-xs text-slate-400">
            Select an examination module designed to prepare you for the professional board examination.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* 1. Pre-Test */}
          <div className="bg-slate-900 border border-slate-800 hover:border-emerald-500/60 rounded-2xl p-6 flex flex-col justify-between space-y-4 shadow-lg transition group">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold text-sm">
                01
              </div>
              <h3 className="text-base font-bold text-white group-hover:text-emerald-400 transition">
                Pre-Test Assessment
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Determine your baseline knowledge and board readiness before diving into intense review sessions. Save diagnostic comparisons.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
              <span className="text-[11px] text-slate-400 font-mono">12 Questions • 30 mins</span>
              <button
                onClick={() => onStartExam('pre_test')}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 transition"
              >
                Launch Pre-Test
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 2. Subject-Based Quizzes */}
          <div className="bg-slate-900 border border-slate-800 hover:border-indigo-500/60 rounded-2xl p-6 flex flex-col justify-between space-y-4 shadow-lg transition group">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-sm">
                02
              </div>
              <h3 className="text-base font-bold text-white group-hover:text-indigo-400 transition">
                Subject-Based Quizzes
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Master individual subjects (Math, ESAS, Electrical Engineering) with topic selection, difficulty filters, and instant feedback.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
              <span className="text-[11px] text-slate-400 font-mono">Customizable • Instant Mode</span>
              <button
                onClick={() => onStartExam('quiz')}
                className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1 transition"
              >
                Configure Quiz
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 3. Practice Examination */}
          <div className="bg-slate-900 border border-slate-800 hover:border-blue-500/60 rounded-2xl p-6 flex flex-col justify-between space-y-4 shadow-lg transition group">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center font-bold text-sm">
                03
              </div>
              <h3 className="text-base font-bold text-white group-hover:text-blue-400 transition">
                Practice Examination
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Continuous exam conditioning in a realistic board environment with question palette, flagging for review, and countdown pacing.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
              <span className="text-[11px] text-slate-400 font-mono">20 Questions • 45 mins</span>
              <button
                onClick={() => onStartExam('practice')}
                className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1 transition"
              >
                Start Practice
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 4. Pre-Board Examination */}
          <div className="bg-slate-900 border border-slate-800 hover:border-purple-500/60 rounded-2xl p-6 flex flex-col justify-between space-y-4 shadow-lg transition group">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center font-bold text-sm">
                04
              </div>
              <h3 className="text-base font-bold text-white group-hover:text-purple-400 transition">
                Pre-Board Examination
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Comprehensive licensure simulation with standard PRC subject distribution: Math (25%), ESAS (30%), and Electrical Engineering (45%).
              </p>
            </div>
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
              <span className="text-[11px] text-slate-400 font-mono">All Subjects • Weighted</span>
              <button
                onClick={() => onStartExam('pre_board')}
                className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1 transition"
              >
                Take Pre-Board
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 5. Final Mock Board Examination */}
          <div className="bg-slate-900 border border-slate-800 hover:border-amber-500/60 rounded-2xl p-6 flex flex-col justify-between space-y-4 shadow-lg transition group">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold text-sm">
                05
              </div>
              <h3 className="text-base font-bold text-white group-hover:text-amber-400 transition">
                Final Mock Board Examination
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                The pinnacle licensure dry-run. Strict professional timing, randomized questions and answer choices, and official rating cert.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
              <span className="text-[11px] text-slate-400 font-mono">Licensure Simulation</span>
              <button
                onClick={() => onStartExam('final_mock')}
                className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1 transition"
              >
                Start Mock Board
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 6. PDF-Based Quiz Generator */}
          <div className="bg-slate-900 border border-emerald-900/50 hover:border-emerald-500/80 rounded-2xl p-6 flex flex-col justify-between space-y-4 shadow-lg transition group bg-emerald-950/10">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center font-bold text-sm">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white group-hover:text-emerald-400 transition">
                PDF Question Sets Hub
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Take focused quizzes specifically generated from uploaded official PDF questionnaires and board exam modules.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
              <span className="text-[11px] text-emerald-400 font-mono">{getSelectableSources(pdfSources, 'pdf_quiz').length} PDF sets available</span>
              <button
                onClick={() => {
                  if (onNavigate) {
                    onNavigate('pdf-quiz-generator');
                  } else {
                    onStartExam('pdf_quiz');
                  }
                }}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 transition"
              >
                Browse PDF Sets
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Examinations History */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white">Recent Examination History</h2>
            <p className="text-xs text-slate-400">Revisit past examination scores, full mathematical solutions, and answer comparisons.</p>
          </div>
        </div>

        {recentExams.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs">
            No examinations taken yet. Choose a module above to begin your board review journey!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px]">
                <tr>
                  <th className="p-3.5 rounded-l-lg">Examination</th>
                  <th className="p-3.5">Type</th>
                  <th className="p-3.5">Score</th>
                  <th className="p-3.5">Rating</th>
                  <th className="p-3.5">Date Completed</th>
                  <th className="p-3.5 rounded-r-lg text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {recentExams.map((exam) => (
                  <tr key={exam.id} className="hover:bg-slate-800/40 transition">
                    <td className="p-3.5 font-bold text-white">{exam.title}</td>
                    <td className="p-3.5 font-mono uppercase text-[11px] text-indigo-400">
                      {exam.type.replace('_', ' ')}
                    </td>
                    <td className="p-3.5 font-mono">
                      {exam.correctCount} / {exam.totalQuestions} ({exam.scorePercentage}%)
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          exam.isPassed
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/40'
                            : 'bg-amber-950 text-amber-300 border border-amber-800/40'
                        }`}
                      >
                        {exam.isPassed ? 'PASSED' : 'RETAKE'}
                      </span>
                    </td>
                    <td className="p-3.5 text-slate-400">
                      {new Date(exam.completedAt).toLocaleDateString()}
                    </td>
                    <td className="p-3.5 text-right">
                      <button
                        onClick={() => onViewResult(exam)}
                        className="px-3 py-1 rounded-lg bg-indigo-600/30 text-indigo-300 hover:bg-indigo-600 hover:text-white transition font-medium text-xs"
                      >
                        Review Solutions
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
