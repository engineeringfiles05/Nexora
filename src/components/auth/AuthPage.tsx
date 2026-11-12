/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  Award,
  BarChart3,
  ClipboardCheck,
  KeyRound,
  Layers,
  Lock,
  Mail,
  MailCheck,
  Phone,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import type { AuthView } from '../../auth/routes.ts';
import type { Course, UserStatus } from '../../types/index.ts';
import {
  COURSES,
  createLoginThrottle,
  describeAuthError,
  isValidEmail,
  passwordProblem,
  validateLogin,
  validateRegistration,
  type RegistrationErrors,
  type RegistrationForm,
} from '../../auth/validation.ts';
import {
  checkResetCode,
  completePasswordReset,
  confirmEmailVerification,
  registerAccount,
  requestPasswordReset,
  signInWithGoogle,
  signInWithPassword,
} from '../../auth/authService.ts';
import { readRememberPreference } from '../../auth/sessionPolicy.ts';
import { LegalDocumentsModal, type LegalDocument } from './LegalDocuments.tsx';
import { Notice, PasswordField, PasswordStrengthMeter, SubmitButton, TextField, type NoticeTone } from './AuthFields.tsx';

export interface AuthNotice {
  tone: NoticeTone;
  text: string;
}

interface Props {
  view: AuthView;
  onNavigate: (view: AuthView) => void;
  /** Shown above the form, e.g. after signing out or when a session expired. */
  notice?: AuthNotice | null;
  onDismissNotice?: () => void;
  onRegistered?: (name: string, status?: UserStatus) => void;
}

// One per page load: repeated wrong passwords slow down further attempts in this browser.
const loginThrottle = createLoginThrottle();

const HEADINGS: Record<AuthView, { title: string; subtitle: string }> = {
  login: { title: 'Welcome back', subtitle: 'Sign in to continue your board exam review.' },
  register: { title: 'Create your account', subtitle: 'Join NEXORA Academy and start reviewing for the REE or RME board exam.' },
  'forgot-password': { title: 'Reset your password', subtitle: 'Enter the email you registered with and we’ll send you a reset link.' },
  'reset-password': { title: 'Choose a new password', subtitle: 'Set a new password for your NEXORA Academy account.' },
};

export const AuthPage: React.FC<Props> = ({ view, onNavigate, notice, onDismissNotice, onRegistered }) => {
  const [legal, setLegal] = useState<LegalDocument | null>(null);
  const [email, setEmail] = useState('');
  const heading = HEADINGS[view];

  const go = (next: AuthView) => {
    onDismissNotice?.();
    onNavigate(next);
  };

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden selection:bg-indigo-500 selection:text-white">
      <Backdrop />
      <div className="relative z-10 min-h-screen grid lg:grid-cols-[1.05fr_1fr]">
        <BrandPanel />

        <main className="flex flex-col items-center justify-center px-4 sm:px-8 py-8 sm:py-12">
          <MobileBrand />
          <motion.div
            layout
            transition={{ layout: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } }}
            className="w-full max-w-[460px] rounded-3xl bg-slate-900/80 backdrop-blur-xl border border-slate-800 shadow-2xl shadow-black/40 p-6 sm:p-8"
          >
            {view !== 'reset-password' && <ModeTabs view={view} onChange={go} />}

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              >
                <header className="mb-6">
                  <h1 className="text-2xl font-extrabold tracking-tight text-white">{heading.title}</h1>
                  <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">{heading.subtitle}</p>
                </header>

                {notice && (
                  <div className="mb-5">
                    <Notice tone={notice.tone}>{notice.text}</Notice>
                  </div>
                )}

                {view === 'login' && <LoginForm email={email} setEmail={setEmail} onForgot={() => go('forgot-password')} onRegister={() => go('register')} />}
                {view === 'register' && (
                  <RegisterForm email={email} setEmail={setEmail} onLogin={() => go('login')} onOpenLegal={setLegal} onRegistered={onRegistered} />
                )}
                {view === 'forgot-password' && <ForgotPasswordForm email={email} setEmail={setEmail} onBack={() => go('login')} />}
                {view === 'reset-password' && <ResetPasswordForm onDone={() => go('login')} onRequestNew={() => go('forgot-password')} />}
              </motion.div>
            </AnimatePresence>
          </motion.div>

          <footer className="mt-6 text-[11px] text-slate-500 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
            <span>© {new Date().getFullYear()} NEXORA Academy</span>
            <button onClick={() => setLegal('terms')} className="hover:text-slate-300 underline-offset-2 hover:underline">
              Terms and Conditions
            </button>
            <button onClick={() => setLegal('privacy')} className="hover:text-slate-300 underline-offset-2 hover:underline">
              Privacy Policy
            </button>
          </footer>
        </main>
      </div>
      <LegalDocumentsModal open={legal} onClose={() => setLegal(null)} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const Backdrop: React.FC = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0">
    <div className="absolute -top-40 -left-32 w-[36rem] h-[36rem] rounded-full bg-indigo-600/20 blur-[120px]" />
    <div className="absolute -bottom-48 right-[-10rem] w-[34rem] h-[34rem] rounded-full bg-emerald-500/10 blur-[120px]" />
    <div
      className="absolute inset-0 opacity-[0.07]"
      style={{
        backgroundImage: 'linear-gradient(rgba(148,163,184,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.6) 1px, transparent 1px)',
        backgroundSize: '44px 44px',
        maskImage: 'radial-gradient(ellipse at 30% 40%, black 20%, transparent 75%)',
        WebkitMaskImage: 'radial-gradient(ellipse at 30% 40%, black 20%, transparent 75%)',
      }}
    />
  </div>
);

