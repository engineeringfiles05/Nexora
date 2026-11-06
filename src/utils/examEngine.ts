/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface QuestionChoice {
  key: string;
  text: string;
}

export interface EngineQuestion {
  id: string;
  question: string;
  options: QuestionChoice[];
  correctAnswer: string;
  subjectId: string;
  subjectName: string;
  topic: string;
  difficulty: 'Easy' | 'Average' | 'Difficult';
  stepByStepSolution?: string;
  explanation?: string;
}

export interface ExamScoreResult {
  totalQuestions: number;
  answeredCount: number;
  unansweredCount: number;
  correctCount: number;
  incorrectCount: number;
  scorePercentage: number;
  isPassed: boolean; // Board criteria: >= 70% overall and no subject < 50%
  subjectBreakdown: Record<string, {
    subjectName: string;
    total: number;
    correct: number;
    percentage: number;
    passed: boolean;
  }>;
  weakTopics: string[];
  strongTopics: string[];
}

/**
 * Calculates official board examination score, subject performance breakdown,
 * passing status based on standard licensure rules (>=70% overall, >=50% per subject),
 * and identifies weak and strong topics for reviewee focus.
 */
export function calculateExamScore(
  questions: EngineQuestion[],
  userAnswers: Record<string, string>
): ExamScoreResult {
  const totalQuestions = questions.length;
  if (totalQuestions === 0) {
    return {
      totalQuestions: 0,
      answeredCount: 0,
      unansweredCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      scorePercentage: 0,
      isPassed: false,
      subjectBreakdown: {},
      weakTopics: [],
      strongTopics: [],
    };
  }

  let correctCount = 0;
  let answeredCount = 0;

  const subjectMap: Record<string, { subjectName: string; total: number; correct: number }> = {};
  const topicMap: Record<string, { total: number; correct: number }> = {};

  for (const q of questions) {
    const selected = userAnswers[q.id];
    const isAnswered = selected !== undefined && selected !== '';
    if (isAnswered) answeredCount++;

    const isCorrect = isAnswered && selected.trim().toUpperCase() === q.correctAnswer.trim().toUpperCase();
    if (isCorrect) correctCount++;

    // Subject tracking
    if (!subjectMap[q.subjectId]) {
      subjectMap[q.subjectId] = {
        subjectName: q.subjectName || q.subjectId.toUpperCase(),
        total: 0,
        correct: 0,
      };
    }
    subjectMap[q.subjectId].total += 1;
    if (isCorrect) subjectMap[q.subjectId].correct += 1;

    // Topic tracking
    const topicKey = q.topic || 'General';
    if (!topicMap[topicKey]) {
      topicMap[topicKey] = { total: 0, correct: 0 };
    }
    topicMap[topicKey].total += 1;
    if (isCorrect) topicMap[topicKey].correct += 1;
  }

  const incorrectCount = answeredCount - correctCount;
  const unansweredCount = totalQuestions - answeredCount;
  const scorePercentage = Math.round((correctCount / totalQuestions) * 100);

  // Subject breakdown & sub-pass rules
  const subjectBreakdown: ExamScoreResult['subjectBreakdown'] = {};
  let anySubjectBelow50 = false;

  for (const [subjId, stats] of Object.entries(subjectMap)) {
    const pct = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
    // Compare exact counts: rounding must never lift 49.5% over the 50% floor.
    const passed = stats.correct * 100 >= stats.total * 50;
    if (!passed) anySubjectBelow50 = true;

    subjectBreakdown[subjId] = {
      subjectName: stats.subjectName,
      total: stats.total,
      correct: stats.correct,
      percentage: pct,
      passed,
    };
  }

  // scorePercentage is rounded for display; the pass mark uses exact counts.
  const isPassed = correctCount * 100 >= totalQuestions * 70 && !anySubjectBelow50;

  // Weak and Strong topics
  const weakTopics: string[] = [];
  const strongTopics: string[] = [];

  for (const [topic, stats] of Object.entries(topicMap)) {
    const pct = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
    if (pct < 60) {
      weakTopics.push(topic);
    } else if (pct >= 80) {
      strongTopics.push(topic);
    }
  }

  return {
    totalQuestions,
    answeredCount,
    unansweredCount,
    correctCount,
    incorrectCount,
    scorePercentage,
    isPassed,
    subjectBreakdown,
    weakTopics,
    strongTopics,
  };
}

/**
 * Normalizes text for linguistic and mathematical similarity checking
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/(\d+)([a-z]+)/g, '$1 $2') // split 50A -> 50 a, 220V -> 220 v
    .replace(/\b(amperes|amps|amp)\b/g, 'a')
    .replace(/\b(volts|volt)\b/g, 'v')
    .replace(/\b(ohms|ohm)\b/g, 'ohm')
    .replace(/\b(watts|watt)\b/g, 'w')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates token similarity between two strings (0.0 to 1.0)
 */
export function calculateTextSimilarity(textA: string, textB: string): number {
  const normA = normalizeText(textA);
  const normB = normalizeText(textB);

  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0.0;

  const wordsA = normA.split(' ').filter(t => t.length >= 2);
  const wordsB = normB.split(' ').filter(t => t.length >= 2);

  if (wordsA.length === 0 || wordsB.length === 0) return 0.0;

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);

  let matchCount = 0;
  for (const wordA of setA) {
    if (setB.has(wordA)) {
      matchCount++;
    } else {
      // Check prefix matching for word variations (e.g., calculate vs calculation, amp vs ampere)
      for (const wordB of setB) {
        if (wordA.length > 3 && wordB.length > 3 && (wordA.startsWith(wordB) || wordB.startsWith(wordA))) {
          matchCount += 0.8;
          break;
        }
      }
    }
  }

  const union = setA.size + setB.size - matchCount;
  return union <= 0 ? 0 : Math.min(1.0, matchCount / union);
}

export interface DuplicateMatchResult {
  isDuplicate: boolean;
  matchedQuestionId?: string;
  matchedQuestionText?: string;
  similarityScore: number;
}

/**
 * Checks if a candidate question is a duplicate of any existing question in the bank
 */
export function checkQuestionDuplicate(
  candidateText: string,
  existingQuestions: { id: string; question: string }[],
  similarityThreshold = 0.75
): DuplicateMatchResult {
  let highestSimilarity = 0;
  let bestMatch: { id: string; question: string } | null = null;

  for (const item of existingQuestions) {
    const sim = calculateTextSimilarity(candidateText, item.question);
    if (sim > highestSimilarity) {
      highestSimilarity = sim;
      bestMatch = item;
    }
  }

  return {
    isDuplicate: highestSimilarity >= similarityThreshold,
    matchedQuestionId: bestMatch?.id,
    matchedQuestionText: bestMatch?.question,
    similarityScore: Math.round(highestSimilarity * 100),
  };
}

/**
 * Formats time in seconds to mm:ss or hh:mm:ss
 */
export function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
