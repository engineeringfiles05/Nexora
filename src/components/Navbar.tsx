/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  ShieldCheck,
  FileUp,
  Database,
  Layers,
  Award,
  BookOpen,
  UserCheck,
  Sparkles,
  ChevronDown,
  Clock,
  History,
  Cloud,
  LogOut,
  Users,
  Bell,
} from 'lucide-react';
import { UserProfile } from '../types/index.ts';
import { Avatar } from './Avatar.tsx';
import { configuredExamDate, countdownLabel, getExamCountdown } from '../utils/examDate.ts';

interface Props {
  currentUser: UserProfile;
  currentView: string;
  onNavigate: (view: string) => void;
  pendingVerificationCount: number;
  /** Registrations waiting for the administrator's approval. */
  pendingApprovals?: number;
  onLogout?: () => void;
}

export const Navbar: React.FC<Props> = ({ currentUser, currentView, onNavigate, pendingVerificationCount, pendingApprovals = 0, onLogout }) => {
  const isAdmin = currentUser.role === 'admin';
  const countdown = getExamCountdown(configuredExamDate());

  return (
    <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 text-white">
      {/* Top Banner Ribbon */}
      <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-emerald-950 border-b border-slate-800/80 px-4 py-1.5 text-xs text-slate-300 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            OFFICIAL BOARD REVIEW CENTER
          </span>
          <span className="hidden md:inline text-slate-500">|</span>
          <span className="hidden md:inline text-slate-400">
            REE Board Exam: <strong className="text-white">{countdownLabel(countdown)}</strong>
          </span>
          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-950/80 border border-indigo-700/50 text-indigo-300">
            <Cloud className="w-3 h-3 text-indigo-400" />
            Firebase Connected
          </span>
        </div>

        {/* Signed-in role (set by the account, never chosen in the app) */}
        <div className="flex items-center gap-2 text-[11px]">
          <span className="hidden sm:inline text-slate-400">Signed in as</span>
          <span
            className={`px-2 py-0.5 rounded-md font-semibold border ${
              isAdmin ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-200' : 'bg-emerald-600/15 border-emerald-500/30 text-emerald-200'
            }`}
          >
            {isAdmin ? 'Administrator' : `Reviewee${currentUser.course ? ` · ${currentUser.course}` : ''}`}
          </span>
          {isAdmin && pendingVerificationCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" aria-hidden />}
          {isAdmin && pendingApprovals > 0 && (
            <button onClick={() => onNavigate('user-approvals')} className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-200 font-semibold hover:bg-amber-500/25">
              <Bell className="w-3 h-3" /> {pendingApprovals} new registration{pendingApprovals === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>

      {/* Main Navigation Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div
            onClick={() => onNavigate(isAdmin ? 'admin-dashboard' : 'reviewee-dashboard')}
            className="flex items-center gap-3 cursor-pointer group select-none"
          >
            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center overflow-hidden shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform">
              <img src="/logo.png" alt="Nexora Academy logo" className="w-full h-full object-contain p-1" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-extrabold tracking-wider bg-gradient-to-r from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent">
                  NEXORA
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono font-semibold border border-indigo-500/30">
                  ACADEMY
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-medium tracking-tight">
                BOARD EXAMINATION REVIEW PLATFORM
              </p>
            </div>
          </div>

          {/* Center Navigation Links based on Role */}
          <nav className="hidden lg:flex items-center gap-1">
            {!isAdmin ? (
              // Reviewee Navigation
              <>
                <button
                  onClick={() => onNavigate('reviewee-dashboard')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    currentView === 'reviewee-dashboard'
                      ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <BookOpen className="w-4 h-4" />
                  Dashboard
                </button>

                <button
                  onClick={() => onNavigate('pre-test-hub')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    currentView === 'pre-test-hub'
                      ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Award className="w-4 h-4" />
                  Pre-Test
                </button>

                <button
                  onClick={() => onNavigate('quizzes-hub')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    currentView === 'quizzes-hub'
                      ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Layers className="w-4 h-4" />
                  Subject Quizzes
                </button>

                <button
                  onClick={() => onNavigate('practice-hub')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    currentView === 'practice-hub'
                      ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Clock className="w-4 h-4" />
                  Practice Exam
                </button>

                <button
                  onClick={() => onNavigate('preboard-hub')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    currentView === 'preboard-hub'
                      ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4" />
                  Pre-Board
                </button>

                <button
                  onClick={() => onNavigate('mock-hub')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    currentView === 'mock-hub'
                      ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Award className="w-4 h-4 text-amber-400" />
                  Final Mock Board
                </button>

                <button
                  onClick={() => onNavigate('pdf-quiz-generator')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    currentView === 'pdf-quiz-generator'
                      ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                      : 'text-emerald-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  PDF Question Sets
                </button>

                <button
                  onClick={() => onNavigate('exam-history')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    currentView === 'exam-history'
                      ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <History className="w-4 h-4" />
                  History
                </button>
              </>
            ) : (
              // Administrator Navigation
              <>
                <button
                  onClick={() => onNavigate('admin-dashboard')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    currentView === 'admin-dashboard'
                      ? 'bg-slate-800 text-indigo-400 border border-slate-700'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Layers className="w-4 h-4" />
                  Overview
                </button>

                <button
                  onClick={() => onNavigate('user-approvals')}
                  title={pendingApprovals ? `${pendingApprovals} registration${pendingApprovals === 1 ? '' : 's'} waiting for approval` : 'User approvals'}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    currentView === 'user-approvals'
                      ? 'bg-slate-800 text-indigo-400 border border-slate-700'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <UserCheck className="w-4 h-4" />
                  Approvals
                  {pendingApprovals > 0 && (
                    <span className="min-w-[18px] px-1 py-0.5 text-[10px] leading-none rounded-full bg-amber-400 text-slate-950 font-extrabold tabular-nums" aria-label={`${pendingApprovals} pending`}>
                      {pendingApprovals}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => onNavigate('user-management')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    currentView === 'user-management'
                      ? 'bg-slate-800 text-indigo-400 border border-slate-700'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Users className="w-4 h-4" />
                  Users
                </button>

                <button
                  onClick={() => onNavigate('pdf-importer')}
                  className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2 shadow-sm ${
                    currentView === 'pdf-importer'
                      ? 'bg-indigo-600 text-white shadow-indigo-600/30'
                      : 'bg-indigo-950/60 text-indigo-300 hover:bg-indigo-900/80 border border-indigo-700/50'
                  }`}
                >
                  <FileUp className="w-4 h-4 text-indigo-400" />
                  <span>AI PDF Importer</span>
                  <span className="text-[10px] bg-indigo-500 text-white px-1.5 py-0.2 rounded font-mono uppercase font-bold">
                    AI OCR
                  </span>
                </button>

                <button
                  onClick={() => onNavigate('question-bank')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    currentView === 'question-bank'
                      ? 'bg-slate-800 text-indigo-400 border border-slate-700'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Database className="w-4 h-4" />
                  Question Bank
                  {pendingVerificationCount > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                      {pendingVerificationCount} review
                    </span>
                  )}
                </button>

                <button
                  onClick={() => onNavigate('pdf-sources')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    currentView === 'pdf-sources'
                      ? 'bg-slate-800 text-indigo-400 border border-slate-700'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <BookOpen className="w-4 h-4" />
                  Uploaded PDFs
                </button>

                <button
                  onClick={() => onNavigate('reviewees-roster')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    currentView === 'reviewees-roster'
                      ? 'bg-slate-800 text-indigo-400 border border-slate-700'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <UserCheck className="w-4 h-4" />
                  Reviewee Analytics
                </button>
              </>
            )}
          </nav>

          {/* User Profile & Active Account */}
          <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
            <button
              onClick={() => onNavigate('account')}
              title="My Account"
              className={`flex items-center gap-2 rounded-xl px-1.5 py-1 transition ${currentView === 'account' ? 'bg-slate-800' : 'hover:bg-slate-800/60'}`}
            >
              <Avatar name={currentUser.name} src={currentUser.avatar} className={`w-9 h-9 border-2 ${isAdmin ? 'border-indigo-500' : 'border-emerald-500'}`} />
              <span className="hidden sm:block text-left">
                <span className="block text-xs font-semibold text-white truncate max-w-[150px]">{currentUser.name}</span>
                <span className="block text-[10px] text-slate-400 flex items-center gap-1">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${isAdmin ? 'bg-indigo-400' : 'bg-emerald-400'}`} />
                  {isAdmin ? 'Administrator' : currentUser.course ? `${currentUser.course} Reviewee` : 'Reviewee'}
                </span>
              </span>
            </button>
            {onLogout && (
              <button
                onClick={onLogout}
                title="Sign out"
                aria-label="Sign out"
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile navigation row */}
      <div className="lg:hidden flex items-center gap-2 overflow-x-auto px-4 py-2 bg-slate-950/80 border-t border-slate-800 text-xs">
        {!isAdmin ? (
          <>
            <button
              onClick={() => onNavigate('reviewee-dashboard')}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${currentView === 'reviewee-dashboard' ? 'bg-emerald-600 text-white' : 'text-slate-300'}`}
            >
              Dashboard
            </button>
            <button
              onClick={() => onNavigate('pre-test-hub')}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${currentView === 'pre-test-hub' ? 'bg-emerald-600 text-white' : 'text-slate-300'}`}
            >
              Pre-Test
            </button>
            <button
              onClick={() => onNavigate('quizzes-hub')}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${currentView === 'quizzes-hub' ? 'bg-emerald-600 text-white' : 'text-slate-300'}`}
            >
              Quizzes
            </button>
            <button
              onClick={() => onNavigate('practice-hub')}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${currentView === 'practice-hub' ? 'bg-emerald-600 text-white' : 'text-slate-300'}`}
            >
              Practice
            </button>
            <button
              onClick={() => onNavigate('preboard-hub')}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${currentView === 'preboard-hub' ? 'bg-emerald-600 text-white' : 'text-slate-300'}`}
            >
              Pre-Board
            </button>
            <button
              onClick={() => onNavigate('mock-hub')}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${currentView === 'mock-hub' ? 'bg-emerald-600 text-white' : 'text-slate-300'}`}
            >
              Mock Board
            </button>
            <button
              onClick={() => onNavigate('pdf-quiz-generator')}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${currentView === 'pdf-quiz-generator' ? 'bg-emerald-600 text-white' : 'text-slate-300'}`}
            >
              PDF Sets
            </button>
            <button
              onClick={() => onNavigate('exam-history')}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${currentView === 'exam-history' ? 'bg-emerald-600 text-white' : 'text-slate-300'}`}
            >
              History
            </button>
            <button
              onClick={() => onNavigate('account')}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${currentView === 'account' ? 'bg-emerald-600 text-white' : 'text-slate-300'}`}
            >
              My Account
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onNavigate('admin-dashboard')}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${currentView === 'admin-dashboard' ? 'bg-indigo-600 text-white' : 'text-slate-300'}`}
            >
              Overview
            </button>
            <button
              onClick={() => onNavigate('user-approvals')}
              className={`px-2.5 py-1 rounded whitespace-nowrap flex items-center gap-1 ${currentView === 'user-approvals' ? 'bg-indigo-600 text-white' : 'text-slate-300'}`}
            >
              Approvals
              {pendingApprovals > 0 && <span className="px-1 rounded-full bg-amber-400 text-slate-950 text-[10px] font-extrabold tabular-nums">{pendingApprovals}</span>}
            </button>
            <button
              onClick={() => onNavigate('user-management')}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${currentView === 'user-management' ? 'bg-indigo-600 text-white' : 'text-slate-300'}`}
            >
              Users
            </button>
            <button
              onClick={() => onNavigate('pdf-importer')}
              className={`px-2.5 py-1 rounded whitespace-nowrap font-semibold ${currentView === 'pdf-importer' ? 'bg-indigo-600 text-white' : 'text-indigo-300'}`}
            >
              AI PDF Importer
            </button>
            <button
              onClick={() => onNavigate('question-bank')}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${currentView === 'question-bank' ? 'bg-indigo-600 text-white' : 'text-slate-300'}`}
            >
              Question Bank
            </button>
            <button
              onClick={() => onNavigate('pdf-sources')}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${currentView === 'pdf-sources' ? 'bg-indigo-600 text-white' : 'text-slate-300'}`}
            >
              PDF Sources
            </button>
            <button
              onClick={() => onNavigate('reviewees-roster')}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${currentView === 'reviewees-roster' ? 'bg-indigo-600 text-white' : 'text-slate-300'}`}
            >
              Reviewees
            </button>
            <button
              onClick={() => onNavigate('account')}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${currentView === 'account' ? 'bg-indigo-600 text-white' : 'text-slate-300'}`}
            >
              My Account
            </button>
          </>
        )}
      </div>
    </header>
  );
};
