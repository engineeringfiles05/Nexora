import React, { useMemo } from 'react';
import katex from 'katex';
import { splitSolutionMath } from '../utils/solutionMath.ts';

/** KaTeX provides typeset HTML and accessible MathML without trusting source HTML. */
export const SolutionMath: React.FC<{ children: string }> = ({ children }) => {
  const parts = useMemo(() => splitSolutionMath(children).map((part) => {
    if (!part.math) return { ...part, html: null };
    try {
      return { ...part, html: katex.renderToString(part.text, {
        displayMode: Boolean(part.display),
        throwOnError: true,
        strict: 'ignore',
        trust: false,
        maxSize: 20,
        maxExpand: 1000,
      }) };
    } catch {
      // A malformed imported equation must not hide the rest of the solution.
      return { ...part, html: null };
    }
  }), [children]);

  return <span className="solution-math">{parts.map((part, i) => part.html
    ? <span key={i} className={part.display ? 'solution-math-display' : undefined} dangerouslySetInnerHTML={{ __html: part.html }} />
    : <React.Fragment key={i}>{part.text}</React.Fragment>)}</span>;
};
