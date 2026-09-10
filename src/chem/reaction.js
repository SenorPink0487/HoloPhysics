import { resolveReactionWithDeepSeek } from './deepseek.js'

/**
 * Resolve reactants and reject malformed or unbalanced AI responses before
 * the physics lab attempts to render the products.
 * @param {{ name: string }[]} parts
 * @param {string} condition
 */
export async function resolveReaction(parts, condition = '') {
  const reactants = parts.map((part) => String(part?.name || '').trim()).filter(Boolean)
  if (reactants.length < 2) throw new Error('请至少输入两种反应物。')

  const data = await resolveReactionWithDeepSeek(reactants, condition)
  if (data.reacts !== true) {
    const error = new Error(String(data.reason || '在所选条件下未预测到可观察的化学反应。'))
    error.code = 'NO_REACTION'
    throw error
  }

  const equation = String(data.equation || '').trim()
  if (!isBalancedEquation(equation)) {
    throw new Error('AI 返回的方程式不完整或未配平，请调整条件后重试。')
  }

  const products = Array.isArray(data.products) ? data.products : []
  const components = products.map((item, index) => ({
    id: `p-${index}`,
    name_zh: String(item?.name_zh || '').trim(),
    name_en: String(item?.name_en || '').trim(),
    formula: String(item?.formula || '').trim(),
    smiles: String(item?.smiles || '').trim(),
    role: String(item?.role || item?.phenomenon || '产物').trim(),
    percent: 100,
  })).filter((item) => item.name_en && item.formula)

  if (!components.length || components.length !== products.length) {
    throw new Error('AI 未返回可用于结构查询的完整产物信息。')
  }

  return {
    kind: 'reaction',
    product_zh: '反应产物',
    product_en: '',
    note: `AI 推断；反应条件：${String(data.condition || condition || '未指定')}。仅供学习与模拟使用。`,
    reason: String(data.reason || 'AI 已识别该反应。'),
    reaction: { equation, condition: String(data.condition || condition || '未指定') },
    components,
    model: data.model || 'deepseek-v4-flash',
  }
}

function isBalancedEquation(equation) {
  const sides = String(equation || '').split(/(?:→|->|=)/)
  if (sides.length !== 2) return false
  const left = countSide(sides[0])
  const right = countSide(sides[1])
  if (!left || !right || !left.size || !right.size || left.size !== right.size) return false
  return [...left].every(([element, count]) => right.get(element) === count)
}

function countSide(side) {
  const totals = new Map()
  const terms = side.split('+').map((term) => term.trim()).filter(Boolean)
  if (!terms.length) return null
  for (const term of terms) {
    const match = term.replace(/\([^)]*\)|\[[^\]]*\]|↑|↓/g, '').trim().match(/^(\d*)\s*([A-Za-z0-9()]+)$/)
    if (!match) return null
    const atoms = parseFormula(match[2])
    if (!atoms) return null
    const coefficient = Number(match[1] || 1)
    for (const [element, count] of atoms) totals.set(element, (totals.get(element) || 0) + coefficient * count)
  }
  return totals
}

function parseFormula(raw) {
  const stack = [new Map()]
  for (let i = 0; i < raw.length;) {
    if (raw[i] === '(') { stack.push(new Map()); i++; continue }
    if (raw[i] === ')') {
      const group = stack.pop()
      if (!group || stack.length === 0) return null
      const match = raw.slice(i + 1).match(/^\d*/)
      const factor = Number(match?.[0] || 1)
      i += 1 + (match?.[0].length || 0)
      for (const [element, count] of group) stack.at(-1).set(element, (stack.at(-1).get(element) || 0) + count * factor)
      continue
    }
    const match = raw.slice(i).match(/^([A-Z][a-z]?)(\d*)/)
    if (!match) return null
    stack.at(-1).set(match[1], (stack.at(-1).get(match[1]) || 0) + Number(match[2] || 1))
    i += match[0].length
  }
  return stack.length === 1 ? stack[0] : null
}
