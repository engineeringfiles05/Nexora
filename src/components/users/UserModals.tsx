/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Mail, Phone, Trash2, User as UserIcon, X } from 'lucide-react';
import type { Course, UserProfile, UserStatus } from '../../types/index.ts';
import { COURSES, isValidContact, isValidEmail, sanitizeContact, sanitizeName } from '../../auth/validation.ts';
import { isAdminEmail } from '../../auth/roles.ts';
import { STATUS_LABELS, statusOf } from '../../auth/accountStatus.ts';
import { Notice, SubmitButton, TextField } from '../auth/AuthFields.tsx';

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export const Modal: React.FC<{ title: string; subtitle?: string; onClose: () => void; busy?: boolean; children: React.ReactNode; wide?: boolean }> = ({
  title,
  subtitle,
  onClose,
  busy,
  children,
  wide,
}) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" onClick={() => !busy && onClose()} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
      <div className={`relative w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'} max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl`}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 px-6 pt-6 pb-4 bg-slate-900 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-white">{title}</h2>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button ref={closeRef} onClick={onClose} disabled={busy} className="p-2 -m-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-40" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
};

const CoursePicker: React.FC<{ value: Course | null | ''; onChange: (c: Course | null) => void; allowNone?: boolean; error?: string }> = ({
  value,
  onChange,
  allowNone,
  error,
}) => (
  <fieldset>
    <legend className="text-xs font-semibold text-slate-300 mb-1.5">Assigned course</legend>
    <div className={`grid gap-2 ${allowNone ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {COURSES.map((c) => (
        <label
          key={c.id}
          className={`cursor-pointer rounded-xl border px-3 py-2.5 transition ${value === c.id ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-700 bg-slate-950/70 hover:border-slate-600'}`}
        >
          <input type="radio" className="sr-only" checked={value === c.id} onChange={() => onChange(c.id)} />
          <span className="block text-sm font-bold text-white">{c.name}</span>
          <span className="block text-[10px] text-slate-400 leading-snug">{c.description}</span>
        </label>
      ))}
      {allowNone && (
        <label className={`cursor-pointer rounded-xl border px-3 py-2.5 transition ${value === null ? 'border-rose-400 bg-rose-500/10' : 'border-slate-700 bg-slate-950/70 hover:border-slate-600'}`}>
          <input type="radio" className="sr-only" checked={value === null} onChange={() => onChange(null)} />
          <span className="block text-sm font-bold text-white">None</span>
          <span className="block text-[10px] text-slate-400 leading-snug">Remove course access</span>
        </label>
      )}
    </div>
    {error && <p className="mt-1.5 text-xs text-rose-300">{error}</p>}
  </fieldset>
);

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

export interface AddUserValues {
  name: string;
  email: string;
  course: Course;
  contactNumber: string;
}

export const AddUserModal: React.FC<{ onClose: () => void; onCreate: (values: AddUserValues) => Promise<string | null> }> = ({ onClose, onCreate }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [course, setCourse] = useState<Course | ''>('');
  const [contact, setContact] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (sanitizeName(name).length < 2) found.name = 'Enter the reviewee’s complete name.';
    if (!isValidEmail(email)) found.email = 'Enter a valid email address.';
    else if (isAdminEmail(email)) found.email = 'This email address is reserved.';
    if (course !== 'REE' && course !== 'RME') found.course = 'Choose a course.';
    if (contact.trim() && !isValidContact(sanitizeContact(contact))) found.contact = 'Enter a valid contact number.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFailure(null);
    const error = await onCreate({ name, email, course: course as Course, contactNumber: contact });
    setBusy(false);
    if (error) setFailure(error);
  };

  return (
    <Modal title="Add reviewee" subtitle="Creates a reviewee account. The reviewee sets their own password." onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {failure && <Notice tone="error">{failure}</Notice>}
        <TextField label="Complete name" icon={UserIcon} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={120} autoFocus />
        <TextField label="Email address" icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} maxLength={254} />
        <CoursePicker value={course} onChange={(c) => c && setCourse(c)} error={errors.course} />
        <TextField label="Contact number" optional icon={Phone} type="tel" value={contact} onChange={(e) => setContact(e.target.value)} error={errors.contact} maxLength={20} />
        <Notice tone="info">
          We'll email the reviewee a secure link to choose their password. The link works once and expires after one hour; you can resend it from their profile.
        </Notice>
        <SubmitButton busy={busy} busyLabel="Creating account…">
          Create account
        </SubmitButton>
      </form>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export interface EditUserValues {
  name: string;
  email: string;
  course: Course | null;
  contactNumber: string;
  status: UserStatus;
}

