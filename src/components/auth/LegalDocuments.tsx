/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export type LegalDocument = 'terms' | 'privacy';

const UPDATED = 'November 2026';

const TERMS: { heading: string; body: string }[] = [
  {
    heading: 'Your account',
    body: 'You need an account to use NEXORA Academy review materials and examinations. Give accurate details, keep your password private, and do not share your account. You are responsible for activity under your account.',
  },
  {
    heading: 'Review materials',
    body: 'Questions, solutions, PDF questionnaires and examinations are provided for your personal board exam preparation only. Do not copy, publish, sell or redistribute them.',
  },
  {
    heading: 'Fair use',
    body: 'Do not try to access administrator pages, other reviewees’ results, or parts of the service you have not been given access to, and do not disrupt the service. Accounts that break these terms may be suspended.',
  },
  {
    heading: 'No guarantee of results',
    body: 'NEXORA Academy helps you prepare, but scores on practice, pre-board and mock board examinations do not guarantee a result in the official PRC licensure examination.',
  },
  {
    heading: 'Changes',
    body: 'These terms may be updated. Continuing to use your account after an update means you accept the updated terms.',
  },
];

const PRIVACY: { heading: string; body: string }[] = [
  {
    heading: 'What we collect',
    body: 'Your complete name, email address, chosen course (REE or RME), optional contact number, and your examination answers, scores and history.',
  },
  {
    heading: 'How we use it',
    body: 'To run your account, show your results and progress, and let NEXORA Academy administrators monitor reviewee performance. We do not sell your personal information.',
  },
  {
    heading: 'How it is stored',
    body: 'Accounts are managed with Google Firebase Authentication, which stores passwords in hashed form; NEXORA Academy never sees your password. Profile and examination data are kept in Google Cloud Firestore and are only readable by you and the academy’s administrator.',
  },
  {
    heading: 'Your rights',
    body: 'Under the Philippine Data Privacy Act of 2012 (Republic Act No. 10173) you may ask to see, correct or delete your personal information. You can update your details in My Account, or contact NEXORA Academy for anything else.',
  },
];

interface Props {
  open: LegalDocument | null;
  onClose: () => void;
}

export const LegalDocumentsModal: React.FC<Props> = ({ open, onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const title = open === 'terms' ? 'Terms and Conditions' : 'Privacy Policy';
  const sections = open === 'terms' ? TERMS : PRIVACY;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="legal-title">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
      <div className="relative w-full sm:max-w-lg max-h-[85vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl">
        <div className="sticky top-0 flex items-start justify-between gap-4 px-6 pt-6 pb-4 bg-slate-900 border-b border-slate-800">
          <div>
            <h2 id="legal-title" className="text-lg font-bold text-white">{title}</h2>
            <p className="text-xs text-slate-400 mt-0.5">NEXORA Academy · Last updated {UPDATED}</p>
          </div>
          <button ref={closeRef} onClick={onClose} className="p-2 -m-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {sections.map((s) => (
            <section key={s.heading}>
              <h3 className="text-sm font-semibold text-white">{s.heading}</h3>
              <p className="text-sm text-slate-300 leading-relaxed mt-1">{s.body}</p>
            </section>
          ))}
        </div>
        <div className="px-6 pb-6">
          <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
