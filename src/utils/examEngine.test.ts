import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateExamScore,
  calculateTextSimilarity,
  checkQuestionDuplicate,
  formatTimeRemaining,
  type EngineQuestion,
} from './examEngine.ts';

test('examEngine: calculateExamScore computes correct percentages and passing status', () => {
  const sampleQuestions: EngineQuestion[] = [
    {
      id: 'q1',
      question: 'What is the unit of reactive power?',
      options: [
        { key: 'A', text: 'Watts' },
        { key: 'B', text: 'VAR' },
        { key: 'C', text: 'VA' },
        { key: 'D', text: 'Joules' },
      ],
      correctAnswer: 'B',
      subjectId: 'ee',
      subjectName: 'Electrical Engineering',
      topic: 'AC Circuits',
      difficulty: 'Easy',
    },
    {
      id: 'q2',
      question: 'What is the derivative of sin(2x)?',
      options: [
        { key: 'A', text: '2 cos(2x)' },
        { key: 'B', text: '-2 cos(2x)' },
        { key: 'C', text: 'cos(2x)' },
        { key: 'D', text: '0.5 cos(2x)' },
      ],
      correctAnswer: 'A',
      subjectId: 'math',
      subjectName: 'Mathematics',
      topic: 'Calculus',
      difficulty: 'Easy',
    },
    {
      id: 'q3',
      question: 'Under thermodynamic adiabatic process, what is zero?',
      options: [
        { key: 'A', text: 'Work done' },
        { key: 'B', text: 'Heat transfer' },
        { key: 'C', text: 'Temperature change' },
        { key: 'D', text: 'Pressure change' },
      ],
      correctAnswer: 'B',
      subjectId: 'esas',
      subjectName: 'Engineering Sciences',
      topic: 'Thermodynamics',
      difficulty: 'Average',
    },
  ];

  // User answers 2 correctly out of 3 (67% score -> failing because < 70%)
  const userAnswers1 = {
    q1: 'B', // correct
    q2: 'A', // correct
    q3: 'A', // incorrect
  };

  const result1 = calculateExamScore(sampleQuestions, userAnswers1);
  assert.equal(result1.totalQuestions, 3);
  assert.equal(result1.correctCount, 2);
  assert.equal(result1.incorrectCount, 1);
  assert.equal(result1.unansweredCount, 0);
  assert.equal(result1.scorePercentage, 67);
  assert.equal(result1.isPassed, false);
  assert.equal(result1.subjectBreakdown['ee'].percentage, 100);
  assert.equal(result1.subjectBreakdown['math'].percentage, 100);
  assert.equal(result1.subjectBreakdown['esas'].percentage, 0);

  // User answers all 3 correctly (100% score -> passed)
  const userAnswers2 = {
    q1: 'B',
    q2: 'A',
    q3: 'B',
  };
  const result2 = calculateExamScore(sampleQuestions, userAnswers2);
  assert.equal(result2.scorePercentage, 100);
  assert.equal(result2.isPassed, true);
});

test('examEngine: calculateTextSimilarity and checkQuestionDuplicate detects similar questions', () => {
  const existing = [
    {
      id: 'ex-1',
      question: 'A 220V shunt motor has an armature resistance of 0.2 ohms. Find the back EMF when armature current is 50A.',
    },
    {
      id: 'ex-2',
      question: 'Calculate the total capacitance of two 10 microfarad capacitors connected in series.',
    },
  ];

  // Minor wording change should trigger duplicate detection
  const candidateDuplicate = 'A 220V DC shunt motor has armature resistance of 0.2 ohm. Calculate the back EMF when armature current is 50 amperes.';
  const duplicateCheck = checkQuestionDuplicate(candidateDuplicate, existing, 0.70);

  assert.equal(duplicateCheck.isDuplicate, true);
  assert.equal(duplicateCheck.matchedQuestionId, 'ex-1');
  assert.ok(duplicateCheck.similarityScore >= 70);

  // Totally distinct question
  const candidateDistinct = 'Define Coulomb law and calculate electric field intensity at 2 meters from 5 microCoulomb charge.';
  const distinctCheck = checkQuestionDuplicate(candidateDistinct, existing, 0.70);
  assert.equal(distinctCheck.isDuplicate, false);
});

test('examEngine: formatTimeRemaining formats hh:mm:ss and mm:ss accurately', () => {
  assert.equal(formatTimeRemaining(3665), '01:01:05');
  assert.equal(formatTimeRemaining(125), '02:05');
  assert.equal(formatTimeRemaining(0), '00:00');
});