export const EditUserModal: React.FC<{
  user: UserProfile;
  canChangeEmail: boolean;
  onClose: () => void;
  onSave: (values: EditUserValues) => Promise<string | null>;
}> = ({ user, canChangeEmail, onClose, onSave }) => {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [course, setCourse] = useState<Course | null | ''>(user.course === undefined ? '' : user.course);
  const [contact, setContact] = useState(user.contactNumber ?? '');
  const [status, setStatus] = useState<UserStatus>(statusOf(user));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (sanitizeName(name).length < 2) found.name = 'Enter a complete name.';
    if (!isValidEmail(email)) found.email = 'Enter a valid email address.';
    else if (isAdminEmail(email)) found.email = 'This email address is reserved.';
    if (course === '') found.course = 'Choose a course, or None to remove access.';
    if (contact.trim() && !isValidContact(sanitizeContact(contact))) found.contact = 'Enter a valid contact number.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFailure(null);
    const error = await onSave({ name, email, course: course as Course | null, contactNumber: contact, status });
    setBusy(false);
    if (error) setFailure(error);
  };

  return (
    <Modal title="Edit reviewee" subtitle={user.email} onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {failure && <Notice tone="error">{failure}</Notice>}
        <TextField label="Complete name" icon={UserIcon} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={120} />
        <TextField
          label="Email address"
          icon={Mail}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          maxLength={254}
          disabled={!canChangeEmail}
          hint={
            canChangeEmail
              ? 'Changes the address the reviewee signs in with. They will need to verify it again.'
              : 'Changing a sign-in email needs Firebase Admin credentials on the server (FIREBASE_SERVICE_ACCOUNT).'
          }
        />
        <CoursePicker value={course} onChange={setCourse} allowNone error={errors.course} />
        <TextField label="Contact number" optional icon={Phone} type="tel" value={contact} onChange={(e) => setContact(e.target.value)} error={errors.contact} maxLength={20} />
        <label className="block">
          <span className="block text-xs font-semibold text-slate-300 mb-1.5">Account status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as UserStatus)}
            className="w-full rounded-xl bg-slate-950/70 border border-slate-700 px-3.5 py-3 text-sm text-white focus:border-indigo-400 outline-none"
          >
            {(Object.keys(STATUS_LABELS) as UserStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {status !== statusOf(user) && status !== 'active' && (
            <span className="block mt-1.5 text-xs text-amber-300">The reviewee will be signed out and blocked until restored.</span>
          )}
        </label>
        <SubmitButton busy={busy} busyLabel="Saving…">
          Save changes
        </SubmitButton>
      </form>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Status change confirmation
// ---------------------------------------------------------------------------

const STATUS_COPY: Record<UserStatus, { title: string; verb: string; explain: string; tone: 'danger' | 'safe' }> = {
  active: {
    title: 'Activate account',
    verb: 'Activate',
    explain: 'The reviewee can sign in again and use all materials for their course. Their history is unchanged.',
    tone: 'safe',
  },
  inactive: {
    title: 'Deactivate account',
    verb: 'Deactivate',
    explain:
      'The reviewee is signed out and can no longer open NEXORA Academy. Their examination history, quiz results and progress are kept, and you can reactivate the account at any time.',
    tone: 'danger',
  },
  suspended: {
    title: 'Suspend account',
    verb: 'Suspend',
    explain:
      'A temporary block: the reviewee is signed out and sees that the account is suspended (with your reason, if given). Everything is kept; restore the account to lift the suspension.',
    tone: 'danger',
  },
  pending: {
    title: 'Mark as pending approval',
    verb: 'Mark pending',
    explain: 'The reviewee is signed out until you approve the account.',
    tone: 'danger',
  },
};

export const StatusModal: React.FC<{ user: UserProfile; status: UserStatus; onClose: () => void; onConfirm: (reason: string) => Promise<string | null> }> = ({
  user,
  status,
  onClose,
  onConfirm,
}) => {
  const copy = STATUS_COPY[status];
  const current = statusOf(user);
  const title = status === 'active' ? (current === 'suspended' ? 'Restore account' : current === 'pending' ? 'Approve account' : copy.title) : copy.title;
  const verb = status === 'active' ? (current === 'suspended' ? 'Restore' : current === 'pending' ? 'Approve' : copy.verb) : copy.verb;
  const [reason, setReason] = useState(status === 'active' ? '' : user.statusReason ?? '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    const error = await onConfirm(reason);
    setBusy(false);
    if (error) setFailure(error);
  };

  return (
    <Modal title={title} subtitle={`${user.name} · ${user.email}`} onClose={onClose} busy={busy}>
      <div className="space-y-4">
        {failure && <Notice tone="error">{failure}</Notice>}
        <p className="text-sm text-slate-300 leading-relaxed">{copy.explain}</p>
        {status !== 'active' && (
          <label className="block">
            <span className="block text-xs font-semibold text-slate-300 mb-1.5">
              Reason <span className="font-normal text-slate-500">(optional, shown to the reviewee)</span>
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              rows={3}
              className="w-full rounded-xl bg-slate-950/70 border border-slate-700 px-3.5 py-2.5 text-sm text-white focus:border-indigo-400 outline-none"
            />
          </label>
        )}
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
          <button onClick={onClose} disabled={busy} className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className={`px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 ${copy.tone === 'danger' ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
          >
            {busy ? 'Saving…' : `${verb} account`}
          </button>
        </div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Permanent deletion
// ---------------------------------------------------------------------------

export const DeleteUserModal: React.FC<{
  user: UserProfile;
  resultCount: number;
  canDelete: boolean;
  onClose: () => void;
  onConfirm: () => Promise<string | null>;
  onDeactivateInstead: () => void;
}> = ({ user, resultCount, canDelete, onClose, onConfirm, onDeactivateInstead }) => {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === user.email.toLowerCase();

  const confirm = async () => {
    if (!matches) return;
    setBusy(true);
    setFailure(null);
    const error = await onConfirm();
    setBusy(false);
    if (error) setFailure(error);
  };

  return (
    <Modal title="Delete account permanently" subtitle={`${user.name} · ${user.email}`} onClose={onClose} busy={busy}>
      <div className="space-y-4">
        {failure && <Notice tone="error">{failure}</Notice>}
        <div className="rounded-xl border border-rose-700/60 bg-rose-950/40 p-4 text-sm text-rose-100 space-y-2">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="w-4 h-4" /> This cannot be undone.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-rose-100/90">
            <li>The sign-in account is deleted; this email can register again as a new reviewee.</li>
            <li>
              Their profile and <strong>{resultCount}</strong> examination result{resultCount === 1 ? '' : 's'} (pre-tests, quizzes, pre-boards, mock boards) are erased.
            </li>
            <li>The activity log keeps a record that you deleted this account.</li>
          </ul>
        </div>
        <p className="text-sm text-slate-300">
          To keep their history, <button onClick={onDeactivateInstead} className="font-semibold text-indigo-300 underline underline-offset-2">deactivate the account</button> instead.
        </p>
        {!canDelete ? (
          <Notice tone="info">
            Permanent deletion needs Firebase Admin credentials on the server, so the sign-in account is removed too. Set FIREBASE_SERVICE_ACCOUNT (see .env.example) and redeploy. Until then, deactivate the account.
          </Notice>
        ) : (
          <label className="block">
            <span className="block text-xs font-semibold text-slate-300 mb-1.5">
              Type <span className="font-mono text-white">{user.email}</span> to confirm
            </span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl bg-slate-950/70 border border-slate-700 px-3.5 py-3 text-sm text-white focus:border-rose-400 outline-none"
            />
          </label>
        )}
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
          <button onClick={onClose} disabled={busy} className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!canDelete || !matches || busy}
            className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
