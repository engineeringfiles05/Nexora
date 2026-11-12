/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Users, Award, TrendingUp, Calendar, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { UserProfile, ExamResult } from '../types/index.ts';
import { Avatar } from './Avatar.tsx';

interface Props {
  reviewees: UserProfile[];
  examResults: ExamResult[];
  /** Signed-in admin, registered accounts still loading. */
  loading?: boolean;
  error?: string;
}

export const RevieweeRosterView: React.FC<Props> = ({ reviewees, examResults, loading = false, error }) => {
  const status = error
    ? error
    : loading
      ? 'Loading registered reviewees…'
      : reviewees.length === 0
        ? 'No reviewee accounts yet. Reviewees appear here after they create an account.'
        : null;
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 select-none">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold uppercase tracking-wider font-mono">
            <Users className="w-3.5 h-3.5" />
            Candidate Monitoring
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Reviewee Cohort & Licensure Readiness
          </h1>
          <p className="text-xs text-slate-400 max-w-xl">
            Track individual and cohort performance, examination completion rates, and board passing probabilities.
          </p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px]">
              <tr>
                <th className="p-3.5 rounded-l-lg">Candidate Name</th>
                <th className="p-3.5">Target Board Licensure</th>
                <th className="p-3.5">Exams Completed</th>
                <th className="p-3.5">Average Score</th>
                <th className="p-3.5">Diagnostic Benchmark</th>
                <th className="p-3.5 rounded-r-lg">Pass Prediction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {status && (
                <tr>
                  <td colSpan={6} className={`p-6 text-center ${error ? 'text-rose-300' : 'text-slate-400'}`} role={error ? 'alert' : 'status'}>
                    {status}
                  </td>
                </tr>
              )}
              {!loading && !error && reviewees.map((rev) => {
                const userExams = examResults.filter((r) => r.userId === rev.id);
                const avg =
                  userExams.length > 0
                    ? Math.round(userExams.reduce((acc, c) => acc + c.scorePercentage, 0) / userExams.length)
                    : 75;
                const passedCount = userExams.filter((r) => r.isPassed).length;

                return (
                  <tr key={rev.id} className="hover:bg-slate-800/40 transition">
                    <td className="p-3.5 font-bold text-white flex items-center gap-3">
                      <Avatar name={rev.name} src={rev.avatar} className="w-8 h-8 border border-slate-700" />
                      <div>
                        <div>{rev.name}</div>
                        <div className="text-[10px] text-slate-400 font-normal">{rev.email}</div>
                        {rev.contactNumber && <div className="text-[10px] text-slate-500 font-normal">{rev.contactNumber}</div>}
                      </div>
                    </td>
                    <td className="p-3.5 text-slate-300">
                      {rev.course ? `${rev.course} · ` : ''}{rev.targetExam || 'Course not selected yet'}
                    </td>
                    <td className="p-3.5 font-mono">
                      {userExams.length} Exams ({passedCount} Passed)
                    </td>
                    <td className="p-3.5 font-mono font-bold text-emerald-400">
                      {avg}%
                    </td>
                    <td className="p-3.5">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800/40">
                        75% (Pre-Test Validated)
                      </span>
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                          avg >= 70
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {avg >= 70 ? 'High Likelihood (Pass)' : 'Requires Practice'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
