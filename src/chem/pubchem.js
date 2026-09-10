import { resolveWithDeepSeek } from './deepseek.js'
import { parseAddExpression, mergeProducts } from './blend.js'
import {
  ALIASES,
  aliasLookup,
  buildLookupCandidates,
  expandMixtureComponents,
  findMixtureExpand,
  toChinese,
} from './chemAliases.js'

const PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug'
const PUBCHEM_AUTOCOMPLETE = 'https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound'

const FORMULA_RE = /^[A-Z][a-z]?(?:\d+)?(?:[A-Z][a-z]?(?:\d+)?)*$/
const SMILES_HINT_RE = /[=#()\[\]\\\/@+.-]/

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeQuery(raw) {
  const q = raw.trim().replace(/\s+/g, ' ')
  if (!q) return ''
  const aliased = aliasLookup(q)
  if (aliased !== q) return aliased
  return q
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (c) => '₀₁₂₃₄₅₆₇₈₉'.indexOf(c).toString())
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
}

/**
 * 是否更像日常自然语言 / 商品名（优先走 AI 多成分）
 * @param {string} raw
 */
export function looksLikeNaturalLanguage(raw) {
  const q = raw.trim()
  if (!q) return false
  if (ALIASES[q] || ALIASES[q.toLowerCase()]) return false
  if (findMixtureExpand(q)) return true
  if (/^\d+$/.test(q)) return false
  const compact = q.replace(/\s/g, '')
  if (FORMULA_RE.test(compact)) return false
  if (SMILES_HINT_RE.test(q)) return false
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(q)) return false
  if (/[\u4e00-\u9fff]/.test(q)) return true
  if (/\s/.test(q) || /[-']/.test(q)) return true
  return false
}

/**
 * @param {string} path
 * @param {'text' | 'json'} as
 */
async function fetchPubChem(path, as = 'text') {
  const res = await fetch(`${PUBCHEM}${path}`, {
    headers: { Accept: as === 'json' ? 'application/json' : 'chemical/x-mdl-sdfile' },
  })
  if (!res.ok) {
    const err = new Error(`PubChem ${res.status}`)
    err.status = res.status
    throw err
  }
  return as === 'json' ? res.json() : res.text()
}

async function fetchSdfByCid(cid) {
  try {
    return await fetchPubChem(`/compound/cid/${cid}/SDF?record_type=3d`)
  } catch {
    return await fetchPubChem(`/compound/cid/${cid}/SDF`)
  }
}

async function fetchProps(cid) {
  const data = await fetchPubChem(
    `/compound/cid/${cid}/property/Title,IUPACName,MolecularFormula,MolecularWeight,CanonicalSMILES,IsomericSMILES/JSON`,
    'json',
  )
  const p = data?.PropertyTable?.Properties?.[0] || {}
  return {
    cid: Number(cid),
    title: p.Title || '',
    iupac: p.IUPACName || '',
    formula: p.MolecularFormula || '',
    weight: p.MolecularWeight != null ? String(p.MolecularWeight) : '',
    smiles: p.CanonicalSMILES || p.IsomericSMILES || '',
  }
}

async function resolveByName(name) {
  const data = await fetchPubChem(`/compound/name/${encodeURIComponent(name)}/cids/JSON`, 'json')
  const cid = data?.IdentifierList?.CID?.[0]
  if (!cid) throw new Error('name not found')
  return cid
}

async function resolveBySmiles(smiles) {
  const data = await fetchPubChem(`/compound/smiles/${encodeURIComponent(smiles)}/cids/JSON`, 'json')
  const cid = data?.IdentifierList?.CID?.[0]
  if (!cid) throw new Error('smiles not found')
  return cid
}

async function resolveByFormula(formula) {
  const data = await fetchPubChem(
    `/compound/fastformula/${encodeURIComponent(formula)}/cids/JSON?MaxRecords=5`,
    'json',
  )
  const cid = data?.IdentifierList?.CID?.[0]
  if (!cid) throw new Error('formula not found')
  return cid
}

/**
 * PubChem 自动补全：商品名/模糊名 → 标准化合物名
 * @param {string} term
 * @returns {Promise<string[]>}
 */
async function autocompleteNames(term) {
  const q = String(term || '').trim()
  if (!q || q.length < 2 || /[\u4e00-\u9fff]/.test(q)) return []
  try {
    const res = await fetch(
      `${PUBCHEM_AUTOCOMPLETE}/${encodeURIComponent(q)}/json?limit=6`,
    )
    if (!res.ok) return []
    const data = await res.json()
    const dict = data?.dictionary_terms?.compound
    return Array.isArray(dict) ? dict.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

/**
 * 单条查询词 → PubChem 结构
 * @param {string} query
 * @param {{ type?: string }} [hint]
 */
export async function lookupDirect(query, hint = {}) {
  const attempts = []

  if (hint.type === 'smiles') {
    attempts.push({ type: 'smiles', value: query })
  } else if (hint.type === 'formula') {
    attempts.push({ type: 'formula', value: query })
  } else if (hint.type === 'cid' || /^\d+$/.test(query)) {
    attempts.push({ type: 'cid', value: query })
  } else if (hint.type === 'name') {
    attempts.push({ type: 'name', value: query })
  } else {
    // 无 hint：自动推断
    if (/^\d+$/.test(query)) {
      attempts.push({ type: 'cid', value: query })
    } else {
      const aliased = aliasLookup(query)
      attempts.push({ type: 'name', value: aliased })
      if (aliased !== query) attempts.push({ type: 'name', value: query })
      if (SMILES_HINT_RE.test(query) || /^[A-Za-z0-9@+\-\\\/\[\]()=#%.]+$/.test(query)) {
        attempts.push({ type: 'smiles', value: query })
      }
      const formula = query.replace(/\s/g, '')
      if (FORMULA_RE.test(formula) || /^[A-Za-z0-9]+$/.test(formula)) {
        attempts.push({ type: 'formula', value: formula })
      }
    }
  }

  let lastError = null
  for (const a of attempts) {
    try {
      let cid
      if (a.type === 'cid') cid = a.value
      else if (a.type === 'name') cid = await resolveByName(a.value)
      else if (a.type === 'smiles') cid = await resolveBySmiles(a.value)
      else cid = await resolveByFormula(a.value)

      const [sdf, props] = await Promise.all([fetchSdfByCid(cid), fetchProps(cid)])
      if (!sdf || sdf.length < 20) throw new Error('empty structure')

      return {
        ...props,
        sdf,
        query,
        resolvedBy: a.type,
      }
    } catch (e) {
      lastError = e
    }
  }

  // 名称失败时尝试自动补全
  if (!hint.type || hint.type === 'name') {
    const suggestions = await autocompleteNames(aliasLookup(query))
    for (const s of suggestions) {
      if (s.toLowerCase() === query.toLowerCase()) continue
      try {
        const cid = await resolveByName(s)
        const [sdf, props] = await Promise.all([fetchSdfByCid(cid), fetchProps(cid)])
        if (!sdf || sdf.length < 20) continue
        return { ...props, sdf, query, resolvedBy: 'autocomplete', matchedName: s }
      } catch (e) {
        lastError = e
      }
    }
  }

  const err = new Error(lastError?.message || 'not found')
  err.status = lastError?.status
  throw err
}

/**
 * 加载单个成分的 3D 结构（多候选 + 混合物拆分回退）
 * @param {{ name_en?: string, name_zh?: string, formula?: string, smiles?: string }} comp
 */
export async function loadComponentStructure(comp) {
  // 1) 若整项是已知混合物，先拆成纯分子再取占比最高且可加载的
  const mixKeys = [comp.name_zh, comp.name_en].filter(Boolean)
  for (const k of mixKeys) {
    if (!findMixtureExpand(k)) continue
    const expanded = expandMixtureComponents([
      { ...comp, percent: Number(comp.percent) || 100 },
    ])
    let lastMixErr = null
    for (const sub of expanded) {
      try {
        const mol = await loadComponentStructurePure(sub)
        return {
          ...mol,
          expandedFrom: comp.name_zh || comp.name_en,
          proxyComponent: sub,
        }
      } catch (e) {
        lastMixErr = e
      }
    }
    if (lastMixErr) {
      // 继续走纯分子候选，不立刻抛
    }
  }

  return loadComponentStructurePure(comp)
}

/**
 * @param {{ name_en?: string, name_zh?: string, formula?: string, smiles?: string }} comp
 */
async function loadComponentStructurePure(comp) {
  const candidates = buildLookupCandidates(comp)
  let lastError = null

  for (const c of candidates) {
    try {
      return await lookupDirect(c.value, { type: c.type })
    } catch (e) {
      lastError = e
    }
  }

  const label = comp.name_zh || comp.name_en || comp.formula || '该成分'
  throw new Error(
    `未找到「${label}」的 3D 结构${lastError?.message ? `（${lastError.message}）` : ''}。` +
      `可能是混合物/聚合物/商品名，请换用纯分子名（如果糖、葡萄糖）或化学式。`,
  )
}

/**
 * 查询单一物品（不含加法）
 * @param {string} input
 * @param {{ onStatus?: (msg: string) => void }} [opts]
 */
export async function lookupSingle(input, opts = {}) {
  const onStatus = opts.onStatus || (() => {})
  const raw = input.trim()
  if (!raw) throw new Error('请输入内容')

  // 本地已知混合物：不依赖 AI 也能拆
  const localMix = findMixtureExpand(raw) || findMixtureExpand(aliasLookup(raw))
  if (localMix && looksLikeNaturalLanguage(raw)) {
    onStatus(`本地配方拆解「${raw}」…`)
    const components = expandMixtureComponents([
      {
        name_zh: raw,
        name_en: aliasLookup(raw),
        percent: 100,
        role: '主体',
      },
    ])
    return finalizeFromComponents(
      {
        kind: 'mixture',
        product_zh: raw,
        product_en: '',
        note: '本地典型配方估算（混合物已拆为可查纯分子）',
        reason: `「${raw}」为混合物，已展开为可显示的分子结构`,
        components,
      },
      raw,
      onStatus,
    )
  }

  const query = normalizeQuery(raw)
  const preferAi = looksLikeNaturalLanguage(raw)

  if (preferAi) {
    onStatus(`正在拆解「${raw}」…`)
    const ai = await resolveWithDeepSeek(raw)
    return finalizeProduct(ai, raw, onStatus)
  }

  try {
    onStatus(`正在获取「${raw}」结构…`)
    const mol = await lookupDirect(query)
    const nameZh = toChinese(raw) !== raw ? toChinese(raw) : toChinese(mol.title) || raw
    return {
      kind: 'pure',
      product_zh: nameZh,
      product_en: mol.title || '',
      note: '单一化学物质',
      reason: '',
      components: [
        {
          id: 'c-0',
          name_zh: nameZh,
          name_en: mol.title || query,
          formula: mol.formula,
          smiles: mol.smiles,
          percent: 100,
          role: '主体',
        },
      ],
      activeIndex: 0,
      molecule: mol,
    }
  } catch {
    onStatus(`「${raw}」直查未命中，智能拆解中…`)
    const ai = await resolveWithDeepSeek(raw)
    return finalizeProduct(ai, raw, onStatus)
  }
}

/**
 * 解析自由输入 → 产品档案（支持 A + B 加法混合）
 * @param {string} input
 * @param {{ onStatus?: (msg: string) => void, parts?: { name: string, weight?: number }[] }} [opts]
 */
export async function lookupMolecule(input, opts = {}) {
  const onStatus = opts.onStatus || (() => {})
  const raw = input.trim()

  let parts = opts.parts?.filter((p) => p?.name?.trim()) || null
  if (!parts || parts.length < 2) {
    const parsed = parseAddExpression(raw)
    if (parsed) parts = parsed
  }

  if (parts && parts.length >= 2) {
    return blendLookup(parts, onStatus)
  }

  if (!raw && !(parts?.[0]?.name)) throw new Error('请输入内容')
  return lookupSingle(parts?.[0]?.name || raw, { onStatus })
}

/**
 * @param {{ name: string, weight?: number }[]} parts
 * @param {(msg: string) => void} onStatus
 */
async function blendLookup(parts, onStatus) {
  const labels = parts.map((p) => p.name.trim())
  onStatus(`加法混合：${labels.join(' + ')}`)

  const products = []
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i].name.trim()
    onStatus(`(${i + 1}/${parts.length}) 解析「${name}」…`)
    const prod = await lookupSingle(name, {
      onStatus: (msg) => onStatus(`(${i + 1}/${parts.length}) ${msg}`),
    })
    products.push({
      product_zh: prod.product_zh,
      product_en: prod.product_en,
      components: prod.components,
      note: prod.note,
      reason: prod.reason,
    })
  }

  const weights = parts.map((p) => p.weight ?? 1)
  const blended = mergeProducts(products, weights)
  // 混合后再展开一层可能残留的混合物名
  blended.components = expandMixtureComponents(blended.components)

  if (!blended.components.length) {
    throw new Error('混合后没有可显示的成分')
  }

  return finalizeFromComponents(blended, labels.join(' + '), onStatus)
}

/**
 * @param {Awaited<ReturnType<typeof resolveWithDeepSeek>>} ai
 * @param {string} raw
 * @param {(msg: string) => void} onStatus
 */
async function finalizeProduct(ai, raw, onStatus) {
  if (!ai.components.length) {
    throw new Error(`无法解析「${raw}」的化学成分`)
  }

  // AI 返回的「高果糖玉米糖浆」等中间混合物 → 拆成纯分子
  const components = expandMixtureComponents(ai.components)

  return finalizeFromComponents(
    {
      kind: components.length <= 1 ? 'pure' : ai.kind === 'pure' ? 'mixture' : ai.kind,
      product_zh: ai.product_zh || raw,
      product_en: ai.product_en,
      note: ai.note,
      reason: ai.reason,
      components,
      model: ai.model,
    },
    raw,
    onStatus,
  )
}

/**
 * 从成分列表加载第一个可显示结构；失败则依次尝试后续成分
 * @param {any} product
 * @param {string} raw
 * @param {(msg: string) => void} onStatus
 */
async function finalizeFromComponents(product, raw, onStatus) {
  const components = product.components || []
  if (!components.length) {
    throw new Error(`无法解析「${raw}」的化学成分`)
  }

  const errors = []
  for (let i = 0; i < components.length; i++) {
    const primary = components[i]
    onStatus(`加载 ${primary.name_zh || primary.name_en}…`)
    try {
      const molecule = await loadComponentStructure(primary)
      // 若用了代理分子，在 UI 上保留原始列表，但结构来自可查分子
      return {
        ...product,
        kind: components.length <= 1 ? product.kind || 'pure' : product.kind || 'mixture',
        components,
        activeIndex: i,
        molecule,
      }
    } catch (e) {
      errors.push(`${primary.name_zh || primary.name_en}: ${e.message}`)
      onStatus(`${primary.name_zh || primary.name_en} 暂无结构，尝试下一成分…`)
    }
  }

  throw new Error(
    `「${raw}」的成分均无法加载 3D 结构。\n${errors.slice(0, 3).join('\n')}`,
  )
}

export { parseAddExpression, mergeProducts } from './blend.js'
export { expandMixtureComponents, ALIASES } from './chemAliases.js'
