/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'admin' | 'reviewee';

/** The board exam a reviewee is preparing for. */
export type Course = 'REE' | 'RME';

/**
 * Whether an account may use NEXORA Academy. Only "active" accounts can open protected
 * pages; firestore.rules enforces the same. Profiles without a status are active.
 */
export type UserStatus = 'active' | 'inactive' | 'suspended' | 'pending';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  /** Display only. Permissions come from the verified sign-in (see auth/roles.ts and firestore.rules). */
  role: UserRole;
  avatar: string;
  title?: string;
  targetExam?: string;
  examDate?: string;
  enrolledAt: string;
  /** null: the administrator removed course access. Absent: not chosen yet. */
  course?: Course | null;
  contactNumber?: string;
  /** How the account signs in: 'password' (email and password) or 'google.com'. */
  authProvider?: string;
  updatedAt?: string;
  status?: UserStatus;
  /** Shown to the person when their account is not active. */
  statusReason?: string;
  statusChangedAt?: string;
  lastLoginAt?: string;
  /** uid of the administrator who created the account, for accounts not self-registered. */
  createdBy?: string;
}

export type SubjectId = 'math' | 'esas' | 'ee';

export interface Subject {
  id: SubjectId;
  name: string;
  code: string;
  description: string;
  color: string;
  borderColor: string;
  bgLight: string;
  topics: string[];
  weightPercent: number; // e.g. Math 25%, ESAS 30%, EE 45%
}

export type DifficultyLevel = 'Easy' | 'Average' | 'Difficult';

export type VerificationStatus =
  | 'verified'
  | 'needs_verification'
  | 'discrepancy_flagged'
  | 'manual_override';

export interface QuestionChoice {
  key: string;
  text: string;
}

export interface GivenValue {
  label: string;
  value: string;
}

export interface Question {
  id: string;
  originalQuestionNumber?: number;
  question: string;
  options: QuestionChoice[];
  correctAnswer: string; // 'A' | 'B' | 'C' | 'D'
  extractedAnswerKey?: string;
  explanation: string;
  stepByStepSolution?: string;
  formulasUsed?: string[];
  givenValues?: GivenValue[];
  finalAnswerWithUnit?: string;
  subjectId: SubjectId;
  subjectName: string;
  topic: string;
  subtopic?: string;
  difficulty: DifficultyLevel;
  diagramUrl?: string;
  hasDiagram?: boolean;
  hasMathEquation?: boolean;
  sourcePdfId?: string;
  sourcePdfName?: string;
  sourcePdfPage?: number;
  extractionConfidence: number; // 0 to 100
  verificationStatus: VerificationStatus;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  flaggedReason?: string;
  /** Which course's reviewees may use it (enforced by firestore.rules). Missing means REE. */
  course?: Course;
  version?: number;
  originalQuestionText?: string; // Exact unedited text extracted from PDF
  originalOptions?: QuestionChoice[]; // Exact unedited choices from PDF
  ocrQuality?: 'high' | 'medium' | 'low';

  // --- Extraction traceability (absent on questions authored before the strict importer) ---
  /** Every page the question's text was read from, in order. sourcePdfPage is the first. */
  sourcePdfPages?: number[];
  /** Where the question sits on each page, for highlighting in the verification viewer. */
  sourceRegions?: SourceRegion[];
  /** SHA-256 of the uploaded file, shared by every question from the same PDF. */
  sourceDocumentHash?: string;
  /** Hash of the normalized question text and choices; used to block duplicate imports. */
  contentFingerprint?: string;
  /** The text block exactly as read from the PDF, line breaks included. */
  sourceBlockText?: string;
  /** A solution or explanation printed in the PDF itself, kept verbatim. */
  sourceSolutionText?: string;
  extractionMethod?: ExtractionMethod;
  extractionIssues?: ExtractionIssue[];
  /** Whether the text and choices match the PDF. Independent of whether the answer is right. */
  contentStatus?: ContentStatus;
  /** Whether a second, independent reading of the page agreed with the extracted text. */
  crossCheck?: CrossCheckResult;
  /** Imported questions start 'pending' and reach reviewees only once an admin approves them. */
  reviewStatus?: ReviewStatus;
  reviewedAt?: string;
  answerSource?: AnswerSource;
  figures?: ExtractedFigure[];
  /** AI output is stored here and never written into question or options. */
  aiSolution?: AiSolution;
}

export type ExtractionMethod = 'native' | 'ocr' | 'native+ocr' | 'text' | 'manual';
export type ContentStatus = 'verified' | 'needs_review' | 'incomplete';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export type AnswerSource = 'pdf_key' | 'ai' | 'admin' | 'none';
export type CrossCheckResult = 'agree' | 'differ' | 'not_run';
export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ExtractionIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  field?: 'stem' | 'choice' | 'answer' | 'figure' | 'number' | 'page';
  choiceKey?: string;
  page?: number;
  /** The two readings when the text layer and the page image disagree. */
  readings?: { textLayer?: string; pageImage?: string };
  /** An administrator reviewed this issue and confirmed the question anyway. */
  acknowledged?: boolean;
}

