import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenizeFormula,
  toSuperscript,
  formatPhysicsNumber,
  measureMathFormula,
} from '../src/physicsFormula.js';

test('tokenizeFormula handles calligraphic EMF script letters \\mathcal{E} and ℰ', () => {
  const tokens1 = tokenizeFormula('\\mathcal{E}_{i}=-n\\Delta\\Phi_{B}/\\Delta t');
  assert.equal(tokens1[0].kind, 'calligraphic');
  assert.equal(tokens1[0].text, 'ℰ');
  assert.equal(tokens1[1].kind, 'sub');
  assert.equal(tokens1[1].text, 'i');

  const tokens2 = tokenizeFormula('ℰ_i');
  assert.equal(tokens2[0].kind, 'calligraphic');
  assert.equal(tokens2[0].text, 'ℰ');
  assert.equal(tokens2[1].kind, 'sub');
  assert.equal(tokens2[1].text, 'i');
});

test('tokenizeFormula handles vector notation \\vec{E} and \\boldsymbol{E}', () => {
  const tokens = tokenizeFormula('\\vec{E}=\\vec{F}/q_{0}');
  assert.equal(tokens[0].kind, 'vec');
  assert.equal(tokens[0].text, 'E');
  assert.equal(tokens[1].kind, 'text');
  assert.equal(tokens[1].text, '=');
  assert.equal(tokens[2].kind, 'vec');
  assert.equal(tokens[2].text, 'F');
});

test('tokenizeFormula auto-parses single-character subscripts without braces', () => {
  const tokens = tokenizeFormula('E_k=\\frac{1}{2}mv^2');
  assert.equal(tokens[0].kind, 'var');
  assert.equal(tokens[0].text, 'E');
  assert.equal(tokens[1].kind, 'sub');
  assert.equal(tokens[1].text, 'k');

  const tokensFlux = tokenizeFormula('\\Phi_B=BS');
  assert.equal(tokensFlux[0].kind, 'var');
  assert.equal(tokensFlux[0].text, 'Φ');
  assert.equal(tokensFlux[1].kind, 'sub');
  assert.equal(tokensFlux[1].text, 'B');
});

test('measureMathFormula measures width without errors', () => {
  const mockCtx = {
    font: '',
    measureText(text) {
      return { width: text.length * 10 };
    },
  };
  const width = measureMathFormula(mockCtx, '\\mathcal{E}_{i}=-n\\frac{\\Delta\\Phi_{B}}{\\Delta t}', 20);
  assert.ok(width > 0);
});

test('formatPhysicsNumber formats numbers with scientific notation and superscripts', () => {
  assert.equal(toSuperscript(-3), '⁻³');
  const res = formatPhysicsNumber(9.0e9, { digits: 1, unit: 'N·m²/C²' });
  assert.ok(res.includes('10⁹'));
});

test('tokenizeFormula parses \\frac{num}{den} correctly including nested braces', () => {
  const tokens1 = tokenizeFormula('\\frac{\\Delta\\Phi_B}{\\Delta t}');
  const texts1 = tokens1.map((t) => t.text).join('');
  assert.ok(texts1.includes('/'));
  assert.ok(!texts1.includes('\\frac'));

  const tokens2 = tokenizeFormula('\\frac{\\mathrm{d}B}{\\mathrm{d}t}');
  const texts2 = tokens2.map((t) => t.text).join('');
  assert.equal(texts2, 'dB / dt');
});

