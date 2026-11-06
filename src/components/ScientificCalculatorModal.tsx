/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Delete, RotateCcw, Calculator as CalcIcon } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const ScientificCalculatorModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [display, setDisplay] = useState('0');
  const [history, setHistory] = useState('');
  const [isRad, setIsRad] = useState(false);
  const [entryState, setEntryState] = useState<'typing' | 'afterOperator' | 'afterResult'>('typing');

  if (!isOpen) return null;

  const handleDigit = (digit: string) => {
    setDisplay((prev) => {
      if (prev === '0' || prev === 'Error' || entryState === 'afterResult') {
        return digit === '.' ? '0.' : digit;
      }
      return prev + digit;
    });
    setEntryState('typing');
  };

  const handleOperator = (op: string) => {
    if (display === 'Error') return;
    if (entryState === 'afterOperator') {
      // A second operator press changes the pending operator.
      setHistory((prev) => prev.replace(/\S+ $/, `${op} `));
      return;
    }
    setHistory((prev) => `${prev}${display} ${op} `);
    setDisplay('0');
    setEntryState('afterOperator');
  };

  const handleClear = () => {
    setDisplay('0');
    setHistory('');
    setEntryState('typing');
  };

  const handleBackspace = () => {
    setDisplay((prev) => {
      if (prev.length <= 1 || prev === 'Error') return '0';
      return prev.slice(0, -1);
    });
    if (entryState === 'afterResult') setEntryState('typing');
  };

  const handleFunc = (func: string) => {
    try {
      // Functions apply to the number being typed, so "(30" keeps its bracket.
      const match = display.match(/^(.*?)(-?\d*\.?\d+(?:e[+-]?\d+)?)$/);
      const isConstant = func === 'pi' || func === 'e';
      const afterBracket = display.endsWith('(');
      if (!match && !(isConstant && (afterBracket || display === 'Error'))) return;
      const prefix = match ? match[1] : afterBracket ? display : '';
      const val = match ? parseFloat(match[2]) : 0;

      let result = 0;
      switch (func) {
        case 'sin': {
          const rad = isRad ? val : (val * Math.PI) / 180;
          result = Math.sin(rad);
          break;
        }
        case 'cos': {
          const rad = isRad ? val : (val * Math.PI) / 180;
          result = Math.cos(rad);
          break;
        }
        case 'tan': {
          const rad = isRad ? val : (val * Math.PI) / 180;
          result = Math.tan(rad);
          break;
        }
        case 'sqrt':
          result = Math.sqrt(val);
          break;
        case 'sqr':
          result = val * val;
          break;
        case 'ln':
          result = Math.log(val);
          break;
        case 'log':
          result = Math.log10(val);
          break;
        case 'inv':
          result = 1 / val;
          break;
        case 'pi':
          result = Math.PI;
          break;
        case 'e':
          result = Math.E;
          break;
        default:
          return;
      }

      if (!isFinite(result)) {
        setDisplay('Error');
        setEntryState('afterResult');
        return;
      }
      setDisplay(prefix + Number(result.toFixed(8)).toString());
      setEntryState(prefix ? 'typing' : 'afterResult');
    } catch {
      setDisplay('Error');
    }
  };

  const handleCalculate = () => {
    try {
      // "2 + =" evaluates as 2 rather than 2 + 0.
      const expression =
        entryState === 'afterOperator' ? history.replace(/\s*\S+ $/, '') : history + display;
      const fullExpression = expression
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/\^/g, '**');

      // Safe arithmetic evaluator
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${fullExpression})`)();
      if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
        setDisplay(Number(result.toFixed(8)).toString());
      } else {
        setDisplay('Error');
      }
    } catch {
      setDisplay('Error');
    }
    setHistory('');
    setEntryState('afterResult');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-800/80 border-b border-slate-700">
          <div className="flex items-center gap-2 text-white font-medium">
            <CalcIcon className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold tracking-wide">Board Exam Scientific Calculator</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsRad(!isRad)}
              className="text-xs px-2 py-0.5 rounded font-mono font-medium transition-colors bg-slate-700 text-slate-300 hover:text-white"
            >
              {isRad ? 'RAD' : 'DEG'}
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition"
              aria-label="Close calculator"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Display */}
        <div className="p-4 bg-slate-950 border-b border-slate-800 text-right">
          <div className="h-5 text-xs font-mono text-slate-400 overflow-hidden text-ellipsis whitespace-nowrap">
            {history}
          </div>
          <div className="text-2xl font-mono font-bold text-emerald-400 tracking-wider overflow-x-auto select-all">
            {display}
          </div>
        </div>

        {/* Keypad */}
        <div className="p-4 grid grid-cols-5 gap-2 text-sm font-medium">
          {/* Scientific row 1 */}
          <button onClick={() => handleFunc('sin')} className="p-2.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white text-xs">sin</button>
          <button onClick={() => handleFunc('cos')} className="p-2.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white text-xs">cos</button>
          <button onClick={() => handleFunc('tan')} className="p-2.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white text-xs">tan</button>
          <button onClick={() => handleFunc('pi')} className="p-2.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white text-xs">π</button>
          <button onClick={handleClear} className="p-2.5 rounded-lg bg-rose-900/40 text-rose-300 border border-rose-800/50 hover:bg-rose-900/60 text-xs font-semibold">AC</button>

          {/* Scientific row 2 */}
          <button onClick={() => handleFunc('sqrt')} className="p-2.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white text-xs">√x</button>
          <button onClick={() => handleFunc('sqr')} className="p-2.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white text-xs">x²</button>
          <button onClick={() => handleFunc('ln')} className="p-2.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white text-xs">ln</button>
          <button onClick={() => handleFunc('log')} className="p-2.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white text-xs">log</button>
          <button onClick={handleBackspace} className="p-2.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white flex items-center justify-center">
            <Delete className="w-4 h-4" />
          </button>

          {/* Numeric row 1 */}
          <button onClick={() => handleDigit('7')} className="p-3 rounded-lg bg-slate-800/80 text-white hover:bg-slate-700 font-semibold">7</button>
          <button onClick={() => handleDigit('8')} className="p-3 rounded-lg bg-slate-800/80 text-white hover:bg-slate-700 font-semibold">8</button>
          <button onClick={() => handleDigit('9')} className="p-3 rounded-lg bg-slate-800/80 text-white hover:bg-slate-700 font-semibold">9</button>
          <button onClick={() => handleOperator('÷')} className="p-3 rounded-lg bg-indigo-900/40 text-indigo-300 border border-indigo-800/40 hover:bg-indigo-800/50 font-semibold">÷</button>
          <button onClick={() => handleFunc('inv')} className="p-3 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs">1/x</button>

          {/* Numeric row 2 */}
          <button onClick={() => handleDigit('4')} className="p-3 rounded-lg bg-slate-800/80 text-white hover:bg-slate-700 font-semibold">4</button>
          <button onClick={() => handleDigit('5')} className="p-3 rounded-lg bg-slate-800/80 text-white hover:bg-slate-700 font-semibold">5</button>
          <button onClick={() => handleDigit('6')} className="p-3 rounded-lg bg-slate-800/80 text-white hover:bg-slate-700 font-semibold">6</button>
          <button onClick={() => handleOperator('×')} className="p-3 rounded-lg bg-indigo-900/40 text-indigo-300 border border-indigo-800/40 hover:bg-indigo-800/50 font-semibold">×</button>
          <button onClick={() => handleFunc('e')} className="p-3 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-serif">e</button>

          {/* Numeric row 3 */}
          <button onClick={() => handleDigit('1')} className="p-3 rounded-lg bg-slate-800/80 text-white hover:bg-slate-700 font-semibold">1</button>
          <button onClick={() => handleDigit('2')} className="p-3 rounded-lg bg-slate-800/80 text-white hover:bg-slate-700 font-semibold">2</button>
          <button onClick={() => handleDigit('3')} className="p-3 rounded-lg bg-slate-800/80 text-white hover:bg-slate-700 font-semibold">3</button>
          <button onClick={() => handleOperator('-')} className="p-3 rounded-lg bg-indigo-900/40 text-indigo-300 border border-indigo-800/40 hover:bg-indigo-800/50 font-semibold">-</button>
          <button onClick={() => handleDigit('(')} className="p-3 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700">(</button>

          {/* Numeric row 4 */}
          <button onClick={() => handleDigit('0')} className="p-3 rounded-lg bg-slate-800/80 text-white hover:bg-slate-700 font-semibold">0</button>
          <button onClick={() => handleDigit('.')} className="p-3 rounded-lg bg-slate-800/80 text-white hover:bg-slate-700 font-semibold">.</button>
          <button onClick={handleCalculate} className="p-3 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-500 shadow-lg shadow-emerald-900/40">=</button>
          <button onClick={() => handleOperator('+')} className="p-3 rounded-lg bg-indigo-900/40 text-indigo-300 border border-indigo-800/40 hover:bg-indigo-800/50 font-semibold">+</button>
          <button onClick={() => handleDigit(')')} className="p-3 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700">)</button>
        </div>
      </div>
    </div>
  );
};