/** A rectangle on a page, as fractions of the page size, origin at the top left. */
export interface SourceRegion {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ExtractedFigure {
  id: string;
  page: number;
  region: SourceRegion;
  kind: 'image' | 'diagram' | 'table' | 'attachment';
  dataUrl?: string;
  /** Text printed inside the figure (circuit labels and the like), verbatim. */
  labels?: string[];
  attachedBy: 'auto' | 'admin';
}

export interface AiSolution {
  /** Choice key the AI picked, or undefined when it was not confident enough to pick one. */
  suggestedAnswer?: string;
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
  stepByStepSolution: string;
  formulasUsed: string[];
  givenValues: GivenValue[];
  finalAnswerWithUnit: string;
  subjectId?: SubjectId;
  topic?: string;
  difficulty?: DifficultyLevel;
  model: string;
  generatedAt: string;
}

export interface PageExtractionReport {
  page: number;
  method: 'native' | 'ocr' | 'native+ocr' | 'text' | 'none';
  textLayerChars: number;
  imageReadingChars?: number;
  questionNumbers: number[];
  status: 'ok' | 'warning' | 'error';
  issues: string[];
  /** Running headers, footers and page numbers left out of question text, listed so nothing disappears silently. */
  removedLines: string[];
}

export type ExtractionReportStatus = 'verified' | 'needs_review' | 'incomplete' | 'failed';

export interface ExtractionReport {
  filename: string;
  fileSize?: string;
  totalPages: number;
  totalQuestionsDetected: number;
  totalQuestionsExtracted: number;
  totalChoicesDetected: number;
  questionsRequiringVerification: number;
  verifiedQuestionsCount: number;
  flaggedDiscrepanciesCount: number;
  incompleteQuestionsCount: number;
  pagesWithIssues: number[];
  sequenceGaps: string[];
  overallStatus: ExtractionReportStatus;
  engineUsed: string;
  notes: string[];
  extractionTimestamp: string;
  // --- Strict importer additions ---
  documentHash?: string;
  pages?: PageExtractionReport[];
  missingQuestionNumbers?: number[];
  duplicateQuestionNumbers?: number[];
  pagesWithOcrIssues?: number[];
  warnings?: string[];
  crossCheckedCount?: number;
  approvedCount?: number;
  answerKeyFound?: boolean;
  imageReadingAvailable?: boolean;
}

export interface PdfSource {
  id: string;
  filename: string;
  originalName: string;
  fileSize: string;
  pageCount: number;
  uploadDate: string;
  status: 'uploaded' | 'processing' | 'extracted' | 'published' | 'error';
  questionsCount: number;
  verifiedCount: number;
  needsReviewCount: number;
  subjectCoverage: { subjectId: SubjectId; count: number }[];
  isPublicToReviewees: boolean;
  allowedModes: ('quiz' | 'practice' | 'preboard' | 'mock')[];
  rawContentSnippet?: string;
  notes?: string;
  extractionReport?: ExtractionReport;
  /** SHA-256 of the uploaded file, so the same PDF is recognised under any filename. */
  fileHash?: string;
  /** Which course's reviewees may use it (enforced by firestore.rules). Missing means REE. */
  course?: Course;
}

export type ExamType =
  | 'pre_test'
  | 'quiz'
  | 'practice'
  | 'pre_board'
  | 'final_mock'
  | 'pdf_quiz';

export interface ExamConfig {
  type: ExamType;
  title: string;
  description: string;
  subjectId?: SubjectId | 'all';
  topic?: string;
  pdfSourceId?: string;
  difficulty?: DifficultyLevel | 'mixed';
  questionCount: number;
  durationMinutes: number;
  passingPercentage: number;
  randomizeQuestions: boolean;
  randomizeChoices: boolean;
  instantFeedback: boolean;
}

export interface ExamResult {
  id: string;
  examId: string;
  userId: string;
  userName: string;
  type: ExamType;
  title: string;
  subjectId?: string;
  completedAt: string;
  durationSeconds: number;
  totalQuestions: number;
  answeredCount: number;
  unansweredCount: number;
  correctCount: number;
  incorrectCount: number;
  scorePercentage: number;
  isPassed: boolean;
  userAnswers: Record<string, string>;
  flaggedQuestionIds: string[];
  subjectBreakdown: Record<string, {
    subjectName: string;
    total: number;
    correct: number;
    percentage: number;
    passed: boolean;
  }>;
  weakTopics: string[];
  strongTopics: string[];
  // Exactly what was asked, in order. Absent on results saved before snapshots existed.
  questionSnapshots?: Question[];
  examConfig?: ExamConfig;
}

export interface AuditLog {
  id: string;
  adminName: string;
  action: string;
  details: string;
  timestamp: string;
  badge?: string;
  /** 'users' for account management; absent for content actions. */
  category?: 'users' | 'content';
  targetUserId?: string;
  targetUserName?: string;
  targetUserEmail?: string;
  /** Full ISO date and time (older entries only have `timestamp`, a time of day). */
  createdAt?: string;
}
