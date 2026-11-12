/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import { BadgeCheck, KeyRound, Lock, LogOut, Mail, MailWarning, Phone, ShieldCheck, User as UserIcon } from 'lucide-react';
import type { Course, UserProfile } from '../types/index.ts';
import { COURSES, describeAuthError, isValidContact, passwordProblem, sanitizeContact, sanitizeName } from '../auth/validation.ts';
import { changePassword, resendVerificationEmail, updateAccountDetails } from '../auth/authService.ts';
import { Notice, PasswordField, PasswordStrengthMeter, SubmitButton, TextField } from './auth/AuthFields.tsx';
import { Avatar } from './Avatar.tsx';

interface Props {
  profile: UserProfile;
  firebaseUser: User;
  onProfileUpdated: (profile: UserProfile) => void;
  onLogout: () => void;
}

export const AccountSettingsView: React.FC<Props> = ({ profile, firebaseUser, onProfileUpdated, onLogout }) => {
  const usesPassword = firebaseUser.providerData.some((p) => p.providerId === 'password');
  const isAdmin = profile.role === 'admin';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Avatar name={profile.name} src={profile.avatar} className="w-16 h-16 text-lg border-2 border-slate-700" />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-white truncate">{profile.name}</h1>
          <p className="text-sm text-slate-400 truncate">{profile.email}</p>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
            <span className={`px-2 py-0.5 rounded-full border font-semibold ${isAdmin ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'}`}>
              {isAdmin ? 'Administrator' : 'Reviewee'}
            </span>
            {profile.course && <span className="px-2 py-0.5 rounded-full border border-slate-700 bg-slate-800 text-slate-200 font-semibold">{profile.course}</span>}
            <span className="text-slate-500">Member since {new Date(profile.enrolledAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>
        </div>
        <button onClick={onLogout} className="self-start sm:self-center flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white">
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>

      <VerificationCard user={firebaseUser} />
      <DetailsCard profile={profile} user={firebaseUser} onSaved={onProfileUpdated} />
      {usesPassword ? (
        <PasswordCard user={firebaseUser} />
      ) : (
        <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 sm:p-6 text-sm text-slate-400 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
          You sign in with Google, so your password is managed in your Google account.
        </section>
      )}
    </div>
  );
};

const Card: React.FC<{ title: string; description?: string; children: React.ReactNode }> = ({ title, description, children }) => (
  <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 sm:p-6">
    <h2 className="text-base font-bold text-white">{title}</h2>
    {description && <p className="text-sm text-slate-400 mt-1">{description}</p>}
    <div className="mt-5">{children}</div>
  </section>
);

const VerificationCard: React.FC<{ user: User }> = ({ user }) => {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | string>('idle');
  if (user.emailVerified) {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-300">
        <BadgeCheck className="w-4 h-4" /> Email address verified
      </div>
    );
  }
  const send = async () => {
    setState('sending');
    try {
      await resendVerificationEmail(user);
      setState('sent');
    } catch (error) {
      setState(describeAuthError(error));
    }
  };
  return (
    <div className="rounded-2xl border border-amber-700/50 bg-amber-950/30 p-4 flex flex-col sm:flex-row sm:items-center gap-3 text-sm">
      <MailWarning className="w-5 h-5 text-amber-300 shrink-0" />
      <p className="flex-1 text-amber-100">
        {state === 'sent'
          ? `Verification email sent to ${user.email}. Open the link in it, then refresh this page.`
          : state !== 'idle' && state !== 'sending'
            ? state
            : 'Your email address is not verified yet. Verifying it helps you recover your account.'}
      </p>
      {state !== 'sent' && (
        <button onClick={send} disabled={state === 'sending'} className="px-3.5 py-2 rounded-lg bg-amber-500/90 hover:bg-amber-400 text-slate-950 font-semibold text-xs disabled:opacity-60">
          {state === 'sending' ? 'Sending…' : 'Send verification email'}
        </button>
      )}
    </div>
  );
};

