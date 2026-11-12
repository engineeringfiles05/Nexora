/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  FileText,
  Upload,
  CheckCircle2,
  Lock,
  Globe,
  Sliders,
  Layers,
  Sparkles,
  BookOpen,
  ArrowRight,
  Eye,
} from 'lucide-react';
import { PdfSource, SubjectId } from '../types/index.ts';
import { isSourceAvailableForExam } from '../utils/bank.ts';
import { contentCourse } from '../auth/accountStatus.ts';
import { COURSES } from '../auth/validation.ts';

interface Props {
  pdfSources: PdfSource[];
  onUpdateSource: (updated: PdfSource) => void;
  onNavigateToImporter: () => void;
  onNavigateToQuiz: (pdfId: string) => void;
}

export const PdfSourcesView: React.FC<Props> = ({
  pdfSources,
  onUpdateSource,
  onNavigateToImporter,
  onNavigateToQuiz,
}) => {
  const [editingSource, setEditingSource] = useState<PdfSource | null>(null);

  const handleTogglePublic = (source: PdfSource) => {
    onUpdateSource({
      ...source,
      isPublicToReviewees: !source.isPublicToReviewees,
    });
  };

  const handleSaveConfig = () => {
    if (editingSource) {
      onUpdateSource(editingSource);
      setEditingSource(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 select-none">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold uppercase tracking-wider font-mono">
            <FileText className="w-3.5 h-3.5" />
            PDF Questionnaire Bank
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Uploaded PDF Question Collections
          </h1>
          <p className="text-xs text-slate-400 max-w-xl">
            Manage uploaded PDF files, configure reviewee access permissions, and monitor question extraction coverage.
          </p>
        </div>

        <button
          onClick={onNavigateToImporter}
          className="px-5 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition"
        >
          <Upload className="w-4 h-4" />
          Upload New PDF File
        </button>
      </div>

      {/* Grid of PDF Sources */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {pdfSources.map((source) => (
          <div
            key={source.id}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-lg flex flex-col justify-between"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <h2 className="text-sm font-bold text-white leading-tight">
                    {source.filename}
                  </h2>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                    {source.notes || 'Official Board Examination Questionnaire collection.'}
                  </p>
                </div>
              </div>

              {/* Stats badges */}
              <div className="grid grid-cols-3 gap-2 p-3 bg-slate-950 rounded-xl border border-slate-800 text-center font-mono">
                <div>
                  <span className="text-[10px] text-slate-500 block uppercase">Extracted</span>
                  <strong className="text-sm text-white">{source.questionsCount} Qs</strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block uppercase">Pages</span>
                  <strong className="text-sm text-indigo-400">{source.pageCount > 0 ? `${source.pageCount} Pgs` : '—'}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block uppercase">File Size</span>
                  <strong className="text-sm text-emerald-400">{source.fileSize}</strong>
                </div>
              </div>

              {/* Subject Coverage distribution */}
              <div className="space-y-1.5 text-xs">
                <span className="text-[11px] font-semibold text-slate-400 uppercase">
                  Subject Coverage:
                </span>
                <div className="flex flex-wrap gap-2">
                  {source.subjectCoverage.map((sc, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px] border border-slate-700"
                    >
                      {sc.subjectId.toUpperCase()}: <strong className="text-white">{sc.count} questions</strong>
                    </span>
                  ))}
                </div>
              </div>

              {/* Permissions info */}
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Reviewee Access:</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      source.isPublicToReviewees
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/40'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {source.isPublicToReviewees ? '✓ Public to Reviewees' : 'Restricted (Admin Only)'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400" id={`course-${source.id}`}>Course:</span>
                  <div role="radiogroup" aria-labelledby={`course-${source.id}`} className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-700">
                    {COURSES.map((c) => {
                      const selected = contentCourse(source) === c.id;
                      return (
                        <button
                          key={c.id}
                          role="radio"
                          aria-checked={selected}
                          title={`${c.description} reviewees can use this set`}
                          onClick={() => !selected && onUpdateSource({ ...source, course: c.id })}
                          className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold transition ${selected ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="text-[11px] text-slate-400">
                  Allowed in:{' '}
                  <span className="text-white font-mono">
                    {source.allowedModes.join(', ')}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
              <button
                onClick={() => handleTogglePublic(source)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
              >
                {source.isPublicToReviewees ? 'Make Restricted' : 'Make Public'}
              </button>

              <button
                onClick={() => onNavigateToQuiz(source.id)}
                disabled={!isSourceAvailableForExam(source, 'pdf_quiz')}
                title={isSourceAvailableForExam(source, 'pdf_quiz') ? undefined : 'Make this PDF public and allow quiz mode to launch it for reviewees.'}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white text-xs font-bold shadow-md shadow-emerald-600/30 flex items-center gap-1.5 transition"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Launch Quiz on this PDF
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
