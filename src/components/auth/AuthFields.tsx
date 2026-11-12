/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useId, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Info, Loader2, type LucideIcon } from 'lucide-react';
import { passwordStrength } from '../../auth/validation.ts';

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon?: LucideIcon;
  error?: string;
  hint?: React.ReactNode;
  optional?: boolean;
  trailing?: React.ReactNode;
}

export const TextField: React.FC<FieldProps> = ({ label, icon: Icon, error, hint, optional, trailing, className, ...input }) => {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="flex items-baseline justify-between text-xs font-semibold text-slate-300 mb-1.5">
        <span>{label}</span>
        {optional && <span className="font-normal text-slate-500">Optional</span>}
      </label>
      <div
        className={`group relative flex items-center rounded-xl bg-slate-950/70 border transition-colors focus-within:ring-2 ${
          error
            ? 'border-rose-500/70 focus-within:ring-rose-500/25'
            : 'border-slate-700 hover:border-slate-600 focus-within:border-indigo-400 focus-within:ring-indigo-500/25'
        }`}
      >
        {Icon && <Icon className="absolute left-3.5 w-4 h-4 text-slate-500 group-focus-within:text-indigo-300 pointer-events-none" aria-hidden />}
        <input
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={`w-full bg-transparent py-3 text-sm text-white placeholder:text-slate-500 outline-none rounded-xl ${Icon ? 'pl-10' : 'pl-3.5'} ${trailing ? 'pr-11' : 'pr-3.5'}`}
          {...input}
        />
        {trailing && <div className="absolute right-1.5">{trailing}</div>}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-rose-300">
          <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <div id={`${id}-hint`} className="mt-1.5 text-xs text-slate-400">
          {hint}
        </div>
      ) : null}
    </div>
  );
};

export const PasswordField: React.FC<Omit<FieldProps, 'type' | 'trailing'>> = (props) => {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      }
    />
  );
};

const STRENGTH_COLORS = ['bg-slate-700', 'bg-rose-500', 'bg-amber-500', 'bg-sky-400', 'bg-emerald-400'];
const STRENGTH_TEXT = ['text-slate-400', 'text-rose-300', 'text-amber-300', 'text-sky-300', 'text-emerald-300'];

export const PasswordStrengthMeter: React.FC<{ password: string }> = ({ password }) => {
  const strength = passwordStrength(password);
  return (
    <div className="mt-2 space-y-2" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex-1 grid grid-cols-4 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((step) => (
            <span
              key={step}
              className={`h-1.5 rounded-full transition-colors duration-300 ${strength.score >= step ? STRENGTH_COLORS[strength.score] : 'bg-slate-800'}`}
            />
          ))}
        </div>
        <span className={`text-[11px] font-semibold w-16 text-right ${STRENGTH_TEXT[strength.score]}`}>
          {strength.label && <span className="sr-only">Password strength: </span>}
          {strength.label}
        </span>
      </div>
      {password && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
          {strength.checks.map((check) => (
            <li key={check.id} className={`flex items-center gap-1.5 text-[11px] ${check.met ? 'text-emerald-300' : 'text-slate-500'}`}>
              <CheckCircle2 className={`w-3 h-3 ${check.met ? '' : 'opacity-40'}`} aria-hidden />
              {check.label}
              <span className="sr-only">{check.met ? ' (met)' : ' (not met)'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export type NoticeTone = 'success' | 'error' | 'info';

export const Notice: React.FC<{ tone: NoticeTone; children: React.ReactNode }> = ({ tone, children }) => {
  const styles = {
    success: 'bg-emerald-950/60 border-emerald-700/60 text-emerald-100',
    error: 'bg-rose-950/60 border-rose-700/60 text-rose-100',
    info: 'bg-indigo-950/60 border-indigo-700/60 text-indigo-100',
  }[tone];
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? AlertCircle : Info;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${styles}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
      <div className="leading-relaxed">{children}</div>
    </div>
  );
};

export const SubmitButton: React.FC<{ busy: boolean; busyLabel: string; children: React.ReactNode; disabled?: boolean }> = ({ busy, busyLabel, children, disabled }) => (
  <button
    type="submit"
    disabled={busy || disabled}
    className="relative w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white text-sm font-bold shadow-lg shadow-indigo-900/40 transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
  >
    {busy ? (
      <>
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
        {busyLabel}
      </>
    ) : (
      children
    )}
  </button>
);
