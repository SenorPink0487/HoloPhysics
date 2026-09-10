/**
 * 解析「A + B」加法表达式
 * 支持：可乐 + 牛奶、可乐+水、可乐:2 + 水:1、可乐*2 + 水
 * 避免拆开带方括号的离子 SMILES（如 [Na+]）
 *
 * @param {string} raw
 * @returns {{ name: string, weight: number }[] | null}  null 表示不是加法
 */
export function parseAddExpression(raw) {
  const text = String(raw || '').trim()
  if (!text) return null

  // 方括号内含 +/- 且无空格：当作单一 SMILES
  if (/\[[^\]]*\]/.test(text) && !/\s/.test(text) && !/[＋]/.test(text)) {
    return null
  }

  const chunks = splitAdd(text)
  if (chunks.length < 2) return null

  const parts = chunks.map(parsePart).filter((p) => p.name)
  return parts.length >= 2 ? parts : null
}

/**
 * @param {string} text
 */
function splitAdd(text) {
  // 中文「加」需两侧有空白或边界，避免误伤
  const parts = []
  let buf = ''
  let depth = 0 // 方括号深度

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '[') depth++
    if (ch === ']' && depth > 0) depth--

    if (depth === 0) {
      // 全角/半角 +
      if (ch === '+' || ch === '＋') {
        // 若是 [Na+] 已在 depth 内；裸 + 则分割
        parts.push(buf)
        buf = ''
        continue
      }
      // 「 加 」
      if (
        ch === '加' &&
        (i === 0 || /\s/.test(text[i - 1]) || /[\u4e00-\u9fffA-Za-z0-9)]$/.test(buf)) &&
        (i === text.length - 1 || /\s/.test(text[i + 1]) || /[\u4e00-\u9fffA-Za-z0-9(]/.test(text[i + 1] || ''))
      ) {
        // 要求「加」两侧至少一侧是空白，或两侧都是词
        const leftOk = /\s$/.test(buf) || /[\u4e00-\u9fff]$/.test(buf)
        const rightOk = /\s/.test(text[i + 1] || '') || /[\u4e00-\u9fffA-Za-z]/.test(text[i + 1] || '')
        if (leftOk && rightOk && buf.trim()) {
          parts.push(buf)
          buf = ''
          continue
        }
      }
    }
    buf += ch
  }
  parts.push(buf)
  return parts.map((s) => s.trim()).filter(Boolean)
}

/**
 * @param {string} s
 */
export function parsePart(s) {
  let name = s.trim()
  let weight = 1

  // name:2  name：2  name*2  name×2
  let m = name.match(/^(.+?)\s*[:：*×xX]\s*(\d+(?:\.\d+)?)\s*$/)
  if (m) {
    name = m[1].trim()
    weight = Number(m[2])
  } else {
    // 2份name  2 name
    m = name.match(/^(\d+(?:\.\d+)?)\s*(?:份|part|parts)?\s+(.+)$/i)
    if (m) {
      weight = Number(m[1])
      name = m[2].trim()
    }
  }

  if (!Number.isFinite(weight) || weight <= 0) weight = 1
  return { name, weight }
}

/**
 * 将多个产品的成分按质量权重混合，合并同名物质
 * @param {Array<{ product_zh: string, product_en?: string, components: any[], reason?: string, note?: string }>} products
 * @param {number[]} weights
 */
export function mergeProducts(products, weights) {
  if (!products.length) throw new Error('没有可混合的物质')

  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 1))
  const totalW = w.reduce((a, b) => a + b, 0) || 1
  const labels = products.map((p) => p.product_zh || p.product_en || '物质')

  /** @type {Map<string, any>} */
  const map = new Map()

  products.forEach((prod, i) => {
    const share = w[i] / totalW
    const src = labels[i]
    for (const c of prod.components || []) {
      const key = (c.name_en || c.formula || c.name_zh || c.id || '')
        .toString()
        .toLowerCase()
        .trim()
      if (!key) continue
      const add = (Number(c.percent) || 0) * share
      if (map.has(key)) {
        const prev = map.get(key)
        prev.percent += add
        if (prev.from && !prev.from.includes(src)) prev.from.push(src)
      } else {
        map.set(key, {
          name_zh: c.name_zh,
          name_en: c.name_en,
          formula: c.formula,
          smiles: c.smiles,
          percent: add,
          role: c.role || `来自${src}`,
          from: [src],
        })
      }
    }
  })

  let components = [...map.values()]
  const sum = components.reduce((s, c) => s + c.percent, 0) || 1
  components = components
    .map((c, i) => ({
      ...c,
      id: `c-${i}`,
      percent: Math.round((c.percent / sum) * 10000) / 100,
      role: c.from?.length > 1 ? `混合·${c.from.join('+')}` : c.role,
    }))
    .sort((a, b) => b.percent - a.percent)

  // 重新编号 id
  components = components.map((c, i) => ({ ...c, id: `c-${i}` }))

  const ratio = w.map((x) => formatRatio(x)).join(' : ')
  const title = labels.join(' + ')

  return {
    kind: 'blend',
    product_zh: title,
    product_en: products.map((p) => p.product_en || p.product_zh).join(' + '),
    note: `按质量比 ${ratio} 混合后的估算占比（原型，非精密实验）`,
    reason: `将「${labels.join('」与「')}」按 ${ratio} 做加法混合`,
    components,
    blend: {
      labels,
      weights: w,
      ratio,
    },
  }
}

function formatRatio(n) {
  if (Number.isInteger(n)) return String(n)
  return String(Math.round(n * 100) / 100)
}
