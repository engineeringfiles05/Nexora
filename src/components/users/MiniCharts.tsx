/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Small single-series charts for the user management pages. Thin marks, recessive grid,
 * values on hover (and as text alternatives), one hue per chart.
 */

import React, { useState } from 'react';

const INK = '#cbd5e1'; // slate-300
const MUTED = '#64748b'; // slate-500
const GRID = 'rgba(148,163,184,0.15)';

interface Tip {
  /** Position as fractions (0-1) of the chart's width and height. */
  x: number;
  y: number;
  label: string;
  value: string;
}

const Tooltip: React.FC<{ tip: Tip | null }> = ({ tip }) =>
  tip ? (
    <div
      role="presentation"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-700 bg-slate-950/95 px-2.5 py-1.5 text-[11px] shadow-xl whitespace-nowrap"
      style={{ left: `${tip.x * 100}%`, top: `${tip.y * 100}%`, marginTop: -8 }}
    >
      <div className="text-slate-400">{tip.label}</div>
      <div className="font-semibold text-white">{tip.value}</div>
    </div>
  ) : null;

/** Vertical bars, e.g. registrations per week. */
export const BarChart: React.FC<{
  data: { label: string; value: number }[];
  valueLabel: (v: number) => string;
  height?: number;
  color?: string;
  ariaLabel: string;
}> = ({ data, valueLabel, height = 170, color = '#818cf8', ariaLabel }) => {
  const [tip, setTip] = useState<Tip | null>(null);
  const width = 720;
  const pad = { top: 10, bottom: 24, left: 4, right: 4 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const inner = height - pad.top - pad.bottom;
  const slot = (width - pad.left - pad.right) / Math.max(1, data.length);
  const bar = Math.min(36, slot * 0.5);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label={ariaLabel} onMouseLeave={() => setTip(null)}>
        {[0.5, 1].map((f) => (
          <line key={f} x1={pad.left} x2={width - pad.right} y1={pad.top + inner * (1 - f)} y2={pad.top + inner * (1 - f)} stroke={GRID} strokeWidth={1} />
        ))}
        <line x1={pad.left} x2={width - pad.right} y1={pad.top + inner} y2={pad.top + inner} stroke={MUTED} strokeWidth={1} />
        {data.map((d, i) => {
          const h = (d.value / max) * inner;
          const cx = pad.left + slot * i + slot / 2;
          const y = pad.top + inner - h;
          const show = () => setTip({ x: cx / width, y: y / height, label: d.label, value: valueLabel(d.value) });
          return (
            <g key={i}>
              {h > 0 && <path d={roundedTopBar(cx - bar / 2, y, bar, h, Math.min(4, h))} fill={color} />}
              <text x={cx} y={height - 6} textAnchor="middle" fontSize={11} fill={MUTED}>
                {d.label}
              </text>
              {/* Hit target taller and wider than the bar. */}
              <rect
                x={cx - slot / 2}
                y={pad.top}
                width={slot}
                height={inner}
                fill="transparent"
                onMouseEnter={show}
                onFocus={show}
                onBlur={() => setTip(null)}
                tabIndex={0}
                aria-label={`${d.label}: ${valueLabel(d.value)}`}
              />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
};

function roundedTopBar(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** Scores over time (0-100%), with the passing line. */
export const ScoreLineChart: React.FC<{
  points: { at: number; score: number; title: string }[];
  passing?: number;
  height?: number;
}> = ({ points, passing = 70, height = 180 }) => {
  const [hover, setHover] = useState<number | null>(null);
  const width = 560;
  const pad = { top: 12, bottom: 22, left: 30, right: 10 };
  const inner = { w: width - pad.left - pad.right, h: height - pad.top - pad.bottom };
  const x = (i: number) => pad.left + (points.length <= 1 ? inner.w / 2 : (i / (points.length - 1)) * inner.w);
  const y = (score: number) => pad.top + inner.h * (1 - Math.max(0, Math.min(100, score)) / 100);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const active = hover !== null ? points[hover] : null;
  const date = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const nearest = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * width;
    let best = 0;
    points.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    return best;
  };

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Exam scores over time, ${points.length} exams`}
        onMouseMove={(e) => points.length && setHover(nearest(e.clientX, (e.currentTarget as SVGSVGElement).getBoundingClientRect()))}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke={v === 0 ? MUTED : GRID} strokeWidth={1} />
            <text x={pad.left - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill={MUTED}>
              {v}%
            </text>
          </g>
        ))}
        <line x1={pad.left} x2={width - pad.right} y1={y(passing)} y2={y(passing)} stroke="#fbbf24" strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
        <text x={width - pad.right} y={y(passing) - 4} textAnchor="end" fontSize={9} fill={INK}>
          Passing {passing}%
        </text>
        {points.length > 1 && <path d={path} fill="none" stroke="#34d399" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {active && hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + inner.h} stroke={MUTED} strokeWidth={1} />}
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.score)} r={hover === i ? 5 : 4} fill="#34d399" stroke="#0f172a" strokeWidth={2} />
        ))}
        {points.length > 0 && (
          <>
            <text x={x(0)} y={height - 6} textAnchor={points.length > 1 ? 'start' : 'middle'} fontSize={9} fill={MUTED}>
              {date(points[0]!.at)}
            </text>
            {points.length > 1 && (
              <text x={x(points.length - 1)} y={height - 6} textAnchor="end" fontSize={9} fill={MUTED}>
                {date(points[points.length - 1]!.at)}
              </text>
            )}
          </>
        )}
      </svg>
      {active && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-700 bg-slate-950/95 px-2.5 py-1.5 text-[11px] shadow-xl max-w-[220px]"
          style={{ left: `${(x(hover) / width) * 100}%`, top: `${(y(active.score) / height) * 100}%`, marginTop: -8 }}
        >
          <div className="text-slate-400 truncate">
            {date(active.at)} · {active.title}
          </div>
          <div className="font-semibold text-white">{active.score}%</div>
        </div>
      )}
    </div>
  );
};

/** Horizontal percentage bars with direct value labels. */
export const PercentBars: React.FC<{ rows: { label: string; value: number; note?: string }[] }> = ({ rows }) => (
  <ul className="space-y-3">
    {rows.map((row) => (
      <li key={row.label}>
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-slate-300 truncate">{row.label}</span>
          <span className="text-white font-semibold tabular-nums">
            {row.value}%{row.note && <span className="text-slate-500 font-normal"> · {row.note}</span>}
          </span>
        </div>
        <div className="mt-1.5 h-2 rounded-full bg-slate-800 overflow-hidden" aria-hidden>
          <div className="h-full rounded-full bg-indigo-400" style={{ width: `${Math.max(0, Math.min(100, row.value))}%` }} />
        </div>
      </li>
    ))}
  </ul>
);
