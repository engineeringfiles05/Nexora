/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Play,
  Clock,
  Layers,
  Sparkles,
  Award,
  Sliders,
  Check,
  FileText,
} from 'lucide-react';
import { ExamType, ExamConfig, Subject, PdfSource, DifficultyLevel, SubjectId } from '../types/index.ts';

interface Props {
  isOpen: boolean;
  initialType: ExamType;
  initialSubjectId?: string;
  initialTopic?: string;
  initialPdfSourceId?: string;
  subjects: Subject[];
  pdfSources: PdfSource[];
  onClose: () => void;
  onLaunch: (config: ExamConfig) => void;
}

export const ExamLauncherModal: React.FC<Props> = ({
  isOpen,
  initialType,
  initialSubjectId,
  initialTopic,
  initialPdfSourceId,
  subjects,
  pdfSources,
  onClose,
  onLaunch,
}) => {
  const [examType, setExamType] = useState<ExamType>(initialType);
  const [selectedSubject, setSelectedSubject] = useState<string>(initialSubjectId || 'all');
  const [selectedTopic, setSelectedTopic] = useState<string>(initialTopic || 'all');
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('mixed');
  const [selectedPdfId, setSelectedPdfId] = useState<string>(initialPdfSourceId || (pdfSources[0]?.id || ''));
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [durationMinutes, setDurationMinutes] = useState<number>(20);
  const [instantFeedback, setInstantFeedback] = useState<boolean>(false);
  const [randomizeQuestions, setRandomizeQuestions] = useState<boolean>(true);
  const [randomizeChoices, setRandomizeChoices] = useState<boolean>(true);

  // Synchronize internal state whenever modal opens or props change
  useEffect(() => {
    if (isOpen) {
      setExamType(initialType);
      setSelectedSubject(initialSubjectId || 'all');
      setSelectedTopic(initialTopic || 'all');
      setSelectedDifficulty('mixed');
      setSelectedPdfId(initialPdfSourceId || (pdfSources[0]?.id || ''));

      if (initialType === 'final_mock') {
        setQuestionCount(20);
        setDurationMinutes(60);
        setInstantFeedback(false);
      } else if (initialType === 'pre_board') {
        setQuestionCount(20);
        setDurationMinutes(45);
        setInstantFeedback(false);
      } else if (initialType === 'pre_test') {
        setQuestionCount(12);
        setDurationMinutes(30);
        setInstantFeedback(false);
      } else if (initialType === 'quiz') {
        setQuestionCount(10);
        setDurationMinutes(15);
        setInstantFeedback(true);
      } else {
        setQuestionCount(15);
        setDurationMinutes(30);
        setInstantFeedback(false);
      }
    }
  }, [isOpen, initialType, initialSubjectId, initialTopic, initialPdfSourceId, pdfSources]);

  if (!isOpen) return null;

  const currentSubjectObj = subjects.find((s) => s.id === selectedSubject);
  const availableTopics = currentSubjectObj ? currentSubjectObj.topics : [];

  const handleStart = () => {
    let title = 'Board Examination';
    let description = '';

    if (examType === 'pre_test') {
      title = 'Diagnostic Pre-Test Assessment';
      description = 'Evaluates baseline engineering preparedness across all subjects.';
    } else if (examType === 'quiz') {
      title = `${currentSubjectObj ? currentSubjectObj.name : 'Engineering'} Subject Quiz`;
      description = selectedTopic !== 'all' ? `Focused on ${selectedTopic}` : 'Comprehensive topic coverage';
    } else if (examType === 'practice') {
      title = 'Standard Board Practice Examination';
      description = 'Realistic board examination timing and pacing practice.';
    } else if (examType === 'pre_board') {
      title = 'Pre-Board Licensure Simulation Examination';
      description = 'Balanced subject distribution matching PRC standards.';
    } else if (examType === 'final_mock') {
      title = 'Final Mock Board Examination - Set Alpha';
      description = 'High-stakes licensure simulation with strict time control.';
    } else if (examType === 'pdf_quiz') {
      const pdf = pdfSources.find((p) => p.id === selectedPdfId);
      title = `PDF Questionnaire: ${pdf ? pdf.filename : 'Custom Set'}`;
      description = 'Questions sourced directly from uploaded PDF questionnaire.';
    }

    const config: ExamConfig = {
      type: examType,
      title,
      description,
      subjectId: selectedSubject === 'all' ? undefined : (selectedSubject as SubjectId),
      topic: selectedTopic === 'all' ? undefined : selectedTopic,
      pdfSourceId: examType === 'pdf_quiz' ? selectedPdfId : undefined,
      difficulty: selectedDifficulty === 'mixed' ? 'mixed' : (selectedDifficulty as DifficultyLevel),
      questionCount,
      durationMinutes,
      passingPercentage: 70,
      randomizeQuestions,
      randomizeChoices,
      instantFeedback,
    };

    onLaunch(config);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl p-6 sm:p-8 space-y-6 my-8 animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-emerald-600 flex items-center justify-center text-white">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Configure Examination</h2>
              <p className="text-xs text-slate-400">Personalize questions, topics, duration, and test mode.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Exam Type Selector */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
            Examination Mode:
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { id: 'pre_test', label: '1. Pre-Test' },
              { id: 'quiz', label: '2. Subject Quiz' },
              { id: 'practice', label: '3. Practice' },
              { id: 'pre_board', label: '4. Pre-Board' },
              { id: 'final_mock', label: '5. Mock Board' },
              { id: 'pdf_quiz', label: '6. PDF Set' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setExamType(m.id as ExamType);
                  if (m.id === 'quiz') setInstantFeedback(true);
                  if (m.id === 'final_mock') {
                    setQuestionCount(20);
                    setDurationMinutes(45);
                    setInstantFeedback(false);
                  }
                }}
                className={`p-2.5 rounded-xl border text-xs font-semibold text-left transition ${
                  examType === m.id
                    ? 'border-indigo-500 bg-indigo-950/50 text-white shadow-sm'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* PDF Selection (if pdf_quiz) */}
        {examType === 'pdf_quiz' && (
          <div className="space-y-2 p-3.5 bg-emerald-950/20 border border-emerald-900/40 rounded-xl">
            <label className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 uppercase">
              <FileText className="w-4 h-4" />
              Select Uploaded PDF Questionnaire Source:
            </label>
            <select
              value={selectedPdfId}
              onChange={(e) => setSelectedPdfId(e.target.value)}
              className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
            >
              {pdfSources.map((pdf) => (
                <option key={pdf.id} value={pdf.id}>
                  {pdf.filename} ({pdf.questionsCount} questions)
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Subject & Topic (for quiz, practice, pre_test) */}
        {examType !== 'pdf_quiz' && examType !== 'final_mock' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Target Subject:</label>
              <select
                value={selectedSubject}
                onChange={(e) => {
                  setSelectedSubject(e.target.value);
                  setSelectedTopic('all');
                }}
                className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="all">All Subjects (Comprehensive)</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Specific Topic:</label>
              <select
                value={selectedTopic}
                onChange={(e) => setSelectedTopic(e.target.value)}
                disabled={selectedSubject === 'all'}
                className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white disabled:opacity-40 focus:outline-none focus:border-indigo-500"
              >
                <option value="all">All Subject Topics</option>
                {availableTopics.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Difficulty, Question Count, and Duration */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Difficulty:</label>
            <select
              value={selectedDifficulty}
              onChange={(e) => setSelectedDifficulty(e.target.value)}
              className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="mixed">Mixed (Real Board Distribution)</option>
              <option value="Easy">Easy (Recall & Basics)</option>
              <option value="Average">Average (Computations)</option>
              <option value="Difficult">Difficult (Multi-Step)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">
              Questions: <strong className="text-indigo-400">{questionCount}</strong>
            </label>
            <select
              value={questionCount}
              onChange={(e) => setQuestionCount(Number(e.target.value))}
              className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value={5}>5 Questions (Quick)</option>
              <option value={10}>10 Questions</option>
              <option value={15}>15 Questions</option>
              <option value={20}>20 Questions</option>
              <option value={30}>30 Questions (Intense)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">
              Timer: <strong className="text-emerald-400">{durationMinutes} mins</strong>
            </label>
            <select
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value={10}>10 Minutes</option>
              <option value={20}>20 Minutes</option>
              <option value={30}>30 Minutes</option>
              <option value={45}>45 Minutes</option>
              <option value={60}>60 Minutes</option>
            </select>
          </div>
        </div>

        {/* Toggles */}
        <div className="space-y-3 pt-2 border-t border-slate-800 text-xs">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={instantFeedback}
              onChange={(e) => setInstantFeedback(e.target.checked)}
              className="w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700"
            />
            <div>
              <span className="font-semibold text-white">Instant Feedback Mode</span>
              <p className="text-[11px] text-slate-400">Shows step-by-step solution immediately after picking an option.</p>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={randomizeQuestions}
              onChange={(e) => setRandomizeQuestions(e.target.checked)}
              className="w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700"
            />
            <div>
              <span className="font-semibold text-white">Shuffle Question Order</span>
              <p className="text-[11px] text-slate-400">Randomizes question presentation sequence.</p>
            </div>
          </label>
        </div>

        {/* Footer CTAs */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition"
          >
            <Play className="w-4 h-4 fill-white" />
            Launch Examination Now
          </button>
        </div>
      </div>
    </div>
  );
};
