import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SolutionMath } from '../components/SolutionMath.tsx';
import { SolutionPanel } from '../components/SolutionPanel.tsx';
import { legacyMathToLatex, splitSolutionMath } from './solutionMath.ts';

const render = (text: string) => renderToStaticMarkup(<SolutionMath>{text}</SolutionMath>);

test('LaTeX delimiters render fractions, roots, subscripts and units alongside prose', () => {
  const html = render(String.raw`The velocity is $v = \sqrt{2gh}$, so $$Q_t = \frac{1}{2}\,\mathrm{ft^3/s}$$`);
  assert.match(html, /The velocity is /);
  assert.match(html, /class="katex"/);
  assert.match(html, /<msqrt>/);
  assert.match(html, /<mfrac>/);
  assert.match(html, /<msub>/);
  assert.match(html, /katex-display/);
  assert.doesNotMatch(html, /katex-error/);
  const bracketed = render(String.raw`Use \(a^2\), then \[b = \frac{2}{3}\].`);
  assert.match(bracketed, /<mfrac>/);
  assert.match(bracketed, /<msup>/);
});

test('the existing hydraulic solution is typeset without changing stored content', () => {
  const steps = '1. a = π(2/12)²/4 = 0.02182 ft²; theoretical velocity √(2gh) = √(2 × 32.2 × 15) = 31.08 ft/s\n2. Qt = 0.02182 × 31.08 = 0.678 cfs\n3. Cd = Qa/Qt = 0.5/0.678 = 0.74';
  const question = { options: [], correctAnswer: '', explanation: '', stepByStepSolution: steps };
  const html = renderToStaticMarkup(<SolutionPanel question={question} />);
  assert.match(html, /<mfrac>/);
  assert.match(html, /<msqrt>/);
  assert.match(html, /<msup>/);
  assert.match(html, /<msub>/);
  assert.match(html, /theoretical velocity/);
  assert.match(html, /0\.678/);
  assert.doesNotMatch(html, /katex-error/);
  assert.equal(question.stepByStepSolution, steps);
  assert.match(legacyMathToLatex('a = π(2/12)²/4'), /\\frac\{\\left\(\\frac\{2\}\{12\}\\right\)\^\{2\}\}\{4\}/);
});

test('prose stays readable and invalid or untrusted input cannot inject HTML', () => {
  const prose = 'Coal is the most conventional source. Choice B lists 20 ohms.';
  assert.equal(render(prose), `<span class="solution-math">${prose}</span>`);
  assert.deepEqual(splitSolutionMath('The cost is $5.'), [{ text: 'The cost is $5.' }]);
  assert.match(render(String.raw`Keep $\frac{1}{$ readable.`), /readable/);
  assert.doesNotMatch(render(String.raw`$\href{javascript:alert(1)}{click}$ <img src=x onerror=alert(1)>`), /<a |<img /);
});

test('structured sections, formulas and final answers share the math renderer', () => {
  const html = renderToStaticMarkup(<SolutionPanel question={{
    options: [],
    correctAnswer: '',
    explanation: '',
    stepByStepSolution: String.raw`Solution:
1. Use $R = \frac{V}{I}$.

Final Answer:
$10\,\Omega$`,
    formulasUsed: [String.raw`$R = \frac{V}{I}$`],
  }} />);
  assert.equal((html.match(/<mfrac>/g) ?? []).length, 2);
  assert.match(html, /Final Answer/);
  assert.doesNotMatch(html, /katex-error/);
});

test('multiline display equations remain intact inside steps and final-answer paragraphs', () => {
  const html = renderToStaticMarkup(<SolutionPanel question={{
    options: [],
    correctAnswer: '',
    explanation: '',
    stepByStepSolution: String.raw`Solution:
1. Substitute:
$$
R = \frac{20}{2}

= 10\,\Omega
$$

Final Answer:
\[
10\,\Omega
\]`,
  }} />);
  assert.equal((html.match(/class="katex-display"/g) ?? []).length, 2);
  assert.match(html, /<mfrac>/);
  assert.doesNotMatch(html, /katex-error|\$\$/);
});