export const Logo: React.FC<{ size?: 'sm' | 'lg' }> = ({ size = 'lg' }) => (
  <div className="flex items-center gap-3 select-none">
    <div className={`${size === 'lg' ? 'w-12 h-12' : 'w-10 h-10'} rounded-xl bg-white flex items-center justify-center overflow-hidden shadow-lg shadow-indigo-500/25`}>
      <img src="/logo.png" alt="" className="w-full h-full object-contain p-1" />
    </div>
    <div>
      <div className="flex items-center gap-2">
        <span className={`${size === 'lg' ? 'text-xl' : 'text-lg'} font-extrabold tracking-wider bg-gradient-to-r from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent`}>
          NEXORA
        </span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono font-semibold border border-indigo-500/30">ACADEMY</span>
      </div>
      <p className="text-[10px] text-slate-400 font-medium tracking-wide">BOARD EXAMINATION REVIEW PLATFORM</p>
    </div>
  </div>
);

const FEATURES = [
  { icon: ClipboardCheck, title: 'Pre-test diagnostics', text: 'Find your weak topics before you start reviewing.' },
  { icon: Layers, title: 'Subject quizzes', text: 'Focused drills for every board exam subject.' },
  { icon: Award, title: 'Pre-board & Final Mock Board', text: 'Timed, full-length examinations under board conditions.' },
  { icon: BarChart3, title: 'Results & analytics', text: 'Step-by-step solutions and progress across every exam.' },
];

const BrandPanel: React.FC = () => (
  <aside className="hidden lg:flex flex-col justify-between px-12 xl:px-16 py-12 border-r border-slate-800/70 bg-gradient-to-b from-slate-900/40 to-slate-950/20">
    <Logo />
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="max-w-xl">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-semibold mb-6">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Now enrolling REE &amp; RME reviewees
      </div>
      <h2 className="text-4xl xl:text-5xl font-extrabold leading-[1.1] tracking-tight text-white">
        Your path to the board
        <span className="block bg-gradient-to-r from-indigo-300 via-sky-300 to-emerald-300 bg-clip-text text-transparent">starts here.</span>
      </h2>
      <p className="mt-5 text-base text-slate-400 leading-relaxed max-w-lg">
        A structured review center for Registered Electrical Engineer and Registered Master Electrician board examinees.
      </p>
      <ul className="mt-10 grid grid-cols-2 gap-x-6 gap-y-6">
        {FEATURES.map(({ icon: Icon, title, text }, i) => (
          <motion.li
            key={title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 + i * 0.07 }}
            className="flex gap-3"
          >
            <span className="w-9 h-9 shrink-0 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center">
              <Icon className="w-4 h-4 text-indigo-300" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-white">{title}</span>
              <span className="block text-xs text-slate-400 mt-0.5 leading-relaxed">{text}</span>
            </span>
          </motion.li>
        ))}
      </ul>
    </motion.div>
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <ShieldCheck className="w-4 h-4 text-emerald-400" />
      Secured with Google Firebase Authentication. Your password is never stored by NEXORA Academy.
    </div>
  </aside>
);

