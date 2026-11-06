/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'admin' | 'reviewee';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  title?: string;
  targetExam?: string;
  examDate?: string;
  enrolledAt: string;
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
  version?: number;
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
}
