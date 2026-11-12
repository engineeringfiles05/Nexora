/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Examination programs and their subject categories, used by the PDF importer (program and
 * subject selection) and anywhere a program's subjects are listed.
 *
 * To add a program: add an entry here and its id to the Course type (src/types/index.ts)
 * and to the course list in firestore.rules. To add a subject: add its id to SubjectId and
 * SUBJECT_NAMES (utils/questionExtractor.ts) and list it under its programs.
 */

import type { Course, SubjectId } from '../types/index.ts';

export interface ProgramSubject {
  id: SubjectId;
  code: string;
  name: string;
}

export interface ExamProgram {
  id: Course;
  name: string;
  subjects: ProgramSubject[];
}

const REE_SUBJECTS: ProgramSubject[] = [
  { id: 'math', code: 'MATH', name: 'Mathematics' },
  { id: 'esas', code: 'ESAS', name: 'Engineering Sciences and Allied Subjects' },
  { id: 'ee', code: 'EE', name: 'Electrical Engineering' },
];

export const EXAM_PROGRAMS: ExamProgram[] = [
  { id: 'REE', name: 'Registered Electrical Engineer', subjects: REE_SUBJECTS },
  // RME uses the same three categories until its own subjects are defined above.
  { id: 'RME', name: 'Registered Master Electrician', subjects: REE_SUBJECTS },
];

export function programById(id: Course): ExamProgram {
  return EXAM_PROGRAMS.find((p) => p.id === id) ?? EXAM_PROGRAMS[0]!;
}
