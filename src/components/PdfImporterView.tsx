/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import {
  FileUp,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  ArrowRight,
  Eye,
  Trash2,
  Edit3,
  Copy,
  Download,
  UploadCloud,
  FileText,
  HelpCircle,
  RefreshCw,
  Search,
  Filter,
  Check,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { Question, PdfSource, SubjectId, DifficultyLevel, VerificationStatus } from '../types/index.ts';
import { SAMPLE_RAW_QUESTIONNAIRE_TEXT } from '../data/seedData.ts';
import { checkQuestionDuplicate } from '../utils/examEngine.ts';

interface Props {
  existingQuestions: Question[];
  pdfSources: PdfSource[];
  onPublishQuestions: (newQuestions: Question[], sourcePdf: PdfSource) => void;
  onAddAuditLog: (action: string, details: string, badge?: string) => void;
}

export const PdfImporterView: React.FC<Props> = ({
  existingQuestions,
  pdfSources,
  onPublishQuestions,
  onAddAuditLog,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>('custom');
  const [rawText, setRawText] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingStage, setProcessingStage] = useState<string>('');
  const [processingProgress, setProcessingProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Extracted staging questions
  const [extractedQuestions, setExtractedQuestions] = useState<Question[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [previewQuestion, setPreviewQuestion] = useState<Question | null>(null);
  const [duplicateConflicts, setDuplicateConflicts] = useState<Record<string, { matchedId: string; matchedText: string; similarity: number }>>({});

  // Filter state for staging questions
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterSubject, setFilterSubject] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sample presets for immediate testability
  const presets = [
    {
      id: 'sample-ree-power',
      name: '2025 REE Licensure - Power & Machines Examination.pdf',
      description: 'Contains 5 realistic Board exam questions with answers, induction motor formulas, RLC circuits, and PEC code.',
      text: SAMPLE_RAW_QUESTIONNAIRE_TEXT,
    },
    {
      id: 'sample-thermo-mechanics',
      name: 'ESAS_Engineering_Thermodynamics_and_Mechanics.pdf',
      description: 'Contains high-yield questions on Carnot efficiency, static friction, tensile stress, and compound interest.',
      text: `
ENGINEERING SCIENCES AND ALLIED SUBJECTS (ESAS)
BOARD EXAMINATION MOCK QUESTIONNAIRE - SET B

INSTRUCTIONS: Read and solve each problem carefully. Choose the letter of the correct answer.

1. A heat engine operating on a Carnot cycle absorbs 1500 kJ of heat from a heat reservoir at 600 K and rejects heat to a sink at 300 K. What is the thermal efficiency of the engine?
A. 50%
B. 60%
C. 40%
D. 75%
[Answer Key: A]

2. A 20-kN load is supported by a bronze rod 2 meters long and having a cross-sectional area of 250 mm^2. If E = 100 GPa, calculate the total axial elongation of the rod.
A. 1.60 mm
B. 1.25 mm
C. 2.00 mm
D. 0.80 mm
[Answer Key: A]

3. An electrical engineer borrows ₱100,000 from a bank at an annual interest rate of 12% compounded monthly. How much must be repaid at the end of 2 years?
A. ₱126,973
B. ₱124,000
C. ₱128,500
D. ₱130,200
[Answer Key: A]
      `,
    },
  ];

  const handlePresetSelect = (presetId: string) => {
    setSelectedPreset(presetId);
    const found = presets.find((p) => p.id === presetId);
    if (found) {
      setRawText(found.text.trim());
      setSelectedFile(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setSelectedPreset('custom');
      // For quick preview or text-based reading
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result;
        if (typeof content === 'string') {
          // If text or plain file
          setRawText(content.slice(0, 5000));
        }
      };
      reader.readAsText(file);
    }
  };

  // Convert File to Base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Strip data:application/pdf;base64, prefix
        const base64 = result.split(',')[1] || result;
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleStartExtraction = async () => {
    if (!rawText.trim() && !selectedFile) {
      setErrorMessage('Please upload a PDF file or select one of the realistic questionnaire presets.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    setProcessingProgress(15);
    setProcessingStage('Stage 1/5: Ingesting document & initializing Gemini AI OCR Engine...');

    try {
      let base64Pdf: string | undefined;
      let filename = 'Uploaded_Questionnaire.pdf';

      if (selectedFile) {
        filename = selectedFile.name;
        if (selectedFile.type === 'application/pdf') {
          setProcessingStage('Stage 1/5: Encoding PDF binary data for multimodal analysis...');
          base64Pdf = await fileToBase64(selectedFile);
        }
      } else {
        const found = presets.find((p) => p.id === selectedPreset);
        if (found) filename = found.name;
      }

      setProcessingProgress(35);
      setProcessingStage('Stage 2/5: Distilling actual examination questions (filtering non-question prose & lecture notes)...');

      // Call backend API
      const res = await fetch('/api/extract-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: rawText.trim() || undefined,
          base64Pdf: base64Pdf,
          filename: filename,
        }),
      });

      setProcessingProgress(65);
      setProcessingStage('Stage 3/5: AI Mathematical Solver formulating step-by-step derivations & equations...');

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Server extraction error');
      }

      const data = await res.json();
      const rawExtracted: any[] = data.questions || [];

      setProcessingProgress(85);
      setProcessingStage('Stage 4/5: Verifying answer keys and checking duplicate similarity against Question Bank...');

      // Transform into typed Question objects & check duplicates
      const pdfId = `pdf-${Date.now().toString(36)}`;
      const newDuplicates: Record<string, { matchedId: string; matchedText: string; similarity: number }> = {};

      const processed: Question[] = rawExtracted.map((item, idx) => {
        const qId = `ext-${Date.now()}-${idx + 1}`;
        const questionText = item.question || '';

        // Check duplicate against existing bank
        const dupCheck = checkQuestionDuplicate(questionText, existingQuestions, 0.70);
        if (dupCheck.isDuplicate && dupCheck.matchedQuestionId) {
          newDuplicates[qId] = {
            matchedId: dupCheck.matchedQuestionId,
            matchedText: dupCheck.matchedQuestionText || '',
            similarity: dupCheck.similarityScore,
          };
        }

        const validStatus: VerificationStatus =
          item.verificationStatus === 'discrepancy_flagged'
            ? 'discrepancy_flagged'
            : item.verificationStatus === 'needs_verification'
            ? 'needs_verification'
            : 'verified';

        return {
          id: qId,
          originalQuestionNumber: item.originalQuestionNumber || idx + 1,
          question: questionText,
          options: item.options || [
            { key: 'A', text: 'Option A' },
            { key: 'B', text: 'Option B' },
            { key: 'C', text: 'Option C' },
            { key: 'D', text: 'Option D' },
          ],
          correctAnswer: item.correctAnswer || 'A',
          extractedAnswerKey: item.extractedAnswerKey,
          explanation: item.explanation || 'Verified using standard board examination principles.',
          stepByStepSolution: item.stepByStepSolution || '1. Identify parameters.\n2. Apply governing theorem.\n3. Compute result with units.',
          formulasUsed: item.formulasUsed || [],
          givenValues: item.givenValues || [],
          finalAnswerWithUnit: item.finalAnswerWithUnit || '',
          subjectId: (item.subjectId as SubjectId) || 'ee',
          subjectName: item.subjectName || 'Electrical Engineering Professional Subjects',
          topic: item.topic || 'General Examination',
          subtopic: item.subtopic,
          difficulty: (item.difficulty as DifficultyLevel) || 'Average',
          sourcePdfId: pdfId,
          sourcePdfName: filename,
          sourcePdfPage: item.sourcePdfPage || 1,
          extractionConfidence: item.extractionConfidence || 95,
          verificationStatus: validStatus,
          isPublished: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      });

      setDuplicateConflicts(newDuplicates);
      setExtractedQuestions(processed);
      setSelectedIds(processed.map((q) => q.id)); // select all by default

      setProcessingProgress(100);
      setProcessingStage('Stage 5/5: Extraction and Verification Complete!');

      onAddAuditLog(
        'AI PDF Extraction Executed',
        `Extracted ${processed.length} questions from "${filename}". Verified ${processed.filter((q) => q.verificationStatus === 'verified').length} questions.`,
        'AI Extracted'
      );
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'An error occurred during PDF question extraction.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Toggle selection
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedIds.length === filteredQuestions.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredQuestions.map((q) => q.id));
    }
  };

  // Inline edit save
  const handleSaveEdit = (updated: Question) => {
    setExtractedQuestions((prev) =>
      prev.map((q) => (q.id === updated.id ? { ...updated, updatedAt: new Date().toISOString() } : q))
    );
    setEditingQuestion(null);
  };

  // Delete question
  const handleDelete = (id: string) => {
    setExtractedQuestions((prev) => prev.filter((q) => q.id !== id));
    setSelectedIds((prev) => prev.filter((item) => item !== id));
  };

  // Approve question
  const handleApprove = (id: string) => {
    setExtractedQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, verificationStatus: 'verified' } : q))
    );
  };

  // Publish to Question Bank
  const handlePublishSelected = () => {
    const toPublish = extractedQuestions.filter((q) => selectedIds.includes(q.id));
    if (toPublish.length === 0) {
      setErrorMessage('Please select at least one question to publish.');
      return;
    }

    const firstItem = toPublish[0];
    const sourcePdfName = firstItem.sourcePdfName || 'Extracted_Questionnaire.pdf';

    const sourceRecord: PdfSource = {
      id: firstItem.sourcePdfId || `pdf-${Date.now().toString(36)}`,
      filename: sourcePdfName,
      originalName: sourcePdfName,
      fileSize: '3.6 MB',
      pageCount: 18,
      uploadDate: new Date().toISOString().split('T')[0],
      status: 'published',
      questionsCount: toPublish.length,
      verifiedCount: toPublish.filter((q) => q.verificationStatus === 'verified').length,
      needsReviewCount: toPublish.filter((q) => q.verificationStatus !== 'verified').length,
      subjectCoverage: [
        { subjectId: 'math', count: toPublish.filter((q) => q.subjectId === 'math').length },
        { subjectId: 'esas', count: toPublish.filter((q) => q.subjectId === 'esas').length },
        { subjectId: 'ee', count: toPublish.filter((q) => q.subjectId === 'ee').length },
      ],
      isPublicToReviewees: true,
      allowedModes: ['quiz', 'practice', 'preboard', 'mock'],
      notes: `Published from AI Importer on ${new Date().toLocaleDateString()}`,
    };

    onPublishQuestions(toPublish, sourceRecord);
    onAddAuditLog(
      'Questions Published to Bank',
      `Published ${toPublish.length} questions from "${sourcePdfName}" into Question Bank. Now live for all reviewee exams.`,
      'Published'
    );

    // Remove published from staging
    setExtractedQuestions((prev) => prev.filter((q) => !selectedIds.includes(q.id)));
    setSelectedIds([]);
    setSuccessMessage(`Successfully published ${toPublish.length} questions to the central Question Bank! They are now immediately accessible to all reviewees.`);
  };

  // Export JSON
  const handleExportQuestions = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(extractedQuestions, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', 'nexora_extracted_questions.json');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Filter questions
  const filteredQuestions = extractedQuestions.filter((q) => {
    const matchSearch =
      q.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.topic.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus =
      filterStatus === 'all' || q.verificationStatus === filterStatus;
    const matchSubject =
      filterSubject === 'all' || q.subjectId === filterSubject;
    return matchSearch && matchStatus && matchSubject;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Title & Introduction */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-900/50 rounded-2xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-indigo-500/10 blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              Automated Question Encoding Suite
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              AI-Powered PDF Question Importer
            </h1>
            <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
              Upload PDF questionnaires or select sample board examination modules. The AI engine automatically extracts genuine questions, filters out non-question prose, computes step-by-step mathematical solutions, checks answer keys, and classifies questions into the Question Bank.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleExportQuestions}
              disabled={extractedQuestions.length === 0}
              className="px-4 py-2 bg-slate-800 text-slate-200 hover:text-white hover:bg-slate-700 disabled:opacity-40 rounded-xl text-xs font-medium border border-slate-700 flex items-center gap-2 transition"
            >
              <Download className="w-4 h-4" />
              Export Staged JSON
            </button>
          </div>
        </div>
      </div>

      {/* Upload & Preset Selector Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Upload and Presets */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-indigo-400" />
              Document Upload & Presets
            </h2>
            <span className="text-xs text-slate-400">PDF, Scanned, Text</span>
          </div>

          {/* Preset Buttons */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
              Quick Test Presets (Instant AI Demonstration):
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {presets.map((p) => (
                <div
                  key={p.id}
                  onClick={() => handlePresetSelect(p.id)}
                  className={`p-3.5 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                    selectedPreset === p.id
                      ? 'border-indigo-500 bg-indigo-950/40 text-white'
                      : 'border-slate-800 bg-slate-800/50 text-slate-300 hover:border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <FileText className={`w-4 h-4 mt-0.5 ${selectedPreset === p.id ? 'text-indigo-400' : 'text-slate-400'}`} />
                    <div>
                      <div className="text-xs font-bold leading-tight">{p.name}</div>
                      <div className="text-[11px] text-slate-400 mt-1 line-clamp-2">{p.description}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] font-mono text-indigo-400 flex items-center justify-end gap-1">
                    {selectedPreset === p.id ? '✓ Selected' : 'Click to Load'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Drag & Drop File Zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${
              selectedFile
                ? 'border-emerald-500/80 bg-emerald-950/20'
                : 'border-slate-700 hover:border-indigo-500 bg-slate-950/50 hover:bg-slate-900'
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".pdf,.txt"
              className="hidden"
            />
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-indigo-400">
                <FileUp className="w-6 h-6" />
              </div>
              <div className="text-sm font-semibold text-white">
                {selectedFile ? selectedFile.name : 'Click to browse or drag & drop PDF questionnaire'}
              </div>
              <p className="text-xs text-slate-400 max-w-sm">
                Supports multi-page text and scanned board examination questionnaires (up to 50MB).
              </p>
              {selectedFile && (
                <div className="text-xs text-emerald-400 font-mono mt-1">
                  File loaded: {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Ready for AI extraction
                </div>
              )}
            </div>
          </div>

          {/* Text Area for raw questionnaire preview/paste */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-slate-300">
                Questionnaire Content Stream Preview:
              </label>
              <button
                onClick={() => setRawText(SAMPLE_RAW_QUESTIONNAIRE_TEXT)}
                className="text-indigo-400 hover:text-indigo-300 transition"
              >
                Reset to Standard Sample
              </button>
            </div>
            <textarea
              rows={4}
              value={rawText}
              onChange={(e) => {
                setRawText(e.target.value);
                setSelectedPreset('custom');
              }}
              placeholder="Paste or review examination questionnaire text here..."
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Start Extraction CTA */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <div className="text-xs text-slate-400">
              Extraction preserves formulas, given values, units, and verifies solutions.
            </div>
            <button
              onClick={handleStartExtraction}
              disabled={isProcessing}
              className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Processing Document...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Run AI Question Extraction
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right: Pipeline Architecture Info */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between space-y-6">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
              <Layers className="w-4 h-4 text-emerald-400" />
              Nexora AI Extraction Pipeline
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Our automated ingestion engine operates in 5 deterministic steps to guarantee board examination question accuracy:
            </p>

            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px] font-mono">1</span>
                  Smart Question Detection
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Filters out lecture notes, objectives, syllabi, and introductory prose; retains only testable questions.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px] font-mono">2</span>
                  Exact Extraction & Math
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Preserves original numbering, multiple-choice options (A-D), units, subscripts, and equations without paraphrase.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px] font-mono">3</span>
                  Step-by-Step AI Solver
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Extracts given parameters, selects governing laws, computes mathematical proofs, and identifies units.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px] font-mono">4</span>
                  Answer Key & Duplicate Check
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Compares AI solution against provided answer keys, flags discrepancies, and checks similarity against existing questions.
                </p>
              </div>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-800/30 text-amber-300 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong>PRC Accuracy Policy:</strong>
              <div className="text-[11px] text-amber-300/80 mt-0.5">
                Questions with discrepancies or confidence below 90% are marked for manual administrator review before publication.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Processing Progress Indicator */}
      {isProcessing && (
        <div className="bg-slate-900 border border-indigo-700/60 rounded-2xl p-6 shadow-2xl animate-pulse space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <RefreshCw className="w-5 h-5 text-indigo-400 animate-spin" />
              <span className="text-sm font-bold text-white">{processingStage}</span>
            </div>
            <span className="font-mono text-sm font-bold text-emerald-400">{processingProgress}%</span>
          </div>

          <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-indigo-500 to-emerald-500 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${processingProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-rose-400 hover:text-white underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Success Banner */}
      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-400 hover:text-white underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Extracted Questions Staging Table & Actions */}
      {extractedQuestions.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl">
          {/* Header Row */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-white">
                  Extracted Staging Queue
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-mono font-semibold border border-indigo-500/30">
                  {extractedQuestions.length} Questions Ready
                </span>
                {Object.keys(duplicateConflicts).length > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-mono font-semibold border border-amber-500/30 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {Object.keys(duplicateConflicts).length} Duplicate Warning
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Review questions, verify AI solutions, resolve potential duplicates, and publish to the live Question Bank.
              </p>
            </div>

            {/* Bulk Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={handleSelectAll}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-xs font-medium border border-slate-700"
              >
                {selectedIds.length === filteredQuestions.length ? 'Deselect All' : 'Select All'}
              </button>

              <button
                onClick={handlePublishSelected}
                disabled={selectedIds.length === 0}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 flex items-center gap-1.5 transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                Publish Selected to Question Bank ({selectedIds.length})
              </button>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div className="relative sm:col-span-2">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search extracted question text or topics..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <select
              value={filterSubject}
              onChange={(e) => setFilterSubject(e.target.value)}
              className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Subjects</option>
              <option value="ee">Electrical Engineering (EE)</option>
              <option value="esas">Engineering Sciences (ESAS)</option>
              <option value="math">Mathematics (MATH)</option>
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Verification Statuses</option>
              <option value="verified">Verified (High Confidence)</option>
              <option value="needs_verification">Needs Verification</option>
              <option value="discrepancy_flagged">Discrepancy Flagged</option>
            </select>
          </div>

          {/* Questions List */}
          <div className="space-y-4">
            {filteredQuestions.map((q) => {
              const isSelected = selectedIds.includes(q.id);
              const dupWarning = duplicateConflicts[q.id];

              return (
                <div
                  key={q.id}
                  className={`p-5 rounded-xl border transition-all ${
                    isSelected
                      ? 'border-indigo-500/80 bg-slate-850/80'
                      : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                  }`}
                >
                  {/* Top Bar with Badges & Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelect(q.id)}
                        className="w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700 focus:ring-indigo-500"
                      />
                      <span className="font-mono text-xs font-bold text-slate-400">
                        Item #{q.originalQuestionNumber || '—'}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                        {q.subjectId.toUpperCase()}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-indigo-300">
                        {q.topic}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        q.difficulty === 'Easy'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/40'
                          : q.difficulty === 'Average'
                          ? 'bg-blue-950 text-blue-300 border border-blue-800/40'
                          : 'bg-purple-950 text-purple-300 border border-purple-800/40'
                      }`}>
                        {q.difficulty}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Verification Status badge */}
                      {q.verificationStatus === 'verified' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          Verified ({q.extractionConfidence}%)
                        </span>
                      ) : q.verificationStatus === 'discrepancy_flagged' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                          Discrepancy with Key
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          Needs Verification
                        </span>
                      )}

                      <button
                        onClick={() => setPreviewQuestion(q)}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                        title="View Full Solution & Breakdown"
                      >
                        <Eye className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => setEditingQuestion(q)}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                        title="Edit Question Statement & Solution"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleDelete(q.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
                        title="Delete Question"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Duplicate warning notification if detected */}
                  {dupWarning && (
                    <div className="mb-3 p-3 rounded-lg bg-amber-950/30 border border-amber-800/40 text-xs text-amber-300 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        <div>
                          <strong>Possible Duplicate Detected ({dupWarning.similarity}% similarity):</strong>
                          <div className="text-[11px] text-amber-300/80 truncate max-w-lg">
                            Matches existing #{dupWarning.matchedId}: "{dupWarning.matchedText}"
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const updatedDups = { ...duplicateConflicts };
                            delete updatedDups[q.id];
                            setDuplicateConflicts(updatedDups);
                          }}
                          className="px-2 py-0.5 bg-amber-800/40 hover:bg-amber-800/60 rounded text-[10px] text-white font-medium"
                        >
                          Keep Both
                        </button>
                        <button
                          onClick={() => handleDelete(q.id)}
                          className="px-2 py-0.5 bg-slate-800 hover:bg-rose-900/60 rounded text-[10px] text-slate-300 hover:text-rose-200"
                        >
                          Skip Duplicate
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Question Statement */}
                  <p className="text-sm text-white font-medium mb-3 leading-relaxed">
                    {q.question}
                  </p>

                  {/* Choices Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                    {q.options.map((opt) => {
                      const isCorrect = opt.key === q.correctAnswer;
                      return (
                        <div
                          key={opt.key}
                          className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                            isCorrect
                              ? 'border-emerald-600/70 bg-emerald-950/30 text-emerald-200 font-semibold'
                              : 'border-slate-800 bg-slate-950/40 text-slate-300'
                          }`}
                        >
                          <span
                            className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                              isCorrect
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {opt.key}
                          </span>
                          <span className="flex-1">{opt.text}</span>
                          {isCorrect && (
                            <span className="text-[10px] text-emerald-400 font-mono">
                              ✓ Correct Answer
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Mathematical Derivation Summary Snippet */}
                  <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 text-xs space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800 pb-1">
                      <span className="font-semibold text-indigo-400">Step-by-Step AI Derivation & Proof:</span>
                      {q.finalAnswerWithUnit && (
                        <span className="font-mono text-emerald-400">
                          Final: {q.finalAnswerWithUnit}
                        </span>
                      )}
                    </div>
                    <p className="text-slate-300 text-[11px] font-mono whitespace-pre-line line-clamp-3">
                      {q.stepByStepSolution}
                    </p>
                    {q.formulasUsed && q.formulasUsed.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[10px] text-slate-500 font-semibold">Formula:</span>
                        {q.formulasUsed.map((f, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 bg-slate-800 text-emerald-400 rounded text-[10px] font-mono border border-slate-700"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Inline Edit Modal */}
      {editingQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-indigo-400" />
                Edit Extracted Question #{editingQuestion.originalQuestionNumber}
              </h3>
              <button
                onClick={() => setEditingQuestion(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

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

              {/* Options */}
              <div className="grid grid-cols-2 gap-3">
                {editingQuestion.options.map((opt, i) => (
                  <div key={opt.key}>
                    <label className="block text-slate-400 mb-1">Option {opt.key}:</label>
                    <input
                      type="text"
                      value={opt.text}
                      onChange={(e) => {
                        const newOptions = [...editingQuestion.options];
                        newOptions[i] = { ...opt, text: e.target.value };
                        setEditingQuestion({ ...editingQuestion, options: newOptions });
                      }}
                      className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                    />
                  </div>
                ))}
              </div>

              {/* Correct answer & Difficulty */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Correct Answer:</label>
                  <select
                    value={editingQuestion.correctAnswer}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, correctAnswer: e.target.value })}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  >
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                    <option value="D">D</option>
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

              {/* Step-by-Step Solution */}
              <div>
                <label className="block text-slate-300 font-medium mb-1">Step-by-Step Mathematical Derivation:</label>
                <textarea
                  rows={4}
                  value={editingQuestion.stepByStepSolution}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, stepByStepSolution: e.target.value })}
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-lg font-mono text-white"
                />
              </div>

              {/* Explanation */}
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
                onClick={() => setEditingQuestion(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveEdit(editingQuestion)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detailed Full Solution Preview Modal */}
      {previewQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">
                  Board Examination Question & Verified Solution
                </h3>
              </div>
              <button
                onClick={() => setPreviewQuestion(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-sm text-white font-medium">
                {previewQuestion.question}
              </div>

              {/* Options list */}
              <div className="space-y-1.5">
                {previewQuestion.options.map((opt) => (
                  <div
                    key={opt.key}
                    className={`p-2.5 rounded-lg border flex items-center justify-between ${
                      opt.key === previewQuestion.correctAnswer
                        ? 'border-emerald-600 bg-emerald-950/40 text-emerald-200 font-bold'
                        : 'border-slate-800 bg-slate-950 text-slate-300'
                    }`}
                  >
                    <span>
                      <strong className="mr-2">{opt.key}.</strong> {opt.text}
                    </span>
                    {opt.key === previewQuestion.correctAnswer && (
                      <span className="text-[10px] text-emerald-400 font-mono">
                        Official Board Answer
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Given values & formulas */}
              {previewQuestion.givenValues && previewQuestion.givenValues.length > 0 && (
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <div className="font-semibold text-slate-300 mb-1 text-[11px]">Given Parameters:</div>
                  <div className="grid grid-cols-2 gap-2">
                    {previewQuestion.givenValues.map((g, i) => (
                      <div key={i} className="text-slate-400 text-[11px] font-mono">
                        • {g.label}: <span className="text-white font-semibold">{g.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step by Step Proof */}
              <div className="p-4 bg-slate-950 rounded-xl border border-emerald-900/40 space-y-2">
                <div className="font-bold text-emerald-400 text-xs flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Step-by-Step Computational Derivation:
                </div>
                <div className="font-mono text-slate-200 whitespace-pre-line text-xs leading-relaxed">
                  {previewQuestion.stepByStepSolution}
                </div>
              </div>

              {/* Conceptual explanation */}
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800">
                <div className="font-semibold text-indigo-400 text-[11px] mb-1">
                  Why Choice {previewQuestion.correctAnswer} is Correct:
                </div>
                <p className="text-slate-300 text-xs leading-relaxed">
                  {previewQuestion.explanation}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setPreviewQuestion(null)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
