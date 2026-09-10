/**
 * DeepSeek 解析日常用语 → 成分清单（含百分比）
 * - Tauri 桌面：invoke Rust 命令（密钥只在后端）
 * - 纯 Web：走 Vite 代理 /api/resolve-molecule
 */

import { apiUrl } from '../lib/apiOrigin.ts'

const IS_IPAD_BUILD = import.meta.env.HOLO_TARGET === 'ipad'
const CHEM_API_ORIGIN = String(import.meta.env.VITE_API_ORIGIN || 'https://hologrip.cn').replace(/\/+$/, '')

function chemApiUrl(path) {
  // Tauri iPad builds must never depend on the WebView origin (tauri:// or
  // asset://). Keep the web fallback on the same absolute remote ingress as
  // the native command, while normal website builds remain same-origin.
  return IS_IPAD_BUILD ? `${CHEM_API_ORIGIN}${path}` : apiUrl(path)
}

function isTauri() {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}

/**
 * @param {string} query
 */
export async function resolveWithDeepSeek(query) {
  // iPad 与网页统一走 hologrip.cn 的服务端代理；桌面端仍可优先尝试本地 Tauri 命令。
  // 宿主 monorepo 的 Tauri 未必注册 resolve_molecule；失败时回退 Web 代理。
  let data
  if (isTauri()) {
    try {
      data = await resolveViaTauri(query)
    } catch (err) {
      console.warn(`[deepseek] ${IS_IPAD_BUILD ? 'iPad' : 'Tauri'} native invoke 失败，回退 Web 代理`, err)
      data = await resolveViaWebProxy(query)
    }
  } else {
    data = await resolveViaWebProxy(query)
  }

  if (!data.ok) {
    throw new Error(data.reason || '无法将输入对应到具体分子')
  }

  const components = normalizeComponents(data.components, data, query)

  return {
    kind: data.kind === 'pure' || components.length <= 1 ? 'pure' : 'mixture',
    product_zh: String(data.product_zh || data.name_zh || query).trim(),
    product_en: String(data.product_en || data.name_en || '').trim(),
    note: String(data.note || '百分比为典型公开估算原型，非厂商精确配方').trim(),
    reason: String(data.reason || '').trim(),
    model: data.model || 'deepseek-v4-flash',
    components,
  }
}

/**
 * Resolve a chemical reaction through the shared server proxy.
 * @param {string[]} reactants
 * @param {string} condition
 */
export async function resolveReactionWithDeepSeek(reactants, condition = '') {
  let data
  if (isTauri()) {
    try {
      data = await resolveViaTauriReaction(reactants, condition)
    } catch (err) {
      console.warn('[deepseek] Tauri reaction invoke 失败，回退 Web 代理', err)
      data = await postJsonWithRetry('/api/resolve-reaction', { reactants, condition }, 'AI 反应判定失败')
    }
  } else {
    data = await postJsonWithRetry('/api/resolve-reaction', { reactants, condition }, 'AI 反应判定失败')
  }
  if (!data?.ok) throw new Error(data?.reason || 'AI 无法判定该反应。')
  return data
}

/**
 * @param {string} query
 */
async function resolveViaTauri(query) {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke('resolve_molecule', { query })
  } catch (err) {
    const msg =
      typeof err === 'string'
        ? err
        : err?.message || err?.toString?.() || 'AI 解析失败'
    throw new Error(msg)
  }
}

async function resolveViaTauriReaction(reactants, condition) {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke('resolve_reaction', { reactants, condition })
}

/**
 * @param {string} query
 */
async function resolveViaWebProxy(query) {
  return postJsonWithRetry('/api/resolve-molecule', { query }, 'AI 解析失败')
}

/**
 * DeepSeek 偶尔会返回格式异常的响应，生产代理会短暂返回 5xx。
 * 对这类瞬时失败自动重试，避免用户需要重复点击 AI 解析。
 * @param {string} path
 * @param {object} body
 * @param {string} label
 */
async function postJsonWithRetry(path, body, label) {
  const retryable = new Set([408, 425, 429, 500, 502, 503, 504])
  const delays = [450, 1000]
  let lastError

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      const res = await fetch(chemApiUrl(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) return data

      const error = new Error(data.error || `${label} (${res.status})`)
      error.status = res.status
      lastError = error
      if (!retryable.has(res.status) || attempt === delays.length) throw error
    } catch (error) {
      lastError = error
      if (attempt === delays.length || (error?.status && !retryable.has(error.status))) throw error
    }

    await new Promise((resolve) => setTimeout(resolve, delays[attempt]))
  }

  throw lastError || new Error(`${label}（未知错误）`)
}

/**
 * 兼容多变 JSON 格式，并规范化 components
 * @param {any} list
 * @param {any} data
 * @param {string} query
 */
function normalizeComponents(list, data, query = '') {
  let items = Array.isArray(list) ? list : []

  // 1. 自动寻找替代数组字段 (items, ingredients, composition, elements 等)
  if (!items.length && data && typeof data === 'object') {
    const altKeys = ['items', 'ingredients', 'composition', 'elements', 'molecules', 'results', 'data']
    for (const key of altKeys) {
      if (Array.isArray(data[key]) && data[key].length > 0) {
        items = data[key]
        break
      }
    }
  }

  // 2. 如果 composition/ingredients 是对象 (如 { "water": "75%" })
  if (!items.length && data && typeof data === 'object') {
    const dict = data.composition || data.ingredients
    if (dict && typeof dict === 'object' && !Array.isArray(dict)) {
      items = Object.entries(dict).map(([name, val]) => {
        const num = parseFloat(String(val).replace(/[^0-9.]/g, '')) || 10
        return {
          name_zh: name,
          name_en: name,
          percent: num,
        }
      })
    }
  }

  // 3. 旧格式：只有 name_en 等单分子字段
  if (!items.length && (data?.name_en || data?.name_zh || data?.formula)) {
    items = [
      {
        name_zh: data.name_zh,
        name_en: data.name_en,
        formula: data.formula,
        smiles: data.smiles,
        percent: 100,
        role: '主体',
      },
    ]
  }

  const mapped = items
    .map((c, i) => {
      if (typeof c === 'string') {
        return {
          id: `c-${i}`,
          name_zh: c,
          name_en: c,
          formula: '',
          smiles: '',
          percent: Math.max(1, Math.round(100 / items.length)),
          role: '成分',
        }
      }
      return {
        id: `c-${i}`,
        name_zh: String(c.name_zh || c.name || c.title || '').trim(),
        name_en: String(c.name_en || c.english_name || c.chemical_name || c.name || '').trim(),
        formula: String(c.formula || '').trim(),
        smiles: String(c.smiles || '').trim(),
        percent: clampPercent(c.percent || c.percentage),
        role: String(c.role || c.category || '成分').trim(),
      }
    })
    .filter((c) => c.name_en || c.name_zh || c.formula || c.smiles)

  // 4. 极端兜底：保证至少有 1 个可查询条目
  if (!mapped.length && query) {
    mapped.push({
      id: 'c-fallback',
      name_zh: query,
      name_en: query,
      formula: '',
      smiles: '',
      percent: 100,
      role: '主体',
    })
  }

  mapped.sort((a, b) => b.percent - a.percent)
  return mapped
}

function clampPercent(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 10
  if (n > 100) return 100
  return Math.round(n * 100) / 100
}
