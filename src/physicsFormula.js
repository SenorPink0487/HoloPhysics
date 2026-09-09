/**
 * 人教版高中物理：常量、科学计数法与公式绘制（斜体变量 + 下标/上标）。
 *
 * 公式 markup 约定：
 *   E_{k}  下标　　r^{2}  上标　　ε_{0}  希腊字母
 *   拉丁/希腊变量用斜体衬线；汉字、数字、运算符用正体。
 */

/** 静电力常量 k = 9.0×10⁹ N·m²/C²（人教版） */
export const K_COULOMB = 9.0e9;

/** 真空介电常量 ε₀ = 1/(4πk) C²/(N·m²) */
export const EPSILON_0 = 1 / (4 * Math.PI * K_COULOMB);

/**
 * 界面电荷读数单位：1 表示 1 μC = 10⁻⁶ C。
 * 位置按米 (m) 计，计算全部走 SI：E = kQ/r²，φ = kQ/r，F = qE。
 */
export const CHARGE_UI_TO_C = 1e-6;

export function chargeUiToCoulomb(qUi) {
  return Number(qUi || 0) * CHARGE_UI_TO_C;
}

/** 物理仿真系统字体栈标准 */
export const FONT_STACKS = {
  /** UI 文本、按钮、菜单、提示与动态读数 */
  ui: '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif',
  /** 物理数学斜体变量（B, x, E, r, t, ε_i） */
  mathVar: '"Times New Roman", "Cambria Math", "STIX Two Math", serif',
  /** 物理正体单位与运算符（V, T, Wb, s, d） */
  mathText: '"Times New Roman", "Cambria Math", serif',
  /** 调试终端与纯代码控制台 */
  code: 'Consolas, "SF Mono", monospace',
};

export function buildUiFont(size, weight = 'bold') {
  return `${weight} ${Math.round(size)}px ${FONT_STACKS.ui}`;
}

export function buildMathVarFont(size, weight = 'bold') {
  return `${weight} italic ${Math.round(size)}px ${FONT_STACKS.mathVar}`;
}

const SUPER_MAP = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻',
};

/** 将整数指数转为上标字符，如 -3 → ⁻³ */
export function toSuperscript(exp) {
  const s = String(exp);
  let out = '';
  for (const ch of s) out += SUPER_MAP[ch] ?? ch;
  return out;
}

/**
 * 科学计数法 / 普通小数（人教版读数习惯）。
 * @param {number} value
 * @param {{ digits?: number, unit?: string, forceSci?: boolean }} [opts]
 */
export function formatPhysicsNumber(value, opts = {}) {
  const digits = opts.digits ?? 2;
  const unit = opts.unit ? ` ${opts.unit}` : '';
  const v = Number(value);
  if (!Number.isFinite(v)) return `—${unit}`;
  if (v === 0) return `0${unit}`;
  const abs = Math.abs(v);
  const useSci = opts.forceSci === true
    || abs >= 1000
    || (abs > 0 && abs < 0.01);
  if (useSci) {
    const exp = Math.floor(Math.log10(abs));
    const mant = v / 10 ** exp;
    return `${mant.toFixed(digits)}×10${toSuperscript(exp)}${unit}`;
  }
  // 中等量级：保留有效数字感
  if (abs >= 100) return `${v.toFixed(Math.max(0, digits - 1))}${unit}`;
  if (abs >= 10) return `${v.toFixed(digits)}${unit}`;
  return `${v.toFixed(digits + 1)}${unit}`;
}

