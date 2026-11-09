/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  GraduationCap,
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
  LogIn,
  LogOut,
} from 'lucide-react';
import { UserProfile, UserRole } from '../types/index.ts';
import { configuredExamDate, countdownLabel, getExamCountdown } from '../utils/examDate.ts';

interface Props {
  currentUser: UserProfile;
  currentView: string;
  onNavigate: (view: string) => void;
  onSwitchRole: (role: UserRole) => void;
  allUsers: UserProfile[];
  onSelectUser: (user: UserProfile) => void;
  pendingVerificationCount: number;
  firebaseUser?: any;
  onLoginWithGoogle?: () => void;
  onLogout?: () => void;
  isFirebaseConnected?: boolean;
  /** False while signed in: the account's own role applies and demo switching is locked. */
  canSwitchRole?: boolean;
}

export const Navbar: React.FC<Props> = ({
  currentUser,
  currentView,
  onNavigate,
  onSwitchRole,
  allUsers,
  onSelectUser,
  pendingVerificationCount,
  firebaseUser,
  onLoginWithGoogle,
  onLogout,
  isFirebaseConnected = true,
  canSwitchRole = true,
}) => {
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

        {/* Quick Role Switcher Pill */}
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] text-slate-400"
            title={canSwitchRole ? 'Demo mode: switch between the sample reviewee and administrator.' : 'Signed in: your account role applies. Sign out to use demo roles.'}
          >
            {canSwitchRole ? 'Demo Role:' : 'Signed-in role:'}
          </span>
          <div className={`inline-flex rounded-lg bg-slate-800 p-0.5 border border-slate-700 ${canSwitchRole ? '' : 'opacity-60'}`}>
            <button
              onClick={() => onSwitchRole('reviewee')}
              disabled={!canSwitchRole}
              className={`px-2.5 py-0.5 text-xs rounded-md font-medium transition disabled:cursor-not-allowed ${
                !isAdmin
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Reviewee
            </button>
            <button
              onClick={() => onSwitchRole('admin')}
              disabled={!canSwitchRole}
              className={`px-2.5 py-0.5 text-xs rounded-md font-medium transition flex items-center gap-1 disabled:cursor-not-allowed ${
                isAdmin
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Admin
              {pendingVerificationCount > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
              )}
            </button>
          </div>
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
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform">
              <GraduationCap className="w-6 h-6 text-white" />
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

                <button
                  onClick={() => onNavigate('audit-logs')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    currentView === 'audit-logs'
                      ? 'bg-slate-800 text-indigo-400 border border-slate-700'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4" />
                  Audit Logs
                </button>
              </>
            )}
          </nav>

          {/* User Profile & Active Account */}
          <div className="flex items-center gap-3">
            {firebaseUser ? (
              <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
                <img
                  src={firebaseUser.photoURL || currentUser.avatar}
                  alt={firebaseUser.displayName || currentUser.name}
                  className="w-9 h-9 rounded-full object-cover border-2 border-emerald-500"
                />
                <div className="hidden sm:block text-left">
                  <div className="text-xs font-semibold text-white truncate max-w-[150px]">
                    {firebaseUser.displayName || currentUser.name}
                  </div>
                  <div className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    {isAdmin ? 'Admin (Google)' : 'Reviewee (Google)'}
                  </div>
                </div>
                {onLogout && (
                  <button
                    onClick={onLogout}
                    title="Sign out from Google"
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition ml-1"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2.5 pl-2 border-l border-slate-800">
                {onLoginWithGoogle && (
                  <button
                    onClick={onLoginWithGoogle}
                    className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    Sign in with Google
                  </button>
                )}
                <img
                  src={currentUser.avatar}
                  alt={currentUser.name}
                  className="w-9 h-9 rounded-full object-cover border-2 border-slate-700"
                />
                <div className="hidden sm:block text-left">
                  <div className="text-xs font-semibold text-white truncate max-w-[150px]">
                    {currentUser.name}
                  </div>
                  <div className="text-[11px] text-slate-400 flex items-center gap-1">
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${
                        isAdmin ? 'bg-indigo-400' : 'bg-emerald-400'
                      }`}
                    />
                    {isAdmin ? 'Administrator' : 'REE Candidate'}
                  </div>
                </div>
              </div>
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
              onClick={() => onNavigate('audit-logs')}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${currentView === 'audit-logs' ? 'bg-indigo-600 text-white' : 'text-slate-300'}`}
            >
              Audit Logs
            </button>
          </>
        )}
      </div>
    </header>
  );
};
