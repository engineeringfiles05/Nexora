/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type QuestionnaireFileKind = 'pdf' | 'text';

/** The extension wins because browsers often report an empty or generic MIME type. */
export function classifyQuestionnaireFile(file: { name: string; type: string }): QuestionnaireFileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.txt')) return 'text';
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type === 'text/plain') return 'text';
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