function findMatchingBrace(str, openIndex) {
  if (str[openIndex] !== '{') return -1;
  let depth = 0;
  for (let i = openIndex; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Calligraphic script map for standard physics notation (e.g. Electromotive Force 花体 E = ℰ).
 */
const SCRIPT_MAP = {
  E: 'ℰ',
  B: 'ℬ',
  L: 'ℒ',
  M: 'ℳ',
  H: 'ℋ',
  F: 'ℱ',
  R: 'ℛ',
  P: '𝒫',
};

const isCjk = (ch) => /[\u3000-\u9fff\uff00-\uffef]/.test(ch);
const isVarStart = (ch) => /[A-Za-zΑ-Ωα-ωΦφθΘεεΔδπμνλρστωℰℬℒℳℋℱℛΣ∑σ]/.test(ch);

const formulaAstCache = new Map();
const MAX_FORMULA_AST_CACHE = 256;

/**
 * 解析 LaTeX 语法为结构化 AST 节点树，支持分式、根号、矢量、角标与花体等 2D 物理公式排版。
 * @param {string} formula
 * @returns {Array}
 */
export function parseFormulaAst(formula) {
  const s = String(formula || '').trim();
  if (!s) return [];
  const cached = formulaAstCache.get(s);
  if (cached) return cached;

  const nodes = [];
  let i = 0;

  while (i < s.length) {
    // 1. 分数: \frac{num}{den}
    if (s.slice(i).startsWith('\\frac{')) {
      const numStart = i + 5;
      const numEnd = findMatchingBrace(s, numStart);
      if (numEnd !== -1 && s[numEnd + 1] === '{') {
        const denStart = numEnd + 1;
        const denEnd = findMatchingBrace(s, denStart);
        if (denEnd !== -1) {
          const numStr = s.slice(numStart + 1, numEnd);
          const denStr = s.slice(denStart + 1, denEnd);
          nodes.push({
            type: 'frac',
            num: parseFormulaAst(numStr),
            den: parseFormulaAst(denStr),
          });
          i = denEnd + 1;
          continue;
        }
      }
    }

    // 2. 根号: \sqrt{inner}
    if (s.slice(i).startsWith('\\sqrt{')) {
      const sqrtStart = i + 5;
      const sqrtEnd = findMatchingBrace(s, sqrtStart);
      if (sqrtEnd !== -1) {
        const innerStr = s.slice(sqrtStart + 1, sqrtEnd);
        nodes.push({
          type: 'sqrt',
          inner: parseFormulaAst(innerStr),
        });
        i = sqrtEnd + 1;
        continue;
      }
    }

    // 3. 花体: \mathcal{E}, \script{E}, \mathscr{E} 或 ℰ
    if (s.slice(i).startsWith('\\mathcal{') || s.slice(i).startsWith('\\script{') || s.slice(i).startsWith('\\mathscr{')) {
      const braceStart = s.indexOf('{', i);
      const braceEnd = findMatchingBrace(s, braceStart);
      if (braceEnd !== -1) {
        const char = s.slice(braceStart + 1, braceEnd).trim();
        nodes.push({ type: 'calligraphic', text: SCRIPT_MAP[char] || char });
        i = braceEnd + 1;
        continue;
      }
    }
    if ('ℰℬℒℳℋℱℛ'.includes(s[i])) {
      nodes.push({ type: 'calligraphic', text: s[i] });
      i += 1;
      continue;
    }

    // 4. 矢量: \vec{E}, \boldsymbol{E}
    if (s.slice(i).startsWith('\\vec{') || s.slice(i).startsWith('\\boldsymbol{')) {
      const braceStart = s.indexOf('{', i);
      const braceEnd = findMatchingBrace(s, braceStart);
      if (braceEnd !== -1) {
        const text = s.slice(braceStart + 1, braceEnd).trim();
        nodes.push({ type: 'vec', text });
        i = braceEnd + 1;
        continue;
      }
    }

    // 5. 正体文本: \mathrm{...} 或 \text{...}
    if (s.slice(i).startsWith('\\mathrm{') || s.slice(i).startsWith('\\text{')) {
      const braceStart = s.indexOf('{', i);
      const braceEnd = findMatchingBrace(s, braceStart);
      if (braceEnd !== -1) {
        const txt = s.slice(braceStart + 1, braceEnd);
        nodes.push(isCjk(txt) ? { type: 'cn', text: txt } : { type: 'text', text: txt, fontStyle: 'normal' });
        i = braceEnd + 1;
        continue;
      }
    }

    // 6. LaTeX 常见数学符号、函数、定界符与希腊字母 (按匹配长度降序，防止短命令截断长命令)
    if (s[i] === '\\') {
      const latexCmds = [
        ['\\left\\{', '{'],
        ['\\right\\}', '}'],
        ['\\left[', '['],
        ['\\right]', ']'],
        ['\\left(', '('],
        ['\\right)', ')'],
        ['\\left|', '|'],
        ['\\right|', '|'],
        ['\\left.', ''],
        ['\\right.', ''],
        ['\\left', ''],
        ['\\right', ''],
        ['\\arcsin', 'arcsin'],
        ['\\arccos', 'arccos'],
        ['\\arctan', 'arctan'],
        ['\\sin', 'sin'],
        ['\\cos', 'cos'],
        ['\\tan', 'tan'],
        ['\\cot', 'cot'],
        ['\\sec', 'sec'],
        ['\\csc', 'csc'],
        ['\\ln', 'ln'],
        ['\\log', 'log'],
        ['\\exp', 'exp'],
        ['\\lim', 'lim'],
        ['\\min', 'min'],
        ['\\max', 'max'],
        ['\\rightarrow', ' → '],
        ['\\Rightarrow', ' ⇒ '],
        ['\\leftarrow', ' ← '],
        ['\\Leftarrow', ' ⇐ '],
        ['\\uparrow', '↑'],
        ['\\downarrow', '↓'],
        ['\\to', ' → '],
        ['\\qquad', '     '],
        ['\\quad', '   '],
        ['\\partial', '∂'],
        ['\\nabla', '∇'],
        ['\\oint', '∮'],
        ['\\int', '∫'],
        ['\\sum', '∑'],
        ['\\prod', '∏'],
        ['\\cdot', ' · '],
        ['\\times', ' × '],
        ['\\div', ' ÷ '],
        ['\\pm', ' ± '],
        ['\\mp', ' ∓ '],
        ['\\propto', ' ∝ '],
        ['\\perp', '⊥'],
        ['\\parallel', '∥'],
        ['\\approx', ' ≈ '],
        ['\\equiv', ' ≡ '],
        ['\\sim', ' ∼ '],
        ['\\leq', ' ≤ '],
        ['\\geq', ' ≥ '],
        ['\\neq', ' ≠ '],
        ['\\le', ' ≤ '],
        ['\\ge', ' ≥ '],
        ['\\ne', ' ≠ '],
        ['\\infty', '∞'],
        ['\\alpha', 'α'],
        ['\\beta', 'β'],
        ['\\gamma', 'γ'],
        ['\\delta', 'δ'],
        ['\\epsilon', 'ε'],
        ['\\varepsilon', 'ε'],
        ['\\zeta', 'ζ'],
        ['\\eta', 'η'],
        ['\\theta', 'θ'],
        ['\\vartheta', 'θ'],
        ['\\iota', 'ι'],
        ['\\kappa', 'κ'],
        ['\\lambda', 'λ'],
        ['\\mu', 'μ'],
        ['\\nu', 'ν'],
        ['\\xi', 'ξ'],
        ['\\pi', 'π'],
        ['\\rho', 'ρ'],
        ['\\sigma', 'σ'],
        ['\\tau', 'τ'],
        ['\\upsilon', 'υ'],
        ['\\phi', 'φ'],
        ['\\varphi', 'φ'],
        ['\\chi', 'χ'],
        ['\\psi', 'ψ'],
        ['\\omega', 'ω'],
        ['\\Gamma', 'Γ'],
        ['\\Delta', 'Δ'],
        ['\\Theta', 'Θ'],
        ['\\Lambda', 'Λ'],
        ['\\Xi', 'Ξ'],
        ['\\Pi', 'Π'],
        ['\\Sigma', 'Σ'],
        ['\\Upsilon', 'Υ'],
        ['\\Phi', 'Φ'],
        ['\\Psi', 'Ψ'],
        ['\\Omega', 'Ω'],
      ].sort((a, b) => b[0].length - a[0].length);

      let matched = false;
      for (const [cmd, rep] of latexCmds) {
        if (s.slice(i).startsWith(cmd)) {
          if (rep) {
            const trimmed = rep.trim();
            if (trimmed.length === 1 && isVarStart(trimmed)) {
              nodes.push({ type: 'var', text: rep, fontStyle: 'italic' });
            } else {
              nodes.push({ type: 'text', text: rep, fontStyle: 'normal' });
            }
          }
          i += cmd.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }

    // 7. 下标 _{...} 或无括号单字符/连续字母下标
    if (s[i] === '_') {
      if (s[i + 1] === '{') {
        const end = findMatchingBrace(s, i + 1);
        if (end !== -1) {
          const subContent = s.slice(i + 2, end);
          nodes.push({
            type: 'sub',
            content: parseFormulaAst(subContent),
            raw: subContent,
          });
          i = end + 1;
          continue;
        }
      } else if (i + 1 < s.length) {
        let j = i + 1;
        while (j < s.length && /[A-Za-z0-9\u3000-\u9fff]/.test(s[j])) j += 1;
        const subContent = s.slice(i + 1, j);
        nodes.push({
          type: 'sub',
          content: parseFormulaAst(subContent),
          raw: subContent,
        });
        i = j;
        continue;
      }
    }

    // 8. 上标 ^{...} 或单字符上标 ^2
    if (s[i] === '^') {
      if (s[i + 1] === '{') {
        const end = findMatchingBrace(s, i + 1);
        if (end !== -1) {
          const supContent = s.slice(i + 2, end);
          nodes.push({
            type: 'sup',
            content: parseFormulaAst(supContent),
            raw: supContent,
          });
          i = end + 1;
          continue;
        }
      } else if (i + 1 < s.length && /[0-9+\-−]/.test(s[i + 1])) {
        const supContent = s[i + 1];
        nodes.push({
          type: 'sup',
          content: parseFormulaAst(supContent),
          raw: supContent,
        });
        i += 2;
        continue;
      }
    }

    // 9. 中文字符
    const ch = s[i];
    if (isCjk(ch)) {
      let j = i + 1;
      while (j < s.length && isCjk(s[j])) j += 1;
      nodes.push({ type: 'cn', text: s.slice(i, j) });
      i = j;
      continue;
    }

    // 10. 函数名 (如 sin, cos, tan, ln, log, exp, SDF, lim)
    if (/^[a-zA-Z]{2,}/.test(s.slice(i))) {
      const match = s.slice(i).match(/^(cos|sin|tan|arctan|arcsin|arccos|ln|log|lim|min|max|exp|SDF)/i);
      if (match) {
        nodes.push({ type: 'text', text: match[0], fontStyle: 'normal' });
        i += match[0].length;
        continue;
      }
    }

    // 11. 变量名 (单字符物理量变量，标准数学斜体)
    if (isVarStart(ch)) {
      nodes.push({ type: 'var', text: ch, fontStyle: 'italic' });
      i += 1;
      continue;
    }

    // 12. 数字、运算符、标点、空格
    let j = i + 1;
    while (
      j < s.length
      && !isCjk(s[j])
      && !isVarStart(s[j])
      && s[j] !== '_'
      && s[j] !== '^'
      && s[j] !== '\\'
    ) {
      j += 1;
    }
    const txt = s.slice(i, j);
    nodes.push({ type: 'text', text: txt, fontStyle: 'normal' });
    i = j;
  }

  if (formulaAstCache.size >= MAX_FORMULA_AST_CACHE) {
    const firstKey = formulaAstCache.keys().next().value;
    formulaAstCache.delete(firstKey);
  }
  formulaAstCache.set(s, nodes);

  return nodes;
}

/**
 * 展平成平铺 Token 序列（向下兼容 tokenizeFormula）。
 * @returns {{ kind: 'var'|'text'|'sub'|'sup'|'cn'|'calligraphic'|'vec', text: string }[]}
 */
export function tokenizeFormula(formula) {
  const ast = parseFormulaAst(formula);
  const tokens = [];

  function flatten(nodeList) {
    for (const node of nodeList) {
      if (node.type === 'frac') {
        flatten(node.num);
        tokens.push({ kind: 'text', text: ' / ' });
        flatten(node.den);
      } else if (node.type === 'sqrt') {
        tokens.push({ kind: 'text', text: '√(' });
        flatten(node.inner);
        tokens.push({ kind: 'text', text: ')' });
      } else if (node.type === 'sub') {
        tokens.push({ kind: 'sub', text: node.raw || '' });
      } else if (node.type === 'sup') {
        tokens.push({ kind: 'sup', text: node.raw || '' });
      } else if (node.type === 'vec') {
        tokens.push({ kind: 'vec', text: node.text });
      } else if (node.type === 'calligraphic') {
        tokens.push({ kind: 'calligraphic', text: node.text });
      } else if (node.type === 'var') {
        tokens.push({ kind: 'var', text: node.text });
      } else if (node.type === 'cn') {
        tokens.push({ kind: 'cn', text: node.text });
      } else {
        tokens.push({ kind: 'text', text: node.text });
      }
    }
  }

  flatten(ast);
  return tokens;
}

/**
 * 测量 2D 物理公式 AST 的总宽度与垂直高度边界。
 */
export function measureFormulaAst(ctx, astList, fontSize = 20, opts = {}) {
  const weight = opts.fontWeight || 'bold';
  const cnFont = opts.cnFont || '"Microsoft YaHei", "PingFang SC", sans-serif';
  const size = fontSize;
  const subSize = Math.max(10, Math.round(size * 0.68));

  let totalW = 0;
  let maxAscent = size * 0.82;
  let maxDescent = size * 0.22;

  for (const node of astList) {
    if (node.type === 'frac') {
      const fracSize = Math.max(10, Math.round(size * 0.76));
      const numM = measureFormulaAst(ctx, node.num, fracSize, opts);
      const denM = measureFormulaAst(ctx, node.den, fracSize, opts);
      const barW = Math.max(numM.width, denM.width) + size * 0.28;
      totalW += barW;
      const fracAscent = numM.height + size * 0.15;
      const fracDescent = denM.height + size * 0.15;
      if (fracAscent > maxAscent) maxAscent = fracAscent;
      if (fracDescent > maxDescent) maxDescent = fracDescent;
    } else if (node.type === 'sqrt') {
      const innerM = measureFormulaAst(ctx, node.inner, size, opts);
      const radicalW = size * 0.5;
      totalW += radicalW + innerM.width + size * 0.12;
      const sqrtAscent = innerM.ascent + size * 0.18;
      const sqrtDescent = innerM.descent + size * 0.08;
      if (sqrtAscent > maxAscent) maxAscent = sqrtAscent;
      if (sqrtDescent > maxDescent) maxDescent = sqrtDescent;
    } else if (node.type === 'sub') {
      const subM = measureFormulaAst(ctx, node.content, subSize, opts);
      totalW += subM.width;
      const subDesc = subM.descent + size * 0.24;
      if (subDesc > maxDescent) maxDescent = subDesc;
    } else if (node.type === 'sup') {
      const supM = measureFormulaAst(ctx, node.content, subSize, opts);
      totalW += supM.width;
      const supAsc = supM.ascent + size * 0.42;
      if (supAsc > maxAscent) maxAscent = supAsc;
    } else if (node.type === 'vec') {
      ctx.font = `${weight} italic ${size}px "Times New Roman", "Cambria Math", "STIX Two Math", serif`;
      const vw = ctx.measureText(node.text).width;
      totalW += vw + size * 0.06;
      const vecAsc = size * 0.95;
      if (vecAsc > maxAscent) maxAscent = vecAsc;
    } else if (node.type === 'calligraphic') {
      ctx.font = `${weight} italic ${size}px "STIX Two Math", "Cambria Math", "TeX Gyre Termes Math", "Segoe Script", "Lucida Calligraphy", cursive, serif`;
      totalW += ctx.measureText(node.text).width;
    } else if (node.type === 'var') {
      ctx.font = `${weight} italic ${size}px "Times New Roman", "Cambria Math", "STIX Two Math", serif`;
      totalW += ctx.measureText(node.text).width;
    } else if (node.type === 'cn') {
      ctx.font = `${weight} ${size}px ${cnFont}`;
      totalW += ctx.measureText(node.text).width;
    } else {
      ctx.font = `${weight} ${size}px "Times New Roman", "Cambria Math", ${cnFont}`;
      totalW += ctx.measureText(node.text).width;
    }
  }

  return {
    width: totalW,
    height: maxAscent + maxDescent,
    ascent: maxAscent,
    descent: maxDescent,
  };
}

/**
 * 测量公式像素宽度（向下兼容接口）。
 */
export function measureMathFormula(ctx, formula, fontSize = 18, opts = {}) {
  const ast = parseFormulaAst(formula);
  const m = measureFormulaAst(ctx, ast, fontSize, opts);
  return m.width;
}

/**
 * 绘制 2D 物理公式 AST（包含真实分数线、根号横线、向量箭头与上下标）。
 */
export function drawFormulaAst(ctx, astList, startX, baseY, fontSize = 20, opts = {}) {
  const weight = opts.fontWeight || 'bold';
  const cnFont = opts.cnFont || '"Microsoft YaHei", "PingFang SC", sans-serif';
  const size = fontSize;
  const subSize = Math.max(10, Math.round(size * 0.68));
  let penX = startX;

  // 数学符号轴心基准线（小写字母水平中心，等号、加减号、分数线所在高度）
  const mathAxisY = baseY - size * 0.28;

  for (const node of astList) {
    if (node.type === 'frac') {
      const fracSize = Math.max(10, Math.round(size * 0.76));
      const numM = measureFormulaAst(ctx, node.num, fracSize, opts);
      const denM = measureFormulaAst(ctx, node.den, fracSize, opts);
      const barW = Math.max(numM.width, denM.width) + size * 0.28;
      const barThick = Math.max(1.6, Math.round(size * 0.055));

      const numX = penX + (barW - numM.width) / 2;
      const numBaseY = mathAxisY - barThick / 2 - numM.descent - size * 0.08;
      drawFormulaAst(ctx, node.num, numX, numBaseY, fracSize, opts);

      const denX = penX + (barW - denM.width) / 2;
      const denBaseY = mathAxisY + barThick / 2 + denM.ascent + size * 0.08;
      drawFormulaAst(ctx, node.den, denX, denBaseY, fracSize, opts);

      // 绘制标准水平分数线
      ctx.lineWidth = barThick;
      ctx.beginPath();
      ctx.moveTo(penX + 2, mathAxisY);
      ctx.lineTo(penX + barW - 2, mathAxisY);
      ctx.stroke();

      penX += barW;
    } else if (node.type === 'sqrt') {
      const innerM = measureFormulaAst(ctx, node.inner, size, opts);
      const radicalW = size * 0.5;
      const radThick = Math.max(1.6, Math.round(size * 0.055));
      const totalW = radicalW + innerM.width + size * 0.12;

      const topY = mathAxisY - innerM.ascent - size * 0.12;
      const botY = mathAxisY + innerM.descent + size * 0.06;

      // 内部绘制
      drawFormulaAst(ctx, node.inner, penX + radicalW + size * 0.06, baseY, size, opts);

      // 绘制标准根号折线与顶部覆盖横线
      ctx.lineWidth = radThick;
      ctx.beginPath();
      ctx.moveTo(penX + radicalW * 0.15, mathAxisY);
      ctx.lineTo(penX + radicalW * 0.45, botY);
      ctx.lineTo(penX + radicalW, topY);
      ctx.lineTo(penX + totalW, topY);
      ctx.stroke();

      penX += totalW;
    } else if (node.type === 'sub') {
      const subM = measureFormulaAst(ctx, node.content, subSize, opts);
      drawFormulaAst(ctx, node.content, penX, baseY + size * 0.2, subSize, opts);
      penX += subM.width;
    } else if (node.type === 'sup') {
      const supM = measureFormulaAst(ctx, node.content, subSize, opts);
      drawFormulaAst(ctx, node.content, penX, baseY - size * 0.42, subSize, opts);
      penX += supM.width;
    } else if (node.type === 'vec') {
      ctx.font = `${weight} italic ${size}px "Times New Roman", "Cambria Math", "STIX Two Math", serif`;
      const vw = ctx.measureText(node.text).width;
      ctx.fillText(node.text, penX, baseY);

      // 绘制顶部标准矢量箭头 →
      const arrowY = baseY - size * 0.86;
      const arrowW = vw;
      ctx.lineWidth = Math.max(1.4, size * 0.07);
      ctx.beginPath();
      ctx.moveTo(penX + 1, arrowY);
      ctx.lineTo(penX + arrowW, arrowY);
      ctx.lineTo(penX + arrowW - size * 0.18, arrowY - size * 0.12);
      ctx.moveTo(penX + arrowW, arrowY);
      ctx.lineTo(penX + arrowW - size * 0.18, arrowY + size * 0.12);
      ctx.stroke();

      penX += vw + size * 0.06;
    } else if (node.type === 'calligraphic') {
      ctx.font = `${weight} italic ${size}px "STIX Two Math", "Cambria Math", "TeX Gyre Termes Math", "Segoe Script", "Lucida Calligraphy", cursive, serif`;
      ctx.fillText(node.text, penX, baseY);
      penX += ctx.measureText(node.text).width;
    } else if (node.type === 'var') {
      ctx.font = `${weight} italic ${size}px "Times New Roman", "Cambria Math", "STIX Two Math", serif`;
      ctx.fillText(node.text, penX, baseY);
      penX += ctx.measureText(node.text).width;
    } else if (node.type === 'cn') {
      ctx.font = `${weight} ${size}px ${cnFont}`;
      ctx.fillText(node.text, penX, baseY);
      penX += ctx.measureText(node.text).width;
    } else {
      ctx.font = `${weight} ${size}px "Times New Roman", "Cambria Math", ${cnFont}`;
      ctx.fillText(node.text, penX, baseY);
      penX += ctx.measureText(node.text).width;
    }
  }

  return penX - startX;
}

/**
 * 在 canvas 上绘制人教版/大学物理规范风格公式（支持 2D 分式、根号及矢量）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} formula markup，如 "h=\\frac{1}{2}gt^{2}"、"\\Phi_{E}=\\frac{Q_{内}}{\\varepsilon_{0}}"、"\\mathcal{E}_{i}=-n\\frac{\\Delta\\Phi_{B}}{\\Delta t}"
 * @param {number} x 基线起点（align=left）或中心（align=center）
 * @param {number} y 字母基线 y
 * @param {{ fontSize?: number, color?: string, align?: 'left'|'center'|'right', maxWidth?: number, textBaseline?: string, fontWeight?: string, cnFont?: string }} [opts]
 * @returns {{ width: number, height: number }}
 */
export function drawMathFormula(ctx, formula, x, y, opts = {}) {
  const size = opts.fontSize || 18;
  const color = opts.color || '#0c4a6e';
  const align = opts.align || 'left';
  const ast = parseFormulaAst(formula);

  const m = measureFormulaAst(ctx, ast, size, opts);
  if (opts.maxWidth && m.width > opts.maxWidth) {
    const scale = opts.maxWidth / m.width;
    return drawMathFormula(ctx, formula, x, y, {
      ...opts,
      fontSize: Math.max(12, Math.floor(size * scale)),
      maxWidth: undefined,
    });
  }

  let penX = align === 'center' ? x - m.width / 2 : (align === 'right' ? x - m.width : x);
  const startX = penX;

  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.textAlign = 'left';

  let baseY = y;
  if (opts.textBaseline === 'top') {
    baseY = y + m.ascent;
  } else if (opts.textBaseline === 'middle') {
    baseY = y + (m.ascent - m.descent) / 2;
  }
  ctx.textBaseline = 'alphabetic';

  drawFormulaAst(ctx, ast, penX, baseY, size, opts);

  ctx.restore();
  return { width: m.width, height: m.height };
}

/**
 * 在指定区域内绘制一组多公式分栏展示卡片（适用于物理大屏等大尺寸面板）。
 * 自动识别分号分隔的公式，分块独立排版并提供大字号居中 2D 公式展示。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string|Array<{label?: string, tex: string}>} formulas
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {{ themeColor?: string, cardBg?: string, cardBorder?: string, title?: string }} [opts]
 */
export function drawFormulaCardGroup(ctx, formulas, x, y, w, h, opts = {}) {
  const themeColor = opts.themeColor || '#0ea5e9';
  let cardItems = [];

  if (Array.isArray(formulas)) {
    cardItems = formulas;
  } else if (typeof formulas === 'string') {
    // 智能切分分号分隔的多个公式
    const parts = formulas.split(/[；;]/).map((p) => p.trim()).filter(Boolean);
    cardItems = parts.map((p, idx) => ({
      label: parts.length > 1 ? `公式 (${idx + 1})` : '核心公式',
      tex: p,
    }));
  }

  if (!cardItems.length) return;

  const count = cardItems.length;
  const gap = 16;
  const cardW = (w - gap * (count - 1)) / count;
  const cardH = h;

  cardItems.forEach((item, idx) => {
    const cx = x + idx * (cardW + gap);
    const cy = y;

    // 绘制子卡片背景
    ctx.fillStyle = opts.cardBg || 'rgba(255, 255, 255, 0.96)';
    ctx.strokeStyle = opts.cardBorder || hexToRgba(themeColor, 0.35);
    ctx.lineWidth = 1.8;
    roundRect(ctx, cx, cy, cardW, cardH, 14);
    ctx.fill();
    ctx.stroke();

    // 顶部公式小标头
    if (item.label && count > 1) {
      const tagW = Math.min(cardW - 32, 140);
      const tagH = 28;
      const tagX = cx + (cardW - tagW) / 2;
      const tagY = cy + 12;

      ctx.fillStyle = hexToRgba(themeColor, 0.12);
      ctx.strokeStyle = hexToRgba(themeColor, 0.3);
      ctx.lineWidth = 1.2;
      roundRect(ctx, tagX, tagY, tagW, tagH, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = themeColor;
      ctx.font = buildUiFont(15, 'bold');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.label, tagX + tagW / 2, tagY + tagH / 2);
    }

    // 计算公式绘制区域与居中位置
    const formulaCenterY = count > 1 && item.label ? cy + (cardH + 28) / 2 : cy + cardH / 2;
    const formulaFontSize = count === 1 ? 52 : (count === 2 ? 44 : 38);

    drawMathFormula(
      ctx,
      item.tex,
      cx + cardW / 2,
      formulaCenterY,
      {
        fontSize: formulaFontSize,
        color: '#0c4a6e',
        align: 'center',
        textBaseline: 'middle',
        maxWidth: cardW - 32,
      },
    );
  });
}

function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return `rgba(14, 165, 233, ${alpha})`;
  const cleanHex = hex.slice(1);
  const num = parseInt(cleanHex.length === 3 ? cleanHex.split('').map((c) => c + c).join('') : cleanHex, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 库仑场强矢量：E = kQ r̂ / r²（SI） */
export function coulombFieldContribution(qUi, dx, dy, dz, minR = 0.04) {
  const Q = chargeUiToCoulomb(qUi);
  if (Math.abs(Q) < 1e-20) return { x: 0, y: 0, z: 0 };
  const r2 = dx * dx + dy * dy + dz * dz;
  const minR2 = minR * minR;
  if (r2 < minR2) return { x: 0, y: 0, z: 0 };
  const r = Math.sqrt(r2);
  const scale = (K_COULOMB * Q) / (r2 * r);
  return { x: dx * scale, y: dy * scale, z: dz * scale };
}

/** 电势：φ = kQ / r（无穷远为零） */
export function coulombPotentialContribution(qUi, r, minR = 0.04) {
  const Q = chargeUiToCoulomb(qUi);
  return (K_COULOMB * Q) / Math.max(minR, r);
}