const MobileBrand: React.FC = () => (
  <div className="lg:hidden w-full max-w-[460px] mb-6 flex flex-col items-center text-center gap-3">
    <Logo size="sm" />
  </div>
);

const ModeTabs: React.FC<{ view: AuthView; onChange: (v: AuthView) => void }> = ({ view, onChange }) => {
  const active = view === 'register' ? 'register' : 'login';
  return (
    <div role="tablist" aria-label="Sign in or create an account" className="relative grid grid-cols-2 p-1 mb-7 rounded-xl bg-slate-950/80 border border-slate-800">
      {(['login', 'register'] as const).map((tab) => (
        <button
          key={tab}
          role="tab"
          aria-selected={active === tab}
          onClick={() => onChange(tab)}
          className={`relative z-10 py-2 text-sm font-semibold rounded-lg transition-colors ${active === tab ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}
        >
          {active === tab && (
            <motion.span layoutId="auth-tab" className="absolute inset-0 -z-10 rounded-lg bg-slate-800 border border-slate-700 shadow" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
          )}
          {tab === 'login' ? 'Sign in' : 'Create account'}
        </button>
      ))}
    </div>
  );
};

const GoogleIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden>
    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.7 2.3 2.4 6.6 2.4 12s4.3 9.7 9.6 9.7c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
  </svg>
);

const Divider: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center gap-3 my-5 text-[11px] uppercase tracking-wider text-slate-500">
    <span className="flex-1 h-px bg-slate-800" />
    {label}
    <span className="flex-1 h-px bg-slate-800" />
  </div>
);

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

const LoginForm: React.FC<{ email: string; setEmail: (v: string) => void; onForgot: () => void; onRegister: () => void }> = ({ email, setEmail, onForgot, onRegister }) => {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => readRememberPreference());
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'password' | 'google' | null>(null);
  const [waitSeconds, setWaitSeconds] = useState(() => Math.ceil(loginThrottle.waitMs() / 1000));

  useEffect(() => {
    if (waitSeconds <= 0) return;
    const timer = setTimeout(() => setWaitSeconds(Math.ceil(loginThrottle.waitMs() / 1000)), 1000);
    return () => clearTimeout(timer);
  }, [waitSeconds]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const found = validateLogin(email, password);
    setErrors(found);
    if (Object.keys(found).length) return;
    if (loginThrottle.waitMs() > 0) {
      setWaitSeconds(Math.ceil(loginThrottle.waitMs() / 1000));
      return;
    }
    setBusy('password');
    try {
      await signInWithPassword(email, password, remember);
      loginThrottle.succeed();
      // The app's auth listener takes over and opens the right dashboard.
    } catch (error) {
      const code = (error as { code?: string })?.code ?? '';
      if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) loginThrottle.fail();
      setFormError(describeAuthError(error));
      setWaitSeconds(Math.ceil(loginThrottle.waitMs() / 1000));
      setPassword('');
      setBusy(null);
    }
  };

  const google = async () => {
    setFormError(null);
    setBusy('google');
    try {
      await signInWithGoogle(remember);
    } catch (error) {
      setFormError(describeAuthError(error));
      setBusy(null);
    }
  };

  const locked = waitSeconds > 0;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {formError && <Notice tone="error">{formError}</Notice>}
      {locked && <Notice tone="info">Too many incorrect attempts. You can try again in {waitSeconds} s, or reset your password.</Notice>}
      <TextField
        label="Email address"
        icon={Mail}
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
        maxLength={254}
        autoFocus
      />
      <PasswordField
        label="Password"
        icon={Lock}
        name="password"
        autoComplete="current-password"
        placeholder="Enter your password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
        maxLength={128}
      />
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-4 h-4 rounded border-slate-600 bg-slate-950 accent-indigo-500" />
          Remember me
        </label>
        <button type="button" onClick={onForgot} className="text-sm font-semibold text-indigo-300 hover:text-indigo-200">
          Forgot password?
        </button>
      </div>
      <SubmitButton busy={busy === 'password'} busyLabel="Signing in…" disabled={busy !== null || locked}>
        Sign in
      </SubmitButton>

      <Divider label="or" />
      <button
        type="button"
        onClick={google}
        disabled={busy !== null}
        className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl bg-slate-950/60 border border-slate-700 hover:border-slate-500 hover:bg-slate-800/60 text-sm font-semibold text-white transition disabled:opacity-60"
      >
        <GoogleIcon />
        {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
      </button>

      <p className="text-center text-sm text-slate-400 pt-2">
        New to NEXORA Academy?{' '}
        <button type="button" onClick={onRegister} className="font-semibold text-emerald-300 hover:text-emerald-200">
          Create an account
        </button>
      </p>
    </form>
  );
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const RegisterForm: React.FC<{
  email: string;
  setEmail: (v: string) => void;
  onLogin: () => void;
  onOpenLegal: (doc: LegalDocument) => void;
  onRegistered?: (name: string, status?: UserStatus) => void;
}> = ({ email, setEmail, onLogin, onOpenLegal, onRegistered }) => {
  const [form, setForm] = useState<Omit<RegistrationForm, 'email'>>({
    name: '',
    password: '',
    confirmPassword: '',
    course: '',
    contactNumber: '',
    acceptedTerms: false,
  });
  const [touched, setTouched] = useState<Partial<Record<keyof RegistrationForm, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<{ text: string; existing?: boolean } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const all: RegistrationForm = { ...form, email };
  const errors = validateRegistration(all);
  const show = (field: keyof RegistrationForm) => ((submitted || touched[field]) ? errors[field] : undefined);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const blur = (field: keyof RegistrationForm) => () => setTouched((t) => ({ ...t, [field]: true }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFormError(null);
    if (Object.keys(errors).length) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]')?.focus());
      return;
    }
    setBusy(true);
    try {
      const profile = await registerAccount(
        { name: form.name, email, password: form.password, course: form.course as Course, contactNumber: form.contactNumber || undefined },
        readRememberPreference()
      );
      onRegistered?.(form.name, profile.status);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      setFormError({ text: describeAuthError(error), existing: code === 'auth/email-already-in-use' });
      setBusy(false);
    }
  };

  const confirmMatches = form.confirmPassword.length > 0 && form.confirmPassword === form.password;

  return (
    <form onSubmit={submit} noValidate className="space-y-4" ref={formRef}>
      {formError && (
        <Notice tone="error">
          {formError.text}
          {formError.existing && (
            <span className="block mt-1">
              <button type="button" onClick={onLogin} className="font-semibold underline underline-offset-2">
                Go to sign in
              </button>
            </span>
          )}
        </Notice>
      )}
      <TextField
        label="Complete name"
        icon={UserIcon}
        name="name"
        autoComplete="name"
        placeholder="Juan A. Dela Cruz"
        value={form.name}
        onChange={(e) => set('name', e.target.value)}
        onBlur={blur('name')}
        error={show('name')}
        maxLength={120}
        autoFocus
      />
      <TextField
        label="Email address"
        icon={Mail}
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={blur('email')}
        error={show('email')}
        maxLength={254}
      />

      <fieldset>
        <legend className="text-xs font-semibold text-slate-300 mb-1.5">Course</legend>
        <div role="radiogroup" aria-invalid={Boolean(show('course'))} data-invalid={Boolean(show('course'))} className="grid grid-cols-2 gap-2.5">
          {COURSES.map((course) => {
            const selected = form.course === course.id;
            return (
              <label
                key={course.id}
                className={`relative cursor-pointer rounded-xl border px-3.5 py-3 transition focus-within:ring-2 focus-within:ring-indigo-500/30 ${
                  selected ? 'border-indigo-400 bg-indigo-500/10' : show('course') ? 'border-rose-500/70 bg-slate-950/70' : 'border-slate-700 bg-slate-950/70 hover:border-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="course"
                  value={course.id}
                  checked={selected}
                  onChange={() => {
                    set('course', course.id);
                    setTouched((t) => ({ ...t, course: true }));
                  }}
                  className="sr-only"
                />
                <span className="flex items-center justify-between">
                  <span className={`text-sm font-extrabold tracking-wide ${selected ? 'text-white' : 'text-slate-200'}`}>{course.name}</span>
                  <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${selected ? 'border-indigo-400' : 'border-slate-600'}`}>
                    {selected && <span className="w-2 h-2 rounded-full bg-indigo-400" />}
                  </span>
                </span>
                <span className="block text-[11px] text-slate-400 mt-0.5 leading-snug">{course.description}</span>
              </label>
            );
          })}
        </div>
        {show('course') && (
          <p role="alert" className="mt-1.5 text-xs text-rose-300">
            {show('course')}
          </p>
        )}
      </fieldset>

      <div>
        <PasswordField
          label="Password"
          icon={Lock}
          name="new-password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={form.password}
          onChange={(e) => set('password', e.target.value)}
          onBlur={blur('password')}
          error={show('password')}
          maxLength={128}
        />
        <PasswordStrengthMeter password={form.password} />
      </div>
      <PasswordField
        label="Confirm password"
        icon={KeyRound}
        name="confirm-password"
        autoComplete="new-password"
        placeholder="Re-enter your password"
        value={form.confirmPassword}
        onChange={(e) => set('confirmPassword', e.target.value)}
        onBlur={blur('confirmPassword')}
        error={show('confirmPassword')}
        hint={confirmMatches ? <span className="text-emerald-300">Passwords match.</span> : undefined}
        maxLength={128}
      />
      <TextField
        label="Contact number"
        optional
        icon={Phone}
        type="tel"
        name="tel"
        autoComplete="tel"
        inputMode="tel"
        placeholder="0917 123 4567"
        value={form.contactNumber}
        onChange={(e) => set('contactNumber', e.target.value)}
        onBlur={blur('contactNumber')}
        error={show('contactNumber')}
        maxLength={20}
      />

      <div>
        <label className="flex items-start gap-2.5 text-sm text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.acceptedTerms}
            onChange={(e) => set('acceptedTerms', e.target.checked)}
            aria-invalid={Boolean(show('acceptedTerms'))}
            className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-950 accent-indigo-500 shrink-0"
          />
          <span className="leading-relaxed">
            I agree to the{' '}
            <button type="button" onClick={() => onOpenLegal('terms')} className="font-semibold text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline">
              Terms and Conditions
            </button>{' '}
            and{' '}
            <button type="button" onClick={() => onOpenLegal('privacy')} className="font-semibold text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline">
              Privacy Policy
            </button>
            .
          </span>
        </label>
        {show('acceptedTerms') && (
          <p role="alert" className="mt-1.5 text-xs text-rose-300">
            {show('acceptedTerms')}
          </p>
        )}
      </div>

      <SubmitButton busy={busy} busyLabel="Creating your account…">
        Create account
      </SubmitButton>
      <p className="text-center text-sm text-slate-400 pt-1">
        Already registered?{' '}
        <button type="button" onClick={onLogin} className="font-semibold text-emerald-300 hover:text-emerald-200">
          Sign in
        </button>
      </p>
    </form>
  );
};

// ---------------------------------------------------------------------------
// Password recovery
// ---------------------------------------------------------------------------

const ForgotPasswordForm: React.FC<{ email: string; setEmail: (v: string) => void; onBack: () => void }> = ({ email, setEmail, onBack }) => {
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!email.trim()) return setError('Enter your email address.');
    if (!isValidEmail(email)) return setError('Enter a valid email address.');
    setError(undefined);
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setSentTo(email.trim());
    } catch (err) {
      setFormError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center text-center gap-3 py-2">
          <span className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <MailCheck className="w-7 h-7 text-emerald-300" />
          </span>
          <p className="text-sm text-slate-300 leading-relaxed">
            If an account exists for <strong className="text-white break-all">{sentTo}</strong>, a password reset link is on its way. The link works once and expires after one hour.
          </p>
          <p className="text-xs text-slate-500">Can’t find it? Check your spam or promotions folder.</p>
        </div>
        <button type="button" onClick={onBack} className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white">
          Back to sign in
        </button>
        <button type="button" onClick={() => setSentTo(null)} className="w-full text-sm font-semibold text-indigo-300 hover:text-indigo-200">
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {formError && <Notice tone="error">{formError}</Notice>}
      <TextField
        label="Email address"
        icon={Mail}
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={error}
        maxLength={254}
        autoFocus
      />
      <SubmitButton busy={busy} busyLabel="Sending link…">
        Send reset link
      </SubmitButton>
      <button type="button" onClick={onBack} className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold text-slate-400 hover:text-white pt-1">
        <ArrowLeft className="w-4 h-4" /> Back to sign in
      </button>
    </form>
  );
};

function readActionParams(): { mode: string | null; code: string | null } {
  if (typeof window === 'undefined') return { mode: null, code: null };
  const params = new URLSearchParams(window.location.search);
  return { mode: params.get('mode'), code: params.get('oobCode') };
}

const ResetPasswordForm: React.FC<{ onDone: () => void; onRequestNew: () => void }> = ({ onDone, onRequestNew }) => {
  const [{ mode, code }] = useState(readActionParams);
  const [state, setState] = useState<'checking' | 'ready' | 'invalid' | 'done' | 'verified'>(code ? 'checking' : 'invalid');
  const [accountEmail, setAccountEmail] = useState('');
  const [problem, setProblem] = useState<string | null>(code ? null : 'Open the reset link from your email to choose a new password.');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    const check = mode === 'verifyEmail' ? confirmEmailVerification(code).then(() => 'verified' as const) : checkResetCode(code).then((address) => {
      setAccountEmail(address);
      return 'ready' as const;
    });
    check
      .then((next) => !cancelled && setState(next))
      .catch((err) => {
        if (cancelled) return;
        setProblem(describeAuthError(err));
        setState('invalid');
      });
    return () => {
      cancelled = true;
    };
  }, [code, mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found: typeof errors = {};
    const pw = passwordProblem(password);
    if (!password) found.password = 'Enter a new password.';
    else if (pw) found.password = pw;
    if (confirm !== password) found.confirm = 'Passwords do not match.';
    setErrors(found);
    if (Object.keys(found).length || !code) return;
    setBusy(true);
    try {
      await completePasswordReset(code, password);
      setState('done');
    } catch (err) {
      setProblem(describeAuthError(err));
      const c = (err as { code?: string })?.code ?? '';
      if (/action-code/.test(c)) setState('invalid');
    } finally {
      setBusy(false);
    }
  };

  const clearLink = () => {
    if (typeof window !== 'undefined') window.history.replaceState(null, '', window.location.pathname);
  };

  if (state === 'checking') {
    return <p className="text-sm text-slate-400 py-6 text-center">Checking your link…</p>;
  }
  if (state === 'verified' || state === 'done') {
    return (
      <div className="space-y-5">
        <Notice tone="success">
          {state === 'done' ? 'Your password has been changed. Sign in with your new password.' : 'Your email address is verified. Thank you!'}
        </Notice>
        <button
          type="button"
          onClick={() => {
            clearLink();
            onDone();
          }}
          className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-bold text-white"
        >
          Continue to sign in
        </button>
      </div>
    );
  }
  if (state === 'invalid') {
    return (
      <div className="space-y-5">
        <Notice tone="error">{problem}</Notice>
        <button
          type="button"
          onClick={() => {
            clearLink();
            onRequestNew();
          }}
          className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-bold text-white"
        >
          Request a new reset link
        </button>
        <button
          type="button"
          onClick={() => {
            clearLink();
            onDone();
          }}
          className="w-full text-sm font-semibold text-slate-400 hover:text-white"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {problem && <Notice tone="error">{problem}</Notice>}
      <p className="text-sm text-slate-400">
        Account: <strong className="text-white break-all">{accountEmail}</strong>
      </p>
      <div>
        <PasswordField
          label="New password"
          icon={Lock}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          maxLength={128}
          autoFocus
        />
        <PasswordStrengthMeter password={password} />
      </div>
      <PasswordField
        label="Confirm new password"
        icon={KeyRound}
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={errors.confirm}
        maxLength={128}
      />
      <SubmitButton busy={busy} busyLabel="Saving…">
        Save new password
      </SubmitButton>
    </form>
  );
};

export const AuthLoadingScreen: React.FC<{ label?: string }> = ({ label = 'Loading NEXORA Academy…' }) => (
  <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-5 text-slate-300">
    <div className="relative">
      <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center overflow-hidden shadow-lg shadow-indigo-500/30">
        <img src="/logo.png" alt="" className="w-full h-full object-contain p-1.5" />
      </div>
      <span className="absolute -inset-2 rounded-3xl border-2 border-indigo-400/40 border-t-indigo-300 animate-spin" />
    </div>
    <p className="text-sm" role="status">
      {label}
    </p>
  </div>
);
