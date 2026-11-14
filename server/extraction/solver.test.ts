import test from 'node:test';
import assert from 'node:assert/strict';
import type { GoogleGenAI } from '@google/genai';
import { solveWithAi } from './solver.ts';

const input = {
  question: 'A machine does 37.5 J of work per cycle at 45 cycles per minute. Find its power.',
  options: [{ key: 'A', text: '28.125 W' }],
};
const formulas = [
  String.raw`Power: $P = E_{\mathrm{cycle}} f$, where $E_{\mathrm{cycle}}$ is work per cycle and $f$ is cycles per second.`,
  String.raw`Frequency conversion: $f = \frac{n}{60}$, where $n$ is cycles per minute.`,
];
const calculation = {
  answerKey: 'A', confidence: 'high', find: 'Power', explanation: 'Power is work per unit time.',
  solutionSteps: [String.raw`$P = E_{\mathrm{cycle}} f = 37.5\times\frac{45}{60} = 28.125\,\mathrm{W}$`],
  finalAnswerWithUnit: String.raw`$28.125\,\mathrm{W}$`,
};

function mockAi(replies: unknown[]) {
  const requests: any[] = [];
  const ai = { models: { generateContent: async (request: unknown) => {
    requests.push(request);
    return { text: JSON.stringify(replies[Math.min(requests.length - 1, replies.length - 1)]) };
  } } } as unknown as GoogleGenAI;
  return { ai, requests };
}

test('generated solutions require the governing formula and conversion before the working', async () => {
  const { ai, requests } = mockAi([{ ...calculation, formulasUsed: formulas }]);
  const solution = await solveWithAi(ai, 'test-model', input);
  assert.deepEqual(solution.formulasUsed, formulas);
  assert.ok(solution.stepByStepSolution.indexOf(formulas[0]) < solution.stepByStepSolution.indexOf('Solution:'));
  assert.ok(solution.stepByStepSolution.indexOf(formulas[1]) < solution.stepByStepSolution.indexOf('Solution:'));
  assert.ok(requests[0].config.responseSchema.required.includes('formulasUsed'));
  assert.match(requests[0].contents, /ALL formulas used/);
  assert.match(requests[0].contents, /general symbolic form BEFORE substituting/);
  assert.equal(requests.length, 1);
});

test('a calculation with missing or blank formulas is regenerated once', async () => {
  for (const formulasUsed of [undefined, [], ['  ']]) {
    const { ai, requests } = mockAi([{ ...calculation, formulasUsed }, { ...calculation, formulasUsed: formulas }]);
    const solution = await solveWithAi(ai, 'test-model', input);
    assert.deepEqual(solution.formulasUsed, formulas);
    assert.equal(requests.length, 2);
    assert.match(requests[1].contents, /previous response omitted the formulas/);
  }
});

test('a calculation still missing its formulas is rejected rather than saved incomplete', async () => {
  const { ai, requests } = mockAi([{ ...calculation, formulasUsed: [] }]);
  await assert.rejects(solveWithAi(ai, 'test-model', input), /omitted its formulas/);
  assert.equal(requests.length, 2);
});

test('purely conceptual solutions may have no mathematical formula', async () => {
  const { ai, requests } = mockAi([{
    answerKey: 'A', confidence: 'high', find: 'Instrument', formulasUsed: [],
    solutionSteps: ['Use an insulation resistance tester.'],
    explanation: 'A megger measures insulation resistance.', finalAnswerWithUnit: 'Megger',
  }]);
  const solution = await solveWithAi(ai, 'test-model', { question: 'Which instrument measures insulation resistance?', options: [{ key: 'A', text: 'Megger' }] });
  assert.deepEqual(solution.formulasUsed, []);
  assert.equal(requests.length, 1);
});
