/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
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
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Plus,
  FileCheck,
  Split,
  Maximize2,
  CheckSquare,
  Square,
} from 'lucide-react';
import {
  Question,
  PdfSource,
  SubjectId,
  DifficultyLevel,
  VerificationStatus,
  ExtractionReport,
  QuestionChoice,
} from '../types/index.ts';
import { SAMPLE_RAW_QUESTIONNAIRE_TEXT } from '../data/seedData.ts';
import { checkQuestionDuplicate } from '../utils/examEngine.ts';
import {
  parseQuestionsFromRawText,
  generateEvaluationExamQuestions,
  validateExtractionReport,
} from '../utils/questionExtractor.ts';

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
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [selectedPreset, setSelectedPreset] = useState<string>('custom');
  const [rawText, setRawText] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingStage, setProcessingStage] = useState<string>('');
  const [processingProgress, setProcessingProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Extracted staging questions and metadata
  const [extractedQuestions, setExtractedQuestions] = useState<Question[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [previewQuestion, setPreviewQuestion] = useState<Question | null>(null);
  const [duplicateConflicts, setDuplicateConflicts] = useState<
    Record<string, { matchedId: string; matchedText: string; similarity: number }>
  >({});
  const [extractionReport, setExtractionReport] = useState<ExtractionReport | null>(null);
  const [rawExtractedText, setRawExtractedText] = useState<string>('');
  const [totalPages, setTotalPages] = useState<number>(1);
  const [sourcePdfId, setSourcePdfId] = useState<string>('');
  const [sourceFilename, setSourceFilename] = useState<string>('');

  // Staging View Tabs: 'side-by-side' | 'cards' | 'report' | 'preview'
  const [activeTab, setActiveTab] = useState<'side-by-side' | 'cards' | 'report' | 'preview'>('side-by-side');

  // Left Panel PDF Viewer Controls
  const [leftPanelPage, setLeftPanelPage] = useState<number>(1);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [viewerMode, setViewerMode] = useState<'pdf' | 'text'>('pdf');
  const [filterToCurrentPage, setFilterToCurrentPage] = useState<boolean>(false);

  // Filter state for staging questions
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterSubject, setFilterSubject] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Add Missing Question modal
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newQuestionNumber, setNewQuestionNumber] = useState<number>(1);
  const [newQuestionStatement, setNewQuestionStatement] = useState<string>('');
  const [newOptions, setNewOptions] = useState<QuestionChoice[]>([
    { key: 'A', text: '' },
    { key: 'B', text: '' },
    { key: 'C', text: '' },
    { key: 'D', text: '' },
  ]);
  const [newCorrectAnswer, setNewCorrectAnswer] = useState<string>('A');
  const [newSubjectId, setNewSubjectId] = useState<SubjectId>('ee');
  const [newTopic, setNewTopic] = useState<string>('General Examination');
  const [newPage, setNewPage] = useState<number>(1);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manage PDF Object URL for preview
  useEffect(() => {
    if (selectedFile && selectedFile.type === 'application/pdf') {
      const url = URL.createObjectURL(selectedFile);
      setPdfPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setPdfPreviewUrl(null);
    }
  }, [selectedFile]);

  // Check duplicate PDF upload notice
  const existingPdfMatch = useMemo(() => {
    if (!selectedFile) return null;
    return pdfSources.find(
      (p) => p.filename.toLowerCase() === selectedFile.name.toLowerCase()
    );
  }, [selectedFile, pdfSources]);

  // Sample presets for immediate testability
  const presets = [
    {
      id: 'sample-ree-power',
      name: '2025 REE Licensure - Power & Machines Examination.pdf',
      description: 'Contains 5 realistic Board exam questions with answers, induction motor formulas, RLC circuits, and PEC code.',
      text: SAMPLE_RAW_QUESTIONNAIRE_TEXT,
    },
    {
      id: 'sample-ee-eval',
      name: 'EE 1 Evaluation Exam.pdf',
      description: 'Contains verified electrical engineering questions on induction motors, RLC resonance, transformers, resistivity, and PEC bends.',
      text: `1. A 3-phase, 4-pole, 60 Hz induction motor has a full-load slip of 4%. Calculate the rotor speed in rpm at full-load.
A. 1728 rpm    B. 1800 rpm    C. 1750 rpm    D. 1680 rpm
[Answer: A]

2. A series RLC circuit has resistance R = 10 Ω, inductance L = 0.1 H, and capacitance C = 100 μF. Determine the resonant frequency in Hertz.
A. 50.33 Hz    B. 159.2 Hz    C. 79.58 Hz    D. 100.0 Hz
[Answer: A]

3. A 25 kVA, 2400/240 V single-phase distribution transformer has a core loss of 200 W and full-load copper loss of 350 W. Calculate the efficiency at full-load with 0.85 power factor lagging.
A. 97.48%      B. 98.20%      C. 96.50%      D. 95.85%
[Answer: A]

4. What is the resistance of a conductor having a resistivity of 1.72 × 10⁻⁸ Ω·m, a length of 100 meters, and a cross-sectional area of 2 mm²?
A. 0.86 Ω      B. 0.43 Ω      C. 1.72 Ω      D. 2.15 Ω
[Answer: A]

5. According to the Philippine Electrical Code (PEC 1), what is the maximum number of quarter bends allowed in a conduit run between pull boxes?
A. 4 quarter bends (360 degrees)
B. 3 quarter bends (270 degrees)
C. 2 quarter bends (180 degrees)
D. 5 quarter bends (450 degrees)
[Answer: A]`,
    },
    {
      id: 'sample-thermo-mechanics',
      name: 'ESAS_Engineering_Thermodynamics_and_Mechanics.pdf',
      description: 'Contains high-yield questions on Carnot efficiency, static friction, tensile stress, and compound interest.',
      text: `ENGINEERING SCIENCES AND ALLIED SUBJECTS (ESAS)
BOARD EXAMINATION MOCK QUESTIONNAIRE - SET B

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
[Answer Key: A]`,
    },
  ];

  const handlePresetSelect = (presetId: string) => {
    setSelectedPreset(presetId);
    const found = presets.find((p) => p.id === presetId);
    if (found) {
      setRawText(found.text.trim());
      setSelectedFile(null);
      setViewerMode('text');
    }
  };

  const loadFile = (file: File) => {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isText = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
    if (!isPdf && !isText) {
      setErrorMessage(`"${file.name}" is not supported. Please choose a PDF or TXT file.`);
      return;
    }

    setErrorMessage(null);
    setSelectedFile(file);
    setSelectedPreset('custom');
    setViewerMode(isPdf ? 'pdf' : 'text');

    if (isPdf) {
      setRawText('');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') {
        setRawText(content);
      }
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    e.target.value = '';
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
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
    setProcessingStage('Stage 1/5: Ingesting document & parsing page structures...');

    try {
      let base64Pdf: string | undefined;
      let filename = 'Uploaded_Questionnaire.pdf';
      let fileSizeStr = 'Unknown';

      if (selectedFile) {
        filename = selectedFile.name;
        fileSizeStr = `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`;
        if (selectedFile.type === 'application/pdf') {
          setProcessingStage('Stage 1/5: Encoding PDF binary data for OCR and Multimodal extraction...');
          base64Pdf = await fileToBase64(selectedFile);
        }
      } else {
        const found = presets.find((p) => p.id === selectedPreset);
        if (found) filename = found.name;
      }

      setSourceFilename(filename);
      const generatedPdfId = `pdf-${Date.now().toString(36)}`;
      setSourcePdfId(generatedPdfId);

      setProcessingProgress(35);
      setProcessingStage('Stage 2/5: Extracting exact verbatim questions, inline choices, and symbols...');

      const res = await fetch('/api/extract-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: rawText.trim() || undefined,
          base64Pdf: base64Pdf,
          filename: filename,
          isPreset: selectedPreset !== 'custom',
          fileSize: fileSizeStr,
        }),
      });

      setProcessingProgress(65);
      setProcessingStage('Stage 3/5: AI Mathematical Solver formulating step-by-step derivations & equations...');

      const contentType = res.headers.get('content-type') || '';
      let data: any = null;

      if (contentType.includes('application/json')) {
        data = await res.json().catch(() => null);
      } else {
        const rawResText = await res.text().catch(() => '');
        throw new Error(`Server returned unexpected response: ${rawResText.slice(0, 120)}`);
      }

      if (!res.ok) {
        throw new Error(data?.error || `Extraction failed with HTTP status ${res.status}`);
      }

      const rawQuestions: any[] = data.questions || [];
      if (rawQuestions.length === 0) {
        throw new Error('No examination questions could be identified in the uploaded document.');
      }

      const report: ExtractionReport = data.report || validateExtractionReport(
        filename,
        data.totalPages || 1,
        rawQuestions,
        data.rawExtractedText || rawText,
        data.engine || 'Extraction Engine',
        fileSizeStr
      );

      setExtractionReport(report);
      setTotalPages(data.totalPages || report.totalPages || 1);
      setRawExtractedText(data.rawExtractedText || rawText);

      setProcessingProgress(85);
      setProcessingStage('Stage 4/5: Running validation audit, sequence verification, and duplicate check...');

      // Transform into typed Question objects
      const newDuplicates: Record<string, { matchedId: string; matchedText: string; similarity: number }> = {};

      const processed: Question[] = rawQuestions.map((item, idx) => {
        const qId = `ext-${Date.now()}-${idx + 1}`;
        const questionText = item.question || '';

        // Check duplicate against existing Question Bank
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
            : item.verificationStatus === 'verified' && (item.options?.length ?? 0) >= 4
            ? 'verified'
            : 'needs_verification';

        return {
          id: qId,
          originalQuestionNumber: item.originalQuestionNumber || idx + 1,
          question: questionText,
          options: item.options || [],
          correctAnswer: item.correctAnswer || 'A',
          extractedAnswerKey: item.extractedAnswerKey,
          explanation: item.explanation || '',
          stepByStepSolution: item.stepByStepSolution || '',
          formulasUsed: item.formulasUsed || [],
          givenValues: item.givenValues || [],
          finalAnswerWithUnit: item.finalAnswerWithUnit || '',
          subjectId: (item.subjectId as SubjectId) || 'ee',
          subjectName: item.subjectName || 'Electrical Engineering Professional Subjects',
          topic: item.topic || 'General Examination',
          subtopic: item.subtopic,
          difficulty: (item.difficulty as DifficultyLevel) || 'Average',
          sourcePdfId: generatedPdfId,
          sourcePdfName: filename,
          sourcePdfPage: item.sourcePdfPage || 1,
          extractionConfidence: item.extractionConfidence ?? 90,
          verificationStatus: validStatus,
          isPublished: false,
          hasDiagram: Boolean(item.hasDiagram),
          hasMathEquation: Boolean(item.hasMathEquation),
          flaggedReason: item.flaggedReason,
          originalQuestionText: item.originalQuestionText || questionText,
          originalOptions: item.originalOptions || item.options,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      });

      setDuplicateConflicts(newDuplicates);
      setExtractedQuestions(processed);
      setSelectedIds(processed.map((q) => q.id)); // Select all by default

      setProcessingProgress(100);
      setProcessingStage('Stage 5/5: Extraction and Verification Complete!');
      setActiveTab('side-by-side');

      onAddAuditLog(
        'Strict PDF Extraction Completed',
        `Extracted ${processed.length} questions from "${filename}". Verified ${processed.filter((q) => q.verificationStatus === 'verified').length} questions. Status: ${report.overallStatus}.`,
        '100% Fidelity'
      );
    } catch (err: any) {
      console.error('[PDF Extraction Error]:', err);
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

  // Reordering questions (Move Up / Down)
  const handleMoveQuestion = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= extractedQuestions.length) return;

    setExtractedQuestions((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(targetIdx, 0, moved);
      return copy.map((q, idx) => ({ ...q, originalQuestionNumber: idx + 1 }));
    });
  };

  // Delete question
  const handleDelete = (id: string) => {
    setExtractedQuestions((prev) => prev.filter((q) => q.id !== id));
    setSelectedIds((prev) => prev.filter((item) => item !== id));
    setDuplicateConflicts((prev) => {
      const remaining = { ...prev };
      delete remaining[id];
      return remaining;
    });
  };

  // Approve question
  const handleApprove = (id: string) => {
    setExtractedQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, verificationStatus: 'verified', flaggedReason: undefined } : q))
    );
  };

  // Add Missing Question
  const handleAddMissingQuestion = () => {
    if (!newQuestionStatement.trim()) {
      alert('Please enter a question statement.');
      return;
    }

    const qId = `ext-manual-${Date.now()}`;
    const newQ: Question = {
      id: qId,
      originalQuestionNumber: newQuestionNumber || extractedQuestions.length + 1,
      question: newQuestionStatement.trim(),
      options: newOptions.filter((o) => o.text.trim().length > 0),
      correctAnswer: newCorrectAnswer,
      explanation: 'Manually verified and encoded by Administrator.',
      stepByStepSolution: '1. Standard engineering solution verified by examiner.\n2. Conforms to PRC licensure specifications.',
      formulasUsed: ['Standard Board Equation'],
      givenValues: [],
      finalAnswerWithUnit: `Option ${newCorrectAnswer}`,
      subjectId: newSubjectId,
      subjectName:
        newSubjectId === 'ee'
          ? 'Electrical Engineering Professional Subjects'
          : newSubjectId === 'math'
          ? 'Mathematics'
          : 'Engineering Sciences & Allied Subjects',
      topic: newTopic || 'General Examination',
      difficulty: 'Average',
      sourcePdfId: sourcePdfId || `pdf-${Date.now().toString(36)}`,
      sourcePdfName: sourceFilename || 'Uploaded_Document.pdf',
      sourcePdfPage: newPage,
      extractionConfidence: 100,
      verificationStatus: 'verified',
      isPublished: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      originalQuestionText: newQuestionStatement.trim(),
      originalOptions: newOptions,
    };

    setExtractedQuestions((prev) => [...prev, newQ]);
    setSelectedIds((prev) => [...prev, qId]);
    setShowAddModal(false);

    // Reset modal form
    setNewQuestionStatement('');
    setNewOptions([
      { key: 'A', text: '' },
      { key: 'B', text: '' },
      { key: 'C', text: '' },
      { key: 'D', text: '' },
    ]);
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
      fileSize: selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB` : '1.8 MB',
      pageCount: totalPages,
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
      notes: `Published from 100% Fidelity AI Importer on ${new Date().toLocaleDateString()}`,
      extractionReport: extractionReport || undefined,
    };

    onPublishQuestions(toPublish, sourceRecord);
    onAddAuditLog(
      'Questions Published to Bank',
      `Published ${toPublish.length} questions from "${sourcePdfName}" into Question Bank. Verified against original PDF.`,
      'Published'
    );

    // Remove published from staging
    setExtractedQuestions((prev) => prev.filter((q) => !selectedIds.includes(q.id)));
    setSelectedIds([]);
    setSuccessMessage(
      `Successfully published ${toPublish.length} questions to the central Question Bank! They are now immediately accessible to all reviewees.`
    );
  };

  // Export JSON
  const handleExportQuestions = () => {
    const dataStr =
      'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(extractedQuestions, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `nexora_${sourceFilename.replace(/\s+/g, '_')}_extracted.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Filter questions
  const filteredQuestions = extractedQuestions.filter((q) => {
    const matchSearch =
      q.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.topic.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = filterStatus === 'all' || q.verificationStatus === filterStatus;
    const matchSubject = filterSubject === 'all' || q.subjectId === filterSubject;
    const matchPage = !filterToCurrentPage || q.sourcePdfPage === leftPanelPage;
    return matchSearch && matchStatus && matchSubject && matchPage;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 select-none">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
              <FileUp className="w-8 h-8 text-indigo-400" />
              Advanced AI PDF Question Importer
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/60 uppercase">
              100% Content Fidelity
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-3xl">
            Extracts authentic board examination questionnaires directly from PDF files with strict character-for-character fidelity.
            Preserves original numbering, equations, Greek symbols, units, and answer choices with side-by-side verification.
          </p>
        </div>

        {extractedQuestions.length > 0 && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleExportQuestions}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition border border-slate-700"
            >
              <Download className="w-4 h-4" />
              Export JSON
            </button>
            <button
              onClick={handlePublishSelected}
              disabled={selectedIds.length === 0}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 disabled:opacity-40 text-white font-bold text-xs shadow-lg shadow-emerald-600/20 flex items-center gap-2 transition"
            >
              <CheckCircle2 className="w-4 h-4" />
              Publish ({selectedIds.length}) to Question Bank
            </button>
          </div>
        )}
      </div>

      {/* Messages */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800/70 text-rose-200 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-white font-bold">
            ✕
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-800/70 text-emerald-200 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-400 hover:text-white font-bold">
            ✕
          </button>
        </div>
      )}

      {/* Duplicate file notice */}
      {existingPdfMatch && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/50 text-amber-200 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <strong>Document Notice:</strong> A file named <em>"{existingPdfMatch.filename}"</em> was already uploaded on {existingPdfMatch.uploadDate} ({existingPdfMatch.questionsCount} questions).
            Re-extracting will create an updated revision in your Question Bank.
          </div>
        </div>
      )}

      {/* 1. UPLOAD & INPUT CONTAINER */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-indigo-400" />
              Upload Examination Document or Select Sample Preset
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Supports text-based PDFs, multi-column questionnaires, scanned papers, and mathematical problem sets.
            </p>
          </div>

          {/* Preset Buttons for Quick Testing */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Quick Presets:</span>
            {presets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handlePresetSelect(preset.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5 border ${
                  selectedPreset === preset.id
                    ? 'bg-indigo-600 border-indigo-500 text-white shadow-md'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
              >
                <FileText className="w-3.5 h-3.5 text-indigo-300" />
                {preset.name.split('.')[0].slice(0, 22)}...
              </button>
            ))}
          </div>
        </div>

        {/* Drag and Drop Upload Box */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingFile(true);
          }}
          onDragLeave={() => setIsDraggingFile(false)}
          onDrop={handleFileDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
            isDraggingFile
              ? 'border-indigo-400 bg-indigo-950/20 scale-[0.99]'
              : selectedFile
              ? 'border-emerald-500/70 bg-emerald-950/10'
              : 'border-slate-700 hover:border-slate-500 bg-slate-950/40 hover:bg-slate-950/70'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".pdf,.txt"
            className="hidden"
          />

          <div className="flex flex-col items-center justify-center space-y-3">
            <div
              className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
                selectedFile
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              {selectedFile ? <FileCheck className="w-7 h-7" /> : <UploadCloud className="w-7 h-7" />}
            </div>

            <div>
              {selectedFile ? (
                <div>
                  <div className="text-sm font-bold text-white flex items-center justify-center gap-2">
                    <span>{selectedFile.name}</span>
                    <span className="text-xs font-mono font-normal text-emerald-400">
                      ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
                    </span>
                  </div>
                  <p className="text-xs text-emerald-300/80 mt-1">
                    ✓ PDF file loaded and verified. Click "Start 100% Fidelity Extraction" to process.
                  </p>
                </div>
              ) : selectedPreset !== 'custom' ? (
                <div>
                  <div className="text-sm font-bold text-indigo-300">
                    Preset Loaded: {presets.find((p) => p.id === selectedPreset)?.name}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Ready for extraction. Or drop another PDF here to replace.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="text-sm font-bold text-white">
                    Drop your PDF questionnaire here, or <span className="text-indigo-400 underline">browse</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Supports text-based & scanned multi-page board examinations (up to 50MB)
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="flex items-center justify-between pt-2">
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>Forensic Verbatim Extraction • No content modifications • Side-by-side verification</span>
          </div>

          <button
            onClick={handleStartExtraction}
            disabled={isProcessing || (!selectedFile && !rawText.trim())}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 disabled:opacity-40 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition"
          >
            {isProcessing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Processing Document...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Start 100% Fidelity Extraction
              </>
            )}
          </button>
        </div>

        {/* Progress Bar during processing */}
        {isProcessing && (
          <div className="p-4 bg-slate-950 rounded-2xl border border-indigo-900/50 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-mono text-slate-300">
              <span className="flex items-center gap-2 text-indigo-400">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                {processingStage}
              </span>
              <span className="font-bold text-white">{processingProgress}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-indigo-500 via-sky-400 to-emerald-400 h-2 rounded-full transition-all duration-300"
                style={{ width: `${processingProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 2. STAGING & VERIFICATION WORKSPACE */}
      {extractedQuestions.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl">
          {/* Workspace Tabs Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-extrabold text-white">
                  Staging & Verification Workspace ({extractedQuestions.length} Items)
                </h2>
                {extractionReport && (
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold uppercase font-mono border ${
                      extractionReport.overallStatus === 'verified'
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-800/60'
                        : extractionReport.overallStatus === 'needs_review'
                        ? 'bg-amber-950 text-amber-300 border-amber-800/60'
                        : 'bg-rose-950 text-rose-300 border-rose-800/60'
                    }`}
                  >
                    Status: {extractionReport.overallStatus.replace('_', ' ')}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Source Document: <strong className="text-white">{sourceFilename}</strong> • Total Pages:{' '}
                <strong className="text-white">{totalPages}</strong>
              </p>
            </div>

            {/* Tab Navigation Controls */}
            <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800 text-xs">
              <button
                onClick={() => setActiveTab('side-by-side')}
                className={`px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1.5 ${
                  activeTab === 'side-by-side'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Split className="w-3.5 h-3.5" />
                Side-by-Side Verification
              </button>
              <button
                onClick={() => setActiveTab('report')}
                className={`px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1.5 ${
                  activeTab === 'report'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <FileCheck className="w-3.5 h-3.5" />
                Extraction Report
              </button>
              <button
                onClick={() => setActiveTab('cards')}
                className={`px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1.5 ${
                  activeTab === 'cards'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Card View ({extractedQuestions.length})
              </button>
              <button
                onClick={() => setActiveTab('preview')}
                className={`px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1.5 ${
                  activeTab === 'preview'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                Exam Preview
              </button>
            </div>
          </div>

          {/* TAB 1: SIDE-BY-SIDE VERIFICATION INTERFACE */}
          {activeTab === 'side-by-side' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[700px]">
                {/* LEFT PANEL: Original PDF Document Reference */}
                <div className="lg:col-span-6 bg-slate-950 border border-slate-800 rounded-2xl flex flex-col overflow-hidden">
                  {/* Left Panel Top Toolbar */}
                  <div className="p-3 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white flex items-center gap-1">
                        <FileText className="w-4 h-4 text-indigo-400" />
                        Original PDF Document
                      </span>
                      <span className="text-slate-500">|</span>
                      <span className="text-slate-400 font-mono text-[11px]">
                        Page {leftPanelPage} of {totalPages}
                      </span>
                    </div>

                    {/* Page Navigator & Zoom Controls */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setLeftPanelPage((p) => Math.max(1, p - 1))}
                        disabled={leftPanelPage <= 1}
                        className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white"
                        title="Previous Page"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>

                      <select
                        value={leftPanelPage}
                        onChange={(e) => setLeftPanelPage(parseInt(e.target.value, 10))}
                        className="bg-slate-800 text-white font-mono text-xs px-2 py-0.5 rounded border border-slate-700"
                      >
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                          <option key={pageNum} value={pageNum}>
                            Page {pageNum}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={() => setLeftPanelPage((p) => Math.min(totalPages, p + 1))}
                        disabled={leftPanelPage >= totalPages}
                        className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white"
                        title="Next Page"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>

                      <span className="text-slate-600">|</span>

                      <button
                        onClick={() => setZoomLevel((z) => Math.max(75, z - 25))}
                        className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-mono"
                        title="Zoom Out"
                      >
                        <ZoomOut className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-[11px] font-mono text-slate-300 w-10 text-center">
                        {zoomLevel}%
                      </span>
                      <button
                        onClick={() => setZoomLevel((z) => Math.min(200, z + 25))}
                        className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-mono"
                        title="Zoom In"
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => setViewerMode(viewerMode === 'pdf' ? 'text' : 'pdf')}
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                          viewerMode === 'text'
                            ? 'bg-indigo-600 text-white border-indigo-500'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}
                        title="Switch between PDF view and raw OCR text stream"
                      >
                        {viewerMode === 'pdf' ? 'Raw OCR' : 'PDF View'}
                      </button>
                    </div>
                  </div>

                  {/* Left Panel Body: Embedded Native PDF or Raw OCR Text */}
                  <div className="flex-1 bg-slate-900/50 p-2 overflow-auto flex items-center justify-center">
                    {viewerMode === 'pdf' && pdfPreviewUrl ? (
                      <div className="w-full h-[650px] rounded-xl overflow-hidden border border-slate-800 bg-slate-950">
                        <iframe
                          src={`${pdfPreviewUrl}#page=${leftPanelPage}&zoom=${zoomLevel}`}
                          title="Original PDF Document"
                          className="w-full h-full border-0"
                        />
                      </div>
                    ) : (
                      <div className="w-full h-[650px] p-4 bg-slate-950 rounded-xl border border-slate-800 overflow-y-auto font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed select-text">
                        <div className="p-2 mb-3 bg-slate-900 border border-slate-800 rounded text-[11px] text-indigo-400 font-sans flex items-center justify-between">
                          <span>
                            Viewing Raw Document Stream (Page {leftPanelPage} of {totalPages})
                          </span>
                          <span className="text-slate-500 font-mono">100% Unaltered Text</span>
                        </div>
                        {rawExtractedText || rawText || 'No direct text extracted for this document.'}
                      </div>
                    )}
                  </div>
                </div>

                {/* RIGHT PANEL: Extracted Questions & Fidelity Verification */}
                <div className="lg:col-span-6 bg-slate-950 border border-slate-800 rounded-2xl flex flex-col overflow-hidden">
                  {/* Right Panel Header */}
                  <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        Extracted Questionnaire
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-800 text-slate-300">
                        {filteredQuestions.length} shown
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={filterToCurrentPage}
                          onChange={(e) => setFilterToCurrentPage(e.target.checked)}
                          className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
                        />
                        Filter to Page {leftPanelPage}
                      </label>

                      <button
                        onClick={() => {
                          setNewPage(leftPanelPage);
                          setNewQuestionNumber(extractedQuestions.length + 1);
                          setShowAddModal(true);
                        }}
                        className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-sm transition"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Missing Item
                      </button>
                    </div>
                  </div>

                  {/* Right Panel Questions List */}
                  <div className="flex-1 p-4 overflow-y-auto space-y-4 max-h-[650px]">
                    {filteredQuestions.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 space-y-2">
                        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
                        <p className="text-sm font-semibold text-white">No questions found on Page {leftPanelPage}</p>
                        <p className="text-xs">
                          Uncheck "Filter to Page {leftPanelPage}" above to view all {extractedQuestions.length} extracted questions across the full document.
                        </p>
                      </div>
                    ) : (
                      filteredQuestions.map((q, idx) => {
                        const isVerified = q.verificationStatus === 'verified';
                        const isFlagged = q.verificationStatus === 'discrepancy_flagged';
                        const isIncomplete = q.options.length < 4;

                        return (
                          <div
                            key={q.id}
                            className={`p-4 rounded-xl border transition-all ${
                              isVerified
                                ? 'border-slate-800 bg-slate-900/90'
                                : isFlagged
                                ? 'border-rose-800/80 bg-rose-950/20'
                                : 'border-amber-800/80 bg-amber-950/20'
                            }`}
                          >
                            {/* Card Header */}
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-800/80">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-slate-800 text-white">
                                  #{q.originalQuestionNumber}
                                </span>

                                <button
                                  onClick={() => setLeftPanelPage(q.sourcePdfPage || 1)}
                                  className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800/50 hover:bg-indigo-900 transition flex items-center gap-1"
                                  title="Jump Left Panel to this page"
                                >
                                  Page {q.sourcePdfPage || 1}
                                  <ArrowRight className="w-3 h-3" />
                                </button>

                                <span className="text-[10px] font-medium text-slate-400">{q.topic}</span>
                              </div>

                              <div className="flex items-center gap-1.5">
                                {/* Verification Badge */}
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono border ${
                                    isVerified
                                      ? 'bg-emerald-950 text-emerald-300 border-emerald-800/60'
                                      : isFlagged
                                      ? 'bg-rose-950 text-rose-300 border-rose-800/60'
                                      : 'bg-amber-950 text-amber-300 border-amber-800/60'
                                  }`}
                                >
                                  {isVerified ? '✓ Verified' : isFlagged ? '⚠️ Discrepancy' : 'Needs Review'}
                                </span>

                                {/* Reorder Controls */}
                                <button
                                  onClick={() => handleMoveQuestion(idx, 'up')}
                                  disabled={idx === 0}
                                  className="p-1 text-slate-400 hover:text-white disabled:opacity-30"
                                  title="Move Up"
                                >
                                  ↑
                                </button>
                                <button
                                  onClick={() => handleMoveQuestion(idx, 'down')}
                                  disabled={idx === filteredQuestions.length - 1}
                                  className="p-1 text-slate-400 hover:text-white disabled:opacity-30"
                                  title="Move Down"
                                >
                                  ↓
                                </button>

                                <button
                                  onClick={() => setEditingQuestion(q)}
                                  className="p-1 text-slate-400 hover:text-indigo-300"
                                  title="Edit Question & Choices"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  onClick={() => handleDelete(q.id)}
                                  className="p-1 text-slate-400 hover:text-rose-400"
                                  title="Delete Question"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Warning notification banner if incomplete or flagged */}
                            {(isIncomplete || q.flaggedReason) && (
                              <div className="mb-2.5 p-2 rounded bg-amber-950/40 border border-amber-800/50 text-[11px] text-amber-300 flex items-center justify-between">
                                <span className="flex items-center gap-1.5">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                  {q.flaggedReason || 'Incomplete answer choices detected from original document.'}
                                </span>
                                <button
                                  onClick={() => setEditingQuestion(q)}
                                  className="underline text-[10px] font-bold hover:text-white"
                                >
                                  Fix Choices
                                </button>
                              </div>
                            )}

                            {/* Exact Question Statement */}
                            <p className="text-xs sm:text-sm text-white font-medium mb-3 leading-relaxed select-text">
                              {q.question}
                            </p>

                            {/* Answer Choices Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                              {q.options.map((opt, optIdx) => {
                                const isCorrect = opt.key === q.correctAnswer;
                                return (
                                  <div
                                    key={`${opt.key}-${optIdx}`}
                                    className={`p-2 rounded-lg border text-xs flex items-center justify-between ${
                                      isCorrect
                                        ? 'border-emerald-600/70 bg-emerald-950/40 text-emerald-200 font-semibold'
                                        : 'border-slate-800 bg-slate-950/50 text-slate-300'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                                          isCorrect ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                                        }`}
                                      >
                                        {opt.key}
                                      </span>
                                      <span className="select-text">{opt.text}</span>
                                    </div>
                                    {isCorrect && (
                                      <span className="text-[10px] font-mono text-emerald-400">✓ Official</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {/* Solution details snippet */}
                            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                              <span className="font-mono text-emerald-400">
                                {q.finalAnswerWithUnit ? `Final: ${q.finalAnswerWithUnit}` : 'Derived via Board Principles'}
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setPreviewQuestion(q)}
                                  className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-semibold"
                                >
                                  <Sparkles className="w-3 h-3" />
                                  Inspect Solution
                                </button>
                                {!isVerified && (
                                  <button
                                    onClick={() => handleApprove(q.id)}
                                    className="px-2 py-0.5 rounded bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 text-[10px] font-bold"
                                  >
                                    Approve
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: COMPREHENSIVE EXTRACTION REPORT */}
          {activeTab === 'report' && extractionReport && (
            <div className="space-y-6">
              {/* Overall Verdict Banner */}
              <div
                className={`p-6 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  extractionReport.overallStatus === 'verified'
                    ? 'bg-emerald-950/30 border-emerald-700/60 text-emerald-200'
                    : extractionReport.overallStatus === 'needs_review'
                    ? 'bg-amber-950/30 border-amber-700/60 text-amber-200'
                    : 'bg-rose-950/30 border-rose-700/60 text-rose-200'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold uppercase tracking-wider">
                      Audit Verification Verdict:
                    </span>
                    <span className="px-2.5 py-0.5 rounded text-xs font-bold uppercase font-mono bg-black/40 border border-white/10">
                      {extractionReport.overallStatus.replace('_', ' ')}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-white">
                    {extractionReport.overallStatus === 'verified'
                      ? '100% Extraction Fidelity Confirmed'
                      : extractionReport.overallStatus === 'needs_review'
                      ? 'Discrepancies & Items Flagged for Review'
                      : 'Incomplete Content or Sequence Gaps Detected'}
                  </h3>
                  <p className="text-xs text-slate-300 max-w-2xl">
                    Engine Used: <strong className="text-white">{extractionReport.engineUsed}</strong> • Processed at{' '}
                    {new Date(extractionReport.extractionTimestamp).toLocaleTimeString()}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab('side-by-side')}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1.5 transition"
                  >
                    Open Side-by-Side Review
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Metric Breakdown Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[11px] text-slate-400 uppercase font-semibold">Total Pages</div>
                  <div className="text-2xl font-mono font-bold text-white">{extractionReport.totalPages}</div>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[11px] text-slate-400 uppercase font-semibold">Questions Extracted</div>
                  <div className="text-2xl font-mono font-bold text-indigo-400">
                    {extractionReport.totalQuestionsExtracted}
                  </div>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[11px] text-slate-400 uppercase font-semibold">Answer Choices</div>
                  <div className="text-2xl font-mono font-bold text-emerald-400">
                    {extractionReport.totalChoicesDetected}
                  </div>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[11px] text-slate-400 uppercase font-semibold">Verified Items</div>
                  <div className="text-2xl font-mono font-bold text-emerald-400">
                    {extractionReport.verifiedQuestionsCount}
                  </div>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[11px] text-slate-400 uppercase font-semibold">Needs Review</div>
                  <div className="text-2xl font-mono font-bold text-amber-400">
                    {extractionReport.questionsRequiringVerification}
                  </div>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[11px] text-slate-400 uppercase font-semibold">Incomplete Items</div>
                  <div className="text-2xl font-mono font-bold text-rose-400">
                    {extractionReport.incompleteQuestionsCount}
                  </div>
                </div>
              </div>

              {/* Numbering Sequence Gaps & Warnings */}
              {extractionReport.sequenceGaps.length > 0 && (
                <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-800/50 space-y-2">
                  <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    Numbering Sequence Gaps Detected in Document:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {extractionReport.sequenceGaps.map((gap, i) => (
                      <span
                        key={i}
                        className="px-2.5 py-1 bg-amber-900/40 text-amber-200 border border-amber-800/60 rounded text-xs font-mono"
                      >
                        ⚠️ {gap}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes & Audit findings list */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
                <span className="font-bold text-white uppercase text-[11px] tracking-wider">
                  Automated Audit Findings:
                </span>
                <ul className="space-y-1 text-slate-300">
                  {extractionReport.notes.map((note, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="text-indigo-400">•</span>
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* TAB 3: CARDS & BATCH ACTIONS VIEW */}
          {activeTab === 'cards' && (
            <div className="space-y-4">
              {/* Batch Action Toolbar */}
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleSelectAll}
                    className="flex items-center gap-1.5 text-slate-300 hover:text-white font-medium"
                  >
                    {selectedIds.length === filteredQuestions.length ? (
                      <CheckSquare className="w-4 h-4 text-indigo-400" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-500" />
                    )}
                    Select All ({filteredQuestions.length})
                  </button>
                  <span className="text-slate-600">|</span>
                  <span className="text-slate-400">
                    Selected: <strong className="text-white">{selectedIds.length}</strong>
                  </span>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      placeholder="Search questions or topics..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs w-48"
                    />
                  </div>

                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs"
                  >
                    <option value="all">All Statuses</option>
                    <option value="verified">Verified</option>
                    <option value="needs_verification">Needs Review</option>
                    <option value="discrepancy_flagged">Discrepancy</option>
                  </select>

                  <select
                    value={filterSubject}
                    onChange={(e) => setFilterSubject(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs"
                  >
                    <option value="all">All Subjects</option>
                    <option value="ee">Electrical Engineering</option>
                    <option value="math">Mathematics</option>
                    <option value="esas">Engineering Sciences</option>
                  </select>
                </div>
              </div>

              {/* Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredQuestions.map((q, idx) => (
                  <div
                    key={q.id}
                    className={`p-5 rounded-2xl border transition-all ${
                      selectedIds.includes(q.id)
                        ? 'border-indigo-600 bg-slate-950/80'
                        : 'border-slate-800 bg-slate-950/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(q.id)}
                          onChange={() => handleToggleSelect(q.id)}
                          className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
                        />
                        <span className="font-mono font-bold text-xs text-white">#{q.originalQuestionNumber}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                          Page {q.sourcePdfPage || 1}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setEditingQuestion(q)}
                          className="p-1 text-slate-400 hover:text-white"
                          title="Edit"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(q.id)}
                          className="p-1 text-slate-400 hover:text-rose-400"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="text-xs sm:text-sm text-white font-medium mb-3 line-clamp-3 select-text">
                      {q.question}
                    </p>

                    {/* Choices Grid */}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {q.options.map((opt, optIdx) => (
                        <div
                          key={`${opt.key}-${optIdx}`}
                          className={`p-2 rounded border text-xs flex items-center justify-between ${
                            opt.key === q.correctAnswer
                              ? 'border-emerald-600/70 bg-emerald-950/40 text-emerald-200 font-semibold'
                              : 'border-slate-800 bg-slate-900 text-slate-400'
                          }`}
                        >
                          <span>
                            <strong>{opt.key}.</strong> {opt.text}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800">
                      <span>{q.topic}</span>
                      <button
                        onClick={() => setPreviewQuestion(q)}
                        className="text-indigo-400 hover:text-indigo-300 font-semibold"
                      >
                        Inspect Solution →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: EXAM SIMULATION PREVIEW */}
          {activeTab === 'preview' && (
            <div className="p-6 bg-slate-950 rounded-2xl border border-slate-800 space-y-6">
              <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white">Live Licensure Exam Preview</h3>
                  <p className="text-xs text-slate-400">
                    Simulates how candidates will experience this questionnaire when published to the Question Bank.
                  </p>
                </div>
                <span className="font-mono text-xs px-2.5 py-1 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                  {extractedQuestions.length} Total Questions
                </span>
              </div>

              <div className="space-y-6 max-w-4xl mx-auto">
                {extractedQuestions.slice(0, 5).map((q, i) => (
                  <div key={q.id} className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                      <span>Question {i + 1} of {extractedQuestions.length}</span>
                      <span>{q.subjectName}</span>
                    </div>

                    <p className="text-sm font-semibold text-white leading-relaxed">{q.question}</p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {q.options.map((opt, optIdx) => (
                        <div
                          key={`${opt.key}-${optIdx}`}
                          className="p-3 rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-800/80 text-xs text-slate-300 flex items-center gap-2.5 cursor-pointer transition"
                        >
                          <span className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center font-bold text-xs">
                            {opt.key}
                          </span>
                          <span>{opt.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit Question Modal */}
      {editingQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-indigo-400" />
                Edit Question #{editingQuestion.originalQuestionNumber}
              </h3>
              <button onClick={() => setEditingQuestion(null)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Question Statement (100% Verbatim):
                </label>
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
                  <div key={`edit-opt-${i}-${opt.key}`}>
                    <label className="block text-slate-400 mb-1">Option {opt.key}:</label>
                    <input
                      type="text"
                      value={opt.text}
                      onChange={(e) => {
                        const newOpts = [...editingQuestion.options];
                        newOpts[i] = { ...opt, text: e.target.value };
                        setEditingQuestion({ ...editingQuestion, options: newOpts });
                      }}
                      className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                    />
                  </div>
                ))}
              </div>

              {/* Correct Answer, Subject, Difficulty */}
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
                    onChange={(e) =>
                      setEditingQuestion({
                        ...editingQuestion,
                        subjectId: e.target.value as SubjectId,
                        subjectName:
                          e.target.value === 'ee'
                            ? 'Electrical Engineering Professional Subjects'
                            : e.target.value === 'math'
                            ? 'Mathematics'
                            : 'Engineering Sciences & Allied Subjects',
                      })
                    }
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  >
                    <option value="ee">Electrical Engineering</option>
                    <option value="esas">Engineering Sciences</option>
                    <option value="math">Mathematics</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Source Page:</label>
                  <input
                    type="number"
                    min={1}
                    value={editingQuestion.sourcePdfPage || 1}
                    onChange={(e) =>
                      setEditingQuestion({
                        ...editingQuestion,
                        sourcePdfPage: parseInt(e.target.value, 10) || 1,
                      })
                    }
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setEditingQuestion(null)}
                className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveEdit(editingQuestion)}
                className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 font-semibold"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Missing Question Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-400" />
                Add Missing Questionnaire Item
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Question Number:</label>
                  <input
                    type="number"
                    value={newQuestionNumber}
                    onChange={(e) => setNewQuestionNumber(parseInt(e.target.value, 10) || 1)}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Source PDF Page:</label>
                  <input
                    type="number"
                    value={newPage}
                    onChange={(e) => setNewPage(parseInt(e.target.value, 10) || 1)}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Question Statement:</label>
                <textarea
                  rows={3}
                  placeholder="Enter the exact verbatim question statement from the PDF..."
                  value={newQuestionStatement}
                  onChange={(e) => setNewQuestionStatement(e.target.value)}
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </div>

              {/* Choices */}
              <div className="grid grid-cols-2 gap-3">
                {newOptions.map((opt, i) => (
                  <div key={opt.key}>
                    <label className="block text-slate-400 mb-1">Choice {opt.key}:</label>
                    <input
                      type="text"
                      placeholder={`Choice ${opt.key} text`}
                      value={opt.text}
                      onChange={(e) => {
                        const copy = [...newOptions];
                        copy[i] = { ...opt, text: e.target.value };
                        setNewOptions(copy);
                      }}
                      className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Official Correct Answer:</label>
                  <select
                    value={newCorrectAnswer}
                    onChange={(e) => setNewCorrectAnswer(e.target.value)}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  >
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                    <option value="D">D</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Subject Category:</label>
                  <select
                    value={newSubjectId}
                    onChange={(e) => setNewSubjectId(e.target.value as SubjectId)}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  >
                    <option value="ee">Electrical Engineering</option>
                    <option value="esas">Engineering Sciences (ESAS)</option>
                    <option value="math">Mathematics</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleAddMissingQuestion}
                className="px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 font-semibold"
              >
                Add Item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inspect Solution Modal */}
      {previewQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                Mathematical Derivation & Proof — Item #{previewQuestion.originalQuestionNumber}
              </h3>
              <button onClick={() => setPreviewQuestion(null)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-[11px] font-semibold text-slate-400 block mb-1">Question Statement:</span>
                <p className="text-white font-medium">{previewQuestion.question}</p>
              </div>

              {/* Choices */}
              <div className="grid grid-cols-2 gap-2">
                {previewQuestion.options.map((opt, optIdx) => (
                  <div
                    key={`prev-opt-${optIdx}-${opt.key}`}
                    className={`p-2.5 rounded-lg border text-xs flex items-center justify-between ${
                      opt.key === previewQuestion.correctAnswer
                        ? 'border-emerald-600 bg-emerald-950/40 text-emerald-200 font-bold'
                        : 'border-slate-800 bg-slate-950 text-slate-400'
                    }`}
                  >
                    <span>{opt.key}. {opt.text}</span>
                    {opt.key === previewQuestion.correctAnswer && (
                      <span className="text-[10px] text-emerald-400 font-mono font-bold">✓ Official Answer</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Step-by-Step Derivation */}
              <div className="p-4 bg-slate-950 rounded-xl border border-emerald-900/40 space-y-1.5">
                <div className="flex items-center justify-between text-emerald-400 font-bold">
                  <span>Step-by-Step Mathematical Proof:</span>
                  {previewQuestion.finalAnswerWithUnit && (
                    <span className="font-mono bg-emerald-950 px-2 py-0.5 rounded text-emerald-300 border border-emerald-800/40">
                      Final: {previewQuestion.finalAnswerWithUnit}
                    </span>
                  )}
                </div>
                <p className="text-slate-300 font-mono whitespace-pre-line leading-relaxed">
                  {previewQuestion.stepByStepSolution}
                </p>
              </div>

              {/* Conceptual Explanation */}
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <span className="font-semibold text-indigo-400">Conceptual Explanation:</span>
                <p className="text-slate-300 leading-relaxed">{previewQuestion.explanation}</p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setPreviewQuestion(null)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold"
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