const DetailsCard: React.FC<{ profile: UserProfile; user: User; onSaved: (p: UserProfile) => void }> = ({ profile, user, onSaved }) => {
  const [name, setName] = useState(profile.name);
  const [course, setCourse] = useState<Course | ''>(profile.course ?? '');
  const [contact, setContact] = useState(profile.contactNumber ?? '');
  const [errors, setErrors] = useState<{ name?: string; course?: string; contact?: string }>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const isAdmin = profile.role === 'admin';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    const found: typeof errors = {};
    if (sanitizeName(name).length < 2) found.name = 'Enter your complete name.';
    if (!isAdmin && course !== 'REE' && course !== 'RME') found.course = 'Choose your course.';
    if (contact.trim() && !isValidContact(sanitizeContact(contact))) found.contact = 'Enter a valid contact number.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const updated = await updateAccountDetails(user, { name, course: course || undefined, contactNumber: contact });
      onSaved(updated);
      setResult({ tone: 'success', text: 'Your details have been saved.' });
    } catch (error) {
      console.warn('Profile update failed:', error);
      setResult({ tone: 'error', text: 'Your details could not be saved. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Personal information" description="This is how you appear to NEXORA Academy administrators.">
      <form onSubmit={submit} noValidate className="grid sm:grid-cols-2 gap-4">
        {result && (
          <div className="sm:col-span-2">
            <Notice tone={result.tone}>{result.text}</Notice>
          </div>
        )}
        <TextField label="Complete name" icon={UserIcon} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={120} autoComplete="name" />
        <TextField label="Email address" icon={Mail} value={profile.email} readOnly disabled hint="Your sign-in email can't be changed here." />
        {!isAdmin && (
          <fieldset>
            <legend className="text-xs font-semibold text-slate-300 mb-1.5">Course</legend>
            <div className="grid grid-cols-2 gap-2">
              {COURSES.map((c) => (
                <label
                  key={c.id}
                  className={`cursor-pointer rounded-xl border px-3 py-2.5 text-sm transition ${course === c.id ? 'border-indigo-400 bg-indigo-500/10 text-white' : 'border-slate-700 bg-slate-950/70 text-slate-300 hover:border-slate-600'}`}
                >
                  <input type="radio" name="account-course" value={c.id} checked={course === c.id} onChange={() => setCourse(c.id)} className="sr-only" />
                  <span className="font-bold">{c.name}</span>
                  <span className="block text-[11px] text-slate-400">{c.description}</span>
                </label>
              ))}
            </div>
            {errors.course && <p className="mt-1.5 text-xs text-rose-300">{errors.course}</p>}
          </fieldset>
        )}
        <TextField label="Contact number" optional icon={Phone} type="tel" value={contact} onChange={(e) => setContact(e.target.value)} error={errors.contact} maxLength={20} autoComplete="tel" />
        <div className="sm:col-span-2 sm:max-w-xs">
          <SubmitButton busy={busy} busyLabel="Saving…">
            Save changes
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
};

const PasswordCard: React.FC<{ user: User }> = ({ user }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    const found: typeof errors = {};
    if (!current) found.current = 'Enter your current password.';
    const problem = passwordProblem(next);
    if (!next) found.next = 'Enter a new password.';
    else if (problem) found.next = problem;
    else if (next === current) found.next = 'Choose a password different from your current one.';
    if (confirm !== next) found.confirm = 'Passwords do not match.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await changePassword(user, current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setResult({ tone: 'success', text: 'Your password has been changed.' });
    } catch (error) {
      const code = (error as { code?: string })?.code ?? '';
      setResult({ tone: 'error', text: /invalid-credential|wrong-password/.test(code) ? 'Your current password is incorrect.' : describeAuthError(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Change password" description="You'll stay signed in on this device.">
      <form onSubmit={submit} noValidate className="grid sm:grid-cols-2 gap-4">
        {result && (
          <div className="sm:col-span-2">
            <Notice tone={result.tone}>{result.text}</Notice>
          </div>
        )}
        <PasswordField label="Current password" icon={Lock} value={current} onChange={(e) => setCurrent(e.target.value)} error={errors.current} autoComplete="current-password" maxLength={128} className="sm:col-span-2 sm:max-w-sm" />
        <div>
          <PasswordField label="New password" icon={KeyRound} value={next} onChange={(e) => setNext(e.target.value)} error={errors.next} autoComplete="new-password" maxLength={128} />
          <PasswordStrengthMeter password={next} />
        </div>
        <PasswordField label="Confirm new password" icon={KeyRound} value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} autoComplete="new-password" maxLength={128} />
        <div className="sm:col-span-2 sm:max-w-xs">
          <SubmitButton busy={busy} busyLabel="Updating…">
            Update password
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
};
