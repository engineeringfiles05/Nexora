/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, BookOpen, Search } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const FormulaReferenceDrawer: React.FC<Props> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'math' | 'esas' | 'ee'>('ee');
  const [search, setSearch] = useState('');

  if (!isOpen) return null;

  const formulas = {
    math: [
      {
        title: 'Laplace Transforms',
        items: [
          { name: 'Cosine', formula: 'L{cos(ωt)} = s / (s² + ω²)' },
          { name: 'Sine', formula: 'L{sin(ωt)} = ω / (s² + ω²)' },
          { name: 'First Shifting Theorem', formula: 'L{e^(at) f(t)} = F(s - a)' },
          { name: 'Unit Step Function', formula: 'L{u(t - a)} = e^(-as) / s' },
        ],
      },
      {
        title: 'Calculus & Derivatives',
        items: [
          { name: 'Product Rule', formula: 'd/dx [u·v] = u·v\' + v·u\'' },
          { name: 'Quotient Rule', formula: 'd/dx [u/v] = (v·u\' - u·v\') / v²' },
          { name: 'Logarithmic Chain Rule', formula: 'd/dx [ln(u)] = u\' / u' },
          { name: 'Exponential Derivative', formula: 'd/dx [e^u] = e^u · u\'' },
        ],
      },
      {
        title: 'Differential Equations',
        items: [
          { name: 'Linear 1st Order Integrating Factor', formula: 'μ(x) = e^(∫ P(x) dx)' },
          { name: 'General Solution', formula: 'y · μ(x) = ∫ Q(x) · μ(x) dx + C' },
        ],
      },
    ],
    esas: [
      {
        title: 'Engineering Mechanics',
        items: [
          { name: 'Static Friction Limit', formula: 'Fs,max = μs · N' },
          { name: 'Work-Energy Principle', formula: 'Wnet = ΔKE = 0.5·m·(v2² - v1²)' },
          { name: 'Normal Axial Stress', formula: 'σ = P / A' },
          { name: 'Axial Deformation (Hooke)', formula: 'δ = (P · L) / (A · E)' },
        ],
      },
      {
        title: 'Thermodynamics',
        items: [
          { name: 'Carnot Thermal Efficiency', formula: 'η = 1 - (Tc / Th)' },
          { name: 'Work Output (Carnot)', formula: 'W = η · Qh = Qh - Qc' },
          { name: 'Ideal Gas Law', formula: 'P · V = m · R · T' },
        ],
      },
      {
        title: 'Engineering Economy',
        items: [
          { name: 'Single Payment Compound Amount', formula: 'F = P · (1 + i)^n' },
          { name: 'Present Worth Factor', formula: 'P = F / (1 + i)^n' },
          { name: 'Uniform Series Capital Recovery', formula: 'A = P · [i·(1+i)^n / ((1+i)^n - 1)]' },
        ],
      },
      {
        title: 'Philippine Electrical Code (PEC)',
        items: [
          { name: 'Maximum Conduit Bends', formula: 'Max 360° total (4 quarter bends) between pull points' },
          { name: 'Service Drop Sidewalk Clearance', formula: '3,000 mm (10 ft) minimum vertical clearance' },
          { name: 'Residential Driveway Clearance', formula: '3,700 mm (12 ft) minimum clearance' },
        ],
      },
    ],
    ee: [
      {
        title: 'DC & AC Circuits',
        items: [
          { name: 'Series RLC Resonant Frequency', formula: 'fr = 1 / [2 · π · √(L · C)]' },
          { name: 'Quality Factor (Series RLC)', formula: 'Q = (1/R) · √(L/C) = ω0 · L / R' },
          { name: 'Apparent Power', formula: 'S = V · I = √(P² + Q²)' },
          { name: 'Power Factor Correction', formula: 'Qc = P · [tan(θ1) - tan(θ2)]' },
          { name: '3-Phase Balanced Power', formula: 'P3φ = √3 · VL · IL · cos θ' },
        ],
      },
      {
        title: 'Transformers & Electrical Machinery',
        items: [
          { name: 'Transformer Ratio', formula: 'V1 / V2 = N1 / N2 = I2 / I1' },
          { name: 'Transformer Efficiency', formula: 'η = (Pout) / (Pout + Pcu + Pcore) · 100%' },
          { name: 'Synchronous Speed', formula: 'Ns = 120 · f / P (rpm)' },
          { name: 'Induction Motor Slip', formula: 's = (Ns - Nr) / Ns' },
          { name: 'Rotor Speed', formula: 'Nr = Ns · (1 - s)' },
          { name: 'DC Motor Back EMF', formula: 'Eb = V - Ia · Ra' },
        ],
      },
      {
        title: 'Power Systems & Protection',
        items: [
          { name: 'Zero-Sequence Component', formula: 'Ia0 = (1/3) · (Ia + Ib + Ic)' },
          { name: 'Neutral Current', formula: 'In = 3 · Ia0' },
          { name: 'Per Unit Impedance Base Change', formula: 'Zpu,new = Zpu,old · (Vbase,old/Vbase,new)² · (Sbase,new/Sbase,old)' },
          { name: 'Differential Relay Threshold (87)', formula: 'Ioperating = |I1 - I2|' },
        ],
      },
    ],
  };

  const filteredSections = formulas[activeTab].map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        item.formula.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter((section) => section.items.length > 0);

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-96 bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-indigo-400" />
          <h2 className="font-semibold text-white text-sm">Board Exam Formula Sheet</h2>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          aria-label="Close formula reference"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-900/80">
        <button
          onClick={() => setActiveTab('ee')}
          className={`flex-1 py-2.5 text-xs font-semibold text-center border-b-2 transition ${
            activeTab === 'ee'
              ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Electrical (EE)
        </button>
        <button
          onClick={() => setActiveTab('esas')}
          className={`flex-1 py-2.5 text-xs font-semibold text-center border-b-2 transition ${
            activeTab === 'esas'
              ? 'border-blue-500 text-blue-400 bg-blue-500/10'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Sciences (ESAS)
        </button>
        <button
          onClick={() => setActiveTab('math')}
          className={`flex-1 py-2.5 text-xs font-semibold text-center border-b-2 transition ${
            activeTab === 'math'
              ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Math
        </button>
      </div>

      {/* Search */}
      <div className="p-3 border-b border-slate-800 bg-slate-900">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search formulas or terms..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Formulas List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {filteredSections.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500">
            No formulas match "{search}".
          </div>
        ) : (
          filteredSections.map((sec, idx) => (
            <div key={idx} className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-1">
                {sec.title}
              </h3>
              <div className="space-y-2">
                {sec.items.map((item, itemIdx) => (
                  <div
                    key={itemIdx}
                    className="p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/60 hover:border-slate-600 transition"
                  >
                    <div className="text-xs text-slate-300 font-medium mb-1">{item.name}</div>
                    <div className="font-mono text-xs text-emerald-400 bg-slate-950/80 px-2.5 py-1.5 rounded border border-slate-800 select-all">
                      {item.formula}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-3 bg-slate-950 border-t border-slate-800 text-[11px] text-slate-500 text-center">
        Philippine Professional Regulation Commission (PRC) Approved Formulation Standards
      </div>
    </div>
  );
};
