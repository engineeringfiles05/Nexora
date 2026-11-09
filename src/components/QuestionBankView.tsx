/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Database,
  Search,
  Filter,
  Plus,
  Trash2,
  Edit3,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  Download,
  FileText,
  ChevronDown,
  Layers,
  ArrowUpDown,
  AlertCircle,
} from 'lucide-react';
import { Question, Subject, PdfSource, SubjectId, DifficultyLevel, VerificationStatus } from '../types/index.ts';
import { isApprovedForReviewees, isReviewedForExams } from '../utils/bank.ts';

const canPublishQuestion = (q: Question) => isReviewedForExams(q) && isApprovedForReviewees(q);

interface Props {
  questions: Question[];
  subjects: Subject[];
  pdfSources: PdfSource[];
  onAddQuestion: (q: Question) => void;
  onUpdateQuestion: (q: Question) => void;
  onDeleteQuestion: (id: string) => void;
  onTogglePublish: (id: string) => void;
  onApproveQuestion?: (id: string) => void;
}

export const QuestionBankView: React.FC<Props> = ({
  questions,
  subjects,
  pdfSources,
  onAddQuestion,
  onUpdateQuestion,
  onDeleteQuestion,
  onTogglePublish,
  onApproveQuestion,
}) => {
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSubject, setFilterSubject] = useState('all');
  const [filterDifficulty, setFilterDifficulty] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPdf, setFilterPdf] = useState('all');

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addModalError, setAddModalError] = useState<string | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [editModalError, setEditModalError] = useState<string | null>(null);
  const [inspectQuestion, setInspectQuestion] = useState<Question | null>(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{ id?: string; isBulk?: boolean } | null>(null);

  // New Question form state
  const [newQuestion, setNewQuestion] = useState<Partial<Question>>({
    question: '',
    options: [
      { key: 'A', text: '' },
      { key: 'B', text: '' },
      { key: 'C', text: '' },
      { key: 'D', text: '' },
    ],
    correctAnswer: 'A',
    subjectId: 'ee',
    subjectName: 'Electrical Engineering Professional Subjects',
    topic: 'DC Circuits & Network Theorems',
    difficulty: 'Average',
    stepByStepSolution: '',
    explanation: '',
    formulasUsed: [],
    finalAnswerWithUnit: '',
    isPublished: true,
  });

  const filteredQuestions = questions.filter((q) => {
    const matchSearch =
      q.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.topic.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (q.stepByStepSolution && q.stepByStepSolution.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchSubject = filterSubject === 'all' || q.subjectId === filterSubject;
    const matchDifficulty = filterDifficulty === 'all' || q.difficulty === filterDifficulty;
    const matchStatus =
      filterStatus === 'all'
        ? true
        : filterStatus === 'published'
        ? q.isPublished
        : filterStatus === 'draft'
        ? !q.isPublished
        : q.verificationStatus === filterStatus;
    const matchPdf = filterPdf === 'all' || q.sourcePdfId === filterPdf;

    return matchSearch && matchSubject && matchDifficulty && matchStatus && matchPdf;
  });

  const handleSelectAll = () => {
    if (selectedIds.length === filteredQuestions.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredQuestions.map((q) => q.id));
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = () => {
    if (selectedIds.length > 0) {
      setDeleteConfirmTarget({ isBulk: true });
    }
  };

  const handleBulkPublish = (publish: boolean) => {
    let held = 0;
    selectedIds.forEach((id) => {
      const target = questions.find((q) => q.id === id);
      if (!target || target.isPublished === publish) return;
      if (publish && !canPublishQuestion(target)) {
        held += 1;
        return;
      }
      onTogglePublish(id);
    });
    setSelectedIds([]);
    setBulkNotice(held > 0 ? `${held} question(s) were not published because their answers or their PDF extraction still need review.` : null);
  };

  const handleConfirmDelete = () => {
    if (!deleteConfirmTarget) return;
    const ids = deleteConfirmTarget.isBulk
      ? selectedIds
      : deleteConfirmTarget.id
      ? [deleteConfirmTarget.id]
      : [];
    ids.forEach((id) => onDeleteQuestion(id));
    setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    setDeleteConfirmTarget(null);
  };

  const handleCloseEdit = () => {
    setEditingQuestion(null);
    setEditModalError(null);
  };

  const handleSaveEdit = () => {
    if (!editingQuestion) return;
    if (!editingQuestion.question.trim() || editingQuestion.options.some((o) => !o.text.trim())) {
      setEditModalError('Please fill out the question statement and all answer choices.');
      return;
    }
    onUpdateQuestion({
      ...editingQuestion,
      subjectName:
        subjects.find((s) => s.id === editingQuestion.subjectId)?.name || editingQuestion.subjectName,
      updatedAt: new Date().toISOString().split('T')[0],
    });
    handleCloseEdit();
  };

  const handleSaveNewQuestion = () => {
    if (!newQuestion.question || !newQuestion.options || newQuestion.options.some((o) => !o.text.trim())) {
      setAddModalError('Please fill out the question statement and all 4 choices (A, B, C, D).');
      return;
    }
    setAddModalError(null);

    const created: Question = {
      id: `man-q-${Date.now()}`,
      question: newQuestion.question,
      options: newQuestion.options,
      correctAnswer: newQuestion.correctAnswer || 'A',
      explanation: newQuestion.explanation || 'Verified using standard board reference standards.',
      stepByStepSolution: newQuestion.stepByStepSolution || '1. Identify given values.\n2. Apply basic principles.\n3. Verify final answer.',
      formulasUsed: newQuestion.formulasUsed || [],
      givenValues: [],
      finalAnswerWithUnit: newQuestion.finalAnswerWithUnit || '',
      subjectId: (newQuestion.subjectId as SubjectId) || 'ee',
      subjectName:
        newQuestion.subjectId === 'math'
          ? 'Mathematics'
          : newQuestion.subjectId === 'esas'
          ? 'Engineering Sciences & Allied Subjects'
          : 'Electrical Engineering Professional Subjects',
      topic: newQuestion.topic || 'General',
      difficulty: (newQuestion.difficulty as DifficultyLevel) || 'Average',
      extractionConfidence: 100,
      verificationStatus: 'verified',
      isPublished: true,
      createdAt: new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString().split('T')[0],
      sourcePdfName: 'Manual Question Creator',
    };

    onAddQuestion(created);
    setIsAddModalOpen(false);
    setNewQuestion({
      question: '',
      options: [
        { key: 'A', text: '' },
        { key: 'B', text: '' },
        { key: 'C', text: '' },
        { key: 'D', text: '' },
      ],
      correctAnswer: 'A',
      subjectId: 'ee',
      topic: 'DC Circuits & Network Theorems',
      difficulty: 'Average',
      stepByStepSolution: '',
      explanation: '',
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 select-none">
      {/* Top Header Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold uppercase tracking-wider font-mono">
            <Database className="w-3.5 h-3.5" />
            Centralized Repository
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Question Bank Management
          </h1>
          <p className="text-xs text-slate-400 max-w-xl">
            Manage, verify, edit, and organize all board examination questions. Questions published here are instantly loaded into Pre-Tests, Quizzes, Practice, and Mock Boards.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition"
          >
            <Plus className="w-4 h-4" />
            Create Manual Question
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          <div className="relative sm:col-span-2">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
            <input
              type="text"
              placeholder="Search question text, formulas, or topics..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <select
            value={filterSubject}
            onChange={(e) => setFilterSubject(e.target.value)}
            className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Subjects</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>

          <select
            value={filterDifficulty}
            onChange={(e) => setFilterDifficulty(e.target.value)}
            className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Difficulties</option>
            <option value="Easy">Easy</option>
            <option value="Average">Average</option>
            <option value="Difficult">Difficult</option>
          </select>

          <select
            value={filterPdf}
            onChange={(e) => setFilterPdf(e.target.value)}
            className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-indigo-500 truncate"
          >
            <option value="all">All PDF Sources</option>
            {pdfSources.map((p) => (
              <option key={p.id} value={p.id}>
                {p.filename}
              </option>
            ))}
          </select>
        </div>

        {bulkNotice && (
          <div role="status" className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-300 text-xs">
            {bulkNotice}
          </div>
        )}

        {/* Selected Items Bulk Toolbar */}
        {selectedIds.length > 0 && (
          <div className="p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-800/40 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-indigo-300 font-semibold font-mono">
              {selectedIds.length} questions selected
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleBulkPublish(true)}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium"
              >
                Publish Selected
              </button>
              <button
                onClick={() => handleBulkPublish(false)}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
              >
                Unpublish Selected
              </button>
              <button
                onClick={handleBulkDelete}
                className="px-3 py-1 bg-rose-900/60 hover:bg-rose-900 text-rose-200 rounded-lg text-xs font-medium"
              >
                Delete Selected
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Question Table / Grid */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={selectedIds.length === filteredQuestions.length && filteredQuestions.length > 0}
              onChange={handleSelectAll}
              className="w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700"
            />
            <span className="font-semibold text-slate-300">
              Showing {filteredQuestions.length} of {questions.length} Questions
            </span>
          </div>
          <span>Select row for bulk actions</span>
        </div>

        {filteredQuestions.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">
            No questions match the active filters or search query.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredQuestions.map((q) => {
              const isSelected = selectedIds.includes(q.id);

              return (
                <div
                  key={q.id}
                  className={`p-4 rounded-xl border transition ${
                    isSelected
                      ? 'border-indigo-500/70 bg-indigo-950/20'
                      : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelect(q.id)}
                        className="w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700"
                      />
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono font-bold text-slate-400">
                        {q.id}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800/40">
                        {q.subjectId.toUpperCase()}
                      </span>
                      <span className="text-xs text-slate-300 font-medium">
                        {q.topic}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          q.difficulty === 'Easy'
                            ? 'bg-emerald-950 text-emerald-300'
                            : q.difficulty === 'Average'
                            ? 'bg-blue-950 text-blue-300'
                            : 'bg-purple-950 text-purple-300'
                        }`}
                      >
                        {q.difficulty}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {!isReviewedForExams(q) && (
                        <>
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            {q.verificationStatus === 'discrepancy_flagged' ? 'Discrepancy with Key' : 'Needs Review'}
                          </span>
                          {onApproveQuestion && (
                            <button
                              onClick={() => onApproveQuestion(q.id)}
                              className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition"
                            >
                              Approve Answer
                            </button>
                          )}
                        </>
                      )}
                      <button
                        onClick={() => onTogglePublish(q.id)}
                        disabled={!q.isPublished && !canPublishQuestion(q)}
                        title={!q.isPublished && !canPublishQuestion(q) ? (isReviewedForExams(q) ? 'Approve this imported question in the PDF Importer before publishing.' : 'Approve the answer before publishing.') : undefined}
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold transition disabled:opacity-50 ${
                          q.isPublished
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {q.isPublished ? '✓ Published' : 'Draft'}
                      </button>

                      <button
                        onClick={() => setInspectQuestion(q)}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                        title="View Full Solution Proof"
                      >
                        <Eye className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => setEditingQuestion(q)}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                        title="Edit Question"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => setDeleteConfirmTarget({ id: q.id })}
                        className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
                        title="Delete Question"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Question snippet */}
                  <p className="text-sm text-white font-medium mb-3">
                    {q.question}
                  </p>

                  {/* Choices list */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    {q.options.map((opt, optIdx) => (
                      <div
                        key={`${opt.key}-${optIdx}`}
                        className={`p-2 rounded-lg border flex items-center gap-1.5 truncate ${
                          opt.key === q.correctAnswer
                            ? 'border-emerald-600 bg-emerald-950/40 text-emerald-300 font-bold'
                            : 'border-slate-800 bg-slate-900/60 text-slate-400'
                        }`}
                      >
                        <span className="w-4 h-4 rounded text-center text-[10px] font-bold">
                          {opt.key}.
                        </span>
                        <span className="truncate">{opt.text}</span>
                      </div>
                    ))}
                  </div>

                  {/* PDF source tag if present */}
                  {q.sourcePdfName && (
                    <div className="mt-2 text-[10px] text-slate-500 font-mono flex items-center gap-1">
                      <FileText className="w-3 h-3 text-slate-500" />
                      Source: {q.sourcePdfName}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Manual Question Creator Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl p-6 sm:p-8 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-400" />
                Add New Question to Question Bank
              </h3>
              <button
                onClick={() => {
                  setIsAddModalOpen(false);
                  setAddModalError(null);
                }}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {addModalError && (
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{addModalError}</span>
              </div>
            )}

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Question Statement:</label>
                <textarea
                  rows={3}
                  value={newQuestion.question}
                  onChange={(e) => setNewQuestion({ ...newQuestion, question: e.target.value })}
                  placeholder="Enter the complete examination question statement with given parameters..."
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </div>

              {/* Choices A, B, C, D */}
              <div className="grid grid-cols-2 gap-3">
                {newQuestion.options?.map((opt, i) => (
                  <div key={`new-opt-${i}-${opt.key}`}>
                    <label className="block text-slate-400 mb-1">Option {opt.key}:</label>
                    <input
                      type="text"
                      value={opt.text}
                      onChange={(e) => {
                        const updated = [...(newQuestion.options || [])];
                        updated[i] = { ...opt, text: e.target.value };
                        setNewQuestion({ ...newQuestion, options: updated });
                      }}
                      placeholder={`Text for choice ${opt.key}...`}
                      className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                    />
                  </div>
                ))}
              </div>

              {/* Correct Answer & Subject */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Correct Answer Choice:</label>
                  <select
                    value={newQuestion.correctAnswer}
                    onChange={(e) => setNewQuestion({ ...newQuestion, correctAnswer: e.target.value })}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  >
                    <option value="A">Choice A</option>
                    <option value="B">Choice B</option>
                    <option value="C">Choice C</option>
                    <option value="D">Choice D</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Subject:</label>
                  <select
                    value={newQuestion.subjectId}
                    onChange={(e) => setNewQuestion({ ...newQuestion, subjectId: e.target.value as SubjectId })}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  >
                    <option value="ee">Electrical Engineering</option>
                    <option value="esas">Engineering Sciences</option>
                    <option value="math">Mathematics</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Difficulty:</label>
                  <select
                    value={newQuestion.difficulty}
                    onChange={(e) => setNewQuestion({ ...newQuestion, difficulty: e.target.value as DifficultyLevel })}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  >
                    <option value="Easy">Easy</option>
                    <option value="Average">Average</option>
                    <option value="Difficult">Difficult</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Topic Name:</label>
                <input
                  type="text"
                  value={newQuestion.topic}
                  onChange={(e) => setNewQuestion({ ...newQuestion, topic: e.target.value })}
                  placeholder="e.g. DC Motors, Thermodynamics, Laplace Transforms"
                  className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </div>

              {/* Step by step derivation */}
              <div>
                <label className="block text-slate-300 font-medium mb-1">Step-by-Step Mathematical Derivation:</label>
                <textarea
                  rows={3}
                  value={newQuestion.stepByStepSolution}
                  onChange={(e) => setNewQuestion({ ...newQuestion, stepByStepSolution: e.target.value })}
                  placeholder="1. Formula used... 2. Substitution... 3. Final calculation with units"
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-lg font-mono text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => {
                  setIsAddModalOpen(false);
                  setAddModalError(null);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNewQuestion}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/30"
              >
                Add to Question Bank
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Question Modal */}
      {editingQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl p-6 sm:p-8 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-indigo-400" />
                Edit Question {editingQuestion.id}
              </h3>
              <button onClick={handleCloseEdit} className="text-slate-400 hover:text-white" aria-label="Close editor">
                ✕
              </button>
            </div>

            {editModalError && (
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{editModalError}</span>
              </div>
            )}

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Question Statement:</label>
                <textarea
                  rows={3}
                  value={editingQuestion.question}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, question: e.target.value })}
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {editingQuestion.options.map((opt, i) => (
                  <div key={`edit-bank-opt-${i}-${opt.key}`}>
                    <label className="block text-slate-400 mb-1">Option {opt.key}:</label>
                    <input
                      type="text"
                      value={opt.text}
                      onChange={(e) => {
                        const options = [...editingQuestion.options];
                        options[i] = { ...opt, text: e.target.value };
                        setEditingQuestion({ ...editingQuestion, options });
                      }}
                      className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Correct Answer Choice:</label>
                  <select
                    value={editingQuestion.correctAnswer}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, correctAnswer: e.target.value })}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  >
                    {editingQuestion.options.map((opt, optIdx) => (
                      <option key={`edit-choice-${optIdx}-${opt.key}`} value={opt.key}>
                        Choice {opt.key}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Subject:</label>
                  <select
                    value={editingQuestion.subjectId}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, subjectId: e.target.value as SubjectId })}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  >
                    <option value="ee">Electrical Engineering</option>
                    <option value="esas">Engineering Sciences</option>
                    <option value="math">Mathematics</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Difficulty:</label>
                  <select
                    value={editingQuestion.difficulty}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, difficulty: e.target.value as DifficultyLevel })}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  >
                    <option value="Easy">Easy</option>
                    <option value="Average">Average</option>
                    <option value="Difficult">Difficult</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Topic Name:</label>
                <input
                  type="text"
                  value={editingQuestion.topic}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, topic: e.target.value })}
                  className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Step-by-Step Mathematical Derivation:</label>
                <textarea
                  rows={4}
                  value={editingQuestion.stepByStepSolution}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, stepByStepSolution: e.target.value })}
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-lg font-mono text-white"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Conceptual Explanation:</label>
                <textarea
                  rows={2}
                  value={editingQuestion.explanation}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, explanation: e.target.value })}
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={handleCloseEdit}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {deleteConfirmTarget.isBulk
                    ? `Delete ${selectedIds.length} selected questions?`
                    : `Delete question ${deleteConfirmTarget.id}?`}
                </h3>
                <p className="text-xs text-slate-400">This removes it from the Question Bank and all future exams.</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
              <button
                onClick={() => setDeleteConfirmTarget(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-rose-600/30 transition"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inspect Solution Modal */}
      {inspectQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl p-6 sm:p-8 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                Question Details & Full Derivation Proof
              </h3>
              <button
                onClick={() => setInspectQuestion(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-sm text-white font-medium">
                {inspectQuestion.question}
              </div>

              <div className="space-y-1.5">
                {inspectQuestion.options.map((opt, optIdx) => (
                  <div
                    key={`insp-opt-${optIdx}-${opt.key}`}
                    className={`p-2.5 rounded-lg border flex items-center justify-between ${
                      opt.key === inspectQuestion.correctAnswer
                        ? 'border-emerald-600 bg-emerald-950/40 text-emerald-200 font-bold'
                        : 'border-slate-800 bg-slate-950 text-slate-300'
                    }`}
                  >
                    <span>
                      <strong>{opt.key}.</strong> {opt.text}
                    </span>
                    {opt.key === inspectQuestion.correctAnswer && (
                      <span className="text-[10px] text-emerald-400 font-mono">
                        Official Answer
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="p-4 bg-slate-950 rounded-xl border border-emerald-900/40 space-y-1.5">
                <span className="text-emerald-400 font-bold text-xs">Step-by-Step Mathematical Derivation:</span>
                <p className="font-mono text-slate-200 whitespace-pre-line text-xs leading-relaxed">
                  {inspectQuestion.stepByStepSolution}
                </p>
              </div>

              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-indigo-400 font-semibold text-xs block mb-1">Conceptual Explanation:</span>
                <p className="text-slate-300 text-xs leading-relaxed">
                  {inspectQuestion.explanation}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setInspectQuestion(null)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
