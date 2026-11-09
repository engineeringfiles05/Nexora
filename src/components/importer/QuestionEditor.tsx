/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Edit3, ImagePlus, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { DifficultyLevel, ExtractedFigure, Question, SubjectId } from '../../types/index.ts';
import { SUBJECT_NAMES } from '../../utils/questionExtractor.ts';

interface Props {
  question: Question;
  title?: string;
  onCancel: () => void;
  onSave: (q: Question) => void;
}

const MAX_IMAGE_BYTES = 600_000;

/**
 * Admin correction of a staged question. The text as extracted stays stored in
 * originalQuestionText / originalOptions and is shown here for reference.
 */
export const QuestionEditor: React.FC<Props> = ({ question, title, onCancel, onSave }) => {
  const [draft, setDraft] = useState<Question>(question);
  const [imageError, setImageError] = useState<string | null>(null);

  const setOption = (i: number, text: string) => setDraft((d) => ({ ...d, options: d.options.map((o, j) => (j === i ? { ...o, text } : o)) }));
  const addOption = () =>
    setDraft((d) => {
      const nextKey = String.fromCharCode(65 + d.options.length);
      return d.options.length >= 8 ? d : { ...d, options: [...d.options, { key: nextKey, text: '' }] };
    });
  const removeOption = (i: number) =>
    setDraft((d) => {
      const options = d.options.filter((_, j) => j !== i).map((o, j) => ({ ...o, key: String.fromCharCode(65 + j) }));
      const removedKey = d.options[i].key;
      const correctAnswer = d.correctAnswer === removedKey ? '' : d.correctAnswer;
      return { ...d, options, correctAnswer };
    });

  const attachImage = (file: File | undefined) => {
    setImageError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setImageError('Choose an image file (PNG or JPG).');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError('Images must be under 600 KB so the question can be saved. Crop or compress it first.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const figure: ExtractedFigure = {
        id: `admin-fig-${Date.now().toString(36)}`,
        page: draft.sourcePdfPage ?? 1,
        region: { page: draft.sourcePdfPage ?? 1, x0: 0, y0: 0, x1: 1, y1: 1 },
        kind: 'attachment',
        dataUrl: String(reader.result),
        attachedBy: 'admin',
      };
      setDraft((d) => ({
        ...d,
        hasDiagram: true,
        figures: [...(d.figures ?? []), figure],
        extractionIssues: (d.extractionIssues ?? []).filter((issue) => issue.code !== 'FIGURE_NOT_CAPTURED'),
      }));
    };
    reader.readAsDataURL(file);
  };

  const original = question.originalQuestionText;
  const originalOptions = question.originalOptions ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-4 sm:p-6 space-y-4 my-4 text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Edit3 className="w-4 h-4 text-indigo-400" />
            {title ?? `Edit question #${question.originalQuestionNumber}`}
          </h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-white" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-slate-400">
          Correct only what differs from the PDF. Text marked ⟦ ⟧ was not read with certainty: replace it, including the brackets, with what the PDF shows.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="block">
            <span className="block text-slate-400 mb-1">Number in PDF</span>
            <input
              type="number"
              min={1}
              value={draft.originalQuestionNumber ?? ''}
              onChange={(e) => setDraft({ ...draft, originalQuestionNumber: parseInt(e.target.value, 10) || undefined })}
              className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
            />
          </label>
          <label className="block">
            <span className="block text-slate-400 mb-1">Page in PDF</span>
            <input
              type="number"
              min={1}
              value={draft.sourcePdfPage ?? 1}
              onChange={(e) => {
                const page = parseInt(e.target.value, 10) || 1;
                setDraft({ ...draft, sourcePdfPage: page, sourcePdfPages: [page, ...(draft.sourcePdfPages ?? []).filter((p) => p > page)] });
              }}
              className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
            />
          </label>
          <label className="block">
            <span className="block text-slate-400 mb-1">Subject</span>
            <select
              value={draft.subjectId}
              onChange={(e) => {
                const subjectId = e.target.value as SubjectId;
                setDraft({ ...draft, subjectId, subjectName: SUBJECT_NAMES[subjectId] });
              }}
              className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
            >
              <option value="math">MATH</option>
              <option value="esas">ESAS</option>
              <option value="ee">EE</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-slate-400 mb-1">Difficulty</span>
            <select
              value={draft.difficulty}
              onChange={(e) => setDraft({ ...draft, difficulty: e.target.value as DifficultyLevel })}
              className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
            >
              <option>Easy</option>
              <option>Average</option>
              <option>Difficult</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="block text-slate-400 mb-1">Topic</span>
          <input value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white" />
        </label>

        <label className="block">
          <span className="block text-slate-300 font-semibold mb-1">Question text</span>
          <textarea
            rows={4}
            value={draft.question}
            onChange={(e) => setDraft({ ...draft, question: e.target.value })}
            className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm leading-relaxed"
          />
        </label>
        {original !== undefined && original !== draft.question && (
          <div className="p-2 rounded bg-slate-950 border border-slate-800 text-slate-400">
            <span className="font-semibold text-slate-300">As extracted: </span>
            <span className="whitespace-pre-wrap">{original || '(empty)'}</span>
          </div>
        )}

        <div className="space-y-2">
          <span className="block text-slate-300 font-semibold">Choices</span>
          {draft.options.map((opt, i) => {
            const was = originalOptions.find((o) => o.key === opt.key)?.text;
            return (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 shrink-0 rounded-full bg-slate-800 text-white font-bold flex items-center justify-center">{opt.key}</span>
                  <input
                    value={opt.text}
                    onChange={(e) => setOption(i, e.target.value)}
                    className="flex-1 min-w-0 p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                    aria-label={`Choice ${opt.key}`}
                  />
                  <button onClick={() => removeOption(i)} className="p-1.5 text-slate-400 hover:text-rose-400" aria-label={`Remove choice ${opt.key}`}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {was !== undefined && was !== opt.text && <div className="pl-8 text-slate-500">As extracted: {was || '(empty)'}</div>}
              </div>
            );
          })}
          <button onClick={addOption} className="flex items-center gap-1 text-indigo-300 hover:text-indigo-200 font-semibold">
            <Plus className="w-3.5 h-3.5" /> Add a choice printed in the PDF
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-slate-400 mb-1">Correct answer</span>
            <select
              value={draft.correctAnswer}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  correctAnswer: e.target.value,
                  answerSource: e.target.value ? 'admin' : 'none',
                  verificationStatus: e.target.value ? 'manual_override' : 'needs_verification',
                })
              }
              className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
            >
              <option value="">Not set</option>
              {draft.options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.key}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="block text-slate-400 mb-1">Figures and tables</span>
            <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer font-semibold">
              <ImagePlus className="w-4 h-4" /> Attach image from the PDF
              <input type="file" accept="image/*" className="hidden" onChange={(e) => attachImage(e.target.files?.[0])} />
            </label>
            {imageError && <p className="text-rose-300 mt-1">{imageError}</p>}
          </div>
        </div>
        {(draft.figures ?? []).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {draft.figures!.map((f) => (
              <div key={f.id} className="relative">
                {f.dataUrl && <img src={f.dataUrl} alt="" className="h-24 rounded border border-slate-700 bg-white" />}
                <button
                  onClick={() => setDraft({ ...draft, figures: draft.figures!.filter((x) => x.id !== f.id) })}
                  className="absolute -top-2 -right-2 p-1 rounded-full bg-slate-800 text-slate-300 hover:text-rose-400"
                  aria-label="Remove figure"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <label className="block">
          <span className="block text-slate-400 mb-1">Explanation (optional)</span>
          <textarea
            rows={3}
            value={draft.explanation}
            onChange={(e) => setDraft({ ...draft, explanation: e.target.value })}
            className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
          {original !== undefined ? (
            <button
              onClick={() => setDraft({ ...draft, question: original, options: originalOptions.map((o) => ({ ...o })) })}
              className="flex items-center gap-1 text-sky-300 hover:text-sky-200 font-semibold"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Restore text as extracted
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700">
              Cancel
            </button>
            <button onClick={() => onSave(draft)} className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 font-semibold">
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
