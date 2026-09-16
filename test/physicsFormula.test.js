import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenizeFormula,
  toSuperscript,
  formatPhysicsNumber,
  measureMathFormula,
  formatPhysicsHtml,
  isRecordToast,
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

test('formatPhysicsHtml standardizes EMF formulas and subscripts for toasts', () => {
  // LaTeX notation \mathcal{E}_i
  const r1 = formatPhysicsHtml('动生测量完成：\\mathcal{E}_i = 21.1047 V，逆时针');
  assert.ok(r1.includes('<span class="math-calligraphic">ℰ</span><sub class="math-sub">i</sub>'));
  assert.ok(r1.includes('21.1047 V'));

  // Non-standard \varepsilon_i or ε_i is automatically normalized to standard calligraphic ℰ_i
  const r2 = formatPhysicsHtml('磁场滑块测量完成：ε_i = 21.1047 V，逆时针（俯视）');
  assert.ok(r2.includes('<span class="math-calligraphic">ℰ</span><sub class="math-sub">i</sub>'));
  assert.ok(!r2.includes('ε_i'));

  // Unicode ℰᵢ is normalized to standard HTML structure
  const r3 = formatPhysicsHtml('感生测量完成：ℰᵢ = 5.6789 V');
  assert.ok(r3.includes('<span class="math-calligraphic">ℰ</span><sub class="math-sub">i</sub>'));

  // Generic variable subscripts like q_0 and Φ_B
  const r4 = formatPhysicsHtml('已瞄准试探电荷 q_0，磁通量 \\Phi_B = 1.25 Wb');
  assert.ok(r4.includes('<span class="math-var">q</span><sub class="math-sub">0</sub>'));
  assert.ok(r4.includes('<span class="math-var">Φ</span><sub class="math-sub">B</sub>'));

  // XSS prevention
  const r5 = formatPhysicsHtml('错误: <script>alert("xss")</script>');
  assert.ok(!r5.includes('<script>'));
  assert.ok(r5.includes('&lt;script&gt;'));
});

test('isRecordToast allows only data recording prompts and suppresses other notifications', () => {
  // Positive cases: data recording feedback messages
  assert.equal(isRecordToast('✓ 已记录第 1 组数据 (X=0.015 m, VH=1.17 mV)'), true);
  assert.equal(isRecordToast('✓ 已记录第 3 组数据 (X=0.015 m, VH=1.17 mV) · 可拟合曲线'), true);
  assert.equal(isRecordToast('✓ 已记录第 1 组'), true);
  assert.equal(isRecordToast('✓ 已记录'), true);
  assert.equal(isRecordToast('已记录当前读数'), true);
  assert.equal(isRecordToast('已记录实验数据'), true);
  assert.equal(isRecordToast('动生测量完成：\\mathcal{E}_i = 0.0500 V，顺时针'), true);
  assert.equal(isRecordToast('感生测量完成：\\mathcal{E}_i = 0.0500 V，逆时针'), true);
  assert.equal(isRecordToast('磁场滑块测量完成：ε_i = 21.1047 V，逆时针（俯视）'), true);

  // Negative cases: experiment start, steps, completion, navigation, UI controls, warnings
  assert.equal(isRecordToast('开始实验：法拉第电磁感应'), false);
  assert.equal(isRecordToast('开始实验：静电场探索'), false);
  assert.equal(isRecordToast('步骤 1/3'), false);
  assert.equal(isRecordToast('实验完成！可返回菜单选择其他实验'), false);
  assert.equal(isRecordToast('法拉第电磁感应实验完成'), false);
  assert.equal(isRecordToast('静电场探索完成'), false);
  assert.equal(isRecordToast('霍尔效应测磁实验完成'), false);
  assert.equal(isRecordToast('已退出当前实验'), false);
  assert.equal(isRecordToast('已关闭实验终端'), false);
  assert.equal(isRecordToast('已打开 电磁学实验台 · 请选择实验'), false);
  assert.equal(isRecordToast('返回实验室大厅'), false);
  assert.equal(isRecordToast('已全屏显示实验内容屏 · Esc 退出全屏'), false);
  assert.equal(isRecordToast('已退出全屏'), false);
  assert.equal(isRecordToast('已瞄准场源电荷 q1；按住拖动或滚轮微调'), false);
  assert.equal(isRecordToast('已抓住铜棒：沿导轨拖动，松开后显示动生电动势'), false);
  assert.equal(isRecordToast('已选择画笔颜色'), false);
  assert.equal(isRecordToast('黑板已清屏'), false);
  assert.equal(isRecordToast('霍尔测量记录已清空'), false);
  assert.equal(isRecordToast('至少记录 2 组数据后才能生成曲线'), false);
  assert.equal(isRecordToast('暂无记录数据，请先点击「记录当前读数」'), false);
  assert.equal(isRecordToast('已返回实验数据记录'), false);
  assert.equal(isRecordToast('已打开打印与导出数据页面'), false);
  assert.equal(isRecordToast(''), false);
  assert.equal(isRecordToast(null), false);
  assert.equal(isRecordToast(undefined), false);
});


