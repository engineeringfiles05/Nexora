/** Math delimiters are preferred; older imported solutions are converted for display only. */
export interface SolutionMathPart {
  text: string;
  math?: boolean;
  display?: boolean;
}

const symbols: Record<string, string> = {
  'π': '\\pi', 'θ': '\\theta', 'ω': '\\omega', 'μ': '\\mu', 'η': '\\eta',
  'Ω': '\\Omega', 'Σ': '\\sum', '×': '\\times', '*': '\\times', '÷': '\\div',
  '≈': '\\approx', '⇒': '\\Rightarrow', '≠': '\\ne', '−': '-', '–': '-',
  '²': '^{2}', '³': '^{3}', '°': '^{\\circ}', '%': '\\%',
};

/** A small arithmetic reader: grouping and powers bind before division. No evaluation. */
export function legacyMathToLatex(source: string): string {
  const tokens = source.match(/\d+(?:[.,]\d+)*|[A-Za-z]+\d*|[^\s]/g) ?? [];
  let position = 0;
  function atom(): string {
    const token = tokens[position++] ?? '';
    let value: string;
    if (token === '(' || token === '[') {
      const close = token === '(' ? ')' : ']';
      value = `\\left${token}${expression(close)}\\right${close}`;
    } else if ((token === '√' || token === 'sqrt') && tokens[position] === '(') {
      position++;
      value = `\\sqrt{${expression(')')}}`;
    } else if (/^(?:sin|cos|tan|ln|log|exp)$/.test(token)) {
      value = `\\${token}`;
    } else if (/^[A-Z][a-z]\d*$/.test(token)) {
      value = `${token[0]}_{${token.slice(1)}}`;
    } else if (/^[A-Za-z]{2,}\d*$/.test(token)) {
      value = `\\mathrm{${token}}`;
    } else {
      value = symbols[token] ?? token;
    }
    if (tokens[position] === '^' || tokens[position] === '_') {
      const operator = tokens[position++];
      value += `${operator}{${atom()}}`;
    }
    // Unicode exponents belong to the preceding atom, including in a fraction.
    while (tokens[position] === '²' || tokens[position] === '³') value += symbols[tokens[position++]];
    return value;
  }
  function expression(close?: string): string {
    const parts: string[] = [];
    while (position < tokens.length && tokens[position] !== close) {
      if (tokens[position] === '/' && parts.length && position + 1 < tokens.length) {
        position++;
        parts.push(`\\frac{${parts.pop()}}{${atom()}}`);
      } else {
        parts.push(atom());
      }
    }
    if (close && tokens[position] === close) position++;
    return parts.join(' ');
  }
  return expression();
}

function legacyParts(text: string): SolutionMathPart[] {
  // Keep explanatory prose intact and identify the variable introducing an equation.
  return text.split(/([;\n]|\.(?=\s+[A-Z]))/).flatMap((line): SolutionMathPart[] => {
    const start = /(?:[A-Za-zα-ωΑ-Ω][A-Za-z0-9_α-ωΑ-Ω]*(?:\([^)]*\))?|√\([^)]*\)|\\[a-zA-Z]+(?:\{[^}]*\})?)\s*(?=[=≈])/.exec(line);
    if (!start) {
      // Accept bare LaTeX as well as delimited math, and simple results with units.
      if (/^\s*\\(?:frac|sqrt|boxed|begin)\b/.test(line)) return [{ text: line, math: true }];
      if (/^\s*-?\d+(?:\.\d+)?\s+[A-Za-zΩ°]+(?:[²³]|\/[A-Za-z]+)?\s*$/.test(line)) {
        return [{ text: legacyMathToLatex(line), math: true }];
      }
      return [{ text: line }];
    }
    const equation = line.slice(start.index);
    return [
      { text: line.slice(0, start.index) },
      { text: /\\[a-zA-Z]+/.test(equation) ? equation : legacyMathToLatex(equation), math: true },
    ];
  });
}

export function splitSolutionMath(text: string): SolutionMathPart[] {
  const delimiter = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^\n$]+?)(?<!\\)\$/g;
  const parts: SolutionMathPart[] = [];
  let end = 0;
  for (const match of text.matchAll(delimiter)) {
    // Explicit math delimiters leave surrounding prose untouched.
    parts.push({ text: text.slice(end, match.index) });
    parts.push({ text: match[1] ?? match[2] ?? match[3] ?? match[4], math: true, display: match[1] !== undefined || match[2] !== undefined });
    end = match.index! + match[0].length;
  }
  if (!end) return legacyParts(text);
  parts.push({ text: text.slice(end) });
  return parts.filter((part) => part.text);
}
