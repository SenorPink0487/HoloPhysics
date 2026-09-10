/**
 * 化学式显示：将 H2O / C6H12O6 / (NH4)2SO4 转为带下标的 HTML，
 * 便于界面上「明确显示化学式」。
 */

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * @param {string | null | undefined} formula
 * @returns {string} 安全的 HTML（数字下标、电荷上标）
 */
export function formatFormulaHtml(formula) {
  if (formula == null) return ''
  const raw = String(formula).trim()
  if (!raw || raw === '—') return escapeHtml(raw || '—')

  let s = escapeHtml(raw)

  // 显式电荷：SO4^2-、NH4^+
  s = s.replace(/\^(\d*[+-])/g, '<sup>$1</sup>')

  // 元素或右括号后的计量数字 → 下标
  s = s.replace(/([A-Za-z\)])(\d+)/g, '$1<sub>$2</sub>')

  // 修正离子电荷被误当成下标：Ca<sub>2</sub>+ → Ca<sup>2+</sup>
  s = s.replace(/([A-Za-z])<sub>(\d+)<\/sub>([+-])/g, '$1<sup>$2$3</sup>')
  // 单电荷：Na+、Cl-
  s = s.replace(/([A-Za-z])([+-])(?![0-9A-Za-z])/g, '$1<sup>$2</sup>')

  return s
}

/**
 * 标题 / aria 用纯文本（Unicode 下标，避免裸数字难读）
 * @param {string | null | undefined} formula
 */
export function formatFormulaPlain(formula) {
  if (formula == null) return ''
  const raw = String(formula).trim()
  if (!raw) return ''

  const subMap = {
    '0': '₀',
    '1': '₁',
    '2': '₂',
    '3': '₃',
    '4': '₄',
    '5': '₅',
    '6': '₆',
    '7': '₇',
    '8': '₈',
    '9': '₉',
  }
  const supMap = {
    '0': '⁰',
    '1': '¹',
    '2': '²',
    '3': '³',
    '4': '⁴',
    '5': '⁵',
    '6': '⁶',
    '7': '⁷',
    '8': '⁸',
    '9': '⁹',
    '+': '⁺',
    '-': '⁻',
  }

  let s = raw.replace(/\^(\d*[+-])/g, (_, ch) =>
    [...ch].map((c) => supMap[c] || c).join(''),
  )
  s = s.replace(/([A-Za-z\)])(\d+)/g, (_, lead, digits) =>
    lead + [...digits].map((d) => subMap[d] || d).join(''),
  )
  s = s.replace(/([A-Za-z])([₀-₉]+)([+-])/g, (_, el, digits, sign) => {
    const n = [...digits]
      .map((d) => {
        const i = '₀₁₂₃₄₅₆₇₈₉'.indexOf(d)
        return i >= 0 ? String(i) : d
      })
      .join('')
    return el + [...(n + sign)].map((c) => supMap[c] || c).join('')
  })
  s = s.replace(/([A-Za-z])([+-])(?![0-9A-Za-z₀-₉])/g, (_, el, sign) => el + (supMap[sign] || sign))
  return s
}
