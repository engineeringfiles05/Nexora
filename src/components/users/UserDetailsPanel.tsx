/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { ArrowLeft, Award, BookOpen, Calendar, Clock, Mail, Pencil, Phone, Send, ShieldAlert, TrendingDown, TrendingUp, UserCheck } from 'lucide-react';
import type { ExamResult, Subject, UserProfile } from '../../types/index.ts';
import { statusOf } from '../../auth/accountStatus.ts';
import { EXAM_TYPE_LABELS, summarizePerformance } from '../../utils/userAdmin.ts';
import { Avatar } from '../Avatar.tsx';
import { PercentBars, ScoreLineChart } from './MiniCharts.tsx';
import { StatusBadge, formatDate, formatDateTime } from './userUi.tsx';

interface Props {
  user: UserProfile;
  examResults: ExamResult[];
  subjects: Subject[];
  onBack: () => void;
  onEdit: () => void;
  onChangeStatus: (status: 'active' | 'inactive' | 'suspended') => void;
  onResendSetup: () => void;
  resendBusy?: boolean;
}

const HEADLINE_TYPES = ['pre_test', 'quiz', 'pre_board', 'final_mock'] as const;

export const UserDetailsPanel: React.FC<Props> = ({ user, examResults, subjects, onBack, onEdit, onChangeStatus, onResendSetup, resendBusy }) => {
  const perf = useMemo(() => summarizePerformance(user.id, examResults), [user.id, examResults]);
  const history = useMemo(() => [...examResults.filter((r) => r.userId === user.id)].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)), [examResults, user.id]);
  const status = statusOf(user);
  // The course's subjects, plus any other subject the reviewee has results in (matched by id).
  const courseSubjects = user.course === 'REE' ? subjects : [];
  const enrolledSubjects = [
    ...courseSubjects.map((s) => s.name),
    ...perf.bySubject.filter((s) => !courseSubjects.some((c) => c.id === s.subjectId)).map((s) => subjects.find((c) => c.id === s.subjectId)?.name ?? s.name),
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-slate-400 hover:text-white">
        <ArrowLeft className="w-4 h-4" /> All users
      </button>

      {/* Header */}
      <section className="rounded-3xl bg-slate-900 border border-slate-800 p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center gap-6">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <Avatar name={user.name} src={user.avatar} className="w-16 h-16 text-lg border-2 border-slate-700" />
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold text-white truncate">{user.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge status={status} />
              <span className={`px-2 py-0.5 rounded-full border font-semibold ${user.course ? 'border-slate-700 bg-slate-800 text-slate-200' : 'border-rose-800/60 bg-rose-950/40 text-rose-200'}`}>
                {user.course ? `${user.course} reviewee` : user.course === null ? 'Course access removed' : 'No course chosen'}
              </span>
            </div>
            {status !== 'active' && user.statusReason && <p className="mt-2 text-xs text-amber-200">Reason: {user.statusReason}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onEdit} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          {status === 'active' ? (
            <>
              <button onClick={() => onChangeStatus('suspended')} className="px-3.5 py-2 rounded-xl bg-amber-600/90 hover:bg-amber-500 text-xs font-semibold text-white">
                Suspend
              </button>
              <button onClick={() => onChangeStatus('inactive')} className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white">
                Deactivate
              </button>
            </>
          ) : (
            <button onClick={() => onChangeStatus('active')} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white">
              <UserCheck className="w-3.5 h-3.5" />
              {status === 'suspended' ? 'Restore' : status === 'pending' ? 'Approve' : 'Activate'}
            </button>
          )}
          {user.authProvider !== 'google.com' && (
            <button onClick={onResendSetup} disabled={resendBusy} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white disabled:opacity-60">
              <Send className="w-3.5 h-3.5" /> {resendBusy ? 'Sending…' : 'Send password link'}
            </button>
          )}
        </div>
      </section>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Personal information */}
        <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 sm:p-6 space-y-4">
          <h2 className="text-sm font-bold text-white">Personal information</h2>
          <dl className="space-y-3 text-sm">
            <Info icon={Mail} label="Email" value={user.email} />
            <Info icon={Phone} label="Contact number" value={user.contactNumber || '—'} />
            <Info icon={Calendar} label="Account created" value={formatDate(user.enrolledAt)} />
            <Info icon={Clock} label="Last login" value={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'No sign-in recorded yet'} />
            <Info icon={ShieldAlert} label="Sign-in method" value={user.authProvider === 'google.com' ? 'Google' : 'Email and password'} />
            {user.statusChangedAt && <Info icon={ShieldAlert} label="Status changed" value={formatDateTime(user.statusChangedAt)} />}
          </dl>
          <div>
            <h3 className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" /> Subjects
            </h3>
            {enrolledSubjects.length ? (
              <div className="flex flex-wrap gap-1.5">
                {enrolledSubjects.map((name) => (
                  <span key={name} className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[11px] text-slate-200">
                    {name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">{user.course === 'RME' ? 'Subjects follow the RME question sets you publish.' : 'No subjects yet.'}</p>
            )}
          </div>
        </section>

        {/* Overall */}
        <section className="lg:col-span-2 rounded-2xl bg-slate-900 border border-slate-800 p-5 sm:p-6 space-y-5">
          <h2 className="text-sm font-bold text-white">Overall performance</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="Exams taken" value={String(perf.attempts)} />
            <Metric label="Average score" value={perf.average === null ? '—' : `${perf.average}%`} />
            <Metric label="Pass rate" value={perf.passRate === null ? '—' : `${perf.passRate}%`} />
            <Metric
              label="Progress"
              value={perf.trend === null ? '—' : `${perf.trend > 0 ? '+' : ''}${perf.trend} pts`}
              hint={perf.trend === null ? 'Needs 4+ exams' : 'Last 3 vs first 3 exams'}
              icon={perf.trend === null ? undefined : perf.trend >= 0 ? TrendingUp : TrendingDown}
              good={perf.trend === null ? undefined : perf.trend >= 0}
            />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-slate-400 mb-2">Score per exam over time</h3>
            {perf.timeline.length ? (
              <ScoreLineChart points={perf.timeline} />
            ) : (
              <p className="text-sm text-slate-500 py-8 text-center rounded-xl border border-dashed border-slate-800">No examinations taken yet.</p>
            )}
          </div>
        </section>
      </div>

      {/* By exam type */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {HEADLINE_TYPES.map((type) => {
          const t = perf.byType.find((x) => x.type === type)!;
          return (
            <div key={type} className="rounded-2xl bg-slate-900 border border-slate-800 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">{EXAM_TYPE_LABELS[type]}</h3>
                <Award className="w-4 h-4 text-indigo-300" />
              </div>
              {t.attempts === 0 ? (
                <p className="mt-3 text-xs text-slate-500">Not taken yet</p>
              ) : (
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <dt className="text-[10px] uppercase text-slate-500">Latest</dt>
                    <dd className="text-lg font-bold text-white tabular-nums">{t.latest}%</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-slate-500">Best</dt>
                    <dd className="text-lg font-bold text-white tabular-nums">{t.best}%</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-slate-500">Taken</dt>
                    <dd className="text-lg font-bold text-white tabular-nums">{t.attempts}</dd>
                  </div>
                  <dd className="col-span-3 text-[11px] text-slate-400">
                    Average {t.average}% · passed {t.passed} of {t.attempts}
                  </dd>
                </dl>
              )}
            </div>
          );
        })}
      </section>

      <div className="grid lg:grid-cols-3 gap-6">
        <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 sm:p-6 space-y-4">
          <h2 className="text-sm font-bold text-white">Learning progress by subject</h2>
          {perf.bySubject.length ? (
            <PercentBars rows={perf.bySubject.map((s) => ({ label: s.name, value: s.percentage, note: `${s.attempts} exam${s.attempts === 1 ? '' : 's'}` }))} />
          ) : (
            <p className="text-xs text-slate-500">No subject results yet.</p>
          )}
          {perf.weakTopics.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-400 mb-2">Topics to review</h3>
              <div className="flex flex-wrap gap-1.5">
                {perf.weakTopics.map((topic) => (
                  <span key={topic} className="px-2 py-0.5 rounded-md bg-amber-950/40 border border-amber-800/50 text-[11px] text-amber-100">
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="lg:col-span-2 rounded-2xl bg-slate-900 border border-slate-800 p-5 sm:p-6">
          <h2 className="text-sm font-bold text-white mb-4">Examination history</h2>
          {history.length === 0 ? (
            <p className="text-sm text-slate-500">No examinations taken yet.</p>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase text-slate-500 border-b border-slate-800">
                  <tr>
                    <th className="py-2 px-1 font-semibold">Date</th>
                    <th className="py-2 px-1 font-semibold">Type</th>
                    <th className="py-2 px-1 font-semibold">Examination</th>
                    <th className="py-2 px-1 font-semibold text-right">Score</th>
                    <th className="py-2 px-1 font-semibold text-right">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {history.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2.5 px-1 text-slate-400 whitespace-nowrap">{formatDate(r.completedAt)}</td>
                      <td className="py-2.5 px-1 text-slate-300 whitespace-nowrap">{EXAM_TYPE_LABELS[r.type]}</td>
                      <td className="py-2.5 px-1 text-white">{r.title}</td>
                      <td className="py-2.5 px-1 text-right text-white font-semibold tabular-nums">{r.scorePercentage}%</td>
                      <td className="py-2.5 px-1 text-right">
                        <span className={`font-semibold ${r.isPassed ? 'text-emerald-300' : 'text-rose-300'}`}>{r.isPassed ? 'Passed' : 'Not passed'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

const Info: React.FC<{ icon: React.ComponentType<{ className?: string }>; label: string; value: string }> = ({ icon: Icon, label, value }) => (
  <div className="flex items-start gap-3">
    <Icon className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
    <div className="min-w-0">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="text-slate-200 break-words">{value}</dd>
    </div>
  </div>
);

const Metric: React.FC<{ label: string; value: string; hint?: string; icon?: React.ComponentType<{ className?: string }>; good?: boolean }> = ({ label, value, hint, icon: Icon, good }) => (
  <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3">
    <div className="text-[11px] text-slate-500">{label}</div>
    <div className="mt-1 flex items-center gap-1.5 text-xl font-extrabold text-white tabular-nums">
      {Icon && <Icon className={`w-4 h-4 ${good ? 'text-emerald-300' : 'text-rose-300'}`} />}
      {value}
    </div>
    {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
  </div>
);
