/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Users,
  Database,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Award,
  TrendingUp,
  FileUp,
  ShieldCheck,
  Clock,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { UserProfile, Question, PdfSource, ExamResult } from '../types/index.ts';

interface Props {
  adminUser: UserProfile;
  questions: Question[];
  pdfSources: PdfSource[];
  examResults: ExamResult[];
  onNavigate: (view: string) => void;
}

export const AdminDashboard: React.FC<Props> = ({
  adminUser,
  questions,
  pdfSources,
  examResults,
  onNavigate,
}) => {
  const totalQuestions = questions.length;
  const publishedQuestions = questions.filter((q) => q.isPublished).length;
  const awaitingVerification = questions.filter(
    (q) => q.verificationStatus === 'needs_verification' || q.verificationStatus === 'discrepancy_flagged'
  ).length;

  const totalExams = examResults.length;
  const avgScore =
    totalExams > 0
      ? Math.round(examResults.reduce((acc, curr) => acc + curr.scorePercentage, 0) / totalExams)
      : 0;

  const totalPdfs = pdfSources.length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 select-none">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-indigo-500/10 blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold uppercase tracking-wider font-mono">
              <ShieldCheck className="w-3.5 h-3.5" />
              Administrative Command Center
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Welcome, {adminUser.name}
            </h1>
            <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
              {adminUser.title || 'Dean of Board Examination Preparation'} • Philippine Licensure Oversight
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => onNavigate('pdf-importer')}
              className="px-5 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition"
            >
              <FileUp className="w-4 h-4" />
              Launch AI PDF Importer
            </button>
            <button
              onClick={() => onNavigate('question-bank')}
              className="px-4 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
            >
              Manage Question Bank
            </button>
          </div>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase">Question Bank</div>
          <div className="text-2xl font-mono font-bold text-white flex items-center gap-2">
            <Database className="w-5 h-5 text-indigo-400" />
            {totalQuestions}
          </div>
          <div className="text-[11px] text-emerald-400 font-mono">
            {publishedQuestions} Published Live
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase">Awaiting Verification</div>
          <div className="text-2xl font-mono font-bold text-amber-400 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            {awaitingVerification}
          </div>
          <div className="text-[11px] text-slate-500">
            {awaitingVerification > 0 ? 'Requires admin review' : 'All questions verified'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase">Uploaded PDF Files</div>
          <div className="text-2xl font-mono font-bold text-emerald-400 flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-400" />
            {totalPdfs}
          </div>
          <div className="text-[11px] text-slate-500">AI questionnaires ingested</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase">Exams Administered</div>
          <div className="text-2xl font-mono font-bold text-indigo-300 flex items-center gap-2">
            <Award className="w-5 h-5 text-indigo-400" />
            {totalExams}
          </div>
          <div className="text-[11px] text-emerald-400 font-mono">
            {avgScore}% Avg Reviewee Rating
          </div>
        </div>
      </div>

      {/* PDF Pipeline */}
      <div className="grid grid-cols-1 gap-6">
        {/* Uploaded PDF Status */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-400" />
                Ingested PDF Questionnaires
              </h2>
              <p className="text-xs text-slate-400">Status of uploaded questionnaires and extracted collections.</p>
            </div>
            <button
              onClick={() => onNavigate('pdf-sources')}
              className="text-xs text-indigo-400 hover:text-white flex items-center gap-1"
            >
              View All
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-3">
            {pdfSources.map((pdf) => (
              <div
                key={pdf.id}
                className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 flex items-center justify-between"
              >
                <div className="space-y-1">
                  <div className="text-xs font-bold text-white leading-tight">{pdf.filename}</div>
                  <div className="text-[11px] text-slate-400 flex items-center gap-2">
                    <span>{pdf.fileSize}</span>
                    <span>•</span>
                    <span>{pdf.pageCount > 0 ? `${pdf.pageCount} Pages` : 'Pages unknown'}</span>
                    <span>•</span>
                    <strong className="text-emerald-400">{pdf.questionsCount} Questions Extracted</strong>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Published
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2">
            <button
              onClick={() => onNavigate('pdf-importer')}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-2"
            >
              <FileUp className="w-4 h-4 text-indigo-400" />
              Upload New PDF Questionnaire
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
